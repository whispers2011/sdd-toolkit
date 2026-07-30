import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type DB } from './database.js';
import { ExecutionRepo, ProjectRepo } from './repos.js';

/**
 * Die Spalte `executions.cost_usd` bleibt bewusst im Schema stehen (keine Migration),
 * darf aber weder gelesen noch geschrieben werden: Alt-Zeilen behalten ihren Wert,
 * er erreicht nur keinen Payload mehr, und neue Zeilen bleiben NULL.
 */
describe('ExecutionRepo — cost_usd bleibt inert', () => {
  let db: DB;
  let executions: ExecutionRepo;
  let projectId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    executions = new ExecutionRepo(db);
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

  it('Alt-Zeile mit gefülltem cost_usd wird ohne Kostenfeld gelesen', () => {
    db.prepare(
      `INSERT INTO executions (id, project_id, feature_id, kind, phase, status, started_at, finished_at,
         exit_code, cost_usd, tokens, tokens_source, log_path)
       VALUES ('alt1', ?, NULL, 'phase', 'implement', 'succeeded', 1000, 2000, 0, 0.42, 1234, 'transcript', NULL)`,
    ).run(projectId);

    const record = executions.get('alt1');
    expect(record).toBeDefined();
    expect('costUsd' in record!).toBe(false);
    expect(record!.tokens).toBe(1234);
    expect(record!.tokensSource).toBe('transcript');

    // Der Wert steht weiterhin in der Datenbank — er wird nur nicht mehr ausgeliefert.
    const raw = db.prepare('SELECT cost_usd FROM executions WHERE id=?').get('alt1') as { cost_usd: number };
    expect(raw.cost_usd).toBe(0.42);
  });

  it('finish() schreibt keine Kosten, aber Tokens und Herkunft', () => {
    const id = executions.start({
      projectId,
      featureId: null,
      kind: 'verify',
      phase: null,
      logPath: null,
    });
    executions.finish(id, 0, 777);

    const raw = db.prepare('SELECT cost_usd, tokens FROM executions WHERE id=?').get(id) as {
      cost_usd: number | null;
      tokens: number | null;
    };
    expect(raw.cost_usd).toBeNull();
    expect(raw.tokens).toBe(777);

    const record = executions.get(id)!;
    expect('costUsd' in record).toBe(false);
    expect(record.tokens).toBe(777);
    expect(record.status).toBe('succeeded');
  });

  it('finishWithUsage() schreibt Komponenten und tokensSource, cost_usd bleibt NULL', () => {
    const id = executions.start({
      projectId,
      featureId: null,
      kind: 'phase',
      phase: 'implement',
      logPath: null,
    });
    executions.finishWithUsage(id, 0, {
      tokens: 1350,
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 1000,
      cacheCreationTokens: 50,
      tokensSource: 'transcript',
    });

    const raw = db.prepare('SELECT cost_usd FROM executions WHERE id=?').get(id) as { cost_usd: number | null };
    expect(raw.cost_usd).toBeNull();

    const record = executions.get(id)!;
    expect(record.tokens).toBe(1350);
    expect(record.cacheReadTokens).toBe(1000);
    expect(record.tokensSource).toBe('transcript');
    expect(JSON.stringify(record).includes('costUsd')).toBe(false);
  });
});

/**
 * Feature "token-und-kostenmessung...": Verbrauch und Betrag stammen von der CLI.
 * Die neuen Spalten sind additiv und nullable — Bestandsläufe bleiben unverändert (FR-025).
 */
