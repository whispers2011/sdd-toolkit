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
  selectEventsForWindow,
  summarizeEvents,
  sumUsage,
  displayStatus,
  usageTotalTokens,
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
import {
  locateTranscript,
  offsetAtTimestamp,
  readTranscriptDelta,
  transcriptSize,
} from '../pty/transcriptWatcher.js';
import { buildClaudeArgv, phaseSlashCommand, resetCommand } from '../pty/commandBuilder.js';
import { TELEMETRY_GRACE_MS, type TelemetryStore } from '../telemetry/telemetryStore.js';
import { prepareForPhase } from './contextOptimizer.js';
import { artifactExists, parseTaskProgress, speckitCommandPrefix } from './artifacts.js';
import { bus } from '../events.js';
import { NotificationThrottle } from './notificationThrottle.js';
import type { MergeQueueService } from './mergeQueueService.js';
import type { ChatWorkService } from './chatWorkService.js';
import type { AgentGateService } from './agentGateService.js';
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
  agentGate: AgentGateService;
  dataDir: string;
  /** Puffer der Verbrauchsmeldungen der CLI; fehlt er, misst nur das Transkript. */
  telemetry?: TelemetryStore;
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
   * dann wird ab 0 gemessen. `null` = beim Start war die Session-ID noch nicht
   * bekannt; dann ist „ab 0" falsch (siehe startedAt).
   */
  transcriptPathStart: string | null;
  /** Startzeit des Laufs — Startmarke, wenn transcriptPathStart null ist. */
  startedAt: number;
  promptText: string;
  /**
   * Der Phasenprompt wurde nachweislich zugestellt (`user_prompt_submit`).
   * Vorher darf ein `Stop` NICHT als Abschluss dieser Phase gelten: Das
   * vorgeschaltete Reset-Kommando (`/clear`) erzeugt einen eigenen Turn, und
   * dessen Stop hat real eine nie gelaufene Phase als erfolgreich abgeschlossen
   * (Ergebnis: Phasenversatz um eins, „implementation"-Commit ohne Code).
   * Gegenstück zur Reset-Unterscheidung in handleSubmitFailed().
   */
  promptConfirmed: boolean;
}

export class Orchestrator {
  private runningPhases = new Map<string, RunningPhase>(); // featureId → Phase
  private runningGates = new Set<string>(); // `${featureId}:${phase}` — Doppelstart-Guard für before-Gates
  private startingPhases = new Set<string>(); // featureId — synchroner Guard gegen Start-Races (vor runningPhases)
  private ensuringSessions = new Map<string, Promise<LiveSession>>(); // featureId → laufender ensureSession-Aufruf
  private lastPreamble = new Map<string, string>(); // featureId → zuletzt injizierte Wissens-Präambel
  private mergeQueue: MergeQueueService | null = null;
  private chatWork: ChatWorkService | null = null;
  private notifyThrottle = new NotificationThrottle();
  private telemetryReconcileTimers = new Set<NodeJS.Timeout>(); // Nachtrag verspäteter Meldungen

  constructor(private deps: OrchestratorDeps) {}

  attachMergeQueue(q: MergeQueueService): void {
    this.mergeQueue = q;
  }

