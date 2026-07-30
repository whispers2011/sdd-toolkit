import { describe, expect, it } from 'vitest';
import {
  ACTION_REASON,
  BUSY_REASON,
  DECISION_REASON,
  FEATURE_ACTIONS,
  STAGE_CLASS,
  alreadyIntegratingReason,
  busyReason,
  evaluateAction,
  integrationRunningReason,
  isFeatureComplete,
  phaseRunningReason,
  previousPhaseOpenReason,
  type FeatureActionContext,
  type FeatureActionId,
} from './actionPolicy.js';
import { initialPhases, type PhaseMap } from './phaseMachine.js';
import type { FeaturePhase, IntegrationStage, PhaseStatus, SessionDisplayStatus } from './types.js';
import { INTEGRATION_STAGE_META } from './workflowModel.js';

const ENABLED: FeaturePhase[] = ['specify', 'plan', 'tasks', 'implement'];

/** Alle Stufen zur LAUFZEIT (nicht nur zur Compilezeit) — Muster aus workflowModel.test.ts. */
const ALL_STAGES = Object.keys(INTEGRATION_STAGE_META) as IntegrationStage[];

function phasesWith(statuses: Partial<Record<FeaturePhase, PhaseStatus>>): PhaseMap {
  const map = initialPhases(ENABLED);
  for (const [phase, status] of Object.entries(statuses) as [FeaturePhase, PhaseStatus][]) {
    map[phase] = { ...map[phase], status };
  }
  return map;
}

/** Alle Schritte freigegeben = Feature ist fertig. */
function completePhases(): PhaseMap {
  return phasesWith(Object.fromEntries(ENABLED.map((p) => [p, 'approved'])));
}

function ctx(overrides: Partial<FeatureActionContext> = {}): FeatureActionContext {
  return {
    phases: initialPhases(ENABLED),
    integration: 'none',
    archived: false,
    hasWorktree: true,
    session: null,
    gateRunning: false,
    hasChanges: 'unknown',
    ...overrides,
  };
}

// ---------- 3. Exhaustiveness der Stufen-Klassifikation ----------

describe('STAGE_CLASS deckt jede Integrationsstufe ab', () => {
  it('klassifiziert alle Stufen zur Laufzeit', () => {
    for (const stage of ALL_STAGES) {
      expect(STAGE_CLASS[stage], `STAGE_CLASS fehlt für ${stage}`).toBeDefined();
    }
    expect(Object.keys(STAGE_CLASS).sort()).toEqual([...ALL_STAGES].sort());
  });

  it('kennt genau einen Ruhezustand und genau einen Endzustand', () => {
    expect(ALL_STAGES.filter((s) => STAGE_CLASS[s] === 'idle')).toEqual(['none']);
    expect(ALL_STAGES.filter((s) => STAGE_CLASS[s] === 'terminal')).toEqual(['merged']);
  });

  it('jede Entscheidungsstufe hat einen Entscheidungssatz', () => {
    for (const stage of ALL_STAGES.filter((s) => STAGE_CLASS[s] === 'decision')) {
      expect(DECISION_REASON[stage as keyof typeof DECISION_REASON]).toBeTruthy();
    }
  });
});

// ---------- isFeatureComplete (FR-001) ----------

describe('isFeatureComplete', () => {
  it('ist genau dann fertig, wenn jeder aktive Schritt freigegeben ist', () => {
    expect(isFeatureComplete(completePhases())).toBe(true);
    expect(isFeatureComplete(phasesWith({ implement: 'awaiting_review' }))).toBe(false);
    expect(isFeatureComplete(initialPhases(ENABLED))).toBe(false);
  });

  it('zählt einen als stale markierten Schritt weiterhin als freigegeben', () => {
    const map = completePhases();
    map.plan = { ...map.plan, stale: true };
    expect(isFeatureComplete(map)).toBe(true);
  });

  it('ignoriert abgeschaltete optionale Schritte', () => {
    const nurZwei = initialPhases(['specify', 'implement']);
    nurZwei.specify = { ...nurZwei.specify, status: 'approved' };
    nurZwei.implement = { ...nurZwei.implement, status: 'approved' };
    expect(isFeatureComplete(nurZwei)).toBe(true);
  });

  it('gilt ohne aktive Schritte als nicht fertig', () => {
    expect(isFeatureComplete({} as PhaseMap)).toBe(false);
  });
});

