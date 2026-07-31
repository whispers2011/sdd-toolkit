/**
 * Pure Auswertung der `-z`-Ausgaben von git für die Worktree-Übersicht.
 *
 * `-z` (NUL-separiert) ist Pflicht: ohne quotiert git Pfade mit Umlauten oder
 * Sonderzeichen (`core.quotepath`) und schreibt Umbenennungen als `alt -> neu`
 * in eine Zeile. Mit `-z` sind Rename-Paare zwei aufeinanderfolgende Felder und
 * Pfade bleiben roh (research.md D5).
 *
 * KEINE Git-Aufrufe in diesem Modul — reine String-Verarbeitung, in Isolation
 * testbar.
 */
import type {
  FileChangeKind,
  FileChangeState,
  WorktreeDirState,
  WorktreeFileChange,
} from './types.js';

/** Eine Zeile aus `git diff --name-status -M -z`. */
export interface NameStatusEntry {
  /** Bei Umbenennung der NEUE Pfad. */
  path: string;
  oldPath: string | null;
  kind: FileChangeKind;
}

/** Statusbuchstabe → Änderungsart. R/C werden gesondert behandelt (Pfad-Paar). */
const STATUS_KIND: Record<string, FileChangeKind> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  T: 'modified', // Typwechsel (z. B. Datei ↔ Symlink) zählt als Änderung
  U: 'modified', // unmerged — im Zweifel als Änderung ausweisen
};

/**
 * `git diff --name-status -M -z` parsen. Felder: `<status>` `<pfad>`, bei
 * Umbenennung/Kopie `<status>` `<alt>` `<neu>`.
 */
export function parseNameStatusZ(out: string): NameStatusEntry[] {
  const fields = out.split('\0').filter((f) => f !== '');
  const entries: NameStatusEntry[] = [];
  let i = 0;
  while (i < fields.length) {
    const status = fields[i++];
    if (status === undefined) break;
    const letter = status[0] ?? '';
    if (letter === 'R' || letter === 'C') {
      const oldPath = fields[i++];
      const newPath = fields[i++];
      if (oldPath === undefined || newPath === undefined) break;
      // Eine Kopie erzeugt eine neue Datei; nur die Umbenennung trägt den alten Pfad.
      entries.push(
        letter === 'R'
          ? { path: newPath, oldPath, kind: 'renamed' }
          : { path: newPath, oldPath: null, kind: 'added' },
      );
      continue;
    }
    const path = fields[i++];
    if (path === undefined) break;
    entries.push({ path, oldPath: null, kind: STATUS_KIND[letter] ?? 'modified' });
  }
  return entries;
}

/** Schlichte NUL-Liste (`ls-files -z`, `diff --name-only -z`). */
export function parseNulList(out: string): string[] {
  return out.split('\0').filter((p) => p !== '');
}

/**
 * `git status --porcelain -z` parsen → alle Pfade mit uncommitteten Anteilen.
 * Format je Datensatz `XY <pfad>`; bei R/C folgt der Ursprungspfad als
 * eigener, unmittelbar anschließender Datensatz.
 */
export function parsePorcelainStatusZ(out: string): string[] {
  const records = out.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec === undefined || rec.length < 4) continue; // "XY " + mindestens ein Zeichen Pfad
    const x = rec[0];
    const y = rec[1];
    paths.push(rec.slice(3));
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const orig = records[++i];
      if (orig !== undefined && orig !== '') paths.push(orig);
    }
  }
  return paths;
}

export interface MergeFileChangesInput {
  /** Netto-Änderung gegen den Abzweigpunkt inkl. Arbeitsbaum. */
  netto: NameStatusEntry[];
  /** Noch nicht versionierte Dateien. */
  untracked: string[];
  /** Pfade mit committeten Anteilen (`base..HEAD`). */
  committedPaths: Iterable<string>;
  /** Pfade mit uncommitteten Anteilen (`status --porcelain`). */
  worktreePaths: Iterable<string>;
}

