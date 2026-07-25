/**
 * Parser für `claude -p --output-format stream-json --include-partial-messages`:
 * eine JSONL-Zeile → ein ChatStreamEvent. Unbekannte/kaputte Zeilen werden
 * bewusst ignoriert, damit CLI-Formatänderungen den Chat nicht brechen.
 */

export type ChatStreamEvent =
  | { kind: 'init'; sessionId: string }
  | { kind: 'delta'; text: string }
  | {
      kind: 'result';
      text: string;
      isError: boolean;
      costUsd: number | null;
      tokens: number | null;
      sessionId: string | null;
    }
  | { kind: 'ignored' };

const IGNORED: ChatStreamEvent = { kind: 'ignored' };

export function parseChatStreamLine(line: string): ChatStreamEvent {
  const trimmed = line.trim();
  if (!trimmed) return IGNORED;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return IGNORED;
  }
  if (typeof obj !== 'object' || obj === null) return IGNORED;

  switch (obj.type) {
    case 'system': {
      if (obj.subtype === 'init' && typeof obj.session_id === 'string') {
        return { kind: 'init', sessionId: obj.session_id };
      }
      return IGNORED;
    }
    case 'stream_event': {
      const event = obj.event as Record<string, unknown> | undefined;
      if (event?.type !== 'content_block_delta') return IGNORED;
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
        return { kind: 'delta', text: delta.text };
      }
      return IGNORED;
    }
    case 'result': {
      const usage = obj.usage as Record<string, unknown> | undefined;
      const inTok = typeof usage?.input_tokens === 'number' ? usage.input_tokens : null;
      const outTok = typeof usage?.output_tokens === 'number' ? usage.output_tokens : null;
      return {
        kind: 'result',
        text: typeof obj.result === 'string' ? obj.result : '',
        isError: obj.is_error === true || obj.subtype !== 'success',
        costUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : null,
        tokens: inTok !== null || outTok !== null ? (inTok ?? 0) + (outTok ?? 0) : null,
        sessionId: typeof obj.session_id === 'string' ? obj.session_id : null,
      };
    }
    default:
      return IGNORED;
  }
}
