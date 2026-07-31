import { describe, it, expect } from 'vitest';
import { detectForeignOtelConfig, telemetryEnvFor, telemetryEndpoint } from './telemetryEnv.js';

describe('telemetryEnvFor', () => {
  it('schaltet die Telemetrie ein und schickt Ereignisse an den lokalen Server', () => {
    const env = telemetryEnvFor({ sessionId: 'sess1' }, 4820);
    expect(env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1');
    expect(env.OTEL_LOGS_EXPORTER).toBe('otlp');
    expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe('http/json');
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://127.0.0.1:4820');
  });

  it('lässt Metriken und Traces aus (research.md D1/D7)', () => {
    const env = telemetryEnvFor({ sessionId: 'sess1' }, 4820);
    expect(env.OTEL_METRICS_EXPORTER).toBeUndefined();
    expect(env.OTEL_TRACES_EXPORTER).toBeUndefined();
  });

  it('schaltet alle Inhaltsdaten ausdrücklich ab (FR-027)', () => {
    const env = telemetryEnvFor({ sessionId: 'sess1' }, 4820);
    for (const key of [
      'OTEL_LOG_USER_PROMPTS',
      'OTEL_LOG_ASSISTANT_RESPONSES',
      'OTEL_LOG_TOOL_CONTENT',
      'OTEL_LOG_TOOL_DETAILS',
      'OTEL_LOG_RAW_API_BODIES',
    ]) {
      expect(env[key]).toBe('0');
    }
  });

  it('setzt die Session-Marke für interaktive Sessions', () => {
    expect(telemetryEnvFor({ sessionId: 'abc123' }, 4820).OTEL_RESOURCE_ATTRIBUTES).toBe('sdd.session.id=abc123');
  });

  it('setzt die Lauf-Marke für Headless-Läufe', () => {
    expect(telemetryEnvFor({ runId: 'exec99' }, 4820).OTEL_RESOURCE_ATTRIBUTES).toBe('sdd.run.id=exec99');
  });

  it('hängt die Marke an bestehende Attribute des Nutzers an, statt sie zu ersetzen', () => {
    const env = telemetryEnvFor({ sessionId: 'abc' }, 4820, { OTEL_RESOURCE_ATTRIBUTES: 'team.id=platform,dept=eng' });
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toBe('team.id=platform,dept=eng,sdd.session.id=abc');
  });

  it('lässt die Marke weg, statt eine unzulässige Liste zu erzeugen', () => {
    // Die CLI verwirft bei einem ungültigen Zeichen die GESAMTE Liste — dann käme
    // gar keine Zuordnung an. Lieber die Marke weglassen als alles zu verlieren.
    for (const bad of ['a,b', 'a;b', 'a\\b', 'ä', 'x'.repeat(256)]) {
      const env = telemetryEnvFor({ sessionId: bad }, 4820);
      expect(env.OTEL_RESOURCE_ATTRIBUTES).toBeUndefined();
    }
  });

  it('akzeptiert die üblichen nanoid-Schlüssel', () => {
    const env = telemetryEnvFor({ sessionId: 'V1StGXR8_Z' }, 4820);
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toBe('sdd.session.id=V1StGXR8_Z');
  });
});

describe('telemetryEndpoint', () => {
  it('bindet immer an die Loopback-Adresse — nie nach aussen (FR-028)', () => {
    expect(telemetryEndpoint(4899)).toBe('http://127.0.0.1:4899');
  });
});

describe('detectForeignOtelConfig', () => {
  it('meldet nichts, wenn der Nutzer keine OTel-Konfiguration hat', () => {
    expect(detectForeignOtelConfig({ PATH: '/usr/bin' })).toBe(false);
  });

  it('erkennt einen abweichenden Endpunkt des Nutzers', () => {
    expect(detectForeignOtelConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.firma.example' })).toBe(true);
  });

  it('erkennt einen abweichenden Exporter', () => {
    expect(detectForeignOtelConfig({ OTEL_LOGS_EXPORTER: 'console' })).toBe(true);
  });

  it('meldet nichts bei einer bereits eingeschalteten, aber gleichlautenden Konfiguration', () => {
    expect(detectForeignOtelConfig({ CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp' })).toBe(false);
  });
});
