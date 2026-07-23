---

description: "Task list for braucht-dich-meldungen-optimieren"
---

# Tasks: „Braucht dich"-Meldungen optimieren

**Input**: Design documents from `specs/braucht-dich-meldungen-optimieren/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/attention-reconciliation.md, quickstart.md

**Tests**: Enthalten — plan.md („Testing": vitest) und quickstart.md fordern Unit-/Service-Tests für Reconciler + Aufrufpunkte explizit. `@sdd/web` hat keine automatisierten Tests (MVP) → UI-Aspekte via manuellem Quickstart.

**Organization**: Aufgaben sind nach User Story gruppiert. Zentrale, geteilte Logik (Gültigkeits-Prädikate) liegt in Phase 2 (Foundational), weil US1 und US2 darauf aufbauen. US3 und US4 sind davon unabhängig.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Kann parallel laufen (andere Datei, keine Abhängigkeit zu offener Aufgabe)
- **[Story]**: Zugehörige User Story (US1…US4)

## Path Conventions

Monorepo (Web-App): `packages/server/src/`, `packages/web/src/`, `packages/shared/src/` (siehe plan.md → Project Structure).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Neues, gekapseltes Reconciler-Modul anlegen (kein Projekt-Init nötig — bestehendes Repo).

- [X] T001 Modul-Stub anlegen: `packages/server/src/services/attentionReconciler.ts` (leere Exports als Platzhalter) und Test-Stub `packages/server/src/services/attentionReconciler.test.ts` (import + leere `describe`-Hülle), damit vitest die Datei erfasst.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Reine Gültigkeits-/Reconcile-Logik, auf die US1 und US2 zugreifen. Keine DB/IO — Zustands-Snapshot als Eingabe (testbar).

**⚠️ CRITICAL**: US1 und US2 können erst starten, wenn diese Phase steht.

- [X] T002 In `packages/server/src/services/attentionReconciler.ts` das Gültigkeits-Prädikat `isAttentionValid(item, snapshot)` implementieren gemäss `data-model.md`-Tabelle: `awaiting_input` gültig wenn Live-Session (per `sessionId` **oder** `conversationId`) im Status `awaiting_input`; `agent_errored` stale wenn eine Live-Session desselben `featureId` gerade `working` ist; `review_due`↔`awaiting_human_review`, `verify_failed`↔`verify_failed`, `gate_failed`↔`gate_failed`, `merge_conflict_escalated`↔`conflict_escalated` (Vergleich gegen `feature.integration`); Feature/Session nicht auffindbar → **stale** (konservativ, FR-015). `permission_request` wird ignoriert. Snapshot-Typ definieren: `{ sessions: Map<sessionId,{status,featureId,conversationId}>, features: Map<featureId,{integration}> }`.
- [X] T003 In `packages/server/src/services/attentionReconciler.ts` zwei Einstiegsfunktionen ergänzen: `findStaleRuntime(open, snapshot)` = `open.filter(i => !isAttentionValid(i, snapshot))`; und `findStaleOnBoot(open, features)` = alle offenen session-basierten Arten (`awaiting_input`, `agent_errored`) als stale **plus** Merge-Arten via `isAttentionValid` gegen `features` (Sessions-Snapshot leer). (D3: nach Boot sind Session-Arten nicht bestätigbar.)
- [X] T004 Unit-Tests in `packages/server/src/services/attentionReconciler.test.ts`: je Meldungsart ein gültig-/stale-Fall (T002); INV-2 (Idempotenz: `findStaleRuntime` zweimal ohne Zustandsänderung → gleiche Menge), INV-3 (gültige Items nie in der stale-Menge), `findStaleOnBoot` löst Session-Arten immer, Merge-Arten nur bei nicht passender Stage.

**Checkpoint**: Reconciler-Kern steht und ist grün getestet — US1/US2 können beginnen.

---

## Phase 3: User Story 1 - Erledigte/überholte Meldungen verschwinden automatisch (Priority: P1) 🎯 MVP

**Goal**: Löst sich der Zustand hinter einer Meldung auf **beliebigem** Weg auf (Session läuft weiter, Antwort in der Konsole, Stage wechselt, Verifikation grün), verschwindet die Meldung automatisch — zur Laufzeit ereignisgetrieben, mit Read-Time-Reconcile als Sicherheitsnetz.

**Independent Test**: Für jede Meldungsart einen Auslöser herstellen, die Situation ausserhalb der Inbox auflösen und prüfen, dass die Meldung ohne Zutun verschwindet (siehe quickstart.md, Szenarien 1–3).

### Implementation for User Story 1

- [X] T005 [US1] In `packages/server/src/services/orchestrator.ts` Methode `reconcileOpenAttention()` ergänzen: Snapshot aus den Live-Sessions (in-memory Session-Status) + `deps.features` bauen, `findStaleRuntime(deps.attention.listOpen(), snapshot)` aufrufen, jedes stale Item via `deps.attention.resolve(id)` auflösen und `bus.emitEvent('attention_resolved', id)` senden. (Kapselt den Live-Session-Zugriff im Orchestrator.)
- [X] T006 [US1] In `packages/server/src/services/orchestrator.ts` die Auflösung erweitern: `handleStatusChange` (Working-Übergang, `orchestrator.ts:353-360`) um Kind `agent_errored` in der `resolveFor`-Liste ergänzen; in `handleExit` (`orchestrator.ts:479-510`) offene `awaiting_input`-Items der beendeten Session auflösen + `attention_resolved` mit `session.id` emittieren. (Hängt an T005/gleiche Datei — sequenziell nach T005.)
- [X] T007 [P] [US1] In `packages/server/src/services/chatWorkService.ts` den Working-Übergang (`chatWorkService.ts:219-222`) analog um `agent_errored` erweitern und Auflösung beim Session-Ende sicherstellen.
- [X] T008 [P] [US1] In `packages/server/src/services/mergeQueueService.ts` in `setStage()` nach dem Stage-Wechsel die zur alten Stage gehörenden, jetzt inkonsistenten Meldungen auflösen (Reconciler-Prädikat gegen die neue `feature.integration`), damit `review_due`/`verify_failed`/`gate_failed`/`merge_conflict_escalated` zustandsgekoppelt verschwinden — nicht nur über die bestehenden Buttons.
- [X] T009 [P] [US1] In `packages/server/src/api/server.ts` Read-Time-Reconcile einhängen: vor Auslieferung von `GET /api/attention` (`server.ts:511`) **und** im Bootstrap-`getState` (`server.ts:84`) `orchestrator.reconcileOpenAttention()` aufrufen, dann nur die (verbleibenden) offenen Items liefern. (Sicherheitsnetz für verpasste Events; erfüllt „auf beliebigem Weg".)
- [X] T010 [US1] Service-Tests (vitest, Server) für US1-Szenarien: `awaiting_input` wird stale bei Working/Session-Ende; `agent_errored` wird stale sobald Feature-Session wieder `working`; `review_due`/`verify_failed`/`gate_failed`/`merge_conflict_escalated` werden stale bei Stage-Wechsel; nur die betroffene Meldung wird aufgelöst (US1-7/INV-3). Muster analog `packages/server/src/services/chatWorkService.test.ts`.

**Checkpoint**: US1 vollständig und unabhängig testbar — der Kern des Features (MVP).

---

## Phase 4: User Story 2 - Aktueller Stand nach verpassten Events und Neustart (Priority: P2)

**Goal**: Nach Neustart oder verpasstem Event zeigt die Inbox nur Meldungen, deren Zustand bestätigt aktiv ist; nicht bestätigbare werden konservativ entfernt.

**Independent Test**: Offene Meldungen erzeugen, `reapOnBoot()` mit einem Zustand ohne diese Sessions ausführen und prüfen, dass `listOpen()` danach nur gültige Items enthält (quickstart.md, Szenario 4 / SC-003).

### Implementation for User Story 2

- [X] T011 [US2] In `packages/server/src/services/orchestrator.ts` `reapOnBoot()` (`orchestrator.ts:514-527`) erweitern: nach dem Beenden der Sessions `findStaleOnBoot(deps.attention.listOpen(), features)` auswerten, stale Items via `deps.attention.resolve(id)` auflösen und `attention_resolved` emittieren. (Gleiche Datei wie T005/T006 → sequenziell danach.)
- [X] T012 [US2] Service-Test (vitest, Server): offene `awaiting_input`/`agent_errored`/`review_due` anlegen, `reapOnBoot()` laufen lassen, prüfen dass Session-Arten aufgelöst sind und Merge-Arten nur bei nicht passender `integration`-Stage verschwinden; INV-2 Idempotenz (zweiter Boot ändert nichts).

**Checkpoint**: US1 + US2 funktionieren unabhängig; Neustart hinterlässt keine Geister.

---

## Phase 5: User Story 3 - Zähler und Liste stimmen überein (Priority: P2)

**Goal**: Badge/Titel-Zähler zeigt exakt die Zahl der sichtbaren, echten Meldungen des ausgewählten Projekts.

**Independent Test**: Meldungen in einem anderen als dem ausgewählten Projekt erzeugen und prüfen, dass der Badge nur das ausgewählte Projekt zählt (quickstart.md, Szenario 5 / SC-004). Unabhängig vom Reconciler.

### Implementation for User Story 3

- [X] T013 [P] [US3] In `packages/web/src/App.tsx` den Zähler `openAttention` (`App.tsx:27-28`) zusätzlich zur bestehenden `permission_request`-Ausnahme auf `a.projectId === state.selectedProjectId` filtern, sodass Badge/Titel-Badge dem Projekt-Scope der Inbox (`AttentionInbox.tsx:22-24`) entsprechen (INV-5, FR-011).

**Checkpoint**: Badge === sichtbare Liste in jedem Projekt-Scope.

---

## Phase 6: User Story 4 - Manuelles Erledigen bleibt möglich (Priority: P3)

**Goal**: Das explizite ✓-Erledigen funktioniert weiterhin; eine so entfernte Meldung bleibt entfernt; ein erneuter Zustand erzeugt eine neue Meldung.

**Independent Test**: Eine aktive Meldung per ✓ erledigen und prüfen, dass sie verschwindet und für denselben Zustand nicht sofort erneut auftaucht (quickstart.md, Szenario 6 / FR-014).

### Implementation for User Story 4

- [X] T014 [US4] Service-Test (vitest, Server): manuelles `resolve(id)` setzt `resolvedAt`; ein anschliessender `reconcileOpenAttention()`/`reapOnBoot()` legt das Item nicht neu an (Reconcile löst nur auf, `attention_raised` bleibt aus, INV-Kontrakt C1); Wiederauftreten des Zustands erzeugt via `raise()` ein neues Item mit neuer ID (FR-013, Dedup INV-4). Keine Produktivcode-Änderung erwartet — reine Absicherung; falls ein Regressionspunkt auffällt, hier beheben.

**Checkpoint**: Alle vier User Stories unabhängig funktionsfähig.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Absicherung über alle Stories.

- [X] T015 [P] `pnpm -r typecheck` und Lint ausführen und Befunde in den geänderten Dateien beheben.
- [ ] T016 Manuelle Quickstart-Validierung durchführen (`specs/braucht-dich-meldungen-optimieren/quickstart.md`, Szenarien 1–6) und SC-001…SC-005 abgleichen.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten.
- **Foundational (Phase 2)**: nach Setup — **blockiert US1 und US2**.
- **US1 (Phase 3)** und **US2 (Phase 4)**: nach Foundational. US2 teilt Datei `orchestrator.ts` mit US1 → US2-Aufgabe T011 sequenziell nach T005/T006.
- **US3 (Phase 5)** und **US4 (Phase 6)**: unabhängig vom Reconciler — US3 kann sofort parallel starten; US4 setzt nur den bestehenden Resolve-Pfad + (optional) den Reconciler voraus.
- **Polish (Phase 7)**: nach den gewünschten Stories.

### User Story Dependencies

- **US1 (P1)**: nach Foundational; keine Abhängigkeit zu anderen Stories.
- **US2 (P2)**: nach Foundational; nutzt dieselbe `orchestrator.ts` wie US1 (Dateikonflikt beachten), sonst eigenständig.
- **US3 (P2)**: völlig unabhängig (nur `App.tsx`).
- **US4 (P3)**: baut auf dem Resolve-Pfad auf; am robustesten nach US1.

### Within Each User Story

- Foundational-Prädikate vor allen Server-Aufrufstellen.
- Tests nach der jeweiligen Implementierung (kein TDD gefordert, aber Abdeckung laut plan/quickstart).

### Parallel Opportunities

- **Foundational**: T002 → T003 → T004 sequenziell (gleiche Datei).
- **US1**: T007 (`chatWorkService.ts`), T008 (`mergeQueueService.ts`), T009 (`server.ts`) parallel `[P]`; T005/T006 sequenziell in `orchestrator.ts`.
- **Story-übergreifend**: US3 (`App.tsx`, T013) läuft parallel zu allen Server-Aufgaben; ein zweiter Entwickler kann US3 sofort nach Setup übernehmen.

---

## Parallel Example: User Story 1

```bash
# Nach T005/T006 (orchestrator.ts) diese drei parallel:
Task: "T007 chatWorkService Working-Übergang erweitern"      # packages/server/src/services/chatWorkService.ts
Task: "T008 mergeQueueService.setStage Stage-Konsistenz"     # packages/server/src/services/mergeQueueService.ts
Task: "T009 Read-Time-Reconcile in GET /api/attention + getState"  # packages/server/src/api/server.ts
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational (Reconciler-Kern grün).
2. Phase 3 US1 → **STOP & VALIDATE**: Meldungen verschwinden zur Laufzeit auf beliebigem Weg (quickstart Szenarien 1–3). Das behebt den Kern des gemeldeten Problems.

### Incremental Delivery

1. Setup + Foundational → Fundament steht.
2. US1 (MVP) → testen → demo.
3. US2 (Neustart-Robustheit) → testen → demo.
4. US3 (Badge = Liste) → testen (parallel möglich) → demo.
5. US4 (manuelles Erledigen abgesichert) → testen.
6. Polish (Typecheck/Lint, Quickstart).

---

## Notes

- [P] = andere Datei, keine offene Abhängigkeit.
- `orchestrator.ts` wird von T005, T006 (US1) und T011 (US2) berührt → nicht parallel, in dieser Reihenfolge.
- Keine Schema-Migration, keine neue Persistenz (data-model.md).
- Reconciler nur auflösend — legt nie Meldungen an (Contract C1); `attention_raised` bleibt den bestehenden Auslösern vorbehalten.
- Commit nach jeder Aufgabe oder logischer Gruppe.
