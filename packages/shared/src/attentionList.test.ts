import { describe, expect, it } from 'vitest';
import { applyAttentionResolved } from './attentionList.js';
import type { AttentionItem, AttentionKind } from './types.js';

function item(over: Partial<AttentionItem> & { id: string }): AttentionItem {
  return {
    kind: 'awaiting_input' as AttentionKind,
    projectId: 'p1',
    featureId: null,
    sessionId: null,
    conversationId: null,
    message: 'Meldung',
    createdAt: 1,
    resolvedAt: null,
    ...over,
  };
}

describe('applyAttentionResolved', () => {
  it('entfernt genau die Meldung mit dieser id und lässt die übrigen unverändert (V8, A1/A2, FR-010a)', () => {
    const a = item({ id: 'a1' });
    const b = item({ id: 'b2' });
    const c = item({ id: 'c3' });

    const result = applyAttentionResolved([a, b, c], 'b2');

    expect(result.map((i) => i.id)).toEqual(['a1', 'c3']);
    // Identität und Reihenfolge der übrigen bleiben erhalten (A2).
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(c);
  });

  it('entfernt nichts bei einer featureId (V9, A3, FR-010b)', () => {
    const items = [item({ id: 'a1', featureId: 'f1' }), item({ id: 'b2', featureId: 'f1' })];

    expect(applyAttentionResolved(items, 'f1')).toHaveLength(2);
  });

  it('entfernt nichts bei einer sessionId (V9, A3, FR-010b)', () => {
    const items = [item({ id: 'a1', sessionId: 's1' }), item({ id: 'b2', sessionId: 's1' })];

    expect(applyAttentionResolved(items, 's1')).toHaveLength(2);
  });

  it('entfernt nichts bei einer conversationId (V9, A3, FR-010b)', () => {
    const items = [item({ id: 'a1', conversationId: 'c1' })];

    expect(applyAttentionResolved(items, 'c1')).toHaveLength(1);
  });

  it('entfernt nichts bei einer unbekannten Kennung (V9, A4)', () => {
    const items = [item({ id: 'a1' }), item({ id: 'b2' })];

    expect(applyAttentionResolved(items, 'gibt-es-nicht').map((i) => i.id)).toEqual(['a1', 'b2']);
  });

  it('entfernt mehrere Meldungen derselben Session nur einzeln (V10, A5)', () => {
    const items = [
      item({ id: 'a1', sessionId: 's1', kind: 'awaiting_input' }),
      item({ id: 'b2', sessionId: 's1', kind: 'permission_request' }),
    ];

    const nachErster = applyAttentionResolved(items, 'a1');
    expect(nachErster.map((i) => i.id)).toEqual(['b2']);

    expect(applyAttentionResolved(nachErster, 'b2')).toEqual([]);
  });

  it('lässt eine neu entstandene Meldung derselben Session stehen (Edge Case „direkt neu erzeugt")', () => {
    const alt = item({ id: 'alt', sessionId: 's1' });
    const neu = item({ id: 'neu', sessionId: 's1', createdAt: 2 });

    // Die Auflösung der Vorgängerin darf die frische Meldung nicht mitentfernen.
    expect(applyAttentionResolved([alt, neu], 'alt').map((i) => i.id)).toEqual(['neu']);
  });

  it('gibt bei leerer Eingabeliste eine leere Liste zurück, ohne Fehler (A6)', () => {
    expect(applyAttentionResolved([], 'a1')).toEqual([]);
  });

  it('verändert die Eingabeliste nicht (A7)', () => {
    const items = [item({ id: 'a1' }), item({ id: 'b2' })];

    applyAttentionResolved(items, 'a1');

    expect(items.map((i) => i.id)).toEqual(['a1', 'b2']);
  });

  it('ist idempotent: ein zweiter Aufruf mit derselben id ändert nichts mehr (A8)', () => {
    const items = [item({ id: 'a1' }), item({ id: 'b2' })];

    const erster = applyAttentionResolved(items, 'a1');
    const zweiter = applyAttentionResolved(erster, 'a1');

    expect(zweiter.map((i) => i.id)).toEqual(['b2']);
  });
});
