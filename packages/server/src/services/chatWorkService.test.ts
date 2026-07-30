import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_HYGIENE_LIMITS, type Feature } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { AttentionRepo, ChatRepo, ExecutionRepo, ProjectRepo, SessionRepo, SettingsRepo } from '../db/repos.js';
import type { WorktreeManager } from '../git/worktrees.js';
import { isCleanWorkingTree } from '../git/git.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import { locateTranscript, transcriptSize } from '../pty/transcriptWatcher.js';
import type { Orchestrator } from './orchestrator.js';
import { ChatWorkService } from './chatWorkService.js';

// Nur isCleanWorkingTree steuern; restliche git.js-Exporte real belassen.
vi.mock('../git/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git/git.js')>();
  return { ...actual, isCleanWorkingTree: vi.fn() };
});

// Verlaufsgröße steuerbar machen (sie liegt sonst im echten ~/.claude/projects);
// die übrigen Transkript-Funktionen bleiben real.
vi.mock('../pty/transcriptWatcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pty/transcriptWatcher.js')>();
  return { ...actual, locateTranscript: vi.fn(), transcriptSize: vi.fn() };
});

const marker = (feats: { name: string; description: string }[]) =>
  `Klingt nach eigenen Features.\n<sdd:features>${JSON.stringify(feats)}</sdd:features>`;

