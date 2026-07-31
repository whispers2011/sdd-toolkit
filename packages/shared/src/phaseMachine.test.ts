import { describe, expect, it } from 'vitest';
import {
  approvePhase,
  discardPhase,
  enteredPhase,
  finishPhase,
  initialPhases,
  nextPhase,
  reapOrphanedRunning,
  reconcileWithDisk,
  reopenLastPhase,
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

  it('reopenLastPhase setzt den letzten aktiven Schritt zurück — ohne Effekte', () => {
    const phases = initialPhases(ENABLED);
    for (const p of ENABLED) phases[p] = { ...phases[p], status: 'approved' };

    const t = reopenLastPhase(phases);

    expect(t.phases.implement.status).toBe('awaiting_review');
    // Kein automatischer Folgestart (FR-021) — auch nicht bei aktivem autoVerify.
    expect(t.effects).toEqual([]);
    // Vorgelagerte Schritte bleiben unverändert freigegeben.
    expect(t.phases.specify.status).toBe('approved');
    expect(t.phases.plan.status).toBe('approved');
    expect(t.phases.tasks.status).toBe('approved');
  });

  it('reopenLastPhase trifft den letzten AKTIVEN Schritt auch bei abgeschalteten Schritten', () => {
    const enabled: FeaturePhase[] = ['specify', 'plan'];
    const phases = initialPhases(enabled);
    for (const p of enabled) phases[p] = { ...phases[p], status: 'approved' };

    const t = reopenLastPhase(phases);

    expect(t.phases.plan.status).toBe('awaiting_review');
    expect(t.phases.specify.status).toBe('approved');
    expect('implement' in t.phases).toBe(false);
  });

  it('reopenLastPhase verändert den Eingabewert nicht und verträgt eine leere Phasenmenge', () => {
    const phases = initialPhases(ENABLED);
    phases.implement = { ...phases.implement, status: 'approved' };
    const before = JSON.stringify(phases);
    reopenLastPhase(phases);
    expect(JSON.stringify(phases)).toBe(before);

    const leer = reopenLastPhase(initialPhases([]));
    expect(leer.effects).toEqual([]);
    expect(leer.phases).toEqual({});
  });

  it('reaper räumt verwaiste running-States ab', () => {
    const { phases } = startPhase(initialPhases(ENABLED), 'specify', 1);
    const map = reapOrphanedRunning(phases, () => false);
    expect(map.specify.status).toBe('idle');
    const kept = reapOrphanedRunning(phases, () => true);
    expect(kept.specify.status).toBe('running');
  });
});

// ---------- Phasen-Diff für die Ton-Ebene (Contract S6) ----------

describe('enteredPhase (S6)', () => {
  it('meldet die Phase, die neu auf running wechselt (S6.1)', () => {
    const vorher = initialPhases(ENABLED);
    const { phases: nachher } = startPhase(vorher, 'specify', 1);
    expect(enteredPhase(vorher, nachher)).toBe('specify');
  });

  it('schweigt beim ersten Eintreffen eines Features (S6.2)', () => {
    // Bootstrap und Wiederverbinden setzen nur den Grundstand — kein Ton.
    const { phases } = startPhase(initialPhases(ENABLED), 'specify', 1);
    expect(enteredPhase(undefined, phases)).toBeNull();
  });

  it('wählt bei mehreren gleichzeitigen Wechseln die späteste Phase (S6.3)', () => {
    const vorher = initialPhases(ENABLED);
    const nachher = {
      ...vorher,
      specify: { ...vorher.specify, status: 'running' as const },
      tasks: { ...vorher.tasks, status: 'running' as const },
    };
    // FEATURE_PHASES-Reihenfolge: tasks liegt hinter specify — die weitergehende Arbeit.
    expect(enteredPhase(vorher, nachher)).toBe('tasks');
  });

  it('schweigt, wenn keine Phase nach running wechselt (S6.4)', () => {
    const vorher = initialPhases(ENABLED);
    // Freigabe, Verwerfen und Integrationsstufen bleiben stumm.
    const approved = { ...vorher, specify: { ...vorher.specify, status: 'approved' as const } };
    expect(enteredPhase(vorher, approved)).toBeNull();

    const review = { ...vorher, plan: { ...vorher.plan, status: 'awaiting_review' as const } };
    expect(enteredPhase(vorher, review)).toBeNull();
  });

  it('schweigt, solange eine Phase durchgehend running bleibt (S6.1)', () => {
    const { phases } = startPhase(initialPhases(ENABLED), 'specify', 1);
    // Anderes Feld ändert sich (z. B. stale) — der Status bleibt running.
    const spaeter = { ...phases, specify: { ...phases.specify, stale: true } };
    expect(enteredPhase(phases, spaeter)).toBeNull();
  });

  it('erkennt den Neustart derselben Phase erneut als erreicht (research D2)', () => {
    const idle = initialPhases(ENABLED);
    const { phases: läuft } = startPhase(idle, 'specify', 1);
    const gestoppt = { ...läuft, specify: { ...läuft.specify, status: 'idle' as const } };
    const { phases: erneut } = startPhase(gestoppt, 'specify', 2);
    expect(enteredPhase(gestoppt, erneut)).toBe('specify');
  });

  it('verträgt abgeschaltete Phasen in beiden Ständen (S6.5)', () => {
    const enabled: FeaturePhase[] = ['specify', 'implement'];
    const vorher = initialPhases(enabled);
    const { phases: nachher } = startPhase(
      { ...vorher, specify: { ...vorher.specify, status: 'approved' } },
      'implement',
      1,
    );
    expect(enteredPhase(vorher, nachher)).toBe('implement');
  });
});
