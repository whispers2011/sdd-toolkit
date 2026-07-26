import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git, mergeBase } from '../git/git.js';

/** Eine geänderte Datei im Diff gegen den Abzweigpunkt (committet + Arbeitsbaum + untracked). */
export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
  /** Datei ist noch nicht versioniert (git ls-files --others). */
  untracked: boolean;
}

export interface DiffCommit {
  sha: string;
  date: number;
  subject: string;
}

export interface UnmergedDiff {
  files: DiffFile[];
  commits: DiffCommit[];
  /** Der Arbeitsbaum weicht von HEAD ab (uncommittete Änderungen vorhanden). */
  hasUncommitted: boolean;
}

/**
 * Alle gegen den Default-Branch noch nicht gemergten Änderungen eines Worktrees:
 * committet UND uncommittet (Arbeitsbaum) UND untracked. Diff-Basis ist der
 * Abzweigpunkt (Merge-Base) OHNE End-Ref — dadurch fließt der Arbeitsbaum ein
 * (anders als beim Drei-Punkt-Diff `base...HEAD`, der nur Commits vergleicht).
 */
export async function collectUnmergedChanges(cwd: string, defaultBranch: string): Promise<UnmergedDiff> {
  const base = (await mergeBase(cwd, defaultBranch, 'HEAD')) ?? defaultBranch;

  // Tracked: committet + staged + unstaged, gemessen gegen die Merge-Base.
  const numstat = await git(cwd, ['diff', base, '--numstat']);
  const files: DiffFile[] = numstat.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, ...path] = line.split('\t');
      return {
        path: path.join('\t'),
        additions: additions === '-' ? 0 : Number(additions),
        deletions: deletions === '-' ? 0 : Number(deletions),
        binary: additions === '-',
        untracked: false,
      };
    });

  // Untracked: neue, noch nicht versionierte Dateien — sonst wären frisch angelegte
  // Feature-Dateien unsichtbar. Zeilenzahl lokal ermitteln (kein weiterer git-Aufruf).
  const others = await git(cwd, ['ls-files', '--others', '--exclude-standard']);
  for (const rel of others.stdout.split('\n').filter(Boolean)) {
    let additions = 0;
    let binary = false;
    try {
      const content = await readFile(join(cwd, rel), 'utf8');
      additions = content.length === 0 ? 0 : content.split('\n').length;
    } catch {
      binary = true; // nicht als UTF-8 lesbar → als binär markieren
    }
    files.push({ path: rel, additions, deletions: 0, binary, untracked: true });
  }

  // Commits, die auf dem Branch, aber nicht im Default-Branch sind.
  const log = await git(cwd, ['log', '--format=%H%x09%ct%x09%s', `${defaultBranch}..HEAD`]);
  const commits: DiffCommit[] = log.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ts, ...subject] = line.split('\t');
      return { sha: sha!, date: Number(ts) * 1000, subject: subject.join('\t') };
    });

  const hasUncommitted = (await git(cwd, ['status', '--porcelain'])).stdout.trim().length > 0;

  return { files, commits, hasUncommitted };
}

/**
 * Gibt es überhaupt etwas zu integrieren? (FR-027) — committete Commits ODER
 * geänderte/neue Dateien gegenüber dem Zielstand. Wirft weiter, wenn der
 * Worktree nicht lesbar ist; die Aufrufer entscheiden, wie sie das werten.
 */
export async function hasUnmergedChanges(cwd: string, defaultBranch: string): Promise<boolean> {
  const { files, commits } = await collectUnmergedChanges(cwd, defaultBranch);
  return files.length > 0 || commits.length > 0;
}

/**
 * Diff einer einzelnen Datei gegen den Abzweigpunkt. Für untracked Dateien gibt es
 * keinen Vergleich in der Historie → Fallback auf `--no-index` gegen /dev/null,
 * damit der volle Dateiinhalt als Hinzufügung erscheint.
 */
export async function unmergedFileDiff(cwd: string, defaultBranch: string, path: string): Promise<string> {
  const base = (await mergeBase(cwd, defaultBranch, 'HEAD')) ?? defaultBranch;
  const tracked = await git(cwd, ['diff', base, '--', path]);
  if (tracked.stdout.trim()) return tracked.stdout;
  // --no-index liefert bei Unterschieden Exit-Code 1, der Diff steht trotzdem in stdout.
  const untracked = await git(cwd, ['diff', '--no-index', '--', '/dev/null', path]);
  return untracked.stdout;
}
