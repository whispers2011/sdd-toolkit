# Data Model: Ask-a-Question-Bot (Projekt-Chat)

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · Entscheidungen: [research.md](./research.md) (R3, R7, R8)

Neue Migration am Ende des `MIGRATIONS`-Arrays (`packages/server/src/db/database.ts`); Zugriff über neuen `ChatRepo` (`packages/server/src/db/repos.ts`) nach bestehendem Repo-Muster. TypeScript-Typen in `packages/shared/src/types.ts`.

## Entität: ChatConversation (`chat_conversations`)

Eine fortlaufende Unterhaltung zwischen Nutzer und Assistent, gebunden an ein Projekt. Pro Projekt existiert höchstens **eine aktive** Unterhaltung (`ended_at IS NULL`).

| Spalte | Typ | Constraints | Beschreibung |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | nanoid(10) |
| `project_id` | TEXT | NOT NULL, FK → `projects(id)` ON DELETE CASCADE | Zugehöriges Projekt |
| `claude_session_id` | TEXT | NULL | Externe Session-Id aus stream-json (`init`/`result`); NULL bis zum ersten abgeschlossenen Turn; wird bei Resume-Fallback ersetzt (R4) |
| `created_at` | INTEGER | NOT NULL | Unix-ms |
| `updated_at` | INTEGER | NOT NULL | Unix-ms; bei jedem Turn aktualisiert |
| `ended_at` | INTEGER | NULL | Gesetzt durch „Neue Unterhaltung" (Reset); beendete Unterhaltungen werden nicht mehr angezeigt |

**Invarianten**:
- Höchstens eine Zeile pro `project_id` mit `ended_at IS NULL` (per partiellem UNIQUE-Index `ON chat_conversations(project_id) WHERE ended_at IS NULL`).
- Lazy-Erzeugung: Die erste gesendete Nachricht eines Projekts erzeugt die aktive Unterhaltung.

**Zustandsübergänge**: `aktiv` (ended_at NULL) → `beendet` (ended_at gesetzt). Kein Weg zurück; Reset erzeugt eine neue aktive Zeile.

## Entität: ChatMessage (`chat_messages`)

Ein einzelner Beitrag innerhalb einer Unterhaltung.

| Spalte | Typ | Constraints | Beschreibung |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | nanoid(10) |
| `conversation_id` | TEXT | NOT NULL, FK → `chat_conversations(id)` ON DELETE CASCADE | Zugehörige Unterhaltung |
| `role` | TEXT | NOT NULL, CHECK IN (`user`,`assistant`) | Absender |
| `content` | TEXT | NOT NULL | Anzeigetext (Assistenten-Nachrichten: Marker bereits entfernt, R5); bei `streaming` der bisher empfangene Teiltext |
| `status` | TEXT | NOT NULL, CHECK IN (`complete`,`streaming`,`error`,`interrupted`) | Turn-Status; `user`-Nachrichten sind immer `complete` |
| `error` | TEXT | NULL | Verständliche Fehlermeldung bei `status = 'error'` (FR-010) |
| `proposal_json` | TEXT | NULL | Serialisierter `FeatureProposal` (nur `assistant`); NULL wenn kein Vorschlag |
| `cost_usd` | REAL | NULL | Turn-Kosten (nur letzte Assistenten-Nachricht eines Turns; Duplikat der `executions`-Zeile für Anzeige im Panel, R7) |
| `tokens` | INTEGER | NULL | Turn-Tokens (dito) |
| `created_at` | INTEGER | NOT NULL | Unix-ms; Sortierschlüssel (Index auf `(conversation_id, created_at)`) |

**Zustandsübergänge (`assistant`-Nachricht)**:

```text
streaming ──(result-Event)──▶ complete
streaming ──(Spawn-/Turn-Fehler, Timeout 20 min)──▶ error
streaming ──(Server-Boot-Cleanup, R8)──▶ interrupted
```

`complete`, `error`, `interrupted` sind terminal.

## Wertobjekt: FeatureProposal (in `proposal_json`)

Vom Assistenten abgeleiteter Feature-Vorschlag (R5); kein eigener Tabelleneintrag, da 1:0..1 zur Assistenten-Nachricht.

| Feld | Typ | Beschreibung |
|---|---|---|
| `name` | string | Kebab-Case-Namensvorschlag aus dem Marker-Attribut; Validierung wie manuelle Anlage (`slugify`) |
| `description` | string | Anforderungsbeschreibung aus dem Marker-Inhalt; nicht leer |
| `status` | `'offen' \| 'angenommen' \| 'abgelehnt'` | Entscheidung des Nutzers |
| `featureId` | string \| undefined | Gesetzt bei `angenommen` nach erfolgreichem `createFeature` |

**Zustandsübergänge**: `offen` → `angenommen` (Dialog bestätigt, Feature erstellt) · `offen` → `abgelehnt` (Karte abgelehnt). Dialog-Abbruch lässt `offen` (erneut aufrufbar, Edge Case der Spec). `angenommen`/`abgelehnt` sind terminal.

## Erweiterung bestehender Typen

- `ExecutionKind` (`packages/shared/src/types.ts`): Union um `'chat'` erweitern. Pro abgeschlossenem Turn eine `executions`-Zeile: `project_id` gesetzt, `feature_id` NULL, `phase` NULL, `log_path` → Turn-Log (R7). Keine Schemaänderung an `executions` nötig.

## Beziehungen (Übersicht)

```text
projects 1 ──── 0..n chat_conversations (max. 1 aktiv)
chat_conversations 1 ──── 0..n chat_messages
chat_messages (assistant) 1 ──── 0..1 FeatureProposal (JSON-Feld)
FeatureProposal (angenommen) ──── 1 features (via featureId; lose Referenz, kein FK)
executions (kind='chat') n ──── 1 projects (bestehende Tabelle)
```

Lose Referenz `featureId` bewusst ohne FK: Das Feature kann später gelöscht/gemergt werden, der Chat-Verlauf bleibt historisch korrekt.
