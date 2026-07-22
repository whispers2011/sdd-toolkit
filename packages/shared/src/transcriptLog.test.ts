import { describe, expect, it } from 'vitest';
import { renderTranscriptLog } from './transcriptLog.js';

const line = (obj: unknown) => JSON.stringify(obj);

describe('renderTranscriptLog', () => {
  it('rendert eine User-Prompt-Zeile (String-Content) mit »', () => {
    const out = renderTranscriptLog([line({ type: 'user', message: { content: 'mach mal /specify' } })]);
    expect(out).toBe('» mach mal /specify');
  });

  it('rendert Assistant-Text', () => {
    const out = renderTranscriptLog([
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Ich analysiere das.' }] } }),
    ]);
    expect(out).toBe('Ich analysiere das.');
  });

  it('rendert tool_use als ⚙ name(input)', () => {
    const out = renderTranscriptLog([
      line({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] },
      }),
    ]);
    expect(out).toBe('⚙ Read({"file_path":"a.ts"})');
  });

  it('rendert tool_result einer user-Zeile mit ⇐', () => {
    const out = renderTranscriptLog([
      line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'Datei-Inhalt' }] } }),
    ]);
    expect(out).toBe('⇐ Datei-Inhalt');
  });

  it('macht den Abbruch-Marker sichtbar', () => {
    const out = renderTranscriptLog([
      line({
        type: 'user',
        message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] },
      }),
    ]);
    expect(out).toBe('⛔ [Abbruch durch Nutzer]');
  });

  it('überspringt meta/summary/system-Zeilen', () => {
    const out = renderTranscriptLog([
      line({ type: 'summary', summary: 'x' }),
      line({ type: 'system', foo: 1 }),
      line({ type: 'file-history-snapshot' }),
    ]);
    expect(out).toBe('');
  });

  it('ist robust gegen leere Eingabe und nicht-parsebare Zeilen', () => {
    expect(renderTranscriptLog([])).toBe('');
    expect(renderTranscriptLog(['nicht json', '{kaputt'])).toBe('');
  });

  it('entfernt ANSI-Escapes und Steuerzeichen (bereinigt, FR-006)', () => {
    const esc = String.fromCharCode(27);
    const raw = `${esc}[31mrot${esc}[0m\r\nzeile2\x07`;
    const out = renderTranscriptLog([
      line({ type: 'assistant', message: { content: [{ type: 'text', text: raw }] } }),
    ]);
    expect(out).toBe('rot\nzeile2');
    // eslint-disable-next-line no-control-regex
    expect(/\x1b|\x07|\r/.test(out)).toBe(false);
  });

  it('kürzt Inhalt nicht (FR-009)', () => {
    const big = 'x'.repeat(50_000);
    const out = renderTranscriptLog([
      line({ type: 'assistant', message: { content: [{ type: 'text', text: big }] } }),
    ]);
    expect(out.length).toBe(big.length);
  });

  it('behält Reihenfolge über mehrere Zeilen', () => {
    const out = renderTranscriptLog([
      line({ type: 'user', message: { content: 'los' } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'file.ts' }] } }),
    ]);
    expect(out).toBe('» los\nok\n⚙ Bash({"command":"ls"})\n⇐ file.ts');
  });
});
