/**
 * OTLP/JSON der Claude-CLI → UsageEvent (Feature "token-und-kostenmessung...", P1).
 * Reine Extraktion — keine IO, wirft nie.
 *
 * Ausgewertet wird ausschliesslich das Ereignis `claude_code.api_request`. Es trägt je
 * API-Anfrage die vier Token-Arten, den Geldbetrag, das Modell, eine `request_id` als
 * Dedupe-Schlüssel und `query_source` als Herkunft. Alles andere — insbesondere
 * `user_prompt` und `assistant_response` — wird verworfen, bevor es irgendwo landet:
 * Inhaltsdaten können so gar nicht erst gespeichert werden (FR-027), unabhängig davon,
 * wie die Inhalts-Schalter der CLI stehen.
 *
 * Struktur und Attributnamen sind gegen Claude Code 2.1.220 verifiziert (research.md D1).
 */

/** Herkunft einer Verbrauchsmeldung — Einstufung exakt nach der Regel der CLI. */
export type UsageOrigin = 'main' | 'subagent' | 'auxiliary';

/** Eine einzelne, von der CLI gemeldete API-Anfrage. Flüchtig — wird nie persistiert. */
export interface UsageEvent {
  /** Dedupe-Schlüssel; je API-Anfrage eindeutig. */
  requestId: string;
  /** Zeitpunkt in ms — Grundlage der Zuordnung zum Zeitfenster eines Laufs. */
  at: number;
  /** Marke einer interaktiven Toolkit-Session. */
  sddSessionId: string | null;
  /** Marke eines Headless-Laufs (executionId). */
  sddRunId: string | null;
  /** Claude-Session-UUID — nur Diagnose; die Zuordnung läuft über die sdd-Marken. */
  claudeSessionId: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** null = kein Betrag gemeldet (nie 0 als Ersatz, FR-023). */
  costMicros: number | null;
  origin: UsageOrigin;
}

const API_REQUEST = 'claude_code.api_request';

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * OTLP-Attributliste → flache Map. Werte kommen als `{stringValue}`, `{intValue}`
 * oder `{doubleValue}`; `intValue` ist in OTLP/JSON je nach Exporter String ODER Zahl.
 */
function attrMap(attrs: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const a of asArray(attrs)) {
    if (!isRecord(a) || typeof a.key !== 'string' || !isRecord(a.value)) continue;
    const [first] = Object.values(a.value);
    if (first !== undefined) out.set(a.key, first);
  }
  return out;
}

function str(m: Map<string, unknown>, key: string): string | null {
  const v = m.get(key);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Ganzzahl aus String oder Zahl; alles Unlesbare zählt als `fallback`. */
function int(m: Map<string, unknown>, key: string, fallback: number | null = 0): number | null {
  const v = m.get(key);
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return fallback;
}

/**
 * Einstufung nach `query_source`, exakt nach der Regel der CLI:
 * fehlend/`sdk`/`repl_main_thread*` → main, `agent:*`/`hook_agent` → subagent, Rest → auxiliary.
 */
export function classifyOrigin(querySource: string | null | undefined): UsageOrigin {
  if (querySource === undefined || querySource === null || querySource === '') return 'main';
  if (querySource === 'sdk' || querySource.startsWith('repl_main_thread')) return 'main';
  if (querySource.startsWith('agent:') || querySource === 'hook_agent') return 'subagent';
  return 'auxiliary';
}

/**
 * Einen OTLP-Logs-Rumpf auswerten. Liefert immer eine Liste — kaputte, fremde oder
 * unvollständige Strukturen ergeben eine leere. Der Empfänger antwortet dem Exporter
 * deshalb auch bei Unsinn mit 200 und provoziert keine Wiederholung (FR-006).
 */
export function parseOtlpLogs(body: unknown): UsageEvent[] {
  if (!isRecord(body)) return [];
  const out: UsageEvent[] = [];

  for (const resourceLog of asArray(body.resourceLogs)) {
    if (!isRecord(resourceLog)) continue;
    // Marke steht auf Ressourcen-Ebene UND (per Voreinstellung der CLI) auf jedem
    // Datensatz. Ressource zuerst, Datensatz als Rückfall — so hängt die Zuordnung
    // nicht an OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES, das ein Nutzer umstellen kann.
    const resourceAttrs = isRecord(resourceLog.resource) ? attrMap(resourceLog.resource.attributes) : new Map();

    for (const scopeLog of asArray(resourceLog.scopeLogs)) {
      if (!isRecord(scopeLog)) continue;
      for (const rec of asArray(scopeLog.logRecords)) {
        const event = parseRecord(rec, resourceAttrs);
        if (event) out.push(event);
      }
    }
  }
  return out;
}

function parseRecord(rec: unknown, resourceAttrs: Map<string, unknown>): UsageEvent | null {
  if (!isRecord(rec)) return null;
  if (!isRecord(rec.body) || rec.body.stringValue !== API_REQUEST) return null;

  const at = nanosToMs(rec.timeUnixNano ?? rec.observedTimeUnixNano);
  if (at === null) return null;

  const a = attrMap(rec.attributes);
  const requestId = str(a, 'request_id');
  if (!requestId) return null;

  const sddSessionId = str(a, 'sdd.session.id') ?? strFrom(resourceAttrs, 'sdd.session.id');
  const sddRunId = str(a, 'sdd.run.id') ?? strFrom(resourceAttrs, 'sdd.run.id');
  // Ohne eigene Marke stammt der Datensatz aus einer Session, die das Toolkit nicht
  // gestartet hat — er darf keinem Lauf zugeschrieben werden (FR-003).
  if (!sddSessionId && !sddRunId) return null;

  return {
    requestId,
    at,
    sddSessionId,
    sddRunId,
    claudeSessionId: str(a, 'session.id'),
    model: str(a, 'model'),
    inputTokens: int(a, 'input_tokens') ?? 0,
    outputTokens: int(a, 'output_tokens') ?? 0,
    cacheReadTokens: int(a, 'cache_read_tokens') ?? 0,
    cacheCreationTokens: int(a, 'cache_creation_tokens') ?? 0,
    costMicros: int(a, 'cost_usd_micros', null),
    origin: classifyOrigin(str(a, 'query_source')),
  };
}

function strFrom(m: Map<string, unknown>, key: string): string | null {
  const v = m.get(key);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function nanosToMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v / 1e6);
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n / 1e6);
  }
  return null;
}
