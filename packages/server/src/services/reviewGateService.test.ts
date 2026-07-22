import { describe, expect, it } from 'vitest';
import { parseVerdict } from './reviewGateService.js';

describe('parseVerdict', () => {
  it('liest VERDICT aus der Review-Datei (case-insensitive)', () => {
    expect(parseVerdict('# Review\n\nAlles gut.\n\nVERDICT: PASS', 1)).toBe('PASS');
    expect(parseVerdict('Probleme gefunden.\nverdict: fail', 0)).toBe('FAIL');
  });

  it('Datei-Verdict schlägt Exit-Code', () => {
    expect(parseVerdict('VERDICT: FAIL', 0)).toBe('FAIL');
    expect(parseVerdict('VERDICT: PASS', 3)).toBe('PASS');
  });

  it('ohne Datei entscheidet der Exit-Code', () => {
    expect(parseVerdict(null, 0)).toBe('PASS');
    expect(parseVerdict(null, 1)).toBe('FAIL');
  });

  it('ohne Verdict-Zeile in der Datei entscheidet der Exit-Code', () => {
    expect(parseVerdict('nur text', 0)).toBe('PASS');
    expect(parseVerdict('nur text', 2)).toBe('FAIL');
  });
});
