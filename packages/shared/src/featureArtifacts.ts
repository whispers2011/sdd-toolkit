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
 *
 * Die Reihenfolge wird NICHT von Hand gepflegt, sondern unten aus FEATURE_PHASES
 * abgeleitet: Bis 27.07.2026 stand `checklist` in dieser Liste hinter `tasks`,
 * in den Lanes aber davor — die Icons auf der Kachel liefen der Lane-Ordnung
 * entgegen. Sortieren statt Umsortieren macht ein erneutes Auseinanderlaufen
 * unmöglich (Drift-Guard-Muster wie in workflowModel.ts).
 */
const ARTIFACT_STEP_SPECS_UNSORTED: readonly ArtifactStepSpec[] = [
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

/**
 * Artefakt-Schritte in der Reihenfolge der SDD-Lanes. Eine neue oder umsortierte
 * Phase in FEATURE_PHASES verschiebt die Icons automatisch mit.
 */
export const ARTIFACT_STEP_SPECS: readonly ArtifactStepSpec[] = FEATURE_PHASES.flatMap(
  (phase) => ARTIFACT_STEP_SPECS_UNSORTED.filter((s) => s.phase === phase),
);

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
