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
  Feature,
  FeaturePhase,
  IntegrationStage,
  LifecycleStageId,
  LifecycleTrigger,
  LifecycleTriggerKind,
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
  manualTestGate: {
    label: 'Manuelles Test-Gate',
    help: 'Nach dem Review-Gate hält das Feature an, damit ein Mensch die laufende Anwendung durchklickt — vor dem menschlichen Review.',
    onLabel: 'hält vor dem Review zur Abnahme an',
    offLabel: 'ohne Halt zur Abnahme',
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

// ---------- Lebenszyklus-Schritte ----------

export interface LifecycleTriggerMeta {
  /** Titel im Auslöser-Katalog (Auswahlfeld, Workflow-Übersicht). */
  title: string;
  /** Kompaktes Chip-Label; bei Phasen-/Stufen-Arten der Präfix vor dem Phasen-/Stufentitel. */
  short: string;
}

/**
 * Beschriftung je Auslöser-Art der Lebenszyklus-Schritte. Über
 * `Record<LifecycleTriggerKind, …>` getypt ⇒ eine neue Art erzwingt hier einen
 * Eintrag und erscheint damit automatisch in der Workflow-Übersicht.
 */
export const LIFECYCLE_TRIGGER_META: Record<LifecycleTriggerKind, LifecycleTriggerMeta> = {
  before_worktree_create: { title: 'Vor Worktree-Anlage', short: 'vor Worktree' },
  after_worktree_create: { title: 'Nach Worktree-Anlage', short: 'nach Worktree' },
  before_phase: { title: 'Vor Phase …', short: 'vor' },
  after_phase: { title: 'Nach Phase …', short: 'nach' },
  before_stage: { title: 'Vor Stufe …', short: 'vor' },
  after_stage: { title: 'Nach Stufe …', short: 'nach' },
};

/** Titel je Integrations-Stufe — dieselben Labels wie in {@link INTEGRATION_STEPS}. */
export function stageTitle(stage: LifecycleStageId): string {
  return INTEGRATION_STEPS.find((s) => s.id === stage)?.label ?? stage;
}

/**
 * Voller Titel eines KONKRETEN Auslösers (Meldungstexte, Verwaltung) — z. B.
 * „Nach Worktree-Anlage" oder „Vor Phase „Planen"". Immer aus
 * {@link LIFECYCLE_TRIGGER_META}, {@link PHASE_META} und {@link INTEGRATION_STEPS}
 * abgeleitet, nie aus einem lokalen Literal.
 */
export function lifecycleTriggerTitle(t: LifecycleTrigger): string {
  const when = t.kind.startsWith('before_') ? 'Vor' : 'Nach';
  if ((t.kind === 'before_phase' || t.kind === 'after_phase') && t.phase) {
    return `${when} Phase „${PHASE_META[t.phase].label}"`;
  }
  if ((t.kind === 'before_stage' || t.kind === 'after_stage') && t.stage) {
    return `${when} Stufe „${stageTitle(t.stage)}"`;
  }
  return LIFECYCLE_TRIGGER_META[t.kind].title;
}

/** Kompaktes Chip-Label eines konkreten Auslösers (`vor Worktree`, `nach Planen`). */
export function lifecycleTriggerChip(t: LifecycleTrigger): string {
  const meta = LIFECYCLE_TRIGGER_META[t.kind];
  if ((t.kind === 'before_phase' || t.kind === 'after_phase') && t.phase) {
    return `${meta.short} ${PHASE_META[t.phase].label}`;
  }
  if ((t.kind === 'before_stage' || t.kind === 'after_stage') && t.stage) {
    return `${meta.short} ${stageTitle(t.stage)}`;
  }
  return meta.short;
}

// ---------- Integration-Pipeline ----------

export type IntegrationTone = 'idle' | 'progress' | 'human' | 'escalation' | 'done';

/**
 * Textfarbe je Ton — die eine Zuordnung für alle Oberflächen.
 *
 * Das Board zeigte bis 27.07.2026 den ROHEN Stage-Bezeichner in Sky-Blau, der Farbe
 * für laufende Vorgänge. `awaiting_human_review` las sich dadurch wie ein aktiver
 * Zustand, obwohl die Stufe dauerhaft auf eine Entscheidung wartet — und, ernster:
 * `verify_failed`, `gate_failed` und `conflict_escalated` sahen aus wie Fortschritt.
 * Farbkonvention des Projekts: emerald = automatisch, amber = Mensch, rot = eskaliert.
 */
export const INTEGRATION_TONE_CLASS: Record<IntegrationTone, string> = {
  idle: 'text-zinc-400',
  progress: 'text-sky-400',
  human: 'text-amber-400',
  escalation: 'text-red-400',
  done: 'text-emerald-400',
};

/**
 * Anzeige je Integrations-Stage. Über `Record<IntegrationStage, …>` getypt ⇒
 * eine neue Stage erzwingt hier einen Eintrag.
 */
export const INTEGRATION_STAGE_META: Record<IntegrationStage, { label: string; tone: IntegrationTone }> = {
  none: { label: 'nicht in Integration', tone: 'idle' },
  verifying: { label: 'Verifikation läuft', tone: 'progress' },
  // Amber statt Sky: es läuft nichts, und nur ein Mensch kann die Konfiguration
  // nachholen. Rot wäre falsch — die Lücke eskaliert nichts (FR-010).
  verification_unconfigured: { label: 'keine Verifikation konfiguriert', tone: 'human' },
  verify_failed: { label: 'Verifikation fehlgeschlagen', tone: 'escalation' },
  review_gate: { label: 'Review-Gate läuft', tone: 'progress' },
  gate_failed: { label: 'Review-Gate FAIL', tone: 'escalation' },
  // Amber wie `verification_unconfigured`: der Mensch ist am Zug. Kein Fortschritt
  // (es läuft nichts) und keine Eskalation (nichts ist kaputt) — FR-024.
  awaiting_manual_test: { label: 'wartet auf manuelle Abnahme', tone: 'human' },
  awaiting_human_review: { label: 'wartet auf menschliches Review', tone: 'human' },
  queued: { label: 'in der Merge-Queue', tone: 'progress' },
  merging: { label: 'Merge läuft', tone: 'progress' },
  conflict_resolving: { label: 'Konfliktauflösung (Agent)', tone: 'progress' },
  conflict_escalated: { label: 'Konflikt eskaliert', tone: 'escalation' },
  merged: { label: 'gemergt', tone: 'done' },
};

/**
 * Kurzform einzelner Integrations-Stufen für Übersichten. Nur wo die
 * Pipeline-Beschriftung zu lang oder zu technisch wäre — alle übrigen Stufen
 * kommen unverändert aus {@link INTEGRATION_STAGE_META}.
 */
const INTEGRATION_PROGRESS_LABEL: Partial<Record<IntegrationStage, string>> = {
  awaiting_human_review: 'Bereit zum Review',
  merged: 'Abgeschlossen',
};

/**
 * Bearbeitungsstand eines Features als ein kurzer Satzteil („Umsetzen läuft",
 * „Bereit zum Review", „Abgeschlossen") — für Übersichten, die Features neben
 * anderen Objekten zeigen (Worktree-Übersicht, FR-007).
 *
 * Rein abgeleitet aus `phases`/`integration`; die Beschriftungen stammen
 * ausschließlich aus PHASE_META/INTEGRATION_STAGE_META, damit eine neue Phase
 * oder Stufe hier nicht still veraltet.
 */
export function featureProgressLabel(feature: Pick<Feature, 'phases' | 'integration'>): string {
  if (feature.integration !== 'none') {
    return INTEGRATION_PROGRESS_LABEL[feature.integration] ?? INTEGRATION_STAGE_META[feature.integration].label;
  }
  const running = FEATURE_PHASES.find((p) => feature.phases[p]?.status === 'running');
  if (running) return `${PHASE_META[running].label} läuft`;

  const awaiting = FEATURE_PHASES.find((p) => feature.phases[p]?.status === 'awaiting_review');
  if (awaiting) return `${PHASE_META[awaiting].label}: Ergebnis prüfen`;

  // Weiteste bereits freigegebene Phase — der Stand, auf dem die Arbeit steht.
  const approved = [...FEATURE_PHASES].reverse().find((p) => feature.phases[p]?.status === 'approved');
  if (approved) return `${PHASE_META[approved].label} abgeschlossen`;

  return 'noch nicht begonnen';
}

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
  /** Identität der Stufe; zugleich der Bezug der Stufen-Auslöser (LifecycleStageId). */
  id: LifecycleStageId;
  label: string;
  detail: string;
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
    autoBy: 'autoVerify',
    escalatesTo: 'verify_failed',
  },
  {
    id: 'review_gate',
    label: 'Review-Gate',
    detail: 'review_gate-Agents laufen sequentiell headless; erster blockierender FAIL eskaliert.',
    requires: 'autoReviewAgents',
    escalatesTo: 'gate_failed',
    showsReviewGateAgents: true,
  },
  {
    id: 'manual_test',
    label: 'Manuelle Abnahme',
    detail:
      'Spalte „Abnahme": vollen Stack starten, die laufende Anwendung durchklicken, bestätigen oder mit Befunden ablehnen. Eine Ablehnung setzt das Feature auf specify zurück.',
    requires: 'manualTestGate',
    // Kein `humanUnless`: die Abnahme ist IMMER menschlich — es gibt keinen
    // automatischen Weg aus der Stufe heraus (FR-028).
  },
  {
    id: 'human_review',
    label: 'Menschliches Review',
    detail: 'Review-Portal: Diff prüfen, Kommentare, Ziel-Branch wählen, Freigabe erteilen.',
    humanUnless: 'autoMerge',
  },
  {
    id: 'merge_queue',
    label: 'Merge-Queue',
    detail: 'Sequentiell je Projekt: rebase → Auto-Konfliktauflösung (Headless-Claude) → Re-Verify → Merge.',
    autoBy: 'autoMerge',
    escalatesTo: 'conflict_escalated',
  },
  {
    id: 'merged',
    label: 'Gemergt',
    detail: 'Merge ins Ziel (bzw. PR im PR-Modus) + Worktree/Branch-Cleanup.',
    terminal: true,
  },
];
