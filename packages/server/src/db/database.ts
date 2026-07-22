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
  // WP4: Review-Personas (project_id NULL = globale Defaults)
  `
  CREATE TABLE personas (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1
  );
  INSERT INTO personas (id, project_id, name, prompt, sort_order) VALUES
    ('default-code-review', NULL, 'Code-Review',
     'Du bist ein strenger Code-Reviewer. Reviewe die Änderungen dieses Feature-Branches gegenüber dem Default-Branch (git diff gegen den Merge-Base). Prüfe: Korrektheit, Randfälle, Fehlerbehandlung, Lesbarkeit, unnötige Komplexität, Konsistenz mit dem Bestandscode. Sei adversarial — suche aktiv nach Fehlern statt zu bestätigen. Schreibe deinen Review-Bericht als Markdown nach {reviewFile}. Die LETZTE Zeile der Datei MUSS exakt lauten: VERDICT: PASS oder VERDICT: FAIL. FAIL bei jedem Fund, der vor dem Merge behoben werden muss.',
     0),
    ('default-security-review', NULL, 'Security-Review',
     'Du bist ein Security-Reviewer. Pruefe die Aenderungen dieses Feature-Branches (git diff gegen den Merge-Base) auf: Injection-Risiken, unsichere Dateizugriffe, Command-Injection, Secrets im Code, unsichere Defaults, fehlende Validierung an Vertrauensgrenzen. Schreibe deinen Bericht als Markdown nach {reviewFile}. Die LETZTE Zeile MUSS exakt lauten: VERDICT: PASS oder VERDICT: FAIL. FAIL nur bei echten Sicherheitsproblemen, nicht bei Stilfragen.',
     1);
  `,
  // WP7: Merge-Modus + Editor-Kommando pro Projekt
  `
  ALTER TABLE projects ADD COLUMN merge_mode TEXT NOT NULL DEFAULT 'ff';
  ALTER TABLE projects ADD COLUMN editor_cmd TEXT;
  `,
  // WP13: Integrationsmodus (lokaler Merge vs. GitHub-PR)
  `ALTER TABLE projects ADD COLUMN integration_mode TEXT NOT NULL DEFAULT 'local';`,
  // Feature "projektspezifisches-wissen": projekt-gescopte Wissensbasis
  `
  CREATE TABLE knowledge_bundles (
    id                 TEXT PRIMARY KEY,
    project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id          TEXT REFERENCES knowledge_bundles(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    applicability_text TEXT NOT NULL DEFAULT '',
    applicability_tags TEXT NOT NULL DEFAULT '[]',
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
  );

  CREATE TABLE knowledge_entries (
    id                 TEXT PRIMARY KEY,
    project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    bundle_id          TEXT REFERENCES knowledge_bundles(id) ON DELETE CASCADE,
    title              TEXT NOT NULL,
    body               TEXT NOT NULL DEFAULT '',
    applicability_text TEXT NOT NULL DEFAULT '',
    applicability_tags TEXT NOT NULL DEFAULT '[]',
    source             TEXT NOT NULL DEFAULT 'inline',
    source_path        TEXT,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
  );

  CREATE TABLE knowledge_feature_selection (
    feature_id  TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    target_id   TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    decision    TEXT NOT NULL,
    PRIMARY KEY (feature_id, target_id)
  );

  CREATE INDEX idx_kbundles_project ON knowledge_bundles(project_id);
  CREATE INDEX idx_kbundles_parent  ON knowledge_bundles(parent_id);
  CREATE INDEX idx_kentries_project ON knowledge_entries(project_id);
  CREATE INDEX idx_kentries_bundle  ON knowledge_entries(bundle_id);
  `,
  // Projekt-Chat (Ask-a-Question): persistente Unterhaltung + Nachrichten
  `
  CREATE TABLE chat_conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    claude_session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  -- Höchstens eine aktive Unterhaltung pro Projekt
  CREATE UNIQUE INDEX idx_chat_active ON chat_conversations(project_id) WHERE ended_at IS NULL;

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('complete','streaming','error','interrupted')),
    error TEXT,
    proposal_json TEXT,
    cost_usd REAL,
    tokens INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_chat_messages_conv ON chat_messages(conversation_id, created_at);
  `,
  // Feature "projekt-chat-vollsession": Arbeits-Modus (Fragen/Arbeiten), Session- und
  // Attention-Bindung an eine Unterhaltung (additive, nullable — feature-Pfade bleiben intakt).
  `
  ALTER TABLE chat_conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'ask' CHECK (mode IN ('ask','work'));
  ALTER TABLE sessions ADD COLUMN conversation_id TEXT REFERENCES chat_conversations(id) ON DELETE SET NULL;
  ALTER TABLE attention ADD COLUMN conversation_id TEXT;
  `,
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
