import { execFile } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { detectOverlaps } from '@sdd/shared';
import type {
  Feature,
  MainCheckoutInfo,
  Project,
  WorktreeDirState,
  WorktreeDiskInfo,
  WorktreeEntry,
  WorktreeEntryKind,
  WorktreeFileChange,
  WorktreeOverview,
  WorktreeProjectGroup,
  WorktreeWarning,
} from '@sdd/shared';
import type { FeatureRepo, ProjectRepo } from '../db/repos.js';
import type { WorktreeManager } from '../git/worktrees.js';
import { currentBranch, isBranchMergedInto, isGitRepo, uncommittedFileCount } from '../git/git.js';
import { readWorktreeInventory } from '../git/worktreeInventory.js';
import { changedOnTargetSince, collectWorktreeChanges } from './worktreeChanges.js';

/**
 * Minimale Sicht auf den PTY-Session-Bestand (nur was die Übersicht braucht) —
 * hält den Service ohne PTY-Apparat testbar.
 */
export interface WorktreeSessionSource {
  list(): { cwd: string; exited: boolean }[];
}

/** Nur das eine Event, das die Entfernen-Aktion sendet. */
export interface WorktreeOverviewBus {
  emitEvent(event: 'feature_updated', feature: Feature): void;
}

/** Der Portblock je Worktree — so viel, wie die Übersicht davon braucht. */
export interface WorktreePortSource {
  baseForWorktree(worktreePath: string): number | null;
  /** Blöcke verschwundener Verzeichnisse freigeben; liefert deren Anzahl. */
  reconcile(): number;
}

/** Meldungen der Übersicht (verwaiste Worktrees) — so viel, wie hier gebraucht wird. */
export interface WorktreeAttentionSink {
  raise(a: { kind: 'orphan_worktree'; projectId: string; message: string }): { id: string };
  listOpen(): { id: string; kind: string; message: string }[];
  resolve(id: string): boolean;
}

export interface WorktreeOverviewDeps {
  projects: ProjectRepo;
  features: FeatureRepo;
  ptys: WorktreeSessionSource;
  worktrees: WorktreeManager;
  bus: WorktreeOverviewBus;
  /** Portblöcke; fehlt sie, bleibt `portBase` überall null. */
  ports?: WorktreePortSource;
  /** Inbox für verwaiste Worktrees (FR-039). */
  attention?: WorktreeAttentionSink;
  /** Größe eines Verzeichnisses in Bytes; null = nicht ermittelbar. Injizierbar für Tests. */
  readDirSize?: (path: string) => Promise<number | null>;
  /** Freier Platz des Datenträgers; null = nicht ermittelbar (Quelle: ResourceMonitor). */
  diskFreeBytes?: () => Promise<number | null>;
  /** Dokumentierte Warnschwelle in Bytes (config.diskWarnBytes). */
  diskWarnBytes?: number;
  /** Stack-Abbau vor dem Entfernen eines Worktrees (FR-017). */
  stacks?: { down(feature: Feature, project: Project): Promise<void> };
}

/** Anzeigereihenfolge der Eintragsarten: erst die Arbeit, dann Chats, dann Verwaistes. */
const KIND_ORDER: Record<WorktreeEntryKind, number> = { feature: 0, chat: 1, orphan: 2 };

/**
 * Nebenläufig erhobene Worktrees. ~7 git-Aufrufe je Worktree — unbegrenzt
 * parallel sprengt Prozesse und Dateideskriptoren, strikt seriell wäre zu
 * langsam für SC-003 (research.md D9).
 */
const CONCURRENCY = 6;

/** Transportgrenze der Dateiliste je Worktree; die Gesamtzahl wird trotzdem ausgewiesen (FR-016). */
const MAX_FILES = 300;

/** Transportgrenze der Beispieldateien je Warnung; `fileCount` bleibt vollständig. */
const MAX_WARNING_FILES = 20;

/**
 * Lastbremse gegen das 5-Sekunden-Polling. Bewusst deutlich kürzer als das
 * Polling-Intervall: der Cache darf nie zu einer Anzeige führen, die spürbar
 * älter ist als das, was `collectedAt` behauptet (FR-028).
 */
