/**
 * DIE Zuweisung von Portblöcken. Aufgerufen ausschließlich aus
 * `WorktreeManager.create()` (belegen) und `.remove()` (freigeben) — durch diese
 * eine Stelle laufen beide Anlagepfade (Feature-Worktree über
 * `Orchestrator.prepareWorktree()` und Chat-Worktree über
 * `ChatWorkService.ensureSession()`). Kein Aufruf aus Orchestrator,
 * MergeQueueService oder einer Route: zwei Quellen erzeugen genau die Kollision,
 * die dieses Feature beseitigt (FR-001, research E1).
 *
 * Der Allocator ist die einzige Klasse mit Schreibzugriff auf `port_blocks`.
 */
import { createServer } from 'node:net';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { blockStarts, portsOfBlock, type PortBlock, type PortRangeConfig } from '@sdd/shared';
import type { PortRepo } from '../db/portRepo.js';
import type { AttentionRepo } from '../db/repos.js';
import { git } from '../git/git.js';
import { bus } from '../events.js';

/** Der Worktree eines Features (oder eines Wissens-Chats). */
export interface WorktreeBlockOwner {
  kind: 'worktree';
  /** Pfad des Worktrees; wird über realpath kanonisiert. */
  path: string;
  projectId: string;
  projectName: string;
  /** Haupt-Checkout — Ziel des git-Ausschlusses. */
  projectPath: string;
  featureName: string;
  branch: string;
}

/** Der projektweite Block für geteilte Dienste (research E2/E7). */
export interface ProjectBlockOwner {
  kind: 'project';
  projectId: string;
  projectName: string;
  projectPath: string;
}

export type BlockOwner = WorktreeBlockOwner | ProjectBlockOwner;

/** Prüft, ob ein Port frei ist. Injizierbar, damit Tests ohne echte Sockets auskommen. */
export type PortProbe = (port: number) => Promise<boolean>;

export interface PortAllocatorDeps {
  ports: PortRepo;
  range: PortRangeConfig;
  /** Für die Meldung, wenn der git-Ausschluss der Env-Datei nicht greift (FR-009). */
  attention?: AttentionRepo;
  probe?: PortProbe;
  /** Zeitlimit der Freiheitsprüfung je Block (research E3). */
  blockProbeTimeoutMs?: number;
}

/** Zeitlimit der Bind-Probe eines ganzen Blocks. */
const BLOCK_PROBE_TIMEOUT_MS = 500;

/** Muster im git-Ausschluss; deckt `.sdd/env` und alles weitere darunter ab. */
const EXCLUDE_PATTERN = '/.sdd/';

export class PortAllocator {
  private probe: PortProbe;
  private blockProbeTimeoutMs: number;

  constructor(private deps: PortAllocatorDeps) {
    this.probe = deps.probe ?? bindProbe;
    this.blockProbeTimeoutMs = deps.blockProbeTimeoutMs ?? BLOCK_PROBE_TIMEOUT_MS;
  }

