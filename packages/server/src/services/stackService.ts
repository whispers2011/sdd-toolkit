/**
 * Stack-Profile als ERSETZBARE KERNSCHRITTE: das Toolkit kennt Profilnamen,
 * Portblock und Dienstliste — nicht Docker, nicht Compose (FR-012). Jedes
 * Kommando kommt vom Projekt und läuft über DENSELBEN Runner wie ein
 * Lebenszyklus-Schritt (research E6).
 *
 * Zwei Dinge sind hier streng getrennt:
 *
 * - **Absicht** (`feature_stacks`): welches Profil betrieben werden SOLL. Sie
 *   überlebt Läufe und Serverneustarts.
 * - **Zustand** (`probe()`): ob ein Dienst antwortet. Immer frisch erhoben, nie
 *   aus der Datenbank behauptet (FR-023, research E8).
 */
import { createConnection } from 'node:net';
import { join } from 'node:path';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  buildLifecycleEnv,
  isStackConfigured,
  laneActionBlockReason,
  portFor,
  profilesForLaneAction,
  stackUrl,
  tailLines,
  type FeatureStackView,
  type LaneAction,
  type StackCommandStep,
  type StackProfileName,
  type StackServiceStatus,
  type StackServiceView,
  type Feature,
  type Project,
} from '@sdd/shared';
import type { AttentionRepo, ExecutionRepo } from '../db/repos.js';
import type { StackRepo } from '../db/stackRepo.js';
import { bus } from '../events.js';
import { defaultStepRunner, type StepRunner } from './stepRunner.js';

/** Portblöcke — so viel, wie der StackService davon braucht. */
export interface StackPortSource {
  baseForWorktree(worktreePath: string): number | null;
  baseForProject(projectId: string): number | null;
  ensureFor(owner: {
    kind: 'project';
    projectId: string;
    projectName: string;
    projectPath: string;
  }): Promise<{ base: number }>;
}

/** Erreichbarkeitsprobe eines Ports. Injizierbar für Tests. */
export type ServiceProbe = (port: number) => Promise<boolean>;

export interface StackServiceDeps {
  stacks: StackRepo;
  executions: ExecutionRepo;
  attention: AttentionRepo;
  ports: StackPortSource;
  dataDir: string;
  runner?: StepRunner;
  probe?: ServiceProbe;
}

/** Ergebnis eines Profillaufs. */
export interface StackRunResult {
  ok: boolean;
  exitCode: number;
  tail: string;
  timedOut: boolean;
  /** Das Kommando, dessen Fehlschlag den Lauf beendet hat. */
  command: string | null;
}

export class StackRunError extends Error {
  constructor(
    readonly exitCode: number,
    readonly tail: string,
    message: string,
  ) {
    super(message);
    this.name = 'StackRunError';
  }
}

/** Verbindungs-Zeitlimit einer Dienstprobe. */
const PROBE_TIMEOUT_MS = 300;

/** Lastbremse der Statuserhebung — die Lane bleibt bedienbar (Performance Goal). */
const PROBE_CACHE_TTL_MS = 3000;

export class StackService {
  private runner: StepRunner;
  private probeFn: ServiceProbe;

  constructor(private deps: StackServiceDeps) {
    this.runner = deps.runner ?? defaultStepRunner;
    this.probeFn = deps.probe ?? tcpProbe;
  }