const CACHE_TTL_MS = 2000;

/** Zeitlimit der Größenerhebung je Eintrag; danach gilt die Größe als unbekannt (FR-044). */
const SIZE_TIMEOUT_MS = 3000;

/** Warnschwelle, wenn keine konfigurierte durchgereicht wurde: 10 GiB. */
const DISK_WARN_BYTES_FALLBACK = 10 * 1024 ** 3;

/**
 * Größe eines Verzeichnisses über `du -sk` (Kilobyte-Blöcke × 1024).
 *
 * Systemwerkzeug statt eigenem `readdir`+`stat`: ein rekursiver Durchlauf über
 * ein `node_modules` mit 100 000 Einträgen ist in Node deutlich langsamer und
 * liefert dieselbe Zahl. Die Spec erlaubt die Größe ausdrücklich als Schätzung
 * (research E15).
 */
function duDirSize(path: string): Promise<number | null> {
  return new Promise((resolveSize) => {
    execFile('du', ['-sk', path], { timeout: SIZE_TIMEOUT_MS }, (err, stdout) => {
      // `du` meldet auch bei Teilfehlern (fehlende Rechte) einen Exit ≠ 0, gibt
      // aber trotzdem eine brauchbare Summe aus — deshalb zuerst die Ausgabe.
      const kb = Number(stdout.trim().split(/\s+/)[0]);
      if (Number.isFinite(kb) && kb >= 0) return resolveSize(kb * 1024);
      resolveSize(err ? null : null);
    });
  });
}

/** „ (1,4 GB)" bzw. leer, wenn die Größe unbekannt ist — für Meldungstexte. */
function sizeSuffix(sizeBytes: number | null): string {
  if (sizeBytes === null) return '';
  const gb = sizeBytes / 1024 ** 3;
  const text = gb >= 1 ? `${gb.toFixed(1).replace('.', ',')} GB` : `${Math.round(sizeBytes / 1024 ** 2)} MB`;
  return ` (${text})`;
}

/** Erhobene, noch UNGEKÜRZTE Dateiliste eines Eintrags — Datenbasis der Warnungen. */
interface EntryChanges {
  files: WorktreeFileChange[];
  base: string | null;
}

/** Aufgaben mit fester Nebenläufigkeit abarbeiten (kein neues Paket nötig). */
async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const item = items[i];
      if (item === undefined) return;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Abweisungsgründe der Entfernen-Aktion — die Route bildet sie 1:1 auf HTTP ab. */
export type WorktreeRemoveErrorCode =
  | 'project_not_found'
  | 'not_a_worktree'
  | 'main_checkout'
  | 'not_removable'
  | 'session_active'
  | 'uncommitted'
  | 'remove_failed';

export class WorktreeRemoveError extends Error {
  constructor(
    readonly code: WorktreeRemoveErrorCode,
    message: string,
    /** Nur bei code === 'uncommitted': wie viel Arbeit auf dem Spiel steht. */
    readonly uncommittedFileCount = 0,
  ) {
    super(message);
    this.name = 'WorktreeRemoveError';
  }
}

/**
 * Kanonisierter Pfad. `git worktree list` gibt stets aufgelöste Pfade aus; unter
 * macOS ist `/var/...` real `/private/var/...`. Ohne diese Auflösung erzeugt der
 * Vergleich mit `feature.worktreePath` systematisch falsche „verwaist"-Meldungen
 * (research.md D2).
 *
 * Existiert der Pfad nicht (mehr) — fehlendes Worktree-Verzeichnis, cwd einer
 * Session in einem gelöschten Unterordner —, wird der tiefste noch existierende
 * Vorfahre aufgelöst und der Rest angehängt. Sonst blieben genau die Fälle
 * unvergleichbar, für die die Übersicht gebaut wurde.
 */
