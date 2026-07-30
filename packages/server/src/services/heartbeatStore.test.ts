import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeartbeatStore } from './heartbeatStore.js';

describe('HeartbeatStore', () => {
  let dir: string;
  let store: HeartbeatStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sdd-heartbeat-'));
    store = new HeartbeatStore(dir);
  });

  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  it('schreibt und liest einen vollständigen Satz', () => {
    store.write({ ts: 1_700_000, instanceId: 'inst-a', startedAt: 1_600_000 });
    expect(store.read()).toEqual({
      ts: 1_700_000,
      instanceId: 'inst-a',
      clean: false,
      startedAt: 1_600_000,
    });
  });

  it('schreibt jeden Takt mit clean=false — ein früheres clean=true wird aufgehoben (D5)', () => {
    store.write({ ts: 1_000, instanceId: 'inst-a', startedAt: 900 });
    store.markClean();
    expect(store.read()?.clean).toBe(true);

    store.write({ ts: 2_000, instanceId: 'inst-a', startedAt: 900 });
    expect(store.read()).toEqual({ ts: 2_000, instanceId: 'inst-a', clean: false, startedAt: 900 });
  });

  it('fehlende Datei = Erststart (FR-010)', () => {
    expect(existsSync(join(dir, 'heartbeat.json'))).toBe(false);
    expect(store.read()).toBeNull();
  });

  it('unlesbarer Inhalt gilt als nicht vorhanden — kein Wurf', () => {
    writeFileSync(join(dir, 'heartbeat.json'), 'kein JSON, sondern Müll');
    expect(() => store.read()).not.toThrow();
    expect(store.read()).toBeNull();
  });

  it('abgeschnittener Inhalt gilt als nicht vorhanden (Ausfall mitten im Schreiben)', () => {
    writeFileSync(join(dir, 'heartbeat.json'), '{"ts":1700000,"instanceId":"inst');
    expect(store.read()).toBeNull();
  });

  it('unvollständiger, aber syntaktisch gültiger Satz gilt als nicht vorhanden', () => {
    writeFileSync(join(dir, 'heartbeat.json'), JSON.stringify({ ts: 1_700_000 }));
    expect(store.read()).toBeNull();
    writeFileSync(join(dir, 'heartbeat.json'), JSON.stringify({ ts: 'gestern', instanceId: 'a', clean: false, startedAt: 1 }));
    expect(store.read()).toBeNull();
  });

  it('markClean() behält ts, instanceId und startedAt und setzt nur clean', () => {
    store.write({ ts: 1_700_000, instanceId: 'inst-a', startedAt: 1_600_000 });
    store.markClean();
    expect(store.read()).toEqual({
      ts: 1_700_000,
      instanceId: 'inst-a',
      clean: true,
      startedAt: 1_600_000,
    });
  });

  it('markClean() ohne vorhandene Datei bleibt folgenlos', () => {
    expect(() => store.markClean()).not.toThrow();
    expect(store.read()).toBeNull();
  });

  it('ersetzt die Datei atomar und hinterlässt keinen Temp-Rest (D1)', () => {
    store.write({ ts: 1_000, instanceId: 'inst-a', startedAt: 900 });
    store.write({ ts: 2_000, instanceId: 'inst-a', startedAt: 900 });
    expect(readFileSync(join(dir, 'heartbeat.json'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(store.read()?.ts).toBe(2_000);
  });

  it('bleibt im schreibgeschützten Verzeichnis folgenlos — kein Wurf (FR-011)', () => {
    chmodSync(dir, 0o500);
    expect(() => store.write({ ts: 1_000, instanceId: 'inst-a', startedAt: 900 })).not.toThrow();
    expect(() => store.markClean()).not.toThrow();
    expect(store.read()).toBeNull();
  });
});
