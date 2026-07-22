import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { MergeEngine } from './mergeEngine.js';
import { WorktreeManager } from './worktrees.js';
import { readBranch } from './branchReader.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('git-Layer (Integration)', () => {
  let repo: string;
  let dataDir: string;
  let worktrees: WorktreeManager;
  const engine = new MergeEngine();

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-data-'));
    worktrees = new WorktreeManager(dataDir);
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'app.txt'), 'zeile1\nzeile2\nzeile3\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('Worktree anlegen, sauberer Rebase, ff-Merge, Cleanup', async () => {
    const wt = await worktrees.create({
      projectId: 'p1',
      projectPath: repo,
      featureName: 'feat-a',
      branch: 'feature/feat-a',
      defaultBranch: 'main',
    });
    expect(existsSync(wt)).toBe(true);
    expect(readBranch(wt)).toBe('feature/feat-a');

    // Feature-Änderung committen
    writeFileSync(join(wt, 'feature-a.txt'), 'neu\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'feat a']);

    // main entwickelt sich parallel weiter (andere Datei → kein Konflikt)
    writeFileSync(join(repo, 'other.txt'), 'main-fortschritt\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'main change']);

    const rebase = await engine.rebaseOntoDefault(wt, 'main');
    expect(rebase).toEqual({ ok: true });

    const merge = await engine.mergeFeature({
      projectPath: repo,
      branch: 'feature/feat-a',
      defaultBranch: 'main',
      mode: 'ff',
      message: 'feat: feat-a',
    });
    expect(merge.ok).toBe(true);
    expect(existsSync(join(repo, 'feature-a.txt'))).toBe(true);

    await worktrees.remove(repo, wt, { force: true });
    expect(existsSync(wt)).toBe(false);
    await engine.deleteBranch(repo, 'feature/feat-a');
  });

  it('Konflikt wird erkannt und Dateien benannt; abort stellt Zustand wieder her', async () => {
    const wt = await worktrees.create({
      projectId: 'p1',
      projectPath: repo,
      featureName: 'feat-b',
      branch: 'feature/feat-b',
      defaultBranch: 'main',
    });

    // Beide Seiten ändern dieselbe Zeile
    writeFileSync(join(wt, 'app.txt'), 'zeile1-FEATURE\nzeile2\nzeile3\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'feature edit']);

    writeFileSync(join(repo, 'app.txt'), 'zeile1-MAIN\nzeile2\nzeile3\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'main edit']);

    const rebase = await engine.rebaseOntoDefault(wt, 'main');
    expect(rebase.ok).toBe(false);
    if (!rebase.ok && rebase.kind === 'conflict') {
      expect(rebase.files).toEqual(['app.txt']);
    } else {
      throw new Error(`Konflikt erwartet, bekam: ${JSON.stringify(rebase)}`);
    }

    // Simulierte Auflösung (das übernimmt in echt der Headless-Agent)
    writeFileSync(join(wt, 'app.txt'), 'zeile1-MAIN+FEATURE\nzeile2\nzeile3\n');
    const cont = await engine.continueRebase(wt);
    expect(cont).toEqual({ ok: true });

    const merge = await engine.mergeFeature({
      projectPath: repo,
      branch: 'feature/feat-b',
      defaultBranch: 'main',
      mode: 'ff',
      message: 'feat: feat-b',
    });
    expect(merge.ok).toBe(true);
    expect(readFileSync(join(repo, 'app.txt'), 'utf8')).toContain('MAIN+FEATURE');
  });

  it('Merge verweigert bei dreckigem Haupt-Checkout', async () => {
    const wt = await worktrees.create({
      projectId: 'p1',
      projectPath: repo,
      featureName: 'feat-c',
      branch: 'feature/feat-c',
      defaultBranch: 'main',
    });
    writeFileSync(join(wt, 'c.txt'), 'c\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'c']);

    writeFileSync(join(repo, 'dirty.txt'), 'uncommitted\n');
    const merge = await engine.mergeFeature({
      projectPath: repo,
      branch: 'feature/feat-c',
      defaultBranch: 'main',
      mode: 'ff',
      message: 'x',
    });
    expect(merge.ok).toBe(false);
    if (!merge.ok) expect(merge.message).toContain('uncommittete');
  });

  it('Worktree-Remove verweigert bei uncommitteten Änderungen (ohne force)', async () => {
    const wt = await worktrees.create({
      projectId: 'p1',
      projectPath: repo,
      featureName: 'feat-d',
      branch: 'feature/feat-d',
      defaultBranch: 'main',
    });
    writeFileSync(join(wt, 'dirty.txt'), 'x\n');
    await expect(worktrees.remove(repo, wt)).rejects.toThrow(/uncommittete/);
  });
});
