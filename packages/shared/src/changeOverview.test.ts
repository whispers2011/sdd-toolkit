import { describe, expect, it } from 'vitest';
import {
  buildChangeOverview,
  overviewGroupKey,
  MAX_OVERVIEW_COMMITS,
  MAX_OVERVIEW_FILES,
  ROOT_GROUP_KEY,
  type ChangeCommit,
  type ChangeFile,
} from './changeOverview.js';

/** Textdatei mit Umfang `additions + deletions`. */
const f = (path: string, additions: number, deletions: number): ChangeFile => ({
  path,
  additions,
  deletions,
  binary: false,
});

/** Binärdatei — git meldet keine Zeilen, also 0/0 (R5). */
const bin = (path: string): ChangeFile => ({ path, additions: 0, deletions: 0, binary: true });

const commit = (sha: string, date: number, subject: string): ChangeCommit => ({ sha, date, subject });

/** Alle gezeigten Dateien über alle Gruppen — die Kürzungsgrenze gilt gruppenübergreifend (R1). */
const shown = (groups: readonly { files: readonly ChangeFile[] }[]) => groups.flatMap((g) => [...g.files]);

describe('overviewGroupKey', () => {
  it('nimmt bei ≥ 3 Segmenten die ersten zwei, sonst das erste, Wurzel eigens', () => {
    expect(overviewGroupKey('packages/web/src/components/X.tsx')).toBe('packages/web');
    expect(overviewGroupKey('specs/foo/spec.md')).toBe('specs/foo');
    expect(overviewGroupKey('docs/x.md')).toBe('docs');
    expect(overviewGroupKey('README.md')).toBe(ROOT_GROUP_KEY);
  });
});

describe('buildChangeOverview — Kürzung und Restzahl (R1)', () => {
  it('zeigt bei 14 Dateien zehn und meldet vier als verborgen (Massstab 30.07.)', () => {
    const files = Array.from({ length: 14 }, (_, i) => f(`packages/web/src/f${i}.ts`, 100 - i, 0));
    const o = buildChangeOverview({ files, commits: [] });

    expect(o.totals.files).toBe(14);
    expect(shown(o.groups)).toHaveLength(MAX_OVERVIEW_FILES);
    expect(o.hiddenFiles).toBe(4);
    // Invariante I1: gezeigte + verborgene Dateien ergeben immer die Gesamtzahl.
    expect(shown(o.groups).length + o.hiddenFiles).toBe(o.totals.files);
  });

  it('zeigt bei 90 Dateien zehn, meldet 80 verborgen und rechnet die Kopfzahlen über alle 90', () => {
    const files = Array.from({ length: 90 }, (_, i) => f(`packages/web/src/f${i}.ts`, 2, 3));
    const o = buildChangeOverview({ files, commits: [] });

    expect(shown(o.groups)).toHaveLength(MAX_OVERVIEW_FILES);
    expect(o.hiddenFiles).toBe(80);
    expect(o.totals.files).toBe(90);
    expect(o.totals.additions).toBe(180);
    expect(o.totals.deletions).toBe(270);
  });

  it('verbirgt bei genau zehn Dateien nichts', () => {
    const files = Array.from({ length: 10 }, (_, i) => f(`docs/f${i}.md`, 5, 1));
    const o = buildChangeOverview({ files, commits: [] });

    expect(shown(o.groups)).toHaveLength(10);
    expect(o.hiddenFiles).toBe(0);
  });
});

describe('buildChangeOverview — Sortierung (R2, R3)', () => {
  it('sortiert nach Umfang absteigend, bei Gleichstand nach Pfad — und liefert zweimal dasselbe', () => {
    const files = [f('docs/b.md', 5, 5), f('docs/a.md', 5, 5), f('docs/c.md', 20, 0), f('docs/d.md', 1, 0)];
    const first = buildChangeOverview({ files, commits: [] });
    const second = buildChangeOverview({ files, commits: [] });

    expect(shown(first.groups).map((x) => x.path)).toEqual(['docs/c.md', 'docs/a.md', 'docs/b.md', 'docs/d.md']);
    expect(second).toEqual(first);
  });

  it('ordnet Gruppen nach ihrer gezeigten Summe, bei Gleichstand nach Schlüssel', () => {
    const files = [f('docs/small.md', 1, 0), f('packages/web/src/big.ts', 90, 10), f('specs/foo/mid.md', 20, 0)];
    const o = buildChangeOverview({ files, commits: [] });

    expect(o.groups.map((g) => g.key)).toEqual(['packages/web', 'specs/foo', 'docs']);
    expect(o.groups[0]!.additions).toBe(90);
    expect(o.groups[0]!.deletions).toBe(10);
  });

  it('deckt alle vier Formen des Gruppenschlüssels in einem Aufruf ab', () => {
    const files = [
      f('packages/web/src/components/X.tsx', 40, 0),
      f('specs/foo/spec.md', 30, 0),
      f('docs/x.md', 20, 0),
      f('README.md', 10, 0),
    ];
    const o = buildChangeOverview({ files, commits: [] });

    expect(o.groups.map((g) => g.key)).toEqual(['packages/web', 'specs/foo', 'docs', ROOT_GROUP_KEY]);
  });
});

