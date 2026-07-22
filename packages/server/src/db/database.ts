import Database from 'better-sqlite3';
import { join } from 'node:path';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    default_branch TEXT NOT NULL DEFAULT 'main',
    color TEXT,
    enabled_phases TEXT NOT NULL,      -- JSON array
    verify_commands TEXT NOT NULL,     -- JSON array
    automation TEXT NOT NULL,          -- JSON partial AutomationSettings
    created_at INTEGER NOT NULL
  );

  CREATE TABLE features (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    branch TEXT NOT NULL,
    worktree_path TEXT,
    phases TEXT NOT NULL,              -- JSON PhaseMap
    integration TEXT NOT NULL DEFAULT 'none',
    automation TEXT NOT NULL DEFAULT '{}',
    tasks_done INTEGER NOT NULL DEFAULT 0,
    tasks_total INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    archived_at INTEGER,
    UNIQUE(project_id, name)
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    feature_id TEXT REFERENCES features(id) ON DELETE SET NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    claude_session_id TEXT,
    pid INTEGER,
    created_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE TABLE executions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    feature_id TEXT,
    kind TEXT NOT NULL,
    phase TEXT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    exit_code INTEGER,
    cost_usd REAL,
    log_path TEXT
  );

  CREATE TABLE merge_queue (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    stage TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    enqueued_at INTEGER NOT NULL,
    UNIQUE(feature_id)
  );

  CREATE TABLE attention (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    project_id TEXT NOT NULL,
    feature_id TEXT,
    session_id TEXT,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX idx_features_project ON features(project_id);
  CREATE INDEX idx_executions_feature ON executions(feature_id);
  CREATE INDEX idx_attention_open ON attention(resolved_at) WHERE resolved_at IS NULL;
  `,
  // WP3: Token-Zählung pro Execution
  `ALTER TABLE executions ADD COLUMN tokens INTEGER;`,
];

export function openDatabase(dataDir: string): DB {
  const db = new Database(join(dataDir, 'sdd-toolkit.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function openMemoryDatabase(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
