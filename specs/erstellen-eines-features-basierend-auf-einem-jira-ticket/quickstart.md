# Quickstart: Features aus Jira-Tickets erstellen — Validierung

Validiert das Feature Ende-zu-Ende entlang der User Stories (spec.md) und Success Criteria SC-001–SC-006.
Details zu Endpunkten: [contracts/jira-http-api.md](./contracts/jira-http-api.md) · Datenmodell: [data-model.md](./data-model.md)

## Voraussetzungen

- Node ≥ 22, pnpm 10 (`pnpm install` im Repo-Root)
- Jira-Cloud-Konto mit Zugriff auf mindestens ein Projekt mit Sprints (Scrum-Board) und einem Ticket mit Kommentaren + Anhängen
- Kein bestehendes `~/.sdd-toolkit/atlassian-mcp.json` (für den Erstverbindungs-Test: `rm -f ~/.sdd-toolkit/atlassian-mcp.json`)

## Start

```bash
pnpm dev          # Server (Port 4820) + Web (Port 4830)
open http://localhost:4830
```

## Stufe 1 — Automatisierte Checks

```bash
pnpm -r typecheck
pnpm -r test      # inkl. atlassianMcpClient/jiraBrowseService/jiraImportService (Server, gemockter MCP)
                  # und jiraSprints/jiraContent (Shared)
```

**Erwartung**: alles grün; Migration läuft gegen eine Kopie der Dev-DB fehlerfrei (`user_version` → 11).

## Stufe 2 — US1: Verbindung (SC-001, SC-005)

1. Sidebar → Benutzereinstellungen → Jira → „Mit Jira verbinden" (Stoppuhr starten).
2. OAuth-Freigabe im Browser erteilen → Einstellungen zeigen „verbunden" mit Konto + Jira-Instanz. **SC-001: < 3 min.**
3. Server neu starten (`Ctrl-C`, `pnpm dev`) → Status weiterhin „verbunden" ohne Login. **SC-005.**
4. „Verbindung trennen" → unverbundener Ausgangszustand; `~/.sdd-toolkit/atlassian-mcp.json` existiert nicht mehr.
5. Re-Auth-Fall: Tokens in der Datei invalidieren (oder Freigabe bei Atlassian widerrufen) → nächste Jira-Aktion zeigt Hinweis + „Erneut autorisieren" direkt in den Einstellungen.

## Stufe 3 — US2: Browse (FR-006–FR-009)

1. Wieder verbinden. Sidebar → „Aus Jira importieren".
2. Site wählen (bei nur einer: vorausgewählt) → Projektliste erscheint (nur sichtbare Projekte).
3. Projekt mit Sprints wählen → Sprintliste (aktive + zukünftige, keine Board-Auswahl); Sprint wählen → Tickets mit Key, Titel, Typ, Status.
4. Projekt ohne Sprints wählen → automatische Backlog-/Projektsicht mit Tickets.
5. Leeren Sprint wählen → verständlicher Leer-Hinweis, kein Fehler.
6. Dialog schließen und erneut öffnen → letzte Auswahl (Site/Projekt/Sprint) ist vorbelegt.

## Stufe 4 — US3: Übernahme (SC-002, SC-004, SC-006)

1. Ein Ticket auswählen → „Übernehmen" (Stoppuhr): Feature erscheint auf dem Kanban-Board mit Ticket-Titel; Karte zeigt den Jira-Key als klickbaren Link. **SC-002: < 1 min.**
2. Feature-Konsole öffnen → Specify-Phase läuft mit dem Ticketinhalt als Ausgangsbeschreibung; Verhalten identisch zu manuell angelegten Features (FR-016).
3. Dialog erneut öffnen → das übernommene Ticket trägt ein „bereits übernommen"-Badge. **SC-006.**
4. Dasselbe Ticket erneut übernehmen → Bestätigungsabfrage; nach Bestätigung entsteht ein zweites, unabhängiges Feature (Name mit Ticketschlüssel-Suffix).
5. ≥ 10 Tickets auswählen, davon 1 absichtlich invalide (z. B. Key eines gelöschten Tickets) → Ergebnisansicht je Ticket: übrige `created`, das eine `failed` mit Meldung. **SC-004.**

## Stufe 5 — US4: Vollständiger Ticketkontext (SC-003)

1. Das Ticket mit Kommentaren + Anhängen übernehmen.
2. Im Feature-Worktree prüfen:
   - `specs/<slug>/jira/ticket.md` enthält Titel, Beschreibung, **alle ausgefüllten Felder** (Labels, Priorität, verknüpfte Tickets, Custom-Felder), **alle Kommentare mit Autor + Zeitpunkt** — als lesbares Markdown ohne rohe Jira-Markup-Reste (FR-019).
   - `specs/<slug>/jira/attachments/` enthält alle zugänglichen Anhänge; nicht abrufbare sind im Dossier mit Name + Quell-URL vermerkt. **SC-003.**

## Stufe 6 — Edge Cases (spec.md)

- Server ohne Netz (WLAN aus) → Jira-Aktionen zeigen 503-Hinweis mit „Erneut versuchen"; restliches Toolkit voll nutzbar.
- Verbindung trennen, während der Import-Dialog offen ist → Dialog fällt in den unverbundenen Zustand; vorhandene Features unberührt.
- Projekt/Sprint wechseln bei bestehender Ticket-Auswahl → Auswahl wird nachvollziehbar zurückgesetzt (keine Übernahme aus falschem Kontext).
