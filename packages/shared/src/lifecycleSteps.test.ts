import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  buildLifecycleEnv,
  compareStepOrder,
  lifecycleCwdKind,
  resolveLifecycleSteps,
  tailLines,
  triggerMatches,
} from './lifecycleSteps.js';
import type { LifecycleContext, LifecycleStep, LifecycleStepFeatureDecision } from './types.js';

function step(over: Partial<LifecycleStep> = {}): LifecycleStep {
  return {
    id: over.id ?? 's1',
    projectId: over.projectId ?? null,
    name: over.name ?? 'Schritt',
    command: over.command ?? 'true',
    trigger: over.trigger ?? { kind: 'after_worktree_create' },
    blocking: over.blocking ?? true,
    timeoutMs: over.timeoutMs ?? null,
    enabled: over.enabled ?? true,
    sortOrder: over.sortOrder ?? 0,
  };
}

describe('triggerMatches', () => {
  it('vergleicht die Art', () => {
    expect(triggerMatches({ kind: 'after_worktree_create' }, { kind: 'after_worktree_create' })).toBe(true);
    expect(triggerMatches({ kind: 'after_worktree_create' }, { kind: 'before_worktree_create' })).toBe(false);
  });

  it('vergleicht bei Phasen-Arten zusätzlich die Phase', () => {
    const configured = { kind: 'before_phase', phase: 'implement' } as const;
    expect(triggerMatches(configured, { kind: 'before_phase', phase: 'implement' })).toBe(true);
    expect(triggerMatches(configured, { kind: 'before_phase', phase: 'plan' })).toBe(false);
    // Ohne Phase im gefeuerten Auslöser darf nichts matchen.
    expect(triggerMatches(configured, { kind: 'before_phase' })).toBe(false);
  });

  it('vergleicht bei Stufen-Arten zusätzlich die Stufe', () => {
    const configured = { kind: 'after_stage', stage: 'merged' } as const;
    expect(triggerMatches(configured, { kind: 'after_stage', stage: 'merged' })).toBe(true);
    expect(triggerMatches(configured, { kind: 'after_stage', stage: 'verify' })).toBe(false);
    expect(triggerMatches(configured, { kind: 'before_stage', stage: 'merged' })).toBe(false);
  });
});

