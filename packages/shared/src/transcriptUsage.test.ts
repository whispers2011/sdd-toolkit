import { describe, expect, it } from 'vitest';
import { hasUsage, parseUsageLine, sumUsage, usageTotalTokens } from './transcriptUsage.js';

const assistantLine = (usage: Record<string, number>, model = 'claude-sonnet-5') =>
  JSON.stringify({ type: 'assistant', message: { model, usage } });

describe('transcriptUsage', () => {
  it('parseUsageLine liest alle vier Komponenten aus einer assistant-Zeile', () => {
    const u = parseUsageLine(
      assistantLine({
        input_tokens: 2,
        output_tokens: 204,
        cache_read_input_tokens: 20874,
        cache_creation_input_tokens: 10496,
      }),
    );
    expect(u).toEqual({
      inputTokens: 2,
      outputTokens: 204,
      cacheReadTokens: 20874,
      cacheCreationTokens: 10496,
      model: 'claude-sonnet-5',
    });
  });

  it('parseUsageLine ignoriert Nicht-Usage-/kaputte Zeilen', () => {
    expect(parseUsageLine('')).toBeNull();
    expect(parseUsageLine('nicht json')).toBeNull();
    expect(parseUsageLine(JSON.stringify({ type: 'user', message: {} }))).toBeNull();
    expect(parseUsageLine(JSON.stringify({ type: 'assistant', message: {} }))).toBeNull();
  });

  it('sumUsage summiert gemischtes Fenster robust', () => {
    const lines = [
      '',
      'kaputt',
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      assistantLine({ input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }),
      assistantLine({ input_tokens: 2, output_tokens: 20, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 }, 'claude-opus-4-8'),
    ];
    const u = sumUsage(lines);
    expect(u.inputTokens).toBe(3);
    expect(u.outputTokens).toBe(30);
    expect(u.cacheReadTokens).toBe(300);
    expect(u.cacheCreationTokens).toBe(5);
    expect(u.model).toBe('claude-opus-4-8'); // letzter gewinnt
  });

  it('sumUsage über leeres/ungültiges Fenster → Null-Usage, kein Wurf', () => {
    const u = sumUsage(['', 'x', 'y']);
    expect(u).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
    expect(hasUsage(u)).toBe(false);
  });

  it('usageTotalTokens: Summe aller vier Komponenten', () => {
    const totalTokens = usageTotalTokens({
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 1000,
      cacheCreationTokens: 50,
      model: 'claude-sonnet-5',
    });
    expect(totalTokens).toBe(1350);
  });

  it('sumUsage dedupliziert Zeilen derselben Assistant-Message (message.id + requestId)', () => {
    const line = (id: string, req: string, output: number) =>
      JSON.stringify({
        type: 'assistant',
        requestId: req,
        message: { id, model: 'claude-sonnet-5', usage: { input_tokens: 1, output_tokens: output, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } },
      });
    const u = sumUsage([
      line('msg_a', 'req_1', 40), // 3 Zeilen derselben Message (Content-Block-Streaming)
      line('msg_a', 'req_1', 40),
      line('msg_a', 'req_1', 40),
      line('msg_b', 'req_2', 7),
    ]);
    expect(u.outputTokens).toBe(47);
    expect(u.inputTokens).toBe(2);
    expect(u.cacheReadTokens).toBe(20);
  });

  it('sumUsage zählt Zeilen ohne message.id weiterhin einzeln (kein Dedupe-Schlüssel)', () => {
    const u = sumUsage([
      assistantLine({ input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      assistantLine({ input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ]);
    expect(u.outputTokens).toBe(20);
  });
});
