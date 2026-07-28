import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import {
  displayStatus,
  hasUsage,
  meter,
  parseSessionFeatures,
  resolveAutomation,
  selectEventsForWindow,
  summarizeEvents,
  sumUsage,
  usageTotalTokens,
  type ChatConversation,
  type ChatFeatureProposal,
  type ChatWorkRestartNeedsConfirm,
  type ChatWorkRestartResult,
  type ChatWorkSessionInfo,
  type Feature,
  type Project,
  type SessionEffect,
} from '@sdd/shared';
import type { AttentionRepo, ChatRepo, ExecutionRepo, ProjectRepo, SessionRepo, SettingsRepo } from '../db/repos.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import type { Orchestrator } from './orchestrator.js';
import { locateTranscript, readTranscriptDelta, transcriptSize } from '../pty/transcriptWatcher.js';
import type { TelemetryStore } from '../telemetry/telemetryStore.js';
import { isCleanWorkingTree } from '../git/git.js';
import { buildClaudeArgv } from '../pty/commandBuilder.js';
import { buildChatWorkSystemPrompt } from './chatWorkPrompt.js';
import { NotificationThrottle } from './notificationThrottle.js';
import { ChatError } from './chatService.js';
import { bus } from '../events.js';

/**
 * Ein Projekt-Chat ohne Aktivität für diese Dauer wird automatisch beendet, damit
 * keine Leerlauf-Session im Hintergrund weiterläuft. Der Verlauf bleibt erhalten:
 * Das Panel zeigt danach eine „Pausiert"-Karte (`workPaused`), über die der Nutzer
 * fortsetzen (`ensure()` → Scrollback-Snapshot + Claude-Resume) oder frisch beginnen kann.
 */
export const CHAT_IDLE_TIMEOUT_MS = 5 * 60_000;

export interface ChatWorkDeps {
  projects: ProjectRepo;
  chatRepo: ChatRepo;
  sessions: SessionRepo;
  attention: AttentionRepo;
  executions: ExecutionRepo;
  settings: SettingsRepo;
  worktrees: WorktreeManager;
  ptys: PtySessionManager;
  /** Feature-Anlage läuft über den kanonischen Pfad (Worktree, optional /speckit-specify). */
  orchestrator: Orchestrator;
  dataDir: string;
  model?: string;
  /** Meldungen der CLI — vorrangige Quelle für Verbrauch UND Kosten eines Turns. */
  telemetry?: TelemetryStore;
}

/**
 * Projekt-Chat als vollwertige Claude-Code-Session: eine interaktive, persistente Session pro
 * Projekt in einer isolierten Worktree/Branch. Der Nutzer tippt direkt in die Konsole. Erkennt
 * die Session, dass sich aus der Unterhaltung Feature(s) herauskristallisieren, gibt sie einen
 * `<sdd:features>`-Marker aus — das Toolkit zeigt eine Bestätigungskarte, und bestätigte Features
 * werden über den normalen Weg (Orchestrator.createFeature) angelegt.
 */
export class ChatWorkService {
  private notify = new NotificationThrottle();
  /** Scrollback-Länge an der letzten Turn-Grenze — Rückfallebene des Metering. */
  private turnStart = new Map<string, number>(); // sessionId → scrollback-Offset
  /** Beginn des laufenden Turns — grenzt die Meldungen der CLI auf genau diesen Turn ein. */
  private turnStartedAt = new Map<string, number>(); // sessionId → ms
  /** Transkript-Position an der letzten Turn-Grenze — grenzt das Delta auf diesen Turn ein. */
  private turnTranscriptOffset = new Map<string, number>(); // sessionId → Byte-Offset
  /** Offener Feature-Vorschlag je Unterhaltung (im Speicher; überlebt Panel-Öffnen). */
  private proposals = new Map<string, ChatFeatureProposal>(); // conversationId → Vorschlag
  /** Dedup: zuletzt verarbeiteter Marker je Unterhaltung. */
  private lastMarker = new Map<string, string>();
  /** Laufender Neustart je Projekt — koalesziert schnelle Doppelklicks (FR-008). */
  private restarting = new Map<string, Promise<ChatWorkRestartResult | ChatWorkRestartNeedsConfirm>>();
  /** Sessions, die für einen Neustart absichtlich beendet werden — kein Fehler-Alarm beim Exit. */
  private terminating = new Set<string>();

  constructor(private deps: ChatWorkDeps) {
    mkdirSync(join(deps.dataDir, 'logs'), { recursive: true });
  }

