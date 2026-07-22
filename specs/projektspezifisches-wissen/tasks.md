---
description: "Task list for Projektspezifisches Wissen"
---

# Tasks: Projektspezifisches Wissen

**Input**: Design documents from `specs/projektspezifisches-wissen/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Unit-Tests der puren `@sdd/shared`-Logik und Repo-/Service-Tests gegen In-Memory-DB sind enthalten — konsistent mit der gelebten Test-Konvention des Projekts (`phaseMachine.test.ts`, `snapshotStore.test.ts`) und der in plan.md festgelegten Struktur. Sie sind Teil der jeweiligen Story, kein separater TDD-Zwang.

**Organization**: Nach User Story (P1–P4). Jede Story ist unabhängig implementier- und testbar.

## Format: `[ID] [P?] [Story] Beschreibung mit Dateipfad`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: `[US1]`…`[US4]` — nur in Story-Phasen
- Monorepo: `packages/shared/src/`, `packages/server/src/`, `packages/web/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Domänentypen bereitstellen, auf die alle Schichten zugreifen.

- [X] T001 [P] Domänentypen anlegen (Applicability, KnowledgeBundle, KnowledgeEntry, KnowledgeTree(Node), KnowledgeIndex(Item), KnowledgeFeatureSelection, ResolvedSelection) gemäß data-model.md in `packages/shared/src/knowledge.ts`
- [X] T002 Modul re-exportieren: `export * from './knowledge.js'` in `packages/shared/src/index.ts` (abhängig von T001)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Persistenz, DI, Event- und Web-Plumbing, ohne die keine Story kompiliert.

**⚠️ CRITICAL**: Muss vor allen User Stories abgeschlossen sein.

- [X] T003 SQLite-Migration (Tabellen `knowledge_bundles`, `knowledge_entries`, `knowledge_feature_selection` + Indizes aus data-model.md) an `MIGRATIONS[]` anhängen in `packages/server/src/db/database.ts`
- [X] T004 `KnowledgeRepo`-Grundgerüst (Row-Interfaces, `toBundle`/`toEntry`-Mapper, Konstruktor, projekt-gescopte `listBundles`/`listEntries`) in `packages/server/src/db/knowledgeRepo.ts` (abhängig von T003)
- [X] T005 [P] `KnowledgeService`-Grundgerüst (Klasse + Deps: Repos, Projects, Features) in `packages/server/src/services/knowledgeService.ts`
- [X] T006 [P] Bus-Event `knowledge_updated: { projectId }` in `BusEvents` und `BUS_EVENT_NAMES` ergänzen in `packages/server/src/events.ts`
- [X] T007 [P] Web-Client-Gerüst: Knowledge-Typen + leere Methodengruppe im `api`-Objekt in `packages/web/src/api.ts`
- [X] T008 [P] Store: `knowledge_updated`-Case im WS-Switch + Action/State `knowledgeVersion: Record<projectId, number>` (Bump zum gezielten Refetch) in `packages/web/src/store.tsx`
- [X] T009 DI-Verdrahtung: `KnowledgeRepo` + `KnowledgeService` instanziieren und in `ApiDeps` einhängen in `packages/server/src/index.ts` und `packages/server/src/api/server.ts` (abhängig von T004, T005)

**Checkpoint**: Fundament steht — User Stories können beginnen.

---

## Phase 3: User Story 1 - Projektspezifisches Wissen verwalten (Priority: P1) 🎯 MVP

**Goal**: Wissenseinträge pro Projekt vollständig im Toolkit anlegen, ansehen, bearbeiten, löschen — projekt-gescopt, persistent (FR-001/FR-002/FR-011, SC-002/SC-004). Inkl. Import bestehender Repo-Dateien (FR-015).

**Independent Test**: Eintrag anlegen → erscheint sofort; bearbeiten/löschen persistiert; in Projekt B nicht sichtbar (quickstart Szenario 1).

