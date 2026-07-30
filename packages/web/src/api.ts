import type {
  AgentDefinition,
  AgentFeatureDecision,
  AgentRunSummary,
  Applicability,
  ApproveMergeRequest,
  AttentionItem,
  AutomationSettings,
  BranchInfo,
  FeatureAgentView,
  FeatureLifecycleStepView,
  LifecycleStep,
  LifecycleStepFeatureDecision,
  ReviewComment,
  ReviewOverviewItem,
  ChatConversation,
  ChatCostProfile,
  ChatFeatureProposal,
  ChatMessage,
  ChatWorkRestartNeedsConfirm,
  ChatWorkRestartResult,
  ChatWorkSessionInfo,
  Feature,
  FeatureArtifact,
  FeatureArtifactStep,
  FeatureCostBreakdown,
  FeatureDocument,
  FeatureDocumentsResult,
  FeaturePhase,
  SaveFeatureArtifactRequest,
  SaveFeatureArtifactResult,
  FeatureProposalStatus,
  FeatureStackView,
  TestingLaneView,
  JiraConnectionStatus,
  JiraImportResult,
  JiraIssueSummary,
  JiraProject,
  JiraSelection,
  JiraSite,
  JiraSprint,
  KnowledgeBundle,
  KnowledgeEntry,
  KnowledgeIndex,
  KnowledgeTree,
  MergeQueueItem,
  OptimizationSettings,
  PersonalSettings,
  PhaseDefinition,
  Project,
  ResolvedSelection,
  RunSummary,
  SavePhaseDefinitionRequest,
  SavePhaseDefinitionResult,
  SelectionDecision,
  SystemStatus,
  WorktreeOverview,
} from '@sdd/shared';

export type { RunSummary };

/** Konflikt beim Speichern einer Definition: Datei wurde extern geändert. */
export class SaveConflictError extends Error {
  constructor(
    message: string,
    public readonly current: { content: string; mtimeMs: number },
  ) {
    super(message);
    this.name = 'SaveConflictError';
  }
}

export interface ChatState {
  conversation: ChatConversation | null;
  messages: ChatMessage[];
  workSession?: ChatWorkSessionInfo | null;
  /** Session war live, ist aber pausiert (Leerlauf-Reaper) und fortsetzbar → Panel fragt nach. */
  workPaused?: boolean;
  pendingFeatures?: ChatFeatureProposal | null;
  /** Bewertung der letzten Turn-Grenze: Verlaufsgröße, Verbrauch, Verhältnis, offenes Angebot. */
  costProfile?: ChatCostProfile | null;
}

export interface LiveSessionInfo {
  id: string;
  projectId: string;
  featureId: string | null;
  conversationId: string | null;
  kind: string;
  status: 'idle' | 'working' | 'awaiting_input' | 'stopped' | 'errored';
  awaitingKind: string | null;
  exited: boolean;
  /** Letzter Aktivitätszeitpunkt (Grid-Auto-Belegung: zuletzt aktiv zuerst). */
  lastActiveAt: number;
}

export interface AppState {
  projects: (Project & { currentBranch: string | null; specKit: boolean })[];
  features: Feature[];
  sessions: LiveSessionInfo[];
  attention: AttentionItem[];
  queues: Record<string, MergeQueueItem[]>;
  automation: AutomationSettings;
  optimization: OptimizationSettings;
  /** Individuelle Einstellungen — immer vollständig, nie null (A1.1). */
  personal: PersonalSettings;
}

/** Abweisungsgründe von `POST /api/worktrees/remove`. */
export type WorktreeRemoveCode =
  | 'not_a_worktree'
  | 'main_checkout'
  | 'not_removable'
  | 'session_active'
  | 'uncommitted'
  | 'remove_failed';

export class WorktreeRemoveError extends Error {
  constructor(
    message: string,
    public readonly code: WorktreeRemoveCode,
    /** Nur bei code === 'uncommitted': Anzahl gefährdeter Dateien (FR-024). */
    public readonly uncommittedFileCount = 0,
  ) {
    super(message);
    this.name = 'WorktreeRemoveError';
  }
}

/** Jira-Routen-Fehler mit HTTP-Status + Verbindungszustand (401 → reauth/disconnected). */
export class JiraApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly state?: 'disconnected' | 'reauth_required',
  ) {
    super(message);
    this.name = 'JiraApiError';
  }
}

