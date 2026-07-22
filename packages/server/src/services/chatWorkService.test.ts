import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Feature } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { AttentionRepo, ChatRepo, ExecutionRepo, ProjectRepo, SessionRepo, SettingsRepo } from '../db/repos.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import type { Orchestrator } from './orchestrator.js';
import { ChatWorkService } from './chatWorkService.js';

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