- [X] T010 [P] [US1] `buildKnowledgeTree(bundles, entries)` (inkl. `looseEntries` ohne Bundle) + Unit-Test in `packages/shared/src/knowledge.ts` und `packages/shared/src/knowledge.test.ts`
- [X] T011 [US1] Entry-CRUD im Repo (`createEntry`/`getEntry`/`updateEntry`/`deleteEntry`/`listEntriesByProject`, projekt-gescopt, `applicability_tags` als JSON) in `packages/server/src/db/knowledgeRepo.ts` (abhängig von T004)
- [X] T012 [US1] Repo-Test gegen `openMemoryDatabase()`: Entry-CRUD, Projekt-Scoping (SC-004), Tree-Query in `packages/server/src/db/knowledgeRepo.test.ts` (abhängig von T011, T010)
- [X] T013 [US1] REST: `GET /api/projects/:id/knowledge` (liefert `{ tree }`) + `POST/PATCH/DELETE` Entries; nach jedem Schreiben `bus.emitEvent('knowledge_updated', {projectId})` in `packages/server/src/api/server.ts` (abhängig von T011)
- [X] T014 [P] [US1] Web-API-Methoden `getKnowledge`, `createEntry`, `updateEntry`, `deleteEntry` in `packages/web/src/api.ts`
- [X] T015 [US1] `KnowledgePanel.tsx`: Eintragsliste + Anlege-/Bearbeiten-/Lösch-Formular, Fetch beim Öffnen, Refetch bei `knowledgeVersion`-Bump in `packages/web/src/components/KnowledgePanel.tsx` (abhängig von T014, T008)
- [X] T016 [US1] `KnowledgePanel` in die UI einhängen (Projekt-Ansicht/Navigation) in `packages/web/src/App.tsx` bzw. `packages/web/src/components/ProjectSettings.tsx` (abhängig von T015)
- [X] T017 [US1] Import/Refresh (FR-015): Repo-Feld-Handling `source`/`source_path` + `KnowledgeService.importFromFile`/`refreshFromFile` (repo-relativ, `..`-Guard) + REST `POST /api/projects/:id/knowledge/entries/import` und `POST /api/knowledge/entries/:id/refresh` in `packages/server/src/services/knowledgeService.ts` und `packages/server/src/api/server.ts` (abhängig von T011, T005, T013)
- [X] T018 [P] [US1] Web: Import-/Refresh-Aktion im `KnowledgePanel` + `importEntry`/`refreshEntry` in `packages/web/src/api.ts` (abhängig von T014)

**Checkpoint**: US1 eigenständig funktionsfähig — MVP demofähig.

---

## Phase 4: User Story 2 - Verschachtelte Bundles mit Anwendbarkeit (Priority: P2)

**Goal**: Wissen hierarchisch in Bundles gliedern; Anwendbarkeit (Freitext + Tags) je Bundle/Eintrag (FR-003/FR-004).

**Independent Test**: Bundle + Unter-Bundle + Einträge anlegen, Eintrag verschieben, Zyklus abgewiesen (quickstart Szenario 2).

- [X] T019 [US2] `detectCycle(bundles, id, newParentId)` + Unit-Test in `packages/shared/src/knowledge.ts` und `packages/shared/src/knowledge.test.ts` (abhängig von T010)
- [X] T020 [US2] Bundle-CRUD + `move` (parentId/bundleId-Umhängung mit Zyklus-Guard, Projekt-Gleichheit) im Repo in `packages/server/src/db/knowledgeRepo.ts` (abhängig von T004, T019)
- [X] T021 [US2] Repo-Test: Verschachtelung, `ON DELETE CASCADE` auf Teilbäume, Ablehnung fremder Parent/Bundle in `packages/server/src/db/knowledgeRepo.test.ts` (abhängig von T020)
- [X] T022 [US2] REST: Bundle-Endpunkte (`POST /api/projects/:id/knowledge/bundles`, `PATCH`/`DELETE /api/knowledge/bundles/:id`) + `bundleId`/`applicability` in Entry-Payloads in `packages/server/src/api/server.ts` (abhängig von T020, T013)
- [X] T023 [P] [US2] Web-API-Methoden für Bundles (`createBundle`, `updateBundle`, `deleteBundle`, `moveNode`) in `packages/web/src/api.ts`
- [X] T024 [US2] `KnowledgePanel`: Baum-/Nesting-Darstellung, Verschieben, Anwendbarkeits-Editor (Freitext + Tag-Chips) in `packages/web/src/components/KnowledgePanel.tsx` (abhängig von T022, T023, T015)

**Checkpoint**: US1 + US2 unabhängig funktionsfähig.

---

## Phase 5: User Story 3 - Automatisch gepflegter Projekt-Index (Priority: P3)

