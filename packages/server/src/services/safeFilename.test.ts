import { describe, expect, it } from 'vitest';
import { sep } from 'node:path';
import { resolveInside, sanitizeFilename, uniqueFilename } from './safeFilename.js';

/**
 * Härtung der Dateinamen aus fremder Quelle (FR-005, R7). Geteilt von
 * Jira-Import und Dokument-Upload — beide Aufrufer hängen an diesen Zusagen.
 */

describe('sanitizeFilename', () => {
  it('entschärft Pfad-Traversal: keine Separatoren, kein führender Punkt', () => {
    const out = sanitizeFilename('../../etc/passwd');
    expect(out).not.toContain('/');
    expect(out).not.toContain('\\');
    expect(out.startsWith('.')).toBe(false);
    expect(out).toBe('__.._etc_passwd');
  });

  it('entschärft Windows-Separatoren', () => {
    expect(sanitizeFilename('..\\..\\windows\\system32\\config')).toBe('__.._windows_system32_config');
  });

  it('entwertet Dotfiles', () => {
    expect(sanitizeFilename('.ssh')).toBe('_ssh');
    expect(sanitizeFilename('.gitignore')).toBe('_gitignore');
  });

  it('entfernt Steuerzeichen und NUL', () => {
    expect(sanitizeFilename('be\u0000richt\u001f.txt\u007f')).toBe('bericht.txt');
  });

  it('kürzt auf 200 Zeichen und behält die Endung', () => {
    const out = sanitizeFilename(`${'a'.repeat(300)}.pdf`);
    expect(out.length).toBe(200);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('kürzt auch ohne verwertbare Endung', () => {
    expect(sanitizeFilename('b'.repeat(300)).length).toBe(200);
  });

  it('fällt auf einen Ersatznamen zurück, wenn nichts übrig bleibt', () => {
    expect(sanitizeFilename('\u0000\u0001')).toBe('dokument');
    expect(sanitizeFilename('   ')).toBe('dokument');
    // Der Jira-Import behält seinen bisherigen Ersatznamen (T011).
    expect(sanitizeFilename('', 'anhang')).toBe('anhang');
  });

  it('lässt einen harmlosen Namen unverändert — auch mit Leerzeichen und Umlauten', () => {
    expect(sanitizeFilename('Anforderungen 2026 – Küche.pdf')).toBe('Anforderungen 2026 – Küche.pdf');
  });
});

describe('uniqueFilename', () => {
  it('hängt vor der Endung einen Zähler an, statt zu überschreiben (FR-005)', () => {
    const used = new Set<string>();
    expect(uniqueFilename('bericht.txt', used)).toBe('bericht.txt');
    expect(uniqueFilename('bericht.txt', used)).toBe('bericht-2.txt');
    expect(uniqueFilename('bericht.txt', used)).toBe('bericht-3.txt');
  });

  it('hängt ohne Endung schlicht an', () => {
    const used = new Set<string>();
    expect(uniqueFilename('README', used)).toBe('README');
    expect(uniqueFilename('README', used)).toBe('README-2');
  });
});

describe('resolveInside', () => {
  it('liefert den absoluten Zielpfad für einen Namen innerhalb des Ordners', () => {
    expect(resolveInside('/repo/specs/x/docs', 'bericht.txt')).toBe(`${sep}repo${sep}specs${sep}x${sep}docs${sep}bericht.txt`);
  });

  it('weist Ausbrüche ab (FR-005)', () => {
    expect(resolveInside('/repo/specs/x/docs', '../../../../tmp/entkommen.txt')).toBeNull();
    expect(resolveInside('/repo/specs/x/docs', '/tmp/entkommen.txt')).toBeNull();
    expect(resolveInside('/repo/specs/x/docs', '..')).toBeNull();
    expect(resolveInside('/repo/specs/x/docs', '.')).toBeNull(); // der Ordner selbst ist kein Ziel
  });

  it('greift auch dann, wenn der Präfix nur zeichenweise passt', () => {
    expect(resolveInside('/repo/docs', '../docs-geheim/x.txt')).toBeNull();
  });
});
