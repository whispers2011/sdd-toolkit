import { describe, expect, it } from 'vitest';
import type { AttentionItem, AttentionKind, IntegrationStage } from '@sdd/shared';
import {
  STAGE_FOR_KIND,
  findStaleOnBoot,
  findStaleRuntime,
  isAttentionValid,
  type LiveSessionState,
  type ReconcileSnapshot,
} from './attentionReconciler.js';

function item(kind: AttentionKind, over: Partial<AttentionItem> = {}): AttentionItem {
  // `over.id` ist ein Suffix → stabile, sprechende ID `${kind}-${suffix}` (nicht vom Spread überschreiben).
  const { id: idSuffix, ...rest } = over;
  return {
    id: `${kind}-${idSuffix ?? '1'}`,
    kind,
    projectId: 'p1',
    featureId: null,
    sessionId: null,
    conversationId: null,
    message: 'x',
    createdAt: 1,
    resolvedAt: null,
    ...rest,
  };
}

function snap(
  sessions: LiveSessionState[] = [],
  stages: Array<[string, IntegrationStage]> = [],
): ReconcileSnapshot {
  return { sessions, featureStages: new Map(stages) };
}

describe('isAttentionValid — awaiting_input', () => {
  it('gültig, solange die Session wartet', () => {
    const s: LiveSessionState = { sessionId: 's1', status: 'awaiting_input', featureId: 'f1', conversationId: null };
    expect(isAttentionValid(item('awaiting_input', { sessionId: 's1', featureId: 'f1' }), snap([s]))).toBe(true);
  });
  it('stale, sobald die Session wieder arbeitet', () => {
    const s: LiveSessionState = { sessionId: 's1', status: 'working', featureId: 'f1', conversationId: null };
    expect(isAttentionValid(item('awaiting_input', { sessionId: 's1', featureId: 'f1' }), snap([s]))).toBe(false);
  });
  it('stale, wenn die Session nicht mehr existiert', () => {
    expect(isAttentionValid(item('awaiting_input', { sessionId: 's1' }), snap([]))).toBe(false);
  });
  it('matcht Chat-Sessions über conversationId', () => {
    const s: LiveSessionState = { sessionId: 's2', status: 'awaiting_input', featureId: null, conversationId: 'c1' };
    expect(isAttentionValid(item('awaiting_input', { conversationId: 'c1' }), snap([s]))).toBe(true);
  });
});

describe('isAttentionValid — agent_errored', () => {
  it('bleibt gültig, solange keine Feature-Session arbeitet', () => {
    expect(isAttentionValid(item('agent_errored', { featureId: 'f1' }), snap([]))).toBe(true);
  });
  it('stale, sobald eine Feature-Session wieder arbeitet', () => {
    const s: LiveSessionState = { sessionId: 'sNEW', status: 'working', featureId: 'f1', conversationId: null };
    expect(isAttentionValid(item('agent_errored', { featureId: 'f1', sessionId: 'sOLD' }), snap([s]))).toBe(false);
  });
});

describe('isAttentionValid — Prozess-Arten (run_interrupted, phase_gate_failed)', () => {
  for (const kind of ['run_interrupted', 'phase_gate_failed'] as const) {
    it(`${kind} bleibt gültig, solange keine Feature-Session arbeitet`, () => {
      expect(isAttentionValid(item(kind, { featureId: 'f1' }), snap([]))).toBe(true);
    });
    it(`${kind} wird stale, sobald wieder am Feature gearbeitet wird (Auslöser anderweitig behoben)`, () => {
      const s: LiveSessionState = { sessionId: 's1', status: 'working', featureId: 'f1', conversationId: null };
      expect(isAttentionValid(item(kind, { featureId: 'f1' }), snap([s]))).toBe(false);
    });
    it(`${kind} ist NICHT stage-gekoppelt (überlebt Stage-Wechsel ohne laufende Arbeit)`, () => {
      expect(isAttentionValid(item(kind, { featureId: 'f1' }), snap([], [['f1', 'merged']]))).toBe(true);
    });
  }
});

describe('isAttentionValid — Merge-Arten gegen feature.integration', () => {
  const cases: Array<[AttentionKind, IntegrationStage]> = [
    ['review_due', 'awaiting_human_review'],
    ['verify_failed', 'verify_failed'],
    ['gate_failed', 'gate_failed'],
    ['merge_conflict_escalated', 'conflict_escalated'],
  ];
  for (const [kind, stage] of cases) {
    it(`${kind} gültig bei Stage ${stage}`, () => {
      expect(isAttentionValid(item(kind, { featureId: 'f1' }), snap([], [['f1', stage]]))).toBe(true);
    });
    it(`${kind} stale, wenn Stage weiterwandert`, () => {
      expect(isAttentionValid(item(kind, { featureId: 'f1' }), snap([], [['f1', 'merged']]))).toBe(false);
    });
  }
  it('stale, wenn das Feature nicht mehr auffindbar ist (konservativ)', () => {
    expect(isAttentionValid(item('review_due', { featureId: 'gone' }), snap([]))).toBe(false);
  });
});

