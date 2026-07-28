import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
    project: { id: 'P', name: 'Demo' },
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

  it('heilt eine Registry-Leiche (Verzeichnis weg, Admin-Eintrag da)', async () => {
    const dest = await worktrees.create(opts('ghost', 'feature/ghost'));
    // Verzeichnis hart entfernen, ohne git zu informieren → Admin-Eintrag bleibt zurück.
    rmSync(dest, { recursive: true, force: true });
    const again = await worktrees.create(opts('ghost', 'feature/ghost'));
    expect(existsSync(again)).toBe(true);
  });

  /**
   * Ungetrackte Agenten-Konfiguration muss mitkommen: steht `.claude/` in der
   * .gitignore, checkt `worktree add` sie nicht aus — der Phasenstart schickt dann
   * einen Slash-Command, den es im Worktree nicht gibt (Jobmappe, 28.07.2026).
   */
  it('spiegelt ungetracktes .claude/ und CLAUDE.md in den neuen Worktree', async () => {
    mkdirSync(join(repo, '.claude', 'skills', 'speckit-specify'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'skills', 'speckit-specify', 'SKILL.md'), '# specify');
    writeFileSync(join(repo, 'CLAUDE.md'), '# Projektregeln');
    writeFileSync(join(repo, '.gitignore'), '.claude/\nCLAUDE.md\n');
    sh(repo, ['add', '.gitignore']);
    sh(repo, ['commit', '-m', 'ignore agent config']);

    const dest = await worktrees.create(opts('mirror', 'feature/mirror'));

    expect(existsSync(join(dest, '.claude', 'skills', 'speckit-specify', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dest, 'CLAUDE.md'))).toBe(true);
  });

  it('überschreibt getrackte Agenten-Konfiguration im Worktree nicht', async () => {
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'marker.txt'), 'hauptrepo');
    sh(repo, ['add', '.claude/marker.txt']);
    sh(repo, ['commit', '-m', 'track agent config']);

    const dest = await worktrees.create(opts('tracked', 'feature/tracked'));

    // Die ausgecheckte Branch-Version gewinnt — gespiegelt wird nur, was fehlt.
    expect(readFileSync(join(dest, '.claude', 'marker.txt'), 'utf8')).toBe('hauptrepo');
  });
});
