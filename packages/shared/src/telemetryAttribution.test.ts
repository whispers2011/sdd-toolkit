import { describe, it, expect } from 'vitest';
import { classifyOrigin, selectEventsForWindow, summarizeEvents } from './telemetryAttribution.js';
import type { UsageEvent } from './telemetryEvent.js';

function ev(over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    requestId: over.requestId ?? 'req_1',
    at: over.at ?? 1_000,
    sddSessionId: over.sddSessionId ?? 'sess',
    sddRunId: over.sddRunId ?? null,
    claudeSessionId: over.claudeSessionId ?? 'claude-uuid',
    model: over.model ?? 'claude-opus-5',
    inputTokens: over.inputTokens ?? 10,
    outputTokens: over.outputTokens ?? 20,
    cacheReadTokens: over.cacheReadTokens ?? 30,
    cacheCreationTokens: over.cacheCreationTokens ?? 40,
    costMicros: over.costMicros === undefined ? 500 : over.costMicros,
    origin: over.origin ?? 'main',
  };
}

describe('classifyOrigin — exakt die Regel der CLI (research.md D4)', () => {
  it('fehlender query_source ist der Hauptagent', () => {
    expect(classifyOrigin(undefined)).toBe('main');
    expect(classifyOrigin(null)).toBe('main');
  });

  it.each(['sdk', 'repl_main_thread', 'repl_main_thread:outputStyle:custom', 'repl_main_thread:outputStyle:Learning'])(
    '%s ist Hauptagent',
    (qs) => expect(classifyOrigin(qs)).toBe('main'),
  );

  it.each(['agent:default', 'agent:builtin', 'agent:custom', 'agent:custom:explore', 'hook_agent'])(
    '%s ist Subagent',
    (qs) => expect(classifyOrigin(qs)).toBe('subagent'),
  );

  it.each(['compact', 'side_question', 'hook_prompt', 'web_search_tool', 'web_fetch_apply', 'auto_mode', 'irgendwas_neues'])(
    '%s ist Hilfsanfrage',
    (qs) => expect(classifyOrigin(qs)).toBe('auxiliary'),
  );
});

describe('selectEventsForWindow', () => {
  const events = [
    ev({ requestId: 'a', at: 500 }),
    ev({ requestId: 'b', at: 1_500 }),
    ev({ requestId: 'c', at: 2_500 }),
    ev({ requestId: 'd', at: 3_500 }),
  ];

  it('nimmt nur, was im Fenster liegt — kein Verbrauch früherer Läufe (US1 Szenario 1)', () => {
    const picked = selectEventsForWindow(events, { from: 1_000, to: 3_000 });
    expect(picked.map((e) => e.requestId)).toEqual(['b', 'c']);
  });

  it('behandelt die Grenzen einschliessend', () => {
    const picked = selectEventsForWindow(events, { from: 1_500, to: 2_500 });
    expect(picked.map((e) => e.requestId)).toEqual(['b', 'c']);
  });

  it('lässt die Obergrenze offen, solange der Lauf läuft', () => {
    const picked = selectEventsForWindow(events, { from: 1_000, to: null });
    expect(picked.map((e) => e.requestId)).toEqual(['b', 'c', 'd']);
  });

  it('zwei aufeinanderfolgende Läufe teilen kein Ereignis (US1 Szenario 2)', () => {
    const erster = selectEventsForWindow(events, { from: 0, to: 1_999 });
    const zweiter = selectEventsForWindow(events, { from: 2_000, to: 4_000 });
    const ids = new Set(erster.map((e) => e.requestId));
    expect(zweiter.every((e) => !ids.has(e.requestId))).toBe(true);
    expect([...erster, ...zweiter]).toHaveLength(4);
  });

  it('lässt Verbrauch ohne aktiven Lauf in keinem Fenster landen (FR-005)', () => {
    const drin = selectEventsForWindow(events, { from: 1_000, to: 2_000 });
    expect(drin.map((e) => e.requestId)).toEqual(['b']);
  });

  it('zählt eine wiederholt gelieferte requestId nur einmal (FR-006)', () => {
    const doppelt = [ev({ requestId: 'x', at: 1_100 }), ev({ requestId: 'x', at: 1_100 }), ev({ requestId: 'y', at: 1_200 })];
    expect(selectEventsForWindow(doppelt, { from: 0, to: null }).map((e) => e.requestId)).toEqual(['x', 'y']);
  });

  it('überspringt bereits verrechnete requestIds', () => {
    const picked = selectEventsForWindow(events, { from: 0, to: null }, new Set(['a', 'c']));
    expect(picked.map((e) => e.requestId)).toEqual(['b', 'd']);
  });
});

describe('summarizeEvents', () => {
  it('summiert die vier Token-Arten und den Betrag (FR-008, FR-021)', () => {
    const s = summarizeEvents([ev({ requestId: '1' }), ev({ requestId: '2' })]);
    expect(s.total).toMatchObject({
      inputTokens: 20,
      outputTokens: 40,
      cacheReadTokens: 60,
      cacheCreationTokens: 80,
      costMicros: 1000,
    });
    expect(s.total.tokens).toBe(200);
  });

  it('trennt Haupt-, Subagent- und Hilfsanteil (FR-009, FR-010)', () => {
    const s = summarizeEvents([
      ev({ requestId: '1', origin: 'main', outputTokens: 100 }),
      ev({ requestId: '2', origin: 'subagent', outputTokens: 200 }),
      ev({ requestId: '3', origin: 'subagent', outputTokens: 300 }),
      ev({ requestId: '4', origin: 'auxiliary', outputTokens: 400 }),
    ]);
    expect(s.byOrigin.main.outputTokens).toBe(100);
    expect(s.byOrigin.subagent.outputTokens).toBe(500);
    expect(s.byOrigin.auxiliary.outputTokens).toBe(400);
    expect(s.total.outputTokens).toBe(1000);
  });

  it('rechnet Hilfsanfragen in die Summe, aber nicht in den Subagenten-Anteil', () => {
    const s = summarizeEvents([ev({ requestId: '1', origin: 'auxiliary' })]);
    expect(s.total.tokens).toBeGreaterThan(0);
    expect(s.byOrigin.subagent.tokens).toBe(0);
  });

  it('meldet keinen Betrag, wenn kein Ereignis einen trug (FR-023)', () => {
    const s = summarizeEvents([ev({ requestId: '1', costMicros: null }), ev({ requestId: '2', costMicros: null })]);
    expect(s.total.costMicros).toBeNull();
  });

  it('summiert nur die gemeldeten Beträge, wenn einzelne fehlen', () => {
    const s = summarizeEvents([ev({ requestId: '1', costMicros: 100 }), ev({ requestId: '2', costMicros: null })]);
    expect(s.total.costMicros).toBe(100);
  });

  it('übernimmt das zuletzt gemeldete Modell (FR-013)', () => {
    const s = summarizeEvents([
      ev({ requestId: '1', model: 'claude-haiku-4-5' }),
      ev({ requestId: '2', model: 'claude-opus-5' }),
    ]);
    expect(s.model).toBe('claude-opus-5');
  });

  it('liefert für eine leere Liste ein leeres Ergebnis ohne Betrag', () => {
    const s = summarizeEvents([]);
    expect(s.total.tokens).toBe(0);
    expect(s.total.costMicros).toBeNull();
    expect(s.model).toBeNull();
  });
});
