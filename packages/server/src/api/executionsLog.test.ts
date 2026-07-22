import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { ExecutionRepo } from '../db/repos.js';
import { buildServer, type ApiDeps } from './server.js';

/**
 * Endpoint-Vertrag GET /api/executions/:id/log (contracts/executions-log.md).
 * Deckt Fall A (Datei), B (abgeschlossener Phasen-Lauf inkl. kein Vermischen),
 * C-negativ (laufend, Transkript nicht auffindbar), D (Altbestand), E (ungültige ID).
 * Der Fall-C-Positivpfad (Live-Render) wird manuell via quickstart.md Schritt 5 geprüft,
 * da locateTranscript fest auf ~/.claude zeigt und Tests dort nicht schreiben.
 */
describe('GET /api/executions/:id/log', () => {
  let db: DB;
  let executions: ExecutionRepo;
  let dataDir: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let noSession: { forFeature: () => undefined };

  const line = (obj: unknown) => JSON.stringify(obj) + '\n';

  const build = async (ptys: unknown) => {
    const deps = { executions, dataDir, ptys } as unknown as ApiDeps;
    app = await buildServer(deps);
  };

  beforeEach(() => {
    db = openMemoryDatabase();
    executions = new ExecutionRepo(db);
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-log-'));
    mkdirSync(join(dataDir, 'logs'), { recursive: true });
    noSession = { forFeature: () => undefined };
  });

  afterEach(async () => {
    await app?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('Fall A: physische Log-Datei wird unverändert bedient (verify/review/…) ', async () => {
    await build(noSession);
    writeFileSync(join(dataDir, 'logs', 'verifyRun01.log'), '=== test: pnpm test ===\nOK\n', 'utf8');
    const res = await app.inject({ method: 'GET', url: '/api/executions/verifyRun01/log' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ log: string }>().log).toContain('pnpm test');
  });

  it('Fall B: abgeschlossener Phasen-Lauf rendert den Transkript-Ausschnitt', async () => {
    await build(noSession);
    const tdir = mkdtempSync(join(tmpdir(), 'sdd-tx-'));
    const tpath = join(tdir, 's.jsonl');
    const p1 =
      line({ type: 'user', message: { content: '/speckit.specify Fehler' } }) +
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Analyse Phase 1' }] } });
    writeFileSync(tpath, p1, 'utf8');

    const id = executions.start({
      projectId: 'p1',
      featureId: 'f1',
      kind: 'phase',
      phase: null,
      logPath: null,
      transcriptOffsetStart: 0,
    });
    executions.recordTranscriptEnd(id, tpath, Buffer.byteLength(p1, 'utf8'));

    const res = await app.inject({ method: 'GET', url: `/api/executions/${id}/log` });
    expect(res.statusCode).toBe(200);
    const log = res.json<{ log: string }>().log;
    expect(log).toContain('» /speckit.specify Fehler');
    expect(log).toContain('Analyse Phase 1');
    rmSync(tdir, { recursive: true, force: true });
  });

  it('Fall B: liest nur [start, end) — keine Vermischung mit Folgephasen (FR-003)', async () => {
    await build(noSession);
    const tdir = mkdtempSync(join(tmpdir(), 'sdd-tx-'));
    const tpath = join(tdir, 's.jsonl');
    const p1 =
      line({ type: 'user', message: { content: 'specify' } }) +
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Analyse Phase 1' }] } });
    const p2 =
      line({ type: 'user', message: { content: 'plan' } }) +
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Analyse Phase 2' }] } });
    writeFileSync(tpath, p1 + p2, 'utf8');

    const id = executions.start({
      projectId: 'p1',
      featureId: 'f1',
      kind: 'phase',
      phase: null,
      logPath: null,
      transcriptOffsetStart: 0,
    });
    executions.recordTranscriptEnd(id, tpath, Buffer.byteLength(p1, 'utf8')); // Ende = Grenze zu p2

    const log = (await app.inject({ method: 'GET', url: `/api/executions/${id}/log` })).json<{ log: string }>().log;
    expect(log).toContain('Analyse Phase 1');
    expect(log).not.toContain('Analyse Phase 2');
    expect(log).not.toContain('plan');
    rmSync(tdir, { recursive: true, force: true });
  });

  it('Fall C (negativ): laufender Phasen-Lauf ohne auffindbares Transkript → 404', async () => {
    // Session existiert, aber locateTranscript findet nichts (cwd/sessionId ohne Datei).
    await build({ forFeature: () => ({ cwd: join(dataDir, 'nope'), claudeSessionId: 'no-such-session-id' }) });
    const id = executions.start({
      projectId: 'p1',
      featureId: 'f1',
      kind: 'phase',
      phase: null,
      logPath: null,
      transcriptOffsetStart: 0,
    });
    const res = await app.inject({ method: 'GET', url: `/api/executions/${id}/log` });
    expect(res.statusCode).toBe(404);
  });

  it('Fall D: Phasen-Altbestand ohne Koordinaten → 404 „Kein Log vorhanden"', async () => {
    await build(noSession);
    const id = executions.start({
      projectId: 'p1',
      featureId: 'f1',
      kind: 'phase',
      phase: null,
      logPath: null,
      // kein transcriptOffsetStart (null) → nicht rekonstruierbar
    });
    const res = await app.inject({ method: 'GET', url: `/api/executions/${id}/log` });
    expect(res.statusCode).toBe(404);
  });

  it('Fall E: ungültige ID (unerlaubte Zeichen) → 400', async () => {
    await build(noSession);
    // Einzelnes Pfadsegment, das den Handler erreicht, aber die ID-Regex verletzt ('.').
    const res = await app.inject({ method: 'GET', url: '/api/executions/foo.bar/log' });
    expect(res.statusCode).toBe(400);
  });
});