describe('compareStepOrder', () => {
  it('setzt globale Schritte vor projektspezifische', () => {
    const global = step({ id: 'g', projectId: null, sortOrder: 99 });
    const project = step({ id: 'p', projectId: 'p1', sortOrder: 0 });
    expect([project, global].sort(compareStepOrder).map((s) => s.id)).toEqual(['g', 'p']);
  });

  it('sortiert je Gruppe nach Position', () => {
    const a = step({ id: 'a', sortOrder: 10 });
    const b = step({ id: 'b', sortOrder: 0 });
    expect([a, b].sort(compareStepOrder).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('entscheidet bei Gleichstand nach Name', () => {
    const a = step({ id: 'a', name: 'Zebra', sortOrder: 0 });
    const b = step({ id: 'b', name: 'Anton', sortOrder: 0 });
    expect([a, b].sort(compareStepOrder).map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('lifecycleCwdKind', () => {
  it('läuft im Haupt-Checkout, wo der Lebenszyklus keinen Worktree hat', () => {
    expect(lifecycleCwdKind({ kind: 'before_worktree_create' })).toBe('main');
    expect(lifecycleCwdKind({ kind: 'after_stage', stage: 'merged' })).toBe('main');
  });

  it('läuft sonst im Worktree', () => {
    expect(lifecycleCwdKind({ kind: 'after_worktree_create' })).toBe('worktree');
    expect(lifecycleCwdKind({ kind: 'before_phase', phase: 'implement' })).toBe('worktree');
    expect(lifecycleCwdKind({ kind: 'after_phase', phase: 'plan' })).toBe('worktree');
    expect(lifecycleCwdKind({ kind: 'before_stage', stage: 'merged' })).toBe('worktree');
    expect(lifecycleCwdKind({ kind: 'after_stage', stage: 'verify' })).toBe('worktree');
  });
});

describe('DEFAULT_STEP_TIMEOUT_MS', () => {
  it('sind 15 Minuten', () => {
    expect(DEFAULT_STEP_TIMEOUT_MS).toBe(900_000);
  });
});

describe('buildLifecycleEnv', () => {
  const ctx: LifecycleContext = {
    worktreePath: '/wt/demo-eins',
    projectName: 'Demo',
    featureName: 'demo-eins',
    branch: 'feature/demo-eins',
    phase: 'implement',
    stage: null,
  };

  /**
   * Der Beweis für DIE eine Stelle (FR-013, US3 Szenario 4): die Schlüsselmenge ist
   * hier festgenagelt. Setzt jemand Variablen anderswo — oder ergänzt hier welche,
   * die nicht zum Vertrag gehören — schlägt dieser Test an.
   */
  it('liefert genau die sechs vertraglich zugesicherten Schlüssel', () => {
    expect(Object.keys(buildLifecycleEnv(ctx)).sort()).toEqual([
      'SDD_BRANCH',
      'SDD_FEATURE',
      'SDD_PHASE',
      'SDD_PROJECT',
      'SDD_STAGE',
      'SDD_WORKTREE',
    ]);
  });

  it('setzt SDD_PORT_BASE und SDD_PROFILE NICHT (FR-013/FR-014 — kommen mit der Portvergabe)', () => {
    const env = buildLifecycleEnv(ctx);
    expect('SDD_PORT_BASE' in env).toBe(false);
    expect('SDD_PROFILE' in env).toBe(false);
  });

  it('trägt Worktree, Projekt, Feature und Branch an jedem Auslöser', () => {
    const env = buildLifecycleEnv(ctx);
    expect(env.SDD_WORKTREE).toBe('/wt/demo-eins');
    expect(env.SDD_PROJECT).toBe('Demo');
    expect(env.SDD_FEATURE).toBe('demo-eins');
    expect(env.SDD_BRANCH).toBe('feature/demo-eins');
  });

  it('macht nicht zutreffende Angaben leer — nie ein Platzhalter (FR-012)', () => {
    const env = buildLifecycleEnv({ ...ctx, phase: null, stage: null });
    expect(env.SDD_PHASE).toBe('');
    expect(env.SDD_STAGE).toBe('');
    // Alle sechs Schlüssel bleiben vorhanden — `set -u` ist damit gefahrlos.
    expect(Object.keys(env)).toHaveLength(6);
  });

  it('setzt Phase und Stufe nie gleichzeitig aus einem anderen Vorgang', () => {
    const phasenLauf = buildLifecycleEnv({ ...ctx, phase: 'plan', stage: null });
    expect(phasenLauf.SDD_PHASE).toBe('plan');
    expect(phasenLauf.SDD_STAGE).toBe('');

    const stufenLauf = buildLifecycleEnv({ ...ctx, phase: null, stage: 'verify' });
    expect(stufenLauf.SDD_PHASE).toBe('');
    expect(stufenLauf.SDD_STAGE).toBe('verify');
  });
});

/**
 * SC-007: die vollständige Matrix der drei Ebenen. `exclude` schlägt alles,
 * `include` erzwingt auch bei deaktiviertem Schritt, sonst entscheidet `enabled`.
 */
describe('resolveLifecycleSteps — drei Ebenen', () => {
  const trigger = { kind: 'after_worktree_create' } as const;
  const decisions: (LifecycleStepFeatureDecision | 'auto')[] = ['auto', 'include', 'exclude'];
  const expected: Record<string, boolean> = {
    'global|true|auto': true,
    'global|true|include': true,
    'global|true|exclude': false,
    'global|false|auto': false,
    'global|false|include': true,
    'global|false|exclude': false,
    'projekt|true|auto': true,
    'projekt|true|include': true,
    'projekt|true|exclude': false,
    'projekt|false|auto': false,
    'projekt|false|include': true,
    'projekt|false|exclude': false,
  };

  for (const level of ['global', 'projekt'] as const) {
    for (const enabled of [true, false]) {
      for (const decision of decisions) {
        const key = `${level}|${enabled}|${decision}`;
        it(`${level}, ${enabled ? 'aktiv' : 'inaktiv'}, ${decision} → ${expected[key] ? 'läuft' : 'läuft nicht'}`, () => {
          const s = step({ id: 'x', projectId: level === 'global' ? null : 'p1', enabled });
          const selection = new Map<string, LifecycleStepFeatureDecision>(
            decision === 'auto' ? [] : [['x', decision]],
          );
          expect(resolveLifecycleSteps([s], selection, trigger).length).toBe(expected[key] ? 1 : 0);
        });
      }
    }
  }

  it('filtert Schritte anderer Auslöser heraus', () => {
    const passend = step({ id: 'a', trigger: { kind: 'after_worktree_create' } });
    const anders = step({ id: 'b', trigger: { kind: 'before_worktree_create' } });
    const phase = step({ id: 'c', trigger: { kind: 'before_phase', phase: 'plan' } });
    expect(resolveLifecycleSteps([passend, anders, phase], new Map(), trigger).map((s) => s.id)).toEqual(['a']);
  });

  it('hält die Reihenfolge global vor Projekt bei gleichem sortOrder stabil', () => {
    const projekt = step({ id: 'p', projectId: 'p1', name: 'Anton', sortOrder: 0 });
    const global = step({ id: 'g', projectId: null, name: 'Zebra', sortOrder: 0 });
    // Eingabereihenfolge darf das Ergebnis nicht beeinflussen.
    expect(resolveLifecycleSteps([projekt, global], new Map(), trigger).map((s) => s.id)).toEqual(['g', 'p']);
    expect(resolveLifecycleSteps([global, projekt], new Map(), trigger).map((s) => s.id)).toEqual(['g', 'p']);
  });

  it('liefert bei leerer Eingabe eine leere Liste (Fast-Path-Grundlage)', () => {
    expect(resolveLifecycleSteps([], new Map(), trigger)).toEqual([]);
  });
});

describe('tailLines', () => {
  it('liefert die letzten Zeilen ohne Leerzeile am Ende', () => {
    expect(tailLines('a\nb\nc\n', 2)).toBe('b\nc');
  });

  it('kappt hart auf die Zeichengrenze', () => {
    expect(tailLines('x'.repeat(5000), 20, 2000)).toHaveLength(2000);
  });

  it('gibt kurze Ausgaben unverändert zurück', () => {
    expect(tailLines('zeile a\nzeile b')).toBe('zeile a\nzeile b');
  });

  it('liefert für leere Ausgabe einen leeren String', () => {
    expect(tailLines('')).toBe('');
    expect(tailLines('\n\n')).toBe('');
  });
});