**Goal**: Kompakter, immer aktueller Index (Titel + Anwendbarkeit, ohne Inhalte), automatisch bei jeder Änderung (FR-005/FR-006, SC-005).

**Independent Test**: Eintrag hinzufügen/löschen → Index spiegelt Änderung ohne manuellen Schritt; Index enthält keine Bodies (quickstart Szenario 3).

- [X] T025 [US3] `projectIndex(bundles, entries, now)` (Projektion, Eltern-vor-Kind, ohne Inhalte) + Unit-Test (spiegelt add/edit/delete, keine `body`-Felder) in `packages/shared/src/knowledge.ts` und `packages/shared/src/knowledge.test.ts` (abhängig von T010)
- [X] T026 [US3] `KnowledgeRepo.index(projectId)` auf Basis von `projectIndex` in `packages/server/src/db/knowledgeRepo.ts` (abhängig von T025, T020)
- [X] T027 [US3] REST: `GET /api/projects/:id/knowledge` um `index` erweitern (`{ tree, index }`) in `packages/server/src/api/server.ts` (abhängig von T026, T013)
- [X] T028 [US3] Web: kompakte Index-Übersicht (Anwendbarkeit je Element, keine Inhalte) im `KnowledgePanel` in `packages/web/src/components/KnowledgePanel.tsx` (abhängig von T027, T024)

**Checkpoint**: US1–US3 unabhängig funktionsfähig.

---

## Phase 6: User Story 4 - Selektive Nutzung bei der Feature-Erstellung (Priority: P4)

**Goal**: Nur relevantes Wissen wird der Feature-Session bereitgestellt (Index-first, Materialisierung), hybrid vorgeschlagen + übersteuerbar; angewandte Auswahl nachvollziehbar (FR-008/FR-009/FR-010/FR-014, SC-003/SC-007).

**Independent Test**: Auth-Feature → „Auth" auto-relevant, „Deployment" nicht; Override greift; `.sdd/knowledge/index.md` listet alles, nur `effective` materialisiert; `.sdd/` git-excluded (quickstart Szenario 4).

- [X] T029 [US4] Spike + Entscheidung: Injektionskanal der Session (research.md **D5**) — spec-kit-`before_*`-Hook/Template-Ergänzung vs. Prompt-Präambel; Ergebnis in `specs/projektspezifisches-wissen/research.md` (D5) festhalten
- [X] T030 [US4] `scoreRelevance(index, signal)` (Tag-Exakttreffer + Text-Token-Overlap) + Unit-Test in `packages/shared/src/knowledge.ts` und `packages/shared/src/knowledge.test.ts` (abhängig von T010)
- [X] T031 [US4] `resolveSelection(scored, selections, threshold)` (Auto ⊕ Overrides → `effective`) + Unit-Test in `packages/shared/src/knowledge.ts` und `packages/shared/src/knowledge.test.ts` (abhängig von T030)
- [X] T032 [US4] Repo: Selektions-CRUD (`setSelection`/`clearSelection`/`listSelectionForFeature`) auf `knowledge_feature_selection` in `packages/server/src/db/knowledgeRepo.ts` (abhängig von T004)
- [X] T033 [US4] `KnowledgeService.suggestRelevance(feature)` — Feature-Name + `specs/<name>/spec.md` als Signal, `scoreRelevance` in `packages/server/src/services/knowledgeService.ts` (abhängig von T005, T030, T026)
- [X] T034 [US4] `KnowledgeService.materializeForFeature(feature, phase)` — `.sdd/knowledge/index.md` (immer) + `effective`-Inhaltsdateien, `.sdd/` in `.git/info/exclude` (Muster wie `.sdd-tmp/`), gemäß contracts/materialized-layout.md in `packages/server/src/services/knowledgeService.ts` (abhängig von T005, T031, T026)
- [X] T035 [US4] REST: `GET /api/features/:id/knowledge`, `PUT /api/features/:id/knowledge/selection`, `POST /api/features/:id/knowledge/materialize` in `packages/server/src/api/server.ts` (abhängig von T032, T033, T034)
- [X] T036 [US4] Orchestrator: additiver `knowledgeService.materializeForFeature(...)`-Aufruf in `startPhaseRun` + gewählter Injektionskanal in `packages/server/src/services/orchestrator.ts` (abhängig von T034, T029)
- [X] T037 [P] [US4] Web-API-Methoden `featureKnowledge`, `setSelection`, `materializeKnowledge` in `packages/web/src/api.ts`
- [X] T038 [US4] `FeatureKnowledgeSelect.tsx` — Vorschau der aufgelösten Auswahl + manuelle Übersteuerung + Anzeige der geladenen Auswahl (FR-014) in `packages/web/src/components/FeatureKnowledgeSelect.tsx` (abhängig von T037, T035)
- [X] T039 [US4] Service-Test: `materializeForFeature` schreibt korrektes Layout + `.git/info/exclude`-Eintrag, nur `effective` materialisiert (SC-003) in `packages/server/src/services/knowledgeService.test.ts` (abhängig von T034)

