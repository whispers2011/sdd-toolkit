# Phase 1 Data Model: Nur ein Projektkontext

**Feature**: Nur ein Projektkontext — „Alle Projekte" entfernen
**Date**: 2026-07-22

Dieses Feature führt **keine** neuen persistierten Domain-Entitäten ein. Es verändert die Semantik eines bestehenden UI-State-Feldes und einer UI-Präferenz. Server-Datenmodell (SQLite) und `@sdd/shared`-Typen bleiben unverändert.

## Betroffener UI-State (`packages/web/src/store.tsx`)

### `UiState.selectedProjectId: string | null`

| Aspekt | Vorher | Nachher |
|--------|--------|---------|
| Bedeutung von `null` | „Alle Projekte" (projektübergreifende Anzeige) | „kein Projekt vorhanden / noch nicht aufgelöst" |
| Zulässig wenn ≥ 1 Projekt existiert | ja (`null` = alle) | **nein** — muss eine gültige Projekt-ID sein (FR-001) |
| Zulässig wenn 0 Projekte existieren | ja | ja (`null` = Leerzustand, FR-008) |
| Nutzer kann `null` aktiv wählen | ja (Button „Alle Projekte") | **nein** (Button entfernt, FR-002) |

**Invariante**: `state.app !== null && state.app.projects.length > 0 ⟹ selectedProjectId !== null && projects.some(p => p.id === selectedProjectId)`.

### `Action` (Reducer-Aktionen)

| Aktion | Vorher | Nachher |
|--------|--------|---------|
| `select_project` | `{ projectId: string \| null }` | `{ projectId: string }` (kein `null` mehr, D4) |
| `bootstrap` | setzt nur `app` | setzt `app` **und** löst `selectedProjectId` gemäß Auflösungsregel auf (D2) |

**Auflösungsregel bei `bootstrap`** (Reihenfolge):
1. Aktuelle `selectedProjectId` existiert noch in `app.projects` → beibehalten.
2. Sonst: ID aus `localStorage['sdd-selected-project']`, falls in `app.projects` vorhanden → wählen.
3. Sonst: `app.projects[0].id`, falls Liste nicht leer → wählen.
4. Sonst (`projects` leer): `null`.

## Betroffene UI-Präferenz (`localStorage`)

| Schlüssel | Status | Zweck |
|-----------|--------|-------|
| `sdd-selected-project` | **neu** | Gemerkte zuletzt gewählte Projekt-ID (FR-005). Beschrieben bei jedem `select_project`; gelesen als Fallback im `bootstrap`. |
| `sdd-grid-panes:<id>` | geändert | Fallback-Suffix `all` → `none` (D5); alte `:all`-Einträge verwaisen folgenlos. |
| `sdd-show-completed`, `sdd-sound` | unverändert | — |

## Abgeleitete Sichtbarkeit

`visibleFeatures(state)` und alle komponentenlokalen Filter (`KanbanBoard`, `GridView`, `AttentionInbox`, `ExecutionsView`) entfernen den `selectedProjectId === null`-Zweig. Ergebnis: Sichtbarkeit reduziert sich auf „gehört zum aktiven Projekt" (kombiniert weiterhin mit dem bestehenden „Abgeschlossen ausblenden"-Filter).

## Referenzierte Domain-Entitäten (unverändert, Kontext)

- **Project** (`@sdd/shared`): `id`, `name`, `color`, `enabledPhases`, `integrationMode`, … — nur gelesen.
- **Feature** (`@sdd/shared`): `id`, `projectId`, `name`, `phases`, `integration`, `tasksDone/Total`, `archivedAt` — nur gelesen; `projectId` bestimmt Zugehörigkeit.
- **AttentionItem**, **ExecutionInfo**: besitzen `projectId`; werden nach aktivem Kontext gefiltert.
