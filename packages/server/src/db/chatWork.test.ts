import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type DB } from './database.js';
import { AttentionRepo, ChatRepo, ProjectRepo, SessionRepo } from './repos.js';

describe('Chat-Work-Migration & Bindungen', () => {
  let db: DB;
  let projectId: string;

  beforeEach(() => {
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
  });

  afterEach(() => db.close());

  it('neue Unterhaltung ist standardmäßig im ask-Modus', () => {
    const chat = new ChatRepo(db);
    const conv = chat.createConversation(projectId);
    expect(conv.mode).toBe('ask');
    expect(chat.getActive(projectId)?.mode).toBe('ask');
  });

  it('createConversation(work) + setMode persistieren den Modus', () => {
    const chat = new ChatRepo(db);
    const conv = chat.createConversation(projectId, 'work');
    expect(conv.mode).toBe('work');
    chat.setMode(conv.id, 'ask');
    expect(chat.getConversation(conv.id)?.mode).toBe('ask');
  });

  it('CHECK-Constraint verbietet ungültige Modi', () => {
    const chat = new ChatRepo(db);
    const conv = chat.createConversation(projectId);
    expect(() => db.prepare('UPDATE chat_conversations SET mode=? WHERE id=?').run('bogus', conv.id)).toThrow();
  });

  it('Session bindet an eine Unterhaltung; latestForConversation findet sie', () => {
    const chat = new ChatRepo(db);
    const sessions = new SessionRepo(db);
    const conv = chat.createConversation(projectId, 'work');
    sessions.create({ id: 's1', featureId: null, conversationId: conv.id, projectId, kind: 'chat_work', pid: 123 });
    const row = sessions.latestForConversation(conv.id);
    expect(row?.id).toBe('s1');
    expect(row?.conversation_id).toBe(conv.id);
    expect(row?.feature_id).toBeNull();
    expect(sessions.latestForFeature('nope')).toBeNull();
  });

  it('Attention trägt conversationId und dedupliziert darüber', () => {
    const chat = new ChatRepo(db);
    const attention = new AttentionRepo(db);
    const conv = chat.createConversation(projectId, 'work');
    const a = attention.raise({ kind: 'awaiting_input', projectId, conversationId: conv.id, message: 'Freigabe?' });
    expect(a.conversationId).toBe(conv.id);
    const again = attention.raise({ kind: 'awaiting_input', projectId, conversationId: conv.id, message: 'Freigabe?' });
    expect(again.id).toBe(a.id); // Dedup über conversationId
    expect(attention.listOpen().filter((i) => i.conversationId === conv.id)).toHaveLength(1);

    attention.resolveFor({ conversationId: conv.id });
    expect(attention.listOpen().filter((i) => i.conversationId === conv.id)).toHaveLength(0);
  });
});
