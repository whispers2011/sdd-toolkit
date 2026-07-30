import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EMPTY_STACK_CONFIG,
  initialPhases,
  type Feature,
  type IntegrationStage,
  type Project,
  type StackConfig,
} from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { StackRepo } from '../db/stackRepo.js';
import { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo } from '../db/repos.js';
import { StackService } from './stackService.js';
import { TestingLaneService } from './testingLaneService.js';
import type { MergeQueueService } from './mergeQueueService.js';

let db: DB;
let stacks: StackRepo;
let features: FeatureRepo;
let projects: ProjectRepo;
let lane: TestingLaneService;
let stackService: StackService;
let dataDir: string;
let confirmed: string[];
let rejected: { id: string; reason: string }[];
let reachable: Set<number>;

const BASE = 21000;

const STACK: StackConfig = {
  test: { command: 'up-test', sharedCommand: null, timeoutMs: null },
  full: { command: 'up-full', sharedCommand: null, timeoutMs: null },
  down: { command: 'tear-down', sharedCommand: null, timeoutMs: null },
  stopCommand: 'halt',
  services: [
    { name: 'web', portOffset: 0, scope: 'feature', stateful: false, primary: true },
    { name: 'db', portOffset: 2, scope: 'feature', stateful: true, primary: false },
  ],
};

function makeProject(name: string, stack: StackConfig): Project {
  return projects.create({
    name,
    path: `/repo/${name}`,
    defaultBranch: 'main',
    color: null,
    enabledPhases: ['specify', 'implement'],
    verifyCommands: [],
    automation: {},
    optimization: {},
    mergeMode: 'ff',
    editorCmd: null,
    integrationMode: 'local',
    stack,
  });
}

function makeFeature(project: Project, name: string, stage: IntegrationStage = 'none'): Feature {
  const f = features.create({
    projectId: project.id,
    name,
    branch: `feature/${name}`,
    worktreePath: `/wt/${name}`,
    phases: initialPhases(['specify', 'implement']),
    integration: 'none',
    integrationTarget: null,
    automation: {},
    optimization: {},
    tasksDone: 0,
    tasksTotal: 0,
  });
  if (stage !== 'none') features.setIntegration(f.id, stage);
  return features.get(f.id)!;
}

beforeEach(() => {
  db = openMemoryDatabase();
  stacks = new StackRepo(db);
  features = new FeatureRepo(db);
  projects = new ProjectRepo(db);
  dataDir = mkdtempSync(join(tmpdir(), 'sdd-lane-'));
  confirmed = [];
  rejected = [];
  reachable = new Set();

  stackService = new StackService({
    stacks,
    executions: new ExecutionRepo(db),
    attention: new AttentionRepo(db),
    ports: {
      baseForWorktree: () => BASE,
      baseForProject: () => BASE + 20,
      ensureFor: async () => ({ base: BASE + 20 }),
    },
    dataDir,
    runner: async () => ({ exitCode: 0, tail: '', timedOut: false }),
    probe: async (port) => reachable.has(port),
  });

  lane = new TestingLaneService({
    projects,
    features,
    stacks,
    stackService,
    mergeQueue: {
      confirmManualTest: async (id: string) => {
        confirmed.push(id);
      },
      rejectManualTest: async (id: string, reason: string) => {
        rejected.push({ id, reason });
      },
    } as unknown as MergeQueueService,
  });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  db.close();
});

describe('TestingLaneService: die fünf Pflichtangaben (FR-030, SC-009)', () => {
  it('liefert Worktree-Pfad, Branch, Anlagedatum, Stufe und Dienstliste in einem Eintrag', async () => {
    const project = makeProject('demo', STACK);
    const feature = makeFeature(project, 'mein-feature', 'awaiting_manual_test');

    const view = await lane.list(project.id);

    expect(view.awaitingManualTest).toHaveLength(1);
    const entry = view.awaitingManualTest[0]!;
    expect(entry.featureName).toBe('mein-feature');
    expect(entry.branch).toBe('feature/mein-feature');
    expect(entry.worktreePath).toBe('/wt/mein-feature');
    expect(entry.createdAt).toBe(feature.createdAt);
    expect(entry.stage).toBe('awaiting_manual_test');
    expect(entry.stack.services.map((s) => s.name)).toEqual(['web', 'db']);
    expect(entry.stack.services.map((s) => s.port)).toEqual([BASE, BASE + 2]);
  });

  it('bildet die Adresse, sobald der Haupteingang antwortet (FR-031, SC-002)', async () => {
    reachable.add(BASE);
    const project = makeProject('demo', STACK);
    makeFeature(project, 'erreichbar', 'awaiting_manual_test');

    const view = await lane.list(project.id, { refresh: true });
    expect(view.awaitingManualTest[0]!.stack.url).toBe(`http://localhost:${BASE}`);
  });

  it('liefert keine Adresse, wenn der Haupteingang stumm ist (FR-033)', async () => {
    const project = makeProject('demo', STACK);
    makeFeature(project, 'stumm', 'awaiting_manual_test');
    const view = await lane.list(project.id, { refresh: true });
    expect(view.awaitingManualTest[0]!.stack.url).toBeNull();
  });

  /** FR-013/FR-033: ein Satz statt einer Adresse, die nirgends hinführt. */
  it('meldet ein Projekt ohne Stack als nicht konfiguriert', async () => {
    const project = makeProject('ohne', EMPTY_STACK_CONFIG);
    makeFeature(project, 'kein-stack', 'awaiting_manual_test');

    const view = await lane.list(project.id, { refresh: true });
    expect(view.awaitingManualTest[0]!.stack).toMatchObject({
      configured: false,
      url: null,
      services: [],
    });
  });

  it('zeigt eine frühere Ablehnung am Eintrag (FR-029)', async () => {
    const project = makeProject('demo', STACK);
    const feature = makeFeature(project, 'abgelehnt', 'awaiting_manual_test');
    stacks.addDecision({
      featureId: feature.id,
      decision: 'rejected',
      reason: 'Der Knopf tut nichts.',
      decidedAt: 1000,
    });

    const view = await lane.list(project.id, { refresh: true });
    expect(view.awaitingManualTest[0]!.lastDecision).toMatchObject({
      decision: 'rejected',
      reason: 'Der Knopf tut nichts.',
    });
  });
});

