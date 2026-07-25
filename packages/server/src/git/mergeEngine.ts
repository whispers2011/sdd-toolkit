import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  /** Rebase des Feature-Branches (im Worktree) auf einen lokalen Ziel-Branch. */
  async rebaseOnto(worktreePath: string, ontoBranch: string): Promise<RebaseResult> {
    if (!(await isCleanWorkingTree(worktreePath))) {
      return { ok: false, kind: 'error', message: 'Worktree hat uncommittete Änderungen' };
    }
    const r = await git(worktreePath, ['rebase', ontoBranch]);
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
   * Feature in den Ziel-Branch mergen. Fall A: das Ziel ist im Haupt-Checkout
   * ausgecheckt → Merge dort (heutiger Default-Pfad, byte-identisch). Fall B:
   * anderes Ziel → Merge in einem ephemeren Worktree unter `tmpWorktreeDir`;
   * der Haupt-Checkout wird NIE umgeschaltet. Ist das Ziel in einem fremden
   * Worktree ausgecheckt, wird sauber abgelehnt.
   */
  async mergeIntoTarget(opts: {
    projectPath: string;
    branch: string;
    target: string;
    mode: MergeMode;
    message: string;
    tmpWorktreeDir: string;
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!(await this.branchExists(opts.projectPath, opts.target))) {
      return { ok: false, message: `Ziel-Branch '${opts.target}' existiert nicht` };
    }

    const checkedOut = await currentBranch(opts.projectPath);
    if (checkedOut === opts.target) {
      if (!(await isCleanWorkingTree(opts.projectPath))) {
        return { ok: false, message: 'Haupt-Checkout hat uncommittete Änderungen' };
      }
      return this.mergeInCheckout(opts.projectPath, opts.branch, opts.mode, opts.message);
    }

    const elsewhere = await this.worktreeWithBranch(opts.projectPath, opts.target);
    if (elsewhere) {
      return {
        ok: false,
        message: `Ziel-Branch '${opts.target}' ist im Worktree ${elsewhere} ausgecheckt — dort mergen oder Worktree schließen`,
      };
    }

    const tmp = join(opts.tmpWorktreeDir, `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(opts.tmpWorktreeDir, { recursive: true });
    const add = await git(opts.projectPath, ['worktree', 'add', tmp, opts.target]);
    if (add.code !== 0) {
      return { ok: false, message: `Merge-Worktree fehlgeschlagen: ${add.stderr.trim()}` };
    }
    try {
      return await this.mergeInCheckout(tmp, opts.branch, opts.mode, opts.message);
    } finally {
      const rm = await git(opts.projectPath, ['worktree', 'remove', '--force', tmp]);
      if (rm.code !== 0) await git(opts.projectPath, ['worktree', 'prune']).catch(() => {});
    }
  }

  /** ff/squash-Merge im gegebenen (sauberen, auf dem Ziel stehenden) Checkout. */
  private async mergeInCheckout(
    cwd: string,
    branch: string,
    mode: MergeMode,
    message: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (mode === 'ff') {
      const r = await git(cwd, ['merge', '--ff-only', branch]);
      if (r.code !== 0) return { ok: false, message: r.stderr.trim() || 'ff-only merge fehlgeschlagen' };
      return { ok: true };
    }

    const sq = await git(cwd, ['merge', '--squash', branch]);
    if (sq.code !== 0) {
      await git(cwd, ['merge', '--abort']);
      await git(cwd, ['reset', '--merge']);
      return { ok: false, message: sq.stderr.trim() || 'squash merge fehlgeschlagen' };
    }
    const c = await git(cwd, ['commit', '-m', message]);
    if (c.code !== 0) {
      await git(cwd, ['reset', '--merge']);
      return { ok: false, message: c.stderr.trim() || 'commit fehlgeschlagen' };
    }
    return { ok: true };
  }

  /** Worktree (≠ Haupt-Checkout), in dem der Branch ausgecheckt ist; null wenn keiner. */
  private async worktreeWithBranch(projectPath: string, branch: string): Promise<string | null> {
    const r = await git(projectPath, ['worktree', 'list', '--porcelain']);
    if (r.code !== 0) return null;
    let path: string | null = null;
    for (const line of r.stdout.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim();
      if (line === `branch refs/heads/${branch}` && path && resolve(path) !== resolve(projectPath)) {
        return path;
      }
    }
    return null;
  }

  /**
   * Ziel-Branch idempotent sicherstellen (`git branch <name> <base>` ohne
   * Checkout) — resume-sicher: existiert er schon, ist nichts zu tun.
   */
  async ensureBranch(projectPath: string, name: string, base: string): Promise<void> {
    if (await this.branchExists(projectPath, name)) return;
    const r = await git(projectPath, ['branch', name, base]);
    if (r.code !== 0) throw new Error(`Branch '${name}' konnte nicht angelegt werden: ${r.stderr.trim()}`);
  }

  /** Branch nach Merge löschen. */
  async deleteBranch(projectPath: string, branch: string): Promise<void> {
    await git(projectPath, ['branch', '-D', branch]);
  }

  /** Existiert der Branch lokal noch? */
  async branchExists(projectPath: string, branch: string): Promise<boolean> {
    return (await git(projectPath, ['show-ref', '--verify', `refs/heads/${branch}`])).code === 0;
  }

  /**
   * Ist der Branch vollständig in den Default-Branch integriert? Schutz vor
   * Datenverlust: nur ein wirklich gemergter Branch darf gelöscht werden.
   */
  async isBranchMerged(projectPath: string, branch: string, defaultBranch: string): Promise<boolean> {
    if (!(await this.branchExists(projectPath, branch))) return false;
    return (await git(projectPath, ['merge-base', '--is-ancestor', branch, defaultBranch])).code === 0;
  }
}
