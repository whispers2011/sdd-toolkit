# Phase 1 Data Model: Wissens-Chat neu starten

Das Feature führt **keine neuen Tabellen und keine Migration** ein. Es nutzt den bestehenden
Zustand und ändert nur Übergänge (Deaktivieren + Neuanlage). Referenz: `packages/server/src/db/repos.ts`.

## Entität: Chat-Unterhaltung (`chat_conversations`) — bestehend

| Feld | Bedeutung (relevant für dieses Feature) |
|------|------------------------------------------|
| `id` | Eindeutige `conversationId` (nanoid). Bestimmt Worktree `chat-<id>`, Branch `chat/<id>`, Resume-Bindung. |
| `project_id` | Zugehöriges Projekt. Genau eine **aktive** Unterhaltung pro Projekt. |
| `mode` | `'work'` für den Wissens-Chat. |
| `claude_session_id` | Letzte Claude-Session-ID (Resume-Kandidat). Für eine **neue** Conversation `NULL` ⇒ kein Resume ⇒ clean. |
| `ended_at` | `NULL` = aktiv; gesetzt = **deaktiviert/behalten**. Der Neustart setzt es auf der alten Unterhaltung. |

**Identität/Eindeutigkeit**: `getActive(projectId)` = Zeile mit `ended_at IS NULL`. Invariante: höchstens
eine aktive Unterhaltung pro Projekt (FR-008).

**Zustandsübergang (Neustart)**:

```text
[aktiv: alt]  --restart-->  [inaktiv: alt (ended_at gesetzt, Nachrichten erhalten)]
                            +
                            [aktiv: neu (ended_at = NULL, claude_session_id = NULL)]
```

- Regel (Q2/FR-002): Deaktivieren via `endConversation(id)`; **kein** Löschen von `chat_conversations`/`chat_messages`.
- Regel (FR-003): Neue Conversation hat `claude_session_id = NULL` ⇒ `ensure` spawnt ohne `--resume`.

## Entität: Chat-Nachrichten (`chat_messages`) — bestehend, unverändert

- Bleiben an die (nun inaktive) alte `conversation_id` gebunden und werden **nicht** gelöscht.
- Die Chat-Anzeige lädt nur Nachrichten der **aktiven** Unterhaltung ⇒ nach Neustart leer (FR-005).

## Entität: Live-Session (`sessions` + PTY) — bestehend

| Feld | Bedeutung |
|------|-----------|
| `id` | PTY-Session-ID (`ptys.forConversation(convId)`). |
| `conversation_id` | Bindung an die Unterhaltung. |
| `claude_session_id` | Für Resume-Recovery; bei der neuen Conversation nicht vorhanden. |

**Übergang (Neustart)**: alte Session `terminate(id)` + `remove(id)` und DB-Zeile via `end(id)`;
neue Session wird durch `ensure(projectId)` für die neue Conversation angelegt.

## Ressource: Worktree & Branch — bestehend

- Alte Unterhaltung: Worktree `chat-<oldConvId>` + Branch `chat/<oldConvId>` werden verworfen
  (`worktrees.remove(..., { force: true })` + `mergeEngine.deleteBranch(...)`), FR-007.
- Neue Unterhaltung: `ensure` legt Worktree `chat-<newConvId>` + Branch `chat/<newConvId>` neu an.

## Flüchtiger Zustand: Feature-Vorschlag — bestehend (in-memory)

- `ChatWorkService.proposals` (Map `conversationId → Vorschlag`) und `lastMarker` sind an die
  `conversationId` gebunden. Beim Neustart müssen die Einträge der **alten** `conversationId`
  entfernt werden (FR-009), damit keine verwaiste Vorschlagskarte übrig bleibt. Bereits angelegte
  Features (eigene Feature-Datensätze) sind unberührt.

## Abgeleitete Invarianten (für Tests)

- **INV-1**: Nach `restart` gilt `getActive(projectId).id !== oldConvId` und `oldConv.ended_at !== NULL`.
- **INV-2**: `listMessages(oldConvId)` liefert nach `restart` weiterhin die alten Nachrichten (nicht gelöscht).
- **INV-3**: `getActive(projectId).claude_session_id === NULL` unmittelbar nach `restart` (clean).
- **INV-4**: Genau eine Live-Session für das Projekt-Chat nach beliebig vielen Neustarts (FR-008).
- **INV-5**: Kein Worktree/Branch mit `chat/<oldConvId>` bleibt nach `restart` zurück.