describe('TestingLaneService: die zwei Abschnitte', () => {
  it('führt Features auf der Stufe in „Wartet auf Abnahme"', async () => {
    const project = makeProject('demo', STACK);
    makeFeature(project, 'wartet', 'awaiting_manual_test');
    const view = await lane.list(project.id);
    expect(view.awaitingManualTest.map((e) => e.featureName)).toEqual(['wartet']);
    expect(view.running).toEqual([]);
  });

  /**
   * Damit sichtbar bleibt, was Ports und Dienste belegt — ohne diesen Abschnitt
   * wäre die Kostenlage wieder unsichtbar.
   */
  it('führt Features mit betriebenem Stack ohne die Stufe in „Läuft gerade"', async () => {
    const project = makeProject('demo', STACK);
    const feature = makeFeature(project, 'laeuft');
    stacks.setIntent(feature.id, 'test', 1000);

    const view = await lane.list(project.id);
    expect(view.awaitingManualTest).toEqual([]);
    expect(view.running.map((e) => e.featureName)).toEqual(['laeuft']);
  });

  it('zeigt Features ohne Stufe und ohne Stack gar nicht', async () => {
    const project = makeProject('demo', STACK);
    makeFeature(project, 'unbeteiligt');
    const view = await lane.list(project.id);
    expect(view.awaitingManualTest).toEqual([]);
    expect(view.running).toEqual([]);
  });

  it('hält Projekte auseinander', async () => {
    const a = makeProject('a', STACK);
    const b = makeProject('b', STACK);
    makeFeature(a, 'in-a', 'awaiting_manual_test');
    makeFeature(b, 'in-b', 'awaiting_manual_test');

    expect((await lane.list(a.id)).awaitingManualTest.map((e) => e.featureName)).toEqual(['in-a']);
    expect((await lane.list(b.id)).awaitingManualTest.map((e) => e.featureName)).toEqual(['in-b']);
  });

  it('wirft bei unbekanntem Projekt', async () => {
    await expect(lane.list('gibt-es-nicht')).rejects.toThrow(/nicht gefunden/);
  });

  it('zählt die Features auf der Stufe für den Einstieg', () => {
    const project = makeProject('demo', STACK);
    makeFeature(project, 'eins', 'awaiting_manual_test');
    makeFeature(project, 'zwei', 'awaiting_manual_test');
    makeFeature(project, 'drei');
    expect(lane.countAwaiting(project.id)).toBe(2);
  });
});

describe('TestingLaneService: die Entscheidung läuft über EINEN Weg', () => {
  /**
   * Die Übergänge der Stufe liegen im MergeQueueService — die Lane reicht nur
   * durch. Sonst gäbe es zwei Wege aus `awaiting_manual_test` heraus (FR-028).
   */
  it('reicht das Bestätigen an die Merge-Queue durch', async () => {
    const project = makeProject('demo', STACK);
    const feature = makeFeature(project, 'ok', 'awaiting_manual_test');
    await lane.confirm(feature.id);
    expect(confirmed).toEqual([feature.id]);
  });

  it('reicht das Ablehnen samt Grund durch', async () => {
    const project = makeProject('demo', STACK);
    const feature = makeFeature(project, 'nein', 'awaiting_manual_test');
    await lane.reject(feature.id, 'Fehlt noch etwas.');
    expect(rejected).toEqual([{ id: feature.id, reason: 'Fehlt noch etwas.' }]);
  });
});