function canonical(p: string): string {
  const abs = resolve(p);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(head);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return abs; // Wurzel erreicht, nichts auflösbar
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

/** Liegt `cwd` im Worktree (oder ist er selbst)? */
function isInside(cwd: string, root: string): boolean {
  return cwd === root || cwd.startsWith(root + sep);
}

/** Vom Toolkit erzeugte Wissens-Chat-Arbeitskopie (`chat-<id>` bzw. `chat/<id>`). */
function isChatWorktree(path: string, branch: string | null): boolean {
  return basename(path).startsWith('chat-') || (branch !== null && branch.startsWith('chat/'));
}

function dirMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Aggregiert die tool-weite Worktree-Übersicht: Git-Realität (`git worktree list`)
 * je Projekt, angereichert um die Feature-Tabelle. Die DB liefert Zuordnung und
 * Bearbeitungsstand — nie die Existenzaussage (research.md D1).
 *
 * Read-only bis auf die eine Aktion `removeWorktree()`.
 */
export class WorktreeOverviewService {
  constructor(private deps: WorktreeOverviewDeps) {}

  private cached: WorktreeOverview | null = null;
  private inFlight: Promise<WorktreeOverview> | null = null;

  /**
   * Übersicht abrufen. Innerhalb der TTL wird der letzte Stand geliefert;
   * parallele Abrufe teilen dieselbe laufende Erhebung (kein Stampede durch
   * mehrere pollende Clients). `refresh` umgeht beides.
   */
  async buildOverview(opts: { refresh?: boolean } = {}): Promise<WorktreeOverview> {
    if (opts.refresh !== true) {
      if (this.cached && Date.now() - this.cached.collectedAt < CACHE_TTL_MS) return this.cached;
      if (this.inFlight) return this.inFlight;
    }
    const run = this.collect().then(
      (overview) => {
        this.cached = overview;
        this.inFlight = null;
        return overview;
      },
      (err: unknown) => {
        this.inFlight = null;
        throw err;
      },
    );
    this.inFlight = run;
    return run;
  }

  /** Gecachten Stand verwerfen — nach jeder Veränderung der Git-Realität. */
  invalidate(): void {
    this.cached = null;
  }

  private async collect(): Promise<WorktreeOverview> {
    // Derselbe Durchlauf gibt die Blöcke verschwundener Verzeichnisse frei —
    // eine zweite Erkennung wäre eine zweite Wahrheit (research E14).
    this.deps.ports?.reconcile();

    const groups: WorktreeProjectGroup[] = [];
    for (const project of this.deps.projects.list()) {
      groups.push(await this.buildGroup(project));
    }
    this.reportOrphans(groups);
    return { groups, collectedAt: Date.now(), disk: await this.readDisk() };
  }

  /**
   * Freier Plattenplatz und Warnschwelle (FR-043). Quelle ist dieselbe wie beim
   * ResourceMonitor — sie zweimal zu messen wäre eine zweite Wahrheit über
   * denselben Datenträger.
   */
  private async readDisk(): Promise<WorktreeDiskInfo> {
    const warnBelowBytes = this.deps.diskWarnBytes ?? DISK_WARN_BYTES_FALLBACK;
    const freeBytes = (await this.deps.diskFreeBytes?.().catch(() => null)) ?? null;
    return { freeBytes, warnBelowBytes, warn: freeBytes !== null && freeBytes < warnBelowBytes };
  }

  /**
   * Jeder verwaiste Eintrag wird AKTIV gemeldet, nicht nur in einer Liste geführt
   * (FR-039, SC-011). Die Erhebung ist der einzige Ort, der Verwaistheit
   * überhaupt bestimmt; `AttentionRepo.raise()` dedupliziert gegen offene
   * Meldungen, deshalb entsteht je Erhebung keine Dublette (research E14).
   */
  private reportOrphans(groups: WorktreeProjectGroup[]): void {
    const attention = this.deps.attention;
    if (!attention) return;

    const paths = new Set<string>();
    for (const group of groups) {
      // Ein Block mit Fehler hat gar nicht erhoben — daraus darf nicht folgen,
      // dass seine Meldungen erledigt sind.
      if (group.error !== null) return;
      for (const entry of group.worktrees) {
        if (entry.kind !== 'orphan') continue;
        paths.add(entry.path);
        attention.raise({
          kind: 'orphan_worktree',
          projectId: group.projectId,
          message: `Verwaister Worktree ohne Feature: ${entry.path}${sizeSuffix(entry.sizeBytes)}`,
        });
      }
    }

    // Verschwundene Einträge auflösen: die Erhebung ist der einzige Ort, der
    // Verwaistheit bestimmt — also auch der einzige, der ihr Ende feststellt
    // (research E14).
    for (const item of attention.listOpen()) {
      if (item.kind !== 'orphan_worktree') continue;
      if (![...paths].some((p) => item.message.includes(p))) attention.resolve(item.id);
    }
  }

  /**
   * Einen einzelnen Worktree entfernen — die einzige verändernde Aktion dieses
   * Features. Die Guards laufen in dieser Reihenfolge, jeder mit eigenem Code:
   *
   * 1. Projekt bekannt?
   * 2. Pfad in der **frisch gelesenen** Worktree-Liste dieses Projekts? Damit
   *    kann der Client keinen beliebigen Ordner adressieren (Sicherheitsgrenze).
   * 3. Nicht der Haupt-Checkout (FR-026).
   * 4. Verzeichnis vorhanden — Registry-Leichen sind kein Entfern-Ziel (Prune
   *    ist außerhalb des Umfangs).
   * 5. Keine laufende Session im Worktree (FR-025).
   * 6. Uncommittete Änderungen nur mit ausdrücklichem `force` (FR-024).
   */
  async removeWorktree(req: {
    projectId: string;
    path: string;
    force?: boolean;
  }): Promise<{ ok: true; featureId: string | null }> {
    const project = this.deps.projects.get(req.projectId);
    if (!project) throw new WorktreeRemoveError('project_not_found', 'Projekt nicht gefunden');

    const target = canonical(req.path);
    const mainPath = canonical(project.path);

    const inventory = await readWorktreeInventory(project.path);
    const known = inventory.find((e) => canonical(e.path) === target);
    if (!known) {
      throw new WorktreeRemoveError(
        'not_a_worktree',
        `In diesem Projekt ist kein Worktree unter ${req.path} geführt`,
      );
    }
    if (target === mainPath) {
      throw new WorktreeRemoveError('main_checkout', 'Der Haupt-Checkout wird nie entfernt');
    }
    if (known.prunable || !existsSync(target)) {
      throw new WorktreeRemoveError(
        'not_removable',
        'Das Worktree-Verzeichnis fehlt — der Eintrag ist nur in der Git-Verwaltung geführt und kann hier nicht entfernt werden',
      );
    }

    const sessionActive = this.deps.ptys
      .list()
      .some((s) => !s.exited && isInside(canonical(s.cwd), target));
    if (sessionActive) {
      throw new WorktreeRemoveError(
        'session_active',
        'Im Worktree läuft eine Session — Entfernen gesperrt',
      );
    }

    const dirty = await uncommittedFileCount(target);
    if (dirty > 0 && req.force !== true) {
      throw new WorktreeRemoveError(
        'uncommitted',
        `${dirty} uncommittete ${dirty === 1 ? 'Änderung' : 'Änderungen'} im Worktree`,
        dirty,
      );
    }

    // Zuordnung VOR dem Entfernen bestimmen — danach ist der Pfad weg.
    const features = this.deps.features.listByProject(project.id);
    const feature =
      features.find((f) => f.worktreePath !== null && canonical(f.worktreePath) === target) ??
      (known.branch === null ? undefined : features.find((f) => f.branch === known.branch));

    // Stack ZUERST abbauen (FR-017, research E9): ein laufender Dienst hält das
    // Verzeichnis. Scheitert der Abbau, wird das Entfernen ABGELEHNT und der Grund
    // genannt — statt halb aufzuräumen und Erfolg zu melden.
    if (feature && this.deps.stacks) {
      try {
        await this.deps.stacks.down(feature, project);
      } catch (err) {
        throw new WorktreeRemoveError('remove_failed', `Stack-Abbau fehlgeschlagen: ${errorText(err)}`);
      }
    }

    try {
      await this.deps.worktrees.remove(project.path, target, { force: req.force === true });
    } catch (err) {
      // Kein DB-Schreibzugriff bei Fehlschlag — die nächste Erhebung zeigt die Realität.
      throw new WorktreeRemoveError('remove_failed', errorText(err));
    }

    if (feature?.worktreePath) {
      this.deps.features.setWorktree(feature.id, null);
      const fresh = this.deps.features.get(feature.id);
      if (fresh) this.deps.bus.emitEvent('feature_updated', fresh);
    }
    // Der nächste Abruf liest die Realität neu, statt den überholten Stand zu zeigen (FR-027).
    this.invalidate();
    return { ok: true, featureId: feature?.id ?? null };
  }

  /**
   * Erhebung eines Projekts, vollständig gekapselt: ein unerreichbares oder
   * defektes Projekt trägt seinen Fehler im eigenen Block und lässt alle
   * anderen Blöcke unberührt (FR-032).
   */
  private async buildGroup(project: Project): Promise<WorktreeProjectGroup> {
    const base = {
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      defaultBranch: project.defaultBranch,
    };
    try {
      if (!existsSync(project.path)) {
        throw new Error(`Projektpfad nicht gefunden: ${project.path}`);
      }
      if (!(await isGitRepo(project.path))) {
        throw new Error(`kein Git-Repository: ${project.path}`);
      }
      const main = await this.readMain(project);
      const worktrees = await this.collectEntries(project, main.path);
      const changes = await this.collectChanges(worktrees);
      await this.applyWarnings(project, worktrees, changes);
      await this.collectSizes(worktrees);
      finalizeFiles(worktrees, changes);
      return { ...base, main, worktrees, worktreeCount: worktrees.length, error: null };
    } catch (err) {
      return { ...base, main: null, worktrees: [], worktreeCount: 0, error: errorText(err) };
    }
  }

  /**
   * Größe je Eintrag (FR-042). Läuft in derselben Nebenläufigkeitsbremse wie die
   * übrige Erhebung und darf die Übersicht nicht blockieren: ist eine Größe nicht
   * ermittelbar, bleibt `sizeBytes` null („unbekannt") und der Eintrag vollständig
   * sichtbar (FR-044).
   */
  private async collectSizes(entries: WorktreeEntry[]): Promise<void> {
    const readDirSize = this.deps.readDirSize ?? duDirSize;
    await forEachLimit(entries, CONCURRENCY, async (entry) => {
      if (entry.dirState !== 'present') return;
      entry.sizeBytes = await readDirSize(entry.path).catch(() => null);
    });
  }

  /** Haupt-Checkout: schlanke Sicht ohne Dateiliste, ohne Warnungen (FR-003, D7). */
  private async readMain(project: Project): Promise<MainCheckoutInfo> {
    const branch = await currentBranch(project.path).catch(() => 'HEAD');
    return {
      projectId: project.id,
      projectName: project.name,
      path: canonical(project.path),
      // `rev-parse --abbrev-ref HEAD` meldet bei detached HEAD wörtlich "HEAD".
      branch: branch === 'HEAD' || branch === '' ? null : branch,
      defaultBranch: project.defaultBranch,
      uncommittedFileCount: await uncommittedFileCount(project.path),
    };
  }

  /**
   * Alle Einträge eines Projekts: von git geführte Worktrees (ohne Haupt-Checkout)
   * plus Features, deren `worktreePath` git nicht (mehr) kennt (FR-009).
   */
  private async collectEntries(project: Project, mainPath: string): Promise<WorktreeEntry[]> {
    const inventory = await readWorktreeInventory(project.path);
    const features = this.deps.features.listByProject(project.id);

    const byPath = new Map<string, Feature>();
    const byBranch = new Map<string, Feature>();
    for (const f of features) {
      if (f.worktreePath) byPath.set(canonical(f.worktreePath), f);
      byBranch.set(f.branch, f);
    }

    const activeCwds = this.deps.ptys
      .list()
      .filter((s) => !s.exited)
      .map((s) => canonical(s.cwd));

    const entries: WorktreeEntry[] = [];
    const knownPaths = new Set<string>();
    const usedFeatureIds = new Set<string>();

    for (const inv of inventory) {
      if (inv.bare) continue;
      const path = canonical(inv.path);
      knownPaths.add(path);
      if (path === mainPath) continue; // Haupt-Checkout ist eine eigene Entität (D7)

      // Zuordnung: erst über den kanonisierten Pfad, dann über Branch-Gleichheit (D2).
      const byPathHit = byPath.get(path);
      const byBranchHit = inv.branch === null ? undefined : byBranch.get(inv.branch);
      const feature = byPathHit ?? byBranchHit ?? null;
      if (feature) usedFeatureIds.add(feature.id);

      const exists = existsSync(path);
      const dirState: WorktreeDirState = inv.prunable || !exists ? 'registry_only' : 'present';
      const kind: WorktreeEntryKind = feature
        ? 'feature'
        : isChatWorktree(path, inv.branch)
          ? 'chat'
          : 'orphan';
      const sessionActive = activeCwds.some((cwd) => isInside(cwd, path));

      entries.push({
        id: `${project.id}::${path}`,
        projectId: project.id,
        kind,
        label: feature ? feature.name : kind === 'chat' ? 'Wissens-Chat' : basename(path),
        path,
        branch: inv.branch,
        dirState,
        featureId: feature?.id ?? null,
        targetBranch: feature?.integrationTarget ?? project.defaultBranch,
        createdAt: feature?.createdAt ?? dirMtime(path),
        sessionActive,
        removable: dirState === 'present' && !sessionActive,
        changedFileCount: 0,
        uncommittedFileCount: 0,
        files: [],
        filesTruncated: false,
        warnings: [],
        sizeBytes: null,
        portBase: this.deps.ports?.baseForWorktree(path) ?? null,
        error: null,
      });
    }

    // Gegenrichtung: Feature hat einen Worktree-Pfad, git kennt ihn nicht (mehr).
    for (const f of features) {
      if (!f.worktreePath || usedFeatureIds.has(f.id)) continue;
      const path = canonical(f.worktreePath);
      if (knownPaths.has(path)) continue;
      entries.push({
        id: `${project.id}::${path}`,
        projectId: project.id,
        kind: 'feature',
        label: f.name,
        path,
        branch: f.branch,
        dirState: 'missing',
        featureId: f.id,
        targetBranch: f.integrationTarget ?? project.defaultBranch,
        createdAt: f.createdAt,
        sessionActive: activeCwds.some((cwd) => isInside(cwd, path)),
        removable: false,
        changedFileCount: 0,
        uncommittedFileCount: 0,
        files: [],
        filesTruncated: false,
        warnings: [],
        sizeBytes: null,
        portBase: this.deps.ports?.baseForWorktree(path) ?? null,
        error: null,
      });
    }

    entries.sort(
      (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label, 'de'),
    );
    return entries;
  }

  /**
   * Dateiebene je vorhandenem Worktree erheben. Ein Fehlschlag betrifft nur
   * diesen einen Eintrag (`entry.error`) — er bleibt sichtbar, statt aus der
   * Übersicht zu verschwinden (SC-010).
   */
  private async collectChanges(entries: WorktreeEntry[]): Promise<Map<string, EntryChanges>> {
    const changes = new Map<string, EntryChanges>();
    const present = entries.filter((e) => e.dirState === 'present');
    await forEachLimit(present, CONCURRENCY, async (entry) => {
      try {
        const { base, files } = await collectWorktreeChanges(entry.path, entry.targetBranch);
        changes.set(entry.id, { files, base });
        entry.changedFileCount = files.length;
        entry.uncommittedFileCount = files.filter((f) => f.state !== 'committed').length;
      } catch (err) {
        entry.error = errorText(err);
      }
    });
    return changes;
  }

  /**
   * Die drei Warnlagen erheben und in stabiler Reihenfolge setzen
   * (`already_merged` → `overlap` → `behind_target`, FR-021).
   *
   * Arbeitet auf den UNGEKÜRZTEN Dateilisten — sonst ginge eine Überschneidung
   * verloren, sobald ein Worktree mehr als 300 Dateien anfasst.
   */
  private async applyWarnings(
    project: Project,
    entries: WorktreeEntry[],
    changes: Map<string, EntryChanges>,
  ): Promise<void> {
    // Nur vorhandene Worktrees mit erfolgreicher Erhebung nehmen teil (FR-020).
    const present = entries.filter((e) => e.dirState === 'present' && changes.has(e.id));
    if (present.length === 0) return;

    // (1) Bereits integriert: Branch weg ODER Vorfahre des Ziels.
    const merged = new Set<string>();
    await forEachLimit(present, CONCURRENCY, async (entry) => {
      if (entry.branch === null) return;
      if (await isBranchMergedInto(project.path, entry.branch, entry.targetBranch)) {
        merged.add(entry.id);
      }
    });

    // (2) Gegenüber dem Ziel überholt — je (Ziel, Basis) nur EINE Erhebung,
    // auch bei nebenläufigen Einträgen (geteilte Promise statt Ergebnis).
    const targetDiffs = new Map<string, Promise<Set<string>>>();
    const changedOnTarget = (target: string, base: string): Promise<Set<string>> => {
      const key = `${target}\0${base}`;
      let pending = targetDiffs.get(key);
      if (!pending) {
        pending = changedOnTargetSince(project.path, base, target);
        targetDiffs.set(key, pending);
      }
      return pending;
    };

    const behind = new Map<string, string[]>();
    // Ein bereits integrierter Worktree bekommt keinen zusätzlichen „veraltet"-Alarm:
    // das wäre die triviale Folge der Integration, nicht das Risiko (research.md D6).
    const notMerged = present.filter((e) => !merged.has(e.id));
    await forEachLimit(notMerged, CONCURRENCY, async (entry) => {
      const entryChanges = changes.get(entry.id);
      if (!entryChanges?.base || entryChanges.files.length === 0) return;
      const onTarget = await changedOnTarget(entry.targetBranch, entryChanges.base);
      if (onTarget.size === 0) return;
      const hits = entryChanges.files.filter((f) => onTarget.has(f.path));
      if (hits.length > 0) {
        for (const f of hits) f.behindTarget = true;
        behind.set(entry.id, hits.map((f) => f.path));
      }
    });

    // (3) Überschneidung mit anderen offenen Worktrees desselben Projekts.
    const overlaps = new Map(
      detectOverlaps(
        present.map((e) => ({
          entryId: e.id,
          label: e.label,
          featureId: e.featureId,
          dirState: e.dirState,
          files: changes.get(e.id)?.files ?? [],
        })),
      ).map((r) => [r.entryId, r] as const),
    );

    for (const entry of present) {
      const warnings: WorktreeWarning[] = [];
      if (merged.has(entry.id)) {
        warnings.push({ kind: 'already_merged', files: [], fileCount: 0, others: [] });
      }
      const overlap = overlaps.get(entry.id);
      if (overlap) {
        const paths = new Set(overlap.files);
        for (const f of changes.get(entry.id)?.files ?? []) {
          if (paths.has(f.path)) f.overlapping = true;
        }
        warnings.push({
          kind: 'overlap',
          files: overlap.files.slice(0, MAX_WARNING_FILES),
          fileCount: overlap.files.length,
          others: overlap.others,
        });
      }
      const behindPaths = behind.get(entry.id);
      if (behindPaths) {
        warnings.push({
          kind: 'behind_target',
          files: behindPaths.slice(0, MAX_WARNING_FILES),
          fileCount: behindPaths.length,
          others: [],
        });
      }
      entry.warnings = warnings;
    }
  }
}

/**
 * Dateilisten in den Transport übernehmen und dabei kürzen. Läuft NACH der
 * Warnberechnung, damit `overlapping`/`behindTarget` auf den ungekürzten Listen
 * bestimmt wurden und keine Überschneidung durch die Kürzung verloren geht.
 */
function finalizeFiles(entries: WorktreeEntry[], changes: Map<string, EntryChanges>): void {
  for (const entry of entries) {
    const files = changes.get(entry.id)?.files ?? [];
    entry.filesTruncated = files.length > MAX_FILES;
    entry.files = entry.filesTruncated ? files.slice(0, MAX_FILES) : files;
  }
}
