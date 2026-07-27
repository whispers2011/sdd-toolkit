import { describe, expect, it } from 'vitest';
import { buildRunSummaries, categorizeExecution } from './runSummary.js';
import { initialPhases } from './phaseMachine.js';
import type { ExecutionRecord, Feature } from './types.js';

let seq = 0;
function exec(patch: Partial<ExecutionRecord>): ExecutionRecord {
  seq += 1;
  return {
    id: `e${seq}`,
    projectId: 'p1',
    featureId: 'f1',
    kind: 'phase',
    phase: 'specify',
    status: 'succeeded',
    startedAt: 1000 + seq,
    finishedAt: 2000 + seq,
    exitCode: 0,
    tokens: 100,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 50,
    cacheCreationTokens: 20,
    tokensSource: 'transcript',
    costMicros: null,
    subagentTokens: null,
    subagentCostMicros: null,
    model: null,
    telemetryFinalAt: null,
    transcriptOffsetStart: 0,
    transcriptOffsetEnd: null,
    transcriptPath: null,
    optContextStrategy: null,
    optCompression: null,
    logPath: null,
    ...patch,
  };
}

function feature(patch: Partial<Feature>): Feature {
  return {
    id: 'f1',
    projectId: 'p1',
    name: 'mein-feature',
    branch: 'feature/mein-feature',
    worktreePath: null,
    phases: initialPhases(['specify', 'plan', 'tasks', 'implement']),
    integration: 'none',
    integrationTarget: null,
    automation: {},
    optimization: {},
    tasksDone: 0,
    tasksTotal: 0,
    reviewRejectedAt: null,
    createdAt: 1,
    archivedAt: null,
    ...patch,
  };
}

describe('categorizeExecution', () => {
  it('ordnet Phasen, Kinds und Chat den richtigen Kategorien zu', () => {
    expect(categorizeExecution({ kind: 'phase', phase: 'specify' })).toBe('spec');
    expect(categorizeExecution({ kind: 'phase', phase: 'plan' })).toBe('spec');
    expect(categorizeExecution({ kind: 'phase', phase: 'tasks' })).toBe('spec');
    expect(categorizeExecution({ kind: 'phase', phase: 'implement' })).toBe('coding');
    expect(categorizeExecution({ kind: 'verify', phase: null })).toBe('overhead');
    expect(categorizeExecution({ kind: 'review', phase: null })).toBe('overhead');
    expect(categorizeExecution({ kind: 'conflict_resolution', phase: null })).toBe('overhead');
    expect(categorizeExecution({ kind: 'chat', phase: null })).toBe('chat');
    expect(categorizeExecution({ kind: 'chat_work', phase: null })).toBe('chat');
  });
});