describe('ExecutionRepo — Telemetrie-Felder', () => {
  let db: DB;
  let executions: ExecutionRepo;
  let projectId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    executions = new ExecutionRepo(db);
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

  const start = () =>
    executions.start({ projectId, featureId: null, kind: 'phase', phase: 'implement', logPath: null });

  it('schreibt und liest die gemeldeten Werte', () => {
    const id = start();
    executions.finishWithUsage(id, 0, {
      tokens: 23_550,
      inputTokens: 2,
      outputTokens: 4,
      cacheReadTokens: 15_273,
      cacheCreationTokens: 8_271,
      tokensSource: 'telemetry',
      costMicros: 90_457,
      subagentTokens: 5_000,
      subagentCostMicros: 12_000,
      model: 'claude-opus-5',
      telemetryFinalAt: 1_785_150_442_000,
    });

    const r = executions.get(id)!;
    expect(r.tokensSource).toBe('telemetry');
    expect(r.costMicros).toBe(90_457);
    expect(r.subagentTokens).toBe(5_000);
    expect(r.subagentCostMicros).toBe(12_000);
    expect(r.model).toBe('claude-opus-5');
    expect(r.telemetryFinalAt).toBe(1_785_150_442_000);
  });

  it('lässt die neuen Felder NULL, wenn nichts gemeldet wurde — kein 0-Ersatz (FR-023)', () => {
    const id = start();
    executions.finishWithUsage(id, 0, { tokens: 100, tokensSource: 'transcript' });

    const r = executions.get(id)!;
    expect(r.costMicros).toBeNull();
    expect(r.subagentTokens).toBeNull();
    expect(r.model).toBeNull();
    expect(r.telemetryFinalAt).toBeNull();
  });

  it('Bestandszeilen ohne die neuen Spalten werden mit NULL gelesen (FR-025)', () => {
    db.prepare(
      `INSERT INTO executions (id, project_id, feature_id, kind, phase, status, started_at, finished_at,
         exit_code, tokens, tokens_source, log_path)
       VALUES ('alt2', ?, NULL, 'phase', 'plan', 'succeeded', 1000, 2000, 0, 4321, 'transcript', NULL)`,
    ).run(projectId);

    const r = executions.get('alt2')!;
    expect(r.tokens).toBe(4321);
    expect(r.tokensSource).toBe('transcript');
    expect(r.costMicros).toBeNull();
    expect(r.subagentTokens).toBeNull();
  });

  it('updateTelemetry trägt nach, ohne Status oder Abschlusszeit anzufassen (FR-011)', () => {
    const id = start();
    executions.finishWithUsage(id, 0, {
      tokens: 100,
      tokensSource: 'telemetry',
      costMicros: 1_000,
      telemetryFinalAt: 999,
    });
    const vorher = executions.get(id)!;

    const ergebnis = executions.updateTelemetry(id, {
      tokens: 500,
      inputTokens: 5,
      tokensSource: 'telemetry',
      costMicros: 4_000,
      model: 'claude-opus-5',
    });

    const nachher = executions.get(id)!;
    expect(nachher.tokens).toBe(500);
    expect(nachher.costMicros).toBe(4_000);
    expect(nachher.status).toBe(vorher.status);
    expect(nachher.finishedAt).toBe(vorher.finishedAt);
    expect(nachher.exitCode).toBe(vorher.exitCode);
    // Das Endgültigkeitsfenster darf durch einen Nachtrag nicht wandern (FR-012).
    expect(nachher.telemetryFinalAt).toBe(999);
    expect(ergebnis.applied).toBe(true);
  });

  /**
   * Beobachtet am 30.07.2026 an neun Läufen: der Nachtrag am Ende des Nachlauffensters
   * summiert das Telemetrie-Fenster neu, findet aber einen von `sweep()` beschnittenen
   * Puffer — und schrieb die Messung um Faktor 2,9–16,8 nach unten. Ein Nachtrag darf
   * vervollständigen, nie verschlechtern.
   */
  describe('Nachtrag darf eine Messung nicht verschlechtern', () => {
    it('verwirft einen Nachtrag, der die Tokenzahl senkt (Fall uQ_RAMEn)', () => {
      const id = start();
      executions.finishWithUsage(id, 0, { tokens: 6_578_097, tokensSource: 'telemetry', costMicros: 3_803_016 });

      const ergebnis = executions.updateTelemetry(id, {
        tokens: 568_955,
        tokensSource: 'telemetry',
        costMicros: 334_466,
      });

      expect(ergebnis.applied).toBe(false);
      expect(ergebnis.applied === false && ergebnis.reason).toContain('senken');
      const r = executions.get(id)!;
      expect(r.tokens).toBe(6_578_097);
      expect(r.costMicros).toBe(3_803_016);
    });

    it('verwirft einen Nachtrag, der den Preis löscht (Fall tMvPe72V: Rückfall aufs Transkript)', () => {
      const id = start();
      executions.finishWithUsage(id, 0, { tokens: 272_685, tokensSource: 'telemetry', costMicros: 248_242 });

      // Mehr Tokens, aber ohne Kosten — die Transkript-Ebene wird nicht bepreist.
      const ergebnis = executions.updateTelemetry(id, { tokens: 5_947_193, tokensSource: 'transcript' });

      expect(ergebnis.applied).toBe(false);
      expect(ergebnis.applied === false && ergebnis.reason).toContain('Preis');
      const r = executions.get(id)!;
      expect(r.costMicros).toBe(248_242);
      expect(r.tokensSource).toBe('telemetry');
    });

    it('lässt einen Nachtrag durch, der die Messung vervollständigt', () => {
      const id = start();
      executions.finishWithUsage(id, 0, { tokens: 135_484, tokensSource: 'telemetry', costMicros: 135_420 });

      const ergebnis = executions.updateTelemetry(id, {
        tokens: 272_685,
        tokensSource: 'telemetry',
        costMicros: 248_242,
      });

      expect(ergebnis.applied).toBe(true);
      const r = executions.get(id)!;
      expect(r.tokens).toBe(272_685);
      expect(r.costMicros).toBe(248_242);
    });

    it('trägt bei einem Lauf ohne Zahl normal nach (erste Messung ist keine Senkung)', () => {
      const id = start();
      executions.finishWithUsage(id, 0, {});

      const ergebnis = executions.updateTelemetry(id, { tokens: 1_033, tokensSource: 'transcript' });

      expect(ergebnis.applied).toBe(true);
      expect(executions.get(id)!.tokens).toBe(1_033);
    });
  });

  /**
   * Die Ablehnung trägt ihre Zahlen strukturiert, damit der Aufrufer (Befund D der
   * Plausibilitätsprüfung) sie nicht aus `reason` zurückparsen muss. Die
   * Ablehnungsregel selbst und der Wortlaut von `reason` ändern sich nicht (FR-018).
   */
  describe('Ablehnungsdaten strukturiert (FR-010)', () => {
    it('liefert bei „Nachtrag würde die Messung senken" rejection, beide Zahlen und den Faktor', () => {
      const id = start();
      executions.finishWithUsage(id, 0, { tokens: 6_578_097, tokensSource: 'telemetry', costMicros: 3_803_016 });

      const ergebnis = executions.updateTelemetry(id, { tokens: 568_955, tokensSource: 'telemetry', costMicros: 1 });

      expect(ergebnis.applied).toBe(false);
      if (ergebnis.applied) throw new Error('unerwartet angewendet');
      expect(ergebnis.rejection).toBe('lowered');
      expect(ergebnis.existingTokens).toBe(6_578_097);
      expect(ergebnis.rejectedTokens).toBe(568_955);
      expect(ergebnis.factor).toBeCloseTo(11.56, 2);
    });

    it('liefert bei „Nachtrag würde den Preis löschen" rejection price_loss', () => {
      const id = start();
      executions.finishWithUsage(id, 0, { tokens: 272_685, tokensSource: 'telemetry', costMicros: 248_242 });

      const ergebnis = executions.updateTelemetry(id, { tokens: 5_947_193, tokensSource: 'transcript' });

      expect(ergebnis.applied).toBe(false);
      if (ergebnis.applied) throw new Error('unerwartet angewendet');
      expect(ergebnis.rejection).toBe('price_loss');
      expect(ergebnis.existingTokens).toBe(272_685);
      expect(ergebnis.rejectedTokens).toBe(5_947_193);
      // Dieser Zweig ist nur erreichbar, wenn die Tokenzahl NICHT sank — der
      // Melde-Faktor 2 ist hier strukturell unerreichbar (research.md D10).
      expect(ergebnis.factor).toBeLessThan(2);
    });

    it('lässt den Wortlaut von reason unverändert (FR-018)', () => {
      const id = start();
      executions.finishWithUsage(id, 0, { tokens: 1_000, tokensSource: 'telemetry', costMicros: 500 });
      const gesenkt = executions.updateTelemetry(id, { tokens: 100, tokensSource: 'telemetry', costMicros: 50 });
      expect(gesenkt.applied === false && gesenkt.reason).toBe(
        'Nachtrag würde die Messung senken: 1000 → 100 Tokens (Faktor 10.0)',
      );

      const id2 = start();
      executions.finishWithUsage(id2, 0, { tokens: 100, tokensSource: 'telemetry', costMicros: 500 });
      const preis = executions.updateTelemetry(id2, { tokens: 200, tokensSource: 'transcript' });
      expect(preis.applied === false && preis.reason).toBe(
        'Nachtrag würde den Preis löschen: 0.00 USD vorhanden, Nachtrag ohne Kosten (Quelle transcript)',
      );
    });
  });
});

