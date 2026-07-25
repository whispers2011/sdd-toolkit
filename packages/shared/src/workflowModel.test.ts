import { describe, expect, it } from 'vitest';
import {
  FEATURE_PHASES,
  LEVEL2_DEFAULTS,
  OPTIONAL_PHASES,
  type FeaturePhase,
} from './types.js';
import {
  AGENT_TRIGGER_META,
  AUTOMATION_META,
  INTEGRATION_STAGE_META,
  INTEGRATION_STEPS,
  PHASE_META,
  isOptionalPhase,
  orderedEnabledPhases,
} from './workflowModel.js';

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
