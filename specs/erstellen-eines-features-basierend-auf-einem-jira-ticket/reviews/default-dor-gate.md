# DoR-Gate-Bericht: Features aus Jira-Tickets erstellen

**Datum**: 2026-07-23 · **Feature**: `erstellen-eines-features-basierend-auf-einem-jira-ticket` · **Branch**: `feature/erstellen-eines-features-basierend-auf-einem-jira-ticket`

**Geprüfte Artefakte**: spec.md, plan.md, tasks.md sowie die referenzierten Begleitartefakte research.md, data-model.md, quickstart.md, contracts/jira-http-api.md, checklists/requirements.md (alle vorhanden).

## Prüfung 1: Offene Fragen / [NEEDS CLARIFICATION]-Marker

**Ergebnis: bestanden.** Eine Volltextsuche über alle Artefakte (spec/plan/tasks + Begleitdokumente) findet keine `[NEEDS CLARIFICATION]`-Marker, TODOs oder unbeantworteten Fragen. Die Spec dokumentiert eine Clarification-Session (2026-07-23) mit vier beantworteten Fragen: Token-Schutz über den offiziellen Atlassian Rovo MCP (keine eigene Token-Speicherung), Übernahme sämtlicher ausgefüllter Felder, keine Größengrenze für Anhänge, Sprint-Zusammenführung über mehrere Boards ohne Board-Auswahlschritt. research.md hält explizit fest „es verbleibt kein NEEDS CLARIFICATION"; die Requirements-Checkliste (checklists/requirements.md) ist vollständig abgehakt.

## Prüfung 2: Unentschiedene Annahmen / Widersprüche zwischen Artefakten

**Ergebnis: bestanden.** Die Artefakte wurden gegeneinander geprüft und sind konsistent:

- **Anbindungsentscheidung**: Rovo MCP via `@modelcontextprotocol/sdk` mit OAuth-Browser-Flow — identisch in spec.md (Clarification, FR-002), plan.md (Technical Context), research.md (R1/R2) und tasks.md (T004). Die scheinbare Spannung „keine eigene Token-Speicherung" (FR-002) vs. Persistenzdatei `~/.sdd-toolkit/atlassian-mcp.json` ist in FR-002/R3/data-model.md 1.2 sauber aufgelöst: Das Toolkit hält keine Jira-Passwörter oder selbst verwaltete API-Token; die SDK-`OAuthClientProvider`-Persistenz ist Teil der MCP-Verbindung und wird vom Toolkit nicht selbst interpretiert.
- **Migrationsstand**: plan.md („user_version 10 → neue Migration = Index 10") deckt sich mit data-model.md („Migration Index 10, user_version 10 → 11") und T003; T026 dokumentiert die Verifikation gegen eine Kopie der Dev-DB.
- **Fehler-Mapping**: `reauth_required` → 401, nicht erreichbar → 503, Teilfehler beim Mehrfachimport → 200 mit `JiraImportResult[]` je Ticket — deckungsgleich in research.md (R9), contracts/jira-http-api.md und T006/T013/T017 (FR-004, FR-015).
- **Bewusst offene Spec-Formulierung ist entschieden**: Der Edge Case „Wechsel von Projekt/Sprint bei bestehender Auswahl" lässt in der Spec „zurückgesetzt oder erhalten" zu; T019 und quickstart.md Stufe 6 legen den Auswahl-Reset verbindlich fest — kein Schwebezustand.
- **Alle Assumptions sind entschieden**: Jira Cloud, „Space" = Jira-Site, Verbindung je Nutzer (nicht je Projekt), Schnappschuss ohne Synchronisation, genau ein Feature pro Ticket, Kanban-Projekte über Backlog-Sicht — sämtlich in Plan, Datenmodell, Contract und Tasks konsistent umgesetzt.

**Nicht blockierende Hinweise**:

