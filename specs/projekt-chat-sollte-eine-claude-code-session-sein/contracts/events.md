# Contract — Events / WebSocket (Erweiterungen)

Feature: Projekt-Chat als vollwertige Claude-Code-Session
Bus: `packages/server/src/events.ts` (`BusEvents`, `BUS_EVENT_NAMES`).
Fan-out: `GET /ws/events` (App-weit). Terminal: `GET /ws/terminal/:sessionId` (unverändert).
Web-Konsument: `packages/web/src/store.tsx` (`onmessage`-Switch).

## Wiederverwendete Events (unverändert)

- `session_status` `{ sessionId, featureId, projectId, status, awaitingKind }` — trägt jetzt auch
  Arbeits-Chat-Sessions (`featureId: null`). Der Store ordnet sie über `sessionId`/`projectId` zu.
- `attention_raised(AttentionItem)` / `attention_resolved(id)` — `AttentionItem.conversationId` ist
  für Arbeits-Chat gesetzt (Routing zum Chat-Panel, D6).
- `notification({ title, body, featureId, kind })` — `kind` bleibt; bei Arbeits-Chat ist
  `featureId` null (Notification-Klick öffnet die Sprechblase des Projekts).
- `chat_stream` / `chat_updated` — weiterhin **nur** für den Nur-Lese-Modus.

## Neue Events

### `chat_session_status`  (optional, falls nötig)

Falls die Unterscheidung Chat-vs-Feature im Store über `session_status` nicht ausreicht, ein
schmales Event für die Chat-Panel-Live-Anzeige:

```jsonc
{ "projectId": "…", "conversationId": "…", "sessionId": "…",
  "status": "idle|working|awaiting_input|stopped|errored",
  "awaitingKind": "permission|question|plan_approval|null" }
```

> Entscheidung: bevorzugt `session_status` wiederverwenden (kein neues Event). Dieses Event nur
> einführen, wenn die Store-Zuordnung sonst mehrdeutig wird. In `/speckit-tasks` final entscheiden.

### `chat_work_integrated`

```jsonc
{ "projectId": "…", "conversationId": "…", "result": "merged" | "failed",
  "detail": "…" }
```

- `merged`: Integration erfolgreich; Web beendet die Arbeits-Unterhaltung und schließt die Konsole.
- `failed`: Verify/Merge fehlgeschlagen; Web verweist auf den Inbox-Eintrag (`verify_failed` /
  `merge_conflict_escalated`), Worktree bleibt erhalten.

## Registrierungspflichten (Konsistenz)

Für jedes neue Event:
1. Feld in `BusEvents` + Name in `BUS_EVENT_NAMES` (`packages/server/src/events.ts`).
2. Case im Web-`onmessage`-Switch (`packages/web/src/store.tsx`) + Reducer-Action.
3. Kein Broadcast sensibler Inhalte über den reinen Status hinaus (localhost-Bus, aber additiv
   minimal halten).

## Terminal-Transport (unverändert, zur Erinnerung)

- Client→Server (JSON-Frames): `{type:'input',data}` · `{type:'resize',cols,rows}` ·
  `{type:'focus',focused}`; Server→Client: rohe PTY-Strings.
- Scrollback-Replay serverseitig beim `subscribe` (Snapshot-Prefix + 2 MB Ring). Reconnect nach
  ~1,5 s. Genau dieser Kanal trägt die Live-Beobachtung des Arbeits-Modus (FR-006).
