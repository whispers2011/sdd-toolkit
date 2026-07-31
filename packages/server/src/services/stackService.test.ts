import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_STACK_CONFIG, initialPhases, type Feature, type Project, type StackConfig } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { StackRepo } from '../db/stackRepo.js';
import { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo } from '../db/repos.js';
import { StackService, StackRunError, type StackPortSource } from './stackService.js';
import type { StepRunner } from './stepRunner.js';

let db: DB;
let stacks: StackRepo;
let attention: AttentionRepo;
let features: FeatureRepo;
let projects: ProjectRepo;
let dataDir: string;

/** Jeder Lauf: Kommando, Arbeitsverzeichnis und die durchgereichte Umgebung. */
interface RunLog {
  command: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}

let runs: RunLog[];
let exitFor: (command: string) => number;
let reachable: Set<number>;

const FEATURE_BASE = 21000;
const PROJECT_BASE = 21020;

function fullConfig(patch: Partial<StackConfig> = {}): StackConfig {
  return {
    test: { command: 'up-test', sharedCommand: null, timeoutMs: null },
    full: { command: 'up-full', sharedCommand: null, timeoutMs: null },
    down: { command: 'tear-down', sharedCommand: null, timeoutMs: null },
    stopCommand: 'halt',
    services: [
      { name: 'web', portOffset: 0, scope: 'feature', stateful: false, primary: true },
      { name: 'db', portOffset: 2, scope: 'feature', stateful: true, primary: false },
    ],
    ...patch,
  };
}

function makeProject(name: string, path: string, stack: StackConfig): Project {
  return projects.create({
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
    stack,
  });
}

function makeFeature(project: Project, name: string): Feature {
  return features.create({
    projectId: project.id,
    name,
    branch: `feature/${name}`,
    worktreePath: join(dataDir, name),
    phases: initialPhases(['specify', 'implement']),
    integration: 'none',
    integrationTarget: null,
    automation: {},
    optimization: {},
    tasksDone: 0,
    tasksTotal: 0,
  });
}

const ports: StackPortSource = {
  baseForWorktree: () => FEATURE_BASE,
  baseForProject: () => PROJECT_BASE,
  ensureFor: async () => ({ base: PROJECT_BASE }),
};

function makeService(): StackService {
  const runner: StepRunner = async ({ command, cwd, extraEnv, timeoutMs }) => {
    runs.push({ command, cwd, env: extraEnv, timeoutMs });
    const code = exitFor(command);
    return { exitCode: code, tail: code === 0 ? '' : `Ausgabe von ${command}`, timedOut: false };
  };
  return new StackService({
    stacks,
    executions: new ExecutionRepo(db),
    attention,
    ports,
    dataDir,
    runner,
    probe: async (port) => reachable.has(port),
  });
}

beforeEach(() => {
  db = openMemoryDatabase();
  stacks = new StackRepo(db);
  attention = new AttentionRepo(db);
  features = new FeatureRepo(db);
  projects = new ProjectRepo(db);
  dataDir = mkdtempSync(join(tmpdir(), 'sdd-stack-'));
  runs = [];
  exitFor = () => 0;
  reachable = new Set();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('StackService: Fast-Path ohne Konfiguration (FR-013, SC-010)', () => {
  it('erkennt ein Projekt ohne Stack', () => {
    const project = makeProject('Ohne', '/repo/ohne', EMPTY_STACK_CONFIG);
    expect(makeService().isConfigured(project)).toBe(false);
  });

  it('führt ohne Konfiguration KEIN Kommando aus und legt keine Absicht an', async () => {
    const project = makeProject('Ohne', '/repo/ohne', EMPTY_STACK_CONFIG);
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'test');
    expect(runs).toEqual([]);
    expect(stacks.getIntent(feature.id)).toBeNull();
  });

  it('lässt auch den Abbau ohne Konfiguration wirkungslos', async () => {
    const project = makeProject('Ohne', '/repo/ohne', EMPTY_STACK_CONFIG);
    const feature = makeFeature(project, 'a');
    await makeService().down(feature, project);
    expect(runs).toEqual([]);
  });
});

describe('StackService: Hochfahren und Idempotenz (FR-014/FR-015, SC-006)', () => {
  it('führt das test-Kommando aus und hält die Absicht fest', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'test');
    expect(runs.map((r) => r.command)).toEqual(['up-test']);
    expect(stacks.getIntent(feature.id)?.profile).toBe('test');
  });

  /**
   * SC-006: der Stack bleibt über aufeinanderfolgende Läufe stehen und wird NICHT
   * pro Lauf herunter- und wieder hochgefahren.
   */
  it('führt bei erneutem Hochfahren desselben Profils kein zweites Kommando aus', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    const svc = makeService();
    await svc.up(feature, project, 'test');
    await svc.up(feature, project, 'test');
    await svc.up(feature, project, 'test');
    expect(runs).toHaveLength(1);
  });

  it('führt beim Wechsel test → full das full-Kommando aus', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    const svc = makeService();
    await svc.up(feature, project, 'test');
    await svc.up(feature, project, 'full');
    expect(runs.map((r) => r.command)).toEqual(['up-test', 'up-full']);
    expect(stacks.getIntent(feature.id)?.profile).toBe('full');
  });

  it('läuft im Worktree des Features', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'test');
    expect(runs[0]!.cwd).toBe(feature.worktreePath);
  });
});

