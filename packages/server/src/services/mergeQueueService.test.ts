import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type DB } from '../db/database.js';
import {
  AttentionRepo,
  ExecutionRepo,
  FeatureRepo,
  ProjectRepo,
  QueueRepo,
  SettingsRepo,
} from '../db/repos.js';
import { WorktreeManager } from '../git/worktrees.js';
import { MergeEngine } from '../git/mergeEngine.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import type { ReviewGateService } from './reviewGateService.js';
import { MergeQueueService } from './mergeQueueService.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('MergeQueueService.reconcileMergedLeftovers (Integration)', () => {
  let repo: string;
  let dataDir: string;
  let db: DB;
  let worktrees: WorktreeManager;
  let features: FeatureRepo;
  let svc: MergeQueueService;
  let projectId: string;

  const ptysStub = {
    forFeature: () => undefined,
    snapshots: { remove: () => {} },
  } as unknown as PtySessionManager;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-mq-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-mq-data-'));
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'app.txt'), 'init\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);

    db = openMemoryDatabase();
    const projects = new ProjectRepo(db);
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
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;

    svc = new MergeQueueService({
      projects,
      features,
      queue: new QueueRepo(db),
      executions: new ExecutionRepo(db),
      attention: new AttentionRepo(db),
      settings: new SettingsRepo(db),
      worktrees,
      ptys: ptysStub,
      reviewGate: {} as unknown as ReviewGateService,
      dataDir,
    });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  it('räumt Worktree + Branch + DB-worktree_path für ein gemergtes Feature ab', async () => {
    const branch = 'feature/leftover';
    const wt = await worktrees.create({ projectId, projectPath: repo, featureName: 'leftover', branch, defaultBranch: 'main' });
    // Branch ist in main integriert (Merge-Base-Ancestor) — hier: keine eigenen Commits.
    const feature = features.create({
      projectId,
      name: 'leftover',
      branch,
      worktreePath: wt,
      phases: {},
      integration: 'merged',
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    expect(existsSync(wt)).toBe(true);

    await svc.reconcileMergedLeftovers();

    expect(existsSync(wt)).toBe(false);
    await expect(new MergeEngine().branchExists(repo, branch)).resolves.toBe(false);
    expect(features.get(feature.id)?.worktreePath).toBeNull();
  });

  it('lässt einen NICHT integrierten Branch stehen (kein Datenverlust)', async () => {
    const branch = 'feature/unmerged';
    const wt = await worktrees.create({ projectId, projectPath: repo, featureName: 'unmerged', branch, defaultBranch: 'main' });
    // Eigener, nicht nach main gemergter Commit → Branch darf nicht gelöscht werden.
    writeFileSync(join(wt, 'only-here.txt'), 'x\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'nur im Feature']);
    const feature = features.create({
      projectId,
      name: 'unmerged',
      branch,
      worktreePath: wt,
      phases: {},
      integration: 'merged', // fälschlich als merged markiert
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });

    await svc.reconcileMergedLeftovers();

    // Sicherheitsverhalten: nicht in main integriert → GAR NICHT anfassen.
    // Worktree, Branch und DB-worktree_path bleiben unverändert.
    expect(existsSync(wt)).toBe(true);
    expect(features.get(feature.id)?.worktreePath).toBe(wt);
    await expect(new MergeEngine().branchExists(repo, branch)).resolves.toBe(true);
  });
});
