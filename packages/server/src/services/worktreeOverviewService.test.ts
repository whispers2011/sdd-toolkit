import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_PHASES, type Feature, type WorktreeEntry } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { FeatureRepo, ProjectRepo } from '../db/repos.js';
import { WorktreeManager } from '../git/worktrees.js';
import {
  WorktreeOverviewService,
  WorktreeRemoveError,
  type WorktreeSessionSource,
} from './worktreeOverviewService.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function idlePhases(): Feature['phases'] {
  return Object.fromEntries(
    FEATURE_PHASES.map((p) => [p, { status: 'idle', stale: false }]),
  ) as Feature['phases'];
}

/**
 * Erhebung gegen ein ECHTES temporäres Repo. `mkdtemp` liegt unter macOS real
 * unter `/private/var/...`, während der zurückgegebene Pfad `/var/...` lautet —
 * genau die Konstellation, die ohne realpath-Auflösung falsche „verwaist"-
 * Meldungen erzeugt (research.md D2).
 */
describe('WorktreeOverviewService.buildOverview (Integration)', () => {
  let repo: string;
  let dataDir: string;
  let db: DB;
  let projects: ProjectRepo;
  let features: FeatureRepo;
  let worktrees: WorktreeManager;
  let svc: WorktreeOverviewService;
  let projectId: string;
  let sessions: { cwd: string; exited: boolean }[];

  const ptys: WorktreeSessionSource = { list: () => sessions };

  const makeFeature = (name: string, branch: string, worktreePath: string | null): Feature =>
    features.create({
      projectId,
      name,
      branch,
      worktreePath,
      phases: idlePhases(),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });

  const entryFor = async (label: string): Promise<WorktreeEntry | undefined> => {
    const overview = await svc.buildOverview();
    return overview.groups[0]?.worktrees.find((w) => w.label === label);
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-wo-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-wo-data-'));
    sessions = [];
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'app.txt'), 'init\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);

    db = openMemoryDatabase();
    projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    worktrees = new WorktreeManager(dataDir);
    projectId = projects.create({
      name: 'Demo',
      path: repo,
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;

    svc = new WorktreeOverviewService({ projects, features, ptys, worktrees, bus: { emitEvent: () => {} } });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  it('führt den Haupt-Checkout getrennt und zählt die offenen Worktrees', async () => {
    const overview = await svc.buildOverview();
    const group = overview.groups[0];
    expect(overview.collectedAt).toBeGreaterThan(0);
    expect(group?.error).toBeNull();
    expect(group?.main).toMatchObject({ branch: 'main', defaultBranch: 'main', uncommittedFileCount: 0 });
    // Der Haupt-Checkout taucht nie als Worktree-Eintrag auf.
    expect(group?.worktrees).toEqual([]);
    expect(group?.worktreeCount).toBe(0);
  });

  it('ordnet einen Worktree seinem Feature zu, obwohl der DB-Pfad unaufgelöst ist (kein falsches „verwaist")', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'zuordnung',
      branch: 'feature/zuordnung',
      defaultBranch: 'main',
    });
    const feature = makeFeature('zuordnung', 'feature/zuordnung', wt);

    const entry = await entryFor('zuordnung');
    expect(entry?.kind).toBe('feature');
    expect(entry?.featureId).toBe(feature.id);
    expect(entry?.branch).toBe('feature/zuordnung');
    expect(entry?.dirState).toBe('present');
    expect(entry?.targetBranch).toBe('main');
    expect(entry?.removable).toBe(true);
    // Stabile Kennung basiert auf dem kanonisierten Pfad.
    expect(entry?.id).toBe(`${projectId}::${entry?.path}`);
  });

  it('ordnet über Branch-Gleichheit zu, wenn der Pfad nicht mehr passt', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'verschoben',
      branch: 'feature/verschoben',
      defaultBranch: 'main',
    });
    const feature = makeFeature('verschoben', 'feature/verschoben', join(dataDir, 'ganz/woanders'));
    expect(wt).toBeTruthy();

    const entry = await entryFor('verschoben');
    expect(entry?.kind).toBe('feature');
    expect(entry?.featureId).toBe(feature.id);
    expect(entry?.dirState).toBe('present');
  });

  it('vergleicht gegen das integrationTarget des Features, nicht gegen den Projekt-Default', async () => {
    sh(repo, ['branch', 'release/1.0']);
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'eigenes-ziel',
      branch: 'feature/eigenes-ziel',
      defaultBranch: 'main',
    });
    const feature = makeFeature('eigenes-ziel', 'feature/eigenes-ziel', wt);
    features.setIntegrationTarget(feature.id, 'release/1.0');
    // Auf dem abweichenden Ziel bewegt sich app.txt — nur dagegen darf verglichen werden.
    sh(repo, ['checkout', '-q', 'release/1.0']);
    writeFileSync(join(repo, 'app.txt'), 'auf release\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'release bewegt sich']);
    sh(repo, ['checkout', '-q', 'main']);
    // Eigener Commit im Worktree, sonst gilt der Branch als integriert.
    writeFileSync(join(wt, 'app.txt'), 'im worktree\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'eigene arbeit']);

    const entry = await entryFor('eigenes-ziel');
    expect(entry?.targetBranch).toBe('release/1.0');
    expect(entry?.warnings.find((w) => w.kind === 'behind_target')?.files).toEqual(['app.txt']);
  });

  it('hält gleichnamige Features zweier Projekte auseinander', async () => {
    const repo2 = mkdtempSync(join(tmpdir(), 'sdd-wo-repo2-'));
    sh(repo2, ['init', '-b', 'main']);
    sh(repo2, ['config', 'user.email', 'test@test.local']);
    sh(repo2, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo2, 'app.txt'), 'init\n');
    sh(repo2, ['add', '-A']);
    sh(repo2, ['commit', '-m', 'init']);
    const projectId2 = projects.create({
      name: 'Zweites',
      path: repo2,
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;

    for (const [pid, path] of [
      [projectId, repo],
      [projectId2, repo2],
    ] as const) {
      const wt = await worktrees.create({
        project: { id: pid, name: 'Demo' },
        projectPath: path,
        featureName: 'gleicher-name',
        branch: 'feature/gleicher-name',
        defaultBranch: 'main',
      });
      features.create({
        projectId: pid,
        name: 'gleicher-name',
        branch: 'feature/gleicher-name',
        worktreePath: wt,
        phases: idlePhases(),
        integration: 'none',
        integrationTarget: null,
        automation: {},
        optimization: {},
        tasksDone: 0,
        tasksTotal: 0,
      });
    }

    const overview = await svc.buildOverview();
    const ids = overview.groups.flatMap((g) => g.worktrees.map((w) => w.id));
    expect(new Set(ids).size).toBe(2);
    expect(overview.groups.every((g) => g.worktreeCount === 1)).toBe(true);
    // Kein Eintrag rutscht in den falschen Projektblock.
    expect(overview.groups.every((g) => g.worktrees.every((w) => w.projectId === g.projectId))).toBe(
      true,
    );
    rmSync(repo2, { recursive: true, force: true });
  });

  it('weist einen Worktree ohne Feature als verwaist aus', async () => {
    const orphan = join(dataDir, 'verwaister-worktree');
    sh(repo, ['worktree', 'add', orphan, '-b', 'tmp/verwaist']);

    const entry = await entryFor('verwaister-worktree');
    expect(entry?.kind).toBe('orphan');
    expect(entry?.featureId).toBeNull();
    expect(entry?.dirState).toBe('present');
  });

  it('weist eine Chat-Arbeitskopie als Wissens-Chat aus (nicht als verwaist)', async () => {
    const chat = join(dataDir, 'chat-abc123');
    sh(repo, ['worktree', 'add', chat, '-b', 'chat/abc123']);

    const entry = await entryFor('Wissens-Chat');
    expect(entry?.kind).toBe('chat');
    expect(entry?.featureId).toBeNull();
  });

  it('meldet ein fehlendes Worktree-Verzeichnis als dirState "missing" (git kennt es nicht)', async () => {
    makeFeature('ohne-worktree', 'feature/ohne-worktree', join(dataDir, 'nie-angelegt'));

    const entry = await entryFor('ohne-worktree');
    expect(entry?.dirState).toBe('missing');
    expect(entry?.kind).toBe('feature');
    expect(entry?.removable).toBe(false);
  });

  it('meldet eine Registry-Leiche als "registry_only" und nicht entfernbar', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'leiche',
      branch: 'feature/leiche',
      defaultBranch: 'main',
    });
    makeFeature('leiche', 'feature/leiche', wt);
    // Verzeichnis hart entfernen, ohne git zu informieren.
    rmSync(wt, { recursive: true, force: true });

    const entry = await entryFor('leiche');
    expect(entry?.dirState).toBe('registry_only');
    expect(entry?.removable).toBe(false);
  });

  it('sperrt das Entfernen bei laufender Session im Worktree', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'aktiv',
      branch: 'feature/aktiv',
      defaultBranch: 'main',
    });
    makeFeature('aktiv', 'feature/aktiv', wt);
    sessions = [{ cwd: join(wt, 'unterordner'), exited: false }];

    const entry = await entryFor('aktiv');
    expect(entry?.sessionActive).toBe(true);
    expect(entry?.removable).toBe(false);
  });

  it('sortiert feature → chat → orphan und zählt korrekt', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'zzz-feature',
      branch: 'feature/zzz',
      defaultBranch: 'main',
    });
    makeFeature('zzz-feature', 'feature/zzz', wt);
    sh(repo, ['worktree', 'add', join(dataDir, 'aaa-verwaist'), '-b', 'tmp/aaa']);
    sh(repo, ['worktree', 'add', join(dataDir, 'chat-xyz'), '-b', 'chat/xyz']);

    const group = (await svc.buildOverview()).groups[0];
    expect(group?.worktrees.map((w) => w.kind)).toEqual(['feature', 'chat', 'orphan']);
    expect(group?.worktreeCount).toBe(3);
    expect(group?.worktreeCount).toBe(group?.worktrees.length);
  });

  it('zählt geänderte und uncommittete Dateien getrennt', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'dateien',
      branch: 'feature/dateien',
      defaultBranch: 'main',
    });
    makeFeature('dateien', 'feature/dateien', wt);
    writeFileSync(join(wt, 'committet.txt'), 'fest\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'arbeit']);
    writeFileSync(join(wt, 'offen.txt'), 'roh\n');

    const entry = await entryFor('dateien');
    expect(entry?.changedFileCount).toBe(2);
    expect(entry?.uncommittedFileCount).toBe(1);
    expect(entry?.files.map((f) => f.path).sort()).toEqual(['committet.txt', 'offen.txt']);
    expect(entry?.filesTruncated).toBe(false);
  });

  it('meldet einen änderungsfreien Worktree ehrlich mit 0', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'leer',
      branch: 'feature/leer',
      defaultBranch: 'main',
    });
    makeFeature('leer', 'feature/leer', wt);

    const entry = await entryFor('leer');
    expect(entry?.changedFileCount).toBe(0);
    expect(entry?.uncommittedFileCount).toBe(0);
    expect(entry?.files).toEqual([]);
    expect(entry?.error).toBeNull();
  });

  it('kürzt die Dateiliste auf 300, ohne die Gesamtzahl zu verfälschen', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'viele',
      branch: 'feature/viele',
      defaultBranch: 'main',
    });
    makeFeature('viele', 'feature/viele', wt);
    for (let i = 0; i < 305; i++) {
      writeFileSync(join(wt, `datei-${String(i).padStart(4, '0')}.txt`), `${i}\n`);
    }

    const entry = await entryFor('viele');
    expect(entry?.changedFileCount).toBe(305);
    expect(entry?.files).toHaveLength(300);
    expect(entry?.filesTruncated).toBe(true);
  });

  it('warnt bei Überschneidung und nennt Datei und das jeweils andere Feature', async () => {
    const a = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'eins',
      branch: 'feature/eins',
      defaultBranch: 'main',
    });
    const b = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'zwei',
      branch: 'feature/zwei',
      defaultBranch: 'main',
    });
    makeFeature('eins', 'feature/eins', a);
    makeFeature('zwei', 'feature/zwei', b);
    writeFileSync(join(a, 'app.txt'), 'aus eins\n');
    writeFileSync(join(b, 'app.txt'), 'aus zwei\n');

    const entryA = await entryFor('eins');
    const overlap = entryA?.warnings.find((w) => w.kind === 'overlap');
    expect(overlap?.files).toEqual(['app.txt']);
    expect(overlap?.fileCount).toBe(1);
    expect(overlap?.others.map((o) => o.label)).toEqual(['zwei']);
    expect(entryA?.files.find((f) => f.path === 'app.txt')?.overlapping).toBe(true);

    const entryB = await entryFor('zwei');
    expect(entryB?.warnings.find((w) => w.kind === 'overlap')?.others.map((o) => o.label)).toEqual([
      'eins',
    ]);
  });

  it('warnt, wenn eine geänderte Datei auch auf dem Zielbranch bewegt wurde', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'veraltet',
      branch: 'feature/veraltet',
      defaultBranch: 'main',
    });
    makeFeature('veraltet', 'feature/veraltet', wt);
    // Eigener Commit, sonst gilt der Branch als integriert und unterdrückt die Warnung.
    writeFileSync(join(wt, 'app.txt'), 'im worktree\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'eigene arbeit']);
    // Dieselbe Datei danach auf main bewegen.
    writeFileSync(join(repo, 'app.txt'), 'auf main\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'main bewegt sich']);

    const entry = await entryFor('veraltet');
    const behind = entry?.warnings.find((w) => w.kind === 'behind_target');
    expect(behind?.files).toEqual(['app.txt']);
    expect(behind?.fileCount).toBe(1);
    expect(entry?.files.find((f) => f.path === 'app.txt')?.behindTarget).toBe(true);
  });

  it('warnt „bereits integriert" und unterdrückt dann „veraltet"', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'integriert',
      branch: 'feature/integriert',
      defaultBranch: 'main',
    });
    makeFeature('integriert', 'feature/integriert', wt);
    // Branch hat keine eigenen Commits ⇒ Vorfahre von main ⇒ integriert.
    writeFileSync(join(wt, 'app.txt'), 'im worktree\n');
    writeFileSync(join(repo, 'app.txt'), 'auf main\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'main bewegt sich']);

    const entry = await entryFor('integriert');
    expect(entry?.warnings.map((w) => w.kind)).toEqual(['already_merged']);
    const merged = entry?.warnings[0];
    expect(merged?.files).toEqual([]);
    expect(merged?.fileCount).toBe(0);
  });

  it('hält die Warn-Reihenfolge stabil, wenn mehrere Lagen zutreffen', async () => {
    const a = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'a-doppelt',
      branch: 'feature/a-doppelt',
      defaultBranch: 'main',
    });
    const b = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'b-doppelt',
      branch: 'feature/b-doppelt',
      defaultBranch: 'main',
    });
    makeFeature('a-doppelt', 'feature/a-doppelt', a);
    makeFeature('b-doppelt', 'feature/b-doppelt', b);
    // Beide Worktrees fassen app.txt an — und main bewegt dieselbe Datei.
    for (const wt of [a, b]) {
      writeFileSync(join(wt, 'app.txt'), `aus ${wt}\n`);
      sh(wt, ['add', '-A']);
      sh(wt, ['commit', '-m', 'eigene arbeit']); // eigene Commits ⇒ nicht integriert
    }
    writeFileSync(join(repo, 'app.txt'), 'auf main\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'main bewegt sich']);

    const entry = await entryFor('a-doppelt');
    expect(entry?.warnings.map((w) => w.kind)).toEqual(['overlap', 'behind_target']);
  });

  it('warnt bei einem frischen, sauberen Worktree gar nicht', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'sauber',
      branch: 'feature/sauber',
      defaultBranch: 'main',
    });
    makeFeature('sauber', 'feature/sauber', wt);
    // Eigener Commit, damit der Branch nicht als integriert gilt.
    writeFileSync(join(wt, 'nur-hier.txt'), 'eigen\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'eigene arbeit']);

    const entry = await entryFor('sauber');
    expect(entry?.warnings).toEqual([]);
  });

  it('erzeugt für Einträge ohne vorhandenes Verzeichnis keine Warnungen', async () => {
    makeFeature('fehlt', 'feature/fehlt', join(dataDir, 'nie-angelegt'));
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'leiche2',
      branch: 'feature/leiche2',
      defaultBranch: 'main',
    });
    makeFeature('leiche2', 'feature/leiche2', wt);
    rmSync(wt, { recursive: true, force: true });

    expect((await entryFor('fehlt'))?.warnings).toEqual([]);
    expect((await entryFor('leiche2'))?.warnings).toEqual([]);
  });

  it('lässt den Haupt-Checkout an keiner Warnung teilnehmen', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'gegenprobe',
      branch: 'feature/gegenprobe',
      defaultBranch: 'main',
    });
    makeFeature('gegenprobe', 'feature/gegenprobe', wt);
    // Dieselbe Datei im Haupt-Checkout und im Worktree anfassen.
    writeFileSync(join(wt, 'app.txt'), 'im worktree\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'eigene arbeit']);
    writeFileSync(join(repo, 'app.txt'), 'im haupt-checkout\n');

    const group = (await svc.buildOverview()).groups[0];
    // Der Haupt-Checkout trägt gar keine Warnungen-Struktur.
    expect(group?.main).not.toHaveProperty('warnings');
    // …und nimmt an der Überschneidungs-Erkennung nicht teil: ein einzelner
    // Worktree überschneidet sich mit niemandem, obwohl main dieselbe Datei hält.
    const entry = group?.worktrees.find((w) => w.label === 'gegenprobe');
    expect(entry?.warnings.some((w) => w.kind === 'overlap')).toBe(false);
  });

  it('hält ein unerreichbares Projekt auf seinen eigenen Block beschränkt', async () => {
    projects.create({
      name: 'Weg',
      path: join(dataDir, 'gibt-es-nicht'),
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    });

    const overview = await svc.buildOverview();
    expect(overview.groups).toHaveLength(2);
    const broken = overview.groups.find((g) => g.projectName === 'Weg');
    expect(broken?.error).toContain('nicht gefunden');
    expect(broken?.main).toBeNull();
    expect(broken?.worktrees).toEqual([]);
    expect(broken?.worktreeCount).toBe(0);
    // Das gesunde Projekt bleibt vollständig nutzbar.
    expect(overview.groups.find((g) => g.projectName === 'Demo')?.error).toBeNull();
  });

  it('meldet ein Verzeichnis ohne .git als „kein Git-Repository"', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'sdd-wo-plain-'));
    projects.create({
      name: 'Ohne Git',
      path: plain,
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    });

    const overview = await svc.buildOverview();
    expect(overview.groups.find((g) => g.projectName === 'Ohne Git')?.error).toContain(
      'kein Git-Repository',
    );
    rmSync(plain, { recursive: true, force: true });
  });

  // ---------- Entfernen (US4) ----------

  const expectRemoveError = async (
    req: { projectId: string; path: string; force?: boolean },
    code: string,
  ): Promise<WorktreeRemoveError> => {
    const err = await svc.removeWorktree(req).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WorktreeRemoveError);
    expect((err as WorktreeRemoveError).code).toBe(code);
    return err as WorktreeRemoveError;
  };

  it('weist ein unbekanntes Projekt ab', async () => {
    await expectRemoveError({ projectId: 'gibt-es-nicht', path: repo }, 'project_not_found');
  });

  it('weist einen Pfad ab, der kein geführter Worktree dieses Projekts ist', async () => {
    await expectRemoveError({ projectId, path: join(dataDir, 'irgendein-ordner') }, 'not_a_worktree');
  });

  it('weist den Haupt-Checkout ab', async () => {
    await expectRemoveError({ projectId, path: repo }, 'main_checkout');
  });

  it('weist eine Registry-Leiche ab (Prune ist außerhalb des Umfangs)', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'leiche-rm',
      branch: 'feature/leiche-rm',
      defaultBranch: 'main',
    });
    makeFeature('leiche-rm', 'feature/leiche-rm', wt);
    rmSync(wt, { recursive: true, force: true });

    await expectRemoveError({ projectId, path: wt }, 'not_removable');
  });

  it('weist ab, solange eine Session im Worktree läuft', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'session-rm',
      branch: 'feature/session-rm',
      defaultBranch: 'main',
    });
    makeFeature('session-rm', 'feature/session-rm', wt);
    sessions = [{ cwd: wt, exited: false }];

    await expectRemoveError({ projectId, path: wt }, 'session_active');
    expect(existsSync(wt)).toBe(true);
  });

  it('verlangt bei uncommitteten Änderungen eine ausdrückliche Zweitbestätigung', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'dreckig',
      branch: 'feature/dreckig',
      defaultBranch: 'main',
    });
    makeFeature('dreckig', 'feature/dreckig', wt);
    writeFileSync(join(wt, 'ungesichert.txt'), 'wertvoll\n');
    writeFileSync(join(wt, 'app.txt'), 'auch geaendert\n');

    const err = await expectRemoveError({ projectId, path: wt }, 'uncommitted');
    expect(err.uncommittedFileCount).toBe(2);
    expect(existsSync(wt)).toBe(true);

    // Erst mit force wird tatsächlich entfernt.
    const result = await svc.removeWorktree({ projectId, path: wt, force: true });
    expect(result.ok).toBe(true);
    expect(existsSync(wt)).toBe(false);
  });

  it('entfernt einen sauberen Worktree und löst die Feature-Zuordnung', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'weg-damit',
      branch: 'feature/weg-damit',
      defaultBranch: 'main',
    });
    const feature = makeFeature('weg-damit', 'feature/weg-damit', wt);
    const emitted: string[] = [];
    svc = new WorktreeOverviewService({
      projects,
      features,
      ptys,
      worktrees,
      bus: { emitEvent: (_e, f) => emitted.push(f.id) },
    });

    const result = await svc.removeWorktree({ projectId, path: wt });
    expect(result).toEqual({ ok: true, featureId: feature.id });
    expect(existsSync(wt)).toBe(false);
    expect(features.get(feature.id)?.worktreePath).toBeNull();
    expect(emitted).toEqual([feature.id]);

    // Der Eintrag verschwindet aus der Übersicht — auch nicht als „missing".
    const group = (await svc.buildOverview()).groups[0];
    expect(group?.worktrees.find((w) => w.label === 'weg-damit')).toBeUndefined();
    expect(await worktrees.list(repo)).toHaveLength(1);
  });

  it('entfernt einen verwaisten Worktree ohne DB-Änderung', async () => {
    const orphan = join(dataDir, 'verwaist-rm');
    sh(repo, ['worktree', 'add', orphan, '-b', 'tmp/verwaist-rm']);

    const result = await svc.removeWorktree({ projectId, path: orphan });
    expect(result).toEqual({ ok: true, featureId: null });
    expect(existsSync(orphan)).toBe(false);
  });

  // ---------- Cache (US5) ----------

  it('liefert innerhalb der TTL denselben Stand', async () => {
    const first = await svc.buildOverview();
    const second = await svc.buildOverview();
    expect(second.collectedAt).toBe(first.collectedAt);
  });

  it('umgeht den Cache bei refresh', async () => {
    const first = await svc.buildOverview();
    const refreshed = await svc.buildOverview({ refresh: true });
    expect(refreshed.collectedAt).toBeGreaterThan(first.collectedAt);
  });

  it('löst bei parallelen Abrufen nur EINE Erhebung aus', async () => {
    const spy = vi.spyOn(projects, 'list');
    const [a, b, c] = await Promise.all([
      svc.buildOverview(),
      svc.buildOverview(),
      svc.buildOverview(),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a?.collectedAt).toBe(b?.collectedAt);
    expect(b?.collectedAt).toBe(c?.collectedAt);
    spy.mockRestore();
  });

  it('verwirft den Cache nach erfolgreichem Entfernen', async () => {
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'cache-weg',
      branch: 'feature/cache-weg',
      defaultBranch: 'main',
    });
    makeFeature('cache-weg', 'feature/cache-weg', wt);

    const before = await svc.buildOverview();
    expect(before.groups[0]?.worktreeCount).toBe(1);

    await svc.removeWorktree({ projectId, path: wt });

    const after = await svc.buildOverview();
    expect(after.collectedAt).toBeGreaterThan(before.collectedAt);
    expect(after.groups[0]?.worktreeCount).toBe(0);
  });
});

