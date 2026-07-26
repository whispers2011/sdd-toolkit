/**
 * Autoritative Token-Messung aus dem Claude-Transkript-JSONL
 * (Feature "minimize-token-consumption", P1). Reine Extraktion — keine IO.
 *
 * Eine `assistant`-Zeile trägt `message.usage` mit input/output sowie
 * cache_read/cache_creation — letzteres macht den akkumulierten Kontext sichtbar.
 */

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  model?: string;
  /**
   * Dedupe-Schlüssel (message.id + requestId): Claude Code schreibt pro Content-Block
   * eine JSONL-Zeile mit identischer Usage — ohne Dedupe wird ~2–3× überzählt.
   */
  dedupeKey?: string;
}

const ZERO: TurnUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Eine JSONL-Zeile → TurnUsage, oder null wenn keine Usage-tragende assistant-Zeile. */
export function parseUsageLine(line: string): TurnUsage | null {
  const raw = line.trim();
  if (!raw) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (obj.type !== 'assistant') return null;
  const message = obj.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== 'object') return null;
  const out: TurnUsage = {
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheCreationTokens: num(usage.cache_creation_input_tokens),
  };
  if (typeof message?.model === 'string') out.model = message.model;
  const messageId = typeof message?.id === 'string' ? message.id : null;
  if (messageId) {
    const requestId = typeof obj.requestId === 'string' ? obj.requestId : '';
    out.dedupeKey = `${messageId}:${requestId}`;
  }
  return out;
}

/**
 * Alle Usage-Zeilen eines Fensters robust summieren (Nicht-Usage/kaputte Zeilen ignorieren).
 * Zeilen derselben Assistant-Message (gleicher dedupeKey) zählen nur einmal.
 */
export function sumUsage(lines: string[]): TurnUsage {
  let model: string | undefined;
  const acc: TurnUsage = { ...ZERO };
  const seen = new Set<string>();
  for (const line of lines) {
    const u = parseUsageLine(line);
    if (!u) continue;
    if (u.dedupeKey) {
      if (seen.has(u.dedupeKey)) continue;
      seen.add(u.dedupeKey);
    }
    acc.inputTokens += u.inputTokens;
    acc.outputTokens += u.outputTokens;
    acc.cacheReadTokens += u.cacheReadTokens;
    acc.cacheCreationTokens += u.cacheCreationTokens;
    if (u.model) model = u.model; // letzter gewinnt
  }
  if (model) acc.model = model;
  return acc;
}

/** True, wenn mindestens ein Token-Wert erfasst wurde (sonst kein Transkript-Signal). */
export function hasUsage(u: TurnUsage): boolean {
  return (
    u.inputTokens > 0 || u.outputTokens > 0 || u.cacheReadTokens > 0 || u.cacheCreationTokens > 0
  );
}

/**
 * TurnUsage → Gesamt-Tokens: Summe aus Input, Output, Cache-Read und Cache-Creation.
 * Cache-Anteile zählen voll mit, weil sie den tatsächlich bewegten Kontext abbilden.
 */
export function usageTotalTokens(u: TurnUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens;
}
