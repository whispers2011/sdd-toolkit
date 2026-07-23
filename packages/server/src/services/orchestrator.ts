import { existsSync } from 'node:fs';
import {
  approvePhase,
  discardPhase,
  finishPhase,
  initialPhases,
  hasUsage,
  meter,
  nextPhase,
  reapOrphanedRunning,
  reconcileWithDisk,
  resolveAutomation,
  resolveOptimization,
  shouldAutoProgress,
  startPhase,
  sumUsage,
  displayStatus,
  usageToCost,
  type AutomationSettings,
  type Feature,
  type FeaturePhase,
  type OptimizationSettings,
  type Project,
  type SessionEffect,
} from '@sdd/shared';
import type { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo, SessionRepo, SettingsRepo } from '../db/repos.js';
import type { KnowledgeService } from './knowledgeService.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import { locateTranscript, readTranscriptDelta, transcriptSize } from '../pty/transcriptWatcher.js';
import { buildClaudeArgv, phaseSlashCommand, resetCommand } from '../pty/commandBuilder.js';
import { prepareForPhase } from './contextOptimizer.js';
import { artifactExists, parseTaskProgress, speckitCommandPrefix } from './artifacts.js';
import { bus } from '../events.js';
import { NotificationThrottle } from './notificationThrottle.js';
import type { MergeQueueService } from './mergeQueueService.js';
import type { ChatWorkService } from './chatWorkService.js';
import {
  findStaleOnBoot,
  findStaleRuntime,
  type ReconcileSnapshot,
} from './attentionReconciler.js';

export interface OrchestratorDeps {
  projects: ProjectRepo;
  features: FeatureRepo;
  sessions: SessionRepo;
  executions: ExecutionRepo;
  attention: AttentionRepo;
  settings: SettingsRepo;
  worktrees: WorktreeManager;
  ptys: PtySessionManager;
  knowledge: KnowledgeService;
  dataDir: string;
}

/** Laufender Phasen-Kontext pro Feature (ephemer). */
interface RunningPhase {
  phase: FeaturePhase;
  executionId: string;
  /** Scrollback-Offset beim Start — für Kosten-Metering des Turn-Deltas (WP3). */
  scrollbackStart: number;
  /** Transkript-Byte-Offset beim Start — für autoritative Usage-Messung. */
  transcriptOffsetStart: number;
  /**
   * Transkript-Pfad beim Start. Wechselt die Claude-Session-ID während der Phase
   * (z. B. /clear-Reset), gilt der Start-Offset nicht für die neue Datei —
   * dann wird ab 0 gemessen.
   */
  transcriptPathStart: string | null;
  promptText: string;
}

export class Orchestrator {
  private runningPhases = new Map<string, RunningPhase>(); // featureId → Phase
  private ensuringSessions = new Map<string, Promise<LiveSession>>(); // featureId → laufender ensureSession-Aufruf
  private mergeQueue: MergeQueueService | null = null;
  private chatWork: ChatWorkService | null = null;
  private notifyThrottle = new NotificationThrottle();

  constructor(private deps: OrchestratorDeps) {}

  attachMergeQueue(q: MergeQueueService): void {
    this.mergeQueue = q;
  }

  /** Arbeits-Chat-Sessions (kind chat_work) werden vom ChatWorkService behandelt. */
  attachChatWork(svc: ChatWorkService): void {
    this.chatWork = svc;
  }

  // ---------- Feature-Lifecycle ----------