describe('findStaleRuntime', () => {
  it('gibt nur ungültige Items zurück und lässt gültige unberührt (INV-3)', () => {
    const working: LiveSessionState = { sessionId: 's1', status: 'working', featureId: 'f1', conversationId: null };
    const open = [
      item('awaiting_input', { id: 'stale', sessionId: 's1', featureId: 'f1' }), // stale (arbeitet)
      item('review_due', { id: 'valid', featureId: 'f2' }), // gültig (Stage passt)
    ];
    const stale = findStaleRuntime(open, snap([working], [['f2', 'awaiting_human_review']]));
    expect(stale.map((i) => i.id)).toEqual(['awaiting_input-stale']);
  });
  it('ist idempotent (INV-2)', () => {
    const s = snap([], [['f1', 'merged']]);
    const open = [item('review_due', { featureId: 'f1' })];
    expect(findStaleRuntime(open, s)).toEqual(findStaleRuntime(open, s));
  });
  it('ignoriert permission_request', () => {
    expect(findStaleRuntime([item('permission_request', { sessionId: 's1' })], snap([]))).toEqual([]);
  });
});

describe('findStaleOnBoot', () => {
  it('löst Session-Arten immer auf (Sessions nach Boot weg)', () => {
    const open = [item('awaiting_input', { sessionId: 's1' }), item('agent_errored', { featureId: 'f1' })];
    expect(findStaleOnBoot(open, new Map()).map((i) => i.kind).sort()).toEqual(['agent_errored', 'awaiting_input']);
  });
  it('behält gültige Merge-Arten anhand der persistierten Stage', () => {
    const open = [
      item('review_due', { id: 'keep', featureId: 'f1' }),
      item('verify_failed', { id: 'drop', featureId: 'f2' }),
    ];
    const stages = new Map<string, IntegrationStage>([
      ['f1', 'awaiting_human_review'],
      ['f2', 'merged'],
    ]);
    expect(findStaleOnBoot(open, stages).map((i) => i.id)).toEqual(['verify_failed-drop']);
  });

  it('server_outage löst sich NIE automatisch — weder zur Laufzeit noch beim Boot (C4.6, C4.7)', () => {
    // Ein Ausfall ist ein Ereignis der Vergangenheit; es gibt keinen aktiven Zustand, an dem
    // er sich prüfen liesse. Der Boot-Fall ist der kritische: dort wird die Meldung gerade
    // angelegt und dürfte im selben Lauf nicht wieder verschwinden.
    const open = [item('server_outage', { id: 'ausfall', featureId: null })];
    const working: LiveSessionState = { sessionId: 's1', status: 'working', featureId: 'f1', conversationId: null };

    expect(findStaleRuntime(open, snap([working], [['f1', 'merged']]))).toEqual([]);
    expect(findStaleOnBoot(open, new Map())).toEqual([]);
    expect(findStaleOnBoot(open, new Map([['f1', 'merged' as IntegrationStage]]))).toEqual([]);
    expect(isAttentionValid(open[0]!, snap())).toBe(true);
  });

  it('approval_required löst sich NUR explizit: bleibt über Boot, Stage-Wechsel UND laufende Arbeit', () => {
    // Freigabebedarf ist eine stehende menschliche Entscheidung — da gibt es weiterhin etwas zu
    // tun. Weder Boot noch Integration-Stage-Wechsel noch eine wieder arbeitende Session lösen ihn;
    // nur Approve/Discard/Neustart der Phase bzw. „Erledigt".
    const open = [item('approval_required', { id: 'appr', featureId: 'f1' })];
    const working: LiveSessionState = { sessionId: 's1', status: 'working', featureId: 'f1', conversationId: null };
    expect(findStaleOnBoot(open, new Map([['f1', 'none' as IntegrationStage]]))).toEqual([]);
    expect(findStaleRuntime(open, snap([working], [['f1', 'merged']]))).toEqual([]);
  });
});

/**
 * Datenbefunde der Plausibilitätsprüfung sind KEINE Prozess-Meldungen: der
 * Widerspruch steht in der Datenbank und verschwindet nicht, weil ein Agent wieder
 * arbeitet (FR-016) oder das Toolkit neu startet (FR-017). Genau darum bekamen sie
 * eigene Arten statt sich `agent_errored` zu leihen.
 */
