import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  buildLifecycleEnv,
  lifecycleCwdKind,
  lifecycleTriggerTitle,
  resolveLifecycleSteps,
} from '@sdd/shared';
import type { Feature, LifecycleStep, LifecycleTrigger, Project } from '@sdd/shared';
import type { AttentionRepo, ExecutionRepo } from '../db/repos.js';
import type { LifecycleStepRepo } from '../db/lifecycleStepRepo.js';
import { bus } from '../events.js';
import { defaultStepRunner, type StepRunner } from './stepRunner.js';

export type { StepRunner };

/** Ergebnis eines einzelnen Schritt-Laufs (Buchführung + Kette). */
export interface StepOutcome {
  step: LifecycleStep;
  executionId: string;
  exitCode: number;
  timedOut: boolean;
}

export interface LifecycleTriggerOutcome {
  /** false = ein blockierender Schritt ist fehlgeschlagen; der Aufrufer hält an. */
  ok: boolean;
  /** Der blockierende Schritt, an dem die Kette abgebrochen ist. */
  failed: LifecycleStep | null;
  ran: StepOutcome[];
  /**
   * true = derselbe Auslöser desselben Features lief bereits (Doppelstart-Guard).
   * `ok` bleibt true, weil der laufende Durchlauf die Wirkung trägt — der Aufrufer
   * soll nicht zusätzlich anhalten.
   */
  skipped?: boolean;
}

export interface LifecycleStepDeps {
  steps: LifecycleStepRepo;
  executions: ExecutionRepo;
  attention: AttentionRepo;
  dataDir: string;
  runner?: StepRunner;
  /**
   * Anfang des Portblocks des eigenen Worktrees; null = keiner bekannt. Kommt aus
   * dem PortAllocator und wird über `buildLifecycleEnv()` als `$SDD_PORT_BASE`
   * gereicht — es gibt keinen zweiten Weg zur Portvergabe (FR-007).
   */
  portBaseFor?: (worktreePath: string) => number | null;
}

/** Kontext-Ergänzungen, die nicht am Feature stehen. */
export interface RunTriggerOptions {
  /**
   * Worktree-Pfad, wenn er (noch) nicht am Feature persistiert ist — bei
   * `before_worktree_create` der KÜNFTIGE Pfad (US3 Szenario 5).
   */
  worktreePath?: string;
}

/**
 * Lebenszyklus-Schritte ausführen: benannte Shell-Kommandos an definierten Punkten
 * des Feature-Lebenszyklus. Je Auslöser laufen die geltenden Schritte **sequentiell**;
 * der erste blockierende Fehlschlag bricht die Kette ab und meldet `{ ok: false }`.
 *
 * Bewertet werden ausschließlich Exit-Code und Zeitlimit — die Ausgabe wird nie
 * interpretiert. Ein Schritt-Lauf schreibt NIE einen Verbrauchswert (FR-020): an
 * einem Shell-Kommando gibt es keine Tokens, und eine 0 wäre eine Falschaussage.
 *
 * Eigener Runner statt Umbau von `verifyService`: dieser Pfad braucht zusätzlich
 * einen Tail-Puffer für das Inbox-Item und ein pro Schritt konfigurierbares
 * Zeitlimit — und `verifyService` sitzt ungetestet im Merge-Pfad.
 */
export class LifecycleStepService {
  private runner: StepRunner;
  /** `${featureId}:${triggerKey}` — Doppelstart-Guard (Muster: Orchestrator.runningGates). */
  private runningTriggers = new Set<string>();

  constructor(private deps: LifecycleStepDeps) {
    this.runner = deps.runner ?? defaultStepRunner;
  }

  /**
   * Fast-Path: gibt es für diesen Auslöser überhaupt geltende Schritte? Ohne
   * konfigurierte Schritte entsteht keine Execution, kein Prozess, kein Log und
   * keine Zustandsänderung — ein Projekt ohne Schritte verhält sich exakt wie
   * bisher (FR-027).
   */
  hasStepsFor(projectId: string, featureId: string, trigger: LifecycleTrigger): boolean {
    return this.resolve(projectId, featureId, trigger).length > 0;
  }

