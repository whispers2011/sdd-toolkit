import { describe, expect, it } from 'vitest';
import {
  FEATURE_PHASES,
  INTEGRATION_STAGE_IDS,
  LEVEL2_DEFAULTS,
  LIFECYCLE_TRIGGER_KINDS,
  OPTIONAL_PHASES,
  type FeaturePhase,
} from './types.js';
import {
  AGENT_TRIGGER_META,
  AUTOMATION_META,
  INTEGRATION_STAGE_META,
  INTEGRATION_STEPS,
  LIFECYCLE_TRIGGER_META,
  PHASE_META,
  featureProgressLabel,
  isOptionalPhase,
  orderedEnabledPhases,
  stageTitle,
} from './workflowModel.js';
import type { Feature, IntegrationStage, PhaseState, PhaseStatus } from './types.js';

/**
 * Drift-Guard: Das Workflow-Modell muss die Domänen-Unions vollständig abdecken.
 * Bricht bewusst, sobald die App um eine Phase/ein Flag/eine Stage erweitert wird,
 * ohne die Workflow-Übersicht mitzuziehen (ergänzend zum Compile-Check der Records).
 */
describe('workflowModel deckt die Domäne vollständig ab', () => {
  it('kennt jede Feature-Phase mit nicht-leerem Titel/Zweck', () => {
    for (const phase of FEATURE_PHASES) {
      const meta = PHASE_META[phase];
      expect(meta, `PHASE_META fehlt für ${phase}`).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.purpose.length).toBeGreaterThan(0);
    }
  });

  it('kennt jedes Automation-Flag', () => {
    for (const key of Object.keys(LEVEL2_DEFAULTS) as (keyof typeof LEVEL2_DEFAULTS)[]) {
      const meta = AUTOMATION_META[key];
      expect(meta, `AUTOMATION_META fehlt für ${key}`).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });

  it('kennt jede Agent-Trigger-Art', () => {
    for (const kind of ['before_phase', 'after_phase', 'review_gate', 'manual'] as const) {
      expect(AGENT_TRIGGER_META[kind]).toBeDefined();
      expect(AGENT_TRIGGER_META[kind].short.length).toBeGreaterThan(0);
    }
  });

  it('kennt jede Integrations-Stage', () => {
    // Alle Werte des IntegrationStage-Union müssen eine Anzeige haben.
    for (const stage of Object.keys(INTEGRATION_STAGE_META)) {
      expect(INTEGRATION_STAGE_META[stage as keyof typeof INTEGRATION_STAGE_META].label.length).toBeGreaterThan(0);
    }
    // Mindestens die Endzustände sind vorhanden.
    expect(INTEGRATION_STAGE_META.merged.tone).toBe('done');
    expect(INTEGRATION_STAGE_META.none.tone).toBe('idle');
  });

  it('Integrations-Schritte referenzieren nur gültige Flags und Stages', () => {
    for (const step of INTEGRATION_STEPS) {
      for (const flag of [step.requires, step.humanUnless, step.autoBy]) {
        if (flag) expect(AUTOMATION_META[flag], `unbekanntes Flag: ${flag}`).toBeDefined();
      }
      if (step.escalatesTo) {
        expect(INTEGRATION_STAGE_META[step.escalatesTo], `unbekannte Stage: ${step.escalatesTo}`).toBeDefined();
      }
    }
    // Genau ein terminaler Erfolgsschritt.
    expect(INTEGRATION_STEPS.filter((s) => s.terminal)).toHaveLength(1);
  });

  it('kennt jede Lebenszyklus-Auslöser-Art mit nicht-leerem Titel und Chip', () => {
    for (const kind of LIFECYCLE_TRIGGER_KINDS) {
      const meta = LIFECYCLE_TRIGGER_META[kind];
      expect(meta, `LIFECYCLE_TRIGGER_META fehlt für ${kind}`).toBeDefined();
      expect(meta.title.length).toBeGreaterThan(0);
      expect(meta.short.length).toBeGreaterThan(0);
    }
    // Kein Eintrag zu viel — sonst zeigt die Übersicht eine Art, die es nicht gibt.
    expect(Object.keys(LIFECYCLE_TRIGGER_META).sort()).toEqual([...LIFECYCLE_TRIGGER_KINDS].sort());
  });

  it('INTEGRATION_STEPS-IDs sind exakt INTEGRATION_STAGE_IDS (Reihenfolge inklusive)', () => {
    expect(INTEGRATION_STEPS.map((s) => s.id)).toEqual([...INTEGRATION_STAGE_IDS]);
  });

  it('liefert für jede Stufen-ID einen nicht-leeren Titel', () => {
    for (const stage of INTEGRATION_STAGE_IDS) {
      expect(stageTitle(stage).length).toBeGreaterThan(0);
    }
  });
});

