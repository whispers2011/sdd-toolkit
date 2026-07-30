import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialPhases, type Feature, type FeatureDocument, type OptimizationSettings } from '@sdd/shared';
import { Orchestrator, type OrchestratorDeps } from './orchestrator.js';
import type { LiveSession } from '../pty/sessionManager.js';

/**
 * Testet die Fehler-/Unterbrechungs-Pfade des Orchestrators (US2) mit
 * leichtgewichtigen Fakes statt echter DB/PTY: startPhaseRun-Rollback,
 * handleSubmitFailed und reapOnBoot.
 */

function makeFeature(
  phases = initialPhases(['specify', 'plan']),
  patch: Partial<Feature> = {},
): Feature {
  return {
    id: 'f1',
    projectId: 'p1',
    name: 'feat',
    branch: 'feature/feat',
    worktreePath: '/nonexistent',
    phases,
    integration: 'none',
    automation: {},
    optimization: {},
    tasksDone: 0,
    tasksTotal: 0,
    createdAt: 0,
    archivedAt: null,
    ...patch,
  } as unknown as Feature;
}

function setup(
  opts: {
    projectExists?: boolean;
    running?: boolean;
    feature?: Partial<Feature>;
    gate?: { hasAgentsFor?: (...args: unknown[]) => boolean; runTrigger?: ReturnType<typeof vi.fn> };
    /** Lebenszyklus-Schritte; ohne Angabe gilt „keine konfiguriert" (Fast-Path). */
    steps?: { hasStepsFor?: (...args: unknown[]) => boolean; runTrigger?: ReturnType<typeof vi.fn> };
    automation?: Record<string, unknown>;
    /** Laufende Session bereitstellen, damit `launchPhase` erreicht wird. */
    withSession?: boolean;
    /** Hinterlegte Dokumente; `'wirft'` simuliert ein defektes Manifest. */
    documents?: FeatureDocument[] | 'wirft';
    optimization?: Partial<OptimizationSettings>;
    projectPath?: string;
    /** Ausgangsstatus einzelner Phasen (die Maschine verlangt approve-Reihenfolge). */
    phaseStatus?: Partial<Record<'specify' | 'plan', string>>;
  } = {},
) {
  let phases = initialPhases(['specify', 'plan']);
  if (opts.running) phases = { ...phases, specify: { ...phases.specify, status: 'running' } };
  for (const [phase, status] of Object.entries(opts.phaseStatus ?? {})) {
    const key = phase as 'specify' | 'plan';
    phases = { ...phases, [key]: { ...phases[key], status } } as typeof phases;
  }
  const state = { get phases() { return phases; } };
  const savePhases = vi.fn((_id: string, p: typeof phases) => {
    phases = p;
  });
  const raise = vi.fn((a: { kind: string }) => ({ id: 'a1', ...a }));
  const finish = vi.fn();
  const runTrigger = opts.gate?.runTrigger ?? vi.fn();
  const stepsRunTrigger =
    opts.steps?.runTrigger ?? vi.fn(async () => ({ ok: true, failed: null, ran: [] }));
  const sendPrompt = vi.fn();
  const session = opts.withSession
    ? ({ id: 's1', kind: 'feature', featureId: 'f1', projectId: 'p1', scrollback: '', claudeSessionId: null, cwd: '/nonexistent' } as unknown as LiveSession)
    : undefined;
  const listDocuments = vi.fn(() => {
    if (opts.documents === 'wirft') throw new Error('documents.json ist kaputt');
    return opts.documents ?? [];
  });
  const deps = {
    features: {
      get: () => makeFeature(phases, opts.feature),
      savePhases,
      listAll: () => [makeFeature(phases, opts.feature)],
      setTasks: vi.fn(),
      setWorktree: vi.fn(),
    },
    projects: {
      get: () =>
        opts.projectExists === false
          ? undefined
          : {
              id: 'p1',
              name: 'proj',
              path: opts.projectPath ?? '/p',
              defaultBranch: 'main',
              enabledPhases: ['specify', 'plan'],
            },
    },
    attention: { raise, resolveFor: vi.fn(() => []), listOpen: () => [], resolve: vi.fn(() => true) },
    executions: {
      finish,
      reapOrphans: () => 0,
      start: vi.fn(),
      finishWithUsage: vi.fn(),
      recordTranscriptEnd: vi.fn(),
    },
    sessions: { listOpen: () => [], end: vi.fn(), latestForFeature: () => undefined, create: vi.fn() },
    settings: {
      getAutomation: () => ({
        autoProgressUntil: 'off',
        autoVerify: false,
        autoReviewAgents: false,
        autoMerge: false,
        autoMode: true,
        ...(opts.automation ?? {}),
      }),
      getOptimization: () => ({ contextStrategy: 'full', compression: 'off', ...(opts.optimization ?? {}) }),
    },
    worktrees: {},
    ptys: { forFeature: () => session, spawn: vi.fn(), remove: vi.fn(), sendPrompt, list: () => [] },
    knowledge: { materializeForFeature: () => ({ preamble: '' }) },
    featureDocuments: { listDocuments },
    agentGate: {
      hasAgentsFor: opts.gate?.hasAgentsFor ?? (() => false),
      runTrigger,
      runAgent: vi.fn(),
    },
    lifecycleSteps: {
      hasStepsFor: opts.steps?.hasStepsFor ?? (() => false),
      runTrigger: stepsRunTrigger,
    },
    dataDir: '/tmp',
  } as unknown as OrchestratorDeps;
  const orch = new Orchestrator(deps);
  return { orch, state, savePhases, raise, finish, runTrigger, stepsRunTrigger, sendPrompt, listDocuments };
}