- **Sprint-Ermittlung per JQL (R4)**: Der Rovo MCP bietet keine Agile-Board-Tools; Sprints werden per `sprint in openSprints()/futureSprints()` aggregiert. Bekannte Grenze: Ein zukünftiger Sprint ohne zugeordnete Tickets ist per JQL nicht auffindbar (praktisch folgenlos — er enthielte keine importierbaren Tickets). Das Risiko ist in research.md und tasks.md dokumentiert, die Rückfallebene definiert; laut T026 sind die Rovo-MCP-Tool-Schemata bereits gegen den Live-MCP verifiziert.
- **Verweis-Ungenauigkeit in tasks.md**: Der Risiko-Hinweis im Technischen Kontext nennt T014 (Web-Fetch-Helper) für die Tool-Verifikation; gemeint ist T012 (jiraBrowseService), wie die Notes-Sektion („T012/T014") nahelegt. Kosmetisch, keine inhaltliche Unklarheit.
- **`imported`-Feld ohne `projectId`**: `JiraIssueSummary.imported` ist im Datenmodell nicht optional, der `projectId`-Query-Parameter in `GET /api/jira/issues` laut Contract aber schon. Der Contract beschreibt das Verhalten hinreichend (ohne `projectId` keine Kennzeichnung); kosmetische Unschärfe ohne Implementierungsrisiko.
- **SC-003 hängt an US4**: Das Erfolgskriterium „100 % vollständiger Ticketkontext" ist erst nach Phase 6 erfüllbar; bei einem Stopp nach US3 bliebe SC-003 offen. Das entspricht dem dokumentierten inkrementellen Vorgehen und ist kein Widerspruch.
- **Zeitlicher Hinweis**: tasks.md ist bereits vollständig abgehakt (T001–T026, Commit `caaddf2`) — dieses Gate läuft faktisch nachlaufend. Für die DoR-Bewertung ist das unerheblich (die Artefakte selbst sind bereit); der in T026 vermerkte offene Rest ist ausschließlich der manuelle Live-Durchstich SC-001–SC-006 (quickstart.md Stufen 2–6), der eine reale Jira-Instanz mit Browser-OAuth erfordert und kein Spezifikationsdefizit ist.

## Prüfung 3: Prüfbare Akzeptanzkriterien je User Story

**Ergebnis: bestanden.** Alle vier User Stories haben durchgängig Given/When/Then-Akzeptanzszenarien plus je einen konkreten „Independent Test": US1 Verbindung (4 Szenarien), US2 Browse (6), US3 Übernahme (5), US4 Vollkontext (3). Die Szenarien sind beobachtbar und falsifizierbar formuliert (Verbindungsstatus mit Konto/Instanz, Neustart ohne Re-Login, Ticketliste mit Key/Titel/Typ/Status, genau ein Feature pro Ticket, Duplikat-Kennzeichnung mit Bestätigungspflicht, Kommentare mit Autor/Zeitpunkt, keine rohen Markup-Reste). quickstart.md übersetzt sie in einen konkreten manuellen Prüfpfad entlang der messbaren Erfolgskriterien SC-001–SC-006.

## Prüfung 4: tasks.md vorhanden und konkret

**Ergebnis: bestanden.** tasks.md existiert mit 26 Tasks (T001–T026) in 7 Phasen. Jede Task nennt exakte Dateipfade (z. B. `packages/server/src/services/atlassianMcpClient.ts`, `packages/web/src/components/JiraImportDialog.tsx`), konkrete Funktionssignaturen/Routen und die abgedeckten FR-Nummern. Abhängigkeiten, [P]-Parallelisierung, Checkpoints je Story und eine MVP-Strategie (US1 zuerst) sind ausgewiesen. Tests sind gemäß Repo-Konvention (Vitest, kolokierte `*.test.ts`) Bestandteil der jeweiligen Implementierungs-Tasks. Keine vagen Sammelaufgaben.

## Fazit

Das Feature ist vollständig vorbereitet: Clarifications dokumentiert, alle Technologie-Entscheidungen in research.md mit Alternativen begründet, Datenmodell, HTTP-Contract und Validierungspfad liegen vor, die Tasks sind dateigenau und unmittelbar ausführbar. Das einzige nennenswerte Restrisiko (Sprint-Listing ohne Agile-Tools) ist erkannt, mit Rückfallebene entschieden und laut T026 bereits gegen den Live-MCP verifiziert.

ZUSAMMENFASSUNG: Alle vier DoR-Prüfungen bestanden — keine offenen Fragen oder Widersprüche, prüfbare Given/When/Then-Akzeptanzkriterien je Story und 26 konkrete, dateigenaue Tasks; einziges dokumentiertes Restrisiko ist die JQL-basierte Sprint-Ermittlung mit definierter Rückfallebene.

VERDICT: PASS
