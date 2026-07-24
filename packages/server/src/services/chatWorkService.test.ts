import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feature } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { AttentionRepo, ChatRepo, ExecutionRepo, ProjectRepo, SessionRepo, SettingsRepo } from '../db/repos.js';
import type { WorktreeManager } from '../git/worktrees.js';
import { isCleanWorkingTree } from '../git/git.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import type { Orchestrator } from './orchestrator.js';
import { ChatWorkService, CHAT_IDLE_TIMEOUT_MS } from './chatWorkService.js';

// Nur isCleanWorkingTree steuern; restliche git.js-Exporte real belassen.
vi.mock('../git/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git/git.js')>();
  return { ...actual, isCleanWorkingTree: vi.fn() };
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
      pathFor: (pid: string, name: string) => join(dataDir, 'worktrees', pid, name),
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
    svc.reapIdleSessions(CHAT_IDLE_TIMEOUT_MS + 1);
    expect(terminated).toEqual(['idle-old']);
  });

  it('würgt eine arbeitende Session nie ab', () => {
    sessions = [mkSession({ id: 'busy', machine: { state: { kind: 'working' } } as LiveSession['machine'], lastActiveAt: 0 })];
    svc.reapIdleSessions(CHAT_IDLE_TIMEOUT_MS * 10);
    expect(terminated).toEqual([]);
  });

  it('lässt eine noch frische Session in Ruhe', () => {
    sessions = [mkSession({ id: 'fresh', lastActiveAt: 1_000 })];
    svc.reapIdleSessions(1_000 + CHAT_IDLE_TIMEOUT_MS - 1);
    expect(terminated).toEqual([]);
  });

  it('ignoriert Nicht-Chat-Sessions (Feature/Shell)', () => {
    sessions = [mkSession({ id: 'feat', kind: 'feature', lastActiveAt: 0 })];
    svc.reapIdleSessions(CHAT_IDLE_TIMEOUT_MS + 1);
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
