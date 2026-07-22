import { describe, expect, it } from 'vitest';
import { parseChatStreamLine } from './chatStream.js';

describe('parseChatStreamLine', () => {
  it('erkennt das Init-Event mit Session-ID', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc-123', model: 'claude-sonnet' });
    expect(parseChatStreamLine(line)).toEqual({ kind: 'init', sessionId: 'abc-123' });
  });

  it('extrahiert Text-Deltas aus stream_event', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hallo ' } },
      session_id: 'abc-123',
    });
    expect(parseChatStreamLine(line)).toEqual({ kind: 'delta', text: 'Hallo ' });
  });

  it('ignoriert Nicht-Text-Deltas (thinking, input_json)', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } },
    });
    expect(parseChatStreamLine(line).kind).toBe('ignored');
  });

  it('parst das Result-Event mit Kosten und Tokens', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Die Antwort.',
      total_cost_usd: 0.0421,
      usage: { input_tokens: 1200, output_tokens: 340 },
      session_id: 'abc-123',
    });
    expect(parseChatStreamLine(line)).toEqual({
      kind: 'result',
      text: 'Die Antwort.',
      isError: false,
      costUsd: 0.0421,
      tokens: 1540,
      sessionId: 'abc-123',
    });
  });

  it('markiert Fehler-Results als isError, auch ohne is_error-Flag', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', result: '' });
    const ev = parseChatStreamLine(line);
    expect(ev.kind).toBe('result');
    if (ev.kind === 'result') {
      expect(ev.isError).toBe(true);
      expect(ev.costUsd).toBeNull();
      expect(ev.tokens).toBeNull();
      expect(ev.sessionId).toBeNull();
    }
  });

  it('ignoriert Leerzeilen, kaputtes JSON und unbekannte Event-Typen', () => {
    expect(parseChatStreamLine('').kind).toBe('ignored');
    expect(parseChatStreamLine('   ').kind).toBe('ignored');
    expect(parseChatStreamLine('{"type":"result"').kind).toBe('ignored');
    expect(parseChatStreamLine('kein json').kind).toBe('ignored');
    expect(parseChatStreamLine('42').kind).toBe('ignored');
    expect(parseChatStreamLine(JSON.stringify({ type: 'assistant', message: { content: [] } })).kind).toBe('ignored');
  });
});