describe('isAttentionValid — Datenbefunde (Plausibilitätsprüfung)', () => {
  const BEFUNDE = ['run_unpriced', 'phase_false_start', 'project_without_runs', 'metering_conflict'] as const;

  it.each(BEFUNDE)('%s bleibt gültig, während eine Session desselben Features arbeitet (US4-4, FR-016)', (kind) => {
    const working: LiveSessionState = { sessionId: 's1', status: 'working', featureId: 'f1', conversationId: null };
    expect(isAttentionValid(item(kind, { featureId: 'f1' }), snap([working]))).toBe(true);
  });

  it.each(BEFUNDE)('%s bleibt gültig bei einem Wechsel der Integrations-Stufe', (kind) => {
    expect(isAttentionValid(item(kind, { featureId: 'f1' }), snap([], [['f1', 'merged']]))).toBe(true);
  });

  it.each(BEFUNDE)('%s bleibt gültig ohne Feature-Bezug (projektweite Befunde)', (kind) => {
    expect(isAttentionValid(item(kind, { featureId: null }), snap([]))).toBe(true);
  });

  it('findStaleRuntime räumt keinen Datenbefund ab, auch nicht bei arbeitender Session (FR-016)', () => {
    const working: LiveSessionState = { sessionId: 's1', status: 'working', featureId: 'f1', conversationId: null };
    const open = BEFUNDE.map((k) => item(k, { featureId: 'f1' }));
    expect(findStaleRuntime(open, snap([working]))).toEqual([]);
  });

  it('findStaleOnBoot liefert keine der vier neuen Arten — sie überleben den Neustart (US4-5, FR-017)', () => {
    const open = [
      ...BEFUNDE.map((k) => item(k, { featureId: 'f1' })),
      ...BEFUNDE.map((k) => item(k, { id: 'projektweit', featureId: null })),
    ];
    expect(findStaleOnBoot(open, new Map())).toEqual([]);
    expect(findStaleOnBoot(open, new Map([['f1', 'merged' as IntegrationStage]]))).toEqual([]);
  });

  it('keiner der vier Befunde ist an eine Integrations-Stufe gebunden', () => {
    for (const kind of BEFUNDE) expect(STAGE_FOR_KIND[kind]).toBeUndefined();
  });
});

/**
 * Feature "eigene-schritte-an-den-lebenszyklus-haengen": ein fehlgeschlagener
 * blockierender Schritt ist eine stehende Meldung. Ein `pnpm install`, das rot war,
 * wird nicht dadurch grün, dass irgendeine Session desselben Features arbeitet oder
 * die Integration eine Stufe weiterrückt — beides würde bei `phase_gate_failed`
 * greifen und genau deshalb ist die Art eigen.
 */
describe('isAttentionValid — lifecycle_step_failed', () => {
  const open = [item('lifecycle_step_failed', { id: 'step', featureId: 'f1' })];

  it('überlebt eine laufende Session desselben Features', () => {
    const working: LiveSessionState = { sessionId: 's1', status: 'working', featureId: 'f1', conversationId: null };
    expect(isAttentionValid(open[0]!, snap([working]))).toBe(true);
    expect(findStaleRuntime(open, snap([working]))).toEqual([]);
  });

  it('überlebt jeden Stufenwechsel der Integration', () => {
    for (const stage of ['none', 'verifying', 'awaiting_human_review', 'merged'] as IntegrationStage[]) {
      expect(findStaleRuntime(open, snap([], [['f1', stage]]))).toEqual([]);
    }
  });

  it('überlebt den Neustart (nicht stale beim Boot)', () => {
    expect(findStaleOnBoot(open, new Map([['f1', 'none' as IntegrationStage]]))).toEqual([]);
    // Auch ohne bekannten Stage-Eintrag — die Meldung hängt an keiner Stage.
    expect(findStaleOnBoot(open, new Map())).toEqual([]);
  });

  it('Gegenprobe: phase_gate_failed wird von einer arbeitenden Session ungültig', () => {
    const working: LiveSessionState = { sessionId: 's1', status: 'working', featureId: 'f1', conversationId: null };
    const gate = [item('phase_gate_failed', { id: 'gate', featureId: 'f1' })];
    expect(findStaleRuntime(gate, snap([working])).map((i) => i.id)).toEqual(['phase_gate_failed-gate']);
    expect(findStaleRuntime(open, snap([working]))).toEqual([]);
  });
});