  /**
   * Alle für den Auslöser geltenden Schritte sequentiell ausführen.
   * Wirft, wenn der erwartete Worktree fehlt (behebbarer Infrastrukturfehler,
   * kein FAIL-Lauf — FR-026).
   */
  async runTrigger(
    feature: Feature,
    project: Project,
    trigger: LifecycleTrigger,
    opts: RunTriggerOptions = {},
  ): Promise<LifecycleTriggerOutcome> {
    const steps = this.resolve(project.id, feature.id, trigger);
    if (steps.length === 0) return { ok: true, failed: null, ran: [] };

    const key = `${feature.id}:${triggerKey(trigger)}`;
    if (this.runningTriggers.has(key)) return { ok: true, failed: null, ran: [], skipped: true };
    this.runningTriggers.add(key);
    try {
      return await this.runChain(steps, feature, project, trigger, opts);
    } finally {
      this.runningTriggers.delete(key);
    }
  }

  private async runChain(
    steps: LifecycleStep[],
    feature: Feature,
    project: Project,
    trigger: LifecycleTrigger,
    opts: RunTriggerOptions,
  ): Promise<LifecycleTriggerOutcome> {
    const worktreePath = opts.worktreePath ?? feature.worktreePath ?? '';
    const cwd = this.resolveCwd(feature, project, trigger, worktreePath);
    const env = buildLifecycleEnv({
      worktreePath,
      projectName: project.name,
      featureName: feature.name,
      branch: feature.branch,
      phase: trigger.phase ?? null,
      stage: trigger.stage ?? null,
      // Der Block des EIGENEN Worktrees — nie der eines Nachbar-Features (US1 Szenario 2).
      portBase: worktreePath ? (this.deps.portBaseFor?.(worktreePath) ?? null) : null,
      // Ein gewöhnlicher Schritt ist kein Profillauf: `[ -z "$SDD_PROFILE" ]`.
      profile: null,
    });

    const ran: StepOutcome[] = [];
    for (const step of steps) {
      const outcome = await this.runOne(step, feature, project, trigger, cwd, env);
      ran.push(outcome);
      if (outcome.exitCode !== 0 && step.blocking) {
        return { ok: false, failed: step, ran };
      }
    }
    // Vollständiger Durchlauf ohne blockierenden Fehlschlag: offene Schritt-Meldungen
    // dieses Features sind erledigt (FR-025). Ein beratender Fehlschlag hat nie ein
    // Item erzeugt (FR-024) und hält den Wiederanlauf deshalb auch nicht auf.
    this.resolveAttention(feature.id);
    return { ok: true, failed: null, ran };
  }

  private async runOne(
    step: LifecycleStep,
    feature: Feature,
    project: Project,
    trigger: LifecycleTrigger,
    cwd: string,
    env: Record<string, string>,
  ): Promise<StepOutcome> {
    const execId = this.deps.executions.start({
      projectId: project.id,
      featureId: feature.id,
      kind: 'lifecycle_step',
      // Name zum Startzeitpunkt: der Lauf bleibt lesbar, wenn der Schritt später
      // umbenannt oder gelöscht wird (FR-028).
      label: step.name,
      phase: trigger.phase ?? null,
      logPath: null,
    });
    // Die Log-Datei heißt nach der execId — dieselbe Ableitung wie bei allen
    // anderen Arten, die eine physische Datei schreiben (agentGate, chat, verify).
    // `GET /api/executions/:id/log` findet sie darüber ohne Zusatzcode.
    const logPath = join(this.deps.dataDir, 'logs', `${execId}.log`);
    bus.emitEvent('execution_updated', { executionId: execId, featureId: feature.id });

    const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const { exitCode, tail, timedOut } = await this.runner({
      command: step.command,
      cwd,
      logPath,
      header: `${step.name}: ${step.command}`,
      timeoutMs,
      extraEnv: env,
    });

    this.deps.executions.finish(execId, exitCode);
    bus.emitEvent('execution_updated', { executionId: execId, featureId: feature.id });

    if (exitCode !== 0 && step.blocking) {
      this.raiseFailed(step, feature, trigger, exitCode, tail, timedOut, timeoutMs);
    }
    return { step, executionId: execId, exitCode, timedOut };
  }