describe('Orchestrator — Fehler- und Unterbrechungs-Pfade', () => {
  it('startPhaseRun rollt bei fehlgeschlagenem Start zurück und meldet „braucht dich"', async () => {
    const { orch, state, raise } = setup({ projectExists: false }); // ensureSession → mustProject wirft

    await expect(orch.startPhaseRun('f1', 'specify')).rejects.toThrow();

    expect(state.phases.specify.status).toBe('idle'); // kein hängendes „läuft"
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent_errored', featureId: 'f1' }));
  });

  it('startPhaseRun lehnt einen Doppelstart ab, solange bereits eine Phase läuft (kein Queueing)', async () => {
    const { orch, savePhases } = setup();
    (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.set('f1', {
      phase: 'specify',
      executionId: 'e1',
    });
    await expect(orch.startPhaseRun('f1', 'plan')).rejects.toThrow(/läuft bereits/i);
    expect(savePhases).not.toHaveBeenCalled(); // Phase wurde NICHT gestartet → nichts eingereiht
  });

  it('handleSubmitFailed rollt die laufende Phase zurück und meldet „braucht dich"', () => {
    const { orch, state, raise, finish } = setup({ running: true });
    (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.set('f1', {
      phase: 'specify',
      executionId: 'e1',
      scrollbackStart: 0,
      transcriptOffsetStart: 0,
      promptText: '/speckit-implement',
    });
    const session = { kind: 'feature', featureId: 'f1', projectId: 'p1', id: 's1' } as unknown as LiveSession;

    orch.handleSubmitFailed(session, '/speckit-implement');

    expect(state.phases.specify.status).toBe('idle');
    expect(finish).toHaveBeenCalledWith('e1', 1);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent_errored', featureId: 'f1' }));
  });

  // Regression: das Reset-Kommando geht als eigener Prompt VOR dem Phasenprompt raus.
  // Blieb dessen Bestätigung aus, räumte handleSubmitFailed die real laufende Phase ab —
  // Ursache für „jeder Schritt manuell", Phantom-Inbox-Meldungen und fehlende Tokens.
  it('handleSubmitFailed lässt die Phase laufen, wenn nur das vorgeschaltete Reset-Kommando scheiterte', () => {
    const { orch, state, raise, finish, savePhases } = setup({ running: true });
    (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.set('f1', {
      phase: 'specify',
      executionId: 'e1',
      scrollbackStart: 0,
      transcriptOffsetStart: 0,
      promptText: '/speckit-specify etwas',
    });
    const session = { kind: 'feature', featureId: 'f1', projectId: 'p1', id: 's1' } as unknown as LiveSession;

    orch.handleSubmitFailed(session, '/clear'); // nicht der Phasenprompt

    expect(state.phases.specify.status).toBe('running'); // Phase bleibt stehen
    expect(finish).not.toHaveBeenCalled();
    expect(savePhases).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled(); // keine Phantom-Meldung
    expect(
      (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.has('f1'),
    ).toBe(true); // Buchführung intakt → Turn-Abschluss greift später
  });

  // Regression zum Phasenversatz vom 27.07.2026: Das Reset-Kommando (/clear) erzeugt
  // einen EIGENEN Turn. Dessen Stop hat die Phase abgeschlossen, bevor ihr Prompt
  // überhaupt zugestellt war — `tasks` galt nach 6 s als erfolgreich, ohne dass
  // tasks.md existierte, und alle Folgephasen verrutschten um eine Position.
  it('Turn-Ende vor Zustellung des Phasenprompts schließt die Phase NICHT ab', async () => {
    const { orch, state, savePhases, finish } = setup({ running: true });
    (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.set('f1', {
      phase: 'specify',
      executionId: 'e1',
      scrollbackStart: 0,
      transcriptOffsetStart: 0,
      transcriptPathStart: null,
      startedAt: 0,
      promptText: '/speckit-specify etwas',
      promptConfirmed: false, // nur das Reset ging bisher raus
    });
    const session = {
      kind: 'feature', featureId: 'f1', projectId: 'p1', id: 's1',
      machine: { state: { kind: 'turn_done' }, hooksLive: true }, scrollback: '',
    } as unknown as LiveSession;

    orch.handleStatusChange(session, [{ kind: 'turn_completed' }]);
    // Der Guard sitzt vor jedem await in handleTurnCompleted, greift also synchron.
    await new Promise((r) => setTimeout(r, 10)); // trotzdem Luft lassen, falls doch etwas nachläuft

    expect(state.phases.specify.status).toBe('running'); // Phase bleibt offen
    expect(savePhases).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled(); // keine Execution als erfolgreich verbucht
    expect(
      (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.has('f1'),
    ).toBe(true);
  });

  it('nach Bestätigung des Phasenprompts schließt derselbe Turn die Phase ab', async () => {
    const { orch, state, savePhases } = setup({ running: true });
    (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.set('f1', {
      phase: 'specify',
      executionId: 'e1',
      scrollbackStart: 0,
      transcriptOffsetStart: 0,
      transcriptPathStart: null,
      startedAt: 0,
      promptText: '/speckit-specify etwas',
      promptConfirmed: false,
    });
    const session = {
      kind: 'feature', featureId: 'f1', projectId: 'p1', id: 's1',
      machine: { state: { kind: 'turn_done' }, hooksLive: true }, scrollback: '',
    } as unknown as LiveSession;

    orch.handleSubmitConfirmed(session, '/clear'); // Reset bestätigt → zählt NICHT
    orch.handleStatusChange(session, [{ kind: 'turn_completed' }]);
    // Der Guard greift synchron vor jedem await — kein Warten nötig, kein Flackern.
    expect(state.phases.specify.status).toBe('running');

    orch.handleSubmitConfirmed(session, '/speckit-specify etwas'); // jetzt der Phasenprompt
    orch.handleStatusChange(session, [{ kind: 'turn_completed' }]);

    // handleTurnCompleted läuft als void-Promise und wartet dazwischen auf IO
    // (parseTaskProgress). Auf eine feste Anzahl Ticks zu warten ist unter Last
    // unzuverlässig — daher auf den Zustand warten, nicht auf die Zeit.
    await vi.waitFor(() => expect(savePhases).toHaveBeenCalled());
    expect(state.phases.specify.status).not.toBe('running');
  });

  it('reapOnBoot setzt verwaiste running-Phasen auf idle und meldet run_interrupted', () => {
    const { orch, state, raise } = setup({ running: true });

    orch.reapOnBoot();

    expect(state.phases.specify.status).toBe('idle');
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'run_interrupted', featureId: 'f1' }));
  });
});

describe('Orchestrator — Agent-Gates (before_phase / after_phase)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it('before_phase-Gate deferrt den Start: Phase bleibt idle, gateRunning=true', async () => {
    // runTrigger hängt bewusst — der Start darf währenddessen nicht erfolgen.
    const runTrigger = vi.fn(() => new Promise(() => {}));
    const { orch, state } = setup({
      gate: { hasAgentsFor: (...a) => (a[2] as { kind: string }).kind === 'before_phase', runTrigger },
    });

    const result = await orch.startPhaseRun('f1', 'specify');
    expect(result).toEqual({ gateRunning: true });
    expect(state.phases.specify.status).toBe('idle'); // deferrt, nichts zu heilen
    await tick();
    expect(runTrigger).toHaveBeenCalledTimes(1);

    // Doppelstart-Guard: zweiter Aufruf startet kein zweites Gate.
    const again = await orch.startPhaseRun('f1', 'specify');
    expect(again).toEqual({ gateRunning: true });
    expect(runTrigger).toHaveBeenCalledTimes(1);
  });

  it('before_phase-FAIL: kein Start, Inbox-Item phase_gate_failed', async () => {
    const runTrigger = vi.fn(async () => ({ ok: false, failedAgent: 'DoR-Gate', runs: [] }));
    const { orch, state, raise } = setup({
      gate: { hasAgentsFor: (...a) => (a[2] as { kind: string }).kind === 'before_phase', runTrigger },
    });

    await orch.startPhaseRun('f1', 'specify');
    await tick();

    expect(state.phases.specify.status).toBe('idle');
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'phase_gate_failed', featureId: 'f1' }));
  });

  it('before_phase-PASS: Start wird mit skipGates nachgeholt', async () => {
    const runTrigger = vi.fn(async () => ({ ok: true, failedAgent: null, runs: [] }));
    const { orch, raise } = setup({
      gate: { hasAgentsFor: (...a) => (a[2] as { kind: string }).kind === 'before_phase', runTrigger },
    });

    await orch.startPhaseRun('f1', 'specify');
    await tick();

    // Der nachgeholte Start läuft in die (absichtlich kaputte) Session-Fake und
    // rollt zurück — entscheidend: er wurde VERSUCHT (agent_errored statt gate-FAIL).
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent_errored', featureId: 'f1' }));
    expect(raise).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'phase_gate_failed' }));
  });

  it('after_phase-FAIL blockiert den Auto-Progress; Phase bleibt awaiting_review', async () => {
    const runTrigger = vi.fn(async () => ({ ok: false, failedAgent: 'Plan-Quality', runs: [] }));
    const { orch, state, raise } = setup({
      running: true,
      automation: { autoProgressUntil: 'plan' }, // ohne Gate würde plan automatisch starten
      gate: { hasAgentsFor: (...a) => (a[2] as { kind: string }).kind === 'after_phase', runTrigger },
    });
    (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.set('f1', {
      phase: 'specify',
      executionId: 'e1',
      scrollbackStart: 0,
      transcriptOffsetStart: 0,
      transcriptPathStart: null,
      promptText: '',
      promptConfirmed: true, // Phasenprompt war zugestellt — der Stop gehört zu dieser Phase
    });
    const session = {
      kind: 'feature',
      featureId: 'f1',
      projectId: 'p1',
      id: 's1',
      scrollback: '',
      cwd: '/nonexistent',
    } as unknown as LiveSession;

    await (orch as unknown as { handleTurnCompleted: (s: LiveSession) => Promise<void> }).handleTurnCompleted(
      session,
    );

    expect(runTrigger).toHaveBeenCalledTimes(1);
    expect(state.phases.specify.status).toBe('awaiting_review'); // kein Auto-Approve (Human-Override möglich)
    expect(state.phases.plan.status).toBe('idle');
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'phase_gate_failed', featureId: 'f1' }));
  });

  it('approve leitet Auto-Progress mit before-Gate um (Effekt-Unterdrückung + Deferral)', async () => {
    const runTrigger = vi.fn(() => new Promise(() => {}));
    const { orch, state } = setup({
      automation: { autoProgressUntil: 'plan' },
      gate: {
        hasAgentsFor: (...a) => {
          const t = a[2] as { kind: string; phase?: string };
          return t.kind === 'before_phase' && t.phase === 'plan';
        },
        runTrigger,
      },
    });
    // specify wartet auf Review → approve würde plan normalerweise sofort starten.
    (state.phases.specify as { status: string }).status = 'awaiting_review';

    orch.approve('f1', 'specify');
    await tick();

    expect(state.phases.specify.status).toBe('approved');
    expect(state.phases.plan.status).toBe('idle'); // deferrt statt gestartet
    expect(runTrigger).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ kind: 'before_phase', phase: 'plan' }),
    );
  });
});

