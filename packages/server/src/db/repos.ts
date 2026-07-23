import { nanoid } from 'nanoid';
import type {
  AttentionItem,
  AttentionKind,
  AutomationSettings,
  ChatConversation,
  ChatMessage,
  ChatMessageStatus,
  ChatMode,
  CompressionMode,
  ContextStrategy,
  ExecutionRecord,
  Feature,
  FeaturePhase,
  FeatureProposal,
  IntegrationStage,
  MergeQueueItem,
  OptimizationSettings,
  Project,
  VerifyCommand,
  WorkflowPhase,
} from '@sdd/shared';
import {
  LEVEL2_DEFAULTS,
  OPTIMIZATION_OFF_DEFAULTS,
  parseOptimizationPartial,
  type PhaseMap,
} from '@sdd/shared';
import type { DB } from './database.js';

// ---------- Projects ----------

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  default_branch: string;
  color: string | null;
  enabled_phases: string;
  verify_commands: string;
  automation: string;
  optimization: string;
  merge_mode: string;
  editor_cmd: string | null;
  integration_mode: string;
  created_at: number;
}

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    defaultBranch: r.default_branch,
    color: r.color,
    enabledPhases: JSON.parse(r.enabled_phases) as FeaturePhase[],
    verifyCommands: JSON.parse(r.verify_commands) as VerifyCommand[],
    automation: JSON.parse(r.automation) as Partial<AutomationSettings>,
    optimization: parseOptimizationPartial(JSON.parse(r.optimization ?? '{}')),
    mergeMode: r.merge_mode === 'squash' ? 'squash' : 'ff',
    editorCmd: r.editor_cmd,
    integrationMode: r.integration_mode === 'pr' ? 'pr' : 'local',
    createdAt: r.created_at,
  };
}

export class ProjectRepo {
  constructor(private db: DB) {}

  create(p: Omit<Project, 'id' | 'createdAt'>): Project {
    const id = nanoid(10);
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO projects (id, name, path, default_branch, color, enabled_phases, verify_commands, automation, optimization, merge_mode, editor_cmd, integration_mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        p.name,
        p.path,
        p.defaultBranch,
        p.color,
        JSON.stringify(p.enabledPhases),
        JSON.stringify(p.verifyCommands),
        JSON.stringify(p.automation),
        JSON.stringify(p.optimization ?? {}),
        p.mergeMode,
        p.editorCmd,
        p.integrationMode,
        createdAt,
      );
    return { ...p, id, createdAt };
  }

  update(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): void {
    const cur = this.get(id);
    if (!cur) throw new Error(`Projekt ${id} nicht gefunden`);
    const merged = { ...cur, ...patch };
    this.db
      .prepare(
        `UPDATE projects SET name=?, path=?, default_branch=?, color=?, enabled_phases=?, verify_commands=?, automation=?, optimization=?, merge_mode=?, editor_cmd=?, integration_mode=? WHERE id=?`,
      )
      .run(
        merged.name,
        merged.path,
        merged.defaultBranch,
        merged.color,
        JSON.stringify(merged.enabledPhases),
        JSON.stringify(merged.verifyCommands),
        JSON.stringify(merged.automation),
        JSON.stringify(merged.optimization ?? {}),
        merged.mergeMode,
        merged.editorCmd,
        merged.integrationMode,
        id,
      );
  }

  get(id: string): Project | null {
    const r = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id) as ProjectRow | undefined;
    return r ? toProject(r) : null;
  }

  getByPath(path: string): Project | null {
    const r = this.db.prepare('SELECT * FROM projects WHERE path=?').get(path) as ProjectRow | undefined;
    return r ? toProject(r) : null;
  }

  list(): Project[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY name').all() as ProjectRow[]).map(toProject);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
  }
}

// ---------- Features ----------

interface FeatureRow {
  id: string;
  project_id: string;
  name: string;
  branch: string;
  worktree_path: string | null;
  phases: string;
  integration: string;
  automation: string;
  optimization: string;
  tasks_done: number;
  tasks_total: number;
  created_at: number;
  archived_at: number | null;
}