function stateFor(path: string, committed: Set<string>, worktree: Set<string>): FileChangeState {
  if (committed.has(path)) return worktree.has(path) ? 'both' : 'committed';
  return 'uncommitted';
}

/**
 * Netto-Änderungen und Untracked-Dateien zu einer Liste zusammenführen und je
 * Datei den Commit-Zustand bestimmen (data-model.md §5).
 *
 * Invariante: jeder Pfad erscheint höchstens einmal. Eine Datei, die committet
 * und danach erneut verändert wurde, ist ehrlich `both`.
 */
export function mergeFileChanges(input: MergeFileChangesInput): WorktreeFileChange[] {
  const committed = new Set(input.committedPaths);
  const worktree = new Set(input.worktreePaths);
  const byPath = new Map<string, WorktreeFileChange>();

  for (const entry of input.netto) {
    if (byPath.has(entry.path)) continue;
    byPath.set(entry.path, {
      path: entry.path,
      oldPath: entry.oldPath,
      kind: entry.kind,
      state: stateFor(entry.path, committed, worktree),
      overlapping: false,
      behindTarget: false,
    });
  }

  // Untracked sind per Definition neu und uncommittet — nie überschreibend.
  for (const path of input.untracked) {
    if (byPath.has(path)) continue;
    byPath.set(path, {
      path,
      oldPath: null,
      kind: 'added',
      state: 'uncommitted',
      overlapping: false,
      behindTarget: false,
    });
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Eingabe der Überschneidungs-Erkennung: ein Eintrag mit seiner UNGEKÜRZTEN Dateiliste. */
export interface OverlapCandidate {
  entryId: string;
  label: string;
  featureId: string | null;
  dirState: WorktreeDirState;
  files: readonly WorktreeFileChange[];
}

export interface OverlapResult {
  entryId: string;
  /** Betroffene Pfade, alphabetisch. */
  files: string[];
  /** Die anderen Einträge, die dieselben Dateien anfassen. */
  others: { entryId: string; label: string; featureId: string | null }[];
}

/**
 * Dateien, die in mehr als einem offenen Worktree desselben Projekts geändert
 * wurden (FR-017). Schlüssel ist bei Umbenennungen der NEUE Pfad — `oldPath`
 * erzeugt bewusst keinen Treffer, sonst meldete jede Umbenennung eine
 * Überschneidung mit sich selbst (Fehlalarm-Schutz, research.md D6).
 *
 * Einträge ohne vorhandenes Verzeichnis nehmen nicht teil: dort ist nichts
 * messbar, also darf auch nichts behauptet werden.
 */
export function detectOverlaps(entries: readonly OverlapCandidate[]): OverlapResult[] {
  const present = entries.filter((e) => e.dirState === 'present');
  const byPath = new Map<string, Set<string>>();
  for (const entry of present) {
    for (const file of entry.files) {
      const holders = byPath.get(file.path) ?? new Set<string>();
      holders.add(entry.entryId);
      byPath.set(file.path, holders);
    }
  }

  const hits = new Map<string, { files: Set<string>; others: Set<string> }>();
  for (const [path, holders] of byPath) {
    if (holders.size < 2) continue;
    for (const id of holders) {
      const hit = hits.get(id) ?? { files: new Set<string>(), others: new Set<string>() };
      hit.files.add(path);
      for (const other of holders) if (other !== id) hit.others.add(other);
      hits.set(id, hit);
    }
  }

  const results: OverlapResult[] = [];
  for (const entry of present) {
    const hit = hits.get(entry.entryId);
    if (!hit) continue;
    results.push({
      entryId: entry.entryId,
      files: [...hit.files].sort((a, b) => a.localeCompare(b)),
      // Reihenfolge der Beteiligten folgt der Eingabereihenfolge (stabile Anzeige).
      others: present
        .filter((o) => hit.others.has(o.entryId))
        .map((o) => ({ entryId: o.entryId, label: o.label, featureId: o.featureId })),
    });
  }
  return results;
}
