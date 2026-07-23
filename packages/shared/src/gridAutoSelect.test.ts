import { describe, it, expect } from 'vitest';
import { selectAutoPanes, type GridSessionCandidate } from './gridAutoSelect.js';

function cand(over: Partial<GridSessionCandidate>): GridSessionCandidate {
  return {
    featureId: 'f1',
    projectId: 'p1',
    kind: 'feature',
    status: 'working',
    exited: false,
    lastActiveAt: 0,
    ...over,
  };
}

const P1 = 'p1';
const visible = (...ids: string[]) => new Set(ids);

describe('selectAutoPanes', () => {
  it('wählt arbeitende und wartende Sessions des Projekts', () => {
    const sessions = [
      cand({ featureId: 'a', status: 'working', lastActiveAt: 2 }),
      cand({ featureId: 'b', status: 'awaiting_input', lastActiveAt: 1 }),
    ];
    expect(selectAutoPanes(sessions, { projectId: P1, visibleFeatureIds: visible('a', 'b'), max: 9 })).toEqual([
      'a',
      'b',
    ]);
  });

  it('schließt idle/stopped/errored und beendete Sessions aus (FR-003)', () => {
    const sessions = [
      cand({ featureId: 'a', status: 'idle' }),
      cand({ featureId: 'b', status: 'stopped' }),
      cand({ featureId: 'c', status: 'errored' }),
      cand({ featureId: 'd', status: 'working', exited: true }),
      cand({ featureId: 'e', status: 'working' }),
    ];
    expect(
      selectAutoPanes(sessions, { projectId: P1, visibleFeatureIds: visible('a', 'b', 'c', 'd', 'e'), max: 9 }),
    ).toEqual(['e']);
  });

  it('schließt Sessions ohne Feature-Bezug aus (FR-013: Chat/Shell)', () => {
    const sessions = [
      cand({ featureId: null, kind: 'chat_work', status: 'awaiting_input' }),
      cand({ featureId: null, kind: 'shell', status: 'working' }),
      cand({ featureId: 'a', status: 'working' }),
    ];
    expect(selectAutoPanes(sessions, { projectId: P1, visibleFeatureIds: visible('a'), max: 9 })).toEqual(['a']);
  });

  it('schließt Sessions anderer Projekte aus (FR-008)', () => {
    const sessions = [
      cand({ featureId: 'a', projectId: 'other', status: 'working' }),
      cand({ featureId: 'b', projectId: P1, status: 'working' }),
    ];
    expect(selectAutoPanes(sessions, { projectId: P1, visibleFeatureIds: visible('a', 'b'), max: 9 })).toEqual(['b']);
  });

  it('schließt Features aus, die nicht sichtbar sind (z. B. gemergt)', () => {
    const sessions = [
      cand({ featureId: 'a', status: 'working' }),
      cand({ featureId: 'merged', status: 'working' }),
    ];
    expect(selectAutoPanes(sessions, { projectId: P1, visibleFeatureIds: visible('a'), max: 9 })).toEqual(['a']);
  });

  it('dedupliziert pro Feature und nimmt die zuletzt aktive Session (FR-012)', () => {
    const sessions = [
      cand({ featureId: 'a', status: 'working', lastActiveAt: 5 }),
      cand({ featureId: 'a', status: 'awaiting_input', lastActiveAt: 10 }),
    ];
    // Nur eine Kachel für 'a', deren Aktivitätszeit die größere (10) ist → Sortierung nutzt 10.
    const sessions2 = [...sessions, cand({ featureId: 'b', status: 'working', lastActiveAt: 8 })];
    expect(
      selectAutoPanes(sessions2, { projectId: P1, visibleFeatureIds: visible('a', 'b'), max: 9 }),
    ).toEqual(['a', 'b']);
  });

  it('sortiert zuletzt aktiv zuerst (FR-004/SC-003)', () => {
    const sessions = [
      cand({ featureId: 'old', lastActiveAt: 100 }),
      cand({ featureId: 'new', lastActiveAt: 300 }),
      cand({ featureId: 'mid', lastActiveAt: 200 }),
    ];
    expect(
      selectAutoPanes(sessions, { projectId: P1, visibleFeatureIds: visible('old', 'new', 'mid'), max: 9 }),
    ).toEqual(['new', 'mid', 'old']);
  });

  it('überschreitet die Höchstzahl nie und nimmt die N jüngsten (FR-005/FR-006/SC-002/SC-003)', () => {
    const sessions = [
      cand({ featureId: 'a', lastActiveAt: 1 }),
      cand({ featureId: 'b', lastActiveAt: 2 }),
      cand({ featureId: 'c', lastActiveAt: 3 }),
      cand({ featureId: 'd', lastActiveAt: 4 }),
    ];
    expect(
      selectAutoPanes(sessions, { projectId: P1, visibleFeatureIds: visible('a', 'b', 'c', 'd'), max: 2 }),
    ).toEqual(['d', 'c']);
  });

  it('liefert bei gleichem/fehlendem Zeitstempel eine stabile Reihenfolge (FR-009/SC-005)', () => {
    const sessions = [
      cand({ featureId: 'c' }),
      cand({ featureId: 'a' }),
      cand({ featureId: 'b' }),
    ];
    const opts = { projectId: P1, visibleFeatureIds: visible('a', 'b', 'c'), max: 9 };
    const first = selectAutoPanes(sessions, opts);
    expect(first).toEqual(['a', 'b', 'c']); // Tiebreak: Feature-Id aufsteigend
    // Wiederholtes Aufrufen (auch mit vertauschter Eingabe) ergibt dieselbe Reihenfolge.
    expect(selectAutoPanes([...sessions].reverse(), opts)).toEqual(first);
  });

  it('gibt bei fehlendem Projekt oder max<=0 nichts zurück', () => {
    const sessions = [cand({ featureId: 'a' })];
    expect(selectAutoPanes(sessions, { projectId: null, visibleFeatureIds: visible('a'), max: 9 })).toEqual([]);
    expect(selectAutoPanes(sessions, { projectId: P1, visibleFeatureIds: visible('a'), max: 0 })).toEqual([]);
  });

  it('gibt bei keinen Kandidaten eine leere Auswahl zurück (Edge Case)', () => {
    expect(selectAutoPanes([], { projectId: P1, visibleFeatureIds: visible('a'), max: 9 })).toEqual([]);
  });
});