function toFeature(r: FeatureRow): Feature {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    branch: r.branch,
    worktreePath: r.worktree_path,
    phases: JSON.parse(r.phases) as PhaseMap,
    integration: r.integration as IntegrationStage,
    automation: JSON.parse(r.automation) as Partial<AutomationSettings>,
    optimization: parseOptimizationPartial(JSON.parse(r.optimization ?? '{}')),
    tasksDone: r.tasks_done,
    tasksTotal: r.tasks_total,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
  };
}

export class FeatureRepo {
  constructor(private db: DB) {}

  create(f: Omit<Feature, 'id' | 'createdAt' | 'archivedAt'>): Feature {
    const id = nanoid(10);
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO features (id, project_id, name, branch, worktree_path, phases, integration, automation, optimization, tasks_done, tasks_total, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        f.projectId,
        f.name,
        f.branch,
        f.worktreePath,
        JSON.stringify(f.phases),
        f.integration,
        JSON.stringify(f.automation),
        JSON.stringify(f.optimization ?? {}),
        f.tasksDone,
        f.tasksTotal,
        createdAt,
      );
    return { ...f, id, createdAt, archivedAt: null };
  }

  get(id: string): Feature | null {
    const r = this.db.prepare('SELECT * FROM features WHERE id=?').get(id) as FeatureRow | undefined;
    return r ? toFeature(r) : null;
  }

  getByName(projectId: string, name: string): Feature | null {
    const r = this.db
      .prepare('SELECT * FROM features WHERE project_id=? AND name=?')
      .get(projectId, name) as FeatureRow | undefined;
    return r ? toFeature(r) : null;
  }

  listByProject(projectId: string, includeArchived = false): Feature[] {
    const sql = includeArchived
      ? 'SELECT * FROM features WHERE project_id=? ORDER BY created_at'
      : 'SELECT * FROM features WHERE project_id=? AND archived_at IS NULL ORDER BY created_at';
    return (this.db.prepare(sql).all(projectId) as FeatureRow[]).map(toFeature);
  }

  listAll(): Feature[] {
    return (
      this.db.prepare('SELECT * FROM features WHERE archived_at IS NULL ORDER BY created_at').all() as FeatureRow[]
    ).map(toFeature);
  }

  savePhases(id: string, phases: PhaseMap): void {
    this.db.prepare('UPDATE features SET phases=? WHERE id=?').run(JSON.stringify(phases), id);
  }

  setIntegration(id: string, stage: IntegrationStage): void {
    this.db.prepare('UPDATE features SET integration=? WHERE id=?').run(stage, id);
  }

  setWorktree(id: string, worktreePath: string | null): void {
    this.db.prepare('UPDATE features SET worktree_path=? WHERE id=?').run(worktreePath, id);
  }

  setTasks(id: string, done: number, total: number): void {
    this.db.prepare('UPDATE features SET tasks_done=?, tasks_total=? WHERE id=?').run(done, total, id);
  }

  setAutomation(id: string, automation: Partial<AutomationSettings>): void {
    this.db.prepare('UPDATE features SET automation=? WHERE id=?').run(JSON.stringify(automation), id);
  }

  setOptimization(id: string, optimization: Partial<OptimizationSettings>): void {
    this.db
      .prepare('UPDATE features SET optimization=? WHERE id=?')
      .run(JSON.stringify(parseOptimizationPartial(optimization)), id);
  }

  archive(id: string): void {
    this.db.prepare('UPDATE features SET archived_at=? WHERE id=?').run(Date.now(), id);
  }
}

// ---------- Sessions (persistiert für Reaper/Resume) ----------

export interface SessionRow {
  id: string;
  feature_id: string | null;
  conversation_id: string | null;
  project_id: string;
  kind: string;
  claude_session_id: string | null;
  pid: number | null;
  created_at: number;
  ended_at: number | null;
}

export class SessionRepo {
  constructor(private db: DB) {}

