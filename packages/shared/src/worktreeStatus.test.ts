import { describe, expect, it } from 'vitest';
import {
  detectOverlaps,
  mergeFileChanges,
  parseNameStatusZ,
  parseNulList,
  parsePorcelainStatusZ,
  type OverlapCandidate,
} from './worktreeStatus.js';
import type { WorktreeDirState, WorktreeFileChange } from './types.js';

/** Baut eine NUL-separierte git-Ausgabe (jedes Feld mit abschließendem NUL). */
const z = (...fields: string[]): string => fields.map((f) => `${f}\0`).join('');

describe('parseNameStatusZ', () => {
  it('parst die einfachen Änderungsarten', () => {
    const out = z('A', 'neu.ts', 'M', 'geaendert.ts', 'D', 'weg.ts');
    expect(parseNameStatusZ(out)).toEqual([
      { path: 'neu.ts', oldPath: null, kind: 'added' },
      { path: 'geaendert.ts', oldPath: null, kind: 'modified' },
      { path: 'weg.ts', oldPath: null, kind: 'deleted' },
    ]);
  });

  it('parst Rename-Paare aus zwei aufeinanderfolgenden Feldern inkl. oldPath', () => {
    const out = z('R100', 'alt/pfad.ts', 'neu/pfad.ts', 'M', 'andere.ts');
    expect(parseNameStatusZ(out)).toEqual([
      { path: 'neu/pfad.ts', oldPath: 'alt/pfad.ts', kind: 'renamed' },
      { path: 'andere.ts', oldPath: null, kind: 'modified' },
    ]);
  });

  it('behandelt eine Kopie als neue Datei ohne oldPath', () => {
    expect(parseNameStatusZ(z('C75', 'quelle.ts', 'kopie.ts'))).toEqual([
      { path: 'kopie.ts', oldPath: null, kind: 'added' },
    ]);
  });

  it('behält Pfade mit Leerzeichen, Umlauten und Tabs unverändert', () => {
    const out = z('M', 'ordner mit leerzeichen/größe.ts', 'A', 'öäü/straße\ttab.ts');
    expect(parseNameStatusZ(out).map((e) => e.path)).toEqual([
      'ordner mit leerzeichen/größe.ts',
      'öäü/straße\ttab.ts',
    ]);
  });

  it('liefert für leere Ausgabe eine leere Liste', () => {
    expect(parseNameStatusZ('')).toEqual([]);
    expect(parseNameStatusZ('\0')).toEqual([]);
  });

  it('bricht bei abgeschnittener Ausgabe ab, statt Müll zu erzeugen', () => {
    expect(parseNameStatusZ(z('M'))).toEqual([]);
    expect(parseNameStatusZ(z('R100', 'nur-alt'))).toEqual([]);
  });

  it('deutet unbekannte Statusbuchstaben als Änderung', () => {
    expect(parseNameStatusZ(z('T', 'symlink.ts'))).toEqual([
      { path: 'symlink.ts', oldPath: null, kind: 'modified' },
    ]);
  });
});

describe('parseNulList', () => {
  it('trennt an NUL und verwirft Leerfelder', () => {
    expect(parseNulList(z('a.ts', 'b/c d.ts'))).toEqual(['a.ts', 'b/c d.ts']);
    expect(parseNulList('')).toEqual([]);
  });
});

describe('parsePorcelainStatusZ', () => {
  it('liest Pfade aller Zustandskombinationen', () => {
    const out = z(' M geaendert.ts', 'M  gestaged.ts', '?? neu.ts', ' D weg.ts');
    expect(parsePorcelainStatusZ(out)).toEqual([
      'geaendert.ts',
      'gestaged.ts',
      'neu.ts',
      'weg.ts',
    ]);
  });

  it('nimmt bei Umbenennung neuen UND alten Pfad auf', () => {
    const out = z('R  neu/pfad.ts', 'alt/pfad.ts', ' M andere.ts');
    expect(parsePorcelainStatusZ(out)).toEqual(['neu/pfad.ts', 'alt/pfad.ts', 'andere.ts']);
  });

  it('behält Leerzeichen im Pfad', () => {
    expect(parsePorcelainStatusZ(z('?? mein ordner/datei.ts'))).toEqual(['mein ordner/datei.ts']);
  });

  it('liefert für leere Ausgabe eine leere Liste', () => {
    expect(parsePorcelainStatusZ('')).toEqual([]);
  });
});

