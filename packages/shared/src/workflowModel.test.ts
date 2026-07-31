import { describe, expect, it } from 'vitest';
import {
  FEATURE_PHASES,
  INTEGRATION_STAGE_IDS,
  LEVEL2_DEFAULTS,
  LEVEL3_DEFAULTS,
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
  rejectTargetPhase,
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

  it('benennt die fehlende Verifikation, ohne eine zu behaupten (INV-2, SC-001)', () => {
    const meta = INTEGRATION_STAGE_META.verification_unconfigured;
    expect(meta.label).toBe('keine Verifikation konfiguriert');
    // Ton „human": die Konfiguration fehlt und nur ein Mensch kann sie nachholen.
    // Nicht 'escalation' (FR-010 schließt jede Eskalation aus) und nicht 'progress'
    // (es läuft nichts).
    expect(meta.tone).toBe('human');
    expect(meta.label).not.toContain('verifiziert');
    expect(meta.label).not.toContain('Verifikation läuft');
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

describe('rejectTargetPhase', () => {
  it('nimmt specify, wenn die Phase aktiv ist — auch wenn sie nicht die erste wäre', () => {
    expect(rejectTargetPhase(['specify', 'plan', 'implement'])).toBe('specify');
    expect(rejectTargetPhase(['clarify', 'specify'])).toBe('specify');
  });

  it('fällt ohne specify auf die erste geordnete Phase zurück', () => {
    expect(rejectTargetPhase(['plan', 'tasks', 'implement'])).toBe('plan');
  });

  it('liefert null, wenn gar keine Phase aktiv ist', () => {
    expect(rejectTargetPhase([])).toBeNull();
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

// ---------- Manuelles Test-Gate: neue Stufe und neuer Schalter ----------

describe('Manuelle Abnahme: Stufe und Schalter sind in allen Katalogen beantwortet', () => {
  it('führt die Stufe im Ton „human" — der Mensch ist am Zug, nichts ist kaputt', () => {
    expect(INTEGRATION_STAGE_META.awaiting_manual_test).toEqual({
      label: 'wartet auf manuelle Abnahme',
      tone: 'human',
    });
  });

  /** FR-024: die Stufe liegt VOR dem menschlichen Review, nicht danach. */
  it('reiht die Pipeline-Stufe zwischen Review-Gate und menschliches Review ein', () => {
    const ids = INTEGRATION_STEPS.map((s) => s.id);
    expect(ids.indexOf('manual_test')).toBeGreaterThan(ids.indexOf('review_gate'));
    expect(ids.indexOf('manual_test')).toBeLessThan(ids.indexOf('human_review'));
  });

  it('hängt die Stufe am Schalter manualTestGate', () => {
    const step = INTEGRATION_STEPS.find((s) => s.id === 'manual_test');
    expect(step?.requires).toBe('manualTestGate');
  });

  /**
   * FR-028: es gibt keinen automatischen Weg aus der Stufe heraus — deshalb kein
   * `humanUnless`, das sie überspringen könnte.
   */
  it('lässt die Abnahme von keinem Automatik-Schalter überspringen', () => {
    const step = INTEGRATION_STEPS.find((s) => s.id === 'manual_test');
    expect(step?.humanUnless).toBeUndefined();
    expect(step?.autoBy).toBeUndefined();
  });

  it('beschreibt den Schalter in AUTOMATION_META', () => {
    expect(AUTOMATION_META.manualTestGate.label).toBe('Manuelles Test-Gate');
    expect(AUTOMATION_META.manualTestGate.help).toContain('durchklickt');
  });

  /** FR-026: Stufe 2 hält an, Stufe 3 ist Autonomie. */
  it('ist in Stufe 2 an und in Stufe 3 aus', () => {
    expect(LEVEL2_DEFAULTS.manualTestGate).toBe(true);
    expect(LEVEL3_DEFAULTS.manualTestGate).toBe(false);
  });

  it('liefert einen Stufentitel aus dem Katalog statt eines Rohbezeichners', () => {
    expect(stageTitle('manual_test')).toBe('Manuelle Abnahme');
  });
});
