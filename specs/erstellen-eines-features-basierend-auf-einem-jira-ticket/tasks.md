# Tasks: Features aus Jira-Tickets erstellen

**Input**: Design documents from `/specs/erstellen-eines-features-basierend-auf-einem-jira-ticket/`

**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/jira-http-api.md, quickstart.md (alle vorhanden). Der technische Kontext unten deckt sich mit plan.md; Details und Begründungen dort bzw. in research.md.

**Tests**: Die Spezifikation fordert keine TDD-Phase. Das Repo hat aber eine feste Konvention (Vitest, kolokierte `*.test.ts` neben jedem Service/Shared-Modul) — Tests sind deshalb Bestandteil der jeweiligen Implementierungs-Tasks, keine eigenen Task-Blöcke.

**Organization**: Tasks sind nach User Story gruppiert, damit jede Story unabhängig implementier- und testbar bleibt.

## Technischer Kontext (aus Codebasis abgeleitet)

- **Monorepo (pnpm)**: `packages/server` (Fastify, better-sqlite3/WAL, node-pty), `packages/web` (Vite/React), `packages/shared` (pure Logik + Typen). Node ≥ 22, TypeScript, Vitest.
- **Server-Konventionen**: alle HTTP-Routen in `packages/server/src/api/server.ts` (Interface `ApiDeps`), Services flach unter `packages/server/src/services/`, Verdrahtung in `packages/server/src/index.ts`, DB-Migrationen als Array in `packages/server/src/db/database.ts` (`user_version`-Zähler), Repos in `packages/server/src/db/repos.ts` (`SettingsRepo` mit `getJson`/`setJson`).
- **Web-Konventionen**: Komponenten unter `packages/web/src/components/`, Fetch-Helper in `packages/web/src/api.ts`, Store/Views in `packages/web/src/store.tsx`, Dialog-Pattern siehe `Sidebar.tsx`/`ProjectSettings.tsx`.
- **Feature-Anlage**: `POST /api/projects/:id/features` → `orchestrator.createFeature(projectId, name, description)` (Slug, Worktree, Session, Beschreibung startet die Specify-Phase). Der Jira-Import setzt genau hier auf (FR-016: importierte Features verhalten sich wie manuelle).
- **Jira-Anbindung (per Clarification fixiert)**: offizieller Atlassian Rovo MCP (`https://mcp.atlassian.com/v1/sse`) als MCP-Client via `@modelcontextprotocol/sdk` mit OAuth-Browser-Flow (Dynamic Client Registration + lokaler Callback). Client-Registrierung/Token persistiert der SDK-`OAuthClientProvider` auf **Nutzerebene** unter `~/.sdd-toolkit/atlassian-mcp.json` (projektunabhängig, überlebt Neustarts); das Toolkit hält keine Jira-Passwörter oder selbst verwaltete API-Token.
- **Bekanntes Risiko (Sprints)**: Der Rovo MCP bietet keine Agile-Board-Tools. Sprintlisten werden per JQL-Aggregation ermittelt (`sprint in openSprints()` / `futureSprints()` je Projekt, Dedupe über Boards per Sprint-ID) — deckt FR-007 (zusammengeführte Liste ohne Board-Auswahl) ab, ist aber in T014 zuerst zu verifizieren.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallel ausführbar (andere Dateien, keine Abhängigkeit auf offene Tasks)
- **[Story]**: Zuordnung zur User Story (US1–US4); nur in Story-Phasen
- Jede Task nennt exakte Dateipfade

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Abhängigkeiten, Typen und Datenmodell für alle Stories