describe('Orchestrator — ensureSession-Guards (offene Sessions auf abgeschlossenen Features)', () => {
  it('verweigert eine neue Session für ein gemergtes Feature', async () => {
    const { orch } = setup({ feature: { integration: 'merged' } });
    await expect(orch.ensureSession('f1')).rejects.toThrow(/abgeschlossen/);
  });

  it('verweigert eine neue Session für ein archiviertes Feature', async () => {
    const { orch } = setup({ feature: { archivedAt: 123 } });
    await expect(orch.ensureSession('f1')).rejects.toThrow(/abgeschlossen/);
  });

  it('liefert die bestehende Live-Session eines gemergten Features weiter aus (kein Bruch offener Konsolen)', async () => {
    const { orch } = setup({ feature: { integration: 'merged' } });
    const existing = { id: 's-live', exited: false } as unknown as LiveSession;
    const deps = (orch as unknown as { deps: OrchestratorDeps }).deps;
    (deps.ptys as unknown as { forFeature: () => LiveSession }).forFeature = () => existing;

    await expect(orch.ensureSession('f1')).resolves.toBe(existing);
  });

  it('serialisiert parallele ensureSession-Aufrufe (keine Doppel-Spawns)', async () => {
    const { orch } = setup({ projectExists: false }); // Inner-Aufruf wirft → beide Promises teilen denselben Fehler
    const p1 = orch.ensureSession('f1').catch((e: Error) => e);
    const p2 = orch.ensureSession('f1').catch((e: Error) => e);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBeInstanceOf(Error);
    expect(r2).toBeInstanceOf(Error);
  });
});

/**
 * Quellenwahl beim Abschluss eines Laufs (Feature "token-und-kostenmessung...").
 * Der Kern: liegen Meldungen der CLI vor, gewinnen sie und die Transkript-Messung
 * läuft gar nicht erst — die Werte beider Quellen werden nie addiert (FR-016).
 */
