import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialPhases } from '@sdd/shared';
import type { Feature, Project } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { AgentRepo, AgentRunRepo } from '../db/agentRepo.js';
import { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo } from '../db/repos.js';
import { AgentGateService, type HeadlessRunner } from './agentGateService.js';

/**
 * Fake-Runner: statt Claude zu spawnen wird der konfigurierte Bericht in die
 * {reviewFile}-Konvention geschrieben. `calls` protokolliert argv für Asserts.
 */
function fakeRunner(reports: Record<string, string | null>, calls: string[][]): HeadlessRunner {
  return async (argv, cwd) => {
    calls.push(argv);
    const prompt = argv[2]!; // ['claude', '-p', prompt, ...]
    const m = prompt.match(/specs\/[^\s]+\/reviews\/([a-z0-9-]+)\.md/i);
    const agentId = m?.[1] ?? 'unknown';
    const report = reports[agentId];
    if (report != null) {
      const file = join(cwd, m![0]!);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, report);
    }
    return 0;
  };
}

describe('AgentGateService', () => {
  let db: DB;
  let dataDir: string;
  let worktree: string;
  let agents: AgentRepo;
  let agentRuns: AgentRunRepo;
  let attention: AttentionRepo;
  let executions: ExecutionRepo;
  let feature: Feature;
  let project: Project;

  beforeEach(() => {
    db = openMemoryDatabase();
    dataDir = mkdtempSync(join(tmpdir(), 'agent-gate-'));
    mkdirSync(join(dataDir, 'logs'), { recursive: true });
    worktree = mkdtempSync(join(tmpdir(), 'agent-gate-wt-'));
    execFileSync('git', ['init', '-q'], { cwd: worktree });

    agents = new AgentRepo(db);
    agentRuns = new AgentRunRepo(db);
    attention = new AttentionRepo(db);
    executions = new ExecutionRepo(db);

    project = new ProjectRepo(db).create({
      name: 'Demo',
      path: '/tmp/demo-project',
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    });
    feature = new FeatureRepo(db).create({
      projectId: project.id,
      name: 'demo-feature',
      branch: 'feature/demo',
      worktreePath: worktree,
      phases: initialPhases([]),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    // Nur eigene Test-Agents verwenden — Seeds abschalten.
    for (const a of agents.list()) agents.upsert({ ...a, enabled: false });
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  });

  function service(reports: Record<string, string | null>, calls: string[][] = []): AgentGateService {
    return new AgentGateService({
      agents,
      agentRuns,
      executions,
      attention,
      dataDir,
      runner: fakeRunner(reports, calls),
    });
  }

  function addAgent(id: string, overrides: Partial<Parameters<AgentRepo['upsert']>[0]> = {}): void {
    agents.upsert({
      id,
      projectId: null,
      name: id,
      description: '',
      prompt: `Prüfe und schreibe nach {reviewFile}.`,
      model: null,
      trigger: { kind: 'review_gate' },
      blocking: true,
      enabled: true,
      sortOrder: 0,
      ...overrides,
    });
  }

  it('läuft in sort_order-Reihenfolge; erster blockierender FAIL stoppt das Gate', async () => {
    addAgent('erster', { sortOrder: 0 });
    addAgent('zweiter', { sortOrder: 1 });
    addAgent('dritter', { sortOrder: 2 });
    const calls: string[][] = [];
    const gate = service(
      {
        erster: 'ok\nVERDICT: PASS',
        zweiter: 'kaputt\nVERDICT: FAIL',
        dritter: 'nie erreicht\nVERDICT: PASS',
      },
      calls,
    );
    const outcome = await gate.runTrigger(feature, project, { kind: 'review_gate' });
    expect(outcome.ok).toBe(false);
    expect(outcome.failedAgent).toBe('zweiter');
    expect(outcome.runs.map((r) => [r.agentId, r.verdict])).toEqual([
      ['erster', 'PASS'],
      ['zweiter', 'FAIL'],
    ]);
    expect(calls).toHaveLength(2); // dritter lief nicht
    // Strukturiert verbucht:
    const persisted = agentRuns.listForFeature(feature.id);
    expect(persisted).toHaveLength(2);
    expect(persisted.every((r) => r.executionId)).toBe(true);
  });

  it('advisory-FAIL wird nur verbucht und stoppt nichts', async () => {
    addAgent('hinweis', { blocking: false, sortOrder: 0 });
    addAgent('gate', { sortOrder: 1 });
    const gate = service({
      hinweis: 'Doku-Verstoß\nVERDICT: FAIL',
      gate: 'ok\nVERDICT: PASS',
    });
    const outcome = await gate.runTrigger(feature, project, { kind: 'review_gate' });
    expect(outcome.ok).toBe(true);
    expect(outcome.failedAgent).toBeNull();
    expect(outcome.runs.map((r) => r.verdict)).toEqual(['FAIL', 'PASS']);
  });

  it('konfiguriertes Modell landet im argv', async () => {
    addAgent('mit-modell', { model: 'opus' });
    const calls: string[][] = [];
    await service({ 'mit-modell': 'VERDICT: PASS' }, calls).runTrigger(feature, project, {
      kind: 'review_gate',
    });
    expect(calls[0]).toContain('--model');
    expect(calls[0]![calls[0]!.indexOf('--model') + 1]).toBe('opus');
  });

  it('Bericht ohne auswertbares Urteil wird NIE als bestanden gewertet', async () => {
    addAgent('stumm');
    const gate = service({ stumm: 'Bericht ohne Urteilszeile.' });
    const outcome = await gate.runTrigger(feature, project, { kind: 'review_gate' });
    expect(outcome.ok).toBe(false);
    expect(outcome.runs[0]!.verdict).toBeNull();
  });

  it('Worktree-Guard: fehlender Worktree wirft statt FAIL zu verbuchen', async () => {
    addAgent('egal');
    const gone = { ...feature, worktreePath: join(worktree, 'gibt-es-nicht') };
    await expect(service({}).runTrigger(gone, project, { kind: 'review_gate' })).rejects.toThrow(/Worktree/);
    expect(agentRuns.listForFeature(feature.id)).toHaveLength(0);
  });

  it('Phasen-Trigger matcht nur die konfigurierte Phase; exclude-Selektion greift', async () => {
    addAgent('plan-gate', { trigger: { kind: 'after_phase', phase: 'plan' } });
    const gate = service({ 'plan-gate': 'VERDICT: PASS' });
    expect(gate.hasAgentsFor(project.id, feature.id, { kind: 'after_phase', phase: 'plan' })).toBe(true);
    expect(gate.hasAgentsFor(project.id, feature.id, { kind: 'after_phase', phase: 'tasks' })).toBe(false);

    agents.setSelection(feature.id, 'plan-gate', 'exclude');
    expect(gate.hasAgentsFor(project.id, feature.id, { kind: 'after_phase', phase: 'plan' })).toBe(false);
  });

  it('FREIGABE ERFORDERLICH erzeugt approval_required-Attention (auch bei PASS)', async () => {
    addAgent('plan-quality');
    const gate = service({
      'plan-quality': [
        'GESAMTENTSCHEIDUNG: FREIGEGEBEN MIT ÄNDERUNGEN',
        'FREIGABE ERFORDERLICH: Repository-Pattern für DataStore',
        'ZUSAMMENFASSUNG: Plan solide, ein Pattern-Entscheid offen.',
        'VERDICT: PASS',
      ].join('\n'),
    });
    const outcome = await gate.runTrigger(feature, project, { kind: 'review_gate' });
    expect(outcome.ok).toBe(true);
    const open = attention.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]!.kind).toBe('approval_required');
    expect(open[0]!.message).toContain('Repository-Pattern');
    // Strukturierte Felder:
    const run = agentRuns.listForFeature(feature.id)[0]!;
    expect(run.decisionLabel).toBe('FREIGEGEBEN MIT ÄNDERUNGEN');
    expect(run.summary).toContain('Plan solide');
  });

  it('manueller Einzellauf funktioniert auch für deaktivierte Agents', async () => {
    addAgent('manuell', { enabled: false });
    const run = await service({ manuell: 'VERDICT: PASS' }).runAgent('manuell', feature, project);
    expect(run.verdict).toBe('PASS');
    expect(run.trigger).toEqual({ kind: 'manual' });
    expect(agentRuns.listForFeature(feature.id)).toHaveLength(1);
  });
});
