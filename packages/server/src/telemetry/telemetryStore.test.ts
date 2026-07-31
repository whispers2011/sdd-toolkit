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

  /**
   * Am 30.07.2026 verlor ein 33-Minuten-Lauf ~83 % seines Verbrauchs, weil der Kehraus
   * seine frühen Meldungen verwarf, bevor der Lauf sie zum ersten Mal verrechnen konnte.
   * „Kein offener Lauf mehr" ist eine Frage der Zuordnung, nicht des Alters.
   */
  describe('offener Lauf schützt seine Meldungen vor dem Kehraus', () => {
    it('behält Ereignisse eines angemeldeten Laufs, auch weit hinter dem Nachlauffenster', () => {
      vi.setSystemTime(100_000);
      store.hold('sess');
      store.ingest([ev({ requestId: 'früh', at: 100_000 })]);

      // Der Lauf läuft noch — eine Stunde später gilt das immer noch.
      vi.setSystemTime(100_000 + 60 * 60_000);
      store.sweep();

      expect(store.eventsFor('sess')).toHaveLength(1);
    });

    it('gibt den Puffer nach dem Abmelden wieder frei', () => {
      vi.setSystemTime(100_000);
      store.hold('sess');
      store.ingest([ev({ requestId: 'alt', at: 100_000 })]);
      vi.setSystemTime(100_000 + 6 * 60_000);
      store.sweep();
      expect(store.eventsFor('sess')).toHaveLength(1);

      store.release('sess');
      store.sweep();
      expect(store.eventsFor('sess')).toHaveLength(0);
    });

    /**
     * Ein Puffer gehört der SESSION, nicht dem einzelnen Lauf. Bei Chats überlappen sich
     * die Nachlauffenster zweier Turns fast immer — Turns liegen Sekunden auseinander,
     * das Fenster ist fünf Minuten offen. Vorher entzog das Fensterende von Turn A dem
     * laufenden Turn B den Schutz mitsamt seiner Meldungen (FR-007a).
     */
    it('hält den Puffer, solange noch ein Lauf offen ist (T1)', () => {
      vi.setSystemTime(100_000);
      store.hold('sess'); // Turn A
      store.ingest([ev({ requestId: 'a', at: 100_000 })]);
      store.hold('sess'); // Turn B startet, während A noch nachträgt

      store.release('sess'); // Nachlauffenster von A läuft ab
      vi.setSystemTime(100_000 + 6 * 60_000);
      store.sweep();

      expect(store.eventsFor('sess')).toHaveLength(1); // B hat seine Meldungen noch
    });

    it('gibt erst mit dem letzten Abmelder frei (T1)', () => {
      vi.setSystemTime(100_000);
      store.hold('sess');
      store.hold('sess');
      store.ingest([ev({ requestId: 'a', at: 100_000 })]);

      store.release('sess');
      store.release('sess'); // jetzt ist keiner mehr offen
      vi.setSystemTime(100_000 + 6 * 60_000);
      store.sweep();

      expect(store.eventsFor('sess')).toHaveLength(0);
    });

    it('verwirft beim Abmelden nichts — der Kehraus nach Alter übernimmt (T3)', () => {
      vi.setSystemTime(100_000);
      store.hold('sess');
      store.ingest([ev({ requestId: 'frisch', at: 100_000 })]);

      store.release('sess'); // kein forget: der Puffer bleibt zunächst stehen

      expect(store.eventsFor('sess')).toHaveLength(1);
      store.sweep(); // noch innerhalb des Nachlauffensters
      expect(store.eventsFor('sess')).toHaveLength(1);
    });

    it('lässt den Zähler nicht negativ werden (T2)', () => {
      vi.setSystemTime(100_000);
      store.release('sess'); // Abmelden ohne Anmelden — darf nicht ins Minus laufen
      store.release('sess');

      store.hold('sess'); // ein einziges hold muss danach wieder schützen
      store.ingest([ev({ requestId: 'a', at: 100_000 })]);
      vi.setSystemTime(100_000 + 6 * 60_000);
      store.sweep();

      expect(store.eventsFor('sess')).toHaveLength(1);
    });

    it('schützt nur die angemeldete Marke, nicht die Nachbarn', () => {
      vi.setSystemTime(100_000);
      store.hold('sess');
      store.ingest([ev({ requestId: 'meins', at: 100_000 })]);
      store.ingest([ev({ requestId: 'fremd', at: 100_000, sddSessionId: 'andere' })]);

      vi.setSystemTime(100_000 + 6 * 60_000);
      store.sweep();

      expect(store.eventsFor('sess')).toHaveLength(1);
      expect(store.eventsFor('andere')).toHaveLength(0);
    });

    it('forget meldet den Lauf mit ab — danach greift der Kehraus wieder', () => {
      vi.setSystemTime(100_000);
      store.hold('sess');
      store.ingest([ev({ requestId: 'a', at: 100_000 })]);
      store.forget('sess');

      store.ingest([ev({ requestId: 'b', at: 100_000 })]);
      vi.setSystemTime(100_000 + 6 * 60_000);
      store.sweep();

      expect(store.eventsFor('sess')).toHaveLength(0);
    });
  });

  it('meldet einen unbekannten Schlüssel als leer statt zu werfen', () => {
    expect(store.eventsFor('gibtsnicht')).toEqual([]);
  });

  it('verwirft Ereignisse ohne jede Marke', () => {
    store.ingest([ev({ requestId: 'a', sddSessionId: null, sddRunId: null })]);
    expect(store.stats().eventsReceived).toBe(0);
  });
});
