import { describe, it, expect } from 'vitest';
import { parseOtlpLogs } from './telemetryEvent.js';

/**
 * Beispieldaten aus dem verifizierten Mitschnitt gegen Claude Code 2.1.220
 * (research.md D1). Die Struktur ist damit nicht angenommen, sondern belegt.
 */
function record(attrs: Record<string, unknown>, timeUnixNano = '1785150142488000000') {
  return {
    timeUnixNano,
    body: { stringValue: 'claude_code.api_request' },
    attributes: Object.entries(attrs).map(([key, value]) => ({ key, value })),
  };
}

const apiRequestAttrs = {
  'sdd.session.id': { stringValue: 'sess-abc' },
  'session.id': { stringValue: '65aa32c1-0173-4b7e-b52c-1ec549498616' },
  model: { stringValue: 'claude-opus-5' },
  input_tokens: { intValue: 2 },
  output_tokens: { intValue: 4 },
  cache_read_tokens: { intValue: 15273 },
  cache_creation_tokens: { intValue: 8271 },
  cost_usd_micros: { intValue: 90457 },
  request_id: { stringValue: 'req_011CdST19ne3fMRQ6CdysbFp' },
  query_source: { stringValue: 'sdk' },
};

function body(records: unknown[], resourceAttrs: Record<string, unknown> = {}) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: Object.entries(resourceAttrs).map(([key, value]) => ({ key, value })),
        },
        scopeLogs: [{ scope: { name: 'com.anthropic.claude_code.events' }, logRecords: records }],
      },
    ],
  };
}

describe('parseOtlpLogs', () => {
  it('liest einen echten api_request-Datensatz vollständig aus', () => {
    const events = parseOtlpLogs(body([record(apiRequestAttrs)]));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      requestId: 'req_011CdST19ne3fMRQ6CdysbFp',
      at: 1785150142488,
      sddSessionId: 'sess-abc',
      sddRunId: null,
      claudeSessionId: '65aa32c1-0173-4b7e-b52c-1ec549498616',
      model: 'claude-opus-5',
      inputTokens: 2,
      outputTokens: 4,
      cacheReadTokens: 15273,
      cacheCreationTokens: 8271,
      costMicros: 90457,
      origin: 'main',
    });
  });

  it('wertet ausschliesslich claude_code.api_request aus — Inhaltsereignisse fallen weg (FR-027)', () => {
    const other = [
      { timeUnixNano: '1785150142000000000', body: { stringValue: 'claude_code.user_prompt' }, attributes: [{ key: 'prompt', value: { stringValue: 'GEHEIMER TEXT' } }] },
      { timeUnixNano: '1785150142000000000', body: { stringValue: 'claude_code.assistant_response' }, attributes: [{ key: 'response', value: { stringValue: 'ANTWORT' } }] },
      { timeUnixNano: '1785150142000000000', body: { stringValue: 'claude_code.tool_result' }, attributes: [] },
    ];
    expect(parseOtlpLogs(body(other))).toEqual([]);
    expect(JSON.stringify(parseOtlpLogs(body([...other, record(apiRequestAttrs)])))).not.toContain('GEHEIM');
  });

  it('liest intValue als String und als Zahl', () => {
    const asString = parseOtlpLogs(
      body([record({ ...apiRequestAttrs, input_tokens: { intValue: '4242' }, cost_usd_micros: { intValue: '999' } })]),
    );
    expect(asString[0]!.inputTokens).toBe(4242);
    expect(asString[0]!.costMicros).toBe(999);
  });

  it('nimmt die Marke auch dann, wenn sie nur auf Ressourcen-Ebene steht', () => {
    const attrs = { ...apiRequestAttrs };
    delete (attrs as Record<string, unknown>)['sdd.session.id'];
    const events = parseOtlpLogs(body([record(attrs)], { 'sdd.session.id': { stringValue: 'nur-ressource' } }));
    expect(events).toHaveLength(1);
    expect(events[0]!.sddSessionId).toBe('nur-ressource');
  });

  it('erkennt die Headless-Marke sdd.run.id', () => {
    const attrs = { ...apiRequestAttrs };
    delete (attrs as Record<string, unknown>)['sdd.session.id'];
    const events = parseOtlpLogs(body([record({ ...attrs, 'sdd.run.id': { stringValue: 'exec-1' } })]));
    expect(events[0]!.sddRunId).toBe('exec-1');
    expect(events[0]!.sddSessionId).toBeNull();
  });

  it('verwirft Datensätze ohne jede sdd-Marke — fremde Sessions zählen nie (FR-003)', () => {
    const attrs = { ...apiRequestAttrs };
    delete (attrs as Record<string, unknown>)['sdd.session.id'];
    expect(parseOtlpLogs(body([record(attrs)]))).toEqual([]);
  });

  it('überspringt Datensätze ohne request_id oder ohne Zeitstempel', () => {
    const noId = { ...apiRequestAttrs };
    delete (noId as Record<string, unknown>).request_id;
    expect(parseOtlpLogs(body([record(noId)]))).toEqual([]);

    const noTime = record(apiRequestAttrs, '');
    expect(parseOtlpLogs(body([noTime]))).toEqual([]);
  });

  it('setzt fehlende Cache-Werte auf 0, fehlenden Betrag auf null (FR-023)', () => {
    const lean = { ...apiRequestAttrs };
    delete (lean as Record<string, unknown>).cache_read_tokens;
    delete (lean as Record<string, unknown>).cache_creation_tokens;
    delete (lean as Record<string, unknown>).cost_usd_micros;
    const e = parseOtlpLogs(body([record(lean)]))[0]!;
    expect(e.cacheReadTokens).toBe(0);
    expect(e.cacheCreationTokens).toBe(0);
    expect(e.costMicros).toBeNull();
  });

  it('wirft nie — kaputte oder fremde Strukturen liefern eine leere Liste', () => {
    expect(parseOtlpLogs(null)).toEqual([]);
    expect(parseOtlpLogs('kein objekt')).toEqual([]);
    expect(parseOtlpLogs({})).toEqual([]);
    expect(parseOtlpLogs({ resourceLogs: 'kein array' })).toEqual([]);
    expect(parseOtlpLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [{}] }] }] })).toEqual([]);
    expect(parseOtlpLogs({ resourceLogs: [null] })).toEqual([]);
  });

  it('liest mehrere Datensätze aus mehreren Stapeln', () => {
    const events = parseOtlpLogs(
      body([
        record(apiRequestAttrs),
        record({ ...apiRequestAttrs, request_id: { stringValue: 'req_2' } }, '1785150143000000000'),
      ]),
    );
    expect(events.map((e) => e.requestId)).toEqual(['req_011CdST19ne3fMRQ6CdysbFp', 'req_2']);
  });
});
