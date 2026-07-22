import { describe, expect, it } from 'vitest';
import {
  approvePhase,
  discardPhase,
  finishPhase,
  initialPhases,
  nextPhase,
  reapOrphanedRunning,
  reconcileWithDisk,
  startPhase,
} from './phaseMachine.js';
import { LEVEL2_DEFAULTS, LEVEL3_DEFAULTS, type FeaturePhase } from './types.js';

const ENABLED: FeaturePhase[] = ['specify', 'plan', 'tasks', 'implement'];

describe('phaseMachine', () => {
  it('startet nur bei approvten Vorphasen', () => {
    const phases = initialPhases(ENABLED);
    expect(() => startPhase(phases, 'plan', 1)).toThrow(/specify/);
    const t = startPhase(phases, 'specify', 1);
    expect(t.phases.specify.status).toBe('running');
    expect(t.effects).toEqual([{ kind: 'start_agent', phase: 'specify' }]);
  });

  it('überspringt deaktivierte Phasen in der Reihenfolge', () => {
    const phases = initialPhases(ENABLED);
    expect(nextPhase(phases, 'specify')).toBe('plan'); // clarify nicht aktiviert
  });

  it('finish mit Exit 0 → awaiting_review, sonst idle', () => {
    let { phases } = startPhase(initialPhases(ENABLED), 'specify', 1);
    const ok = finishPhase(phases, 'specify', 0, 2);
    expect(ok.phases.specify.status).toBe('awaiting_review');
    expect(ok.effects).toEqual([{ kind: 'phase_awaiting_review', phase: 'specify' }]);

    ({ phases } = startPhase(initialPhases(ENABLED), 'specify', 1));
    const fail = finishPhase(phases, 'specify', 3, 2);
    expect(fail.phases.specify.status).toBe('idle');
    expect(fail.phases.specify.exitCode).toBe(3);
    expect(fail.effects).toEqual([]);
  });

  it('approve ohne Auto-Progress startet nichts (Level 2)', () => {
    let { phases } = startPhase(initialPhases(ENABLED), 'specify', 1);
    ({ phases } = finishPhase(phases, 'specify', 0, 2));
    const t = approvePhase(phases, 'specify', LEVEL2_DEFAULTS, 3);
    expect(t.phases.specify.status).toBe('approved');
    expect(t.phases.plan.status).toBe('idle');
    expect(t.effects).toEqual([]);
  });

  it('approve mit Auto-Progress startet die Folgephase (Level 3)', () => {
    let { phases } = startPhase(initialPhases(ENABLED), 'specify', 1);
    ({ phases } = finishPhase(phases, 'specify', 0, 2));
    const t = approvePhase(phases, 'specify', LEVEL3_DEFAULTS, 3);
    expect(t.phases.plan.status).toBe('running');
    expect(t.effects).toEqual([{ kind: 'start_agent', phase: 'plan' }]);
  });

  it('autoProgressUntil begrenzt die Auto-Kette', () => {
    const auto = { ...LEVEL3_DEFAULTS, autoProgressUntil: 'plan' as const };
    let { phases } = startPhase(initialPhases(ENABLED), 'specify', 1);
    ({ phases } = finishPhase(phases, 'specify', 0, 2));
    ({ phases } = approvePhase(phases, 'specify', auto, 3)); // auto-startet plan
    expect(phases.plan.status).toBe('running');
    ({ phases } = finishPhase(phases, 'plan', 0, 4));
    const t = approvePhase(phases, 'plan', auto, 5);
    expect(t.phases.tasks.status).toBe('idle'); // tasks > plan → kein Auto-Start
    expect(t.effects).toEqual([]);
  });

  it('letzte Phase approved + autoVerify → start_integration', () => {
    let phases = initialPhases(ENABLED);
    for (const p of ENABLED) {
      ({ phases } = startPhase(phases, p, 1));
      ({ phases } = finishPhase(phases, p, 0, 2));
      if (p !== 'implement') ({ phases } = approvePhase(phases, p, LEVEL2_DEFAULTS, 3));
    }
    const t = approvePhase(phases, 'implement', { ...LEVEL2_DEFAULTS, autoVerify: true }, 4);
    expect(t.effects).toEqual([{ kind: 'start_integration' }]);
  });

  it('discard markiert Downstream als stale', () => {
    let phases = initialPhases(ENABLED);
    for (const p of ['specify', 'plan'] as const) {
      ({ phases } = startPhase(phases, p, 1));
      ({ phases } = finishPhase(phases, p, 0, 2));
      ({ phases } = approvePhase(phases, p, LEVEL2_DEFAULTS, 3));
    }
    const t = discardPhase(phases, 'specify');
    expect(t.phases.specify.status).toBe('idle');
    expect(t.phases.plan.stale).toBe(true);
    expect(t.phases.plan.status).toBe('approved');
  });

  it('reconcile hebt idle mit Disk-Artefakt auf awaiting_review', () => {
    const phases = initialPhases(ENABLED);
    const map = reconcileWithDisk(phases, (p) => p === 'specify');
    expect(map.specify.status).toBe('awaiting_review');
    expect(map.plan.status).toBe('idle');
  });

  it('reaper räumt verwaiste running-States ab', () => {
    const { phases } = startPhase(initialPhases(ENABLED), 'specify', 1);
    const map = reapOrphanedRunning(phases, () => false);
    expect(map.specify.status).toBe('idle');
    const kept = reapOrphanedRunning(phases, () => true);
    expect(kept.specify.status).toBe('running');
  });
});
