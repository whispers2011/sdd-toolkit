import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialPhases } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo } from '../db/repos.js';
import { PlausibilityRepo } from '../db/plausibilityRepo.js';
import { TELEMETRY_GRACE_MS } from '../telemetry/telemetryStore.js';
import { PlausibilityService } from './plausibilityService.js';

/**
 * Service-Tests der Plausibilitätsprüfung gegen echte Repos und eine In-Memory-DB.
 * Die Regeln selbst liegen in @sdd/shared und sind dort pur getestet — hier geht es
 * um Gruppierung, Bezugsobjekt, Wasserstand und die Zusage „nur beurteilen".
 */
describe('PlausibilityService', () => {
  let db: DB;
  let projects: ProjectRepo;
  let features: FeatureRepo;
  let executions: ExecutionRepo;
  let attention: AttentionRepo;
  let state: PlausibilityRepo;
  let service: PlausibilityService;
  let projectId: string;

  const NOW = 10_000_000_000;
  /** Endgültig gemessen: das Nachtragsfenster ist sicher zu. */
  const ENDGUELTIG = NOW - TELEMETRY_GRACE_MS - 1_000;

  let lfd = 0;

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

  function feature(name: string, over: { projectId?: string } = {}): string {
    return features.create({
      projectId: over.projectId ?? projectId,
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

  /** Lauf mit frei wählbaren Zeitstempeln — die Repo-Methoden setzen Date.now(). */
  function lauf(over: Partial<Record<string, unknown>> = {}): string {
    const id = `run${++lfd}`;
    const row = {
      id,
      project_id: projectId,
      feature_id: null,
      kind: 'phase',
      phase: 'implement',
      status: 'succeeded',
      started_at: ENDGUELTIG - 60_000,
      finished_at: ENDGUELTIG,
      exit_code: 0,
      tokens: null,
      cost_micros: null,
      telemetry_final_at: null,
      ...over,
    };
    db.prepare(
      `INSERT INTO executions (id, project_id, feature_id, kind, phase, status, started_at, finished_at,
         exit_code, tokens, cost_micros, telemetry_final_at, log_path)
       VALUES (@id, @project_id, @feature_id, @kind, @phase, @status, @started_at, @finished_at,
         @exit_code, @tokens, @cost_micros, @telemetry_final_at, NULL)`,
    ).run(row);
    return id;
  }

  /** Unbepreister Lauf (Befund A): Tokens gezählt, kein Betrag. */
  const unbepreist = (over: Record<string, unknown> = {}) => lauf({ tokens: 5_000, cost_micros: null, ...over });

  /** Fehlstart (Befund B): Phasenlauf, 2,4 s, Exitcode 1. */
  const fehlstart = (featureId: string, over: Record<string, unknown> = {}) =>
    lauf({
      feature_id: featureId,
      status: 'failed',
      exit_code: 1,
      started_at: ENDGUELTIG - 2_400,
      finished_at: ENDGUELTIG,
      ...over,
    });

  const offen = (kind: string) => attention.listOpen().filter((i) => i.kind === kind);

  beforeEach(() => {
    db = openMemoryDatabase();
    projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    executions = new ExecutionRepo(db);
    attention = new AttentionRepo(db);
    state = new PlausibilityRepo(db);
    service = new PlausibilityService({ executions, features, projects, attention, state });
    projectId = projekt('Demo');
    lfd = 0;
  });

  afterEach(() => db.close());

  // ---------- Befund A ----------

  describe('Befund A — Verbrauch ohne Preis', () => {
    it('legt für ein betroffenes Projekt genau EINE offene Meldung an (SC-001)', () => {
      unbepreist();
      service.check(NOW);
      expect(offen('run_unpriced')).toHaveLength(1);
      expect(offen('run_unpriced')[0]!.projectId).toBe(projectId);
      expect(offen('run_unpriced')[0]!.featureId).toBeNull();
    });

    it('bündelt mehrere betroffene Läufe zu EINER Meldung mit Anzahl (Edge Case, FR-015)', () => {
      unbepreist();
      unbepreist();
      unbepreist();
      service.check(NOW);
      expect(offen('run_unpriced')).toHaveLength(1);
      expect(offen('run_unpriced')[0]!.message).toContain('3');
    });

    it('nennt im Text ein konkretes Beispiel: den Lauf mit der grössten Tokenzahl (FR-015)', () => {
      const f = feature('mein-feature');
      unbepreist({ feature_id: f, tokens: 1_000 });
      unbepreist({ feature_id: f, tokens: 62_377_448, phase: 'implement' });
      service.check(NOW);
      const text = offen('run_unpriced')[0]!.message;
      expect(text).toContain('mein-feature');
      expect(text).toContain('implement');
      expect(text).toContain(new Intl.NumberFormat('de-CH').format(62_377_448));
    });

    it('meldet je Projekt getrennt — zwei betroffene Projekte, zwei Meldungen', () => {
      const zweites = projekt('Zweites');
      unbepreist();
      unbepreist({ project_id: zweites });
      service.check(NOW);
      expect(offen('run_unpriced')).toHaveLength(2);
      expect(offen('run_unpriced').map((i) => i.projectId).sort()).toEqual([projectId, zweites].sort());
    });

    it('zählt Läufe archivierter und gelöschter Features mit (research.md D6)', () => {
      const archiviert = feature('archiviert');
      features.archive(archiviert);
      unbepreist({ feature_id: archiviert });
      unbepreist({ feature_id: 'laengst-geloescht' });
      service.check(NOW);
      expect(offen('run_unpriced')).toHaveLength(1);
      expect(offen('run_unpriced')[0]!.message).toContain('2');
    });

    it('meldet nicht, solange kein Lauf betroffen ist', () => {
      lauf({ tokens: 5_000, cost_micros: 42 });
      service.check(NOW);
      expect(offen('run_unpriced')).toHaveLength(0);
    });
  });

  // ---------- Befund B ----------

  describe('Befund B — Fehlstart', () => {
    it('legt für ein betroffenes Feature genau EINE offene Meldung an (SC-001)', () => {
      const f = feature('mein-feature');
      fehlstart(f);
      service.check(NOW);
      expect(offen('phase_false_start')).toHaveLength(1);
      expect(offen('phase_false_start')[0]!.featureId).toBe(f);
      expect(offen('phase_false_start')[0]!.projectId).toBe(projectId);
    });

    it('bündelt mehrere Fehlstarts eines Features zu EINER Meldung mit Anzahl (Edge Case)', () => {
      const f = feature('mein-feature');
      fehlstart(f);
      fehlstart(f, { started_at: ENDGUELTIG - 3_400 });
      service.check(NOW);
      expect(offen('phase_false_start')).toHaveLength(1);
      const text = offen('phase_false_start')[0]!.message;
      expect(text).toContain('2');
      expect(text).toContain('mein-feature');
      expect(text).toContain('Fehlstart');
    });

    it('meldet je Feature getrennt', () => {
      const a = feature('feature-a');
      const b = feature('feature-b');
      fehlstart(a);
      fehlstart(b);
      service.check(NOW);
      expect(offen('phase_false_start')).toHaveLength(2);
    });

    it('meldet KEINEN Fehlstart eines archivierten Features (research.md D6)', () => {
      const f = feature('abgeschlossen');
      fehlstart(f);
      features.archive(f);
      service.check(NOW);
      expect(offen('phase_false_start')).toHaveLength(0);
    });

    it('meldet keinen Fehlstart ohne Feature-Zuordnung', () => {
      fehlstart('nicht-existent');
      service.check(NOW);
      expect(offen('phase_false_start')).toHaveLength(0);
    });

    it('meldet einen langen Fehlschlag nicht (FR-007)', () => {
      const f = feature('mein-feature');
      fehlstart(f, { started_at: ENDGUELTIG - 40_000 });
      service.check(NOW);
      expect(offen('phase_false_start')).toHaveLength(0);
    });
  });

  // ---------- Befund C ----------

  describe('Befund C — Projekt mit Features, aber ohne Lauf', () => {
    /** Feature, dessen Anlage ausserhalb der Karenzzeit liegt. */
    function altesFeature(name: string, projectIdOver?: string): string {
      const id = feature(name, { projectId: projectIdOver });
      db.prepare('UPDATE features SET created_at=? WHERE id=?').run(NOW - 29 * 3_600_000, id);
      return id;
    }

    it('meldet ein Projekt mit Features, ohne Phasenlauf, nach Ablauf der Karenzzeit (US2-1)', () => {
      altesFeature('eins');
      altesFeature('zwei');
      service.check(NOW);
      const meldungen = offen('project_without_runs');
      expect(meldungen).toHaveLength(1);
      expect(meldungen[0]!.projectId).toBe(projectId);
      expect(meldungen[0]!.featureId).toBeNull();
      expect(meldungen[0]!.message).toContain('Demo');
      expect(meldungen[0]!.message).toContain('2');
    });

    it('meldet nicht, solange die Karenzzeit des jüngsten Features läuft (US2-2)', () => {
      feature('frisch'); // created_at = jetzt
      service.check(NOW);
      expect(offen('project_without_runs')).toHaveLength(0);
    });

    it('meldet nicht für ein Projekt ohne Features (US2-3)', () => {
      service.check(NOW);
      expect(offen('project_without_runs')).toHaveLength(0);
    });

    it('meldet nicht, sobald ein — auch fehlgeschlagener — Phasenlauf existiert (US2-4)', () => {
      const f = altesFeature('eins');
      lauf({ feature_id: f, status: 'failed', exit_code: 1 });
      service.check(NOW);
      expect(offen('project_without_runs')).toHaveLength(0);
    });

    it('meldet nicht für ein Projekt mit ausschliesslich archivierten Features (US2-5)', () => {
      const f = altesFeature('abgeschlossen');
      features.archive(f);
      service.check(NOW);
      expect(offen('project_without_runs')).toHaveLength(0);
    });

    it('meldet nicht, wenn nur ein chat_work-Lauf existiert — FR-008 fragt nach Phasenläufen', () => {
      altesFeature('eins');
      lauf({ kind: 'chat_work', phase: null });
      service.check(NOW);
      expect(offen('project_without_runs')).toHaveLength(1);
    });
  });

  // ---------- Wasserstand: die Inbox bleibt handhabbar (US4) ----------

  describe('Wasserstand — kein Nachwachsen (US4)', () => {
    it('zehn Prüfungen über unverändertem Bestand ergeben dieselbe Anzahl wie die erste (US4-1, SC-004)', () => {
      const f = feature('mein-feature');
      unbepreist();
      unbepreist();
      fehlstart(f);
      service.check(NOW);
      const nachErster = attention.listOpen().length;
      expect(nachErster).toBe(2);

      for (let i = 1; i <= 10; i++) service.check(NOW + i * 60_000);
      expect(attention.listOpen()).toHaveLength(nachErster);
    });

    it('eine aufgelöste Meldung kehrt bei unverändertem Bestand NICHT zurück (US4-2, SC-005)', () => {
      unbepreist();
      service.check(NOW);
      attention.resolve(offen('run_unpriced')[0]!.id);

      service.check(NOW + 60_000);
      service.check(NOW + 120_000);
      expect(offen('run_unpriced')).toHaveLength(0);
    });

    it('eine aufgelöste Meldung kehrt bei einem weiteren betroffenen Lauf zurück — genau einmal (US4-3, SC-005)', () => {
      unbepreist();
      service.check(NOW);
      attention.resolve(offen('run_unpriced')[0]!.id);

      unbepreist();
      service.check(NOW + 60_000);
      expect(offen('run_unpriced')).toHaveLength(1);
      expect(offen('run_unpriced')[0]!.message).toContain('2');

      // …und danach wächst wieder nichts nach.
      for (let i = 2; i <= 10; i++) service.check(NOW + i * 60_000);
      expect(offen('run_unpriced')).toHaveLength(1);
    });

    it('zieht die Marke bei OFFENER Meldung nach — wer auflöst, quittiert den Stand von jetzt (FR-014)', () => {
      unbepreist();
      service.check(NOW);
      expect(state.getMark('run_unpriced', projectId, '')).toBe(1);

      unbepreist();
      unbepreist();
      service.check(NOW + 60_000); // Meldung ist offen ⇒ refresh
      expect(offen('run_unpriced')).toHaveLength(1);
      expect(state.getMark('run_unpriced', projectId, '')).toBe(3);

      // Auflösen quittiert die 3 — unveränderter Bestand bringt sie nicht zurück.
      attention.resolve(offen('run_unpriced')[0]!.id);
      service.check(NOW + 120_000);
      expect(offen('run_unpriced')).toHaveLength(0);
    });

    it('ändert den Text einer offenen Meldung nicht — sie bleibt quittierbar', () => {
      unbepreist();
      service.check(NOW);
      const text = offen('run_unpriced')[0]!.message;
      unbepreist();
      service.check(NOW + 60_000);
      expect(offen('run_unpriced')[0]!.message).toBe(text);
    });

    it('löscht die Marke, wenn der Befund ganz verschwindet — ein späterer Einzelfall meldet wieder', () => {
      const id = unbepreist();
      service.check(NOW);
      attention.resolve(offen('run_unpriced')[0]!.id);
      expect(state.getMark('run_unpriced', projectId, '')).toBe(1);

      db.prepare('DELETE FROM executions WHERE id=?').run(id);
      service.check(NOW + 60_000);
      expect(state.getMark('run_unpriced', projectId, '')).toBeNull();

      // Ohne das Löschen wäre „1 ≤ alte Marke" dauerhaft unterdrückt.
      unbepreist();
      service.check(NOW + 120_000);
      expect(offen('run_unpriced')).toHaveLength(1);
    });

    it('überlebt einen Neustart: neue Service-Instanz auf derselben DB meldet nicht erneut (FR-017)', () => {
      unbepreist();
      service.check(NOW);
      attention.resolve(offen('run_unpriced')[0]!.id);

      const nachNeustart = new PlausibilityService({
        executions: new ExecutionRepo(db),
        features: new FeatureRepo(db),
        projects: new ProjectRepo(db),
        attention: new AttentionRepo(db),
        state: new PlausibilityRepo(db),
      });
      nachNeustart.check(NOW + 60_000);
      expect(offen('run_unpriced')).toHaveLength(0);
    });

    it('hält den Wasserstand je Bezugsobjekt getrennt', () => {
      const a = feature('feature-a');
      const b = feature('feature-b');
      fehlstart(a);
      service.check(NOW);
      attention.resolve(offen('phase_false_start')[0]!.id);

      fehlstart(b);
      service.check(NOW + 60_000);
      expect(offen('phase_false_start')).toHaveLength(1);
      expect(offen('phase_false_start')[0]!.featureId).toBe(b);
    });
  });

  // ---------- Befund D ----------

  describe('Befund D — verworfene Nachkorrektur', () => {
    /** Ablehnung, wie `ExecutionRepo.updateTelemetry()` sie liefert. */
    const abgelehnt = (over: Record<string, unknown> = {}) =>
      ({
        applied: false,
        reason: 'egal',
        rejection: 'lowered',
        existingTokens: 6_578_097,
        rejectedTokens: 568_955,
        factor: 11.56,
        ...over,
      }) as never;

    it('meldet bei Faktor ≥ 2 genau eine Meldung mit Lauf-ID, beiden Zahlen und Faktor (US3-1)', () => {
      const f = feature('mein-feature');
      service.reportMeteringConflict({ id: 'uQ_RAMEn', projectId, featureId: f }, abgelehnt());
      const meldungen = offen('metering_conflict');
      expect(meldungen).toHaveLength(1);
      expect(meldungen[0]!.featureId).toBe(f);
      expect(meldungen[0]!.message).toContain('uQ_RAMEn');
      expect(meldungen[0]!.message).toContain(new Intl.NumberFormat('de-CH').format(6_578_097));
      expect(meldungen[0]!.message).toContain(new Intl.NumberFormat('de-CH').format(568_955));
    });

    it('meldet NICHT bei einer Abweichung unter Faktor 2 (US3-2)', () => {
      const f = feature('mein-feature');
      service.reportMeteringConflict(
        { id: 'r1', projectId, featureId: f },
        abgelehnt({ existingTokens: 1_000, rejectedTokens: 900, factor: 1.11 }),
      );
      expect(offen('metering_conflict')).toHaveLength(0);
    });

    it('meldet NICHT bei der Preis-Ablehnung — die bleibt auf der Konsole (US3-3)', () => {
      const f = feature('mein-feature');
      service.reportMeteringConflict(
        { id: 'r1', projectId, featureId: f },
        abgelehnt({ rejection: 'price_loss', factor: 5 }),
      );
      expect(offen('metering_conflict')).toHaveLength(0);
    });

    it('meldet genau am Schwellenwert Faktor 2', () => {
      const f = feature('mein-feature');
      service.reportMeteringConflict(
        { id: 'r1', projectId, featureId: f },
        abgelehnt({ existingTokens: 1_000, rejectedTokens: 500, factor: 2 }),
      );
      expect(offen('metering_conflict')).toHaveLength(1);
    });

    it('legt bei offener Meldung desselben Features keine zweite an (FR-013)', () => {
      const f = feature('mein-feature');
      service.reportMeteringConflict({ id: 'r1', projectId, featureId: f }, abgelehnt());
      service.reportMeteringConflict({ id: 'r2', projectId, featureId: f }, abgelehnt());
      expect(offen('metering_conflict')).toHaveLength(1);
      expect(offen('metering_conflict')[0]!.message).toContain('r1');
    });

    it('meldet nach dem Auflösen erneut — ein neuer Widerspruch ist ein neues Ereignis (research.md D10)', () => {
      const f = feature('mein-feature');
      service.reportMeteringConflict({ id: 'r1', projectId, featureId: f }, abgelehnt());
      attention.resolve(offen('metering_conflict')[0]!.id);
      service.reportMeteringConflict({ id: 'r2', projectId, featureId: f }, abgelehnt());
      expect(offen('metering_conflict')).toHaveLength(1);
      expect(offen('metering_conflict')[0]!.message).toContain('r2');
    });

    it('hält Features auseinander', () => {
      const a = feature('feature-a');
      const b = feature('feature-b');
      service.reportMeteringConflict({ id: 'r1', projectId, featureId: a }, abgelehnt());
      service.reportMeteringConflict({ id: 'r2', projectId, featureId: b }, abgelehnt());
      expect(offen('metering_conflict')).toHaveLength(2);
    });

    it('wirft nicht, wenn die Meldung scheitert (FR-003)', () => {
      const kaputt = new PlausibilityService({
        executions,
        features,
        projects,
        attention: {
          listOpen: () => [],
          raise: () => {
            throw new Error('DB weg');
          },
        } as unknown as AttentionRepo,
        state,
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => kaputt.reportMeteringConflict({ id: 'r1', projectId, featureId: null }, abgelehnt())).not.toThrow();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  // ---------- FR-003 / SC-006: die Beurteilung ist kein Tor ----------

  describe('Die Beurteilung hält den Laufabschluss nicht auf (FR-003, SC-006)', () => {
    it('check() wirft nicht, wenn ein Repo-Zugriff scheitert', () => {
      const kaputt = new PlausibilityService({
        executions: {
          listAll: () => {
            throw new Error('DB weg');
          },
        } as unknown as ExecutionRepo,
        features,
        projects,
        attention,
        state,
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => kaputt.check(NOW)).not.toThrow();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('ein werfender Service lässt Status, finished_at, Exitcode und Tokenzahl des Laufs unberührt', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { RunMeter } = await import('./core/runMeter.js');
        const f = feature('mein-feature');
        const executionId = executions.start({
          projectId,
          featureId: f,
          kind: 'phase',
          phase: 'implement',
          logPath: null,
        });

        // Die Beurteilung hängt am Nachtragsfenster des gemeinsamen Kerns (FR-002) —
        // dort steht sie als letzte Anweisung des letzten Timers, in eigenem try/catch.
        const meter = new RunMeter({
          executions,
          plausibility: {
            check: () => {
              throw new Error('Beurteilung kaputt');
            },
          } as never,
        });

        const session = { id: 'sess1', featureId: f, projectId, cwd: '/p', claudeSessionId: null, scrollback: '' };
        const running = {
          phase: 'implement',
          executionId,
          scrollbackStart: 0,
          transcriptOffsetStart: 0,
          transcriptPathStart: null,
          startedAt: Date.now(),
          promptText: 'x',
          promptConfirmed: true,
        };

        // Laufabschluss inklusive Nachtragsfenster — der letzte Timer ruft die Prüfung.
        meter.finish(session as never, running as never, 0);
        const nachAbschluss = executions.get(executionId)!;
        expect(nachAbschluss.status).toBe('succeeded');

        expect(() => vi.advanceTimersByTime(TELEMETRY_GRACE_MS + 1_000)).not.toThrow();

        const danach = executions.get(executionId)!;
        expect(danach.status).toBe(nachAbschluss.status);
        expect(danach.finishedAt).toBe(nachAbschluss.finishedAt);
        expect(danach.exitCode).toBe(nachAbschluss.exitCode);
        expect(danach.tokens).toBe(nachAbschluss.tokens);
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });
  });
});