  /** Läufe pro Schlüssel serialisieren (Muster: WorktreeManager). */
  private locks = new Map<string, Promise<unknown>>();
  private serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(fn, fn);
    this.locks.set(
      key,
      run.catch(() => {}),
    );
    return run;
  }

  private probeCache = new Map<string, { at: number; view: FeatureStackView }>();

  // ---------- Fast-Path ----------

  /**
   * Ohne Stack-Konfiguration passiert NICHTS: kein Query, kein Spawn, keine
   * Execution. Ein Projekt ohne Profile verhält sich wie vor diesem Feature
   * (FR-013, SC-010).
   */
  isConfigured(project: Project): boolean {
    return isStackConfigured(project.stack);
  }

  // ---------- Betrieb ----------

  /**
   * Profil hochfahren (FR-014/FR-016). Idempotent auf der ABSICHT: steht sie
   * bereits auf demselben Profil, läuft kein zweites Kommando — der Stack bleibt
   * über alle folgenden Läufe stehen und wird nicht pro Lauf neu gestartet
   * (FR-015, SC-006).
   */
  async up(
    feature: Feature,
    project: Project,
    profile: Extract<StackProfileName, 'test' | 'full'>,
  ): Promise<void> {
    if (!this.isConfigured(project)) return;
    if (this.deps.stacks.getIntent(feature.id)?.profile === profile) return;

    await this.runLaneAction(feature, project, 'up', profile);
    this.deps.stacks.setIntent(feature.id, profile, Date.now());
    this.invalidateProbe(feature.id);
  }

  /** Dienste anhalten, Daten behalten. Die Absicht bleibt bestehen. */
  async stop(feature: Feature, project: Project): Promise<void> {
    await this.runLaneAction(feature, project, 'stop', 'full');
    this.invalidateProbe(feature.id);
  }

  /** Neu starten; ohne Anhalte-Kommando ist das Abbau + Aufbau (die Daten sind weg). */
  async restart(feature: Feature, project: Project): Promise<void> {
    await this.runLaneAction(feature, project, 'restart', 'full');
    this.deps.stacks.setIntent(feature.id, 'full', Date.now());
    this.invalidateProbe(feature.id);
  }

  /**
   * Abbauen, einschließlich der Datenablagen (FR-017). Läuft an Session-Ende,
   * Merge, Worktree-Entfernen, Archivieren und Löschen.
   *
   * `quiet` für die Anlässe, an denen ein Fehlschlag den Vorgang nicht abbrechen
   * darf (Session-Ende, Archivieren): es entsteht die Meldung, aber kein Wurf.
   */
  async down(feature: Feature, project: Project, opts: { quiet?: boolean } = {}): Promise<void> {
    if (!this.isConfigured(project)) {
      this.deps.stacks.clearIntent(feature.id);
      return;
    }
    try {
      await this.runLaneAction(feature, project, 'down', 'full');
    } catch (err) {
      if (opts.quiet !== true) throw err;
      return;
    }
    this.deps.stacks.clearIntent(feature.id);
    this.invalidateProbe(feature.id);
  }

  // ---------- Ausführung ----------

  /**
   * Die Kommandofolge einer Lane-Aktion ausführen. Die Auswahl ist pur
   * (`profilesForLaneAction`); hier fällt nur die Entscheidung, die ein einzelnes
   * Feature nicht treffen KANN: ob das geteilte Kommando mitläuft (FR-022).
   */
  private async runLaneAction(
    feature: Feature,
    project: Project,
    action: LaneAction,
    upProfile: Extract<StackProfileName, 'test' | 'full'>,
  ): Promise<void> {
    const blockReason = laneActionBlockReason(project.stack, action);
    if (blockReason !== null) throw new StackRunError(0, '', blockReason);

    const steps = profilesForLaneAction(project.stack, action, upProfile);
    if (steps === null) throw new StackRunError(0, '', 'Für dieses Profil ist kein Kommando hinterlegt.');

    await this.serialize(`feature::${feature.id}`, async () => {
      for (const step of steps) {
        const shared = await this.sharedCommandFor(feature, project, action, step);
        // Geteiltes Kommando VOR dem feature-eigenen beim Hochfahren, DANACH beim
        // Abbau — sonst zieht der Abbau die Grundlage unter dem eigenen weg.
        const goingUp = action === 'up' || (action === 'restart' && step.profile !== 'down');
        if (shared && goingUp) await this.runSharedStep(feature, project, step, shared);
        await this.runStep(feature, project, step, {
          scope: 'feature',
          command: step.command,
          cwd: feature.worktreePath ?? project.path,
          portBase: feature.worktreePath ? this.deps.ports.baseForWorktree(feature.worktreePath) : null,
        });
        if (shared && !goingUp) await this.runSharedStep(feature, project, step, shared);
      }
      this.deps.attention.resolveFor({ featureId: feature.id, kinds: ['stack_failed'] });
      bus.emitEvent('attention_resolved', feature.id);
    });
  }

  /**
   * Läuft das geteilte Kommando in diesem Schritt mit? Diese Entscheidung fällt
   * über MEHRERE Features hinweg und kann deshalb nur hier fallen, nicht in
   * einem Kommando, das immer nur sein eigenes Feature kennt (FR-022, research E7).
   *
   * - Hochfahren: nur, wenn die geteilten Dienste nicht erreichbar sind.
   * - Abbau: nur, wenn kein weiteres Feature des Projekts eine Absicht hat.
   */
  private async sharedCommandFor(
    feature: Feature,
    project: Project,
    action: LaneAction,
    step: StackCommandStep,
  ): Promise<string | null> {
    if (step.sharedCommand === null) return null;
    if (action === 'down' || step.profile === 'down') {
      return this.deps.stacks.hasOtherIntent(project.id, feature.id) ? null : step.sharedCommand;
    }
    return (await this.sharedReachable(project)) ? null : step.sharedCommand;
  }

  /** Antworten alle geteilten Dienste des Projekts? */
  private async sharedReachable(project: Project): Promise<boolean> {
    const shared = project.stack.services.filter((s) => s.scope === 'shared');
    if (shared.length === 0) return true;
    const base = this.deps.ports.baseForProject(project.id);
    if (base === null) return false;
    const results = await Promise.all(shared.map((s) => this.probeFn(base + s.portOffset)));
    return results.every(Boolean);
  }

  /**
   * Das geteilte Kommando: serialisiert pro Projekt, damit es bei zwei
   * gleichzeitig startenden Features GENAU EINMAL entsteht (Edge Case der Spec).
   * Arbeitsverzeichnis ist der Haupt-Checkout, `$SDD_PORT_BASE` der PROJEKTBLOCK
   * — im Block eines Features stürbe der Dienst mit dessen Abbau (research E2).
   */
  private async runSharedStep(
    feature: Feature,
    project: Project,
    step: StackCommandStep,
    command: string,
  ): Promise<void> {
    await this.serialize(`shared::${project.id}`, async () => {
      const block = await this.deps.ports.ensureFor({
        kind: 'project',
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
      });
      await this.runStep(feature, project, step, {
        scope: 'shared',
        command,
        cwd: project.path,
        portBase: block.base,
      });
    });
  }

  /**
   * Ein einzelner Profillauf. Verbucht als Execution der Art `lifecycle_step` mit
   * `label: "Stack: <profil>"` und OHNE Verbrauchswert — an einem Shell-Kommando
   * gibt es keine Tokens, und eine 0 wäre eine Falschaussage.
   *
   * Bewertet werden ausschließlich Exit-Code und Zeitlimit; die Ausgabe wird nie
   * interpretiert (contracts/stack-profiles.md §5).
   */
  private async runStep(
    feature: Feature,
    project: Project,
    step: StackCommandStep,
    run: { scope: 'feature' | 'shared'; command: string; cwd: string; portBase: number | null },
  ): Promise<void> {
    const label = `Stack: ${step.profile}${run.scope === 'shared' ? ' (geteilt)' : ''}`;
    const execId = this.deps.executions.start({
      projectId: project.id,
      featureId: feature.id,
      kind: 'lifecycle_step',
      label,
      phase: null,
      logPath: null,
    });
    const logPath = join(this.deps.dataDir, 'logs', `${execId}.log`);
    bus.emitEvent('execution_updated', { executionId: execId, featureId: feature.id });

    // DIESELBE Stelle wie bei jedem Lebenszyklus-Schritt — kein eigener
    // Umgebungsaufbau für Profilläufe (FR-007, research E5).
    const env = buildLifecycleEnv({
      worktreePath: run.scope === 'shared' ? '' : (feature.worktreePath ?? ''),
      projectName: project.name,
      featureName: run.scope === 'shared' ? '' : feature.name,
      branch: run.scope === 'shared' ? '' : feature.branch,
      phase: null,
      stage: null,
      portBase: run.portBase,
      profile: step.profile,
    });

    const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const { exitCode, tail, timedOut } = await this.runner({
      command: run.command,
      cwd: run.cwd,
      logPath,
      header: `${label}: ${run.command}`,
      timeoutMs,
      extraEnv: env,
    });

    this.deps.executions.finish(execId, exitCode);
    bus.emitEvent('execution_updated', { executionId: execId, featureId: feature.id });

    if (exitCode !== 0) {
      this.raiseFailed(feature, step.profile, run.command, exitCode, tail, timedOut, timeoutMs);
      throw new StackRunError(
        exitCode,
        tail,
        timedOut
          ? `Stack-Profil „${step.profile}" nach Zeitlimit beendet (${Math.round(timeoutMs / 60_000)} min)`
          : `Stack-Profil „${step.profile}" fehlgeschlagen (exit ${exitCode})`,
      );
    }
  }

  /**
   * Fehlschlag ⇒ eine „Braucht dich"-Meldung mit Profil, Kommando, Exit-Code und
   * Ausgabe-Ausschnitt. Der Ablauf läuft NICHT stillschweigend auf einem halben
   * Stack weiter (FR-019).
   */
  private raiseFailed(
    feature: Feature,
    profile: StackProfileName,
    command: string,
    exitCode: number,
    tail: string,
    timedOut: boolean,
    timeoutMs: number,
  ): void {
    const head = timedOut
      ? `nach Zeitlimit beendet (${Math.round(timeoutMs / 60_000)} min)`
      : `fehlgeschlagen (exit ${exitCode})`;
    const item = this.deps.attention.raise({
      kind: 'stack_failed',
      projectId: feature.projectId,
      featureId: feature.id,
      message: [
        `${feature.name}: Stack-Profil „${profile}" ${head}`,
        `Kommando: ${command}`,
        ...(tail ? ['Letzte Ausgabe:', tailLines(tail)] : []),
      ].join('\n'),
    });
    bus.emitEvent('attention_raised', item);
    bus.emitEvent('notification', {
      title: 'Stack-Profil fehlgeschlagen',
      body: `${feature.name}: ${profile} — ${head}`,
      featureId: feature.id,
      kind: 'escalation',
    });
  }

  // ---------- Erhebung ----------

  private invalidateProbe(featureId: string): void {
    this.probeCache.delete(featureId);
  }

  /**
   * Erhobener Zustand eines Features (FR-023). Jeder Status kommt aus einer
   * frischen TCP-Probe — auch nach einem Serverneustart wird nichts behauptet.
   * Die Adresse entsteht NUR, wenn der Haupteingang antwortet; sonst zeigt die
   * Lane „nicht erreichbar" statt eines Links ins Leere (FR-031/FR-033).
   */
  async probe(feature: Feature, project: Project, opts: { refresh?: boolean } = {}): Promise<FeatureStackView> {
    const cached = this.probeCache.get(feature.id);
    if (opts.refresh !== true && cached && Date.now() - cached.at < PROBE_CACHE_TTL_MS) return cached.view;

    const intent = this.deps.stacks.getIntent(feature.id);
    const configured = this.isConfigured(project);
    const collectedAt = Date.now();

    if (!configured) {
      const view: FeatureStackView = {
        configured: false,
        profile: intent?.profile ?? null,
        portBase: null,
        url: null,
        services: [],
        collectedAt,
      };
      this.probeCache.set(feature.id, { at: collectedAt, view });
      return view;
    }

    const featureBase = feature.worktreePath ? this.deps.ports.baseForWorktree(feature.worktreePath) : null;
    const projectBase = this.deps.ports.baseForProject(project.id);

    const services: StackServiceView[] = await Promise.all(
      project.stack.services.map(async (s) => {
        const base = s.scope === 'shared' ? projectBase : featureBase;
        const port = portFor(base, s);
        const status: StackServiceStatus =
          port === null ? 'unknown' : (await this.probeFn(port)) ? 'up' : 'down';
        return { name: s.name, port, scope: s.scope, stateful: s.stateful, primary: s.primary, status };
      }),
    );

    const primaryUp = services.some((s) => s.primary && s.status === 'up');
    const view: FeatureStackView = {
      configured: true,
      profile: intent?.profile ?? null,
      portBase: featureBase,
      url: primaryUp ? stackUrl(featureBase, project.stack.services) : null,
      services,
      collectedAt,
    };
    this.probeCache.set(feature.id, { at: collectedAt, view });
    return view;
  }

  /** Nicht erhobene Sicht für Aufrufer ohne Worktree/Projektbezug. */
  emptyView(): FeatureStackView {
    return { configured: false, profile: null, portBase: null, url: null, services: [], collectedAt: Date.now() };
  }

  /** Wird für dieses Feature ein Profil betrieben? (Absicht, nicht Zustand.) */
  isRunning(featureId: string): boolean {
    return this.deps.stacks.getIntent(featureId) !== null;
  }
}

/**
 * Erreichbarkeitsprobe: antwortet dort etwas? Technikneutral — ein Port, der
 * annimmt, ist die Frage, die ohne Container-SDK beantwortbar ist (research E8).
 */
export const tcpProbe: ServiceProbe = (port) =>
  new Promise((resolveUp) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (up: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolveUp(up);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
