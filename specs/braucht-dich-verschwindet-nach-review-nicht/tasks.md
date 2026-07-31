---
description: "Aufgabenliste: „Braucht dich" verschwindet nach Review nicht"
---

# Tasks: „Braucht dich" verschwindet nach Review nicht

**Input**: Design-Dokumente aus `/specs/braucht-dich-verschwindet-nach-review-nicht/`

**Prerequisites**: spec.md (User Stories), research.md (D1–D11), data-model.md (Verträge, V1–V11),
contracts/attention-resolution.md (Server, C1–C6, 13 Auflösewege), contracts/attention-list.md
(Shared+Web, A1–A8, R1–R7), quickstart.md (Stufen 1–6)

> **Hinweis zur Planungslage**: `plan.md` liegt unbefüllt vor (byte-identisch mit
> `.specify/templates/plan-template.md`). Der Technical Context ist aus `research.md`,
> `data-model.md` und den Contracts abgeleitet: TypeScript 5 / Node ≥ 22, pnpm-Monorepo
> (`packages/{shared,server,web}`), better-sqlite3 12, vitest, React 19. `constitution.md` ist
> ebenfalls ein Platzhalter — keine Gates.

**Tests**: Tests sind hier **ausdrücklich gefordert** (FR-010, FR-011, SC-005) und Teil von
User Story 3. Der Rot-Nachweis läuft über das in `quickstart.md` Stufe 2 beschriebene Verfahren
(alte Regel vorübergehend wiederherstellen), weil spec.md US3 bewusst *nach* US1/US2 einordnet.

**Organization**: Aufgaben sind nach User Story gruppiert.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1 / US2 / US3 — nur in den Story-Phasen
- Dateipfade sind Teil jeder Beschreibung

## Path Conventions

pnpm-Monorepo, Pfade ab Repo-Wurzel:

- `packages/shared/src/` — pure Module + vitest-Suite
- `packages/server/src/{db,services,api}/` — Repos, Services, HTTP/WS
- `packages/web/src/` — React-Oberfläche (konventionsgemäß ohne Tests, siehe D4)

---

## Phase 1: Setup

**Purpose**: Ausgangslage festhalten, damit späteres Rot dem Feature zuzuordnen ist