describe('Orchestrator — Telemetrie schlägt Transkript', () => {
  function withTelemetry(events: unknown[]) {
    const finishWithUsage = vi.fn();
    const updateTelemetry = vi.fn();
    const telemetry = {
      eventsFor: () => events,
      forget: vi.fn(),
    };
    const deps = {
      features: { get: () => makeFeature(), savePhases: vi.fn(), setTasks: vi.fn() },
      projects: { get: () => ({ id: 'p1', path: '/p', defaultBranch: 'main', enabledPhases: [] }) },
      attention: { raise: vi.fn(), resolveFor: vi.fn(() => []), listOpen: () => [] },
      executions: { finishWithUsage, updateTelemetry, recordTranscriptEnd: vi.fn(), finish: vi.fn() },
      sessions: { end: vi.fn() },
      settings: {
        getAutomation: () => ({ autoProgressUntil: 'off', autoVerify: false, autoMode: true }),
        getOptimization: () => ({ contextStrategy: 'full', compression: 'off' }),
      },
      worktrees: {},
      ptys: { remove: vi.fn() },
      knowledge: { materializeForFeature: () => ({ preamble: '' }) },
      agentGate: { hasAgentsFor: () => false },
      dataDir: '/tmp',
      telemetry,
    } as unknown as OrchestratorDeps;

    const orch = new Orchestrator(deps);
    const session = {
      id: 'sess1',
      featureId: 'f1',
      projectId: 'p1',
      cwd: '/p',
      claudeSessionId: null,
      scrollback: '',
    } as unknown as LiveSession;
    const running = {
      phase: 'specify',
      executionId: 'e1',
      scrollbackStart: 0,
      transcriptOffsetStart: 0,
      transcriptPathStart: null,
      startedAt: 1_000,
      promptText: 'prompt',
    };
    return { orch, session, running, finishWithUsage };
  }

  function apiEvent(over: Record<string, unknown> = {}) {
    return {
      requestId: 'req_1',
      at: 2_000,
      sddSessionId: 'sess1',
      sddRunId: null,
      claudeSessionId: 'uuid',
      model: 'claude-opus-5',
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      costMicros: 500,
      origin: 'main',
      ...over,
    };
  }

  it('schreibt bei vorhandenen Meldungen die Herkunft telemetry — ohne Transkript-Messung', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([apiEvent()]);
    (orch as unknown as { finishWithMetering(s: unknown, r: unknown, c: number): void }).finishWithMetering(
      session,
      running,
      0,
    );

    expect(finishWithUsage).toHaveBeenCalledTimes(1);
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.tokensSource).toBe('telemetry');
    expect(usage.tokens).toBe(100);
    expect(usage.costMicros).toBe(500);
    expect(usage.model).toBe('claude-opus-5');
    // Endgültigkeitsfenster ist gesetzt (FR-012).
    expect(usage.telemetryFinalAt).toBeGreaterThan(Date.now());
  });

  it('zählt nur Meldungen im Zeitfenster des Laufs (US1 Szenario 1)', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([
      apiEvent({ requestId: 'frueher', at: 500, outputTokens: 999_999 }), // vor dem Laufstart
      apiEvent({ requestId: 'drin', at: 2_000 }),
    ]);
    (orch as unknown as { finishWithMetering(s: unknown, r: unknown, c: number): void }).finishWithMetering(
      session,
      running,
      0,
    );
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.outputTokens).toBe(20); // nur das Ereignis im Fenster
  });

  /**
   * Kern des Fixes vom 30.07.2026: die Messung wird fortgeschrieben, nicht neu summiert.
   * Vorher summierte jeder Nachtrag den Puffer von Grund auf — und traf einen, den der
   * Kehraus inzwischen beschnitten hatte. Neun Läufe wurden so um Faktor 2,9–16,8 nach
   * unten geschrieben; einer verlor sogar seinen Preis, weil die Messung ganz auf das
   * Transkript zurückfiel.
   */
  describe('Telemetrie-Summe ist monoton', () => {
    /** Direkter Zugriff auf die Messung — der Nachtrag hängt sonst an Timern. */
    const messen = (orch: unknown, session: unknown, running: unknown, until: number) =>
      (
        orch as {
          meterFromTelemetry(s: unknown, r: unknown, u: number): Record<string, number | null> | null;
        }
      ).meterFromTelemetry(session, running, until);

    it('hält die Zahl, wenn der Puffer zwischen zwei Messungen geleert wird', () => {
      const events: unknown[] = [
        apiEvent({ requestId: 'a', at: 2_000 }),
        apiEvent({ requestId: 'b', at: 3_000 }),
      ];
      const { orch, session, running } = withTelemetry(events);

      const erst = messen(orch, session, running, 4_000);
      expect(erst?.tokens).toBe(200); // 2 × (10+20+30+40)

      // Der Kehraus hat zugeschlagen — der Puffer ist leer.
      events.length = 0;
      const zweit = messen(orch, session, running, 4_000);

      expect(zweit?.tokens).toBe(200); // unverändert, NICHT 0 und nicht null
      expect(zweit?.costMicros).toBe(1_000);
    });

    it('zählt neue Meldungen dazu, jede aber nur einmal (FR-006)', () => {
      const events: unknown[] = [apiEvent({ requestId: 'a', at: 2_000 })];
      const { orch, session, running } = withTelemetry(events);

      expect(messen(orch, session, running, 9_000)?.tokens).toBe(100);

      // Dieselbe Meldung erneut im Puffer plus eine echte neue.
      events.push(apiEvent({ requestId: 'a', at: 2_000 }), apiEvent({ requestId: 'c', at: 5_000 }));

      expect(messen(orch, session, running, 9_000)?.tokens).toBe(200); // 100 + 100, 'a' nicht doppelt
    });

    it('trennt die Summen zweier Läufe', () => {
      const events: unknown[] = [apiEvent({ requestId: 'a', at: 2_000 })];
      const { orch, session, running } = withTelemetry(events);
      const zweiterLauf = { ...running, executionId: 'e2' };

      expect(messen(orch, session, running, 9_000)?.tokens).toBe(100);
      expect(messen(orch, session, zweiterLauf, 9_000)?.tokens).toBe(100); // eigener Akkumulator
    });
  });

  it('weist ohne Subagenten keinen Subagenten-Anteil aus (FR-010, kein Null-Platzhalter)', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([apiEvent({ origin: 'main' })]);
    (orch as unknown as { finishWithMetering(s: unknown, r: unknown, c: number): void }).finishWithMetering(
      session,
      running,
      0,
    );
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.subagentTokens).toBeNull();
  });

  it('rechnet Subagenten mit und weist ihren Anteil getrennt aus (FR-009/FR-010)', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([
      apiEvent({ requestId: 'haupt', origin: 'main', outputTokens: 100 }),
      apiEvent({ requestId: 'sub', origin: 'subagent', outputTokens: 300 }),
    ]);
    (orch as unknown as { finishWithMetering(s: unknown, r: unknown, c: number): void }).finishWithMetering(
      session,
      running,
      0,
    );
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.outputTokens).toBe(400);
    expect(usage.subagentTokens).toBe(380); // 10+300+30+40
  });

  it('fällt ohne Meldungen auf die bestehende Messung zurück (FR-015)', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([]);
    (orch as unknown as { finishWithMetering(s: unknown, r: unknown, c: number): void }).finishWithMetering(
      session,
      running,
      0,
    );
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.tokensSource).not.toBe('telemetry');
    expect(['transcript', 'parsed', 'estimated']).toContain(usage.tokensSource);
  });

  it('verwirft Meldungen einer fremden Session — sie tragen eine andere Marke (FR-003)', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([]);
    (orch as unknown as { finishWithMetering(s: unknown, r: unknown, c: number): void }).finishWithMetering(
      session,
      running,
      0,
    );
    // eventsFor('sess1') liefert leer → Rückfall, kein fremder Verbrauch am Lauf.
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.tokensSource).not.toBe('telemetry');
  });
});

// ---------- Dokument-Verweis im Phasenauftrag (US2) ----------

/**
 * Der Verweis auf hinterlegte Dokumente muss in JEDEM Phasenauftrag stehen —
 * über alle drei Startwege, auch nach einem Kontext-Reset (FR-007/FR-008,
 * SC-003). Ohne Dokumente muss der Prompt zeichengleich mit dem bisherigen
 * bleiben (FR-017, SC-006).
 */
