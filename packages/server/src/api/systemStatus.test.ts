import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OutageRecord, SystemStatus } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { StackRepo } from '../db/stackRepo.js';
import { ExecutionRepo } from '../db/repos.js';
import { ResourceMonitor, type DiskUsage } from '../services/resourceMonitor.js';
import { buildAllowedOrigins } from './originGuard.js';
import { buildServer, type ApiDeps } from './server.js';

const GB = 1024 ** 3;
const JETZT = 1_700_000_000_000;

/**
 * Endpunkt-Vertrag GET /api/system/status (contracts/system-status-api.md).
 * Geprüft wird hier, was die Abnahme von Hand nicht erzwingen kann: dass die Route
 * auch dann antwortet, wenn JEDE Kennzahl fehlschlägt (C3.1).
 */
describe('GET /api/system/status', () => {
  let db: DB;
  let dataDir: string;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(() => {
    db = openMemoryDatabase();
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-sysstatus-'));
  });

  afterEach(async () => {
    await app?.close();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function build(
    over: {
      readDisk?: (dataDir: string) => Promise<DiskUsage>;
      readSwapLine?: () => Promise<string | null>;
      lastOutage?: OutageRecord | null;
    } = {},
  ) {
    const resourceMonitor = new ResourceMonitor({
      dataDir,
      executions: new ExecutionRepo(db),
      now: () => JETZT,
      readDisk: over.readDisk ?? (async () => ({ freeBytes: 200 * GB, totalBytes: 500 * GB })),
      readSwapLine: over.readSwapLine ?? (async () => 'total = 6144.00M  used = 614.40M  free = 5529.60M'),
    });
    app = await buildServer({
      resourceMonitor,
      outageMonitor: { lastOutage: over.lastOutage ?? null },
      // Stack-Profile werden in diesen Tests nicht bedient — der Guard fragt nur,
      // ob ein Profil betrieben wird (kein Projekt hier hat einen Stack).
      stackService: { isRunning: () => false },
      stackRepo: new StackRepo(db),
      testingLane: { confirm: async () => {}, reject: async () => {} },
      portBlockSize: 20,
      dataDir,
      allowedOrigins: buildAllowedOrigins([80]),
    } as unknown as ApiDeps);
  }

  const hole = async (): Promise<SystemStatus> => {
    const res = await app.inject({ method: 'GET', url: '/api/system/status' });
    expect(res.statusCode).toBe(200);
    return res.json() as SystemStatus;
  };

  it('liefert Kennzahlen, Bewertung und den letzten Ausfall in der Form aus C3', async () => {
    const ausfall: OutageRecord = {
      from: JETZT - 5_450_000,
      to: JETZT,
      durationMs: 5_450_000,
      affectedRuns: 2,
      silent: true,
      undetermined: false,
    };
    await build({ lastOutage: ausfall });

    const body = await hole();
    expect(body.resources).toMatchObject({ diskFreeBytes: 200 * GB, activeFeatures: 0, collectedAt: JETZT });
    expect(body.pressure.level).toBe('ok');
    expect(body.lastOutage).toEqual(ausfall);
  });

  it('antwortet 200 mit lauter null, wenn jede Kennzahl fehlschlägt (C3.1, FR-024)', async () => {
    await build({
      readDisk: () => Promise.reject(new Error('statfs kaputt')),
      readSwapLine: () => Promise.reject(new Error('sysctl kaputt')),
    });

    const body = await hole();
    expect(body.resources).toMatchObject({ diskFreeBytes: null, swapUsedRatio: null });
    // Unwissen ist keine Warnung — die Stufe bleibt „ok" (FR-022).
    expect(body.pressure.level).toBe('ok');
    expect(body.pressure.summary).toBe('– · Swap –');
  });

  it('gibt lastOutage als null aus, solange kein Ausfall registriert ist (C3.4)', async () => {
    await build();
    expect((await hole()).lastOutage).toBeNull();
  });

  it('leitet die Bewertung serverseitig ab — die Oberfläche entscheidet keine Schwellen (C3.5)', async () => {
    await build({ readDisk: async () => ({ freeBytes: 1 * GB, totalBytes: 500 * GB }) });

    const body = await hole();
    expect(body.pressure.level).toBe('warn');
    expect(body.pressure.notice).toBe('1.0 GB frei');
  });
});