  private resolve(projectId: string, featureId: string, trigger: LifecycleTrigger): LifecycleStep[] {
    return resolveLifecycleSteps(
      this.deps.steps.forProject(projectId),
      this.deps.steps.selectionFor(featureId),
      trigger,
    );
  }

  /**
   * Arbeitsverzeichnis je Auslöser (pure Regel in shared). Fehlt der Worktree
   * dort, wo einer erwartet wird, ist das ein behebbarer Infrastrukturfehler —
   * kein Grund, still im falschen Verzeichnis zu laufen und einen scheinbaren
   * Erfolg zu produzieren (Muster: AgentGateService.guardWorktree).
   */
  private resolveCwd(
    feature: Feature,
    project: Project,
    trigger: LifecycleTrigger,
    worktreePath: string,
  ): string {
    if (lifecycleCwdKind(trigger) === 'main') {
      if (!existsSync(project.path)) {
        throw new Error(
          `Lebenszyklus-Schritte übersprungen: Projektverzeichnis fehlt (${project.path}) — erneut anstoßen.`,
        );
      }
      return project.path;
    }
    if (!worktreePath || !existsSync(worktreePath)) {
      throw new Error(
        `Lebenszyklus-Schritte übersprungen: Worktree fehlt (${worktreePath || 'kein Pfad'}) — erneut anstoßen.`,
      );
    }
    return worktreePath;
  }

  /**
   * Blockierender Fehlschlag → ein Inbox-Item, synchron im Abschlusspfad (SC-003).
   * Es trägt Schrittname, Kommando, Exit-Code und die letzten Ausgabezeilen, damit
   * es ohne Log-Suche lesbar ist (FR-023). Ein **beratender** Fehlschlag erzeugt
   * KEIN Item (FR-024) — sichtbar bleibt er am fehlgeschlagenen Lauf.
   */
  private raiseFailed(
    step: LifecycleStep,
    feature: Feature,
    trigger: LifecycleTrigger,
    exitCode: number,
    tail: string,
    timedOut: boolean,
    timeoutMs: number,
  ): void {
    const head = timedOut
      ? `nach Zeitlimit beendet (${Math.round(timeoutMs / 60_000)} min)`
      : `fehlgeschlagen (exit ${exitCode})`;
    const message = [
      `${feature.name}: Schritt „${step.name}" ${head} an ${lifecycleTriggerTitle(trigger)}`,
      `Kommando: ${step.command}`,
      ...(tail ? ['Letzte Ausgabe:', tail] : []),
    ].join('\n');

    const item = this.deps.attention.raise({
      kind: 'lifecycle_step_failed',
      projectId: feature.projectId,
      featureId: feature.id,
      message,
    });
    bus.emitEvent('attention_raised', item);
    bus.emitEvent('notification', {
      title: 'Lebenszyklus-Schritt fehlgeschlagen',
      body: `${feature.name}: ${step.name} — ${head}`,
      featureId: feature.id,
      kind: 'escalation',
    });
  }

  private resolveAttention(featureId: string): void {
    this.deps.attention.resolveFor({ featureId, kinds: ['lifecycle_step_failed'] });
    bus.emitEvent('attention_resolved', featureId);
  }
}

/** Auslöser-Identität für den Doppelstart-Guard. */
function triggerKey(t: LifecycleTrigger): string {
  return `${t.kind}:${t.phase ?? t.stage ?? ''}`;
}

