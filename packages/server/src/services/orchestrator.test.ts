import { describe, expect, it, vi } from 'vitest';
import { initialPhases, type Feature } from '@sdd/shared';
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
    automation?: Record<string, unknown>;
  } = {},
) {
  let phases = initialPhases(['specify', 'plan']);
  if (opts.running) phases = { ...phases, specify: { ...phases.specify, status: 'running' } };
  const state = { get phases() { return phases; } };
  const savePhases = vi.fn((_id: string, p: typeof phases) => {
    phases = p;
  });
  const raise = vi.fn((a: { kind: string }) => ({ id: 'a1', ...a }));
  const finish = vi.fn();
  const runTrigger = opts.gate?.runTrigger ?? vi.fn();
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
          : { id: 'p1', name: 'proj', path: '/p', defaultBranch: 'main', enabledPhases: ['specify', 'plan'] },
    },
    attention: { raise, resolveFor: vi.fn(() => []), listOpen: () => [], resolve: vi.fn() },
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
      getOptimization: () => ({ contextStrategy: 'full', compression: 'off' }),
    },
    worktrees: {},
    ptys: { forFeature: () => undefined, spawn: vi.fn(), remove: vi.fn(), sendPrompt: vi.fn() },
    knowledge: { materializeForFeature: () => ({ preamble: '' }) },
    agentGate: {
      hasAgentsFor: opts.gate?.hasAgentsFor ?? (() => false),
      runTrigger,
      runAgent: vi.fn(),
    },
    dataDir: '/tmp',
  } as unknown as OrchestratorDeps;
  const orch = new Orchestrator(deps);
  return { orch, state, savePhases, raise, finish, runTrigger };
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