describe('Orchestrator — Dokument-Verweis im Phasenauftrag', () => {
  const DOCS: FeatureDocument[] = [
    {
      name: 'Anforderungen 2026.pdf',
      storedName: 'Anforderungen 2026.pdf',
      relPath: 'specs/feat/docs/Anforderungen 2026.pdf',
      bytes: 1258291,
      mimeType: 'application/pdf',
      uploadedAt: 1785312000000,
    },
    {
      name: 'schema.sql',
      storedName: 'schema.sql',
      relPath: 'specs/feat/docs/schema.sql',
      bytes: 4403,
      mimeType: 'application/sql',
      uploadedAt: 1785312000000,
    },
  ];

  const BLOCK_HEAD = '[Dokumente] Zu diesem Feature wurden 2 Dokumente hinterlegt (Ablage: specs/feat/docs/):';
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const lastPrompt = (sendPrompt: { mock: { calls: unknown[][] } }) =>
    String(sendPrompt.mock.calls.at(-1)?.[1] ?? '');

  /** Phase erneut startbar machen (Maschine + Buchführung), um den 2. Start zu prüfen. */
  function restartable(
    orch: unknown,
    savePhases: (id: string, phases: Record<string, { status: string }>) => void,
    state: { phases: Record<string, { status: string }> },
  ): void {
    (orch as { runningPhases: Map<string, unknown> }).runningPhases.clear();
    savePhases('f1', { ...state.phases, plan: { ...state.phases.plan, status: 'idle' } });
  }

  /** Worktree mit vorhandener spec.md — nur so lässt der Guard einen Reset zu. */
  const worktrees: string[] = [];
  function worktreeWithSpec(): string {
    const root = mkdtempSync(join(tmpdir(), 'sdd-orch-docs-'));
    mkdirSync(join(root, 'specs', 'feat'), { recursive: true });
    writeFileSync(join(root, 'specs', 'feat', 'spec.md'), '# spec\n');
    worktrees.push(root);
    return root;
  }

  afterAll(() => {
    for (const dir of worktrees) rmSync(dir, { recursive: true, force: true });
  });

  it('hängt den Verweis an den regulären Phasenstart (FR-007)', async () => {
    const { orch, sendPrompt } = setup({ withSession: true, documents: DOCS });

    await orch.startPhaseRun('f1', 'specify', 'Kundendaten übernehmen');

    const prompt = lastPrompt(sendPrompt);
    expect(prompt).toContain(BLOCK_HEAD);
    expect(prompt).toContain('- `schema.sql` → specs/feat/docs/schema.sql (4.3 KB)');
    expect(prompt).toContain('Verwende dieses Material als Ausgangsbasis der Spezifikation.');
  });

  it('hängt den Verweis auch an den Start nach einem bestandenen Gate (FR-007)', async () => {
    const runTrigger = vi.fn(async () => ({ ok: true, runs: [] }));
    const { orch, sendPrompt } = setup({
      withSession: true,
      documents: DOCS,
      gate: { hasAgentsFor: (...a) => (a[2] as { kind: string }).kind === 'before_phase', runTrigger },
    });

    // Erster Aufruf deferrt auf das Gate; der PASS startet die Phase intern.
    expect(await orch.startPhaseRun('f1', 'specify')).toEqual({ gateRunning: true });
    await tick();

    expect(runTrigger).toHaveBeenCalledTimes(1);
    expect(lastPrompt(sendPrompt)).toContain(BLOCK_HEAD);
  });

  it('hängt den Verweis auch an die Auto-Progress-Kette (SC-003)', async () => {
    const { orch, sendPrompt } = setup({
      withSession: true,
      documents: DOCS,
      phaseStatus: { specify: 'awaiting_review' },
      automation: { autoProgressUntil: 'plan' },
    });

    // approve(specify) löst den Effekt start_agent für 'plan' aus.
    orch.approve('f1', 'specify');
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalled());

    const prompt = lastPrompt(sendPrompt);
    expect(prompt).toContain(BLOCK_HEAD);
    expect(prompt).toContain('Berücksichtige dieses Material bei diesem Schritt');
  });

  it.each(['compact', 'fresh'] as const)(
    'sendet den Verweis auch im Schritt direkt nach dem Reset (%s) — kein Dedupe (FR-008)',
    async (contextStrategy) => {
      const root = worktreeWithSpec();
      const { orch, sendPrompt } = setup({
        withSession: true,
        documents: DOCS,
        feature: { worktreePath: root },
        optimization: { contextStrategy },
        phaseStatus: { specify: 'approved' },
      });

      await orch.startPhaseRun('f1', 'plan');

      // Reset geht als eigener Prompt VOR dem Phasenprompt raus.
      expect(sendPrompt.mock.calls.map((c) => c[1])).toContain(contextStrategy === 'compact' ? '/compact' : '/clear');
      expect(lastPrompt(sendPrompt)).toContain(BLOCK_HEAD);
    },
  );

  it('sendet den Verweis bei jedem Start erneut, statt ihn zu deduplizieren (FR-008)', async () => {
    const root = worktreeWithSpec();
    const { orch, sendPrompt, savePhases, state } = setup({
      withSession: true,
      documents: DOCS,
      feature: { worktreePath: root },
      phaseStatus: { specify: 'approved' },
    });

    await orch.startPhaseRun('f1', 'plan');
    const ersterPrompt = lastPrompt(sendPrompt);
    restartable(orch, savePhases, state);
    await orch.startPhaseRun('f1', 'plan');
    const zweiterPrompt = lastPrompt(sendPrompt);

    expect(ersterPrompt).toContain(BLOCK_HEAD);
    expect(zweiterPrompt).toContain(BLOCK_HEAD); // beim zweiten Mal genauso
  });

  // SC-006: die einzige Absicherung dagegen, dass der dokumentlose Auftrag wächst.
  it('lässt den Prompt ohne Dokumente zeichengleich mit dem bisherigen (FR-017, SC-006)', async () => {
    const { orch, sendPrompt } = setup({ withSession: true, documents: [] });

    await orch.startPhaseRun('f1', 'specify', 'Beschreibungstext');

    expect(lastPrompt(sendPrompt)).toBe(
      '/speckit-specify specs/feat Beschreibungstext' +
        '\n\n[Hinweis] `spec.md` liegt im Spec-Ordner bereits als Vorlage vor. ' +
        'Lies sie, bevor du sie schreibst — sonst schlägt der erste Schreibvorgang fehl.',
    );
  });

  it('startet die Phase auch bei defektem Manifest — ohne Block statt mit Fehler', async () => {
    const { orch, sendPrompt, state } = setup({ withSession: true, documents: 'wirft' });

    await expect(orch.startPhaseRun('f1', 'specify', 'Text')).resolves.toEqual({ gateRunning: false });

    expect(state.phases.specify.status).toBe('running');
    expect(lastPrompt(sendPrompt)).not.toContain('[Dokumente]');
  });

  it('liest die Dokumente bei jedem Start frisch aus dem Manifest (R5)', async () => {
    const root = worktreeWithSpec();
    const { orch, listDocuments, savePhases, state } = setup({
      withSession: true,
      documents: DOCS,
      feature: { worktreePath: root },
      phaseStatus: { specify: 'approved' },
    });

    await orch.startPhaseRun('f1', 'plan');
    restartable(orch, savePhases, state);
    await orch.startPhaseRun('f1', 'plan');

    expect(listDocuments).toHaveBeenCalledTimes(2); // nicht aus dem Prozessspeicher
    expect(listDocuments).toHaveBeenCalledWith('f1');
  });
});

/**
 * Befund A12 (30.07.2026): eine implement-Phase galt nach 30 Sekunden als fertig und
 * freigegeben, während der Agent noch 37 Minuten weiterarbeitete — ungezählt und ohne
 * jeden Hinweis in der Datenbank. Sichtbar war das allein an der Ausgabe der Session.
 */
