import { join } from 'node:path';
import {
  approvePhase,
  discardPhase,
  finishPhase,
  initialPhases,
  nextPhase,
  reapOrphanedRunning,
  reconcileWithDisk,
  resolveAutomation,
  shouldAutoProgress,
  startPhase,
  displayStatus,
  type AutomationSettings,
  type Feature,
  type FeaturePhase,
  type Project,
  type SessionEffect,
} from '@sdd/shared';
import type { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo, SessionRepo, SettingsRepo } from '../db/repos.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import { buildClaudeArgv, phaseSlashCommand } from '../pty/commandBuilder.js';
import { artifactExists, parseTaskProgress } from './artifacts.js';
import { bus } from '../events.js';
import type { MergeQueueService } from './mergeQueueService.js';

export interface OrchestratorDeps {
  projects: ProjectRepo;
  features: FeatureRepo;
  sessions: SessionRepo;
  executions: ExecutionRepo;
  attention: AttentionRepo;
  settings: SettingsRepo;
  worktrees: WorktreeManager;
  ptys: PtySessionManager;
  dataDir: string;
}

/** Laufender Phasen-Kontext pro Feature (ephemer). */
interface RunningPhase {
  phase: FeaturePhase;
  executionId: string;
}

export class Orchestrator {
  private runningPhases = new Map<string, RunningPhase>(); // featureId → Phase
  private mergeQueue: MergeQueueService | null = null;

  constructor(private deps: OrchestratorDeps) {}

  attachMergeQueue(q: MergeQueueService): void {
    this.mergeQueue = q;
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
      automation: {},
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

  /** Konsole pro Feature: eine persistente Claude-Session im Worktree. */
  async ensureSession(featureId: string): Promise<LiveSession> {
    const feature = this.mustFeature(featureId);
    const project = this.mustProject(feature.projectId);
    const existing = this.deps.ptys.forFeature(featureId);
    if (existing) return existing;

    if (!feature.worktreePath) {
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

    // Resume, wenn eine frühere Claude-Session bekannt ist und ihr Transkript noch existiert.
    const prev = this.deps.sessions.latestForFeature(featureId);
    const resumeId = prev?.claude_session_id ?? undefined;

    const argv = buildClaudeArgv({
      ...(resumeId ? { resume: resumeId } : {}),
      settingsPath: '__SETTINGS__',
      permissionMode: 'acceptEdits',
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

    const executionId = this.deps.executions.start({
      projectId: feature.projectId,
      featureId,
      kind: 'phase',
      phase,
      logPath: null,
    });
    this.runningPhases.set(featureId, { phase, executionId });

    const session = await this.ensureSession(featureId);
    const slash = phaseSlashCommand(phase, `specs/${feature.name}`);
    const prompt = extraPrompt ? `${slash} ${extraPrompt}` : slash;
    this.deps.ptys.sendPrompt(session.id, prompt);

    this.emitFeature(featureId);
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
    const executionId = this.deps.executions.start({
      projectId: feature.projectId,
      featureId,
      kind: 'phase',
      phase,
      logPath: null,
    });
    this.runningPhases.set(featureId, { phase, executionId });
    const session = await this.ensureSession(featureId);
    this.deps.ptys.sendPrompt(session.id, phaseSlashCommand(phase, `specs/${feature.name}`));
    this.emitFeature(featureId);
  }

  // ---------- Session-Callbacks (von PtySessionManager) ----------

  handleStatusChange(session: LiveSession, effects: SessionEffect[]): void {
    const status = displayStatus(session.machine.state);
    const awaiting = session.machine.state.kind === 'awaiting_input' ? session.machine.state.awaiting : null;

    bus.emitEvent('session_status', {
      sessionId: session.id,
      featureId: session.featureId,
      projectId: session.projectId,
      status,
      awaitingKind: awaiting,
    });

    // Wieder aktiv → offene Aufmerksamkeits-Items dieser Session sind erledigt.
    if (status === 'working') {
      this.deps.attention.resolveFor({
        sessionId: session.id,
        kinds: ['awaiting_input', 'permission_request'],
      });
      bus.emitEvent('attention_resolved', session.id);
    }

    for (const effect of effects) {
      if (effect.kind === 'input_requested') {
        const feature = session.featureId ? this.deps.features.get(session.featureId) : null;
        const item = this.deps.attention.raise({
          kind: effect.awaiting === 'permission' ? 'permission_request' : 'awaiting_input',
          projectId: session.projectId,
          featureId: session.featureId,
          sessionId: session.id,
          message:
            effect.awaiting === 'permission'
              ? `${feature?.name ?? 'Session'}: wartet auf eine Berechtigung`
              : effect.awaiting === 'plan_approval'
                ? `${feature?.name ?? 'Session'}: wartet auf Plan-Freigabe`
                : `${feature?.name ?? 'Session'}: hat eine Frage`,
        });
        bus.emitEvent('attention_raised', item);
        bus.emitEvent('notification', {
          title: 'Agent wartet auf dich',
          body: item.message,
          featureId: session.featureId,
        });
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
      this.deps.executions.finish(running.executionId, 0);

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
        bus.emitEvent('notification', {
          title: `Phase ${running.phase} fertig`,
          body: `${feature.name}: wartet auf dein Review`,
          featureId,
        });
      }
    } else {
      bus.emitEvent('notification', {
        title: 'Agent ist fertig',
        body: `${feature.name}: Turn abgeschlossen`,
        featureId,
      });
    }
  }

  handleExit(session: LiveSession, exitCode: number): void {
    this.deps.sessions.end(session.id);
    if (session.featureId) {
      const running = this.runningPhases.get(session.featureId);
      if (running) {
        // Session starb mitten in einer Phase → Phase zurücksetzen.
        this.runningPhases.delete(session.featureId);
        this.deps.executions.finish(running.executionId, exitCode || 1);
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
      const reaped = reapOrphanedRunning(f.phases, () => false);
      if (reaped !== f.phases) this.deps.features.savePhases(f.id, reaped);
    }
    if (orphaned > 0) {
      console.log(`[reaper] ${orphaned} verwaiste Executions bereinigt`);
    }
  }

  /** Disk-Reconciliation: extern erzeugte Artefakte heben idle-Phasen an. */
  reconcileFeature(featureId: string): void {
    const feature = this.mustFeature(featureId);
    const root = feature.worktreePath ?? this.mustProject(feature.projectId).path;
    const reconciled = reconcileWithDisk(feature.phases, (p) => artifactExists(root, feature.name, p));
    if (reconciled !== feature.phases) {
      this.deps.features.savePhases(featureId, reconciled);
      this.emitFeature(featureId);
    }
  }

  // ---------- Helpers ----------

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
