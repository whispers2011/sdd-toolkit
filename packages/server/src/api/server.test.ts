import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { ACTION_REASON, BUSY_REASON, initialPhases, phaseRunningReason, type FeaturePhase, type PhaseMap } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import {
  AttentionRepo,
  ExecutionRepo,
  FeatureRepo,
  ProjectRepo,
  QueueRepo,
  ReviewCommentRepo,
  SessionRepo,
  SettingsRepo,
} from '../db/repos.js';
import { buildServer, type ApiDeps } from './server.js';

/**
 * Regressions-Tripwire (FR-005/FR-007/FR-010): stellt sicher, dass echte
 * Kommando-Auslösepunkte über sendPrompt (auto-submit) laufen, die bewussten
 * Einfüge-/Bestätigungs-Pfade (Init, Bild-Pfad) dagegen nur `write` nutzen
 * (kein CR, kein Auto-Submit). Ohne vollständigen App-Aufbau via Quelltext.
 */

const SRC = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

/** Handler-Rumpf einer Route: vom Marker bis zur nächsten `app.<method>(`-Registrierung. */
function routeBody(marker: string): string {
  const start = SRC.indexOf(marker);
  expect(start, `Route-Marker nicht gefunden: ${marker}`).toBeGreaterThanOrEqual(0);
  const rest = SRC.slice(start + marker.length);
  const next = rest.search(/\n {2}app\.(get|post|patch|delete|put)\b/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('server routes — Auto-Submit vs. reine Einfügung', () => {
  it('freier Prompt (/prompt) wird über sendPrompt abgeschickt', () => {
    const body = routeBody("'/api/features/:id/prompt'");
    expect(body).toContain('sendPrompt(session.id, req.body.text)');
  });

  it('init-speckit füllt nur vor (write), submittet nicht', () => {
    const body = routeBody("'/api/projects/:id/init-speckit'");
    expect(body).toContain('deps.ptys.write(');
    expect(body).not.toContain('sendPrompt');
  });

  it('paste-image fügt nur den Pfad ein (write, Bracketed Paste ohne CR), submittet nicht', () => {
    const body = routeBody("'/api/features/:id/paste-image'");
    expect(body).toContain('deps.ptys.write(');
    expect(body).not.toContain('sendPrompt');
  });
});

// ---------- Aktions-Guards (FR-024) ----------

const ENABLED: FeaturePhase[] = ['specify', 'plan', 'implement'];

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** Git-Repo, dessen HEAD-Branch `withChanges` Commits gegenüber main hat. */
function makeRepo(withChanges: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'sdd-api-repo-'));
  sh(dir, ['init', '-b', 'main']);
  sh(dir, ['config', 'user.email', 'test@test.local']);
  sh(dir, ['config', 'user.name', 'Test']);
  writeFileSync(join(dir, 'app.txt'), 'init\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-m', 'init']);
  sh(dir, ['checkout', '-b', 'feature/demo']);
  if (withChanges) {
    writeFileSync(join(dir, 'feature.txt'), 'arbeit\n');
    sh(dir, ['add', '-A']);
    sh(dir, ['commit', '-m', 'feat: arbeit']);
  }
  return dir;
}

function phasesWith(statuses: Partial<Record<FeaturePhase, PhaseMap[FeaturePhase]['status']>>): PhaseMap {
  const map = initialPhases(ENABLED);
  for (const [phase, status] of Object.entries(statuses) as [FeaturePhase, PhaseMap[FeaturePhase]['status']][]) {
    map[phase] = { ...map[phase], status };
  }
  return map;
}

const ALL_APPROVED = phasesWith({ specify: 'approved', plan: 'approved', implement: 'approved' });