describe('Orchestrator — Arbeit ohne offenen Lauf wird gemeldet', () => {
  const JETZT = 10_000_000;

  function setupZuordnung(session: Partial<Record<string, unknown>>) {
    const raise = vi.fn((item: Record<string, unknown>) => ({ id: 'a1', ...item }));
    const live = {
      id: 's1',
      projectId: 'p1',
      featureId: 'f1',
      kind: 'feature',
      exited: false,
      startedAt: JETZT - 10 * 60_000,
      lastOutputAt: JETZT - 5_000,
      ...session,
    };
    const deps = {
      features: { get: () => makeFeature(), savePhases: vi.fn() },
      projects: { get: () => ({ id: 'p1', path: '/p', defaultBranch: 'main', enabledPhases: [] }) },
      attention: { raise, resolveFor: vi.fn(() => []), listOpen: () => [] },
      executions: { start: vi.fn(), finishWithUsage: vi.fn(), updateTelemetry: vi.fn() },
      sessions: { end: vi.fn() },
      settings: {
        getAutomation: () => ({ autoProgressUntil: 'off', autoVerify: false, autoMode: true }),
        getOptimization: () => ({ contextStrategy: 'full', compression: 'off' }),
      },
      ptys: { list: () => [live], forFeature: () => live },
      worktrees: {},
      knowledge: { materializeForFeature: () => ({ preamble: '' }) },
      agentGate: { hasAgentsFor: () => false },
      dataDir: '/tmp',
    } as unknown as OrchestratorDeps;
    return { orch: new Orchestrator(deps), raise };
  }

  it('meldet eine schreibende Session, für die kein Schritt offen ist', () => {
    const { orch, raise } = setupZuordnung({});
    orch.checkWorkWithoutRun(JETZT);
    expect(raise).toHaveBeenCalledTimes(1);
    expect((raise.mock.calls[0]![0] as { message: string }).message).toContain('kein Schritt ist offen');
  });

  it('meldet dieselbe Session nur einmal', () => {
    const { orch, raise } = setupZuordnung({});
    orch.checkWorkWithoutRun(JETZT);
    orch.checkWorkWithoutRun(JETZT + 60_000);
    expect(raise).toHaveBeenCalledTimes(1);
  });

  it('schweigt, wenn die Ausgabe längst ruht (Agent ist fertig)', () => {
    const { orch, raise } = setupZuordnung({ lastOutputAt: JETZT - 10 * 60_000 });
    orch.checkWorkWithoutRun(JETZT);
    expect(raise).not.toHaveBeenCalled();
  });

  it('schweigt in der Anlaufzeit einer frischen Session', () => {
    const { orch, raise } = setupZuordnung({ startedAt: JETZT - 30_000 });
    orch.checkWorkWithoutRun(JETZT);
    expect(raise).not.toHaveBeenCalled();
  });

  it('schweigt, wenn nie Ausgabe kam', () => {
    const { orch, raise } = setupZuordnung({ lastOutputAt: 0 });
    orch.checkWorkWithoutRun(JETZT);
    expect(raise).not.toHaveBeenCalled();
  });

  it('schweigt bei einer beendeten Session', () => {
    const { orch, raise } = setupZuordnung({ exited: true });
    orch.checkWorkWithoutRun(JETZT);
    expect(raise).not.toHaveBeenCalled();
  });

  it('schweigt bei Chat-Sessions — die haben keine Phasen', () => {
    const { orch, raise } = setupZuordnung({ kind: 'chat_work' });
    orch.checkWorkWithoutRun(JETZT);
    expect(raise).not.toHaveBeenCalled();
  });
});

/**
 * Feature "eigene-schritte-an-den-lebenszyklus-haengen": die Worktree-Auslöser.
 * Eigener Aufbau, weil `createFeature` mehr Repo-Oberfläche braucht als die
 * Phasen-Tests — insbesondere `create`/`hardDelete`/`setWorktree`.
 */
