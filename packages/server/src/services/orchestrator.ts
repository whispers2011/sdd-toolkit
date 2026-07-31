import { existsSync } from 'node:fs';
import {
  approvePhase,
  buildDocumentsPreamble,
  discardPhase,
  finishPhase,
  initialPhases,
  nextPhase,
  reapOrphanedRunning,
  reconcileWithDisk,
  resolveAutomation,
  resolveOptimization,
  shouldAutoProgress,
  startPhase,
  displayStatus,
  type AutomationSettings,
  type Feature,
  artifactStepSpec,
  type FeaturePhase,
  type OptimizationSettings,
  type Project,
  type SessionEffect,
} from '@sdd/shared';
import type { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo, SessionRepo, SettingsRepo } from '../db/repos.js';
import type { KnowledgeService } from './knowledgeService.js';
import type { FeatureDocumentsService } from './featureDocuments.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import { locateTranscript, transcriptSize } from '../pty/transcriptWatcher.js';
import { buildClaudeArgv, phaseSlashCommand, resetCommand } from '../pty/commandBuilder.js';
import type { TelemetryStore } from '../telemetry/telemetryStore.js';
import { prepareForPhase } from './contextOptimizer.js';
import { artifactExists, parseTaskProgress, speckitCommandPrefix } from './artifacts.js';
import { bus, emitAttentionResolved } from '../events.js';
import { NotificationThrottle } from './notificationThrottle.js';
import type { MergeQueueService } from './mergeQueueService.js';
import type { ChatWorkService } from './chatWorkService.js';
import type { AgentGateService } from './agentGateService.js';
import type { PlausibilityService } from './plausibilityService.js';
import type { LifecycleStepService } from './lifecycleStepService.js';
import {
  findStaleOnBoot,
  findStaleRuntime,
  type ReconcileSnapshot,
} from './attentionReconciler.js';
import { resolveVerificationGaps } from './verificationGap.js';
import { ensureWorkspace } from './core/workspace.js';
import { markSession, startOffsetIn, type RunMark, type RunMeter } from './core/runMeter.js';

export interface EnsureSessionOptions {
  /**
   * Worktree-Vorbereitung (inkl. der Worktree-Auslöser) überspringen, weil der
   * Aufrufer sie unmittelbar davor selbst ausgeführt hat. Nur `createFeature`
   * setzt das Flag; jeder andere Weg soll die Auslöser wiederholen (FR-025).
   */
  skipPrepare?: boolean;
}

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
  featureDocuments: FeatureDocumentsService;
  agentGate: AgentGateService;
  lifecycleSteps: LifecycleStepService;
  /** Turn messen — gemeinsamer Kern, denselben Baustein benutzt der Chat-Pfad (FR-002). */
  meter: RunMeter;
  dataDir: string;
  /** Puffer der Verbrauchsmeldungen der CLI; fehlt er, misst nur das Transkript. */
  telemetry?: TelemetryStore;
  /**
   * Plausibilitätsprüfung; fehlt sie, wird nur nicht beurteilt. Optional, damit
   * bestehende Orchestrator-Tests unverändert kompilieren — und weil eine
   * Beurteilung nie Voraussetzung eines Laufabschlusses sein darf (FR-003).
   */
  plausibility?: PlausibilityService;
  /**
   * Stack-Profile. Optional, damit bestehende Tests unverändert kompilieren; ein
   * Projekt ohne Konfiguration löst hier ohnehin nichts aus (FR-013, SC-010).
   */
  stacks?: {
    isConfigured(project: Project): boolean;
    isRunning(featureId: string): boolean;
    up(feature: Feature, project: Project, profile: 'test' | 'full'): Promise<void>;
    down(feature: Feature, project: Project, opts?: { quiet?: boolean }): Promise<void>;
  };
}

