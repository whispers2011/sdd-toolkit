import { describe, expect, it } from 'vitest';
import { aggregateBreakdown } from './costBreakdown.js';
import type { ExecutionRecord } from './types.js';

function exec(partial: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    id: Math.random().toString(36).slice(2),
    projectId: 'p1',
    featureId: 'f1',
    kind: 'phase',
    phase: null,
    status: 'succeeded',
    startedAt: 0,
    finishedAt: 1,
    exitCode: 0,
    tokens: 0,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    tokensSource: null,
    costMicros: null,
    subagentTokens: null,
    subagentCostMicros: null,
    model: null,
    telemetryFinalAt: null,
    transcriptOffsetStart: null,
    transcriptOffsetEnd: null,
    transcriptPath: null,
    optContextStrategy: null,
    optCompression: null,
    logPath: null,
    ...partial,
  };
}

describe('aggregateBreakdown', () => {
  it('summiert je Phase und hält die Invariante byPhase + phasenlos == total', () => {
    const execs = [
      exec({ kind: 'phase', phase: 'plan', tokens: 30000, tokensSource: 'transcript' }),
      exec({ kind: 'phase', phase: 'implement', tokens: 40000, tokensSource: 'transcript' }),
      exec({ kind: 'review', phase: null, tokens: 500, tokensSource: 'estimated' }),
    ];
    const b = aggregateBreakdown(execs, { featureId: 'f1' });
    expect(b.total.tokens).toBe(70500);
    const phaseSum = b.byPhase.reduce((s, p) => s + p.rollup.tokens, 0);
    const phaselessKinds = b.byKind.filter((k) => k.kind === 'review');
    const phaseless = phaselessKinds.reduce((s, k) => s + k.rollup.tokens, 0);
    expect(phaseSum + phaseless).toBe(b.total.tokens);
  });

  it('Mehrfachläufe derselben Phase werden summiert (runs>1)', () => {
    const execs = [
      exec({ phase: 'implement', tokens: 10000 }),
      exec({ phase: 'implement', tokens: 15000 }),
    ];
    const b = aggregateBreakdown(execs);
    const impl = b.byPhase.find((p) => p.phase === 'implement');
    expect(impl?.rollup.runs).toBe(2);
    expect(impl?.rollup.tokens).toBe(25000);
  });

  it('phasenlose Läufe (review/verify) landen in byKind, nicht in byPhase', () => {
    const b = aggregateBreakdown([exec({ kind: 'verify', phase: null, tokens: 0 })]);
    expect(b.byPhase).toHaveLength(0);
    expect(b.byKind.find((k) => k.kind === 'verify')?.rollup.runs).toBe(1);
  });

  it('sourceMix-Anteile summieren zu 1 bei bekannten Quellen', () => {
    const b = aggregateBreakdown([
      exec({ tokensSource: 'transcript' }),
      exec({ tokensSource: 'transcript' }),
      exec({ tokensSource: 'estimated' }),
      exec({ tokensSource: 'parsed' }),
    ]);
    const sum = b.sourceMix.transcript + b.sourceMix.parsed + b.sourceMix.estimated;
    expect(sum).toBeCloseTo(1, 10);
    expect(b.sourceMix.transcript).toBeCloseTo(0.5, 10);
  });

  it('groupByOptimization liefert je Strategie einen Rollup (A/B)', () => {
    const b = aggregateBreakdown(
      [
        exec({ phase: 'plan', tokens: 30000, optContextStrategy: 'full' }),
        exec({ phase: 'plan', tokens: 18000, optContextStrategy: 'fresh' }),
      ],
      { groupByOptimization: true },
    );
    expect(b.byOptimization).toBeDefined();
    const full = b.byOptimization!.find((o) => o.contextStrategy === 'full');
    const fresh = b.byOptimization!.find((o) => o.contextStrategy === 'fresh');
    expect(full?.rollup.tokens).toBe(30000);
    expect(fresh?.rollup.tokens).toBe(18000);
  });

  it('weist die Telemetrie-Herkunft im Messanteil aus (FR-018)', () => {
    const b = aggregateBreakdown([
      exec({ tokensSource: 'telemetry' }),
      exec({ tokensSource: 'telemetry' }),
      exec({ tokensSource: 'transcript' }),
      exec({ tokensSource: 'estimated' }),
    ]);
    expect(b.sourceMix.telemetry).toBeCloseTo(0.5, 10);
    expect(b.sourceMix.transcript).toBeCloseTo(0.25, 10);
    const sum = b.sourceMix.telemetry + b.sourceMix.transcript + b.sourceMix.parsed + b.sourceMix.estimated;
    expect(sum).toBeCloseTo(1, 10);
  });

  it('summiert nur gemeldete Beträge und zählt die Läufe ohne Betrag (FR-024)', () => {
    const b = aggregateBreakdown([
      exec({ costMicros: 120_000 }),
      exec({ costMicros: 80_000 }),
      exec({ costMicros: null }),
      exec({ costMicros: null }),
    ]);
    expect(b.total.costMicros).toBe(200_000);
    expect(b.total.runsWithoutCost).toBe(2);
  });

  it('bildet aus fehlenden Beträgen keinen Ersatzwert (FR-023)', () => {
    const b = aggregateBreakdown([exec({ costMicros: null, tokens: 50_000 })]);
    expect(b.total.costMicros).toBe(0);
    expect(b.total.runsWithoutCost).toBe(1);
  });

  it('summiert den Subagenten-Anteil (FR-010)', () => {
    const b = aggregateBreakdown([
      exec({ tokens: 1000, subagentTokens: 400 }),
      exec({ tokens: 500, subagentTokens: null }),
    ]);
    expect(b.total.subagentTokens).toBe(400);
    expect(b.total.tokens).toBe(1500);
  });
});
