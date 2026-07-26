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
