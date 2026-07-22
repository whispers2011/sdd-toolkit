/** Feature-Phasen des spec-kit-Workflows (Reihenfolge = Workflow-Reihenfolge). */
export const FEATURE_PHASES = [
  'specify',
  'clarify',
  'plan',
  'checklist',
  'analyze',
  'tasks',
  'implement',
] as const;
export type FeaturePhase = (typeof FEATURE_PHASES)[number];

/** Projekt-Phase (einmalig pro Projekt, nicht pro Feature). */
export type ProjectPhase = 'constitution';
export type WorkflowPhase = FeaturePhase | ProjectPhase;

/** Optionale Phasen, die pro Projekt an-/abgeschaltet werden können. */
export const OPTIONAL_PHASES: readonly FeaturePhase[] = ['clarify', 'checklist', 'analyze'];

export type PhaseStatus = 'idle' | 'running' | 'awaiting_review' | 'approved';

export interface PhaseState {
  status: PhaseStatus;
  /** Upstream wurde nach Approval geändert — Ergebnis dieser Phase ist potenziell veraltet. */
  stale: boolean;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
}

/** Pipeline nach `implement`: Verifikation → Review → Merge-Queue. */
export type IntegrationStage =
  | 'none'
  | 'verifying'
  | 'verify_failed'
  | 'review_gate'
  | 'gate_failed'
  | 'awaiting_human_review'
  | 'queued'
  | 'merging'
  | 'conflict_resolving'
  | 'conflict_escalated'
  | 'merged';

/** Automation-Dial: einzeln schaltbar, Ebenen global → Projekt → Feature (Override). */
export interface AutomationSettings {
  /** Phase fertig → nächste startet automatisch, bis einschließlich dieser Phase. 'off' = Level 2. */
  autoProgressUntil: FeaturePhase | 'off';
  /** Test/Build/Lint-Pipeline nach implement automatisch ausführen. */
  autoVerify: boolean;
  /** Code-/Security-Review-Agents vor menschlichem Review (P1). */
  autoReviewAgents: boolean;
  /** Approvte Features automatisch in die Merge-Queue geben. */
  autoMerge: boolean;
}

export const LEVEL2_DEFAULTS: AutomationSettings = {
  autoProgressUntil: 'off',
  autoVerify: false,
  autoReviewAgents: false,
  autoMerge: false,
};

export const LEVEL3_DEFAULTS: AutomationSettings = {
  autoProgressUntil: 'implement',
  autoVerify: true,
  autoReviewAgents: true,
  autoMerge: true,
};

export interface VerifyCommand {
  name: string; // z.B. "test", "build", "lint"
  command: string; // Shell-Kommando, läuft im Worktree
}

export interface Project {
  id: string;
  name: string;
  /** Absoluter Pfad zum Haupt-Checkout. */
  path: string;
  defaultBranch: string;
  color: string | null;
  /** Phasen, die für Features dieses Projekts aktiv sind. */
  enabledPhases: FeaturePhase[];
  verifyCommands: VerifyCommand[];
  automation: Partial<AutomationSettings>;
  createdAt: number;
}

export interface Feature {
  id: string;
  projectId: string;
  /** Slug, identisch mit dem Ordnernamen unter specs/. */
  name: string;
  branch: string;
  /** Absoluter Pfad des Worktrees; null solange keiner existiert. */
  worktreePath: string | null;
  phases: Record<FeaturePhase, PhaseState>;
  integration: IntegrationStage;
  automation: Partial<AutomationSettings>;
  /** Fortschritt aus tasks.md-Checkboxen. */
  tasksDone: number;
  tasksTotal: number;
  createdAt: number;
  archivedAt: number | null;
}

/** Laufzeitstatus einer Agent-/Terminal-Session (ephemer, nie persistiert). */
export type SessionDisplayStatus = 'idle' | 'working' | 'awaiting_input' | 'stopped' | 'errored';

export type AwaitingKind = 'permission' | 'question' | 'plan_approval';

export interface SessionInfo {
  id: string;
  featureId: string | null;
  projectId: string;
  kind: 'feature' | 'shell' | 'headless';
  /** Externe Claude-Session-ID (für --resume), sobald bekannt. */
  claudeSessionId: string | null;
  status: SessionDisplayStatus;
  awaitingKind: AwaitingKind | null;
  pid: number | null;
  createdAt: number;
}

/** Exception-Inbox: alles, was menschliche Aufmerksamkeit braucht. */
export type AttentionKind =
  | 'awaiting_input'
  | 'permission_request'
  | 'verify_failed'
  | 'gate_failed'
  | 'merge_conflict_escalated'
  | 'review_due'
  | 'agent_errored';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  projectId: string;
  featureId: string | null;
  sessionId: string | null;
  message: string;
  createdAt: number;
  resolvedAt: number | null;
}

export interface MergeQueueItem {
  id: string;
  projectId: string;
  featureId: string;
  position: number;
  stage: IntegrationStage;
  attempts: number;
  lastError: string | null;
  enqueuedAt: number;
}

export interface ExecutionRecord {
  id: string;
  projectId: string;
  featureId: string | null;
  kind: 'phase' | 'verify' | 'review' | 'conflict_resolution';
  phase: WorkflowPhase | null;
  status: 'running' | 'succeeded' | 'failed' | 'orphaned';
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  costUsd: number | null;
  tokens: number | null;
  logPath: string | null;
}

export function resolveAutomation(
  global: AutomationSettings,
  project: Partial<AutomationSettings>,
  feature: Partial<AutomationSettings>,
): AutomationSettings {
  return { ...global, ...project, ...feature };
}
