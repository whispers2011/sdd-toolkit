import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialPhases } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { ExecutionRepo, FeatureRepo, ProjectRepo } from '../db/repos.js';
import { ResourceMonitor, parseSwapUsage, type ResourceMonitorDeps } from './resourceMonitor.js';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const JETZT = 1_700_000_000_000;

describe('parseSwapUsage (D10)', () => {
  it('liest die Zeile von `sysctl -n vm.swapusage`, wie macOS sie ausgibt', () => {
    const gelesen = parseSwapUsage('total = 6144.00M  used = 4555.38M  free = 1588.62M  (encrypted)')!;
    expect(gelesen.totalBytes).toBe(Math.round(6144 * MB));
    expect(gelesen.usedBytes).toBe(Math.round(4555.38 * MB));
    // Die Quote gehört zu den ausgewiesenen Bytes — sonst widerspräche die Anzeige sich selbst.
    expect(gelesen.usedRatio).toBe(gelesen.usedBytes / gelesen.totalBytes);
    expect(gelesen.usedRatio).toBeCloseTo(0.7414, 4);
  });

  it('versteht auch K- und G-Einheiten und einen Zeilenumbruch am Ende', () => {
    expect(parseSwapUsage('total = 2.00G  used = 1.00G  free = 1.00G\n')).toMatchObject({
      totalBytes: 2 * GB,
      usedBytes: 1 * GB,
      usedRatio: 0.5,
    });
    expect(parseSwapUsage('total = 1024.00K  used = 512.00K  free = 512.00K')).toMatchObject({
      totalBytes: 1024 * 1024,
      usedRatio: 0.5,
    });
  });

  it('meldet abgeschaltete Auslagerung als 0 Prozent statt als Division durch null', () => {
    expect(parseSwapUsage('total = 0.00M  used = 0.00M  free = 0.00M')).toMatchObject({
      totalBytes: 0,
      usedRatio: 0,
    });
  });

  it('gibt bei unverständlicher Ausgabe null zurück — geraten wird nichts (FR-022)', () => {
    expect(parseSwapUsage('')).toBeNull();
    expect(parseSwapUsage('sysctl: unknown oid')).toBeNull();
    expect(parseSwapUsage('total = viel  used = wenig')).toBeNull();
  });
});

