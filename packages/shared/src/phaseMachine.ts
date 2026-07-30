import {
  FEATURE_PHASES,
  type AutomationSettings,
  type FeaturePhase,
  type PhaseState,
} from './types.js';

export type PhaseMap = Record<FeaturePhase, PhaseState>;

export function initialPhases(enabled: FeaturePhase[]): PhaseMap {
  const map = {} as PhaseMap;
  for (const p of FEATURE_PHASES) {
    if (enabled.includes(p)) map[p] = { status: 'idle', stale: false };
  }
  return map;
}

export function orderedPhases(phases: PhaseMap): FeaturePhase[] {
  return FEATURE_PHASES.filter((p) => p in phases);
}

export function nextPhase(phases: PhaseMap, after: FeaturePhase): FeaturePhase | null {
  const order = orderedPhases(phases);
  const idx = order.indexOf(after);
  if (idx === -1 || idx === order.length - 1) return null;
  return order[idx + 1] ?? null;
}

/** Ergebnis einer Phasen-Transition: neuer PhaseMap + auszuführende Effekte. */
export interface PhaseTransition {
  phases: PhaseMap;
  effects: PhaseEffect[];
}

export type PhaseEffect =
  | { kind: 'start_agent'; phase: FeaturePhase }
  | { kind: 'phase_awaiting_review'; phase: FeaturePhase }
  | { kind: 'start_integration' };

function patch(phases: PhaseMap, phase: FeaturePhase, next: Partial<PhaseState>): PhaseMap {
  const cur = phases[phase];
  return { ...phases, [phase]: { ...cur, ...next } };
}

/** Agent-Lauf für eine Phase starten (setzt Vorphasen approved voraus). */
export function startPhase(phases: PhaseMap, phase: FeaturePhase, now: number): PhaseTransition {
  const order = orderedPhases(phases);
  for (const p of order) {
    if (p === phase) break;
    if (phases[p].status !== 'approved') {
      throw new Error(`Phase ${phase} kann nicht starten: ${p} ist nicht approved`);
    }
  }
  if (phases[phase].status === 'running') {
    throw new Error(`Phase ${phase} läuft bereits`);
  }
  return {
    phases: patch(phases, phase, { status: 'running', stale: false, startedAt: now }),
    effects: [{ kind: 'start_agent', phase }],
  };
}

/** Agent-Lauf beendet. Erfolg → awaiting_review; Misserfolg → zurück auf idle. */
export function finishPhase(
  phases: PhaseMap,
  phase: FeaturePhase,
  exitCode: number,
  now: number,
): PhaseTransition {
  if (phases[phase].status !== 'running') {
    return { phases, effects: [] };
  }
  if (exitCode !== 0) {
    return {
      phases: patch(phases, phase, { status: 'idle', finishedAt: now, exitCode }),
      effects: [],
    };
  }
  return {
    phases: patch(phases, phase, { status: 'awaiting_review', finishedAt: now, exitCode }),
    effects: [{ kind: 'phase_awaiting_review', phase }],
  };
}

/**
 * Phase approven. Bei aktivem Auto-Progress wird die Folgephase gestartet;
 * nach der letzten Phase beginnt (bei autoVerify) die Integrations-Pipeline.
 */
export function approvePhase(
  phases: PhaseMap,
  phase: FeaturePhase,
  automation: AutomationSettings,
  now: number,
): PhaseTransition {
  if (phases[phase].status !== 'awaiting_review') {
    throw new Error(`Phase ${phase} ist nicht awaiting_review`);
  }
  let map = patch(phases, phase, { status: 'approved', stale: false });
  const effects: PhaseEffect[] = [];

  const next = nextPhase(map, phase);
  if (next === null) {
    if (automation.autoVerify) effects.push({ kind: 'start_integration' });
    return { phases: map, effects };
  }

  if (shouldAutoProgress(next, automation)) {
    map = patch(map, next, { status: 'running', stale: false, startedAt: now });
    effects.push({ kind: 'start_agent', phase: next });
  }
  return { phases: map, effects };
}

