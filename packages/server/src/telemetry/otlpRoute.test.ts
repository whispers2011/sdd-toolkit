import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerOtlpRoute } from './otlpRoute.js';
import { TelemetryStore } from './telemetryStore.js';

function apiRequestBody(mark = 'sess-1', requestId = 'req_1') {
  return {
    resourceLogs: [
      {
        resource: { attributes: [{ key: 'sdd.session.id', value: { stringValue: mark } }] },
        scopeLogs: [
          {
            scope: { name: 'com.anthropic.claude_code.events' },
            logRecords: [
              {
                timeUnixNano: '1785150142488000000',
                body: { stringValue: 'claude_code.api_request' },
                attributes: [
                  { key: 'request_id', value: { stringValue: requestId } },
                  { key: 'model', value: { stringValue: 'claude-opus-5' } },
                  { key: 'input_tokens', value: { intValue: 2 } },
                  { key: 'output_tokens', value: { intValue: 4 } },
                  { key: 'cost_usd_micros', value: { intValue: 90457 } },
                  { key: 'query_source', value: { stringValue: 'sdk' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('POST /v1/logs', () => {
  let app: FastifyInstance;
  let store: TelemetryStore;

  beforeEach(async () => {
    store = new TelemetryStore({ autoSweep: false });
    app = Fastify();
    registerOtlpRoute(app, store);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    store.stop();
  });

  const post = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/v1/logs', payload: payload as object, headers: { 'content-type': 'application/json' } });

  it('nimmt einen gültigen Stapel an und legt ihn ab', async () => {
    const res = await post(apiRequestBody());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
    expect(store.stats().eventsReceived).toBe(1);
    expect(store.eventsFor('sess-1')).toHaveLength(1);
  });

  it('antwortet auch auf kaputtes JSON mit 200 — sonst wiederholt der Exporter (FR-006)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/logs',
      payload: '{kein gueltiges json',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(store.stats().eventsReceived).toBe(0);
  });

  it('antwortet auf einen Rumpf ohne resourceLogs mit 200 und verwertet nichts', async () => {
    const res = await post({ irgendwas: true });
    expect(res.statusCode).toBe(200);
    expect(store.stats().eventsReceived).toBe(0);
  });

  it('verwirft fremde Ereignisse still — nur api_request zählt (FR-027)', async () => {
    const body = apiRequestBody();
    body.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.body.stringValue = 'claude_code.user_prompt';
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    expect(store.stats().eventsReceived).toBe(0);
  });

  it('verwirft Meldungen ohne sdd-Marke — fremde Sessions zählen nie (FR-003)', async () => {
    const body = apiRequestBody();
    body.resourceLogs[0]!.resource.attributes = [];
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    expect(store.stats().eventsReceived).toBe(0);
  });

  it('zählt einen wiederholt gelieferten Stapel nur einmal (FR-006)', async () => {
    await post(apiRequestBody('sess-1', 'req_gleich'));
    await post(apiRequestBody('sess-1', 'req_gleich'));
    expect(store.stats().eventsReceived).toBe(1);
  });
});
