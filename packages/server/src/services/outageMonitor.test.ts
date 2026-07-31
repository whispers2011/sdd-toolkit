import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialPhases } from '@sdd/shared';
import type { OperationsEntry } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo } from '../db/repos.js';
import { HeartbeatStore } from './heartbeatStore.js';
import { OperationsLog } from './operationsLog.js';
import { OutageMonitor } from './outageMonitor.js';

const MIN = 60_000;

/** Gesetzte Zeitpunkte — die Verdrahtung wird ohne echten Absturz geprüft (FR-025). */
const ALTES_LEBENSZEICHEN = 1_700_000_000_000;
const START_NACH_AUSFALL = ALTES_LEBENSZEICHEN + 5 * MIN;

describe('OutageMonitor.detectOnBoot', () => {
  let dir: string;
  let db: DB;
  let projects: ProjectRepo;
  let features: FeatureRepo;
  let executions: ExecutionRepo;
  let attention: AttentionRepo;
  let log: OperationsLog;
  let heartbeats: HeartbeatStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sdd-outage-'));
    db = openMemoryDatabase();
    projects = new ProjectRepo(db);
    features = new FeatureRepo(db);
    executions = new ExecutionRepo(db);
    attention = new AttentionRepo(db);
    log = new OperationsLog(dir);
    heartbeats = new HeartbeatStore(dir);
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

  function lauf(projectId: string, featureId: string | null): string {
    return executions.start({
      projectId,
      featureId,
      kind: featureId ? 'phase' : 'chat',
      phase: null,
      logPath: null,
    });
  }

  function monitor(now: number, instanceId = 'inst-neu'): OutageMonitor {
    return new OutageMonitor({
      executions,
      attention,
      features,
      operationsLog: log,
      heartbeatStore: heartbeats,
      instanceId,
      startedAt: now,
      now: () => now,
    });
  }

  /** Das Lebenszeichen einer Instanz, die danach hart abgebrochen wurde. */
  function abgestürzteInstanz(ts = ALTES_LEBENSZEICHEN, instanceId = 'inst-alt'): void {
    log.append({ ts: ts - MIN, instanceId, kind: 'startup', pid: 111 });
    heartbeats.write({ ts, instanceId, startedAt: ts - MIN });
  }

  function protokoll(): OperationsEntry[] {
    return log.tail(100);
  }

  function ausfallEinträge(): OperationsEntry[] {
    return protokoll().filter((e) => e.kind === 'outage');
  }

  it('liest die betroffenen Läufe, SOLANGE sie laufen — reapOnBoot() danach ändert das Ergebnis nicht', () => {
    const p = projekt('projekt-a');
    lauf(p, feature(p, 'feature-eins'));
    lauf(p, feature(p, 'feature-zwei'));
    abgestürzteInstanz();

    monitor(START_NACH_AUSFALL).detectOnBoot();

    // Der Reaper läuft erst NACH der Erkennung — genau diese Reihenfolge hält C4 fest.
    expect(executions.reapOrphans()).toBe(2);

    const offen = attention.listOpen().filter((i) => i.kind === 'server_outage');
    expect(offen).toHaveLength(1);
    expect(offen[0]!.message).toContain('2 Läufe betroffen');
    expect(offen[0]!.message).toContain('feature-eins');
    expect(offen[0]!.message).toContain('feature-zwei');
    expect(ausfallEinträge()[0]!.outage).toMatchObject({ affectedRuns: 2, silent: true, undetermined: false });
  });

  it('vertauschte Reihenfolge zählt null betroffene Läufe — der Regressionsfehler dieses Features', () => {
    const p = projekt('projekt-a');
    lauf(p, feature(p, 'feature-eins'));
    lauf(p, feature(p, 'feature-zwei'));
    abgestürzteInstanz();

    // Falsche Reihenfolge: erst reapen, dann erkennen.
    executions.reapOrphans();
    monitor(START_NACH_AUSFALL).detectOnBoot();

    expect(attention.listOpen().filter((i) => i.kind === 'server_outage')).toHaveLength(0);
    expect(ausfallEinträge()[0]!.outage).toMatchObject({ affectedRuns: 0 });
  });

  it('legt je Projekt genau eine Meldung an, mit den Zahlen DIESES Projekts (C4.1, US1-5)', () => {
    const a = projekt('projekt-a');
    const b = projekt('projekt-b');
    lauf(a, feature(a, 'a-eins'));
    lauf(a, feature(a, 'a-zwei'));
    lauf(b, feature(b, 'b-eins'));
    abgestürzteInstanz();

    monitor(START_NACH_AUSFALL).detectOnBoot();

    const offen = attention.listOpen().filter((i) => i.kind === 'server_outage');
    expect(offen).toHaveLength(2);
    const fürA = offen.find((i) => i.projectId === a)!;
    const fürB = offen.find((i) => i.projectId === b)!;
    expect(fürA.message).toContain('2 Läufe betroffen: a-eins, a-zwei');
    expect(fürB.message).toContain('1 Lauf betroffen: b-eins');
    // Der Ausfall gehört keinem einzelnen Feature und keiner Session (C4.5).
    expect([fürA.featureId, fürA.sessionId, fürA.conversationId]).toEqual([null, null, null]);
    // Der Protokolleintrag zählt über alle Projekte.
    expect(ausfallEinträge()[0]!.outage?.affectedRuns).toBe(3);
  });

  it('FR-026 „Ausfall ohne betroffene Läufe": Protokolleintrag, aber KEINE Meldung (C4.2)', () => {
    projekt('projekt-a');
    abgestürzteInstanz();

    monitor(START_NACH_AUSFALL).detectOnBoot();

    expect(attention.listOpen()).toHaveLength(0);
    expect(ausfallEinträge()).toHaveLength(1);
    expect(ausfallEinträge()[0]!.outage).toMatchObject({
      from: ALTES_LEBENSZEICHEN,
      to: START_NACH_AUSFALL,
      durationMs: 5 * MIN,
      affectedRuns: 0,
    });
  });

  it('FR-026 „wiederholter Start nach gemeldetem Ausfall": keine zweite Meldung (C4.4)', () => {
    const p = projekt('projekt-a');
    lauf(p, feature(p, 'feature-eins'));
    abgestürzteInstanz();

    monitor(START_NACH_AUSFALL, 'inst-1').detectOnBoot();
    expect(attention.listOpen().filter((i) => i.kind === 'server_outage')).toHaveLength(1);

    // Der erste Start hat ein frisches Lebenszeichen hinterlassen (D4) — der zweite
    // Start findet damit gar keine Lücke mehr.
    monitor(START_NACH_AUSFALL + MIN, 'inst-2').detectOnBoot();

    expect(attention.listOpen().filter((i) => i.kind === 'server_outage')).toHaveLength(1);
    expect(ausfallEinträge()).toHaveLength(1);
  });

  it('D15 „Uhr springt rückwärts": Protokolleintrag mit undetermined, aber keine Meldung', () => {
    const p = projekt('projekt-a');
    lauf(p, feature(p, 'feature-eins'));
    // Lebenszeichen liegt in der Zukunft.
    abgestürzteInstanz(START_NACH_AUSFALL + 10 * MIN);

    monitor(START_NACH_AUSFALL).detectOnBoot();

    expect(attention.listOpen().filter((i) => i.kind === 'server_outage')).toHaveLength(0);
    expect(ausfallEinträge()[0]!.outage).toMatchObject({
      from: null,
      durationMs: null,
      to: START_NACH_AUSFALL,
      undetermined: true,
      affectedRuns: 1,
    });
  });

  it('geordneter Abgang: kein Ausfall, kein Protokolleintrag, keine Meldung (C1.2)', () => {
    const p = projekt('projekt-a');
    lauf(p, feature(p, 'feature-eins'));
    log.append({ ts: ALTES_LEBENSZEICHEN - MIN, instanceId: 'inst-alt', kind: 'startup', pid: 111 });
    heartbeats.write({ ts: ALTES_LEBENSZEICHEN, instanceId: 'inst-alt', startedAt: ALTES_LEBENSZEICHEN - MIN });
    heartbeats.markClean();

    monitor(START_NACH_AUSFALL + 3 * 24 * 60 * MIN).detectOnBoot();

    expect(attention.listOpen()).toHaveLength(0);
    expect(ausfallEinträge()).toHaveLength(0);
  });

  it('Erststart ohne Lebenszeichen: startup-Eintrag, kein Ausfall (C1.1)', () => {
    monitor(START_NACH_AUSFALL).detectOnBoot();

    expect(protokoll().map((e) => e.kind)).toEqual(['startup']);
    expect(attention.listOpen()).toHaveLength(0);
  });

  it('hält die Reihenfolge aus C4 ein: startup vor dem Ausfall, danach frisches Lebenszeichen (D4)', () => {
    abgestürzteInstanz();
    monitor(START_NACH_AUSFALL, 'inst-neu').detectOnBoot();

    const eigene = protokoll().filter((e) => e.instanceId === 'inst-neu');
    expect(eigene.map((e) => e.kind)).toEqual(['startup', 'outage']);
    expect(eigene[0]!.pid).toBe(process.pid);
    // Das neu geschriebene Lebenszeichen macht die Lücke unwiederholbar.
    expect(heartbeats.read()).toEqual({
      ts: START_NACH_AUSFALL,
      instanceId: 'inst-neu',
      clean: false,
      startedAt: START_NACH_AUSFALL,
    });
  });

  describe('stiller Abgang (C2.4, FR-014)', () => {
    it('silent: true, wenn zum letzten startup kein Abgangseintrag steht', () => {
      abgestürzteInstanz();
      monitor(START_NACH_AUSFALL).detectOnBoot();
      expect(ausfallEinträge()[0]!.outage?.silent).toBe(true);
    });

    it('silent: false, wenn die Vorinstanz einen shutdown-Eintrag hinterlassen hat', () => {
      // Der Server hat sich verabschiedet, das Lebenszeichen aber nicht mehr auf clean
      // setzen können — der Abgang ist belegt, nur die Lücke ist ungewöhnlich lang.
      log.append({ ts: ALTES_LEBENSZEICHEN - MIN, instanceId: 'inst-alt', kind: 'startup', pid: 111 });
      heartbeats.write({ ts: ALTES_LEBENSZEICHEN, instanceId: 'inst-alt', startedAt: ALTES_LEBENSZEICHEN - MIN });
      log.append({
        ts: ALTES_LEBENSZEICHEN + 1_000,
        instanceId: 'inst-alt',
        kind: 'shutdown',
        signal: 'SIGTERM',
        uptimeMs: MIN,
      });

      monitor(START_NACH_AUSFALL).detectOnBoot();
      expect(ausfallEinträge()[0]!.outage?.silent).toBe(false);
    });

    it('silent: false auch bei einem exit-Eintrag der Vorinstanz', () => {
      log.append({ ts: ALTES_LEBENSZEICHEN - MIN, instanceId: 'inst-alt', kind: 'startup', pid: 111 });
      heartbeats.write({ ts: ALTES_LEBENSZEICHEN, instanceId: 'inst-alt', startedAt: ALTES_LEBENSZEICHEN - MIN });
      log.append({ ts: ALTES_LEBENSZEICHEN + 1_000, instanceId: 'inst-alt', kind: 'exit', exitCode: 1, uptimeMs: MIN });

      monitor(START_NACH_AUSFALL).detectOnBoot();
      expect(ausfallEinträge()[0]!.outage?.silent).toBe(false);
    });

    it('ein uncaught-Eintrag ist KEIN Abgang — der Abgang bleibt still (C2.3)', () => {
      log.append({ ts: ALTES_LEBENSZEICHEN - MIN, instanceId: 'inst-alt', kind: 'startup', pid: 111 });
      heartbeats.write({ ts: ALTES_LEBENSZEICHEN, instanceId: 'inst-alt', startedAt: ALTES_LEBENSZEICHEN - MIN });
      log.append({ ts: ALTES_LEBENSZEICHEN + 1_000, instanceId: 'inst-alt', kind: 'uncaught', error: 'TypeError: kaputt' });

      monitor(START_NACH_AUSFALL).detectOnBoot();
      expect(ausfallEinträge()[0]!.outage?.silent).toBe(true);
    });

    it('der Abgangseintrag einer FRÜHEREN Instanz macht den Ausfall nicht laut', () => {
      // inst-uralt ist ordentlich gegangen, inst-alt danach hart abgebrochen.
      log.append({ ts: ALTES_LEBENSZEICHEN - 10 * MIN, instanceId: 'inst-uralt', kind: 'startup', pid: 100 });
      log.append({ ts: ALTES_LEBENSZEICHEN - 9 * MIN, instanceId: 'inst-uralt', kind: 'shutdown', signal: 'SIGINT', uptimeMs: MIN });
      abgestürzteInstanz();

      monitor(START_NACH_AUSFALL).detectOnBoot();
      expect(ausfallEinträge()[0]!.outage?.silent).toBe(true);
    });
  });

  describe('lastOutage (FR-023, D13)', () => {
    it('hält den gerade erkannten Ausfall bereit', () => {
      abgestürzteInstanz();
      const m = monitor(START_NACH_AUSFALL);
      expect(m.lastOutage).toBeNull();
      m.detectOnBoot();
      expect(m.lastOutage).toMatchObject({ from: ALTES_LEBENSZEICHEN, to: START_NACH_AUSFALL });
    });

    it('liest den letzten Ausfall auch aus einem früheren Lauf aus dem Protokoll', () => {
      abgestürzteInstanz();
      monitor(START_NACH_AUSFALL, 'inst-1').detectOnBoot();

      // Neuer Start ohne eigenen Ausfall — der alte bleibt nachschlagbar.
      const zweiter = monitor(START_NACH_AUSFALL + MIN, 'inst-2');
      zweiter.detectOnBoot();
      expect(zweiter.lastOutage).toMatchObject({ from: ALTES_LEBENSZEICHEN, to: START_NACH_AUSFALL });
    });

    it('bleibt null, solange im Protokoll kein Ausfall steht (C3.4)', () => {
      const m = monitor(START_NACH_AUSFALL);
      m.detectOnBoot();
      expect(m.lastOutage).toBeNull();
    });
  });
});
