import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialPhases, type Feature, type IntegrationStage } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { AttentionRepo, FeatureRepo, ProjectRepo } from '../db/repos.js';
import { MergeQueueService, type MergeQueueDeps } from './mergeQueueService.js';

/**
 * US1 (Merge-Fluss): setStage() löst zustandsgekoppelt jede Meldung auf, deren Art nicht mehr
 * zur neuen integration-Stage passt — nicht nur über approveForMerge()/retry().
 */
describe('MergeQueueService.setStage — Stage-Konsistenz der Attention-Items', () => {
  let db: DB;
  let attention: AttentionRepo;
  let features: FeatureRepo;
  let projectId: string;
  let svc: MergeQueueService;
  let feature: Feature;

  // setStage ist privat — für den gezielten Zustands-Test typsicher freilegen.
  const setStage = (stage: IntegrationStage) =>
    (svc as unknown as { setStage(f: Feature, s: IntegrationStage): void }).setStage(feature, stage);

  const openKinds = () => attention.listOpen().map((i) => i.kind).sort();

  beforeEach(() => {
    db = openMemoryDatabase();
    attention = new AttentionRepo(db);
    features = new FeatureRepo(db);
    projectId = new ProjectRepo(db).create({
      name: 'Demo',
      path: '/tmp/demo',
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;
    feature = features.create({
      projectId,
      name: 'demo-feature',
      branch: 'feature/demo',
      worktreePath: null,
      phases: initialPhases([]),
      integration: 'awaiting_human_review',
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });

    svc = new MergeQueueService({
      projects: new ProjectRepo(db),
      features,
      attention,
      queue: {} as unknown,
      executions: {} as unknown,
      settings: {} as unknown,
      worktrees: {} as unknown,
      ptys: {} as unknown,
      reviewGate: {} as unknown,
      dataDir: '/tmp',
    } as unknown as MergeQueueDeps);
  });

  afterEach(() => db.close());

  it('review_due verschwindet, sobald die Stage awaiting_human_review verlässt', () => {
    attention.raise({ kind: 'review_due', projectId, featureId: feature.id, message: 'r' });
    setStage('queued');
    expect(openKinds()).toEqual([]);
  });

  it('review_due bleibt, solange die Stage awaiting_human_review ist', () => {
    attention.raise({ kind: 'review_due', projectId, featureId: feature.id, message: 'r' });
    setStage('awaiting_human_review');
    expect(openKinds()).toEqual(['review_due']);
  });

  it('verify_failed/gate_failed/merge_conflict_escalated werden bei merged alle aufgelöst', () => {
    attention.raise({ kind: 'verify_failed', projectId, featureId: feature.id, message: 'v' });
    attention.raise({ kind: 'gate_failed', projectId, featureId: feature.id, message: 'g' });
    attention.raise({ kind: 'merge_conflict_escalated', projectId, featureId: feature.id, message: 'c' });
    setStage('merged');
    expect(openKinds()).toEqual([]);
  });

  it('lässt Meldungen anderer Features unberührt', () => {
    const other = features.create({
      projectId,
      name: 'other',
      branch: 'feature/other',
      worktreePath: null,
      phases: initialPhases([]),
      integration: 'verify_failed',
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    attention.raise({ kind: 'verify_failed', projectId, featureId: other.id, message: 'v' });
    attention.raise({ kind: 'review_due', projectId, featureId: feature.id, message: 'r' });
    setStage('merged'); // betrifft nur `feature`
    expect(openKinds()).toEqual(['verify_failed']);
  });
});
