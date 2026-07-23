import type { Feature, FeaturePhase } from './types.js';
import { FEATURE_PHASES } from './types.js';

/**
 * Deklarative Spezifikation eines artefakt-erzeugenden Schritts. Rein datenbasiert;
 * die tatsächliche Datei-Auflösung (Existenz, Verzeichnis-Globs) erfolgt im Server-Service.
 */
export interface ArtifactStepSpec {
  phase: FeaturePhase;
  label: string;
  tooltip: string;
  /** Primärdatei relativ zu specs/<feature>/; null bei reinen Verzeichnis-Schritten (z. B. checklist). */
  primaryRelPath: string | null;
  /** Optionale Begleitdateien (nur gelistet, falls vorhanden). */
  companionRelPaths: string[];
  /** Verzeichnisse (relativ), deren .md-Dateien (nicht rekursiv) als Artefakte gelten. */
  globDirs: string[];
}

/**
 * Nur diese Schritte erzeugen ein einsehbares Ergebnis-Artefakt.
 * Clarify (schreibt in spec.md), Analyze (Report) und Implement (Code) erhalten kein Icon.
 */
export const ARTIFACT_STEP_SPECS: readonly ArtifactStepSpec[] = [
  {
    phase: 'specify',
    label: 'Specify',
    tooltip: 'Specify-Ergebnis ansehen (spec.md)',
    primaryRelPath: 'spec.md',
    companionRelPaths: [],
    globDirs: [],
  },
  {
    phase: 'plan',
    label: 'Plan',
    tooltip: 'Plan-Ergebnis ansehen (plan.md + Begleitartefakte)',
    primaryRelPath: 'plan.md',
    companionRelPaths: ['research.md', 'data-model.md', 'quickstart.md'],
    globDirs: ['contracts'],
  },
  {
    phase: 'tasks',
    label: 'Tasks',
    tooltip: 'Tasks-Ergebnis ansehen (tasks.md)',
    primaryRelPath: 'tasks.md',
    companionRelPaths: [],
    globDirs: [],
  },
  {
    phase: 'checklist',
    label: 'Checklist',
    tooltip: 'Checklisten ansehen',
    primaryRelPath: null,
    companionRelPaths: [],
    globDirs: ['checklists'],
  },
];

/** Spezifikation eines Schritts (oder undefined, wenn der Schritt kein Artefakt erzeugt). */
export function artifactStepSpec(phase: FeaturePhase): ArtifactStepSpec | undefined {
  return ARTIFACT_STEP_SPECS.find((s) => s.phase === phase);
}

/** Menschenlesbares Label für eine Artefakt-Datei anhand ihres relativen Pfads. */
export function artifactFileLabel(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath;
  if (relPath.startsWith('contracts/')) return `Contract: ${base}`;
  const name = base.replace(/\.md$/i, '');
  const map: Record<string, string> = {
    spec: 'Spec',
    plan: 'Plan',
    research: 'Research',
    'data-model': 'Data Model',
    quickstart: 'Quickstart',
    tasks: 'Tasks',
  };
  return map[name] ?? name;
}

/**
 * Feature-weite Bearbeitungs-Sperre (FR-011): gesperrt, solange irgendeine Phase des Features
 * läuft — artefaktunabhängig. Einsehen bleibt unabhängig davon immer möglich.
 */
export function featureLock(feature: Feature): { locked: boolean; reason: string | null } {
  const running = FEATURE_PHASES.some((p) => feature.phases[p]?.status === 'running');
  return running
    ? { locked: true, reason: 'Ein Agent entwickelt dieses Feature gerade.' }
    : { locked: false, reason: null };
}
