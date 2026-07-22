# Contract — Events / WebSocket (Erweiterungen)

Feature: Projekt-Chat als vollwertige Claude-Code-Session
Bus: `packages/server/src/events.ts` (`BusEvents`, `BUS_EVENT_NAMES`).
Fan-out: `GET /ws/events`. Terminal: `GET /ws/terminal/:sessionId` (unverändert; Eingabe direkt).
Web-Konsument: `packages/web/src/store.tsx` (`onmessage`-Switch).

> Stand nach Überarbeitung: es wurde **kein** neues WS-Event nötig. `chat_work_integrated`
> (aus dem verworfenen Übernehmen-Flow) existiert nicht.

## Wiederverwendete Events

- `session_status` `{ sessionId, featureId, conversationId, projectId, status, awaitingKind }` —
  trägt jetzt auch Chat-Sessions (`featureId: null`, `conversationId` gesetzt). Der Store ordnet
  sie über `conversationId` dem Chat-Panel zu (Status-Indikator, Sprechblasen-Puls).
- `attention_raised(AttentionItem)` / `attention_resolved(id)` — `AttentionItem.conversationId`
  ist für Chat-Sessions gesetzt (Inbox „Zum Chat →").
- `chat_updated({ projectId, conversationId })` — Invalidierungssignal: Feature-Vorschlag
  erschienen/entschieden oder Turn fertig → Panel lädt `GET /chat` neu (holt `pendingFeatures`).
- `notification(...)` — u. a. „Feature-Vorschlag" (kind `input_requested`, lautlos) und
  „wartet auf dich".

## Feature-Vorschlag-Fluss (ohne neues Event)

1. Session gibt in einer Assistant-Nachricht den Marker `<sdd:features>[…]</sdd:features>` aus.
2. Server liest ihn über den Transcript-Watcher (`onAssistantText`) → speichert den Vorschlag →
   `chat_updated`.
3. Panel lädt `GET /chat` → `pendingFeatures` → Bestätigungskarte.
4. `POST …/features/create` bzw. `…/dismiss` → `chat_updated` (+ `feature_updated` bei Anlage).

## Terminal-Transport (unverändert)

Client→Server (JSON): `{type:'input',data}` · `{type:'resize',cols,rows}` · `{type:'focus',focused}`;
Server→Client: rohe PTY-Strings. Scrollback-Replay serverseitig beim `subscribe`. Dieser Kanal ist
die einzige Eingabe des Chats (kein separates Prompt-Feld).
