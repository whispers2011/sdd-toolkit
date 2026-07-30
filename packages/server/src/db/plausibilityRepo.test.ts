import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialPhases } from '@sdd/shared';
import { openMemoryDatabase, type DB } from './database.js';
import { FeatureRepo, ProjectRepo } from './repos.js';
import { PlausibilityRepo } from './plausibilityRepo.js';

describe('PlausibilityRepo', () => {
  let db: DB;
  let projects: ProjectRepo;
  let features: FeatureRepo;
  let repo: PlausibilityRepo;

  function projekt(name: string): string {
    return projects.create({
      name,
      path: `/tmp/${name}`,
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;
  }

  function feature(projectId: string, name: string): string {
    return features.create({
      projectId,
      name,
      branch: `feature/${name}`,
      worktreePath: null,
      phases: initialPhases([]),
      integration: 'none',
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;
  }

  function lauf(projectId: string, over: Record<string, unknown> = {}): void {
    db.prepare(
      `INSERT INTO executions (id, project_id, feature_id, kind, phase, status, started_at, finished_at, exit_code, log_path)
       VALUES (@id, @project_id, @feature_id, @kind, @phase, @status, 1000, 2000, @exit_code, NULL)`,
    ).run({
      id: `e${Math.random().toString(36).slice(2, 10)}`,
      project_id: projectId,
      feature_id: null,
      kind: 'phase',
      phase: 'implement',
      status: 'succeeded',
      exit_code: 0,
      ...over,
    });
  }

  const stats = (projectId: string) => repo.listProjectStats().find((s) => s.projectId === projectId)!;

  beforeEach(() => {
    db = openMemoryDatabase();
    projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    repo = new PlausibilityRepo(db);
  });

  afterEach(() => db.close());

  // ---------- listProjectStats (Befund C) ----------

  describe('listProjectStats', () => {
    it('liefert für ein Projekt ohne Features 0 aktive Features und newestFeatureAt null (US2-3)', () => {
      const p = projekt('leer');
      expect(stats(p)).toMatchObject({ activeFeatures: 0, newestFeatureAt: null, phaseRuns: 0 });
    });

    it('zählt nur nicht archivierte Features — alles archiviert ⇒ 0 und null (US2-5)', () => {
      const p = projekt('nur-archiv');
      const f = feature(p, 'alt');
      features.archive(f);
      expect(stats(p)).toMatchObject({ activeFeatures: 0, newestFeatureAt: null });
    });

    it('liefert den Zeitstempel des jüngsten nicht archivierten Features', () => {
      const p = projekt('mit-features');
      feature(p, 'eins');
      feature(p, 'zwei');
      const s = stats(p);
      expect(s.activeFeatures).toBe(2);
      expect(s.newestFeatureAt).not.toBeNull();
    });

    it('zählt einen FEHLGESCHLAGENEN Phasenlauf mit — es wird nicht nach Status gefiltert (US2-4)', () => {
      const p = projekt('mit-fehlschlag');
      feature(p, 'eins');
      lauf(p, { status: 'failed', exit_code: 1 });
      expect(stats(p).phaseRuns).toBe(1);
    });

    it('zählt den Lauf eines inzwischen gelöschten Features weiter als „es lief etwas" (Edge Case)', () => {
      const p = projekt('geloeschtes-feature');
      const f = feature(p, 'weg');
      lauf(p, { feature_id: f });
      features.hardDelete(f);
      expect(stats(p)).toMatchObject({ activeFeatures: 0, phaseRuns: 0 });

      // Gegenprobe: ein Lauf, dessen feature_id ins Leere zeigt, zählt weiterhin.
      lauf(p, { feature_id: 'laengst-geloescht' });
      expect(stats(p).phaseRuns).toBe(1);
    });

    it('zählt einen chat_work-Lauf NICHT als Phasenlauf (FR-008)', () => {
      const p = projekt('nur-chat');
      feature(p, 'eins');
      lauf(p, { kind: 'chat_work', phase: null });
      expect(stats(p).phaseRuns).toBe(0);
    });

    it('hält Projekte auseinander', () => {
      const a = projekt('a');
      const b = projekt('b');
      feature(a, 'eins');
      lauf(b);
      expect(stats(a)).toMatchObject({ activeFeatures: 1, phaseRuns: 0 });
      expect(stats(b)).toMatchObject({ activeFeatures: 0, phaseRuns: 1 });
    });
  });

  // ---------- Wasserstand ----------

  describe('getMark / setMark / clearMark', () => {
    it('liefert null, solange nie gemeldet wurde', () => {
      const p = projekt('p');
      expect(repo.getMark('run_unpriced', p, '')).toBeNull();
    });

    it('setzt und liest eine projektweite Marke (featureId "")', () => {
      const p = projekt('p');
      repo.setMark('run_unpriced', p, '', 148, 1_000);
      expect(repo.getMark('run_unpriced', p, '')).toBe(148);
    });

    it('überschreibt eine vorhandene Marke statt zu scheitern (ON CONFLICT DO UPDATE)', () => {
      const p = projekt('p');
      repo.setMark('run_unpriced', p, '', 148, 1_000);
      repo.setMark('run_unpriced', p, '', 160, 2_000);
      expect(repo.getMark('run_unpriced', p, '')).toBe(160);
    });

    it('hält projektweite und featurebezogene Marken auseinander', () => {
      const p = projekt('p');
      const f = feature(p, 'eins');
      repo.setMark('run_unpriced', p, '', 10, 1_000);
      repo.setMark('phase_false_start', p, f, 9, 1_000);
      expect(repo.getMark('run_unpriced', p, '')).toBe(10);
      expect(repo.getMark('phase_false_start', p, f)).toBe(9);
      expect(repo.getMark('phase_false_start', p, '')).toBeNull();
    });

    it('löscht eine Marke', () => {
      const p = projekt('p');
      repo.setMark('run_unpriced', p, '', 5, 1_000);
      repo.clearMark('run_unpriced', p, '');
      expect(repo.getMark('run_unpriced', p, '')).toBeNull();
    });

    it('räumt Marken beim Löschen des Projekts mit ab (ON DELETE CASCADE)', () => {
      const p = projekt('p');
      repo.setMark('run_unpriced', p, '', 5, 1_000);
      projects.remove(p);
      expect(db.prepare('SELECT COUNT(*) AS n FROM plausibility_state').get()).toMatchObject({ n: 0 });
    });

    it('räumt die Marke beim hardDelete eines Features mit ab', () => {
      const p = projekt('p');
      const f = feature(p, 'eins');
      repo.setMark('phase_false_start', p, f, 3, 1_000);
      features.hardDelete(f);
      expect(repo.getMark('phase_false_start', p, f)).toBeNull();
    });
  });
});