  /**
   * Läuft für dieses Feature gerade ein Agenten-Gate? Quelle der Aktions-Policy
   * für `gateRunning` (FR-005) — die Schlüssel sind `${featureId}:${phase}`.
   */
  isGateRunning(featureId: string): boolean {
    const prefix = `${featureId}:`;
    for (const key of this.runningGates) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
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
      project,
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
        project,
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

  async startPhaseRun(
    featureId: string,
    phase: FeaturePhase,
    extraPrompt?: string,
    opts: { skipGates?: boolean } = {},
  ): Promise<{ gateRunning: boolean }> {
    const feature = this.mustFeature(featureId);

    // Doppelstart-/Queue-Schutz: läuft (oder startet gerade) für dieses Feature schon eine Phase,
    // würde ein weiterer Start den Slash-Command nur in die laufende Session einreihen — er liefe
    // nach dem aktuellen Schritt sofort erneut. Deshalb ablehnen statt einreihen. Auto-Progress und
    // Gate-Fortsetzung laufen erst NACH dem Turn-Abschluss (runningPhases bereits geleert) und sind
    // damit nicht betroffen. `startingPhases` schließt zusätzlich das Start-Race vor `launchPhase`.
    if (this.runningPhases.has(featureId) || this.startingPhases.has(featureId)) {
      throw new Error(`${feature.name}: Es läuft bereits ein Schritt — bitte abwarten, bis er fertig ist.`);
    }
    this.startingPhases.add(featureId);
    try {
      // before_phase-Gate: Start deferren, Phase bleibt idle (crash-sicher — ein
      // Absturz während des Gates hinterlässt schlicht eine ungestartete Phase).
      const trigger = { kind: 'before_phase', phase } as const;
      if (!opts.skipGates && this.deps.agentGate.hasAgentsFor(feature.projectId, featureId, trigger)) {
        const key = `${featureId}:${phase}`;
        if (!this.runningGates.has(key)) {
          this.runningGates.add(key);
          void this.runBeforePhaseGate(key, featureId, phase, extraPrompt);
        }
        return { gateRunning: true };
      }

      this.resolveGateAttention(featureId);
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
      return { gateRunning: false };
    } finally {
      this.startingPhases.delete(featureId);
    }
  }

  /**
   * before_phase-Gate asynchron ausführen: PASS startet die Phase (skipGates),
   * blockierender FAIL erzeugt ein Inbox-Item — der Start unterbleibt.
   */
  private async runBeforePhaseGate(
    key: string,
    featureId: string,
    phase: FeaturePhase,
    extraPrompt?: string,
  ): Promise<void> {
    try {
      const feature = this.mustFeature(featureId);
      const project = this.mustProject(feature.projectId);
      const outcome = await this.deps.agentGate.runTrigger(feature, project, { kind: 'before_phase', phase });
      if (outcome.ok) {
        await this.startPhaseRun(featureId, phase, extraPrompt, { skipGates: true });
        return;
      }
      this.raiseGateFailed(featureId, `Gate vor Phase '${phase}' FAIL — ${outcome.failedAgent}`);
    } catch (err) {
      // Infrastruktur-Fehler (z. B. Worktree weg): behebbar melden, kein Dauer-FAIL.
      const feature = this.deps.features.get(featureId);
      if (!feature) return;
      const item = this.deps.attention.raise({
        kind: 'agent_errored',
        projectId: feature.projectId,
        featureId,
        message: `${feature.name}: Gate vor Phase '${phase}' fehlgeschlagen — ${(err as Error).message}`,
      });
      bus.emitEvent('attention_raised', item);
    } finally {
      this.runningGates.delete(key);
    }
  }

  /** Blockierender Gate-FAIL: Inbox-Item + Notification (Human-Override bleibt möglich). */
  private raiseGateFailed(featureId: string, detail: string): void {
    const feature = this.deps.features.get(featureId);
    if (!feature) return;
    const item = this.deps.attention.raise({
      kind: 'phase_gate_failed',
      projectId: feature.projectId,
      featureId,
      message: `${feature.name}: ${detail}`,
    });
    bus.emitEvent('attention_raised', item);
    bus.emitEvent('notification', {
      title: 'Qualitäts-Gate FAIL',
      body: item.message,
      featureId,
      kind: 'escalation',
    });
  }

  /** Freigabe/Verwerfen/Neustart einer Phase löst offene Gate-Meldungen des Features auf. */
  private resolveGateAttention(featureId: string): void {
    this.deps.attention.resolveFor({ featureId, kinds: ['phase_gate_failed', 'approval_required'] });
    bus.emitEvent('attention_resolved', featureId);
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

    // Wissens-Präambel nur anhängen, wenn nötig: bei erster Injektion, geändertem
    // Wissen oder nach einem Kontext-Reset (nach /clear ist sie weg, nach /compact
    // evtl. aus der Zusammenfassung gefallen). Ohne Reset (contextStrategy=full)
    // bleibt die früher gesendete Präambel im Verlauf → nicht Phase für Phase erneut
    // mitschicken (das war reine, mit jedem Step wachsende Token-Redundanz).
    const prevPreamble = this.lastPreamble.get(feature.id);
    const injectPreamble =
      plan.preamble.trim().length > 0 && (plan.reset !== null || plan.preamble !== prevPreamble);
    const prompt = injectPreamble ? base + plan.preamble : base;
    if (injectPreamble) this.lastPreamble.set(feature.id, plan.preamble);

    this.runningPhases.set(feature.id, {
      phase,
      executionId,
      scrollbackStart: session.scrollback.length,
      transcriptOffsetStart,
      transcriptPathStart,
      startedAt: Date.now(),
      promptText: prompt,
      promptConfirmed: false,
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
    this.resolveGateAttention(featureId);

    // Auto-Progress-Umleitung: hätte die Folgephase ein before_phase-Gate, wird
    // ohne Auto-Start-Effekte approvt und der Start über startPhaseRun angestoßen —
    // der deferrt bis zum Gate-PASS. phaseMachine bleibt unangetastet (kein
    // Agent-Wissen in der pure Machine).
    const next = nextPhase(feature.phases, phase);
    if (
      next !== null &&
      shouldAutoProgress(next, automation) &&
      this.deps.agentGate.hasAgentsFor(feature.projectId, featureId, { kind: 'before_phase', phase: next })
    ) {
      const t = approvePhase(
        feature.phases,
        phase,
        { ...automation, autoProgressUntil: 'off', autoVerify: false },
        Date.now(),
      );
      this.deps.features.savePhases(featureId, t.phases);
      this.emitFeature(featureId);
      void this.startPhaseRun(featureId, next);
      return;
    }

    const t = approvePhase(feature.phases, phase, automation, Date.now());
    this.deps.features.savePhases(featureId, t.phases);
    this.emitFeature(featureId);
    this.runEffects(featureId, t.effects);
  }

  discard(featureId: string, phase: FeaturePhase): void {
    const feature = this.mustFeature(featureId);
    this.resolveGateAttention(featureId);
    const t = discardPhase(feature.phases, phase);
    this.deps.features.savePhases(featureId, t.phases);
    this.emitFeature(featureId);
  }

  private runEffects(featureId: string, effects: import('@sdd/shared').PhaseEffect[]): void {
    for (const e of effects) {
      if (e.kind === 'start_agent') {
        void this.startAgentForApprovedChain(featureId, e.phase);
      } else if (e.kind === 'start_integration') {
        // Auch der automatische Pfad unterliegt den Vorprüfungen (FR-004/FR-027):
        // eine Ablehnung ist KEIN Erfolg und ändert nichts am Feature.
        void this.mergeQueue?.beginIntegration(featureId).then((r) => {
          if (!r.started && r.reason) {
            console.warn(`[integration] ${featureId}: automatischer Start abgelehnt — ${r.reason}`);
          }
        });
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

  /**
   * Zustellung des Phasenprompts bestätigt. Erst ab hier zählt ein `Stop` als
   * Abschluss dieser Phase — siehe RunningPhase.promptConfirmed.
   */
  handleSubmitConfirmed(session: LiveSession, text: string): void {
    const featureId = session.featureId;
    if (!featureId) return;
    const running = this.runningPhases.get(featureId);
    if (running && text === running.promptText) running.promptConfirmed = true;
  }

  private async handleTurnCompleted(session: LiveSession): Promise<void> {
    if (!session.featureId) return;
    const featureId = session.featureId;
    const running = this.runningPhases.get(featureId);
    const feature = this.deps.features.get(featureId);
    if (!feature) return;

    // Der Stop gehört noch nicht zu dieser Phase: Ihr Prompt ist nicht zugestellt,
    // also stammt er von einem vorgeschalteten Kommando (Reset). Die Phase läuft
    // gleich erst an — sie hier abzuschließen meldete Erfolg ohne jede Arbeit.
    if (running && !running.promptConfirmed) {
      console.warn(
        `[orchestrator] Turn-Ende vor Zustellung des Phasenprompts (${running.phase}) — Reset-Turn, Phase bleibt offen`,
      );
      return;
    }

    if (running) {
      this.runningPhases.delete(featureId);
      // Verbrauch: vorrangig aus den Meldungen der CLI, sonst wie bisher aus dem
      // Transkript. Genau EIN Schreibpfad je Lauf — die Werte beider Quellen
      // werden nie addiert (FR-016).
      this.finishWithMetering(session, running, 0);
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

      // after_phase-Gate: läuft NACH dem Phasenabschluss und VOR dem Auto-
      // Progress. Blockierender FAIL → Phase bleibt awaiting_review, Inbox-Item,
      // kein Auto-Approve; manuelles Freigeben (Human-Override) bleibt möglich.
      const gateBlocked = await this.runAfterPhaseGate(featureId, running.phase);
      if (gateBlocked) return;

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
   * after_phase-Gate ausführen; true = blockierender FAIL (Aufrufer stoppt den
   * Auto-Progress). Infrastruktur-Fehler blockieren nie (best-effort + Meldung).
   */
  private async runAfterPhaseGate(featureId: string, phase: FeaturePhase): Promise<boolean> {
    const feature = this.deps.features.get(featureId);
    if (!feature) return false;
    const trigger = { kind: 'after_phase', phase } as const;
    if (!this.deps.agentGate.hasAgentsFor(feature.projectId, featureId, trigger)) return false;
    try {
      const project = this.mustProject(feature.projectId);
      const outcome = await this.deps.agentGate.runTrigger(feature, project, trigger);
      if (outcome.ok) return false;
      this.raiseGateFailed(featureId, `Qualitäts-Gate nach Phase '${phase}' FAIL — ${outcome.failedAgent}`);
      return true;
    } catch (err) {
      const item = this.deps.attention.raise({
        kind: 'agent_errored',
        projectId: feature.projectId,
        featureId,
        message: `${feature.name}: Gate nach Phase '${phase}' fehlgeschlagen — ${(err as Error).message}`,
      });
      bus.emitEvent('attention_raised', item);
      return false;
    }
  }

  /**
   * Lauf abschliessen und dabei die Quelle wählen (FR-014/FR-015/FR-016).
   *
   * Liegen Meldungen der CLI vor, gewinnen sie und `meterTurn` läuft GAR NICHT erst —
   * das Nicht-Addieren ist damit eine strukturelle Eigenschaft und keine Regel, die
   * eingehalten werden müsste. Zusätzlich bleibt der Lauf fünf Minuten nachtragsfähig,
   * weil Meldungen in Intervallen eintreffen und ein kurzer Lauf beim Abschluss noch
   * unvollständig sein kann (FR-011).
   */
  private finishWithMetering(session: LiveSession, running: RunningPhase, exitCode: number): void {
    const now = Date.now();
    const fromTelemetry = this.meterFromTelemetry(session, running, now);

    if (fromTelemetry) {
      const finalAt = now + TELEMETRY_GRACE_MS;
      this.deps.executions.finishWithUsage(running.executionId, exitCode, {
        ...fromTelemetry,
        telemetryFinalAt: finalAt,
      });
      this.scheduleTelemetryReconcile(session, running, now);
      return;
    }

    this.deps.executions.finishWithUsage(running.executionId, exitCode, this.meterTurn(session, running));
    // Auch ohne Meldungen beim Abschluss kann Telemetrie noch eintreffen (kurzer Lauf,
    // Exportintervall 5 s). Der Nachtrag ersetzt die Transkript-Zahl dann vollständig.
    this.scheduleTelemetryReconcile(session, running, now);
  }

  /**
   * Nachtrag verspäteter Meldungen (FR-011): Bis zum Ablauf des Nachlauffensters
   * wird der Lauf neu verrechnet und die Ansicht über den Bus aktualisiert. Danach
   * gilt seine Zahl als endgültig und spätere Meldungen verfallen (FR-012, SC-005).
   *
   * Es wird jedes Mal das VOLLE Fenster neu summiert, nicht addiert — dieselbe
   * requestId kann so nie zweimal zählen (FR-006).
   */
  private scheduleTelemetryReconcile(session: LiveSession, running: RunningPhase, finishedAt: number): void {
    if (!this.deps.telemetry) return;

    const attempt = (delay: number, last: boolean) => {
      const timer = setTimeout(() => {
        this.telemetryReconcileTimers.delete(timer);
        try {
          const usage = this.meterFromTelemetry(session, running, finishedAt);
          if (usage) {
            this.deps.executions.updateTelemetry(running.executionId, usage);
            bus.emitEvent('execution_updated', {
              executionId: running.executionId,
              featureId: session.featureId,
            });
          }
        } catch (err) {
          console.warn('[telemetry] Nachtrag fehlgeschlagen:', (err as Error).message);
        }
        if (last) this.deps.telemetry?.forget(session.id);
      }, delay);
      timer.unref?.();
      this.telemetryReconcileTimers.add(timer);
    };

    // Zweimal nachfassen: einmal kurz nach dem üblichen Exportintervall (5 s) für
    // den Regelfall, einmal am Ende des Nachlauffensters als Sicherheitsnetz.
    attempt(8_000, false);
    attempt(TELEMETRY_GRACE_MS, true);
  }

  /**
   * Verbrauch eines Laufs aus den Meldungen der CLI (FR-014). Vorrangige Quelle:
   * jede Meldung trägt ihren eigenen Zeitstempel und die Marke ihrer Session, also
   * gehört genau das zum Lauf, was zwischen seinem Start und seinem Ende gemeldet
   * wurde. Damit entfällt die aus Byte-Positionen rekonstruierte Startmarke —
   * die Quelle des Zwei-Minuten-Laufs mit 62 Mio. Tokens.
   *
   * Liefert `null`, wenn keine Meldungen vorliegen; dann greift `meterTurn` (FR-015).
   */
  private meterFromTelemetry(session: LiveSession, running: RunningPhase, until: number) {
    const store = this.deps.telemetry;
    if (!store) return null;

    const events = selectEventsForWindow(store.eventsFor(session.id), {
      from: running.startedAt,
      to: until,
    });
    if (events.length === 0) return null;

    const { total, byOrigin, model } = summarizeEvents(events);
    const hasSubagents = byOrigin.subagent.tokens > 0;
    return {
      tokens: total.tokens,
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      cacheReadTokens: total.cacheReadTokens,
      cacheCreationTokens: total.cacheCreationTokens,
      tokensSource: 'telemetry' as const,
      costMicros: total.costMicros,
      // null statt 0: ohne Subagenten soll die Ansicht gar nichts zeigen, keine
      // Null-Zeile (FR-010, US2 Szenario 3).
      subagentTokens: hasSubagents ? byOrigin.subagent.tokens : null,
      subagentCostMicros: hasSubagents ? byOrigin.subagent.costMicros : null,
      model,
    };
  }

  /**
   * Verbrauch eines abgeschlossenen Phasen-Turns messen. Bevorzugt autoritative
   * Usage aus dem Transkript-Delta (inkl. cache_read = akkumulierter Kontext);
   * fällt auf die Scrollback-Schätzung zurück, wenn kein Transkript/keine Usage vorliegt.
   *
   * Rückfallebene: läuft nur, wenn die Telemetrie nichts geliefert hat (FR-015/FR-016).
   */
  private meterTurn(session: LiveSession, running: RunningPhase) {
    if (session.claudeSessionId) {
      const path = locateTranscript(session.cwd, session.claudeSessionId);
      if (path) {
        const offset = this.startOffsetIn(path, running);
        const usage = sumUsage(readTranscriptDelta(path, offset));
        if (hasUsage(usage)) {
          const totalTokens = usageTotalTokens(usage);
          return {
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
    const offsetStartFix = path ? this.startOffsetIn(path, running) : null;
    this.deps.executions.recordTranscriptEnd(running.executionId, path, offsetEnd, offsetStartFix);
  }

  /**
   * Startmarke eines Laufs in seiner Transkriptdatei. Drei Fälle, und sie sind
   * NICHT dasselbe:
   *  - gleiche Datei wie beim Start → der gemerkte Offset.
   *  - Datei wechselte während der Phase (/clear-Reset) → die neue Datei gehört
   *    ganz diesem Lauf, ab 0 messen.
   *  - beim Start war die Datei unbekannt (Claude-Session-ID noch nicht gemeldet,
   *    typisch bei fortgesetzter Session) → sie enthält womöglich frühere Läufe.
   *    Ab 0 zu messen schrieb deren Verbrauch diesem Lauf zu (gemessen: ein
   *    2-Minuten-Lauf mit 62 Mio. Tokens / $132). Startmarke ist darum die erste
   *    Zeile, die zeitlich zu diesem Lauf gehört.
   */
  private startOffsetIn(path: string, running: RunningPhase): number {
    if (running.transcriptPathStart === null) return offsetAtTimestamp(path, running.startedAt);
    return path === running.transcriptPathStart ? running.transcriptOffsetStart : 0;
  }

  /**
   * Callback der Send-Pipeline: ein Prompt konnte nicht zugestellt werden (Session
   * lebt, nimmt ihn aber nicht an). Laufende Phase zurückrollen + „braucht dich".
   */
  handleSubmitFailed(session: LiveSession, text: string): void {
    if (session.kind === 'chat_work') return; // Arbeits-Chat läuft über einen anderen Pfad
    const featureId = session.featureId;
    if (!featureId) return;
    const feature = this.deps.features.get(featureId);
    const running = this.runningPhases.get(featureId);
    // Nur der Phasenprompt selbst darf die Phase zurückrollen. Das Reset-Kommando
    // (/clear bzw. /compact) geht als EIGENER Prompt voraus (launchPhase); bleibt dessen
    // Bestätigung aus, stellt pump() den Phasenprompt danach trotzdem zu und die Phase
    // läuft real an. Sie hier abzuräumen setzte eine LAUFENDE Phase auf idle, meldete
    // fälschlich „konnte nicht gestartet werden" und nahm dem Turn-Abschluss die
    // Buchführung (kein Auto-Progress, keine Tokens).
    if (running && text !== running.promptText) {
      console.warn(
        `[orchestrator] Vorgeschaltetes Kommando für Phase ${running.phase} unbestätigt — Phase läuft weiter: ${text}`,
      );
      return;
    }
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
      // Session ist tot → die injizierte Präambel steckt nicht mehr garantiert im
      // Kontext der (evtl. frisch gestarteten) Nachfolge-Session → einmalig neu erlauben.
      this.lastPreamble.delete(session.featureId);
      const running = this.runningPhases.get(session.featureId);
      if (running) {
        // Session starb mitten in einer Phase → Phase zurücksetzen.
        this.runningPhases.delete(session.featureId);
        // Abgebrochene Läufe haben Tokens verbraucht — auch sie messen, sonst zeigt das
        // Dashboard 0 für real bezahlte Arbeit.
        this.finishWithMetering(session, running, exitCode || 1);
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

/** Feature-Name → Slug (Ordnername unter specs/); auch vom Jira-Import genutzt (FR-013). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
