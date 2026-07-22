import { conflictedFiles, currentBranch, filesWithConflictMarkers, git, gitOk, isCleanWorkingTree } from './git.js';

export type RebaseResult =
  | { ok: true }
  | { ok: false; kind: 'conflict'; files: string[] }
  | { ok: false; kind: 'error'; message: string };

export type MergeMode = 'ff' | 'squash';

/**
 * Merge-Engine: Feature-Branch im Worktree auf den Default-Branch rebasen,
 * danach im Haupt-Checkout mergen. Konflikte werden erkannt und nach außen
 * gereicht (Auto-Resolution übernimmt der MergeQueueService).
 */
export class MergeEngine {
  /** Rebase des Feature-Branches (im Worktree) auf den lokalen Default-Branch. */
  async rebaseOntoDefault(worktreePath: string, defaultBranch: string): Promise<RebaseResult> {
    if (!(await isCleanWorkingTree(worktreePath))) {
      return { ok: false, kind: 'error', message: 'Worktree hat uncommittete Änderungen' };
    }
    const r = await git(worktreePath, ['rebase', defaultBranch]);
    if (r.code === 0) return { ok: true };

    const files = await conflictedFiles(worktreePath);
    if (files.length > 0) return { ok: false, kind: 'conflict', files };

    await git(worktreePath, ['rebase', '--abort']);
    return { ok: false, kind: 'error', message: r.stderr.trim() || r.stdout.trim() };
  }

  /** Nach manueller/agentischer Konfliktauflösung: add + continue. */
  async continueRebase(worktreePath: string): Promise<RebaseResult> {
    // Sicherheitsnetz: NIE unaufgelöste Konfliktmarker committen. Der Auflöser kann
    // exit 0 melden, ohne alle Marker entfernt zu haben; `git add -A` würde den
    // kaputten Stand als „gelöst" markieren und `rebase --continue` ihn festschreiben
    // (Build-Bruch, der erst im Review/Verify auffällt).
    const stillConflicted = await filesWithConflictMarkers(worktreePath, await conflictedFiles(worktreePath));
    if (stillConflicted.length > 0) {
      return { ok: false, kind: 'conflict', files: stillConflicted };
    }
    await gitOk(worktreePath, ['add', '-A']);
    const r = await git(worktreePath, ['-c', 'core.editor=true', 'rebase', '--continue']);
    if (r.code === 0) return { ok: true };
    const files = await conflictedFiles(worktreePath);
    if (files.length > 0) return { ok: false, kind: 'conflict', files };
    return { ok: false, kind: 'error', message: r.stderr.trim() || r.stdout.trim() };
  }

  async abortRebase(worktreePath: string): Promise<void> {
    await git(worktreePath, ['rebase', '--abort']);
  }

  async isRebaseInProgress(worktreePath: string): Promise<boolean> {
    const r = await git(worktreePath, ['rev-parse', '--git-path', 'rebase-merge']);
    if (r.code !== 0) return false;
    const dir = r.stdout.trim();
    const check = await git(worktreePath, ['rev-parse', '--verify', 'REBASE_HEAD']);
    return check.code === 0 && dir.length > 0;
  }

  /**
   * Feature in den Default-Branch mergen (im Haupt-Checkout).
   * Voraussetzung: Haupt-Checkout ist sauber und auf dem Default-Branch.
   */
  async mergeFeature(opts: {
    projectPath: string;
    branch: string;
    defaultBranch: string;
    mode: MergeMode;
    message: string;
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const branch = await currentBranch(opts.projectPath);
    if (branch !== opts.defaultBranch) {
      return { ok: false, message: `Haupt-Checkout ist auf '${branch}', erwartet '${opts.defaultBranch}'` };
    }
    if (!(await isCleanWorkingTree(opts.projectPath))) {
      return { ok: false, message: 'Haupt-Checkout hat uncommittete Änderungen' };
    }

    if (opts.mode === 'ff') {
      const r = await git(opts.projectPath, ['merge', '--ff-only', opts.branch]);
      if (r.code !== 0) return { ok: false, message: r.stderr.trim() || 'ff-only merge fehlgeschlagen' };
      return { ok: true };
    }

    // squash
    const sq = await git(opts.projectPath, ['merge', '--squash', opts.branch]);
    if (sq.code !== 0) {
      await git(opts.projectPath, ['merge', '--abort']);
      await git(opts.projectPath, ['reset', '--merge']);
      return { ok: false, message: sq.stderr.trim() || 'squash merge fehlgeschlagen' };
    }
    const c = await git(opts.projectPath, ['commit', '-m', opts.message]);
    if (c.code !== 0) {
      await git(opts.projectPath, ['reset', '--merge']);
      return { ok: false, message: c.stderr.trim() || 'commit fehlgeschlagen' };
    }
    return { ok: true };
  }

  /** Branch nach Merge löschen. */
  async deleteBranch(projectPath: string, branch: string): Promise<void> {
    await git(projectPath, ['branch', '-D', branch]);
  }
}