  // ---------- Session-Lifecycle ----------

  /** Session sicherstellen (idempotent): Worktree anlegen + interaktive Claude-Session spawnen. */
  async ensure(projectId: string): Promise<{ sessionId: string }> {
    const project = this.mustProject(projectId);
    const conv = this.deps.chatRepo.ensureActive(projectId, 'work');

    const existing = this.deps.ptys.forConversation(conv.id);
    if (existing) return { sessionId: existing.id };

    const worktreeName = `chat-${conv.id}`;
    const branch = this.branchFor(conv.id);
    let worktreePath: string;
    try {
      worktreePath = await this.deps.worktrees.create({
        project,
        projectPath: project.path,
        featureName: worktreeName,
        branch,
        defaultBranch: project.defaultBranch,
      });
    } catch (err) {
      throw new ChatError(503, `Arbeitskopie konnte nicht erstellt werden: ${(err as Error).message}`);
    }

    // Resume-Recovery: nie blind auf eine tote Session-ID resumen.
    const prev = this.deps.sessions.latestForConversation(conv.id);
    let resumeId = prev?.claude_session_id ?? undefined;
    if (resumeId && prev && !locateTranscript(worktreePath, resumeId)) {
      this.deps.sessions.setClaudeSessionId(prev.id, null);
      resumeId = undefined;
    }

    const automation = resolveAutomation(this.deps.settings.getAutomation(), project.automation, {});
    const argv = buildClaudeArgv({
      ...(resumeId ? { resume: resumeId } : {}),
      settingsPath: '__SETTINGS__',
      appendSystemPrompt: buildChatWorkSystemPrompt(project),
      ...(this.deps.model ? { model: this.deps.model } : {}),
      permissionMode: automation.autoMode ? 'bypassPermissions' : 'acceptEdits',
    });

    let session: LiveSession;
    try {
      session = await this.deps.ptys.spawn({
        projectId: project.id,
        featureId: null,
        conversationId: conv.id,
        kind: 'chat_work',
        cwd: worktreePath,
        argv,
        withHooks: true,
      });
    } catch (err) {
      throw new ChatError(503, `Session konnte nicht gestartet werden: ${(err as Error).message}`);
    }
    this.turnStart.set(session.id, 0);
    this.deps.sessions.create({
      id: session.id,
      featureId: null,
      conversationId: conv.id,
      projectId: project.id,
      kind: 'chat_work',
      pid: session.pty.pid,
    });
    return { sessionId: session.id };
  }

  /**
   * Wissens-Chat neu starten: aktive Unterhaltung deaktivieren (Verlauf bleibt erhalten),
   * ihre Session/Worktree/Branch verwerfen und eine frische, automatisch gestartete Session
   * beginnen. Liegt laufende Arbeit vor (Session arbeitet ODER Arbeitskopie dirty) und fehlt
   * `confirm`, wird ohne etwas zu verwerfen ein Bestätigungssignal zurückgegeben (FR-006).
   */
  restart(
    projectId: string,
    opts: { confirm?: boolean } = {},
  ): Promise<ChatWorkRestartResult | ChatWorkRestartNeedsConfirm> {
    const inflight = this.restarting.get(projectId);
    if (inflight) return inflight; // Doppelklick-Schutz (FR-008)
    const run = this.doRestart(projectId, opts.confirm === true).finally(() =>
      this.restarting.delete(projectId),
    );
    this.restarting.set(projectId, run);
    return run;
  }

