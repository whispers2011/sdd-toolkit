# Implementation Plan: Projektspezifisches Wissen

**Branch**: `feature/projektspezifisches-wissen` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/projektspezifisches-wissen/spec.md`

## Summary

Pro Projekt verwaltbares, verschachteltes Wissen (Bundles → Einträge) mit Anwendbarkeit (Freitext + Tags), das die SDD-Feature-Sessions selektiv konsumieren. Technischer Ansatz: SQLite als Single Source of Truth (neue projekt-gescopte Tabellen, analog zu `personas`), der **Index als abgeleitete Projektion** (dadurch inhärent immer aktuell — keine separate Pflege, keine Staleness), REST-CRUD + `knowledge_updated`-WebSocket-Event (on-demand geladen, nicht im `/api/state`-Bootstrap), sowie **Materialisierung nur des relevanten Wissens in den Feature-Worktree** (`.sdd/knowledge/`, git-excluded — analog zum bestehenden `.sdd-tmp/`-Muster) beim Start einer Phase. Relevanz wird deterministisch aus Tags/Text gegen die Feature-Beschreibung vorgeschlagen und ist pro Feature manuell übersteuerbar (hybrid).

## Technical Context

**Language/Version**: TypeScript 5.x (ESM, `"type": "module"`), Node ≥ 22

**Primary Dependencies**: Fastify + `@fastify/websocket` + `@fastify/multipart` (Server), `better-sqlite3` (WAL) für Persistenz, React 18 + Vite + Tailwind (Web), `nanoid` für IDs. Keine neuen Laufzeit-Abhängigkeiten erforderlich.

**Storage**: SQLite (`<dataDir>/sdd-toolkit.sqlite`) via Migrations-Array in `packages/server/src/db/database.ts`. Materialisierte Session-Artefakte als Dateien im Worktree unter `.sdd/knowledge/` (git-excluded über `.git/info/exclude`).

**Testing**: Vitest pro Package (`*.test.ts`). Pure Logik (Index-Projektion, Relevanz-Matching, Baum-Aufbau) in `@sdd/shared` unit-getestet (Muster: `phaseMachine.test.ts`, `costMeter.test.ts`); Repo-/Service-Tests gegen In-Memory-DB (`openMemoryDatabase()`, Muster: `snapshotStore.test.ts`).

**Target Platform**: Lokale Web-App (Server 127.0.0.1:4820, Web 4830), primär macOS (Finder/osascript-Pfade vorhanden), Linux-tauglich.

**Project Type**: Web-Application im pnpm-Monorepo — drei Packages: `@sdd/shared`, `@sdd/server`, `@sdd/web`.

**Performance Goals**: Index-Projektion < 50 ms bei ~10–50 Einträgen; CRUD im UI < 1 s sichtbar (WS-Broadcast → gezielter Refetch); Materialisierung des Selektions-Sets < 200 ms.

**Constraints**: Kein Eingriff in Feature-Diffs (materialisiertes Wissen strikt git-excluded); Wissen projekt-gescopt (0 Cross-Projekt-Leakage); keine Änderung an bestehenden Phasen-/Merge-Flows außer additiver Einhängung in `startPhaseRun`; kein Secret-/Key-Handling.

**Scale/Scope**: Dutzende Bundles/Einträge pro Projekt (Klärung 2026-07-22). Beliebig unterschiedliche Inhalte je Projekt, kein festes Content-Schema.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Die Projekt-Konstitution (`.specify/memory/constitution.md`) ist noch unausgefüllt (Template-Platzhalter) — es existieren **keine ratifizierten, bindenden Prinzipien**. Ersatzweise gelten die im Bestandscode gelebten Leitlinien; das Design wurde dagegen geprüft:

- **Konsistenz mit der bestehenden Architektur** — ✅ SQLite-Migration + typisiertes Repo + Fastify-Route + Bus-Event + Reducer-Store; keine neuen Muster.
- **Einfachheit / YAGNI** — ✅ Index als Projektion statt separater Pflege-Maschinerie; keine neuen Dependencies; kein separater LLM-Relevanz-Call in v1.
- **Pure Domänenlogik in `@sdd/shared`, testbar** — ✅ Index-Projektion, Relevanz-Score, Baum-Aufbau als pure Funktionen.
- **Additive Integration** — ✅ Bestehende Phasen-/Session-/Merge-Pfade bleiben unverändert; Einhängung nur additiv in `startPhaseRun`.
- **Isolation / keine Seiteneffekte auf Repos** — ✅ materialisierte Dateien git-excluded, außerhalb der Feature-Diffs.

**Ergebnis**: PASS (keine Verstöße, Complexity Tracking bleibt leer). Re-Check nach Phase 1: weiterhin PASS.

## Project Structure

### Documentation (this feature)

```text
specs/projektspezifisches-wissen/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0 (Entscheidungen + Begründungen)
├── data-model.md        # Phase 1 (Entitäten, Tabellen, Projektionen)
├── quickstart.md        # Phase 1 (End-to-End-Validierungsleitfaden)
├── contracts/           # Phase 1 (REST-, WS-, Materialisierungs-Contracts)
│   ├── rest-api.md
│   ├── ws-events.md
│   └── materialized-layout.md
├── checklists/
│   └── requirements.md  # aus /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT hier erzeugt)
```

### Source Code (repository root)

```text
packages/
├── shared/src/
│   ├── knowledge.ts          # NEU: Typen (Bundle/Entry/Index/Selection) + pure Logik
│   │                         #      (buildKnowledgeTree, projectIndex, scoreRelevance)
│   ├── knowledge.test.ts     # NEU: Unit-Tests der puren Logik
│   ├── types.ts              # unverändert (Knowledge-Typen liegen in knowledge.ts)
│   └── index.ts              # + export * from './knowledge.js'
│
├── server/src/
│   ├── db/
│   │   ├── database.ts        # + Migration (knowledge_bundles, knowledge_entries, knowledge_feature_selection)
│   │   └── knowledgeRepo.ts   # NEU: KnowledgeRepo (CRUD, Baum-Query, Index-Projektion, Selektion)
│   ├── services/
│   │   └── knowledgeService.ts # NEU: Import aus Repo-Datei, Relevanz-Vorschlag, Worktree-Materialisierung
│   ├── api/server.ts          # + /api/projects/:id/knowledge* Routen, + Selektions-/Materialisierungs-Routen
│   ├── events.ts              # + 'knowledge_updated' in BusEvents + BUS_EVENT_NAMES
│   ├── services/orchestrator.ts # startPhaseRun: additiver Aufruf knowledgeService.materializeForFeature(...)
│   └── index.ts               # + KnowledgeRepo/knowledgeService in die DI-Verdrahtung
│
└── web/src/
    ├── api.ts                 # + knowledge-Client-Methoden
    ├── store.tsx              # + 'knowledge_updated'-Dispatch (gezielter Refetch je Projekt)
    └── components/
        ├── KnowledgePanel.tsx        # NEU: Baum-Verwaltung (CRUD, Nesting, Anwendbarkeit, Import)
        └── FeatureKnowledgeSelect.tsx # NEU (P4): Vorschau/Übersteuerung der geladenen Auswahl pro Feature
```

**Structure Decision**: Bestehendes Monorepo erweitern. Pure, testbare Domänenlogik nach `@sdd/shared/src/knowledge.ts`; Persistenz + API + Materialisierung im Server (neue `knowledgeRepo.ts` + `knowledgeService.ts`, additive Route-/Event-/Orchestrator-Erweiterungen); Verwaltungs-UI + Feature-Auswahl im Web. Wissen wird **nicht** in `/api/state` gebootstrappt (potenziell groß) — es wird on-demand pro Projekt geladen und über `knowledge_updated` invalidiert (Muster wie `executions`).

## Complexity Tracking

> Keine Constitution-Verstöße — Tabelle bleibt leer.
