/**
 * Token-Metering (Port von speckit-assistant CostMeter):
 * opportunistisches Parsing expliziter Usage-Ausgaben der CLI, Fallback auf
 * Token-Schätzung anhand der Zeichenlänge.
 */

export interface CostMetadata {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  source: 'parsed' | 'estimated';
}

// ANSI-Escapes (Farben, Cursor, OSC) entfernen — sonst verzerren Steuerzeichen
// Längen-Schätzung und Regex-Parsing.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/** Grobe Schätzung: ~4 Zeichen pro Token. */
export function estimateTokens(text: string): number {
  return Math.ceil(stripAnsi(text).length / 4);
}

const toInt = (s: string): number => parseInt(s.replace(/,/g, ''), 10);

// Beide Reihenfolgen: "input tokens: 1,234" und "1,234 input tokens".
function matchTokens(text: string, label: string): number | undefined {
  const labelFirst = text.match(new RegExp(`(?:${label})\\s*tokens?\\s*[:=]\\s*([\\d,]+)`, 'i'));
  if (labelFirst?.[1]) return toInt(labelFirst[1]);
  const numberFirst = text.match(new RegExp(`([\\d,]+)\\s*(?:${label})\\s*tokens`, 'i'));
  if (numberFirst?.[1]) return toInt(numberFirst[1]);
  return undefined;
}

export interface ParsedUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
}

/** Best-effort-Scrape expliziter Usage-Angaben aus CLI-Output. */
export function parseUsage(raw: string): ParsedUsage {
  const text = stripAnsi(raw);
  const out: ParsedUsage = {};

  const input = matchTokens(text, 'input|prompt');
  if (input !== undefined) out.inputTokens = input;
  const output = matchTokens(text, 'output|completion');
  if (output !== undefined) out.outputTokens = output;

  // Nur explizites "total tokens"/"tokens used" — nicht das nackte "tokens:" treffen.
  const total = text.match(/(?:total\s*tokens|tokens\s*used)\s*[:=]\s*([\d,]+)/i);
  if (total?.[1]) out.totalTokens = toInt(total[1]);

  const model = text.match(/model["']?\s*[:=]\s*["']?([\w.\-:]+)/i);
  if (model?.[1]) out.model = model[1];

  return out;
}

export const DEFAULT_MODEL = 'claude-sonnet';

/** Parsing + Schätzung kombinieren — liefert immer eine CostMetadata. */
export function meter(input: { model?: string; promptText: string; outputText: string }): CostMetadata {
  const parsed = parseUsage(input.outputText);
  const hasParsed =
    parsed.inputTokens !== undefined ||
    parsed.outputTokens !== undefined ||
    parsed.totalTokens !== undefined;

  const inputTokens = parsed.inputTokens ?? estimateTokens(input.promptText);
  const outputTokens = parsed.outputTokens ?? estimateTokens(input.outputText);
  const totalTokens = parsed.totalTokens ?? inputTokens + outputTokens;
  const model = parsed.model ?? input.model ?? DEFAULT_MODEL;

  return { inputTokens, outputTokens, totalTokens, model, source: hasParsed ? 'parsed' : 'estimated' };
}
