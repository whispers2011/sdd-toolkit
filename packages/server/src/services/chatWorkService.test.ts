import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { AttentionRepo, ChatRepo, ExecutionRepo, ProjectRepo, SessionRepo, SettingsRepo } from '../db/repos.js';
import { WorktreeManager } from '../git/worktrees.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import type { ChatService } from './chatService.js';
import { ChatWorkService } from './chatWorkService.js';
import { bus } from '../events.js';

function sh(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** Minimaler PTY-Stub: keine echte Claude-Session — nur was discard/integrate berühren. */
const ptyStub = {
  forConversation: () => undefined,
  terminate: async () => {},
  snapshots: { remove: () => {} },
} as unknown as PtySessionManager;

describe('ChatWorkService (Integration, ohne Claude)', () => {
  let repo: string;
  let dataDir: string;
  let db: DB;
  let svc: ChatWorkService;
  let chat: ChatRepo;
  let projectId: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-cw-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-cw-data-'));
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'app.txt'), 'zeile1\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);

    db = openMemoryDatabase();
    chat = new ChatRepo(db);
    const worktrees = new WorktreeManager(dataDir);
    projectId = new ProjectRepo(db).create({
      name: 'Demo',
      path: repo,
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;

    svc = new ChatWorkService({
      projects: new ProjectRepo(db),
      chat: {} as unknown as ChatService,
      chatRepo: chat,
      sessions: new SessionRepo(db),
      attention: new AttentionRepo(db),
      executions: new ExecutionRepo(db),
      settings: new SettingsRepo(db),
      worktrees,
      ptys: ptyStub,
      dataDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** Legt Worktree/Branch an wie ensure() es täte + eine uncommittete Änderung. */
  async function seedWorktree(): Promise<{ convId: string; worktreePath: string; branch: string }> {
    const conv = chat.createConversation(projectId, 'work');
    const worktrees = new WorktreeManager(dataDir);
    const worktreePath = await worktrees.create({
      projectId,
      projectPath: repo,
      featureName: `chat-${conv.id}`,
      branch: `chat/${conv.id}`,
      defaultBranch: 'main',
    });
    writeFileSync(join(worktreePath, 'neu.txt'), 'aus dem Chat\n');
    return { convId: conv.id, worktreePath, branch: `chat/${conv.id}` };
  }

  it('discard entfernt Worktree + Branch restlos und beendet die Unterhaltung', async () => {
    const { convId, worktreePath, branch } = await seedWorktree();
    expect(existsSync(worktreePath)).toBe(true);

    await svc.discard(projectId);

    expect(existsSync(worktreePath)).toBe(false);
    const branches = execFileSync('git', ['branch', '--list', branch], { cwd: repo, encoding: 'utf8' });
    expect(branches.trim()).toBe('');
    expect(chat.getActive(projectId)).toBeNull();
    // Haupt-Arbeitskopie unberührt (nur die init-Datei).
    expect(existsSync(join(repo, 'neu.txt'))).toBe(false);
  });

  it('integrate committet, merged nach main und räumt auf', async () => {
    const { worktreePath } = await seedWorktree();

    const integrated = new Promise<{ result: string }>((resolve) => {
      bus.once('chat_work_integrated', (p: { result: string }) => resolve(p));
    });
    svc.integrate(projectId);
    const result = (await Promise.race([
      integrated,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ])) as { result: string };

    expect(result.result).toBe('merged');
    expect(existsSync(join(repo, 'neu.txt'))).toBe(true); // nach main übernommen
    expect(existsSync(worktreePath)).toBe(false); // Cleanup
    expect(chat.getActive(projectId)).toBeNull();
  });
});
