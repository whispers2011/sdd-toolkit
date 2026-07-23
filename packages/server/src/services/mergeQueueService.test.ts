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
import type { AgentGateService } from './agentGateService.js';
import { MergeApprovalError, MergeQueueService } from './mergeQueueService.js';

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
      agentGate: {} as unknown as AgentGateService,
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

  // ---------- approveForMerge: Zielwahl, Validierung, Reviewer-Edits ----------

  async function makeReviewReadyFeature(name: string) {
    const branch = `feature/${name}`;
    const wt = await worktrees.create({ projectId, projectPath: repo, featureName: name, branch, defaultBranch: 'main' });
    writeFileSync(join(wt, `${name}.txt`), `${name}\n`);
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', `feat ${name}`]);
    const feature = features.create({
      projectId,
      name,
      branch,
      worktreePath: wt,
      phases: {},
      integration: 'none',
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    features.setIntegration(feature.id, 'awaiting_human_review');
    return { feature: features.get(feature.id)!, wt, branch };
  }

  async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error('Timeout beim Warten auf Bedingung');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('approveForMerge validiert Zielwahl (Name, Existenz, Feature-Branch, Stage)', async () => {
    const { feature, branch } = await makeReviewReadyFeature('val');
    await expect(svc.approveForMerge(feature.id, { targetBranch: 'mit space' })).rejects.toThrow(MergeApprovalError);
    await expect(svc.approveForMerge(feature.id, { targetBranch: branch })).rejects.toThrow(/Feature-Branch/);
    await expect(svc.approveForMerge(feature.id, { targetBranch: 'gibts/nicht' })).rejects.toThrow(/existiert nicht/);
    sh(repo, ['branch', 'schon-da']);
    await expect(
      svc.approveForMerge(feature.id, { targetBranch: 'schon-da', createBranch: true }),
    ).rejects.toThrow(/existiert bereits/);

    features.setIntegration(feature.id, 'none');
    await expect(svc.approveForMerge(feature.id)).rejects.toThrow(/nicht prüfbereit/);
  });

  it('approveForMerge mit createBranch merged in neuen Ziel-Branch; main bleibt unberührt', async () => {
    const { feature, branch } = await makeReviewReadyFeature('neuziel');
    const mainBefore = sh(repo, ['rev-parse', 'main']).trim();

    await svc.approveForMerge(feature.id, { targetBranch: 'integration/neuziel', createBranch: true });
    expect(features.get(feature.id)?.integrationTarget).toBe('integration/neuziel');
    await waitFor(() => features.get(feature.id)?.integration === 'merged');

    // Feature-Commits liegen im Ziel, main und Haupt-Checkout unverändert.
    expect(sh(repo, ['log', 'integration/neuziel', '--format=%s'])).toContain('feat neuziel');
    expect(sh(repo, ['rev-parse', 'main']).trim()).toBe(mainBefore);
    // Cleanup lief gegen das Ziel (nicht gegen main): Feature-Branch ist weg.
    await expect(new MergeEngine().branchExists(repo, branch)).resolves.toBe(false);
  });

  it('approveForMerge normalisiert Default-Ziel zu NULL und committet Reviewer-Edits', async () => {
    const { feature, wt } = await makeReviewReadyFeature('edits');
    // Portal-Edit: uncommittete Reviewer-Korrektur im Worktree.
    writeFileSync(join(wt, 'edits.txt'), 'reviewer-korrektur\n');

    await svc.approveForMerge(feature.id, { targetBranch: 'main' });
    expect(features.get(feature.id)?.integrationTarget).toBeNull();
    await waitFor(() => features.get(feature.id)?.integration === 'merged');

    const log = sh(repo, ['log', 'main', '--format=%s']);
    expect(log).toContain('review(edits): reviewer-korrekturen');
    expect(sh(repo, ['show', 'main:edits.txt'])).toContain('reviewer-korrektur');
  });

  it('reject: setIntegrationTarget(null) macht die Zielwahl rückgängig', async () => {
    const { feature } = await makeReviewReadyFeature('zurueck');
    features.setIntegrationTarget(feature.id, 'integration/alt');
    expect(features.get(feature.id)?.integrationTarget).toBe('integration/alt');
    features.setIntegrationTarget(feature.id, null);
    expect(features.get(feature.id)?.integrationTarget).toBeNull();
  });
});