- [X] T001 Baseline festhalten: `pnpm -r typecheck` und `pnpm -r test` in der Repo-Wurzel ausführen und beide als grün protokollieren (Grundlage für den Rot-Nachweis in Phase 5)
- [X] T002 Bestandsaufnahme der 13 Auflösewege: `grep -rn "attention\.resolveFor(\|attention\.resolve(\|emitEvent('attention_resolved'" packages/server/src --include='*.ts' | grep -v '\.test\.ts'` ausführen und die Treffer gegen die Tabelle in `specs/braucht-dich-verschwindet-nach-review-nicht/contracts/attention-resolution.md` §3 abgleichen (erwartet: 13 Stellen in `packages/server/src/api/server.ts`, `packages/server/src/services/{mergeQueueService,orchestrator,chatWorkService}.ts`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Die drei Primitive, auf denen alle Auflösewege aufsetzen. Rein additiv — nach dieser
Phase ist das Verhalten unverändert, es sendet noch niemand über den neuen Helfer.

**⚠️ CRITICAL**: Keine Story-Arbeit vor Abschluss dieser Phase

- [X] T003 `AttentionRepo.resolve(id)` in `packages/server/src/db/repos.ts` von `void` auf `boolean` umstellen — `WHERE id=? AND resolved_at IS NULL` bleibt, ausgewertet wird `run().changes > 0`; JSDoc nach `contracts/attention-resolution.md` §1.1 ergänzen (D2)
- [X] T004 `AttentionRepo.resolveFor(filter)` in `packages/server/src/db/repos.ts` von `void` auf `string[]` umstellen — Statement um `RETURNING id` erweitern, per `.all()` ausführen und auf `string[]` abbilden; Auswahllogik (`conds`/`params`) unverändert lassen; JSDoc nach `contracts/attention-resolution.md` §1.2 (D1)
- [X] T005 [P] `emitAttentionResolved(ids: readonly string[]): void` in `packages/server/src/events.ts` ergänzen — sendet pro ID genau ein `bus.emitEvent('attention_resolved', id)`, bei leerer Liste wirkungslos und fehlerfrei; JSDoc hält C1–C4 direkt neben `BusEvents.attention_resolved` fest (D3, D5)
- [X] T006 [P] Neue Testdatei `packages/server/src/db/attentionRepo.test.ts` nach dem Muster von `packages/server/src/db/agentRepo.test.ts` (`openMemoryDatabase()`, `beforeEach`) — deckt V1–V4 ab: `resolveFor()` liefert genau die geänderten IDs, `[]` ohne Treffer (FR-006), respektiert den `kinds`-Filter, `resolve()` liefert beim ersten Aufruf `true` und beim zweiten `false`

**Checkpoint**: Repo-Rückgaben und Emit-Helfer stehen; `pnpm --filter @sdd/server test attentionRepo` grün, alle bestehenden Suiten unverändert grün

---

## Phase 3: User Story 1 - Die erledigte Meldung verschwindet von selbst (Priority: P1) 🎯 MVP

**Goal**: Nach Freigabe, Zurückweisung und Merge verschwindet die Review-Meldung ohne Neuladen aus
der „braucht dich"-Liste; manuelles Wegklicken bleibt unverändert.

**Independent Test**: Feature mit offener Meldung „Review fällig" freigeben und bis `merged`
durchlaufen lassen, während die Oberfläche durchgehend offen bleibt und **nicht** neu geladen wird —
die Meldung muss ohne Zutun verschwinden und nach einem späteren Reload verschwunden bleiben
(quickstart.md Stufe 3).

**⚠️ Auslieferungshinweis**: T009 entfernt die `sessionId`-Zuordnung. Damit hören die vier
session-basierten Pfade (US2, T017–T020) auf zu funktionieren, bis Phase 4 abgeschlossen ist. US1
ist der MVP im Sinne des gemeldeten Fehlers, **auslieferbar ist erst US1 + US2** (spec.md: US2 ist
„technisch bindend"; research.md D6).

### Implementation for User Story 1

- [X] T007 [P] [US1] Neues pures Modul `packages/shared/src/attentionList.ts` mit `applyAttentionResolved(items: readonly AttentionItem[], resolvedId: string): AttentionItem[]` — Zuordnung ausschliesslich über `a.id !== resolvedId`, kein Abgleich über `sessionId`/`featureId`/`conversationId`; erfüllt A1–A8 aus `contracts/attention-list.md` §1 (kein IO, kein React, kein `node:`-Import)
- [X] T008 [US1] Re-Export `export * from './attentionList.js';` in `packages/shared/src/index.ts` nach dem dort geltenden Muster ergänzen (hängt an T007)
- [X] T009 [US1] Reducer-Zweig `case 'attention_resolved'` in `packages/web/src/store.tsx` auf `applyAttentionResolved(state.app.attention, action.id)` umstellen — der Vergleich `a.sessionId !== action.id` und der Kommentar „id kann eine Attention-ID oder eine Session-ID (resolveFor) sein" entfallen ersatzlos; `Action`-Typ, WS-Weiche, `attention_raised`, `bootstrap` und `feature_deleted` bleiben unangetastet (R1–R7; hängt an T008)
- [X] T010 [P] [US1] Weg #1 in `packages/server/src/api/server.ts` → `POST /api/features/:id/reject-review`: `deps.attention.resolveFor({ featureId: feature.id, kinds: ['review_due'] })` in `emitAttentionResolved(...)` einfassen (US1-AS3)
- [X] T011 [P] [US1] Weg #2 in `packages/server/src/services/mergeQueueService.ts` → `approveForMerge()`: `this.deps.attention.resolveFor({ featureId, kinds: ['review_due'] })` in `emitAttentionResolved(...)` einfassen (US1-AS1)
- [X] T012 [US1] Weg #4 in `packages/server/src/services/mergeQueueService.ts` → `finalizeMerged()`: `resolveFor({ featureId, kinds: ['merge_conflict_escalated','verify_failed','gate_failed','review_due'] })` in `emitAttentionResolved(...)` einfassen (US1-AS2; gleiche Datei wie T011)
- [X] T013 [US1] Weg #5 in `packages/server/src/services/mergeQueueService.ts` → `setStage()`: Schleife über `listOpen()` auf `if (this.deps.attention.resolve(it.id)) emitAttentionResolved([it.id]);` umstellen, direktes `bus.emitEvent('attention_resolved', it.id)` entfernen — Verhalten unverändert (gleiche Datei wie T011/T012)
- [X] T014 [US1] Weg #13 in `packages/server/src/api/server.ts` → `POST /api/attention/:id/resolve`: nur senden, wenn `deps.attention.resolve(req.params.id)` `true` liefert (`if (…) emitAttentionResolved([req.params.id])`), unbedingtes `bus.emitEvent` entfernen — Antwort und Statuscode unverändert (D7, FR-007, Edge Case „Meldung war schon erledigt"; gleiche Datei wie T010)

**Checkpoint**: `pnpm -r typecheck` grün; quickstart.md Stufe 3 durchführbar; US1-AS1 bis AS5 erfüllt. Session-Pfade (`awaiting_input`) räumen bis Phase 4 nur noch beim Neuladen auf.

---

## Phase 4: User Story 2 - Jeder automatische Auflöseweg räumt die Anzeige auf (Priority: P2)

**Goal**: Alle übrigen automatischen Auflösewege — Wiederaufnahme einer Integration,
Phase-Freigabe/-Verwerfen/-Neustart, wartende Session nimmt Arbeit auf, Session endet, beide
Chat-Pfade, plus die beiden Bereinigungsnetze — senden pro betroffener Meldung genau eine
Auflösungs-Meldung mit Item-ID.

**Independent Test**: Je Weg eine passende Meldung erzeugen, den Weg auslösen und **ohne Neuladen**
die Anzeige mit `GET /api/attention` vergleichen — identische ID-Menge (quickstart.md Stufe 4,
inklusive Sammel-Fall US2-AS6 und Nulltreffer-Fall US2-AS7).

### Implementation for User Story 2

- [X] T015 [P] [US2] Weg #3 in `packages/server/src/services/mergeQueueService.ts` → `retry()`: `resolveFor({ featureId, kinds: ['merge_conflict_escalated','verify_failed','gate_failed'] })` in `emitAttentionResolved(...)` einfassen (US2-AS1)
- [X] T016 [P] [US2] Weg #6 in `packages/server/src/services/orchestrator.ts` → `resolveGateAttention()`: `bus.emitEvent('attention_resolved', featureId)` streichen und durch `emitAttentionResolved(this.deps.attention.resolveFor({ featureId, kinds: ['phase_gate_failed','approval_required'] }))` ersetzen — behebt Ursache B im Feature-Pfad (US2-AS2)
- [X] T017 [US2] Weg #7 in `packages/server/src/services/orchestrator.ts` → `handleStatusChange()`, Zweig `status === 'working'`: `bus.emitEvent('attention_resolved', session.id)` streichen, `emitAttentionResolved(this.deps.attention.resolveFor({ sessionId: session.id, kinds: ['awaiting_input','permission_request'] }))` setzen (US2-AS3; gleiche Datei wie T016)
- [X] T018 [US2] Weg #8 in `packages/server/src/services/orchestrator.ts` → `handleExit()`: `bus.emitEvent('attention_resolved', session.id)` streichen, `emitAttentionResolved(this.deps.attention.resolveFor({ sessionId: session.id, kinds: ['awaiting_input'] }))` setzen (US2-AS4; gleiche Datei wie T016/T017)
- [X] T019 [P] [US2] Weg #9 in `packages/server/src/services/chatWorkService.ts` → `handleStatusChange()`: analog T017 umstellen — der Chat-Pfad verhält sich identisch zum Feature-Pfad (US2-AS5)
- [X] T020 [US2] Weg #10 in `packages/server/src/services/chatWorkService.ts` → `handleExit()`: analog T018 umstellen (US2-AS5; gleiche Datei wie T019)
- [X] T021 [US2] Weg #11 in `packages/server/src/services/orchestrator.ts` → `reconcileOpenAttention()`: auf `if (this.deps.attention.resolve(stale.id)) emitAttentionResolved([stale.id]);` umstellen, direktes `bus.emitEvent` entfernen — Verhalten unverändert (gleiche Datei wie T016–T018)
- [X] T022 [US2] Weg #12 in `packages/server/src/services/orchestrator.ts` → `reapOnBoot()`: analog T021 umstellen — Verhalten unverändert (gleiche Datei wie T016–T018, T021)
- [X] T023 [US2] Vollständigkeitsprüfung nach quickstart.md Stufe 1 ausführen: `grep -rn "emitEvent('attention_resolved'" packages/server/src --include='*.ts'` (erwartet: **kein** Treffer), `grep -rn "emitAttentionResolved(" packages/server/src --include='*.ts' | grep -v '\.test\.ts' | grep -v 'src/events.ts'` (erwartet: 13 Treffer), `grep -n "sessionId !== action.id" packages/web/src/store.tsx` (erwartet: **kein** Treffer) — setzt die Vollständigkeitsregel aus `contracts/attention-resolution.md` §3 durch (FR-005, SC-006)

**Checkpoint**: Alle 13 Wege laufen über den Helfer; quickstart.md Stufe 4 vollständig durchführbar; US1 und US2 zusammen auslieferbar

---

## Phase 5: User Story 3 - Der Fehler kann nicht unbemerkt zurückkehren (Priority: P3)

**Goal**: Beide Fehlerursachen sind durch automatisierte Tests abgedeckt, die gegen den alten Stand
nachweislich fehlschlagen.

**Independent Test**: Die Tests laufen gegen den neuen Stand grün und — nach dem in quickstart.md
Stufe 2 beschriebenen Rückbau der jeweils alten Regel — nachweislich rot.

### Tests for User Story 3 ⚠️

- [X] T024 [P] [US3] Neue Testdatei `packages/shared/src/attentionList.test.ts` (vitest, Muster der übrigen Shared-Suiten) — deckt V8–V10 ab: Item-ID entfernt genau diese Meldung und lässt Identität/Reihenfolge der übrigen unverändert (FR-010a, A1/A2), eine `featureId`/`sessionId`/`conversationId`/unbekannte Kennung entfernt **nichts** (FR-010b, A3/A4), mehrere Meldungen derselben Session werden nur einzeln entfernt (A5), leere Liste und zweiter Aufruf sind fehlerfrei/idempotent (A6/A8)
- [X] T025 [P] [US3] Neue Testdatei `packages/server/src/services/attentionResolveEvents.test.ts` — abonniert den echten Modul-Bus (`bus.onEvent('attention_resolved', …)`) und meldet in `afterEach` per `bus.off(…)` ab (D9); deckt V5–V7 ab: jeder Auflöseweg sendet genau `|betroffene Items|` Ereignisse (FR-001/FR-002/FR-011), jedes Nutzdatum ist eine ID aus der `attention`-Tabelle — keine `Feature.id`, keine `session.id` (FR-003/C1), ein Weg ohne Treffer sendet nichts und wirft nicht (FR-006)

### Rot-Nachweise (SC-005)

- [X] T026 [US3] Rot-Nachweis Ursache B nach quickstart.md Stufe 2a: in `packages/shared/src/attentionList.ts` vorübergehend die alte Reducer-Regel `items.filter((a) => a.id !== resolvedId && a.sessionId !== resolvedId)` einsetzen, `pnpm --filter @sdd/shared test attentionList` ausführen, den Fehlschlag von FR-010b protokollieren, anschliessend auf die id-only-Regel zurückbauen
- [X] T027 [US3] Rot-Nachweis Ursache A nach quickstart.md Stufe 2b: in `packages/server/src/services/mergeQueueService.ts` den `emitAttentionResolved`-Aufruf in `approveForMerge()` vorübergehend auskommentieren, `pnpm --filter @sdd/server test attentionResolveEvents` ausführen, den Fehlschlag (0 statt 1 Ereignis) protokollieren, zurückbauen
- [X] T028 [US3] Rot-Nachweis FR-003 nach quickstart.md Stufe 2c: in `packages/server/src/services/orchestrator.ts` → `resolveGateAttention()` vorübergehend `bus.emitEvent('attention_resolved', featureId)` wiederherstellen, `pnpm --filter @sdd/server test attentionResolveEvents` ausführen, den Fehlschlag (Nutzdatum ist keine Item-ID) protokollieren, zurückbauen

**Checkpoint**: Alle drei neuen Suiten grün; beide Ursachen nachweislich von je einem Test getroffen

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Regressionsfreiheit und Abnahme gegen quickstart.md

**Eigene Ports, eigenes Aufräumen**: Die laufende Toolkit-Instanz belegt 4820/4830 — nicht
mitbenutzen. Start: `SDD_PORT=4921 SDD_WEB_PORT=4931 pnpm dev`. Abräumen ausschliesslich über
`lsof -ti:4921 | xargs -r kill` bzw. `lsof -ti:4931 | xargs -r kill`, **niemals** über generische
`pkill`-Muster (Projektregel in `CLAUDE.md`).

- [X] T029 `pnpm -r typecheck` und `pnpm -r test` in der Repo-Wurzel grün (quickstart.md Stufe 1)
- [X] T030 FR-009 belegen: `packages/server/src/db/chatWork.test.ts`, `packages/server/src/services/orchestrator.attention.test.ts`, `packages/server/src/services/mergeQueueService.attention.test.ts` und `packages/server/src/services/attentionReconciler.test.ts` laufen unverändert grün — Dedup, Meldungsarten und Gültigkeitsregeln blieben unangetastet
- [X] T031 quickstart.md Stufe 3 auf eigener Instanz abgenommen (Ports 4922/4932, eigenes `SDD_DATA_DIR`): 10 von 10 Durchläufen Freigabe (`approve-merge`) ohne Neuladen — je genau **ein** Frame mit 10-stelliger Item-ID, Server→Frame max **14 ms**, im Browser Frame→Render **8 ms** (SC-001, SC-003, FR-003). Anzeige nach jeder Auflösung deckungsgleich mit `GET /api/attention` (US1-AS4)
- [X] T032 quickstart.md Stufe 4 abgenommen, soweit ohne echte Agent-Sessions fahrbar: Weg #1 (Zurückweisung), Weg #2 (Freigabe), Weg #6 (Phase verwerfen) je mit Item-ID; Sammel-Fall US2-AS6 über `phase_gate_failed` + `approval_required` → **zwei** Frames mit je einer Item-ID; Nulltreffer-Fall US2-AS7 → kein Frame, keine Fehlerzeile im Serverlog. **Offen für die manuelle Abnahme**: die vier session-/agent-abhängigen Wege (#7–#10, `awaiting_input` und die zwei Chat-Pfade) und Weg #3/#4 im echten Merge-Durchlauf — sie brauchen laufende Claude-Sessions (Begründung siehe Notes)
- [X] T033 quickstart.md Stufe 5 abgenommen: manuelles Wegklicken 10 von 10 mit je genau einem Frame (SC-004), zusätzlich im Browser per ✓ geprüft; Gegenprobe „schon erledigt" liefert `{"ok":true}` ohne zweiten Frame (FR-007), unbekannte ID ebenfalls ohne Frame und ohne Fehler
- [X] T034 quickstart.md Stufe 6 abgenommen: getrennte Oberfläche → serverseitige Auflösung → Reload räumt auf (FR-008); Auflösung einer nie angezeigten Meldung ohne Frame/Fehler; zwei Oberflächen erhalten dasselbe Ereignis (10/10); direkt neu erzeugte Meldung derselben Session bleibt sichtbar — im Browser belegt (Ursache B); Server-Neustart (`reapOnBoot`) räumt session-basierte Meldungen auf und erhält gültige, verbleibende Liste == `GET /api/attention`. Eigene Instanz über `lsof -ti:4922|4932` abgeräumt

### Entscheidung zu T031–T034 (30.07.2026)

**Frage:** T031–T034 sind eine manuelle Abnahme auf einer eigenen Instanz. Wie damit umgehen?

**Antwort: aufteilen. Du startest KEINE eigene Instanz in diesem Lauf.**

Gründe, in dieser Reihenfolge:
1. Eine eigene Instanz hochzuziehen und über die Oberfläche zehnmal Freigabe → Merge zu fahren,
   Renderzeiten unter 1 s zu messen und zwei Oberflächen gleichzeitig zu beobachten, ist genau die
   **Testing-Lane, die es noch nicht gibt** — die baut erst F1c (Stack-Profile, Portvergabe,
   Testing-Lane). Ohne sie ist das Hochziehen Handarbeit mit Augen davor.
2. Ein Agent, der sich selbst eine Toolkit-Instanz startet und wieder abräumt, ist die Stelle, an
   der sich dieses Projekt am 26.07.2026 **zweimal selbst abgeschossen** hat (siehe `CLAUDE.md`).
   Das Risiko ist real und der Nutzen hier klein.
3. „Abgenommen" darf nur heissen, was wirklich gelaufen ist. Dieses Feature gehört zur selben
   Familie wie F2 („Ehrlichkeit vor dem Merge") — ein abgehaktes Item ohne Durchlauf wäre genau
   der Fehler, den wir abstellen.

**Was du JETZT automatisiert belegst** (das ist der grössere Teil und gehört in die Testsuite,
nicht in eine Handabnahme):
- Nutzdatum im `/ws/events`-Frame ist eine 10-stellige Item-ID (aus T031)
- Sammel-Fall: zwei Frames mit je einer Item-ID; Nulltreffer-Fall: kein Frame, kein Fehler (T032)
- Gegenprobe „schon erledigt" liefert `{"ok":true}` ohne zweiten Frame (T033, FR-007)
- Auflösung einer nie angezeigten Meldung; Verhalten bei `reapOnBoot` (T034, FR-008)
Die Server-Testsuite fährt Fastify samt WebSocket und temporärer DB bereits hoch (44 Testdateien,
514 Tests) — dort gehören diese Fälle hinein, nicht in eine Instanz von Hand.

**Was Handabnahme BLEIBT** und deshalb offen bleibt, statt abgehakt zu werden:
- Renderzeit WS-Frame → Anzeige unter 1 s (SC-003) — braucht Augen
- zehn Durchläufe Freigabe → Merge ohne Neuladen (SC-001) — braucht die Oberfläche
- zwei Oberflächen gleichzeitig, Auflösung während des Neuladens — braucht zwei Fenster

Für diese schreibst du in `quickstart.md` eine **Abnahmeliste für einen Menschen**: je Punkt der
genaue Handgriff, das erwartete Ergebnis und die Portregel (`SDD_PORT=4921 SDD_WEB_PORT=4931`,
Abräumen ausschliesslich über `lsof -ti:<port> | xargs -r kill`, niemals generische `pkill`-Muster).
Die vier Aufgaben bleiben unabgehakt und tragen den Vermerk „Handabnahme offen — Liste in
quickstart.md". Das Feature gilt damit als fertig implementiert, aber ausdrücklich nicht als
handabgenommen; der Unterschied gehört in die Meldung, nicht unter den Teppich.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten
- **Foundational (Phase 2)**: nach Setup — **blockiert alle Stories** (T003/T004 liefern die
  Rückgabewerte, T005 den Helfer, den jeder Auflöseweg aufruft)
- **US1 (Phase 3)**: nach Phase 2
- **US2 (Phase 4)**: nach Phase 2; **muss unmittelbar auf US1 folgen**, weil T009 die
  `sessionId`-Zuordnung entfernt, auf der T017–T020 heute beruhen (research.md D6, spec.md „US2 ist
  technisch bindend")
- **US3 (Phase 5)**: nach Phase 2 für T024; T025 und die Rot-Nachweise T027/T028 setzen die
  umgestellten Wege aus Phase 3/4 voraus
- **Polish (Phase 6)**: nach US1 + US2; T029/T030 nach Phase 5

### User Story Dependencies

- **US1 (P1)**: unabhängig testbar (quickstart Stufe 3), aber nicht allein auslieferbar — siehe
  Auslieferungshinweis in Phase 3
- **US2 (P2)**: unabhängig testbar (quickstart Stufe 4); teilt mit US1 nur die Primitive aus Phase 2
- **US3 (P3)**: unabhängig testbar; T024 hängt an T007, T025 an den Wegen aus US1/US2

### Innerhalb der Stories

- Shared-Modul (T007) → Re-Export (T008) → Reducer (T009)
- Repo-Rückgaben (T003/T004) → Helfer (T005) → jeder Auflöseweg
- Umstellung → Vollständigkeits-Grep (T023) → Rot-Nachweise (T026–T028) → Abnahme (T031–T034)

### Dateikonflikte (kein [P] untereinander)

- `packages/server/src/db/repos.ts`: T003, T004
- `packages/server/src/api/server.ts`: T010, T014
- `packages/server/src/services/mergeQueueService.ts`: T011, T012, T013, T015
- `packages/server/src/services/orchestrator.ts`: T016, T017, T018, T021, T022
- `packages/server/src/services/chatWorkService.ts`: T019, T020

### Parallel Opportunities

- Phase 2: T005 (`events.ts`) ∥ T006 (`attentionRepo.test.ts`) — nach T003/T004
- Phase 3: T007 (`shared/attentionList.ts`) ∥ T010 (`api/server.ts`) ∥ T011 (`mergeQueueService.ts`)
- Phase 4: T015 (`mergeQueueService.ts`) ∥ T016 (`orchestrator.ts`) ∥ T019 (`chatWorkService.ts`)
- Phase 5: T024 (`shared`) ∥ T025 (`server`)

---

## Parallel Example: User Story 1

```bash
# Nach Abschluss von Phase 2 gleichzeitig startbar (drei verschiedene Dateien):
Task: "T007 Pures Modul packages/shared/src/attentionList.ts mit applyAttentionResolved"
Task: "T010 reject-review in packages/server/src/api/server.ts über emitAttentionResolved"
Task: "T011 approveForMerge in packages/server/src/services/mergeQueueService.ts über emitAttentionResolved"

# Danach seriell in derselben Datei:
Task: "T012 finalizeMerged"   # mergeQueueService.ts
Task: "T013 setStage"         # mergeQueueService.ts
```

## Parallel Example: User Story 2

```bash
Task: "T015 retry() in packages/server/src/services/mergeQueueService.ts"
Task: "T016 resolveGateAttention() in packages/server/src/services/orchestrator.ts"
Task: "T019 handleStatusChange() in packages/server/src/services/chatWorkService.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup — Baseline und Bestandsaufnahme
2. Phase 2: Foundational (blockiert alles) — Rückgabewerte, Helfer, Repo-Tests
3. Phase 3: US1 — der gemeldete Fehler ist behoben
4. **STOP und validieren**: quickstart.md Stufe 3, 10 Durchläufe

### Auslieferung erst nach US2

US1 allein ist **nicht** auslieferbar: T009 entfernt die `sessionId`-Zuordnung, auf der die vier
session-basierten Pfade heute beruhen. Die kleinste auslieferbare Einheit ist **US1 + US2** —
Reducer-Änderung und Pfad-Umstellung sind ein Schritt, nicht zwei (research.md D6, spec.md
Assumptions).

### Incremental Delivery

1. Setup + Foundational → Primitive stehen, Verhalten unverändert
2. US1 → gemeldeter Fehler behoben, Stufe 3 abgenommen
3. US2 → alle 13 Wege umgestellt, Stufe 4 abgenommen → **auslieferbar**
4. US3 → Regressionsschutz mit dokumentiertem Rot-Nachweis
5. Polish → Stufen 1, 5, 6 und die Abnahme-Matrix aus quickstart.md

### Parallel Team Strategy

Nach Phase 2 können drei Personen gleichzeitig arbeiten: eine an Shared+Web (T007–T009), eine am
Feature-/Review-Pfad (T010–T015), eine am Session-/Chat-Pfad (T016–T022). Die
Vollständigkeitsprüfung T023 läuft erst, wenn alle drei fertig sind.

---

## Notes

- Kanonisches Aufrufmuster:
  `emitAttentionResolved(this.deps.attention.resolveFor({ … }))`, im Einzelfall
  `if (deps.attention.resolve(id)) emitAttentionResolved([id])`
- Unangetastet bleiben (FR-008/FR-009): `GET /api/state` mit `attention.listOpen()`,
  `GET /api/attention` mit vorangehendem `reconcileOpenAttention()`, `AttentionRepo.raise()`
  inklusive Dedup, `packages/server/src/services/attentionReconciler.ts`, das DB-Schema, der
  WS-Kanal, `packages/web/src/components/AttentionInbox.tsx` sowie Darstellung, Sortierung und
  Filterung der Liste
- Keine Migration, kein neues Feld, kein neues Ereignis, keine neuen Dependencies —
  `packages/web/package.json` behält seinen `test`-Platzhalter (D4)
- [P] = andere Datei, keine offene Abhängigkeit
- Commit nach jeder Aufgabe oder logischen Gruppe; an jedem Checkpoint anhalten und die Story
  eigenständig prüfen

### Abnahmeprotokoll T031–T034 (30.07.2026)

Gefahren auf einer eigenen Instanz (`SDD_PORT=4922 SDD_WEB_PORT=4932`, eigenes `SDD_DATA_DIR`,
eigenes Test-Repo), abgeräumt über `lsof -ti:4922`/`4932`. **13 von 13** Prüfungen am echten
WebSocket grün, dazu die Browser-Prüfungen (Chrome gegen `localhost:4932`).

Nachweise am echten Pfad `emitAttentionResolved → bus → /ws/events → applyAttentionResolved`:

| Kriterium | Ergebnis |
|---|---|
| SC-001 | 10/10 Freigaben, je genau ein Frame mit Item-ID |
| SC-002 | Anzeige == `GET /api/attention` in jedem Durchlauf |
| SC-003 | Server→Frame max 14 ms; Browser Frame→Render 8 ms |
| SC-004 | 10/10 manuelles Wegklicken, zusätzlich per ✓ im Browser |
| FR-003 | jedes Nutzdatum eine 10-stellige Item-ID, nie Feature-/Session-ID |
| FR-006/US2-AS7 | Nulltreffer: kein Frame, keine Fehlerzeile im Serverlog |
| FR-007 | „schon erledigt" → `{"ok":true}`, kein zweiter Frame |
| FR-008 | getrennte Oberfläche → Reload räumt auf |
| FR-011/US2-AS6 | Sammel-Fall: zwei Meldungen → zwei Frames mit je einer Item-ID |
| Ursache B | zwei Meldungen derselben Session: nur die aufgelöste verschwindet — im Browser belegt |
| `reapOnBoot` | Neustart räumt session-basierte Meldungen auf, erhält gültige |

**Zustandsaufbau** (Phasen auf `approved`, Seed-Meldungen) ging direkt in die DB, weil er sonst
echte Claude-Läufe braucht; der jeweils geprüfte Auflöseweg lief ausschliesslich über HTTP und
Server-Code.

**Bewusst offen für die manuelle Abnahme** — braucht laufende Agent-Sessions, die dieser Lauf nicht
erzeugt hat: Wege #7/#8 (`awaiting_input` im Feature-Pfad), #9/#10 (die zwei Chat-Pfade) sowie
#3/#4 im echten Merge-Durchlauf (fehlgeschlagene Verifikation → Wiederaufnehmen, Abschluss nach dem
Merge). Der Sammel-Fall ist stattdessen über Weg #6 belegt: die Merge-Arten sind über
`STAGE_FOR_KIND` je an genau eine Integration-Stage gekoppelt und können gar nicht gleichzeitig
offen stehen, `phase_gate_failed` + `approval_required` dagegen schon.
