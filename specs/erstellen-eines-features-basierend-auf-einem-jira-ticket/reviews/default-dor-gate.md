# DoR-Gate-Bericht: Features aus Jira-Tickets erstellen

**Datum**: 2026-07-23 · **Feature**: `erstellen-eines-features-basierend-auf-einem-jira-ticket` · **Branch**: `feature/erstellen-eines-features-basierend-auf-einem-jira-ticket`

**Geprüfte Artefakte**: spec.md, plan.md, tasks.md, research.md, data-model.md, quickstart.md, contracts/jira-http-api.md, checklists/requirements.md

## Prüfung 1: Offene Fragen / [NEEDS CLARIFICATION]-Marker

**Ergebnis: bestanden.** Eine Volltextsuche über alle Artefakte findet keine `[NEEDS CLARIFICATION]`-Marker, TODOs oder offene Fragen. Die Spec enthält eine dokumentierte Clarification-Session (2026-07-23) mit vier beantworteten Fragen (Token-Schutz via Rovo MCP, Übernahmeumfang aller ausgefüllten Felder, keine Anhang-Größengrenze, Sprint-Merge über Boards). research.md bestätigt explizit: „es verbleibt kein NEEDS CLARIFICATION"; die Requirements-Checkliste ist vollständig abgehakt.

## Prüfung 2: Unentschiedene Annahmen / Widersprüche zwischen Artefakten

**Ergebnis: bestanden.** Die Artefakte sind untereinander konsistent geprüft worden:

- Migrationsstand: plan.md („user_version 10 → neue Migration = Index 10") deckt sich mit data-model.md („Migration Index 10, user_version 10 → 11") und T003.
- Persistenzentscheidung (OAuth-Datei `~/.sdd-toolkit/atlassian-mcp.json` statt DB, letzte Auswahl in `settings`) ist in research.md (R3/R7), data-model.md, contract und tasks.md identisch.
- Fehler-Mapping (401 `reauth_required`, 503 nicht erreichbar, Teilfehler ⇒ 200 mit `JiraImportResult[]`) ist in research.md R9, contract und T006/T013/T017 deckungsgleich.
- Die in der Spec bewusst offene Formulierung beim Kontextwechsel-Edge-Case („zurückgesetzt **oder** erhalten") ist downstream entschieden: T019 und quickstart.md Stufe 6 legen den Auswahl-Reset fest.
- Alle Spec-Annahmen (Jira Cloud, Space = Jira-Site, Verbindung je Nutzer, Schnappschuss ohne Sync, ein Feature pro Ticket) sind entschieden und in Plan/Tasks umgesetzt, nicht in der Schwebe.

**Nicht blockierende Hinweise** (keine offenen Entscheidungen, aber bei der Implementierung zu beachten):

- **Sprint-Ermittlung per JQL (R4, T012)**: Der Rovo MCP bietet keine Agile-Board-Tools; die Sprintliste wird über `sprint in openSprints()/futureSprints()` aggregiert. Bekannte Grenze: Ein zukünftiger Sprint ganz ohne zugeordnete Tickets ist über JQL nicht auffindbar und würde in der Liste fehlen (betrifft FR-007 in einem Randfall). Das Risiko ist in tasks.md und research.md dokumentiert, ein Verifikationsschritt (`tools/list` vor der Implementierung) ist eingeplant — die Entscheidung ist getroffen, die Rückfallebene definiert.
- **Verweis-Tippfehler**: Der Risiko-Hinweis im Technischen Kontext von tasks.md nennt „T014" (Web-Fetch-Helper) für die Tool-Verifikation; gemeint ist offensichtlich T012 (jiraBrowseService). Kosmetisch, keine inhaltliche Unklarheit.
- **SC-003 hängt an US4**: Das Erfolgskriterium „100 % vollständiger Ticketkontext" ist erst nach Phase 6 (US4) erfüllbar; bei einem Abbruch nach US3 (Kernnutzen) wäre SC-003 offen. Das entspricht dem dokumentierten inkrementellen Vorgehen und ist kein Widerspruch.

## Prüfung 3: Prüfbare Akzeptanzkriterien je User Story

**Ergebnis: bestanden.** Alle vier User Stories (US1 Verbindung, US2 Browse, US3 Übernahme, US4 Vollkontext) haben durchgängig Given/When/Then-Akzeptanzszenarien (4/6/5/3 Szenarien) plus je einen konkreten „Independent Test". Die Szenarien sind beobachtbar formuliert (Verbindungsstatus mit Konto/Instanz, Ticketliste mit Key/Titel/Typ/Status, ein Feature pro Ticket, Kommentare mit Autor/Zeitpunkt) und in quickstart.md in einen konkreten manuellen Prüfpfad entlang SC-001–SC-006 übersetzt.

## Prüfung 4: tasks.md vorhanden und konkret

**Ergebnis: bestanden.** tasks.md existiert mit 26 Tasks (T001–T026) in 7 Phasen. Jede Task nennt exakte Dateipfade (z. B. `packages/server/src/services/atlassianMcpClient.ts`, `packages/web/src/components/JiraImportDialog.tsx`), konkrete Funktionssignaturen und die abgedeckten FR-Nummern. Abhängigkeiten, Parallelisierungsmöglichkeiten, Checkpoints je Story und eine MVP-Strategie sind ausgewiesen. Tests sind gemäß Repo-Konvention (Vitest, kolokiert) Bestandteil der Implementierungs-Tasks. Keine vagen Sammelaufgaben.

## Fazit

Das Feature ist ungewöhnlich vollständig vorbereitet: Clarifications dokumentiert, alle Technologie-Entscheidungen in research.md mit Alternativen begründet, Datenmodell, HTTP-Contract und Validierungspfad liegen vor, die Tasks sind unmittelbar ausführbar. Das einzige nennenswerte Restrisiko (Sprint-Listing ohne Agile-Tools) ist erkannt, mit Rückfallebene entschieden und mit einem Verifikationsschritt vor der Implementierung abgesichert.

ZUSAMMENFASSUNG: Alle vier DoR-Prüfungen bestanden — keine offenen Fragen oder Widersprüche, prüfbare Akzeptanzkriterien je Story und 26 konkrete, dateigenaue Tasks; einziges dokumentiertes Restrisiko ist die JQL-basierte Sprint-Ermittlung mit definierter Rückfallebene.

VERDICT: PASS
