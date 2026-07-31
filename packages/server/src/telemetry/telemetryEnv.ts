/**
 * Umgebung der vom Toolkit gestarteten Claude-Prozesse (Feature
 * "token-und-kostenmessung...", contracts/telemetry-env.md).
 *
 * Diese Variablen gehen ausschliesslich in die Umgebung eigener Kindprozesse —
 * nie in die Umgebung des Nutzers und nie in seine `~/.claude/settings.json`.
 * Sessions, die der Nutzer selbst startet, bleiben unberührt.
 *
 * WICHTIG (empirisch geklärt, research.md D5): Der `env`-Block einer Settings-Datei
 * SCHLÄGT die Prozessumgebung. Diese Werte müssen deshalb zusätzlich in den
 * `env`-Block der je Session geschriebenen Settings-Datei — die Prozessumgebung
 * allein genügt nicht, wenn der Nutzer gegenläufige Einträge in seinen Settings hat.
 */

/** Marke, mit der ein Prozess seine Meldungen kennzeichnet. */
export type TelemetryMark = { sessionId: string } | { runId: string };

/** Empfangsendpunkt — immer Loopback, es verlässt nichts den Rechner (FR-028). */
export function telemetryEndpoint(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Zulässigkeit eines Ressourcen-Attributwerts nach der Prüfung der CLI:
 * druckbares ASCII (33..126), ohne `,` `;` `\`, höchstens 255 Zeichen.
 * Verletzt ein Wert das, verwirft die CLI die GESAMTE Liste still — dann käme keine
 * Zuordnung mehr an. Wir lassen die Marke in dem Fall lieber weg.
 */
function isValidAttrValue(v: string): boolean {
  if (v.length === 0 || v.length > 255) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 33 || c > 126) return false;
    if (c === 44 /* , */ || c === 59 /* ; */ || c === 92 /* \ */) return false;
  }
  return true;
}

function markPair(mark: TelemetryMark): { key: string; value: string } {
  return 'sessionId' in mark
    ? { key: 'sdd.session.id', value: mark.sessionId }
    : { key: 'sdd.run.id', value: mark.runId };
}

/**
 * Telemetrie-Variablen für einen Kindprozess.
 *
 * `inherited` ist die Umgebung, in die hinein gemischt wird — daraus wird eine
 * bestehende `OTEL_RESOURCE_ATTRIBUTES`-Liste des Nutzers übernommen und die eigene
 * Marke angehängt, statt sie zu ersetzen.
 */
export function telemetryEnvFor(
  mark: TelemetryMark,
  port: number,
  inherited: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: telemetryEndpoint(port),
    // Entspricht der Voreinstellung; explizit gesetzt, damit eine abweichende
    // Nutzerkonfiguration die Nachlaufzeit eines Laufs nicht verlängert.
    OTEL_LOGS_EXPORT_INTERVAL: '5000',
    // Inhaltsdaten bleiben aus (FR-027). Das ist bereits die Voreinstellung der CLI —
    // explizit gesetzt bleibt es richtig, auch wenn der Nutzer sie global umstellt.
    OTEL_LOG_USER_PROMPTS: '0',
    OTEL_LOG_ASSISTANT_RESPONSES: '0',
    OTEL_LOG_TOOL_CONTENT: '0',
    OTEL_LOG_TOOL_DETAILS: '0',
    OTEL_LOG_RAW_API_BODIES: '0',
  };

  const { key, value } = markPair(mark);
  if (isValidAttrValue(value)) {
    const existing = inherited.OTEL_RESOURCE_ATTRIBUTES?.trim();
    env.OTEL_RESOURCE_ATTRIBUTES = existing ? `${existing},${key}=${value}` : `${key}=${value}`;
  } else {
    console.warn(`[telemetry] Marke '${value}' ist als Ressourcen-Attribut unzulässig — Lauf wird über das Transkript gemessen`);
  }

  return env;
}

/**
 * Hat der Nutzer eine eigene, abweichende OTel-Konfiguration geerbt? Dann übersteuert
 * das Toolkit sie für seine eigenen Prozesse — das darf nicht still geschehen (D5),
 * sondern wird über den Statusendpunkt in den Einstellungen sichtbar gemacht.
 */
export function detectForeignOtelConfig(env: Record<string, string | undefined>): boolean {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(endpoint)) return true;
  const logs = env.OTEL_LOGS_EXPORTER;
  if (logs && logs !== 'otlp') return true;
  return false;
}
