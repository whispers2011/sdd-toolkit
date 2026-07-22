# Contract — REST API (Erweiterungen)

Feature: Projekt-Chat als vollwertige Claude-Code-Session
Basis: `http://127.0.0.1:4820`, registriert in `packages/server/src/api/server.ts`.
Client-Wrapper: `packages/web/src/api.ts`.

Bestehende Chat-Routen bleiben unverändert:
`GET /api/projects/:id/chat`, `POST /api/projects/:id/chat/messages`,
`POST /api/projects/:id/chat/reset`, `PATCH /api/chat/messages/:messageId/proposal`.
Der Terminal-Stream `GET /ws/terminal/:sessionId` wird **unverändert wiederverwendet**.

## Erweiterte/neue Endpunkte

### GET /api/projects/:id/chat  (erweitert)

`ChatState` wird um den Modus + optionale Arbeits-Session ergänzt:

```jsonc
{
  "conversation": {
    "id": "…", "projectId": "…", "mode": "ask" | "work",
    "claudeSessionId": "…|null", "endedAt": null, "createdAt": 0, "updatedAt": 0
  },
  "messages": [ /* ChatMessage[] — nur im ask-Modus befüllt */ ],
  "workSession": {                 // nur wenn mode === 'work' und Session existiert
    "sessionId": "…",
    "status": "idle|working|awaiting_input|stopped|errored",
    "awaitingKind": "permission|question|plan_approval|null",
    "branch": "chat/<shortId>",
    "hasChanges": true             // Worktree enthält uncommittete/committete Änderungen
  } | null
}
```

### POST /api/projects/:id/chat/mode

Setzt/wählt den Modus. Nur erlaubt, solange keine Nachricht/kein Turn in der aktiven Unterhaltung
läuft; ansonsten `409`. Wechsel auf einen anderen Modus impliziert eine **neue Unterhaltung**
(Reset der bisherigen), damit `mode` konversationsfix bleibt (data-model).

- Request: `{ "mode": "ask" | "work" }`
- Response `200`: `ChatState` (wie oben, neue Unterhaltung im gewählten Modus)
- Fehler: `404` Projekt fehlt · `409` läuft gerade · `400` ungültiger Modus

### POST /api/projects/:id/chat/work/session

Stellt die Arbeits-Session sicher (idempotent): legt Worktree/Branch an (falls nötig) und
spawnt/rehydriert die PTY-Session. Spiegelt `POST /api/features/:id/session`.

- Request: `{}`
- Response `200`: `{ "sessionId": "…" }`  → Web verbindet `TerminalPane` auf `/ws/terminal/:id`
- Fehler: `404` Projekt/aktive Work-Unterhaltung fehlt · `409` Unterhaltung nicht im `work`-Modus ·
  `503` Worktree/Session konnte nicht erstellt werden (verständliche Meldung, erneut versuchbar —
  Edge Case „Session kann nicht starten")

### POST /api/projects/:id/chat/work/prompt

Sendet einen Prompt in die laufende Arbeits-Session (bracketed paste + submit). Spiegelt
`POST /api/features/:id/prompt`.

- Request: `{ "text": "…" }`
- Response `202`: `{ "ok": true }`
- Fehler: `404` keine Session · `409` kein `work`-Modus

### POST /api/projects/:id/chat/work/interrupt

Unterbricht die laufende Session (2× Ctrl-C → SIGKILL), ohne Worktree/Branch zu verwerfen (FR-006).

- Response `200`: `{ "status": "stopped" }`
- Fehler: `404` keine Session

### POST /api/projects/:id/chat/work/discard

Verwirft die Arbeit restlos (FR-007): terminate → worktree `remove(force)` → branch delete →
snapshot remove → Session-Zeile schließen. Beendet außerdem die aktive Arbeits-Unterhaltung.

- Request: `{ "confirm": true }`  (UI bestätigt via ConfirmDialog)
- Response `200`: `{ "conversation": null }`
- Fehler: `404` keine Session · `400` `confirm` fehlt

### POST /api/projects/:id/chat/work/integrate

Übernimmt die Arbeit nach `main` (FR-004): commit → verify (falls `verifyCommands`) → merge →
Cleanup. Läuft asynchron; Fortschritt/Ergebnis über Events + Inbox.

- Request: `{}`
- Response `202`: `{ "executionId": "…" }`
- Ergebnis:
  - Erfolg → `chat_work_integrated` Event, Unterhaltung endet, Worktree entfernt.
  - Verify/Merge-Fehler → `attention` (`verify_failed` / `merge_conflict_escalated`) mit
    `conversationId`; Worktree bleibt erhalten (FR-012), erneut versuchbar.
- Fehler: `404` keine Session · `409` kein `work`-Modus / bereits in Integration

## Bestehende Wiederverwendung (kein neuer Contract)

- `PUT /api/settings/automation`, `PATCH /api/projects/:id` (`automation`) — der Arbeits-Modus
  erbt diese Werte (D5). Kein per-Unterhaltung-Override im MVP.
- `POST /api/projects/:id/features` — bleibt der Übergabe-Weg für „feature-würdigen Umfang"
  (FR-010), aufgerufen wie beim Proposal aus dem Nur-Lese-Modus.
