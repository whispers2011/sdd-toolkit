import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localBranchExists } from './git.js';
import { WorktreeManager, projectDirName } from './worktrees.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('projectDirName', () => {
  it('macht den Ordner lesbar und hält ihn über die ID eindeutig', () => {
    expect(projectDirName({ id: 'OYHWliMHZN', name: 'sdd-toolkit' })).toBe('sdd-toolkit-OYHWliMHZN');
    expect(projectDirName({ id: 'X1', name: 'Jobmappe' })).toBe('jobmappe-X1');
  });

  it('entschärft Umlaute, Leerzeichen und Sonderzeichen', () => {
    expect(projectDirName({ id: 'X1', name: 'Küchen Wärmepumpe / Rechner!' })).toBe('kuchen-warmepumpe-rechner-X1');
  });

  it('fällt auf die reine ID zurück, wenn vom Namen nichts übrig bleibt', () => {
    expect(projectDirName({ id: 'X1', name: '???' })).toBe('X1');
  });
});

describe('WorktreeManager — Ordnerwahl und Projekt-Aufräumen', () => {
  let repo: string;
  let dataDir: string;
  let wm: WorktreeManager;
  const project = { id: 'P1', name: 'Demo Projekt' };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-wt-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-wt-data-'));
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 't@t.local']);
    sh(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'a.txt'), 'init\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);
    wm = new WorktreeManager(dataDir);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('legt neue Worktrees unter dem lesbaren Ordnernamen an', () => {
    expect(wm.pathFor(project, 'feat')).toBe(join(dataDir, 'worktrees', 'demo-projekt-P1', 'feat'));
  });

  it('bleibt beim Alt-Ordner, solange dort etwas liegt (kein Umzug von Bestand)', () => {
    const legacy = join(dataDir, 'worktrees', project.id, 'altes-feature');
    mkdirSync(legacy, { recursive: true });
    expect(wm.pathFor(project, 'feat')).toBe(join(dataDir, 'worktrees', project.id, 'feat'));
  });

  it('ignoriert einen LEEREN Alt-Ordner und nutzt den neuen Namen', () => {
    mkdirSync(join(dataDir, 'worktrees', project.id), { recursive: true });
    expect(wm.pathFor(project, 'feat')).toBe(join(dataDir, 'worktrees', 'demo-projekt-P1', 'feat'));
  });

  it('entfernt beim Projekt-Löschen Worktrees, gemergte Branches und den Projektordner', async () => {
    const wt = await wm.create({
      project,
      projectPath: repo,
      featureName: 'sauber',
      branch: 'feature/sauber',
      defaultBranch: 'main',
    });
    expect(existsSync(wt)).toBe(true);
    const real = realpathSync(wt); // nach dem Entfernen nicht mehr auflösbar

    const cleanup = await wm.removeAllForProject(project, repo);

    expect(cleanup.removed).toContain(real);
    expect(cleanup.kept).toEqual([]);
    expect(existsSync(wt)).toBe(false);
    // Branch ohne eigene Commits ist in main enthalten → darf weg.
    await expect(localBranchExists(repo, 'feature/sauber')).resolves.toBe(false);
    expect(existsSync(join(dataDir, 'worktrees', projectDirName(project)))).toBe(false);
  });

  it('lässt uncommittete Arbeit stehen und meldet sie, statt sie zu löschen', async () => {
    const wt = await wm.create({
      project,
      projectPath: repo,
      featureName: 'dreckig',
      branch: 'feature/dreckig',
      defaultBranch: 'main',
    });
    writeFileSync(join(wt, 'nicht-gesichert.txt'), 'wertvoll\n');

    const cleanup = await wm.removeAllForProject(project, repo);

    expect(cleanup.removed).not.toContain(realpathSync(wt));
    expect(cleanup.kept).toEqual([{ path: realpathSync(wt), reason: 'uncommittete Änderungen' }]);
    expect(existsSync(join(wt, 'nicht-gesichert.txt'))).toBe(true);
  });

  it('behält einen Branch mit ungemergten Commits, auch wenn der Worktree sauber ist', async () => {
    const wt = await wm.create({
      project,
      projectPath: repo,
      featureName: 'eigenstaendig',
      branch: 'feature/eigenstaendig',
      defaultBranch: 'main',
    });
    writeFileSync(join(wt, 'arbeit.txt'), 'committet\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'feat: arbeit']);
    const real = realpathSync(wt);

    const cleanup = await wm.removeAllForProject(project, repo);

    // Worktree ist ersetzbar, der Branch hält die Arbeit — er bleibt.
    expect(cleanup.removed).toContain(real);
    await expect(localBranchExists(repo, 'feature/eigenstaendig')).resolves.toBe(true);
  });

  it('fasst Worktrees außerhalb des Datenverzeichnisses nicht an', async () => {
    const fremd = join(mkdtempSync(join(tmpdir(), 'sdd-fremd-')), 'eigener-worktree');
    sh(repo, ['worktree', 'add', fremd, '-b', 'eigener-branch']);

    const cleanup = await wm.removeAllForProject(project, repo);

    expect(cleanup.removed).not.toContain(realpathSync(fremd));
    expect(existsSync(fremd)).toBe(true);
    await expect(localBranchExists(repo, 'eigener-branch')).resolves.toBe(true);
    rmSync(fremd, { recursive: true, force: true });
  });
});