  create(s: {
    id: string;
    featureId: string | null;
    conversationId?: string | null;
    projectId: string;
    kind: string;
    pid: number | null;
  }): void {
    this.db
      .prepare(
        'INSERT INTO sessions (id, feature_id, conversation_id, project_id, kind, pid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(s.id, s.featureId, s.conversationId ?? null, s.projectId, s.kind, s.pid, Date.now());
  }

  setClaudeSessionId(id: string, claudeSessionId: string | null): void {
    this.db.prepare('UPDATE sessions SET claude_session_id=? WHERE id=?').run(claudeSessionId, id);
  }

  setPid(id: string, pid: number | null): void {
    this.db.prepare('UPDATE sessions SET pid=? WHERE id=?').run(pid, id);
  }

  end(id: string): void {
    this.db.prepare('UPDATE sessions SET ended_at=?, pid=NULL WHERE id=?').run(Date.now(), id);
  }

  get(id: string): SessionRow | null {
    return (this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as SessionRow | undefined) ?? null;
  }

  listOpen(): SessionRow[] {
    return this.db.prepare('SELECT * FROM sessions WHERE ended_at IS NULL').all() as SessionRow[];
  }

  latestForFeature(featureId: string): SessionRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM sessions WHERE feature_id=? ORDER BY created_at DESC LIMIT 1')
        .get(featureId) as SessionRow | undefined) ?? null
    );
  }

  latestForConversation(conversationId: string): SessionRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM sessions WHERE conversation_id=? ORDER BY created_at DESC LIMIT 1')
        .get(conversationId) as SessionRow | undefined) ?? null
    );
  }
}

// ---------- Executions ----------

export interface ExecutionStartInput {
  projectId: string;
  featureId: string | null;
  kind: ExecutionRecord['kind'];
  phase: WorkflowPhase | null;
  logPath: string | null;
  /** Transkript-Byte-Offset beim Start (Usage-Attribution, nur Phasen). */
  transcriptOffsetStart?: number | null;
  /** Snapshot der aktiven Optimierungs-Strategie (nur Phasen). */
  optContextStrategy?: ContextStrategy | null;
  optCompression?: CompressionMode | null;
}

/** Autoritative/geschätzte Verbrauchsdaten beim Abschluss eines Laufs. */
export interface ExecutionUsageInput {
  costUsd?: number | null;
  tokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  tokensSource?: ExecutionRecord['tokensSource'];
}

export class ExecutionRepo {
  constructor(private db: DB) {}

