import { describe, expect, it } from 'vitest';
import {
  extractSummary,
  hasExplicitVerdict,
  parseApprovalItems,
  parseDecisionLabel,
  parseVerdict,
  resolveAgentsForTrigger,
} from './agentSelect.js';
import type { AgentDefinition, AgentFeatureDecision } from './types.js';

function agent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: 'a1',
    projectId: null,
    name: 'Agent',
    description: '',
    prompt: 'p',
    model: null,
    trigger: { kind: 'review_gate' },
    blocking: true,
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

const noSelection = new Map<string, AgentFeatureDecision>();

describe('resolveAgentsForTrigger', () => {
  it('matcht nur den passenden Trigger (kind + phase)', () => {
    const agents = [
      agent({ id: 'gate', trigger: { kind: 'review_gate' } }),
      agent({ id: 'plan', trigger: { kind: 'after_phase', phase: 'plan' } }),
      agent({ id: 'impl', trigger: { kind: 'before_phase', phase: 'implement' } }),
      agent({ id: 'manual', trigger: { kind: 'manual' } }),
    ];
    expect(resolveAgentsForTrigger(agents, noSelection, { kind: 'review_gate' }).map((a) => a.id)).toEqual(['gate']);
    expect(
      resolveAgentsForTrigger(agents, noSelection, { kind: 'after_phase', phase: 'plan' }).map((a) => a.id),
    ).toEqual(['plan']);
    expect(
      resolveAgentsForTrigger(agents, noSelection, { kind: 'after_phase', phase: 'tasks' }),
    ).toEqual([]);
    expect(
      resolveAgentsForTrigger(agents, noSelection, { kind: 'before_phase', phase: 'implement' }).map((a) => a.id),
    ).toEqual(['impl']);
  });

  it('sortiert nach sortOrder', () => {
    const agents = [
      agent({ id: 'b', sortOrder: 2 }),
      agent({ id: 'a', sortOrder: 1 }),
    ];
    expect(resolveAgentsForTrigger(agents, noSelection, { kind: 'review_gate' }).map((a) => a.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('exclude schlägt alles, include erzwingt disabled Agents', () => {
    const agents = [
      agent({ id: 'on' }),
      agent({ id: 'off', enabled: false }),
      agent({ id: 'kicked' }),
    ];
    const selection = new Map<string, AgentFeatureDecision>([
      ['off', 'include'],
      ['kicked', 'exclude'],
    ]);
    expect(resolveAgentsForTrigger(agents, selection, { kind: 'review_gate' }).map((a) => a.id)).toEqual([
      'on',
      'off',
    ]);
  });

  it('disabled ohne Override läuft nicht', () => {
    const agents = [agent({ id: 'off', enabled: false })];
    expect(resolveAgentsForTrigger(agents, noSelection, { kind: 'review_gate' })).toEqual([]);
  });
});

describe('parseVerdict / hasExplicitVerdict', () => {
  it('liest VERDICT aus dem Bericht (case-insensitive)', () => {
    expect(parseVerdict('...\nVERDICT: PASS', 1)).toBe('PASS');
    expect(parseVerdict('verdict: fail', 0)).toBe('FAIL');
  });

  it('fällt ohne Bericht auf den Exit-Code zurück', () => {
    expect(parseVerdict(null, 0)).toBe('PASS');
    expect(parseVerdict(null, 2)).toBe('FAIL');
    expect(parseVerdict('kein urteil', 0)).toBe('PASS');
  });

  it('hasExplicitVerdict unterscheidet echtes Urteil von Fallback', () => {
    expect(hasExplicitVerdict('VERDICT: PASS')).toBe(true);
    expect(hasExplicitVerdict('nur text')).toBe(false);
    expect(hasExplicitVerdict(null)).toBe(false);
  });
});

describe('parseDecisionLabel', () => {
  it('liest die GESAMTENTSCHEIDUNG-Zeile', () => {
    expect(parseDecisionLabel('# Bericht\nGESAMTENTSCHEIDUNG: FREIGEGEBEN MIT ÄNDERUNGEN\n')).toBe(
      'FREIGEGEBEN MIT ÄNDERUNGEN',
    );
    expect(parseDecisionLabel('ohne label')).toBeNull();
    expect(parseDecisionLabel(null)).toBeNull();
  });
});

describe('extractSummary', () => {
  it('bevorzugt die ZUSAMMENFASSUNG-Zeile', () => {
    expect(extractSummary('# T\n\nAbsatz eins.\n\nZUSAMMENFASSUNG: Kurz und gut.')).toBe('Kurz und gut.');
  });

  it('nimmt sonst den ersten inhaltlichen Absatz ohne Überschriften', () => {
    expect(extractSummary('# Überschrift\n\nErster Absatz.\nZweite Zeile.\n\nNoch was.')).toBe(
      'Erster Absatz. Zweite Zeile.',
    );
  });

  it('kappt auf 300 Zeichen', () => {
    const long = 'x'.repeat(400);
    const summary = extractSummary(long)!;
    expect(summary.length).toBeLessThanOrEqual(300);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('null bei leerem Bericht', () => {
    expect(extractSummary(null)).toBeNull();
    expect(extractSummary('')).toBeNull();
  });
});

describe('parseApprovalItems', () => {
  it('sammelt alle FREIGABE ERFORDERLICH-Zeilen (auch als Listenpunkte)', () => {
    const report = [
      'GESAMTENTSCHEIDUNG: FREIGEGEBEN MIT ÄNDERUNGEN',
      'FREIGABE ERFORDERLICH: Repository-Pattern für DataStore',
      '- FREIGABE ERFORDERLICH: Wechsel auf Event-Bus',
      'VERDICT: PASS',
    ].join('\n');
    expect(parseApprovalItems(report)).toEqual([
      'Repository-Pattern für DataStore',
      'Wechsel auf Event-Bus',
    ]);
  });

  it('leer ohne Marker', () => {
    expect(parseApprovalItems('VERDICT: PASS')).toEqual([]);
    expect(parseApprovalItems(null)).toEqual([]);
  });
});
