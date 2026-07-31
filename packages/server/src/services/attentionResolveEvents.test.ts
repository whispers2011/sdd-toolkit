import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { initialPhases, type Feature, type IntegrationStage, type Project, type SessionState } from '@sdd/shared';
import { buildAllowedOrigins } from '../api/originGuard.js';
import { buildServer, type ApiDeps } from '../api/server.js';
import { openMemoryDatabase, type DB } from '../db/database.js';
import {
  AttentionRepo,
  ChatRepo,
  ExecutionRepo,
  FeatureRepo,
  ProjectRepo,
  QueueRepo,
  ReviewCommentRepo,
  SessionRepo,
  SettingsRepo,
} from '../db/repos.js';
import { bus } from '../events.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import { ChatWorkService } from './chatWorkService.js';
import { RunMeter } from './core/runMeter.js';
import type { KnowledgeService } from './knowledgeService.js';
import { MergeQueueService, type MergeQueueDeps } from './mergeQueueService.js';
import { Orchestrator } from './orchestrator.js';

/**
 * Ereignis-Vertrag der Auflösung (FR-001/FR-002/FR-003/FR-006/FR-011, SC-006, V5–V7).
 *
 * Geprüft wird am echten Modul-Bus — er ist ein Singleton, den die Services direkt importieren,
 * also ist ein Abonnement der einzige Weg, das tatsächlich gesendete Nutzdatum zu sehen (D9).
 * Abmelden in `afterEach` ist Pflicht, sonst summieren sich die Listener über die Datei.
 *
 * Zwei Zusicherungen laufen durch jeden Fall:
 *   - genau `|betroffene Meldungen|` Ereignisse (V5)
 *   - jedes Nutzdatum ist eine `id` aus der `attention`-Tabelle — keine Feature-, Session- oder
 *     Conversation-Kennung (V6). Genau hier schlägt Ursache B auf.
 */

/** Aufgezeichnete Nutzdaten der laufenden Prüfung. */
let seen: string[] = [];
const listener = (id: string): void => {
  seen.push(id);
};

beforeEach(() => {
  seen = [];
  bus.onEvent('attention_resolved', listener);
});

afterEach(() => {
  bus.off('attention_resolved', listener as (...args: unknown[]) => void);
});