describe('buildChangeOverview — Binärdateien (R5)', () => {
  it('behält 0/0 und binary, ohne die Datei aus der Zählung zu nehmen', () => {
    const o = buildChangeOverview({ files: [f('docs/a.md', 3, 1), bin('docs/images/review.png')], commits: [] });
    const png = shown(o.groups).find((x) => x.path === 'docs/images/review.png')!;

    expect(png.binary).toBe(true);
    expect(png.additions).toBe(0);
    expect(png.deletions).toBe(0);
    expect(o.totals.files).toBe(2);
    expect(o.totals.binaryFiles).toBe(1);
  });

  it('meldet bei ausschliesslich Binärdateien Änderungen ohne Zeilenbilanz', () => {
    const o = buildChangeOverview({ files: [bin('a.png'), bin('b.xlsx')], commits: [] });

    expect(o.hasChanges).toBe(true);
    expect(o.totals.additions).toBe(0);
    expect(o.totals.deletions).toBe(0);
    expect(o.totals.binaryFiles).toBe(o.totals.files);
  });
});

describe('buildChangeOverview — leere Fälle (R6, R7)', () => {
  it('meldet ohne Dateien nichts Geändertes und keine Nullwert-Gruppen', () => {
    const o = buildChangeOverview({ files: [], commits: [commit('a1', 1, 'egal')] });

    expect(o.hasChanges).toBe(false);
    expect(o.groups).toEqual([]);
    expect(o.hiddenFiles).toBe(0);
    expect(o.totals).toEqual({ files: 0, additions: 0, deletions: 0, binaryFiles: 0, commits: 1 });
  });

  it('lässt den Dateiteil vollständig, wenn es noch keine Commits gibt', () => {
    const o = buildChangeOverview({ files: [f('docs/a.md', 4, 2)], commits: [] });

    expect(o.hasCommits).toBe(false);
    expect(o.recentCommits).toEqual([]);
    expect(o.hasChanges).toBe(true);
    expect(o.totals.commits).toBe(0);
    expect(shown(o.groups)).toHaveLength(1);
  });
});

describe('buildChangeOverview — Commits (R4)', () => {
  it('nimmt aus unsortierter Eingabe die drei jüngsten, jüngster zuerst', () => {
    const commits = [
      commit('c2', 2000, 'zweiter'),
      commit('c5', 5000, 'fünfter'),
      commit('c1', 1000, 'erster'),
      commit('c4', 4000, 'vierter'),
      commit('c3', 3000, 'dritter'),
    ];
    const o = buildChangeOverview({ files: [f('docs/a.md', 1, 0)], commits });

    expect(o.recentCommits).toHaveLength(MAX_OVERVIEW_COMMITS);
    expect(o.recentCommits.map((c) => c.sha)).toEqual(['c5', 'c4', 'c3']);
    expect(o.totals.commits).toBe(5);
    expect(o.hasCommits).toBe(true);
  });
});

describe('buildChangeOverview — Reinheit (R8)', () => {
  it('lässt die Eingabe-Arrays unverändert (Sortierung auf Kopien)', () => {
    const files = [f('docs/a.md', 1, 0), f('docs/b.md', 99, 0)];
    const commits = [commit('c1', 1000, 'erster'), commit('c2', 9000, 'zweiter')];
    const filesBefore = [...files];
    const commitsBefore = [...commits];

    buildChangeOverview({ files, commits });

    expect(files).toEqual(filesBefore);
    expect(commits).toEqual(commitsBefore);
    // Referenzgleichheit: die Reihenfolge der Original-Arrays wurde nicht umgestellt.
    expect(files[0]).toBe(filesBefore[0]);
    expect(commits[0]).toBe(commitsBefore[0]);
  });
});
