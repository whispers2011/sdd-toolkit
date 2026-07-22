# Phase 0 Research: Projekt-Klick öffnet Board-Ansicht

**Feature**: `feature/klick-auf-projektname-soll-board-oeffnen` | **Date**: 2026-07-22

Es verbleiben **keine** `NEEDS CLARIFICATION`-Punkte — Technical Context ist vollständig aus dem bestehenden Code ableitbar, und die beiden materiellen Entscheidungen wurden in `/speckit-clarify` (Session 2026-07-22) aufgelöst. Dieses Dokument hält die Umsetzungsentscheidung fest.

## Decision 1: Änderung im Komponenten-Handler statt im Reducer

- **Decision**: Der `onClick` der Projektzeile in `Sidebar.tsx` dispatcht zusätzlich zum bestehenden `select_project` ein `set_view { kind: 'board' }`. Der Reducer `select_project` in `store.tsx` bleibt unverändert.
- **Rationale**:
  - `select_project` wird von **mehreren** Stellen ausgelöst: „Alle Projekte" (`Sidebar.tsx:32`, `projectId: null`), Projektzeile (`:47`), Feature-Klick (`:100`) und QuickSwitcher (`QuickSwitcher.tsx:83`). Ein pauschales „immer Board" im Reducer würde FR-008 verletzen (》Alle Projekte《 darf nicht zum Board zwingen) und den QuickSwitcher-Scope-Fall ungewollt umbiegen.
  - Es existiert bereits ein etabliertes Muster für genau diese Doppel-Dispatch-Navigation: der Feature-Klick dispatcht `select_project` **und** `set_view { kind: 'console', featureId }` (`Sidebar.tsx:99-101`). Der Projektzeilen-Klick folgt demselben Muster mit `board`.
  - `set_view` ist unbedingt und überschreibt die vom `select_project`-Reducer optional berechnete View — dadurch wird FR-004 erfüllt (immer Board, auch bei bereits offener Konsole desselben Projekts).
- **Alternatives considered**:
  - *Reducer-Parameter* `select_project { openBoard: true }` bzw. neue Action: invasiver, verteilt die Board-Logik in den Store, ohne Mehrwert gegenüber dem bewährten Doppel-Dispatch.
  - *Board-Fallback im `select_project`-Reducer generalisieren*: bricht FR-008 und QuickSwitcher-Verhalten.

## Decision 2: Scope-Abgrenzung „Alle Projekte" & QuickSwitcher

- **Decision**: Nur der Klick auf eine **Projektzeile** in der Sidebar öffnet das Board. »Alle Projekte« (`Sidebar.tsx:32`) und der ⌘K-QuickSwitcher (`QuickSwitcher.tsx:83`) bleiben unverändert.
- **Rationale**: Deckt sich mit dem wörtlichen Feature-Wunsch und der Clarify-Antwort (FR-008: »Alle Projekte« nur Filter). QuickSwitcher ist ein separater Navigationsmechanismus und nicht Teil der Anforderung „Klick in der Sidebar".
- **Alternatives considered**: QuickSwitcher ebenfalls aufs Board leiten — bewusst verworfen (Scope, keine Anforderung; der Switcher navigiert bereits gezielt zu Features/Ansichten).

## Decision 3: Verifikationsstrategie ohne Web-Test-Harness

- **Decision**: Verifikation über `typecheck` + manuelle/E2E-Prüfung in der laufenden App (optional via chrome-devtools MCP). Kein neues Test-Framework einführen.
- **Rationale**: `@sdd/web` besitzt keinen Unit-Test-Runner (`test`-Script ist ein No-op-Stub; kein Vitest/RTL). Das Einführen eines Harness für eine 2-Zeilen-UI-Änderung wäre Over-Engineering (Global-Preference: minimale Komplexität). Die pure State-Logik (`store.tsx`) ist bereits an anderer Stelle typgesichert; die Änderung selbst ist rein deklaratives Dispatch.
- **Alternatives considered**: Vitest + React Testing Library aufsetzen und den Reducer/Handler testen — unverhältnismäßig für den Umfang; als optionale Folgeaufgabe vermerkbar, aber nicht Teil dieses Features.
