import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type DB } from '../db/database.js';
import {
  AttentionRepo,
  ChatRepo,
  ExecutionRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
} from '../db/repos.js';
import { WorktreeManager } from '../git/worktrees.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import type { Orchestrator } from './orchestrator.js';
import { ChatWorkService } from './chatWorkService.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Nachziehen (P1) und Übernehmen (P2) der Wissens-Chat-Arbeitskopie gegen ein echtes Repo.
 * Der PTY-Layer wird gestubbt — geprüft wird ausschließlich der git-Fluss.
 */
describe('ChatWorkService — Arbeitskopie nachziehen & übernehmen (Integration)', () => {
  let repo: string;
  let dataDir: string;
  let db: DB;
  let worktrees: WorktreeManager;
  let chatRepo: ChatRepo;
  let svc: ChatWorkService;
  let projectId: string;
  let convId: string;
  let worktreePath: string;

  const ptysStub = { forConversation: () => undefined } as unknown as PtySessionManager;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-chat-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-chat-data-'));
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'app.txt'), 'init\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);

    db = openMemoryDatabase();
    const projects = new ProjectRepo(db);
    chatRepo = new ChatRepo(db);
    worktrees = new WorktreeManager(dataDir);
    projectId = projects.create({
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
      projects,
      chatRepo,
      sessions: new SessionRepo(db),
      attention: new AttentionRepo(db),
      executions: new ExecutionRepo(db),
      settings: new SettingsRepo(db),
      worktrees,
      ptys: ptysStub,
      orchestrator: {} as unknown as Orchestrator,
      dataDir,
    });

    // Arbeitskopie wie beim Chat-Start anlegen (ohne Session zu spawnen).
    const conv = chatRepo.ensureActive(projectId, 'work');
    convId = conv.id;
    worktreePath = await worktrees.create({
      projectId,
      projectPath: repo,
      featureName: `chat-${conv.id}`,
      branch: `chat/${conv.id}`,
      defaultBranch: 'main',
    });
    sh(worktreePath, ['config', 'user.email', 'test@test.local']);
    sh(worktreePath, ['config', 'user.name', 'Test']);
  });

  afterEach(() => {
    db.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** main um einen Commit voranbringen — die Arbeitskopie hinkt danach hinterher. */
  function advanceMain(): void {
    writeFileSync(join(repo, 'neu.txt'), 'aus main\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'main voraus']);
  }

  describe('Nachziehen', () => {
    it('rebased eine saubere, veraltete Arbeitskopie automatisch auf main', async () => {
      advanceMain();

      const sync = await svc.syncWorktree(projectId, worktreePath);

      expect(sync).toEqual({ behind: 0, dirty: false, state: 'rebased' });
      // Der neue main-Stand ist jetzt in der Arbeitskopie sichtbar.
      expect(existsSync(join(worktreePath, 'neu.txt'))).toBe(true);
    });

    it('lässt eine aktuelle Arbeitskopie unangetastet', async () => {
      const sync = await svc.syncWorktree(projectId, worktreePath);
      expect(sync).toEqual({ behind: 0, dirty: false, state: 'current' });
    });

    it('zieht NICHT nach, solange uncommittete Arbeit im Weg ist', async () => {
      advanceMain();
      writeFileSync(join(worktreePath, 'wip.txt'), 'halbfertig\n');

      const sync = await svc.syncWorktree(projectId, worktreePath);

      expect(sync).toEqual({ behind: 1, dirty: true, state: 'blocked_dirty' });
      // Die Arbeit des Nutzers bleibt unberührt, main-Stand kommt NICHT dazu.
      expect(readFileSync(join(worktreePath, 'wip.txt'), 'utf8')).toBe('halbfertig\n');
      expect(existsSync(join(worktreePath, 'neu.txt'))).toBe(false);
    });

    it('rollt einen konfliktbehafteten Rebase zurück und meldet ihn', async () => {
      // Beide Seiten ändern dieselbe Zeile → Rebase kollidiert.
      writeFileSync(join(worktreePath, 'app.txt'), 'chat-variante\n');
      sh(worktreePath, ['commit', '-am', 'chat ändert app.txt']);
      writeFileSync(join(repo, 'app.txt'), 'main-variante\n');
      sh(repo, ['commit', '-am', 'main ändert app.txt']);

      const sync = await svc.syncWorktree(projectId, worktreePath);

      expect(sync.state).toBe('conflict');
      expect(sync.behind).toBe(1);
      // Kein halb fertiger Rebase — HEAD steht wieder auf dem Branch, nicht detached.
      expect(sh(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe(`chat/${convId}`);
      expect(readFileSync(join(worktreePath, 'app.txt'), 'utf8')).toBe('chat-variante\n');
    });
  });

  describe('Übernehmen', () => {
    it('committet uncommittete Arbeit, rebased und merged sie nach main', async () => {
      writeFileSync(join(worktreePath, 'feature.txt'), 'chat-arbeit\n');
      advanceMain(); // main läuft parallel weiter → Rebase ist nötig

      const res = await svc.adopt(projectId);

      expect(res).toMatchObject({ target: 'main', committed: true });
      expect('files' in res && res.files).toBe(1);
      // In main angekommen — und der Nebenast von main ist ebenfalls erhalten.
      expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe('chat-arbeit\n');
      expect(existsSync(join(repo, 'neu.txt'))).toBe(true);
      // Arbeitskopie ist danach deckungsgleich → kein zweites Leben derselben Änderung.
      expect(sh(repo, ['rev-parse', 'main']).trim()).toBe(
        sh(worktreePath, ['rev-parse', 'HEAD']).trim(),
      );
    });

    it('übernimmt auch bereits committete Chat-Arbeit', async () => {
      writeFileSync(join(worktreePath, 'feature.txt'), 'chat-arbeit\n');
      sh(worktreePath, ['add', '-A']);
      sh(worktreePath, ['commit', '-m', 'chat commit']);

      const res = await svc.adopt(projectId);

      expect(res).toMatchObject({ target: 'main', committed: false, files: 1 });
      expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe('chat-arbeit\n');
    });

    it('meldet „nichts zu übernehmen" bei unveränderter Arbeitskopie', async () => {
      const res = await svc.adopt(projectId);
      expect(res).toMatchObject({ blocked: 'nothing' });
    });

    it('bricht bei Konflikten folgenlos ab (main bleibt unverändert)', async () => {
      writeFileSync(join(worktreePath, 'app.txt'), 'chat-variante\n');
      sh(worktreePath, ['commit', '-am', 'chat ändert app.txt']);
      writeFileSync(join(repo, 'app.txt'), 'main-variante\n');
      sh(repo, ['commit', '-am', 'main ändert app.txt']);
      const mainBefore = sh(repo, ['rev-parse', 'main']).trim();

      const res = await svc.adopt(projectId);

      expect(res).toMatchObject({ blocked: 'conflict' });
      expect('files' in res && res.files).toContain('app.txt');
      expect(sh(repo, ['rev-parse', 'main']).trim()).toBe(mainBefore);
      expect(readFileSync(join(repo, 'app.txt'), 'utf8')).toBe('main-variante\n');
    });

    it('verweigert die Übernahme bei dreckigem Haupt-Checkout, ohne etwas zu verlieren', async () => {
      writeFileSync(join(worktreePath, 'feature.txt'), 'chat-arbeit\n');
      writeFileSync(join(repo, 'app.txt'), 'lokale bearbeitung im haupt-checkout\n'); // PhpStorm-Fall

      const res = await svc.adopt(projectId);

      expect(res).toMatchObject({ blocked: 'merge' });
      expect('message' in res && res.message).toMatch(/Haupt-Checkout/);
      // Die Chat-Arbeit ist committet und bleibt auf dem Branch erhalten — nichts verloren.
      expect(readFileSync(join(worktreePath, 'feature.txt'), 'utf8')).toBe('chat-arbeit\n');
      expect(sh(worktreePath, ['log', '--oneline', 'main..HEAD'])).toContain('Wissens-Chat');
    });
  });
});
