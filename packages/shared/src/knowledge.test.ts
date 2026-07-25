import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeTree,
  detectCycle,
  projectIndex,
  resolveSelection,
  scoreRelevance,
  type KnowledgeBundle,
  type KnowledgeEntry,
  type KnowledgeFeatureSelection,
} from './knowledge.js';

const now = 1_000;

function bundle(p: Partial<KnowledgeBundle> & { id: string }): KnowledgeBundle {
  return {
    projectId: 'proj',
    parentId: null,
    name: p.id,
    applicability: { text: '', tags: [] },
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}

function entry(p: Partial<KnowledgeEntry> & { id: string }): KnowledgeEntry {
  return {
    projectId: 'proj',
    bundleId: null,
    title: p.id,
    body: 'Inhalt',
    applicability: { text: '', tags: [] },
    source: 'inline',
    sourcePath: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}

describe('buildKnowledgeTree', () => {
  it('verschachtelt Bundles und ordnet Einträge zu', () => {
    const bundles = [bundle({ id: 'auth' }), bundle({ id: 'sso', parentId: 'auth' })];
    const entries = [
      entry({ id: 'e1', bundleId: 'auth' }),
      entry({ id: 'e2', bundleId: 'sso' }),
      entry({ id: 'loose' }),
    ];
    const tree = buildKnowledgeTree(bundles, entries);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]!.bundle.id).toBe('auth');
    expect(tree.roots[0]!.entries.map((e) => e.id)).toEqual(['e1']);
    expect(tree.roots[0]!.children[0]!.bundle.id).toBe('sso');
    expect(tree.roots[0]!.children[0]!.entries.map((e) => e.id)).toEqual(['e2']);
    expect(tree.looseEntries.map((e) => e.id)).toEqual(['loose']);
  });

  it('behandelt Bundles mit unbekanntem Parent als Wurzel', () => {
    const tree = buildKnowledgeTree([bundle({ id: 'x', parentId: 'weg' })], []);
    expect(tree.roots.map((n) => n.bundle.id)).toEqual(['x']);
  });
});

describe('detectCycle', () => {
  const bundles = [bundle({ id: 'a' }), bundle({ id: 'b', parentId: 'a' }), bundle({ id: 'c', parentId: 'b' })];
  it('erkennt Selbst- und Vorfahren-Zyklen', () => {
    expect(detectCycle(bundles, 'a', 'a')).toBe(true); // selbst
    expect(detectCycle(bundles, 'a', 'c')).toBe(true); // c ist Nachfahre von a
  });
  it('erlaubt gültige Umhängungen', () => {
    expect(detectCycle(bundles, 'c', 'a')).toBe(false);
    expect(detectCycle(bundles, 'b', null)).toBe(false);
  });
});

describe('projectIndex', () => {
  const bundles = [bundle({ id: 'auth' }), bundle({ id: 'sso', parentId: 'auth' })];
  const entries = [entry({ id: 'e1', bundleId: 'auth', body: 'GEHEIM' })];

  it('listet Eltern vor Kindern und ohne Inhalte', () => {
    const idx = projectIndex(bundles, entries, now);
    expect(idx.items.map((i) => i.id)).toEqual(['auth', 'e1', 'sso']);
    // Keine Inhalte in der Projektion
    expect(JSON.stringify(idx.items)).not.toContain('GEHEIM');
    expect(idx.generatedAt).toBe(now);
    expect(idx.projectId).toBe('proj');
  });

  it('spiegelt Hinzufügen/Entfernen ohne separaten Schritt (Projektion)', () => {
    const before = projectIndex(bundles, entries, now);
    expect(before.items).toHaveLength(3);
    const after = projectIndex(bundles, [], now);
    expect(after.items.map((i) => i.id)).toEqual(['auth', 'sso']);
  });

  it('Performance-Sanity: ~50 Einträge < 50 ms', () => {
    const many = Array.from({ length: 50 }, (_, i) => entry({ id: `e${i}`, bundleId: 'auth' }));
    const start = performance.now();
    projectIndex(bundles, many, now);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('scoreRelevance + resolveSelection', () => {
  const bundles = [
    bundle({ id: 'auth', applicability: { text: 'bei Login und Token', tags: ['auth', 'jwt'] } }),
    bundle({ id: 'deploy', applicability: { text: 'bei Release und CI', tags: ['ci'] } }),
  ];
  const idx = projectIndex(bundles, [], now);

  it('bewertet passende Bundles höher', () => {
    const scored = scoreRelevance(idx, 'JWT-Login härten mit Token');
    const auth = scored.find((s) => s.id === 'auth')!;
    const deploy = scored.find((s) => s.id === 'deploy')!;
    expect(auth.score).toBeGreaterThan(deploy.score);
    expect(deploy.score).toBe(0);
  });

  it('kombiniert Auto-Vorschlag mit Overrides', () => {
    const scored = scoreRelevance(idx, 'JWT-Login');
    const selections: KnowledgeFeatureSelection[] = [
      { featureId: 'f', targetId: 'deploy', targetKind: 'bundle', decision: 'include' },
      { featureId: 'f', targetId: 'auth', targetKind: 'bundle', decision: 'exclude' },
    ];
    const r = resolveSelection(scored, selections, 1);
    expect(r.autoIncluded).toContain('auth');
    expect(r.effective).toContain('deploy'); // manuell aufgenommen
    expect(r.effective).not.toContain('auth'); // manuell ausgeschlossen gewinnt
  });
});
