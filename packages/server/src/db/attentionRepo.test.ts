import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type DB } from './database.js';
import { AttentionRepo, ProjectRepo } from './repos.js';

describe('AttentionRepo — Dedup & Auflösung', () => {
  let db: DB;
  let attention: AttentionRepo;
  let projectId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    attention = new AttentionRepo(db);
    projectId = new ProjectRepo(db).create({
      name: 'Demo',
      path: '/tmp/demo',
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;
  });

  afterEach(() => db.close());

  it('zieht den Text einer bestehenden Meldung nach, statt ihn zu verschlucken', () => {
    const first = attention.raise({
      kind: 'awaiting_input',
      projectId,
      sessionId: 's1',
      message: 'Feature: fragt „Framework A oder B?"',
    });
    const second = attention.raise({
      kind: 'awaiting_input',
      projectId,
      sessionId: 's1',
      message: 'Feature: Plan-Freigabe nötig — „Migration in drei Schritten"',
    });

    expect(second.id).toBe(first.id); // weiterhin EINE Meldung
    expect(second.message).toBe('Feature: Plan-Freigabe nötig — „Migration in drei Schritten"');
    expect(attention.listOpen()).toHaveLength(1);
    expect(attention.listOpen()[0]!.message).toBe(second.message);
  });

  it('dedupKey trennt gleichartige Meldungen unterschiedlicher Quellen', () => {
    attention.raise({
      kind: 'approval_required',
      projectId,
      featureId: 'f1',
      dedupKey: 'approval:Code-Review',
      message: 'f1: Freigabe erforderlich (Code-Review)',
    });
    attention.raise({
      kind: 'approval_required',
      projectId,
      featureId: 'f1',
      dedupKey: 'approval:Security-Review',
      message: 'f1: Freigabe erforderlich (Security-Review)',
    });

    expect(attention.listOpen()).toHaveLength(2);
  });

  it('resolveFor liefert genau die aufgelösten IDs (Grundlage der UI-Events)', () => {
    const question = attention.raise({
      kind: 'awaiting_input',
      projectId,
      sessionId: 's1',
      message: 'Frage',
    });
    const error = attention.raise({
      kind: 'agent_errored',
      projectId,
      sessionId: 's1',
      message: 'Fehler',
    });

    const ids = attention.resolveFor({ sessionId: 's1', kinds: ['awaiting_input'] });

    expect(ids).toEqual([question.id]);
    expect(attention.listOpen().map((a) => a.id)).toEqual([error.id]);
    expect(attention.resolveFor({ sessionId: 's1', kinds: ['awaiting_input'] })).toEqual([]);
  });
});
