import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACTION_REASON,
  BUSY_REASON,
  initialPhases,
  phaseRunningReason,
  type FeaturePhase,
} from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { FeatureRepo, ProjectRepo } from '../db/repos.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import type { Orchestrator } from './orchestrator.js';
import { ActionGuard, ActionNotAllowedError, FeatureNotFoundError } from './actionGuard.js';

const ENABLED: FeaturePhase[] = ['specify', 'plan', 'implement'];

describe('ActionGuard', () => {
  let db: DB;
  let features: FeatureRepo;
  let featureId: string;
  let sessionState: { kind: string } | null;
  let gateRunning: boolean;
  let guard: ActionGuard;

  beforeEach(() => {
    db = openMemoryDatabase();
    const projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    const projectId = projects.create({
      name: 'Demo',
      path: '/tmp/demo',
      defaultBranch: 'main',
      color: null,
      enabledPhases: ENABLED,
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;
    featureId = features.create({
      projectId,
      name: 'demo',
      branch: 'feature/demo',
      worktreePath: '/tmp/demo-wt',
      phases: initialPhases(ENABLED),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;

    sessionState = null;
    gateRunning = false;
    guard = new ActionGuard({
      features,
      ptys: {
        forFeature: (id: string) =>
          id === featureId && sessionState ? { machine: { state: sessionState } } : undefined,
      } as unknown as PtySessionManager,
      orchestrator: { isGateRunning: (id: string) => gateRunning && id === featureId } as unknown as Orchestrator,
    });
  });

  afterEach(() => db.close());

  // ---------- Kontextaufbau ----------

  it('baut den Kontext aus Feature-Repo, PTY-Manager und Orchestrator', () => {
    sessionState = { kind: 'awaiting_input' };
    gateRunning = true;
    const ctx = guard.buildContext(featureId);
    expect(ctx.integration).toBe('none');
    expect(ctx.archived).toBe(false);
    expect(ctx.hasWorktree).toBe(true);
    expect(ctx.session).toBe('awaiting_input');
    expect(ctx.gateRunning).toBe(true);
    expect(Object.keys(ctx.phases)).toEqual(ENABLED);
  });

  it('meldet keine Session, wenn keine lebt, und hasChanges standardmäßig als unbekannt', () => {
    const ctx = guard.buildContext(featureId);
    expect(ctx.session).toBeNull();
    expect(ctx.gateRunning).toBe(false);
    expect(ctx.hasChanges).toBe('unknown');
  });

  it('übernimmt einen von der Route ermittelten hasChanges-Wert', () => {
    expect(guard.buildContext(featureId, { hasChanges: false }).hasChanges).toBe(false);
    expect(guard.buildContext(featureId, { hasChanges: true }).hasChanges).toBe(true);
  });

  it('spiegelt Archivierung und fehlenden Worktree', () => {
    features.setWorktree(featureId, null);
    features.archive(featureId);
    const ctx = guard.buildContext(featureId);
    expect(ctx.hasWorktree).toBe(false);
    expect(ctx.archived).toBe(true);
  });

  it('unbekanntes Feature → 404', () => {
    expect(() => guard.buildContext('gibts-nicht')).toThrow(FeatureNotFoundError);
    expect(() => guard.assertAllowed('integrate', 'gibts-nicht')).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  // ---------- Ablehnung mit wortgleichem Grundsatz ----------

  it('lehnt die Integration eines unfertigen Features mit dem Policy-Satz ab', () => {
    expect(() => guard.assertAllowed('integrate', featureId)).toThrow(ActionNotAllowedError);
    expect(() => guard.assertAllowed('integrate', featureId)).toThrow(ACTION_REASON.notComplete);
  });

  it('lehnt mit 409 ab (Fastify übernimmt statusCode)', () => {
    try {
      guard.assertAllowed('integrate', featureId);
      expect.unreachable('assertAllowed hätte werfen müssen');
    } catch (err) {
      expect((err as { statusCode: number }).statusCode).toBe(409);
      expect((err as Error).message).toBe(ACTION_REASON.notComplete);
    }
  });

  it('lehnt bei arbeitender Session mit dem Beschäftigt-Satz ab', () => {
    sessionState = { kind: 'working' };
    expect(() => guard.assertAllowed('phase_start', featureId, { phase: 'specify' })).toThrow(
      BUSY_REASON.sessionWorking,
    );
  });

  it('lehnt bei laufendem Gate mit dem Gate-Satz ab', () => {
    gateRunning = true;
    expect(() => guard.assertAllowed('phase_start', featureId, { phase: 'specify' })).toThrow(
      BUSY_REASON.gateRunning,
    );
  });

  it('lehnt bei laufendem Schritt mit dessen Namen ab', () => {
    const phases = initialPhases(ENABLED);
    phases.implement = { ...phases.implement, status: 'running' };
    features.savePhases(featureId, phases);
    expect(() => guard.assertAllowed('phase_start', featureId, { phase: 'specify' })).toThrow(
      phaseRunningReason('implement'),
    );
  });

  it('lehnt einen änderungsfreien Integrationsstart mit dem FR-027-Satz ab', () => {
    const phases = initialPhases(ENABLED);
    for (const p of ENABLED) phases[p] = { ...phases[p], status: 'approved' };
    features.savePhases(featureId, phases);
    // Ohne ermittelte Änderungslage bleibt der Start erlaubt ('unknown' sperrt nicht).
    expect(() => guard.assertAllowed('integrate', featureId)).not.toThrow();
    expect(() => guard.assertAllowed('integrate', featureId, { hasChanges: false })).toThrow(
      ACTION_REASON.noChanges,
    );
    expect(() => guard.assertAllowed('integrate', featureId, { hasChanges: true })).not.toThrow();
  });

  it('lehnt eine Review-Entscheidung ohne wartendes Review ab', () => {
    expect(() => guard.assertAllowed('review_approve', featureId)).toThrow(ACTION_REASON.notAwaitingReview);
    features.setIntegration(featureId, 'awaiting_human_review');
    expect(() => guard.assertAllowed('review_approve', featureId)).not.toThrow();
    expect(() => guard.assertAllowed('review_reject', featureId)).not.toThrow();
  });

  it('lässt Aufräum-Aktionen auch bei laufender Arbeit durch (FR-017)', () => {
    sessionState = { kind: 'working' };
    expect(() => guard.assertAllowed('archive', featureId)).not.toThrow();
  });

  it('ein beschäftigtes Feature A blockiert Feature B nicht (FR-011)', () => {
    sessionState = { kind: 'working' }; // gilt nur für featureId
    const other = features.create({
      projectId: features.get(featureId)!.projectId,
      name: 'zweit',
      branch: 'feature/zweit',
      worktreePath: '/tmp/zweit-wt',
      phases: initialPhases(ENABLED),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    expect(() => guard.assertAllowed('phase_start', featureId, { phase: 'specify' })).toThrow();
    expect(() => guard.assertAllowed('phase_start', other.id, { phase: 'specify' })).not.toThrow();
  });
});
