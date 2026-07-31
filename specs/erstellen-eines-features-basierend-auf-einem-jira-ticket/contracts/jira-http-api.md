# HTTP-Contract: Jira-Anbindung & Import

Alle Routen werden in `packages/server/src/api/server.ts` registriert (Interface `ApiDeps`).
Antworten sind JSON; Fehlerkörper folgen dem bestehenden Muster `{ message: string }`.

**Globales Fehler-Mapping** (alle Jira-Routen):

| Zustand | HTTP | Körper |
|---|---|---|
| Nicht verbunden / Autorisierung abgelaufen | 401 | `{ message, state: 'reauth_required' \| 'disconnected' }` |
| Jira nicht erreichbar (Netz/Dienst) | 503 | `{ message }` — Client bietet „Erneut versuchen" |
| Fehlende Berechtigung auf Einzelobjekt | 403 | `{ message }` |

## Verbindung (US1)

### GET /api/jira/status
- **Response 200**: `JiraConnectionStatus` — `{ state, account?, site? }`
- Immer 200, auch unverbunden (`state: 'disconnected'`); niemals 500 für erwartbare Zustände.

### POST /api/jira/connect
- Startet den OAuth-Flow (Dynamic Client Registration, lokaler Callback).
- **Response 200**: `{ authUrl: string }` — Client öffnet die URL im Browser und pollt `/api/jira/status`.

### GET /api/jira/oauth/callback?code=&state=
- Schließt den OAuth-Flow ab (vom Browser des Anbieters aufgerufen).
- **Response 200**: minimale HTML-Seite („Fenster kann geschlossen werden").
- **Response 400**: bei ungültigem `state`/`code` (HTML mit Fehlerhinweis).

### POST /api/jira/disconnect
- Entfernt `~/.sdd-toolkit/atlassian-mcp.json`, schließt die Verbindung.
- **Response 200**: `{ state: 'disconnected' }`

## Browse (US2)

### GET /api/jira/sites
- **Response 200**: `JiraSite[]` (via getAccessibleAtlassianResources)

### GET /api/jira/projects?siteId=
- **Response 200**: `JiraProject[]` — Pagination vollständig aufgelöst; nur für den Nutzer sichtbare Projekte.

### GET /api/jira/sprints?siteId=&projectKey=
- **Response 200**: `JiraSprint[]` — aktive + zukünftige Sprints aller Boards, Dedupe per Sprint-ID, sortiert aktiv → zukünftig → Startdatum (FR-007).
- Projekt ohne Sprints → `[]` (Client wechselt auf Backlog-Sicht, FR-008).

### GET /api/jira/issues?siteId=&projectKey=&sprintId=&projectId=
- `sprintId` optional: fehlt → Ticketliste auf Projektebene (Backlog-Sicht).
- `projectId` (Toolkit-Projekt) optional: liefert das Feld `imported` je Ticket über `FeatureRepo.listJiraKeys(projectId)` (FR-010).
- **Response 200**: `JiraIssueSummary[]`; leerer Sprint → `[]` (Client zeigt Leer-Hinweis, kein Fehler).

## Letzte Auswahl (US2, FR-009)

### GET /api/settings/jira
- **Response 200**: `{ siteId?: string; projectKey?: string; sprintId?: number }` (leer = `{}`)

### PUT /api/settings/jira
- **Request**: `{ siteId, projectKey?, sprintId? }`
- **Response 200**: gespeicherte Auswahl (Settings-Key `jira.lastSelection`).

## Import (US3/US4)

### POST /api/projects/:id/jira-import
- **Request**:
  ```json
  {
    "siteId": "…",
    "issueKeys": ["PROJ-1", "PROJ-2"],
    "confirmedReimports": ["PROJ-1"]
  }
  ```
  `confirmedReimports` optional — nur diese Keys dürfen trotz vorhandener Übernahme erneut importiert werden (FR-014).
- **Response 200**: `JiraImportResult[]` — ein Eintrag je angefragtem Key, Reihenfolge erhalten:
  ```json
  [
    { "issueKey": "PROJ-1", "status": "created", "featureId": "…" },
    { "issueKey": "PROJ-2", "status": "failed", "error": "…" }
  ]
  ```
  Teilfehler ⇒ trotzdem 200 (FR-015); 401/503 nur, wenn der Gesamtvorgang unmöglich ist (keine Verbindung).
- **Response 404**: unbekanntes Toolkit-Projekt.

**Wirkung je `created`**: Feature via `orchestrator.createFeature` (Slug/Branch/Worktree/Session, Specify-Start mit Ticketmaterial), `jiraRef` persistiert, Dossier + Anhänge unter `specs/<slug>/jira/` im Feature-Worktree (US4), Event `feature_updated` über den bestehenden WS-Bus.
