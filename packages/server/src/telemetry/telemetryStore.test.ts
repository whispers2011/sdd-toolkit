import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetryStore } from './telemetryStore.js';
import type { UsageEvent } from '@sdd/shared';

function ev(over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    requestId: over.requestId ?? 'req_1',
    at: over.at ?? 1_000,
    sddSessionId: over.sddSessionId === undefined ? 'sess' : over.sddSessionId,
    sddRunId: over.sddRunId ?? null,
    claudeSessionId: 'claude-uuid',
    model: over.model ?? 'claude-opus-5',
    inputTokens: over.inputTokens ?? 1,
    outputTokens: over.outputTokens ?? 2,
    cacheReadTokens: over.cacheReadTokens ?? 3,
    cacheCreationTokens: over.cacheCreationTokens ?? 4,
    costMicros: over.costMicros === undefined ? 100 : over.costMicros,
    origin: over.origin ?? 'main',
  };
}

describe('TelemetryStore', () => {
  let store: TelemetryStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new TelemetryStore();
  });
  afterEach(() => {
    store.stop();
    vi.useRealTimers();
  });

  it('legt Ereignisse unter der Marke ihrer Session ab', () => {
    store.ingest([ev({ requestId: 'a', sddSessionId: 's1' }), ev({ requestId: 'b', sddSessionId: 's2' })]);
    expect(store.eventsFor('s1').map((e) => e.requestId)).toEqual(['a']);
    expect(store.eventsFor('s2').map((e) => e.requestId)).toEqual(['b']);
  });

  it('nimmt auch die Headless-Marke sdd.run.id als Schlüssel', () => {
    store.ingest([ev({ requestId: 'a', sddSessionId: null, sddRunId: 'exec1' })]);
    expect(store.eventsFor('exec1').map((e) => e.requestId)).toEqual(['a']);
  });

  it('zählt dieselbe requestId nur einmal, auch über mehrere Stapel (FR-006)', () => {
    store.ingest([ev({ requestId: 'x' })]);
    store.ingest([ev({ requestId: 'x' }), ev({ requestId: 'y' })]);
    expect(store.eventsFor('sess').map((e) => e.requestId)).toEqual(['x', 'y']);
  });

  it('hält die Ereignisse nach Zeit sortiert, auch bei verspäteten Stapeln', () => {
    store.ingest([ev({ requestId: 'spaet', at: 5_000 })]);
    store.ingest([ev({ requestId: 'frueh', at: 1_000 })]);
    expect(store.eventsFor('sess').map((e) => e.requestId)).toEqual(['frueh', 'spaet']);
  });

  it('zählt nur verwertete Ereignisse für den Statusendpunkt', () => {
    expect(store.stats().eventsReceived).toBe(0);
    store.ingest([ev({ requestId: 'a', at: 4_242 })]);
    store.ingest([ev({ requestId: 'a', at: 4_242 })]); // Dublette
    expect(store.stats().eventsReceived).toBe(1);
    expect(store.stats().lastEventAt).toBe(4_242);
  });

  it('deckelt die Menge je Puffer und wirft die ältesten zuerst raus (FR-030)', () => {
    const store2 = new TelemetryStore({ maxEventsPerKey: 3 });
    store2.ingest([
      ev({ requestId: 'a', at: 1 }),
      ev({ requestId: 'b', at: 2 }),
      ev({ requestId: 'c', at: 3 }),
      ev({ requestId: 'd', at: 4 }),
    ]);
    expect(store2.eventsFor('sess').map((e) => e.requestId)).toEqual(['b', 'c', 'd']);
    store2.stop();
  });

  it('entfernt beim Kehraus Ereignisse ausserhalb des Nachlauffensters (FR-030)', () => {
    vi.setSystemTime(100_000);
    store.ingest([ev({ requestId: 'alt', at: 100_000 })]);
    expect(store.eventsFor('sess')).toHaveLength(1);

    // Weit hinter dem Nachlauffenster von 5 Minuten.
    vi.setSystemTime(100_000 + 6 * 60_000);
    store.sweep();
    expect(store.eventsFor('sess')).toHaveLength(0);
  });

  it('behält Ereignisse innerhalb des Nachlauffensters', () => {
    vi.setSystemTime(100_000);
    store.ingest([ev({ requestId: 'frisch', at: 100_000 })]);
    vi.setSystemTime(100_000 + 60_000);
    store.sweep();
    expect(store.eventsFor('sess')).toHaveLength(1);
  });

  it('räumt den Puffer einer beendeten Session vollständig ab', () => {
    store.ingest([ev({ requestId: 'a' })]);
    store.forget('sess');
    expect(store.eventsFor('sess')).toHaveLength(0);
  });

  it('meldet einen unbekannten Schlüssel als leer statt zu werfen', () => {
    expect(store.eventsFor('gibtsnicht')).toEqual([]);
  });

  it('verwirft Ereignisse ohne jede Marke', () => {
    store.ingest([ev({ requestId: 'a', sddSessionId: null, sddRunId: null })]);
    expect(store.stats().eventsReceived).toBe(0);
  });
});