  async createFeature(projectId: string, name: string, description?: string): Promise<Feature> {
    const project = this.mustProject(projectId);
    const slug = slugify(name);
    if (this.deps.features.getByName(projectId, slug)) {
      throw new Error(`Feature '${slug}' existiert bereits`);
    }
    const branch = `feature/${slug}`;
    const worktreePath = await this.deps.worktrees.create({
      projectId,
      projectPath: project.path,
      featureName: slug,
      branch,
      defaultBranch: project.defaultBranch,
    });

    const feature = this.deps.features.create({
      projectId,
      name: slug,
      branch,
      worktreePath,
      phases: initialPhases(project.enabledPhases),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    bus.emitEvent('feature_updated', feature);

    await this.ensureSession(feature.id);
    if (description) {
      await this.startPhaseRun(feature.id, 'specify', description);
    }
    return this.deps.features.get(feature.id)!;
  }

  /**
   * Konsole pro Feature: eine persistente Claude-Session im Worktree.
   * Pro Feature serialisiert (in-flight Promise), sonst spawnen zwei gleichzeitige
   * Aufrufe (z. B. Grid-Auto-Select + Konsole öffnen) doppelte Sessions.
   */
  ensureSession(featureId: string): Promise<LiveSession> {
    const inFlight = this.ensuringSessions.get(featureId);
    if (inFlight) return inFlight;
    const p = this.ensureSessionInner(featureId).finally(() => {
      this.ensuringSessions.delete(featureId);
    });
    this.ensuringSessions.set(featureId, p);
    return p;
  }

  private async ensureSessionInner(featureId: string): Promise<LiveSession> {
    const feature = this.mustFeature(featureId);
    const project = this.mustProject(feature.projectId);
    const existing = this.deps.ptys.forFeature(featureId);
    if (existing) return existing;

    // Abgeschlossene Features bekommen keine neue Session mehr — sonst sammeln
    // sich offene Sessions auf gemergten/archivierten Features an.
    if (feature.integration === 'merged' || feature.archivedAt !== null) {
      throw new Error(`Feature '${feature.name}' ist abgeschlossen — keine neue Session`);
    }

    // Worktree sicherstellen — auch wenn ein gespeicherter Pfad auf Disk fehlt
    // (z. B. manuell gelöscht): worktrees.create ist idempotent.
    if (!feature.worktreePath || !existsSync(feature.worktreePath)) {
      if (feature.worktreePath) await this.deps.worktrees.remove(project.path, feature.worktreePath).catch(() => {});
      const wt = await this.deps.worktrees.create({
        projectId: project.id,
        projectPath: project.path,
        featureName: feature.name,
        branch: feature.branch,
        defaultBranch: project.defaultBranch,
      });
      this.deps.features.setWorktree(featureId, wt);
      feature.worktreePath = wt;
    }

    // Resume-Recovery (WP2): nie blind auf eine tote Session-ID resumen —
    // erst prüfen, ob das Transkript-JSONL noch existiert (Claude räumt nach ~30 Tagen auf).
    const prev = this.deps.sessions.latestForFeature(featureId);
    let resumeId = prev?.claude_session_id ?? undefined;
    if (resumeId && prev) {
      if (!locateTranscript(feature.worktreePath ?? project.path, resumeId)) {
        this.deps.sessions.setClaudeSessionId(prev.id, null);
        resumeId = undefined;
      }
    }

    // Auto-Modus (aufgelöst global → Projekt → Feature): an → bypassPermissions
    // (keine Kommando-/Tool-Rückfragen), aus → acceptEdits (nur Edits, Kommandos fragen nach).
    const automation = this.automationFor(feature);
    const argv = buildClaudeArgv({
      ...(resumeId ? { resume: resumeId } : {}),
      settingsPath: '__SETTINGS__',
      permissionMode: automation.autoMode ? 'bypassPermissions' : 'acceptEdits',
    });

    const session = await this.deps.ptys.spawn({
      projectId: project.id,
      featureId,
      kind: 'feature',
      cwd: feature.worktreePath,
      argv,
      withHooks: true,
    });
    this.deps.sessions.create({
      id: session.id,
      featureId,
      projectId: project.id,
      kind: 'feature',
      pid: session.pty.pid,
    });
    return session;
  }

  // ---------- Phasen ----------

  async startPhaseRun(featureId: string, phase: FeaturePhase, extraPrompt?: string): Promise<void> {
    const feature = this.mustFeature(featureId);
    const t = startPhase(feature.phases, phase, Date.now());
    this.deps.features.savePhases(featureId, t.phases);

    try {
      const session = await this.ensureSession(featureId);
      const slash = phaseSlashCommand(phase, `specs/${feature.name}`, this.commandPrefixFor(feature));
      const base = extraPrompt ? `${slash} ${extraPrompt}` : slash;
      this.launchPhase(feature, phase, session, base);
      this.emitFeature(featureId);
    } catch (err) {
      // Start fehlgeschlagen → kein hängendes „läuft": Phase zurückrollen + „braucht dich".
      this.failPhaseStart(
        featureId,
        phase,
        `${feature.name}: Phase ${phase} konnte nicht gestartet werden (${(err as Error).message})`,
      );
      throw err;
    }
  }

  /** Fehlgeschlagenen Phasenstart zurückrollen (running → idle) und ein „braucht dich"-Item erzeugen. */
  private failPhaseStart(featureId: string, phase: FeaturePhase, message: string): void {
    this.runningPhases.delete(featureId);
    const feature = this.deps.features.get(featureId);
    if (!feature) return;
    if (feature.phases[phase]?.status === 'running') {
      const t = finishPhase(feature.phases, phase, 1, Date.now());
      this.deps.features.savePhases(featureId, t.phases);
    }
    const item = this.deps.attention.raise({
      kind: 'agent_errored',
      projectId: feature.projectId,
      featureId,
      sessionId: null,
      message,
    });
    bus.emitEvent('attention_raised', item);
    this.emitFeature(featureId);
  }

  /**
   * Gemeinsamer Phasen-Start (Token-Optimierung): Optimierungs-Settings auflösen,
   * Kontext ggf. zurücksetzen (P2) und Wissens-Präambel ggf. verdichten (P3),
   * Transkript-Offset für autoritative Messung festhalten, dann Prompt senden.
   */
  private launchPhase(feature: Feature, phase: FeaturePhase, session: LiveSession, base: string): void {
    const opt = this.optimizationFor(feature);
    const root = feature.worktreePath ?? this.mustProject(feature.projectId).path;
    const plan = prepareForPhase({
      phase,
      worktreeRoot: root,
      featureName: feature.name,
      opt,
      rawPreamble: this.knowledgePreambleFor(feature.id),
    });
    if (plan.fellBackToFull) {
      console.warn(`[optimizer] ${feature.name}/${phase}: Basis-Artefakt fehlt → voller Kontext`);
    }
    if (plan.report) {
      console.log(
        `[optimizer] ${feature.name}/${phase}: Präambel verdichtet ${plan.report.tokensBefore}→${plan.report.tokensAfter} Tokens`,
      );
    }
    if (plan.llmSkipped) {
      console.log(
        `[optimizer] ${feature.name}/${phase}: LLM-Verdichtung übersprungen (Präambel zu klein für Netto-Ersparnis) → deterministisch`,
      );
    }

    // Offset VOR dem Reset festhalten: die Usage des Resets (z. B. /compact) gehört
    // zur realen Kosten dieses optimierten Laufs und wird so mitgemessen (faires A/B).
    const { path: transcriptPathStart, offset: transcriptOffsetStart } = this.transcriptMarkFor(session);
    const executionId = this.deps.executions.start({
      projectId: feature.projectId,
      featureId: feature.id,
      kind: 'phase',
      phase,
      logPath: null,
      transcriptOffsetStart,
      optContextStrategy: opt.contextStrategy,
      optCompression: opt.compression,
    });

    const prompt = base + plan.preamble;
    this.runningPhases.set(feature.id, {
      phase,
      executionId,
      scrollbackStart: session.scrollback.length,
      transcriptOffsetStart,
      transcriptPathStart,
      promptText: prompt,
    });

    // Reset-Kommando (opt-in) VOR dem Phasenprompt; Session-Prozess/-ID bleiben.
    if (plan.reset) this.deps.ptys.sendPrompt(session.id, resetCommand(plan.reset));
    this.deps.ptys.sendPrompt(session.id, prompt);
  }

  /** Aktuelle Transkript-Startmarke der Session (Pfad + Byte-Offset; 0/null wenn unbekannt). */
  private transcriptMarkFor(session: LiveSession): { path: string | null; offset: number } {
    if (!session.claudeSessionId) return { path: null, offset: 0 };
    const path = locateTranscript(session.cwd, session.claudeSessionId);
    return { path, offset: path ? transcriptSize(path) : 0 };
  }

  private optimizationFor(feature: Feature): OptimizationSettings {
    const project = this.mustProject(feature.projectId);
    return resolveOptimization(
      this.deps.settings.getOptimization(),
      project.optimization,
      feature.optimization,
    );
  }

  approve(featureId: string, phase: FeaturePhase): void {
    const feature = this.mustFeature(featureId);
    const automation = this.automationFor(feature);
    const t = approvePhase(feature.phases, phase, automation, Date.now());
    this.deps.features.savePhases(featureId, t.phases);
    this.emitFeature(featureId);
    this.runEffects(featureId, t.effects);
  }

  /**
   * Drag-to-Advance (speckit-Muster): alle Zwischenphasen bis zur Zielphase
   * approven, dann die Zielphase starten.
   */
  async advanceTo(featureId: string, target: FeaturePhase): Promise<void> {
    const feature = this.mustFeature(featureId);
    const order = Object.keys(feature.phases) as FeaturePhase[];
    for (const p of order) {
      if (p === target) break;
      const fresh = this.mustFeature(featureId);
      const status = fresh.phases[p]?.status;
      if (status === 'approved') continue;
      if (status === 'awaiting_review') {
        // Direkt approven ohne Auto-Progress-Effekte (das Ziel bestimmt der Drag).
        const t = approvePhase(fresh.phases, p, { ...this.automationFor(fresh), autoProgressUntil: 'off', autoVerify: false }, Date.now());
        this.deps.features.savePhases(featureId, t.phases);
      } else {
        throw new Error(`Phase ${p} ist ${status ?? 'unbekannt'} — kann nicht zu ${target} springen`);
      }
    }
    await this.startPhaseRun(featureId, target);
  }

  discard(featureId: string, phase: FeaturePhase): void {
    const feature = this.mustFeature(featureId);
    const t = discardPhase(feature.phases, phase);
    this.deps.features.savePhases(featureId, t.phases);
    this.emitFeature(featureId);
  }

  private runEffects(featureId: string, effects: import('@sdd/shared').PhaseEffect[]): void {
    for (const e of effects) {
      if (e.kind === 'start_agent') {
        void this.startAgentForApprovedChain(featureId, e.phase);
      } else if (e.kind === 'start_integration') {
        void this.mergeQueue?.beginIntegration(featureId);
      }
    }
  }

  /** Effekt start_agent: Phase ist in der Maschine schon running — nur Lauf starten. */
  private async startAgentForApprovedChain(featureId: string, phase: FeaturePhase): Promise<void> {
    const feature = this.mustFeature(featureId);
    const session = await this.ensureSession(featureId);
    const base = phaseSlashCommand(phase, `specs/${feature.name}`, this.commandPrefixFor(feature));
    this.launchPhase(feature, phase, session, base);
    this.emitFeature(featureId);
  }

  /**
   * Projektspezifisches Wissen für die Phase in den Worktree materialisieren und
   * einen kompakten Pointer für die Prompt zurückgeben. Best-effort — Wissen darf
   * eine Phase nie blockieren.
   */
  private knowledgePreambleFor(featureId: string): string {
    try {
      const feature = this.deps.features.get(featureId);
      if (!feature) return '';
      return this.deps.knowledge.materializeForFeature(feature).preamble;
    } catch (err) {
      console.warn('[knowledge] Materialisierung übersprungen:', (err as Error).message);
      return '';
    }
  }

  // ---------- Session-Callbacks (von PtySessionManager) ----------

  handleStatusChange(session: LiveSession, effects: SessionEffect[]): void {
    if (session.kind === 'chat_work' && this.chatWork) {
      this.chatWork.handleStatusChange(session, effects);
      return;
    }
    const status = displayStatus(session.machine.state);
    const awaiting = session.machine.state.kind === 'awaiting_input' ? session.machine.state.awaiting : null;

    bus.emitEvent('session_status', {
      sessionId: session.id,
      featureId: session.featureId,
      conversationId: session.conversationId,
      projectId: session.projectId,
      status,
      awaitingKind: awaiting,
      lastActiveAt: session.lastActiveAt,
    });

    // Wieder aktiv → offene Aufmerksamkeits-Items dieser Session sind erledigt.
    if (status === 'working') {
      this.deps.attention.resolveFor({
        sessionId: session.id,
        kinds: ['awaiting_input', 'permission_request'],
      });
      bus.emitEvent('attention_resolved', session.id);
    }
    // Zustandsgekoppelte Bereinigung: jede jetzt überholte Meldung auflösen (auch feature-weit,
    // z.B. „Agent-Fehler" sobald wieder gearbeitet wird). Nur in Nicht-Warte-Übergängen, damit
    // eine gerade frisch entstehende Frage nicht sofort wieder entfernt wird.
    if (status !== 'awaiting_input') {
      this.reconcileOpenAttention();
    }

    for (const effect of effects) {
      if (effect.kind === 'input_requested') {
        // Berechtigungs-Rückfragen erscheinen nicht in der „Braucht dich"-Inbox: Im Auto-Modus
        // entstehen sie ohnehin nicht; ist er aus, wird in der Feature-Konsole geantwortet.
        // Der awaiting_input-Status wurde oben via session_status bereits publiziert.
        if (effect.awaiting === 'permission') continue;
        const feature = session.featureId ? this.deps.features.get(session.featureId) : null;
        const item = this.deps.attention.raise({
          kind: 'awaiting_input',
          projectId: session.projectId,
          featureId: session.featureId,
          sessionId: session.id,
          message:
            effect.awaiting === 'plan_approval'
              ? `${feature?.name ?? 'Session'}: wartet auf Plan-Freigabe`
              : `${feature?.name ?? 'Session'}: hat eine Frage`,
        });
        bus.emitEvent('attention_raised', item);
        if (this.notifyThrottle.allow(session.id, 'input_requested')) {
          bus.emitEvent('notification', {
            title: 'Agent wartet auf dich',
            body: item.message,
            featureId: session.featureId,
            kind: 'input_requested',
          });
        }
      } else if (effect.kind === 'turn_completed') {
        void this.handleTurnCompleted(session);
      }
    }
  }

  private async handleTurnCompleted(session: LiveSession): Promise<void> {
    if (!session.featureId) return;
    const featureId = session.featureId;
    const running = this.runningPhases.get(featureId);
    const feature = this.deps.features.get(featureId);
    if (!feature) return;

    if (running) {
      this.runningPhases.delete(featureId);
      // Kosten-Metering: autoritativ aus dem Transkript, Fallback auf Scrollback-Schätzung.
      this.deps.executions.finishWithUsage(running.executionId, 0, this.meterTurn(session, running));
      // Transkript-Endkoordinaten festhalten → Lauf-Log ist neustartfest abrufbar.
      this.persistTranscriptRange(session, running);

      // Task-Fortschritt aktualisieren (implement/tasks ändern tasks.md).
      if (feature.worktreePath) {
        const progress = await parseTaskProgress(feature.worktreePath, feature.name);
        this.deps.features.setTasks(featureId, progress.done, progress.total);
      }

      const t = finishPhase(feature.phases, running.phase, 0, Date.now());
      this.deps.features.savePhases(featureId, t.phases);
      this.emitFeature(featureId);

      const automation = this.automationFor(feature);
      const next = nextPhase(t.phases, running.phase);

      if (next !== null && shouldAutoProgress(next, automation)) {
        // „Claude kickt Claude an": Auto-Approve + Auto-Start der Folgephase.
        this.approve(featureId, running.phase);
      } else if (next === null && automation.autoVerify) {
        this.approve(featureId, running.phase);
      } else {
        if (this.notifyThrottle.allow(session.id, 'turn_completed')) {
          bus.emitEvent('notification', {
            title: `Phase ${running.phase} fertig`,
            body: `${feature.name}: wartet auf dein Review`,
            featureId,
            kind: 'turn_completed',
          });
        }
      }
    } else {
      if (this.notifyThrottle.allow(session.id, 'turn_completed')) {
        bus.emitEvent('notification', {
          title: 'Agent ist fertig',
          body: `${feature.name}: Turn abgeschlossen`,
          featureId,
          kind: 'turn_completed',
        });
      }
    }
  }

  /**
   * Verbrauch eines abgeschlossenen Phasen-Turns messen. Bevorzugt autoritative
   * Usage aus dem Transkript-Delta (inkl. cache_read = akkumulierter Kontext);
   * fällt auf die Scrollback-Schätzung zurück, wenn kein Transkript/keine Usage vorliegt.
   */
  private meterTurn(session: LiveSession, running: RunningPhase) {
    if (session.claudeSessionId) {
      const path = locateTranscript(session.cwd, session.claudeSessionId);
      if (path) {
        // Session-ID/Datei hat während der Phase gewechselt (/clear-Reset) →
        // Start-Offset gilt nicht für die neue Datei, ab 0 messen.
        const offset = path === running.transcriptPathStart ? running.transcriptOffsetStart : 0;
        const usage = sumUsage(readTranscriptDelta(path, offset));
        if (hasUsage(usage)) {
          const { totalTokens, costUsd } = usageToCost(usage);
          return {
            costUsd,
            tokens: totalTokens,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            tokensSource: 'transcript' as const,
          };
        }
      }
    }
    const outputText = session.scrollback.slice(running.scrollbackStart);
    const cost = meter({ promptText: running.promptText, outputText });
    return {
      costUsd: cost.costUsd,
      tokens: cost.totalTokens,
      tokensSource: (cost.source === 'parsed' ? 'parsed' : 'estimated') as 'parsed' | 'estimated',
    };
  }

  /**
   * Transkriptpfad + End-Offset eines abgeschlossenen Phasen-Laufs persistieren, damit
   * der Lauf-Log-Endpoint den Ausschnitt [start, end) auch nach Server-Neustart rendern
   * kann. Ohne Transkript (keine claudeSessionId) bleibt der Pfad null. Hat die Datei
   * während der Phase gewechselt (/clear), wird der Start-Offset auf 0 korrigiert.
   */
  private persistTranscriptRange(session: LiveSession, running: RunningPhase): void {
    const path = session.claudeSessionId
      ? locateTranscript(session.cwd, session.claudeSessionId)
      : null;
    const offsetEnd = path ? transcriptSize(path) : 0;
    const offsetStartFix = path && path !== running.transcriptPathStart ? 0 : null;
    this.deps.executions.recordTranscriptEnd(running.executionId, path, offsetEnd, offsetStartFix);
  }

  /**
   * Callback der Send-Pipeline: ein Prompt konnte nicht zugestellt werden (Session
   * lebt, nimmt ihn aber nicht an). Laufende Phase zurückrollen + „braucht dich".
   */
  handleSubmitFailed(session: LiveSession, _text: string): void {
    if (session.kind === 'chat_work') return; // Arbeits-Chat läuft über einen anderen Pfad
    const featureId = session.featureId;
    if (!featureId) return;
    const feature = this.deps.features.get(featureId);
    const running = this.runningPhases.get(featureId);
    if (running) {
      this.runningPhases.delete(featureId);
      this.deps.executions.finish(running.executionId, 1);
      if (feature) {
        const t = finishPhase(feature.phases, running.phase, 1, Date.now());
        this.deps.features.savePhases(featureId, t.phases);
        this.emitFeature(featureId);
      }
    }
    const item = this.deps.attention.raise({
      kind: 'agent_errored',
      projectId: session.projectId,
      featureId,
      sessionId: session.id,
      message: running
        ? `${feature?.name ?? 'Feature'}: Kommando für Phase ${running.phase} konnte nicht gestartet werden`
        : `${feature?.name ?? 'Feature'}: Prompt konnte nicht abgeschickt werden`,
    });
    bus.emitEvent('attention_raised', item);
  }

  handleExit(session: LiveSession, exitCode: number): void {
    if (session.kind === 'chat_work' && this.chatWork) {
      this.chatWork.handleExit(session, exitCode);
      return;
    }
    this.deps.sessions.end(session.id);
    // Beendete Session → eine offene „Frage" dieser Session ist hinfällig.
    this.deps.attention.resolveFor({ sessionId: session.id, kinds: ['awaiting_input'] });
    bus.emitEvent('attention_resolved', session.id);
    if (session.featureId) {
      const running = this.runningPhases.get(session.featureId);
      if (running) {
        // Session starb mitten in einer Phase → Phase zurücksetzen.
        this.runningPhases.delete(session.featureId);
        this.deps.executions.finish(running.executionId, exitCode || 1);
        // Auch abgebrochene/fehlgeschlagene Läufe behalten ihr Log (US1-Szenario 3).
        this.persistTranscriptRange(session, running);
        const feature = this.deps.features.get(session.featureId);
        if (feature) {
          const t = finishPhase(feature.phases, running.phase, exitCode || 1, Date.now());
          this.deps.features.savePhases(session.featureId, t.phases);
          this.emitFeature(session.featureId);
        }
        if (exitCode !== 0) {
          const item = this.deps.attention.raise({
            kind: 'agent_errored',
            projectId: session.projectId,
            featureId: session.featureId,
            sessionId: session.id,
            message: `Agent-Session beendet (exit ${exitCode}) während Phase ${running.phase}`,
          });
          bus.emitEvent('attention_raised', item);
        }
      }
    }
    this.deps.ptys.remove(session.id);
  }

  // ---------- Boot / Reaper ----------

  /** Nach Server-Neustart: running-Leichen bereinigen (Fix des speckit-assistant-Bugs). */
  reapOnBoot(): void {
    const orphaned = this.deps.executions.reapOrphans();
    for (const s of this.deps.sessions.listOpen()) {
      this.deps.sessions.end(s.id);
    }
    for (const f of this.deps.features.listAll()) {
      // Vor dem Reap merken, welche Läufe unterbrochen wurden → als „braucht dich" (fortsetzbar) melden.
      const interrupted = (Object.keys(f.phases) as FeaturePhase[]).filter(
        (p) => f.phases[p]?.status === 'running',
      );
      const reaped = reapOrphanedRunning(f.phases, () => false);
      if (reaped !== f.phases) this.deps.features.savePhases(f.id, reaped);
      for (const p of interrupted) {
        const item = this.deps.attention.raise({
          kind: 'run_interrupted',
          projectId: f.projectId,
          featureId: f.id,
          sessionId: null,
          message: `${f.name}: Lauf „${p}" unterbrochen — per Run fortsetzbar`,
        });
        bus.emitEvent('attention_raised', item);
      }
    }
    // Attention-Reconcile (US2): session-basierte Meldungen sind nach dem Neustart nicht mehr
    // bestätigbar und werden konservativ aufgelöst; Merge-Arten werden gegen die persistierte
    // integration-Stage geprüft.
    const featureStages = new Map(this.deps.features.listAll().map((f) => [f.id, f.integration]));
    for (const stale of findStaleOnBoot(this.deps.attention.listOpen(), featureStages)) {
      this.deps.attention.resolve(stale.id);
      bus.emitEvent('attention_resolved', stale.id);
    }
    if (orphaned > 0) {
      console.log(`[reaper] ${orphaned} verwaiste Executions bereinigt`);
    }
  }

  /**
   * Zustandsgekoppelte Bereinigung der Exception-Inbox: löst alle offenen Meldungen auf,
   * deren zugrunde liegender Zustand nicht mehr aktiv ist (Echtzeit-Pflege + Read-Sicherheitsnetz).
   */
  reconcileOpenAttention(): void {
    const snap = this.buildReconcileSnapshot();
    for (const stale of findStaleRuntime(this.deps.attention.listOpen(), snap)) {
      this.deps.attention.resolve(stale.id);
      bus.emitEvent('attention_resolved', stale.id);
    }
  }

  private buildReconcileSnapshot(): ReconcileSnapshot {
    const sessions = this.deps.ptys
      .list()
      .filter((s) => !s.exited)
      .map((s) => ({
        sessionId: s.id,
        status: displayStatus(s.machine.state),
        featureId: s.featureId,
        conversationId: s.conversationId,
      }));
    const featureStages = new Map(this.deps.features.listAll().map((f) => [f.id, f.integration]));
    return { sessions, featureStages };
  }

  /** Disk-Reconciliation: extern erzeugte Artefakte heben idle-Phasen an. */
  reconcileFeature(featureId: string): void {
    const feature = this.mustFeature(featureId);
    const root = feature.worktreePath ?? this.mustProject(feature.projectId).path;
    let changed = false;
    const reconciled = reconcileWithDisk(feature.phases, (p) => artifactExists(root, feature.name, p));
    if (reconciled !== feature.phases) {
      this.deps.features.savePhases(featureId, reconciled);
      changed = true;
    }
    // Task-Fortschritt mitziehen (Change-Guard, WP12).
    void parseTaskProgress(root, feature.name).then((progress) => {
      if (progress.done !== feature.tasksDone || progress.total !== feature.tasksTotal) {
        this.deps.features.setTasks(featureId, progress.done, progress.total);
        this.emitFeature(featureId);
      } else if (changed) {
        this.emitFeature(featureId);
      }
    });
  }

  // ---------- Helpers ----------

  /** Kommando-Stil (Skills `-` vs. Commands `.`): Worktree zuerst, sonst Projekt-Root. */
  private commandPrefixFor(feature: Feature): string {
    const fresh = this.deps.features.get(feature.id) ?? feature;
    if (fresh.worktreePath && existsSync(fresh.worktreePath)) {
      return speckitCommandPrefix(fresh.worktreePath);
    }
    return speckitCommandPrefix(this.mustProject(fresh.projectId).path);
  }

  automationFor(feature: Feature): AutomationSettings {
    const project = this.mustProject(feature.projectId);
    return resolveAutomation(this.deps.settings.getAutomation(), project.automation, feature.automation);
  }

  runningPhaseOf(featureId: string): FeaturePhase | null {
    return this.runningPhases.get(featureId)?.phase ?? null;
  }

  private emitFeature(featureId: string): void {
    const f = this.deps.features.get(featureId);
    if (f) bus.emitEvent('feature_updated', f);
  }

  private mustFeature(id: string): Feature {
    const f = this.deps.features.get(id);
    if (!f) throw new Error(`Feature ${id} nicht gefunden`);
    return f;
  }

  private mustProject(id: string): Project {
    const p = this.deps.projects.get(id);
    if (!p) throw new Error(`Projekt ${id} nicht gefunden`);
    return p;
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