describe('mergeFileChanges', () => {
  it('deckt die vollständige state-Matrix ab', () => {
    const files = mergeFileChanges({
      netto: [
        { path: 'nur-committet.ts', oldPath: null, kind: 'modified' },
        { path: 'nur-arbeitsbaum.ts', oldPath: null, kind: 'modified' },
        { path: 'beides.ts', oldPath: null, kind: 'modified' },
      ],
      untracked: [],
      committedPaths: ['nur-committet.ts', 'beides.ts'],
      worktreePaths: ['nur-arbeitsbaum.ts', 'beides.ts'],
    });
    expect(files.map((f) => [f.path, f.state])).toEqual([
      ['beides.ts', 'both'],
      ['nur-arbeitsbaum.ts', 'uncommitted'],
      ['nur-committet.ts', 'committed'],
    ]);
  });

  it('führt Untracked immer als added/uncommitted', () => {
    const [file] = mergeFileChanges({
      netto: [],
      untracked: ['frisch.ts'],
      committedPaths: [],
      worktreePaths: ['frisch.ts'],
    });
    expect(file).toMatchObject({ path: 'frisch.ts', kind: 'added', state: 'uncommitted', oldPath: null });
  });

  it('übernimmt oldPath und kind einer Umbenennung', () => {
    const [file] = mergeFileChanges({
      netto: [{ path: 'neu.ts', oldPath: 'alt.ts', kind: 'renamed' }],
      untracked: [],
      committedPaths: ['neu.ts'],
      worktreePaths: [],
    });
    expect(file).toMatchObject({ path: 'neu.ts', oldPath: 'alt.ts', kind: 'renamed', state: 'committed' });
  });

  it('führt jeden Pfad höchstens einmal (Netto schlägt Untracked)', () => {
    const files = mergeFileChanges({
      netto: [{ path: 'doppelt.ts', oldPath: null, kind: 'modified' }],
      untracked: ['doppelt.ts'],
      committedPaths: ['doppelt.ts'],
      worktreePaths: [],
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ kind: 'modified', state: 'committed' });
  });

  it('setzt Warn-Markierungen zunächst auf false', () => {
    const [file] = mergeFileChanges({
      netto: [{ path: 'a.ts', oldPath: null, kind: 'modified' }],
      untracked: [],
      committedPaths: [],
      worktreePaths: ['a.ts'],
    });
    expect(file?.overlapping).toBe(false);
    expect(file?.behindTarget).toBe(false);
  });

  it('liefert ohne Änderungen eine leere Liste', () => {
    expect(
      mergeFileChanges({ netto: [], untracked: [], committedPaths: [], worktreePaths: [] }),
    ).toEqual([]);
  });
});

describe('detectOverlaps', () => {
  const file = (path: string, extra: Partial<WorktreeFileChange> = {}): WorktreeFileChange => ({
    path,
    oldPath: null,
    kind: 'modified',
    state: 'uncommitted',
    overlapping: false,
    behindTarget: false,
    ...extra,
  });

  const candidate = (
    entryId: string,
    paths: WorktreeFileChange[],
    dirState: WorktreeDirState = 'present',
  ): OverlapCandidate => ({
    entryId,
    label: entryId,
    featureId: `f-${entryId}`,
    dirState,
    files: paths,
  });

  it('findet eine Überschneidung über zwei Einträge und nennt den jeweils anderen', () => {
    const result = detectOverlaps([
      candidate('a', [file('gemeinsam.ts'), file('nur-a.ts')]),
      candidate('b', [file('gemeinsam.ts'), file('nur-b.ts')]),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      entryId: 'a',
      files: ['gemeinsam.ts'],
      others: [{ entryId: 'b', label: 'b', featureId: 'f-b' }],
    });
    expect(result[1]?.others.map((o) => o.entryId)).toEqual(['a']);
  });

  it('nennt bei drei Beteiligten jeweils beide anderen', () => {
    const result = detectOverlaps([
      candidate('a', [file('x.ts')]),
      candidate('b', [file('x.ts')]),
      candidate('c', [file('x.ts')]),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]?.others.map((o) => o.entryId)).toEqual(['b', 'c']);
    expect(result[2]?.others.map((o) => o.entryId)).toEqual(['a', 'b']);
  });

  it('meldet nichts, wenn sich die Dateien nicht überschneiden', () => {
    expect(
      detectOverlaps([candidate('a', [file('a.ts')]), candidate('b', [file('b.ts')])]),
    ).toEqual([]);
  });

  it('erzeugt über oldPath keinen Treffer — nur der neue Pfad zählt', () => {
    const result = detectOverlaps([
      candidate('a', [file('neu.ts', { kind: 'renamed', oldPath: 'gemeinsam.ts' })]),
      candidate('b', [file('gemeinsam.ts')]),
    ]);
    expect(result).toEqual([]);
  });

  it('erkennt eine Überschneidung auf dem neuen Pfad zweier Umbenennungen', () => {
    const result = detectOverlaps([
      candidate('a', [file('neu.ts', { kind: 'renamed', oldPath: 'alt-a.ts' })]),
      candidate('b', [file('neu.ts', { kind: 'renamed', oldPath: 'alt-b.ts' })]),
    ]);
    expect(result.map((r) => r.entryId)).toEqual(['a', 'b']);
    expect(result[0]?.files).toEqual(['neu.ts']);
  });

  it('schließt Einträge ohne vorhandenes Verzeichnis aus', () => {
    expect(
      detectOverlaps([
        candidate('a', [file('x.ts')]),
        candidate('b', [file('x.ts')], 'registry_only'),
        candidate('c', [file('x.ts')], 'missing'),
      ]),
    ).toEqual([]);
  });

  it('sortiert die betroffenen Pfade alphabetisch', () => {
    const result = detectOverlaps([
      candidate('a', [file('z.ts'), file('a.ts'), file('m.ts')]),
      candidate('b', [file('m.ts'), file('z.ts'), file('a.ts')]),
    ]);
    expect(result[0]?.files).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });

  it('liefert für eine leere Eingabe eine leere Liste', () => {
    expect(detectOverlaps([])).toEqual([]);
  });
});
