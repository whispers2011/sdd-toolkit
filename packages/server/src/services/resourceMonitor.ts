import { statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { platform } from 'node:process';
import type { ResourceSnapshot } from '@sdd/shared';
import type { ExecutionRepo } from '../db/repos.js';

/**
 * Lastbremse gegen das 20-s-Polling der Kopfleiste. 20 s Abruf + 10 s Cache ergibt
 * höchstens 30 s Alter — FR-021 verlangt 60 s, die Hälfte ist Reserve (D11, C3.3).
 */
export const CACHE_TTL_MS = 10_000;

/** `sysctl` darf den Abruf nicht aufhalten; ohne Antwort bleibt die Kennzahl unbekannt (C3.6). */
const SYSCTL_TIMEOUT_MS = 2_000;

/** Freier und gesamter Platz eines Datenträgers. */
export interface DiskUsage {
  freeBytes: number;
  totalBytes: number;
}

/** Auslastung des Auslagerungsspeichers. */
export interface SwapUsage {
  usedBytes: number;
  totalBytes: number;
  /** 0..1; bei abgeschalteter Auslagerung 0, nie NaN. */
  usedRatio: number;
}

export interface ResourceMonitorDeps {
  /** Datenverzeichnis — sein Datenträger ist der, auf dem es eng wird. */
  dataDir: string;
  executions: Pick<ExecutionRepo, 'listRunning'>;
  /** Uhr — in Tests gesetzt (D16). */
  now?: () => number;
  /** Plattenplatz; Vorgabe `fs.promises.statfs` (D9). Injektion für Tests. */
  readDisk?: (dataDir: string) => Promise<DiskUsage>;
  /** Rohe `sysctl -n vm.swapusage`-Zeile; `null` = diese Plattform kennt keine (D10). */
  readSwapLine?: () => Promise<string | null>;
}

/** Zahlwort mit Einheit, wie `sysctl` es schreibt: `4555.38M`. */
const MENGE = /^([\d.]+)([KMG])$/;

/**
 * Parst die Zeile von `sysctl -n vm.swapusage`:
 * `total = 6144.00M  used = 4555.38M  free = 1588.62M  (encrypted)`
 *
 * Rein und exportiert, damit das Format ohne macOS prüfbar ist. Alles, was nicht
 * sicher gelesen werden kann, ergibt `null` — geraten wird nichts (FR-022, D10).
 */
export function parseSwapUsage(line: string): SwapUsage | null {
  const totalBytes = mengeToBytes(line.match(/total\s*=\s*(\S+)/)?.[1]);
  const usedBytes = mengeToBytes(line.match(/used\s*=\s*(\S+)/)?.[1]);
  if (totalBytes === null || usedBytes === null) return null;
  // Abgeschaltete Auslagerung ist kein Fehler, sondern 0 % Auslastung.
  return { usedBytes, totalBytes, usedRatio: totalBytes > 0 ? usedBytes / totalBytes : 0 };
}

function mengeToBytes(text: string | undefined): number | null {
  const treffer = text?.match(MENGE);
  if (!treffer) return null;
  const zahl = Number(treffer[1]);
  if (!Number.isFinite(zahl)) return null;
  const faktor = treffer[2] === 'G' ? 1024 ** 3 : treffer[2] === 'M' ? 1024 ** 2 : 1024;
  return Math.round(zahl * faktor);
}

/**
 * Erhebt den Ressourcendruck auf Abruf (Contract C3).
 *
 * Zwei Festlegungen tragen das Verhalten:
 *
 * 1. **Bedarfsgesteuert mit kurzem Cache statt Hintergrund-Timer** (D11) — ein Timer
 *    würde auch messen, wenn niemand hinschaut, und SC-008 (< 1 % Last im Leerlauf)
 *    ohne Gegenwert belasten. Der Cache verhindert zugleich, dass mehrere offene
 *    Browser-Tabs die Erhebung vervielfachen.
 * 2. **Jede Kennzahl für sich** — `Promise.allSettled`, nicht `all`. Ein Fehlschlag
 *    beim Plattenplatz darf die Auslagerung nicht mitreissen (C3.7), und `snapshot()`
 *    wirft nie: die Route antwortet auch dann `200`, wenn alles fehlschlägt (C3.1).
 */
export class ResourceMonitor {
  private readonly now: () => number;
  private readonly readDisk: (dataDir: string) => Promise<DiskUsage>;
  private readonly readSwapLine: () => Promise<string | null>;
  private cached: ResourceSnapshot | null = null;

  constructor(private readonly deps: ResourceMonitorDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.readDisk = deps.readDisk ?? statfsUsage;
    this.readSwapLine = deps.readSwapLine ?? sysctlSwapLine;
  }

  async snapshot(): Promise<ResourceSnapshot> {
    const now = this.now();
    if (this.cached && now - this.cached.collectedAt < CACHE_TTL_MS) return this.cached;

    const [disk, swap] = await Promise.allSettled([
      this.readDisk(this.deps.dataDir),
      this.readSwapLine().then((line) => (line === null ? null : parseSwapUsage(line))),
    ]);

    const platte = disk.status === 'fulfilled' ? disk.value : null;
    const auslagerung = swap.status === 'fulfilled' ? swap.value : null;

    this.cached = {
      diskFreeBytes: platte?.freeBytes ?? null,
      diskTotalBytes: platte?.totalBytes ?? null,
      swapUsedRatio: auslagerung?.usedRatio ?? null,
      swapUsedBytes: auslagerung?.usedBytes ?? null,
      swapTotalBytes: auslagerung?.totalBytes ?? null,
      activeFeatures: this.activeFeatures(),
      collectedAt: now,
    };
    return this.cached;
  }

  /**
   * Zahl der Features, für die gerade mindestens ein Lauf läuft — dieselbe Quelle, aus
   * der ein Ausfall seine betroffenen Läufe zählt. Ein Chat-Lauf ohne Feature zählt über
   * sein Projekt; zwei Läufe desselben Features zählen einmal (D12).
   */
  private activeFeatures(): number {
    try {
      const schlüssel = this.deps.executions
        .listRunning()
        // Präfix, damit eine Feature-Kennung nie zufällig auf eine Projektkennung fällt.
        .map((run) => (run.featureId === null ? `project:${run.projectId}` : `feature:${run.featureId}`));
      return new Set(schlüssel).size;
    } catch {
      // Die Datenbank ist im Abgang schon zu — eine Zahl aus der Luft wäre schlechter als 0.
      return 0;
    }
  }
}

/** Freier Platz für Nicht-Root (`bavail`), nicht der für Root reservierte (`bfree`) — D9. */
async function statfsUsage(dataDir: string): Promise<DiskUsage> {
  const fs = await statfs(dataDir);
  return { freeBytes: Number(fs.bavail) * Number(fs.bsize), totalBytes: Number(fs.blocks) * Number(fs.bsize) };
}

/** Nur macOS kennt `vm.swapusage`; anderswo bleibt die Kennzahl unbekannt statt geraten (D10). */
function sysctlSwapLine(): Promise<string | null> {
  if (platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    execFile('sysctl', ['-n', 'vm.swapusage'], { timeout: SYSCTL_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}