  private async doRestart(
    projectId: string,
    confirm: boolean,
  ): Promise<ChatWorkRestartResult | ChatWorkRestartNeedsConfirm> {
    const project = this.mustProject(projectId);
    const old = this.deps.chatRepo.getActive(projectId);

    if (old) {
      const worktreePath = this.deps.worktrees.pathFor(project, `chat-${old.id}`);

      // Guard (FR-006): arbeitet die Session ODER hat die Arbeitskopie unbestätigte Änderungen?
      const live = this.deps.ptys.forConversation(old.id);
      const status = live ? displayStatus(live.machine.state) : null;
      const running = status === 'working' || status === 'awaiting_input';
      let dirty = false;
      try {
        dirty = !(await isCleanWorkingTree(worktreePath));
      } catch {
        dirty = false; // Worktree existiert (noch) nicht → nichts zu verlieren
      }
      if (!confirm && (running || dirty)) {
        return { needsConfirm: true, reason: running ? 'running' : 'dirty' };
      }

      // Verwerfen: Session beenden, Worktree + Branch fallenlassen (FR-007).
      if (live) {
        this.terminating.add(live.id); // absichtlicher Exit → kein Fehler-Alarm in handleExit
        await this.deps.ptys.terminate(live.id);
        this.deps.ptys.remove(live.id);
        this.deps.sessions.end(live.id);
      }
      await this.deps.worktrees
        .remove(project.path, worktreePath, { force: true })
        .catch(() => {});
      await this.deps.worktrees.deleteBranch(project.path, this.branchFor(old.id)).catch(() => {});

      // Flüchtigen Feature-Vorschlag entfernen (FR-009) und Unterhaltung deaktivieren (behalten).
      this.proposals.delete(old.id);
      this.lastMarker.delete(old.id);
      this.deps.chatRepo.endConversation(old.id);
    }

    // Frische, aktive Unterhaltung → automatisch gestartete Session (FR-002/003/004).
    const fresh = this.deps.chatRepo.createConversation(projectId, 'work');
    const { sessionId } = await this.ensure(projectId);
    bus.emitEvent('chat_updated', { projectId, conversationId: fresh.id });
    return { sessionId, conversationId: fresh.id };
  }

  /** Laufzeit-Info der Session (null, wenn keine läuft) — für den Status-Indikator. */
  workSessionInfo(conversation: ChatConversation): ChatWorkSessionInfo | null {
    const live = this.deps.ptys.forConversation(conversation.id);
    if (!live) return null;
    return {
      sessionId: live.id,
      status: displayStatus(live.machine.state),
      awaitingKind: live.machine.state.kind === 'awaiting_input' ? live.machine.state.awaiting : null,
      branch: this.branchFor(conversation.id),
    };
  }

  /**
   * „Pausiert": Die Unterhaltung hatte schon eine echte Session, die aber nicht mehr
   * läuft (Leerlauf-Reaper oder Server-Neustart) und sich fortsetzen ließe. Signal für
   * das Panel, den Nutzer zu fragen (fortsetzen ODER neu) statt still zu resumen.
   */
  workPaused(conversation: ChatConversation): boolean {
    if (this.deps.ptys.forConversation(conversation.id)) return false; // läuft → nicht pausiert
    const prev = this.deps.sessions.latestForConversation(conversation.id);
    return !!prev?.claude_session_id; // es gab bereits eine echte Session → fortsetzbar
  }

  // ---------- Feature-Vorschläge ----------

  /** Offener Vorschlag der aktiven Unterhaltung (für GET /chat). */
  proposalForProject(projectId: string): ChatFeatureProposal | null {
    const conv = this.deps.chatRepo.getActive(projectId);
    return conv ? (this.proposals.get(conv.id) ?? null) : null;
  }