function makeProject(db: DB): string {
  return new ProjectRepo(db).create({
    name: 'Demo',
    path: '/tmp/demo',
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
}

/** Alle je in der DB angelegten Item-IDs — Bezugsmenge für V6. */
function allAttentionIds(db: DB): Set<string> {
  return new Set((db.prepare('SELECT id FROM attention').all() as { id: string }[]).map((r) => r.id));
}

describe('MergeQueueService — Auflösewege senden pro Meldung genau ein Ereignis', () => {
  let db: DB;
  let attention: AttentionRepo;
  let features: FeatureRepo;
  let projects: ProjectRepo;
  let projectId: string;
  let feature: Feature;
  let svc: MergeQueueService;

  const setStage = (stage: IntegrationStage): void =>
    (svc as unknown as { setStage(f: Feature, s: IntegrationStage): void }).setStage(feature, stage);

  const finalizeMerged = (project: Project): Promise<void> =>
    (svc as unknown as { finalizeMerged(f: Feature, p: Project): Promise<void> }).finalizeMerged(feature, project);

  beforeEach(() => {
    db = openMemoryDatabase();
    attention = new AttentionRepo(db);
    features = new FeatureRepo(db);
    projects = new ProjectRepo(db);
    projectId = makeProject(db);
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
      projects,
      features,
      attention,
      // Die Queue läuft im Test leer: `head()` liefert nichts, der Worker endet sofort.
      queue: { listByProject: () => [], enqueue: vi.fn(), head: () => undefined, remove: vi.fn() },
      executions: {} as unknown,
      settings: { getAutomation: () => ({}) },
      worktrees: { remove: async () => {} },
      ptys: { forFeature: () => undefined, snapshots: { remove: vi.fn() } },
      reviewGate: {} as unknown,
      // Lebenszyklus-Schritte (F1b) sind hier nicht Gegenstand: kein Schritt konfiguriert, damit
      // der Stufen-Auslöser sofort durchlässt. Ohne dieses Double schlägt der Zugriff auf
      // `hasStepsFor` fehl — aufgefallen bei der Zusammenführung von F1b und F5 am 30.07.2026.
      lifecycleSteps: { hasStepsFor: () => false, runTrigger: async () => ({ ok: true }) },
      dataDir: '/tmp',
    } as unknown as MergeQueueDeps);
    // Der Merge-Engine-Aufruf im Cleanup würde echtes git anfassen.
    (svc as unknown as { engine: unknown }).engine = { deleteBranch: async () => {} };
  });

  afterEach(() => db.close());

  it('Weg #2 approveForMerge: eine offene review_due → ein Ereignis mit deren Item-ID (US1-AS1)', async () => {
    const item = attention.raise({ kind: 'review_due', projectId, featureId: feature.id, message: 'r' });

    await svc.approveForMerge(feature.id);

    expect(seen).toEqual([item.id]);
    // Kein Nutzdatum, das eine Feature-Kennung ist (FR-003).
    expect(seen).not.toContain(feature.id);
  });

  it('Weg #2 approveForMerge ohne offene Meldung: kein Ereignis, kein Fehler (V7, FR-006, US2-AS7)', async () => {
    await expect(svc.approveForMerge(feature.id)).resolves.toBeUndefined();

    expect(seen).toEqual([]);
  });

  it('Weg #3 retry: zwei offene Meldungen → zwei Ereignisse mit je einer Item-ID (US2-AS1/AS6)', () => {
    features.setIntegration(feature.id, 'verify_failed');
    const verify = attention.raise({ kind: 'verify_failed', projectId, featureId: feature.id, message: 'v' });
    const gate = attention.raise({ kind: 'gate_failed', projectId, featureId: feature.id, message: 'g' });

    svc.retry(feature.id);

    expect(seen.slice(0, 2).sort()).toEqual([verify.id, gate.id].sort());
    expect(seen).toHaveLength(2);
  });

  it('Weg #3 retry ohne offene Meldung: kein Ereignis (V7)', () => {
    svc.retry(feature.id);

    expect(seen).toEqual([]);
  });

  it('Weg #4 finalizeMerged: alle Merge-Fluss-Meldungen → je ein Ereignis (US1-AS2)', async () => {
    const verify = attention.raise({ kind: 'verify_failed', projectId, featureId: feature.id, message: 'v' });
    const review = attention.raise({ kind: 'review_due', projectId, featureId: feature.id, message: 'r' });

    await finalizeMerged(projects.get(projectId)!);

    expect(seen.sort()).toEqual([verify.id, review.id].sort());
  });

  it('Weg #5 setStage: löst die stage-fremde Meldung mit ihrer Item-ID auf', () => {
    const review = attention.raise({ kind: 'review_due', projectId, featureId: feature.id, message: 'r' });

    setStage('queued');

    expect(seen).toEqual([review.id]);
  });

  it('Weg #5 setStage sendet kein zweites Ereignis für eine bereits aufgelöste Meldung (C3)', () => {
    attention.raise({ kind: 'review_due', projectId, featureId: feature.id, message: 'r' });

    setStage('queued');
    const nachErstem = seen.length;
    setStage('merging');

    expect(nachErstem).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('jedes Nutzdatum ist eine ID aus der attention-Tabelle (V6, FR-003)', async () => {
    attention.raise({ kind: 'review_due', projectId, featureId: feature.id, message: 'r' });

    await svc.approveForMerge(feature.id);

    const ids = allAttentionIds(db);
    expect(seen.length).toBeGreaterThan(0);
    for (const payload of seen) expect(ids).toContain(payload);
  });
});

describe('Orchestrator — Auflösewege senden pro Meldung genau ein Ereignis', () => {
  let db: DB;
  let dataDir: string;
  let attention: AttentionRepo;
  let features: FeatureRepo;
  let sessions: SessionRepo;
  let projectId: string;
  let liveSessions: LiveSession[];
  let orch: Orchestrator;

  const resolveGateAttention = (featureId: string): void =>
    (orch as unknown as { resolveGateAttention(id: string): void }).resolveGateAttention(featureId);

  const liveSession = (over: { id: string; state: SessionState; featureId?: string | null }): LiveSession =>
    ({
      id: over.id,
      featureId: over.featureId ?? null,
      conversationId: null,
      projectId,
      exited: false,
      lastActiveAt: Date.now(),
      machine: { state: over.state },
    }) as unknown as LiveSession;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-att-events-'));
    db = openMemoryDatabase();
    attention = new AttentionRepo(db);
    features = new FeatureRepo(db);
    sessions = new SessionRepo(db);
    projectId = makeProject(db);
    liveSessions = [];

    orch = new Orchestrator({
      projects: new ProjectRepo(db),
      features,
      sessions,
      executions: new ExecutionRepo(db),
      meter: new RunMeter({ executions: new ExecutionRepo(db) }),
      attention,
      settings: new SettingsRepo(db),
      worktrees: {} as unknown as WorktreeManager,
      ptys: { list: () => liveSessions, remove: vi.fn() } as unknown as PtySessionManager,
      knowledge: {} as unknown as KnowledgeService,
      dataDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('Weg #6 resolveGateAttention: ein Ereignis mit der Item-ID, NICHT mit der featureId (US2-AS2, FR-003)', () => {
    const featureId = features.create({
      projectId,
      name: 'gate-feature',
      branch: 'feature/gate',
      worktreePath: null,
      phases: initialPhases([]),
      integration: 'none',
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;
    const item = attention.raise({ kind: 'approval_required', projectId, featureId, message: 'a' });

    resolveGateAttention(featureId);

    expect(seen).toEqual([item.id]);
    // Das war Ursache B: hier stand früher die featureId im Nutzdatum.
    expect(seen).not.toContain(featureId);
  });

  it('Weg #6 resolveGateAttention löst beide Gate-Arten je einzeln auf (FR-002)', () => {
    const featureId = features.create({
      projectId,
      name: 'gate-zwei',
      branch: 'feature/gate2',
      worktreePath: null,
      phases: initialPhases([]),
      integration: 'none',
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;
    const gate = attention.raise({ kind: 'phase_gate_failed', projectId, featureId, message: 'g' });
    const approval = attention.raise({ kind: 'approval_required', projectId, featureId, message: 'a' });

    resolveGateAttention(featureId);

    expect(seen.sort()).toEqual([gate.id, approval.id].sort());
  });

  it('Weg #6 resolveGateAttention ohne offene Meldung: kein Ereignis (V7, FR-006)', () => {
    resolveGateAttention('feature-ohne-meldung');

    expect(seen).toEqual([]);
  });

  it('Weg #7 handleStatusChange(working): Ereignis mit der Item-ID, NICHT mit der session.id (US2-AS3)', () => {
    const item = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'q' });
    const session = liveSession({ id: 's1', state: { kind: 'working' } });
    liveSessions = [session];

    orch.handleStatusChange(session, []);

    expect(seen).toEqual([item.id]);
    expect(seen).not.toContain('s1');
  });

  it('Weg #7 handleStatusChange löst awaiting_input und permission_request je einzeln auf (FR-002)', () => {
    const frage = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'q' });
    const erlaubnis = attention.raise({ kind: 'permission_request', projectId, sessionId: 's1', message: 'p' });
    const session = liveSession({ id: 's1', state: { kind: 'working' } });
    liveSessions = [session];

    orch.handleStatusChange(session, []);

    expect(seen.sort()).toEqual([frage.id, erlaubnis.id].sort());
  });

  it('Weg #8 handleExit: Ereignis mit der Item-ID, NICHT mit der session.id (US2-AS4)', () => {
    sessions.create({ id: 's2', projectId, featureId: null, conversationId: null, kind: 'feature', pid: null });
    const item = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's2', message: 'q' });

    orch.handleExit(liveSession({ id: 's2', state: { kind: 'idle' } }), 0);

    expect(seen).toEqual([item.id]);
    expect(seen).not.toContain('s2');
  });

  it('Weg #11 reconcileOpenAttention: pro aufgeräumter Meldung genau ein Ereignis mit deren ID', () => {
    const item = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 'weg', message: 'q' });
    liveSessions = []; // Session existiert nicht mehr → Meldung ist überholt

    orch.reconcileOpenAttention();

    expect(seen).toEqual([item.id]);
  });

  it('Weg #11 reconcileOpenAttention sendet beim zweiten Lauf nichts mehr (C3, Idempotenz)', () => {
    attention.raise({ kind: 'awaiting_input', projectId, sessionId: 'weg', message: 'q' });

    orch.reconcileOpenAttention();
    const nachErstem = seen.length;
    orch.reconcileOpenAttention();

    expect(nachErstem).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('Weg #11 reconcileOpenAttention ohne überholte Meldung: kein Ereignis (V7)', () => {
    attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'q' });
    liveSessions = [liveSession({ id: 's1', state: { kind: 'awaiting_input', awaiting: 'question' } })];

    orch.reconcileOpenAttention();

    expect(seen).toEqual([]);
  });

  it('Weg #12 reapOnBoot: pro aufgeräumter Meldung genau ein Ereignis mit deren ID', () => {
    const item = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 'alt', message: 'q' });

    orch.reapOnBoot();

    expect(seen).toEqual([item.id]);
  });

  it('jedes Nutzdatum ist eine ID aus der attention-Tabelle (V6, FR-003)', () => {
    attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'q' });
    const session = liveSession({ id: 's1', state: { kind: 'working' } });
    liveSessions = [session];

    orch.handleStatusChange(session, []);

    const ids = allAttentionIds(db);
    expect(seen.length).toBeGreaterThan(0);
    for (const payload of seen) expect(ids).toContain(payload);
  });
});

