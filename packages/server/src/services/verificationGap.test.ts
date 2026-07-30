import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialPhases, reviewDueMessage, type Feature, type IntegrationStage, type Project } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { AttentionRepo, FeatureRepo, ProjectRepo } from '../db/repos.js';
import { MergeQueueService, type MergeQueueDeps } from './mergeQueueService.js';
import { raiseVerificationGap, resolveVerificationGaps } from './verificationGap.js';

/**
 * Lebensdauer des projektbezogenen Eintrags „keine Verifikation konfiguriert"
 * (FR-004 … FR-007). Die Matrix stammt aus quickstart.md §1 — jede Zeile dort ist
 * hier ein Test, weil die Einmaligkeit weder an einer Stufe noch an einem Feature
 * hängt und damit an keiner anderen Stelle nachweisbar ist.
 */
describe('verificationGap — Lebensdauer des Projekt-Eintrags', () => {
  let db: DB;
  let attention: AttentionRepo;
  let projects: ProjectRepo;
  let features: FeatureRepo;
  let project: Project;

  const KIND = 'verification_unconfigured';
  const open = () => attention.listOpen().filter((i) => i.kind === KIND);
  const projekt = () => projects.get(project.id)!;

  function neuesFeature(name: string, integration: IntegrationStage = 'none'): Feature {
    return features.create({
      projectId: project.id,
      name,
      branch: `feature/${name}`,
      worktreePath: null,
      phases: initialPhases([]),
      integration,
      automation: {},
      optimization: {},
      tasksDone: 1,
      tasksTotal: 2,
    });
  }

  beforeEach(() => {
    db = openMemoryDatabase();
    attention = new AttentionRepo(db);
    projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    project = projects.create({
      name: 'Ohne Verifikation',
      path: '/tmp/ohne-verify',
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    });
  });

  afterEach(() => db.close());

  it('erster Integrationsversuch erzeugt genau einen offenen Eintrag ohne Feature-Bezug', () => {
    const item = raiseVerificationGap({ attention, project: projekt() });

    expect(item).not.toBeNull();
    expect(open()).toHaveLength(1);
    // Projektbezogen, nicht feature-bezogen (FR-006, R3.2).
    expect(open()[0].featureId).toBeNull();
    expect(open()[0].sessionId).toBeNull();
    expect(open()[0].conversationId).toBeNull();
    expect(open()[0].projectId).toBe(project.id);
    expect(open()[0].message).toBe(
      'Ohne Verifikation: Projekt hat keine Verifikation konfiguriert — Features werden ungeprüft integriert.',
    );
  });

  it('zweiter und dritter Integrationsversuch erzeugen keinen weiteren Eintrag (FR-005)', () => {
    raiseVerificationGap({ attention, project: projekt() });
    expect(raiseVerificationGap({ attention, project: projekt() })).toBeNull();
    expect(raiseVerificationGap({ attention, project: projekt() })).toBeNull();

    expect(open()).toHaveLength(1);
  });

  it('erzeugt nichts für ein Projekt, das Verifikationskommandos hat', () => {
    projects.update(project.id, { verifyCommands: [{ name: 'test', command: 'pnpm test' }] });
    expect(raiseVerificationGap({ attention, project: projekt() })).toBeNull();
    expect(open()).toHaveLength(0);
  });

  it('lässt den Eintrag stehen, während das Feature bis merged wandert (FR-006)', () => {
    const feature = neuesFeature('wandert', 'awaiting_human_review');
    raiseVerificationGap({ attention, project: projekt() });

    // Die stufengekoppelte Bereinigung läuft in setStage() — sie darf den
    // projektbezogenen Eintrag nicht mitnehmen.
    const svc = new MergeQueueService({
      projects,
      features,
      attention,
      queue: {} as unknown,
      executions: {} as unknown,
      settings: {} as unknown,
      worktrees: {} as unknown,
      ptys: {} as unknown,
      reviewGate: {} as unknown,
      dataDir: '/tmp',
    } as unknown as MergeQueueDeps);
    const setStage = (s: IntegrationStage) =>
      (svc as unknown as { setStage(f: Feature, s: IntegrationStage): void }).setStage(feature, s);

    for (const stage of ['verification_unconfigured', 'queued', 'merging', 'merged'] as const) {
      setStage(stage);
      expect(open(), `Eintrag verschwand bei Stufe ${stage}`).toHaveLength(1);
    }
  });

  it('löst den Eintrag ohne Abhaken auf, sobald ein Verifikationskommando konfiguriert ist (FR-007)', () => {
    const item = raiseVerificationGap({ attention, project: projekt() })!;
    projects.update(project.id, { verifyCommands: [{ name: 'test', command: 'pnpm test' }] });

    const resolved = resolveVerificationGaps({ attention, projects });

    expect(resolved).toEqual([item.id]);
    expect(open()).toHaveLength(0);
  });

  it('meldet beim Reconcile nichts, wenn die Lücke weiter besteht', () => {
    raiseVerificationGap({ attention, project: projekt() });
    expect(resolveVerificationGaps({ attention, projects })).toEqual([]);
    expect(open()).toHaveLength(1);
  });

  it('meldet einen bereits aufgelösten Eintrag nicht erneut als aufgelöst', () => {
    raiseVerificationGap({ attention, project: projekt() });
    projects.update(project.id, { verifyCommands: [{ name: 'test', command: 'pnpm test' }] });

    expect(resolveVerificationGaps({ attention, projects })).toHaveLength(1);
    expect(resolveVerificationGaps({ attention, projects })).toEqual([]);
  });

  it('abgehakt und weiterhin unkonfiguriert: kein neuer Eintrag (Clarification)', () => {
    const item = raiseVerificationGap({ attention, project: projekt() })!;
    attention.resolve(item.id);

    // Wer die Meldung wegklickt, verzichtet auf die Erinnerung.
    expect(raiseVerificationGap({ attention, project: projekt() })).toBeNull();
    expect(open()).toHaveLength(0);
  });

  it('abgehakt heißt nicht verifiziert: Stufe und Meldung führen den Zustand weiter (R3.4)', () => {
    const feature = neuesFeature('abgehakt', 'verification_unconfigured');
    const item = raiseVerificationGap({ attention, project: projekt() })!;
    attention.resolve(item.id);

    // Die Stufe hängt an der Projektkonfiguration, nicht am Aufmerksamkeits-Eintrag.
    expect(features.get(feature.id)!.integration).toBe('verification_unconfigured');
    expect(projekt().verifyCommands).toHaveLength(0);
    const meldung = reviewDueMessage(feature, { verificationConfigured: false });
    expect(meldung).toContain('keine Verifikation konfiguriert');
    expect(meldung).not.toContain('verifiziert');
  });

  it('nach Konfigurieren und erneutem Leeren entsteht der Eintrag wieder (Edge Case)', () => {
    raiseVerificationGap({ attention, project: projekt() });
    projects.update(project.id, { verifyCommands: [{ name: 'test', command: 'pnpm test' }] });
    resolveVerificationGaps({ attention, projects });
    projects.update(project.id, { verifyCommands: [] });

    expect(raiseVerificationGap({ attention, project: projekt() })).not.toBeNull();
    expect(open()).toHaveLength(1);
  });

  it('hält Projekte auseinander: die Lücke des einen meldet nicht für das andere', () => {
    const zweites = projects.create({
      name: 'Zweites',
      path: '/tmp/zweites',
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    });
    raiseVerificationGap({ attention, project: projekt() });
    raiseVerificationGap({ attention, project: zweites });
    expect(open()).toHaveLength(2);

    // Nur das konfigurierte Projekt wird aufgelöst.
    projects.update(zweites.id, { verifyCommands: [{ name: 'test', command: 'pnpm test' }] });
    resolveVerificationGaps({ attention, projects });

    expect(open().map((i) => i.projectId)).toEqual([project.id]);
  });
});
