import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATION_COUNT, migrate, openDatabase, type DB } from './database.js';

/**
 * Der Pfad, der bei echten Nutzern zählt: eine **bestehende** Datenbank wird auf einen
 * neueren Stand gehoben. Alle übrigen Tests bauen das Schema in einem Rutsch auf und
 * decken diesen Fall nicht ab — genau hier entstehen aber stille Datenverluste
 * (Constitution IV: „Kein Blind-Merge, keine stillen Verluste").
 */

/** Rohe In-Memory-DB ohne Migrationen — Ausgangspunkt für einen gezielten Zwischenstand. */
function emptyDb(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

/** Schema-Fingerabdruck: Tabellen, Indizes und ihr gespeichertes SQL. */
function schemaOf(db: DB): string {
  const rows = db
    .prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
    .all() as { type: string; name: string; sql: string | null }[];
  return rows.map((r) => `${r.type} ${r.name}\n${(r.sql ?? '').replace(/\s+/g, ' ').trim()}`).join('\n---\n');
}

const version = (db: DB) => db.pragma('user_version', { simple: true }) as number;

/** Ein Projekt anlegen — die Tabelle existiert ab dem ersten Schemastand. */
function insertProject(db: DB, id: string): void {
  db.prepare(
    `INSERT INTO projects (id, name, path, enabled_phases, verify_commands, automation, created_at)
     VALUES (?, ?, ?, '[]', '[]', '{}', 1700000000000)`,
  ).run(id, `Projekt ${id}`, `/tmp/${id}`);
}

describe('Migrationen — Aufstieg einer Bestandsdatenbank', () => {
  let db: DB;

  beforeEach(() => {
    db = emptyDb();
  });

  afterEach(() => {
    db.close();
  });

  it('erhält Bestandsdaten über die gesamte Migrationskette', () => {
    migrate(db, 1);
    insertProject(db, 'p1');
    db.prepare(
      `INSERT INTO features (id, project_id, name, branch, phases, created_at)
       VALUES ('f1', 'p1', 'Bestandsfeature', 'feature/bestand', '{"specify":"done"}', 1700000000001)`,
    ).run();
    db.prepare(
      `INSERT INTO executions (id, project_id, feature_id, kind, status, started_at)
       VALUES ('e1', 'p1', 'f1', 'phase', 'ok', 1700000000002)`,
    ).run();
    db.prepare(
      `INSERT INTO attention (id, kind, project_id, message, created_at)
       VALUES ('a1', 'question', 'p1', 'Bestandsmeldung', 1700000000003)`,
    ).run();

    migrate(db);

    expect(version(db)).toBe(MIGRATION_COUNT);
    expect(db.prepare(`SELECT name, path FROM projects WHERE id='p1'`).get()).toEqual({
      name: 'Projekt p1',
      path: '/tmp/p1',
    });
    expect(db.prepare(`SELECT name, branch, phases FROM features WHERE id='f1'`).get()).toEqual({
      name: 'Bestandsfeature',
      branch: 'feature/bestand',
      phases: '{"specify":"done"}',
    });
    expect(db.prepare(`SELECT status FROM executions WHERE id='e1'`).get()).toEqual({ status: 'ok' });
    expect(db.prepare(`SELECT message FROM attention WHERE id='a1'`).get()).toEqual({ message: 'Bestandsmeldung' });
  });

  it('füllt später ergänzte Spalten mit ihren Defaults statt mit NULL', () => {
    migrate(db, 1);
    insertProject(db, 'p1');
    db.prepare(
      `INSERT INTO features (id, project_id, name, branch, phases, created_at)
       VALUES ('f1', 'p1', 'F', 'feature/f', '{}', 1700000000001)`,
    ).run();

    migrate(db);

    expect(db.prepare(`SELECT merge_mode, integration_mode, optimization FROM projects WHERE id='p1'`).get()).toEqual({
      merge_mode: 'ff',
      integration_mode: 'local',
      optimization: '{}',
    });
    expect(db.prepare(`SELECT optimization FROM features WHERE id='f1'`).get()).toEqual({ optimization: '{}' });
  });

  it('überführt Personas verlustfrei in Agents (RENAME auf gefüllter Tabelle)', () => {
    // Stand direkt nach Anlage der personas-Tabelle: eine eigene Persona ergänzen und
    // prüfen, dass das spätere RENAME sie mitnimmt statt sie zu verlieren.
    const personasCreated = firstVersionWithTable('personas');
    migrate(db, personasCreated);
    db.prepare(
      `INSERT INTO personas (id, project_id, name, prompt, sort_order)
       VALUES ('eigene-persona', NULL, 'Eigenes Review', 'Prüfe alles.', 9)`,
    ).run();

    migrate(db);

    expect(db.prepare(`SELECT name, prompt FROM agents WHERE id='eigene-persona'`).get()).toEqual({
      name: 'Eigenes Review',
      prompt: 'Prüfe alles.',
    });
    // Die Alt-Persona wird zum blockierenden Review-Gate — das bisherige Verhalten.
    expect(db.prepare(`SELECT trigger_kind, blocking FROM agents WHERE id='eigene-persona'`).get()).toEqual({
      trigger_kind: 'review_gate',
      blocking: 1,
    });
  });

  it('lässt sich aus jedem Zwischenstand fortsetzen und endet im selben Schema', () => {
    const reference = emptyDb();
    migrate(reference);
    const expected = schemaOf(reference);
    reference.close();

    for (let stop = 0; stop <= MIGRATION_COUNT; stop++) {
      const stepwise = emptyDb();
      migrate(stepwise, stop);
      expect(version(stepwise), `Zwischenstand ${stop}`).toBe(stop);
      insertProjectIfPossible(stepwise, `p-${stop}`);

      migrate(stepwise);

      expect(version(stepwise), `Endstand nach Stopp bei ${stop}`).toBe(MIGRATION_COUNT);
      expect(schemaOf(stepwise), `Schema nach Stopp bei ${stop}`).toBe(expected);
      if (stop >= 1) {
        expect(rowExists(stepwise, `p-${stop}`), `Projekt aus Zwischenstand ${stop} überlebt`).toBe(true);
      }
      stepwise.close();
    }
  });

  it('ist idempotent — ein zweiter Lauf ändert nichts', () => {
    migrate(db);
    const before = schemaOf(db);
    migrate(db);
    expect(version(db)).toBe(MIGRATION_COUNT);
    expect(schemaOf(db)).toBe(before);
  });
});

describe('Migrationen — echte Datei-Datenbank im WAL-Modus', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-migrate-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('migriert beim ersten Öffnen und wendet beim zweiten nichts erneut an', () => {
    const first = openDatabase(dataDir);
    expect(version(first)).toBe(MIGRATION_COUNT);
    insertProject(first, 'p1');
    first.close();

    const second = openDatabase(dataDir);
    expect(version(second)).toBe(MIGRATION_COUNT);
    expect(second.prepare(`SELECT name FROM projects WHERE id='p1'`).get()).toEqual({ name: 'Projekt p1' });
    second.close();
  });
});

/** Erster Schemastand, in dem `table` existiert. */
function firstVersionWithTable(table: string): number {
  for (let v = 1; v <= MIGRATION_COUNT; v++) {
    const probe = emptyDb();
    migrate(probe, v);
    const found = probe
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
      .pluck()
      .get(table) as number | undefined;
    probe.close();
    if (found) return v;
  }
  throw new Error(`Tabelle nie angelegt: ${table}`);
}

function insertProjectIfPossible(db: DB, id: string): void {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'`).pluck().get();
  if (exists) insertProject(db, id);
}

function rowExists(db: DB, id: string): boolean {
  return db.prepare('SELECT 1 FROM projects WHERE id=?').pluck().get(id) === 1;
}
