import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { localBranchExists } from './git.js';
import { WorktreeManager } from './worktrees.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Race-Sicherheit von WorktreeManager.create() — Regression für
 * „fatal: cannot lock ref 'refs/heads/feature/<name>': reference already exists".
 * Ursache war eine TOCTOU-Race: zwei parallele create()-Aufrufe (Boot-Recovery +
 * reconnectender Client) lasen beide „Branch fehlt" und riefen beide `worktree add -b`.
 */
describe('WorktreeManager.create() — race-fest & idempotent', () => {
  let repo: string;
  let dataDir: string;
  let worktrees: WorktreeManager;

  const opts = (featureName: string, branch: string) => ({
    projectId: 'P',
    projectPath: repo,
    featureName,
    branch,
    defaultBranch: 'main',
  });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-wt-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-wt-data-'));
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

  it('legt Worktree + Branch an', async () => {
    const dest = await worktrees.create(opts('feat', 'feature/feat'));
    expect(existsSync(dest)).toBe(true);
    expect(await localBranchExists(repo, 'feature/feat')).toBe(true);
  });

  it('ist idempotent bei erneutem Aufruf (gleicher Pfad, kein Fehler)', async () => {
    const a = await worktrees.create(opts('feat', 'feature/feat'));
    const b = await worktrees.create(opts('feat', 'feature/feat'));
    expect(b).toBe(a);
  });

  it('legt bei bereits existierendem Branch (ohne Worktree) sauber an — nicht -b', async () => {
    sh(repo, ['branch', 'feature/pre']);
    const dest = await worktrees.create(opts('pre', 'feature/pre'));
    expect(existsSync(dest)).toBe(true);
  });

  it('mehrere parallele create() für DENSELBEN Branch werfen nicht (Regression)', async () => {
    const results = await Promise.all([
      worktrees.create(opts('race', 'feature/race')),
      worktrees.create(opts('race', 'feature/race')),
      worktrees.create(opts('race', 'feature/race')),
    ]);
    // Alle liefern denselben, existierenden Worktree-Pfad — kein „reference already exists".
    expect(new Set(results).size).toBe(1);
    expect(existsSync(results[0])).toBe(true);
  });

  it('adoptiert einen fremden Branch am Zielpfad NICHT, sondern legt sauber neu an', async () => {
    // Rest eines gelöschten Features: gleicher Slug, anderer Branch, eigener Inhalt.
    const dest = await worktrees.create(opts('kollision', 'feature/alt'));
    writeFileSync(join(dest, 'alt.txt'), 'arbeit des alten features\n');
    sh(dest, ['config', 'user.email', 'test@test.local']);
    sh(dest, ['config', 'user.name', 'Test']);
    sh(dest, ['add', '-A']);
    sh(dest, ['commit', '-m', 'alt']);

    const again = await worktrees.create(opts('kollision', 'feature/neu'));

    expect(again).toBe(dest);
    // Der neue Branch ist ausgecheckt, nicht der alte — und ohne dessen Inhalt.
    expect(sh(again, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('feature/neu');
    expect(existsSync(join(again, 'alt.txt'))).toBe(false);
    // Die Arbeit des alten Branches ist nicht verloren, nur nicht mehr ausgecheckt.
    expect(await localBranchExists(repo, 'feature/alt')).toBe(true);
    expect(sh(repo, ['show', 'feature/alt:alt.txt'])).toContain('arbeit des alten features');
  });

  it('bricht ab, statt uncommittete Arbeit eines fremden Branches zu verwerfen', async () => {
    const dest = await worktrees.create(opts('kollision', 'feature/alt'));
    writeFileSync(join(dest, 'wip.txt'), 'unersetzlich\n');

    await expect(worktrees.create(opts('kollision', 'feature/neu'))).rejects.toThrow(
      /uncommittete Änderungen/,
    );
    expect(existsSync(join(dest, 'wip.txt'))).toBe(true);
    expect(sh(dest, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('feature/alt');
  });

  it('heilt eine Registry-Leiche (Verzeichnis weg, Admin-Eintrag da)', async () => {
    const dest = await worktrees.create(opts('ghost', 'feature/ghost'));
    // Verzeichnis hart entfernen, ohne git zu informieren → Admin-Eintrag bleibt zurück.
    rmSync(dest, { recursive: true, force: true });
    const again = await worktrees.create(opts('ghost', 'feature/ghost'));
    expect(existsSync(again)).toBe(true);
  });
});