describe('Feature-Routen setzen die Aktions-Policy durch', () => {
  let app: FastifyInstance;
  let db: DB;
  let features: FeatureRepo;
  let repo: string;
  let featureId: string;
  let otherId: string;
  let gateRunning = false;
  let sessionState: { kind: string } | null = null;
  let started: string[] = [];
  let retried: string[] = [];
  let approvedMerges: string[] = [];
  let beginResult: { started: boolean; reason?: string } = { started: true };

  beforeEach(async () => {
    repo = makeRepo(true);
    db = openMemoryDatabase();
    const projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    gateRunning = false;
    sessionState = null;
    started = [];
    retried = [];
    approvedMerges = [];
    beginResult = { started: true };

    const projectId = projects.create({
      name: 'Demo',
      path: repo,
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

    const mk = (name: string) =>
      features.create({
        projectId,
        name,
        branch: 'feature/demo',
        worktreePath: repo,
        phases: initialPhases(ENABLED),
        integration: 'none',
        integrationTarget: null,
        automation: {},
        optimization: {},
        tasksDone: 0,
        tasksTotal: 0,
      }).id;
    featureId = mk('demo');
    otherId = mk('zweit');

    app = await buildServer({
      projects,
      features,
      sessions: new SessionRepo(db),
      executions: new ExecutionRepo(db),
      attention: new AttentionRepo(db),
      queue: new QueueRepo(db),
      settings: new SettingsRepo(db),
      reviewComments: new ReviewCommentRepo(db),
      orchestrator: {
        isGateRunning: () => gateRunning,
        startPhaseRun: async (id: string) => {
          started.push(id);
          return { gateRunning: false };
        },
        approve: () => {},
        discard: () => {},
        reconcileOpenAttention: () => {},
      },
      mergeQueue: {
        beginIntegration: async () => beginResult,
        retry: (id: string) => retried.push(id),
        approveForMerge: async (id: string) => approvedMerges.push(id),
        deleteFeature: async () => {},
      },
      ptys: {
        forFeature: (id: string) =>
          id === featureId && sessionState ? { machine: { state: sessionState } } : undefined,
        terminate: async () => {},
        sendPrompt: () => {},
      },
      dataDir: mkdtempSync(join(tmpdir(), 'sdd-api-data-')),
      webDir: null,
    } as unknown as ApiDeps);
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repo, { recursive: true, force: true });
  });

  const post = (url: string, payload?: unknown) => app.inject({ method: 'POST', url, payload: payload ?? undefined });
  const message = (res: { payload: string }) => (JSON.parse(res.payload) as { message?: string }).message;

  // ---------- POST /integrate (US1) ----------

  it('lehnt die Integration eines unfertigen Features ab — mit dem Satz aus der Policy', async () => {
    const res = await post(`/api/features/${featureId}/integrate`);
    expect(res.statusCode).toBe(409);
    expect(message(res)).toBe(ACTION_REASON.notComplete);
    // FR-004: kein Zustandswechsel, kein Aufruf der Pipeline.
    expect(features.get(featureId)?.integration).toBe('none');
  });

  it('lehnt die Integration eines bereits integrierenden Features ab', async () => {
    features.savePhases(featureId, ALL_APPROVED);
    features.setIntegration(featureId, 'verifying');
    const res = await post(`/api/features/${featureId}/integrate`);
    expect(res.statusCode).toBe(409);
    expect(message(res)).toContain('bereits in der Integration');
  });

  it('lehnt die Integration eines änderungsfreien Features ab (FR-027)', async () => {
    const leer = makeRepo(false);
    try {
      features.savePhases(featureId, ALL_APPROVED);
      features.setWorktree(featureId, leer);
      const res = await post(`/api/features/${featureId}/integrate`);
      expect(res.statusCode).toBe(409);
      expect(message(res)).toBe(ACTION_REASON.noChanges);
    } finally {
      rmSync(leer, { recursive: true, force: true });
    }
  });

  it('startet die Integration eines fertigen Features mit Änderungen', async () => {
    features.savePhases(featureId, ALL_APPROVED);
    const res = await post(`/api/features/${featureId}/integrate`);
    expect(res.statusCode).toBe(200);
  });

  it('meldet eine Ablehnung der Pipeline selbst als 409 weiter', async () => {
    features.savePhases(featureId, ALL_APPROVED);
    beginResult = { started: false, reason: ACTION_REASON.noChanges };
    const res = await post(`/api/features/${featureId}/integrate`);
    expect(res.statusCode).toBe(409);
    expect(message(res)).toBe(ACTION_REASON.noChanges);
  });

  it('behandelt die Selbstheilung (kein Grund) nicht als Ablehnung', async () => {
    // Branch bereits gemergt / Worktree defekt: reconcile() hat übernommen und
    // meldet sich über die Inbox — das ist kein 409 für den Bedienenden.
    features.savePhases(featureId, ALL_APPROVED);
    beginResult = { started: false };
    const res = await post(`/api/features/${featureId}/integrate`);
    expect(res.statusCode).toBe(200);
  });

  it('liefert die Integrations-Bereitschaft', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/features/${featureId}/integration-readiness` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ hasChanges: true });
  });

  // ---------- Beschäftigt: jede bewachte Route lehnt ab (US2) ----------

  /** Setzt eine Phase, ohne die übrigen zu überschreiben. */
  const setPhase = (phase: FeaturePhase, status: PhaseMap[FeaturePhase]['status']) => {
    const cur = features.get(featureId)!.phases;
    features.savePhases(featureId, { ...cur, [phase]: { ...cur[phase], status } });
  };

  /** Die vier Arten, auf die ein Feature beschäftigt sein kann (FR-005). */
  const BUSY_SOURCES: [string, () => void, string][] = [
    ['laufender Schritt', () => setPhase('implement', 'running'), phaseRunningReason('implement')],
    ['arbeitende Session', () => void (sessionState = { kind: 'working' }), BUSY_REASON.sessionWorking],
    ['laufendes Gate', () => void (gateRunning = true), BUSY_REASON.gateRunning],
    [
      'aktive Integrationsstufe',
      () => features.setIntegration(featureId, 'merging'),
      'Die Integration läuft — Merge läuft.',
    ],
  ];

  it.each(BUSY_SOURCES)('beschäftigt (%s): Schritt-Routen antworten 409 mit dem Grund', async (_n, busy, reason) => {
    features.savePhases(featureId, phasesWith({ plan: 'awaiting_review' }));
    busy();
    // Starten trifft den offenen Schritt, Freigeben/Verwerfen den wartenden —
    // in beiden Fällen greift der Beschäftigt-Zweig, nicht eine Vorstufe.
    for (const [phase, suffix] of [
      ['specify', 'start'],
      ['plan', 'approve'],
      ['plan', 'discard'],
    ] as const) {
      const res = await post(`/api/features/${featureId}/phases/${phase}/${suffix}`);
      expect(res.statusCode, suffix).toBe(409);
      expect(message(res), suffix).toBe(reason);
    }
    expect(started).toEqual([]);
  });

  it.each(BUSY_SOURCES)('beschäftigt (%s): Integration wird abgelehnt, Aufräumen nicht', async (_n, busy) => {
    features.savePhases(featureId, ALL_APPROVED);
    busy();
    for (const url of [`/api/features/${featureId}/integrate`, `/api/features/${featureId}/approve-merge`]) {
      expect((await post(url)).statusCode, url).toBe(409);
    }
    // Aufräum-Aktionen werden nie gesperrt (FR-017).
    expect((await post(`/api/features/${featureId}/archive`)).statusCode).toBe(200);
  });

  it('beschäftigt: fertiges Feature nennt bei der Integration den Beschäftigt-Satz', async () => {
    features.savePhases(featureId, ALL_APPROVED);
    sessionState = { kind: 'working' };
    const res = await post(`/api/features/${featureId}/integrate`);
    expect(res.statusCode).toBe(409);
    expect(message(res)).toBe(BUSY_REASON.sessionWorking);
  });

  it('beschäftigt: Review-Entscheidungen und Wiederaufnahme werden abgelehnt', async () => {
    sessionState = { kind: 'awaiting_input' };
    features.setIntegration(featureId, 'awaiting_human_review');
    for (const url of ['approve-merge', 'reject-review']) {
      const res = await post(`/api/features/${featureId}/${url}`, { comment: '' });
      expect(res.statusCode, url).toBe(409);
      expect(message(res), url).toBe(BUSY_REASON.sessionAwaitingInput);
    }
    expect(approvedMerges).toEqual([]);

    features.setIntegration(featureId, 'verify_failed');
    const retry = await post(`/api/features/${featureId}/retry-integration`);
    expect(retry.statusCode).toBe(409);
    expect(retried).toEqual([]);
  });

  it('Wiederaufnahme ohne fehlgeschlagene Integration wird abgelehnt', async () => {
    const res = await post(`/api/features/${featureId}/retry-integration`);
    expect(res.statusCode).toBe(409);
    expect(message(res)).toBe(ACTION_REASON.noFailedIntegration);
  });

  it('Freigabe ohne wartendes Review wird abgelehnt', async () => {
    const res = await post(`/api/features/${featureId}/approve-merge`);
    expect(res.statusCode).toBe(409);
    expect(message(res)).toBe(ACTION_REASON.notAwaitingReview);
  });

  // ---------- FR-011: Features beeinflussen sich nicht ----------

  it('ein beschäftigtes Feature A blockiert die Routen von Feature B nicht', async () => {
    features.savePhases(featureId, phasesWith({ implement: 'running' }));
    sessionState = { kind: 'working' };

    const blockedRes = await post(`/api/features/${featureId}/phases/specify/start`);
    expect(blockedRes.statusCode).toBe(409);

    const okRes = await post(`/api/features/${otherId}/phases/specify/start`);
    expect(okRes.statusCode).toBe(200);
    expect(started).toEqual([otherId]);
  });

  // ---------- US3: entfernte Abkürzungen ----------

  it('„Als abgeschlossen markieren" und „advance" existieren nicht mehr (FR-016/FR-029)', async () => {
    expect((await post(`/api/features/${featureId}/mark-done`)).statusCode).toBe(404);
    expect((await post(`/api/features/${featureId}/advance`, { to: 'implement' })).statusCode).toBe(404);
    expect(features.get(featureId)?.integration).toBe('none');
  });

  // ---------- US3: Zurückweisung im Review ----------

  it('reject-review setzt zurück, merkt die Zurückweisung und startet nichts (FR-020/FR-021/FR-026)', async () => {
    features.savePhases(featureId, ALL_APPROVED);
    features.setIntegration(featureId, 'awaiting_human_review');
    features.setIntegrationTarget(featureId, 'integration/alt');
    // Auto-Verify aktiv: es darf trotzdem keine Integration anspringen.
    features.setAutomation(featureId, { autoVerify: true, autoMerge: true });

    const res = await post(`/api/features/${featureId}/reject-review`, { comment: '' });
    expect(res.statusCode).toBe(200);

    const fresh = features.get(featureId)!;
    expect(fresh.integration).toBe('none');
    expect(fresh.integrationTarget).toBeNull();
    expect(fresh.phases.implement.status).toBe('awaiting_review');
    expect(fresh.phases.plan.status).toBe('approved');
    expect(fresh.reviewRejectedAt).toBeGreaterThan(0);
  });

  it('die erneute Freigabe des letzten Schritts löscht die Zurückweisung', async () => {
    features.savePhases(featureId, ALL_APPROVED);
    features.setIntegration(featureId, 'awaiting_human_review');
    await post(`/api/features/${featureId}/reject-review`, { comment: '' });
    expect(features.get(featureId)?.reviewRejectedAt).not.toBeNull();

    const res = await post(`/api/features/${featureId}/phases/implement/approve`);
    expect(res.statusCode).toBe(200);
    expect(features.get(featureId)?.reviewRejectedAt).toBeNull();
  });

  it('die Freigabe eines früheren Schritts lässt die Zurückweisung stehen', async () => {
    features.savePhases(featureId, ALL_APPROVED);
    features.setIntegration(featureId, 'awaiting_human_review');
    await post(`/api/features/${featureId}/reject-review`, { comment: '' });
    features.savePhases(featureId, phasesWith({ specify: 'awaiting_review' }));

    const res = await post(`/api/features/${featureId}/phases/specify/approve`);
    expect(res.statusCode).toBe(200);
    expect(features.get(featureId)?.reviewRejectedAt).not.toBeNull();
  });
});