/**
 * Hinweis auf die vom spec-kit-Skript VORAB angelegte Zieldatei.
 *
 * `/speckit-specify` und Verwandte legen ihre Ausgabedatei aus einem Template an,
 * bevor der Agent zu schreiben beginnt. Das Write-Tool von Claude Code verweigert
 * das Überschreiben einer existierenden, in dieser Session nicht gelesenen Datei —
 * der erste Write scheitert deshalb mit „File has not been read yet".
 *
 * Gemessen am 27.07.2026 an spec.md: 10 905 Output-Tokens verloren, sofort erneut
 * erzeugt. Es trifft den grössten Write der Phase. `/speckit-plan` blieb im selben
 * Lauf verschont, weil sein Ablauf den Agenten das Template ohnehin lesen lässt —
 * der Fehler hängt also am Ablauf, nicht an der Datei. Ein Hinweis, der nicht darauf
 * vertraut, kostet ~25 Tokens und spart im Fehlerfall das Vierhundertfache.
 *
 * Zieldatei kommt aus ARTIFACT_STEP_SPECS — keine zweite Liste von Dateinamen.
 */
function templateHint(phase: FeaturePhase): string {
  const relPath = artifactStepSpec(phase)?.primaryRelPath;
  if (!relPath) return '';
  return (
    `\n\n[Hinweis] \`${relPath}\` liegt im Spec-Ordner bereits als Vorlage vor. ` +
    `Lies sie, bevor du sie schreibst — sonst schlägt der erste Schreibvorgang fehl.`
  );
}

/** Ausgabe jünger als das gilt als „schreibt gerade" (checkWorkWithoutRun). */
const WORK_WITHOUT_RUN_QUIET_MS = 60_000;
/** So lange nach dem Sessionstart wird nicht gemeldet — Anlauf und erste Phase brauchen Ruhe. */
const WORK_WITHOUT_RUN_MIN_AGE_MS = 3 * 60_000;

/**
 * Laufender Phasen-Kontext pro Feature (ephemer): die Lauf-Marke des gemeinsamen
 * Kerns plus das, was nur eine Phase hat.
 */
type RunningPhase = RunMark & {
  phase: FeaturePhase;
  /**
   * Der Phasenprompt wurde nachweislich zugestellt (`user_prompt_submit`).
   * Vorher darf ein `Stop` NICHT als Abschluss dieser Phase gelten: Das
   * vorgeschaltete Reset-Kommando (`/clear`) erzeugt einen eigenen Turn, und
   * dessen Stop hat real eine nie gelaufene Phase als erfolgreich abgeschlossen
   * (Ergebnis: Phasenversatz um eins, „implementation"-Commit ohne Code).
   * Gegenstück zur Reset-Unterscheidung in handleSubmitFailed().
   */
  promptConfirmed: boolean;
};

export class Orchestrator {
  private runningPhases = new Map<string, RunningPhase>(); // featureId → Phase
  private runningGates = new Set<string>(); // `${featureId}:${phase}` — Doppelstart-Guard für before-Gates
  private startingPhases = new Set<string>(); // featureId — synchroner Guard gegen Start-Races (vor runningPhases)
  private ensuringSessions = new Map<string, Promise<LiveSession>>(); // featureId → laufender ensureSession-Aufruf
  private lastPreamble = new Map<string, string>(); // featureId → zuletzt injizierte Wissens-Präambel
  private mergeQueue: MergeQueueService | null = null;
  private chatWork: ChatWorkService | null = null;
  private notifyThrottle = new NotificationThrottle();
  /** Wiederholungs-Timer des automatischen Integrationsstarts. */
  private backgroundTimers = new Set<NodeJS.Timeout>();
  /** Sessions, für die „Arbeit ohne Lauf" schon gemeldet wurde (eine Meldung je Episode). */
  private workWithoutRunReported = new Set<string>();

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

