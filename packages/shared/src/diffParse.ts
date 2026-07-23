/**
 * Parser für unified Diffs (git diff): pure Funktion, Grundlage für den
 * Diff-Renderer im Review-Portal und die Zeilen-Anker der Reviewer-Kommentare.
 */

export type DiffLineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: DiffLineKind;
  /** Zeilennummer in der alten Datei; null bei 'add'. */
  oldNo: number | null;
  /** Zeilennummer in der neuen Datei; null bei 'del'. */
  newNo: number | null;
  /** Zeileninhalt OHNE das führende Diff-Zeichen (+/-/Leerzeichen). */
  text: string;
}

export interface DiffHunk {
  /** Roh-Header (`@@ -a,b +c,d @@ …`), inkl. optionalem Kontext-Suffix. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  /** Pfad vor der Änderung (a/…); bei neuen Dateien identisch mit newPath. */
  oldPath: string;
  /** Pfad nach der Änderung (b/…); bei gelöschten Dateien identisch mit oldPath. */
  newPath: string;
  /** true, wenn git die Datei als binär ausweist (keine Hunks). */
  binary: boolean;
  renamed: boolean;
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, '');
}

/** Pfad aus einer `diff --git a/x b/y`-Zeile extrahieren (ohne Quote-Handling für Sonderfälle). */
function parseGitHeader(line: string): { oldPath: string; newPath: string } | null {
  const m = line.match(/^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/);
  if (!m) return null;
  return { oldPath: m[1]!, newPath: m[2]! };
}

/**
 * Zerlegt einen unified Diff (Ausgabe von `git diff`) in Dateien, Hunks und
 * nummerierte Zeilen. Toleriert führende Metazeilen (index, mode, similarity …).
 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const paths = parseGitHeader(raw);
      file = {
        oldPath: paths ? stripPrefix(`a/${paths.oldPath}`) : '',
        newPath: paths ? stripPrefix(`b/${paths.newPath}`) : '',
        binary: false,
        renamed: false,
        hunks: [],
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) {
      file.binary = true;
      continue;
    }
    if (raw.startsWith('rename from ') || raw.startsWith('rename to ')) {
      file.renamed = true;
      continue;
    }
    // Explizite Pfade aus ---/+++ übernehmen (präziser als der --git-Header bei Quotes).
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4).trim();
      if (p !== '/dev/null') file.oldPath = stripPrefix(p);
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      if (p !== '/dev/null') file.newPath = stripPrefix(p);
      continue;
    }

    const hm = raw.match(HUNK_RE);
    if (hm) {
      hunk = {
        header: raw,
        oldStart: Number(hm[1]),
        oldLines: hm[2] === undefined ? 1 : Number(hm[2]),
        newStart: Number(hm[3]),
        newLines: hm[4] === undefined ? 1 : Number(hm[4]),
        lines: [],
      };
      file.hunks.push(hunk);
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      continue;
    }
    if (!hunk) continue;

    if (raw.startsWith('+')) {
      hunk.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      hunk.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: raw.slice(1) });
    } else if (raw.startsWith(' ') || raw === '') {
      hunk.lines.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: raw.slice(1) });
    }
    // "\ No newline at end of file" u. ä. bewusst ignoriert (keine Zeilennummern).
  }
  return files;
}
