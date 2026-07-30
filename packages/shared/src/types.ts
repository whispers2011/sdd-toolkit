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
  /** Integrations-Ziel-Branch (Review-Portal-Wahl); null = Projekt-Default-Branch. */
  integrationTarget: string | null;
  automation: Partial<AutomationSettings>;
  /** Token-Optimierungs-Override auf Feature-Ebene (leer = Projekt/global erben). */
  optimization: Partial<OptimizationSettings>;
  /** Fortschritt aus tasks.md-Checkboxen. */
  tasksDone: number;
  tasksTotal: number;
  /** Referenz auf das Jira-Ursprungsticket (Schnappschuss, unveränderlich nach Anlage). */
  jiraRef?: JiraRef;
  /** Zeitpunkt der letzten Zurückweisung im Review; null = keine offene Zurückweisung (FR-026). */
  reviewRejectedAt: number | null;
  createdAt: number;
  archivedAt: number | null;
}

// ---------- Jira-Import (Feature "erstellen-eines-features-basierend-auf-einem-jira-ticket") ----------

/** Dauerhafte Ticket-Referenz eines importierten Features (FR-012). */
export interface JiraRef {
  key: string;
  url: string;
  importedAt: number;
}

export type JiraConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reauth_required';

export interface JiraConnectionStatus {
  state: JiraConnectionState;
  account?: { name: string; email?: string };
  site?: { id: string; name: string; url: string };
}

export interface JiraSite {
  id: string;
  name: string;
  url: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: 'active' | 'future';
  startDate?: string;
  endDate?: string;
}

export interface JiraIssueSummary {
  key: string;
  title: string;
  type: string;
  status: string;
  /** FR-010: bereits als Feature im aktuellen Toolkit-Projekt übernommen. */
  imported: boolean;
}

export interface JiraImportResult {
  issueKey: string;
  status: 'created' | 'failed' | 'skipped_duplicate';
  featureId?: string;
  error?: string;
}

