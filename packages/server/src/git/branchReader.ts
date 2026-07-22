import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

/**
 * Branch direkt aus .git/HEAD lesen — kein git-Subprozess (WhisperM8-Muster,
 * spart 20–150 ms pro Aufruf). Behandelt Worktrees/Submodule (.git als Datei).
 */
export function readBranch(repoPath: string): string | null {
  try {
    const gitDir = resolveGitDir(repoPath);
    if (!gitDir) return null;
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: refs/heads/')) return head.slice('ref: refs/heads/'.length);
    if (head.startsWith('ref: ')) return head.slice(5);
    return head.slice(0, 12); // detached HEAD → Kurz-SHA
  } catch {
    return null;
  }
}

function resolveGitDir(repoPath: string): string | null {
  let dir = resolve(repoPath);
  // Monorepo-Parent-Suche: nach oben laufen bis .git gefunden.
  for (let i = 0; i < 40; i++) {
    const dotGit = join(dir, '.git');
    if (existsSync(dotGit)) {
      const st = statSync(dotGit);
      if (st.isDirectory()) return dotGit;
      // Worktree/Submodule: .git ist eine Datei mit "gitdir: <pfad>"
      const content = readFileSync(dotGit, 'utf8').trim();
      if (content.startsWith('gitdir: ')) {
        const target = content.slice('gitdir: '.length);
        return resolve(dir, target);
      }
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