- [X] T001 [P] Abhängigkeit `@modelcontextprotocol/sdk` in packages/server/package.json ergänzen (`pnpm --filter @sdd/server add @modelcontextprotocol/sdk`), Build/Typecheck des Server-Pakets verifizieren
- [X] T002 [P] Shared-Typen in packages/shared/src/types.ts: optionales Feld `jiraRef?: { key: string; url: string; importedAt: number }` am `Feature`-Interface sowie DTOs `JiraConnectionStatus` (state: disconnected|connecting|connected|reauth_required, account?, site?), `JiraSite`, `JiraProject`, `JiraSprint`, `JiraIssueSummary` (key, title, type, status, imported), `JiraImportResult` (issueKey, status: created|failed|skipped_duplicate, featureId?, error?); Export über packages/shared/src/index.ts
- [X] T003 DB-Migration in packages/server/src/db/database.ts (neuer Migrationseintrag: `ALTER TABLE features ADD COLUMN jira_key TEXT; ALTER TABLE features ADD COLUMN jira_url TEXT; ALTER TABLE features ADD COLUMN jira_imported_at INTEGER; CREATE INDEX idx_features_jira ON features(project_id, jira_key)`) und FeatureRepo in packages/server/src/db/repos.ts erweitern: Row-Mapping ↔ `jiraRef`, `setJiraRef(featureId, ref)`, `listJiraKeys(projectId): string[]` (abhängig von T002)

**Checkpoint**: Typen und Schema stehen — Migration läuft gegen bestehende Dev-DB fehlerfrei durch

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: MCP-Client als Kern der Jira-Verbindung — von allen Stories benötigt

**⚠️ CRITICAL**: Ohne diese Phase kann keine User Story beginnen

- [X] T004 Service packages/server/src/services/atlassianMcpClient.ts: MCP-Client zum Rovo MCP (`https://mcp.atlassian.com/v1/sse`, Fallback Streamable HTTP) via @modelcontextprotocol/sdk; `OAuthClientProvider`-Implementierung mit Persistenz unter `~/.sdd-toolkit/atlassian-mcp.json` (Client-Registrierung + Tokens, Nutzerebene); öffentliche API: `getStatus()`, `startConnect(): { authUrl }`, `handleCallback(code, state)`, `disconnect()` (Persistenzdatei entfernen, Verbindung schließen), `callTool(name, args)`; Fehler-Mapping: 401/invalid_grant/abgelaufene Tokens → Status `reauth_required`, Netzwerkfehler → typisierter `JiraUnreachableError`; inkl. Tests (gemockter Transport) in packages/server/src/services/atlassianMcpClient.test.ts
- [X] T005 Verdrahtung: `AtlassianMcpClient` in packages/server/src/index.ts instanziieren und in das `ApiDeps`-Interface in packages/server/src/api/server.ts aufnehmen (analog zu bestehenden Services wie mergeQueue/knowledge)

**Checkpoint**: Foundation ready — User-Story-Phasen können starten

---

## Phase 3: User Story 1 - Jira-Verbindung einrichten und autorisieren (Priority: P1) 🎯 MVP

**Goal**: Nutzer verbindet/trennt Jira in den Benutzereinstellungen, sieht Konto + Instanz, Verbindung überlebt Neustarts, abgelaufene Autorisierung ist direkt erneuerbar (FR-001–FR-005).

**Independent Test**: In den Einstellungen Jira-Anbindung starten, OAuth-Freigabe im Browser erteilen → Bereich zeigt „verbunden" mit Konto und Instanz. Server neu starten → weiterhin verbunden ohne Login. Trennen → unverbundener Ausgangszustand.

### Implementation for User Story 1

