# Contract — REST API (Erweiterungen)

Feature: Projekt-Chat als vollwertige Claude-Code-Session
Basis: `http://127.0.0.1:4820`, registriert in `packages/server/src/api/server.ts`.
Client-Wrapper: `packages/web/src/api.ts`.

> Stand nach Überarbeitung (siehe spec.md › Clarifications, Session 2). Der Chat ist **immer**
> eine Session; es gibt keinen Modus, kein Prompt-Feld und keine Übernehmen/Verwerfen-Endpunkte.
> Der Terminal-Stream `GET /ws/terminal/:sessionId` wird **unverändert wiederverwendet** (Eingabe
> erfolgt direkt dort).

## Endpunkte

### GET /api/projects/:id/chat

```jsonc
{
  "conversation": { "id": "…", "projectId": "…", "mode": "work", "claudeSessionId": "…|null", … } | null,
  "messages": [],                    // leer (Legacy-Ask-Feld; Interaktion läuft über die Konsole)
  "workSession": {                   // null, solange keine Session läuft
    "sessionId": "…", "status": "idle|working|awaiting_input|stopped|errored",
    "awaitingKind": "permission|question|plan_approval|null", "branch": "chat/<id>"
  } | null,
  "pendingFeatures": {               // null, wenn kein offener Vorschlag
    "id": "…", "features": [ { "name": "kebab", "description": "…" } ]
  } | null
}
```

### POST /api/projects/:id/chat/work/session

Stellt die Session sicher (idempotent): Worktree/Branch anlegen (falls nötig) und PTY-Session
spawnen/rehydrieren. → `{ "sessionId": "…" }` (Web verbindet `TerminalPane` auf
`/ws/terminal/:id`). Fehler: `404` Projekt fehlt · `503` Worktree/Session konnte nicht erstellt
werden (verständliche Meldung, erneut versuchbar).

### POST /api/projects/:id/chat/work/features/create

Legt die bestätigten Features des offenen Vorschlags an (Teilmenge per Name).

- Request: `{ "names": ["pdf-export", …] }`
- Response `200`: `{ "features": Feature[] }` (angelegt über `orchestrator.createFeature`)
- Fehler: `404` keine aktive Unterhaltung / kein offener Vorschlag · `400` keine Auswahl ·
  `409` Anlage aller gewählten fehlgeschlagen

### POST /api/projects/:id/chat/work/features/dismiss

Verwirft den offenen Feature-Vorschlag (legt nichts an). → `{ "ok": true }`

## Bestehende Wiederverwendung (kein neuer Contract)

- `POST /api/projects/:id/features` — der kanonische Feature-Anlage-Weg, den `features/create`
  intern nutzt.
- `PUT /api/settings/automation`, `PATCH /api/projects/:id` (`automation`) — die Session erbt
  diese Werte (Permission-Mode).
- Der frühere Ask-Modus (`/chat/messages`, `/chat/reset`, `/chat/messages/:id/proposal`) ist im
  UI entfallen; die Endpunkte bleiben serverseitig vorhanden, werden aber vom Chat nicht genutzt.
