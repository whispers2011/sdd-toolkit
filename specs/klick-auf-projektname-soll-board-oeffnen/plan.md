# Implementation Plan: Projekt-Klick öffnet Board-Ansicht

**Branch**: `feature/klick-auf-projektname-soll-board-oeffnen` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/klick-auf-projektname-soll-board-oeffnen/spec.md`

## Summary

Ein Klick auf einen Projektnamen in der linken Sidebar soll unmittelbar die Board-Ansicht (Kanban) öffnen, beschränkt auf dieses Projekt. Heute setzt der Klick nur den Projekt-Filter (`select_project`) und lässt die aktive Ansicht stehen. Der technische Ansatz spiegelt das bereits vorhandene Muster des Feature-Klicks (`Sidebar.tsx`): Die Projektzeile dispatcht zusätzlich zu `select_project` ein `set_view { kind: 'board' }`. Kein Reducer-Umbau, keine neuen Datenstrukturen — eine lokalisierte Änderung im Sidebar-Komponenten-Handler.

## Technical Context

**Language/Version**: TypeScript 5.8, React 19 (function components + `useReducer`-Store)

**Primary Dependencies**: React 19, Vite 6, Tailwind 4, `@sdd/shared` (Domain-Typen). Store-State liegt in `packages/web/src/store.tsx` (Context + Reducer).

**Storage**: N/A — reiner Client-UI-State (`UiState.view`, `UiState.selectedProjectId`). Kein Persistenz-Touch (localStorage-Präferenzen bleiben unberührt).

**Testing**: Kein Web-Unit-Test-Harness vorhanden (`@sdd/web` `test`-Script ist ein No-op-Stub; Vitest/RTL nicht eingerichtet). Verifikation über `pnpm --filter @sdd/web typecheck` + manuelle/E2E-Prüfung in der laufenden App (optional via chrome-devtools MCP).

**Target Platform**: Lokale Web-App im Browser (Vite-Dev auf `http://localhost:4830`, API/WS auf 4820).

**Project Type**: Web (pnpm-Monorepo: `packages/shared`, `packages/server`, `packages/web`). Betroffen ist ausschließlich `packages/web`.

**Performance Goals**: Ansichtswechsel ohne wahrnehmbare Verzögerung (<1 s, SC-003) — trivial erfüllt, da rein clientseitiger State-Update ohne Netzwerk.

**Constraints**: Minimaler Eingriff; bestehendes Dispatch-Muster wiederverwenden; „Alle Projekte" und QuickSwitcher-Verhalten nicht verändern (FR-008).

**Scale/Scope**: Einzelnutzer-Orchestrator; Änderung betrifft eine Komponente (`Sidebar.tsx`), ~2 Zeilen im Klick-Handler.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Die Datei `.specify/memory/constitution.md` enthält ausschließlich unausgefüllte Platzhalter (nicht ratifiziert) → keine erzwingbaren Gates. Angewandte allgemeine Prinzipien: minimale Komplexität, Wiederverwendung bestehender Muster (Feature-Klick-Dispatch), keine Backwards-Compat-Shims. **Ergebnis: PASS** (keine Verstöße, Complexity Tracking bleibt leer).

## Project Structure

### Documentation (this feature)

```text
specs/klick-auf-projektname-soll-board-oeffnen/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0 (/speckit-plan)
├── data-model.md        # Phase 1 (/speckit-plan)
├── quickstart.md        # Phase 1 (/speckit-plan)
├── contracts/           # Phase 1 (/speckit-plan)
│   └── ui-interaction.md # UI-Interaktions-Contract (Klick → Board)
├── checklists/
│   └── requirements.md  # aus /speckit-specify + /speckit-clarify
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan)
```

### Source Code (repository root)

```text
packages/web/src/
├── components/
│   └── Sidebar.tsx        # ← ÄNDERUNG: Projektzeilen-onClick dispatcht zusätzlich set_view {board}
├── store.tsx              # unverändert: select_project / set_view / View-Typen bleiben wie sie sind
└── components/
    └── KanbanBoard.tsx    # unverändert: filtert bereits über state.selectedProjectId
```

**Structure Decision**: Bestehende Web-Frontend-Struktur unter `packages/web`. Einziger Eingriffspunkt ist der Klick-Handler der Projektzeile in `packages/web/src/components/Sidebar.tsx` (aktuell Zeile 47). Store-Reducer (`store.tsx`) und Board (`KanbanBoard.tsx`) bleiben unverändert.

## Complexity Tracking

> Keine Constitution-Verstöße — Tabelle bewusst leer.