  /** Bestätigte Features anlegen (Teilmenge per Name); löscht den Vorschlag. */
  async createFeatures(projectId: string, names: string[]): Promise<Feature[]> {
    const conv = this.deps.chatRepo.getActive(projectId);
    if (!conv) throw new ChatError(404, 'Keine aktive Unterhaltung');
    const proposal = this.proposals.get(conv.id);
    if (!proposal) throw new ChatError(404, 'Kein offener Feature-Vorschlag');

    const wanted = new Set(names);
    const selected = proposal.features.filter((f) => wanted.has(f.name));
    if (selected.length === 0) throw new ChatError(400, 'Kein Feature ausgewählt');

    const created: Feature[] = [];
    const errors: string[] = [];
    for (const f of selected) {
      try {
        created.push(await this.deps.orchestrator.createFeature(projectId, f.name, f.description));
      } catch (err) {
        errors.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    this.proposals.delete(conv.id);
    bus.emitEvent('chat_updated', { projectId, conversationId: conv.id });
    if (created.length === 0) throw new ChatError(409, `Feature-Anlage fehlgeschlagen — ${errors.join('; ')}`);
    return created;
  }

  /** Vorschlag verwerfen (kein Feature anlegen). */
  dismissProposal(projectId: string): void {
    const conv = this.deps.chatRepo.getActive(projectId);
    if (!conv) return;
    this.proposals.delete(conv.id);
    bus.emitEvent('chat_updated', { projectId, conversationId: conv.id });
  }

  // ---------- Session-Callbacks (delegiert vom Orchestrator / PtySessionManager) ----------

  /** Marker-Erkennung: Assistant-Text der Session auf Feature-Vorschläge prüfen. */
  onAssistantText(session: LiveSession, text: string): void {
    const conversationId = session.conversationId;
    if (!conversationId) return;
    const features = parseSessionFeatures(text);
    if (!features) return;
    const key = JSON.stringify(features);
    if (this.lastMarker.get(conversationId) === key) return; // Dedup (gleicher Marker erneut)
    this.lastMarker.set(conversationId, key);
    this.proposals.set(conversationId, { id: nanoid(10), features });
    bus.emitEvent('chat_updated', { projectId: session.projectId, conversationId });
    if (this.notify.allow(session.id, 'input_requested')) {
      bus.emitEvent('notification', {
        title: 'Projekt-Chat: Feature-Vorschlag',
        body: features.length === 1 ? features[0]!.name : `${features.length} Features vorgeschlagen`,
        featureId: null,
        kind: 'input_requested',
      });
    }
  }

  handleStatusChange(session: LiveSession, effects: SessionEffect[]): void {
    const status = displayStatus(session.machine.state);
    const awaiting = session.machine.state.kind === 'awaiting_input' ? session.machine.state.awaiting : null;
    bus.emitEvent('session_status', {
      sessionId: session.id,
      featureId: null,
      conversationId: session.conversationId,
      projectId: session.projectId,
      status,
      awaitingKind: awaiting,
      lastActiveAt: session.lastActiveAt,
    });

    if (status === 'working') {
      this.deps.attention.resolveFor({ sessionId: session.id, kinds: ['awaiting_input', 'permission_request'] });
      bus.emitEvent('attention_resolved', session.id);
    }
    // Zustandsgekoppelte Bereinigung (US1): überholte Meldungen (auch der frühere „Agent-Fehler"
    // dieser Unterhaltung) auflösen, sobald wieder gearbeitet wird. Nicht im Warte-Übergang, damit
    // eine gerade entstehende Frage nicht sofort wieder entfernt wird.
    if (status !== 'awaiting_input') {
      this.deps.orchestrator.reconcileOpenAttention();
    }

    for (const effect of effects) {
      if (effect.kind === 'input_requested') {
        if (effect.awaiting === 'permission') continue; // in der Konsole beantworten
        const item = this.deps.attention.raise({
          kind: 'awaiting_input',
          projectId: session.projectId,
          sessionId: session.id,
          conversationId: session.conversationId,
          message:
            effect.awaiting === 'plan_approval'
              ? 'Projekt-Chat: wartet auf Plan-Freigabe'
              : 'Projekt-Chat: hat eine Frage',
        });
        bus.emitEvent('attention_raised', item);
        if (this.notify.allow(session.id, 'input_requested')) {
          bus.emitEvent('notification', {
            title: 'Projekt-Chat wartet auf dich',
            body: item.message,
            featureId: null,
            kind: 'input_requested',
          });
        }
      } else if (effect.kind === 'turn_completed') {
        this.meterTurn(session);
      }
    }
  }

  /**
   * Verbrauch eines Chat-Turns messen — dieselbe Kaskade wie im Phasen-Pfad
   * (Orchestrator.meterTurn): Meldungen der CLI vor Transkript vor Schätzung.
   *
   * Vorher schätzte diese Methode aus dem Terminal-Scrollback mit leerem
   * `promptText` und schrieb weder Kosten noch Quelle. Gemessen wurde damit
   * ausgerechnet die Größe, die kaum ins Gewicht fällt: In einem Chat vom
   * 28.07.2026 standen 7,0 Mio. gelesene Cache-Tokens 45k Ausgabe-Tokens
   * gegenüber — erfasst waren 94k Tokens und 0 $ statt real gut 5 $.
   */
  private meterTurn(session: LiveSession): void {
    const scrollbackStart = this.turnStart.get(session.id) ?? 0;
    const startedAt = this.turnStartedAt.get(session.id) ?? 0;
    const outputText = session.scrollback.slice(scrollbackStart);
    const finishedAt = Date.now();

    this.turnStart.set(session.id, session.scrollback.length);
    this.turnStartedAt.set(session.id, finishedAt);

    const usage = this.usageForTurn(session, startedAt, finishedAt, outputText);
    if (!usage) return;

    const execId = this.deps.executions.start({
      projectId: session.projectId,
      featureId: null,
      kind: 'chat_work',
      phase: null,
      logPath: null,
    });
    this.deps.executions.finishWithUsage(execId, 0, usage);
  }

  /** Meldungen → Transkript → Scrollback-Schätzung; `null`, wenn der Turn nichts hergab. */
  private usageForTurn(session: LiveSession, startedAt: number, finishedAt: number, outputText: string) {
    const store = this.deps.telemetry;
    if (store) {
      const events = selectEventsForWindow(store.eventsFor(session.id), { from: startedAt, to: finishedAt });
      if (events.length > 0) {
        const { total, model } = summarizeEvents(events);
        return {
          tokens: total.tokens,
          inputTokens: total.inputTokens,
          outputTokens: total.outputTokens,
          cacheReadTokens: total.cacheReadTokens,
          cacheCreationTokens: total.cacheCreationTokens,
          tokensSource: 'telemetry' as const,
          costMicros: total.costMicros,
          model,
        };
      }
    }

    if (session.claudeSessionId) {
      const path = locateTranscript(session.cwd, session.claudeSessionId);
      if (path) {
        const offset = this.turnTranscriptOffset.get(session.id) ?? 0;
        const usage = sumUsage(readTranscriptDelta(path, offset));
        this.turnTranscriptOffset.set(session.id, transcriptSize(path));
        if (hasUsage(usage)) {
          return {
            tokens: usageTotalTokens(usage),
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            tokensSource: 'transcript' as const,
          };
        }
      }
    }

    if (!outputText.trim()) return null;
    const cost = meter({ ...(this.deps.model ? { model: this.deps.model } : {}), promptText: '', outputText });
    return {
      tokens: cost.totalTokens,
      tokensSource: (cost.source === 'parsed' ? 'parsed' : 'estimated') as 'parsed' | 'estimated',
    };
  }

  handleExit(session: LiveSession, exitCode: number): void {
    this.deps.sessions.end(session.id);
    this.turnStart.delete(session.id);
    this.turnStartedAt.delete(session.id);
    this.turnTranscriptOffset.delete(session.id);
    // Beendete Session → eine offene „Frage" dieser Session ist hinfällig.
    this.deps.attention.resolveFor({ sessionId: session.id, kinds: ['awaiting_input'] });
    bus.emitEvent('attention_resolved', session.id);
    const intentional = this.terminating.delete(session.id); // Neustart-Termination → kein Alarm
    if (exitCode !== 0 && !intentional) {
      const item = this.deps.attention.raise({
        kind: 'agent_errored',
        projectId: session.projectId,
        sessionId: session.id,
        conversationId: session.conversationId,
        message: `Projekt-Chat-Session beendet (exit ${exitCode})`,
      });
      bus.emitEvent('attention_raised', item);
    }
    this.deps.ptys.remove(session.id);
  }

  /**
   * Leerlauf-Reaper: beendet Projekt-Chat-Sessions, die seit `maxIdleMs` nicht mehr
   * gearbeitet haben (weder `working` noch zwischenzeitlich aktiv). Eine gerade
   * arbeitende Session wird nie abgewürgt. Der Exit läuft über den regulären Pfad
   * (`handleExit`); dank `terminating` gibt es dabei keinen Fehler-Alarm.
   */
  reapIdleSessions(now: number = Date.now(), maxIdleMs: number = CHAT_IDLE_TIMEOUT_MS): void {
    for (const s of this.deps.ptys.list()) {
      try {
        if (s.kind !== 'chat_work' || s.exited) continue;
        if (displayStatus(s.machine.state) === 'working') continue; // aktiver Turn → laufen lassen
        if (now - s.lastActiveAt < maxIdleMs) continue;
        this.terminating.add(s.id); // erwarteter Exit → kein „braucht dich"-Alarm
        // Fehler beim Beenden dürfen weder die Schleife abbrechen noch als
        // unbehandelte Rejection den Serverprozess reißen.
        void this.deps.ptys.terminate(s.id).catch((err) => {
          console.error(`[chatWork] Reap von Session ${s.id} fehlgeschlagen:`, err);
        });
        if (s.conversationId) {
          bus.emitEvent('chat_updated', { projectId: s.projectId, conversationId: s.conversationId });
        }
      } catch (err) {
        console.error(`[chatWork] Reap-Iteration für Session ${s.id} fehlgeschlagen:`, err);
      }
    }
  }

  killAll(): void {
    this.turnStart.clear();
  }

  // ---------- Helpers ----------

  private branchFor(conversationId: string): string {
    return `chat/${conversationId}`;
  }

  private mustProject(id: string): Project {
    const p = this.deps.projects.get(id);
    if (!p) throw new ChatError(404, 'Projekt nicht gefunden');
    return p;
  }
}