  /**
   * Feature anlegen. Der **Datensatz entsteht vor dem Worktree** (umgestellte
   * Reihenfolge): jeder Lebenszyklus-Schritt braucht einen Lauf-Eintrag am
   * zugehörigen Feature, und `buildRunSummaries()` überspringt Executions ohne
   * `featureId` — ein `before_worktree_create`-Lauf wäre sonst nicht attribuierbar.
   *
   * Scheitert die Vorbereitung (typisch `git worktree add`), wird der frisch
   * angelegte Datensatz zurückgerollt und der Fehler weitergeworfen: nach außen
   * exakt die heutige Fehlersemantik („Worktree kaputt ⇒ kein Feature in der Ansicht").
   */
  async createFeature(projectId: string, name: string, description?: string): Promise<Feature> {
    const project = this.mustProject(projectId);
    const slug = slugify(name);
    if (this.deps.features.getByName(projectId, slug)) {
      throw new Error(`Feature '${slug}' existiert bereits`);
    }
    const branch = `feature/${slug}`;

    const feature = this.deps.features.create({
      projectId,
      name: slug,
      branch,
      worktreePath: null,
      phases: initialPhases(project.enabledPhases),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });

    let prepared: { ok: boolean };
    try {
      prepared = await this.prepareWorktree(feature);
    } catch (err) {
      this.deps.features.hardDelete(feature.id);
      throw err;
    }
    this.emitFeature(feature.id);

    // Blockierender Schritt-Fehlschlag: keine Session, keine erste Phase. Das Feature
    // bleibt stehen und meldet sich in der Inbox; erneutes Anstoßen läuft über
    // dieselbe prepareWorktree()-Methode und löst die Meldung bei Erfolg auf.
    if (!prepared.ok) return this.deps.features.get(feature.id)!;

    // `skipPrepare`: die Vorbereitung ist gerade gelaufen. Ohne das Flag liefe sie
    // in `ensureSessionInner` ein zweites Mal — und mit ihr jeder Worktree-Schritt.
    await this.ensureSession(feature.id, { skipPrepare: true });
    if (description) {
      await this.startPhaseRun(feature.id, 'specify', description);
    }
    return this.deps.features.get(feature.id)!;
  }

  /**
   * Worktree für ein Feature bereitstellen — der EINE Weg für beide Anlagepfade
   * (Erstanlage und erneutes Anstoßen einer Session), damit ein Wiederanlauf
   * denselben Auslöser wiederholt.
   *
   * Reihenfolge: `before_worktree_create`-Schritte (im Haupt-Checkout, mit dem
   * künftigen Pfad im Kontext) → `git worktree add` → Pfad persistieren →
   * `after_worktree_create`-Schritte (im neuen Worktree).
   *
   * `{ ok: false }` = ein blockierender Schritt ist fehlgeschlagen; der Aufrufer
   * startet weder Session noch erste Phase.
   */
  private async prepareWorktree(feature: Feature): Promise<{ ok: boolean }> {
    const project = this.mustProject(feature.projectId);

    // Der künftige Pfad ist schon vor der Anlage bekannt — ein Schritt „vor
    // Worktree-Anlage" kann ihn also auswerten (US3 Szenario 5).
    const futurePath = feature.worktreePath ?? this.deps.worktrees.pathFor(project, feature.name);
    const before = await this.deps.lifecycleSteps.runTrigger(
      feature,
      project,
      { kind: 'before_worktree_create' },
      { worktreePath: futurePath },
    );
    if (!before.ok) return { ok: false };

    // Idempotent, inkl. Waisen-Erholung: auch wenn ein gespeicherter Pfad auf Disk fehlt
    // (z. B. manuell gelöscht). Der gemeinsame Kern — derselbe Baustein trägt die
    // Arbeitskopie des Chats (FR-003); die Auslöser darum herum bleiben feature-eigen.
    if (!feature.worktreePath || !existsSync(feature.worktreePath)) {
      const wt = await ensureWorkspace(this.deps.worktrees, {
        project,
        name: feature.name,
        branch: feature.branch,
        recordedPath: feature.worktreePath,
      });
      this.deps.features.setWorktree(feature.id, wt);
      feature.worktreePath = wt;
    }

    return this.deps.lifecycleSteps.runTrigger(feature, project, { kind: 'after_worktree_create' });
  }

