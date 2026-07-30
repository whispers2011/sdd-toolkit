import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import {
  AttentionRepo,
  ChatRepo,
  ExecutionRepo,
  FeatureRepo,
  ProjectRepo,
  QueueRepo,
  ReviewCommentRepo,
  SessionRepo,
  SettingsRepo,
} from './db/repos.js';
import { AgentRepo, AgentRunRepo } from './db/agentRepo.js';
import { KnowledgeRepo } from './db/knowledgeRepo.js';
import { PlausibilityRepo } from './db/plausibilityRepo.js';
import { PlausibilityService } from './services/plausibilityService.js';
import { KnowledgeService } from './services/knowledgeService.js';
import { AtlassianMcpClient } from './services/atlassianMcpClient.js';
import { JiraBrowseService } from './services/jiraBrowseService.js';
import { JiraImportService } from './services/jiraImportService.js';
import { FeatureDocumentsService } from './services/featureDocuments.js';
import { ChatService } from './services/chatService.js';
import { ChatWorkService } from './services/chatWorkService.js';
import { AgentGateService } from './services/agentGateService.js';
import { WorktreeManager } from './git/worktrees.js';
import { PtySessionManager } from './pty/sessionManager.js';
import { Orchestrator } from './services/orchestrator.js';
import { MergeQueueService } from './services/mergeQueueService.js';
import { OnboardingService } from './services/onboardingService.js';
import { WorktreeOverviewService } from './services/worktreeOverviewService.js';
import { ChangeGuard } from './services/changeGuard.js';
import { HeartbeatStore } from './services/heartbeatStore.js';
import { OperationsLog, describeError } from './services/operationsLog.js';
import { OutageMonitor } from './services/outageMonitor.js';
import { bus } from './events.js';
import { buildServer } from './api/server.js';
import { TelemetryStore } from './telemetry/telemetryStore.js';
import { nanoid } from 'nanoid';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dataDir);

  // Verbrauchsmeldungen der CLI (Feature "token-und-kostenmessung..."). Der Puffer
  // steht vor allem anderen, damit jeder gespawnte Prozess seine Marke schon
  // mitbekommt und nichts verloren geht.
  const telemetry = new TelemetryStore();

  const projects = new ProjectRepo(db);
  const features = new FeatureRepo(db);
  const sessions = new SessionRepo(db);
  const executions = new ExecutionRepo(db);
  const attention = new AttentionRepo(db);
  const queue = new QueueRepo(db);
  const settings = new SettingsRepo(db);
  const agents = new AgentRepo(db);
  const agentRuns = new AgentRunRepo(db);
  const reviewComments = new ReviewCommentRepo(db);
  const knowledge = new KnowledgeRepo(db);
  const worktrees = new WorktreeManager(config.dataDir);

  // Betriebsspuren (Feature „server-ausfaelle-sichtbar-machen"): Lebenszeichen und
  // Betriebsprotokoll neben der Datenbank. Der Ausfall vom 30.07.2026 stand in keinem
  // einzigen Betriebsdatensatz — ab hier hinterlässt jeder Lauf eine Spur.
  //
  // Die Reihenfolge ist verbindlich: `detectOnBoot()` liest die betroffenen Läufe,
  // SOLANGE sie als `running` geführt werden. Der Start-Reaper weiter unten
  // (`orchestrator.reapOnBoot()`) setzt sie auf `orphaned` und zerstört damit genau die
  // Information, die die Ausfallmeldung braucht (research.md D3, contracts/attention-item.md).
  const instanceId = nanoid(10);
  const startedAt = Date.now();
  const operationsLog = new OperationsLog(config.dataDir);
  const heartbeatStore = new HeartbeatStore(config.dataDir);
  const outageMonitor = new OutageMonitor({
    executions,
    attention,
    features,
    operationsLog,
    heartbeatStore,
    instanceId,
    startedAt,
  });
  outageMonitor.detectOnBoot();
  outageMonitor.startHeartbeat();

  const knowledgeService = new KnowledgeService({ knowledge, projects, features });

  // PTY-Callbacks delegieren an den (danach konstruierten) Orchestrator bzw. ChatWorkService.
  let orchestrator: Orchestrator;
  let chatWork: ChatWorkService;
  const ptys = new PtySessionManager(config.dataDir, config.port, {
    onStatusChange: (s, effects) => orchestrator.handleStatusChange(s, effects),
    onExit: (s, code) => orchestrator.handleExit(s, code),
    onClaudeSessionId: (s, id) => sessions.setClaudeSessionId(s.id, id),
    onAssistantText: (s, text) => {
      if (s.kind === 'chat_work') chatWork.onAssistantText(s, text);
    },
    onSubmitFailed: (s, text) => orchestrator.handleSubmitFailed(s, text),
    onSubmitConfirmed: (s, text) => orchestrator.handleSubmitConfirmed(s, text),
  });

  const agentGate = new AgentGateService({
    agents,
    agentRuns,
    executions,
    attention,
    dataDir: config.dataDir,
    port: config.port,
  });

  // Feature-Dokumente (Ablage + Manifest); vor dem Orchestrator, der den
  // Dokument-Verweis in jeden Phasenauftrag hängt.
  const featureDocuments = new FeatureDocumentsService({ projects, features });

  // Plausibilitätsprüfung: beurteilt gespeicherte Läufe, greift nie ein. Vor dem
  // Orchestrator gebaut und ihm als optionale Abhängigkeit übergeben — der Service
  // hängt nicht am Orchestrator, damit bestehende Orchestrator-Tests unberührt bleiben.
  const plausibility = new PlausibilityService({
    executions,
    features,
    projects,
    attention,
    state: new PlausibilityRepo(db),
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
    featureDocuments,
    agentGate,
    dataDir: config.dataDir,
    telemetry,
    plausibility,
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
    agentGate,
    dataDir: config.dataDir,
    port: config.port,
  });
  orchestrator.attachMergeQueue(mergeQueue);

  // Projekt-Chat (Ask-a-Question): Q&A-Turns, persistente Unterhaltung pro Projekt.
  const chatRepo = new ChatRepo(db);
  const chat = new ChatService({ projects, chat: chatRepo, executions, dataDir: config.dataDir, port: config.port });

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
    telemetry,
  });
  orchestrator.attachChatWork(chatWork);

  // Jira-Import (US1–US4): MCP-Client auf Nutzerebene + Browse-/Import-Services.
  const jira = new AtlassianMcpClient({
    dataDir: config.dataDir,
    callbackUrl: `http://127.0.0.1:${config.port}/api/jira/oauth/callback`,
  });
  const jiraBrowse = new JiraBrowseService(jira);
  const jiraImport = new JiraImportService({ jira, features, orchestrator });

  // Startup-Reaper: verwaiste running-States aus früheren Server-Läufen bereinigen.
  // NIEMALS vor `outageMonitor.detectOnBoot()` ziehen — siehe Kommentar dort.
  orchestrator.reapOnBoot();
  // Reihenfolge ist verbindlich: erst der Reaper, dann die erste Beurteilung. Sonst
  // sähe die Prüfung running-Leichen ohne finished_at (kein Befund, aber die Absicht
  // wäre unklar). Der erste Lauf macht den vorhandenen Bestand sichtbar (FR-002).
  plausibility.check();
  // Merge-Queue-Recovery SEQUENZIELL (nie unawaited parallel): zwei gleichzeitige
  // Worktree-Reparaturen würden sonst denselben feature/<name>-Branch doppelt anlegen
  // → „cannot lock ref … reference already exists". Erst Restanzen bereits gemergter
  // Features abräumen, dann unterbrochene Items selbstheilend wieder aufnehmen.
  void (async () => {
    try {
      await mergeQueue.reconcileMergedLeftovers();
      await mergeQueue.resumeInterruptedOnBoot();
    } catch (err) {
      console.error('[boot] Merge-Queue-Recovery fehlgeschlagen:', err);
    }
  })();
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

  // Projekt-Chat-Leerlauf-Reaper: inaktive chat_work-Sessions nach 5 min beenden,
  // damit keine Session im Hintergrund weiterläuft (Ressourcen-Hygiene).
  const chatIdleInterval = setInterval(() => chatWork.reapIdleSessions(), 60_000);

  // Zuordnungswächter: schreibt ein Agent, ohne dass ein Schritt offen ist, wird sein
  // Verbrauch nicht gemessen und der Phasenzustand behauptet Fertigstellung, die es
  // nicht gibt (Befund A12 vom 30.07.2026). Nur melden, nicht eingreifen.
  const workWithoutRunInterval = setInterval(() => orchestrator.checkWorkWithoutRun(), 60_000);

  // Bestandsprüfung im selben Takt: Befund C („Projekt mit Features, aber nie ein
  // Phasenlauf") lässt sich nicht am Laufabschluss aufhängen — dort endet nie ein Lauf.
  const plausibilityInterval = setInterval(() => plausibility.check(), 60_000);

  const onboarding = new OnboardingService(projects, features);

  // Worktree-Übersicht: tool-weite Sicht auf Git-Realität + Feature-Zuordnung.
  const worktreeOverview = new WorktreeOverviewService({ projects, features, ptys, worktrees, bus });

  const app = await buildServer({
    allowedOrigins: config.allowedOrigins,
    projects,
    features,
    sessions,
    executions,
    attention,
    queue,
    settings,
    agents,
    agentRuns,
    agentGate,
    reviewComments,
    knowledge,
    knowledgeService,
    orchestrator,
    mergeQueue,
    onboarding,
    chat,
    chatWork,
    jira,
    jiraBrowse,
    jiraImport,
    featureDocuments,
    worktreeOverview,
    worktrees,
    ptys,
    telemetry,
    dataDir: config.dataDir,
    webDir: config.webDir,
    port: config.port,
  });

  await app.listen({ port: config.port, host: config.host });
  console.log(`sdd-toolkit Server läuft auf http://${config.host}:${config.port}`);
  console.log(config.webDir ? `Web-Bundle wird ausgeliefert aus ${config.webDir}` : 'Web: Dev-Modus (Vite)');

  const shutdown = async (signal: string) => {
    console.log('Fahre herunter — beende Sessions …');
    clearInterval(guardInterval);
    clearInterval(chatIdleInterval);
    clearInterval(workWithoutRunInterval);
    clearInterval(plausibilityInterval);
    await changeGuard.stop();
    ptys.saveAllSnapshots();
    chat.killAll();
    chatWork.killAll();
    await Promise.allSettled(ptys.list().map((s) => ptys.terminate(s.id)));
    await app.close();
    // Takt anhalten und den geordneten Abgang im Lebenszeichen vermerken — danach ist
    // eine Lücke beliebiger Länge kein Ausfall mehr (FR-002).
    outageMonitor.stop();
    // Abgang festhalten, bevor die Datenbank zugeht. Das Protokoll ist eine eigene
    // Datei genau deshalb: hier ist die DB gleich weg, und `process.on('exit')` unten
    // könnte ohnehin nur noch synchron schreiben (D6, C2.7).
    operationsLog.appendFarewell({
      ts: Date.now(),
      instanceId,
      kind: 'shutdown',
      signal,
      uptimeMs: Date.now() - startedAt,
    });
    db.close();
    process.exit(0);
  };
  // SIGINT (Ctrl-C im Terminal) und SIGTERM (`kill`) laufen beide durch denselben
  // geordneten Pfad — sie sind beide „geordnetes Herunterfahren". Unterscheidbar bleiben
  // sie über das mitgeführte Signal, nicht über eine erfundene Wertung (D8).
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGHUP', () => void shutdown('SIGHUP'));

  // Letzte Gelegenheit für den Abgangseintrag — etwa bei `process.exit()` aus einem
  // anderen Pfad. `'exit'` verwirft asynchrone Arbeit, deshalb schreibt das Protokoll
  // synchron (C2.7). Das Once-Flag verhindert die Dublette aus
  // shutdown() → process.exit(0) → 'exit' (C2.2).
  process.on('exit', (exitCode) => {
    operationsLog.appendFarewell({
      ts: Date.now(),
      instanceId,
      kind: 'exit',
      exitCode,
      uptimeMs: Date.now() - startedAt,
    });
  });

  // Letztes Sicherheitsnetz: ein Fehler in einem Hintergrund-Timer, PTY-Event
  // oder einer gevoideten Promise darf den Server NICHT beenden. Node 22 würde
  // sonst (Default „throw") den ganzen Prozess reißen — das Toolkit „beendet
  // sich selbst". Loggen und weiterlaufen.
  //
  // Der Vorfall wird zusätzlich protokolliert: er beantwortet beim Nachlesen die Frage
  // „ist der Server an sich selbst gestorben?". Ein `uncaught`-Eintrag ist deshalb KEIN
  // Abgang — der Guard beendet den Prozess nicht, und das Once-Flag des Abgangs bleibt
  // unberührt (C2.3, FR-013).
  process.on('unhandledRejection', (reason) => {
    console.error('[fatal-guard] Unbehandelte Promise-Rejection (Server läuft weiter):', reason);
    operationsLog.append({ ts: Date.now(), instanceId, kind: 'uncaught', error: describeError(reason) });
  });
  process.on('uncaughtException', (err) => {
    console.error('[fatal-guard] Unbehandelte Exception (Server läuft weiter):', err);
    operationsLog.append({ ts: Date.now(), instanceId, kind: 'uncaught', error: describeError(err) });
  });
}

main().catch((err) => {
  console.error('Serverstart fehlgeschlagen:', err);
  process.exit(1);
});
