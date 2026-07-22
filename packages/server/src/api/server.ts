import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeaturePhase } from '@sdd/shared';
import { FEATURE_PHASES } from '@sdd/shared';
import type {
  AttentionRepo,
  ExecutionRepo,
  FeatureRepo,
  PersonaRepo,
  ProjectRepo,
  QueueRepo,
  SessionRepo,
  SettingsRepo,
} from '../db/repos.js';
import type { Orchestrator } from '../services/orchestrator.js';
import type { MergeQueueService } from '../services/mergeQueueService.js';
import type { OnboardingService } from '../services/onboardingService.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import { readBranch } from '../git/branchReader.js';
import { git } from '../git/git.js';
import { bus, BUS_EVENT_NAMES } from '../events.js';
import { displayStatus } from '@sdd/shared';

export interface ApiDeps {
  projects: ProjectRepo;
  features: FeatureRepo;
  sessions: SessionRepo;
  executions: ExecutionRepo;
  attention: AttentionRepo;
  queue: QueueRepo;
  settings: SettingsRepo;
  personas: PersonaRepo;
  orchestrator: Orchestrator;
  mergeQueue: MergeQueueService;
  onboarding: OnboardingService;
  ptys: PtySessionManager;
  dataDir: string;
}

export async function buildServer(deps: ApiDeps) {
  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors, { origin: true });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  // ---------- Bootstrap ----------

  app.get('/api/state', () => {
    const projects = deps.projects.list();
    const features = deps.features.listAll();
    const liveSessions = deps.ptys.list().map((s) => ({
      id: s.id,
      projectId: s.projectId,
      featureId: s.featureId,
      kind: s.kind,
      status: displayStatus(s.machine.state),
      awaitingKind: s.machine.state.kind === 'awaiting_input' ? s.machine.state.awaiting : null,
      exited: s.exited,
    }));
    return {
      projects: projects.map((p) => ({ ...p, currentBranch: readBranch(p.path) })),
      features,
      sessions: liveSessions,
      attention: deps.attention.listOpen(),
      queues: Object.fromEntries(projects.map((p) => [p.id, deps.queue.listByProject(p.id)])),
      automation: deps.settings.getAutomation(),
    };
  });

  // ---------- Projekte ----------

  app.post<{ Body: { path: string; name?: string } }>('/api/projects', async (req) => {
    return deps.onboarding.addProject(req.body);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/projects/:id', (req) => {
    const allowed: Record<string, unknown> = {};
    const b = req.body;
    for (const key of ['name', 'color', 'defaultBranch', 'enabledPhases', 'verifyCommands', 'automation', 'mergeMode', 'editorCmd'] as const) {
      if (key in b) allowed[key] = b[key];
    }
    deps.projects.update(req.params.id, allowed);
    return deps.projects.get(req.params.id);
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', (req) => {
    deps.projects.remove(req.params.id);
    return { ok: true };
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
      await deps.orchestrator.startPhaseRun(req.params.id, phase, req.body?.prompt);
      return deps.features.get(req.params.id);
    },
  );

  app.post<{ Params: { id: string; phase: string } }>('/api/features/:id/phases/:phase/approve', (req) => {
    deps.orchestrator.approve(req.params.id, validatePhase(req.params.phase));
    return deps.features.get(req.params.id);
  });

  app.post<{ Params: { id: string; phase: string } }>('/api/features/:id/phases/:phase/discard', (req) => {
    deps.orchestrator.discard(req.params.id, validatePhase(req.params.phase));
    return deps.features.get(req.params.id);
  });

  app.patch<{ Params: { id: string }; Body: { automation?: Record<string, unknown> } }>(
    '/api/features/:id',
    (req) => {
      const feature = deps.features.get(req.params.id);
      if (!feature) throw httpError(404, 'Feature nicht gefunden');
      if (req.body.automation !== undefined) {
        deps.features.setAutomation(feature.id, req.body.automation);
      }
      const fresh = deps.features.get(feature.id);
      if (fresh) bus.emitEvent('feature_updated', fresh);
      return fresh;
    },
  );

  app.post<{ Params: { id: string }; Body: { to: string } }>('/api/features/:id/advance', async (req) => {
    await deps.orchestrator.advanceTo(req.params.id, validatePhase(req.body.to));
    return deps.features.get(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/features/:id/session', async (req) => {
    const session = await deps.orchestrator.ensureSession(req.params.id);
    return { sessionId: session.id };
  });

  app.post<{ Params: { id: string }; Body: { text: string } }>('/api/features/:id/prompt', async (req) => {
    const session = await deps.orchestrator.ensureSession(req.params.id);
    deps.ptys.sendPrompt(session.id, req.body.text);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/features/:id/integrate', async (req) => {
    await deps.mergeQueue.beginIntegration(req.params.id);
    return deps.features.get(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/features/:id/approve-merge', (req) => {
    deps.mergeQueue.approveForMerge(req.params.id);
    return deps.features.get(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/features/:id/retry-integration', (req) => {
    deps.mergeQueue.retry(req.params.id);
    return deps.features.get(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/features/:id/archive', async (req) => {
    const feature = deps.features.get(req.params.id);
    if (feature) {
      const session = deps.ptys.forFeature(feature.id);
      if (session) await deps.ptys.terminate(session.id);
      deps.features.archive(feature.id);
    }
    return { ok: true };
  });

  /** Strukturierter Diff des Feature-Branches gegen den Default-Branch (Review-Portal, WP5). */
  app.get<{ Params: { id: string } }>('/api/features/:id/diff', async (req) => {
    const { cwd, project } = featureCwd(req.params.id);
    const range = `${project.defaultBranch}...HEAD`;
    const numstat = await git(cwd, ['diff', range, '--numstat']);
    const files = numstat.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [additions, deletions, ...path] = line.split('\t');
        return {
          path: path.join('\t'),
          additions: additions === '-' ? 0 : Number(additions),
          deletions: deletions === '-' ? 0 : Number(deletions),
          binary: additions === '-',
        };
      });
    const log = await git(cwd, ['log', '--format=%H%x09%ct%x09%s', `${project.defaultBranch}..HEAD`]);
    const commits = log.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, ts, ...subject] = line.split('\t');
        return { sha, date: Number(ts) * 1000, subject: subject.join('\t') };
      });
    return { files, commits };
  });

  /** Einzeldiff einer Datei (Review-Portal). */
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/features/:id/diff/file',
    async (req) => {
      const { cwd, project } = featureCwd(req.params.id);
      if (!req.query.path || req.query.path.includes('..')) throw httpError(400, 'Ungültiger Pfad');
      const r = await git(cwd, ['diff', `${project.defaultBranch}...HEAD`, '--', req.query.path]);
      return { diff: r.stdout };
    },
  );

  /** Zurückweisen im Review: Kommentar geht als Prompt in die Feature-Konsole. */
  app.post<{ Params: { id: string }; Body: { comment?: string } }>(
    '/api/features/:id/reject-review',
    async (req) => {
      const feature = deps.features.get(req.params.id);
      if (!feature) throw httpError(404, 'Feature nicht gefunden');
      deps.features.setIntegration(feature.id, 'none');
      deps.attention.resolveFor({ featureId: feature.id, kinds: ['review_due'] });
      if (req.body?.comment) {
        const session = await deps.orchestrator.ensureSession(feature.id);
        deps.ptys.sendPrompt(session.id, `Review-Feedback (bitte umsetzen): ${req.body.comment}`);
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

  // ---------- Attention / Queue / Settings / Executions ----------

  app.get('/api/attention', () => deps.attention.listOpen());
  app.post<{ Params: { id: string } }>('/api/attention/:id/resolve', (req) => {
    deps.attention.resolve(req.params.id);
    bus.emitEvent('attention_resolved', req.params.id);
    return { ok: true };
  });

  // ---------- Personas (WP4) ----------

  app.get('/api/personas', () => deps.personas.list());
  app.put<{ Body: { id?: string; projectId: string | null; name: string; prompt: string; sortOrder: number; enabled: boolean } }>(
    '/api/personas',
    (req) => ({ id: deps.personas.upsert(req.body) }),
  );
  app.delete<{ Params: { id: string } }>('/api/personas/:id', (req) => {
    deps.personas.remove(req.params.id);
    return { ok: true };
  });

  app.get('/api/settings/automation', () => deps.settings.getAutomation());
  app.put<{ Body: Record<string, unknown> }>('/api/settings/automation', (req) => {
    deps.settings.setAutomation({ ...deps.settings.getAutomation(), ...(req.body as object) });
    return deps.settings.getAutomation();
  });

  app.get<{ Querystring: { featureId?: string } }>('/api/executions', (req) =>
    deps.executions.list(req.query.featureId),
  );

  /** Lauf-Log (WP5/WP6): Logs liegen per Konvention unter <dataDir>/logs/<id>.log. */
  app.get<{ Params: { id: string } }>('/api/executions/:id/log', async (req) => {
    if (!/^[A-Za-z0-9_-]+$/.test(req.params.id)) throw httpError(400, 'Ungültige ID');
    const p = join(deps.dataDir, 'logs', `${req.params.id}.log`);
    const content = await readFile(p, 'utf8').catch(() => null);
    if (content === null) throw httpError(404, 'Kein Log vorhanden');
    return { log: content };
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
  app.get('/ws/events', { websocket: true }, (socket) => {
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

  /** Terminal-Stream: bidirektional, mit Scrollback-Replay beim Connect. */
  app.get<{ Params: { sessionId: string } }>('/ws/terminal/:sessionId', { websocket: true }, (socket, req) => {
    const { sessionId } = req.params;
    const unsubscribe = deps.ptys.subscribe(sessionId, (data) => {
      if (socket.readyState === socket.OPEN) socket.send(data);
    });
    if (!unsubscribe) {
      socket.close(4404, 'Session nicht gefunden');
      return;
    }
    socket.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as
          | { type: 'input'; data: string }
          | { type: 'resize'; cols: number; rows: number };
        if (msg.type === 'input') deps.ptys.write(sessionId, msg.data);
        else if (msg.type === 'resize') deps.ptys.resize(sessionId, msg.cols, msg.rows);
      } catch {
        // Nicht-JSON = Roh-Input
        deps.ptys.write(sessionId, raw.toString());
      }
    });
    socket.on('close', () => unsubscribe());
  });

  return app;
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
