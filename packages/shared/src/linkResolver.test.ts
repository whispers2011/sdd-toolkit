import { describe, expect, it } from 'vitest';
import { findPathLinks } from './linkResolver.js';

describe('findPathLinks', () => {
  it('findet absoluten Pfad mit Zeile', () => {
    const links = findPathLinks('Fehler in /Users/x/proj/src/app.ts:42 gefunden');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ file: '/Users/x/proj/src/app.ts', line: 42 });
  });

  it('findet relativen Pfad mit Zeile:Spalte', () => {
    const links = findPathLinks('  src/services/orchestrator.ts:120:7 - error TS2345');
    expect(links[0]).toMatchObject({ file: 'src/services/orchestrator.ts', line: 120 });
  });

  it('findet ./-Pfade ohne Zeilenangabe', () => {
    const links = findPathLinks("siehe './packages/web/vite.config.ts' dort");
    expect(links[0]).toMatchObject({ file: './packages/web/vite.config.ts', line: null });
  });

  it('Start/Ende zeigen auf den Pfad in der Zeile', () => {
    const text = 'in src/a/b.ts:7 und';
    const [l] = findPathLinks(text);
    expect(text.slice(l!.start, l!.end)).toBe('src/a/b.ts:7');
  });

  it('mehrere Treffer pro Zeile', () => {
    const links = findPathLinks('diff src/a.ts b/src/a.ts');
    expect(links.length).toBe(2);
  });

  it('ignoriert nackte Wörter und Domains ohne Pfadstruktur', () => {
    expect(findPathLinks('hallo welt example.com fertig')).toHaveLength(0);
  });
});