export function shouldAutoProgress(next: FeaturePhase, automation: AutomationSettings): boolean {
  if (automation.autoProgressUntil === 'off') return false;
  return FEATURE_PHASES.indexOf(next) <= FEATURE_PHASES.indexOf(automation.autoProgressUntil);
}

/**
 * Zurückweisung im Review (FR-020/FR-021): der LETZTE aktive Schritt geht auf
 * `awaiting_review` zurück und braucht eine neue, ausdrückliche Freigabe.
 *
 * Bewusst OHNE Effekte: `approvePhase()` würde bei autoVerify sofort wieder
 * einen Integrationsstart auslösen — genau das darf beim Zurücksetzen nicht
 * passieren. Erst die spätere Freigabe durch den Menschen geht wieder durch
 * `approvePhase()` und startet die Pipeline dann von vorn.
 */
export function reopenLastPhase(phases: PhaseMap): PhaseTransition {
  const order = orderedPhases(phases);
  const last = order.at(-1);
  if (last === undefined) return { phases, effects: [] };
  return { phases: patch(phases, last, { status: 'awaiting_review' }), effects: [] };
}

/** Phase verwerfen: selbst auf idle, alle approvten Downstream-Phasen werden stale. */
export function discardPhase(phases: PhaseMap, phase: FeaturePhase): PhaseTransition {
  let map = patch(phases, phase, { status: 'idle', stale: false });
  const order = orderedPhases(map);
  for (const p of order.slice(order.indexOf(phase) + 1)) {
    if (map[p].status === 'approved' || map[p].status === 'awaiting_review') {
      map = patch(map, p, { stale: true });
    }
  }
  return { phases: map, effects: [] };
}

/**
 * Reconciliation beim Laden: existiert das Phasen-Artefakt auf Disk und die Phase
 * ist idle, wird sie auf awaiting_review gehoben. running/approved sind User-States.
 */
export function reconcileWithDisk(phases: PhaseMap, artifactExists: (p: FeaturePhase) => boolean): PhaseMap {
  let map = phases;
  for (const p of orderedPhases(phases)) {
    if (map[p].status === 'idle' && artifactExists(p)) {
      map = patch(map, p, { status: 'awaiting_review' });
    }
  }
  return map;
}

/**
 * Phasen-Diff für die Ton-Ebene (Contract S6, research D2): welche Phase ist
 * gerade *erreicht* worden? Erreicht = ihr Status wechselt auf `running`.
 *
 * Bewusst ohne neues Server-Ereignis: die Oberfläche hält den letzten
 * `phases`-Stand je Feature und vergleicht ihn beim Eintreffen von
 * `feature_updated`. `prev === undefined` (erstes Eintreffen, Bootstrap,
 * Wiederverbinden) liefert `null` — kein Ton ohne echtes Ereignis.
 *
 * Ein Neustart derselben Phase gilt erneut als erreicht; hörbar ist „diese
 * Phase läuft jetzt an", nicht „zum ersten Mal".
 */
export function enteredPhase(prev: PhaseMap | undefined, next: PhaseMap): FeaturePhase | null {
  if (prev === undefined) return null;
  let entered: FeaturePhase | null = null;
  // FEATURE_PHASES ist die Workflow-Reihenfolge: bei mehreren gleichzeitigen
  // Wechseln bleibt die SPÄTESTE stehen — die weitergehende Arbeit (S6.3).
  for (const p of FEATURE_PHASES) {
    const before = prev[p] as PhaseState | undefined;
    const after = next[p] as PhaseState | undefined;
    if (after?.status === 'running' && before?.status !== 'running') entered = p;
  }
  return entered;
}

/**
 * Startup-Reaper: `running`-Phasen ohne lebenden Prozess sind Leichen
 * (Server-Neustart) und fallen auf idle zurück — Fix des speckit-assistant-Bugs.
 */
export function reapOrphanedRunning(phases: PhaseMap, isAlive: (p: FeaturePhase) => boolean): PhaseMap {
  let map = phases;
  for (const p of orderedPhases(phases)) {
    if (map[p].status === 'running' && !isAlive(p)) {
      map = patch(map, p, { status: 'idle' });
    }
  }
  return map;
}