  /** Läufe pro Besitzer serialisieren — zwei parallele Aufrufe vergeben nie zweimal. */
  private locks = new Map<string, Promise<unknown>>();
  private serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(fn, fn);
    this.locks.set(
      key,
      run.catch(() => {}),
    );
    return run;
  }

  /** Kanonische Besitzerkennung: realpath beim Worktree, projectId beim Projekt. */
  private ownerId(owner: BlockOwner): string {
    return owner.kind === 'worktree' ? canonical(owner.path) : owner.projectId;
  }

  /**
   * Block eines Besitzers sicherstellen. Idempotent: ein bestehender Block wird
   * unverändert zurückgegeben — er wandert nie und wird nie umverteilt (FR-004).
   * Beim Worktree wird zusätzlich die Env-Datei geschrieben.
   */
  async ensureFor(owner: BlockOwner): Promise<PortBlock> {
    const ownerId = this.ownerId(owner);
    return this.serialize(`${owner.kind}::${ownerId}`, async () => {
      const existing = this.deps.ports.findLiveByOwner(owner.kind, ownerId);
      const block = existing ?? (await this.allocate(owner, ownerId));
      if (owner.kind === 'worktree') await this.writeEnvFile(owner, block);
      return block;
    });
  }

  /** Anfang des belegten Blocks eines Worktrees; null = keiner. */
  baseForWorktree(worktreePath: string): number | null {
    return this.deps.ports.findLiveByOwner('worktree', canonical(worktreePath))?.base ?? null;
  }

  /** Anfang des belegten Projektblocks (geteilte Dienste); null = keiner. */
  baseForProject(projectId: string): number | null {
    return this.deps.ports.findLiveByOwner('project', projectId)?.base ?? null;
  }

  /** Freigeben; der Block ist danach wieder vergebbar (FR-005). */
  release(owner: BlockOwner): void {
    this.deps.ports.release(owner.kind, this.ownerId(owner), Date.now());
  }

  /** Freigeben allein über den Worktree-Pfad (Aufrufer ohne Projektkontext). */
  releaseWorktree(worktreePath: string): void {
    this.deps.ports.release('worktree', canonical(worktreePath), Date.now());
  }

  /**
   * Blöcke von Worktrees freigeben, deren Verzeichnis es nicht mehr gibt.
   * Deckt den Edge Case „Worktree von außen gelöscht, Portbereich noch vergeben"
   * ab und läuft im Boot-Pfad sowie in der Worktree-Erhebung (research E14).
   *
   * @returns Anzahl der freigegebenen Blöcke.
   */
  reconcile(): number {
    const now = Date.now();
    let freed = 0;
    for (const b of this.deps.ports.live()) {
      if (b.ownerKind !== 'worktree') continue;
      if (existsSync(b.ownerId)) continue;
      this.deps.ports.release('worktree', b.ownerId, now);
      freed++;
    }
    return freed;
  }

  // ---------- Vergabe ----------

  /**
   * Ersten freien Block belegen. „Frei" heißt zweierlei: nicht in der Buchführung
   * UND jeder einzelne Port bindbar. Ein belegter Port verwirft den GANZEN Block
   * — die beobachtete Kollision betraf 8080 *und* 4000 (FR-003, research E3).
   */
  private async allocate(owner: BlockOwner, ownerId: string): Promise<PortBlock> {
    const span = this.deps.range.blockSize;
    const taken = new Set(this.deps.ports.live().map((b) => b.base));

    for (const base of blockStarts(this.deps.range)) {
      if (taken.has(base)) continue;
      if (!(await this.blockIsFree(base, span))) continue;
      try {
        return this.deps.ports.allocate({
          ownerKind: owner.kind,
          ownerId,
          projectId: owner.projectId,
          base,
          span,
          allocatedAt: Date.now(),
        });
      } catch {
        // Der partielle Index hat zugeschlagen: ein anderer Vorgang war schneller.
        // Kein Grund zum Abbruch — der nächste Block wird geprüft.
        taken.add(base);
      }
    }

    throw new Error(
      `Keine freien Portbereiche mehr (${this.deps.range.start}–${this.deps.range.end}, Breite ${span}). ` +
        `Nicht mehr benötigte Worktrees entfernen oder SDD_PORT_RANGE_END erhöhen.`,
    );
  }

  /** Alle Ports des Blocks nebenläufig prüfen, mit Zeitlimit über den ganzen Block. */
  private async blockIsFree(base: number, span: number): Promise<boolean> {
    const probes = Promise.all(portsOfBlock(base, span).map((p) => this.probe(p)));
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), this.blockProbeTimeoutMs));
    const result = await Promise.race([probes, timeout]);
    // Zeitüberschreitung ⇒ Block gilt als nicht frei: lieber einen Block überspringen
    // als eine Doppelvergabe riskieren.
    return result !== null && result.every(Boolean);
  }

  // ---------- Env-Datei ----------

  /**
   * `<worktree>/.sdd/env` mit den STABILEN Angaben schreiben (FR-006). Bei jeder
   * Bereitstellung neu — die Zuweisung des Toolkits gewinnt gegen eine von Hand
   * veränderte Datei (Edge Case der Spec).
   *
   * `SDD_PHASE`, `SDD_STAGE` und `SDD_PROFILE` stehen bewusst NICHT darin: sie
   * wechseln pro Lauf, eine Datei mit veraltetem Phasenwert wäre eine
   * Falschaussage (research E4).
   */
  private async writeEnvFile(owner: WorktreeBlockOwner, block: PortBlock): Promise<void> {
    if (!existsSync(owner.path)) return;
    const body = [
      '# Von SDD-Toolkit erzeugt — nicht bearbeiten, wird überschrieben.',
      `SDD_PORT_BASE=${block.base}`,
      `SDD_PORT_SPAN=${block.span}`,
      `SDD_WORKTREE=${owner.path}`,
      `SDD_PROJECT=${owner.projectName}`,
      `SDD_FEATURE=${owner.featureName}`,
      `SDD_BRANCH=${owner.branch}`,
      '',
    ].join('\n');

    const envPath = join(owner.path, '.sdd', 'env');
    // Der git-Ausschluss läuft VOR dem Schreiben, damit die Datei nie ungeschützt
    // im Arbeitsbaum liegt; scheitert er, entsteht danach die Meldung.
    const excludeError = await this.ensureGitExcluded(owner);
    try {
      await mkdir(dirname(envPath), { recursive: true });
      await writeFile(envPath, body, 'utf8');
    } catch (err) {
      this.raiseEnvProblem(owner, `Datei konnte nicht geschrieben werden: ${(err as Error).message}`);
      return;
    }
    if (excludeError) this.raiseEnvProblem(owner, excludeError);
  }

  /**
   * `/.sdd/` in `$GIT_COMMON_DIR/info/exclude` eintragen und den Ausschluss
   * NACHPRÜFEN — idempotent.
   *
   * Das GEMEINSAME git-Verzeichnis, nicht `<worktree>/.git`: im Worktree ist
   * `.git` eine Datei (gitdir-Redirect), und ein Eintrag im gemeinsamen
   * Verzeichnis deckt alle Worktrees des Repos ab. Die `.gitignore` des Projekts
   * wird NICHT angefasst — das wäre eine Änderung am Repo des Nutzers, die
   * committet würde (research E4).
   *
   * Nachprüfen statt annehmen: ein bereits getracktes `.sdd/` hebelt den
   * Ausschluss aus — das soll das Toolkit FESTSTELLEN (FR-009).
   *
   * @returns Grund, wenn der Ausschluss nicht greift; null, wenn alles in Ordnung
   * ist ODER das Verzeichnis gar kein git-Arbeitsbaum ist (dann gibt es nichts
   * auszuschließen und keinen Commit, in den etwas geraten könnte).
   */
  private async ensureGitExcluded(owner: WorktreeBlockOwner): Promise<string | null> {
    const dirResult = await git(owner.path, ['rev-parse', '--git-common-dir']);
    if (dirResult.code !== 0) return null;

    const raw = dirResult.stdout.trim();
    const commonDir = isAbsolute(raw) ? raw : resolve(owner.path, raw);
    const excludePath = join(commonDir, 'info', 'exclude');

    try {
      const current = await readFile(excludePath, 'utf8').catch(() => '');
      if (!current.split('\n').some((line) => line.trim() === EXCLUDE_PATTERN)) {
        await mkdir(dirname(excludePath), { recursive: true });
        const sep = current === '' || current.endsWith('\n') ? '' : '\n';
        await appendFile(excludePath, `${sep}${EXCLUDE_PATTERN}\n`);
      }
    } catch (err) {
      return `Der git-Ausschluss in ${excludePath} konnte nicht gesetzt werden: ${(err as Error).message}`;
    }

    const check = await git(owner.path, ['check-ignore', '-q', '.sdd/env']);
    return check.code === 0
      ? null
      : 'Die Datei .sdd/env ist nicht von git ausgeschlossen — sie würde in einen Commit geraten. ' +
          'Vermutlich ist .sdd/ im Repo bereits getrackt.';
  }

  /** „Braucht dich"-Meldung statt eines stillen Commits (FR-009). */
  private raiseEnvProblem(owner: WorktreeBlockOwner, reason: string): void {
    if (!this.deps.attention) return;
    const item = this.deps.attention.raise({
      kind: 'stack_failed',
      projectId: owner.projectId,
      message: [
        `${owner.featureName}: Portdatei .sdd/env konnte nicht sicher abgelegt werden`,
        `Worktree: ${owner.path}`,
        reason,
      ].join('\n'),
    });
    bus.emitEvent('attention_raised', item);
  }
}

/** Aufgelöster Pfad; fällt auf resolve() zurück, wenn er (noch) nicht existiert. */
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Freiheitsprüfung über einen echten BINDEVERSUCH auf `0.0.0.0`.
 *
 * Bind statt Connect: ein Dienst, der nur auf 127.0.0.1 lauscht, antwortet keinem
 * Connect-Versuch auf einer anderen Adresse, blockiert aber ein späteres Binden
 * auf 0.0.0.0. `EADDRINUSE` beim Binden ist genau die Frage, die die
 * Stack-Kommandos später auch stellen (research E3).
 */
export const bindProbe: PortProbe = (port) =>
  new Promise((resolveFree) => {
    const srv = createServer();
    const finish = (free: boolean): void => {
      srv.removeAllListeners();
      srv.close(() => resolveFree(free));
    };
    srv.once('error', () => {
      srv.removeAllListeners();
      resolveFree(false);
    });
    srv.once('listening', () => finish(true));
    try {
      srv.listen({ host: '0.0.0.0', port, exclusive: true });
    } catch {
      resolveFree(false);
    }
  });