describe('Orchestrator — Worktree-Auslöser (Lebenszyklus-Schritte)', () => {
  function setupCreate(
    opts: {
      worktreeCreate?: (calls: string[]) => Promise<string>;
      stepOutcome?: (trigger: { kind: string }) => { ok: boolean };
      /** Gelten Schritte an einem Phasen-Auslöser? Vorgabe: nein (der Fast-Path). */
      hasSteps?: (trigger: { kind: string }) => boolean;
      /**
       * Vorgabe true: `ptys.forFeature` liefert sofort eine Session, `ensureSession`
       * steigt früh aus. Mit `false` läuft der ECHTE Weg einer Neuanlage — erst der
       * Spawn erzeugt die Session. Nur so wird sichtbar, was `ensureSession` selbst tut.
       */
      existingSession?: boolean;
    } = {},
  ) {
    const calls: string[] = [];
    const stored = new Map<string, Feature>();
    const hardDelete = vi.fn((id: string) => {
      calls.push('feature:hardDelete');
      stored.delete(id);
      return { executionIds: [] };
    });
    const sendPrompt = vi.fn(() => calls.push('phase:prompt'));
    let spawnedSession = opts.existingSession ?? true;
    const session = {
      id: 's1',
      kind: 'feature',
      featureId: 'f1',
      projectId: 'p1',
      scrollback: '',
      claudeSessionId: null,
      cwd: '/wt/feat',
      pty: { pid: 4242 },
    } as unknown as LiveSession;

    const stepsRunTrigger = vi.fn(async (_f: Feature, _p: unknown, trigger: { kind: string }) => {
      calls.push(`steps:${trigger.kind}`);
      return { ok: opts.stepOutcome?.(trigger).ok ?? true, failed: null, ran: [] };
    });

    const deps = {
      features: {
        get: (id: string) => stored.get(id),
        getByName: () => null,
        create: (f: Omit<Feature, 'id' | 'createdAt' | 'archivedAt' | 'reviewRejectedAt'>) => {
          calls.push('feature:create');
          const feature = { ...f, id: 'f1', createdAt: 0, archivedAt: null, reviewRejectedAt: null } as Feature;
          stored.set('f1', feature);
          return feature;
        },
        setWorktree: vi.fn((id: string, wt: string | null) => {
          calls.push('feature:setWorktree');
          const f = stored.get(id);
          if (f) stored.set(id, { ...f, worktreePath: wt });
        }),
        hardDelete,
        savePhases: vi.fn((id: string, phases: Feature['phases']) => {
          const f = stored.get(id);
          if (f) stored.set(id, { ...f, phases });
        }),
        setTasks: vi.fn(),
      },
      projects: {
        get: () => ({
          id: 'p1',
          name: 'proj',
          path: '/p',
          defaultBranch: 'main',
          enabledPhases: ['specify', 'plan'],
        }),
      },
      // `resolveFor` liefert seit F5 die IDs der aufgelösten Meldungen (vorher `void`) — das
      // Double muss ein Array zurückgeben, sonst bricht `emitAttentionResolved` mit
      // „ids is not iterable" (aufgefallen bei der Zusammenführung am 30.07.2026).
      attention: { raise: vi.fn((a: { kind: string }) => ({ id: 'a1', ...a })), resolveFor: vi.fn(() => []), listOpen: () => [] },
      executions: { start: vi.fn(() => 'e1'), finish: vi.fn(), finishWithUsage: vi.fn(), reapOrphans: () => 0 },
      sessions: { latestForFeature: () => undefined, create: vi.fn(), listOpen: () => [] },
      settings: {
        getAutomation: () => ({
          autoProgressUntil: 'off',
          autoVerify: false,
          autoReviewAgents: false,
          autoMerge: false,
          autoMode: true,
        }),
        getOptimization: () => ({ contextStrategy: 'full', compression: 'off' }),
      },
      worktrees: {
        pathFor: () => '/wt/feat',
        create:
          opts.worktreeCreate ??
          (async () => {
            calls.push('worktree:create');
            return '/wt/feat';
          }),
        remove: vi.fn(async () => {}),
      },
      ptys: {
        forFeature: () => (spawnedSession ? session : undefined),
        spawn: vi.fn(async () => {
          calls.push('session:spawn');
          spawnedSession = true;
          return session;
        }),
        sendPrompt,
        list: () => [],
      },
      knowledge: { materializeForFeature: () => ({ preamble: '' }) },
      featureDocuments: { listDocuments: () => [] },
      agentGate: { hasAgentsFor: () => false, runTrigger: vi.fn(), runAgent: vi.fn() },
      lifecycleSteps: {
        // Die Worktree-Auslöser rufen runTrigger direkt (der Service hat seinen
        // eigenen Fast-Path); hasStepsFor entscheidet nur über die Phasen-Deferral.
        hasStepsFor: (...a: unknown[]) => opts.hasSteps?.(a[2] as { kind: string }) ?? false,
        runTrigger: stepsRunTrigger,
      },
      dataDir: '/tmp',
    } as unknown as OrchestratorDeps;

    return { orch: new Orchestrator(deps), calls, stored, hardDelete, stepsRunTrigger, deps };
  }

  it('führt die Worktree-Auslöser in der richtigen Reihenfolge aus: vor Anlage → Anlage → nach Anlage → Phase', async () => {
    const { orch, calls } = setupCreate();

    await orch.createFeature('p1', 'demo eins', 'beschreibung');

    expect(calls).toEqual([
      // Der Datensatz entsteht ZUERST — sonst wäre der before-Lauf keinem Feature zuordenbar.
      'feature:create',
      'steps:before_worktree_create',
      'worktree:create',
      'feature:setWorktree',
      'steps:after_worktree_create',
      // Erst danach startet die erste Phase.
      'phase:prompt',
    ]);
  });

  it('der Schritt läuft im neuen Worktree — der Kontext trägt den Worktree-Pfad', async () => {
    const { orch, stepsRunTrigger } = setupCreate();

    await orch.createFeature('p1', 'demo eins');

    // Vor der Anlage: künftiger Pfad wird explizit mitgegeben (US3 Szenario 5).
    expect(stepsRunTrigger.mock.calls[0]![3]).toEqual({ worktreePath: '/wt/feat' });
    // Nach der Anlage: der Pfad steht am Feature.
    expect((stepsRunTrigger.mock.calls[1]![0] as Feature).worktreePath).toBe('/wt/feat');
    expect(stepsRunTrigger.mock.calls[1]![3]).toBeUndefined();
  });

  /** FR-027: ohne konfigurierte Schritte bleibt der Weg exakt wie bisher. */
  it('ohne konfigurierte Schritte entsteht keine zusätzliche Execution', async () => {
    const { orch, deps, calls } = setupCreate();

    await orch.createFeature('p1', 'demo eins', 'los');

    // Der Service entscheidet selbst über den Fast-Path; hier zählt: kein Lauf für einen Schritt.
    expect((deps.executions.start as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[0] as { kind: string }).kind === 'lifecycle_step',
    )).toHaveLength(0);
    expect(calls).toContain('phase:prompt');
  });

  it('bei einem Git-Fehler bleibt kein Feature-Datensatz zurück (Rollback)', async () => {
    const { orch, calls, stored, hardDelete } = setupCreate({
      worktreeCreate: async () => {
        calls.push('worktree:create-fehler');
        throw new Error('fatal: cannot lock ref');
      },
    });

    await expect(orch.createFeature('p1', 'demo eins')).rejects.toThrow(/cannot lock ref/);

    expect(hardDelete).toHaveBeenCalledWith('f1');
    expect(stored.size).toBe(0);
    expect(calls).not.toContain('phase:prompt');
  });

  it('blockierender Fehlschlag vor der Anlage verhindert git worktree add, Session und erste Phase', async () => {
    const { orch, calls, stored } = setupCreate({
      stepOutcome: (t) => ({ ok: t.kind !== 'before_worktree_create' }),
    });

    const feature = await orch.createFeature('p1', 'demo eins', 'los');

    expect(calls).toEqual(['feature:create', 'steps:before_worktree_create']);
    expect(calls).not.toContain('worktree:create');
    expect(calls).not.toContain('phase:prompt');
    // Das Feature bleibt stehen — ohne Worktree, ohne laufende Phase.
    expect(stored.get('f1')).toBeDefined();
    expect(feature.worktreePath).toBeNull();
    expect(feature.phases.specify.status).toBe('idle');
  });

  it('blockierender Fehlschlag nach der Anlage verhindert Session und erste Phase; der Worktree bleibt', async () => {
    const { orch, calls, stored } = setupCreate({
      stepOutcome: (t) => ({ ok: t.kind !== 'after_worktree_create' }),
    });

    const feature = await orch.createFeature('p1', 'demo eins', 'los');

    expect(calls).toContain('worktree:create');
    expect(calls).not.toContain('phase:prompt');
    expect(stored.get('f1')!.worktreePath).toBe('/wt/feat');
    expect(feature.phases.specify.status).toBe('idle');
  });

  it('beratender Fehlschlag verhindert nichts (der Service meldet ok)', async () => {
    const { orch, calls } = setupCreate({ stepOutcome: () => ({ ok: true }) });

    await orch.createFeature('p1', 'demo eins', 'los');

    expect(calls).toContain('phase:prompt');
  });

  /**
   * Regression (30.07.2026, in der eigenen Test-Instanz aufgefallen): bei einer
   * Neuanlage gibt es noch KEINE Session. `createFeature` bereitete den Worktree vor
   * und `ensureSession` tat es unmittelbar danach ein zweites Mal — jeder
   * Worktree-Schritt lief doppelt (zwei Läufe je Schritt, `pnpm install` zweimal).
   * Die übrigen Tests sahen es nicht, weil ihr `ptys.forFeature` sofort eine Session
   * liefert und `ensureSession` deshalb früh aussteigt.
   */
  it('feuert die Worktree-Auslöser bei der Anlage genau EINMAL — auch ohne bestehende Session', async () => {
    const { orch, calls, stepsRunTrigger } = setupCreate({ existingSession: false });

    await orch.createFeature('p1', 'demo eins', 'los');

    expect(calls.filter((c) => c === 'steps:before_worktree_create')).toHaveLength(1);
    expect(calls.filter((c) => c === 'steps:after_worktree_create')).toHaveLength(1);
    expect(stepsRunTrigger).toHaveBeenCalledTimes(2);
    // Der Worktree entsteht ebenfalls nur einmal, die Session wird trotzdem gespawnt.
    expect(calls.filter((c) => c === 'worktree:create')).toHaveLength(1);
    expect(calls).toContain('session:spawn');
    expect(calls).toContain('phase:prompt');
  });

  /**
   * Die Gegenprobe zum Flag: jeder ANDERE Weg zur Session wiederholt die
   * Worktree-Auslöser — das ist der Wiederanlauf nach einem blockierenden
   * Fehlschlag (FR-025).
   */
  it('ein erneutes Anstoßen nach blockierendem Fehlschlag wiederholt die Worktree-Auslöser', async () => {
    let blockiert = true;
    const { orch, calls, stepsRunTrigger } = setupCreate({
      existingSession: false,
      stepOutcome: (t) => ({ ok: !(blockiert && t.kind === 'after_worktree_create') }),
    });

    await orch.createFeature('p1', 'demo eins', 'los');
    // Blockiert: keine Session, keine Phase — das Feature steht.
    expect(calls).not.toContain('session:spawn');
    expect(calls).not.toContain('phase:prompt');

    // Ursache behoben, Session erneut anstoßen (POST /api/features/:id/session).
    blockiert = false;
    stepsRunTrigger.mockClear();
    calls.length = 0;
    await orch.ensureSession('f1');

    expect(calls.filter((c) => c === 'steps:before_worktree_create')).toHaveLength(1);
    expect(calls.filter((c) => c === 'steps:after_worktree_create')).toHaveLength(1);
    expect(calls).toContain('session:spawn');
  });
});