describe('StackService: Umgebung des Kommandos (FR-007/FR-018)', () => {
  it('reicht acht Schlüssel durch — dieselbe Stelle wie bei jedem Schritt', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'test');
    expect(Object.keys(runs[0]!.env).sort()).toEqual([
      'SDD_BRANCH',
      'SDD_FEATURE',
      'SDD_PHASE',
      'SDD_PORT_BASE',
      'SDD_PROFILE',
      'SDD_PROJECT',
      'SDD_STAGE',
      'SDD_WORKTREE',
    ]);
  });

  it('teilt dem Kommando das gemeinte Profil mit', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    const svc = makeService();
    await svc.up(feature, project, 'test');
    expect(runs[0]!.env.SDD_PROFILE).toBe('test');
    await svc.down(feature, project);
    expect(runs[1]!.env.SDD_PROFILE).toBe('down');
  });

  it('gibt dem feature-eigenen Kommando den Block des Worktrees', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'test');
    expect(runs[0]!.env.SDD_PORT_BASE).toBe(String(FEATURE_BASE));
  });

  it('lässt Phase und Stufe bei einem Profillauf leer', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'test');
    expect(runs[0]!.env.SDD_PHASE).toBe('');
    expect(runs[0]!.env.SDD_STAGE).toBe('');
  });

  it('nutzt das Zeitlimit des Profils', async () => {
    const cfg = fullConfig({ test: { command: 'up-test', sharedCommand: null, timeoutMs: 60_000 } });
    const project = makeProject('Mit', '/repo/mit', cfg);
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'test');
    expect(runs[0]!.timeoutMs).toBe(60_000);
  });
});

describe('StackService: Fehlschlag (FR-019)', () => {
  const failing = () => {
    exitFor = (c) => (c === 'up-test' ? 3 : 0);
  };

  it('wirft mit Exit-Code und Ausschnitt', async () => {
    failing();
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    await expect(makeService().up(feature, project, 'test')).rejects.toBeInstanceOf(StackRunError);
  });

  it('erzeugt eine Meldung mit Profil, Kommando, Exit-Code und Ausgabe', async () => {
    failing();
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'test').catch(() => {});

    const items = attention.listOpen(project.id).filter((i) => i.kind === 'stack_failed');
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toContain('test');
    expect(items[0]!.message).toContain('up-test');
    expect(items[0]!.message).toContain('exit 3');
    expect(items[0]!.message).toContain('Ausgabe von up-test');
  });

  /** Kein halber Stack: ohne Erfolg entsteht keine Absicht. */
  it('hält KEINE Absicht fest, wenn das Kommando fehlschlägt', async () => {
    failing();
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'test').catch(() => {});
    expect(stacks.getIntent(feature.id)).toBeNull();
  });

  it('löst offene Meldungen nach einem erfolgreichen Lauf auf', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    const svc = makeService();
    failing();
    await svc.up(feature, project, 'test').catch(() => {});
    exitFor = () => 0;
    await svc.up(feature, project, 'test');
    expect(attention.listOpen(project.id).filter((i) => i.kind === 'stack_failed')).toHaveLength(0);
  });

  it('schluckt den Fehlschlag beim Abbau nur mit `quiet`', async () => {
    exitFor = (c) => (c === 'tear-down' ? 1 : 0);
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    const svc = makeService();
    await expect(svc.down(feature, project)).rejects.toBeInstanceOf(StackRunError);
    await expect(svc.down(feature, project, { quiet: true })).resolves.toBeUndefined();
  });
});

