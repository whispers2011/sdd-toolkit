import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OperationsEntry } from '@sdd/shared';
import { KEEP_LINES, MAX_ERROR_CHARS, OperationsLog, ROTATE_AT_BYTES, describeError } from './operationsLog.js';

function entry(over: Partial<OperationsEntry> = {}): OperationsEntry {
  return { ts: 1_000, instanceId: 'inst-a', kind: 'startup', ...over };
}

/** Zeilen der Protokolldatei — Rohform, damit auch unlesbare Zeilen sichtbar bleiben. */
function rawLines(dir: string): string[] {
  return readFileSync(join(dir, 'operations.jsonl'), 'utf8').split('\n').filter((l) => l !== '');
}

describe('OperationsLog', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sdd-opslog-'));
  });

  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  it('schreibt je Instanz genau einen startup-Eintrag als eigene JSON-Zeile (C2.1)', () => {
    const log = new OperationsLog(dir);
    log.append(entry({ instanceId: 'inst-a', kind: 'startup', pid: 4711 }));
    log.append(entry({ ts: 2_000, instanceId: 'inst-b', kind: 'startup', pid: 4712 }));

    const lines = rawLines(dir);
    expect(lines).toHaveLength(2);
    expect(lines.filter((l) => (JSON.parse(l) as OperationsEntry).instanceId === 'inst-a')).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ ts: 1_000, instanceId: 'inst-a', kind: 'startup', pid: 4711 });
  });

  it('schreibt höchstens einen Abgangseintrag je Instanz — das Once-Flag hält (C2.2)', () => {
    const log = new OperationsLog(dir);
    log.append(entry({ kind: 'startup' }));
    // Der reale Weg: shutdown() schreibt, process.exit(0) löst den 'exit'-Handler aus,
    // der ohne Flag ein zweites Mal schreiben würde.
    log.appendFarewell(entry({ ts: 2_000, kind: 'shutdown', signal: 'SIGINT', uptimeMs: 1_000 }));
    log.appendFarewell(entry({ ts: 2_001, kind: 'exit', exitCode: 0, uptimeMs: 1_001 }));

    const farewells = rawLines(dir)
      .map((l) => JSON.parse(l) as OperationsEntry)
      .filter((e) => e.kind === 'shutdown' || e.kind === 'exit');
    expect(farewells).toHaveLength(1);
    expect(farewells[0]).toMatchObject({ kind: 'shutdown', signal: 'SIGINT' });
  });

  it('lässt append() vom Once-Flag unberührt — uncaught ist kein Abgang (C2.3)', () => {
    const log = new OperationsLog(dir);
    log.append(entry({ ts: 2_000, kind: 'uncaught', error: 'TypeError: kaputt' }));
    log.appendFarewell(entry({ ts: 3_000, kind: 'shutdown', signal: 'SIGTERM', uptimeMs: 2_000 }));

    const kinds = rawLines(dir).map((l) => (JSON.parse(l) as OperationsEntry).kind);
    expect(kinds).toEqual(['uncaught', 'shutdown']);
  });

  it('kürzt ab 1 MB auf 1000 Zeilen, atomar über Temp-Datei und rename (C2.6)', () => {
    const file = join(dir, 'operations.jsonl');
    // Zeilen mit Füllfeld, damit die Datei die Schwelle sicher überschreitet.
    const fat = 'x'.repeat(600);
    const lines = Array.from({ length: 2_500 }, (_, i) =>
      JSON.stringify({ ts: i, instanceId: `inst-${i}`, kind: 'startup', error: fat }),
    );
    writeFileSync(file, `${lines.join('\n')}\n`);
    expect(readFileSync(file).byteLength).toBeGreaterThan(ROTATE_AT_BYTES);

    new OperationsLog(dir).rotateIfNeeded();

    const kept = rawLines(dir);
    expect(kept).toHaveLength(KEEP_LINES);
    // Die JÜNGSTEN Zeilen bleiben stehen, die Reihenfolge ist unverändert.
    expect((JSON.parse(kept[0]!) as OperationsEntry).ts).toBe(2_500 - KEEP_LINES);
    expect((JSON.parse(kept[kept.length - 1]!) as OperationsEntry).ts).toBe(2_499);
    // Atomar heisst auch: kein Temp-Rest im Datenverzeichnis.
    expect(readdirSync(dir)).toEqual(['operations.jsonl']);
  });

  it('lässt eine Datei unter der Schwelle unangetastet', () => {
    const log = new OperationsLog(dir);
    log.append(entry());
    log.rotateIfNeeded();
    expect(rawLines(dir)).toHaveLength(1);
  });

  it('bleibt im schreibgeschützten Verzeichnis folgenlos — kein Wurf, kein Abbruch (C2.5)', () => {
    chmodSync(dir, 0o500);
    const log = new OperationsLog(dir);

    expect(() => log.append(entry())).not.toThrow();
    expect(() => log.appendFarewell(entry({ kind: 'shutdown', signal: 'SIGINT' }))).not.toThrow();
    expect(() => log.rotateIfNeeded()).not.toThrow();
    expect(log.tail(5)).toEqual([]);
    expect(existsSync(join(dir, 'operations.jsonl'))).toBe(false);
  });

  describe('tail()', () => {
    it('liefert die letzten n Einträge, älteste zuerst', () => {
      const log = new OperationsLog(dir);
      for (let i = 1; i <= 5; i++) log.append(entry({ ts: i * 1_000, instanceId: `inst-${i}` }));

      expect(log.tail(3).map((e) => e.ts)).toEqual([3_000, 4_000, 5_000]);
      expect(log.tail(99)).toHaveLength(5);
      expect(log.tail(0)).toEqual([]);
    });

    it('überspringt eine halb geschriebene letzte Zeile still (kill -9 mitten im Schreiben)', () => {
      const log = new OperationsLog(dir);
      log.append(entry({ ts: 1_000, kind: 'startup' }));
      log.append(entry({ ts: 2_000, kind: 'shutdown', signal: 'SIGINT' }));
      // Abgeschnittene Zeile ohne Zeilenumbruch anhängen, wie sie ein harter Abbruch hinterlässt.
      writeFileSync(join(dir, 'operations.jsonl'), '{"ts":3000,"instanceId":"inst', { flag: 'a' });

      const tail = log.tail(10);
      expect(tail.map((e) => e.kind)).toEqual(['startup', 'shutdown']);
    });

    it('gibt bei fehlender Datei eine leere Liste zurück (Erststart)', () => {
      expect(new OperationsLog(dir).tail(10)).toEqual([]);
    });
  });

  describe('Anlässe des Abgangs (US2)', () => {
    it('hält shutdown mit Signal und Laufzeit fest (US2-1, US2-2)', () => {
      const log = new OperationsLog(dir);
      log.appendFarewell({
        ts: 5_000,
        instanceId: 'inst-a',
        kind: 'shutdown',
        signal: 'SIGTERM',
        uptimeMs: 4_000,
      });
      expect(log.tail(1)[0]).toEqual({
        ts: 5_000,
        instanceId: 'inst-a',
        kind: 'shutdown',
        signal: 'SIGTERM',
        uptimeMs: 4_000,
      });
    });

    it('hält exit mit Rückgabewert und Laufzeit fest', () => {
      const log = new OperationsLog(dir);
      log.appendFarewell({ ts: 5_000, instanceId: 'inst-a', kind: 'exit', exitCode: 1, uptimeMs: 4_000 });
      expect(log.tail(1)[0]).toMatchObject({ kind: 'exit', exitCode: 1, uptimeMs: 4_000 });
    });

    it('ordnet startup und Abgang je instanceId in zeitlicher Reihenfolge zu (US2-5, FR-015)', () => {
      const log = new OperationsLog(dir);
      log.append(entry({ ts: 1_000, instanceId: 'inst-a', kind: 'startup', pid: 1 }));
      log.appendFarewell(entry({ ts: 2_000, instanceId: 'inst-a', kind: 'shutdown', signal: 'SIGINT' }));
      // Zweite Instanz = zweiter OperationsLog, denn das Once-Flag gilt je Prozess.
      const zweiter = new OperationsLog(dir);
      zweiter.append(entry({ ts: 3_000, instanceId: 'inst-b', kind: 'startup', pid: 2 }));
      zweiter.appendFarewell(entry({ ts: 4_000, instanceId: 'inst-b', kind: 'exit', exitCode: 0 }));

      const alle = zweiter.tail(10);
      expect(alle.map((e) => `${e.instanceId}:${e.kind}`)).toEqual([
        'inst-a:startup',
        'inst-a:shutdown',
        'inst-b:startup',
        'inst-b:exit',
      ]);
      // Die Reihenfolge in der Datei IST die zeitliche Reihenfolge.
      expect(alle.map((e) => e.ts)).toEqual([...alle.map((e) => e.ts)].sort((a, b) => a - b));
    });
  });

  describe('describeError', () => {
    it('nimmt Message und Stack eines Fehlers', () => {
      const err = new TypeError("Cannot read properties of undefined (reading 'id')");
      const text = describeError(err);
      expect(text).toContain("TypeError: Cannot read properties of undefined (reading 'id')");
      expect(text).toContain('at ');
    });

    it('kürzt auf 2000 Zeichen mit sichtbarer Marke (FR-013)', () => {
      const err = new Error('x'.repeat(5_000));
      const text = describeError(err);
      expect(text).toHaveLength(MAX_ERROR_CHARS);
      expect(text.endsWith('…')).toBe(true);
    });

    it('verträgt eine Rejection, die gar kein Fehler ist', () => {
      expect(describeError('nur ein String')).toBe('nur ein String');
      expect(describeError(undefined)).toBe('undefined');
    });
  });
});
