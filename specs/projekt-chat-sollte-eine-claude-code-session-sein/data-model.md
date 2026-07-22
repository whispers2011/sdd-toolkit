# Phase 1 — Data Model

Feature: Projekt-Chat als vollwertige Claude-Code-Session

Nur **additive** Änderungen (neue Migration, keine Breaking-Changes). Bestehende Tabellen:
`chat_conversations`, `chat_messages`, `sessions`, `executions`, `attention` (siehe
`packages/server/src/db/database.ts`).

## Entitäten & Änderungen

### ChatConversation (erweitert)

Bestehend: `id`, `projectId`, `claudeSessionId`, `createdAt`, `updatedAt`, `endedAt`.

| Feld | Typ | Neu? | Beschreibung |
|---|---|---|---|
| `mode` | `'ask' \| 'work'` | **neu** | Modus der Unterhaltung (FR-011). Default `'ask'`. Bei `endConversation` beginnt eine neue Unterhaltung wieder mit dem gewählten Modus. |

- **Invariante (unverändert)**: höchstens eine aktive Unterhaltung pro Projekt
  (`idx_chat_active`).
- **Invariante (neu)**: `mode` ist nach Anlage der Unterhaltung fix. Ein Moduswechsel = neue
  Unterhaltung (Reset).
- **Migration**: `ALTER TABLE chat_conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'ask'
  CHECK(mode IN ('ask','work'))`.

### ChatMessage (unverändert)

Bleibt exakt wie heute und wird **nur im `'ask'`-Modus** verwendet. Im `'work'`-Modus ist die
Wahrheit der Unterhaltung der PTY-Stream + Snapshot (wie bei Feature-Sessions); es werden dort
keine `chat_messages` geschrieben. (Optionaler späterer Ausbau: Prompt-Historie des Arbeits-Modus
protokollieren — nicht Teil dieses MVP.)

### ChatWorkSession (neu — über die bestehende `sessions`-Tabelle)

Keine neue Tabelle: Wiederverwendung von `sessions` mit `kind = 'chat_work'`, `feature_id = NULL`
und neuer Bindung `conversation_id`.

| Feld | Typ | Neu? | Beschreibung |
|---|---|---|---|
| `id` | TEXT PK | – | Session-Id (auch WS-Terminal-Kanal `/ws/terminal/:id`). |
| `feature_id` | TEXT NULL | – | bleibt `NULL` für Chat-Work. |
| `conversation_id` | TEXT NULL → FK `chat_conversations(id)` ON DELETE CASCADE | **neu** | Bindung an die Unterhaltung. |
| `project_id` | TEXT | – | Projektbezug. |
| `kind` | TEXT | – | `'chat_work'`. |
| `claude_session_id` | TEXT NULL | – | für `claude --resume`. |
| `pid` | INTEGER NULL | – | PTY-Prozess. |
| `created_at` / `ended_at` | INTEGER | – | Lebenszyklus. |

- **Laufzeit-Bindung (nicht persistiert, im `LiveSession`)**: `worktreePath`, `branch` — abgeleitet
  deterministisch aus `conversationId` (siehe research D2), daher nach Neustart rekonstruierbar.
- **Migration**: `ALTER TABLE sessions ADD COLUMN conversation_id TEXT REFERENCES
  chat_conversations(id) ON DELETE SET NULL`.
- **Repo**: `SessionRepo.create(...)` akzeptiert `conversationId`; neu
  `SessionRepo.latestForConversation(conversationId)` (analog `latestForFeature`).

### AttentionItem (erweitert)

| Feld | Typ | Neu? | Beschreibung |
|---|---|---|---|
| `conversationId` | TEXT NULL | **neu** | Routing-Ziel: gesetzt ⇒ Inbox-Eintrag springt in den Chat-Panel des Projekts; sonst wie bisher `featureId` → Feature-Konsole (D6). |

- **Migration**: `ALTER TABLE attention ADD COLUMN conversation_id TEXT`.
- **Kinds**: wiederverwendet (`awaiting_input`, `permission_request`, `agent_errored`,
  `verify_failed`) — kein neuer Kind nötig.
- **Dedup**: bestehende Dedup-Regel (kind+project+feature+session) wird um `conversation` ergänzt.

### ExecutionRecord (erweitert)

| Feld | Typ | Neu? | Beschreibung |
|---|---|---|---|
| `kind` | Enum | **Wert neu** | `'chat_work'` ergänzt (`'phase' \| 'verify' \| 'review' \| 'conflict_resolution' \| 'chat' \| 'chat_work'`). |

- Kosten/Tokens gemetert wie bei Feature-Turns (D9). Kein Migrationsbedarf (Spalte ist frei-TEXT).

## Zustände & Übergänge

### Modus einer Unterhaltung

```
(neue Unterhaltung) --wähle 'ask'--> ASK  (Nur-Lese, heutiges Verhalten)
(neue Unterhaltung) --wähle 'work'--> WORK (interaktive Arbeits-Session)
ASK/WORK --Reset ("Neue Unterhaltung")--> (neue Unterhaltung, Modus erneut wählbar)
```

### Arbeits-Session (nutzt `SessionMachine`, unverändert)

`created → launching → ready → working ⇄ awaiting_input(permission|question|plan_approval) →
turn_done → (working|stopped|errored)`. Signale aus Hook-Bridge (Vorrang) + Transcript.

### Lebenszyklus einer Arbeits-Unterhaltung

```
WORK gewählt
  └─ ensureChatWorkSession: Worktree/Branch anlegen (idempotent) → PTY-Session spawnen (mit Hooks)
       ├─ Prompt(s) → Änderungen im Worktree; Freigaben via Inbox/Dial
       ├─ Unterbrechen → terminate (Session lebt weiter/kann neu gestartet werden)
       ├─ Verwerfen  → terminate + worktree remove(force) + branch delete + snapshot remove
       └─ Übernehmen → commit → verify → merge nach default → Cleanup (wie Verwerfen)
```

## Beziehungen

```
Project 1───* ChatConversation (≤1 aktiv, mode ask|work)
ChatConversation 1───* ChatMessage        (nur im ask-Modus)
ChatConversation 1───0..1 Session(kind=chat_work)   (nur im work-Modus, via conversation_id)
Session(chat_work) 1───1 Worktree/Branch   (deterministisch aus conversationId)
ChatConversation 1───* AttentionItem       (via conversationId, work-Modus)
ChatConversation 1───* ExecutionRecord      (kind chat / chat_work)
```

## Validierungsregeln (aus den Requirements)

- FR-004: Arbeits-Änderungen nur in der Chat-Worktree; Haupt-Arbeitskopie unberührt bis Merge.
- FR-005: Vor eingreifenden Aktionen greift der Automation-Dial (permissionMode); kein separater
  Pfad.
- FR-007: Verwerfen hinterlässt keine Rückstände (Worktree/Branch/Snapshot entfernt).
- FR-008: `mode`, Session-Zeile (`claude_session_id`) und Snapshot überleben Neustart;
  Nur-Lese-Verlauf (`chat_messages`) wie bisher.
- FR-012: Fehlgeschlagene Aktion/Verify → Unterhaltung + Worktree bleiben konsistent; Fehler wird
  im Terminal/als Inbox-Eintrag sichtbar.
