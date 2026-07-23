import { describe, expect, it, vi } from 'vitest';
import { initialPhases, type Feature } from '@sdd/shared';
import { Orchestrator, type OrchestratorDeps } from './orchestrator.js';
import type { LiveSession } from '../pty/sessionManager.js';

/**
 * Testet die Fehler-/Unterbrechungs-Pfade des Orchestrators (US2) mit
 * leichtgewichtigen Fakes statt echter DB/PTY: startPhaseRun-Rollback,
 * handleSubmitFailed und reapOnBoot.
 */

function makeFeature(phases = initialPhases(['specify', 'plan'])): Feature {
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
  } as unknown as Feature;
}

function setup(opts: { projectExists?: boolean; running?: boolean } = {}) {
  let phases = initialPhases(['specify', 'plan']);
  if (opts.running) phases = { ...phases, specify: { ...phases.specify, status: 'running' } };
  const state = { get phases() { return phases; } };
  const savePhases = vi.fn((_id: string, p: typeof phases) => {
    phases = p;
  });
  const raise = vi.fn((a: { kind: string }) => ({ id: 'a1', ...a }));
  const finish = vi.fn();
  const deps = {
    features: {
      get: () => makeFeature(phases),
      savePhases,
      listAll: () => [makeFeature(phases)],
      setTasks: vi.fn(),
      setWorktree: vi.fn(),
    },
    projects: {
      get: () =>
        opts.projectExists === false
          ? undefined
          : { id: 'p1', name: 'proj', path: '/p', defaultBranch: 'main', enabledPhases: ['specify', 'plan'] },
    },
    attention: { raise, resolveFor: vi.fn() },
    executions: { finish, reapOrphans: () => 0, start: vi.fn(), finishWithUsage: vi.fn() },
    sessions: { listOpen: () => [], end: vi.fn(), latestForFeature: () => undefined, create: vi.fn() },
    settings: {},
    worktrees: {},
    ptys: { forFeature: () => undefined, spawn: vi.fn(), remove: vi.fn() },
    knowledge: {},
    dataDir: '/tmp',
  } as unknown as OrchestratorDeps;
  const orch = new Orchestrator(deps);
  return { orch, state, savePhases, raise, finish };
}

describe('Orchestrator — Fehler- und Unterbrechungs-Pfade', () => {
  it('startPhaseRun rollt bei fehlgeschlagenem Start zurück und meldet „braucht dich"', async () => {
    const { orch, state, raise } = setup({ projectExists: false }); // ensureSession → mustProject wirft

    await expect(orch.startPhaseRun('f1', 'specify')).rejects.toThrow();

    expect(state.phases.specify.status).toBe('idle'); // kein hängendes „läuft"
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent_errored', featureId: 'f1' }));
  });

  it('handleSubmitFailed rollt die laufende Phase zurück und meldet „braucht dich"', () => {
    const { orch, state, raise, finish } = setup({ running: true });
    (orch as unknown as { runningPhases: Map<string, unknown> }).runningPhases.set('f1', {
      phase: 'specify',
      executionId: 'e1',
      scrollbackStart: 0,
      transcriptOffsetStart: 0,
      promptText: '',
    });
    const session = { kind: 'feature', featureId: 'f1', projectId: 'p1', id: 's1' } as unknown as LiveSession;

    orch.handleSubmitFailed(session, '/speckit-implement');

    expect(state.phases.specify.status).toBe('idle');
    expect(finish).toHaveBeenCalledWith('e1', 1);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent_errored', featureId: 'f1' }));
  });

  it('reapOnBoot setzt verwaiste running-Phasen auf idle und meldet run_interrupted', () => {
    const { orch, state, raise } = setup({ running: true });

    orch.reapOnBoot();

    expect(state.phases.specify.status).toBe('idle');
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'run_interrupted', featureId: 'f1' }));
  });
});
