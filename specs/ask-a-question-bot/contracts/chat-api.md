# Contract: Chat-API (REST + WS-Events)

**Feature**: [../spec.md](../spec.md) · Datenformen: [../data-model.md](../data-model.md)

Alle Routen werden in `buildServer()` (`packages/server/src/api/server.ts`) registriert und über `deps.chat` (neuer `ChatService`) bedient. Fehlerformat wie bestehend: `httpError(status, message)` → `{error: message}`.

## REST

### `GET /api/projects/:id/chat`

Aktive Unterhaltung samt Nachrichten (chronologisch).

- **200**: `{ conversation: ChatConversation | null, messages: ChatMessage[] }` — `conversation: null`, wenn noch nie gechattet oder nach Reset (dann `messages: []`).
- **404**: Projekt unbekannt.

### `POST /api/projects/:id/chat/messages`

Sendet eine Nutzer-Nachricht und startet den Assistenten-Turn (asynchron). Erzeugt die aktive Unterhaltung lazy (Data-Model-Invariante).

- **Request**: `{ content: string }` — nicht leer, getrimmt.
- **202**: `{ conversationId, userMessage: ChatMessage, assistantMessage: ChatMessage }` — `assistantMessage.status = 'streaming'`, `content = ''`; Fortschritt kommt über WS.
- **400**: leerer `content`.
- **404**: Projekt unbekannt.
- **409**: In dieser Unterhaltung läuft bereits ein Turn (`{error: 'Antwort läuft bereits'}`); UI deaktiviert Senden solange.

### `POST /api/projects/:id/chat/reset`

Beendet die aktive Unterhaltung („Neue Unterhaltung", FR-009). Läuft ein Turn, wird er abgebrochen und seine Nachricht `interrupted`.

- **200**: `{ conversation: null }` — nächste Nachricht erzeugt eine frische Unterhaltung.
- **404**: Projekt unbekannt.

### `PATCH /api/chat/messages/:messageId/proposal`

Entscheidung zum Feature-Vorschlag einer Assistenten-Nachricht (FR-006/FR-008). Die Feature-Anlage selbst läuft unverändert über `POST /api/projects/:id/features` (bestehender Contract) — dieser Endpoint verbucht nur die Entscheidung.

- **Request**: `{ status: 'angenommen', featureId: string } | { status: 'abgelehnt' }`
- **200**: aktualisierte `ChatMessage`.
- **404**: Nachricht unbekannt oder ohne Vorschlag.
- **409**: Vorschlag bereits entschieden (terminal, Data-Model).

## WS-Events (Broadcast über bestehenden `GET /ws/events`)

Neue Einträge in `BusEvents` + `BUS_EVENT_NAMES` (`packages/server/src/events.ts`); Client-Handling im `ws.onmessage`-Switch von `packages/web/src/store.tsx`. Rahmenformat wie bestehend: `{type: <name>, payload: <payload>}`.

### `chat_stream`

Antwortfortschritt eines laufenden Turns. **Implementierungs-Entscheidung** (Abweichung vom ursprünglichen Delta-Entwurf): Der Payload trägt den **kumulierten** bisherigen Text statt eines Deltas — idempotent und robust, wenn ein Client mitten im Turn beitritt (Panel-Öffnen während laufender Antwort); der Client setzt statt anzuhängen.

```ts
{ projectId: string, conversationId: string, messageId: string,
  text: string,           // kumulierter Antworttext bis jetzt ('' beim Abschluss-Frame möglich)
  done: boolean }         // true: Nachricht terminal (complete/error/interrupted)
```

Nach `done: true` folgen keine weiteren Frames für diese `messageId`. Client-Regel: `text` als aktuellen Stand übernehmen; bei `done` Nachricht per `chat_updated`/GET nachladen (autoritative Fassung inkl. Proposal/Kosten/Fehler).

### `chat_updated`

Grobes Invalidierungssignal (Turn fertig, Vorschlag entschieden, Reset).

```ts
{ projectId: string, conversationId: string }
```

Client-Regel: Ist das Panel für dieses Projekt sichtbar, `GET /api/projects/:id/chat` neu laden. Damit funktioniert auch „Panel war zu, während die Antwort fertig wurde" (Edge Case).

## Typen (Auszug, `packages/shared/src/types.ts`)

```ts
export interface ChatConversation {
  id: string; projectId: string; claudeSessionId: string | null;
  createdAt: number; updatedAt: number; endedAt: number | null;
}
export interface ChatMessage {
  id: string; conversationId: string; role: 'user' | 'assistant';
  content: string; status: 'complete' | 'streaming' | 'error' | 'interrupted';
  error: string | null; proposal: FeatureProposal | null;
  costUsd: number | null; tokens: number | null; createdAt: number;
}
export interface FeatureProposal {
  name: string; description: string;
  status: 'offen' | 'angenommen' | 'abgelehnt'; featureId?: string;
}
```

## Vertrag mit der Claude-CLI (intern, `buildChatArgv`)

`claude -p <content> --output-format stream-json --include-partial-messages [--resume <claudeSessionId>] --append-system-prompt <chatPrompt> --allowedTools "Read,Grep,Glob"` · cwd = `projects.path` · Timeout 20 min. System-Prompt-Vertrag (R5): Feature-Vorschläge ausschließlich als `<feature-vorschlag name="kebab-slug">Beschreibung</feature-vorschlag>` im Antworttext; Parser entfernt den Marker aus `content` und befüllt `proposal`.
