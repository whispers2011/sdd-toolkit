import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialPhases } from '@sdd/shared';
import type { LifecycleStep } from '@sdd/shared';
import { openMemoryDatabase, type DB } from './database.js';
import { LifecycleStepRepo } from './lifecycleStepRepo.js';
import { FeatureRepo, ProjectRepo } from './repos.js';

describe('LifecycleStepRepo', () => {
  let db: DB;
  let repo: LifecycleStepRepo;
  let features: FeatureRepo;
  let projectId: string;
  let otherProjectId: string;

  const makeProject = (name: string, path: string) =>
    new ProjectRepo(db).create({
      name,
      path,
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;

  const makeFeature = (name: string, pid = projectId) =>
    features.create({
      projectId: pid,
      name,
      branch: `feature/${name}`,
      worktreePath: `/tmp/wt/${name}`,
      phases: initialPhases([]),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;

  const input = (over: Partial<LifecycleStep> = {}): Omit<LifecycleStep, 'id'> & { id?: string } => ({
    projectId: over.projectId !== undefined ? over.projectId : null,
    name: over.name ?? 'Schritt',
    command: over.command ?? 'true',
    trigger: over.trigger ?? { kind: 'after_worktree_create' },
    blocking: over.blocking ?? true,
    timeoutMs: over.timeoutMs ?? null,
    enabled: over.enabled ?? true,
    sortOrder: over.sortOrder ?? 0,
    ...(over.id ? { id: over.id } : {}),
  });

  beforeEach(() => {
    db = openMemoryDatabase();
    repo = new LifecycleStepRepo(db);
    features = new FeatureRepo(db);
    projectId = makeProject('Demo', '/tmp/demo');
    otherProjectId = makeProject('Anders', '/tmp/anders');
  });

  afterEach(() => db.close());

  it('forProject liefert globale UND projektspezifische Schritte (Union)', () => {
    repo.upsert(input({ name: 'Global', projectId: null }));
    repo.upsert(input({ name: 'Projekt', projectId }));
    repo.upsert(input({ name: 'Fremd', projectId: otherProjectId }));

    expect(repo.forProject(projectId).map((s) => s.name)).toEqual(['Global', 'Projekt']);
    expect(repo.forProject(otherProjectId).map((s) => s.name)).toEqual(['Global', 'Fremd']);
  });

  it('sortiert global vor Projekt, dann nach Position, dann nach Name', () => {
    repo.upsert(input({ name: 'G spät', projectId: null, sortOrder: 99 }));
    repo.upsert(input({ name: 'G früh', projectId: null, sortOrder: 0 }));
    repo.upsert(input({ name: 'P Anton', projectId, sortOrder: 0 }));
    repo.upsert(input({ name: 'P Zebra', projectId, sortOrder: 0 }));

    // Der globale Schritt mit Position 99 steht trotzdem vor jedem Projekt-Schritt.
    expect(repo.forProject(projectId).map((s) => s.name)).toEqual([
      'G früh',
      'G spät',
      'P Anton',
      'P Zebra',
    ]);
  });

  it('normalisiert nicht zutreffende Trigger-Felder auf NULL', () => {
    // Phase an einer Art, die keine kennt.
    const a = repo.upsert(
      input({ name: 'A', trigger: { kind: 'after_worktree_create', phase: 'implement' } }),
    );
    expect(a.trigger).toEqual({ kind: 'after_worktree_create' });

    // Stufe an einer Phasen-Art.
    const b = repo.upsert(
      input({ name: 'B', trigger: { kind: 'before_phase', phase: 'plan', stage: 'verify' } }),
    );
    expect(b.trigger).toEqual({ kind: 'before_phase', phase: 'plan' });

    // Phase an einer Stufen-Art.
    const c = repo.upsert(
      input({ name: 'C', trigger: { kind: 'after_stage', stage: 'merged', phase: 'plan' } }),
    );
    expect(c.trigger).toEqual({ kind: 'after_stage', stage: 'merged' });

    const raw = db
      .prepare('SELECT trigger_phase, trigger_stage FROM lifecycle_steps WHERE id=?')
      .get(a.id) as { trigger_phase: string | null; trigger_stage: string | null };
    expect(raw.trigger_phase).toBeNull();
    expect(raw.trigger_stage).toBeNull();
  });

  it('upsert aktualisiert bei gleichem id statt anzulegen', () => {
    const created = repo.upsert(input({ name: 'Erst', command: 'true' }));
    const updated = repo.upsert(
      input({ id: created.id, name: 'Danach', command: 'false', blocking: false, timeoutMs: 60_000 }),
    );

    expect(updated.id).toBe(created.id);
    expect(repo.list()).toHaveLength(1);
    expect(updated.name).toBe('Danach');
    expect(updated.blocking).toBe(false);
    expect(updated.timeoutMs).toBe(60_000);
  });

  it('löschen ist idempotent — ein unbekanntes id ist kein Fehler', () => {
    const s = repo.upsert(input());
    repo.remove(s.id);
    expect(repo.get(s.id)).toBeNull();
    expect(() => repo.remove(s.id)).not.toThrow();
    expect(() => repo.remove('gibtsnicht')).not.toThrow();
  });

  // ----- Per-Feature-Auswahl (US4) -----

  it('setzt, überschreibt und entfernt eine Feature-Entscheidung', () => {
    const step = repo.upsert(input({ projectId }));
    const featureId = makeFeature('demo-eins');

    expect(repo.selectionFor(featureId).size).toBe(0);

    repo.setDecision(featureId, step.id, 'exclude');
    expect(repo.selectionFor(featureId).get(step.id)).toBe('exclude');

    repo.setDecision(featureId, step.id, 'include');
    expect(repo.selectionFor(featureId).get(step.id)).toBe('include');

    // 'auto' löscht die Zeile — die Ebene darüber gilt wieder.
    repo.setDecision(featureId, step.id, 'auto');
    expect(repo.selectionFor(featureId).has(step.id)).toBe(false);
  });

  it('hält die Auswahl zweier Features auseinander', () => {
    const step = repo.upsert(input({ projectId }));
    const eins = makeFeature('demo-eins');
    const zwei = makeFeature('demo-zwei');

    repo.setDecision(eins, step.id, 'exclude');
    expect(repo.selectionFor(eins).get(step.id)).toBe('exclude');
    expect(repo.selectionFor(zwei).size).toBe(0);
  });

  it('ON DELETE CASCADE räumt Auswahlzeilen beim Löschen des Schritts ab', () => {
    const step = repo.upsert(input({ projectId }));
    const featureId = makeFeature('demo-eins');
    repo.setDecision(featureId, step.id, 'include');

    repo.remove(step.id);
    expect(repo.selectionFor(featureId).size).toBe(0);
  });

  it('ON DELETE CASCADE räumt Auswahlzeilen beim Löschen des Features ab', () => {
    const step = repo.upsert(input({ projectId }));
    const featureId = makeFeature('demo-eins');
    repo.setDecision(featureId, step.id, 'include');

    features.hardDelete(featureId);
    expect(
      db.prepare('SELECT COUNT(*) AS c FROM lifecycle_step_feature_selection').get() as { c: number },
    ).toEqual({ c: 0 });
  });

  it('ON DELETE CASCADE räumt Schritte beim Löschen des Projekts ab', () => {
    repo.upsert(input({ projectId }));
    repo.upsert(input({ projectId: null }));

    db.prepare('DELETE FROM projects WHERE id=?').run(projectId);
    expect(repo.list().map((s) => s.projectId)).toEqual([null]);
  });
});
