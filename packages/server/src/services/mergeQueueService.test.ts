import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_REASON, initialPhases } from '@sdd/shared';
import type { FeaturePhase, LifecycleStageId, PhaseMap } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { StackRepo } from '../db/stackRepo.js';
import {
  AttentionRepo,
  ExecutionRepo,
  FeatureRepo,
  ProjectRepo,
  QueueRepo,
  SettingsRepo,
} from '../db/repos.js';
import { LifecycleStepRepo } from '../db/lifecycleStepRepo.js';
import { WorktreeManager } from '../git/worktrees.js';
import { MergeEngine } from '../git/mergeEngine.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import type { AgentGateService } from './agentGateService.js';
import { LifecycleStepService } from './lifecycleStepService.js';
import { MergeApprovalError, MergeQueueService } from './mergeQueueService.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('MergeQueueService.reconcileMergedLeftovers (Integration)', () => {
  let repo: string;
  let dataDir: string;
  let db: DB;
  let worktrees: WorktreeManager;
  let features: FeatureRepo;
  let svc: MergeQueueService;
  let stackRepo: StackRepo;
  let projectId: string;
  let executions: ExecutionRepo;
  let attention: AttentionRepo;
  let steps: LifecycleStepRepo;

  /** Von Tests gesetzt, die eine lebende Agent-Session brauchen; sonst gibt es keine. */
  let aktiveSession: { exited: boolean; lastOutputAt: number } | undefined;

  const ptysStub = {
    forFeature: () => aktiveSession,
    snapshots: { remove: () => {} },
  } as unknown as PtySessionManager;

  beforeEach(() => {
    aktiveSession = undefined;
    repo = mkdtempSync(join(tmpdir(), 'sdd-mq-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-mq-data-'));
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'app.txt'), 'init\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);

    db = openMemoryDatabase();
    const projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    worktrees = new WorktreeManager(dataDir);
    projectId = projects.create({
      name: 'Demo',
      path: repo,
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;

    executions = new ExecutionRepo(db);
    attention = new AttentionRepo(db);
    steps = new LifecycleStepRepo(db);
    stackRepo = new StackRepo(db);
    mkdirSync(join(dataDir, 'logs'), { recursive: true });

    svc = new MergeQueueService({
      stackRepo,
      projects,
      features,
      queue: new QueueRepo(db),
      executions,
      attention,
      settings: new SettingsRepo(db),
      worktrees,
      ptys: ptysStub,
      agentGate: {} as unknown as AgentGateService,
      // Echter Service: die Stufen-Auslöser laufen im Test über den Produktionspfad.
      lifecycleSteps: new LifecycleStepService({ steps, executions, attention, dataDir }),
      dataDir,
    });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  it('räumt Worktree + Branch + DB-worktree_path für ein gemergtes Feature ab', async () => {
    const branch = 'feature/leftover';
    const wt = await worktrees.create({ project: { id: projectId, name: 'Demo' }, projectPath: repo, featureName: 'leftover', branch, defaultBranch: 'main' });
    // Branch ist in main integriert (Merge-Base-Ancestor) — hier: keine eigenen Commits.
    const feature = features.create({
      projectId,
      name: 'leftover',
      branch,
      worktreePath: wt,
      phases: {},
      integration: 'merged',
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    expect(existsSync(wt)).toBe(true);

    await svc.reconcileMergedLeftovers();

    expect(existsSync(wt)).toBe(false);
    await expect(new MergeEngine().branchExists(repo, branch)).resolves.toBe(false);
    expect(features.get(feature.id)?.worktreePath).toBeNull();
  });

  it('deleteFeature entfernt Worktree, Branch UND alle DB-Spuren (auch ein ungemergtes Feature)', async () => {
    const attention = new AttentionRepo(db);
    const executions = new ExecutionRepo(db);
    const branch = 'feature/wegdamit';
    const wt = await worktrees.create({ project: { id: projectId, name: 'Demo' }, projectPath: repo, featureName: 'wegdamit', branch, defaultBranch: 'main' });
    const feature = features.create({
      projectId,
      name: 'wegdamit',
      branch,
      worktreePath: wt,
      phases: {},
      integration: 'none', // fälschlich angelegt, NICHT gemergt — trotzdem restlos löschbar
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    // Spuren erzeugen: offenes Attention-Item + Lauf-Log auf der Platte.
    attention.raise({ kind: 'agent_errored', projectId, featureId: feature.id, sessionId: null, message: 'x' });
    const exId = executions.start({ projectId, featureId: feature.id, kind: 'phase', phase: 'specify', logPath: 'x' });
    mkdirSync(join(dataDir, 'logs'), { recursive: true });
    const logFile = join(dataDir, 'logs', `${exId}.log`);
    writeFileSync(logFile, 'log');
    expect(existsSync(wt)).toBe(true);

    await svc.deleteFeature(feature.id);

    expect(existsSync(wt)).toBe(false); // Worktree weg
    await expect(new MergeEngine().branchExists(repo, branch)).resolves.toBe(false); // Branch weg
    expect(features.get(feature.id)).toBeNull(); // Feature-Row weg
    expect(attention.listOpen().some((a) => a.featureId === feature.id)).toBe(false); // Attention weg
    const exCount = db.prepare('SELECT COUNT(*) c FROM executions WHERE feature_id=?').get(feature.id) as { c: number };
    expect(exCount.c).toBe(0); // Execution-Zeile weg
    expect(existsSync(logFile)).toBe(false); // Lauf-Log auf Platte weg
  });

  it('lässt einen NICHT integrierten Branch stehen (kein Datenverlust)', async () => {
    const branch = 'feature/unmerged';
    const wt = await worktrees.create({ project: { id: projectId, name: 'Demo' }, projectPath: repo, featureName: 'unmerged', branch, defaultBranch: 'main' });
    // Eigener, nicht nach main gemergter Commit → Branch darf nicht gelöscht werden.
    writeFileSync(join(wt, 'only-here.txt'), 'x\n');
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', 'nur im Feature']);
    const feature = features.create({
      projectId,
      name: 'unmerged',
      branch,
      worktreePath: wt,
      phases: {},
      integration: 'merged', // fälschlich als merged markiert
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });

    await svc.reconcileMergedLeftovers();

    // Sicherheitsverhalten: nicht in main integriert → GAR NICHT anfassen.
    // Worktree, Branch und DB-worktree_path bleiben unverändert.
    expect(existsSync(wt)).toBe(true);
    expect(features.get(feature.id)?.worktreePath).toBe(wt);
    await expect(new MergeEngine().branchExists(repo, branch)).resolves.toBe(true);
  });

  // ---------- approveForMerge: Zielwahl, Validierung, Reviewer-Edits ----------

  async function makeReviewReadyFeature(name: string) {
    const branch = `feature/${name}`;
    const wt = await worktrees.create({ project: { id: projectId, name: 'Demo' }, projectPath: repo, featureName: name, branch, defaultBranch: 'main' });
    writeFileSync(join(wt, `${name}.txt`), `${name}\n`);
    sh(wt, ['add', '-A']);
    sh(wt, ['commit', '-m', `feat ${name}`]);
    const feature = features.create({
      projectId,
      name,
      branch,
      worktreePath: wt,
      phases: {},
      integration: 'none',
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    features.setIntegration(feature.id, 'awaiting_human_review');
    return { feature: features.get(feature.id)!, wt, branch };
  }

  async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error('Timeout beim Warten auf Bedingung');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('approveForMerge validiert Zielwahl (Name, Existenz, Feature-Branch, Stage)', async () => {
    const { feature, branch } = await makeReviewReadyFeature('val');
    await expect(svc.approveForMerge(feature.id, { targetBranch: 'mit space' })).rejects.toThrow(MergeApprovalError);
    await expect(svc.approveForMerge(feature.id, { targetBranch: branch })).rejects.toThrow(/Feature-Branch/);
    await expect(svc.approveForMerge(feature.id, { targetBranch: 'gibts/nicht' })).rejects.toThrow(/existiert nicht/);
    sh(repo, ['branch', 'schon-da']);
    await expect(
      svc.approveForMerge(feature.id, { targetBranch: 'schon-da', createBranch: true }),
    ).rejects.toThrow(/existiert bereits/);

    features.setIntegration(feature.id, 'none');
    await expect(svc.approveForMerge(feature.id)).rejects.toThrow(/nicht prüfbereit/);
  });

  it('approveForMerge mit createBranch merged in neuen Ziel-Branch; main bleibt unberührt', async () => {
    const { feature, branch } = await makeReviewReadyFeature('neuziel');
    const mainBefore = sh(repo, ['rev-parse', 'main']).trim();

    await svc.approveForMerge(feature.id, { targetBranch: 'integration/neuziel', createBranch: true });
    expect(features.get(feature.id)?.integrationTarget).toBe('integration/neuziel');
    await waitFor(() => features.get(feature.id)?.integration === 'merged');

    // Feature-Commits liegen im Ziel, main und Haupt-Checkout unverändert.
    expect(sh(repo, ['log', 'integration/neuziel', '--format=%s'])).toContain('feat neuziel');
    expect(sh(repo, ['rev-parse', 'main']).trim()).toBe(mainBefore);
    // Cleanup lief gegen das Ziel (nicht gegen main): Feature-Branch ist weg.
    await expect(new MergeEngine().branchExists(repo, branch)).resolves.toBe(false);
  });

  it('approveForMerge normalisiert Default-Ziel zu NULL und committet Reviewer-Edits', async () => {
    const { feature, wt } = await makeReviewReadyFeature('edits');
    // Portal-Edit: uncommittete Reviewer-Korrektur im Worktree.
    writeFileSync(join(wt, 'edits.txt'), 'reviewer-korrektur\n');

    await svc.approveForMerge(feature.id, { targetBranch: 'main' });
    expect(features.get(feature.id)?.integrationTarget).toBeNull();
    await waitFor(() => features.get(feature.id)?.integration === 'merged');

    const log = sh(repo, ['log', 'main', '--format=%s']);
    expect(log).toContain('review(edits): reviewer-korrekturen');
    expect(sh(repo, ['show', 'main:edits.txt'])).toContain('reviewer-korrektur');
  });

  // ---------- beginIntegration: Vorprüfungen vor jeder Wirkung (FR-004/FR-027) ----------

  /** Worktree ohne eigene Commits und ohne Änderungen — es gibt nichts zu integrieren. */
  async function makeEmptyFeature(name: string) {
    const branch = `feature/${name}`;
    const wt = await worktrees.create({ project: { id: projectId, name: 'Demo' }, projectPath: repo, featureName: name, branch, defaultBranch: 'main' });
    const feature = features.create({
      projectId,
      name,
      branch,
      worktreePath: wt,
      phases: {},
      integration: 'none',
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    return { feature, wt };
  }

  it('lehnt einen änderungsfreien Branch ab, OHNE Zustand oder Worktree anzufassen', async () => {
    const { feature, wt } = await makeEmptyFeature('leer');
    const headBefore = sh(wt, ['rev-parse', 'HEAD']).trim();
    const svcInternals = svc as unknown as Record<string, () => unknown>;
    const reconcile = vi.spyOn(svcInternals, 'reconcile');
    const setStage = vi.spyOn(svcInternals, 'setStage');
    const commitWorktree = vi.spyOn(svcInternals, 'commitWorktree');

    const result = await svc.beginIntegration(feature.id);

    expect(result).toEqual({ started: false, reason: ACTION_REASON.noChanges });
    // Die Prüfung liegt VOR reconcile(), setStage() und commitWorktree().
    expect(reconcile).not.toHaveBeenCalled();
    expect(setStage).not.toHaveBeenCalled();
    expect(commitWorktree).not.toHaveBeenCalled();
    // Und damit: kein Zustandswechsel, nichts festgeschrieben.
    expect(features.get(feature.id)?.integration).toBe('none');
    expect(sh(wt, ['rev-parse', 'HEAD']).trim()).toBe(headBefore);
    expect(sh(wt, ['status', '--porcelain'])).toBe('');
  });

  it('ein änderungsfreier Branch landet NICHT über reconcile() auf merged (SC-003)', async () => {
    const { feature } = await makeEmptyFeature('kein-zweiter-weg');
    // Der Branch ist trivialer Vorfahre von main — reconcile() würde ihn als
    // „bereits gemergt" erkennen und finalizeMerged() aufrufen. Die Vorprüfung
    // verhindert genau diesen zweiten Weg in den Endzustand.
    await svc.beginIntegration(feature.id);
    expect(features.get(feature.id)?.integration).toBe('none');
  });

  it('schreibt uncommittete Arbeit VOR dem Merged-Abgleich fest (Regression)', async () => {
    // Der Normalfall am Ende von implement: das Ergebnis liegt uncommittet im
    // Worktree, festgeschrieben wird es von commitWorktree(). Lief reconcile()
    // zuerst, hatte der Branch keinen eigenen Commit, galt als trivialer Vorfahre
    // von main — also als „bereits gemergt" — und eskalierte wegen der
    // uncommitteten Dateien, ohne dass je committet wurde. Sackgasse für JEDES
    // Feature (am 26.07.2026 dreimal in Folge beobachtet).
    const branch = 'feature/uncommittet';
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'uncommittet',
      branch,
      defaultBranch: 'main',
    });
    writeFileSync(join(wt, 'implementierung.txt'), 'fertige arbeit\n');
    const feature = features.create({
      projectId,
      name: 'uncommittet',
      branch,
      worktreePath: wt,
      phases: {},
      integration: 'none',
      automation: { autoReviewAgents: false, autoMerge: false, manualTestGate: false },
      tasksDone: 0,
      tasksTotal: 0,
    });

    await svc.beginIntegration(feature.id);

    expect(features.get(feature.id)?.integration).toBe('awaiting_human_review');
    expect(sh(wt, ['status', '--porcelain'])).toBe('');
    expect(sh(wt, ['log', '--oneline', 'main..HEAD']).trim()).not.toBe('');
  });

  // Regression zum 27.07.2026: Ein Feature lief komplett durch die Pipeline und trug
  // im Commit ausschliesslich Markdown — die implement-Phase war fälschlich als
  // abgeschlossen verbucht. Verifikation und Review-Gate konnten das nicht sehen
  // (dieselben Tests wie auf main). Einziges Signal war 0 von 56 erledigten Tasks.
  it('lehnt die Integration ab, wenn kein einziger Task erledigt ist', async () => {
    const branch = 'feature/keine-tasks-erledigt';
    const wt = await worktrees.create({
      project: { id: projectId, name: 'Demo' },
      projectPath: repo,
      featureName: 'keine-tasks-erledigt',
      branch,
      defaultBranch: 'main',
    });
    writeFileSync(join(wt, 'nur-spec.md'), '# Spezifikation, kein Code\n');
    const feature = features.create({
      projectId,
      name: 'keine-tasks-erledigt',
      branch,
      worktreePath: wt,
      phases: {},
      integration: 'none',
      automation: { autoReviewAgents: false, autoMerge: false, manualTestGate: false },
      tasksDone: 0,
      tasksTotal: 56,
    });

    const result = await svc.beginIntegration(feature.id);

    expect(result).toEqual({ started: false, reason: ACTION_REASON.noTasksDone });
    expect(features.get(feature.id)?.integration).toBe('none'); // nichts angefasst
    expect(sh(wt, ['status', '--porcelain'])).not.toBe(''); // auch nicht committet
  });

  it('lässt ein Feature mit mindestens einem erledigten Task durch', async () => {
    const { feature } = await makeReviewReadyFeature('teilweise-erledigt');
    features.setIntegration(feature.id, 'none');
    features.setTasks(feature.id, 1, 56);
    const result = await svc.beginIntegration(feature.id);
    expect(result.started).toBe(true);
  });

  /**
   * Befund A12 (30.07.2026): eine implement-Phase galt nach 30 s als fertig und
   * freigegeben, während der Agent noch 37 Minuten weiterarbeitete. Der automatische
   * Integrationsstart wurde damals nur zufällig aufgehalten (0 von 50 Aufgaben
   * erledigt) — mit einer einzigen abgehakten Aufgabe hätte die Strecke committet und
   * gemergt, während der Agent dieselben Dateien schrieb. Das ist die Konstellation
   * des Datenverlusts vom 24.07.2026.
   */
  describe('integriert nicht, während der Agent noch schreibt', () => {
    it('lehnt den Start ab, solange Ausgabe fliesst — und lässt die Tür offen', async () => {
      const { feature, wt } = await makeReviewReadyFeature('agent-schreibt-noch');
      features.setIntegration(feature.id, 'none');
      features.setTasks(feature.id, 12, 50);
      // Arbeit mitten im Schreiben — genau das darf die Integration nicht festschreiben.
      writeFileSync(join(wt, 'halbfertig.txt'), 'Zeile 1\n');
      aktiveSession = { exited: false, lastOutputAt: Date.now() };

      const result = await svc.beginIntegration(feature.id);

      expect(result.started).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.reason).toContain('arbeitet noch');
      expect(features.get(feature.id)?.integration).toBe('none'); // Zustand unberührt
      expect(sh(wt, ['status', '--porcelain'])).toContain('halbfertig.txt'); // NICHT committet
    });

    it('lässt durch, sobald die Ausgabe lange genug ruht', async () => {
      const { feature } = await makeReviewReadyFeature('agent-ist-still');
      features.setIntegration(feature.id, 'none');
      features.setTasks(feature.id, 12, 50);
      aktiveSession = { exited: false, lastOutputAt: Date.now() - 60_000 };

      expect((await svc.beginIntegration(feature.id)).started).toBe(true);
    });

    it('lässt durch, wenn die Session beendet ist', async () => {
      const { feature } = await makeReviewReadyFeature('session-beendet');
      features.setIntegration(feature.id, 'none');
      features.setTasks(feature.id, 12, 50);
      aktiveSession = { exited: true, lastOutputAt: Date.now() };

      expect((await svc.beginIntegration(feature.id)).started).toBe(true);
    });

    it('lässt durch, wenn nie Ausgabe kam (frische Session ohne Arbeit)', async () => {
      const { feature } = await makeReviewReadyFeature('nie-ausgabe');
      features.setIntegration(feature.id, 'none');
      features.setTasks(feature.id, 12, 50);
      aktiveSession = { exited: false, lastOutputAt: 0 };

      expect((await svc.beginIntegration(feature.id)).started).toBe(true);
    });
  });

  it('lehnt ein bereits integrierendes Feature ab', async () => {
    const { feature } = await makeReviewReadyFeature('schon-drin');
    const result = await svc.beginIntegration(feature.id);
    expect(result.started).toBe(false);
    expect(result.reason).toContain('bereits in der Integration');
    expect(features.get(feature.id)?.integration).toBe('awaiting_human_review');
  });

  it('lehnt ein Feature ohne Arbeitsverzeichnis ab', async () => {
    const { feature } = await makeEmptyFeature('kein-worktree');
    features.setWorktree(feature.id, null);
    const result = await svc.beginIntegration(feature.id);
    expect(result).toEqual({ started: false, reason: ACTION_REASON.noWorktree });
  });

  it('startet die Integration eines Features mit Änderungen', async () => {
    const { feature } = await makeReviewReadyFeature('mit-arbeit');
    features.setIntegration(feature.id, 'none'); // makeReviewReadyFeature setzt awaiting_human_review
    const result = await svc.beginIntegration(feature.id);
    expect(result.started).toBe(true);
    expect(features.get(feature.id)?.integration).not.toBe('none');
  });

  it('reject: setIntegrationTarget(null) macht die Zielwahl rückgängig', async () => {
    const { feature } = await makeReviewReadyFeature('zurueck');
    features.setIntegrationTarget(feature.id, 'integration/alt');
    expect(features.get(feature.id)?.integrationTarget).toBe('integration/alt');
    features.setIntegrationTarget(feature.id, null);
    expect(features.get(feature.id)?.integrationTarget).toBeNull();
  });

  // ---------- US5: Lebenszyklus-Schritte an den Stufen der Pipeline ----------

  /** Marker-Datei außerhalb des Worktrees — sie überlebt das Cleanup der letzten Stufe. */
  // ---------- Manuelles Test-Gate (US3, FR-024 – FR-029) ----------

  /** Wie makeManualFeature, aber MIT eingeschaltetem Gate. */
  async function makeGatedFeature(name: string) {
    const { feature } = await makeReviewReadyFeature(name);
    features.setIntegration(feature.id, 'none');
    features.setAutomation(feature.id, { autoReviewAgents: false, autoMerge: false, manualTestGate: true });
    return features.get(feature.id)!;
  }

  /** Alle Schritte freigegeben — Ausgangslage für den Rücksprung auf `specify`. */
  function approvedPhases(): PhaseMap {
    const enabled: FeaturePhase[] = ['specify', 'plan', 'implement'];
    const map = initialPhases(enabled);
    for (const p of enabled) map[p] = { ...map[p]!, status: 'approved' };
    return map;
  }

  it('hält bei eingeschaltetem Gate auf der Abnahme an — VOR dem Review (FR-024)', async () => {
    const feature = await makeGatedFeature('gate-an');

    await svc.beginIntegration(feature.id);

    expect(features.get(feature.id)?.integration).toBe('awaiting_manual_test');
    // Die Review-Meldung entsteht NICHT: der Mensch ist noch nicht beim Review.
    expect(attention.listOpen(projectId).some((i) => i.kind === 'review_due')).toBe(false);
    expect(attention.listOpen(projectId).some((i) => i.kind === 'manual_test_due')).toBe(true);
  });

  it('nennt in der Meldung, dass keine Adresse erreichbar ist (FR-033)', async () => {
    const feature = await makeGatedFeature('gate-adresse');
    await svc.beginIntegration(feature.id);
    const item = attention.listOpen(projectId).find((i) => i.kind === 'manual_test_due');
    expect(item?.message).toContain('wartet auf manuelle Abnahme');
    expect(item?.message).toContain('keine erreichbare Adresse');
  });

  /** FR-027: Gate aus ⇒ der Ablauf ist unverändert. */
  it('betritt die Stufe bei ausgeschaltetem Gate nicht (FR-027)', async () => {
    const feature = await makeManualFeature('gate-aus');

    await svc.beginIntegration(feature.id);

    expect(features.get(feature.id)?.integration).toBe('awaiting_human_review');
    expect(attention.listOpen(projectId).some((i) => i.kind === 'manual_test_due')).toBe(false);
  });

  it('führt die Schritte der Stufe „Manuelle Abnahme" aus', async () => {
    const feature = await makeGatedFeature('gate-schritte');
    addMarkerStep('before_stage', 'manual_test', 'vor-abnahme');

    await svc.beginIntegration(feature.id);

    expect(trail()).toEqual(['vor-abnahme']);
  });

  it('bestätigt die Abnahme und führt danach zum Review (FR-028)', async () => {
    const feature = await makeGatedFeature('gate-ok');
    addMarkerStep('after_stage', 'manual_test', 'nach-abnahme');
    await svc.beginIntegration(feature.id);

    await svc.confirmManualTest(feature.id);

    expect(features.get(feature.id)?.integration).toBe('awaiting_human_review');
    expect(trail()).toEqual(['nach-abnahme']);
    expect(attention.listOpen(projectId).some((i) => i.kind === 'manual_test_due')).toBe(false);
    expect(attention.listOpen(projectId).some((i) => i.kind === 'review_due')).toBe(true);
  });

  it('lehnt die Bestätigung auf jeder anderen Stufe ab', async () => {
    const feature = await makeManualFeature('gate-falsch');
    await expect(svc.confirmManualTest(feature.id)).rejects.toThrow(/wartet nicht auf eine manuelle Abnahme/);
  });

  /**
   * FR-029, neu ab 31.07.2026: zurück auf `specify`, nicht nach `implement`.
   * Ein Feature erreicht die Abnahme nur nach Verifikation UND Review-Gate — was
   * danach beim Durchklicken auffällt, ist eine Aussage über die Absicht.
   */
  it('setzt eine Ablehnung auf specify zurück und entwertet alles Nachgelagerte', async () => {
    const feature = await makeGatedFeature('gate-nein');
    features.savePhases(feature.id, approvedPhases());
    await svc.beginIntegration(feature.id);

    await svc.rejectManualTest(feature.id, { comment: 'Der Knopf tut nichts.' });

    const fresh = features.get(feature.id)!;
    expect(fresh.integration).toBe('none');
    expect(fresh.reviewRejectedAt).not.toBeNull();
    expect(fresh.phases.specify?.status).toBe('idle');
    expect(fresh.phases.implement?.stale).toBe(true);
    expect(attention.listOpen(projectId).some((i) => i.kind === 'manual_test_due')).toBe(false);
  });

  it('legt die Befunde an und startet den specify-Lauf mit dem kompilierten Auftrag', async () => {
    const started: { phase: string; prompt?: string }[] = [];
    svc.attachRework({
      startPhaseRun: async (_id, phase, extraPrompt) => {
        started.push({ phase, prompt: extraPrompt });
        return { gateRunning: false };
      },
    });
    const feature = await makeGatedFeature('gate-befunde');
    features.savePhases(feature.id, approvedPhases());
    await svc.beginIntegration(feature.id);

    await svc.rejectManualTest(feature.id, {
      comment: 'sonst in Ordnung',
      findings: [
        { where: 'Board → Karte öffnen', text: 'öffnet die Konsole', severity: 'blocker' },
        { where: null, text: 'Speichern bleibt aktiv', severity: 'rework' },
      ],
    });

    expect(stackRepo.openFindingsFor(feature.id)).toHaveLength(2);
    expect(started).toHaveLength(1);
    expect(started[0]!.phase).toBe('specify');
    // Der Auftrag trägt die Befunde und die Anweisung, die Spezifikation zu
    // ergänzen statt neu zu schreiben — sonst wäre der Befund nach einer Runde weg.
    expect(started[0]!.prompt).toContain('Board → Karte öffnen');
    expect(started[0]!.prompt).toContain('BESTEHENDE Spezifikation');
  });

  it('sperrt die Annahme, solange ein Blocker aus einer früheren Runde offen ist', async () => {
    const feature = await makeGatedFeature('gate-blocker');
    await svc.beginIntegration(feature.id);
    stackRepo.addFinding({
      featureId: feature.id,
      round: 1,
      where: null,
      text: 'kippt beim Speichern um',
      severity: 'blocker',
      createdAt: Date.now(),
    });

    await expect(svc.confirmManualTest(feature.id)).rejects.toThrow(/Blocker/);
    expect(features.get(feature.id)?.integration).toBe('awaiting_manual_test');
  });

  it('verlangt bei der Ablehnung einen Befund oder eine Anmerkung', async () => {
    const feature = await makeGatedFeature('gate-ohne-grund');
    await svc.beginIntegration(feature.id);
    await expect(svc.rejectManualTest(feature.id, { comment: '   ' })).rejects.toThrow(
      /Befund oder eine Anmerkung/,
    );
    expect(features.get(feature.id)?.integration).toBe('awaiting_manual_test');
  });

  /**
   * Edge Case: das Einschalten des Gates schiebt ein Feature, das schon auf
   * Review wartet, NICHT zurück — der Schalter wird beim Durchlauf gelesen.
   */
  it('schiebt ein Feature auf awaiting_human_review nicht rückwärts', async () => {
    const { feature } = await makeReviewReadyFeature('kein-rueckwaerts');
    features.setAutomation(feature.id, { manualTestGate: true });

    expect(features.get(feature.id)?.integration).toBe('awaiting_human_review');
    await svc.beginIntegration(feature.id).catch(() => {});
    expect(features.get(feature.id)?.integration).toBe('awaiting_human_review');
  });

  // ---------- Aufräumen mit Nachweis (US4, FR-034 – FR-037) ----------

  it('leert den Worktree-Pfad NICHT, wenn das Entfernen scheitert (FR-035, SC-004)', async () => {
    const { feature, wt } = await makeReviewReadyFeature('haelt-fest');
    features.setIntegration(feature.id, 'merged');
    // Entfernen scheitert: das Verzeichnis bleibt bestehen.
    const spy = vi.spyOn(worktrees, 'remove').mockRejectedValue(new Error('Prozess hält das Verzeichnis'));

    const result = await svc.retryCleanup(feature.id);

    expect(result.cleaned).toBe(false);
    expect(features.get(feature.id)?.worktreePath).toBe(wt);
    expect(features.get(feature.id)?.cleanupError).toContain('Prozess hält das Verzeichnis');
    expect(attention.listOpen(projectId).some((i) => i.kind === 'worktree_cleanup_failed')).toBe(true);
    spy.mockRestore();
  });

  it('nennt in der Meldung den Grund und den bleibenden Ordner', async () => {
    const { feature, wt } = await makeReviewReadyFeature('meldung');
    features.setIntegration(feature.id, 'merged');
    const spy = vi.spyOn(worktrees, 'remove').mockRejectedValue(new Error('kaputt'));

    await svc.retryCleanup(feature.id);

    const item = attention.listOpen(projectId).find((i) => i.kind === 'worktree_cleanup_failed');
    expect(item?.message).toContain('kaputt');
    expect(item?.message).toContain(wt);
    spy.mockRestore();
  });

  /** FR-036/FR-037: der Pfad wird erst nach nachgewiesenem Entfernen geleert. */
  it('läuft nach Beheben der Ursache zu Ende und leert den Pfad erst danach', async () => {
    const { feature } = await makeReviewReadyFeature('wiederholung');
    features.setIntegration(feature.id, 'merged');
    const spy = vi.spyOn(worktrees, 'remove').mockRejectedValue(new Error('noch nicht'));
    await svc.retryCleanup(feature.id);
    expect(features.get(feature.id)?.worktreePath).not.toBeNull();

    spy.mockRestore();
    const result = await svc.retryCleanup(feature.id);

    expect(result.cleaned).toBe(true);
    expect(result.worktreePath).toBeNull();
    expect(result.cleanupError).toBeNull();
    expect(attention.listOpen(projectId).some((i) => i.kind === 'worktree_cleanup_failed')).toBe(false);
  });

  it('meldet erneutes Scheitern als Ergebnis, nicht als Fehler', async () => {
    const { feature, wt } = await makeReviewReadyFeature('nochmal-nein');
    features.setIntegration(feature.id, 'merged');
    const spy = vi.spyOn(worktrees, 'remove').mockRejectedValue(new Error('haelt weiter'));

    await svc.retryCleanup(feature.id);
    const result = await svc.retryCleanup(feature.id);

    expect(result.cleaned).toBe(false);
    expect(result.worktreePath).toBe(wt);
    expect(result.cleanupError).toContain('haelt weiter');
    spy.mockRestore();
  });

  it('räumt bei erfolgreichem Entfernen wie bisher ab', async () => {
    const { feature, wt } = await makeReviewReadyFeature('klappt');
    features.setIntegration(feature.id, 'merged');

    await svc.retryCleanup(feature.id);

    expect(existsSync(wt)).toBe(false);
    expect(features.get(feature.id)?.worktreePath).toBeNull();
    expect(features.get(feature.id)?.cleanupError).toBeNull();
  });

  function markerPath(): string {
    return join(dataDir, 'ablauf.txt');
  }

  function trail(): string[] {
    const p = markerPath();
    return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : [];
  }

  /** Schritt, der beim Laufen seine Marke anhängt — daraus wird die Reihenfolge lesbar. */
  function addMarkerStep(
    kind: 'before_stage' | 'after_stage',
    stage: LifecycleStageId,
    mark: string,
    opts: { blocking?: boolean; command?: string } = {},
  ): void {
    steps.upsert({
      projectId,
      name: `${kind}:${stage}`,
      command: opts.command ?? `echo "${mark}" >> "${markerPath()}"`,
      trigger: { kind, stage },
      blocking: opts.blocking ?? true,
      timeoutMs: 60_000,
      enabled: true,
      sortOrder: 0,
    });
  }

  function stepRuns(featureId: string) {
    return executions.list(featureId).filter((e) => e.kind === 'lifecycle_step');
  }

  function stepItems() {
    return attention.listOpen(projectId).filter((i) => i.kind === 'lifecycle_step_failed');
  }

  /** Prüfbereites Feature mit ausgeschalteter Automation — der Weg endet im Human-Review. */
  async function makeManualFeature(name: string) {
    const { feature } = await makeReviewReadyFeature(name);
    features.setIntegration(feature.id, 'none');
    features.setAutomation(feature.id, { autoReviewAgents: false, autoMerge: false, manualTestGate: false });
    return features.get(feature.id)!;
  }

  it('führt je Stufe die Schritte vor der Arbeit und nach dem Erfolg aus', async () => {
    const feature = await makeManualFeature('stufen');
    addMarkerStep('before_stage', 'verify', 'vor-verify');
    addMarkerStep('after_stage', 'verify', 'nach-verify');
    addMarkerStep('before_stage', 'human_review', 'vor-human');

    await svc.beginIntegration(feature.id);

    // Reihenfolge ist die der Pipeline — nicht die der Konfiguration.
    expect(trail()).toEqual(['vor-verify', 'nach-verify', 'vor-human']);
    expect(features.get(feature.id)?.integration).toBe('awaiting_human_review');
    const runs = stepRuns(feature.id);
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.status === 'succeeded' && r.exitCode === 0)).toBe(true);
    expect(runs.map((r) => r.label).sort()).toEqual([
      'after_stage:verify',
      'before_stage:human_review',
      'before_stage:verify',
    ]);
  });

  it('ein blockierender Fehlschlag hält die Stufe an: kein Stufenwechsel, ein Inbox-Item', async () => {
    const feature = await makeManualFeature('halt');
    addMarkerStep('before_stage', 'verify', 'vor-verify');
    addMarkerStep('before_stage', 'human_review', 'nie', { command: 'echo "zeile a"; exit 3' });
    addMarkerStep('after_stage', 'human_review', 'auch-nie');

    const result = await svc.beginIntegration(feature.id);

    expect(result.started).toBe(true);
    // Die Übergabe an den Menschen unterbleibt — und damit auch die Review-Meldung.
    // Worum es hier geht: die Stufe wechselt NICHT zu `awaiting_human_review`. Der Name der
    // Zwischenstufe hat sich am 30.07.2026 geändert: das Testprojekt hat keine
    // `verifyCommands`, und seit „Ehrlichkeit vor dem Merge" heisst dieser Zustand ehrlich
    // `verification_unconfigured` statt `verifying` — ungeprüft darf nicht wie geprüft aussehen.
    expect(features.get(feature.id)?.integration).not.toBe('awaiting_human_review');
    expect(features.get(feature.id)?.integration).toBe('verification_unconfigured');
    expect(trail()).toEqual(['vor-verify']);
    expect(attention.listOpen(projectId).some((i) => i.kind === 'review_due')).toBe(false);
    const items = stepItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toContain('exit 3');
    expect(items[0]!.message).toContain('zeile a');
  });

  it('ein beratender Fehlschlag hält nichts an und erzeugt kein Inbox-Item', async () => {
    const feature = await makeManualFeature('beratend');
    addMarkerStep('before_stage', 'human_review', 'egal', { command: 'exit 3', blocking: false });

    await svc.beginIntegration(feature.id);

    expect(features.get(feature.id)?.integration).toBe('awaiting_human_review');
    expect(stepRuns(feature.id)[0]?.status).toBe('failed');
    expect(stepItems()).toHaveLength(0);
  });

  it('umschließt Merge und Cleanup: nach Merge-Queue, vor Abschluss (Worktree), nach Abschluss (Haupt-Checkout)', async () => {
    const { feature } = await makeReviewReadyFeature('merge-stufen');
    addMarkerStep('before_stage', 'merge_queue', 'vor-merge');
    addMarkerStep('after_stage', 'merge_queue', 'nach-merge');
    // Der Worktree steht hier noch — das ist die letzte Gelegenheit, in ihm zu arbeiten.
    addMarkerStep('before_stage', 'merged', 'x', {
      command: `test -d "$SDD_WORKTREE" && echo "vor-abschluss-im-worktree" >> "${markerPath()}"`,
    });
    // Nach dem Cleanup ist der Worktree weg — der Schritt läuft im Haupt-Checkout.
    addMarkerStep('after_stage', 'merged', 'x', {
      command: `echo "nach-abschluss:$PWD" >> "${markerPath()}"`,
    });

    await svc.approveForMerge(feature.id, { targetBranch: 'main' });
    await waitFor(() => features.get(feature.id)?.integration === 'merged');

    expect(trail()).toEqual([
      'vor-merge',
      'nach-merge',
      'vor-abschluss-im-worktree',
      `nach-abschluss:${realpathSync(repo)}`,
    ]);
  });

  it('after_stage:merged mit exit 1 lässt den Merge bestehen, verhindert aber den Abschluss-Vermerk', async () => {
    const { feature, wt } = await makeReviewReadyFeature('kein-vermerk');
    addMarkerStep('after_stage', 'merged', 'x', { command: 'exit 1' });

    await svc.approveForMerge(feature.id, { targetBranch: 'main' });
    await waitFor(() => stepItems().length > 0);

    // Der Merge ist erfolgt und das Cleanup gelaufen — nur der Abschluss fehlt.
    expect(sh(repo, ['log', 'main', '--format=%s'])).toContain('feat kein-vermerk');
    expect(existsSync(wt)).toBe(false);
    expect(features.get(feature.id)?.integration).not.toBe('merged');
    expect(stepItems()).toHaveLength(1);
  });
});