async function jiraRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    let state: 'disconnected' | 'reauth_required' | undefined;
    try {
      const data = JSON.parse(text) as { message?: string; state?: 'disconnected' | 'reauth_required' };
      message = data.message ?? text;
      state = data.state;
    } catch {
      /* raw text */
    }
    throw new JiraApiError(message || `${method} ${url} → ${res.status}`, res.status, state);
  }
  return res.json() as Promise<T>;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* raw text */
    }
    throw new Error(message || `${method} ${url} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  state: () => request<AppState>('GET', '/api/state'),
  addProject: (path: string, name?: string) => request<unknown>('POST', '/api/projects', { path, name }),
  updateProject: (id: string, patch: Record<string, unknown>) =>
    request<Project>('PATCH', `/api/projects/${id}`, patch),
  removeProject: (id: string) => request<unknown>('DELETE', `/api/projects/${id}`),
  createFeature: (projectId: string, name: string, description?: string) =>
    request<Feature>('POST', `/api/projects/${projectId}/features`, { name, description }),
  /**
   * Feature mit Dokumenten anlegen (US1). `request()` kann kein multipart —
   * daher direkter `fetch` wie bei `pasteImage`. Die Reihenfolge im FormData ist
   * verbindlich: `name`, `description`, dann die Dateien (contracts).
   */
  createFeatureWithDocuments: async (
    projectId: string,
    name: string,
    description: string | undefined,
    files: File[],
  ): Promise<FeatureDocumentsResult> => {
    const form = new FormData();
    form.append('name', name);
    form.append('description', description ?? '');
    for (const file of files) form.append('files', file, file.name);
    const res = await fetch(`/api/projects/${projectId}/features/with-documents`, {
      method: 'POST',
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error((data.message as string) ?? `POST → ${res.status}`);
    return data as unknown as FeatureDocumentsResult;
  },
  featureDocuments: (featureId: string) =>
    request<FeatureDocument[]>('GET', `/api/features/${featureId}/documents`),
  openFeatureDocument: (featureId: string, storedName: string) =>
    request<{ ok: true }>('POST', `/api/features/${featureId}/documents/open`, { storedName }),
  startPhase: (featureId: string, phase: FeaturePhase, prompt?: string) =>
    request<Feature>('POST', `/api/features/${featureId}/phases/${phase}/start`, { prompt }),
  approvePhase: (featureId: string, phase: FeaturePhase) =>
    request<Feature>('POST', `/api/features/${featureId}/phases/${phase}/approve`),
  discardPhase: (featureId: string, phase: FeaturePhase) =>
    request<Feature>('POST', `/api/features/${featureId}/phases/${phase}/discard`),
  integrate: (featureId: string) => request<Feature>('POST', `/api/features/${featureId}/integrate`),
  /** Der einzige asynchrone Fakt der Aktions-Policy (FR-027). */
  integrationReadiness: (featureId: string) =>
    request<{ hasChanges: boolean }>('GET', `/api/features/${featureId}/integration-readiness`),
  approveMerge: (featureId: string, body: ApproveMergeRequest = {}) =>
    request<Feature>('POST', `/api/features/${featureId}/approve-merge`, body),
  retryIntegration: (featureId: string) =>
    request<Feature>('POST', `/api/features/${featureId}/retry-integration`),
  archiveFeature: (featureId: string) => request<unknown>('POST', `/api/features/${featureId}/archive`),
  deleteFeature: (featureId: string) => request<{ ok: true }>('DELETE', `/api/features/${featureId}`),
  updateFeature: (
    featureId: string,
    patch: { automation?: Partial<AutomationSettings>; optimization?: Partial<OptimizationSettings> },
  ) => request<Feature>('PATCH', `/api/features/${featureId}`, patch),
  setOptimization: (patch: Partial<OptimizationSettings>) =>
    request<{ optimization: OptimizationSettings }>('PATCH', '/api/settings/optimization', patch),
  /** Teilmengen-Semantik; die Antwort ist der vollständige, normalisierte Stand (A2). */
  savePersonal: (patch: Partial<PersonalSettings>) =>
    request<PersonalSettings>('PATCH', '/api/settings/personal', patch),
  costBreakdown: (featureId: string, groupByOptimization = false) =>
    request<FeatureCostBreakdown>(
      'GET',
      `/api/features/${featureId}/cost-breakdown${groupByOptimization ? '?groupByOptimization=true' : ''}`,
    ),
  ensureSession: (featureId: string) => request<{ sessionId: string }>('POST', `/api/features/${featureId}/session`),
  sendPrompt: (featureId: string, text: string) =>
    request<unknown>('POST', `/api/features/${featureId}/prompt`, { text }),
  resolveAttention: (id: string) => request<unknown>('POST', `/api/attention/${id}/resolve`),
  setAutomation: (patch: Partial<AutomationSettings>) =>
    request<AutomationSettings>('PUT', '/api/settings/automation', patch),
  diff: (featureId: string) => request<DiffSummary>('GET', `/api/features/${featureId}/diff`),
  fileDiff: (featureId: string, path: string) =>
    request<{ diff: string }>('GET', `/api/features/${featureId}/diff/file?path=${encodeURIComponent(path)}`),
  rejectReview: (featureId: string, comment: string) =>
    request<Feature>('POST', `/api/features/${featureId}/reject-review`, { comment }),
  executions: (featureId?: string) =>
    request<ExecutionInfo[]>('GET', featureId ? `/api/executions?featureId=${featureId}` : '/api/executions'),
  runs: () => request<{ runs: RunSummary[] }>('GET', '/api/runs'),
  telemetryStatus: () => request<TelemetryStatus>('GET', '/api/telemetry/status'),
  executionLog: (id: string) => request<{ log: string }>('GET', `/api/executions/${id}/log`),
  resolutionDiff: (id: string) =>
    request<{ pre: string | null; post: string | null }>('GET', `/api/executions/${id}/resolution-diff`),
  openInEditor: (featureId: string, file: string, line: number | null) =>
    request<unknown>('POST', '/api/open-in-editor', { featureId, file, line }),
  projectTerminal: (projectId: string) =>
    request<{ sessionId: string }>('POST', `/api/projects/${projectId}/terminal`),
  pickFolder: () => request<{ cancelled: boolean; path?: string }>('POST', '/api/fs/pick-folder'),
  listDirs: (path?: string) =>
    request<{ base: string; parent: string | null; dirs: { path: string; name: string; isGitRepo: boolean }[] }>(
      'GET',
      path ? `/api/fs/dirs?path=${encodeURIComponent(path)}` : '/api/fs/dirs',
    ),
  suggestions: () => request<{ suggestions: string[] }>('GET', '/api/fs/suggestions'),
  getTranscription: () =>
    request<{ provider: 'openai' | 'groq' | null; hasKey: boolean; language?: string }>(
      'GET',
      '/api/settings/transcription',
    ),
  setTranscription: (provider: 'openai' | 'groq', apiKey: string | undefined, language: string) =>
    request<unknown>('PUT', '/api/settings/transcription', { provider, apiKey, language }),
  openFeature: (featureId: string, target: 'finder' | 'editor') =>
    request<unknown>('POST', `/api/features/${featureId}/open`, { target }),
  pasteImage: async (featureId: string, blob: Blob): Promise<{ path: string }> => {
    const form = new FormData();
    form.append('file', blob, 'paste.png');
    const res = await fetch(`/api/features/${featureId}/paste-image`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ path: string }>;
  },
  initSpeckit: (projectId: string) =>
    request<{ sessionId: string }>('POST', `/api/projects/${projectId}/init-speckit`),
  phaseDefinition: (projectId: string, phase: FeaturePhase) =>
    request<PhaseDefinition>('GET', `/api/projects/${projectId}/phases/${phase}/definition`),
  savePhaseDefinition: async (
    projectId: string,
    phase: FeaturePhase,
    body: SavePhaseDefinitionRequest,
  ): Promise<SavePhaseDefinitionResult> => {
    const res = await fetch(`/api/projects/${projectId}/phases/${phase}/definition`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 409 && data.error === 'conflict') {
      throw new SaveConflictError(
        (data.message as string) ?? 'Konflikt beim Speichern',
        data.current as { content: string; mtimeMs: number },
      );
    }
    if (!res.ok) throw new Error((data.message as string) ?? `PUT → ${res.status}`);
    return data as unknown as SavePhaseDefinitionResult;
  },
  openPhaseDefinitionInEditor: (projectId: string, phase: FeaturePhase) =>
    request<unknown>('POST', `/api/projects/${projectId}/phases/${phase}/definition/open-in-editor`),

  // Feature-Artefakte (Kachel-Ergebnis-Icons)
  featureArtifacts: (featureId: string) =>
    request<FeatureArtifactStep[]>('GET', `/api/features/${featureId}/artifacts`),
  featureArtifact: (featureId: string, phase: FeaturePhase, fileId?: string) =>
    request<FeatureArtifact>(
      'GET',
      `/api/features/${featureId}/artifacts/${phase}${fileId ? `?file=${encodeURIComponent(fileId)}` : ''}`,
    ),
  saveFeatureArtifact: async (
    featureId: string,
    phase: FeaturePhase,
    fileId: string,
    body: SaveFeatureArtifactRequest,
  ): Promise<SaveFeatureArtifactResult> => {
    const res = await fetch(
      `/api/features/${featureId}/artifacts/${phase}?file=${encodeURIComponent(fileId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 409 && data.error === 'conflict') {
      throw new SaveConflictError(
        (data.message as string) ?? 'Konflikt beim Speichern',
        data.current as { content: string; mtimeMs: number },
      );
    }
    if (!res.ok) throw new Error((data.message as string) ?? `PUT → ${res.status}`);
    return data as unknown as SaveFeatureArtifactResult;
  },

  // Projektspezifisches Wissen
  getKnowledge: (projectId: string) =>
    request<KnowledgeResponse>('GET', `/api/projects/${projectId}/knowledge`),
  createBundle: (projectId: string, body: BundleBody) =>
    request<KnowledgeBundle>('POST', `/api/projects/${projectId}/knowledge/bundles`, body),
  updateBundle: (bundleId: string, patch: Partial<BundleBody>) =>
    request<KnowledgeBundle>('PATCH', `/api/knowledge/bundles/${bundleId}`, patch),
  deleteBundle: (bundleId: string) => request<unknown>('DELETE', `/api/knowledge/bundles/${bundleId}`),
  createEntry: (projectId: string, body: EntryBody) =>
    request<KnowledgeEntry>('POST', `/api/projects/${projectId}/knowledge/entries`, body),
  updateEntry: (entryId: string, patch: Partial<EntryBody>) =>
    request<KnowledgeEntry>('PATCH', `/api/knowledge/entries/${entryId}`, patch),
  deleteEntry: (entryId: string) => request<unknown>('DELETE', `/api/knowledge/entries/${entryId}`),
  importEntry: (projectId: string, body: { bundleId: string | null; sourcePath: string; title?: string; applicability: Applicability }) =>
    request<KnowledgeEntry>('POST', `/api/projects/${projectId}/knowledge/entries/import`, body),
  refreshEntry: (entryId: string) => request<KnowledgeEntry>('POST', `/api/knowledge/entries/${entryId}/refresh`),
  featureKnowledge: (featureId: string) =>
    request<FeatureKnowledgeResponse>('GET', `/api/features/${featureId}/knowledge`),
  setKnowledgeSelection: (featureId: string, body: { targetId: string; targetKind: 'bundle' | 'entry'; decision: SelectionDecision | 'auto' }) =>
    request<FeatureKnowledgeResponse>('PUT', `/api/features/${featureId}/knowledge/selection`, body),
  materializeKnowledge: (featureId: string) =>
    request<{ indexPath: string | null; materialized: { id: string; path: string }[]; resolved: ResolvedSelection }>(
      'POST',
      `/api/features/${featureId}/knowledge/materialize`,
    ),
  getChat: (projectId: string) => request<ChatState>('GET', `/api/projects/${projectId}/chat`),
  sendChatMessage: (projectId: string, content: string) =>
    request<{ conversationId: string; userMessage: ChatMessage; assistantMessage: ChatMessage }>(
      'POST',
      `/api/projects/${projectId}/chat/messages`,
      { content },
    ),
  resetChat: (projectId: string) =>
    request<{ conversation: null }>('POST', `/api/projects/${projectId}/chat/reset`),
  decideChatProposal: (messageId: string, status: Exclude<FeatureProposalStatus, 'offen'>, featureId?: string) =>
    request<ChatMessage>('PATCH', `/api/chat/messages/${messageId}/proposal`, { status, featureId }),
  // Projekt-Chat als vollwertige Session
  ensureChatWorkSession: (projectId: string) =>
    request<{ sessionId: string }>('POST', `/api/projects/${projectId}/chat/work/session`),
  /** Neustart: frische Session. 409 → { needsConfirm, reason }; sonst { sessionId, conversationId }. */
  restartChatWorkSession: async (
    projectId: string,
    confirm: boolean,
  ): Promise<ChatWorkRestartResult | ChatWorkRestartNeedsConfirm> => {
    const res = await fetch(`/api/projects/${projectId}/chat/work/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    });
    if (res.status === 409) return (await res.json()) as ChatWorkRestartNeedsConfirm;
    if (!res.ok) throw new Error((await res.text()) || `restart → ${res.status}`);
    return (await res.json()) as ChatWorkRestartResult;
  },
  createChatFeatures: (projectId: string, names: string[]) =>
    request<{ features: Feature[] }>('POST', `/api/projects/${projectId}/chat/work/features/create`, { names }),
  dismissChatFeatures: (projectId: string) =>
    request<{ ok: true }>('POST', `/api/projects/${projectId}/chat/work/features/dismiss`),
  /** „Chat fortsetzen": Neustart-Angebot ablehnen, bis der Verlauf weiter gewachsen ist. */
  dismissChatRestartOffer: (projectId: string) =>
    request<{ ok: true }>('POST', `/api/projects/${projectId}/chat/work/offer/dismiss`),

  // Review-Portal
  reviewOverview: (projectId: string) =>
    request<ReviewOverviewItem[]>('GET', `/api/review/overview?projectId=${projectId}`),
  branches: (projectId: string) => request<BranchInfo[]>('GET', `/api/projects/${projectId}/branches`),
  featureTree: (featureId: string) => request<{ files: string[] }>('GET', `/api/features/${featureId}/tree`),
  featureFile: (featureId: string, path: string) =>
    request<{ path: string; content: string; mtimeMs: number; size: number }>(
      'GET',
      `/api/features/${featureId}/file?path=${encodeURIComponent(path)}`,
    ),
  saveFeatureFile: async (
    featureId: string,
    body: { path: string; content: string; baseMtimeMs: number },
  ): Promise<{ mtimeMs: number }> => {
    const res = await fetch(`/api/features/${featureId}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 409 && data.error === 'conflict') {
      throw new SaveConflictError((data.message as string) ?? 'Konflikt beim Speichern', {
        content: '',
        mtimeMs: data.currentMtimeMs as number,
      });
    }
    if (!res.ok) throw new Error((data.message as string) ?? `PUT → ${res.status}`);
    return data as unknown as { mtimeMs: number };
  },
  comments: (featureId: string) => request<ReviewComment[]>('GET', `/api/features/${featureId}/comments`),
  addComment: (
    featureId: string,
    body: { filePath?: string | null; line?: number | null; side?: 'old' | 'new' | null; text: string },
  ) => request<ReviewComment>('POST', `/api/features/${featureId}/comments`, body),
  updateComment: (commentId: string, patch: { text?: string; status?: 'open' | 'resolved' }) =>
    request<ReviewComment>('PATCH', `/api/comments/${commentId}`, patch),
  deleteComment: (commentId: string) => request<unknown>('DELETE', `/api/comments/${commentId}`),
  agentRuns: (featureId: string) => request<AgentRunSummary[]>('GET', `/api/features/${featureId}/agent-runs`),
  agentRunReport: (featureId: string, runId: string) =>
    request<{ content: string; reportPath: string }>(
      'GET',
      `/api/features/${featureId}/agent-runs/${encodeURIComponent(runId)}/report`,
    ),

  /**
   * Systemzustand für die Kopfleiste (Contract C3): Ressourcendruck samt fertiger
   * Bewertung und der zuletzt registrierte Ausfall. Die Schwellen entscheidet der
   * Server — hier wird nur gezeigt, was er urteilt.
   */
  systemStatus: () => request<SystemStatus>('GET', '/api/system/status'),

  // Stack-Profile und Testing-Lane (manuelle Abnahme vor dem Merge)

  /** Erhobener Stack-Zustand eines Features (FR-023) — Lesen ist immer erlaubt. */
  featureStack: (featureId: string, refresh = false) =>
    request<FeatureStackView>(
      'GET',
      `/api/features/${featureId}/stack${refresh ? '?refresh=1' : ''}`,
    ),
  /**
   * Eine der vier Lane-Aktionen. Wirkt ausschließlich auf den Stack dieses
   * Features; die Antwort ist der frisch erhobene Zustand danach (FR-032).
   */
  stackAction: (featureId: string, action: 'up' | 'stop' | 'restart' | 'down', profile?: 'test' | 'full') =>
    request<FeatureStackView>('POST', `/api/features/${featureId}/stack/${action}`, profile ? { profile } : {}),
  /** Einträge der Testing-Lane eines Projekts (FR-030). */
  testingLane: (projectId: string, refresh = false) =>
    request<TestingLaneView>(
      'GET',
      `/api/testing-lane?projectId=${encodeURIComponent(projectId)}${refresh ? '&refresh=1' : ''}`,
    ),
  confirmManualTest: (featureId: string) =>
    request<Feature>('POST', `/api/features/${featureId}/manual-test/confirm`),
  /** Ablehnen; der Grund ist Pflicht (FR-029). */
  rejectManualTest: (featureId: string, reason: string) =>
    request<Feature>('POST', `/api/features/${featureId}/manual-test/reject`, { reason }),
  /** Fehlgeschlagenes Aufräumen erneut anstoßen (FR-037). */
  retryCleanup: (featureId: string) =>
    request<{ cleaned: boolean; worktreePath: string | null; cleanupError: string | null }>(
      'POST',
      `/api/features/${featureId}/cleanup`,
    ),

  // Worktree-Übersicht (tool-weit, projektübergreifend)
  worktrees: (refresh = false) =>
    request<WorktreeOverview>('GET', refresh ? '/api/worktrees?refresh=1' : '/api/worktrees'),
  /**
   * Einen Worktree entfernen. Abweisungen kommen als {@link WorktreeRemoveError}
   * mit unterscheidbarem Code — insbesondere `uncommitted` inkl. Anzahl, die den
   * zweistufigen Bestätigungsfluss auslöst.
   */
  removeWorktree: async (body: {
    projectId: string;
    path: string;
    force?: boolean;
  }): Promise<{ ok: true; featureId: string | null }> => {
    const res = await fetch('/api/worktrees/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: WorktreeRemoveCode;
      message?: string;
      uncommittedFileCount?: number;
      ok?: true;
      featureId?: string | null;
    };
    if (!res.ok) {
      throw new WorktreeRemoveError(
        data.message ?? `Entfernen fehlgeschlagen (${res.status})`,
        data.error ?? 'remove_failed',
        data.uncommittedFileCount ?? 0,
      );
    }
    return { ok: true, featureId: data.featureId ?? null };
  },

  // Agents-Verwaltung
  agents: (projectId?: string) =>
    request<AgentDefinition[]>('GET', projectId ? `/api/agents?projectId=${projectId}` : '/api/agents'),
  saveAgent: (agent: Omit<AgentDefinition, 'id'> & { id?: string }) =>
    request<AgentDefinition>('PUT', '/api/agents', agent),
  deleteAgent: (agentId: string) => request<unknown>('DELETE', `/api/agents/${agentId}`),
  featureAgents: (featureId: string) => request<FeatureAgentView[]>('GET', `/api/features/${featureId}/agents`),
  setAgentSelection: (featureId: string, agentId: string, decision: AgentFeatureDecision | 'auto') =>
    request<unknown>('PUT', `/api/features/${featureId}/agents/selection`, { agentId, decision }),
  runAgent: (featureId: string, agentId: string) =>
    request<{ started: true }>('POST', `/api/features/${featureId}/agents/${agentId}/run`),

  // Lebenszyklus-Schritte (Zwilling der Agent-Aufrufe). Bewusst OHNE „jetzt ausführen":
  // ein Schritt läuft an seinem Auslöser, die Stufe wird als Ganzes erneut angestoßen.
  lifecycleSteps: (projectId?: string) =>
    request<LifecycleStep[]>(
      'GET',
      projectId ? `/api/lifecycle-steps?projectId=${projectId}` : '/api/lifecycle-steps',
    ),
  saveLifecycleStep: (step: Omit<LifecycleStep, 'id'> & { id?: string }) =>
    request<LifecycleStep>('PUT', '/api/lifecycle-steps', step),
  deleteLifecycleStep: (stepId: string) => request<unknown>('DELETE', `/api/lifecycle-steps/${stepId}`),
  featureLifecycleSteps: (featureId: string) =>
    request<FeatureLifecycleStepView[]>('GET', `/api/features/${featureId}/lifecycle-steps`),
  setLifecycleStepSelection: (
    featureId: string,
    stepId: string,
    decision: LifecycleStepFeatureDecision | 'auto',
  ) => request<unknown>('PUT', `/api/features/${featureId}/lifecycle-steps/selection`, { stepId, decision }),
  // Jira-Anbindung & Import (US1–US4)
  jiraStatus: () => jiraRequest<JiraConnectionStatus>('GET', '/api/jira/status'),
  jiraConnect: () => jiraRequest<{ authUrl: string | null }>('POST', '/api/jira/connect'),
  jiraDisconnect: () => jiraRequest<{ state: 'disconnected' }>('POST', '/api/jira/disconnect'),
  jiraSites: () => jiraRequest<JiraSite[]>('GET', '/api/jira/sites'),
  jiraProjects: (siteId: string) =>
    jiraRequest<JiraProject[]>('GET', `/api/jira/projects?siteId=${encodeURIComponent(siteId)}`),
  jiraSprints: (siteId: string, projectKey: string) =>
    jiraRequest<JiraSprint[]>(
      'GET',
      `/api/jira/sprints?siteId=${encodeURIComponent(siteId)}&projectKey=${encodeURIComponent(projectKey)}`,
    ),
  jiraIssues: (siteId: string, projectKey: string, sprintId?: number, projectId?: string) => {
    const params = new URLSearchParams({ siteId, projectKey });
    if (sprintId !== undefined) params.set('sprintId', String(sprintId));
    if (projectId) params.set('projectId', projectId);
    return jiraRequest<JiraIssueSummary[]>('GET', `/api/jira/issues?${params.toString()}`);
  },
  getJiraSelection: () => jiraRequest<JiraSelection>('GET', '/api/settings/jira'),
  saveJiraSelection: (sel: JiraSelection) => jiraRequest<JiraSelection>('PUT', '/api/settings/jira', sel),
  jiraImport: (projectId: string, payload: { siteId: string; issueKeys: string[]; confirmedReimports?: string[] }) =>
    jiraRequest<JiraImportResult[]>('POST', `/api/projects/${projectId}/jira-import`, payload),
};