/** Letzte Auswahl im Import-Dialog (Settings-Key `jira.lastSelection`, FR-009). */
export interface JiraSelection {
  siteId?: string;
  projectKey?: string;
  sprintId?: number;
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
  | 'agent_errored'
  | 'run_interrupted'
  | 'phase_gate_failed'
  | 'approval_required'
  // Datenbefunde der Plausibilitätsprüfung: der Widerspruch steht in der Datenbank
  // und besteht unabhängig von laufender Arbeit — nur ein Mensch löst sie auf.
  | 'run_unpriced' // A: Tokens gezählt, kein Betrag
  | 'phase_false_start' // B: Phase lief nie an
  | 'project_without_runs' // C: Features, aber nie ein Phasenlauf
  | 'metering_conflict' // D: Nachkorrektur verworfen, weil sie die Messung senkt
  /** Der Server war unerwartet weg; die Meldung nennt Fenster, Dauer und betroffene Läufe (FR-007). */
  | 'server_outage';

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
  /** Re-Verifikation vor dem Merge erzwingen (Reviewer-Edits beim Approve). */
  forceVerify: boolean;
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
  tokens: number | null;
  /** Autoritative Token-Komponenten (aus Transkript); null wenn nur geschätzt. */
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  /**
   * Herkunft des Verbrauchswerts, absteigend nach Verlässlichkeit:
   * 'telemetry' (von der CLI selbst gemeldet) > 'transcript' > 'parsed' > 'estimated'.
   */
  tokensSource: 'telemetry' | 'transcript' | 'parsed' | 'estimated' | null;
  /** Von der CLI gemeldeter Betrag in Mikro-USD; null = kein Betrag gemeldet (nie 0 als Ersatz). */
  costMicros: number | null;
  /** Tokens der Subagenten dieses Laufs; null = es liefen keine Subagenten. */
  subagentTokens: number | null;
  /** Betragsanteil der Subagenten in Mikro-USD; null wenn kein Betrag/keine Subagenten. */
  subagentCostMicros: number | null;
  /** Modell laut Telemetrie-Meldungen; null bei Transkript-/Schätz-Herkunft. */
  model: string | null;
  /** Ab diesem Zeitpunkt gilt der Lauf als endgültig gemessen; spätere Meldungen verfallen. */
  telemetryFinalAt: number | null;
  /** Byte-Offset des Transkripts beim Phasenstart (Attribution der Usage). */
  transcriptOffsetStart: number | null;
  /** Byte-Offset des Transkripts beim Phasenabschluss (Ende des Lauf-Ausschnitts, nur kind='phase'). */
  transcriptOffsetEnd: number | null;
  /** Aufgelöster Transkriptpfad des Laufs (beim Abschluss persistiert, neustartfest; nur kind='phase'). */
  transcriptPath: string | null;
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

// ---------- Feature-Artefakte (Kachel-Ergebnis-Icons) ----------

/** Eine einzelne einsehbare Ergebnis-Datei innerhalb eines Schritts. */
export interface FeatureArtifactFile {
  /** Stabile Kennung = relativer Pfad unter specs/<feature>/ (z. B. "plan.md", "contracts/api.md"). */
  id: string;
  label: string;
  relPath: string;
}

/** Ein artefakt-erzeugender Speckit-Schritt eines Features (Kachel-Icon + Tooltip + Verfügbarkeit). */
export interface FeatureArtifactStep {
  phase: FeaturePhase;
  label: string;
  tooltip: string;
  /** Mindestens eine zugehörige Datei existiert. */
  available: boolean;
  files: FeatureArtifactFile[];
}

/** Inhalt einer konkret gewählten Artefakt-Datei (Detail-DTO fürs Modal). */
export interface FeatureArtifact {
  featureId: string;
  phase: FeaturePhase;
  fileId: string;
  label: string;
  /** Absoluter Pfad (informativ); null wenn nicht vorhanden. */
  path: string | null;
  /** Roh-Markdown der Datei (der Editor rendert es als Rich-Text); null wenn nicht vorhanden. */
  content: string | null;
  /** Änderungszeit für Konfliktprüfung; null wenn nicht vorhanden. */
  mtimeMs: number | null;
  exists: boolean;
  /** Bearbeiten gesperrt, solange eine Phase des Features läuft. */
  locked: boolean;
  lockReason: string | null;
  /** Geschwister-Dateien desselben Schritts (für den Umschalter). */
  files: FeatureArtifactFile[];
}

export interface SaveFeatureArtifactRequest {
  content: string;
  /** Beim Öffnen gelesene mtimeMs (Basis der Konfliktprüfung). */
  baseMtimeMs: number;
  /** Konfliktprüfung überspringen (bewusstes Überschreiben). */
  overwrite?: boolean;
}

export interface SaveFeatureArtifactResult {
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
  tokens: number | null;
  createdAt: number;
}

// ---------- Agents (Generalisierung der Review-Personas) ----------

/** Auslöser-Arten eines Agents. */
export type AgentTriggerKind = 'manual' | 'review_gate' | 'after_phase' | 'before_phase';

/** Auslöser eines Agents; `phase` nur bei after_phase/before_phase gesetzt. */
export interface AgentTrigger {
  kind: AgentTriggerKind;
  phase?: FeaturePhase;
}

/** Konfigurierbare Prüf-/Arbeitseinheit (Nachfolger der Review-Persona). */
export interface AgentDefinition {
  id: string;
  /** null = global (gilt via Union in allen Projekten). */
  projectId: string | null;
  name: string;
  description: string;
  prompt: string;
  /** null = CLI-Default-Modell. */
  model: string | null;
  trigger: AgentTrigger;
  /** true = Gate (FAIL stoppt), false = beratend (FAIL wird nur verbucht). */
  blocking: boolean;
  enabled: boolean;
  sortOrder: number;
}

/** Per-Feature-Override der Agent-Geltung; kein Eintrag = 'auto'. */
export type AgentFeatureDecision = 'include' | 'exclude';

/** Strukturiertes, dauerhaftes Ergebnis eines Agent-Laufs. */
export interface AgentRunSummary {
  id: string;
  /** null wenn der Agent inzwischen gelöscht wurde (agentName bleibt lesbar). */
  agentId: string | null;
  agentName: string;
  featureId: string;
  executionId: string | null;
  trigger: AgentTrigger;
  blocking: boolean;
  /** null = kein auswertbares Urteil (wird NIE als bestanden gewertet). */
  verdict: 'PASS' | 'FAIL' | null;
  /** z. B. 'FREIGEGEBEN MIT ÄNDERUNGEN' (GESAMTENTSCHEIDUNG:-Zeile). */
  decisionLabel: string | null;
  summary: string | null;
  /** Repo-relativer Pfad des Berichts (specs/<feature>/reviews/<agent-id>.md). */
  reportPath: string | null;
  createdAt: number;
  finishedAt: number | null;
  /** Aus der verknüpften Execution (Join); nur in API-Antworten gefüllt. */
  totalTokens?: number | null;
  /** 'markdown' = Alt-Bericht aus der Zeit vor der strukturierten Ablage. */
  source?: 'db' | 'markdown';
}

/** Effektive Agent-Sicht eines Features (Verwaltung + „Jetzt ausführen"). */
export interface FeatureAgentView {
  agent: AgentDefinition;
  decision: AgentFeatureDecision | 'auto';
  /** Läuft der Agent für dieses Feature beim nächsten passenden Trigger? */
  effective: boolean;
  lastRun: AgentRunSummary | null;
}

// ---------- Review-Portal ----------

/** Flacher, persistierter Reviewer-Kommentar mit optionalem Datei-/Zeilen-Anker. */
export interface ReviewComment {
  id: string;
  featureId: string;
  /** null = Feature-genereller Kommentar. */
  filePath: string | null;
  /** null = Datei-genereller Kommentar; nur mit filePath gesetzt. */
  line: number | null;
  /** Diff-Seite des Ankers; nur mit line gesetzt. */
  side: 'old' | 'new' | null;
  text: string;
  status: 'open' | 'resolved';
  createdAt: number;
  resolvedAt: number | null;
}

/** Verdichtete Sicht eines integrationsnahen Features für die Review-Übersicht. */
export interface ReviewOverviewItem {
  feature: Feature;
  stage: IntegrationStage;
  filesChanged: number;
  additions: number;
  deletions: number;
  audits: { passed: number; failed: number; total: number };
  openComments: number;
  verify: { status: 'passed' | 'failed' | 'none'; executionId?: string };
  /** Der Worktree hat uncommittete Änderungen (Arbeitsbaum ≠ HEAD). */
  hasUncommitted: boolean;
}

/** Branch eines Projekts (Ziel-Auswahl im Portal). */
export interface BranchInfo {
  name: string;
  isDefault: boolean;
  /** Von einem Feature dieses Projekts belegter Branch (kein gültiges Ziel). */
  isFeatureBranch: boolean;
}

/** Integrations-Entscheidung des Reviewers; leer = Default-Branch (heutiges Verhalten). */
export interface ApproveMergeRequest {
  targetBranch?: string;
  createBranch?: boolean;
}

// ---------- Worktree-Übersicht (Feature "worktree-uebersicht") ----------

/** Art eines Eintrags in der Worktree-Übersicht (der Haupt-Checkout ist ein eigener Typ). */
export type WorktreeEntryKind = 'feature' | 'chat' | 'orphan';
/** Verhältnis zwischen Git-Registrierung und tatsächlichem Verzeichnis. */
export type WorktreeDirState = 'present' | 'missing' | 'registry_only';
export type FileChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';
export type FileChangeState = 'committed' | 'uncommitted' | 'both';
export type WorktreeWarningKind = 'overlap' | 'behind_target' | 'already_merged';

/** Eine gegenüber dem Zielbranch geänderte Datei eines Worktrees. */
export interface WorktreeFileChange {
  /** Repo-relativ; bei Umbenennung der NEUE Pfad. */
  path: string;
  /** Nur bei kind === 'renamed' gesetzt. */
  oldPath: string | null;
  kind: FileChangeKind;
  state: FileChangeState;
  /** Datei wurde auch in einem anderen offenen Worktree desselben Projekts geändert. */
  overlapping: boolean;
  /** Datei wurde seit dem Abzweigpunkt auch auf dem Zielbranch geändert. */
  behindTarget: boolean;
}

/** Eine erkannte Risikolage eines Worktrees. */
export interface WorktreeWarning {
  kind: WorktreeWarningKind;
  /** Betroffene Pfade, für die Anzeige auf 20 gekürzt. */
  files: string[];
  /** Gesamtzahl betroffener Dateien (auch bei Kürzung vollständig). */
  fileCount: number;
  /** Nur bei kind === 'overlap': die anderen beteiligten Einträge. */
  others: { entryId: string; label: string; featureId: string | null }[];
}

/** Der Haupt-Checkout eines Projekts — nie entfernbar, ohne Dateiliste und Warnungen. */
export interface MainCheckoutInfo {
  projectId: string;
  projectName: string;
  path: string;
  /** Aktueller Branch; null = detached HEAD. */
  branch: string | null;
  defaultBranch: string;
  uncommittedFileCount: number;
}

/** Ein bestehender oder erwarteter Worktree eines Projekts. */
export interface WorktreeEntry {
  /** Stabile Kennung `<projectId>::<realpath>` — Identität über Erhebungen hinweg. */
  id: string;
  projectId: string;
  kind: WorktreeEntryKind;
  /** Feature-Name · "Wissens-Chat" · Verzeichnisname (verwaist). */
  label: string;
  path: string;
  /** null = detached HEAD. */
  branch: string | null;
  dirState: WorktreeDirState;
  /** null ⇒ verwaist (keinem Feature zugeordnet). */
  featureId: string | null;
  /** feature.integrationTarget ?? project.defaultBranch. */
  targetBranch: string;
  createdAt: number | null;
  /** Nicht beendete PTY-Session mit cwd innerhalb des Worktrees. */
  sessionActive: boolean;
  removable: boolean;
  /** Gesamtzahl geänderter Dateien — auch wenn `files` gekürzt ist. */
  changedFileCount: number;
  uncommittedFileCount: number;
  /** Auf 300 Einträge gekürzt. */
  files: WorktreeFileChange[];
  filesTruncated: boolean;
  warnings: WorktreeWarning[];
  /** Erhebung dieses Eintrags fehlgeschlagen — der Eintrag bleibt trotzdem sichtbar. */
  error: string | null;
}

/** Ein Projektblock der Übersicht. */
export interface WorktreeProjectGroup {
  projectId: string;
  projectName: string;
  projectPath: string;
  defaultBranch: string;
  /** null NUR wenn error !== null. */
  main: MainCheckoutInfo | null;
  /** Ohne Haupt-Checkout; Sortierung feature → chat → orphan, je Gruppe alphabetisch. */
  worktrees: WorktreeEntry[];
  worktreeCount: number;
  /** Projekt nicht erreichbar / kein Git-Repository. */
  error: string | null;
}

/** Wurzel der Antwort von GET /api/worktrees. */
export interface WorktreeOverview {
  groups: WorktreeProjectGroup[];
  /** Erhebungszeitpunkt (ms) — die Oberfläche weist ihn als „Stand" aus. */
  collectedAt: number;
}

// ---------- Betriebsspuren: Lebenszeichen, Ausfall, Protokoll (Feature „server-ausfaelle-sichtbar-machen") ----------

/** Lebenszeichen des Servers; liegt als eine JSON-Zeile in `$SDD_DATA_DIR/heartbeat.json`. */
export interface Heartbeat {
  /** Zeitpunkt des Schreibens (ms seit Epoche). */
  ts: number;
  /** Kennung des schreibenden Serverlaufs; wechselt bei jedem Start. */
  instanceId: string;
  /** true = der Server hat sich geordnet verabschiedet; eine Lücke danach ist kein Ausfall. */
  clean: boolean;
  /** Startzeitpunkt der schreibenden Instanz (Laufzeit im Abgangseintrag). */
  startedAt: number;
}

/** Festgehaltener Ausfall — so steht er im Protokoll und so geht er an die Oberfläche. */
export interface OutageRecord {
  /** Letztes Lebenszeichen vor dem Ausfall; null, wenn das Fenster nicht bestimmbar ist. */
  from: number | null;
  /** Startzeitpunkt der neuen Instanz. */
  to: number;
  /** Dauer der Lücke; null bei nicht bestimmbarem Fenster. */
  durationMs: number | null;
  /** Zahl der zum Ausfallzeitpunkt noch als laufend geführten Läufe (über alle Projekte). */
  affectedRuns: number;
  /** true = kein Abgangseintrag vorhanden → stiller Abgang (FR-014). */
  silent: boolean;
  /** true = Zeitfenster nicht bestimmbar, etwa weil die Uhr rückwärts sprang (D15). */
  undetermined: boolean;
}

export type OperationsEntryKind = 'startup' | 'shutdown' | 'uncaught' | 'exit' | 'outage';

/** Eine Zeile in `$SDD_DATA_DIR/operations.jsonl` — ein Betriebsereignis (Contract C2). */
export interface OperationsEntry {
  /** Zeitpunkt des Ereignisses, ms seit Epoche. */
  ts: number;
  /** Kennung des Serverlaufs; verbindet `startup` mit seinem Abgang. */
  instanceId: string;
  kind: OperationsEntryKind;
  /** kind='shutdown': empfangenes Signal, z. B. 'SIGINT'. */
  signal?: string;
  /** kind='uncaught': Fehlerbeschreibung (Message + erste Zeilen des Stacks, gekürzt). */
  error?: string;
  /** kind='exit': Rückgabewert des Prozesses. */
  exitCode?: number;
  /** kind='shutdown' | 'exit': Laufzeit der Instanz in ms. */
  uptimeMs?: number;
  /** kind='outage': der nachgetragene Ausfall (FR-014). */
  outage?: OutageRecord;
  /** kind='startup': Prozesskennung zur Zuordnung. */
  pid?: number;
}

export function resolveAutomation(
  global: AutomationSettings,
  project: Partial<AutomationSettings>,
  feature: Partial<AutomationSettings>,
): AutomationSettings {
  return { ...global, ...project, ...feature };
}
