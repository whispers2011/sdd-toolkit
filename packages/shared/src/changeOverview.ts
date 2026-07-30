/**
 * Änderungsübersicht des Review-Portals: die gekürzte Antwort auf „worum geht es
 * in diesem Feature?", gerechnet aus dem Diff, den das Portal ohnehin lädt.
 *
 * Reines Modul — keine Uhr, kein DOM, kein Netz. Die Kürzung auf zehn Dateien und
 * drei Commits ist eine prüfbare Regel und liegt deshalb hier und nicht in der
 * Komponente: `packages/web` hat bewusst keinen Test-Runner.
 */

/** Eine geänderte Datei, wie sie der Diff-Abruf des Portals liefert. */
export interface ChangeFile {
  /** Repo-relativer POSIX-Pfad. */
  path: string;
  /** Hinzugefügte Zeilen; bei Binärdateien 0. */
  additions: number;
  /** Entfernte Zeilen; bei Binärdateien 0. */
  deletions: number;
  /** true, wenn git die Datei als binär ausweist. */
  binary: boolean;
}

/** Ein Commit des Features. */
export interface ChangeCommit {
  sha: string;
  /** Unix-Millisekunden. */
  date: number;
  subject: string;
}

/** Eingabe: strukturell erfüllt von `DiffSummary` aus `packages/web/src/api.ts`. */
export interface ChangeOverviewInput {
  files: readonly ChangeFile[];
  commits: readonly ChangeCommit[];
}

/** Eine Gruppe gezeigter Dateien (Paket bzw. Verzeichnis). */
export interface ChangeGroup {
  /** Gruppenschlüssel nach `overviewGroupKey`. */
  key: string;
  /** Nur die in der Übersicht gezeigten Dateien, Umfang absteigend. */
  files: readonly ChangeFile[];
  /** Summe über `files` dieser Gruppe. */
  additions: number;
  deletions: number;
}

export interface ChangeOverview {
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
    commits: number;
  };
  /** Höchstens MAX_OVERVIEW_FILES Dateien über alle Gruppen zusammen. */
  groups: readonly ChangeGroup[];
  /** Anzahl nicht gezeigter Dateien → Restzeile. 0, wenn alles gezeigt wird. */
  hiddenFiles: number;
  /** Höchstens MAX_OVERVIEW_COMMITS, jüngster zuerst. */
  recentCommits: readonly ChangeCommit[];
  hasChanges: boolean;
  hasCommits: boolean;
}

export const MAX_OVERVIEW_FILES = 10;
export const MAX_OVERVIEW_COMMITS = 3;

/** Schlüssel für Wurzeldateien. */
export const ROOT_GROUP_KEY = '(Wurzel)';

/**
 * Gruppenschlüssel eines Pfades: erste zwei Segmente bei ≥ 3 Segmenten,
 * sonst das erste Segment, bei Dateien in der Wurzel ROOT_GROUP_KEY.
 *
 * Zwei Segmente sind der Punkt, an dem im Monorepo das Paket sichtbar wird
 * (`packages/web`, `specs/<feature>`); ein Segment reicht für `docs/x.md`.
 */
export function overviewGroupKey(path: string): string {
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length >= 3) return `${segments[0]}/${segments[1]}`;
  if (segments.length === 2) return segments[0]!;
  return ROOT_GROUP_KEY;
}

/** Sortiermass einer Datei — kein Ausgabefeld. */
const volume = (file: ChangeFile) => file.additions + file.deletions;

/** Baut die Übersicht. Pur: verändert die Eingabe nicht, liest keine Uhr. */
export function buildChangeOverview(input: ChangeOverviewInput): ChangeOverview {
  const totals = {
    files: input.files.length,
    additions: input.files.reduce((s, f) => s + f.additions, 0),
    deletions: input.files.reduce((s, f) => s + f.deletions, 0),
    binaryFiles: input.files.filter((f) => f.binary).length,
    commits: input.commits.length,
  };

  // Umfang absteigend, bei Gleichstand Pfad aufsteigend — damit ist die Auswahl
  // der gezeigten zehn Dateien deterministisch und nicht von der Eingabereihenfolge
  // abhängig (R2). Sortiert wird auf einer Kopie (R8).
  const ranked = [...input.files].sort((a, b) => volume(b) - volume(a) || a.path.localeCompare(b.path));
  const visible = ranked.slice(0, MAX_OVERVIEW_FILES);

  // Gruppieren erst NACH der Kürzung: die Grenze von zehn gilt gruppenübergreifend,
  // sonst zeigte ein Feature mit vielen Paketen beliebig viele Zeilen (R1).
  const byKey = new Map<string, ChangeFile[]>();
  for (const file of visible) {
    const key = overviewGroupKey(file.path);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(file);
    else byKey.set(key, [file]);
  }

  const groups: ChangeGroup[] = [...byKey.entries()]
    .map(([key, files]) => ({
      key,
      files,
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
    }))
    .sort(
      (a, b) =>
        b.additions + b.deletions - (a.additions + a.deletions) || a.key.localeCompare(b.key),
    );

  const recentCommits = [...input.commits].sort((a, b) => b.date - a.date).slice(0, MAX_OVERVIEW_COMMITS);

  return {
    totals,
    groups,
    hiddenFiles: Math.max(0, totals.files - visible.length),
    recentCommits,
    hasChanges: totals.files > 0,
    hasCommits: totals.commits > 0,
  };
}
