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
  /** Tool-/Kommando-Berechtigungen automatisch erteilen — keine Rückfragen im Feature-Lauf. */
  autoMode: boolean;
}

export const LEVEL2_DEFAULTS: AutomationSettings = {
  autoProgressUntil: 'off',
  autoVerify: false,
  autoReviewAgents: false,
  autoMerge: false,
  autoMode: true,
};

export const LEVEL3_DEFAULTS: AutomationSettings = {
  autoProgressUntil: 'implement',
  autoVerify: true,
  autoReviewAgents: true,
  autoMerge: true,
  autoMode: true,
};

/** Kontext-Strategie einer Downstream-Phase (Token-Reduktion, Feature "minimize-token-consumption"). */
export type ContextStrategy = 'full' | 'compact' | 'fresh';
/** Verdichtungs-Modus für toolkit-injizierte Inhalte. */
export type CompressionMode = 'off' | 'deterministic' | 'llm';

/**
 * Optimierungs-Dial (Token-Reduktion): Ebenen global → Projekt → Feature (Override),
 * analog zu {@link AutomationSettings}. `full`/`off` == unverändertes Alt-Verhalten (reversibel).
 */
export interface OptimizationSettings {
  /** Kontext-Reset vor Downstream-Phasen: none/compact/fresh. */
  contextStrategy: ContextStrategy;
  /** Verdichtung signalarmer, toolkit-injizierter Inhalte. */
  compression: CompressionMode;
}

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
  /** Token-Optimierungs-Override auf Projektebene (leer = global erben). */
  optimization: Partial<OptimizationSettings>;
  mergeMode: 'ff' | 'squash';
  /** Editor-Öffner, z. B. "code -g {file}:{line}" (WP10). */
  editorCmd: string | null;
  /** local = direkt auf den Default-Branch mergen; pr = GitHub-PR via gh (WP13). */
  integrationMode: 'local' | 'pr';
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
  /** Token-Optimierungs-Override auf Feature-Ebene (leer = Projekt/global erben). */
  optimization: Partial<OptimizationSettings>;
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
  kind: 'feature' | 'shell' | 'headless' | 'chat_work';
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
  /** Gesetzt bei Arbeits-Chat-Sessions: Routing-Ziel ist der Chat-Panel des Projekts. */
  conversationId: string | null;
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
  kind: 'phase' | 'verify' | 'review' | 'conflict_resolution' | 'chat' | 'chat_work';
  phase: WorkflowPhase | null;
  status: 'running' | 'succeeded' | 'failed' | 'orphaned';
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  costUsd: number | null;
  tokens: number | null;
  /** Autoritative Token-Komponenten (aus Transkript); null wenn nur geschätzt. */
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  /** Herkunft des Verbrauchswerts. */
  tokensSource: 'transcript' | 'parsed' | 'estimated' | null;
  /** Byte-Offset des Transkripts beim Phasenstart (Attribution der Usage). */
  transcriptOffsetStart: number | null;
  /** Snapshot der aktiven Optimierungs-Settings beim Lauf (nur kind='phase'). */
  optContextStrategy: ContextStrategy | null;
  optCompression: CompressionMode | null;
  logPath: string | null;
}

/** DTO: spec-kit-Definition eines SDD-Schritts (Lane-Info-Icon). */
export interface PhaseDefinition {
  projectId: string;
  phase: FeaturePhase;
  /** Ob eine Definitionsdatei gefunden wurde. */
  exists: boolean;
  /** Absoluter Pfad der Datei (informativ / „im Editor öffnen"); null wenn nicht gefunden. */
  path: string | null;
  /** Markdown-Inhalt; null wenn nicht vorhanden. */
  content: string | null;
  /** Änderungszeit für Konfliktprüfung; null wenn nicht vorhanden. */
  mtimeMs: number | null;
  /** Bearbeiten gesperrt (Agent führt den Schritt aus)? */
  locked: boolean;
  lockReason: string | null;
}

export interface SavePhaseDefinitionRequest {
  content: string;
  /** Beim Öffnen gelesene mtimeMs (Basis der Konfliktprüfung). */
  baseMtimeMs: number;
  /** Konfliktprüfung überspringen (bewusstes Überschreiben). */
  overwrite?: boolean;
}

export interface SavePhaseDefinitionResult {
  ok: true;
  mtimeMs: number;
}

// ---------- Projekt-Chat (Ask-a-Question) ----------

/**
 * Modus einer Chat-Unterhaltung: `ask` = strikt lesend (heutiges Verhalten, keine Artefakte),
 * `work` = vollwertige, eingreifende Claude-Code-Session in isolierter Worktree. Der Modus ist
 * pro Unterhaltung fix; ein Wechsel startet eine neue Unterhaltung.
 */
export type ChatMode = 'ask' | 'work';

/** Fortlaufende Q&A-Unterhaltung eines Projekts; höchstens eine aktive (endedAt = null) pro Projekt. */
export interface ChatConversation {
  id: string;
  projectId: string;
  /** Modus der Unterhaltung (siehe {@link ChatMode}). */
  mode: ChatMode;
  /** Externe Claude-Session-ID (für --resume über App-Neustarts hinweg). */
  claudeSessionId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Gesetzt durch „Neue Unterhaltung" — beendete Unterhaltungen werden nicht mehr angezeigt. */
  endedAt: number | null;
}

/** Laufzeit-Info der Arbeits-Session einer work-Unterhaltung (DTO für den Chat-Panel). */
export interface ChatWorkSessionInfo {
  sessionId: string;
  status: SessionDisplayStatus;
  awaitingKind: AwaitingKind | null;
  /** Branch der isolierten Arbeitskopie (`chat/<conversationId>`). */
  branch: string;
}

/** Erfolgreicher Neustart des Wissens-Chats: frische, automatisch gestartete Session. */
export interface ChatWorkRestartResult {
  sessionId: string;
  conversationId: string;
}

/** Neustart-Guard: Bestätigung nötig, weil laufende Arbeit verloren ginge (nichts verworfen). */
export interface ChatWorkRestartNeedsConfirm {
  needsConfirm: true;
  /** `running` = Session arbeitet gerade; `dirty` = unbestätigte Änderungen in der Arbeitskopie. */
  reason: 'running' | 'dirty';
}

export type ChatMessageStatus = 'complete' | 'streaming' | 'error' | 'interrupted';

export type FeatureProposalStatus = 'offen' | 'angenommen' | 'abgelehnt';

/** Vom Assistenten abgeleiteter Feature-Vorschlag (Marker-Protokoll) samt Nutzer-Entscheidung. */
export interface FeatureProposal {
  name: string;
  description: string;
  status: FeatureProposalStatus;
  /** Gesetzt bei 'angenommen' nach erfolgreicher Feature-Anlage (lose Referenz, kein FK). */
  featureId?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  /** Anzeigetext; bei Assistenten-Nachrichten ist der Vorschlag-Marker bereits entfernt. */
  content: string;
  status: ChatMessageStatus;
  error: string | null;
  proposal: FeatureProposal | null;
  costUsd: number | null;
  tokens: number | null;
  createdAt: number;
}

export function resolveAutomation(
  global: AutomationSettings,
  project: Partial<AutomationSettings>,
  feature: Partial<AutomationSettings>,
): AutomationSettings {
  return { ...global, ...project, ...feature };
}
