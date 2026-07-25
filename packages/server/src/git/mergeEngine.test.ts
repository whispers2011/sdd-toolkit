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

    const rebase = await engine.rebaseOnto(wt, 'main');
    expect(rebase).toEqual({ ok: true });

    const merge = await engine.mergeIntoTarget({
      projectPath: repo,
      branch: 'feature/feat-a',
      target: 'main',
      mode: 'ff',
      message: 'feat: feat-a',
      tmpWorktreeDir: join(dataDir, 'merge-tmp'),
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

    const rebase = await engine.rebaseOnto(wt, 'main');
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

    const merge = await engine.mergeIntoTarget({
      projectPath: repo,
      branch: 'feature/feat-b',
      target: 'main',
      mode: 'ff',
      message: 'feat: feat-b',
      tmpWorktreeDir: join(dataDir, 'merge-tmp'),
    });
    expect(merge.ok).toBe(true);
    expect(readFileSync(join(repo, 'app.txt'), 'utf8')).toContain('MAIN+FEATURE');
  });

  it('continueRebase committet KEINE unaufgelösten Konfliktmarker (Regression)', async () => {
    const wt = await worktrees.create({
      projectId: 'p1',
      projectPath: repo,
      featureName: 'feat-marker',
      branch: 'feature/feat-marker',
      defaultBranch: 'main',
    });

    writeFileSync(join(wt, 'app.txt'), 'zeile1-FEATURE\nzeile2\nzeile3\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'feature edit']);

    writeFileSync(join(repo, 'app.txt'), 'zeile1-MAIN\nzeile2\nzeile3\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'main edit']);

    const rebase = await engine.rebaseOnto(wt, 'main');
    expect(rebase.ok).toBe(false);

    // Fehlerhafte „Auflösung": Marker bleiben im Quelltext stehen (Agent exit 0, aber unvollständig).
    writeFileSync(
      join(wt, 'app.txt'),
      '<<<<<<< HEAD\nzeile1-MAIN\n=======\nzeile1-FEATURE\n>>>>>>> feature\nzeile2\nzeile3\n',
    );
    const cont = await engine.continueRebase(wt);
    expect(cont).toEqual({ ok: false, kind: 'conflict', files: ['app.txt'] });

    // Nichts wurde committet: der Rebase läuft noch, HEAD trägt keine Marker.
    expect(sh(wt, ['log', '-1', '--pretty=%s'])).not.toContain('feature edit');

    // Saubere Auflösung → continue klappt und der committete Stand ist markerfrei.
    writeFileSync(join(wt, 'app.txt'), 'zeile1-MAIN+FEATURE\nzeile2\nzeile3\n');
    const cont2 = await engine.continueRebase(wt);
    expect(cont2).toEqual({ ok: true });
    expect(sh(wt, ['show', 'HEAD:app.txt'])).not.toMatch(/<<<<<<<|>>>>>>>/);
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
    const merge = await engine.mergeIntoTarget({
      projectPath: repo,
      branch: 'feature/feat-c',
      target: 'main',
      mode: 'ff',
      message: 'x',
      tmpWorktreeDir: join(dataDir, 'merge-tmp'),
    });
    expect(merge.ok).toBe(false);
    if (!merge.ok) expect(merge.message).toContain('uncommittete');
  });

  it('mergeIntoTarget: Nicht-Default-Ziel via ephemerem Worktree, Haupt-Checkout bleibt unberührt', async () => {
    const wt = await worktrees.create({
      projectId: 'p1',
      projectPath: repo,
      featureName: 'feat-e',
      branch: 'feature/feat-e',
      defaultBranch: 'main',
    });
    writeFileSync(join(wt, 'e.txt'), 'e\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'e']);

    const mainHeadBefore = sh(repo, ['rev-parse', 'main']).trim();
    await engine.ensureBranch(repo, 'integration/ziel', 'main');
    // Idempotent: zweiter Aufruf ist ein No-Op.
    await expect(engine.ensureBranch(repo, 'integration/ziel', 'main')).resolves.toBeUndefined();

    const merge = await engine.mergeIntoTarget({
      projectPath: repo,
      branch: 'feature/feat-e',
      target: 'integration/ziel',
      mode: 'ff',
      message: 'feat: feat-e',
      tmpWorktreeDir: join(dataDir, 'merge-tmp'),
    });
    expect(merge).toEqual({ ok: true });

    // Ziel enthält den Feature-Commit, main und Haupt-Checkout sind unverändert.
    expect(sh(repo, ['merge-base', '--is-ancestor', 'feature/feat-e', 'integration/ziel'])).toBe('');
    expect(sh(repo, ['rev-parse', 'main']).trim()).toBe(mainHeadBefore);
    expect(readBranch(repo)).toBe('main');
    expect(existsSync(join(repo, 'e.txt'))).toBe(false);
    // Ephemerer Worktree wurde aufgeräumt.
    expect(sh(repo, ['worktree', 'list'])).not.toContain('merge-tmp');
    expect(await engine.isBranchMerged(repo, 'feature/feat-e', 'integration/ziel')).toBe(true);
    expect(await engine.isBranchMerged(repo, 'feature/feat-e', 'main')).toBe(false);
  });

  it('mergeIntoTarget: Ziel in fremdem Worktree ausgecheckt → sauberer Fehler', async () => {
    sh(repo, ['branch', 'integration/busy', 'main']);
    const foreign = join(dataDir, 'foreign-wt');
    sh(repo, ['worktree', 'add', foreign, 'integration/busy']);

    const wt = await worktrees.create({
      projectId: 'p1',
      projectPath: repo,
      featureName: 'feat-f',
      branch: 'feature/feat-f',
      defaultBranch: 'main',
    });
    writeFileSync(join(wt, 'f.txt'), 'f\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'f']);

    const merge = await engine.mergeIntoTarget({
      projectPath: repo,
      branch: 'feature/feat-f',
      target: 'integration/busy',
      mode: 'ff',
      message: 'x',
      tmpWorktreeDir: join(dataDir, 'merge-tmp'),
    });
    expect(merge.ok).toBe(false);
    if (!merge.ok) expect(merge.message).toContain('ausgecheckt');
  });

  it('mergeIntoTarget: fehlender Ziel-Branch → sauberer Fehler', async () => {
    const merge = await engine.mergeIntoTarget({
      projectPath: repo,
      branch: 'main',
      target: 'gibt/es-nicht',
      mode: 'ff',
      message: 'x',
      tmpWorktreeDir: join(dataDir, 'merge-tmp'),
    });
    expect(merge.ok).toBe(false);
    if (!merge.ok) expect(merge.message).toContain('existiert nicht');
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
