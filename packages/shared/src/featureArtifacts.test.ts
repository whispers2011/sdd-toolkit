import { describe, expect, it } from 'vitest';
import type { Feature, FeaturePhase, PhaseState, PhaseStatus } from './types.js';
import { FEATURE_PHASES } from './types.js';
import {
  ARTIFACT_STEP_SPECS,
  artifactFileLabel,
  artifactStepSpec,
  featureLock,
} from './featureArtifacts.js';

function phaseState(status: PhaseStatus): PhaseState {
  return { status, stale: false };
}

function makeFeature(overrides: Partial<Record<FeaturePhase, PhaseStatus>> = {}): Feature {
  const phases = Object.fromEntries(
    FEATURE_PHASES.map((p) => [p, phaseState(overrides[p] ?? 'idle')]),
  ) as Record<FeaturePhase, PhaseState>;
  return {
    id: 'f1',
    projectId: 'p1',
    name: 'demo',
    branch: 'feature/demo',
    worktreePath: null,
    phases,
    integration: 'none',
    integrationTarget: null,
    automation: {},
    optimization: {},
    tasksDone: 0,
    tasksTotal: 0,
    reviewRejectedAt: null,
    cleanupError: null,
    createdAt: 0,
    archivedAt: null,
  };
}

describe('ARTIFACT_STEP_SPECS', () => {
  // Reihenfolge folgt seit 27.07.2026 den SDD-Lanes (FEATURE_PHASES): checklist
  // kommt vor tasks. Zuvor stand es am Ende, wodurch die Ergebnis-Icons auf der
  // Kachel der Lane-Reihenfolge widersprachen.
  it('deckt genau die artefakt-erzeugenden Schritte in Lane-Reihenfolge ab', () => {
    const phases = ARTIFACT_STEP_SPECS.map((s) => s.phase);
    expect(phases).toEqual(['specify', 'plan', 'checklist', 'tasks']);
  });

  it('enthält Clarify/Analyze/Implement nicht', () => {
    for (const p of ['clarify', 'analyze', 'implement'] as FeaturePhase[]) {
      expect(artifactStepSpec(p)).toBeUndefined();
    }
  });

  it('Plan hat Begleitartefakte und contracts-Glob, Checklist nur den Glob', () => {
    const plan = artifactStepSpec('plan')!;
    expect(plan.primaryRelPath).toBe('plan.md');
    expect(plan.companionRelPaths).toContain('research.md');
    expect(plan.globDirs).toContain('contracts');
    const checklist = artifactStepSpec('checklist')!;
    expect(checklist.primaryRelPath).toBeNull();
    expect(checklist.globDirs).toEqual(['checklists']);
  });
});

describe('artifactFileLabel', () => {
  it('mappt bekannte Dateien und präfixiert Contracts', () => {
    expect(artifactFileLabel('spec.md')).toBe('Spec');
    expect(artifactFileLabel('data-model.md')).toBe('Data Model');
    expect(artifactFileLabel('contracts/api.md')).toBe('Contract: api.md');
    expect(artifactFileLabel('checklists/requirements.md')).toBe('requirements');
  });
});

describe('featureLock', () => {
  it('nicht gesperrt, wenn keine Phase läuft', () => {
    expect(featureLock(makeFeature())).toEqual({ locked: false, reason: null });
    expect(featureLock(makeFeature({ specify: 'approved', plan: 'awaiting_review' })).locked).toBe(false);
  });

  it('gesperrt, sobald irgendeine Phase läuft (artefaktunabhängig)', () => {
    expect(featureLock(makeFeature({ tasks: 'running' })).locked).toBe(true);
    expect(featureLock(makeFeature({ implement: 'running' })).locked).toBe(true);
  });
});

// Regression 27.07.2026: `checklist` stand in ARTIFACT_STEP_SPECS hinter `tasks`,
// in FEATURE_PHASES aber davor — die Ergebnis-Icons auf der Kachel liefen der
// Lane-Reihenfolge entgegen. Die Liste wird jetzt aus FEATURE_PHASES abgeleitet.
describe('ARTIFACT_STEP_SPECS folgt der Lane-Reihenfolge', () => {
  it('ist nach FEATURE_PHASES sortiert', () => {
    const positions = ARTIFACT_STEP_SPECS.map((s) => FEATURE_PHASES.indexOf(s.phase));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('enthält checklist vor tasks — wie in den Lanes', () => {
    const order = ARTIFACT_STEP_SPECS.map((s) => s.phase);
    expect(order.indexOf('checklist')).toBeLessThan(order.indexOf('tasks'));
  });

  it('verliert keinen Schritt beim Sortieren', () => {
    expect(ARTIFACT_STEP_SPECS.map((s) => s.phase).sort()).toEqual(
      ['checklist', 'plan', 'specify', 'tasks'],
    );
  });
});