// ---------- busyReason (FR-005, Prioritätsfolge) ----------

describe('busyReason nennt genau einen Grund in fester Prioritätsfolge', () => {
  it('laufender Schritt schlägt alles andere', () => {
    const c = ctx({
      phases: phasesWith({ specify: 'running' }),
      session: 'working',
      gateRunning: true,
      integration: 'verifying',
    });
    expect(busyReason(c)).toBe(phaseRunningReason('specify'));
  });

  it('arbeitende Session vor Gate und Integration', () => {
    expect(busyReason(ctx({ session: 'working', gateRunning: true }))).toBe(BUSY_REASON.sessionWorking);
  });

  it('wartende Session vor Gate', () => {
    expect(busyReason(ctx({ session: 'awaiting_input', gateRunning: true }))).toBe(
      BUSY_REASON.sessionAwaitingInput,
    );
  });

  it('Gate vor laufender Integration', () => {
    expect(busyReason(ctx({ gateRunning: true, integration: 'merging' }))).toBe(BUSY_REASON.gateRunning);
  });

  it('aktive Integrationsstufe nennt die Stufe', () => {
    expect(busyReason(ctx({ integration: 'queued' }))).toBe(integrationRunningReason('queued'));
  });

  it('untätige Session-Zustände machen nicht beschäftigt', () => {
    for (const s of ['idle', 'stopped', 'errored'] as SessionDisplayStatus[]) {
      expect(busyReason(ctx({ session: s }))).toBeNull();
    }
    expect(busyReason(ctx())).toBeNull();
  });

  it('Entscheidungsstufen machen NICHT beschäftigt', () => {
    for (const stage of ALL_STAGES.filter((s) => STAGE_CLASS[s] === 'decision')) {
      expect(busyReason(ctx({ integration: stage })), stage).toBeNull();
    }
  });
});

// ---------- 1. Vollständigkeit: jede Matrixzeile je Aktion ----------