// ---------- Größe, Portbereich, Plattenwarnung, verwaiste Worktrees ----------

describe('WorktreeOverviewService — Platte und verwaiste Einträge', () => {
  let repo: string;
  let dataDir: string;
  let db: DB;
  let projects: ProjectRepo;
  let features: FeatureRepo;
  let worktrees: WorktreeManager;
  let projectId: string;
  let svc: WorktreeOverviewService;
  let raised: { kind: string; message: string; id: string }[];
  let resolved: string[];
  let sizeFor: (path: string) => Promise<number | null>;
  let freeBytes: number | null;

  const ptys = { list: () => [] };

  function build(): WorktreeOverviewService {
    return new WorktreeOverviewService({
      projects,
      features,
      ptys,
      worktrees,
      bus: { emitEvent: () => {} },
      attention: {
        raise: (a) => {
          const item = { ...a, id: `att-${raised.length}` };
          // Dedup wie im echten Repo: gleiche offene Meldung entsteht nicht doppelt.
          const vorhanden = raised.find((r) => r.kind === a.kind && r.message === a.message);
          if (vorhanden) return vorhanden;
          raised.push(item);
          return item;
        },
        listOpen: () => raised.filter((r) => !resolved.includes(r.id)),
        resolve: (id) => {
          resolved.push(id);
          return true;
        },
      },
      ports: { baseForWorktree: () => 21040, reconcile: () => 0 },
      readDirSize: (p) => sizeFor(p),
      diskFreeBytes: async () => freeBytes,
      diskWarnBytes: 10 * 1024 ** 3,
    });
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-wd-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-wd-data-'));
    raised = [];
    resolved = [];
    sizeFor = async () => 1_500_000_000;
    freeBytes = 500 * 1024 ** 3;
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'app.txt'), 'init\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);

    db = openMemoryDatabase();
    projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    worktrees = new WorktreeManager(dataDir);
    projectId = projects.create({
      name: 'Demo',
      path: repo,
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;
    svc = build();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  /** Ein Worktree ohne zugeordnetes Feature = verwaist. */
  async function makeOrphan(name: string): Promise<string> {
    return worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: name,
      branch: `chatlos/${name}`,
      defaultBranch: 'main',
    });
  }

  it('nennt je Eintrag eine Größe (FR-042)', async () => {
    await makeOrphan('gross');
    const overview = await svc.buildOverview({ refresh: true });
    expect(overview.groups[0]?.worktrees[0]?.sizeBytes).toBe(1_500_000_000);
  });

  /** FR-044: „unbekannt" ist ein gültiger Wert, der Eintrag bleibt vollständig. */
  it('lässt den Eintrag vollständig sichtbar, wenn die Größe nicht ermittelbar ist', async () => {
    sizeFor = async () => null;
    const wt = await makeOrphan('unbekannt');
    const entry = (await svc.buildOverview({ refresh: true })).groups[0]?.worktrees[0];
    expect(entry?.sizeBytes).toBeNull();
    // Der Pfad kommt kanonisiert (macOS: /var → /private/var) — der Eintrag ist
    // vollständig, das ist der Punkt.
    expect(entry?.path).toContain(wt.replace('/private', ''));
    expect(entry?.branch).toBe('chatlos/unbekannt');
  });

  it('lässt den Eintrag auch bei einem Fehler der Größenerhebung stehen', async () => {
    sizeFor = () => Promise.reject(new Error('du kaputt'));
    await makeOrphan('fehler');
    const entry = (await svc.buildOverview({ refresh: true })).groups[0]?.worktrees[0];
    expect(entry?.sizeBytes).toBeNull();
    expect(entry?.error).toBeNull();
  });

  it('nennt den zugewiesenen Portbereich je Eintrag', async () => {
    await makeOrphan('mitport');
    expect((await svc.buildOverview({ refresh: true })).groups[0]?.worktrees[0]?.portBase).toBe(21040);
  });

  it('warnt NICHT, solange genug Platz frei ist', async () => {
    const overview = await svc.buildOverview({ refresh: true });
    expect(overview.disk).toEqual({ freeBytes: 500 * 1024 ** 3, warnBelowBytes: 10 * 1024 ** 3, warn: false });
  });

  it('warnt bei Unterschreiten der Schwelle und nennt den freien Platz (FR-043)', async () => {
    freeBytes = 813 * 1024 ** 2;
    const overview = await svc.buildOverview({ refresh: true });
    expect(overview.disk.warn).toBe(true);
    expect(overview.disk.freeBytes).toBe(813 * 1024 ** 2);
  });

  it('warnt nicht, wenn der freie Platz nicht ermittelbar ist', async () => {
    freeBytes = null;
    const overview = await svc.buildOverview({ refresh: true });
    expect(overview.disk).toEqual({ freeBytes: null, warnBelowBytes: 10 * 1024 ** 3, warn: false });
  });

  /** FR-039/SC-011: aktiv melden, nicht nur in einer Liste führen. */
  it('meldet jeden verwaisten Worktree als „Braucht dich" (FR-039)', async () => {
    const wt = await makeOrphan('verwaist');
    await svc.buildOverview({ refresh: true });
    const item = raised.find((r) => r.kind === 'orphan_worktree');
    expect(item).toBeDefined();
    expect(item?.message).toContain(wt);
    expect(item?.message).toContain('1,4 GB');
  });

  it('erzeugt je Erhebung keine Dublette', async () => {
    await makeOrphan('einmal');
    await svc.buildOverview({ refresh: true });
    await svc.buildOverview({ refresh: true });
    expect(raised.filter((r) => r.kind === 'orphan_worktree')).toHaveLength(1);
  });

  it('löst die Meldung auf, sobald der Eintrag verschwindet', async () => {
    const wt = await makeOrphan('geht-weg');
    await svc.buildOverview({ refresh: true });
    const item = raised.find((r) => r.kind === 'orphan_worktree')!;

    await worktrees.remove(repo, wt, { force: true });
    await svc.buildOverview({ refresh: true });

    expect(resolved).toContain(item.id);
  });

  it('meldet ein Feature-Worktree NICHT als verwaist', async () => {
    const wt = await makeOrphan('gehoert-dazu');
    features.create({
      projectId,
      name: 'gehoert-dazu',
      branch: 'chatlos/gehoert-dazu',
      worktreePath: wt,
      phases: {},
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    await svc.buildOverview({ refresh: true });
    expect(raised.filter((r) => r.kind === 'orphan_worktree')).toHaveLength(0);
  });
});
