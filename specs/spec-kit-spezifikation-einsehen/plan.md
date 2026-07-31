# Implementation Plan: Spezifikation der SDD-Schritte per Lane-Info-Icon einsehen und bearbeiten

**Branch**: `feature/spec-kit-spezifikation-einsehen` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/spec-kit-spezifikation-einsehen/spec.md`

## Summary

Jede Phasen-Lane des Kanban-Boards erhält im Lane-Header ein Info-Icon. Ein Klick öffnet einen Dialog, der die spec-kit-Definition dieses Schritts (die Datei, die beschreibt, *was* der Schritt tut) formatiert (gerendertes Markdown) anzeigt. Der Nutzer kann in einen Bearbeitungsmodus wechseln, den Text ändern und in-App speichern; zusätzlich lässt sich die Datei im konfigurierten externen Editor öffnen. Speichern ist konfliktgeschützt (externe Änderung seit dem Öffnen → warnen und Nutzer wählen lassen) und gesperrt (nur-lesend), solange ein Agent den Schritt ausführt.

Technischer Ansatz: Ein neuer server-seitiger Resolver mappt Phase → Definitionsdatei (analog zum bestehenden `artifacts.ts`/`speckitCommandPrefix`), pro Projekt aufgelöst gegen `project.path`. Drei projekt-skopierte REST-Endpunkte (lesen, speichern mit Konflikt-/Lock-Prüfung, im Editor öffnen) ergänzen den Fastify-Server. Im Web kommt ein neuer Dialog `PhaseDefinitionDialog` hinzu, angebunden über neue `api`-Methoden; das Icon wird im Lane-Header von `KanbanBoard` platziert. Für das Rendern von Markdown wird eine fokussierte Abhängigkeit (`react-markdown` + `remark-gfm`) ergänzt.

## Technical Context

**Language/Version**: TypeScript 5.8, Node.js ≥ 22, ES-Module

**Primary Dependencies**: Server: Fastify (+ `@fastify/cors`, `@fastify/websocket`, `@fastify/multipart`), better-sqlite3 (Repos), node:fs/child_process. Web: React 19, Vite 6, Tailwind 4. **Neu**: `react-markdown` + `remark-gfm` (nur für die Definitions-Leseansicht).

**Storage**: Definitionsinhalte liegen als Dateien im Projekt-Checkout (`<project.path>/.claude/skills/speckit-<phase>/SKILL.md`, ältere Installationen: `.claude/commands/`). Keine neue DB-Tabelle; Metadaten (Konflikt-`mtime`, Lock) werden zur Laufzeit ermittelt.

**Testing**: vitest (`packages/server`, `packages/shared`). Web hat kein Test-Setup (MVP) → Validierung über `quickstart.md`. Neue Unit-Tests für den Definitions-Resolver und die Konflikt-/Lock-Logik (co-lokalisiert in `packages/server`).

**Target Platform**: Lokale Desktop-/Web-App (Fastify-Server + Vite-Frontend), Einzelnutzer, macOS-Fokus.

**Project Type**: Web application (Monorepo: `packages/server`, `packages/web`, `packages/shared`).

**Performance Goals**: Definition nach Öffnen < 1 s sichtbar (SC-002); Dialog reaktionsschnell (< 100 ms Interaktions-Latenz) auch bei großen Definitionsdateien (~20–50 KB).

**Constraints**: Kein stiller Datenverlust (Konfliktschutz per `mtime`); Bearbeiten gesperrt bei laufendem Agenten; nur Definitionsdateien zugänglich (keine dateisystemweite Navigation, FR-012-Grenze); bestehende Board-/Dialog-Patterns wiederverwenden.

**Scale/Scope**: 7 Phasen-Lanes × N verwaltete Projekte; pro Projekt eine Definitionsdatei je Phase. 1 neuer Web-Dialog, 1 Server-Resolver, 3 Endpunkte, 3 api-Methoden.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Die Projektkonstitution (`.specify/memory/constitution.md`) ist eine unausgefüllte Vorlage — es existieren keine ratifizierten Prinzipien, die durchgesetzt werden müssten. Es gelten daher die allgemeinen Leitplanken des Repos:

- **Minimale Komplexität / YAGNI**: Erfüllt — Wiederverwendung bestehender Muster (Dialog, `openInEditor`, `artifacts.ts`-Resolver); keine neue DB, kein neues Framework. Einzige neue Abhängigkeit (`react-markdown`) ist eng auf die Leseansicht begrenzt (Alternative in `research.md` bewertet).
- **Testbarkeit**: Erfüllt — reine Logik (Pfad-Resolver, Konflikt-/Lock-Entscheidung) wird per vitest getestet; UI über quickstart validiert (Web-Konvention).
- **Konsistenz mit bestehendem Code**: Erfüllt — deutsche UI-Texte, `zinc`-Tailwind-Stil, Fastify-Routen-Stil, `api.ts`-Client-Muster.

**Ergebnis**: PASS (keine Verstöße; Complexity Tracking bleibt leer).

## Project Structure

### Documentation (this feature)

```text
specs/spec-kit-spezifikation-einsehen/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0 (/speckit-plan)
├── data-model.md        # Phase 1 (/speckit-plan)
├── quickstart.md        # Phase 1 (/speckit-plan)
├── contracts/           # Phase 1 (/speckit-plan)
│   └── phase-definition-api.md
├── checklists/
│   └── requirements.md  # aus /speckit-specify + /speckit-clarify
└── tasks.md             # Phase 2 (/speckit-tasks – NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
└── types.ts                       # + PhaseDefinition-DTO-Typen (geteilt Web↔Server)

packages/server/src/
├── services/
│   ├── artifacts.ts               # + phaseDefinitionPath(repoRoot, phase)
│   ├── artifacts.test.ts          # + Unit-Tests Resolver
│   ├── phaseDefinition.ts         # NEU: read/write mit Konflikt- & Lock-Logik
│   └── phaseDefinition.test.ts    # NEU: Unit-Tests Konflikt/Lock
└── api/
    └── server.ts                  # + 3 Routen (GET/PUT/open-in-editor, projekt-skopiert)

packages/web/src/
├── api.ts                         # + phaseDefinition / savePhaseDefinition / openPhaseDefinitionInEditor
└── components/
    ├── KanbanBoard.tsx            # + Info-Icon im Lane-Header (nur Phasen-Lanes)
    └── PhaseDefinitionDialog.tsx  # NEU: Lese-/Bearbeitungs-Dialog
```

**Structure Decision**: Bestehende Monorepo-Struktur (`server`/`web`/`shared`) wird beibehalten. Server-Logik in `packages/server/src/services` (neben dem verwandten `artifacts.ts`), REST-Routen in `api/server.ts`, geteilte DTOs in `packages/shared/src/types.ts`, UI in `packages/web/src/components`. Keine neuen Pakete oder Verzeichnisse.

## Complexity Tracking

> Keine Verstöße gegen die Constitution-Gates — Tabelle bleibt leer.