  start(e: ExecutionStartInput): string {
    const id = nanoid(10);
    this.db
      .prepare(
        `INSERT INTO executions (id, project_id, feature_id, kind, phase, status, started_at, log_path,
           transcript_offset_start, opt_context_strategy, opt_compression)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        e.projectId,
        e.featureId,
        e.kind,
        e.phase,
        Date.now(),
        e.logPath,
        e.transcriptOffsetStart ?? null,
        e.optContextStrategy ?? null,
        e.optCompression ?? null,
      );
    return id;
  }

  /** Schlanker Abschluss (Kosten/Tokens geschätzt, ohne Komponenten). */
  finish(id: string, exitCode: number, costUsd: number | null = null, tokens: number | null = null): void {
    this.finishWithUsage(id, exitCode, { costUsd, tokens });
  }

  /** Abschluss mit autoritativen Komponenten + Herkunft. */
  finishWithUsage(id: string, exitCode: number, usage: ExecutionUsageInput = {}): void {
    this.db
      .prepare(
        `UPDATE executions SET status=?, finished_at=?, exit_code=?, cost_usd=?, tokens=?,
           input_tokens=?, output_tokens=?, cache_read_tokens=?, cache_creation_tokens=?, tokens_source=?
         WHERE id=?`,
      )
      .run(
        exitCode === 0 ? 'succeeded' : 'failed',
        Date.now(),
        exitCode,
        usage.costUsd ?? null,
        usage.tokens ?? null,
        usage.inputTokens ?? null,
        usage.outputTokens ?? null,
        usage.cacheReadTokens ?? null,
        usage.cacheCreationTokens ?? null,
        usage.tokensSource ?? null,
        id,
      );
  }

  /** Transkript-Endkoordinaten eines Phasen-Laufs festhalten (Lauf-Log-Attribution). */
  recordTranscriptEnd(id: string, path: string | null, offsetEnd: number): void {
    this.db
      .prepare('UPDATE executions SET transcript_path=?, transcript_offset_end=? WHERE id=?')
      .run(path, offsetEnd, id);
  }

  /** Startup-Reaper: running-Leichen aus früheren Server-Läufen markieren. */
  reapOrphans(): number {
    return this.db
      .prepare(`UPDATE executions SET status='orphaned', finished_at=? WHERE status='running'`)
      .run(Date.now()).changes;
  }

  get(id: string): ExecutionRecord | undefined {
    const row = this.db.prepare('SELECT * FROM executions WHERE id=?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.map(row) : undefined;
  }

  list(featureId?: string): ExecutionRecord[] {
    const rows = featureId
      ? this.db.prepare('SELECT * FROM executions WHERE feature_id=? ORDER BY started_at DESC').all(featureId)
      : this.db.prepare('SELECT * FROM executions ORDER BY started_at DESC LIMIT 500').all();
    return (rows as Record<string, unknown>[]).map((r) => this.map(r));
  }

  /** Ungekappte Liste für die Läufe-Aggregation (Lauf = Feature/Worktree). */
  listAll(): ExecutionRecord[] {
    const rows = this.db.prepare('SELECT * FROM executions ORDER BY started_at ASC').all();
    return (rows as Record<string, unknown>[]).map((r) => this.map(r));
  }

  private map(r: Record<string, unknown>): ExecutionRecord {
    return {
      id: r.id as string,
      projectId: r.project_id as string,
      featureId: r.feature_id as string | null,
      kind: r.kind as ExecutionRecord['kind'],
      phase: r.phase as ExecutionRecord['phase'],
      status: r.status as ExecutionRecord['status'],
      startedAt: r.started_at as number,
      finishedAt: r.finished_at as number | null,
      exitCode: r.exit_code as number | null,
      costUsd: r.cost_usd as number | null,
      tokens: (r.tokens as number | null) ?? null,
      inputTokens: (r.input_tokens as number | null) ?? null,
      outputTokens: (r.output_tokens as number | null) ?? null,
      cacheReadTokens: (r.cache_read_tokens as number | null) ?? null,
      cacheCreationTokens: (r.cache_creation_tokens as number | null) ?? null,
      tokensSource: (r.tokens_source as ExecutionRecord['tokensSource']) ?? null,
      transcriptOffsetStart: (r.transcript_offset_start as number | null) ?? null,
      transcriptOffsetEnd: (r.transcript_offset_end as number | null) ?? null,
      transcriptPath: (r.transcript_path as string | null) ?? null,
      optContextStrategy: (r.opt_context_strategy as ContextStrategy | null) ?? null,
      optCompression: (r.opt_compression as CompressionMode | null) ?? null,
      logPath: r.log_path as string | null,
    };
  }
}

// ---------- Merge-Queue ----------

export class QueueRepo {
  constructor(private db: DB) {}

  enqueue(projectId: string, featureId: string): MergeQueueItem {
    const id = nanoid(10);
    const max = this.db
      .prepare('SELECT COALESCE(MAX(position), 0) AS m FROM merge_queue WHERE project_id=?')
      .get(projectId) as { m: number };
    const item: MergeQueueItem = {
      id,
      projectId,
      featureId,
      position: max.m + 1,
      stage: 'queued',
      attempts: 0,
      lastError: null,
      enqueuedAt: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO merge_queue (id, project_id, feature_id, position, stage, attempts, enqueued_at)
         VALUES (?, ?, ?, ?, 'queued', 0, ?)`,
      )
      .run(id, projectId, featureId, item.position, item.enqueuedAt);
    return item;
  }

  head(projectId: string): MergeQueueItem | null {
    const r = this.db
      .prepare(`SELECT * FROM merge_queue WHERE project_id=? ORDER BY position LIMIT 1`)
      .get(projectId) as Record<string, unknown> | undefined;
    return r ? toQueueItem(r) : null;
  }

  listByProject(projectId: string): MergeQueueItem[] {
    return (
      this.db.prepare('SELECT * FROM merge_queue WHERE project_id=? ORDER BY position').all(projectId) as Record<
        string,
        unknown
      >[]
    ).map(toQueueItem);
  }

  setStage(id: string, stage: IntegrationStage, lastError: string | null = null): void {
    this.db.prepare('UPDATE merge_queue SET stage=?, last_error=? WHERE id=?').run(stage, lastError, id);
  }

  bumpAttempts(id: string): void {
    this.db.prepare('UPDATE merge_queue SET attempts=attempts+1 WHERE id=?').run(id);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM merge_queue WHERE id=?').run(id);
  }
}

