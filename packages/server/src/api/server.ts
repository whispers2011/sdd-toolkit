import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { WS_ORIGIN_REJECTED, isOriginAllowed, registerOriginGuard } from './originGuard.js';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { readFile } from 'node:fs/promises';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { exec, execFile } from 'node:child_process';
import { loginShellEnv } from '../pty/loginShellEnv.js';
import type { AgentDefinition, ApproveMergeRequest, FeaturePhase } from '@sdd/shared';
import {
  FEATURE_PHASES,
  aggregateBreakdown,
  buildRunSummaries,
  compileReviewPrompt,
  detectCycle,
  orderedPhases,
  renderTranscriptLog,
  reopenLastPhase,
} from '@sdd/shared';
import type {
  AttentionRepo,
  ExecutionRepo,
  FeatureRepo,
  ProjectRepo,
  QueueRepo,
  ReviewCommentRepo,
  SessionRepo,
  SettingsRepo,
} from '../db/repos.js';
import type { AgentRepo, AgentRunRepo } from '../db/agentRepo.js';
import type { AgentGateService } from '../services/agentGateService.js';
import type { KnowledgeRepo } from '../db/knowledgeRepo.js';
import type { KnowledgeService } from '../services/knowledgeService.js';
import type { Applicability, SelectionDecision } from '@sdd/shared';
import type { Orchestrator } from '../services/orchestrator.js';
import { MergeApprovalError, type MergeQueueService } from '../services/mergeQueueService.js';
import { JiraAuthRequiredError, JiraUnreachableError } from '../services/atlassianMcpClient.js';
import type { AtlassianMcpClient } from '../services/atlassianMcpClient.js';
import type { JiraBrowseService } from '../services/jiraBrowseService.js';
import type { JiraImportService } from '../services/jiraImportService.js';
import type { JiraSelection } from '@sdd/shared';
import type { OnboardingService } from '../services/onboardingService.js';
import type { ChatService } from '../services/chatService.js';
import type { ChatWorkService } from '../services/chatWorkService.js';
import type { WorktreeOverviewService } from '../services/worktreeOverviewService.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import { locateTranscript, readTranscriptRange, transcriptSize } from '../pty/transcriptWatcher.js';
import { readBranch } from '../git/branchReader.js';
import { git } from '../git/git.js';
import type { WorktreeManager } from '../git/worktrees.js';
import { collectUnmergedChanges, hasUnmergedChanges, unmergedFileDiff } from '../services/unmergedChanges.js';
import { ActionGuard } from '../services/actionGuard.js';
import { registerOtlpRoute } from '../telemetry/otlpRoute.js';
import { TelemetryStore } from '../telemetry/telemetryStore.js';
import { detectForeignOtelConfig, telemetryEndpoint } from '../telemetry/telemetryEnv.js';
import { hasSpecKit, phaseDefinitionPath } from '../services/artifacts.js';
import { DefinitionError, readPhaseDefinition, writePhaseDefinition } from '../services/phaseDefinition.js';
import {
  ArtifactError,
  listFeatureArtifactSteps,
  readFeatureArtifact,
  writeFeatureArtifact,
} from '../services/featureArtifacts.js';
import { bus, BUS_EVENT_NAMES } from '../events.js';
import { displayStatus } from '@sdd/shared';
import { registerReviewRoutes } from './reviewRoutes.js';
import { registerWorktreeRoutes } from './worktreeRoutes.js';

export interface ApiDeps {
  projects: ProjectRepo;
  features: FeatureRepo;
  sessions: SessionRepo;
  executions: ExecutionRepo;
  attention: AttentionRepo;
  queue: QueueRepo;
  settings: SettingsRepo;
  agents: AgentRepo;
  agentRuns: AgentRunRepo;
  agentGate: AgentGateService;
  reviewComments: ReviewCommentRepo;
  knowledge: KnowledgeRepo;
  knowledgeService: KnowledgeService;
  orchestrator: Orchestrator;
  mergeQueue: MergeQueueService;
  onboarding: OnboardingService;
  chat: ChatService;
  chatWork: ChatWorkService;
  jira: AtlassianMcpClient;
  jiraBrowse: JiraBrowseService;
  jiraImport: JiraImportService;
  worktreeOverview: WorktreeOverviewService;
  worktrees: WorktreeManager;
  ptys: PtySessionManager;
  /** Puffer der Verbrauchsmeldungen (Feature "token-und-kostenmessung..."). */
  telemetry: TelemetryStore;
  dataDir: string;
  /** Port, unter dem der Server erreichbar ist — Ziel der Telemetrie-Meldungen. */
  port: number;
  /** Gebautes Web-Bundle für den Prod-Ein-Prozess-Modus; null/undefined = Web nicht ausliefern (Dev). */
  webDir?: string | null;
  /** Browser-Origins, die HTTP-API und WebSockets nutzen dürfen (api/originGuard.ts). */
  allowedOrigins: readonly string[];
}

