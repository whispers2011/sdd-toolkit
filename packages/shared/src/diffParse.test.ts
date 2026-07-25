import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diffParse.js';

const SIMPLE = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1234567..89abcde 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,5 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' export { a, b };',
  ' // ende',
].join('\n');

describe('parseUnifiedDiff', () => {
  it('parst Datei, Hunk und nummeriert alt/neu korrekt', () => {
    const files = parseUnifiedDiff(SIMPLE);
    expect(files).toHaveLength(1);
    const f = files[0]!;
    expect(f.oldPath).toBe('src/a.ts');
    expect(f.newPath).toBe('src/a.ts');
    expect(f.binary).toBe(false);
    expect(f.hunks).toHaveLength(1);
    const h = f.hunks[0]!;
    expect(h.oldStart).toBe(1);
    expect(h.newStart).toBe(1);
    expect(h.lines).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'const a = 1;' },
      { kind: 'del', oldNo: 2, newNo: null, text: 'const b = 2;' },
      { kind: 'add', oldNo: null, newNo: 2, text: 'const b = 3;' },
      { kind: 'add', oldNo: null, newNo: 3, text: 'const c = 4;' },
      { kind: 'context', oldNo: 3, newNo: 4, text: 'export { a, b };' },
      { kind: 'context', oldNo: 4, newNo: 5, text: '// ende' },
    ]);
  });

  it('parst mehrere Dateien und Hunks mit Kontext-Suffix im Header', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -10,2 +10,2 @@ function foo() {',
      ' a',
      '-b',
      '+c',
      '@@ -20,1 +20,2 @@',
      ' d',
      '+e',
      'diff --git a/y.ts b/y.ts',
      '--- a/y.ts',
      '+++ b/y.ts',
      '@@ -1 +1 @@',
      '-alt',
      '+neu',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0]!.hunks).toHaveLength(2);
    expect(files[0]!.hunks[0]!.header).toContain('function foo()');
    expect(files[0]!.hunks[1]!.lines).toEqual([
      { kind: 'context', oldNo: 20, newNo: 20, text: 'd' },
      { kind: 'add', oldNo: null, newNo: 21, text: 'e' },
    ]);
    // Kurzform "@@ -1 +1 @@" (ohne Zeilenzahl) = 1 Zeile
    expect(files[1]!.hunks[0]!.oldLines).toBe(1);
    expect(files[1]!.hunks[0]!.newLines).toBe(1);
  });

  it('erkennt neue Dateien (/dev/null) und Binärdateien', () => {
    const diff = [
      'diff --git a/neu.ts b/neu.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/neu.ts',
      '@@ -0,0 +1,2 @@',
      '+eins',
      '+zwei',
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files[0]!.newPath).toBe('neu.ts');
    expect(files[0]!.hunks[0]!.lines.map((l) => l.newNo)).toEqual([1, 2]);
    expect(files[1]!.binary).toBe(true);
    expect(files[1]!.hunks).toHaveLength(0);
  });

  it('erkennt Renames und liefert beide Pfade', () => {
    const diff = [
      'diff --git a/alt/name.ts b/neu/name.ts',
      'similarity index 95%',
      'rename from alt/name.ts',
      'rename to neu/name.ts',
      '--- a/alt/name.ts',
      '+++ b/neu/name.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n');
    const f = parseUnifiedDiff(diff)[0]!;
    expect(f.renamed).toBe(true);
    expect(f.oldPath).toBe('alt/name.ts');
    expect(f.newPath).toBe('neu/name.ts');
  });

  it('liefert [] für leeren Input und ignoriert No-newline-Marker', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    const diff = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-a',
      '\\ No newline at end of file',
      '+b',
      '\\ No newline at end of file',
    ].join('\n');
    const lines = parseUnifiedDiff(diff)[0]!.hunks[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.kind)).toEqual(['del', 'add']);
  });
});
