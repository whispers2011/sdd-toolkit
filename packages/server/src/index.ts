import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import {
  AttentionRepo,
  ChatRepo,
  ExecutionRepo,
  FeatureRepo,
  PersonaRepo,
  ProjectRepo,
  QueueRepo,
  SessionRepo,
  SettingsRepo,
} from './db/repos.js';
import { KnowledgeRepo } from './db/knowledgeRepo.js';
import { KnowledgeService } from './services/knowledgeService.js';
import { ChatService } from './services/chatService.js';
import { ChatWorkService } from './services/chatWorkService.js';
import { ReviewGateService } from './services/reviewGateService.js';
import { WorktreeManager } from './git/worktrees.js';
import { PtySessionManager } from './pty/sessionManager.js';
import { Orchestrator } from './services/orchestrator.js';
import { MergeQueueService } from './services/mergeQueueService.js';
import { OnboardingService } from './services/onboardingService.js';
import { ChangeGuard } from './services/changeGuard.js';
import { bus } from './events.js';
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
  const personas = new PersonaRepo(db);
  const knowledge = new KnowledgeRepo(db);
  const worktrees = new WorktreeManager(config.dataDir);

  const knowledgeService = new KnowledgeService({ knowledge, projects, features });

  // PTY-Callbacks delegieren an den (danach konstruierten) Orchestrator bzw. ChatWorkService.
  let orchestrator: Orchestrator;
  let chatWork: ChatWorkService;
  const ptys = new PtySessionManager(config.dataDir, {
    onStatusChange: (s, effects) => orchestrator.handleStatusChange(s, effects),
    onExit: (s, code) => orchestrator.handleExit(s, code),
    onClaudeSessionId: (s, id) => sessions.setClaudeSessionId(s.id, id),
    onAssistantText: (s, text) => {
      if (s.kind === 'chat_work') chatWork.onAssistantText(s, text);
    },
    onSubmitFailed: (s, text) => orchestrator.handleSubmitFailed(s, text),
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
    knowledge: knowledgeService,
    dataDir: config.dataDir,
  });

  const reviewGate = new ReviewGateService(personas, executions, config.dataDir);
  const mergeQueue = new MergeQueueService({
    projects,
    features,
    queue,
    executions,
    attention,
    settings,
    worktrees,
    ptys,
    reviewGate,
    dataDir: config.dataDir,
  });
  orchestrator.attachMergeQueue(mergeQueue);

  // Projekt-Chat (Ask-a-Question): Q&A-Turns, persistente Unterhaltung pro Projekt.
  const chatRepo = new ChatRepo(db);
  const chat = new ChatService({ projects, chat: chatRepo, executions, dataDir: config.dataDir });

  // Projekt-Chat als vollwertige Session: interaktive Claude-Session in isolierter Worktree
  // pro Projekt; kristallisiert sich ein Feature heraus, wird es über den Orchestrator angelegt.
  chatWork = new ChatWorkService({
    projects,
    chatRepo,
    sessions,
    attention,
    executions,
    settings,
    worktrees,
    ptys,
    orchestrator,
    dataDir: config.dataDir,
  });
  orchestrator.attachChatWork(chatWork);

  // Startup-Reaper: verwaiste running-States aus früheren Server-Läufen bereinigen.
  orchestrator.reapOnBoot();
  // Merge-Queue-Recovery: bei merging/conflict_resolving abgebrochene Items wieder aufnehmen.
  void mergeQueue.resumeInterruptedOnBoot();
  chat.interruptStreamingOnBoot();

  // Change-Guard (WP12): specs/** beobachten, Watcher-Menge bei Änderungen angleichen.
  const changeGuard = new ChangeGuard(projects, features, orchestrator);
  changeGuard.sync();
  let guardSyncTimer: NodeJS.Timeout | null = null;
  bus.onEvent('feature_updated', () => {
    if (guardSyncTimer) clearTimeout(guardSyncTimer);
    guardSyncTimer = setTimeout(() => changeGuard.sync(), 1000);
  });
  const guardInterval = setInterval(() => changeGuard.sync(), 30_000);

  const onboarding = new OnboardingService(projects, features);
  const app = await buildServer({
    projects,
    features,
    sessions,
    executions,
    attention,
    queue,
    settings,
    personas,
    knowledge,
    knowledgeService,
    orchestrator,
    mergeQueue,
    onboarding,
    chat,
    chatWork,
    ptys,
    dataDir: config.dataDir,
  });

  await app.listen({ port: config.port, host: config.host });
  console.log(`sdd-toolkit Server läuft auf http://${config.host}:${config.port}`);

  const shutdown = async () => {
    console.log('Fahre herunter — beende Sessions …');
    clearInterval(guardInterval);
    await changeGuard.stop();
    ptys.saveAllSnapshots();
    chat.killAll();
    chatWork.killAll();
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
