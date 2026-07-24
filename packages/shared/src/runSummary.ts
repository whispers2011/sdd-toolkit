/**
 * Läufe-Sicht: Ein „Lauf" ist ein Worktree (= Feature), nicht eine einzelne
 * Agent-Ausführung. Aggregiert Executions pro Feature zu Step-Rollups
 * (specify … implement, danach Verify/Review/Merge) und kategorisiert den
 * Verbrauch in Spezifikation vs. Coding vs. Overhead. Reine Funktionen, keine IO.
 */
import { FEATURE_PHASES, type ExecutionRecord, type Feature, type IntegrationStage } from './types.js';
import type { CostRollup, TokensSource } from './costBreakdown.js';

export type RunCategory = 'spec' | 'coding' | 'overhead' | 'chat';

export const RUN_CATEGORY_LABELS: Record<RunCategory, string> = {
  spec: 'Spezifikation',
  coding: 'Coding',
  overhead: 'Overhead',
  chat: 'Chat',
};

/** Verbrauchskategorie einer Execution: Phasen bis tasks = Spez, implement = Coding, Rest = Overhead/Chat. */
export function categorizeExecution(e: Pick<ExecutionRecord, 'kind' | 'phase'>): RunCategory {
  if (e.kind === 'phase') return e.phase === 'implement' ? 'coding' : 'spec';
  if (e.kind === 'chat' || e.kind === 'chat_work') return 'chat';
  return 'overhead'; // verify, review, conflict_resolution
}

/** Anzeige-Reihenfolge der Steps eines Laufs: Workflow-Phasen, danach Integrations-Overhead. */
const STEP_ORDER: readonly string[] = [
  'constitution',
  ...FEATURE_PHASES,
  'verify',
  'review',
  'conflict_resolution',
  'chat',
  'chat_work',
];

export interface RunStep {
  /** Phase (specify, plan, …) oder Kind (verify, review, …). */
  key: string;
  category: RunCategory;
  rollup: CostRollup;
}

export interface RunSummary {
  featureId: string;
  featureName: string;
  projectId: string;
  branch: string;
  integration: IntegrationStage;
  archived: boolean;
  /** Erste Execution des Laufs (0, wenn noch keine existiert). */
  startedAt: number;
  /** Letzte Aktivität (Ende bzw. Start der jüngsten Execution). */
  lastActivityAt: number;
  /** Mindestens eine Execution läuft gerade. */
  running: boolean;
  total: CostRollup;
  byStep: RunStep[];
  byCategory: Record<RunCategory, CostRollup>;
  /** Anteil je Mess-Herkunft (transcript = autoritativ). */
  sourceMix: Record<TokensSource, number>;
}

function emptyRollup(): CostRollup {
  return {
    runs: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };
}

function add(r: CostRollup, e: ExecutionRecord): void {
  r.runs += 1;
  r.tokens += e.tokens ?? 0;
  r.inputTokens += e.inputTokens ?? 0;
  r.outputTokens += e.outputTokens ?? 0;
  r.cacheReadTokens += e.cacheReadTokens ?? 0;
  r.cacheCreationTokens += e.cacheCreationTokens ?? 0;
  r.costUsd += e.costUsd ?? 0;
}

function stepKeyOf(e: ExecutionRecord): string {
  return e.kind === 'phase' ? (e.phase ?? 'phase') : e.kind;
}

function buildOne(feature: Feature, executions: ExecutionRecord[]): RunSummary {
  const total = emptyRollup();
  const stepMap = new Map<string, RunStep>();
  const byCategory: Record<RunCategory, CostRollup> = {
    spec: emptyRollup(),
    coding: emptyRollup(),
    overhead: emptyRollup(),
    chat: emptyRollup(),
  };
  const sourceCounts: Record<TokensSource, number> = { transcript: 0, parsed: 0, estimated: 0 };
  let sourceTotal = 0;
  let startedAt = 0;
  let lastActivityAt = 0;
  let running = false;

  for (const e of executions) {
    add(total, e);
    const category = categorizeExecution(e);
    add(byCategory[category], e);

    const key = stepKeyOf(e);
    let step = stepMap.get(key);
    if (!step) stepMap.set(key, (step = { key, category, rollup: emptyRollup() }));
    add(step.rollup, e);

    // Nenner sind ALLE Läufe, nicht nur die bereits gemessenen: sonst meldet ein Lauf
    // mit 1 gemessenen und 10 ungemessenen Executions „100 % gemessen". Der fehlende
    // Rest zu 1 ist der ungemessene Anteil.
    sourceTotal += 1;
    if (e.tokensSource) sourceCounts[e.tokensSource] += 1;
    if (startedAt === 0 || e.startedAt < startedAt) startedAt = e.startedAt;
    const activity = e.finishedAt ?? e.startedAt;
    if (activity > lastActivityAt) lastActivityAt = activity;
    if (e.status === 'running') running = true;
  }

  const sourceMix: Record<TokensSource, number> = { transcript: 0, parsed: 0, estimated: 0 };
  if (sourceTotal > 0) {
    sourceMix.transcript = sourceCounts.transcript / sourceTotal;
    sourceMix.parsed = sourceCounts.parsed / sourceTotal;
    sourceMix.estimated = sourceCounts.estimated / sourceTotal;
  }

  const byStep = [...stepMap.values()].sort((a, b) => {
    const ia = STEP_ORDER.indexOf(a.key);
    const ib = STEP_ORDER.indexOf(b.key);
    return (ia === -1 ? STEP_ORDER.length : ia) - (ib === -1 ? STEP_ORDER.length : ib);
  });

  return {
    featureId: feature.id,
    featureName: feature.name,
    projectId: feature.projectId,
    branch: feature.branch,
    integration: feature.integration,
    archived: feature.archivedAt !== null,
    startedAt,
    lastActivityAt,
    running,
    total,
    byStep,
    byCategory,
    sourceMix,
  };
}

/**
 * Alle Läufe (Features mit mindestens einer Execution) aggregieren,
 * jüngste Aktivität zuerst. Executions ohne featureId (Projekt-Chat,
 * Constitution) sind bewusst nicht Teil eines Laufs.
 */
export function buildRunSummaries(features: Feature[], executions: ExecutionRecord[]): RunSummary[] {
  const byFeature = new Map<string, ExecutionRecord[]>();
  for (const e of executions) {
    if (!e.featureId) continue;
    let list = byFeature.get(e.featureId);
    if (!list) byFeature.set(e.featureId, (list = []));
    list.push(e);
  }
  const summaries: RunSummary[] = [];
  for (const f of features) {
    const list = byFeature.get(f.id);
    if (!list || list.length === 0) continue;
    summaries.push(buildOne(f, list));
  }
  return summaries.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
