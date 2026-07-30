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
  return 'overhead'; // verify, review, conflict_resolution, lifecycle_step
}

/** Anzeige-Reihenfolge der Steps eines Laufs: Workflow-Phasen, danach Integrations-Overhead. */
const STEP_ORDER: readonly string[] = [
  'constitution',
  ...FEATURE_PHASES,
  'lifecycle_step',
  'verify',
  'review',
  'conflict_resolution',
  'chat',
  'chat_work',
];

/**
 * Läufe, an denen es nichts zu messen gibt. Ein Lebenszyklus-Schritt ist ein
 * Shell-Kommando — es verbraucht keine Tokens und meldet keine Herkunft. Im Nenner
 * der Mess-Herkunft würde er als „ungemessen" zählen und damit den Messanteil eines
 * Laufs künstlich drücken, obwohl nichts fehlt.
 */
function countsTowardSourceMix(e: ExecutionRecord): boolean {
  return e.kind !== 'lifecycle_step';
}

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
  /**
   * Aufgabenstand des zugehörigen Features — Durchreichung, keine neue Erhebung
   * (FR-017). Steht im Objekt, weil die Läufe-Ansicht das Feature nicht mitliefert.
   */
  tasksDone: number;
  /** `0` = keine Aufgabenliste vorhanden (nie als „0 von 0 erledigt" anzeigen). */
  tasksTotal: number;
}

export interface CostPerTask {
  /** Mikro-USD je erledigter Aufgabe; `null` = nicht bestimmbar ⇒ Strich (FR-020/FR-021). */
  micros: number | null;
  /** Mindestens eine Ausführung des Laufs hat keinen Betrag gemeldet (FR-021). */
  incomplete: boolean;
}

/**
 * Bezugsgrösse eines Laufs: gemeldeter Betrag je ERLEDIGTER Aufgabe. Nie geschätzt.
 *
 * Eine Funktion statt eines Feldes, damit Läufe-Liste und Lauf-Dashboard nicht
 * auseinanderlaufen können (FR-019) und keine weitere Kennzahl gespeichert wird.
 *
 * Zwei Fälle liefern bewusst `null` statt einer Zahl: ohne erledigte Aufgabe gibt
 * es keinen Nenner, und ohne gemeldeten Betrag wäre `0` eine Behauptung über
 * Kosten, die niemand gemessen hat.
 */
export function costPerTask(run: Pick<RunSummary, 'total' | 'tasksDone'>): CostPerTask {
  const incomplete = run.total.runsWithoutCost > 0;
  if (run.tasksDone <= 0 || run.total.costMicros <= 0) return { micros: null, incomplete };
  return { micros: Math.round(run.total.costMicros / run.tasksDone), incomplete };
}

function emptyRollup(): CostRollup {
  return {
    runs: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costMicros: 0,
    runsWithoutCost: 0,
    subagentTokens: 0,
  };
}

function add(r: CostRollup, e: ExecutionRecord): void {
  r.runs += 1;
  r.tokens += e.tokens ?? 0;
  r.inputTokens += e.inputTokens ?? 0;
  r.outputTokens += e.outputTokens ?? 0;
  r.cacheReadTokens += e.cacheReadTokens ?? 0;
  r.cacheCreationTokens += e.cacheCreationTokens ?? 0;
  // Nur gemeldete Beträge summieren; Läufe ohne Betrag zählen, statt geschätzt zu werden (FR-024).
  if (e.costMicros === null) r.runsWithoutCost += 1;
  else r.costMicros += e.costMicros;
  r.subagentTokens += e.subagentTokens ?? 0;
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
  const sourceCounts: Record<TokensSource, number> = { telemetry: 0, transcript: 0, parsed: 0, estimated: 0 };
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

    // Nenner sind ALLE Läufe, an denen es etwas zu messen gibt — nicht nur die bereits
    // gemessenen: sonst meldet ein Lauf mit 1 gemessenen und 10 ungemessenen Executions
    // „100 % gemessen". Der fehlende Rest zu 1 ist der ungemessene Anteil.
    if (countsTowardSourceMix(e)) {
      sourceTotal += 1;
      if (e.tokensSource) sourceCounts[e.tokensSource] += 1;
    }
    if (startedAt === 0 || e.startedAt < startedAt) startedAt = e.startedAt;
    const activity = e.finishedAt ?? e.startedAt;
    if (activity > lastActivityAt) lastActivityAt = activity;
    if (e.status === 'running') running = true;
  }

  const sourceMix: Record<TokensSource, number> = { telemetry: 0, transcript: 0, parsed: 0, estimated: 0 };
  if (sourceTotal > 0) {
    sourceMix.telemetry = sourceCounts.telemetry / sourceTotal;
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
    tasksDone: feature.tasksDone,
    tasksTotal: feature.tasksTotal,
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