describe('ResourceMonitor.snapshot', () => {
  let dir: string;
  let db: DB;
  let projects: ProjectRepo;
  let features: FeatureRepo;
  let executions: ExecutionRepo;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sdd-resource-'));
    db = openMemoryDatabase();
    projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    executions = new ExecutionRepo(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function projekt(name: string): string {
    return projects.create({
      name,
      path: join(dir, name),
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
      integrationTarget: null,
      automation: {},
      optimization: {},
      tasksDone: 0,
      tasksTotal: 0,
    }).id;
  }

  function lauf(projectId: string, featureId: string | null): void {
    executions.start({
      projectId,
      featureId,
      kind: featureId ? 'phase' : 'chat',
      phase: null,
      logPath: null,
    });
  }

  function monitor(over: Partial<ResourceMonitorDeps> = {}): ResourceMonitor {
    return new ResourceMonitor({
      dataDir: dir,
      executions,
      now: () => JETZT,
      readDisk: async () => ({ freeBytes: 200 * GB, totalBytes: 500 * GB }),
      readSwapLine: async () => 'total = 6144.00M  used = 614.40M  free = 5529.60M',
      ...over,
    });
  }

  it('erhebt Platte, Auslagerung, Parallelität und den Erhebungszeitpunkt', async () => {
    const p = projekt('projekt-a');
    lauf(p, feature(p, 'feature-eins'));

    const snap = await monitor().snapshot();
    expect(snap).toMatchObject({
      diskFreeBytes: 200 * GB,
      diskTotalBytes: 500 * GB,
      swapUsedBytes: Math.round(614.4 * MB),
      swapTotalBytes: 6144 * MB,
      activeFeatures: 1,
      collectedAt: JETZT,
    });
    expect(snap.swapUsedRatio).toBeCloseTo(0.1, 6);
  });

  describe('Degradation einzelner Kennzahlen (C3.7, FR-022)', () => {
    it('lässt die Auslagerung stehen, wenn der Plattenplatz fehlschlägt', async () => {
      const snap = await monitor({
        readDisk: () => Promise.reject(new Error('statfs: permission denied')),
      }).snapshot();

      expect(snap.diskFreeBytes).toBeNull();
      expect(snap.diskTotalBytes).toBeNull();
      expect(snap.swapUsedRatio).toBeCloseTo(0.1, 5);
    });

    it('lässt den Plattenplatz stehen, wenn `sysctl` fehlschlägt oder hängt', async () => {
      const snap = await monitor({
        readSwapLine: () => Promise.reject(new Error('ETIMEDOUT')),
      }).snapshot();

      expect(snap.swapUsedRatio).toBeNull();
      expect(snap.swapUsedBytes).toBeNull();
      expect(snap.swapTotalBytes).toBeNull();
      expect(snap.diskFreeBytes).toBe(200 * GB);
    });

    it('liefert auf Plattformen ohne Auslagerungsabfrage sauber null statt einer geratenen Zahl (D10)', async () => {
      const snap = await monitor({ readSwapLine: async () => null }).snapshot();
      expect(snap.swapUsedRatio).toBeNull();
      expect(snap.diskFreeBytes).toBe(200 * GB);
    });

    it('antwortet auch dann, wenn JEDE Kennzahl fehlschlägt (C3.1)', async () => {
      const snap = await monitor({
        readDisk: () => Promise.reject(new Error('kaputt')),
        readSwapLine: () => Promise.reject(new Error('kaputt')),
      }).snapshot();

      expect(snap).toMatchObject({
        diskFreeBytes: null,
        swapUsedRatio: null,
        activeFeatures: 0,
        collectedAt: JETZT,
      });
    });
  });

  describe('Cache (C3.2, D11)', () => {
    it('erhebt innerhalb von 10 s nicht erneut — derselbe collectedAt', async () => {
      let aufrufe = 0;
      let uhr = JETZT;
      const m = monitor({
        now: () => uhr,
        readDisk: async () => {
          aufrufe++;
          return { freeBytes: 200 * GB, totalBytes: 500 * GB };
        },
      });

      const erste = await m.snapshot();
      uhr = JETZT + 9_000;
      const zweite = await m.snapshot();

      expect(aufrufe).toBe(1);
      expect(zweite.collectedAt).toBe(erste.collectedAt);
    });

    it('erhebt nach Ablauf der Cache-Dauer neu', async () => {
      let uhr = JETZT;
      const m = monitor({ now: () => uhr });

      await m.snapshot();
      uhr = JETZT + 10_001;
      expect((await m.snapshot()).collectedAt).toBe(JETZT + 10_001);
    });
  });

  describe('gleichzeitig arbeitende Features (D12)', () => {
    it('zählt verschiedene Features, nicht Läufe', async () => {
      const p = projekt('projekt-a');
      const eins = feature(p, 'feature-eins');
      lauf(p, eins);
      lauf(p, eins); // zweiter Lauf desselben Features
      lauf(p, feature(p, 'feature-zwei'));

      expect((await monitor().snapshot()).activeFeatures).toBe(2);
    });

    it('zählt Chat-Läufe ohne Feature über ihr Projekt', async () => {
      const a = projekt('projekt-a');
      const b = projekt('projekt-b');
      lauf(a, null);
      lauf(a, null); // zweiter Chat desselben Projekts zählt nicht doppelt
      lauf(b, null);

      expect((await monitor().snapshot()).activeFeatures).toBe(2);
    });

    it('zählt beendete Läufe nicht mehr mit', async () => {
      const p = projekt('projekt-a');
      lauf(p, feature(p, 'feature-eins'));
      executions.reapOrphans();

      expect((await monitor().snapshot()).activeFeatures).toBe(0);
    });
  });
});
