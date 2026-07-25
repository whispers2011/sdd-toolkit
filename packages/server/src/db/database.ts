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
  // Feature "minimize-token-consumption": autoritative Token-Messung + Optimierungs-Dial.
  // Additiv/nullable — Alt-Verhalten bleibt bei leeren Optimierungs-Spalten unverändert.
  `
  ALTER TABLE executions ADD COLUMN input_tokens INTEGER;
  ALTER TABLE executions ADD COLUMN output_tokens INTEGER;
  ALTER TABLE executions ADD COLUMN cache_read_tokens INTEGER;
  ALTER TABLE executions ADD COLUMN cache_creation_tokens INTEGER;
  ALTER TABLE executions ADD COLUMN tokens_source TEXT;
  ALTER TABLE executions ADD COLUMN transcript_offset_start INTEGER;
  ALTER TABLE executions ADD COLUMN opt_context_strategy TEXT;
  ALTER TABLE executions ADD COLUMN opt_compression TEXT;
  ALTER TABLE projects ADD COLUMN optimization TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE features ADD COLUMN optimization TEXT NOT NULL DEFAULT '{}';
  `,
  // Feature "laeufe-haben-kein-log": Phasen-Läufe rendern ihr Log aus dem Transkript.
  // transcript_path + transcript_offset_end grenzen den Lauf-Ausschnitt ab (additiv/nullable).
  `
  ALTER TABLE executions ADD COLUMN transcript_path TEXT;
  ALTER TABLE executions ADD COLUMN transcript_offset_end INTEGER;
  `,
  // Feature "review-portal-und-agent-verwaltung" (Teil B): Personas → Agents.
  // Verlustfreies RENAME; die Defaults bilden das bisherige Verhalten exakt ab
  // (jede Alt-Persona wird ein blockierender review_gate-Agent).
  `
  ALTER TABLE personas RENAME TO agents;
  ALTER TABLE agents ADD COLUMN description TEXT NOT NULL DEFAULT '';
  ALTER TABLE agents ADD COLUMN model TEXT;
  ALTER TABLE agents ADD COLUMN trigger_kind TEXT NOT NULL DEFAULT 'review_gate'
    CHECK (trigger_kind IN ('manual','review_gate','after_phase','before_phase'));
  ALTER TABLE agents ADD COLUMN trigger_phase TEXT;
  ALTER TABLE agents ADD COLUMN blocking INTEGER NOT NULL DEFAULT 1;

  UPDATE agents SET description='Adversariales Code-Review des Feature-Diffs (Korrektheit, Randfälle, Lesbarkeit).'
    WHERE id='default-code-review';
  UPDATE agents SET description='Security-Review des Feature-Diffs (Injection, Secrets, unsichere Defaults).'
    WHERE id='default-security-review';

  -- Seed 1: DoR-Gate (Definition of Ready) — blockiert den Implementierungs-Start,
  -- solange spec/plan/tasks offene Fragen enthalten (Meeting-Beschluss 3).
  INSERT INTO agents (id, project_id, name, description, prompt, sort_order, enabled, trigger_kind, trigger_phase, blocking) VALUES
    ('default-dor-gate', NULL, 'DoR-Gate (Definition of Ready)',
     'Prüft vor der Implementierung, ob Spezifikation, Plan und Aufgaben frei von offenen Fragen sind.',
     'Du bist das DoR-Gate (Definition of Ready). Prüfe VOR der Implementierung, ob dieses Feature bereit ist. Lies unter specs/<feature>/ die Artefakte spec.md, plan.md und tasks.md (Feature-Name siehe Kontext unten). Prüfe: (1) offene Fragen oder [NEEDS CLARIFICATION]-Marker in spec/plan/tasks, (2) unentschiedene Annahmen oder Widersprüche zwischen den Artefakten, (3) jede User Story hat prüfbare Akzeptanzkriterien, (4) tasks.md existiert und ist konkret genug (Dateipfade, keine vagen Sammelaufgaben). Sei streng: zu früh implementieren ist teurer als eine Rückfrage. Schreibe deinen Bericht als Markdown nach {reviewFile}. Bei FAIL MUSS der Bericht eine nummerierte Liste der offenen Fragen mit Fundstelle (Datei/Abschnitt) enthalten. Ergänze eine Zeile ZUSAMMENFASSUNG: <ein Satz>. Die LETZTE Zeile der Datei MUSS exakt lauten: VERDICT: PASS oder VERDICT: FAIL.',
     0, 1, 'before_phase', 'implement', 1);

  -- Seed 2: Plan-Qualitätsreview — eingedampfte Fassung von
  -- docs/solution-plan-quality-review.md (Meeting-Beschluss 2: Human-in-the-loop
  -- bei Architektur-/Pattern-Entscheidungen). Läuft nach der plan-Phase.
  INSERT INTO agents (id, project_id, name, description, prompt, sort_order, enabled, trigger_kind, trigger_phase, blocking) VALUES
    ('default-plan-quality', NULL, 'Plan-Qualitätsreview',
     'Prüft den Lösungsplan nach der Plan-Phase gegen Coding Principles, Architekturregeln und Pattern-Eignung; meldet Pattern-Entscheidungen als Freigabebedarf.',
     'Du bist der Lösungsplan-Qualitätsreviewer. Prüfe den Plan dieses Features (specs/<feature>/plan.md samt research.md/data-model.md/contracts, Feature-Name siehe Kontext) BEVOR implementiert wird. Ziel ist nicht, möglichst viele Prinzipien zu erwähnen, sondern aus dem konkreten Kontext die relevanten Prüfungen abzuleiten, Lücken nachzuweisen und den Plan belastbar zu machen. Du implementierst NICHTS.

VERBINDLICHE ARBEITSREGELN:
1. Evidenz vor Vermutung: Behaupte nichts über Architektur, Datenfluss oder vorhandene Abstraktionen, ohne den relevanten Code, Tests oder die Git-Historie gelesen zu haben. Verfolge Aufrufer und Konsumenten; suche vorhandene Lösungen für vergleichbare Features; dokumentiere Unsicherheit sichtbar statt Lücken mit plausiblen Annahmen zu füllen.
2. Prinzipien sind kontextabhängige Prüfregeln: Aktiviere ein Prinzip nur, wenn der Artefakttyp in seinen Anwendungsbereich fällt, die Änderung das zugehörige Risiko erzeugt, ein konkretes Code-Signal darauf deutet oder es ein Mandatory Gate ist.
3. Design Patterns sind keine Zielvorgabe (Pattern-Suitability-Gate): Empfehle ein Pattern nur, wenn (a) ein konkretes, wiederkehrendes Designproblem nachgewiesen ist, (b) das Pattern es besser löst als eine einfachere lokale Lösung, (c) die Abstraktion die wahrscheinliche Änderungsrichtung unterstützt, (d) es zur bestehenden Architektur passt und (e) Kosten und Alternativen dokumentiert sind. Pattern-Namen ohne Problemdruck sind kein Qualitätsmerkmal.
4. Bestehende Projektentscheidungen zuerst: Rangfolge = fachliche Anforderung > Sicherheit/Datenintegrität > ADRs/Teamkonventionen > etablierte Muster im Modul > allgemeine Principles > Stilpräferenz. Konflikte sichtbar machen, nie stillschweigend überschreiben.
5. Mandatory Gates (bei Relevanz IMMER prüfen): fachliche Invarianten; Autorisierung; Mandanten-/Datentrennung; Datenintegrität und Transaktionsgrenzen; Status-/Workflow-Konsistenz; Rückwärtskompatibilität bestehender Verträge und Daten; Fehler-/Retry-Verhalten externer oder asynchroner Operationen; Regressionstests bei Bugfixes; Schutz sensibler Daten.
6. Kein mechanisches DRY: Nur echte Single-Source-of-Business-Truth-Verstöße melden, keine zufälligen Textdopplungen.

WORKFLOW:
1. Plan lesen und klassifizieren (Änderungstyp, betroffene Schichten, Risikoklasse niedrig/mittel/hoch/kritisch).
2. Repository-Evidenz sammeln: geplante Dateien/Symbole im Bestand nachschlagen, Datenfluss verfolgen, vergleichbare Implementierungen und historische Entscheidungen (git log) prüfen.
3. Relevante Qualitätsprofile aktivieren (KISS/YAGNI, SOLID nur bei OO-Verantwortungs-Risiko, Fachmodell/Invarianten, Persistenz/Transaktionen, APIs/Verträge, Security, Tests/Beobachtbarkeit).
4. Findings erheben mit Schweregrad BLOCKER/HIGH/MEDIUM/LOW, je mit Fundstelle und konkretem Verbesserungsvorschlag.
5. Pattern-Fit-Analyse: für jeden Pattern-Kandidaten das Suitability-Gate dokumentieren (Problem, einfachere Alternative, Entscheidung, Kosten).
6. Adversarialer Gegencheck: Nimm die Gegenposition ein — welche Annahme des Plans ist am wahrscheinlichsten falsch, welcher Randfall bricht das Design, was übersieht der glücklichste Pfad?
7. Vollständigkeit: fachliche Änderung, geplante Artefakte, Daten/Migrationen, API/UI-Verträge, Tests und Rollout müssen konkret genug sein, dass die Implementierung keine Architekturentscheidung improvisieren muss.

BERICHT (Markdown nach {reviewFile}): Klassifikation, aktivierte Profile, Findings nach Schweregrad, Pattern-Entscheidungen (verwendet/abgelehnt mit Begründung), Ergebnis des Gegenchecks, konkrete Planänderungen. Danach folgende Pflichtzeilen: GESAMTENTSCHEIDUNG: FREIGEGEBEN oder FREIGEGEBEN MIT ÄNDERUNGEN oder PLAN ÜBERARBEITEN. Für JEDE Architektur-/Pattern-Entscheidung, die ein Mensch absegnen soll, eine eigene Zeile: FREIGABE ERFORDERLICH: <thema>. Dann ZUSAMMENFASSUNG: <ein Satz>. Verdict-Regel: FREIGEGEBEN und FREIGEGEBEN MIT ÄNDERUNGEN ergeben PASS, PLAN ÜBERARBEITEN ergibt FAIL (FREIGEGEBEN nur ohne offene BLOCKER/HIGH-Findings und mit abgedeckten Mandatory Gates). Die LETZTE Zeile der Datei MUSS exakt lauten: VERDICT: PASS oder VERDICT: FAIL.',
     0, 1, 'after_phase', 'plan', 1);

  -- Seed 3: Kommentar- & Doku-Policy — advisory (Meeting-Beschluss 1: Rationale in
  -- Commit-Messages, git-Historie LESEN statt in Dateien schreiben). False Positives
  -- sollen Merges nicht stoppen; im UI auf blockierend umschaltbar.
  INSERT INTO agents (id, project_id, name, description, prompt, sort_order, enabled, trigger_kind, trigger_phase, blocking) VALUES
    ('default-doku-policy', NULL, 'Kommentar- & Doku-Policy',
     'Prüft den Diff auf Meta-Kommentare, redundante DocBlocks und Historie im Code (beratend).',
     'Du bist der Kommentar- und Doku-Policy-Reviewer. Prüfe die Änderungen dieses Feature-Branches (git diff gegen den Merge-Base zum Default-Branch) auf Verstöße gegen die Doku-Policy: (1) Meta-Kommentare, die beschreiben WAS die nächste Zeile tut, statt WARUM es so ist — Clean Code und gutes Naming ersetzen solche Kommentare; (2) redundante DocBlocks ohne Informationsgewinn (Wiederholung von Signatur oder Namen); (3) Ticketnummern, Autoren- oder Änderungshistorie in Quelldateien — Rationale und Ticketbezug gehören in Commit-Messages, Historie liefert git log/blame (LIES die Historie bei Bedarf, schreibe sie nie in Dateien); (4) auskommentierter Code. Erhaltenswert sind Kommentare, die Constraints, Invarianten oder nicht offensichtliche Gründe erklären. Schreibe deinen Bericht als Markdown nach {reviewFile}; bei Verstößen eine Liste mit Datei und Zeile. Ergänze ZUSAMMENFASSUNG: <ein Satz>. Die LETZTE Zeile MUSS exakt lauten: VERDICT: PASS oder VERDICT: FAIL. FAIL bei klaren Policy-Verstößen, nicht bei Geschmacksfragen.',
     2, 1, 'review_gate', NULL, 0);

  CREATE TABLE agent_feature_selection (
    feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    agent_id   TEXT NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
    decision   TEXT NOT NULL CHECK (decision IN ('include','exclude')),
    PRIMARY KEY (feature_id, agent_id)
  );

  CREATE TABLE agent_runs (
    id             TEXT PRIMARY KEY,
    agent_id       TEXT REFERENCES agents(id) ON DELETE SET NULL,
    agent_name     TEXT NOT NULL,
    project_id     TEXT NOT NULL,
    feature_id     TEXT NOT NULL,
    execution_id   TEXT,
    trigger_kind   TEXT NOT NULL,
    trigger_phase  TEXT,
    blocking       INTEGER NOT NULL,
    verdict        TEXT,
    decision_label TEXT,
    summary        TEXT,
    report_path    TEXT,
    created_at     INTEGER NOT NULL,
    finished_at    INTEGER
  );
  CREATE INDEX idx_agent_runs_feature ON agent_runs(feature_id, created_at);
  `,
  // Feature "review-portal-und-agent-verwaltung" (Teil A): Reviewer-Kommentare,
  // Integrations-Zielwahl und erzwungene Re-Verifikation nach Reviewer-Edits.
  `
  CREATE TABLE review_comments (
    id          TEXT PRIMARY KEY,
    feature_id  TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    file_path   TEXT,
    line        INTEGER,
    side        TEXT CHECK (side IN ('old','new')),
    text        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    created_at  INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX idx_review_comments_feature ON review_comments(feature_id, status);

  ALTER TABLE features ADD COLUMN integration_target TEXT;
  ALTER TABLE merge_queue ADD COLUMN force_verify INTEGER NOT NULL DEFAULT 0;
  `,
  // Feature "erstellen-eines-features-basierend-auf-einem-jira-ticket": Ticket-Referenz
  // importierter Features (Schnappschuss) + Index für Duplikat-Lookup (FR-010/FR-014).
  `
  ALTER TABLE features ADD COLUMN jira_key TEXT;
  ALTER TABLE features ADD COLUMN jira_url TEXT;
  ALTER TABLE features ADD COLUMN jira_imported_at INTEGER;
  CREATE INDEX idx_features_jira ON features(project_id, jira_key);
  `,
  // Inbox-Dedup verfeinern: gleichartige Meldungen aus unterschiedlichen Quellen
  // (z. B. Freigabebedarf zweier Review-Agents) dürfen sich nicht gegenseitig verschlucken.
  `ALTER TABLE attention ADD COLUMN dedup_key TEXT;`,
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

/** Anzahl der Schemastände; `MIGRATION_COUNT` ist zugleich die aktuelle Zielversion. */
export const MIGRATION_COUNT = MIGRATIONS.length;

/**
 * Migriert die Datenbank auf `target` (Default: aktueller Stand). Jeder Schritt läuft in
 * einer eigenen Transaktion und schreibt danach `user_version` — bricht ein Schritt ab,
 * bleibt der letzte vollständige Stand erhalten. Der `target`-Parameter existiert, damit
 * Tests den Zwischenstand einer echten Bestandsdatenbank herstellen können.
 */
export function migrate(db: DB, target: number = MIGRATION_COUNT): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < target; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
