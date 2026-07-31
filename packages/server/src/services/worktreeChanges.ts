import {
  mergeFileChanges,
  parseNameStatusZ,
  parseNulList,
  parsePorcelainStatusZ,
} from '@sdd/shared';
import type { WorktreeFileChange } from '@sdd/shared';
import { git, mergeBase } from '../git/git.js';

export interface WorktreeChanges {
  /** Abzweigpunkt gegen den Zielbranch; null, wenn nicht bestimmbar. */
  base: string | null;
  files: WorktreeFileChange[];
}

/**
 * Alle gegenüber dem Zielbranch geänderten Dateien eines Worktrees mit
 * Änderungsart und Commit-Zustand (research.md D4).
 *
 * Bewusst NICHT über `collectUnmergedChanges` (Review-Portal/Merge-Queue): jenes
 * liefert Zeilenzahlen, aber weder Änderungsart noch die Unterscheidung
 * committet/uncommittet — und speist die Merge-Queue, darf also keine neue
 * Semantik aufgedrückt bekommen.
 */
export async function collectWorktreeChanges(cwd: string, targetBranch: string): Promise<WorktreeChanges> {
  const base = await mergeBase(cwd, targetBranch, 'HEAD');
  const ref = base ?? targetBranch;

  const [netto, others, committed, status] = await Promise.all([
    // Ohne End-Ref fließt der Arbeitsbaum ein — Netto-Änderung, nicht nur Commits.
    git(cwd, ['diff', '--name-status', '-M', '-z', ref]),
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
    git(cwd, ['diff', '--name-only', '-z', `${ref}..HEAD`]),
    git(cwd, ['status', '--porcelain', '-z']),
  ]);

  if (netto.code !== 0) {
    throw new Error(
      `Änderungen gegenüber ${targetBranch} nicht ermittelbar: ${netto.stderr.trim() || netto.stdout.trim()}`,
    );
  }

  return {
    base,
    files: mergeFileChanges({
      netto: parseNameStatusZ(netto.stdout),
      untracked: parseNulList(others.stdout),
      committedPaths: parseNulList(committed.stdout),
      worktreePaths: parsePorcelainStatusZ(status.stdout),
    }),
  };
}

/**
 * Pfade, die sich auf dem Zielbranch seit dem Abzweigpunkt geändert haben —
 * Datenbasis der Warnung „gegenüber Zielbranch veraltet" (FR-018).
 * Läuft im Haupt-Checkout und ist je (Projekt, Ziel, Basis) nur einmal nötig.
 */
export async function changedOnTargetSince(
  projectPath: string,
  base: string,
  targetBranch: string,
): Promise<Set<string>> {
  const r = await git(projectPath, ['diff', '--name-only', '-z', `${base}..${targetBranch}`]);
  return new Set(r.code === 0 ? parseNulList(r.stdout) : []);
}