describe('orderedEnabledPhases', () => {
  it('respektiert die kanonische Reihenfolge, nicht die Eingabereihenfolge', () => {
    const enabled: FeaturePhase[] = ['implement', 'specify', 'plan'];
    expect(orderedEnabledPhases(enabled)).toEqual(['specify', 'plan', 'implement']);
  });

  it('filtert nicht aktive Phasen heraus', () => {
    expect(orderedEnabledPhases(['specify'])).toEqual(['specify']);
    expect(orderedEnabledPhases([])).toEqual([]);
  });
});

describe('isOptionalPhase', () => {
  it('markiert genau die optionalen Phasen', () => {
    for (const p of OPTIONAL_PHASES) expect(isOptionalPhase(p)).toBe(true);
    expect(isOptionalPhase('specify')).toBe(false);
    expect(isOptionalPhase('implement')).toBe(false);
  });
});

describe('featureProgressLabel', () => {
  const idle: PhaseState = { status: 'idle', stale: false };
  const phases = (overrides: Partial<Record<FeaturePhase, PhaseStatus>>): Feature['phases'] =>
    Object.fromEntries(
      FEATURE_PHASES.map((p) => [p, overrides[p] ? { status: overrides[p], stale: false } : idle]),
    ) as Feature['phases'];

  const feature = (
    integration: IntegrationStage,
    overrides: Partial<Record<FeaturePhase, PhaseStatus>> = {},
  ): Pick<Feature, 'phases' | 'integration'> => ({ integration, phases: phases(overrides) });

  it('nennt die laufende Phase', () => {
    expect(featureProgressLabel(feature('none', { implement: 'running' }))).toBe('Umsetzen läuft');
    expect(featureProgressLabel(feature('none', { specify: 'running' }))).toBe('Spezifizieren läuft');
  });

  it('nennt eine Phase, deren Ergebnis geprüft werden muss', () => {
    expect(featureProgressLabel(feature('none', { plan: 'awaiting_review' }))).toBe(
      'Planen: Ergebnis prüfen',
    );
  });

  it('nennt die weiteste freigegebene Phase, wenn nichts läuft', () => {
    expect(
      featureProgressLabel(feature('none', { specify: 'approved', plan: 'approved' })),
    ).toBe('Planen abgeschlossen');
  });

  it('meldet ein unberührtes Feature als „noch nicht begonnen"', () => {
    expect(featureProgressLabel(feature('none'))).toBe('noch nicht begonnen');
  });

  it('bevorzugt die Integrations-Stufe vor jedem Phasenstand', () => {
    expect(featureProgressLabel(feature('awaiting_human_review', { implement: 'running' }))).toBe(
      'Bereit zum Review',
    );
    expect(featureProgressLabel(feature('merged', { implement: 'approved' }))).toBe('Abgeschlossen');
    expect(featureProgressLabel(feature('verifying'))).toBe(INTEGRATION_STAGE_META.verifying.label);
    expect(featureProgressLabel(feature('conflict_escalated'))).toBe(
      INTEGRATION_STAGE_META.conflict_escalated.label,
    );
  });

  it('liefert für jede Integrations-Stufe außer „none" einen nicht-leeren Text', () => {
    for (const stage of Object.keys(INTEGRATION_STAGE_META) as IntegrationStage[]) {
      if (stage === 'none') continue;
      expect(featureProgressLabel(feature(stage)).length).toBeGreaterThan(0);
    }
  });
});