describe('StackService: geteilte Dienste (FR-022, research E7)', () => {
  const sharedCfg = () =>
    fullConfig({
      full: { command: 'up-full', sharedCommand: 'up-shared', timeoutMs: null },
      down: { command: 'tear-down', sharedCommand: 'down-shared', timeoutMs: null },
      services: [
        { name: 'web', portOffset: 0, scope: 'feature', stateful: false, primary: true },
        { name: 'mail', portOffset: 5, scope: 'shared', stateful: false, primary: false },
      ],
    });

  it('startet den geteilten Dienst, wenn er nicht erreichbar ist — VOR dem eigenen', async () => {
    const project = makeProject('Mit', '/repo/mit', sharedCfg());
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'full');
    expect(runs.map((r) => r.command)).toEqual(['up-shared', 'up-full']);
  });

  /** Edge Case: zwei Features starten gleichzeitig — er entsteht genau einmal. */
  it('startet den geteilten Dienst NICHT erneut, wenn er bereits antwortet', async () => {
    reachable.add(PROJECT_BASE + 5);
    const project = makeProject('Mit', '/repo/mit', sharedCfg());
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'full');
    expect(runs.map((r) => r.command)).toEqual(['up-full']);
  });

  it('gibt dem geteilten Kommando den PROJEKTBLOCK und den Haupt-Checkout', async () => {
    const project = makeProject('Mit', '/repo/mit', sharedCfg());
    const feature = makeFeature(project, 'a');
    await makeService().up(feature, project, 'full');
    const shared = runs.find((r) => r.command === 'up-shared')!;
    expect(shared.env.SDD_PORT_BASE).toBe(String(PROJECT_BASE));
    expect(shared.cwd).toBe(project.path);
    // Ohne Feature-Bezug: die feature-eigenen Angaben sind leer, nie ein Wert
    // aus einem anderen Vorgang.
    expect(shared.env.SDD_FEATURE).toBe('');
    expect(shared.env.SDD_BRANCH).toBe('');
  });

  it('baut den geteilten Dienst NICHT ab, solange ein anderes Feature ihn nutzt', async () => {
    const project = makeProject('Mit', '/repo/mit', sharedCfg());
    const a = makeFeature(project, 'a');
    const b = makeFeature(project, 'b');
    const svc = makeService();
    await svc.up(a, project, 'full');
    await svc.up(b, project, 'full');
    runs = [];

    await svc.down(a, project);
    expect(runs.map((r) => r.command)).toEqual(['tear-down']);
  });

  it('baut den geteilten Dienst mit dem LETZTEN Feature ab — DANACH', async () => {
    const project = makeProject('Mit', '/repo/mit', sharedCfg());
    const a = makeFeature(project, 'a');
    const b = makeFeature(project, 'b');
    const svc = makeService();
    await svc.up(a, project, 'full');
    await svc.up(b, project, 'full');
    await svc.down(a, project);
    runs = [];

    await svc.down(b, project);
    expect(runs.map((r) => r.command)).toEqual(['tear-down', 'down-shared']);
  });
});

