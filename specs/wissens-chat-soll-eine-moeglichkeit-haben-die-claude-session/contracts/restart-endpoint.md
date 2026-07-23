# Contract: Wissens-Chat Neustart-Endpoint

Neuer REST-Endpoint (Fastify) im bestehenden Chat-Work-Namespace. Ergänzt die vorhandenen Routen
(`.../chat`, `.../chat/work/session`, `.../chat/work/features/*`). Client-Methode in
`packages/web/src/api.ts`.

## POST `/api/projects/:id/chat/work/restart`

Beendet die aktive Wissens-Chat-Unterhaltung des Projekts und startet eine frische Session.

### Request

- **Path param**: `id` — Projekt-ID.
- **Body** (JSON):

```json
{ "confirm": false }
```

| Feld | Typ | Default | Bedeutung |
|------|-----|---------|-----------|
| `confirm` | boolean | `false` | `true` = Nutzer hat den Verlust laufender Arbeit bestätigt (überspringt den Guard). |

### Verhalten (Server)

1. Projekt & aktive Unterhaltung ermitteln. Existiert keine aktive Unterhaltung → es wird direkt eine neue erzeugt und gestartet (unschädlicher Neustart, Edge Case „leere Session").
2. **Guard (FR-006 / Q1)**: „Arbeit vorhanden" = Live-Session-Status ∈ {`working`, `awaiting_input`} **ODER** `!isCleanWorkingTree(worktreePath)`.
   - Wenn Arbeit vorhanden **und** `confirm !== true` → **409** zurückgeben, **nichts** verwerfen.
3. Andernfalls Neustart durchführen (Reihenfolge): alte PTY-Session `terminate` + `remove` → Worktree `remove(force:true)` → Branch `deleteBranch` (best-effort) → alte Unterhaltung `endConversation` → **flüchtigen Feature-Vorschlag der alten `conversationId` löschen (FR-009)** → neue Unterhaltung `createConversation('work')` → `ensure(projectId)` (spawnt frische Session).
4. `chat_updated`-Event feuern.

### Responses

**200 OK** — Neustart durchgeführt:

```json
{ "sessionId": "<neue Session-ID>", "conversationId": "<neue conversationId>" }
```

**409 Conflict** — Bestätigung nötig (Guard ausgelöst, nichts verworfen):

```json
{ "needsConfirm": true, "reason": "running" }
```

| `reason` | Bedeutung |
|----------|-----------|
| `"running"` | Session arbeitet gerade (working/awaiting_input). |
| `"dirty"` | Arbeitskopie enthält unbestätigte Änderungen. |

**404 Not Found** — Projekt nicht gefunden: `{ "message": "Projekt nicht gefunden" }` (`ChatError`).

**503 Service Unavailable** — neue Session/Worktree konnte nicht gestartet werden (FR-010):
`{ "message": "<verständlicher Fehler>" }`. Der bisherige Zustand bleibt möglichst erhalten; ein
erneuter Versuch ist möglich.

### Client-Flow (Web, `ChatPanel.tsx`)

```text
Klick auf Restart-Icon
  → api.restartChatWorkSession(projectId, false)
     → 200: getChat() neu laden; TerminalPane per key={conversationId} remounten
     → 409 { needsConfirm }: Bestätigungsdialog zeigen (Hinweis auf reason)
          → Bestätigt: api.restartChatWorkSession(projectId, true) → wie 200
          → Abgebrochen: nichts tun (alte Unterhaltung/Arbeit bleibt)
     → Fehler (503/…): Fehlerbanner im Panel; Icon bleibt nutzbar
```

- Der Restart-Button ist während eines laufenden Requests **deaktiviert** (Doppelklick-Schutz, FR-008).

### Client-Methode (Signaturvorschlag)

```ts
restartChatWorkSession: (projectId: string, confirm: boolean) =>
  request<{ sessionId: string; conversationId: string }>(
    'POST', `/api/projects/${projectId}/chat/work/restart`, { confirm },
  ),
```

## Abgrenzung zu bestehendem `POST /api/projects/:id/chat/reset`

`chat/reset` gehört zum alten **Nur-Lese**-Q&A-Chat (`ChatService.reset`) und beendet dort die
Unterhaltung ohne Worktree/Session-Cleanup. Der neue `chat/work/restart` ist der Neustart der
**vollwertigen Work-Session** (mit Worktree/Branch/PTY-Cleanup). Beide bleiben getrennt.
