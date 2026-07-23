import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type DB } from './database.js';
import { AgentRepo, AgentRunRepo } from './agentRepo.js';
import { FeatureRepo, ProjectRepo, QueueRepo, ReviewCommentRepo } from './repos.js';
import type { AgentDefinition } from '@sdd/shared';
import { initialPhases } from '@sdd/shared';

function makeAgent(overrides: Partial<AgentDefinition> = {}): Omit<AgentDefinition, 'id'> & { id?: string } {
  return {
    projectId: null,
    name: 'Test-Agent',
    description: '',
    prompt: 'Prüfe. {reviewFile}',
    model: null,
    trigger: { kind: 'review_gate' },
    blocking: true,
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

describe('AgentRepo', () => {
  let db: DB;
  let agents: AgentRepo;
  let projectId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    agents = new AgentRepo(db);
    projectId = new ProjectRepo(db).create({
      name: 'Demo',
      path: '/tmp/demo',
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;
  });

  afterEach(() => db.close());

  it('Migration: Alt-Personas als blockierende review_gate-Agents + 3 neue Seeds', () => {
    const all = agents.list();
    const ids = all.map((a) => a.id);
    for (const id of ['default-code-review', 'default-security-review']) {
      const a = all.find((x) => x.id === id)!;
      expect(a.trigger).toEqual({ kind: 'review_gate' });
      expect(a.blocking).toBe(true);
      expect(a.enabled).toBe(true);
    }
    expect(ids).toContain('default-dor-gate');
    expect(ids).toContain('default-plan-quality');
    expect(ids).toContain('default-doku-policy');
    expect(agents.get('default-dor-gate')!.trigger).toEqual({ kind: 'before_phase', phase: 'implement' });
    expect(agents.get('default-plan-quality')!.trigger).toEqual({ kind: 'after_phase', phase: 'plan' });
    const doku = agents.get('default-doku-policy')!;
    expect(doku.trigger).toEqual({ kind: 'review_gate' });
    expect(doku.blocking).toBe(false); // advisory
    expect(doku.sortOrder).toBe(2);
  });

  it('forProject = Union aus globalen UND projektspezifischen Agents', () => {
    agents.upsert(makeAgent({ id: 'proj-1', projectId, name: 'Projekt-Agent' }));
    const result = agents.forProject(projectId);
    const ids = result.map((a) => a.id);
    expect(ids).toContain('proj-1');
    expect(ids).toContain('default-code-review'); // global bleibt sichtbar (kein Fallback!)
  });

  it('upsert rundreist Trigger, Modell und blocking; remove löscht', () => {
    const saved = agents.upsert(
      makeAgent({
        id: 'plan-gate',
        trigger: { kind: 'after_phase', phase: 'plan' },
        model: 'opus',
        blocking: false,
      }),
    );
    expect(saved.trigger).toEqual({ kind: 'after_phase', phase: 'plan' });
    expect(saved.model).toBe('opus');
    expect(saved.blocking).toBe(false);

    agents.upsert({ ...saved, name: 'Umbenannt' });
    expect(agents.get('plan-gate')?.name).toBe('Umbenannt');

    agents.remove('plan-gate');
    expect(agents.get('plan-gate')).toBeNull();
  });

  it('Per-Feature-Selektion: set/list/clear', () => {
    const features = new FeatureRepo(db);
    const f = features.create({
      projectId,
      name: 'demo-feature',
      branch: 'feature/demo',
      worktreePath: null,
      phases: initialPhases([]),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    agents.setSelection(f.id, 'default-code-review', 'exclude');
    expect(agents.listSelection(f.id).get('default-code-review')).toBe('exclude');
    agents.setSelection(f.id, 'default-code-review', 'include');
    expect(agents.listSelection(f.id).get('default-code-review')).toBe('include');
    agents.clearSelection(f.id, 'default-code-review');
    expect(agents.listSelection(f.id).size).toBe(0);
  });
});

describe('AgentRunRepo', () => {
  let db: DB;
  let agents: AgentRepo;
  let runs: AgentRunRepo;
  let featureId: string;
  let projectId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    agents = new AgentRepo(db);
    runs = new AgentRunRepo(db);
    projectId = new ProjectRepo(db).create({
      name: 'Demo',
      path: '/tmp/demo2',
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;
    featureId = new FeatureRepo(db).create({
      projectId,
      name: 'demo-feature',
      branch: 'feature/demo',
      worktreePath: null,
      phases: initialPhases([]),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;
  });

  afterEach(() => db.close());

  it('start/finish rundreist Verdict, Label, Summary und Bericht', () => {
    const agent = agents.get('default-code-review')!;
    const id = runs.start({
      agent,
      projectId,
      featureId,
      executionId: 'exec-1',
      trigger: { kind: 'review_gate' },
    });
    runs.finish(id, {
      verdict: 'FAIL',
      decisionLabel: 'PLAN ÜBERARBEITEN',
      summary: 'Zwei offene Fragen.',
      reportPath: 'specs/demo-feature/reviews/default-code-review.md',
    });
    const [run] = runs.listForFeature(featureId);
    expect(run).toMatchObject({
      agentId: 'default-code-review',
      agentName: agent.name,
      executionId: 'exec-1',
      verdict: 'FAIL',
      decisionLabel: 'PLAN ÜBERARBEITEN',
      summary: 'Zwei offene Fragen.',
      blocking: true,
    });
    expect(run!.finishedAt).not.toBeNull();
  });

  it('verdict NULL bleibt unklar (nie PASS); Agent-Löschung lässt den Lauf lesbar', () => {
    const agent = agents.get('default-code-review')!;
    const id = runs.start({ agent, projectId, featureId, executionId: null, trigger: { kind: 'manual' } });
    runs.finish(id, { verdict: null });
    agents.remove('default-code-review');
    const [run] = runs.listForFeature(featureId);
    expect(run!.verdict).toBeNull();
    expect(run!.agentId).toBeNull(); // ON DELETE SET NULL
    expect(run!.agentName).toBe(agent.name); // Snapshot
  });

  it('latestPerAgent liefert den jüngsten Lauf je Agent', () => {
    const agent = agents.get('default-security-review')!;
    const first = runs.start({ agent, projectId, featureId, executionId: null, trigger: { kind: 'review_gate' } });
    runs.finish(first, { verdict: 'FAIL' });
    db.prepare('UPDATE agent_runs SET created_at = created_at - 1000 WHERE id=?').run(first);
    const second = runs.start({ agent, projectId, featureId, executionId: null, trigger: { kind: 'review_gate' } });
    runs.finish(second, { verdict: 'PASS' });
    expect(runs.latestPerAgent(featureId).get(agent.id)?.verdict).toBe('PASS');
  });
});

describe('ReviewCommentRepo + Queue/Feature-Erweiterungen', () => {
  let db: DB;
  let featureId: string;
  let projectId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    projectId = new ProjectRepo(db).create({
      name: 'Demo',
      path: '/tmp/demo3',
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;
    featureId = new FeatureRepo(db).create({
      projectId,
      name: 'demo-feature',
      branch: 'feature/demo',
      worktreePath: null,
      phases: initialPhases([]),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;
  });

  afterEach(() => db.close());

  it('Kommentare: create/list/resolve/delete + countOpen', () => {
    const comments = new ReviewCommentRepo(db);
    const c1 = comments.create({ featureId, filePath: 'src/x.ts', line: 12, side: 'new', text: 'Null-Check' });
    comments.create({ featureId, text: 'Allgemein' });
    expect(comments.listForFeature(featureId)).toHaveLength(2);
    expect(comments.countOpen(featureId)).toBe(2);

    const resolved = comments.update(c1.id, { status: 'resolved' });
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(comments.countOpen(featureId)).toBe(1);

    const reopened = comments.update(c1.id, { status: 'open', text: 'Doch offen' });
    expect(reopened?.resolvedAt).toBeNull();
    expect(reopened?.text).toBe('Doch offen');

    comments.remove(c1.id);
    expect(comments.listForFeature(featureId)).toHaveLength(1);
  });

  it('Anker-Invarianten: line nur mit filePath, side nur mit line', () => {
    const comments = new ReviewCommentRepo(db);
    const noFile = comments.create({ featureId, line: 5, side: 'old', text: 'x' });
    expect(noFile.line).toBeNull();
    expect(noFile.side).toBeNull();
    const noLine = comments.create({ featureId, filePath: 'a.ts', side: 'old', text: 'x' });
    expect(noLine.side).toBeNull();
  });

  it('Queue: forceVerify wird persistiert; Feature: integrationTarget setzbar', () => {
    const queue = new QueueRepo(db);
    const features = new FeatureRepo(db);
    const item = queue.enqueue(projectId, featureId, { forceVerify: true });
    expect(item.forceVerify).toBe(true);
    expect(queue.head(projectId)?.forceVerify).toBe(true);

    features.setIntegrationTarget(featureId, 'integration/foo');
    expect(features.get(featureId)?.integrationTarget).toBe('integration/foo');
    features.setIntegrationTarget(featureId, null);
    expect(features.get(featureId)?.integrationTarget).toBeNull();
  });
});
