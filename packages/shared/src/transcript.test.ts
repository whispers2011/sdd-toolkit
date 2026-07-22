import { describe, expect, it } from 'vitest';
import {
  decideTranscriptSignal,
  encodeClaudeCwd,
  parseClaudeTranscriptLine,
} from './transcript.js';

const line = (obj: unknown) => JSON.stringify(obj);

describe('parseClaudeTranscriptLine', () => {
  it('user-Message = working', () => {
    const e = parseClaudeTranscriptLine(line({ type: 'user', message: { content: 'mach mal' } }));
    expect(e).toEqual({ kind: 'user_message' });
    expect(decideTranscriptSignal(e!)).toBe('working');
  });

  it('tool_result in user-Zeile ist keine echte Eingabe', () => {
    const e = parseClaudeTranscriptLine(
      line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    );
    expect(e).toEqual({ kind: 'tool_result' });
    expect(decideTranscriptSignal(e!)).toBe('working');
  });

  it('ESC-Abbruch-Marker → turn_aborted (Array- und String-Content, Prefix-Match)', () => {
    const arr = parseClaudeTranscriptLine(
      line({
        type: 'user',
        message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] },
      }),
    );
    expect(decideTranscriptSignal(arr!)).toBe('turn_aborted');

    const str = parseClaudeTranscriptLine(
      line({ type: 'user', message: { content: '[Request interrupted by user]' } }),
    );
    expect(decideTranscriptSignal(str!)).toBe('turn_aborted');
  });

  it('assistant mit stop_reason tool_use/pause_turn = working (kein Turn-Ende!)', () => {
    for (const stopReason of ['tool_use', 'pause_turn']) {
      const e = parseClaudeTranscriptLine(line({ type: 'assistant', message: { stop_reason: stopReason } }));
      expect(decideTranscriptSignal(e!)).toBe('working');
    }
  });

  it('assistant mit end_turn/stop_sequence/max_tokens/refusal = turn_finished', () => {
    for (const stopReason of ['end_turn', 'stop_sequence', 'max_tokens', 'refusal']) {
      const e = parseClaudeTranscriptLine(line({ type: 'assistant', message: { stop_reason: stopReason } }));
      expect(decideTranscriptSignal(e!)).toBe('turn_finished');
    }
  });

  it('assistant ohne stop_reason = ongoing = working', () => {
    const e = parseClaudeTranscriptLine(line({ type: 'assistant', message: { content: [] } }));
    expect(e).toEqual({ kind: 'assistant_ongoing' });
    expect(decideTranscriptSignal(e!)).toBe('working');
  });

  it('Meta-Zeilen (summary/system/…) liefern kein Signal', () => {
    for (const type of ['summary', 'system', 'file-history-snapshot', 'queue-operation']) {
      const e = parseClaudeTranscriptLine(line({ type }));
      expect(e).toEqual({ kind: 'meta' });
      expect(decideTranscriptSignal(e!)).toBeNull();
    }
  });

  it('kaputtes JSON → null', () => {
    expect(parseClaudeTranscriptLine('{nicht json')).toBeNull();
  });
});

describe('encodeClaudeCwd', () => {
  it('ersetzt alles Nicht-Alphanumerische durch Bindestriche', () => {
    expect(encodeClaudeCwd('/Users/louismichel/iwf-projects/sdd-toolkit')).toBe(
      '-Users-louismichel-iwf-projects-sdd-toolkit',
    );
    expect(encodeClaudeCwd('/Users/x/mein.projekt_v2')).toBe('-Users-x-mein-projekt-v2');
  });
});
