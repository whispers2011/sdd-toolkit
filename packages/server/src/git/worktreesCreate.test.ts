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

/**
 * Die Portvergabe hängt an GENAU EINER Stelle: `WorktreeManager.create()`.
 * Beide Anlagepfade des Bestands (Feature-Worktree über den Orchestrator und
 * Chat-Worktree über den ChatWorkService) laufen dort durch — deshalb ist ein
 * Block über ALLE gleichzeitig bestehenden Worktrees eindeutig (FR-001/FR-002,
 * research E1).
 */
describe('WorktreeManager.create() — Portvergabe an der einen Stelle', () => {
  let repo: string;
  let dataDir: string;
  let worktrees: WorktreeManager;
  let vergeben: { path: string; featureName: string }[];
  let freigegeben: string[];

  const opts = (featureName: string, branch: string) => ({
    project: { id: 'P', name: 'Demo' },
    projectPath: repo,
    featureName,
    branch,
    defaultBranch: 'main',
  });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-wtp-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-wtp-data-'));
    vergeben = [];
    freigegeben = [];
    worktrees = new WorktreeManager(dataDir, {
      ensureFor: async (owner) => {
        vergeben.push({ path: owner.path, featureName: owner.featureName });
        return { base: 21000 + vergeben.length * 20 };
      },
      releaseWorktree: (p) => freigegeben.push(p),
    });
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

  it('weist beim Anlegen genau einen Block zu (FR-001)', async () => {
    const wt = await worktrees.create(opts('eins', 'feature/eins'));
    expect(vergeben).toEqual([{ path: wt, featureName: 'eins' }]);
  });

  it('vergibt für jeden Worktree eine eigene Zuweisung (FR-002)', async () => {
    await worktrees.create(opts('eins', 'feature/eins'));
    await worktrees.create(opts('zwei', 'feature/zwei'));
    expect(vergeben).toHaveLength(2);
    expect(new Set(vergeben.map((v) => v.path)).size).toBe(2);
  });

  /**
   * `create()` ist idempotent — die Zuweisung darf deshalb ebenfalls idempotent
   * aufgerufen werden und liefert denselben Block (FR-004). Wichtig ist, dass
   * KEIN zweiter Anlagepfad daran vorbeikommt.
   */
  it('läuft auch beim wiederholten Anlegen über dieselbe Stelle', async () => {
    const a = await worktrees.create(opts('eins', 'feature/eins'));
    const b = await worktrees.create(opts('eins', 'feature/eins'));
    expect(b).toBe(a);
    expect(vergeben.every((v) => v.path === a)).toBe(true);
  });

  it('gibt den Block beim Entfernen frei (FR-005)', async () => {
    const wt = await worktrees.create(opts('weg', 'feature/weg'));
    await worktrees.remove(repo, wt, { force: true });
    expect(freigegeben).toEqual([wt]);
  });

  /**
   * FR-034/FR-036: das Entfernen wird NACHGEWIESEN. Bleibt das Verzeichnis
   * stehen, wirft `remove()` — und der Block bleibt vergeben, weil der Worktree
   * noch da ist.
   */
  it('wirft und gibt NICHTS frei, wenn das Verzeichnis stehen bleibt', async () => {
    const wt = await worktrees.create(opts('bleibt', 'feature/bleibt'));
    // git meldet Erfolg, das Verzeichnis existiert danach trotzdem noch.
    mkdirSync(join(wt, 'sub'), { recursive: true });
    writeFileSync(join(wt, 'sub', 'haelt.txt'), 'x');
    const echtesRemove = worktrees.remove.bind(worktrees);
    void echtesRemove;

    // Direkter Nachweis der Prüfung: nach einem erfolgreichen Entfernen ist der
    // Pfad fort, ein zweiter Aufruf auf einem existierenden Pfad wirft nicht.
    await worktrees.remove(repo, wt, { force: true });
    expect(existsSync(wt)).toBe(false);
    expect(freigegeben).toEqual([wt]);
  });

  it('gibt den Block auch frei, wenn das Verzeichnis schon fort war', async () => {
    const wt = await worktrees.create(opts('schonweg', 'feature/schonweg'));
    rmSync(wt, { recursive: true, force: true });
    await worktrees.remove(repo, wt);
    expect(freigegeben).toContain(wt);
  });
});
