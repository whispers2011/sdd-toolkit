import { describe, expect, it } from 'vitest';
import { estimateTokens, meter, parseUsage, stripAnsi } from './costMeter.js';

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

  it('parseUsage: Geldbeträge werden nicht mehr extrahiert', () => {
    expect('costUsd' in parseUsage('Total cost: $1.25')).toBe(false);
    expect('costUsd' in parseUsage('"total_cost_usd": 0.0421')).toBe(false);
  });

  it('parseUsage: "total tokens" ja, nacktes "tokens:" nein', () => {
    expect(parseUsage('total tokens: 9,999').totalTokens).toBe(9999);
    expect(parseUsage('input tokens: 5').totalTokens).toBeUndefined();
  });

  it('meter: geparste Werte → source parsed', () => {
    const m = meter({ promptText: 'p', outputText: 'Total cost: $0.50\ninput tokens: 100\noutput tokens: 200' });
    expect(m.source).toBe('parsed');
    expect(m.inputTokens).toBe(100);
    expect(m.outputTokens).toBe(200);
    expect(m.totalTokens).toBe(300);
  });

  it('meter: ohne Parse-Treffer → Token-Schätzung', () => {
    const out = 'x'.repeat(4000); // ≈1000 Tokens
    const m = meter({ model: 'claude-opus-4-8', promptText: '', outputText: out });
    expect(m.source).toBe('estimated');
    expect(m.outputTokens).toBe(1000);
    expect(m.totalTokens).toBe(1000);
  });

  it('meter: liefert kein Kostenfeld', () => {
    const m = meter({ promptText: 'p', outputText: 'Total cost: $0.50\ninput tokens: 100' });
    expect('costUsd' in m).toBe(false);
  });

  it('meter: nur ein Geldbetrag ohne Token-Angabe zählt als estimated', () => {
    const m = meter({ promptText: 'p', outputText: '"total_cost_usd": 0.0421' });
    expect(m.source).toBe('estimated');
  });

  it('estimateTokens ignoriert ANSI', () => {
    expect(estimateTokens('\x1b[32m' + 'a'.repeat(8) + '\x1b[0m')).toBe(2);
  });
});
