# Research: Features aus Jira-Tickets erstellen

**Datum**: 2026-07-23 · **Input**: spec.md (inkl. Clarifications Session 2026-07-23), Codebasis-Analyse

Alle offenen Punkte aus dem Technical Context sind aufgelöst; es verbleibt kein NEEDS CLARIFICATION.

## R1: Jira-Anbindung — Atlassian Rovo MCP statt eigener REST-Integration

- **Decision**: Anbindung über den offiziellen Atlassian MCP (Rovo MCP, `https://mcp.atlassian.com/v1/sse`) als MCP-Client via `@modelcontextprotocol/sdk`; Autorisierung über dessen OAuth-Browser-Flow (Dynamic Client Registration + lokaler Callback).
- **Rationale**: Per Clarification fixiert (Spec, Session 2026-07-23). Das Toolkit speichert damit weder Jira-Passwörter noch eigene API-Token (FR-002); Token-Verwaltung und -Erneuerung liegen beim MCP/SDK. Der Rovo MCP bietet die benötigten Tools (`atlassianUserInfo`, `getAccessibleAtlassianResources`, `getVisibleJiraProjects`, `searchJiraIssuesUsingJql`, `getJiraIssue`, `getJiraIssueRemoteIssueLinks`).
- **Alternatives considered**:
  - *Direkte Jira-REST-API mit eigener OAuth-App*: abgelehnt — eigene Client-Registrierung bei Atlassian, eigene Token-Speicherung/-Rotation, widerspricht FR-002 und der Clarification.
  - *Atlassian API-Token (Basic Auth)*: abgelehnt — dauerhafte Secrets im Toolkit, genau das schließt die Spec aus.

## R2: Transport und SDK

- **Decision**: `@modelcontextprotocol/sdk` (TypeScript-Referenz-SDK) mit SSE-Transport gegen `https://mcp.atlassian.com/v1/sse`, Fallback auf Streamable HTTP, falls der SSE-Endpunkt abgekündigt wird.
- **Rationale**: Einziges offiziell gepflegtes Client-SDK mit eingebautem `OAuthClientProvider`-Interface (Auth-Flow, Refresh, 401-Handling). Bisher keine MCP-Abhängigkeit im Repo — eine neue, durch die Clarification gedeckte Dependency.
- **Alternatives considered**: Eigener minimaler SSE/JSON-RPC-Client — abgelehnt (OAuth-DCR + Refresh selbst zu bauen ist fehleranfällig und ohne Mehrwert).

## R3: Persistenz der OAuth-Daten auf Nutzerebene

- **Decision**: Eigene `OAuthClientProvider`-Implementierung persistiert Client-Registrierung + Tokens als JSON unter `~/.sdd-toolkit/atlassian-mcp.json`. „Verbindung trennen" = Datei löschen + Verbindung schließen.
- **Rationale**: FR-003 verlangt Nutzerebene (projektübergreifend, überlebt Neustarts). `~/.sdd-toolkit` ist bereits das globale Datenverzeichnis (`config.ts`: `dataDir`). Eine separate Datei statt der `settings`-Tabelle hält Secrets aus der App-DB heraus, macht das Trennen trivial atomar (unlink) und passt zum dateiorientierten Provider-Interface des SDK.
- **Alternatives considered**: `SettingsRepo` (`settings`-Key/Value-Tabelle) — abgelehnt für Tokens (Secrets in der DB, Backups/Snapshots würden Tokens mitkopieren); wird aber für die *nicht geheime* letzte Auswahl genutzt (R7).

## R4: Sprints ohne Agile-API — JQL-Aggregation

- **Decision**: Der Rovo MCP bietet keine Agile-/Board-Tools. Sprintlisten werden per JQL über `searchJiraIssuesUsingJql` aggregiert: `project = X AND sprint in openSprints()` bzw. `futureSprints()`, Sprint-Feld der Treffer auswerten, Dedupe über Sprint-ID (mehrere Boards → eine zusammengeführte Liste, FR-007). Pure Merge-Logik in `packages/shared/src/jiraSprints.ts`.
- **Rationale**: Deckt FR-007 (aktive + zukünftige Sprints, keine Board-Auswahl) ohne zweite Auth-Strecke ab. Abgeschlossene Sprints sind laut Assumptions nicht nötig.
- **Risiko/Verifikation**: Vor der Implementierung per `tools/list` verifizieren, ob inzwischen Agile-Tools existieren (Notiz in tasks.md T012/T014); die JQL-Aggregation ist die belastbare Rückfallebene. Projekte ohne Sprints → Ticketliste auf Projektebene (`project = X ORDER BY updated DESC`), erfüllt FR-008.
- **Alternatives considered**: Jira Agile REST (`/rest/agile/1.0/board/.../sprint`) direkt — abgelehnt, bräuchte eigene Auth außerhalb des MCP (R1).