describe('ChatWorkService — Feature-Vorschläge aus der Session', () => {
  let db: DB;
  let chat: ChatRepo;
  let dataDir: string;
  let projectId: string;
  let convId: string;
  let svc: ChatWorkService;
  let created: { name: string; description: string }[];

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-cw-'));
    db = openMemoryDatabase();
    chat = new ChatRepo(db);
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
    convId = chat.createConversation(projectId, 'work').id;
    created = [];

    const orchestrator = {
      createFeature: async (pid: string, name: string, description?: string) => {
        created.push({ name, description: description ?? '' });
        return { id: `f-${name}`, projectId: pid, name } as unknown as Feature;
      },
    } as unknown as Orchestrator;

    svc = new ChatWorkService({
      projects: new ProjectRepo(db),
      chatRepo: chat,
      sessions: new SessionRepo(db),
      attention: new AttentionRepo(db),
      executions: new ExecutionRepo(db),
      settings: new SettingsRepo(db),
      worktrees: {} as unknown as WorktreeManager,
      ptys: { forConversation: () => undefined } as unknown as PtySessionManager,
      orchestrator,
      dataDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const fakeSession = () => ({ id: 's1', conversationId: convId, projectId } as unknown as LiveSession);

  it('ohne Marker entsteht kein Vorschlag', () => {
    svc.onAssistantText(fakeSession(), 'Nur eine ganz normale Antwort ohne Marker.');
    expect(svc.proposalForProject(projectId)).toBeNull();
  });

  it('Marker erzeugt einen Vorschlag; identischer Marker dedupliziert', () => {
    const feats = [
      { name: 'pdf-export', description: 'Alle Features als PDF exportieren' },
      { name: 'csv-import', description: 'Aufgaben aus CSV importieren' },
    ];
    svc.onAssistantText(fakeSession(), marker(feats));
    const p1 = svc.proposalForProject(projectId);
    expect(p1?.features.map((f) => f.name)).toEqual(['pdf-export', 'csv-import']);

    svc.onAssistantText(fakeSession(), marker(feats)); // gleicher Marker erneut
    expect(svc.proposalForProject(projectId)?.id).toBe(p1?.id); // kein neuer Vorschlag
  });

  it('createFeatures legt nur die ausgewählten an und löscht den Vorschlag', async () => {
    svc.onAssistantText(
      fakeSession(),
      marker([
        { name: 'pdf-export', description: 'PDF' },
        { name: 'csv-import', description: 'CSV' },
      ]),
    );
    const features = await svc.createFeatures(projectId, ['pdf-export']);
    expect(features).toHaveLength(1);
    expect(created).toEqual([{ name: 'pdf-export', description: 'PDF' }]);
    expect(svc.proposalForProject(projectId)).toBeNull();
  });

  it('dismissProposal verwirft ohne Anlage', () => {
    svc.onAssistantText(fakeSession(), marker([{ name: 'x', description: 'y' }]));
    expect(svc.proposalForProject(projectId)).not.toBeNull();
    svc.dismissProposal(projectId);
    expect(svc.proposalForProject(projectId)).toBeNull();
    expect(created).toEqual([]);
  });
});

describe('ChatWorkService — Neustart (restart)', () => {
  let db: DB;
  let chat: ChatRepo;
  let dataDir: string;
  let projectId: string;
  let oldConvId: string;
  let svc: ChatWorkService;
  let wt: { remove: number; deleteBranch: string[] };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-cw-restart-'));
    db = openMemoryDatabase();
    chat = new ChatRepo(db);
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
    oldConvId = chat.createConversation(projectId, 'work').id;
    wt = { remove: 0, deleteBranch: [] };

    const worktrees = {
      pathFor: (p: { id: string }, name: string) => join(dataDir, 'worktrees', p.id, name),
      remove: async () => {
        wt.remove++;
      },
      deleteBranch: async (_p: string, branch: string) => {
        wt.deleteBranch.push(branch);
      },
    } as unknown as WorktreeManager;

    svc = new ChatWorkService({
      projects: new ProjectRepo(db),
      chatRepo: chat,
      sessions: new SessionRepo(db),
      attention: new AttentionRepo(db),
      executions: new ExecutionRepo(db),
      settings: new SettingsRepo(db),
      worktrees,
      ptys: { forConversation: () => undefined } as unknown as PtySessionManager,
      orchestrator: {} as unknown as Orchestrator,
      dataDir,
    });
    // ensure() stubben: keine echte Worktree/Spawn — nur eine Session-ID liefern.
    svc.ensure = async () => ({ sessionId: 's-new' });
    vi.mocked(isCleanWorkingTree).mockResolvedValue(true); // Standard: sauber
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const activeCount = () =>
    (
      db
        .prepare('SELECT COUNT(*) AS c FROM chat_conversations WHERE project_id=? AND ended_at IS NULL')
        .get(projectId) as { c: number }
    ).c;

  it('deaktiviert die alte Unterhaltung (Verlauf bleibt) und startet frisch & clean (INV-1/2/3)', async () => {
    chat.createMessage({ conversationId: oldConvId, role: 'user', content: 'BANANE', status: 'complete' });

    const res = await svc.restart(projectId, { confirm: false });

    expect('sessionId' in res).toBe(true);
    if ('sessionId' in res) {
      const active = chat.getActive(projectId)!;
      expect(active.id).toBe(res.conversationId);
      expect(active.id).not.toBe(oldConvId); // INV-1: neue aktive Unterhaltung
      expect(active.claudeSessionId).toBeNull(); // INV-3: kein Resume ⇒ clean
    }
    const old = chat.getConversation(oldConvId)!;
    expect(old.endedAt).not.toBeNull(); // INV-1: alt deaktiviert
    expect(chat.listMessages(oldConvId).map((m) => m.content)).toContain('BANANE'); // INV-2: Verlauf erhalten
  });

  it('Guard: dirty Arbeitskopie ohne confirm → needsConfirm, nichts verworfen (FR-006)', async () => {
    vi.mocked(isCleanWorkingTree).mockResolvedValue(false); // dirty

    const res = await svc.restart(projectId, { confirm: false });

    expect(res).toEqual({ needsConfirm: true, reason: 'dirty' });
    expect(chat.getActive(projectId)!.id).toBe(oldConvId); // nichts verworfen
    expect(wt.remove).toBe(0);
    expect(wt.deleteBranch).toEqual([]);

    const ok = await svc.restart(projectId, { confirm: true }); // mit Bestätigung
    expect('sessionId' in ok).toBe(true);
    expect(chat.getActive(projectId)!.id).not.toBe(oldConvId);
  });

  it('räumt Worktree/Branch der alten Unterhaltung auf; genau eine aktive Session (INV-4/5)', async () => {
    const r1 = await svc.restart(projectId, { confirm: true });
    expect(wt.remove).toBe(1);
    expect(wt.deleteBranch).toContain(`chat/${oldConvId}`); // INV-5

    await svc.restart(projectId, { confirm: true });
    if ('conversationId' in r1) expect(wt.deleteBranch).toContain(`chat/${r1.conversationId}`);
    expect(activeCount()).toBe(1); // INV-4: nach mehreren Neustarts genau eine aktive
  });
});

describe('ChatWorkService — Leerlauf-Reaper (reapIdleSessions)', () => {
  let db: DB;
  let dataDir: string;
  let projectId: string;
  let terminated: string[];
  let sessions: LiveSession[];
  let svc: ChatWorkService;

  const mkSession = (over: Partial<LiveSession> & { id: string }): LiveSession =>
    ({
      kind: 'chat_work',
      exited: false,
      projectId,
      conversationId: 'c1',
      machine: { state: { kind: 'ready' } },
      lastActiveAt: 0,
      lastUsedAt: 0,
      subscribers: new Set(),
      ...over,
    }) as unknown as LiveSession;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-cw-reap-'));
    db = openMemoryDatabase();
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
    terminated = [];
    sessions = [];

    const ptys = {
      list: () => sessions,
      terminate: async (id: string) => {
        terminated.push(id);
      },
      forConversation: () => undefined,
    } as unknown as PtySessionManager;

    svc = new ChatWorkService({
      projects: new ProjectRepo(db),
      chatRepo: new ChatRepo(db),
      sessions: new SessionRepo(db),
      attention: new AttentionRepo(db),
      executions: new ExecutionRepo(db),
      settings: new SettingsRepo(db),
      worktrees: {} as unknown as WorktreeManager,
      ptys,
      orchestrator: {} as unknown as Orchestrator,
      dataDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('beendet eine inaktive Chat-Session nach Ablauf der Leerlaufzeit', () => {
    sessions = [mkSession({ id: 'idle-old', lastActiveAt: 0 })];
    svc.reapIdleSessions(CHAT_HYGIENE_LIMITS.idleMs + 1);
    expect(terminated).toEqual(['idle-old']);
  });

  it('würgt eine arbeitende Session nie ab', () => {
    sessions = [mkSession({ id: 'busy', machine: { state: { kind: 'working' } } as LiveSession['machine'], lastActiveAt: 0 })];
    svc.reapIdleSessions(CHAT_HYGIENE_LIMITS.idleMs * 10);
    expect(terminated).toEqual([]);
  });

  /**
   * Der Fall, der den Chat regelmäßig abbrechen ließ: Der Agent hat vor langer Zeit
   * geantwortet (`lastActiveAt` alt), der Nutzer liest und tippt gerade (`lastUsedAt`
   * frisch). Am alten Maß gemessen war das „seit Ewigkeiten inaktiv".
   */
  it('verschont eine Session, der sich der Nutzer gerade zuwendet', () => {
    const now = CHAT_HYGIENE_LIMITS.idleMs * 10;
    sessions = [mkSession({ id: 'lesend', lastActiveAt: 0, lastUsedAt: now - 1000 })];
    svc.reapIdleSessions(now);
    expect(terminated).toEqual([]);
  });

  it('verschont eine Session mit offenem Panel, egal wie lange sie still ist', () => {
    sessions = [mkSession({ id: 'beobachtet', lastUsedAt: 0, subscribers: new Set([{}]) as LiveSession['subscribers'] })];
    svc.reapIdleSessions(CHAT_HYGIENE_LIMITS.idleMs * 100);
    expect(terminated).toEqual([]);
  });

  it('beendet eine Session, die niemand mehr offen hat und der sich niemand zuwendet', () => {
    sessions = [mkSession({ id: 'vergessen', lastUsedAt: 0, subscribers: new Set() })];
    svc.reapIdleSessions(CHAT_HYGIENE_LIMITS.idleMs + 1);
    expect(terminated).toEqual(['vergessen']);
  });

  it('lässt eine noch frische Session in Ruhe', () => {
    // dispatch() setzt beide Marken gemeinsam, wenn der Agent zu arbeiten beginnt.
    sessions = [mkSession({ id: 'fresh', lastActiveAt: 1_000, lastUsedAt: 1_000 })];
    svc.reapIdleSessions(1_000 + CHAT_HYGIENE_LIMITS.idleMs - 1);
    expect(terminated).toEqual([]);
  });

  it('ignoriert Nicht-Chat-Sessions (Feature/Shell)', () => {
    sessions = [mkSession({ id: 'feat', kind: 'feature', lastActiveAt: 0 })];
    svc.reapIdleSessions(CHAT_HYGIENE_LIMITS.idleMs + 1);
    expect(terminated).toEqual([]);
  });
});

describe('ChatWorkService — workPaused (Pausiert-Signal fürs Panel)', () => {
  let db: DB;
  let dataDir: string;
  let projectId: string;
  let sessionsRepo: SessionRepo;
  let live: LiveSession | undefined;
  let svc: ChatWorkService;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-cw-paused-'));
    db = openMemoryDatabase();
    projectId = new ProjectRepo(db).create({
      name: 'Demo', path: '/tmp/demo', defaultBranch: 'main', color: null, enabledPhases: [],
      verifyCommands: [], automation: {}, mergeMode: 'ff', editorCmd: null, integrationMode: 'local',
    }).id;
    sessionsRepo = new SessionRepo(db);
    live = undefined;

    const ptys = { forConversation: () => live } as unknown as PtySessionManager;
    svc = new ChatWorkService({
      projects: new ProjectRepo(db), chatRepo: new ChatRepo(db), sessions: sessionsRepo,
      attention: new AttentionRepo(db), executions: new ExecutionRepo(db), settings: new SettingsRepo(db),
      worktrees: {} as unknown as WorktreeManager, ptys, orchestrator: {} as unknown as Orchestrator, dataDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const conv = () => new ChatRepo(db).createConversation(projectId, 'work');

  it('false, wenn eine Session live ist', () => {
    const c = conv();
    live = { id: 's1' } as unknown as LiveSession;
    expect(svc.workPaused(c)).toBe(false);
  });

  it('false für eine frische Unterhaltung ohne je gestartete Session', () => {
    expect(svc.workPaused(conv())).toBe(false);
  });

  it('true, wenn keine Session läuft, aber eine frühere mit Claude-Session-ID existiert (fortsetzbar)', () => {
    const c = conv();
    sessionsRepo.create({ id: 's1', featureId: null, conversationId: c.id, projectId, kind: 'chat_work', pid: 123 });
    sessionsRepo.setClaudeSessionId('s1', 'claude-abc');
    expect(svc.workPaused(c)).toBe(true);
  });

  it('false, wenn die frühere Session nie eine Claude-Session-ID erhielt', () => {
    const c = conv();
    sessionsRepo.create({ id: 's1', featureId: null, conversationId: c.id, projectId, kind: 'chat_work', pid: 123 });
    expect(svc.workPaused(c)).toBe(false);
  });
});

/**
 * Metering eines Chat-Turns. Vorher wurde aus dem Terminal-Scrollback geschätzt —
 * also ausgerechnet die Größe, die kaum kostet: In einem Chat vom 28.07.2026 standen
 * 7,0 Mio. gelesene Cache-Tokens 45k Ausgabe-Tokens gegenüber, erfasst waren 94k
 * Tokens und 0 $ statt real gut 5 $. Vorrang haben jetzt die Meldungen der CLI.
 */
describe('ChatWorkService — Verbrauch und Kosten eines Turns', () => {
  let db: DB;
  let dataDir: string;
  let projectId: string;
  let executions: ExecutionRepo;
  let svc: ChatWorkService;

  const telemetryEvent = (sessionId: string) => ({
    sessionId,
    timestamp: Date.now(),
    origin: 'main' as const,
    model: 'claude-opus-5',
    tokens: 7_175_597,
    inputTokens: 135,
    outputTokens: 45_096,
    cacheReadTokens: 7_016_059,
    cacheCreationTokens: 114_307,
    costMicros: 5_350_524,
  });

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-cw-meter-'));
    db = openMemoryDatabase();
    executions = new ExecutionRepo(db);
    projectId = new ProjectRepo(db).create({
      name: 'Demo', path: '/tmp/demo', defaultBranch: 'main', color: null, enabledPhases: [],
      verifyCommands: [], automation: {}, mergeMode: 'ff', editorCmd: null, integrationMode: 'local',
    }).id;
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const build = (telemetry?: unknown) =>
    new ChatWorkService({
      projects: new ProjectRepo(db), chatRepo: new ChatRepo(db), sessions: new SessionRepo(db),
      attention: new AttentionRepo(db), executions, settings: new SettingsRepo(db),
      worktrees: {} as unknown as WorktreeManager,
      ptys: { forConversation: () => undefined } as unknown as PtySessionManager,
      orchestrator: { reconcileOpenAttention: () => {} } as unknown as Orchestrator, dataDir,
      ...(telemetry ? { telemetry: telemetry as never } : {}),
    });

  const session = (): LiveSession =>
    ({
      id: 's1',
      projectId,
      cwd: '/tmp/demo',
      scrollback: 'Antwort des Agenten.\n',
      machine: { state: { kind: 'turn_done' } },
    }) as unknown as LiveSession;

  it('rechnet über die Meldungen der CLI ab — inklusive Kosten und Cache-Tokens', () => {
    const live = session();
    svc = build({ eventsFor: () => [telemetryEvent(live.id)] });

    svc.handleStatusChange(live, [{ kind: 'turn_completed' }] as never);

    const [run] = executions.listAll();
    expect(run.tokensSource).toBe('telemetry');
    expect(run.costMicros).toBe(5_350_524);
    expect(run.cacheReadTokens).toBe(7_016_059);
    expect(run.tokens).toBe(7_175_597);
  });

  it('fällt ohne Meldungen und ohne Transkript auf die Scrollback-Schätzung zurück', () => {
    const live = session();
    svc = build({ eventsFor: () => [] });

    svc.handleStatusChange(live, [{ kind: 'turn_completed' }] as never);

    const [run] = executions.listAll();
    expect(run.tokensSource).toBe('estimated');
    expect(run.tokens).toBeGreaterThan(0);
  });
});

// ---------- Kontext-Hygiene (Kostenprofil und Neustart-Angebot) ----------

const MB = 1024 * 1024;
/** Referenzfall 28.07.2026: 16,8 MB Verlauf, ~265'000 gelesene Tokens je Turn, ~300 erzeugte. */
const REFERENZ_VERLAUF = Math.round(16.8 * MB);

interface TurnVerbrauch {
  cacheReadTokens: number;
  outputTokens: number;
  costMicros?: number;
}

/** Projekt + aktive Unterhaltung + steuerbare Session, Verlaufsgröße und Verbrauchsmeldungen. */
function hygieneSetup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'sdd-cw-hygiene-'));
  const db = openMemoryDatabase();
  const chatRepo = new ChatRepo(db);
  const sessionsRepo = new SessionRepo(db);
  const projectId = new ProjectRepo(db).create({
    name: 'Demo', path: '/tmp/demo', defaultBranch: 'main', color: null, enabledPhases: [],
    verifyCommands: [], automation: {}, mergeMode: 'ff', editorCmd: null, integrationMode: 'local',
  }).id;
  const convId = chatRepo.createConversation(projectId, 'work').id;

  const ctx = {
    db,
    dataDir,
    chatRepo,
    sessionsRepo,
    projectId,
    convId,
    /** Verbrauchsmeldungen des laufenden Turns (leer = die CLI hat nichts gemeldet). */
    events: [] as Record<string, unknown>[],
    live: undefined as LiveSession | undefined,
    svc: null as unknown as ChatWorkService,
  };

  ctx.svc = new ChatWorkService({
    projects: new ProjectRepo(db),
    chatRepo,
    sessions: sessionsRepo,
    attention: new AttentionRepo(db),
    executions: new ExecutionRepo(db),
    settings: new SettingsRepo(db),
    worktrees: {
      pathFor: (p: { id: string }, name: string) => join(dataDir, 'wt', p.id, name),
      remove: async () => {},
      deleteBranch: async () => {},
    } as unknown as WorktreeManager,
    ptys: { forConversation: () => ctx.live } as unknown as PtySessionManager,
    orchestrator: { reconcileOpenAttention: () => {} } as unknown as Orchestrator,
    dataDir,
    telemetry: { eventsFor: () => ctx.events } as never,
  });
  ctx.svc.ensure = async () => ({ sessionId: 's-neu' });
  vi.mocked(isCleanWorkingTree).mockResolvedValue(true);
  return ctx;
}

type Hygiene = ReturnType<typeof hygieneSetup>;

const hygieneSession = (ctx: Hygiene, over: Record<string, unknown> = {}): LiveSession =>
  ({
    id: 's1',
    projectId: ctx.projectId,
    conversationId: ctx.convId,
    cwd: '/tmp/demo',
    claudeSessionId: 'claude-abc',
    scrollback: 'Antwort des Agenten.\n',
    machine: { state: { kind: 'turn_done' } },
    ...over,
  }) as unknown as LiveSession;

/** Verlaufsgröße, die `historyBytesFor()` findet (`null` = kein Transkript auffindbar). */
const setzeVerlauf = (bytes: number | null) => {
  vi.mocked(locateTranscript).mockReturnValue(bytes === null ? null : '/tmp/transkript.jsonl');
  vi.mocked(transcriptSize).mockReturnValue(bytes ?? 0);
};

/** Einen Turn beenden; `null` = für diesen Turn war nichts messbar. */
const beendeTurn = (ctx: Hygiene, verbrauch: TurnVerbrauch | null) => {
  ctx.events = verbrauch
    ? [
        {
          sessionId: 's1',
          requestId: `req-${Math.random()}`,
          at: Date.now(),
          origin: 'main',
          model: 'claude-opus-5',
          tokens: verbrauch.cacheReadTokens + verbrauch.outputTokens,
          inputTokens: 0,
          outputTokens: verbrauch.outputTokens,
          cacheReadTokens: verbrauch.cacheReadTokens,
          cacheCreationTokens: 0,
          costMicros: verbrauch.costMicros ?? 890_000,
        },
      ]
    : [];
  // Ohne Meldungen UND ohne Ausgabe im Scrollback gibt der Turn nichts her → Verbrauch unbekannt.
  const live = hygieneSession(ctx, verbrauch ? {} : { scrollback: '' });
  ctx.svc.handleStatusChange(live, [{ kind: 'turn_completed' }] as never);
};

const profil = (ctx: Hygiene) => ctx.svc.costProfileFor(ctx.chatRepo.getActive(ctx.projectId)!);

/** Die Unterhaltung pausieren lassen: frühere Session mit Claude-ID, keine laufende. */
const pausiere = (ctx: Hygiene) => {
  ctx.sessionsRepo.create({
    id: 's-alt', featureId: null, conversationId: ctx.convId, projectId: ctx.projectId,
    kind: 'chat_work', pid: 123,
  });
  ctx.sessionsRepo.setClaudeSessionId('s-alt', 'claude-abc');
};

const TEUER: TurnVerbrauch = { cacheReadTokens: 265_673, outputTokens: 300 };
const GUENSTIG: TurnVerbrauch = { cacheReadTokens: 12_000, outputTokens: 600 };

/**
 * Messung an der Turn-Grenze: der Verbrauch des Turns und die Verlaufsgröße werden für die
 * Unterhaltung festgehalten — auch dann, wenn nichts messbar war (dann als „unbekannt",
 * nie als 0, FR-016).
 */
describe('ChatWorkService — Kostenprofil an der Turn-Grenze', () => {
  let ctx: Hygiene;

  beforeEach(() => {
    ctx = hygieneSetup();
    setzeVerlauf(300 * 1024);
  });

  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it('vor dem ersten Turn gibt es kein Profil', () => {
    expect(profil(ctx)).toBeNull();
  });

  it('Turn-Ende schreibt Verbrauch und Verlaufsgröße fest', () => {
    setzeVerlauf(2 * MB);
    beendeTurn(ctx, { cacheReadTokens: 90_000, outputTokens: 1_500, costMicros: 42_000 });

    const p = profil(ctx)!;
    expect(p.lastTurn).toEqual({
      cacheReadTokens: 90_000,
      outputTokens: 1_500,
      costMicros: 42_000,
      tokens: 91_500,
      measured: true,
    });
    expect(p.historyBytes).toBe(2 * MB);
    expect(p.ratio).toEqual({ kind: 'value', ratio: 60 });
  });

  it('ein Turn ohne messbaren Verbrauch landet als unbekannt, nicht als 0 (FR-016)', () => {
    beendeTurn(ctx, null);

    const p = profil(ctx)!;
    expect(p.lastTurn).toEqual({
      cacheReadTokens: null, outputTokens: null, costMicros: null, tokens: null, measured: false,
    });
    expect(p.ratio).toEqual({ kind: 'unknown' });
    expect(p.reasons).toEqual([]);
  });

  it('die Zahlen beziehen sich stets auf den zuletzt beendeten Turn', () => {
    beendeTurn(ctx, { cacheReadTokens: 90_000, outputTokens: 100 });
    beendeTurn(ctx, { cacheReadTokens: 11_000, outputTokens: 800 });

    expect(profil(ctx)!.lastTurn?.cacheReadTokens).toBe(11_000);
  });

  it('der Ringpuffer hält nur die letzten drei Turns', () => {
    for (const v of [GUENSTIG, GUENSTIG, GUENSTIG, TEUER, TEUER, TEUER]) beendeTurn(ctx, v);
    // Die günstigen Turns sind herausgefallen — drei teure in Folge lösen das Verhältnis aus.
    expect(profil(ctx)!.reasons).toContain('context_ratio');

    for (const v of [TEUER, TEUER, TEUER, GUENSTIG]) beendeTurn(ctx, v);
    // Ein günstiger Turn im Fenster genügt, damit das Verhältnis nicht mehr gilt.
    expect(profil(ctx)!.reasons).not.toContain('context_ratio');
  });

  it('nicht ermittelbare Verlaufsgröße bleibt unbekannt und löst nichts aus', () => {
    setzeVerlauf(null);
    beendeTurn(ctx, GUENSTIG);

    const p = profil(ctx)!;
    expect(p.historyBytes).toBeNull();
    expect(p.reasons).toEqual([]);
  });

  it('nach einem Neustart beginnt die Bewertung der frischen Unterhaltung bei null (FR-012)', async () => {
    setzeVerlauf(REFERENZ_VERLAUF);
    beendeTurn(ctx, TEUER);
    expect(profil(ctx)!.offerOpen).toBe(true);

    await ctx.svc.restart(ctx.projectId, { confirm: true });

    expect(ctx.chatRepo.getActive(ctx.projectId)!.id).not.toBe(ctx.convId);
    expect(profil(ctx)).toBeNull();
  });
});

/**
 * Der zweite Auslöser derselben Entscheidung: nicht „5 Minuten Leerlauf", sondern „der
 * Verlauf ist teuer geworden". Gemessen am Fall vom 28.07.2026 — dort lasen sechs Turns je
 * ~265'000 Tokens Kontext, um 100–400 Tokens zu erzeugen.
 */
describe('ChatWorkService — Neustart-Angebot aus Kosten', () => {
  let ctx: Hygiene;

  beforeEach(() => {
    ctx = hygieneSetup();
    setzeVerlauf(300 * 1024);
  });

  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it('bietet bei großem Verlauf an, ohne dass eine Leerlaufzeit abläuft (AC1/SC-001)', () => {
    setzeVerlauf(REFERENZ_VERLAUF);
    beendeTurn(ctx, GUENSTIG);

    const p = profil(ctx)!;
    expect(p.offerOpen).toBe(true);
    expect(p.reasons).toEqual(['history_size']);
    expect(p.reasons).not.toContain('idle');
    expect(p.message).toContain('16,8 MB');
  });

  it('bietet bei hohem gelesenen Kontext an, obwohl der Verlauf klein ist (AC2)', () => {
    setzeVerlauf(200 * 1024);
    beendeTurn(ctx, TEUER);

    const p = profil(ctx)!;
    expect(p.offerOpen).toBe(true);
    expect(p.reasons).toEqual(['context_per_turn']);
    expect(p.message).toContain("265'673");
  });

  it('während ein Turn arbeitet, entsteht kein Angebot (AC5/FR-007)', () => {
    setzeVerlauf(REFERENZ_VERLAUF);
    const arbeitend = hygieneSession(ctx, { machine: { state: { kind: 'working' } } });

    ctx.svc.handleStatusChange(arbeitend, [] as never);

    // Auch der Abruf über GET /chat erzeugt nichts — es gibt noch keine Turn-Grenze.
    expect(profil(ctx)).toBeNull();
  });

  it('ein frischer Chat mit kurzem Verlauf bekommt über mehrere Turns nichts angeboten (AC6/SC-004)', () => {
    setzeVerlauf(400 * 1024);
    for (let i = 0; i < 9; i++) beendeTurn(ctx, GUENSTIG);

    const p = profil(ctx)!;
    expect(p.offerOpen).toBe(false);
    expect(p.reasons).toEqual([]);
    expect(p.message).toBeNull();
  });

  it('Ablehnen unterdrückt das Angebot; im selben Turn erscheint kein zweites (AC4/SC-006)', () => {
    setzeVerlauf(REFERENZ_VERLAUF);
    beendeTurn(ctx, TEUER);
    expect(profil(ctx)!.offerOpen).toBe(true);

    ctx.svc.dismissOffer(ctx.projectId);

    const p = profil(ctx)!;
    expect(p.offerOpen).toBe(false);
    expect(p.reasons).toEqual([]);
    expect(p.message).toBeNull();
    // Die Zahlen bleiben ablesbar — abgelehnt ist das Angebot, nicht die Messung (FR-014).
    expect(p.lastTurn?.cacheReadTokens).toBe(265_673);
  });

  it('nach der Ablehnung bleibt es still, solange der Verlauf nur wenig wächst (FR-009)', () => {
    setzeVerlauf(REFERENZ_VERLAUF);
    beendeTurn(ctx, GUENSTIG);
    ctx.svc.dismissOffer(ctx.projectId);

    setzeVerlauf(REFERENZ_VERLAUF + 2 * MB);
    beendeTurn(ctx, GUENSTIG);
    expect(profil(ctx)!.offerOpen).toBe(false);
  });

  it('nach Wachstum um eine weitere Schwellenstufe wird erneut angeboten (FR-009)', () => {
    setzeVerlauf(REFERENZ_VERLAUF);
    beendeTurn(ctx, GUENSTIG);
    ctx.svc.dismissOffer(ctx.projectId);

    setzeVerlauf(REFERENZ_VERLAUF + CHAT_HYGIENE_LIMITS.historyBytes);
    beendeTurn(ctx, GUENSTIG);

    const p = profil(ctx)!;
    expect(p.offerOpen).toBe(true);
    expect(p.reasons).toEqual(['history_size']);
  });

  it('Ablehnen ohne vorherige Messung tut nichts (kein Zustand aus dem Nichts)', () => {
    ctx.svc.dismissOffer(ctx.projectId);
    expect(profil(ctx)).toBeNull();
  });

  it('pausiert UND teuer ergibt EINEN Text, der beide Gründe nennt (AC7/FR-013)', () => {
    setzeVerlauf(REFERENZ_VERLAUF);
    beendeTurn(ctx, TEUER);
    pausiere(ctx);

    const p = profil(ctx)!;
    expect(ctx.svc.workPaused(ctx.chatRepo.getActive(ctx.projectId)!)).toBe(true);
    expect(p.reasons).toEqual(['idle', 'history_size', 'context_per_turn']);
    expect(p.message).toContain('keine Aktivität');
    expect(p.message).toContain('16,8 MB');
    expect(p.message).toContain("265'673");
    expect(p.message?.match(/\./g)).toHaveLength(1); // ein Satz, nicht zwei Karten-Texte
  });

  it('pausiert und günstig nennt nur den Leerlauf', () => {
    setzeVerlauf(400 * 1024);
    beendeTurn(ctx, GUENSTIG);
    pausiere(ctx);

    const p = profil(ctx)!;
    expect(p.reasons).toEqual(['idle']);
    expect(p.offerOpen).toBe(false); // die bestehende Karte trägt den Leerlauf, kein Streifen
  });
});

/**
 * Doppelstart-Schutz. Zwischen „läuft schon eine Session?" und dem Spawn liegt ein
 * `await` auf die Worktree-Anlage — zwei gleichzeitige Aufrufe lasen beide „keine"
 * und spawnten beide eine. Am 28.07.2026 fünfmal beobachtet, zuletzt mit zwei
 * arbeitenden Claude-Prozessen in derselben Arbeitskopie.
 */
describe('ChatWorkService — ensure() koalesziert parallele Aufrufe', () => {
  let db: DB;
  let dataDir: string;
  let projectId: string;
  let spawns: number;
  let svc: ChatWorkService;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-cw-ensure-'));
    db = openMemoryDatabase();
    projectId = new ProjectRepo(db).create({
      name: 'Demo', path: '/tmp/demo', defaultBranch: 'main', color: null, enabledPhases: [],
      verifyCommands: [], automation: {}, mergeMode: 'ff', editorCmd: null, integrationMode: 'local',
    }).id;
    spawns = 0;

    const worktrees = {
      // Verzögert wie die echte Worktree-Anlage — genau hier klaffte das Zeitfenster.
      create: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return join(dataDir, 'wt');
      },
      pathFor: () => join(dataDir, 'wt'),
    } as unknown as WorktreeManager;

    const ptys = {
      forConversation: () => undefined, // nie eine laufende Session sehen: der Race-Fall
      spawn: async () => {
        spawns++;
        return { id: `s${spawns}`, pty: { pid: 1000 + spawns } } as unknown as LiveSession;
      },
    } as unknown as PtySessionManager;

    svc = new ChatWorkService({
      projects: new ProjectRepo(db), chatRepo: new ChatRepo(db), sessions: new SessionRepo(db),
      attention: new AttentionRepo(db), executions: new ExecutionRepo(db), settings: new SettingsRepo(db),
      worktrees, ptys, orchestrator: {} as unknown as Orchestrator, dataDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('drei gleichzeitige ensure() erzeugen genau eine Session', async () => {
    const results = await Promise.all([svc.ensure(projectId), svc.ensure(projectId), svc.ensure(projectId)]);

    expect(spawns).toBe(1);
    expect(new Set(results.map((r) => r.sessionId)).size).toBe(1);
  });

  it('nach Abschluss ist der Schutz wieder frei (kein dauerhaft blockiertes Projekt)', async () => {
    await svc.ensure(projectId);
    await svc.ensure(projectId);
    // Zweiter Aufruf läuft neu, weil der erste abgeschlossen ist — Koaleszenz gilt nur währenddessen.
    expect(spawns).toBe(2);
  });
});

/**
 * Regression: Eine Session, die noch arbeitet, darf nie abgeräumt werden — auch dann
 * nicht, wenn der Zustandsautomat sie nicht mehr als `working` führt. Nach
 * WORKING_STALL_SECONDS ohne Transkript-Schreibvorgang fällt `working` auf `ready`
 * zurück (Sicherheitsnetz für die Anzeige). Ein Agent, der länger nachdenkt oder auf
 * einen langen Build wartet, wurde dadurch mitten in der Arbeit beendet.
 */
describe('ChatWorkService — Reaper und laufende Ausgabe', () => {
  let db: DB;
  let dataDir: string;
  let projectId: string;
  let terminated: string[];
  let sessions: LiveSession[];
  let svc: ChatWorkService;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-cw-stall-'));
    db = openMemoryDatabase();
    projectId = new ProjectRepo(db).create({
      name: 'Demo', path: '/tmp/demo', defaultBranch: 'main', color: null, enabledPhases: [],
      verifyCommands: [], automation: {}, mergeMode: 'ff', editorCmd: null, integrationMode: 'local',
    }).id;
    terminated = [];
    sessions = [];

    const ptys = {
      list: () => sessions,
      terminate: async (id: string) => { terminated.push(id); },
      remove: () => {},
    } as unknown as PtySessionManager;

    svc = new ChatWorkService({
      projects: new ProjectRepo(db), chatRepo: new ChatRepo(db), sessions: new SessionRepo(db),
      attention: new AttentionRepo(db), executions: new ExecutionRepo(db), settings: new SettingsRepo(db),
      worktrees: {} as unknown as WorktreeManager, ptys,
      orchestrator: {} as unknown as Orchestrator, dataDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('verschont eine Session, die Ausgabe liefert, obwohl der Automat sie als ready führt', () => {
    const now = CHAT_HYGIENE_LIMITS.idleMs * 10;
    sessions = [
      {
        id: 'denkt-nach', kind: 'chat_work', exited: false, projectId, conversationId: 'c1',
        machine: { state: { kind: 'ready' } }, // stall_timeout hat working bereits zurückgesetzt
        lastActiveAt: 0,
        lastUsedAt: now - 5_000, // ...aber vor 5 Sekunden kam noch Ausgabe
        subscribers: new Set(),
      } as unknown as LiveSession,
    ];

    svc.reapIdleSessions(now);

    expect(terminated).toEqual([]);
  });
});
