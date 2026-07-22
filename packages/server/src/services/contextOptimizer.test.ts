import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPTIMIZATION_OFF_DEFAULTS } from '@sdd/shared';
import { llmResultIsWorthKeeping, prepareForPhase } from './contextOptimizer.js';

function featureRoot(withSpec: boolean): { root: string; name: string } {
  const root = mkdtempSync(join(tmpdir(), 'ctxopt-'));
  const name = 'demo-feature';
  if (withSpec) {
    mkdirSync(join(root, 'specs', name), { recursive: true });
    writeFileSync(join(root, 'specs', name, 'spec.md'), '# Spec\n');
  }
  return { root, name };
}

describe('prepareForPhase', () => {
  it('full → kein Reset', () => {
    const { root, name } = featureRoot(true);
    const plan = prepareForPhase({ phase: 'plan', worktreeRoot: root, featureName: name, opt: OPTIMIZATION_OFF_DEFAULTS, rawPreamble: '' });
    expect(plan.reset).toBeNull();
    expect(plan.fellBackToFull).toBe(false);
  });

  it('erste Phase (specify) → nie Reset, auch bei fresh', () => {
    const { root, name } = featureRoot(true);
    const plan = prepareForPhase({ phase: 'specify', worktreeRoot: root, featureName: name, opt: { contextStrategy: 'fresh', compression: 'off' }, rawPreamble: '' });
    expect(plan.reset).toBeNull();
  });

  it('compact/fresh downstream mit vorhandenem spec.md → korrektes Reset-Kommando', () => {
    const { root, name } = featureRoot(true);
    expect(prepareForPhase({ phase: 'plan', worktreeRoot: root, featureName: name, opt: { contextStrategy: 'compact', compression: 'off' }, rawPreamble: '' }).reset).toBe('compact');
    expect(prepareForPhase({ phase: 'implement', worktreeRoot: root, featureName: name, opt: { contextStrategy: 'fresh', compression: 'off' }, rawPreamble: '' }).reset).toBe('fresh');
  });

  it('Guard: fehlendes spec.md → fellBackToFull, kein Reset (FR-010)', () => {
    const { root, name } = featureRoot(false);
    const plan = prepareForPhase({ phase: 'plan', worktreeRoot: root, featureName: name, opt: { contextStrategy: 'fresh', compression: 'off' }, rawPreamble: '' });
    expect(plan.reset).toBeNull();
    expect(plan.fellBackToFull).toBe(true);
  });

  it('deterministische Verdichtung verkleinert die Präambel und liefert einen Report', () => {
    const { root, name } = featureRoot(true);
    const bloat = 'Zeile\n' + '\n'.repeat(20) + 'Zeile\nZeile\nZeile\n';
    const plan = prepareForPhase({ phase: 'plan', worktreeRoot: root, featureName: name, opt: { contextStrategy: 'full', compression: 'deterministic' }, rawPreamble: bloat });
    expect(plan.report).toBeDefined();
    expect(plan.report!.tokensAfter).toBeLessThan(plan.report!.tokensBefore);
    expect(plan.preamble.length).toBeLessThan(bloat.length);
  });

  it('llmResultIsWorthKeeping: nur bei echter Netto-Ersparnis', () => {
    expect(llmResultIsWorthKeeping(1000, 400, 100)).toBe(true); // 600 gespart > 100 Kosten
    expect(llmResultIsWorthKeeping(1000, 950, 100)).toBe(false); // 50 gespart < 100 Kosten
  });
});