- [X] T006 [US1] Routen in packages/server/src/api/server.ts: `GET /api/jira/status` (Status inkl. Konto via `atlassianUserInfo`-Tool und Site-Angabe), `POST /api/jira/connect` (liefert `{ authUrl }`), `GET /api/jira/oauth/callback` (schließt OAuth-Flow ab, antwortet mit minimaler „Fenster schließen"-HTML-Seite), `POST /api/jira/disconnect`; Fehlerfälle: `reauth_required` als Status (nicht als 500), Jira nicht erreichbar → 503 mit verständlicher Meldung
- [X] T007 [P] [US1] Fetch-Helper in packages/web/src/api.ts: `jiraStatus()`, `jiraConnect()`, `jiraDisconnect()`
- [X] T008 [US1] Komponente packages/web/src/components/JiraSettings.tsx (Dialog-Pattern wie ProjectSettings.tsx): unverbundener Zustand mit „Mit Jira verbinden" (öffnet `authUrl` in neuem Tab, pollt danach den Status), verbundener Zustand mit Konto + Jira-Instanz und „Verbindung trennen" (mit Bestätigung), Zustand `reauth_required` mit Hinweistext und „Erneut autorisieren"-Button (Akzeptanzszenario 4)
- [X] T009 [US1] Einstiegspunkt in packages/web/src/components/Sidebar.tsx: Bereich „Benutzereinstellungen" mit Jira-Eintrag, der den JiraSettings-Dialog öffnet (gleiches Dialog-Hosting wie ProjectSettings)
- [X] T010 [US1] Neustart-Persistenz in packages/server/src/services/atlassianMcpClient.ts: beim Serverstart persistierte Registrierung/Tokens laden und `getStatus()` ohne erneuten Login korrekt melden; Test für „Persistenzdatei vorhanden → connected/reauth_required, fehlt → disconnected" in packages/server/src/services/atlassianMcpClient.test.ts

**Checkpoint**: US1 eigenständig testbar — Verbinden, Neustart, Trennen, Re-Auth funktionieren ohne jede Browse-/Import-Funktion

---

## Phase 4: User Story 2 - Projekte, Sprints und Tickets durchsuchen (Priority: P2)

**Goal**: Nach Verbindung Site → Projekt → Sprint wählen und Tickets (Key, Titel, Typ, Status) sehen; Projekte ohne Sprints über Backlog-Sicht; letzte Auswahl vorbelegt (FR-006–FR-009).

**Independent Test**: Mit verbundener Instanz Site und Projekt wählen, Sprintliste anzeigen, Sprint wählen → Tickets mit Schlüssel, Titel, Typ, Status erscheinen; leerer Sprint zeigt Leer-Hinweis; erneutes Öffnen belegt die letzte Auswahl vor.

### Implementation for User Story 2

- [X] T011 [P] [US2] Pure Sprint-Merge-Logik in packages/shared/src/jiraSprints.ts: `mergeSprints(sprints)` — Dedupe über mehrere Boards per Sprint-ID, nur aktive + zukünftige, Sortierung aktiv vor zukünftig, dann Startdatum (FR-007); inkl. packages/shared/src/jiraSprints.test.ts und Export in packages/shared/src/index.ts
- [X] T012 [US2] Service packages/server/src/services/jiraBrowseService.ts auf Basis von `atlassianMcpClient.callTool`: `listSites()` (getAccessibleAtlassianResources), `listProjects(siteId)` (getVisibleJiraProjects, Pagination vollständig auflösen), `listSprints(siteId, projectKey)` (JQL-Aggregation `sprint in openSprints()`/`futureSprints()` über searchJiraIssuesUsingJql, Sprint-Feld auswerten, `mergeSprints`), `listIssues(siteId, projectKey, sprintId?)` (Sprint- oder Projekt-/Backlog-Ebene; Key, Titel, Typ, Status); inkl. Tests mit gemocktem MCP-Client in packages/server/src/services/jiraBrowseService.test.ts
- [X] T013 [US2] Routen in packages/server/src/api/server.ts: `GET /api/jira/sites`, `GET /api/jira/projects?siteId=`, `GET /api/jira/sprints?siteId=&projectKey=`, `GET /api/jira/issues?siteId=&projectKey=&sprintId=` sowie `GET/PUT /api/settings/jira` (letzte Auswahl `{ siteId, projectKey, sprintId }` über SettingsRepo-Schlüssel `jira.lastSelection`, FR-009); Fehler-Mapping: `reauth_required` → 401 mit Hinweis, nicht erreichbar → 503
- [X] T014 [P] [US2] Fetch-Helper in packages/web/src/api.ts: `jiraSites()`, `jiraProjects(siteId)`, `jiraSprints(siteId, projectKey)`, `jiraIssues(siteId, projectKey, sprintId?)`, `getJiraSelection()`, `saveJiraSelection(sel)`
- [X] T015 [US2] Komponente packages/web/src/components/JiraImportDialog.tsx (Browse-Teil): Kaskade Site → Projekt → Sprint mit Ladezuständen; Projekte ohne Sprints → automatische Backlog-Sicht (Akzeptanzszenario 4); Ticketliste mit Key, Titel, Typ, Status; Leer-Hinweis statt Fehler bei leerem Sprint (Szenario 6); Fehlerzustand mit „Erneut versuchen"; Vorbelegung aus und Persistieren nach `jira.lastSelection` (Szenario 5); bei `reauth_required` Hinweis mit Verweis auf die Einstellungen
- [X] T016 [US2] Einstiegspunkt in packages/web/src/components/Sidebar.tsx: Aktion „Aus Jira importieren" neben „Neues Feature" — öffnet JiraImportDialog bei verbundenem Status, sonst Hinweis mit Sprung zu den Jira-Einstellungen

**Checkpoint**: US1 + US2 unabhängig testbar — Jira-Sicht im Toolkit funktioniert komplett ohne Import

---

## Phase 5: User Story 3 - Tickets als neue Features übernehmen (Priority: P3)

**Goal**: Ein oder mehrere Tickets in einem Vorgang übernehmen; pro Ticket genau ein Feature mit Titel, Beschreibung und dauerhafter Ticket-Referenz; Fehler einzelner Tickets stoppen die übrigen nicht; Duplikate nur nach Bestätigung (FR-011–FR-016).

**Independent Test**: Zwei Tickets in der Liste auswählen und übernehmen → zwei neue Features existieren im Projekt, jeweils mit Ticket-Titel, Ticket-Beschreibung und sichtbarem Jira-Key samt Link; ein bereits übernommenes Ticket ist markiert und verlangt vor erneuter Übernahme eine Bestätigung.

### Implementation for User Story 3

- [X] T017 [US3] Service packages/server/src/services/jiraImportService.ts: `importIssues(projectId, siteId, issueKeys, confirmedReimports)` — je Ticket: Ticket via `getJiraIssue` laden, Feature-Name aus Titel (Slug; bei Kollision mit bestehendem Feature Suffix aus Ticketschlüssel, FR-013), `orchestrator.createFeature` mit Beschreibung aus Titel, Jira-Key + Browse-URL und Ticket-Beschreibung aufrufen (startet damit den normalen Specify-Workflow, FR-016), `FeatureRepo.setJiraRef` persistieren; bereits importierte Keys (`listJiraKeys`) ohne Bestätigung → `skipped_duplicate` (FR-014); Fehler je Ticket fangen und als Ergebnis ausweisen statt abzubrechen (FR-015); Rückgabe `JiraImportResult[]`; inkl. Tests (gemockter Orchestrator + MCP-Client) in packages/server/src/services/jiraImportService.test.ts
- [X] T018 [US3] Route `POST /api/projects/:id/jira-import` (Body `{ siteId, issueKeys, confirmedReimports? }`) in packages/server/src/api/server.ts, Service-Verdrahtung in packages/server/src/index.ts; zusätzlich in `GET /api/jira/issues` das Feld `imported` je Ticket über `FeatureRepo.listJiraKeys(projectId)` füllen (FR-010; Route erhält dafür `projectId`-Query-Parameter)
- [X] T019 [US3] JiraImportDialog.tsx erweitern + Helper `jiraImport(projectId, payload)` in packages/web/src/api.ts: Mehrfachauswahl per Checkbox, „Übernehmen (n)"-Button, „bereits übernommen"-Badge, Bestätigungsabfrage bei Re-Import (Szenario 3), Ergebnisansicht je Ticket (Erfolg → Link zur Feature-Konsole via `set_view`, Fehler → Meldung; Szenario 4), Auswahl-Reset bei Wechsel von Projekt/Sprint (Edge Case Kontextwechsel)
- [X] T020 [US3] Sichtbare Ticket-Referenz: Jira-Key als klickbarer Link (Browse-URL) auf der Feature-Karte in packages/web/src/components/KanbanBoard.tsx und im Konsolen-Header in packages/web/src/components/FeatureConsole.tsx (nutzt `feature.jiraRef` aus T002/T003; FR-012)

**Checkpoint**: Kernnutzen steht — Weg vom Jira-Ticket zum Toolkit-Feature funktioniert Ende-zu-Ende

---

## Phase 6: User Story 4 - Ticketkontext vollständig einlesen (Priority: P4)

**Goal**: Übernahme umfasst Kommentare (Autor + Zeitpunkt), sämtliche ausgefüllte Standard-/Custom-Felder und alle zugänglichen Anhänge; Jira-Formatierung wird lesbar konvertiert (FR-017–FR-019).

**Independent Test**: Ticket mit mehreren Kommentaren und Anhängen übernehmen → das Feature enthält ein Dossier mit allen Kommentaren (Autor, Zeitpunkt), allen ausgefüllten Feldern und allen zugänglichen Anhängen bzw. Verweisen auf nicht abrufbare.

### Implementation for User Story 4

- [X] T021 [P] [US4] Pure Konvertierung in packages/shared/src/jiraContent.ts: ADF-/Wiki-Markup → Markdown (Absätze, Listen, Tabellen, Codeblöcke, Erwähnungen als Klarnamen, Links; keine rohen Markup-Reste, FR-019), Kommentar-Formatierung mit Autor + Zeitpunkt, Feld-Rendering nur ausgefüllter Felder (Standard + Custom inkl. Labels, Priorität, verknüpfte Tickets), `buildTicketDossier(issue, comments, fields, attachmentNotes): string`; inkl. packages/shared/src/jiraContent.test.ts und Export in packages/shared/src/index.ts
- [X] T022 [US4] jiraImportService.ts erweitern: vollständiges Ticket laden (alle ausgefüllten Felder über die Feld-Expansion von `getJiraIssue`, Kommentare, verknüpfte Tickets inkl. `getJiraIssueRemoteIssueLinks`), Dossier per `buildTicketDossier` als `specs/<slug>/jira/ticket.md` in den Feature-Worktree schreiben und den Specify-Prompt um den Verweis auf das Dossier als Ausgangsmaterial ergänzen (FR-017); Tests in packages/server/src/services/jiraImportService.test.ts erweitern
- [X] T023 [US4] Anhang-Übernahme in packages/server/src/services/jiraImportService.ts: zugängliche Anhänge unabhängig von der Größe authentifiziert über die MCP-Verbindung abrufen und unter `specs/<slug>/jira/attachments/` im Worktree ablegen; nicht abrufbare Anhänge (fehlende Berechtigung, kein Content-Zugriff über den MCP) als Verweis mit Name + Quell-URL im Dossier vermerken (FR-018); Test für den Verweis-Fallback

**Checkpoint**: Alle Stories unabhängig funktionsfähig — Übernahme enthält den vollständigen Ticketkontext

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Edge-Case-Härtung, Doku, Gesamtvalidierung

- [X] T024 [P] Edge-Case-Härtung: Trennung der Verbindung bei geöffnetem JiraImportDialog → Rückfall in den unverbundenen Zustand ohne Datenverlust im restlichen Toolkit (Status-Polling/Event in packages/web/src/components/JiraImportDialog.tsx und JiraSettings.tsx); Ablauf der Autorisierung mitten in der Sitzung → Hinweis mit direkter Re-Auth-Möglichkeit, aktuelle Ansicht bleibt erhalten (Edge Cases aus spec.md)
- [X] T025 [P] Dokumentation: README.md um Abschnitt „Jira-Import" ergänzen (Voraussetzungen, Verbindung einrichten, Tickets übernehmen, Ablageort `~/.sdd-toolkit/atlassian-mcp.json`)
- [X] T026 Gesamtvalidierung: `pnpm -r typecheck && pnpm -r test` grün; manueller Durchstich entlang der Success Criteria SC-001–SC-006 (Einrichtung < 3 min, Einzelticket < 1 min, Vollständigkeit der Übernahme, ≥ 10 Tickets in einem Vorgang mit Teilfehlern, Neustart ohne Re-Login, 100 % Duplikat-Kennzeichnung)
  - Automatisiert erledigt: Typecheck + 339 Tests grün (3 Pakete), Migration gegen Kopie der Dev-DB verifiziert (`user_version` 10 → 11, 55 Bestands-Features lesbar). Rovo-MCP-Tool-Schemata gegen den Live-MCP verifiziert (Namen/Parameter/Pagination, Hinweis aus T012/T014).
  - Offen (erfordert Live-Jira + Browser-OAuth): manueller Durchstich SC-001–SC-006 gemäß quickstart.md Stufen 2–6.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten — T001 und T002 parallel, T003 nach T002
- **Foundational (Phase 2)**: benötigt T001 (SDK) und T002 (Typen) — **blockiert alle User Stories**
- **User Stories (Phase 3–6)**: alle benötigen Phase 2
  - **US1 (P1)**: nur Phase 2 — keine Abhängigkeit auf andere Stories
  - **US2 (P2)**: nur Phase 2 (Verbindung kann für Tests auch direkt über eine bestehende Persistenzdatei hergestellt werden); UI-Einstieg T016 verweist auf JiraSettings aus US1
  - **US3 (P3)**: benötigt US2 (Ticketliste als Auswahlgrundlage) und T003 (Jira-Spalten)
  - **US4 (P4)**: benötigt US3 (erweitert den Import)
- **Polish (Phase 7)**: nach Abschluss der gewünschten Stories

### Within Each User Story

- Services vor Routen, Routen vor Web-Helpern/UI
- Shared-Pure-Logik ([P]-Tasks T011, T021) jederzeit nach Phase 1 möglich
- Story abschließen (Checkpoint testen), bevor die nächste Priorität beginnt

### Parallel Opportunities

- Phase 1: T001 ∥ T002
- US1: T007 parallel zu T006; T008/T009 nach T007
- US2: T011 ∥ T012-Start; T014 parallel zu T013
- US4: T021 parallel zu T022-Vorbereitung (T022 konsumiert T021)
- Phase 7: T024 ∥ T025
- Story-übergreifend: nach Phase 2 kann US2-Backend (T011/T012) parallel zur US1-UI (T008/T009) entstehen — verschiedene Dateien

---

## Parallel Example: User Story 2

```bash
# Nach Abschluss von Phase 2 gleichzeitig starten:
Task: "T011 Pure Sprint-Merge-Logik in packages/shared/src/jiraSprints.ts"
Task: "T012 jiraBrowseService.ts mit gemocktem MCP-Client"

# Nach T013 gleichzeitig:
Task: "T014 Fetch-Helper in packages/web/src/api.ts"
Task: "T015 JiraImportDialog.tsx (Browse-Teil)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001–T003)
2. Phase 2: Foundational (T004–T005) — kritisch, blockiert alles
3. Phase 3: US1 (T006–T010)
4. **STOP & VALIDATE**: Verbinden → Neustart → Trennen → Re-Auth unabhängig testen
5. Demo-fähig: Jira-Verbindung in den Benutzereinstellungen

### Incremental Delivery

1. Setup + Foundational → Fundament steht
2. US1 → unabhängig testen → MVP (Verbindungsstatus sichtbar)
3. US2 → unabhängig testen → Jira-Sicht im Toolkit
4. US3 → unabhängig testen → Ticket-zu-Feature-Übernahme (Kernnutzen)
5. US4 → unabhängig testen → vollständiger Ticketkontext
6. Polish → Edge Cases, Doku, Gesamtvalidierung

---

## Notes

- [P]-Tasks = andere Dateien, keine offenen Abhängigkeiten
- Nach jeder Task bzw. logischen Gruppe committen (`feat(jira): …`)
- An jedem Checkpoint anhalten und die Story unabhängig validieren
- T012/T014: Zuerst verifizieren, welche Rovo-MCP-Tools tatsächlich verfügbar sind (`tools/list`); die Sprint-Aggregation per JQL ist die Rückfallebene, falls keine Agile-Tools existieren
- Die Übernahme ist ein Schnappschuss (keine Synchronisation) — Abgleich später manuell über die Ticket-Referenz
