import { describe, expect, it } from 'vitest';
import type { AttentionItem, AttentionKind, IntegrationStage } from '@sdd/shared';
import {
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
});
