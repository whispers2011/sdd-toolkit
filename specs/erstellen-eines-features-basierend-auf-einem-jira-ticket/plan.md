# Implementation Plan: Features aus Jira-Tickets erstellen

**Branch**: `feature/erstellen-eines-features-basierend-auf-einem-jira-ticket` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/erstellen-eines-features-basierend-auf-einem-jira-ticket/spec.md`

## Summary

Nutzer verbinden ihre Jira-Cloud-Instanz auf Nutzerebene über den offiziellen Atlassian Rovo MCP (OAuth-Browser-Flow, keine eigene Token-Speicherung), durchsuchen Projekte, Sprints und Tickets und übernehmen ein oder mehrere Tickets als neue SDD-Toolkit-Features. Die Übernahme ist ein Schnappschuss mit vollständigem Ticketkontext (alle ausgefüllten Felder, Kommentare, Anhänge) und mündet in den bestehenden Feature-Workflow (`orchestrator.createFeature` → Specify-Phase). Technischer Ansatz: neuer MCP-Client-Service im Server (`@modelcontextprotocol/sdk`), darauf aufbauend Browse- und Import-Services, neue `/api/jira/*`-Routen, Jira-Bereich in den Benutzereinstellungen und ein Import-Dialog im Web-Client.

## Technical Context

**Language/Version**: TypeScript (strict) auf Node ≥ 22, pnpm-Monorepo (`packages/server`, `packages/web`, `packages/shared`)

**Primary Dependencies**: Fastify 5 (+ @fastify/websocket), better-sqlite3 12 (WAL), Vite/React (Web), **neu**: `@modelcontextprotocol/sdk` (MCP-Client + OAuth-Provider für den Rovo MCP)

**Storage**: SQLite `~/.sdd-toolkit/sdd-toolkit.sqlite` (Migrations-Array in `packages/server/src/db/database.ts`, aktuell `user_version` 10 → neue Migration = Index 10). OAuth-Registrierung/Tokens des MCP: `~/.sdd-toolkit/atlassian-mcp.json` (Nutzerebene, verwaltet vom SDK-`OAuthClientProvider` — das Toolkit hält keine Jira-Passwörter oder eigenen API-Token, FR-002)

**Testing**: Vitest 3 (`packages/server`, `packages/shared`, kolokierte `*.test.ts`); Web ohne Test-Harness (bestehende MVP-Konvention)

**Target Platform**: Lokale Web-App (macOS-Dev), Server-Port 4820, Vite-Dev 4830

**Project Type**: Web-Service (Fastify) + SPA (React) im bestehenden Monorepo — keine neuen Pakete

**Performance Goals**: SC-001 Einrichtung < 3 min; SC-002 Einzelticket-Import < 1 min; SC-004 ≥ 10 Tickets pro Vorgang mit Teilfehler-Toleranz

**Constraints**: Keine eigene Token-Speicherung (FR-002); Autorisierung überlebt Neustarts (FR-003); Übernahme ist Schnappschuss ohne Synchronisation; Fehler einzelner Tickets brechen die Mehrfachübernahme nicht ab (FR-015); Jira-Ausfall darf das restliche Toolkit nicht beeinträchtigen

**Scale/Scope**: Einzelnutzer, lokal; 4 User Stories, ~10 neue HTTP-Routen, 3 neue Server-Services, 2 neue Web-Komponenten, 1 DB-Migration

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein unausgefülltes Template — es existieren keine projektspezifischen Gates. Ersatzweise geprüfte allgemeine Prinzipien:

| Prüfung | Ergebnis |
|---|---|
| Keine neuen Pakete/Schichten — bestehende Monorepo-Struktur wird erweitert | PASS |
| Bestehende Konventionen (Routen in `server.ts`, Services flach, Migrations-Array, `SettingsRepo.getJson/setJson`) werden wiederverwendet | PASS |
| Pure Logik (Sprint-Merge, ADF→Markdown) landet testbar in `packages/shared` | PASS |
| Nur eine neue externe Abhängigkeit (`@modelcontextprotocol/sdk`), durch Clarification fixiert | PASS |

**Re-Check nach Phase-1-Design**: unverändert PASS — das Design fügt keine zusätzlichen Projekte, Abstraktionsschichten oder Abhängigkeiten hinzu.

## Project Structure

### Documentation (this feature)

```text
specs/erstellen-eines-features-basierend-auf-einem-jira-ticket/
├── spec.md              # Feature-Spezifikation (vorhanden)
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase-0-Output (/speckit-plan)
├── data-model.md        # Phase-1-Output (/speckit-plan)
├── quickstart.md        # Phase-1-Output (/speckit-plan)
├── contracts/
│   └── jira-http-api.md # HTTP-Schnittstellenvertrag (Phase 1)
├── checklists/          # /speckit-checklist-Output (vorhanden)
└── tasks.md             # /speckit-tasks-Output (vorhanden)
```

### Source Code (repository root)

```text
packages/shared/src/
├── types.ts                     # +jiraRef am Feature, +Jira-DTOs (JiraConnectionStatus, JiraSite, …)
├── jiraSprints.ts               # NEU: pure Sprint-Merge-Logik (Dedupe über Boards)
├── jiraContent.ts               # NEU: ADF/Wiki-Markup → Markdown, Ticket-Dossier
└── index.ts                     # Exporte ergänzen

packages/server/src/
├── services/
│   ├── atlassianMcpClient.ts    # NEU: MCP-Client + OAuth-Provider (Persistenz ~/.sdd-toolkit/atlassian-mcp.json)
│   ├── jiraBrowseService.ts     # NEU: Sites/Projekte/Sprints/Tickets über MCP-Tools
│   ├── jiraImportService.ts     # NEU: Ticket(s) → Feature(s), Dossier + Anhänge in den Worktree
│   └── orchestrator.ts          # unverändert genutzt: createFeature(projectId, name, description)
├── api/server.ts                # +/api/jira/*-Routen, +POST /api/projects/:id/jira-import (Interface ApiDeps)
├── db/database.ts               # +Migration: features.jira_key/jira_url/jira_imported_at + Index
├── db/repos.ts                  # FeatureRepo: jiraRef-Mapping, setJiraRef, listJiraKeys
└── index.ts                     # Verdrahtung der neuen Services in buildServer(deps)

packages/web/src/
├── api.ts                       # +Jira-Fetch-Helper
├── components/
│   ├── JiraSettings.tsx         # NEU: Benutzereinstellungen — verbinden/Status/trennen/Re-Auth
│   ├── JiraImportDialog.tsx     # NEU: Site→Projekt→Sprint-Kaskade, Ticketliste, Mehrfach-Import
│   ├── Sidebar.tsx              # Einstiegspunkte (Benutzereinstellungen, „Aus Jira importieren")
│   ├── KanbanBoard.tsx          # Jira-Key als Link auf der Feature-Karte
│   └── FeatureConsole.tsx       # Jira-Referenz im Konsolen-Header
└── store.tsx                    # unverändert (View-Union, WS-Events)
```

**Structure Decision**: Erweiterung des bestehenden Monorepos ohne neue Pakete. Server-seitig drei flache Services nach vorhandenem Muster (Instanziierung in `index.ts`, Übergabe via `ApiDeps` an `buildServer`), pure/portable Logik in `packages/shared`, UI als zwei neue Dialog-Komponenten nach dem Muster von `ProjectSettings.tsx`.

## Complexity Tracking

> Keine Constitution-Verstöße — Tabelle entfällt.