function toQueueItem(r: Record<string, unknown>): MergeQueueItem {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    featureId: r.feature_id as string,
    position: r.position as number,
    stage: r.stage as IntegrationStage,
    attempts: r.attempts as number,
    lastError: r.last_error as string | null,
    enqueuedAt: r.enqueued_at as number,
  };
}

// ---------- Attention (Exception-Inbox) ----------

export class AttentionRepo {
  constructor(private db: DB) {}

  raise(a: {
    kind: AttentionKind;
    projectId: string;
    featureId?: string | null;
    sessionId?: string | null;
    conversationId?: string | null;
    message: string;
  }): AttentionItem {
    // Dedup: gleiche offene Meldung (kind+feature/session/conversation) nicht doppelt anlegen.
    const existing = this.db
      .prepare(
        `SELECT id FROM attention WHERE resolved_at IS NULL AND kind=? AND project_id=?
         AND COALESCE(feature_id,'')=COALESCE(?,'') AND COALESCE(session_id,'')=COALESCE(?,'')
         AND COALESCE(conversation_id,'')=COALESCE(?,'')`,
      )
      .get(a.kind, a.projectId, a.featureId ?? null, a.sessionId ?? null, a.conversationId ?? null) as
      | { id: string }
      | undefined;
    if (existing) return this.get(existing.id)!;

    const item: AttentionItem = {
      id: nanoid(10),
      kind: a.kind,
      projectId: a.projectId,
      featureId: a.featureId ?? null,
      sessionId: a.sessionId ?? null,
      conversationId: a.conversationId ?? null,
      message: a.message,
      createdAt: Date.now(),
      resolvedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO attention (id, kind, project_id, feature_id, session_id, conversation_id, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.kind,
        item.projectId,
        item.featureId,
        item.sessionId,
        item.conversationId,
        item.message,
        item.createdAt,
      );
    return item;
  }

  resolve(id: string): void {
    this.db.prepare('UPDATE attention SET resolved_at=? WHERE id=? AND resolved_at IS NULL').run(Date.now(), id);
  }

  /** Offene Items einer Session/eines Features/einer Unterhaltung auflösen (z.B. Input wurde gegeben). */
  resolveFor(filter: { sessionId?: string; featureId?: string; conversationId?: string; kinds?: AttentionKind[] }): void {
    const conds: string[] = ['resolved_at IS NULL'];
    const params: unknown[] = [];
    if (filter.sessionId) {
      conds.push('session_id=?');
      params.push(filter.sessionId);
    }
    if (filter.featureId) {
      conds.push('feature_id=?');
      params.push(filter.featureId);
    }
    if (filter.conversationId) {
      conds.push('conversation_id=?');
      params.push(filter.conversationId);
    }
    if (filter.kinds?.length) {
      conds.push(`kind IN (${filter.kinds.map(() => '?').join(',')})`);
      params.push(...filter.kinds);
    }
    this.db.prepare(`UPDATE attention SET resolved_at=? WHERE ${conds.join(' AND ')}`).run(Date.now(), ...params);
  }

  get(id: string): AttentionItem | null {
    const r = this.db.prepare('SELECT * FROM attention WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return r ? toAttention(r) : null;
  }

  listOpen(): AttentionItem[] {
    return (
      this.db.prepare('SELECT * FROM attention WHERE resolved_at IS NULL ORDER BY created_at DESC').all() as Record<
        string,
        unknown
      >[]
    ).map(toAttention);
  }
}

function toAttention(r: Record<string, unknown>): AttentionItem {
  return {
    id: r.id as string,
    kind: r.kind as AttentionKind,
    projectId: r.project_id as string,
    featureId: r.feature_id as string | null,
    sessionId: r.session_id as string | null,
    conversationId: (r.conversation_id as string | null) ?? null,
    message: r.message as string,
    createdAt: r.created_at as number,
    resolvedAt: r.resolved_at as number | null,
  };
}

// ---------- Projekt-Chat (Ask-a-Question) ----------

interface ChatConversationRow {
  id: string;
  project_id: string;
  mode: string;
  claude_session_id: string | null;
  created_at: number;
  updated_at: number;
  ended_at: number | null;
}

interface ChatMessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  status: string;
  error: string | null;
  proposal_json: string | null;
  cost_usd: number | null;
  tokens: number | null;
  created_at: number;
}

function toConversation(r: ChatConversationRow): ChatConversation {
  return {
    id: r.id,
    projectId: r.project_id,
    mode: (r.mode === 'work' ? 'work' : 'ask') as ChatMode,
    claudeSessionId: r.claude_session_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    endedAt: r.ended_at,
  };
}

function toChatMessage(r: ChatMessageRow): ChatMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as ChatMessage['role'],
    content: r.content,
    status: r.status as ChatMessageStatus,
    error: r.error,
    proposal: r.proposal_json ? (JSON.parse(r.proposal_json) as FeatureProposal) : null,
    costUsd: r.cost_usd,
    tokens: r.tokens,
    createdAt: r.created_at,
  };
}

