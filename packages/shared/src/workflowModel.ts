/**
 * Deklaratives Workflow-Modell (Feature "workflow-overview").
 *
 * Einzige Quelle der Wahrheit für die STRUKTUR des SDD-Workflows, aus der die
 * Workflow-Übersicht rein rendert. Bewusst domänen-abgeleitet: die Meta-Maps
 * sind über die Domänen-Unions getypt (`Record<FeaturePhase, …>` usw.), sodass
 * jede künftige Erweiterung (neue Phase, neues Automation-Flag, neue Trigger-Art,
 * neue Integrations-Stufe) `pnpm typecheck` an genau dieser Stelle bricht — die
 * Übersicht kann nicht mehr still veralten. Zusätzlich abgesichert durch
 * workflowModel.test.ts (Laufzeit-Exhaustiveness).
 *
 * KEINE UI, KEIN IO — pure Daten + kleine Helfer, in Isolation testbar.
 */
import { FEATURE_PHASES, OPTIONAL_PHASES } from './types.js';
import type {
  AgentTriggerKind,
  AutomationSettings,
  FeaturePhase,
  IntegrationStage,
} from './types.js';

// ---------- Phasen ----------

export interface PhaseMeta {
  /** Menschlicher Titel des Schritts. */
  label: string;
  /** Ein Satz: was der Schritt tut / welches Artefakt entsteht. */
  purpose: string;
}

/**
 * Titel/Zweck je Feature-Phase. Über `Record<FeaturePhase, …>` getypt ⇒ eine
 * neue Phase in FEATURE_PHASES erzwingt hier einen Eintrag (Compile-Fehler sonst).
 */
export const PHASE_META: Record<FeaturePhase, PhaseMeta> = {
  specify: {
    label: 'Spezifizieren',
    purpose: 'Aus der Anforderung eine spec.md ableiten (was & warum, ohne Implementierung).',
  },
  clarify: {
    label: 'Klären',
    purpose: 'Offene Punkte der Spezifikation durch gezielte Rückfragen schließen.',
  },
  plan: {
    label: 'Planen',
    purpose: 'Technischer Plan (plan.md) inkl. Begleitartefakten aus der Spec.',
  },
  checklist: {
    label: 'Checkliste',
    purpose: 'Qualitäts-/Abnahme-Checkliste für das Feature erzeugen.',
  },
  analyze: {
    label: 'Analysieren',
    purpose: 'Spec/Plan/Tasks auf Konsistenz und Lücken gegenprüfen.',
  },
  tasks: {
    label: 'Aufgaben',
    purpose: 'Plan in eine geordnete, abhakbare tasks.md zerlegen.',
  },
  implement: {
    label: 'Umsetzen',
    purpose: 'Die Aufgaben abarbeiten und den Code im Worktree implementieren.',
  },
};

/** In FEATURE_PHASES-Reihenfolge, gefiltert auf die im Projekt aktiven Phasen. */
export function orderedEnabledPhases(enabled: readonly FeaturePhase[]): FeaturePhase[] {
  return FEATURE_PHASES.filter((p) => enabled.includes(p));
}

/** Kann diese Phase pro Projekt abgeschaltet werden? */
export function isOptionalPhase(phase: FeaturePhase): boolean {
  return OPTIONAL_PHASES.includes(phase);
}

// ---------- Automation-Dial ----------

export interface AutomationMeta {
  label: string;
  /** Was das Flag im Fluss bewirkt (Tooltip). */
  help: string;
  onLabel: string;
  offLabel: string;
}

/**
 * Beschriftung je Automation-Flag. Über `Record<keyof AutomationSettings, …>`
 * getypt ⇒ ein neues Flag erzwingt hier einen Eintrag und taucht damit
 * automatisch in der Übersicht auf.
 */
export const AUTOMATION_META: Record<keyof AutomationSettings, AutomationMeta> = {
  autoProgressUntil: {
    label: 'Auto-Progress',
    help: 'Nach Abschluss einer Phase startet die nächste automatisch — bis einschließlich der eingestellten Phase.',
    onLabel: 'automatisch bis Phase',
    offLabel: 'jede Phase manuell freigeben',
  },
  autoMode: {
    label: 'Auto-Freigaben',
    help: 'Tool-/Kommando-Berechtigungen werden automatisch erteilt — keine Rückfragen im Lauf (bypassPermissions).',
    onLabel: 'an (keine Rückfragen)',
    offLabel: 'aus (Edits erlaubt, Kommandos fragen nach)',
  },
  autoVerify: {
    label: 'Auto-Verify',
    help: 'Nach der letzten Phase startet die Verifikations-Pipeline automatisch.',
    onLabel: 'automatisch nach implement',
    offLabel: 'manuell integrieren',
  },
  autoReviewAgents: {
    label: 'Review-Agents',
    help: 'Die review_gate-Agents laufen vor dem menschlichen Review automatisch.',
    onLabel: 'automatisch',
    offLabel: 'übersprungen',
  },
  autoMerge: {
    label: 'Auto-Merge',
    help: 'Freigegebene/verifizierte Features gehen automatisch in die Merge-Queue (ohne separaten Human-Review-Halt).',
    onLabel: 'automatisch',
    offLabel: 'Human-Review vor Merge',
  },
};

