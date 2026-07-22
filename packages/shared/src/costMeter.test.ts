import { describe, expect, it } from 'vitest';
import { estimateTokens, meter, parseUsage, priceFor, stripAnsi } from './costMeter.js';

describe('costMeter', () => {
  it('stripAnsi entfernt Farb- und OSC-Sequenzen', () => {
    expect(stripAnsi('\x1b[31mrot\x1b[0m \x1b]0;titel\x07text')).toBe('rot text');
  });

  it('parseUsage: label-first und number-first', () => {
    const a = parseUsage('input tokens: 1,234\noutput tokens: 567');
    expect(a.inputTokens).toBe(1234);
    expect(a.outputTokens).toBe(567);

    const b = parseUsage('12,000 input tokens · 3,400 output tokens');
    expect(b.inputTokens).toBe(12000);
    expect(b.outputTokens).toBe(3400);
  });

  it('parseUsage: Kosten und total_cost_usd', () => {
    expect(parseUsage('Total cost: $1.25').costUsd).toBe(1.25);
    expect(parseUsage('"total_cost_usd": 0.0421').costUsd).toBe(0.0421);
  });

  it('parseUsage: "total tokens" ja, nacktes "tokens:" nein', () => {
    expect(parseUsage('total tokens: 9,999').totalTokens).toBe(9999);
    expect(parseUsage('input tokens: 5').totalTokens).toBeUndefined();
  });

  it('meter: geparste Werte → source parsed', () => {
    const m = meter({ promptText: 'p', outputText: 'Total cost: $0.50\ninput tokens: 100\noutput tokens: 200' });
    expect(m.source).toBe('parsed');
    expect(m.costUsd).toBe(0.5);
    expect(m.totalTokens).toBe(300);
  });

  it('meter: ohne Parse-Treffer → Schätzung × Preistabelle', () => {
    const out = 'x'.repeat(4000); // ≈1000 Tokens
    const m = meter({ model: 'claude-opus-4-8', promptText: '', outputText: out });
    expect(m.source).toBe('estimated');
    expect(m.outputTokens).toBe(1000);
    expect(m.costUsd).toBeCloseTo((1000 / 1e6) * 75, 5);
  });

  it('priceFor normalisiert Modellnamen', () => {
    expect(priceFor('claude-opus-4-8[1m]').outputPerM).toBe(75);
    expect(priceFor('claude-haiku-4-5-20251001').inputPerM).toBe(0.8);
    expect(priceFor('unbekannt')).toEqual(priceFor('claude-sonnet-5'));
  });

  it('estimateTokens ignoriert ANSI', () => {
    expect(estimateTokens('\x1b[32m' + 'a'.repeat(8) + '\x1b[0m')).toBe(2);
  });
});
