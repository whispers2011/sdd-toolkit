# Contract: REST-API (Wissen)

Fastify-Routen, additiv in `packages/server/src/api/server.ts`. Konventionen wie im Bestand: JSON-Body, Fehler via `httpError(status, msg)`, IDs `nanoid(10)`. Alle schreibenden Routen emittieren `knowledge_updated` (siehe `ws-events.md`). Client-Methoden spiegeln sich in `packages/web/src/api.ts`.

## Verwaltung (CRUD) — P1/P2

### `GET /api/projects/:id/knowledge`
Liefert Baum **und** Index des Projekts.
```jsonc
// 200
{
  "tree": { "roots": [ /* KnowledgeTreeNode */ ], "looseEntries": [ /* KnowledgeEntry */ ] },
  "index": { "projectId": "…", "items": [ /* KnowledgeIndexItem */ ], "generatedAt": 0 }
}
```
`404` wenn Projekt unbekannt.

### `POST /api/projects/:id/knowledge/bundles`
```jsonc
// Body
{ "parentId": "…|null", "name": "Bundle X", "applicability": { "text": "…", "tags": ["auth"] }, "sortOrder": 0 }
// 200 → KnowledgeBundle
```
`400` bei leerem Namen / Zyklus / fremdem `parentId`.

### `PATCH /api/knowledge/bundles/:bundleId`
Teil-Update (`name`, `applicability`, `parentId`, `sortOrder`). `parentId`-Änderung wird auf Zyklus geprüft. → `KnowledgeBundle`.

### `DELETE /api/knowledge/bundles/:bundleId`
Kaskadiert auf Unter-Bundles + Einträge. → `{ "ok": true }`.

### `POST /api/projects/:id/knowledge/entries`
```jsonc
// Body (inline)
{ "bundleId": "…|null", "title": "…", "body": "# Markdown …",
  "applicability": { "text": "…", "tags": [] }, "source": "inline", "sortOrder": 0 }
// 200 → KnowledgeEntry
```
`400` bei leerem Titel / fremdem `bundleId`.

### `PATCH /api/knowledge/entries/:entryId`
Teil-Update (`title`, `body`, `applicability`, `bundleId`, `sortOrder`). → `KnowledgeEntry`.

### `DELETE /api/knowledge/entries/:entryId`
→ `{ "ok": true }`.

## Import bestehender Repo-Dateien — FR-015 / D7

### `POST /api/projects/:id/knowledge/entries/import`
```jsonc
// Body
{ "bundleId": "…|null", "sourcePath": "docs/architektur.md", "title": "…?",
  "applicability": { "text": "…", "tags": [] } }
// 200 → KnowledgeEntry (source='file', body aus Datei gelesen)
```
`400` bei `..`-Traversal / Datei außerhalb des Projekt-Checkouts; `404` wenn Datei fehlt. Titel default = Dateiname.

### `POST /api/knowledge/entries/:entryId/refresh`
Liest `source='file'`-Body neu aus der Quelle (Drift-Heilung, FR-013). → `KnowledgeEntry`. `409` wenn `source='inline'`.

## Feature-Auswahl & Materialisierung — P4

### `GET /api/features/:id/knowledge`
Aufgelöste Auswahl für die Vorschau/Übersteuerung.
```jsonc
// 200
{
  "index": { /* KnowledgeIndex des Projekts */ },
  "resolved": { "autoIncluded": [], "userIncluded": [], "userExcluded": [], "effective": [] }
}
```

### `PUT /api/features/:id/knowledge/selection`
Setzt/entfernt einen Override.
```jsonc
// Body
{ "targetId": "…", "targetKind": "bundle|entry", "decision": "include|exclude|auto" }
// 'auto' entfernt einen bestehenden Override. 200 → resolved (wie oben)
```

### `POST /api/features/:id/knowledge/materialize`
Schreibt `.sdd/knowledge/` in den Worktree (idempotent). Wird intern auch von `startPhaseRun` aufgerufen; manuell für Vorschau/Re-Sync nutzbar.
```jsonc
// 200
{ "indexPath": ".sdd/knowledge/index.md", "materialized": [ { "id":"…", "path":".sdd/knowledge/…" } ] }
```
`409` wenn kein Worktree existiert.

## Fehler-Konvention

`{ "message": "…" }` mit passendem HTTP-Status (400/404/409). Deutsch, wie im Bestand.