describe('StackService: Zustand wird ERHOBEN, nie behauptet (FR-023)', () => {
  it('meldet jeden Dienst als `down`, solange nichts antwortet', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    const view = await makeService().probe(feature, project);
    expect(view.services.map((s) => s.status)).toEqual(['down', 'down']);
    expect(view.url).toBeNull();
  });

  it('leitet die Ports aus dem Block ab', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    const view = await makeService().probe(feature, project);
    expect(view.services.map((s) => s.port)).toEqual([FEATURE_BASE, FEATURE_BASE + 2]);
    expect(view.portBase).toBe(FEATURE_BASE);
  });

  it('bildet die Adresse NUR, wenn der Haupteingang antwortet (FR-031/FR-033)', async () => {
    reachable.add(FEATURE_BASE);
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    const view = await makeService().probe(feature, project, { refresh: true });
    expect(view.url).toBe(`http://localhost:${FEATURE_BASE}`);
  });

  /** Edge Case „läuft, aber nicht erreichbar": lieber kein Link als einer ins Leere. */
  it('liefert keine Adresse, wenn der Haupteingang stumm bleibt — auch bei betriebenem Profil', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    const svc = makeService();
    await svc.up(feature, project, 'full');
    const view = await svc.probe(feature, project, { refresh: true });
    expect(view.profile).toBe('full');
    expect(view.url).toBeNull();
  });

  /** Edge Case „Server startet neu, während Stacks laufen". */
  it('erhebt den Status neu, statt einen gemerkten Stand zu behaupten', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    const svc = makeService();
    await svc.up(feature, project, 'full');

    // Frischer Service = wie nach einem Serverneustart: die Absicht überlebt,
    // der Zustand wird erhoben.
    reachable.add(FEATURE_BASE);
    const nachNeustart = await makeService().probe(feature, project);
    expect(nachNeustart.profile).toBe('full');
    expect(nachNeustart.services.find((s) => s.name === 'web')?.status).toBe('up');
  });

  it('meldet den geteilten Dienst über den Projektblock', async () => {
    const cfg = fullConfig({
      services: [
        { name: 'web', portOffset: 0, scope: 'feature', stateful: false, primary: true },
        { name: 'mail', portOffset: 5, scope: 'shared', stateful: false, primary: false },
      ],
    });
    reachable.add(PROJECT_BASE + 5);
    const project = makeProject('Mit', '/repo/mit', cfg);
    const feature = makeFeature(project, 'a');
    const view = await makeService().probe(feature, project);
    expect(view.services.find((s) => s.name === 'mail')).toMatchObject({
      port: PROJECT_BASE + 5,
      status: 'up',
      scope: 'shared',
    });
  });

  it('liefert ohne Konfiguration die leere Sicht statt einer Behauptung', async () => {
    const project = makeProject('Ohne', '/repo/ohne', EMPTY_STACK_CONFIG);
    const feature = makeFeature(project, 'a');
    const view = await makeService().probe(feature, project);
    expect(view).toMatchObject({ configured: false, services: [], url: null, portBase: null });
  });
});

describe('StackService: gesperrte Aktionen', () => {
  it('lehnt „Stoppen" ohne Anhalte-Kommando mit dem Satz der Oberfläche ab', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig({ stopCommand: null }));
    const feature = makeFeature(project, 'a');
    await expect(makeService().stop(feature, project)).rejects.toThrow(
      'Kein Kommando zum Anhalten hinterlegt — nur Abbauen ist möglich.',
    );
  });

  it('führt „Neustarten" als Anhalten und dann Starten aus', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const feature = makeFeature(project, 'a');
    await makeService().restart(feature, project);
    expect(runs.map((r) => r.command)).toEqual(['halt', 'up-full']);
  });

  it('wirkt ausschließlich auf den Stack DIESES Features (US3 Szenario 5)', async () => {
    const project = makeProject('Mit', '/repo/mit', fullConfig());
    const a = makeFeature(project, 'a');
    const b = makeFeature(project, 'b');
    const svc = makeService();
    await svc.up(a, project, 'full');
    await svc.up(b, project, 'full');
    runs = [];

    await svc.down(a, project);
    expect(stacks.getIntent(a.id)).toBeNull();
    expect(stacks.getIntent(b.id)?.profile).toBe('full');
    expect(runs.every((r) => r.env.SDD_FEATURE === 'a')).toBe(true);
  });
});