describe('phase_start — Entscheidungsmatrix', () => {
  const start = (c: FeatureActionContext, phase: FeaturePhase = 'specify') =>
    evaluateAction('phase_start', c, { phase });

  it('1 archiviert → hidden', () => {
    const v = start(ctx({ archived: true }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.archived);
  });

  it('2 abgeschlossen → hidden', () => {
    const v = start(ctx({ integration: 'merged' }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.completed);
  });

  it('3 Schritt im Projekt nicht aktiv → hidden', () => {
    const v = start(ctx(), 'clarify');
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.phaseNotEnabled);
  });

  it('4 Schritt nicht offen → hidden', () => {
    const v = start(ctx({ phases: phasesWith({ specify: 'awaiting_review' }) }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.phaseNotIdle);
  });

  it('5 kein Arbeitsverzeichnis → hidden', () => {
    const v = start(ctx({ hasWorktree: false }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.noWorktree);
  });

  it('6 beschäftigt → blocked mit dem Beschäftigt-Satz', () => {
    const v = start(ctx({ session: 'working' }));
    expect(v.availability).toBe('blocked');
    expect(v.reason).toBe(BUSY_REASON.sessionWorking);
  });

  it('7 Entscheidungszustand → blocked mit dem Entscheidungssatz', () => {
    const v = start(ctx({ integration: 'awaiting_human_review' }));
    expect(v.availability).toBe('blocked');
    expect(v.reason).toBe(DECISION_REASON.awaiting_human_review);
  });

  it('8 vorgelagerter Schritt nicht freigegeben → blocked mit dessen Namen', () => {
    const v = start(ctx({ phases: phasesWith({ specify: 'awaiting_review' }) }), 'plan');
    expect(v.availability).toBe('blocked');
    expect(v.reason).toBe(previousPhaseOpenReason('specify'));
  });

  it('Grundsatz: sonst available ohne Grund', () => {
    const v = start(ctx());
    expect(v.availability).toBe('available');
    expect(v.reason).toBeNull();
  });
});

describe.each(['phase_approve', 'phase_discard'] as const)('%s — Entscheidungsmatrix', (action) => {
  const evaluate = (c: FeatureActionContext, phase: FeaturePhase = 'specify') =>
    evaluateAction(action, c, { phase });
  const wartend = () => phasesWith({ specify: 'awaiting_review' });

  it('1 archiviert → hidden', () => {
    const v = evaluate(ctx({ phases: wartend(), archived: true }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.archived);
  });

  it('2 abgeschlossen → hidden', () => {
    const v = evaluate(ctx({ phases: wartend(), integration: 'merged' }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.completed);
  });

  it('3 Schritt im Projekt nicht aktiv → hidden', () => {
    const v = evaluate(ctx({ phases: wartend() }), 'analyze');
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.phaseNotEnabled);
  });

  it('4 Schritt wartet nicht auf Freigabe → hidden', () => {
    const v = evaluate(ctx());
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.phaseNotAwaitingReview);
  });

  it('5 beschäftigt → blocked mit dem Beschäftigt-Satz', () => {
    const v = evaluate(ctx({ phases: wartend(), gateRunning: true }));
    expect(v.availability).toBe('blocked');
    expect(v.reason).toBe(BUSY_REASON.gateRunning);
  });

  it('6 Entscheidungszustand → blocked mit dem Entscheidungssatz', () => {
    const v = evaluate(ctx({ phases: wartend(), integration: 'verify_failed' }));
    expect(v.availability).toBe('blocked');
    expect(v.reason).toBe(DECISION_REASON.verify_failed);
  });

  it('Grundsatz: sonst available ohne Grund', () => {
    const v = evaluate(ctx({ phases: wartend() }));
    expect(v.availability).toBe('available');
    expect(v.reason).toBeNull();
  });
});

describe('integrate — Entscheidungsmatrix (Kernproblem der Spec)', () => {
  const fertig = (o: Partial<FeatureActionContext> = {}) => ctx({ phases: completePhases(), ...o });
  const integrate = (c: FeatureActionContext) => evaluateAction('integrate', c);

  it('1 archiviert → hidden', () => {
    const v = integrate(fertig({ archived: true }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.archived);
  });

  it('2 bereits in der Integration → hidden mit Stufennamen', () => {
    const v = integrate(fertig({ integration: 'verifying' }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(alreadyIntegratingReason('verifying'));
  });

  it('3 nicht fertig → hidden (FR-002/SC-001)', () => {
    const v = integrate(ctx({ phases: phasesWith({ specify: 'approved' }) }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.notComplete);
  });

  it('4 kein Arbeitsverzeichnis → hidden', () => {
    const v = integrate(fertig({ hasWorktree: false }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.noWorktree);
  });

  it('5 beschäftigt → blocked mit dem Beschäftigt-Satz', () => {
    const v = integrate(fertig({ session: 'awaiting_input' }));
    expect(v.availability).toBe('blocked');
    expect(v.reason).toBe(BUSY_REASON.sessionAwaitingInput);
  });

  it('6 keine Änderungen → blocked (FR-027)', () => {
    const v = integrate(fertig({ hasChanges: false }));
    expect(v.availability).toBe('blocked');
    expect(v.reason).toBe(ACTION_REASON.noChanges);
  });

  it('Grundsatz: fertig mit Änderungen → available', () => {
    expect(integrate(fertig({ hasChanges: true })).availability).toBe('available');
  });

  it("Grundsatz: 'unknown' sperrt nicht", () => {
    const v = integrate(fertig({ hasChanges: 'unknown' }));
    expect(v.availability).toBe('available');
    expect(v.reason).toBeNull();
  });

  it('automatisch gestartete Pipeline lässt die manuelle Aktion verschwinden', () => {
    for (const stage of ALL_STAGES.filter((s) => s !== 'none')) {
      expect(integrate(fertig({ integration: stage, hasChanges: true })).availability, stage).toBe('hidden');
    }
  });
});

describe('integration_retry — Entscheidungsmatrix', () => {
  const retry = (c: FeatureActionContext) => evaluateAction('integration_retry', c);

  it('1 archiviert → hidden', () => {
    const v = retry(ctx({ integration: 'verify_failed', archived: true }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.archived);
  });

  it('2 keine fehlgeschlagene Integration → hidden', () => {
    const v = retry(ctx());
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.noFailedIntegration);
  });

  it('3 beschäftigt → blocked mit dem Beschäftigt-Satz', () => {
    const v = retry(ctx({ integration: 'gate_failed', phases: phasesWith({ implement: 'running' }) }));
    expect(v.availability).toBe('blocked');
    expect(v.reason).toBe(phaseRunningReason('implement'));
  });

  it('Grundsatz: alle drei Fehlerstufen sind überall wiederholbar (FR-015)', () => {
    for (const stage of ['verify_failed', 'gate_failed', 'conflict_escalated'] as IntegrationStage[]) {
      const v = retry(ctx({ integration: stage }));
      expect(v.availability, stage).toBe('available');
      expect(v.reason).toBeNull();
    }
  });
});

describe.each(['review_approve', 'review_reject'] as const)('%s — Entscheidungsmatrix', (action) => {
  const evaluate = (c: FeatureActionContext) => evaluateAction(action, c);

  it('1 archiviert → hidden', () => {
    const v = evaluate(ctx({ integration: 'awaiting_human_review', archived: true }));
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.archived);
  });

  it('2 wartet nicht auf Review → hidden (FR-019, Vorschau)', () => {
    const v = evaluate(ctx());
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(ACTION_REASON.notAwaitingReview);
  });

  it('3 beschäftigt → blocked mit dem Beschäftigt-Satz', () => {
    const v = evaluate(ctx({ integration: 'awaiting_human_review', session: 'working' }));
    expect(v.availability).toBe('blocked');
    expect(v.reason).toBe(BUSY_REASON.sessionWorking);
  });

  it('Grundsatz: sonst available ohne Grund', () => {
    const v = evaluate(ctx({ integration: 'awaiting_human_review' }));
    expect(v.availability).toBe('available');
    expect(v.reason).toBeNull();
  });
});

describe.each(['archive', 'delete'] as const)('%s — Aufräum-Aktion (FR-017/FR-008)', (action) => {
  const evaluate = (c: FeatureActionContext) => evaluateAction(action, c);

  it('archiviert: archive verschwindet, delete bleibt', () => {
    const v = evaluate(ctx({ archived: true }));
    if (action === 'archive') {
      expect(v.availability).toBe('hidden');
      expect(v.reason).toBe(ACTION_REASON.alreadyArchived);
    } else {
      expect(v.availability).toBe('available');
      expect(v.reason).toBeNull();
    }
  });

  // Verschärft am 27.07.2026: Aufräumen war zuvor in JEDEM Zustand verfügbar und nur
  // durch einen Warnsatz im Dialog abgesichert. Beide Aktionen sind destruktiv und
  // treffen uncommittete Arbeit — an diesem Tag lagen zeitweise 38 ungesicherte
  // Dateien im Worktree, während die Oberfläche „fertig" zeigte.
  it('ist gesperrt, solange gearbeitet wird — mit sichtbarem Grund', () => {
    for (const busy of [
      ctx({ session: 'working' }),
      ctx({ session: 'awaiting_input' }),
      ctx({ phases: phasesWith({ plan: 'running' }) }),
      ctx({ gateRunning: true }),
      ctx({ integration: 'merging' }),
    ]) {
      const v = evaluate(busy);
      expect(v.availability).toBe('blocked');
      expect(v.reason).toBe(busyReason(busy)); // wortgleich mit jeder anderen Aktion
    }
  });

  it('ist verfügbar, sobald nichts mehr läuft — auch in Entscheidungsstufen', () => {
    expect(evaluate(ctx()).availability).toBe('available');
    expect(evaluate(ctx({ integration: 'awaiting_human_review' })).availability).toBe('available');
    expect(evaluate(ctx({ integration: 'conflict_escalated' })).availability).toBe('available');
    expect(evaluate(ctx({ integration: 'merged' })).availability).toBe('available');
  });
});

// ---------- 2. Invariante über eine erzeugte Kontextmenge ----------

/** Kreuzprodukt aus Stufen × Phasenlagen × Session × Gate × Änderungslage × archiviert. */
function generatedContexts(): FeatureActionContext[] {
  const phaseSets: PhaseMap[] = [
    initialPhases(ENABLED),
    phasesWith({ specify: 'running' }),
    phasesWith({ specify: 'awaiting_review' }),
    phasesWith({ specify: 'approved', plan: 'awaiting_review' }),
    completePhases(),
  ];
  const sessions: (SessionDisplayStatus | null)[] = [null, 'idle', 'working', 'awaiting_input', 'stopped'];
  const out: FeatureActionContext[] = [];
  for (const integration of ALL_STAGES) {
    for (const phases of phaseSets) {
      for (const session of sessions) {
        for (const gateRunning of [false, true]) {
          for (const hasChanges of [true, false, 'unknown'] as (boolean | 'unknown')[]) {
            for (const archived of [false, true]) {
              for (const hasWorktree of [false, true]) {
                out.push({ phases, integration, archived, hasWorktree, session, gateRunning, hasChanges });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

describe('Invariante über die gesamte Zustandsmenge', () => {
  const CONTEXTS = generatedContexts();

  it('reason === null ⟺ availability === available', () => {
    for (const c of CONTEXTS) {
      for (const action of FEATURE_ACTIONS) {
        for (const phase of [undefined, ...ENABLED] as (FeaturePhase | undefined)[]) {
          const v = evaluateAction(action, c, phase === undefined ? undefined : { phase });
          expect(v.reason === null, `${action}/${phase ?? '–'}`).toBe(v.availability === 'available');
        }
      }
    }
  });

  it('liefert für jede Aktion immer einen der drei Befunde', () => {
    for (const c of CONTEXTS.slice(0, 200)) {
      for (const action of FEATURE_ACTIONS) {
        const v = evaluateAction(action, c, { phase: 'implement' });
        expect(['available', 'blocked', 'hidden']).toContain(v.availability);
      }
    }
  });
});

// ---------- 4. SC-001 ----------

describe('SC-001 — integrate ist vor der Fertigstellung NIE verfügbar', () => {
  it('gilt über alle Zwischenzustände eines Features', () => {
    const zwischenzustaende: PhaseMap[] = [
      initialPhases(ENABLED), // kein Schritt gestartet
      phasesWith({ specify: 'running' }), // erster Schritt läuft
      phasesWith({ specify: 'awaiting_review' }), // erster Schritt wartet auf Freigabe
      phasesWith({ specify: 'approved', plan: 'awaiting_review' }),
      phasesWith({ specify: 'approved', plan: 'approved', tasks: 'approved' }), // letzter Schritt offen
      phasesWith({ specify: 'approved', plan: 'approved', tasks: 'approved', implement: 'awaiting_review' }),
    ];
    for (const phases of zwischenzustaende) {
      for (const hasChanges of [true, false, 'unknown'] as (boolean | 'unknown')[]) {
        const v = evaluateAction('integrate', ctx({ phases, hasChanges }));
        expect(v.availability).toBe('hidden');
        expect(v.reason).toBe(ACTION_REASON.notComplete);
      }
    }
  });

  it('erscheint, sobald alle aktiven Schritte freigegeben sind', () => {
    expect(evaluateAction('integrate', ctx({ phases: completePhases() })).availability).toBe('available');
  });
});

// ---------- 5. SC-002 ----------

describe('SC-002 — beschäftigt sperrt jede auslösende Aktion', () => {
  const AUSLOESEND: FeatureActionId[] = [
    'phase_start',
    'phase_approve',
    'phase_discard',
    'integrate',
    'integration_retry',
    'review_approve',
    'review_reject',
  ];

  const QUELLEN: Partial<FeatureActionContext>[] = [
    { phases: phasesWith({ implement: 'running' }) },
    { session: 'working' },
    { session: 'awaiting_input' },
    { gateRunning: true },
    ...ALL_STAGES.filter((s) => STAGE_CLASS[s] === 'active').map((integration) => ({ integration })),
  ];

  // Wo die Beschäftigung nicht aus einem laufenden Schritt stammt, zusätzlich die
  // fertige Phasenlage prüfen — sonst greift bei `integrate` schon eine
  // Sichtbarkeits-Vorstufe und der Beschäftigt-Zweig würde nie erreicht.
  const beschaeftigt: FeatureActionContext[] = QUELLEN.flatMap((src) =>
    'phases' in src ? [ctx(src)] : [ctx(src), ctx({ ...src, phases: completePhases() })],
  );

  it('keine auslösende Aktion ist verfügbar, solange gearbeitet wird', () => {
    for (const c of beschaeftigt) {
      expect(busyReason(c)).not.toBeNull();
      for (const action of AUSLOESEND) {
        for (const phase of ENABLED) {
          expect(evaluateAction(action, c, { phase }).availability).not.toBe('available');
        }
      }
    }
  });

  // Seit 27.07.2026 gilt SC-002 ausnahmslos: Auch die Aufräum-Aktionen sind
  // gesperrt, solange gearbeitet wird. Sie sind destruktiv und trafen bis dahin
  // uncommittete Arbeit, abgesichert nur durch einen Warnsatz im Dialog.
  it('Aufräum-Aktionen sind ebenfalls gesperrt, solange gearbeitet wird', () => {
    for (const c of beschaeftigt) {
      for (const action of ['archive', 'delete'] as const) {
        const v = evaluateAction(action, c);
        expect(v.availability).not.toBe('available');
        expect(v.reason).not.toBeNull();
      }
    }
  });
});

// ---------- 6. FR-011 ----------

describe('FR-011 — die Policy liest ausschließlich aus dem übergebenen Kontext', () => {
  it('ein beschäftigtes Feature A beeinflusst Feature B nicht', () => {
    const a = ctx({ phases: phasesWith({ implement: 'running' }), session: 'working' });
    const b = ctx({ phases: completePhases(), hasChanges: true });
    expect(evaluateAction('integrate', a).availability).not.toBe('available');
    expect(evaluateAction('integrate', b).availability).toBe('available');
  });

  it('ist frei von Seiteneffekten: gleicher Kontext → gleicher Befund', () => {
    const c = ctx({ phases: completePhases(), hasChanges: true });
    const first = evaluateAction('integrate', c);
    evaluateAction('integrate', ctx({ session: 'working' }));
    expect(evaluateAction('integrate', c)).toEqual(first);
  });

  it('verändert den übergebenen Kontext nicht', () => {
    const c = ctx({ phases: completePhases(), hasChanges: true });
    const snapshot = JSON.stringify(c);
    for (const action of FEATURE_ACTIONS) evaluateAction(action, c, { phase: 'implement' });
    expect(JSON.stringify(c)).toBe(snapshot);
  });
});

// ---------- Darstellungsregeln (T052, FR-009/US4) ----------

describe('Darstellungsregeln — jede Aktion kennt hidden UND blocked', () => {
  /** Je Aktion: ein grundsätzlich sinnloser (hidden) und ein gerade verhinderter (blocked) Zustand. */
  const FAELLE: Record<
    FeatureActionId,
    { hidden: [FeatureActionContext, FeaturePhase | undefined, string]; blocked: [FeatureActionContext, FeaturePhase | undefined, string] | null }
  > = {
    phase_start: {
      hidden: [ctx({ phases: phasesWith({ specify: 'approved' }) }), 'specify', ACTION_REASON.phaseNotIdle],
      blocked: [ctx({ session: 'working' }), 'specify', BUSY_REASON.sessionWorking],
    },
    phase_approve: {
      hidden: [ctx(), 'specify', ACTION_REASON.phaseNotAwaitingReview],
      blocked: [
        ctx({ phases: phasesWith({ specify: 'awaiting_review' }), gateRunning: true }),
        'specify',
        BUSY_REASON.gateRunning,
      ],
    },
    phase_discard: {
      hidden: [ctx({ archived: true }), 'specify', ACTION_REASON.archived],
      blocked: [
        ctx({ phases: phasesWith({ specify: 'awaiting_review' }), integration: 'conflict_escalated' }),
        'specify',
        DECISION_REASON.conflict_escalated,
      ],
    },
    phase_reopen: {
      hidden: [ctx(), 'specify', ACTION_REASON.phaseNotApproved],
      blocked: [
        ctx({ phases: phasesWith({ specify: 'approved' }), integration: 'verifying' }),
        'specify',
        ACTION_REASON.reopenWhileIntegrating,
      ],
    },
    integrate: {
      hidden: [ctx(), undefined, ACTION_REASON.notComplete],
      blocked: [ctx({ phases: completePhases(), hasChanges: false }), undefined, ACTION_REASON.noChanges],
    },
    integration_retry: {
      hidden: [ctx(), undefined, ACTION_REASON.noFailedIntegration],
      blocked: [ctx({ integration: 'verify_failed', session: 'working' }), undefined, BUSY_REASON.sessionWorking],
    },
    review_approve: {
      hidden: [ctx(), undefined, ACTION_REASON.notAwaitingReview],
      blocked: [
        ctx({ integration: 'awaiting_human_review', gateRunning: true }),
        undefined,
        BUSY_REASON.gateRunning,
      ],
    },
    review_reject: {
      hidden: [ctx({ integration: 'merged' }), undefined, ACTION_REASON.notAwaitingReview],
      blocked: [
        ctx({ integration: 'awaiting_human_review', session: 'awaiting_input' }),
        undefined,
        BUSY_REASON.sessionAwaitingInput,
      ],
    },
    // Aufräum-Aktionen werden nach FR-017 bewusst NIE gesperrt.
    archive: { hidden: [ctx({ archived: true }), undefined, ACTION_REASON.alreadyArchived], blocked: null },
    delete: { hidden: [ctx(), undefined, ''], blocked: null },
  };

  it.each(FEATURE_ACTIONS.filter((a) => a !== 'delete'))('%s: hidden-Fall trägt den erwarteten Grund', (action) => {
    const [c, phase, reason] = FAELLE[action].hidden;
    const v = evaluateAction(action, c, phase === undefined ? undefined : { phase });
    expect(v.availability).toBe('hidden');
    expect(v.reason).toBe(reason);
  });

  it.each(FEATURE_ACTIONS.filter((a) => FAELLE[a].blocked !== null))(
    '%s: blocked-Fall trägt den erwarteten Grund',
    (action) => {
      const [c, phase, reason] = FAELLE[action].blocked!;
      const v = evaluateAction(action, c, phase === undefined ? undefined : { phase });
      expect(v.availability).toBe('blocked');
      expect(v.reason).toBe(reason);
    },
  );

  // delete wird nie ausgeblendet — es ist die letzte verfügbare Aktion und muss
  // auffindbar bleiben. Gesperrt wird es nur, solange gearbeitet wird (seit
  // 27.07.2026); dann trägt es einen Grund.
  it('delete ist nie versteckt und genau dann gesperrt, wenn gearbeitet wird', () => {
    for (const c of generatedContexts().slice(0, 300)) {
      const v = evaluateAction('delete', c);
      expect(v.availability).not.toBe('hidden');
      if (busyReason(c) === null) {
        expect(v.availability).toBe('available');
        expect(v.reason).toBeNull();
      } else {
        expect(v.availability).toBe('blocked');
        expect(v.reason).toBe(busyReason(c));
      }
    }
  });
});
