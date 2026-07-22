import { describe, expect, it } from 'vitest';
import { compress } from './contextCompressor.js';

describe('contextCompressor', () => {
  it('kollabiert mehrfache Leerzeilen und aufeinanderfolgende Duplikate', () => {
    const { text, report } = compress('a\n\n\n\nb\nb\nb\nc');
    expect(text).toBe('a\n\nb\nc\n');
    const blank = report.elided.find((e) => e.reason === 'blank');
    const dedup = report.elided.find((e) => e.reason === 'dedup');
    expect(blank?.count).toBeGreaterThan(0);
    expect(dedup?.count).toBe(2);
  });

  it('kürzt überlange Code-/Log-Blöcke mit Auslassungsmarker', () => {
    const body = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const { text, report } = compress('```\n' + body + '\n```', { maxLogLines: 10 });
    expect(text).toContain('Zeilen ausgelassen)');
    expect(report.elided.find((e) => e.reason === 'log-truncation')?.count).toBe(1);
    expect(report.bytesAfter).toBeLessThan(report.bytesBefore);
  });

  it('entfernt Boilerplate-Zeilen', () => {
    const { text } = compress('keep\nBOILER\nkeep2', { boilerplate: ['BOILER'] });
    expect(text).toBe('keep\nkeep2\n');
  });

  it('ist idempotent bzgl. Text', () => {
    const input = '```\n' + Array.from({ length: 80 }, (_, i) => `x ${i}`).join('\n') + '\n```\n\n\nend';
    const once = compress(input).text;
    const twice = compress(once).text;
    expect(twice).toBe(once);
  });

  it('Report-Zahlen sind konsistent (bytesAfter ≤ bytesBefore)', () => {
    const { report } = compress('a\n\n\nb\nb');
    expect(report.bytesAfter).toBeLessThanOrEqual(report.bytesBefore);
    expect(report.tokensAfter).toBeLessThanOrEqual(report.tokensBefore);
  });
});
