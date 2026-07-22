import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import {
  AttentionRepo,
  ExecutionRepo,
  FeatureRepo,
  ProjectRepo,
  QueueRepo,
  SessionRepo,
  SettingsRepo,
} from './db/repos.js';
import { WorktreeManager } from './git/worktrees.js';
import { PtySessionManager } from './pty/sessionManager.js';
import { Orchestrator } from './services/orchestrator.js';
import { MergeQueueService } from './services/mergeQueueService.js';
import { OnboardingService } from './services/onboardingService.js';
import { buildServer } from './api/server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dataDir);

  const projects = new ProjectRepo(db);
  const features = new FeatureRepo(db);
  const sessions = new SessionRepo(db);
  const executions = new ExecutionRepo(db);
  const attention = new AttentionRepo(db);
  const queue = new QueueRepo(db);
  const settings = new SettingsRepo(db);
  const worktrees = new WorktreeManager(config.dataDir);

  // PTY-Callbacks delegieren an den (danach konstruierten) Orchestrator.
  let orchestrator: Orchestrator;
  const ptys = new PtySessionManager(config.dataDir, {
    onStatusChange: (s, effects) => orchestrator.handleStatusChange(s, effects),
    onExit: (s, code) => orchestrator.handleExit(s, code),
    onClaudeSessionId: (s, id) => sessions.setClaudeSessionId(s.id, id),
  });

  orchestrator = new Orchestrator({
    projects,
    features,
    sessions,
    executions,
    attention,
    settings,
    worktrees,
    ptys,
    dataDir: config.dataDir,
  });

  const mergeQueue = new MergeQueueService({
    projects,
    features,
    queue,
    executions,
    attention,
    settings,
    worktrees,
    ptys,
    dataDir: config.dataDir,
  });
  orchestrator.attachMergeQueue(mergeQueue);

  // Startup-Reaper: verwaiste running-States aus früheren Server-Läufen bereinigen.
  orchestrator.reapOnBoot();

  const onboarding = new OnboardingService(projects, features);
  const app = await buildServer({
    projects,
    features,
    sessions,
    executions,
    attention,
    queue,
    settings,
    orchestrator,
    mergeQueue,
    onboarding,
    ptys,
  });

  await app.listen({ port: config.port, host: config.host });
  console.log(`sdd-toolkit Server läuft auf http://${config.host}:${config.port}`);

  const shutdown = async () => {
    console.log('Fahre herunter — beende Sessions …');
    ptys.saveAllSnapshots();
    await Promise.allSettled(ptys.list().map((s) => ptys.terminate(s.id)));
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('Serverstart fehlgeschlagen:', err);
  process.exit(1);
});