// ---------- Agent-Trigger ----------

export interface AgentTriggerMeta {
  label: string;
  /** Kompaktes Chip-Label. */
  short: string;
  /** Wo im Fluss der Trigger sitzt (für die Positionierung/Erklärung). */
  where: 'phase-before' | 'phase-after' | 'integration' | 'manual';
}

/**
 * Beschriftung je Agent-Trigger-Art. Über `Record<AgentTriggerKind, …>` getypt
 * ⇒ eine neue Trigger-Art erzwingt hier einen Eintrag.
 */
export const AGENT_TRIGGER_META: Record<AgentTriggerKind, AgentTriggerMeta> = {
  before_phase: { label: 'Vor Phase (Gate)', short: 'vor', where: 'phase-before' },
  after_phase: { label: 'Nach Phase (Gate)', short: 'nach', where: 'phase-after' },
  review_gate: { label: 'Review-Gate (Integration)', short: 'Review-Gate', where: 'integration' },
  manual: { label: 'Nur manuell', short: 'manuell', where: 'manual' },
};

// ---------- Integration-Pipeline ----------

export type IntegrationTone = 'idle' | 'progress' | 'human' | 'escalation' | 'done';

/**
 * Anzeige je Integrations-Stage. Über `Record<IntegrationStage, …>` getypt ⇒
 * eine neue Stage erzwingt hier einen Eintrag.
 */
export const INTEGRATION_STAGE_META: Record<IntegrationStage, { label: string; tone: IntegrationTone }> = {
  none: { label: 'nicht in Integration', tone: 'idle' },
  verifying: { label: 'Verifikation läuft', tone: 'progress' },
  verify_failed: { label: 'Verifikation fehlgeschlagen', tone: 'escalation' },
  review_gate: { label: 'Review-Gate läuft', tone: 'progress' },
  gate_failed: { label: 'Review-Gate FAIL', tone: 'escalation' },
  awaiting_human_review: { label: 'wartet auf menschliches Review', tone: 'human' },
  queued: { label: 'in der Merge-Queue', tone: 'progress' },
  merging: { label: 'Merge läuft', tone: 'progress' },
  conflict_resolving: { label: 'Konfliktauflösung (Agent)', tone: 'progress' },
  conflict_escalated: { label: 'Konflikt eskaliert', tone: 'escalation' },
  merged: { label: 'gemergt', tone: 'done' },
};

/**
 * Ein Schritt der Integrations-Pipeline (nach `implement`). Deklarative
 * Abbildung von mergeQueueService.beginIntegration/processItem.
 *
 * WICHTIG: Diese Sequenz bildet imperative Merge-Logik ab und muss bei
 * strukturellen Änderungen an der Pipeline mitgezogen werden — sie kann nicht
 * automatisch aus dem Kontrollfluss abgeleitet werden. Die referenzierten
 * Automation-Flags und Stages sind jedoch getypt (Compile-Fehler bei Umbenennung).
 */
export interface IntegrationStep {
  id: string;
  label: string;
  detail: string;
  icon: string;
  /** Läuft nur, wenn dieses Flag an ist (sonst „übersprungen"). */
  requires?: keyof AutomationSettings;
  /** Menschlicher Checkpoint — außer dieses Flag ist an. */
  humanUnless?: keyof AutomationSettings;
  /** „auto", wenn dieses Flag an ist, sonst „manuell". */
  autoBy?: keyof AutomationSettings;
  /** Fehlschlag eskaliert mit dieser Stage in die „Braucht dich"-Inbox. */
  escalatesTo?: IntegrationStage;
  /** Hier laufen die review_gate-Agents. */
  showsReviewGateAgents?: boolean;
  /** Terminaler Erfolg. */
  terminal?: boolean;
}

export const INTEGRATION_STEPS: IntegrationStep[] = [
  {
    id: 'verify',
    label: 'Verifikation',
    detail: 'Test/Build/Lint im Worktree (pro Projekt konfigurierbar). Vorher: Worktree committen.',
    icon: '📋',
    autoBy: 'autoVerify',
    escalatesTo: 'verify_failed',
  },
  {
    id: 'review_gate',
    label: 'Review-Gate',
    detail: 'review_gate-Agents laufen sequentiell headless; erster blockierender FAIL eskaliert.',
    icon: '⚖',
    requires: 'autoReviewAgents',
    escalatesTo: 'gate_failed',
    showsReviewGateAgents: true,
  },
  {
    id: 'human_review',
    label: 'Menschliches Review',
    detail: 'Review-Portal: Diff prüfen, Kommentare, Ziel-Branch wählen, Freigabe erteilen.',
    icon: '🧑',
    humanUnless: 'autoMerge',
  },
  {
    id: 'merge_queue',
    label: 'Merge-Queue',
    detail: 'Sequentiell je Projekt: rebase → Auto-Konfliktauflösung (Headless-Claude) → Re-Verify → Merge.',
    icon: '🔀',
    autoBy: 'autoMerge',
    escalatesTo: 'conflict_escalated',
  },
  {
    id: 'merged',
    label: 'Gemergt',
    detail: 'Merge ins Ziel (bzw. PR im PR-Modus) + Worktree/Branch-Cleanup.',
    icon: '✓',
    terminal: true,
  },
];
