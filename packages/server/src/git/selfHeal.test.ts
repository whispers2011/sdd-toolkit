import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { isBranchMergedInto, isGitRepo, uncommittedFileCount } from './git.js';
import { WorktreeManager } from './worktrees.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Deckt die Bausteine der Merge-Queue-Selbstheilung ab (WP: „Tool muss solche
 * Zustände selbst auflösen können"): Erkennung bereits gemergter Branches und
 * Reparatur/Erkennung defekter bzw. fehlender Worktrees. Reproduziert das reale
 * Szenario „Worktree entfernt → git ‚not a git repository'".
 */
describe('Merge-Queue Self-Healing (git-Layer)', () => {
  let repo: string;
  let dataDir: string;
  let worktrees: WorktreeManager;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-heal-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-heal-data-'));
    worktrees = new WorktreeManager(dataDir);
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'app.txt'), 'init\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('isBranchMergedInto', () => {
    it('erkennt einen bereits (ff) gemergten Branch', async () => {
      sh(repo, ['checkout', '-b', 'feature/x']);
      writeFileSync(join(repo, 'x.txt'), 'x\n');
      sh(repo, ['add', '-A']);
      sh(repo, ['commit', '-m', 'x']);
      sh(repo, ['checkout', 'main']);
      sh(repo, ['merge', '--ff-only', 'feature/x']);
      expect(await isBranchMergedInto(repo, 'feature/x', 'main')).toBe(true);
    });

    it('erkennt einen NICHT gemergten Branch', async () => {
      sh(repo, ['checkout', '-b', 'feature/y']);
      writeFileSync(join(repo, 'y.txt'), 'y\n');
      sh(repo, ['add', '-A']);
      sh(repo, ['commit', '-m', 'y']);
      sh(repo, ['checkout', 'main']);
      expect(await isBranchMergedInto(repo, 'feature/y', 'main')).toBe(false);
    });

    it('behandelt einen nicht (mehr) existierenden Branch als integriert', async () => {
      expect(await isBranchMergedInto(repo, 'feature/ghost', 'main')).toBe(true);
    });

    /**
     * Der Fallstrick, der eine fertige Implementierung gekostet hat: ein Branch OHNE
     * eigene Commits ist trivial Vorfahre von main und damit von einem echten ff-Merge
     * NICHT unterscheidbar. Allein aus der Commit-Topologie ist der Fall nicht lösbar —
     * deshalb entscheidet uncommittedFileCount, ob Aufräumen Arbeit vernichten würde
     * (Schutz in MergeQueueService.reconcile).
     */
    it('meldet einen Branch ohne eigene Commits fälschlich als gemergt — Worktree-Inhalt ist der einzige Unterschied', async () => {
      const wt = await worktrees.create({
        projectId: 'p1',
        projectPath: repo,
        featureName: 'nocommit',
        branch: 'feature/nocommit',
        defaultBranch: 'main',
      });

      expect(await isBranchMergedInto(repo, 'feature/nocommit', 'main')).toBe(true); // Fehldiagnose
      expect(await uncommittedFileCount(wt)).toBe(0); // noch nichts zu verlieren

      writeFileSync(join(wt, 'neu.ts'), 'export const a = 1;\n'); // Agent-Arbeit, nie committet
      expect(await uncommittedFileCount(wt)).toBe(1); // ⇒ reconcile muss eskalieren, nicht aufräumen
    });
  });

  describe('uncommittedFileCount', () => {
    it('zählt geänderte und untracked Dateien, wirft nicht bei fehlendem Verzeichnis', async () => {
      expect(await uncommittedFileCount(repo)).toBe(0);
      writeFileSync(join(repo, 'app.txt'), 'geändert\n');
      writeFileSync(join(repo, 'dazu.txt'), 'neu\n');
      expect(await uncommittedFileCount(repo)).toBe(2);
      expect(await uncommittedFileCount(join(tmpdir(), 'gibt-es-nicht-xyz'))).toBe(0);
    });
  });

  describe('WorktreeManager.ensureValid', () => {
    it("meldet 'ok' für einen gesunden Worktree", async () => {
      const wt = await worktrees.create({
        projectId: 'p',
        projectPath: repo,
        featureName: 'feat',
        branch: 'feature/feat',
        defaultBranch: 'main',
      });
      expect(await worktrees.ensureValid(repo, wt)).toBe('ok');
    });

    it("repariert einen Worktree mit gelöschter .git-Verknüpfung ('repaired')", async () => {
      const wt = await worktrees.create({
        projectId: 'p',
        projectPath: repo,
        featureName: 'feat2',
        branch: 'feature/feat2',
        defaultBranch: 'main',
      });
      // Reale Störung: die .git-Datei des Worktrees verschwindet → „not a git repository".
      rmSync(join(wt, '.git'), { force: true });
      expect(await isGitRepo(wt)).toBe(false);

      expect(await worktrees.ensureValid(repo, wt)).toBe('repaired');
      expect(await isGitRepo(wt)).toBe(true);
    });

    it("meldet 'missing' für ein nicht vorhandenes Verzeichnis", async () => {
      const gone = join(dataDir, 'nicht-da');
      expect(existsSync(gone)).toBe(false);
      expect(await worktrees.ensureValid(repo, gone)).toBe('missing');
    });
  });
});