export class ChatRepo {
  constructor(private db: DB) {}

  /** Aktive Unterhaltung des Projekts; legt bei Bedarf lazy eine an (im gewünschten Modus). */
  ensureActive(projectId: string, mode: ChatMode = 'ask'): ChatConversation {
    return this.getActive(projectId) ?? this.createConversation(projectId, mode);
  }

  getActive(projectId: string): ChatConversation | null {
    const r = this.db
      .prepare('SELECT * FROM chat_conversations WHERE project_id=? AND ended_at IS NULL')
      .get(projectId) as ChatConversationRow | undefined;
    return r ? toConversation(r) : null;
  }

  /** Auch beendete Unterhaltungen (z. B. für Vorschlag-Entscheidungen nach Reset). */
  getConversation(id: string): ChatConversation | null {
    const r = this.db.prepare('SELECT * FROM chat_conversations WHERE id=?').get(id) as
      | ChatConversationRow
      | undefined;
    return r ? toConversation(r) : null;
  }

  createConversation(projectId: string, mode: ChatMode = 'ask'): ChatConversation {
    const now = Date.now();
    const conv: ChatConversation = {
      id: nanoid(10),
      projectId,
      mode,
      claudeSessionId: null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
    this.db
      .prepare(
        'INSERT INTO chat_conversations (id, project_id, mode, claude_session_id, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
      )
      .run(conv.id, projectId, mode, now, now);
    return conv;
  }

  setMode(id: string, mode: ChatMode): void {
    this.db.prepare('UPDATE chat_conversations SET mode=? WHERE id=?').run(mode, id);
  }

  endConversation(id: string): void {
    this.db.prepare('UPDATE chat_conversations SET ended_at=? WHERE id=? AND ended_at IS NULL').run(Date.now(), id);
  }

  touch(id: string): void {
    this.db.prepare('UPDATE chat_conversations SET updated_at=? WHERE id=?').run(Date.now(), id);
  }

  setClaudeSessionId(id: string, claudeSessionId: string | null): void {
    this.db.prepare('UPDATE chat_conversations SET claude_session_id=? WHERE id=?').run(claudeSessionId, id);
  }

  listMessages(conversationId: string): ChatMessage[] {
    return (
      this.db
        .prepare('SELECT * FROM chat_messages WHERE conversation_id=? ORDER BY created_at, rowid')
        .all(conversationId) as ChatMessageRow[]
    ).map(toChatMessage);
  }

  getMessage(id: string): ChatMessage | null {
    const r = this.db.prepare('SELECT * FROM chat_messages WHERE id=?').get(id) as ChatMessageRow | undefined;
    return r ? toChatMessage(r) : null;
  }

  createMessage(m: {
    conversationId: string;
    role: ChatMessage['role'];
    content: string;
    status: ChatMessageStatus;
  }): ChatMessage {
    const msg: ChatMessage = {
      id: nanoid(10),
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      status: m.status,
      error: null,
      proposal: null,
      costUsd: null,
      tokens: null,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO chat_messages (id, conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(msg.id, msg.conversationId, msg.role, msg.content, msg.status, msg.createdAt);
    return msg;
  }

  appendDelta(id: string, delta: string): void {
    this.db.prepare(`UPDATE chat_messages SET content = content || ? WHERE id=? AND status='streaming'`).run(delta, id);
  }

  /** Streaming-Nachricht während des Resume-Fallbacks auf leer zurücksetzen. */
  resetContent(id: string): void {
    this.db.prepare(`UPDATE chat_messages SET content='' WHERE id=? AND status='streaming'`).run(id);
  }

  /** Terminaler Abschluss eines Turns — wirkt nur auf noch streamende Nachrichten. */
  finalizeMessage(
    id: string,
    outcome: {
      status: Exclude<ChatMessageStatus, 'streaming'>;
      content?: string;
      error?: string | null;
      proposal?: FeatureProposal | null;
      costUsd?: number | null;
      tokens?: number | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE chat_messages SET status=?, content=COALESCE(?, content), error=?, proposal_json=?, cost_usd=?, tokens=?
         WHERE id=? AND status='streaming'`,
      )
      .run(
        outcome.status,
        outcome.content ?? null,
        outcome.error ?? null,
        outcome.proposal ? JSON.stringify(outcome.proposal) : null,
        outcome.costUsd ?? null,
        outcome.tokens ?? null,
        id,
      );
  }

  /** Entscheidung zum Feature-Vorschlag verbuchen (Statusübergänge prüft der Service). */
  setProposal(messageId: string, proposal: FeatureProposal): void {
    this.db.prepare('UPDATE chat_messages SET proposal_json=? WHERE id=?').run(JSON.stringify(proposal), messageId);
  }

  /** Boot-Cleanup: streamende Leichen aus früheren Server-Läufen als unterbrochen markieren. */
  interruptStreaming(): number {
    return this.db.prepare(`UPDATE chat_messages SET status='interrupted' WHERE status='streaming'`).run().changes;
  }
}

// ---------- Personas (WP4) ----------

export interface PersonaRow {
  id: string;
  project_id: string | null;
  name: string;
  prompt: string;
  sort_order: number;
  enabled: number;
}

export class PersonaRepo {
  constructor(private db: DB) {}

  /** Personas eines Projekts: projektspezifische, sonst die globalen Defaults. */
  forProject(projectId: string): PersonaRow[] {
    const own = this.db
      .prepare('SELECT * FROM personas WHERE project_id=? AND enabled=1 ORDER BY sort_order')
      .all(projectId) as PersonaRow[];
    if (own.length > 0) return own;
    return this.db
      .prepare('SELECT * FROM personas WHERE project_id IS NULL AND enabled=1 ORDER BY sort_order')
      .all() as PersonaRow[];
  }

  list(): PersonaRow[] {
    return this.db.prepare('SELECT * FROM personas ORDER BY project_id NULLS FIRST, sort_order').all() as PersonaRow[];
  }

  upsert(p: { id?: string; projectId: string | null; name: string; prompt: string; sortOrder: number; enabled: boolean }): string {
    const id = p.id ?? nanoid(10);
    this.db
      .prepare(
        `INSERT INTO personas (id, project_id, name, prompt, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, prompt=excluded.prompt, sort_order=excluded.sort_order, enabled=excluded.enabled`,
      )
      .run(id, p.projectId, p.name, p.prompt, p.sortOrder, p.enabled ? 1 : 0);
    return id;
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM personas WHERE id=?').run(id);
  }
}

// ---------- Settings ----------

export class SettingsRepo {
  constructor(private db: DB) {}

  getJson<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : null;
  }

  setJson(key: string, value: unknown): void {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(key, JSON.stringify(value));
  }

  getAutomation(): AutomationSettings {
    const r = this.db.prepare(`SELECT value FROM settings WHERE key='automation'`).get() as
      | { value: string }
      | undefined;
    return r ? { ...LEVEL2_DEFAULTS, ...(JSON.parse(r.value) as Partial<AutomationSettings>) } : LEVEL2_DEFAULTS;
  }

  setAutomation(a: AutomationSettings): void {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('automation', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(JSON.stringify(a));
  }

  /** Globaler Optimierungs-Default (Token-Reduktion). Fehlt der Key → OFF (Alt-Verhalten). */
  getOptimization(): OptimizationSettings {
    const r = this.db.prepare(`SELECT value FROM settings WHERE key='optimization'`).get() as
      | { value: string }
      | undefined;
    return r
      ? { ...OPTIMIZATION_OFF_DEFAULTS, ...parseOptimizationPartial(JSON.parse(r.value)) }
      : OPTIMIZATION_OFF_DEFAULTS;
  }

  setOptimization(patch: Partial<OptimizationSettings>): OptimizationSettings {
    const merged = { ...this.getOptimization(), ...parseOptimizationPartial(patch) };
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('optimization', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(JSON.stringify(merged));
    return merged;
  }
}
