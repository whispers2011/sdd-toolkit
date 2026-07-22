# Phase 1 Data Model: Projekt-Klick öffnet Board-Ansicht

**Feature**: `feature/klick-auf-projektname-soll-board-oeffnen` | **Date**: 2026-07-22

Dieses Feature führt **keine neuen persistenten Entitäten** ein. Es verändert ausschließlich, welcher clientseitige UI-State-Übergang bei einem Klick ausgelöst wird. Für Vollständigkeit sind die berührten State-Elemente dokumentiert (Definitionen in `packages/web/src/store.tsx`).

## Berührter UI-State

### `UiState.view` (Union `View`)

Welche Hauptansicht rechts angezeigt wird. Relevante Variante:

- `{ kind: 'board' }` — Kanban-Board (`KanbanBoard`), gefiltert nach `selectedProjectId`.

Weitere bestehende Varianten (`inbox`, `executions`, `grid`, `console`, `shell`) bleiben unverändert.

- **Übergang (neu durch dieses Feature)**: Klick auf Projektzeile → `view` wird auf `{ kind: 'board' }` gesetzt (unbedingt), unabhängig vom Ausgangswert.

### `UiState.selectedProjectId` (`string | null`)

Aktuell fokussiertes Projekt (`null` = alle Projekte). Steuert die Sidebar-Hervorhebung und die Filterung in `KanbanBoard` / `visibleFeatures`.

- **Übergang**: Klick auf Projektzeile → `selectedProjectId = project.id` (via bestehende Action `select_project`).

## Beteiligte Domänen-Entitäten (bestehend, unverändert)

| Entität | Rolle in diesem Feature | Quelle |
|---|---|---|
| **Project** (`id`, `name`, `color`, `currentBranch`) | Klickziel in der Sidebar; `id` wird zum neuen `selectedProjectId` | `@sdd/shared` |
| **Feature** (`projectId`, `phases`, `integration`, …) | Als Board-Karten dargestellt; über `projectId === selectedProjectId` gefiltert | `@sdd/shared` |

## Validierungs-/Konsistenzregeln

- **R1**: Nach dem Klick MUSS `view.kind === 'board'` und `selectedProjectId === project.id` gelten (FR-001, FR-002, FR-003).
- **R2**: Der Übergang ist idempotent — erneuter Klick auf dasselbe, bereits ausgewählte Projekt führt zu identischem State (FR: Edge Case „bereits ausgewählt").
- **R3**: `select_project` mit `projectId: null` (》Alle Projekte《) verändert `view` **nicht** erzwungen (FR-008) — dieser Pfad wird durch das Feature nicht angefasst.
- **R4**: Kein Zustand außerhalb von `view` und `selectedProjectId` wird geschrieben; Sessions/Queues/Attention bleiben unberührt (FR-007).

## Zustandsübergänge (Sidebar-Projektzeile)

```text
(beliebige view, beliebiges selectedProjectId)
        │  Klick auf Projektzeile P
        ▼
dispatch select_project { projectId: P.id }   # setzt selectedProjectId = P.id
dispatch set_view       { kind: 'board' }      # setzt view = board (überschreibt)
        ▼
view = { kind: 'board' }, selectedProjectId = P.id
```