describe('buildRunSummaries', () => {
  it('gruppiert Executions pro Feature zu einem Lauf mit Step- und Kategorie-Rollups', () => {
    const f = feature({});
    const execs = [
      exec({ phase: 'specify', tokens: 100 }),
      exec({ phase: 'plan', tokens: 200 }),
      exec({ phase: 'implement', tokens: 1000 }),
      exec({ kind: 'verify', phase: null, tokens: 50 }),
      exec({ kind: 'review', phase: null, tokens: 30 }),
    ];
    const [run] = buildRunSummaries([f], execs);
    expect(run).toBeDefined();
    expect(run!.featureId).toBe('f1');
    expect(run!.total.tokens).toBe(1380);
    expect(run!.total.runs).toBe(5);
    expect(run!.byCategory.spec.tokens).toBe(300);
    expect(run!.byCategory.coding.tokens).toBe(1000);
    expect(run!.byCategory.overhead.tokens).toBe(80);
    // Steps in Workflow-Reihenfolge, Overhead danach
    expect(run!.byStep.map((s) => s.key)).toEqual(['specify', 'plan', 'implement', 'verify', 'review']);
  });

  it('mehrere Läufe derselben Phase summieren in einem Step', () => {
    const [run] = buildRunSummaries(
      [feature({})],
      [exec({ phase: 'plan', tokens: 10 }), exec({ phase: 'plan', tokens: 15 })],
    );
    expect(run!.byStep).toHaveLength(1);
    expect(run!.byStep[0]!.rollup.tokens).toBe(25);
    expect(run!.byStep[0]!.rollup.runs).toBe(2);
  });

  it('Features ohne Executions erscheinen nicht; Executions ohne featureId zählen nicht', () => {
    const runs = buildRunSummaries(
      [feature({}), feature({ id: 'f2', name: 'leer' })],
      [exec({}), exec({ featureId: null })],
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.total.runs).toBe(1);
  });

  it('running-Flag, Zeitspanne und Sortierung nach letzter Aktivität', () => {
    const runs = buildRunSummaries(
      [feature({}), feature({ id: 'f2', name: 'aktiv' })],
      [
        exec({ featureId: 'f1', startedAt: 100, finishedAt: 200 }),
        exec({ featureId: 'f2', startedAt: 150, finishedAt: null, status: 'running' }),
      ],
    );
    expect(runs.map((r) => r.featureId)).toEqual(['f1', 'f2']); // f1: Aktivität 200 > f2: 150
    const f2 = runs.find((r) => r.featureId === 'f2')!;
    expect(f2.running).toBe(true);
    expect(f2.startedAt).toBe(150);
  });

  it('sourceMix spiegelt Mess-Herkunft', () => {
    const [run] = buildRunSummaries(
      [feature({})],
      [exec({ tokensSource: 'transcript' }), exec({ tokensSource: 'estimated' })],
    );
    expect(run!.sourceMix.transcript).toBeCloseTo(0.5);
    expect(run!.sourceMix.estimated).toBeCloseTo(0.5);
  });

  /**
   * Regression: der Nenner zählte nur Executions MIT tokensSource. Ein Lauf mit
   * 1 gemessenen und 10 ungemessenen Executions meldete dadurch „100 % gemessen"
   * — genau die Kombination, in der 97 % der real bezahlten Tokens unsichtbar waren.
   */
  it('rechnet ungemessene Executions in den Nenner ein (kein falsches „100 % gemessen")', () => {
    const executions = [
      exec({ tokensSource: 'transcript' }),
      ...Array.from({ length: 10 }, () => exec({ tokensSource: null })),
    ];
    const [run] = buildRunSummaries([feature({})], executions);

    expect(run!.sourceMix.transcript).toBeCloseTo(1 / 11);
    const measured = run!.sourceMix.transcript + run!.sourceMix.parsed + run!.sourceMix.estimated;
    expect(measured).toBeLessThan(0.1); // der Rest ist ungemessen
  });

  it('der ausgelieferte Payload trägt kein costUsd, aber alle Token-Angaben', () => {
    const runs = buildRunSummaries(
      [feature({})],
      [exec({ phase: 'plan', tokens: 200 }), exec({ kind: 'verify', phase: null, tokens: 50 })],
    );
    const payload = JSON.stringify(runs);

    expect(payload.includes('costUsd')).toBe(false);
    for (const key of [
      'tokens',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheCreationTokens',
      'sourceMix',
    ]) {
      expect(payload.includes(key)).toBe(true);
    }
  });

  it('weist die Telemetrie-Herkunft im Messanteil aus (FR-018)', () => {
    const runs = buildRunSummaries(
      [feature({})],
      [
        exec({ phase: 'plan', tokensSource: 'telemetry' }),
        exec({ phase: 'implement', tokensSource: 'telemetry' }),
        exec({ kind: 'verify', phase: null, tokensSource: 'estimated' }),
        exec({ kind: 'review', phase: null, tokensSource: 'transcript' }),
      ],
    );
    expect(runs[0]!.sourceMix.telemetry).toBeCloseTo(0.5, 10);
    expect(runs[0]!.sourceMix.transcript).toBeCloseTo(0.25, 10);
  });

  it('Feature-Summe enthält die Subagenten-Anteile der Einzelläufe (FR-010, US2 Szenario 4)', () => {
    const runs = buildRunSummaries(
      [feature({})],
      [
        exec({ phase: 'implement', tokens: 1000, subagentTokens: 600 }),
        exec({ phase: 'plan', tokens: 400, subagentTokens: null }),
      ],
    );
    expect(runs[0]!.total.tokens).toBe(1400);
    expect(runs[0]!.total.subagentTokens).toBe(600);
  });

  it('summiert über die Läufe hinweg nur gemeldete Beträge (FR-024)', () => {
    const runs = buildRunSummaries(
      [feature({})],
      [
        exec({ phase: 'plan', costMicros: 90_000 }),
        exec({ phase: 'implement', costMicros: null }),
      ],
    );
    expect(runs[0]!.total.costMicros).toBe(90_000);
    expect(runs[0]!.total.runsWithoutCost).toBe(1);
  });
});