export interface KnowledgeResponse {
  tree: KnowledgeTree;
  index: KnowledgeIndex;
}
export interface FeatureKnowledgeResponse {
  index: KnowledgeIndex;
  resolved: ResolvedSelection;
}
export interface BundleBody {
  parentId: string | null;
  name: string;
  applicability: Applicability;
}
export interface EntryBody {
  bundleId: string | null;
  title: string;
  body: string;
  applicability: Applicability;
}

export interface DiffSummary {
  files: { path: string; additions: number; deletions: number; binary: boolean }[];
  commits: { sha: string; date: number; subject: string }[];
}

/** Zustand der Telemetrie-Erfassung (FR-019). */
export interface TelemetryStatus {
  active: boolean;
  /** Grund, wenn nicht in Betrieb; null = läuft. */
  reason: 'route_unavailable' | 'no_events_yet' | null;
  endpoint: string;
  eventsReceived: number;
  lastEventAt: number | null;
  /** Eine bestehende OTel-Konfiguration wird für Toolkit-Sessions übersteuert. */
  overridesUserConfig: boolean;
}

export interface ExecutionInfo {
  id: string;
  projectId: string;
  featureId: string | null;
  kind: 'phase' | 'verify' | 'review' | 'conflict_resolution' | 'chat' | 'chat_work' | 'lifecycle_step';
  /** Bezeichnung des Laufs; bei kind='lifecycle_step' der Schrittname beim Start. */
  label: string | null;
  phase: string | null;
  status: 'running' | 'succeeded' | 'failed' | 'orphaned';
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  tokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  tokensSource: 'telemetry' | 'transcript' | 'parsed' | 'estimated' | null;
  /** Von der CLI gemeldeter Betrag in Mikro-USD; null = kein Betrag (nie geschätzt). */
  costMicros: number | null;
  /** Tokens der Subagenten; null = es liefen keine (dann wird nichts angezeigt). */
  subagentTokens: number | null;
  subagentCostMicros: number | null;
  model: string | null;
  telemetryFinalAt: number | null;
  logPath: string | null;
}
