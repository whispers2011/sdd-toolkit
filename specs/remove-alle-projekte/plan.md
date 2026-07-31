# Implementation Plan: Nur ein Projektkontext — „Alle Projekte" entfernen

**Branch**: `feature/remove-alle-projekte` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/remove-alle-projekte/spec.md`

## Summary

Die projektübergreifende Sicht „Alle Projekte" wird entfernt. Der aktive Projektkontext (`selectedProjectId` im Web-Store) ist künftig immer genau ein Projekt, sobald mindestens ein Projekt existiert; nur im Leerzustand (keine Projekte) gibt es keinen Kontext. Umgesetzt wird das rein im Frontend (`packages/web`) durch: (1) Entfernen des „Alle Projekte"-Buttons, (2) Umdeutung der `null`-Semantik von „alle" zu „kein Projekt vorhanden/unaufgelöst", (3) automatische Kontextauflösung beim `bootstrap` (zuletzt gewähltes Projekt aus `localStorage`, sonst erstes) inkl. Persistenz, und (4) Bereinigung aller `selectedProjectId === null`-Zweige in den Ansichten. Server und Shared bleiben unverändert.

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, Node ≥ 22

**Primary Dependencies**: React 19 + `useReducer`-Store (kein Redux/externe State-Lib), Vite 6, Tailwind 4, WebSocket-Live-Updates

**Storage**: Browser `localStorage` für UI-Präferenzen (bestehend: `sdd-show-completed`, `sdd-sound`, `sdd-grid-panes:*`); neu: gemerkte Projektauswahl. Domain-Daten liegen serverseitig (SQLite) und werden **nicht** berührt.

**Testing**: Keine Web-Unit-Tests im MVP (`packages/web` test = no-op). Verifikation via `pnpm --filter @sdd/web typecheck` + manuelles Quickstart-Skript.

**Target Platform**: Desktop-Web-App (lokaler Server + Browser-Frontend)

**Project Type**: Web application (pnpm-Monorepo: `packages/server`, `packages/web`, `packages/shared`)

**Performance Goals**: Reine UI-Interaktion; keine spürbaren Ladezeiten. Projektwechsel/Filterung < 16 ms (ein Reducer-Dispatch + Re-Render).

**Constraints**: Invariante FR-001 — sobald ≥ 1 Projekt existiert, ist `selectedProjectId` nie `null`. Kein Migrations- oder Server-Aufwand.

**Scale/Scope**: 7 Frontend-Dateien betroffen; typische Nutzung wenige Projekte / Dutzende Features.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Die Projekt-Constitution (`.specify/memory/constitution.md`) enthält ausschließlich Platzhalter — es sind **keine** projektspezifischen Prinzipien oder Gates ratifiziert. Es gibt daher keine verletzbaren Regeln.

Allgemeine Sorgfaltsgrundsätze werden dennoch eingehalten:

- **Minimaler Umfang / YAGNI**: rein additive Umdeutung eines bestehenden Feldes, keine neuen Abstraktionen. ✅ PASS
- **Keine Backwards-Compat-Altlasten**: der „Alle Projekte"-Pfad wird ersatzlos entfernt, nicht als Shim behalten. ✅ PASS
- **Keine Server-/Datenänderung**: Blast-Radius auf `packages/web` begrenzt. ✅ PASS

**Ergebnis**: PASS (Initial). Re-Check nach Phase 1: unverändert PASS — das Design führt keine neue Komplexität ein.

## Project Structure

### Documentation (this feature)

```text
specs/remove-alle-projekte/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0 (/speckit-plan)
├── data-model.md        # Phase 1 (/speckit-plan)
├── quickstart.md        # Phase 1 (/speckit-plan)
├── contracts/
│   └── ui-state-contract.md   # Phase 1 (/speckit-plan)
├── checklists/
│   └── requirements.md  # aus /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT hier erzeugt)
```

### Source Code (repository root)

```text
packages/web/src/
├── store.tsx                     # Kern: null-Semantik, Bootstrap-Auflösung, Persistenz, select_project
├── App.tsx                       # SpecKitBanner: null-Zweig entfernen
└── components/
    ├── Sidebar.tsx               # „Alle Projekte"-Button entfernen
    ├── GridView.tsx              # scope-null-Zweige + storageKey-Fallback bereinigen
    ├── KanbanBoard.tsx           # features-Filter + enabledUnion: null-Zweige entfernen
    ├── AttentionInbox.tsx        # Filter: null-Zweig entfernen
    ├── ExecutionsView.tsx        # projectFilter-null-Zweig entfernen
    └── QuickSwitcher.tsx         # unverändert nutzbar (setzt projectId je Eintrag); nur Typprüfung

packages/server/**                # UNVERÄNDERT
packages/shared/**                # UNVERÄNDERT
```

**Structure Decision**: Bestehende Web-Application-Struktur des Monorepos. Die gesamte Änderung ist Frontend-lokal und zentriert sich in `packages/web/src/store.tsx`; die Komponenten folgen nur der geänderten Invariante.

## Complexity Tracking

> Keine Constitution-Verletzungen — Abschnitt entfällt.