describe('ChatWorkService — der Chat-Pfad verhält sich identisch zum Feature-Pfad (US2-AS5)', () => {
  let db: DB;
  let dataDir: string;
  let attention: AttentionRepo;
  let sessions: SessionRepo;
  let projectId: string;
  let conversationId: string;
  let svc: ChatWorkService;

  const liveSession = (over: { id: string; state: SessionState }): LiveSession =>
    ({
      id: over.id,
      featureId: null,
      conversationId,
      projectId,
      exited: false,
      lastActiveAt: Date.now(),
      kind: 'chat_work',
      // Der Chat öffnet sein Turn-Fenster jetzt beim working-Übergang; der Kern
      // fotografiert dabei die Scrollback-Länge.
      scrollback: '',
      machine: { state: over.state },
    }) as unknown as LiveSession;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-att-chat-'));
    db = openMemoryDatabase();
    attention = new AttentionRepo(db);
    sessions = new SessionRepo(db);
    projectId = makeProject(db);
    conversationId = new ChatRepo(db).ensureActive(projectId, 'work').id;

    svc = new ChatWorkService({
      projects: new ProjectRepo(db),
      chatRepo: new ChatRepo(db),
      sessions,
      attention,
      executions: new ExecutionRepo(db),
      meter: new RunMeter({ executions: new ExecutionRepo(db) }),
      settings: new SettingsRepo(db),
      worktrees: {} as unknown as WorktreeManager,
      ptys: { remove: vi.fn() } as unknown as PtySessionManager,
      orchestrator: { reconcileOpenAttention: () => {} } as unknown as Orchestrator,
      dataDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('Weg #9 handleStatusChange(working): Ereignis mit der Item-ID, NICHT mit der session.id', () => {
    const item = attention.raise({
      kind: 'awaiting_input',
      projectId,
      sessionId: 'c1',
      conversationId,
      message: 'Chat fragt',
    });

    svc.handleStatusChange(liveSession({ id: 'c1', state: { kind: 'working' } }), []);

    expect(seen).toEqual([item.id]);
    expect(seen).not.toContain('c1');
    expect(seen).not.toContain(conversationId);
  });

  it('Weg #9 handleStatusChange ohne offene Meldung: kein Ereignis (V7)', () => {
    svc.handleStatusChange(liveSession({ id: 'c1', state: { kind: 'working' } }), []);

    expect(seen).toEqual([]);
  });

  it('Weg #10 handleExit: Ereignis mit der Item-ID, NICHT mit der session.id', () => {
    const item = attention.raise({
      kind: 'awaiting_input',
      projectId,
      sessionId: 'c2',
      conversationId,
      message: 'Chat fragt',
    });

    svc.handleExit(liveSession({ id: 'c2', state: { kind: 'idle' } }), 0);

    expect(seen).toEqual([item.id]);
    expect(seen).not.toContain('c2');
  });
});

describe('API — die beiden HTTP-Auflösewege', () => {
  let db: DB;
  let dataDir: string;
  let attention: AttentionRepo;
  let features: FeatureRepo;
  let projectId: string;
  let featureId: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-att-api-'));
    db = openMemoryDatabase();
    attention = new AttentionRepo(db);
    features = new FeatureRepo(db);
    projectId = makeProject(db);
    featureId = features.create({
      projectId,
      name: 'review-feature',
      branch: 'feature/review',
      worktreePath: '/tmp/demo-wt',
      phases: initialPhases(['specify']),
      integration: 'awaiting_human_review',
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;

    app = await buildServer({
      allowedOrigins: buildAllowedOrigins([80]),
      projects: new ProjectRepo(db),
      features,
      sessions: new SessionRepo(db),
      executions: new ExecutionRepo(db),
      attention,
      queue: new QueueRepo(db),
      settings: new SettingsRepo(db),
      reviewComments: new ReviewCommentRepo(db),
      orchestrator: { reconcileOpenAttention: () => {}, isGateRunning: () => false },
      mergeQueue: {},
      ptys: { forFeature: () => undefined, sendPrompt: () => {} },
      // Stack-Profile werden in diesen Tests nicht bedient — der Guard fragt nur,
      // ob ein Profil betrieben wird (kein Projekt hier hat einen Stack).
      stackService: { isRunning: () => false },
      testingLane: { confirm: async () => {}, reject: async () => {} },
      portBlockSize: 20,
      dataDir,
      webDir: null,
      port: 4899,
    } as unknown as ApiDeps);
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const post = (url: string) => app.inject({ method: 'POST', url });

  it('Weg #1 reject-review: ein Ereignis mit der Item-ID der review_due (US1-AS3)', async () => {
    const item = attention.raise({ kind: 'review_due', projectId, featureId, message: 'r' });

    const res = await post(`/api/features/${featureId}/reject-review`);

    expect(res.statusCode).toBe(200);
    expect(seen).toEqual([item.id]);
    expect(seen).not.toContain(featureId);
  });

  it('Weg #1 reject-review ohne offene Meldung: kein Ereignis, kein Fehler (V7, FR-006)', async () => {
    const res = await post(`/api/features/${featureId}/reject-review`);

    expect(res.statusCode).toBe(200);
    expect(seen).toEqual([]);
  });

  it('Weg #13 manuelles Wegklicken: ein Ereignis mit genau dieser Item-ID (FR-007)', async () => {
    const item = attention.raise({ kind: 'review_due', projectId, featureId, message: 'r' });

    const res = await post(`/api/attention/${item.id}/resolve`);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true });
    expect(seen).toEqual([item.id]);
  });

  it('Weg #13 bereits erledigte Meldung: Antwort unverändert ok, aber KEIN zweites Ereignis (D7, C3)', async () => {
    const item = attention.raise({ kind: 'review_due', projectId, featureId, message: 'r' });
    attention.resolve(item.id);

    const res = await post(`/api/attention/${item.id}/resolve`);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true });
    expect(seen).toEqual([]);
  });

  it('Weg #13 unbekannte Kennung: Antwort ok, kein Ereignis (Edge Case „nie angezeigte Meldung")', async () => {
    const res = await post('/api/attention/gibt-es-nicht/resolve');

    expect(res.statusCode).toBe(200);
    expect(seen).toEqual([]);
  });
});