**Checkpoint**: Alle vier Stories unabhängig funktionsfähig.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T040 [P] README.md um Abschnitt „Projektspezifisches Wissen" ergänzen in `README.md`
- [X] T041 `pnpm -r typecheck && pnpm -r test` grün ziehen (Fehler beheben)
- [X] T042 quickstart.md Szenarien P1–P4 end-to-end durchspielen (`pnpm dev`)
- [X] T043 [P] Performance-Sanity: `projectIndex` < 50 ms bei ~50 Einträgen (Micro-Check im `knowledge.test.ts`)

---

## Dependencies & Execution Order

### Phase-Abhängigkeiten

- **Setup (P1)**: sofort startbar
- **Foundational (P2)**: nach Setup — **blockiert alle Stories**
- **US1 (P3)** → **US2 (P4)** → **US3 (P5)** → **US4 (P6)**: in Prioritätsreihenfolge; jede nach Foundational eigenständig testbar. US3 baut GET aus US1 aus; US2/US3 erweitern das `KnowledgePanel` aus US1; US4 nutzt Index (US3) und Repo/Service (Foundational).
- **Polish (P7)**: nach den gewünschten Stories

### Story-Abhängigkeiten (real, nicht künstlich)

- US1: nur Foundational.
- US2: Foundational + `buildKnowledgeTree`/Panel aus US1 (erweitert dieselbe Datei).
- US3: `buildKnowledgeTree` (US1) + Bundle-Repo (US2) für vollständige Verschachtelung im Index.
- US4: Index-Repo (US3) + Selektions-Tabelle (Foundational). Injektionskanal-Spike (T029) vor Orchestrator-Einhängung (T036).

### Innerhalb einer Story

- Pure Logik + Test → Repo → REST → Web.
- Tasks mit gleicher Zieldatei (`knowledge.ts`/`knowledge.test.ts`, `knowledgeRepo.ts`, `api/server.ts`, `KnowledgePanel.tsx`) laufen **seriell**.

---

## Parallel-Beispiele

**Foundational (P2)** — nach T004:
```text
T005 knowledgeService-Gerüst (services/knowledgeService.ts)
T006 events.ts
T007 web/api.ts
T008 web/store.tsx
```
(vier verschiedene Dateien → parallelisierbar; T009 danach)

**US1 (P3)**:
```text
T010 buildKnowledgeTree (shared)      # parallel zu Server-/Web-Setup
T014 web/api.ts Entry-Methoden        # parallel, andere Datei
```

---

## Implementation Strategy

### MVP zuerst (nur US1)
1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & VALIDATE** (quickstart Szenario 1) → demofähig.

### Inkrementell
US1 (MVP) → US2 (Nesting) → US3 (Index) → US4 (selektive Nutzung). Jede Story fügt Wert hinzu, ohne vorige zu brechen.

### Hinweise
- `[P]` = andere Datei, keine offene Abhängigkeit.
- Nach jeder Story am Checkpoint validieren.
- Materialisiertes Wissen **immer** git-excluded halten — Feature-Diffs dürfen `.sdd/` nie enthalten.
- Injektionskanal (T029) ist das einzige echte Design-Risiko — vor T036 klären.

## Task-Zusammenfassung

- **Gesamt**: 43 Tasks
- **Setup**: T001–T002 · **Foundational**: T003–T009
- **US1 (MVP)**: T010–T018 (9) · **US2**: T019–T024 (6) · **US3**: T025–T028 (4) · **US4**: T029–T039 (11)
- **Polish**: T040–T043 (4)