export async function buildServer(deps: ApiDeps) {
  const app = Fastify({ logger: { level: 'info' } });
  // Der lokale Server ist über localhost von JEDER Webseite erreichbar — ohne
  // Origin-Prüfung könnte eine beliebige Seite im Browser die API bedienen.
  const allowedOrigins = deps.allowedOrigins;
  registerOriginGuard(app, allowedOrigins);
  await app.register(cors, { origin: (origin, cb) => cb(null, isOriginAllowed(origin, allowedOrigins)) });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  // OTLP-Empfänger der Claude-CLI (contracts/otlp-receiver.md). Gekapselt, mit
  // eigenem nachsichtigen JSON-Parser — antwortet IMMER 200.
  registerOtlpRoute(app, deps.telemetry);

  // Serverseitige Durchsetzung der Aktions-Policy (FR-024): dieselbe Festlegung,
  // die die Oberfläche rendert — kein Bedienweg kommt an ihr vorbei.
  const actionGuard = new ActionGuard({
    features: deps.features,
    ptys: deps.ptys,
    orchestrator: deps.orchestrator,
  });

  // Review-Portal-Routen (Übersicht, Branches, Dateibaum/Editor, Kommentare, Audits).
  registerReviewRoutes(app, {
    projects: deps.projects,
    features: deps.features,
    executions: deps.executions,
    reviewComments: deps.reviewComments,
    agentRuns: deps.agentRuns,
  });

  // Worktree-Übersicht (tool-weit: Bestand, geänderte Dateien, Warnungen, Aufräumen).
  registerWorktreeRoutes(app, { worktreeOverview: deps.worktreeOverview });

  // ---------- Bootstrap ----------

  app.get('/api/state', () => {
    // Read-Sicherheitsnetz: überholte Meldungen vor dem Bootstrap-Snapshot auflösen.
    deps.orchestrator.reconcileOpenAttention();
    const projects = deps.projects.list();
    const features = deps.features.listAll();
    const liveSessions = deps.ptys.list().map((s) => ({
      id: s.id,
      projectId: s.projectId,
      featureId: s.featureId,
      conversationId: s.conversationId,
      kind: s.kind,
      status: displayStatus(s.machine.state),
      awaitingKind: s.machine.state.kind === 'awaiting_input' ? s.machine.state.awaiting : null,
      exited: s.exited,
      lastActiveAt: s.lastActiveAt,
    }));
    return {
      projects: projects.map((p) => ({ ...p, currentBranch: readBranch(p.path), specKit: hasSpecKit(p.path) })),
      features,
      sessions: liveSessions,
      attention: deps.attention.listOpen(),
      queues: Object.fromEntries(projects.map((p) => [p.id, deps.queue.listByProject(p.id)])),
      automation: deps.settings.getAutomation(),
      optimization: deps.settings.getOptimization(),
    };
  });

  // ---------- Dateisystem (WP14: Ordnerauswahl) ----------

  /** Nativer Finder-Dialog (macOS). Abbruch ist kein Fehler. */
  app.post('/api/fs/pick-folder', async () => {
    if (process.platform !== 'darwin') return { cancelled: true, unsupported: true };
    return new Promise((resolve) => {
      execFile(
        'osascript',
        ['-e', 'POSIX path of (choose folder with prompt "Projekt-Repository wählen")'],
        { timeout: 120_000 },
        (err, stdout) => {
          if (err) resolve({ cancelled: true });
          else resolve({ cancelled: false, path: stdout.trim().replace(/\/$/, '') });
        },
      );
    });
  });

  /** Verzeichnis-Browser (Fallback): Unterordner mit Git-Repo-Flag. */
  app.get<{ Querystring: { path?: string } }>('/api/fs/dirs', (req) => {
    const base = req.query.path?.trim() || homedir();
    if (!base.startsWith('/')) throw httpError(400, 'Absoluter Pfad erwartet');
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      throw httpError(404, `Verzeichnis nicht lesbar: ${base}`);
    }
    const dirs = entries
      .filter((name) => !name.startsWith('.'))
      .map((name) => join(base, name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      })
      .map((p) => ({ path: p, name: p.split('/').at(-1)!, isGitRepo: existsSync(join(p, '.git')) }))
      .sort((a, b) => Number(b.isGitRepo) - Number(a.isGitRepo) || a.name.localeCompare(b.name));
    return { base, parent: dirname(base) === base ? null : dirname(base), dirs };
  });

  /** Vorschläge: Geschwister-Repos bereits registrierter Projekte. */
  app.get('/api/fs/suggestions', () => {
    const registered = new Set(deps.projects.list().map((p) => p.path));
    const suggestions = new Set<string>();
    for (const project of deps.projects.list()) {
      const parent = dirname(project.path);
      try {
        for (const name of readdirSync(parent)) {
          if (name.startsWith('.')) continue;
          const p = join(parent, name);
          if (registered.has(p) || suggestions.has(p)) continue;
          try {
            if (statSync(p).isDirectory() && existsSync(join(p, '.git'))) suggestions.add(p);
          } catch {
            /* unlesbar */
          }
        }
      } catch {
        /* Parent unlesbar */
      }
    }
    return { suggestions: [...suggestions].slice(0, 20) };
  });

  // ---------- Projekte ----------

  app.post<{ Body: { path: string; name?: string } }>('/api/projects', async (req) => {
    return deps.onboarding.addProject(req.body);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/projects/:id', (req) => {
    const allowed: Record<string, unknown> = {};
    const b = req.body;
    for (const key of ['name', 'color', 'defaultBranch', 'enabledPhases', 'verifyCommands', 'automation', 'optimization', 'mergeMode', 'editorCmd', 'integrationMode'] as const) {
      if (key in b) allowed[key] = b[key];
    }
    deps.projects.update(req.params.id, allowed);
    return deps.projects.get(req.params.id);
  });

  /**
   * Projekt löschen — inklusive seiner Arbeitsverzeichnisse. Ohne diesen Schritt
   * blieben Worktrees und ihre git-Registrierungen im Ziel-Repo zurück, während
   * das Projekt aus der DB verschwand (so entstanden neun verwaiste Worktrees).
   * Uncommittete Arbeit wird nicht gelöscht, sondern als `kept` zurückgegeben.
   */
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const project = deps.projects.get(req.params.id);
    const cleanup = project
      ? await deps.worktrees.removeAllForProject(project, project.path).catch((err: Error) => {
          app.log.warn(`Worktree-Aufräumen für '${project.name}' fehlgeschlagen: ${err.message}`);
          return { removed: [], kept: [{ path: project.path, reason: err.message }] };
        })
      : { removed: [], kept: [] };
    for (const k of cleanup.kept) {
      app.log.warn(`Worktree bleibt stehen (${k.reason}): ${k.path}`);
    }
    deps.projects.remove(req.params.id);
    return { ok: true, ...cleanup };
  });

  /** Projekt-Terminal (WP11): persistente Login-Shell im Projekt-cwd. */
  app.post<{ Params: { id: string } }>('/api/projects/:id/terminal', async (req) => {
    const project = deps.projects.get(req.params.id);
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    const existing = deps.ptys
      .list()
      .find((s) => s.kind === 'shell' && s.projectId === project.id && !s.exited);
    if (existing) return { sessionId: existing.id };
    const env = await loginShellEnv();
    const session = await deps.ptys.spawn({
      projectId: project.id,
      featureId: null,
      kind: 'shell',
      cwd: project.path,
      argv: [env.SHELL ?? '/bin/zsh', '-i'],
      withHooks: false,
    });
    deps.sessions.create({
      id: session.id,
      featureId: null,
      projectId: project.id,
      kind: 'shell',
      pid: session.pty.pid,
    });
    return { sessionId: session.id };
  });

  /**
   * spec-kit-Init (WP11): Befehl vorbereitet ins Projekt-Terminal schreiben —
   * OHNE Submit, der User bestätigt bewusst mit Enter.
   */
  app.post<{ Params: { id: string } }>('/api/projects/:id/init-speckit', async (req) => {
    const res = (await app.inject({
      method: 'POST',
      url: `/api/projects/${req.params.id}/terminal`,
    }).then((r) => r.json())) as { sessionId: string };
    // Init + Commit in einem Schritt: Worktrees zweigen vom Default-Branch ab —
    // ohne Commit hätten Feature-Sessions die speckit-Skills nicht.
    deps.ptys.write(
      res.sessionId,
      'uvx --from git+https://github.com/github/spec-kit.git specify init --here --integration claude && git add -A && git commit -m "chore: spec-kit init"',
    );
    return res;
  });

  // ---------- Phase-Definitionen (Lane-Info-Icon) ----------

  /** Definition eines SDD-Schritts lesen (was der Schritt tut). */
  app.get<{ Params: { id: string; phase: string } }>(
    '/api/projects/:id/phases/:phase/definition',
    async (req) => {
      const project = deps.projects.get(req.params.id);
      if (!project) throw httpError(404, 'Projekt nicht gefunden');
      const phase = validatePhase(req.params.phase);
      const features = deps.features.listByProject(project.id);
      return readPhaseDefinition(project, phase, features);
    },
  );

  /** Definition eines SDD-Schritts speichern (Konflikt- & Sperr-geschützt). */
  app.put<{ Params: { id: string; phase: string }; Body: { content?: string; baseMtimeMs?: number; overwrite?: boolean } }>(
    '/api/projects/:id/phases/:phase/definition',
    async (req, reply) => {
      const project = deps.projects.get(req.params.id);
      if (!project) throw httpError(404, 'Projekt nicht gefunden');
      const phase = validatePhase(req.params.phase);
      if (typeof req.body.content !== 'string' || typeof req.body.baseMtimeMs !== 'number') {
        throw httpError(400, 'content und baseMtimeMs erforderlich');
      }
      const features = deps.features.listByProject(project.id);
      try {
        const { mtimeMs } = await writePhaseDefinition(project, phase, features, {
          content: req.body.content,
          baseMtimeMs: req.body.baseMtimeMs,
          overwrite: req.body.overwrite ?? false,
        });
        return { ok: true, mtimeMs };
      } catch (e) {
        if (e instanceof DefinitionError) {
          if (e.code === 'not_found') throw httpError(404, e.message);
          void reply.code(409);
          return e.code === 'conflict'
            ? { error: 'conflict', message: e.message, current: e.current }
            : { error: 'locked', message: e.message };
        }
        throw e;
      }
    },
  );

  /** Definitionsdatei eines SDD-Schritts im externen Editor öffnen. */
  app.post<{ Params: { id: string; phase: string } }>(
    '/api/projects/:id/phases/:phase/definition/open-in-editor',
    async (req) => {
      const project = deps.projects.get(req.params.id);
      if (!project) throw httpError(404, 'Projekt nicht gefunden');
      const phase = validatePhase(req.params.phase);
      const file = phaseDefinitionPath(project.path, phase);
      if (!file) throw httpError(404, 'Keine Definitionsdatei für diesen Schritt.');
      const template = project.editorCmd?.trim() || 'code -g {file}:{line}';
      const command = template.replaceAll('{file}', shellQuotePath(file)).replaceAll('{line}', '1');
      const env = await loginShellEnv();
      exec(command, { env, cwd: project.path }, () => {});
      return { ok: true };
    },
  );

  // ---------- Feature-Artefakte (Kachel-Ergebnis-Icons) ----------

  /** Liste der artefakt-erzeugenden Schritte eines Features (Icons + Verfügbarkeit + Datei-Umschalter). */
  app.get<{ Params: { id: string } }>('/api/features/:id/artifacts', (req) => {
    const feature = deps.features.get(req.params.id);
    if (!feature) throw httpError(404, 'Feature nicht gefunden');
    const project = deps.projects.get(feature.projectId);
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    return listFeatureArtifactSteps(project, feature);
  });

  /** Inhalt einer Artefakt-Datei lesen (immer erlaubt). */
  app.get<{ Params: { id: string; phase: string }; Querystring: { file?: string } }>(
    '/api/features/:id/artifacts/:phase',
    async (req) => {
      const feature = deps.features.get(req.params.id);
      if (!feature) throw httpError(404, 'Feature nicht gefunden');
      const project = deps.projects.get(feature.projectId);
      if (!project) throw httpError(404, 'Projekt nicht gefunden');
      const phase = validatePhase(req.params.phase);
      try {
        return await readFeatureArtifact(project, feature, phase, req.query.file);
      } catch (e) {
        if (e instanceof ArtifactError && e.code === 'not_found') throw httpError(400, e.message);
        throw e;
      }
    },
  );

  /** Bearbeiteten Inhalt zurückschreiben (Konflikt- & Sperr-geschützt). */
  app.put<{
    Params: { id: string; phase: string };
    Querystring: { file?: string };
    Body: { content?: string; baseMtimeMs?: number; overwrite?: boolean };
  }>('/api/features/:id/artifacts/:phase', async (req, reply) => {
    const feature = deps.features.get(req.params.id);
    if (!feature) throw httpError(404, 'Feature nicht gefunden');
    const project = deps.projects.get(feature.projectId);
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    const phase = validatePhase(req.params.phase);
    if (typeof req.body.content !== 'string' || typeof req.body.baseMtimeMs !== 'number' || !req.query.file) {
      throw httpError(400, 'content, baseMtimeMs und file erforderlich');
    }
    try {
      const { mtimeMs } = await writeFeatureArtifact(project, feature, phase, req.query.file, {
        content: req.body.content,
        baseMtimeMs: req.body.baseMtimeMs,
        overwrite: req.body.overwrite ?? false,
      });
      return { ok: true, mtimeMs };
    } catch (e) {
      if (e instanceof ArtifactError) {
        if (e.code === 'not_found') throw httpError(404, e.message);
        void reply.code(409);
        return e.code === 'conflict'
          ? { error: 'conflict', message: e.message, current: e.current }
          : { error: 'locked', message: e.message };
      }
      throw e;
    }
  });

  // ---------- Projekt-Chat (Ask-a-Question) ----------

  /** Aktive Unterhaltung + Arbeits-Session-Info + offener Feature-Vorschlag (Karte). */
  app.get<{ Params: { id: string } }>('/api/projects/:id/chat', (req) => {
    if (!deps.projects.get(req.params.id)) throw httpError(404, 'Projekt nicht gefunden');
    const base = deps.chat.getState(req.params.id);
    const workSession = base.conversation ? deps.chatWork.workSessionInfo(base.conversation) : null;
    const workPaused = base.conversation ? deps.chatWork.workPaused(base.conversation) : false;
    const pendingFeatures = deps.chatWork.proposalForProject(req.params.id);
    return { ...base, workSession, workPaused, pendingFeatures };
  });

  /** Session sicherstellen (Worktree + interaktive Session) → sessionId für /ws/terminal. */
  app.post<{ Params: { id: string } }>('/api/projects/:id/chat/work/session', async (req) => {
    return deps.chatWork.ensure(req.params.id);
  });

  /** Wissens-Chat neu starten: frische Session. 409 { needsConfirm, reason } wenn Arbeit droht. */
  app.post<{ Params: { id: string }; Body: { confirm?: boolean } }>(
    '/api/projects/:id/chat/work/restart',
    async (req, reply) => {
      const result = await deps.chatWork.restart(req.params.id, { confirm: req.body?.confirm === true });
      if ('needsConfirm' in result) void reply.code(409);
      return result;
    },
  );

  /** Bestätigte Feature(s) aus dem Vorschlag anlegen (Teilmenge per Name). */
  app.post<{ Params: { id: string }; Body: { names?: string[] } }>(
    '/api/projects/:id/chat/work/features/create',
    async (req) => {
      const names = Array.isArray(req.body?.names) ? req.body!.names : [];
      const features = await deps.chatWork.createFeatures(req.params.id, names);
      return { features };
    },
  );

  /** Feature-Vorschlag verwerfen. */
  app.post<{ Params: { id: string } }>('/api/projects/:id/chat/work/features/dismiss', (req) => {
    deps.chatWork.dismissProposal(req.params.id);
    return { ok: true };
  });

  /** Nutzer-Nachricht senden — startet den Assistenten-Turn asynchron (202). */
  app.post<{ Params: { id: string }; Body: { content?: string } }>(
    '/api/projects/:id/chat/messages',
    (req, reply) => {
      const content = req.body?.content?.trim();
      if (!content) throw httpError(400, 'Nachricht fehlt');
      const result = deps.chat.sendMessage(req.params.id, content);
      void reply.code(202);
      return result;
    },
  );

  /** „Neue Unterhaltung": aktive Unterhaltung beenden, laufenden Turn abbrechen. */
  app.post<{ Params: { id: string } }>('/api/projects/:id/chat/reset', (req) => {
    deps.chat.reset(req.params.id);
    return { conversation: null };
  });

  /** Entscheidung zum Feature-Vorschlag (Anlage selbst läuft über POST /features). */
  app.patch<{
    Params: { messageId: string };
    Body: { status: 'angenommen' | 'abgelehnt'; featureId?: string };
  }>('/api/chat/messages/:messageId/proposal', (req) => {
    if (req.body?.status !== 'angenommen' && req.body?.status !== 'abgelehnt') {
      throw httpError(400, 'status muss angenommen oder abgelehnt sein');
    }
    return deps.chat.decideProposal(req.params.messageId, req.body);
  });

  // ---------- Features ----------

  app.post<{ Params: { id: string }; Body: { name: string; description?: string } }>(
    '/api/projects/:id/features',
    async (req) => {
      return deps.orchestrator.createFeature(req.params.id, req.body.name, req.body.description);
    },
  );

  app.post<{ Params: { id: string; phase: string }; Body: { prompt?: string } }>(
    '/api/features/:id/phases/:phase/start',
    async (req) => {
      const phase = validatePhase(req.params.phase);
      actionGuard.assertAllowed('phase_start', req.params.id, { phase });
      const { gateRunning } = await deps.orchestrator.startPhaseRun(req.params.id, phase, req.body?.prompt);
      return { ...deps.features.get(req.params.id), gateRunning };
    },
  );

  app.post<{ Params: { id: string; phase: string } }>('/api/features/:id/phases/:phase/approve', (req) => {
    const phase = validatePhase(req.params.phase);
    actionGuard.assertAllowed('phase_approve', req.params.id, { phase });
    // Mit der erneuten Freigabe des letzten Schritts ist die Zurückweisung erledigt
    // (FR-026) — vor dem Approve, damit alle Folgeereignisse den neuen Stand tragen.
    const before = deps.features.get(req.params.id);
    if (before && before.reviewRejectedAt !== null && orderedPhases(before.phases).at(-1) === phase) {
      deps.features.setReviewRejected(req.params.id, null);
    }
    deps.orchestrator.approve(req.params.id, phase);
    return deps.features.get(req.params.id);
  });

  app.post<{ Params: { id: string; phase: string } }>('/api/features/:id/phases/:phase/discard', (req) => {
    const phase = validatePhase(req.params.phase);
    actionGuard.assertAllowed('phase_discard', req.params.id, { phase });
    deps.orchestrator.discard(req.params.id, phase);
    return deps.features.get(req.params.id);
  });

  app.patch<{ Params: { id: string }; Body: { automation?: Record<string, unknown>; optimization?: Record<string, unknown> } }>(
    '/api/features/:id',
    (req) => {
      const feature = deps.features.get(req.params.id);
      if (!feature) throw httpError(404, 'Feature nicht gefunden');
      if (req.body.automation !== undefined) {
        deps.features.setAutomation(feature.id, req.body.automation);
      }
      if (req.body.optimization !== undefined) {
        deps.features.setOptimization(feature.id, req.body.optimization);
      }
      const fresh = deps.features.get(feature.id);
      if (fresh) bus.emitEvent('feature_updated', fresh);
      return fresh;
    },
  );

  app.post<{ Params: { id: string } }>('/api/features/:id/session', async (req) => {
    const session = await deps.orchestrator.ensureSession(req.params.id);
    return { sessionId: session.id };
  });

  app.post<{ Params: { id: string }; Body: { text: string } }>('/api/features/:id/prompt', async (req) => {
    const session = await deps.orchestrator.ensureSession(req.params.id);
    deps.ptys.sendPrompt(session.id, req.body.text);
    return { ok: true };
  });

  /**
   * Der einzige Fakt, den die Oberfläche nicht aus ihrem Zustand ableiten kann
   * (FR-027): gibt es im Arbeitsverzeichnis überhaupt etwas zu integrieren?
   * Fehlender oder unlesbarer Worktree ⇒ false — die Aktion ist dann ohnehin
   * ausgeblendet.
   */
  async function integrationHasChanges(featureId: string): Promise<boolean> {
    const { feature, project } = featureCwd(featureId);
    if (!feature.worktreePath) return false;
    try {
      return await hasUnmergedChanges(feature.worktreePath, feature.integrationTarget ?? project.defaultBranch);
    } catch {
      return false;
    }
  }

  app.get<{ Params: { id: string } }>('/api/features/:id/integration-readiness', async (req) => ({
    hasChanges: await integrationHasChanges(req.params.id),
  }));

  app.post<{ Params: { id: string } }>('/api/features/:id/integrate', async (req) => {
    // Serverseitig ermittelte Änderungslage in die Prüfung hereinreichen (FR-027).
    const hasChanges = await integrationHasChanges(req.params.id);
    actionGuard.assertAllowed('integrate', req.params.id, { hasChanges });
    const result = await deps.mergeQueue.beginIntegration(req.params.id);
    // Nur die Vorprüfungen tragen einen Grund und sind echte Ablehnungen (409).
    // Bleibt der Start ohne Grund aus, hat die Selbstheilung übernommen (Branch
    // bereits gemergt, Worktree defekt) — sie meldet sich selbst über die Inbox.
    if (!result.started && result.reason) throw httpError(409, result.reason);
    return deps.features.get(req.params.id);
  });

  app.post<{ Params: { id: string }; Body: ApproveMergeRequest | undefined }>(
    '/api/features/:id/approve-merge',
    async (req) => {
      actionGuard.assertAllowed('review_approve', req.params.id);
      try {
        await deps.mergeQueue.approveForMerge(req.params.id, req.body ?? {});
      } catch (e) {
        if (e instanceof MergeApprovalError) throw httpError(400, e.message);
        throw e;
      }
      return deps.features.get(req.params.id);
    },
  );

  app.post<{ Params: { id: string } }>('/api/features/:id/retry-integration', (req) => {
    actionGuard.assertAllowed('integration_retry', req.params.id);
    deps.mergeQueue.retry(req.params.id);
    return deps.features.get(req.params.id);
  });

  // Löschen ist eine Aufräum-Aktion mit Rückfrage in der Oberfläche (FR-008/FR-017)
  // und bleibt deshalb bewusst ungeschützt.
  app.delete<{ Params: { id: string } }>('/api/features/:id', async (req) => {
    await deps.mergeQueue.deleteFeature(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/features/:id/archive', async (req) => {
    actionGuard.assertAllowed('archive', req.params.id);
    const feature = deps.features.get(req.params.id);
    if (feature) {
      const session = deps.ptys.forFeature(feature.id);
      if (session) await deps.ptys.terminate(session.id);
      deps.features.archive(feature.id);
    }
    return { ok: true };
  });

  /**
   * Strukturierter Diff des Feature-Branches gegen den Default-Branch (Review-Portal, WP5).
   * Basis ist der Abzweigpunkt OHNE End-Ref → committete UND uncommittete/untracked
   * Änderungen werden sichtbar (nicht nur bereits committete).
   */
  app.get<{ Params: { id: string } }>('/api/features/:id/diff', async (req) => {
    const { cwd, project } = featureCwd(req.params.id);
    return collectUnmergedChanges(cwd, project.defaultBranch);
  });

  /** Einzeldiff einer Datei (Review-Portal) — inkl. uncommitteter/untracked Dateien. */
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/features/:id/diff/file',
    async (req) => {
      const { cwd, project } = featureCwd(req.params.id);
      if (!req.query.path || req.query.path.includes('..')) throw httpError(400, 'Ungültiger Pfad');
      const diff = await unmergedFileDiff(cwd, project.defaultBranch, req.query.path);
      return { diff };
    },
  );

  /**
   * Zurückweisen im Review: offene Reviewer-Kommentare + Freitext werden zu
   * einem strukturierten Arbeitsauftrag kompiliert und gehen als Prompt in die
   * Feature-Konsole; eine gewählte Nicht-Default-Zielwahl wird zurückgesetzt.
   *
   * Zusätzlich (FR-020/FR-021/FR-026): der letzte aktive Schritt geht auf
   * „wartet auf Freigabe" zurück und die Zurückweisung bleibt als Hinweis
   * sichtbar. Es folgt KEIN automatischer Integrationsstart — erst die erneute,
   * ausdrückliche Freigabe startet die Pipeline von vorn.
   */
  app.post<{ Params: { id: string }; Body: { comment?: string } }>(
    '/api/features/:id/reject-review',
    async (req) => {
      actionGuard.assertAllowed('review_reject', req.params.id);
      const feature = deps.features.get(req.params.id);
      if (!feature) throw httpError(404, 'Feature nicht gefunden');
      deps.features.setIntegration(feature.id, 'none');
      deps.features.setIntegrationTarget(feature.id, null);
      deps.features.savePhases(feature.id, reopenLastPhase(feature.phases).phases);
      deps.features.setReviewRejected(feature.id, Date.now());
      deps.attention.resolveFor({ featureId: feature.id, kinds: ['review_due'] });
      const openComments = deps.reviewComments
        .listForFeature(feature.id)
        .filter((c) => c.status === 'open');
      const freeText = req.body?.comment ?? '';
      if (openComments.length > 0 || freeText.trim()) {
        const session = await deps.orchestrator.ensureSession(feature.id);
        deps.ptys.sendPrompt(session.id, compileReviewPrompt(openComments, freeText));
      }
      const fresh = deps.features.get(feature.id);
      if (fresh) bus.emitEvent('feature_updated', fresh);
      return fresh;
    },
  );

  function featureCwd(featureId: string) {
    const feature = deps.features.get(featureId);
    if (!feature) throw httpError(404, 'Feature nicht gefunden');
    const project = deps.projects.get(feature.projectId);
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    return { feature, project, cwd: feature.worktreePath ?? project.path };
  }

  // ---------- Jira-Anbindung & Import (US1–US4) ----------

  /** Fehler-Mapping des Contracts: Auth → 401 {message, state}, nicht erreichbar → 503. */
  async function jiraGuarded<T>(
    reply: { code(statusCode: number): unknown },
    fn: () => Promise<T>,
  ): Promise<T | { message: string; state?: string }> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof JiraAuthRequiredError) {
        void reply.code(401);
        return { message: err.message, state: err.state };
      }
      if (err instanceof JiraUnreachableError) {
        void reply.code(503);
        return { message: err.message };
      }
      throw err;
    }
  }

  /** Verbindungsstatus — immer 200, auch unverbunden (Contract US1). */
  app.get('/api/jira/status', () => deps.jira.getStatus());

  /** OAuth-Browser-Flow starten; authUrl=null, wenn Tokens noch gültig sind. */
  app.post('/api/jira/connect', (_req, reply) => jiraGuarded(reply, () => deps.jira.startConnect()));

  /** OAuth-Callback des Anbieters — antwortet mit minimaler HTML-Seite. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/api/jira/oauth/callback',
    async (req, reply) => {
      void reply.type('text/html; charset=utf-8');
      const { code, state, error, error_description: errorDescription } = req.query;
      if (error || !code) {
        void reply.code(400);
        return oauthCallbackHtml(false, errorDescription || error || 'Kein Autorisierungscode erhalten');
      }
      try {
        await deps.jira.handleCallback(code, state);
        return oauthCallbackHtml(true);
      } catch (err) {
        void reply.code(400);
        return oauthCallbackHtml(false, (err as Error).message);
      }
    },
  );

  /** Verbindung trennen: Persistenzdatei entfernen (FR-005). */
  app.post('/api/jira/disconnect', async () => {
    await deps.jira.disconnect();
    return { state: 'disconnected' };
  });

  app.get('/api/jira/sites', (_req, reply) => jiraGuarded(reply, () => deps.jiraBrowse.listSites()));

  app.get<{ Querystring: { siteId?: string } }>('/api/jira/projects', (req, reply) => {
    const siteId = req.query.siteId;
    if (!siteId) throw httpError(400, 'siteId erforderlich');
    return jiraGuarded(reply, () => deps.jiraBrowse.listProjects(siteId));
  });

  app.get<{ Querystring: { siteId?: string; projectKey?: string } }>('/api/jira/sprints', (req, reply) => {
    const { siteId, projectKey } = req.query;
    if (!siteId || !projectKey) throw httpError(400, 'siteId und projectKey erforderlich');
    return jiraGuarded(reply, () => deps.jiraBrowse.listSprints(siteId, projectKey));
  });

  /** Ticketliste (Sprint- oder Projekt-/Backlog-Ebene); imported je Toolkit-Projekt (FR-010). */
  app.get<{ Querystring: { siteId?: string; projectKey?: string; sprintId?: string; projectId?: string } }>(
    '/api/jira/issues',
    (req, reply) => {
      const { siteId, projectKey, sprintId, projectId } = req.query;
      if (!siteId || !projectKey) throw httpError(400, 'siteId und projectKey erforderlich');
      return jiraGuarded(reply, async () => {
        const issues = await deps.jiraBrowse.listIssues(
          siteId,
          projectKey,
          sprintId ? Number(sprintId) : undefined,
        );
        const imported = new Set(projectId ? deps.features.listJiraKeys(projectId) : []);
        return issues.map((i) => ({ ...i, imported: imported.has(i.key) }));
      });
    },
  );

  /** Letzte Auswahl (FR-009): Settings-Key jira.lastSelection. */
  app.get('/api/settings/jira', () => deps.settings.getJson<JiraSelection>('jira.lastSelection') ?? {});
  app.put<{ Body: JiraSelection }>('/api/settings/jira', (req) => {
    const sel: JiraSelection = {};
    if (typeof req.body?.siteId === 'string') sel.siteId = req.body.siteId;
    if (typeof req.body?.projectKey === 'string') sel.projectKey = req.body.projectKey;
    if (typeof req.body?.sprintId === 'number') sel.sprintId = req.body.sprintId;
    deps.settings.setJson('jira.lastSelection', sel);
    return sel;
  });

  /** Ticket(s) als Feature(s) übernehmen (US3/US4); Teilfehler ⇒ trotzdem 200 (FR-015). */
  app.post<{
    Params: { id: string };
    Body: { siteId?: string; issueKeys?: string[]; confirmedReimports?: string[] };
  }>('/api/projects/:id/jira-import', (req, reply) => {
    const project = deps.projects.get(req.params.id);
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    const { siteId, issueKeys, confirmedReimports } = req.body ?? {};
    if (!siteId || !Array.isArray(issueKeys) || issueKeys.length === 0) {
      throw httpError(400, 'siteId und issueKeys erforderlich');
    }
    return jiraGuarded(reply, () =>
      deps.jiraImport.importIssues(project.id, siteId, issueKeys, confirmedReimports ?? []),
    );
  });

  // ---------- Attention / Queue / Settings / Executions ----------

  app.get('/api/attention', () => {
    // Read-Sicherheitsnetz für verpasste Events: nur (verbleibende) gültige Items ausliefern.
    deps.orchestrator.reconcileOpenAttention();
    return deps.attention.listOpen();
  });
  app.post<{ Params: { id: string } }>('/api/attention/:id/resolve', (req) => {
    deps.attention.resolve(req.params.id);
    bus.emitEvent('attention_resolved', req.params.id);
    return { ok: true };
  });

  /** Im Editor öffnen (WP10): Editor-Kommando des Projekts mit {file}/{line}. */
  app.post<{ Body: { featureId: string; file: string; line?: number | null } }>(
    '/api/open-in-editor',
    async (req) => {
      const { feature, project, cwd } = featureCwd(req.body.featureId);
      void feature;
      const file = req.body.file.startsWith('/') ? req.body.file : join(cwd, req.body.file);
      const template = project.editorCmd?.trim() || 'code -g {file}:{line}';
      const line = req.body.line ?? 1;
      const command = template.replaceAll('{file}', shellQuotePath(file)).replaceAll('{line}', String(line));
      const env = await loginShellEnv();
      exec(command, { env, cwd }, () => {});
      return { ok: true };
    },
  );

  /** QoL (WP16/Q3): Worktree im Finder/Editor öffnen. */
  app.post<{ Params: { id: string }; Body: { target: 'finder' | 'editor' } }>(
    '/api/features/:id/open',
    async (req) => {
      const { project, cwd } = featureCwd(req.params.id);
      const env = await loginShellEnv();
      if (req.body.target === 'finder') {
        exec(`open ${shellQuotePath(cwd)}`, { env }, () => {});
      } else {
        const template = project.editorCmd?.trim() || 'code -g {file}:{line}';
        const command = template.replaceAll('{file}', shellQuotePath(cwd)).replaceAll('{line}', '1');
        exec(command, { env, cwd }, () => {});
      }
      return { ok: true };
    },
  );

  /**
   * QoL (WP16/Q4): Bild aus der Zwischenablage → <worktree>/.sdd-tmp/,
   * Pfad landet per Bracketed Paste in der Konsole (Claude liest Bilder per Pfad).
   */
  app.post<{ Params: { id: string } }>('/api/features/:id/paste-image', async (req) => {
    const { feature, cwd } = featureCwd(req.params.id);
    const file = await req.file();
    if (!file) throw httpError(400, 'Bild fehlt');
    const buffer = await file.toBuffer();
    const ext = (file.mimetype.split('/')[1] ?? 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    const dir = join(cwd, '.sdd-tmp');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `paste-${Date.now()}.${ext}`);
    writeFileSync(path, buffer);
    // .sdd-tmp lokal ausschließen, ohne das Repo-.gitignore anzufassen.
    try {
      const excludePath = join(cwd, '.git', 'info', 'exclude');
      const cur = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
      if (!cur.includes('.sdd-tmp/')) appendFileSync(excludePath, '\n.sdd-tmp/\n');
    } catch {
      /* Worktree-.git ist eine Datei — exclude liegt im gitdir; best effort */
    }
    const session = deps.ptys.forFeature(feature.id);
    if (session) deps.ptys.write(session.id, `\x1b[200~${path}\x1b[201~`);
    return { path };
  });

  // ---------- Agents (Generalisierung der Review-Personas) ----------

  /** Validierung: Phasen-Trigger brauchen eine gültige Phase, andere keine. */
  const validateAgent = (a: AgentDefinition): void => {
    if (!a.name?.trim()) throw httpError(400, 'Agent-Name fehlt');
    if (!a.prompt?.trim()) throw httpError(400, 'Agent-Prompt fehlt');
    const kinds: AgentDefinition['trigger']['kind'][] = ['manual', 'review_gate', 'after_phase', 'before_phase'];
    if (!kinds.includes(a.trigger?.kind)) throw httpError(400, 'Unbekannte Trigger-Art');
    const needsPhase = a.trigger.kind === 'after_phase' || a.trigger.kind === 'before_phase';
    if (needsPhase && !FEATURE_PHASES.includes(a.trigger.phase as FeaturePhase)) {
      throw httpError(400, 'Phasen-Trigger braucht eine gültige Phase');
    }
    if (!needsPhase && a.trigger.phase) throw httpError(400, 'Trigger-Art erlaubt keine Phase');
  };

  app.get<{ Querystring: { projectId?: string } }>('/api/agents', (req) => {
    const { projectId } = req.query;
    if (projectId && projectId !== 'global') return deps.agents.forProject(projectId);
    return deps.agents.list();
  });
  app.put<{ Body: AgentDefinition }>('/api/agents', (req) => {
    validateAgent(req.body);
    return deps.agents.upsert(req.body);
  });
  app.delete<{ Params: { id: string } }>('/api/agents/:id', (req) => {
    deps.agents.remove(req.params.id);
    return { ok: true };
  });

  /** Effektive Agent-Sicht eines Features (Union + Selektion + letzter Lauf). */
  app.get<{ Params: { id: string } }>('/api/features/:id/agents', (req) => {
    const feature = deps.features.get(req.params.id);
    if (!feature) throw httpError(404, 'Feature nicht gefunden');
    const selection = deps.agents.listSelection(feature.id);
    const lastRuns = deps.agentRuns.latestPerAgent(feature.id);
    return deps.agents.forProject(feature.projectId).map((agent) => {
      const decision = selection.get(agent.id) ?? 'auto';
      const lastRun = lastRuns.get(agent.id) ?? null;
      return {
        agent,
        decision,
        effective: decision === 'include' ? true : decision === 'exclude' ? false : agent.enabled,
        lastRun:
          lastRun?.executionId != null
            ? {
                ...lastRun,
                totalTokens: deps.executions.get(lastRun.executionId)?.tokens ?? null,
              }
            : lastRun,
      };
    });
  });

  app.put<{ Params: { id: string }; Body: { agentId: string; decision: 'include' | 'exclude' | 'auto' } }>(
    '/api/features/:id/agents/selection',
    (req) => {
      const feature = deps.features.get(req.params.id);
      if (!feature) throw httpError(404, 'Feature nicht gefunden');
      const { agentId, decision } = req.body ?? ({} as never);
      if (!deps.agents.get(agentId)) throw httpError(404, 'Agent nicht gefunden');
      if (decision === 'auto') deps.agents.clearSelection(feature.id, agentId);
      else if (decision === 'include' || decision === 'exclude') deps.agents.setSelection(feature.id, agentId, decision);
      else throw httpError(400, 'decision muss include|exclude|auto sein');
      return { ok: true };
    },
  );

  /** Manueller Agent-Lauf („Jetzt ausführen") — asynchron, Ergebnis via agent_gate-Event. */
  app.post<{ Params: { id: string; agentId: string } }>(
    '/api/features/:id/agents/:agentId/run',
    async (req, reply) => {
      const feature = deps.features.get(req.params.id);
      if (!feature) throw httpError(404, 'Feature nicht gefunden');
      const project = deps.projects.get(feature.projectId);
      if (!project) throw httpError(404, 'Projekt nicht gefunden');
      if (!deps.agents.get(req.params.agentId)) throw httpError(404, 'Agent nicht gefunden');
      if (!feature.worktreePath || !existsSync(feature.worktreePath)) {
        throw httpError(409, 'Kein Worktree vorhanden — Agent-Läufe brauchen einen Arbeitsstand');
      }
      void deps.agentGate
        .runAgent(req.params.agentId, feature, project)
        .catch((err) => console.warn(`[agents] Manueller Lauf fehlgeschlagen: ${(err as Error).message}`));
      void reply.code(202);
      return { started: true };
    },
  );

  // ---------- Projektspezifisches Wissen ----------

  const mustProject = (id: string) => {
    const p = deps.projects.get(id);
    if (!p) throw httpError(404, 'Projekt nicht gefunden');
    return p;
  };
  const normApplicability = (a: unknown): Applicability => {
    const o = (a ?? {}) as { text?: unknown; tags?: unknown };
    const tags = Array.isArray(o.tags)
      ? o.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
      : [];
    return { text: typeof o.text === 'string' ? o.text : '', tags: [...new Set(tags)] };
  };
  const knowledgeChanged = (projectId: string) => bus.emitEvent('knowledge_updated', { projectId });

  app.get<{ Params: { id: string } }>('/api/projects/:id/knowledge', (req) => {
    const project = mustProject(req.params.id);
    return { tree: deps.knowledge.tree(project.id), index: deps.knowledge.index(project.id) };
  });

  app.post<{ Params: { id: string }; Body: { parentId?: string | null; name?: string; applicability?: unknown; sortOrder?: number } }>(
    '/api/projects/:id/knowledge/bundles',
    (req) => {
      const project = mustProject(req.params.id);
      const name = (req.body.name ?? '').trim();
      if (!name) throw httpError(400, 'Name erforderlich');
      const parentId = req.body.parentId ?? null;
      if (parentId) {
        const parent = deps.knowledge.getBundle(parentId);
        if (!parent || parent.projectId !== project.id) throw httpError(400, 'Ungültiges Eltern-Bundle');
      }
      const bundle = deps.knowledge.createBundle(project.id, {
        parentId,
        name,
        applicability: normApplicability(req.body.applicability),
        sortOrder: req.body.sortOrder ?? 0,
      });
      knowledgeChanged(project.id);
      return bundle;
    },
  );

  app.patch<{ Params: { bundleId: string }; Body: { name?: string; applicability?: unknown; parentId?: string | null; sortOrder?: number } }>(
    '/api/knowledge/bundles/:bundleId',
    (req) => {
      const cur = deps.knowledge.getBundle(req.params.bundleId);
      if (!cur) throw httpError(404, 'Bundle nicht gefunden');
      const patch: Parameters<typeof deps.knowledge.updateBundle>[1] = {};
      if (req.body.name !== undefined) {
        const name = req.body.name.trim();
        if (!name) throw httpError(400, 'Name darf nicht leer sein');
        patch.name = name;
      }
      if (req.body.applicability !== undefined) patch.applicability = normApplicability(req.body.applicability);
      if (req.body.sortOrder !== undefined) patch.sortOrder = req.body.sortOrder;
      if (req.body.parentId !== undefined) {
        const parentId = req.body.parentId;
        if (parentId) {
          const parent = deps.knowledge.getBundle(parentId);
          if (!parent || parent.projectId !== cur.projectId) throw httpError(400, 'Ungültiges Eltern-Bundle');
        }
        if (detectCycle(deps.knowledge.listBundles(cur.projectId), cur.id, parentId)) {
          throw httpError(400, 'Zyklus: Bundle kann nicht unter sich selbst hängen');
        }
        patch.parentId = parentId;
      }
      const bundle = deps.knowledge.updateBundle(cur.id, patch);
      knowledgeChanged(cur.projectId);
      return bundle;
    },
  );

  app.delete<{ Params: { bundleId: string } }>('/api/knowledge/bundles/:bundleId', (req) => {
    const cur = deps.knowledge.getBundle(req.params.bundleId);
    if (!cur) throw httpError(404, 'Bundle nicht gefunden');
    deps.knowledge.deleteBundle(cur.id);
    knowledgeChanged(cur.projectId);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { bundleId?: string | null; title?: string; body?: string; applicability?: unknown; sortOrder?: number } }>(
    '/api/projects/:id/knowledge/entries',
    (req) => {
      const project = mustProject(req.params.id);
      const title = (req.body.title ?? '').trim();
      if (!title) throw httpError(400, 'Titel erforderlich');
      const bundleId = req.body.bundleId ?? null;
      if (bundleId) {
        const b = deps.knowledge.getBundle(bundleId);
        if (!b || b.projectId !== project.id) throw httpError(400, 'Ungültiges Bundle');
      }
      const entry = deps.knowledge.createEntry(project.id, {
        bundleId,
        title,
        body: typeof req.body.body === 'string' ? req.body.body : '',
        applicability: normApplicability(req.body.applicability),
        source: 'inline',
        sortOrder: req.body.sortOrder ?? 0,
      });
      knowledgeChanged(project.id);
      return entry;
    },
  );

  app.patch<{ Params: { entryId: string }; Body: { title?: string; body?: string; bundleId?: string | null; applicability?: unknown; sortOrder?: number } }>(
    '/api/knowledge/entries/:entryId',
    (req) => {
      const cur = deps.knowledge.getEntry(req.params.entryId);
      if (!cur) throw httpError(404, 'Eintrag nicht gefunden');
      const patch: Parameters<typeof deps.knowledge.updateEntry>[1] = {};
      if (req.body.title !== undefined) {
        const t = req.body.title.trim();
        if (!t) throw httpError(400, 'Titel darf nicht leer sein');
        patch.title = t;
      }
      if (req.body.body !== undefined) patch.body = req.body.body;
      if (req.body.applicability !== undefined) patch.applicability = normApplicability(req.body.applicability);
      if (req.body.sortOrder !== undefined) patch.sortOrder = req.body.sortOrder;
      if (req.body.bundleId !== undefined) {
        const bundleId = req.body.bundleId;
        if (bundleId) {
          const b = deps.knowledge.getBundle(bundleId);
          if (!b || b.projectId !== cur.projectId) throw httpError(400, 'Ungültiges Bundle');
        }
        patch.bundleId = bundleId;
      }
      const entry = deps.knowledge.updateEntry(cur.id, patch);
      knowledgeChanged(cur.projectId);
      return entry;
    },
  );

  app.delete<{ Params: { entryId: string } }>('/api/knowledge/entries/:entryId', (req) => {
    const cur = deps.knowledge.getEntry(req.params.entryId);
    if (!cur) throw httpError(404, 'Eintrag nicht gefunden');
    deps.knowledge.deleteEntry(cur.id);
    knowledgeChanged(cur.projectId);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { bundleId?: string | null; sourcePath?: string; title?: string; applicability?: unknown } }>(
    '/api/projects/:id/knowledge/entries/import',
    (req) => {
      const project = mustProject(req.params.id);
      const sourcePath = (req.body.sourcePath ?? '').trim();
      if (!sourcePath) throw httpError(400, 'sourcePath erforderlich');
      const bundleId = req.body.bundleId ?? null;
      if (bundleId) {
        const b = deps.knowledge.getBundle(bundleId);
        if (!b || b.projectId !== project.id) throw httpError(400, 'Ungültiges Bundle');
      }
      try {
        const entry = deps.knowledgeService.importFromFile(project.id, {
          bundleId,
          sourcePath,
          title: req.body.title,
          applicability: normApplicability(req.body.applicability),
        });
        knowledgeChanged(project.id);
        return entry;
      } catch (e) {
        throw httpError(400, (e as Error).message);
      }
    },
  );

  app.post<{ Params: { entryId: string } }>('/api/knowledge/entries/:entryId/refresh', (req) => {
    const cur = deps.knowledge.getEntry(req.params.entryId);
    if (!cur) throw httpError(404, 'Eintrag nicht gefunden');
    if (cur.source !== 'file') throw httpError(409, 'Nur datei-basierte Einträge können aktualisiert werden');
    try {
      const entry = deps.knowledgeService.refreshFromFile(cur.id);
      knowledgeChanged(cur.projectId);
      return entry;
    } catch (e) {
      throw httpError(400, (e as Error).message);
    }
  });

  app.get<{ Params: { id: string } }>('/api/features/:id/knowledge', (req) => {
    const feature = deps.features.get(req.params.id);
    if (!feature) throw httpError(404, 'Feature nicht gefunden');
    return deps.knowledgeService.resolveForFeature(feature);
  });

  app.put<{ Params: { id: string }; Body: { targetId?: string; targetKind?: 'bundle' | 'entry'; decision?: SelectionDecision | 'auto' } }>(
    '/api/features/:id/knowledge/selection',
    (req) => {
      const feature = deps.features.get(req.params.id);
      if (!feature) throw httpError(404, 'Feature nicht gefunden');
      const targetId = req.body.targetId;
      if (!targetId) throw httpError(400, 'targetId erforderlich');
      if (!req.body.decision || req.body.decision === 'auto') {
        deps.knowledge.clearSelection(feature.id, targetId);
      } else {
        const kind = req.body.targetKind === 'bundle' ? 'bundle' : 'entry';
        deps.knowledge.setSelection(feature.id, targetId, kind, req.body.decision);
      }
      return deps.knowledgeService.resolveForFeature(feature);
    },
  );

  app.post<{ Params: { id: string } }>('/api/features/:id/knowledge/materialize', (req) => {
    const feature = deps.features.get(req.params.id);
    if (!feature) throw httpError(404, 'Feature nicht gefunden');
    if (!feature.worktreePath || !existsSync(feature.worktreePath)) throw httpError(409, 'Kein Worktree vorhanden');
    const result = deps.knowledgeService.materializeForFeature(feature);
    return { indexPath: result.indexPath, materialized: result.materialized, resolved: result.resolved };
  });

  // ---------- Voice-Transkription (WP15) ----------

  interface TranscriptionSettings {
    provider: 'openai' | 'groq';
    apiKey: string;
    language?: string;
  }

  app.get('/api/settings/transcription', () => {
    const s = deps.settings.getJson<TranscriptionSettings>('transcription');
    // Key nie ans Frontend geben — nur maskiert anzeigen.
    return s ? { provider: s.provider, hasKey: true, language: s.language ?? 'de' } : { provider: null, hasKey: false };
  });

  app.put<{ Body: { provider: 'openai' | 'groq'; apiKey?: string; language?: string } }>(
    '/api/settings/transcription',
    (req) => {
      const cur = deps.settings.getJson<TranscriptionSettings>('transcription');
      const apiKey = req.body.apiKey?.trim() || cur?.apiKey;
      if (!apiKey) throw httpError(400, 'API-Key fehlt');
      deps.settings.setJson('transcription', {
        provider: req.body.provider,
        apiKey,
        language: req.body.language ?? cur?.language ?? 'de',
      });
      return { provider: req.body.provider, hasKey: true };
    },
  );

  /** Audio → Text via OpenAI Whisper oder Groq (WhisperM8-Muster, Key bleibt serverseitig). */
  app.post('/api/transcribe', async (req) => {
    const s = deps.settings.getJson<TranscriptionSettings>('transcription');
    if (!s?.apiKey) throw httpError(409, 'Kein Transkriptions-Provider konfiguriert — Web Speech nutzen');
    const file = await req.file();
    if (!file) throw httpError(400, 'Audio fehlt');
    const buffer = await file.toBuffer();

    const url =
      s.provider === 'groq'
        ? 'https://api.groq.com/openai/v1/audio/transcriptions'
        : 'https://api.openai.com/v1/audio/transcriptions';
    const model = s.provider === 'groq' ? 'whisper-large-v3' : 'whisper-1';

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: file.mimetype }), file.filename || 'audio.webm');
    form.append('model', model);
    if (s.language) form.append('language', s.language);

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      throw httpError(502, `Transkription fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { text?: string };
    return { text: json.text ?? '' };
  });

  app.get('/api/settings/automation', () => deps.settings.getAutomation());
  app.put<{ Body: Record<string, unknown> }>('/api/settings/automation', (req) => {
    deps.settings.setAutomation({ ...deps.settings.getAutomation(), ...(req.body as object) });
    return deps.settings.getAutomation();
  });

  // Token-Optimierung (Feature "minimize-token-consumption"): globaler Default.
  app.get('/api/settings/optimization', () => ({ optimization: deps.settings.getOptimization() }));
  app.patch<{ Body: Record<string, unknown> }>('/api/settings/optimization', (req) => ({
    optimization: deps.settings.setOptimization(req.body),
  }));

  app.get<{ Querystring: { featureId?: string } }>('/api/executions', (req) =>
    deps.executions.list(req.query.featureId),
  );

  /** Läufe-Sicht: Lauf = Worktree/Feature, aggregiert über alle Executions (Token-Dashboard). */
  app.get('/api/runs', () => ({
    runs: buildRunSummaries(deps.features.listAll(), deps.executions.listAll()),
  }));

  /**
   * Zustand der Telemetrie-Erfassung (FR-019): Läuft sie? Wenn nicht, warum nicht?
   * Und übersteuert das Toolkit dabei eine bestehende Konfiguration des Nutzers (D5)?
   * Der Nutzer soll das sehen können, statt zu raten, welche Quelle gerade misst.
   */
  app.get('/api/telemetry/status', () => {
    const stats = deps.telemetry.stats();
    return {
      active: true,
      reason: stats.eventsReceived === 0 ? ('no_events_yet' as const) : null,
      endpoint: telemetryEndpoint(deps.port),
      eventsReceived: stats.eventsReceived,
      lastEventAt: stats.lastEventAt,
      overridesUserConfig: detectForeignOtelConfig(process.env),
    };
  });

  /** Aggregierte Verbrauchssicht eines Features nach Phase/Art (P1, SC-003). */
  app.get<{ Params: { featureId: string }; Querystring: { groupByOptimization?: string } }>(
    '/api/features/:featureId/cost-breakdown',
    (req) => {
      const feature = deps.features.get(req.params.featureId);
      if (!feature) throw httpError(404, 'Feature nicht gefunden');
      return aggregateBreakdown(deps.executions.list(feature.id), {
        featureId: feature.id,
        groupByOptimization: req.query.groupByOptimization === 'true',
      });
    },
  );

  /**
   * Lauf-Log (WP5/WP6): datei-basierte Arten (verify/review/conflict/chat/chat_work) liegen
   * unter <dataDir>/logs/<id>.log. Phasen-Läufe haben keine Datei — ihr Log wird aus dem
   * Claude-Transkript-Ausschnitt [transcript_offset_start, transcript_offset_end) gerendert
   * (Feature "laeufe-haben-kein-log"); bei laufendem Lauf bis zur aktuellen Transkriptgröße.
   */
  app.get<{ Params: { id: string } }>('/api/executions/:id/log', async (req) => {
    if (!/^[A-Za-z0-9_-]+$/.test(req.params.id)) throw httpError(400, 'Ungültige ID');

    // Fall A: physische Log-Datei — unverändertes Verhalten der Nicht-Phasen-Arten.
    const p = join(deps.dataDir, 'logs', `${req.params.id}.log`);
    const fileContent = await readFile(p, 'utf8').catch(() => null);
    if (fileContent !== null) return { log: fileContent };

    // Fall B/C: Phasen-Lauf → aus dem Transkript rendern.
    const exec = deps.executions.get(req.params.id);
    if (exec?.kind === 'phase' && exec.transcriptOffsetStart !== null) {
      let path = exec.transcriptPath;
      let end = exec.transcriptOffsetEnd;
      if (!path) {
        // Fall C: Lauf läuft noch → Pfad aus der Live-Session ableiten.
        const session = exec.featureId ? deps.ptys.forFeature(exec.featureId) : undefined;
        if (session?.claudeSessionId) path = locateTranscript(session.cwd, session.claudeSessionId);
      }
      if (path) {
        if (end === null) end = transcriptSize(path); // laufender Lauf: bis jetzt
        return { log: renderTranscriptLog(readTranscriptRange(path, exec.transcriptOffsetStart, end)) };
      }
    }

    // Fall D: kein Log rekonstruierbar (Vor-Fix-Altbestand / Transkript nicht auffindbar).
    throw httpError(404, 'Kein Log vorhanden');
  });

  /** Diff der Auto-Konfliktauflösung (WP5): vorher (mit Markern) / nachher. */
  app.get<{ Params: { id: string } }>('/api/executions/:id/resolution-diff', async (req) => {
    if (!/^[A-Za-z0-9_-]+$/.test(req.params.id)) throw httpError(400, 'Ungültige ID');
    const base = join(deps.dataDir, 'logs', req.params.id);
    const pre = await readFile(`${base}.pre.diff`, 'utf8').catch(() => null);
    const post = await readFile(`${base}.post.diff`, 'utf8').catch(() => null);
    return { pre, post };
  });

  // ---------- WebSockets ----------

  /** Event-Broadcast: alle Bus-Events als {type, payload} an alle Clients. */
  app.get('/ws/events', { websocket: true }, (socket, req) => {
    // Zweite Verteidigungslinie neben dem onRequest-Guard: WebSockets kennen keine
    // Same-Origin-Policy, ein durchgerutschter Handshake wäre unmittelbar ausnutzbar.
    if (!isOriginAllowed(req.headers.origin, allowedOrigins)) {
      socket.close(WS_ORIGIN_REJECTED, 'Origin nicht erlaubt');
      return;
    }
    const listeners: [string, (...args: unknown[]) => void][] = [];
    for (const event of BUS_EVENT_NAMES) {
      const listener = (...args: unknown[]) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: event, payload: args[0] }));
        }
      };
      bus.on(event, listener);
      listeners.push([event, listener]);
    }
    socket.on('close', () => {
      for (const [event, listener] of listeners) bus.off(event, listener);
    });
  });

  /** Terminal-Stream: bidirektional, Scrollback-Replay, Focus-Drosselung (WP8). */
  app.get<{ Params: { sessionId: string } }>('/ws/terminal/:sessionId', { websocket: true }, (socket, req) => {
    if (!isOriginAllowed(req.headers.origin, allowedOrigins)) {
      socket.close(WS_ORIGIN_REJECTED, 'Origin nicht erlaubt');
      return;
    }
    const { sessionId } = req.params;
    const handle = deps.ptys.subscribe(sessionId, (data) => {
      if (socket.readyState === socket.OPEN) socket.send(data);
    });
    if (!handle) {
      socket.close(4404, 'Session nicht gefunden');
      return;
    }
    socket.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as
          | { type: 'input'; data: string }
          | { type: 'resize'; cols: number; rows: number }
          | { type: 'focus'; focused: boolean };
        if (msg.type === 'input') deps.ptys.write(sessionId, msg.data);
        else if (msg.type === 'resize') deps.ptys.resize(sessionId, msg.cols, msg.rows);
        else if (msg.type === 'focus') handle.setFocused(msg.focused);
      } catch {
        // Nicht-JSON = Roh-Input
        deps.ptys.write(sessionId, raw.toString());
      }
    });
    socket.on('close', () => handle.unsubscribe());
  });

  // Prod-Ein-Prozess-Modus: gebautes Web-Bundle ausliefern, unbekannte Nicht-API-Pfade
  // fallen per SPA-Fallback auf index.html zurück. API/WS-404 bleiben JSON. In Dev
  // (webDir leer) liefert Vite das Web selbst und proxyt /api + /ws hierher.
  if (deps.webDir) {
    await app.register(fastifyStatic, { root: deps.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

function shellQuotePath(p: string): string {
  return `'${p.replaceAll("'", `'\\''`)}'`;
}

/** Minimale Abschluss-Seite des OAuth-Flows („Fenster kann geschlossen werden"). */
function oauthCallbackHtml(ok: boolean, message?: string): string {
  const title = ok ? 'Jira verbunden' : 'Autorisierung fehlgeschlagen';
  const body = ok
    ? 'Die Verbindung wurde hergestellt. Dieses Fenster kann geschlossen werden — zurück zum SDD Toolkit.'
    : `Die Autorisierung konnte nicht abgeschlossen werden: ${escapeHtml(message ?? 'Unbekannter Fehler')}. Bitte im SDD Toolkit erneut versuchen.`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#18181b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}main{max-width:26rem;text-align:center;padding:2rem}h1{font-size:1.1rem}p{color:#a1a1aa;font-size:.9rem}</style>
</head><body><main><h1>${ok ? '✓' : '✕'} ${title}</h1><p>${body}</p></main></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function validatePhase(phase: string): FeaturePhase {
  if ((FEATURE_PHASES as readonly string[]).includes(phase)) return phase as FeaturePhase;
  throw httpError(400, `Unbekannte Phase: ${phase}`);
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}
