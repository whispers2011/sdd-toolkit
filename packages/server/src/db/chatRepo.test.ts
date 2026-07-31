import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type DB } from './database.js';
import { ChatRepo, ProjectRepo } from './repos.js';

describe('ChatRepo', () => {
  let db: DB;
  let chat: ChatRepo;
  let projectId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    chat = new ChatRepo(db);
    const projects = new ProjectRepo(db);
    projectId = projects.create({
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
  });

  afterEach(() => db.close());

  it('ensureActive legt lazy an und liefert danach dieselbe Unterhaltung', () => {
    expect(chat.getActive(projectId)).toBeNull();
    const conv = chat.ensureActive(projectId);
    expect(chat.ensureActive(projectId).id).toBe(conv.id);
    expect(chat.getActive(projectId)?.id).toBe(conv.id);
  });

  it('Invariante: höchstens eine aktive Unterhaltung pro Projekt', () => {
    chat.createConversation(projectId);
    expect(() => chat.createConversation(projectId)).toThrow();
  });

  it('nach endConversation ist eine neue aktive Unterhaltung möglich', () => {
    const first = chat.createConversation(projectId);
    chat.endConversation(first.id);
    expect(chat.getActive(projectId)).toBeNull();
    const second = chat.createConversation(projectId);
    expect(second.id).not.toBe(first.id);
    expect(chat.getActive(projectId)?.id).toBe(second.id);
  });

  it('appendDelta akkumuliert nur solange die Nachricht streamt', () => {
    const conv = chat.createConversation(projectId);
    const msg = chat.createMessage({ conversationId: conv.id, role: 'assistant', content: '', status: 'streaming' });
    chat.appendDelta(msg.id, 'Hallo ');
    chat.appendDelta(msg.id, 'Welt');
    expect(chat.getMessage(msg.id)?.content).toBe('Hallo Welt');

    chat.finalizeMessage(msg.id, { status: 'complete' });
    chat.appendDelta(msg.id, '!!!');
    expect(chat.getMessage(msg.id)?.content).toBe('Hallo Welt');
  });

  it('finalizeMessage ist terminal — zweiter Abschluss wirkt nicht mehr', () => {
    const conv = chat.createConversation(projectId);
    const msg = chat.createMessage({ conversationId: conv.id, role: 'assistant', content: '', status: 'streaming' });
    chat.finalizeMessage(msg.id, {
      status: 'complete',
      content: 'Antwort',
      proposal: { name: 'x', description: 'y', status: 'offen' },
      tokens: 42,
    });
    chat.finalizeMessage(msg.id, { status: 'error', error: 'zu spät' });

    const stored = chat.getMessage(msg.id)!;
    expect(stored.status).toBe('complete');
    expect(stored.content).toBe('Antwort');
    expect(stored.error).toBeNull();
    expect(stored.proposal).toEqual({ name: 'x', description: 'y', status: 'offen' });
    expect(stored.tokens).toBe(42);
  });

  it('interruptStreaming markiert alle streamenden Nachrichten (Boot-Cleanup)', () => {
    const conv = chat.createConversation(projectId);
    chat.createMessage({ conversationId: conv.id, role: 'user', content: 'Frage', status: 'complete' });
    const streaming = chat.createMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'halb…',
      status: 'streaming',
    });
    expect(chat.interruptStreaming()).toBe(1);
    expect(chat.getMessage(streaming.id)?.status).toBe('interrupted');
    const roles = chat.listMessages(conv.id).map((m) => m.status);
    expect(roles).toEqual(['complete', 'interrupted']);
  });

  it('listMessages liefert stabile Reihenfolge auch bei gleichem Zeitstempel', () => {
    const conv = chat.createConversation(projectId);
    const a = chat.createMessage({ conversationId: conv.id, role: 'user', content: 'a', status: 'complete' });
    const b = chat.createMessage({ conversationId: conv.id, role: 'assistant', content: 'b', status: 'complete' });
    expect(chat.listMessages(conv.id).map((m) => m.id)).toEqual([a.id, b.id]);
  });

  it('setProposal + setClaudeSessionId persistieren Entscheidungen und Resume-ID', () => {
    const conv = chat.createConversation(projectId);
    const msg = chat.createMessage({ conversationId: conv.id, role: 'assistant', content: '', status: 'streaming' });
    chat.finalizeMessage(msg.id, {
      status: 'complete',
      content: 'ok',
      proposal: { name: 'pdf-export', description: 'PDF', status: 'offen' },
    });
    chat.setProposal(msg.id, { name: 'pdf-export', description: 'PDF', status: 'angenommen', featureId: 'f1' });
    expect(chat.getMessage(msg.id)?.proposal).toEqual({
      name: 'pdf-export',
      description: 'PDF',
      status: 'angenommen',
      featureId: 'f1',
    });

    chat.setClaudeSessionId(conv.id, 'sess-1');
    expect(chat.getActive(projectId)?.claudeSessionId).toBe('sess-1');
  });
});