  /**
   * Konsole pro Feature: eine persistente Claude-Session im Worktree.
   * Pro Feature serialisiert (in-flight Promise), sonst spawnen zwei gleichzeitige
   * Aufrufe (z. B. Grid-Auto-Select + Konsole öffnen) doppelte Sessions.
   */
  ensureSession(featureId: string, opts: EnsureSessionOptions = {}): Promise<LiveSession> {
    const inFlight = this.ensuringSessions.get(featureId);
    if (inFlight) return inFlight;
    const p = this.ensureSessionInner(featureId, opts).finally(() => {
      this.ensuringSessions.delete(featureId);
    });
    this.ensuringSessions.set(featureId, p);
    return p;
  }

  private async ensureSessionInner(
    featureId: string,
    opts: EnsureSessionOptions = {},
  ): Promise<LiveSession> {
    const feature = this.mustFeature(featureId);
    const project = this.mustProject(feature.projectId);
    const existing = this.deps.ptys.forFeature(featureId);
    if (existing) return existing;

    // Abgeschlossene Features bekommen keine neue Session mehr — sonst sammeln
    // sich offene Sessions auf gemergten/archivierten Features an.
    if (feature.integration === 'merged' || feature.archivedAt !== null) {
      throw new Error(`Feature '${feature.name}' ist abgeschlossen — keine neue Session`);
    }

    // Worktree über denselben Weg wie bei der Erstanlage sicherstellen: ein erneutes
    // Anstoßen wiederholt damit auch die Worktree-Auslöser (Wiederanlauf, FR-025).
    // Ausnahme: `createFeature` hat unmittelbar davor selbst vorbereitet — ein
    // zweiter Durchlauf würde jeden Worktree-Schritt der Anlage doppelt ausführen.
    if (!opts.skipPrepare) {
      const prepared = await this.prepareWorktree(feature);
      if (!prepared.ok) {
        throw new Error(
          `${feature.name}: Lebenszyklus-Schritt vor der Session fehlgeschlagen — siehe „Braucht dich".`,
        );
      }
    }
    const worktreePath = feature.worktreePath;
    if (!worktreePath) throw new Error(`${feature.name}: Worktree konnte nicht bereitgestellt werden`);

    // Resume-Recovery (WP2): nie blind auf eine tote Session-ID resumen —
    // erst prüfen, ob das Transkript-JSONL noch existiert (Claude räumt nach ~30 Tagen auf).
    const prev = this.deps.sessions.latestForFeature(featureId);
    let resumeId = prev?.claude_session_id ?? undefined;
    if (resumeId && prev) {
      if (!locateTranscript(worktreePath, resumeId)) {
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
      cwd: worktreePath,
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
      // before_phase-Vorlauf: Start deferren, Phase bleibt idle (crash-sicher — ein
      // Absturz während des Vorlaufs hinterlässt schlicht eine ungestartete Phase).
      // Deferriert wird für Schritte UND Agents; ohne beides bleibt der Weg exakt
      // wie bisher (kein zusätzlicher Prozess, keine Verzögerung).
      const trigger = { kind: 'before_phase', phase } as const;
      const deferred =
        !opts.skipGates &&
        (this.needsTestStack(feature, phase) ||
          this.deps.lifecycleSteps.hasStepsFor(feature.projectId, featureId, trigger) ||
          this.deps.agentGate.hasAgentsFor(feature.projectId, featureId, trigger));
      if (deferred) {
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
   * before_phase-Vorlauf asynchron ausführen: erst die Lebenszyklus-Schritte, dann
   * das Agenten-Gate, dann der Phasenstart (skipGates). Ein blockierender Fehlschlag
   * auf einer der beiden Stufen verhindert den Start — die Phase bleibt `idle`.
   *
   * Schritte VOR Agents (research.md E8): Schritte bereiten mechanisch vor
   * (installieren, generieren, formatieren), Agents urteilen. Ein Agent soll den
   * vorbereiteten Stand beurteilen, nicht einen halb vorbereiteten.
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
      const trigger = { kind: 'before_phase', phase } as const;

      // Reihenfolge am gemeinsamen Punkt: STACK vor Schritten vor Agents (research E9).
      // Ein Schritt darf Migrationen gegen die frisch hochgefahrene Datenbank fahren;
      // ein Agent soll den vorbereiteten Stand beurteilen. Scheitert das Profil,
      // startet die Phase NICHT und bleibt `idle` — die Meldung hat der StackService
      // schon erzeugt (FR-019, US2 Szenario 5).
      if (this.needsTestStack(feature, phase)) {
        try {
          await this.deps.stacks!.up(feature, project, 'test');
        } catch {
          return;
        }
      }

      // Das Inbox-Item hat der Schritt-Service schon erzeugt; hier bleibt nur, den
      // Start zu unterlassen (Human-Override über manuelles Starten bleibt möglich).
      const steps = await this.deps.lifecycleSteps.runTrigger(feature, project, trigger);
      if (!steps.ok) return;

      const outcome = await this.deps.agentGate.runTrigger(feature, project, trigger);
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

  /**
   * Muss vor dieser Phase das `test`-Profil hochgefahren werden (FR-014)?
   *
   * Nur beim Beginn von `implement` und nur, solange die Absicht noch nicht
   * steht: über alle folgenden Läufe desselben Features bleibt der Stack stehen
   * und wird NICHT pro Lauf herunter- und wieder hochgefahren (SC-006).
   *
   * Fast-Path: ohne Stack-Konfiguration ist das ein Blick auf ein leeres Objekt —
   * kein Query, kein Spawn, keine messbare Verzögerung (SC-010).
   */
  private needsTestStack(feature: Feature, phase: FeaturePhase): boolean {
    if (phase !== 'implement' || !this.deps.stacks) return false;
    const project = this.deps.projects.get(feature.projectId);
    if (!project || !this.deps.stacks.isConfigured(project)) return false;
    return !this.deps.stacks.isRunning(feature.id);
  }

  /**
   * Stack eines Features abbauen (FR-017). Für die Anlässe, an denen ein
   * Fehlschlag den Vorgang nicht abbrechen darf — Session-Ende, Archivieren,
   * Löschen: es entsteht die Meldung, der Vorgang läuft weiter (Edge Case
   * „archiviert oder abgebrochen, ohne je gemergt zu werden").
   */
  async tearDownStack(featureId: string): Promise<void> {
    if (!this.deps.stacks) return;
    const feature = this.deps.features.get(featureId);
    if (!feature) return;
    const project = this.deps.projects.get(feature.projectId);
    if (!project) return;
    await this.deps.stacks.down(feature, project, { quiet: true }).catch(() => {});
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
    emitAttentionResolved(
      this.deps.attention.resolveFor({ featureId, kinds: ['phase_gate_failed', 'approval_required'] }),
    );
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
    const mark = markSession(session, Date.now());
    const executionId = this.deps.executions.start({
      projectId: feature.projectId,
      featureId: feature.id,
      kind: 'phase',
      phase,
      logPath: null,
      transcriptOffsetStart: mark.transcriptOffsetStart,
      optContextStrategy: opt.contextStrategy,
      optCompression: opt.compression,
    });

    // Lauf beim Telemetrie-Puffer anmelden: seine Meldungen dürfen nicht nach Alter
    // verworfen werden, solange er läuft (siehe telemetryStore.sweep).
    this.deps.meter.hold(session.id);

    // Wissens-Präambel nur anhängen, wenn nötig: bei erster Injektion, geändertem
    // Wissen oder nach einem Kontext-Reset (nach /clear ist sie weg, nach /compact
    // evtl. aus der Zusammenfassung gefallen). Ohne Reset (contextStrategy=full)
    // bleibt die früher gesendete Präambel im Verlauf → nicht Phase für Phase erneut
    // mitschicken (das war reine, mit jedem Step wachsende Token-Redundanz).
    const prevPreamble = this.lastPreamble.get(feature.id);
    const injectPreamble =
      plan.preamble.trim().length > 0 && (plan.reset !== null || plan.preamble !== prevPreamble);
    // Dokument-Verweis BEWUSST ohne Dedupe: er gehört zum Auftrag selbst und muss
    // in jedem Schritt stehen, auch direkt nach /compact oder /clear (FR-007/FR-008,
    // SC-003). Ohne Dokumente ist er leer — dann ist der Prompt zeichengleich mit
    // dem bisherigen (FR-017, SC-006).
    const docsBlock = this.documentsPreambleFor(feature, phase);
    const prompt = injectPreamble
      ? base + docsBlock + plan.preamble + templateHint(phase)
      : base + docsBlock + templateHint(phase);
    if (injectPreamble) this.lastPreamble.set(feature.id, plan.preamble);

    this.runningPhases.set(feature.id, {
      ...mark,
      executionId,
      phase,
      promptText: prompt,
      promptConfirmed: false,
    });

    // Reset-Kommando (opt-in) VOR dem Phasenprompt; Session-Prozess/-ID bleiben.
    if (plan.reset) this.deps.ptys.sendPrompt(session.id, resetCommand(plan.reset));
    this.deps.ptys.sendPrompt(session.id, prompt);
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

  /**
   * Arbeit ohne zugeordneten Lauf melden (Befund A12, 30.07.2026).
   *
   * Am 30.07. lief eine implement-Phase 30 Sekunden, wurde als fertig verbucht und
   * freigegeben — und der Agent arbeitete danach 37 Minuten weiter: ungezählt,
   * unbepreist, mit einem Phasenzustand, der Fertigstellung behauptete. In der
   * Datenbank stand kein einziger Hinweis darauf. Sichtbar war es nur an der Ausgabe
   * der Session, also an genau der Grösse, die diese Prüfung liest.
   *
   * Bewusst nur eine Meldung, kein Eingriff: der Agent soll weiterarbeiten dürfen.
   * Was fehlt, ist die Zuordnung — und die kann nur ein Mensch klären.
   *
   * Je Session wird höchstens einmal gemeldet; erst wenn wieder ein Lauf offen ist,
   * kann dieselbe Session erneut auffallen.
   */
  checkWorkWithoutRun(now = Date.now()): void {
    for (const session of this.deps.ptys.list()) {
      if (session.kind !== 'feature' || !session.featureId || session.exited) continue;

      const laeuftEinSchritt = this.runningPhases.has(session.featureId);
      if (laeuftEinSchritt) {
        this.workWithoutRunReported.delete(session.id); // Zuordnung wieder in Ordnung
        continue;
      }

      // Der Agent muss über einen längeren Zeitraum schreiben — die letzten Zuckungen
      // eines gerade beendeten Turns sind kein Befund.
      const seitAusgabe = now - session.lastOutputAt;
      if (session.lastOutputAt === 0 || seitAusgabe > WORK_WITHOUT_RUN_QUIET_MS) continue;
      const seitStart = now - session.startedAt;
      if (seitStart < WORK_WITHOUT_RUN_MIN_AGE_MS) continue;
      if (this.workWithoutRunReported.has(session.id)) continue;

      this.workWithoutRunReported.add(session.id);
      const feature = this.deps.features.get(session.featureId);
      const item = this.deps.attention.raise({
        kind: 'agent_errored',
        projectId: session.projectId,
        featureId: session.featureId,
        message:
          `${feature?.name ?? session.featureId}: Der Agent arbeitet, aber kein Schritt ist offen — ` +
          `dieser Verbrauch wird nicht gemessen. Schritt wieder öffnen oder Ergebnis prüfen.`,
      });
      bus.emitEvent('attention_raised', item);
      console.warn(
        `[zuordnung] ${session.id} (${feature?.name ?? session.featureId}): Ausgabe vor ${Math.round(
          seitAusgabe / 1000,
        )} s, kein offener Lauf`,
      );
    }
  }

  /**
   * Freigegebenen Schritt wieder öffnen (approved → idle), damit die Arbeit daran
   * fortgesetzt werden kann. Nutzt bewusst `discardPhase`: dieselbe Zustandsänderung
   * (Schritt auf idle, freigegebene Folgeschritte werden `stale`), keine Dateioperation —
   * die Arbeit im Worktree bleibt unangetastet.
   */
  reopen(featureId: string, phase: FeaturePhase): void {
    const feature = this.mustFeature(featureId);
    const t = discardPhase(feature.phases, phase);
    this.deps.features.savePhases(featureId, t.phases);
    this.emitFeature(featureId);
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
        this.tryBeginIntegration(featureId, 0);
      }
    }
  }

  /**
   * Automatischer Integrationsstart mit Wiederholung.
   *
   * Eine Ablehnung mit `retryable` heisst „noch nicht", nicht „nein": der Agent
   * schreibt noch (siehe mergeQueueService.sessionStillWorking). Ohne Wiederholung
   * bliebe das Feature stumm liegen — genau das passierte am 30.07.2026, als ein
   * abgelehnter Auto-Start 40 Minuten lang niemandem auffiel. Nach Ablauf der
   * Versuche wird es ein Inbox-Item, damit der Vorgang nicht still verschwindet.
   */
  private tryBeginIntegration(featureId: string, versuch: number): void {
    const MAX_VERSUCHE = 20; // 20 × 30 s = 10 min Geduld mit einem arbeitenden Agenten
    void this.mergeQueue?.beginIntegration(featureId).then((r) => {
      if (r.started || !r.reason) return;
      if (!r.retryable) {
        console.warn(`[integration] ${featureId}: automatischer Start abgelehnt — ${r.reason}`);
        return;
      }
      if (versuch + 1 >= MAX_VERSUCHE) {
        const feature = this.deps.features.get(featureId);
        const item = this.deps.attention.raise({
          kind: 'agent_errored',
          projectId: feature?.projectId ?? '',
          featureId,
          message: `${feature?.name ?? featureId}: Integration konnte nicht starten — ${r.reason}`,
        });
        bus.emitEvent('attention_raised', item);
        return;
      }
      const timer = setTimeout(() => {
        this.backgroundTimers.delete(timer);
        this.tryBeginIntegration(featureId, versuch + 1);
      }, 30_000);
      timer.unref?.();
      this.backgroundTimers.add(timer);
    });
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
  /**
   * Verweis auf die hinterlegten Dokumente (Namen + Fundorte, nie Inhalte).
   * Frisch aus dem Manifest gelesen, damit er Neustart, Kontext-Reset und das
   * Entfernen einer Datei überlebt. Best-effort wie die Wissens-Präambel: ein
   * defektes Manifest darf keinen Phasenstart blockieren.
   */
  private documentsPreambleFor(feature: Feature, phase: FeaturePhase): string {
    try {
      return buildDocumentsPreamble(phase, this.deps.featureDocuments.listDocuments(feature.id));
    } catch (err) {
      console.warn('[documents] Verweis übersprungen:', (err as Error).message);
      return '';
    }
  }

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
      emitAttentionResolved(
        this.deps.attention.resolveFor({
          sessionId: session.id,
          kinds: ['awaiting_input', 'permission_request'],
        }),
      );
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
          // Worum es geht, gehört in die Meldung: Die Inbox ist das Instrument für
          // „Monitoring by exception" — ohne den Fragetext sagt sie nur DASS etwas
          // ansteht und zwingt zum Wechsel in die Konsole, um es einzuschätzen.
          message:
            effect.awaiting === 'plan_approval'
              ? `${feature?.name ?? 'Session'}: wartet auf Plan-Freigabe${effect.detail ? ` — ${effect.detail}` : ''}`
              : `${feature?.name ?? 'Session'}: ${effect.detail ?? 'hat eine Frage'}`,
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
      this.deps.meter.finish(session, running, 0);
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

      // after_phase-Vorlauf: läuft NACH dem Phasenabschluss und VOR dem Auto-
      // Progress. Blockierender Fehlschlag → Phase bleibt awaiting_review, Inbox-Item,
      // kein Auto-Approve; manuelles Freigeben (Human-Override) bleibt möglich.
      // Schritte vor Agents (E8) — und beide vor jedem Weiterlauf (FR-009).
      if (await this.runAfterPhaseSteps(featureId, running.phase)) return;
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
   * after_phase-Schritte ausführen; true = blockierender Fehlschlag (Aufrufer stoppt
   * Gate und Auto-Progress). Infrastruktur-Fehler blockieren nie (best-effort +
   * behebbare Meldung) — dieselbe Linie wie beim Agenten-Gate.
   */
  private async runAfterPhaseSteps(featureId: string, phase: FeaturePhase): Promise<boolean> {
    const feature = this.deps.features.get(featureId);
    if (!feature) return false;
    const trigger = { kind: 'after_phase', phase } as const;
    if (!this.deps.lifecycleSteps.hasStepsFor(feature.projectId, featureId, trigger)) return false;
    try {
      const project = this.mustProject(feature.projectId);
      const outcome = await this.deps.lifecycleSteps.runTrigger(feature, project, trigger);
      return !outcome.ok;
    } catch (err) {
      const item = this.deps.attention.raise({
        kind: 'agent_errored',
        projectId: feature.projectId,
        featureId,
        message: `${feature.name}: Schritte nach Phase '${phase}' fehlgeschlagen — ${(err as Error).message}`,
      });
      bus.emitEvent('attention_raised', item);
      return false;
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
   * Transkriptpfad + End-Offset eines abgeschlossenen Phasen-Laufs persistieren, damit
   * der Lauf-Log-Endpoint den Ausschnitt [start, end) auch nach Server-Neustart rendern
   * kann. Ohne Transkript (keine claudeSessionId) bleibt der Pfad null. Hat die Datei
   * während der Phase gewechselt (/clear), wird der Start-Offset auf 0 korrigiert.
   */
  persistTranscriptRange(session: LiveSession, running: RunMark): void {
    const path = session.claudeSessionId
      ? locateTranscript(session.cwd, session.claudeSessionId)
      : null;
    const offsetEnd = path ? transcriptSize(path) : 0;
    const offsetStartFix = path ? startOffsetIn(path, running) : null;
    this.deps.executions.recordTranscriptEnd(running.executionId, path, offsetEnd, offsetStartFix);
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
    emitAttentionResolved(this.deps.attention.resolveFor({ sessionId: session.id, kinds: ['awaiting_input'] }));
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
        this.deps.meter.finish(session, running, exitCode || 1);
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
      if (this.deps.attention.resolve(stale.id)) emitAttentionResolved([stale.id]);
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
      if (this.deps.attention.resolve(stale.id)) emitAttentionResolved([stale.id]);
    }
    // Die projektbezogene Verifikationslücke hängt an der Projektkonfiguration, nicht
    // am Snapshot — sie wird hier aufgelöst, sobald ein Kommando konfiguriert ist
    // (FR-007). Im Reconcile-Durchlauf und nicht im PATCH-Handler, damit es auch nach
    // einem Neustart und bei Änderungen außerhalb der Route wirkt.
    for (const id of resolveVerificationGaps({ attention: this.deps.attention, projects: this.deps.projects })) {
      bus.emitEvent('attention_resolved', id);
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
