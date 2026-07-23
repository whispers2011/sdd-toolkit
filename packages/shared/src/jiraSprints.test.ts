import { describe, expect, it } from 'vitest';
import { extractSprintsFromIssues, mergeSprints } from './jiraSprints.js';
import type { JiraSprint } from './types.js';

const sprint = (patch: Partial<JiraSprint> & { id: number }): JiraSprint => ({
  name: `Sprint ${patch.id}`,
  state: 'active',
  ...patch,
});

describe('mergeSprints (FR-007)', () => {
  it('dedupliziert Sprints über mehrere Boards per ID', () => {
    const merged = mergeSprints([sprint({ id: 1 }), sprint({ id: 1 }), sprint({ id: 2, state: 'future' })]);
    expect(merged.map((s) => s.id)).toEqual([1, 2]);
  });

  it('sortiert aktiv vor zukünftig, dann nach Startdatum', () => {
    const merged = mergeSprints([
      sprint({ id: 3, state: 'future', startDate: '2026-09-01' }),
      sprint({ id: 1, state: 'active', startDate: '2026-07-20' }),
      sprint({ id: 4, state: 'future', startDate: '2026-08-01' }),
      sprint({ id: 2, state: 'active', startDate: '2026-07-01' }),
    ]);
    expect(merged.map((s) => s.id)).toEqual([2, 1, 4, 3]);
  });

  it('Sprints ohne Startdatum landen am Ende ihrer Gruppe', () => {
    const merged = mergeSprints([
      sprint({ id: 1, state: 'active' }),
      sprint({ id: 2, state: 'active', startDate: '2026-07-01' }),
    ]);
    expect(merged.map((s) => s.id)).toEqual([2, 1]);
  });

  it('filtert abgeschlossene Sprints heraus', () => {
    const closed = { id: 9, name: 'Alt', state: 'closed' } as unknown as JiraSprint;
    expect(mergeSprints([closed, sprint({ id: 1 })])).toHaveLength(1);
  });

  it('bevorzugt beim Dedupe die Fassung mit Startdatum', () => {
    const merged = mergeSprints([sprint({ id: 1 }), sprint({ id: 1, startDate: '2026-07-01' })]);
    expect(merged[0]?.startDate).toBe('2026-07-01');
  });
});

describe('extractSprintsFromIssues (R4: Sprint-Feld ist instanzabhängig)', () => {
  it('findet Sprint-Objekte in beliebigen Custom-Feldern', () => {
    const issues = [
      {
        key: 'P-1',
        fields: {
          summary: 'x',
          customfield_10020: [{ id: 5, name: 'Sprint 5', state: 'active', startDate: '2026-07-20' }],
        },
      },
      {
        key: 'P-2',
        fields: { customfield_99: [{ id: 6, name: 'Sprint 6', state: 'future' }] },
      },
    ];
    const sprints = extractSprintsFromIssues(issues);
    expect(sprints.map((s) => s.id).sort()).toEqual([5, 6]);
  });

  it('parst das Greenhopper-String-Altformat', () => {
    const issues = [
      {
        fields: {
          customfield_10020: [
            'com.atlassian.greenhopper.service.sprint.Sprint@1a2b[id=7,rapidViewId=1,state=ACTIVE,name=Sprint 7,startDate=2026-07-01T00:00:00.000Z,endDate=<null>]',
          ],
        },
      },
    ];
    const sprints = extractSprintsFromIssues(issues);
    expect(sprints).toEqual([
      { id: 7, name: 'Sprint 7', state: 'active', startDate: '2026-07-01T00:00:00.000Z' },
    ]);
  });

  it('ignoriert Felder ohne Sprint-Form und geschlossene Sprints', () => {
    const issues = [
      {
        fields: {
          summary: 'kein Sprint',
          labels: ['a', 'b'],
          status: { name: 'Done' },
          customfield_10020: [{ id: 8, name: 'Alt', state: 'closed' }],
        },
      },
    ];
    expect(extractSprintsFromIssues(issues)).toEqual([]);
  });

  it('übersteht Issues ohne fields', () => {
    expect(extractSprintsFromIssues([null, {}, { fields: null }])).toEqual([]);
  });
});
