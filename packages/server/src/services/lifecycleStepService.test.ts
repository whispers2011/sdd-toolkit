import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialPhases } from '@sdd/shared';
import type { Feature, LifecycleStep, LifecycleTrigger, Project } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { LifecycleStepRepo } from '../db/lifecycleStepRepo.js';
import { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo } from '../db/repos.js';
import { LifecycleStepService, type StepRunner } from './lifecycleStepService.js';

const AFTER_WT: LifecycleTrigger = { kind: 'after_worktree_create' };

describe('LifecycleStepService', () => {
  let db: DB;
  let steps: LifecycleStepRepo;
  let executions: ExecutionRepo;
  let attention: AttentionRepo;
  let features: FeatureRepo;
  let svc: LifecycleStepService;
  let root: string;
  let dataDir: string;
  let project: Project;
  let feature: Feature;

  const add = (over: Partial<LifecycleStep> = {}): LifecycleStep =>
    steps.upsert({
      projectId: over.projectId !== undefined ? over.projectId : project.id,
      name: over.name ?? 'Schritt',
      command: over.command ?? 'true',
      trigger: over.trigger ?? AFTER_WT,
      blocking: over.blocking ?? true,
      timeoutMs: over.timeoutMs ?? null,
      enabled: over.enabled ?? true,
      sortOrder: over.sortOrder ?? 0,
    });

  const makeFeature = (name: string): Feature => {
    const worktreePath = join(root, 'worktrees', name);
    mkdirSync(worktreePath, { recursive: true });
    return features.create({
      projectId: project.id,
      name,
      branch: `feature/${name}`,
      worktreePath,
      phases: initialPhases([]),
      integration: 'none',
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
  };

  const stepRuns = () =>
    executions.list(feature.id).filter((e) => e.kind === 'lifecycle_step');

  const openItems = () =>
    attention.listOpen(project.id).filter((i) => i.kind === 'lifecycle_step_failed');

  beforeEach(() => {
    // realpath: unter macOS ist /var ein Symlink auf /private/var — `$PWD` im
    // gespawnten Kommando trägt den aufgelösten Pfad.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-lifecycle-')));
    dataDir = join(root, 'data');
    mkdirSync(join(dataDir, 'logs'), { recursive: true });
    mkdirSync(join(root, 'main'), { recursive: true });

    db = openMemoryDatabase();
    steps = new LifecycleStepRepo(db);
    executions = new ExecutionRepo(db);
    attention = new AttentionRepo(db);
    features = new FeatureRepo(db);
    project = new ProjectRepo(db).create({
      name: 'Demo',
      path: join(root, 'main'),
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    });
    svc = new LifecycleStepService({ steps, executions, attention, dataDir });
    feature = makeFeature('demo-eins');
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  // ---------- US1: Erfolgspfad und Fast-Path ----------

  it('verbucht einen erfolgreichen Schritt als genau eine Execution mit Namen und Log', async () => {
    add({ name: 'Marker schreiben', command: 'echo "vorbereitet für $SDD_FEATURE" > .sdd-prepared' });

    const outcome = await svc.runTrigger(feature, project, AFTER_WT);
    expect(outcome.ok).toBe(true);
    expect(outcome.ran).toHaveLength(1);

    const runs = stepRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.label).toBe('Marker schreiben');
    expect(runs[0]!.status).toBe('succeeded');
    expect(runs[0]!.exitCode).toBe(0);
    expect(runs[0]!.featureId).toBe(feature.id);
    expect(runs[0]!.projectId).toBe(project.id);

    // Das Kommando lief IM Worktree.
    expect(readFileSync(join(feature.worktreePath!, '.sdd-prepared'), 'utf8').trim()).toBe(
      'vorbereitet für demo-eins',
    );
    // Log-Kopf nach dem verifyService-Muster.
    const log = readFileSync(join(dataDir, 'logs', `${runs[0]!.id}.log`), 'utf8');
    expect(log.split('\n')[0]).toBe('=== Marker schreiben: echo "vorbereitet für $SDD_FEATURE" > .sdd-prepared ===');
  });

  it('schreibt keinen Verbrauchswert — nie 0, nie geschätzt (FR-020)', async () => {
    add({ command: 'true' });
    await svc.runTrigger(feature, project, AFTER_WT);

    const run = stepRuns()[0]!;
    expect(run.tokens).toBeNull();
    expect(run.tokensSource).toBeNull();
    expect(run.costMicros).toBeNull();
    expect(run.model).toBeNull();
  });

  /** SC-008: ohne konfigurierte Schritte kein Prozess, keine Execution, kein Log. */
  it('Fast-Path: bei leerer Tabelle wird weder gespawnt noch eine Execution angelegt', async () => {
    const runner = vi.fn<StepRunner>();
    const spy = vi.spyOn(executions, 'start');
    const bare = new LifecycleStepService({ steps, executions, attention, dataDir, runner });

    expect(bare.hasStepsFor(project.id, feature.id, AFTER_WT)).toBe(false);
    const outcome = await bare.runTrigger(feature, project, AFTER_WT);

    expect(outcome).toEqual({ ok: true, failed: null, ran: [] });
    expect(runner).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(stepRuns()).toHaveLength(0);
  });

  it('hasStepsFor meldet true, sobald ein passender Schritt gilt', () => {
    expect(svc.hasStepsFor(project.id, feature.id, AFTER_WT)).toBe(false);
    add({ trigger: { kind: 'before_phase', phase: 'plan' } });
    expect(svc.hasStepsFor(project.id, feature.id, AFTER_WT)).toBe(false);
    expect(svc.hasStepsFor(project.id, feature.id, { kind: 'before_phase', phase: 'plan' })).toBe(true);
    // Ein deaktivierter Schritt gilt nicht.
    add({ name: 'Aus', enabled: false });
    expect(svc.hasStepsFor(project.id, feature.id, AFTER_WT)).toBe(false);
  });

  it('führt zwei Schritte nacheinander aus — die Zeiträume überlappen nicht', async () => {
    add({ name: 'Erster', command: 'sleep 0.2; echo 1 >> .sdd-order', sortOrder: 0 });
    add({ name: 'Zweiter', command: 'sleep 0.2; echo 2 >> .sdd-order', sortOrder: 10 });

    await svc.runTrigger(feature, project, AFTER_WT);

    const runs = stepRuns().sort((a, b) => a.startedAt - b.startedAt);
    expect(runs.map((r) => r.label)).toEqual(['Erster', 'Zweiter']);
    expect(runs[0]!.finishedAt).not.toBeNull();
    expect(runs[0]!.finishedAt!).toBeLessThanOrEqual(runs[1]!.startedAt);
    expect(readFileSync(join(feature.worktreePath!, '.sdd-order'), 'utf8')).toBe('1\n2\n');
  });

  // ---------- US2: Fehlerverhalten ----------

  it('beratender Fehlschlag: nächster Schritt läuft, kein Inbox-Item (FR-024)', async () => {
    add({ name: 'Beratender Fehlschlag', command: 'exit 4', blocking: false, sortOrder: 0 });
    add({ name: 'Danach', command: 'touch .sdd-danach', blocking: true, sortOrder: 10 });

    const outcome = await svc.runTrigger(feature, project, AFTER_WT);

    expect(outcome.ok).toBe(true);
    expect(outcome.ran.map((r) => r.exitCode)).toEqual([4, 0]);
    expect(stepRuns().find((r) => r.label === 'Beratender Fehlschlag')!.status).toBe('failed');
    expect(readFileSync(join(feature.worktreePath!, '.sdd-danach'), 'utf8')).toBe('');
    expect(openItems()).toHaveLength(0);
  });

  it('blockierender Fehlschlag: Kette bricht ab, genau ein Item mit Kommando, Exit-Code und Tail', async () => {
    add({ name: 'Blockierender Fehlschlag', command: 'echo "zeile a"; echo "zeile b"; exit 3', sortOrder: 10 });
    add({ name: 'Darf nicht laufen', command: 'touch .sdd-should-not-exist', sortOrder: 20 });

    const outcome = await svc.runTrigger(feature, project, AFTER_WT);

    expect(outcome.ok).toBe(false);
    expect(outcome.failed!.name).toBe('Blockierender Fehlschlag');
    expect(outcome.ran).toHaveLength(1);

    // Der Folgeschritt lief nicht — kein Lauf, keine Wirkung.
    expect(stepRuns().map((r) => r.label)).toEqual(['Blockierender Fehlschlag']);
    expect(() => readFileSync(join(feature.worktreePath!, '.sdd-should-not-exist'))).toThrow();

    const items = openItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toContain('Schritt „Blockierender Fehlschlag"');
    expect(items[0]!.message).toContain('exit 3');
    expect(items[0]!.message).toContain('Kommando: echo "zeile a"; echo "zeile b"; exit 3');
    expect(items[0]!.message).toContain('zeile a');
    expect(items[0]!.message).toContain('zeile b');
    expect(items[0]!.featureId).toBe(feature.id);
  });

  it('nennt den Auslöser in der Meldung', async () => {
    add({ name: 'Rot', command: 'exit 1', trigger: { kind: 'before_phase', phase: 'plan' } });
    await svc.runTrigger(feature, project, { kind: 'before_phase', phase: 'plan' });
    expect(openItems()[0]!.message).toContain('Vor Phase „Planen"');
  });

  it('Zeitlimit: SIGKILL, Lauf failed mit exit 137 (FR-015/SC-006)', async () => {
    add({ name: 'Hänger', command: 'sleep 30', timeoutMs: 400 });

    const started = Date.now();
    const outcome = await svc.runTrigger(feature, project, AFTER_WT);
    const dauer = Date.now() - started;

    expect(outcome.ok).toBe(false);
    expect(outcome.ran[0]!.timedOut).toBe(true);
    // Innerhalb von 10 s nach Ablauf verbucht — hier weit darunter.
    expect(dauer).toBeLessThan(10_000);

    const run = stepRuns()[0]!;
    expect(run.status).toBe('failed');
    expect(run.exitCode).toBe(137);
    expect(openItems()[0]!.message).toContain('nach Zeitlimit beendet');
  });

  it('nicht existierendes Kommando: exit 127 statt stillem Erfolg', async () => {
    add({ name: 'Gibts nicht', command: 'sdd-gibtsnicht --version' });

    const outcome = await svc.runTrigger(feature, project, AFTER_WT);

    expect(outcome.ok).toBe(false);
    expect(stepRuns()[0]!.exitCode).toBe(127);
    expect(stepRuns()[0]!.status).toBe('failed');
  });

  it('erfolgreicher Wiederanlauf löst das Item auf (FR-025)', async () => {
    const rot = add({ name: 'Erst rot', command: 'exit 1' });
    await svc.runTrigger(feature, project, AFTER_WT);
    expect(openItems()).toHaveLength(1);

    steps.upsert({ ...rot, command: 'true' });
    const outcome = await svc.runTrigger(feature, project, AFTER_WT);

    expect(outcome.ok).toBe(true);
    expect(openItems()).toHaveLength(0);
  });

  it('ein beratender Fehlschlag im Durchlauf verhindert das Auflösen nicht', async () => {
    const rot = add({ name: 'Erst rot', command: 'exit 1', sortOrder: 0 });
    await svc.runTrigger(feature, project, AFTER_WT);
    expect(openItems()).toHaveLength(1);

    steps.upsert({ ...rot, command: 'true' });
    add({ name: 'Nur Hinweis', command: 'exit 9', blocking: false, sortOrder: 10 });
    await svc.runTrigger(feature, project, AFTER_WT);

    expect(openItems()).toHaveLength(0);
  });

  it('fehlender Worktree: wirft und erzeugt keinen FAIL-Lauf (FR-026)', async () => {
    add({ command: 'true' });
    rmSync(feature.worktreePath!, { recursive: true, force: true });

    await expect(svc.runTrigger(feature, project, AFTER_WT)).rejects.toThrow(/Worktree fehlt/);
    expect(stepRuns()).toHaveLength(0);
    expect(openItems()).toHaveLength(0);
  });

  it('fehlender Worktree-Pfad am Feature: derselbe Infrastrukturfehler', async () => {
    add({ command: 'true' });
    const ohnePfad: Feature = { ...feature, worktreePath: null };

    await expect(svc.runTrigger(ohnePfad, project, AFTER_WT)).rejects.toThrow(/Worktree fehlt/);
    expect(stepRuns()).toHaveLength(0);
  });

  // ---------- US3: Kontext und Arbeitsverzeichnis ----------

  it('setzt genau die sechs Kontext-Variablen im Kommando (Worktree-Auslöser)', async () => {
    const out = join(root, 'ctx-worktree.log');
    add({
      command:
        `{ echo "W=$SDD_WORKTREE"; echo "P=$SDD_PROJECT"; echo "F=$SDD_FEATURE"; ` +
        `echo "B=$SDD_BRANCH"; echo "PH=$SDD_PHASE"; echo "ST=$SDD_STAGE"; echo "PWD=$PWD"; } > ${out}`,
    });

    await svc.runTrigger(feature, project, AFTER_WT);

    const lines = readFileSync(out, 'utf8').trim().split('\n');
    expect(lines).toEqual([
      `W=${feature.worktreePath}`,
      'P=Demo',
      'F=demo-eins',
      'B=feature/demo-eins',
      'PH=',
      'ST=',
      `PWD=${feature.worktreePath}`,
    ]);
  });

  it('Phasen-Auslöser setzt SDD_PHASE, Stufen-Auslöser SDD_STAGE — nie beide', async () => {
    const out = join(root, 'ctx-phase.log');
    const cmd = `echo "PH=$SDD_PHASE ST=$SDD_STAGE" >> ${out}`;
    add({ name: 'Phase', command: cmd, trigger: { kind: 'after_phase', phase: 'specify' } });
    add({ name: 'Stufe', command: cmd, trigger: { kind: 'before_stage', stage: 'verify' } });

    await svc.runTrigger(feature, project, { kind: 'after_phase', phase: 'specify' });
    await svc.runTrigger(feature, project, { kind: 'before_stage', stage: 'verify' });

    expect(readFileSync(out, 'utf8').trim().split('\n')).toEqual([
      'PH=specify ST=',
      'PH= ST=verify',
    ]);
  });

  /** US3 Szenario 5: vor der Anlage gibt es keinen Worktree — der Pfad ist trotzdem bekannt. */
  it('before_worktree_create läuft im Haupt-Checkout und kennt den künftigen Pfad', async () => {
    const out = join(root, 'ctx-before.log');
    add({
      command: `{ echo "W=$SDD_WORKTREE"; echo "PWD=$PWD"; } > ${out}`,
      trigger: { kind: 'before_worktree_create' },
    });
    const kuenftig = join(root, 'worktrees', 'noch-nicht-da');
    const ohneWorktree: Feature = { ...feature, worktreePath: null };

    const outcome = await svc.runTrigger(
      ohneWorktree,
      project,
      { kind: 'before_worktree_create' },
      { worktreePath: kuenftig },
    );

    expect(outcome.ok).toBe(true);
    expect(readFileSync(out, 'utf8').trim().split('\n')).toEqual([
      `W=${kuenftig}`,
      `PWD=${project.path}`,
    ]);
  });

  it('after_stage:merged läuft im Haupt-Checkout, auch wenn der Worktree schon weg ist', async () => {
    const out = join(root, 'ctx-merged.log');
    add({ command: `echo "PWD=$PWD" > ${out}`, trigger: { kind: 'after_stage', stage: 'merged' } });
    rmSync(feature.worktreePath!, { recursive: true, force: true });

    const outcome = await svc.runTrigger(feature, project, { kind: 'after_stage', stage: 'merged' });

    expect(outcome.ok).toBe(true);
    expect(readFileSync(out, 'utf8').trim()).toBe(`PWD=${project.path}`);
  });

  // ---------- US4: Ebenen und Lauf-Buchführung ----------

  it('reicht die Feature-Auswahl durch: exclude schließt aus, include erzwingt', async () => {
    const global = steps.upsert({
      projectId: null,
      name: 'Global A',
      command: 'touch .sdd-global',
      trigger: AFTER_WT,
      blocking: true,
      timeoutMs: null,
      enabled: true,
      sortOrder: 0,
    });
    const aus = add({ name: 'Deaktiviert', command: 'touch .sdd-aus', enabled: false, sortOrder: 10 });

    steps.setDecision(feature.id, global.id, 'exclude');
    steps.setDecision(feature.id, aus.id, 'include');

    const outcome = await svc.runTrigger(feature, project, AFTER_WT);

    expect(outcome.ran.map((r) => r.step.name)).toEqual(['Deaktiviert']);
    // Der Fast-Path sieht dasselbe Bild.
    expect(svc.hasStepsFor(project.id, feature.id, AFTER_WT)).toBe(true);
  });

  it('die Auswahl eines Features wirkt nicht auf ein anderes desselben Projekts', async () => {
    const s = add({ name: 'Projekt B', command: 'true' });
    steps.setDecision(feature.id, s.id, 'exclude');
    const zweites = makeFeature('demo-zwei');

    expect(svc.hasStepsFor(project.id, feature.id, AFTER_WT)).toBe(false);
    expect(svc.hasStepsFor(project.id, zweites.id, AFTER_WT)).toBe(true);
  });

  /** FR-028: der Lauf behält seinen Namen, auch wenn der Schritt danach verschwindet. */
  it('ein Lauf behält seinen label nach Umbenennung und Löschung des Schritts', async () => {
    const s = add({ name: 'Ursprünglich', command: 'true' });
    await svc.runTrigger(feature, project, AFTER_WT);

    steps.upsert({ ...s, name: 'Umbenannt' });
    expect(stepRuns()[0]!.label).toBe('Ursprünglich');

    steps.remove(s.id);
    expect(steps.get(s.id)).toBeNull();
    expect(stepRuns()[0]!.label).toBe('Ursprünglich');
  });

  // ---------- Doppelstart-Guard (SC-005) ----------

  it('derselbe Auslöser desselben Features läuft nie zweimal gleichzeitig', async () => {
    add({ name: 'Einmal', command: 'sleep 0.3; echo x >> .sdd-count' });

    const [a, b] = await Promise.all([
      svc.runTrigger(feature, project, AFTER_WT),
      svc.runTrigger(feature, project, AFTER_WT),
    ]);

    // Genau ein echter Durchlauf; der zweite Aufruf ist übersprungen und hält nichts an.
    expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);
    expect(a.ok && b.ok).toBe(true);
    expect(stepRuns()).toHaveLength(1);
    expect(readFileSync(join(feature.worktreePath!, '.sdd-count'), 'utf8')).toBe('x\n');
  });

  it('zwei verschiedene Features laufen unabhängig voneinander', async () => {
    add({ name: 'Beide', command: 'sleep 0.2; echo "$SDD_FEATURE" > .sdd-wer' });
    const zweites = makeFeature('demo-zwei');

    const [a, b] = await Promise.all([
      svc.runTrigger(feature, project, AFTER_WT),
      svc.runTrigger(zweites, project, AFTER_WT),
    ]);

    expect(a.skipped).toBeUndefined();
    expect(b.skipped).toBeUndefined();
    // Jedes Feature schreibt in seinen eigenen Worktree — nie in den des anderen.
    expect(readFileSync(join(feature.worktreePath!, '.sdd-wer'), 'utf8').trim()).toBe('demo-eins');
    expect(readFileSync(join(zweites.worktreePath!, '.sdd-wer'), 'utf8').trim()).toBe('demo-zwei');
    expect(executions.list(zweites.id).filter((e) => e.kind === 'lifecycle_step')).toHaveLength(1);
  });

  it('verschiedene Auslöser desselben Features blockieren sich nicht', async () => {
    add({ name: 'Worktree', command: 'sleep 0.2', trigger: AFTER_WT });
    add({ name: 'Phase', command: 'sleep 0.2', trigger: { kind: 'before_phase', phase: 'plan' } });

    const [a, b] = await Promise.all([
      svc.runTrigger(feature, project, AFTER_WT),
      svc.runTrigger(feature, project, { kind: 'before_phase', phase: 'plan' }),
    ]);

    expect(a.skipped).toBeUndefined();
    expect(b.skipped).toBeUndefined();
    expect(stepRuns()).toHaveLength(2);
  });

  // ---------- Ausgabe ----------

  it('hält sehr viel Ausgabe vollständig im Log und nur den Rest im Item', async () => {
    add({ name: 'Viel Ausgabe', command: 'seq 1 20000; exit 5' });

    await svc.runTrigger(feature, project, AFTER_WT);

    const log = readFileSync(join(dataDir, 'logs', `${stepRuns()[0]!.id}.log`), 'utf8');
    expect(log).toContain('\n1\n');
    expect(log).toContain('\n20000\n');

    const message = openItems()[0]!.message;
    expect(message).toContain('20000');
    expect(message).not.toContain('\n1\n');
    // Der Tail ist hart gekappt — die Meldung bleibt lesbar.
    expect(message.length).toBeLessThan(2500);
  });
});