## R5: Ticketinhalt — ADF/Wiki-Markup → Markdown

- **Decision**: Eigener, schlanker Konverter als pure Funktion in `packages/shared/src/jiraContent.ts`: Absätze, Überschriften, Listen, Tabellen, Codeblöcke, Links, Erwähnungen als Klarnamen; `buildTicketDossier(...)` rendert Titel, Beschreibung, alle ausgefüllten Felder (Standard + Custom, leere ausgelassen — FR-017), Kommentare mit Autor/Zeitpunkt und Anhangsliste zu einem Markdown-Dossier.
- **Rationale**: FR-019 verlangt lesbare Form ohne rohe Markup-Reste. Die MCP-Antworten liefern Text/ADF-Strukturen; ein fokussierter Konverter ist klein, vollständig testbar (Vitest in shared) und vermeidet eine Abhängigkeit, deren ADF-Abdeckung wir ohnehin prüfen müssten.
- **Alternatives considered**: `adf-to-md`-artige npm-Pakete — abgelehnt (geringe Pflege, deckt Wiki-Markup-Altformat nicht ab); Roh-Übernahme — verletzt FR-019.

## R6: Anhänge

- **Decision**: Zugängliche Anhänge werden unabhängig von der Größe über die authentifizierte MCP-Verbindung geladen und unter `specs/<slug>/jira/attachments/` im Feature-Worktree abgelegt; nicht abrufbare Anhänge werden im Dossier mit Name + Quell-URL vermerkt (FR-018, per Clarification: keine Größengrenze).
- **Rationale**: Der Worktree ist das natürliche Arbeitsmaterial des Features (Schnappschuss-Charakter); der Verweis-Fallback hält die Übernahme robust, falls der MCP keinen Content-Zugriff auf einzelne Anhänge gewährt.
- **Alternatives considered**: Anhänge nur verlinken — abgelehnt (Links erfordern Jira-Login und brechen den Schnappschuss-Anspruch von SC-003).

## R7: Merken der letzten Auswahl

- **Decision**: `{ siteId, projectKey, sprintId }` als Settings-Key `jira.lastSelection` über den bestehenden `SettingsRepo` (`getJson`/`setJson`), Routen `GET/PUT /api/settings/jira`.
- **Rationale**: FR-009; die `settings`-Tabelle ist bereits der Ort für globale, nicht geheime App-Einstellungen (automation, optimization, transcription).
- **Alternatives considered**: localStorage im Web-Client — abgelehnt (überlebt Browser-/Profilwechsel nicht, Server kennt die Vorbelegung dann nicht).

## R8: Duplikat-Erkennung und Feature-Anlage

- **Decision**: Drei neue Spalten an `features` (`jira_key`, `jira_url`, `jira_imported_at`) + Index `(project_id, jira_key)`; `FeatureRepo.listJiraKeys(projectId)` speist die `imported`-Kennzeichnung (FR-010) und die Bestätigungspflicht beim Re-Import (FR-014). Die Anlage läuft über das bestehende `orchestrator.createFeature(projectId, name, description)` — Slug, Branch, Worktree, Session und Specify-Start inklusive (FR-016); Namenskollisionen werden vor dem Aufruf per Ticketschlüssel-Suffix aufgelöst (FR-013, `createFeature` lehnt vorhandene Slugs ab).
- **Rationale**: Spalten statt JSON, weil Duplikat-Lookup und Index sonst nicht sauber möglich sind; `createFeature` unverändert zu nutzen garantiert identisches Verhalten zu manuell angelegten Features.
- **Alternatives considered**: Eigene Import-Pipeline am Orchestrator vorbei — abgelehnt (verletzt FR-016, dupliziert Worktree-/Session-Logik).

## R9: Fehler-Mapping und Resilienz

- **Decision**: `atlassianMcpClient` mappt 401/`invalid_grant`/abgelaufene Tokens auf den Status `reauth_required` (HTTP 401 mit Hinweis), Netzwerk-/Dienstfehler auf typisierten `JiraUnreachableError` (HTTP 503 mit Wiederholungsmöglichkeit). Mehrfachimport iteriert je Ticket mit try/catch und liefert `JiraImportResult[]` (`created` | `failed` | `skipped_duplicate`) — kein Abbruch der übrigen (FR-015).
- **Rationale**: Edge Cases der Spec (Ablauf mitten in der Sitzung, Jira nicht erreichbar, fehlende Berechtigungen) verlangen unterscheidbare, verständliche Zustände statt generischer 500er; das restliche Toolkit bleibt unberührt, weil Jira-Routen isoliert sind.
