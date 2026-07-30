import { describe, expect, it, beforeEach } from 'vitest';
import { EMPTY_STACK_CONFIG, initialPhases } from '@sdd/shared';
import { openMemoryDatabase, type DB } from './database.js';
import { StackRepo } from './stackRepo.js';
import { FeatureRepo, ProjectRepo } from './repos.js';

let db: DB;
let stacks: StackRepo;
let features: FeatureRepo;
let projectId: string;
let otherProjectId: string;

function makeProject(name: string, path: string): string {
  return new ProjectRepo(db).create({
    name,
    path,
    defaultBranch: 'main',
    color: null,
    enabledPhases: ['specify', 'implement'],
    verifyCommands: [],
    automation: {},
    optimization: {},
    mergeMode: 'ff',
    editorCmd: null,
    integrationMode: 'local',
    stack: EMPTY_STACK_CONFIG,
  }).id;
}

function makeFeature(pid: string, name: string): string {
  return features.create({
    projectId: pid,
    name,
    branch: `feature/${name}`,
    worktreePath: null,
    phases: initialPhases(['specify', 'implement']),
    integration: 'none',
    integrationTarget: null,
    automation: {},
    optimization: {},
    tasksDone: 0,
    tasksTotal: 0,
  }).id;
}

beforeEach(() => {
  db = openMemoryDatabase();
  stacks = new StackRepo(db);
  features = new FeatureRepo(db);
  projectId = makeProject('Projekt A', '/repo/a');
  otherProjectId = makeProject('Projekt B', '/repo/b');
});

describe('StackRepo: Absicht (nicht Zustand)', () => {
  it('kennt ohne Eintrag keine Absicht', () => {
    expect(stacks.getIntent(makeFeature(projectId, 'a'))).toBeNull();
  });

  it('hält fest, welches Profil betrieben werden soll', () => {
    const f = makeFeature(projectId, 'a');
    stacks.setIntent(f, 'test', 1000);
    expect(stacks.getIntent(f)).toEqual({ featureId: f, profile: 'test', since: 1000 });
  });

  /** Der Wechsel test → full ist eine Obermenge, kein zweiter Eintrag. */
  it('hebt die Absicht von test auf full, statt zwei Zeilen zu führen', () => {
    const f = makeFeature(projectId, 'a');
    stacks.setIntent(f, 'test', 1000);
    stacks.setIntent(f, 'full', 2000);
    expect(stacks.getIntent(f)).toEqual({ featureId: f, profile: 'full', since: 2000 });
  });

  it('löscht die Absicht beim Abbau', () => {
    const f = makeFeature(projectId, 'a');
    stacks.setIntent(f, 'full', 1000);
    stacks.clearIntent(f);
    expect(stacks.getIntent(f)).toBeNull();
  });

  it('räumt die Absicht mit dem Feature ab (FK-Cascade)', () => {
    const f = makeFeature(projectId, 'a');
    stacks.setIntent(f, 'test', 1000);
    db.prepare('DELETE FROM features WHERE id=?').run(f);
    expect(stacks.getIntent(f)).toBeNull();
  });
});

describe('StackRepo: geteilte Dienste — die Frage wird abgeleitet, nicht gezählt', () => {
  /**
   * FR-022: der geteilte Dienst wird erst mit dem LETZTEN Nutzer abgebaut. Ein
   * Referenzzähler driftet bei Abstürzen — deshalb die Ableitung (research E7).
   */
  it('meldet ein weiteres Feature mit Absicht im selben Projekt', () => {
    const a = makeFeature(projectId, 'a');
    const b = makeFeature(projectId, 'b');
    stacks.setIntent(a, 'test', 1);
    stacks.setIntent(b, 'test', 2);
    expect(stacks.hasOtherIntent(projectId, a)).toBe(true);
    expect(stacks.hasOtherIntent(projectId, b)).toBe(true);
  });

  it('meldet nichts mehr, sobald das letzte andere Feature abgebaut ist', () => {
    const a = makeFeature(projectId, 'a');
    const b = makeFeature(projectId, 'b');
    stacks.setIntent(a, 'test', 1);
    stacks.setIntent(b, 'test', 2);
    stacks.clearIntent(b);
    expect(stacks.hasOtherIntent(projectId, a)).toBe(false);
  });

  it('zählt Features FREMDER Projekte nicht mit', () => {
    const a = makeFeature(projectId, 'a');
    const fremd = makeFeature(otherProjectId, 'fremd');
    stacks.setIntent(a, 'test', 1);
    stacks.setIntent(fremd, 'test', 2);
    expect(stacks.hasOtherIntent(projectId, a)).toBe(false);
  });

  it('nennt alle Absichten eines Projekts', () => {
    const a = makeFeature(projectId, 'a');
    const b = makeFeature(projectId, 'b');
    makeFeature(otherProjectId, 'fremd');
    stacks.setIntent(a, 'test', 1);
    stacks.setIntent(b, 'full', 2);
    expect(stacks.intentsForProject(projectId).map((i) => i.profile).sort()).toEqual(['full', 'test']);
  });
});

describe('StackRepo: manuelle Abnahme als Historie', () => {
  it('hält eine Bestätigung ohne Grund fest', () => {
    const f = makeFeature(projectId, 'a');
    stacks.addDecision({ featureId: f, decision: 'confirmed', reason: null, decidedAt: 5000 });
    expect(stacks.lastDecision(f)).toEqual({
      featureId: f,
      decision: 'confirmed',
      reason: null,
      decidedAt: 5000,
    });
  });

  /** FR-029: mehrere Ablehnungen sind möglich — nicht überschreibend. */
  it('sammelt mehrere Ablehnungen, statt sie zu überschreiben', () => {
    const f = makeFeature(projectId, 'a');
    stacks.addDecision({ featureId: f, decision: 'rejected', reason: 'erster Grund', decidedAt: 1000 });
    stacks.addDecision({ featureId: f, decision: 'rejected', reason: 'zweiter Grund', decidedAt: 2000 });
    expect(stacks.decisionsFor(f)).toHaveLength(2);
    expect(stacks.lastDecision(f)?.reason).toBe('zweiter Grund');
  });

  it('liefert die Historie jüngste zuerst', () => {
    const f = makeFeature(projectId, 'a');
    stacks.addDecision({ featureId: f, decision: 'rejected', reason: 'alt', decidedAt: 1000 });
    stacks.addDecision({ featureId: f, decision: 'confirmed', reason: null, decidedAt: 3000 });
    expect(stacks.decisionsFor(f).map((d) => d.decidedAt)).toEqual([3000, 1000]);
  });

  it('hält Entscheidungen zweier Features auseinander', () => {
    const a = makeFeature(projectId, 'a');
    const b = makeFeature(projectId, 'b');
    stacks.addDecision({ featureId: a, decision: 'rejected', reason: 'nur a', decidedAt: 1000 });
    expect(stacks.lastDecision(b)).toBeNull();
  });

  it('kennt ohne Entscheidung keine', () => {
    expect(stacks.lastDecision(makeFeature(projectId, 'a'))).toBeNull();
  });
});
