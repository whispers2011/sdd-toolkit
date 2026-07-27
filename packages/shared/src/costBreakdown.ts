/**
 * Aggregation von Executions → Feature-Verbrauchssicht (Feature
 * "minimize-token-consumption", P1). Reine Funktion — keine IO.
 */
import type { ExecutionRecord, WorkflowPhase } from './types.js';

export type ExecutionKind = ExecutionRecord['kind'];
export type TokensSource = NonNullable<ExecutionRecord['tokensSource']>;

export interface CostRollup {
  runs: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Summe der von der CLI gemeldeten Beträge in Mikro-USD (nie geschätzt, FR-022). */
  costMicros: number;
  /** Wie viele der enthaltenen Läufe keinen Betrag beitragen (FR-024). */
  runsWithoutCost: number;
  /** Anteil, den Subagenten verursacht haben (FR-010). */
  subagentTokens: number;
}

export interface FeatureCostBreakdown {
  featureId: string | null;
  total: CostRollup;
  byPhase: { phase: WorkflowPhase; rollup: CostRollup }[];
  byKind: { kind: ExecutionKind; rollup: CostRollup }[];
  /** Anteil je Herkunft (Summe ~1 bei ≥1 Lauf mit bekannter Quelle). */
  sourceMix: Record<TokensSource, number>;
  /** Nur gesetzt, wenn nach Optimierungs-Strategie gruppiert wird (A/B, SC-001). */
  byOptimization?: { contextStrategy: string; rollup: CostRollup }[];
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
  // Nur gemeldete Beträge summieren; Läufe ohne Betrag werden gezählt statt geschätzt,
  // damit eine Summe nie so aussieht, als deckte sie alle enthaltenen Läufe ab (FR-024).
  if (e.costMicros === null) r.runsWithoutCost += 1;
  else r.costMicros += e.costMicros;
  r.subagentTokens += e.subagentTokens ?? 0;
}

/**
 * Executions eines Features zu Phasen-/Art-Rollups aggregieren.
 * Invariante: Summe(byPhase) + phasenlose Läufe == total.
 */
export function aggregateBreakdown(
  executions: ExecutionRecord[],
  opts: { featureId?: string | null; groupByOptimization?: boolean } = {},
): FeatureCostBreakdown {
  const total = emptyRollup();
  const phaseMap = new Map<WorkflowPhase, CostRollup>();
  const kindMap = new Map<ExecutionKind, CostRollup>();
  const optMap = new Map<string, CostRollup>();
  const sourceCounts: Record<TokensSource, number> = { telemetry: 0, transcript: 0, parsed: 0, estimated: 0 };
  let sourceTotal = 0;

  for (const e of executions) {
    add(total, e);

    if (e.phase) {
      let r = phaseMap.get(e.phase);
      if (!r) phaseMap.set(e.phase, (r = emptyRollup()));
      add(r, e);
    }

    let k = kindMap.get(e.kind);
    if (!k) kindMap.set(e.kind, (k = emptyRollup()));
    add(k, e);

    // Nenner sind ALLE Executions (siehe runSummary): nur gemessene zu zählen
    // behauptete „100 % gemessen", während der Großteil ohne Usage dastand.
    sourceTotal += 1;
    if (e.tokensSource) sourceCounts[e.tokensSource] += 1;

    if (opts.groupByOptimization) {
      const key = e.optContextStrategy ?? 'unset';
      let o = optMap.get(key);
      if (!o) optMap.set(key, (o = emptyRollup()));
      add(o, e);
    }
  }

  const sourceMix: Record<TokensSource, number> = { telemetry: 0, transcript: 0, parsed: 0, estimated: 0 };
  if (sourceTotal > 0) {
    sourceMix.telemetry = sourceCounts.telemetry / sourceTotal;
    sourceMix.transcript = sourceCounts.transcript / sourceTotal;
    sourceMix.parsed = sourceCounts.parsed / sourceTotal;
    sourceMix.estimated = sourceCounts.estimated / sourceTotal;
  }

  const result: FeatureCostBreakdown = {
    featureId: opts.featureId ?? executions[0]?.featureId ?? null,
    total,
    byPhase: [...phaseMap.entries()]
      .map(([phase, rollup]) => ({ phase, rollup }))
      .sort((a, b) => b.rollup.tokens - a.rollup.tokens),
    byKind: [...kindMap.entries()].map(([kind, rollup]) => ({ kind, rollup })),
    sourceMix,
  };
  if (opts.groupByOptimization) {
    result.byOptimization = [...optMap.entries()].map(([contextStrategy, rollup]) => ({
      contextStrategy,
      rollup,
    }));
  }
  return result;
}
