# Contract: WebSocket-Event

Der Server broadcastet Bus-Events generisch über `/ws/events` als `{ type, payload }` (siehe `api/server.ts`, Schleife über `BUS_EVENT_NAMES`). Für dieses Feature kommt **ein** neues Event hinzu.

## `knowledge_updated`

**Wann**: nach jeder erfolgreichen schreibenden Wissens-Operation (Bundle/Entry create/update/delete, import, refresh, Selektions-Änderung).

**Payload**:
```ts
{ projectId: string }
```

**Ergänzungen im Code**:

`packages/server/src/events.ts`
```ts
export interface BusEvents {
  // … bestehende …
  knowledge_updated: (payload: { projectId: string }) => void;
}
export const BUS_EVENT_NAMES: (keyof BusEvents)[] = [
  // … bestehende …
  'knowledge_updated',
];
```

`packages/web/src/store.tsx` — neuer Case im `ws.onmessage`-Switch:
```ts
case 'knowledge_updated':
  // gezielter Refetch NUR für das betroffene Projekt (kein globaler Reload)
  dispatch({ type: 'knowledge_invalidate', projectId: (msg.payload as { projectId: string }).projectId });
  break;
```

## Design-Regel

- **Nur Invalidierung, keine Volldaten** über WS (D6): Der Client lädt den Baum/Index bei Bedarf via `GET /api/projects/:id/knowledge` neu. Hält die WS-Nutzlast klein und `/api/state` unberührt.
- Wissen ist **nicht** Teil des `/api/state`-Bootstraps — es wird beim Öffnen des Wissens-Panels bzw. der Feature-Auswahl geladen (Muster wie `executions`).
- Kein neues Terminal-/Session-Event nötig; Materialisierung läuft serverseitig in `startPhaseRun` und braucht keinen eigenen Broadcast (der bestehende `feature_updated`/`session_status`-Fluss bleibt maßgeblich).
