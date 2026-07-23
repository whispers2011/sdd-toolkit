# Implementation Plan: „Braucht dich"-Meldungen optimieren

**Branch**: `feature/braucht-dich-meldungen-optimieren` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/braucht-dich-meldungen-optimieren/spec.md`

## Summary

Die „Braucht dich"-Inbox soll nur noch Meldungen zeigen, deren zugrunde liegender Zustand aktuell aktiv ist. Statt der heutigen **aktionsgekoppelten** Auflösung (Meldung verschwindet nur über einen bestimmten Weg) wird ein **zustandsgekoppeltes Gültigkeitsmodell** eingeführt: Jede Meldungsart hat ein Prädikat über den autoritativen aktuellen Zustand — persistierter `Feature.integration`-Stage für die Merge-Fluss-Arten, Live-Session-Status für `awaiting_input`/`agent_errored`. Ein zentraler **Reconciler** löst stale Meldungen an drei Punkten auf: beim Boot, bei Zustandsänderungs-Events und beim Lesen (Bootstrap / `GET /api/attention`). Zusätzlich wird der Badge-Scope an die (projektgebundene) Liste angeglichen. Keine neue Persistenz, keine Migration.

## Technical Context

**Language/Version**: TypeScript, Node ≥ 22 (ESM)

**Primary Dependencies**: Fastify-artige HTTP-API + WebSocket-Bus, `better-sqlite3`, `node-pty` (Server); React 18 + Tailwind + Vite (Web); geteilte Typen/State-Machine in `@sdd/shared`

**Storage**: SQLite — bestehende Tabellen `attention`, `sessions`, `features` (keine Schema-Änderung)

**Testing**: `vitest run` in `@sdd/server` und `@sdd/shared`; `@sdd/web` ohne automatisierte Tests (MVP) → UI-Aspekte via manuellem Quickstart

**Target Platform**: Lokale Desktop-/Einzelnutzer-Anwendung (Server-Prozess + Web-UI)

**Project Type**: Web application (Monorepo: `packages/server`, `packages/web`, `packages/shared`)

**Performance Goals**: Auflösung einer Meldung bei geöffneter Inbox ≤ 5 s (SC-002); Reconcile ist O(offene Items) — vernachlässigbar

**Constraints**: Darf keine noch aktive Meldung entfernen (FR-012); restart-sicher (FR-010); minimale Architekturänderung; kein Neubau der Inbox-Oberfläche

**Scale/Scope**: Einzelnutzer, wenige Projekte/Features/Sessions; `attention`-Tabelle klein

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Die Projekt-Constitution (`.specify/memory/constitution.md`) ist eine unausgefüllte Vorlage (nur Platzhalter) — es sind keine konkreten Prinzipien/Gates definiert. Ersatzweise gelten die allgemeinen Projektleitlinien:

- **Minimale Komplexität / YAGNI**: erfüllt — keine neue Persistenz, kein neues API, Wiederverwendung des bestehenden Event-/Reducer-Mechanismus; ein einziger Reconciler statt verstreuter Sonderfälle.
- **Keine Rückbau-Shims**: erfüllt — aktionsgekoppelte Auflösung wird durch zustandsgekoppelte ergänzt/ersetzt, ohne toten Kompatibilitätscode.
- **Testbarkeit**: erfüllt — Prädikate + Reconcile sind reine, per vitest testbare Logik.

**Ergebnis**: PASS (keine Verstösse, keine Einträge in Complexity Tracking nötig).

## Project Structure

### Documentation (this feature)

```text
specs/braucht-dich-meldungen-optimieren/
├── plan.md              # Diese Datei (/speckit-plan)
├── spec.md              # Feature-Spezifikation (/speckit-specify + /speckit-clarify)
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── attention-reconciliation.md   # Phase 1
├── checklists/
│   └── requirements.md  # Spec-Qualitäts-Checkliste
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

Betroffene, bestehende Dateien (keine neuen Pakete/Verzeichnisse):

```text
packages/shared/src/
└── types.ts                         # AttentionKind/-Item, IntegrationStage (Referenz; ggf. Helfer-Typ)

packages/server/src/
├── db/repos.ts                      # AttentionRepo.resolveFor/listOpen (Basis für Reconcile)
├── services/
│   ├── attentionReconciler.ts       # NEU: reine Gültigkeits-/Reconcile-Logik (Prädikate)
│   ├── attentionReconciler.test.ts  # NEU: vitest-Abdeckung der Prädikate/Invarianten
│   ├── orchestrator.ts              # reapOnBoot() → Reconcile; handleStatusChange → agent_errored ergänzen
│   ├── chatWorkService.ts           # handleStatusChange → agent_errored ergänzen (Chat-Sessions)
│   └── mergeQueueService.ts         # setStage() → stage-inkonsistente Meldungen auflösen
└── api/server.ts                    # GET /api/attention + Bootstrap getState → Reconcile vor Auslieferung

packages/web/src/
└── App.tsx                          # Badge/Titel-Zähler auf selectedProjectId scopen
```

**Structure Decision**: Bestehende Web-App-Struktur (Monorepo server/web/shared) wird beibehalten. Neu ist einzig ein gekapseltes Reconciler-Modul im Server (`services/attentionReconciler.ts`) plus dessen Test; alle übrigen Änderungen sind punktuelle Anpassungen an vorhandenen Aufrufstellen. Die reine Prädikat-Logik wird so gebaut, dass sie ohne DB/IO testbar ist (Zustands-Snapshot als Eingabe), während die Aufrufstellen Persistenz + Event-Emission übernehmen.

## Complexity Tracking

> Keine Constitution-Verstösse → keine Einträge nötig.
