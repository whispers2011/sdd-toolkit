/**
 * Renderer für Lauf-Logs (Feature "laeufe-haben-kein-log").
 *
 * Wandelt einen Claude-Transkript-Ausschnitt (rohe JSONL-Zeilen eines einzelnen
 * Phasen-Laufs) in bereinigten, ANSI-freien Klartext für die „Läufe"-Log-Ansicht um.
 * Reine Funktion ohne I/O — deterministisch und unit-testbar.
 *
 * Darstellung: User-Prompts (»), Assistant-Text, Tool-Aufrufe (⚙) und Tool-Ergebnisse (⇐).
 * Abbruch-Marker (ESC) werden sichtbar gemacht; Meta-/Summary-/System-Zeilen entfallen.
 * Inhalt wird NICHT gekürzt (FR-009), nur von Steuerzeichen befreit (FR-006).
 */
import { INTERRUPT_MARKER_PREFIX } from './transcript.js';

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

/** Entfernt ANSI-Escapes und Steuerzeichen (behält \n und \t; verwirft \r). */
function clean(s: string): string {
  const noAnsi = s.replace(ANSI_RE, '');
  let out = '';
  for (const ch of noAnsi) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || (c >= 32 && c !== 127)) out += ch;
  }
  return out;
}

/** Text aus einem content-Wert (string oder Array von Blöcken) zusammenführen. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Record<string, unknown>[])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
  }
  return '';
}

function stringifyInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input) ?? '';
  } catch {
    return '';
  }
}

function isInterrupt(text: string): boolean {
  return text.startsWith(INTERRUPT_MARKER_PREFIX);
}

function renderUser(content: unknown): string | null {
  const lines: string[] = [];

  if (typeof content === 'string') {
    if (isInterrupt(content)) return '⛔ [Abbruch durch Nutzer]';
    const t = clean(content).trim();
    return t ? `» ${t}` : null;
  }

  if (Array.isArray(content)) {
    const blocks = content as Record<string, unknown>[];
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        const t = clean(extractText(b.content)).trimEnd();
        if (t) lines.push(`⇐ ${t}`);
      } else if (b.type === 'text' && typeof b.text === 'string') {
        if (isInterrupt(b.text)) {
          lines.push('⛔ [Abbruch durch Nutzer]');
        } else {
          const t = clean(b.text).trim();
          if (t) lines.push(`» ${t}`);
        }
      }
    }
  }

  return lines.length ? lines.join('\n') : null;
}

function renderAssistant(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const lines: string[] = [];
  for (const b of content as Record<string, unknown>[]) {
    if (b.type === 'text' && typeof b.text === 'string') {
      const t = clean(b.text).trimEnd();
      if (t) lines.push(t);
    } else if (b.type === 'tool_use') {
      const name = typeof b.name === 'string' ? b.name : 'tool';
      const input = clean(stringifyInput(b.input));
      lines.push(input ? `⚙ ${name}(${input})` : `⚙ ${name}`);
    }
  }
  return lines.length ? lines.join('\n') : null;
}

function renderLine(line: string): string | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const message = obj.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (obj.type === 'user') return renderUser(content);
  if (obj.type === 'assistant') return renderAssistant(content);
  return null; // system / summary / meta / file-history-snapshot …
}

export function renderTranscriptLog(lines: string[]): string {
  const out: string[] = [];
  for (const line of lines) {
    const rendered = renderLine(line);
    if (rendered !== null) out.push(rendered);
  }
  return out.join('\n');
}
