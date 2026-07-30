import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import {
  ACTION_REASON,
  BUSY_REASON,
  initialPhases,
  phaseRunningReason,
  type ChatCostProfile,
  type FeaturePhase,
  type PhaseMap,
} from '@sdd/shared';
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
import { TelemetryStore } from '../telemetry/telemetryStore.js';
import { FeatureDocumentsService } from '../services/featureDocuments.js';
import { buildAllowedOrigins } from './originGuard.js';
import { buildServer, type ApiDeps } from './server.js';

/** Fehlermeldung aus einer Antwort ziehen (Fehlerkörper: `{ message }`). */
const message = (res: { payload: string }) => (JSON.parse(res.payload) as { message?: string }).message;

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
  let telemetry: TelemetryStore;
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

    telemetry = new TelemetryStore({ autoSweep: false });
    app = await buildServer({
      allowedOrigins: buildAllowedOrigins([80]),
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
      telemetry,
      dataDir: mkdtempSync(join(tmpdir(), 'sdd-api-data-')),
      webDir: null,
      port: 4899,
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

  // Verschärft am 27.07.2026: Aufräumen wird ebenfalls abgelehnt, solange gearbeitet
  // wird. Es ist destruktiv und traf zuvor uncommittete Arbeit, abgesichert nur durch
  // einen Warnsatz im Bestätigungsdialog.
  it.each(BUSY_SOURCES)('beschäftigt (%s): Integration UND Aufräumen werden abgelehnt', async (_n, busy) => {
    features.savePhases(featureId, ALL_APPROVED);
    busy();
    for (const url of [
      `/api/features/${featureId}/integrate`,
      `/api/features/${featureId}/approve-merge`,
      `/api/features/${featureId}/archive`,
    ]) {
      expect((await post(url)).statusCode, url).toBe(409);
    }
  });

  it('nach Ende der Arbeit ist Aufräumen wieder möglich', async () => {
    features.savePhases(featureId, ALL_APPROVED);
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

/**
 * Zustand der Verbrauchsmessung (FR-019). Der Nutzer muss ohne Rückfrage erkennen
 * können, ob die Telemetrie greift — sonst wäre der Umstieg nicht überprüfbar.
 */
describe('GET /api/telemetry/status', () => {
  let app: FastifyInstance;
  let db: DB;
  let telemetry: TelemetryStore;

  beforeEach(async () => {
    db = openMemoryDatabase();
    telemetry = new TelemetryStore({ autoSweep: false });
    app = await buildServer({
      allowedOrigins: buildAllowedOrigins([80]),
      projects: new ProjectRepo(db),
      features: new FeatureRepo(db),
      sessions: new SessionRepo(db),
      executions: new ExecutionRepo(db),
      attention: new AttentionRepo(db),
      telemetry,
      dataDir: mkdtempSync(join(tmpdir(), 'sdd-telemetry-')),
      webDir: null,
      port: 4899,
    } as unknown as ApiDeps);
  });

  afterEach(async () => {
    await app.close();
    telemetry.stop();
    db.close();
  });

  it('meldet vor der ersten Meldung no_events_yet', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.active).toBe(true);
    expect(body.reason).toBe('no_events_yet');
    expect(body.eventsReceived).toBe(0);
    expect(body.endpoint).toBe('http://127.0.0.1:4899');
  });

  it('meldet nach eingetroffenen Meldungen den Zählerstand ohne Grund', async () => {
    telemetry.ingest([
      {
        requestId: 'req_1',
        at: 1_700_000_000_000,
        sddSessionId: 'sess1',
        sddRunId: null,
        claudeSessionId: 'uuid',
        model: 'claude-opus-5',
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
        costMicros: 100,
        origin: 'main',
      },
    ]);
    const body = (await app.inject({ method: 'GET', url: '/api/telemetry/status' })).json() as Record<string, unknown>;
    expect(body.reason).toBeNull();
    expect(body.eventsReceived).toBe(1);
    expect(body.lastEventAt).toBe(1_700_000_000_000);
  });
});

// ---------- Feature-Dokumente (US1/US3, contracts/feature-documents-api.md) ----------

/** multipart-Body von Hand — die Reihenfolge der Teile ist Teil des Contracts. */
function multipartBody(
  fields: Array<{ name: string; value?: string; filename?: string; content?: string | Buffer; contentType?: string }>,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----sddtestboundary1234';
  const chunks: Buffer[] = [];
  for (const f of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (f.filename !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n` +
            `Content-Type: ${f.contentType ?? 'application/octet-stream'}\r\n\r\n`,
        ),
      );
      chunks.push(typeof f.content === 'string' ? Buffer.from(f.content) : (f.content ?? Buffer.alloc(0)));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${f.name}"\r\n\r\n`));
      chunks.push(Buffer.from(f.value ?? ''));
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('Feature-Dokumente: Routen', () => {
  let app: FastifyInstance;
  let db: DB;
  let repo: string;
  let projects: ProjectRepo;
  let features: FeatureRepo;
  let projectId: string;
  let started: Array<{ featureId: string; phase: string; prompt?: string }>;
  let opened: string[];

  const docsDirOf = (name: string) => join(repo, 'specs', name, 'docs');

  beforeEach(async () => {
    repo = makeRepo(false);
    db = openMemoryDatabase();
    projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    started = [];
    opened = [];

    projectId = projects.create({
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

    app = await buildServer({
      allowedOrigins: buildAllowedOrigins([80]),
      projects,
      features,
      sessions: new SessionRepo(db),
      executions: new ExecutionRepo(db),
      attention: new AttentionRepo(db),
      queue: new QueueRepo(db),
      settings: new SettingsRepo(db),
      reviewComments: new ReviewCommentRepo(db),
      featureDocuments: new FeatureDocumentsService({ projects, features }),
      orchestrator: {
        // Nachbau von Orchestrator.createFeature: gleicher Fehler bei Namenskollision.
        createFeature: async (pid: string, name: string) => {
          if (features.getByName(pid, name)) throw new Error(`Feature '${name}' existiert bereits`);
          return features.create({
            projectId: pid,
            name,
            branch: `feature/${name}`,
            worktreePath: repo,
            phases: initialPhases(ENABLED),
            integration: 'none',
            integrationTarget: null,
            automation: {},
            optimization: {},
            tasksDone: 0,
            tasksTotal: 0,
          });
        },
        startPhaseRun: async (featureId: string, phase: string, prompt?: string) => {
          started.push({ featureId, phase, prompt });
          return { gateRunning: false };
        },
        isGateRunning: () => false,
        approve: () => {},
        discard: () => {},
        reconcileOpenAttention: () => {},
      },
      ptys: { forFeature: () => undefined, terminate: async () => {}, sendPrompt: () => {} },
      telemetry: new TelemetryStore({ autoSweep: false }),
      dataDir: mkdtempSync(join(tmpdir(), 'sdd-docs-api-')),
      webDir: null,
      port: 4899,
      openDocument: (path: string) => opened.push(path),
    } as unknown as ApiDeps);
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(repo, { recursive: true, force: true });
  });

  const upload = (
    pid: string,
    fields: Parameters<typeof multipartBody>[0],
  ) => {
    const { payload, headers } = multipartBody(fields);
    return app.inject({ method: 'POST', url: `/api/projects/${pid}/features/with-documents`, payload, headers });
  };

  // ---------- POST /api/projects/:id/features/with-documents ----------

  it('legt Feature an, hinterlegt die Dokumente und startet den Specify-Lauf', async () => {
    const res = await upload(projectId, [
      { name: 'name', value: 'kundenimport' },
      { name: 'description', value: 'Kundendaten übernehmen' },
      { name: 'files', filename: 'anforderung.md', content: '# Kundennummer', contentType: 'text/markdown' },
      { name: 'files', filename: 'schema.sql', content: 'CREATE TABLE kunde();' },
    ]);

    expect(res.statusCode).toBe(200);
    const body = res.json() as { feature: { id: string; name: string }; documents: unknown[]; rejected: unknown[] };
    expect(body.feature.name).toBe('kundenimport');
    expect(body.rejected).toEqual([]);
    expect(body.documents).toEqual([
      expect.objectContaining({
        name: 'anforderung.md',
        storedName: 'anforderung.md',
        relPath: 'specs/kundenimport/docs/anforderung.md',
        mimeType: 'text/markdown',
      }),
      expect.objectContaining({ name: 'schema.sql', relPath: 'specs/kundenimport/docs/schema.sql' }),
    ]);
    expect(readFileSync(join(docsDirOf('kundenimport'), 'anforderung.md'), 'utf8')).toBe('# Kundennummer');
    // Der Specify-Lauf startet serverseitig, NACH den Dokumenten (R4).
    expect(started).toEqual([
      { featureId: body.feature.id, phase: 'specify', prompt: 'Kundendaten übernehmen' },
    ]);
  });

  it('startet den Specify-Lauf auch ohne Beschreibung (FR-010)', async () => {
    const res = await upload(projectId, [
      { name: 'name', value: 'ohne-text' },
      { name: 'description', value: '' },
      { name: 'files', filename: 'a.txt', content: 'inhalt' },
    ]);

    expect(res.statusCode).toBe(200);
    expect(started).toEqual([{ featureId: expect.any(String), phase: 'specify', prompt: undefined }]);
  });

  it('meldet abgelehnte Dokumente, legt das Feature aber trotzdem an (FR-014)', async () => {
    const res = await upload(projectId, [
      { name: 'name', value: 'grenztest' },
      { name: 'files', filename: 'gut.txt', content: 'da' },
      { name: 'files', filename: 'leer.txt', content: '' },
    ]);

    expect(res.statusCode).toBe(200);
    const body = res.json() as { documents: Array<{ name: string }>; rejected: Array<{ name: string; reason: string }> };
    expect(body.documents.map((d) => d.name)).toEqual(['gut.txt']);
    expect(body.rejected).toEqual([{ name: 'leer.txt', reason: 'leer.txt: leere Datei (0 Byte)' }]);
  });

  it('weist einen leeren Feature-Namen ab (400)', async () => {
    const res = await upload(projectId, [
      { name: 'name', value: '   ' },
      { name: 'files', filename: 'a.txt', content: 'x' },
    ]);

    expect(res.statusCode).toBe(400);
    expect(message(res)).toBe('Feature-Name fehlt');
  });

  it('weist eine Datei vor dem Namen ab (400) — die Reihenfolge trägt FR-015', async () => {
    const res = await upload(projectId, [
      { name: 'files', filename: 'a.txt', content: 'x' },
      { name: 'name', value: 'zu-spaet' },
    ]);

    expect(res.statusCode).toBe(400);
    expect(message(res)).toBe('name muss vor den Dateien gesendet werden');
    expect(features.getByName(projectId, 'zu-spaet')).toBeNull();
  });

  it('weist ein Formular ohne Datei ab (400)', async () => {
    const res = await upload(projectId, [{ name: 'name', value: 'ohne-datei' }]);

    expect(res.statusCode).toBe(400);
    expect(message(res)).toBe('Kein Dokument im Formular');
    expect(features.getByName(projectId, 'ohne-datei')).toBeNull();
  });

  it('weist ein unbekanntes Projekt ab (404)', async () => {
    const res = await upload('gibt-es-nicht', [
      { name: 'name', value: 'egal' },
      { name: 'files', filename: 'a.txt', content: 'x' },
    ]);

    expect(res.statusCode).toBe(404);
    expect(message(res)).toBe('Projekt nicht gefunden');
  });

  // FR-015: scheitert das Anlegen, darf keine Datei und kein docs/-Ordner entstehen.
  it('schreibt nichts, wenn das Feature nicht angelegt werden kann (FR-015)', async () => {
    await upload(projectId, [
      { name: 'name', value: 'kundenimport' },
      { name: 'files', filename: 'erste.txt', content: 'erste Fassung' },
    ]);
    const vorher = readFileSync(join(docsDirOf('kundenimport'), 'documents.json'), 'utf8');

    const res = await upload(projectId, [
      { name: 'name', value: 'kundenimport' },
      { name: 'files', filename: 'zweite.txt', content: 'darf nicht landen' },
    ]);

    expect(res.statusCode).toBe(400);
    expect(message(res)).toBe("Feature 'kundenimport' existiert bereits");
    expect(existsSync(join(docsDirOf('kundenimport'), 'zweite.txt'))).toBe(false);
    expect(readFileSync(join(docsDirOf('kundenimport'), 'documents.json'), 'utf8')).toBe(vorher);
  });

  // Entspricht der curl-Gegenprobe aus quickstart.md („Pfad-Härtung"): der
  // Dateiname kommt aus dem multipart-Body und darf nie ein Pfad werden (FR-005).
  it('hält einen Dateinamen mit Pfadanteilen im docs-Ordner fest (FR-005)', async () => {
    const res = await upload(projectId, [
      { name: 'name', value: 'pfadtest' },
      { name: 'description', value: '' },
      { name: 'files', filename: '../../../../tmp/entkommen.txt', content: 'boese' },
    ]);

    expect(res.statusCode).toBe(200);
    const body = res.json() as { documents: Array<{ storedName: string; relPath: string }> };
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]!.storedName).not.toContain('/');
    expect(body.documents[0]!.relPath.startsWith('specs/pfadtest/docs/')).toBe(true);
    expect(existsSync('/tmp/entkommen.txt')).toBe(false);
    expect(existsSync(join(docsDirOf('pfadtest'), body.documents[0]!.storedName))).toBe(true);
  });

  // ---------- GET /api/features/:id/documents ----------

  it('liefert die hinterlegten Dokumente eines Features', async () => {
    const angelegt = await upload(projectId, [
      { name: 'name', value: 'liste' },
      { name: 'files', filename: 'a.txt', content: 'A' },
      { name: 'files', filename: 'b.txt', content: 'BB' },
    ]);
    const featureId = (angelegt.json() as { feature: { id: string } }).feature.id;

    const res = await app.inject({ method: 'GET', url: `/api/features/${featureId}/documents` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({ name: 'a.txt', relPath: 'specs/liste/docs/a.txt', bytes: 1 }),
      expect.objectContaining({ name: 'b.txt', relPath: 'specs/liste/docs/b.txt', bytes: 2 }),
    ]);
  });

  it('liefert ohne hinterlegte Dokumente ein leeres Array statt eines Fehlers', async () => {
    const featureId = features.create({
      projectId,
      name: 'ohne-docs',
      branch: 'feature/ohne-docs',
      worktreePath: repo,
      phases: initialPhases(ENABLED),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;

    const res = await app.inject({ method: 'GET', url: `/api/features/${featureId}/documents` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('weist ein unbekanntes Feature ab (404)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/features/gibt-es-nicht/documents' });
    expect(res.statusCode).toBe(404);
    expect(message(res)).toBe('Feature nicht gefunden');
  });

  // ---------- POST /api/features/:id/documents/open ----------

  it('öffnet ein gelistetes Dokument mit dem Systemöffner', async () => {
    const angelegt = await upload(projectId, [
      { name: 'name', value: 'oeffnen' },
      { name: 'files', filename: 'bericht.pdf', content: '%PDF' },
    ]);
    const featureId = (angelegt.json() as { feature: { id: string } }).feature.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/features/${featureId}/documents/open`,
      payload: { storedName: 'bericht.pdf' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(opened).toEqual([join(docsDirOf('oeffnen'), 'bericht.pdf')]);
  });

  it('weist einen nicht im Manifest gelisteten Namen ab (404) — nie als Pfad übernommen (FR-005)', async () => {
    const angelegt = await upload(projectId, [
      { name: 'name', value: 'haerte' },
      { name: 'files', filename: 'bericht.pdf', content: '%PDF' },
    ]);
    const featureId = (angelegt.json() as { feature: { id: string } }).feature.id;

    for (const storedName of ['documents.json', '../../../etc/passwd', '/etc/passwd', 'gibt-es-nicht.pdf']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/features/${featureId}/documents/open`,
        payload: { storedName },
      });
      expect(res.statusCode, storedName).toBe(404);
      expect(message(res)).toBe('Dokument nicht gefunden');
    }
    expect(opened).toEqual([]); // nichts geöffnet
  });

  it('meldet ein zwischenzeitlich gelöschtes Dokument als nicht mehr vorhanden (404)', async () => {
    const angelegt = await upload(projectId, [
      { name: 'name', value: 'geloescht' },
      { name: 'files', filename: 'weg.txt', content: 'x' },
    ]);
    const featureId = (angelegt.json() as { feature: { id: string } }).feature.id;
    rmSync(join(docsDirOf('geloescht'), 'weg.txt'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/features/${featureId}/documents/open`,
      payload: { storedName: 'weg.txt' },
    });

    // Der Manifest-Eintrag ohne Datei wird schon beim Lesen ausgelassen (FR-016).
    expect(res.statusCode).toBe(404);
    expect(opened).toEqual([]);
  });

  it('legt bei fehlgeschlagenem Anlegen keinen docs-Ordner an (FR-015)', async () => {
    features.create({
      projectId,
      name: 'schon-da',
      branch: 'feature/schon-da',
      worktreePath: repo,
      phases: initialPhases(ENABLED),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });

    const res = await upload(projectId, [
      { name: 'name', value: 'schon-da' },
      { name: 'files', filename: 'a.txt', content: 'x' },
    ]);

    expect(res.statusCode).toBe(400);
    expect(existsSync(docsDirOf('schon-da'))).toBe(false);
  });
});

/**
 * Kontext-Hygiene über die API: `GET /chat` transportiert nur den an der letzten Turn-Grenze
 * gebildeten Stand (FR-007), und das Angebot lässt sich ablehnen (FR-008/FR-009).
 */
describe('Chat-Routen — Kostenprofil und Neustart-Angebot', () => {
  let app: FastifyInstance;
  let db: DB;
  let telemetry: TelemetryStore;
  let projectId: string;
  let costProfile: ChatCostProfile | null;
  let dismissed: string[];

  const teuer: ChatCostProfile = {
    historyBytes: Math.round(16.8 * 1024 * 1024),
    lastTurn: { cacheReadTokens: 265_673, outputTokens: 300, costMicros: 890_000, tokens: 266_000, measured: true },
    ratio: { kind: 'value', ratio: 885.6 },
    reasons: ['history_size', 'context_per_turn'],
    offerOpen: true,
    message: 'Der Verlauf ist 16,8 MB groß — jeder weitere Turn zahlt den Verlauf mit.',
  };

  beforeEach(async () => {
    db = openMemoryDatabase();
    telemetry = new TelemetryStore({ autoSweep: false });
    const projects = new ProjectRepo(db);
    projectId = projects.create({
      name: 'Demo', path: '/tmp/demo', defaultBranch: 'main', color: null, enabledPhases: [],
      verifyCommands: [], automation: {}, mergeMode: 'ff', editorCmd: null, integrationMode: 'local',
    }).id;
    costProfile = null;
    dismissed = [];

    const conversation = {
      id: 'c1', projectId, mode: 'work', claudeSessionId: null, createdAt: 0, updatedAt: 0, endedAt: null,
    };

    app = await buildServer({
      allowedOrigins: buildAllowedOrigins([80]),
      projects,
      features: new FeatureRepo(db),
      sessions: new SessionRepo(db),
      executions: new ExecutionRepo(db),
      attention: new AttentionRepo(db),
      chat: { getState: () => ({ conversation, messages: [] }) },
      chatWork: {
        workSessionInfo: () => null,
        workPaused: () => false,
        proposalForProject: () => null,
        costProfileFor: () => costProfile,
        // Wie im Service: Wasserstand merken ⇒ das Angebot ist zu, die Zahlen bleiben.
        dismissOffer: (id: string) => {
          dismissed.push(id);
          if (costProfile) costProfile = { ...costProfile, reasons: [], offerOpen: false, message: null };
        },
      },
      telemetry,
      dataDir: mkdtempSync(join(tmpdir(), 'sdd-chat-hygiene-')),
      webDir: null,
      port: 4899,
    } as unknown as ApiDeps);
  });

  afterEach(async () => {
    await app.close();
    telemetry.stop();
    db.close();
  });

  const getChat = async (id = projectId) => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${id}/chat` });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };

  it('liefert ohne Messung costProfile: null und lässt die bestehenden Felder unverändert', async () => {
    const { status, body } = await getChat();

    expect(status).toBe(200);
    expect(body.costProfile).toBeNull();
    expect(body.workSession).toBeNull();
    expect(body.workPaused).toBe(false);
    expect(body.pendingFeatures).toBeNull();
    expect(body.conversation).toMatchObject({ id: 'c1' });
  });

  it('liefert das Kostenprofil der letzten Turn-Grenze mit', async () => {
    costProfile = teuer;

    const { body } = await getChat();

    expect(body.costProfile).toEqual(teuer);
  });

  it('POST …/chat/work/offer/dismiss lehnt ab; danach ist das Angebot zu', async () => {
    costProfile = teuer;

    const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/chat/work/offer/dismiss` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(dismissed).toEqual([projectId]);

    const { body } = await getChat();
    expect((body.costProfile as ChatCostProfile).offerOpen).toBe(false);
    // Die Zahlen bleiben ablesbar — abgelehnt ist das Angebot, nicht die Messung.
    expect((body.costProfile as ChatCostProfile).lastTurn?.cacheReadTokens).toBe(265_673);
  });

  it('unbekannte Projekt-ID → 404 wie bei den benachbarten Chat-Routen', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/projects/gibt-es-nicht/chat/work/offer/dismiss' });

    expect(res.statusCode).toBe(404);
    expect(message(res)).toBe('Projekt nicht gefunden');
    expect(dismissed).toEqual([]);

    expect((await getChat('gibt-es-nicht')).status).toBe(404);
  });
});
