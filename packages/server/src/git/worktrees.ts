import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { git, gitOk, isCleanWorkingTree, isGitRepo } from './git.js';

/** Zustand eines Worktrees nach der Gesundheitsprüfung. */
export type WorktreeHealth = 'ok' | 'repaired' | 'missing';

/**
 * Worktree-Lifecycle pro Feature (WhisperM8-AgentWorktreeManager-Muster).
 * Worktrees liegen außerhalb des Repos unter <dataDir>/worktrees/<projectId>/<feature>
 * — kein .gitignore-Zwang im Ziel-Repo.
 */
export class WorktreeManager {
  constructor(private dataDir: string) {}

  pathFor(projectId: string, featureName: string): string {
    return join(this.dataDir, 'worktrees', projectId, featureName);
  }

  /** Worktree + Feature-Branch anlegen (Branch von defaultBranch abgezweigt). */
  async create(opts: {
    projectId: string;
    projectPath: string;
    featureName: string;
    branch: string;
    defaultBranch: string;
  }): Promise<string> {
    const dest = this.pathFor(opts.projectId, opts.featureName);
    if (existsSync(dest)) return dest; // idempotent
    mkdirSync(join(this.dataDir, 'worktrees', opts.projectId), { recursive: true });

    const branchExists =
      (await git(opts.projectPath, ['show-ref', '--verify', `refs/heads/${opts.branch}`])).code === 0;
    const args = branchExists
      ? ['worktree', 'add', dest, opts.branch]
      : ['worktree', 'add', dest, '-b', opts.branch, opts.defaultBranch];
    await gitOk(opts.projectPath, args);
    return dest;
  }

  /**
   * Prüft die Git-Verknüpfung eines Worktrees und repariert sie bei Bedarf.
   * - Verzeichnis fehlt → 'missing'.
   * - Verzeichnis da, aber `.git`-Verknüpfung defekt (z. B. Admin-Eintrag
   *   `git worktree prune`d) → `git worktree repair` im Haupt-Checkout versuchen,
   *   dann erneut prüfen ('repaired' bei Erfolg, sonst 'missing').
   * Wirft nie — der Aufrufer entscheidet, wie er mit dem Zustand umgeht.
   */
  async ensureValid(projectPath: string, worktreePath: string): Promise<WorktreeHealth> {
    if (!existsSync(worktreePath)) return 'missing';
    if (await isGitRepo(worktreePath)) return 'ok';
    // `git worktree repair` ist idempotent und harmlos, wenn nichts zu tun ist.
    await git(projectPath, ['worktree', 'repair', worktreePath]).catch(() => {});
    return (await isGitRepo(worktreePath)) ? 'repaired' : 'missing';
  }

  /** Entfernen mit Sauberkeitsprüfung; force nur explizit. */
  async remove(projectPath: string, worktreePath: string, opts: { force?: boolean } = {}): Promise<void> {
    if (!existsSync(worktreePath)) {
      await git(projectPath, ['worktree', 'prune']);
      return;
    }
    if (!opts.force && !(await isCleanWorkingTree(worktreePath))) {
      throw new Error(`Worktree ${worktreePath} hat uncommittete Änderungen — Entfernen verweigert`);
    }
    await gitOk(projectPath, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), worktreePath]);
  }

  /** Branch löschen (best-effort; wirft nicht bei fehlendem Branch). */
  async deleteBranch(projectPath: string, branch: string): Promise<void> {
    await git(projectPath, ['branch', '-D', branch]);
  }

  async list(projectPath: string): Promise<{ path: string; branch: string | null }[]> {
    const out = await gitOk(projectPath, ['worktree', 'list', '--porcelain']);
    const entries: { path: string; branch: string | null }[] = [];
    let cur: { path: string; branch: string | null } | null = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (cur) entries.push(cur);
        cur = { path: line.slice('worktree '.length), branch: null };
      } else if (line.startsWith('branch refs/heads/') && cur) {
        cur.branch = line.slice('branch refs/heads/'.length);
      }
    }
    if (cur) entries.push(cur);
    return entries;
  }
}