/**
 * Feature "eigene-schritte-an-den-lebenszyklus-haengen": Schritt-Läufe reihen sich
 * in die bestehende Lauferfassung ein. `label` trägt den Schrittnamen zum
 * Startzeitpunkt, damit der Lauf nach Umbenennung oder Löschung lesbar bleibt.
 */
describe('ExecutionRepo — label und Schritt-Läufe', () => {
  let db: DB;
  let executions: ExecutionRepo;
  let projectId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    executions = new ExecutionRepo(db);
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

  it('speichert und liest label', () => {
    const id = executions.start({
      projectId,
      featureId: null,
      kind: 'lifecycle_step',
      label: 'Abhängigkeiten installieren',
      phase: null,
      logPath: '/tmp/x.log',
    });
    expect(executions.get(id)!.label).toBe('Abhängigkeiten installieren');
    expect(executions.get(id)!.kind).toBe('lifecycle_step');
  });

  it('lässt label NULL, wenn keins angegeben wurde — auch bei Bestandsarten', () => {
    const id = executions.start({ projectId, featureId: null, kind: 'phase', phase: 'plan', logPath: null });
    expect(executions.get(id)!.label).toBeNull();
  });

  it('schreibt bei einem Schritt-Lauf keinen Verbrauchswert — nie 0, nie geschätzt (FR-020)', () => {
    const id = executions.start({
      projectId,
      featureId: null,
      kind: 'lifecycle_step',
      label: 'Marker schreiben',
      phase: null,
      logPath: null,
    });
    // Der Service ruft finish() OHNE Tokens — hier festgenagelt.
    executions.finish(id, 0);

    const r = executions.get(id)!;
    expect(r.tokens).toBeNull();
    expect(r.tokensSource).toBeNull();
    expect(r.costMicros).toBeNull();
    expect(r.status).toBe('succeeded');
  });

  /**
   * FR-021: Endet das Toolkit während eines Schritt-Laufs, bleibt der Lauf nicht
   * dauerhaft „läuft". Der vorhandene Boot-Reaper erledigt das ohne Zusatzcode —
   * dieser Test nagelt die Kopplung fest, damit sie nicht unbemerkt bricht.
   */
  it('reapOrphans() markiert einen laufenden Schritt-Lauf beim Boot als orphaned (FR-021)', () => {
    const id = executions.start({
      projectId,
      featureId: null,
      kind: 'lifecycle_step',
      label: 'Hänger',
      phase: null,
      logPath: null,
    });
    expect(executions.get(id)!.status).toBe('running');

    expect(executions.reapOrphans()).toBe(1);

    const r = executions.get(id)!;
    expect(r.status).toBe('orphaned');
    expect(r.finishedAt).not.toBeNull();
    // Der Name bleibt lesbar, auch wenn der Lauf nie zu Ende kam.
    expect(r.label).toBe('Hänger');
  });
});