describe('Orchestrator — Phasen-Auslöser (Lebenszyklus-Schritte)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it('deferrt den Phasenstart auch ohne Agents, wenn Schritte gelten', async () => {
    const stepsRunTrigger = vi.fn(() => new Promise(() => {})); // hängt bewusst
    const { orch, state } = setup({
      steps: { hasStepsFor: (...a) => (a[2] as { kind: string }).kind === 'before_phase', runTrigger: stepsRunTrigger },
    });

    const result = await orch.startPhaseRun('f1', 'specify');

    expect(result).toEqual({ gateRunning: true });
    expect(state.phases.specify.status).toBe('idle');
    await tick();
    expect(stepsRunTrigger).toHaveBeenCalledTimes(1);
  });

  it('Schritte laufen VOR dem Agenten-Gate (E8)', async () => {
    const order: string[] = [];
    const stepsRunTrigger = vi.fn(async (_f: unknown, _p: unknown, t: { kind: string }) => {
      // Der nachgeholte Start läuft über ensureSession → prepareWorktree; hier sind
      // nur die Phasen-Auslöser interessant.
      if (t.kind === 'before_phase') order.push('steps');
      return { ok: true, failed: null, ran: [] };
    });
    const runTrigger = vi.fn(async () => {
      order.push('gate');
      return { ok: true, failedAgent: null, runs: [] };
    });
    const { orch } = setup({
      gate: { hasAgentsFor: (...a) => (a[2] as { kind: string }).kind === 'before_phase', runTrigger },
      steps: { hasStepsFor: (...a) => (a[2] as { kind: string }).kind === 'before_phase', runTrigger: stepsRunTrigger },
    });

    await orch.startPhaseRun('f1', 'specify');
    await tick();

    expect(order).toEqual(['steps', 'gate']);
  });

  it('blockierender Fehlschlag an before_phase hält die Phase auf idle — und das Gate läuft nicht', async () => {
    const runTrigger = vi.fn();
    const stepsRunTrigger = vi.fn(async () => ({ ok: false, failed: null, ran: [] }));
    const { orch, state, raise } = setup({
      gate: { hasAgentsFor: (...a) => (a[2] as { kind: string }).kind === 'before_phase', runTrigger },
      steps: { hasStepsFor: (...a) => (a[2] as { kind: string }).kind === 'before_phase', runTrigger: stepsRunTrigger },
    });

    await orch.startPhaseRun('f1', 'specify');
    await tick();

    expect(state.phases.specify.status).toBe('idle');
    expect(runTrigger).not.toHaveBeenCalled();
    // Das Inbox-Item kommt vom Schritt-Service, nicht vom Orchestrator.
    expect(raise).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'phase_gate_failed' }));
  });

  it('blockierender Fehlschlag an after_phase verhindert Gate und Auto-Progress', async () => {
    const runTrigger = vi.fn();
    const stepsRunTrigger = vi.fn(async () => ({ ok: false, failed: null, ran: [] }));
    const { orch, state } = setup({
      running: true,
      automation: { autoProgressUntil: 'plan' }, // ohne Halt würde plan automatisch starten
      gate: { hasAgentsFor: (...a) => (a[2] as { kind: string }).kind === 'after_phase', runTrigger },
      steps: { hasStepsFor: (...a) => (a[2] as { kind: string }).kind === 'after_phase', runTrigger: stepsRunTrigger },
    });
    (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.set('f1', {
      phase: 'specify',
      executionId: 'e1',
      scrollbackStart: 0,
      transcriptOffsetStart: 0,
      transcriptPathStart: null,
      promptText: '',
      promptConfirmed: true,
    });
    const session = {
      kind: 'feature',
      featureId: 'f1',
      projectId: 'p1',
      id: 's1',
      scrollback: '',
      cwd: '/nonexistent',
    } as unknown as LiveSession;

    await (orch as unknown as { handleTurnCompleted: (s: LiveSession) => Promise<void> }).handleTurnCompleted(session);
    await tick();

    expect(stepsRunTrigger).toHaveBeenCalledTimes(1);
    expect(runTrigger).not.toHaveBeenCalled();
    expect(state.phases.specify.status).toBe('awaiting_review');
    expect(state.phases.plan.status).toBe('idle');
  });

  it('ohne Schritte am after_phase-Punkt bleibt der Weg unverändert (Fast-Path)', async () => {
    const stepsRunTrigger = vi.fn();
    const { orch, state } = setup({
      running: true,
      automation: { autoProgressUntil: 'off' },
      steps: { hasStepsFor: () => false, runTrigger: stepsRunTrigger },
    });
    (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.set('f1', {
      phase: 'specify',
      executionId: 'e1',
      scrollbackStart: 0,
      transcriptOffsetStart: 0,
      transcriptPathStart: null,
      promptText: '',
      promptConfirmed: true,
    });
    const session = {
      kind: 'feature',
      featureId: 'f1',
      projectId: 'p1',
      id: 's1',
      scrollback: '',
      cwd: '/nonexistent',
    } as unknown as LiveSession;

    await (orch as unknown as { handleTurnCompleted: (s: LiveSession) => Promise<void> }).handleTurnCompleted(session);

    expect(stepsRunTrigger).not.toHaveBeenCalled();
    expect(state.phases.specify.status).toBe('awaiting_review');
  });
});
