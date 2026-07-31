import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAllowedOrigins } from './api/originGuard.js';

export interface ServerConfig {
  port: number;
  host: string;
  /** Browser-Origins, die HTTP-API und WebSockets nutzen dürfen (siehe api/originGuard.ts). */
  allowedOrigins: string[];
  /** Datenverzeichnis für DB, Logs, Hook-Event-Dateien, Snapshots. */
  dataDir: string;
  /** Gebautes Web-Bundle, das der Server im Prod-Modus mit ausliefert; null = Dev (Vite liefert das Web). */
  webDir: string | null;
  /** Erster vergebbarer Port der Blockvergabe (SDD_PORT_RANGE_START). */
  portRangeStart: number;
  /** Letzter vergebbarer Blockanfang (SDD_PORT_RANGE_END). */
  portRangeEnd: number;
  /** Breite eines Blocks (SDD_PORT_BLOCK_SIZE). */
  portBlockSize: number;
  /** Warnschwelle für freien Plattenplatz in Bytes (SDD_DISK_WARN_BYTES). */
  diskWarnBytes: number;
}

/**
 * Vorgabewerte der Portvergabe. 21000 liegt oberhalb der üblichen
 * Entwicklungsports (3000/4000/5173/8080) und unterhalb des ephemeren Bereichs,
 * den macOS ab 49152 vergibt; 20 Ports fassen ein Sieben-Dienste-Projekt mit
 * Reserve. Start 21000 / Ende 29980 / Breite 20 ergibt 449 Blöcke.
 */
export const PORT_RANGE_DEFAULTS = { start: 21000, end: 29980, blockSize: 20 } as const;

/** Vorgabe der Plattenwarnung: 10 GiB freier Platz. */
export const DISK_WARN_BYTES_DEFAULT = 10 * 1024 ** 3;

export function loadConfig(): ServerConfig {
  const dataDir = process.env.SDD_DATA_DIR ?? join(homedir(), '.sdd-toolkit');
  for (const sub of ['', 'logs', 'hooks', 'snapshots']) {
    mkdirSync(join(dataDir, sub), { recursive: true });
  }
  const port = Number(process.env.SDD_PORT ?? 4820);
  const webPort = Number(process.env.SDD_WEB_PORT ?? 4830);
  return {
    port,
    host: process.env.SDD_HOST ?? '127.0.0.1',
    allowedOrigins: buildAllowedOrigins([port, webPort], process.env.SDD_ALLOWED_ORIGINS),
    dataDir,
    webDir: resolveWebDir(),
    portRangeStart: positiveInt(process.env.SDD_PORT_RANGE_START, PORT_RANGE_DEFAULTS.start),
    portRangeEnd: positiveInt(process.env.SDD_PORT_RANGE_END, PORT_RANGE_DEFAULTS.end),
    portBlockSize: positiveInt(process.env.SDD_PORT_BLOCK_SIZE, PORT_RANGE_DEFAULTS.blockSize),
    diskWarnBytes: positiveInt(process.env.SDD_DISK_WARN_BYTES, DISK_WARN_BYTES_DEFAULT),
  };
}

/** Ganzzahl > 0 aus der Umgebung; alles andere fällt auf den Vorgabewert zurück. */
function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Prod-Modus (NODE_ENV=production oder SDD_SERVE_WEB=1): das gebaute Web-Bundle
 * ausliefern, damit EIN Prozess API + Web bedient. Default-Pfad relativ zum
 * kompilierten Server (packages/server/dist → packages/web/dist), per SDD_WEB_DIR
 * übersteuerbar. Existiert kein index.html, bleibt das Web-Serving aus.
 */
function resolveWebDir(): string | null {
  const serveWeb = process.env.NODE_ENV === 'production' || process.env.SDD_SERVE_WEB === '1';
  if (!serveWeb) return null;
  const dir = process.env.SDD_WEB_DIR
    ? resolve(process.env.SDD_WEB_DIR)
    : resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  return existsSync(join(dir, 'index.html')) ? dir : null;
}
