/**
 * Claude-Transkript-Parser (Port von WhisperM8 AgentSessionTranscript).
 * Fallback-Statusquelle neben der Hook-Bridge — unverzichtbar für den
 * ESC-Abbruch: der schreibt nur einen Marker ins Transkript, feuert aber
 * keinen Stop-Hook.
 */

export type TranscriptEvent =
  | { kind: 'user_message' }
  | { kind: 'tool_result' }
  | { kind: 'turn_interrupted' }
  | { kind: 'assistant_stopped'; stopReason: string }
  | { kind: 'assistant_ongoing' }
  | { kind: 'meta' };

export type TranscriptSignal = 'working' | 'turn_finished' | 'turn_aborted';

/** Marker, mit dem Claude einen User-Abbruch (ESC) ins Transkript schreibt (Prefix-Match). */
export const INTERRUPT_MARKER_PREFIX = '[Request interrupted by user';

/** Tool-Aufruf/Pause ist KEIN Turn-Ende — der Agent arbeitet gleich weiter. */
export const CONTINUATION_STOP_REASONS = new Set(['tool_use', 'pause_turn']);

/** Aktivität ohne File-Write länger als das gilt nicht mehr als Arbeit. */
export const WORKING_STALL_SECONDS = 120;

export function parseClaudeTranscriptLine(line: string): TranscriptEvent | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = obj.type;

  if (type === 'user') {
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (Array.isArray(content)) {
      const blocks = content as Record<string, unknown>[];
      // Tool-Results stecken in user-Zeilen mit tool_result-Block — keine echte Eingabe.
      if (blocks.some((b) => b.type === 'tool_result')) return { kind: 'tool_result' };
      if (
        blocks.some(
          (b) => b.type === 'text' && typeof b.text === 'string' && b.text.startsWith(INTERRUPT_MARKER_PREFIX),
        )
      ) {
        return { kind: 'turn_interrupted' };
      }
    }
    if (typeof content === 'string' && content.startsWith(INTERRUPT_MARKER_PREFIX)) {
      return { kind: 'turn_interrupted' };
    }
    return { kind: 'user_message' };
  }

  if (type === 'assistant') {
    const message = obj.message as Record<string, unknown> | undefined;
    const stopReason = message?.stop_reason;
    if (typeof stopReason === 'string' && stopReason.length > 0) {
      return { kind: 'assistant_stopped', stopReason };
    }
    return { kind: 'assistant_ongoing' };
  }

  // summary/system/mode/file-history-snapshot/… = Meta, bestimmt nie den Status.
  return { kind: 'meta' };
}

/**
 * Extrahiert den zusammengesetzten Text einer Assistant-Transkriptzeile (text-Blöcke),
 * sonst null. Für Marker-Erkennung aus der Session (Feature-Vorschläge).
 */
export function assistantTextFromTranscriptLine(line: string): string | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (obj.type !== 'assistant') return null;
  const message = obj.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return null;
  const text = (content as Record<string, unknown>[])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
  return text || null;
}

/** Übersetzt das letzte statusrelevante Event in ein Session-Signal. */
export function decideTranscriptSignal(event: TranscriptEvent): TranscriptSignal | null {
  switch (event.kind) {
    case 'user_message':
    case 'tool_result':
    case 'assistant_ongoing':
      return 'working';
    case 'assistant_stopped':
      return CONTINUATION_STOP_REASONS.has(event.stopReason) ? 'working' : 'turn_finished';
    case 'turn_interrupted':
      return 'turn_aborted';
    case 'meta':
      return null;
  }
}

/**
 * Claude-Projektverzeichnis-Encoding: jedes nicht-alphanumerische Zeichen → '-'
 * (`/Users/x/mein.projekt` → `-Users-x-mein-projekt`).
 */
export function encodeClaudeCwd(cwd: string): string {
  let result = '';
  for (const ch of cwd) {
    result += /[a-zA-Z0-9]/.test(ch) ? ch : '-';
  }
  return result;
}
