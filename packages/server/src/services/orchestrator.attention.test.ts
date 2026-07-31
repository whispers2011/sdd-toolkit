import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialPhases, type IntegrationStage, type SessionState } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import {
  AttentionRepo,
  ExecutionRepo,
  FeatureRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
} from '../db/repos.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import type { KnowledgeService } from './knowledgeService.js';
import { Orchestrator } from './orchestrator.js';
import { RunMeter } from './core/runMeter.js';

/**
 * Service-Tests der zustandsgekoppelten Attention-Bereinigung (US1/US2/US4).
 * Der Reconciler-Kern ist in attentionReconciler.test.ts abgedeckt; hier geht es um die
 * Verdrahtung in Orchestrator.reconcileOpenAttention()/reapOnBoot() gegen echte Repos + DB.
 */
describe('Orchestrator — Attention-Reconcile', () => {
  let db: DB;
  let dataDir: string;
  let attention: AttentionRepo;
  let features: FeatureRepo;
  let projectId: string;
  let liveSessions: LiveSession[];
  let orch: Orchestrator;

  const session = (over: {
    id: string;
    state: SessionState;
    featureId?: string | null;
    conversationId?: string | null;
    exited?: boolean;
  }): LiveSession =>
    ({
      id: over.id,
      featureId: over.featureId ?? null,
      conversationId: over.conversationId ?? null,
      exited: over.exited ?? false,
      machine: { state: over.state },
    }) as unknown as LiveSession;

  const feature = (integration: IntegrationStage): string =>
    features.create({
      projectId,
      name: `f-${integration}-${Math.floor(features.listAll().length)}`,
      branch: 'feature/x',
      worktreePath: null,
      phases: initialPhases([]),
      integration,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;

  const openIds = () => attention.listOpen().map((i) => i.id).sort();

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-orch-att-'));
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
    liveSessions = [];

    orch = new Orchestrator({
      projects: new ProjectRepo(db),
      features,
      sessions: new SessionRepo(db),
      executions: new ExecutionRepo(db),
      meter: new RunMeter({ executions: new ExecutionRepo(db) }),
      attention,
      settings: new SettingsRepo(db),
      worktrees: {} as unknown as WorktreeManager,
      ptys: { list: () => liveSessions } as unknown as PtySessionManager,
      knowledge: {} as unknown as KnowledgeService,
      dataDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // ---------- US1: Laufzeit-Reconcile ----------

  it('US1-1: awaiting_input wird stale, sobald die Session wieder arbeitet', () => {
    const it = attention.raise({ kind: 'awaiting_input', projectId, featureId: 'f1', sessionId: 's1', message: 'q' });
    liveSessions = [session({ id: 's1', featureId: 'f1', state: { kind: 'working' } })];
    orch.reconcileOpenAttention();
    expect(attention.get(it.id)?.resolvedAt).not.toBeNull();
  });

  it('US1-1: awaiting_input bleibt, solange die Session wartet', () => {
    const it = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'q' });
    liveSessions = [session({ id: 's1', state: { kind: 'awaiting_input', awaiting: 'question' } })];
    orch.reconcileOpenAttention();
    expect(attention.get(it.id)?.resolvedAt).toBeNull();
  });

  it('US1-2: awaiting_input wird stale, wenn die Session nicht mehr existiert', () => {
    const it = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 'gone', message: 'q' });
    liveSessions = [];
    orch.reconcileOpenAttention();
    expect(attention.get(it.id)?.resolvedAt).not.toBeNull();
  });

  it('US1-6: agent_errored wird stale, sobald eine Feature-Session wieder arbeitet', () => {
    const it = attention.raise({ kind: 'agent_errored', projectId, featureId: 'f1', sessionId: 'sOLD', message: 'boom' });
    liveSessions = [session({ id: 'sNEW', featureId: 'f1', state: { kind: 'working' } })];
    orch.reconcileOpenAttention();
    expect(attention.get(it.id)?.resolvedAt).not.toBeNull();
  });

  it('US1-6: agent_errored bleibt, solange keine Feature-Session arbeitet', () => {
    const it = attention.raise({ kind: 'agent_errored', projectId, featureId: 'f1', message: 'boom' });
    liveSessions = [];
    orch.reconcileOpenAttention();
    expect(attention.get(it.id)?.resolvedAt).toBeNull();
  });

  it('US1-3/1-5: Merge-Arten werden stale, wenn die integration-Stage weiterwandert', () => {
    const fMerged = feature('merged');
    const review = attention.raise({ kind: 'review_due', projectId, featureId: fMerged, message: 'r' });
    orch.reconcileOpenAttention();
    expect(attention.get(review.id)?.resolvedAt).not.toBeNull();
  });

  it('US1-3: Merge-Art bleibt, solange die Stage passt', () => {
    const fReview = feature('awaiting_human_review');
    const review = attention.raise({ kind: 'review_due', projectId, featureId: fReview, message: 'r' });
    orch.reconcileOpenAttention();
    expect(attention.get(review.id)?.resolvedAt).toBeNull();
  });

  it('US1-7/INV-3: nur die betroffene Meldung wird aufgelöst, gültige bleiben', () => {
    const fReview = feature('awaiting_human_review');
    const stale = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 'gone', message: 'q' });
    const valid = attention.raise({ kind: 'review_due', projectId, featureId: fReview, message: 'r' });
    liveSessions = [];
    orch.reconcileOpenAttention();
    expect(openIds()).toEqual([valid.id]);
    expect(attention.get(stale.id)?.resolvedAt).not.toBeNull();
  });

  it('INV-2: reconcileOpenAttention ist idempotent', () => {
    const fMerged = feature('merged');
    attention.raise({ kind: 'review_due', projectId, featureId: fMerged, message: 'r' });
    attention.raise({ kind: 'awaiting_input', projectId, featureId: fMerged, sessionId: 'x', message: 'q' });
    orch.reconcileOpenAttention();
    const first = openIds();
    orch.reconcileOpenAttention();
    expect(openIds()).toEqual(first);
  });

  // ---------- US2: Boot-Reconcile ----------

  it('US2-1/SC-003: reapOnBoot löst Session-Arten und stage-inkonsistente Merge-Arten auf', () => {
    const fReview = feature('awaiting_human_review');
    const fMerged = feature('merged');
    const awaiting = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'q' });
    const errored = attention.raise({ kind: 'agent_errored', projectId, featureId: fReview, message: 'boom' });
    const reviewKept = attention.raise({ kind: 'review_due', projectId, featureId: fReview, message: 'r' });
    const verifyStale = attention.raise({ kind: 'verify_failed', projectId, featureId: fMerged, message: 'v' });

    orch.reapOnBoot();

    expect(attention.get(awaiting.id)?.resolvedAt).not.toBeNull();
    expect(attention.get(errored.id)?.resolvedAt).not.toBeNull();
    expect(attention.get(verifyStale.id)?.resolvedAt).not.toBeNull();
    expect(attention.get(reviewKept.id)?.resolvedAt).toBeNull();
    expect(openIds()).toEqual([reviewKept.id]);
  });

  it('INV-2: zweiter Boot ändert nichts', () => {
    const fReview = feature('awaiting_human_review');
    attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'q' });
    attention.raise({ kind: 'review_due', projectId, featureId: fReview, message: 'r' });
    orch.reapOnBoot();
    const first = openIds();
    orch.reapOnBoot();
    expect(openIds()).toEqual(first);
  });

  // ---------- US4: Manuelles Erledigen bleibt möglich ----------

  it('US4/FR-014: manuelles resolve setzt resolvedAt; Reconcile legt nichts neu an', () => {
    const it = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'q' });
    // Meldung wäre gültig (Session wartet) — der Nutzer erledigt trotzdem manuell.
    liveSessions = [session({ id: 's1', state: { kind: 'awaiting_input', awaiting: 'question' } })];
    attention.resolve(it.id);
    expect(attention.get(it.id)?.resolvedAt).not.toBeNull();

    const before = (db.prepare('SELECT COUNT(*) AS n FROM attention').get() as { n: number }).n;
    orch.reconcileOpenAttention();
    orch.reapOnBoot();
    const after = (db.prepare('SELECT COUNT(*) AS n FROM attention').get() as { n: number }).n;

    expect(after).toBe(before); // Reconcile löst nur auf, legt nie neu an (Contract C1)
    expect(openIds()).toEqual([]);
  });

  it('FR-013/INV-4: derselbe Zustand nach Auflösung erzeugt ein neues Item mit neuer ID', () => {
    const first = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'q' });
    attention.resolve(first.id);
    const second = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'q' });
    expect(second.id).not.toBe(first.id);
    expect(openIds()).toEqual([second.id]);
  });
});
