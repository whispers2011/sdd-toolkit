---
description: "Aufgabenliste — Plausibilitätsprüfung gemessener Läufe"
---

# Tasks: Plausibilitätsprüfung gemessener Läufe

**Input**: Design-Dokumente aus `/specs/plausibilitaetspruefung/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Tests sind hier **verlangt** — SC-002 fordert je Befund einen Erkennungstest und je
Nicht-Melde-Regel aus FR-005/007/009/011 einen eigenen Test. Die Testaufgaben sind deshalb Teil
der Abnahme, nicht optional.

**Organization**: Nach User Stories gruppiert. Reihenfolge folgt der
[Umsetzungsreihenfolge](./plan.md#umsetzungsreihenfolge-empfohlen-story-prioritäten-folgend) des Plans.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallelisierbar (andere Datei, keine Abhängigkeit auf eine unfertige Aufgabe)
- **[Story]**: zugehörige User Story (US1–US4)
- Jede Aufgabe nennt ihren exakten Dateipfad

## Path Conventions

pnpm-Monorepo (siehe [plan.md](./plan.md#source-code-repository-root)):

- `packages/shared/src/` — pure Typen und Logik, keine `node:`-Importe
- `packages/server/src/` — API, Services, DB
- `packages/web/src/` — React-SPA (konventionsgemäß ohne Tests)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ausgangslage sichern und das pure Modul anlegen. Kein neues Paket, keine neue
Dependency — das Monorepo bleibt wie es ist.

- [X] T001 Ausgangslage sichern: `pnpm -r typecheck && pnpm -r test` über die Skripte in `package.json` an der Repo-Wurzel ausführen und grün bestätigen, damit spätere Fehlschläge diesem Feature zuzuordnen sind
- [X] T002 Leeres pures Modul `packages/shared/src/plausibility.ts` anlegen (Kopfkommentar: kein IO, kein `node:`-Import) und `export * from './plausibility.js';` in `packages/shared/src/index.ts` ergänzen

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Regeln, Meldungsarten und Wasserstand — alles, was jede Story braucht, bevor sie
überhaupt eine Meldung anlegen kann.

**⚠️ CRITICAL**: Ohne T007/T008 kompiliert kein `raise()`-Aufruf der neuen Arten; ohne T009/T010
gibt es keinen Wasserstand, also keine Meldung, die eine Auflösung überlebt.

- [X] T003 [P] Konstanten und `ProjectRunStats` in `packages/shared/src/plausibility.ts`: `FALSE_START_MAX_MS = 6_000` (ausschliessend), `PROJECT_WITHOUT_RUNS_GRACE_MS = 60 * 60_000`, `METERING_CONFLICT_MIN_FACTOR = 2`, `TERMINATION_EXIT_CODES = [130, 137, 143]` — Endgültigkeitsfenster bewusst **nicht** hier (kommt als Parameter `graceMs`), siehe [contracts/plausibility-module.md](./contracts/plausibility-module.md)
- [X] T004 Fünf Prädikate in `packages/shared/src/plausibility.ts`: `isMeasurementFinal`, `isUnpricedRun` (überspringt `status === 'orphaned'`), `isPhaseFalseStart` (nur `kind === 'phase'`, `status === 'failed'`, Exitcode ∉ `TERMINATION_EXIT_CODES`, Laufzeit `< FALSE_START_MAX_MS`), `isProjectWithoutRuns`, `meteringConflictFactor` — Signaturen exakt nach [data-model.md](./data-model.md) §1
- [X] T005 `FindingAction` und `decideFinding(count, mark, hasOpenItem)` in `packages/shared/src/plausibility.ts` gemäß der Wahrheitstabelle in [contracts/plausibility-module.md](./contracts/plausibility-module.md) — `clear` bei Anzahl 0, `refresh` bei offener Meldung, `raise` nur ohne offene Meldung und bei `mark === null || count > mark`
- [X] T006 Vier Meldungstext-Builder plus `UnpricedExample`/`FalseStartExample` in `packages/shared/src/plausibility.ts`: `unpricedMessage`, `falseStartMessage`, `projectWithoutRunsMessage`, `meteringConflictMessage` — Deutsch, Zahlen über `Intl.NumberFormat('de-CH')`, Laufzeiten in Sekunden mit einer Dezimalstelle, Vorlagen in [data-model.md](./data-model.md) §3
- [X] T007 [P] `AttentionKind` in `packages/shared/src/types.ts` um `'run_unpriced' | 'phase_false_start' | 'project_without_runs' | 'metering_conflict'` erweitern (rein additiv, keine bestehende Art umbenennen)
- [X] T008 Vier `KIND_META`-Einträge in `packages/web/src/components/AttentionInbox.tsx` ergänzen (Bezeichnung, Emoji, Farbe nach [contracts/attention-kinds.md](./contracts/attention-kinds.md)) — Pflicht, weil `KIND_META` ein `Record<AttentionKind, …>` ist und `pnpm typecheck` sonst nach T007 fehlschlägt
- [X] T009 [P] Migration `CREATE TABLE plausibility_state` als neuen Eintrag am **Ende** von `MIGRATIONS` in `packages/server/src/db/database.ts`, Schema wortgleich zu [data-model.md](./data-model.md) §2 (`PRIMARY KEY (kind, project_id, feature_id)`, `project_id` mit `ON DELETE CASCADE`, `feature_id` Default `''`)
- [X] T010 `PlausibilityRepo` mit `getMark`/`setMark`/`clearMark` in neuer Datei `packages/server/src/db/plausibilityRepo.ts` anlegen (`setMark` als `INSERT … ON CONFLICT DO UPDATE`, `featureId: ''` = projektweiter Befund)
- [X] T011 [P] `FeatureRepo.hardDelete()` in `packages/server/src/db/repos.ts` um `DELETE FROM plausibility_state WHERE feature_id=?` **innerhalb** der bestehenden Transaktion ergänzen, damit ein gelöschtes Feature keine Marke hinterlässt

**Checkpoint**: `pnpm -r typecheck` grün, `pnpm --filter @sdd/shared build` grün. Ab hier kann jede
Story eine Meldung anlegen und quittieren.

---

## Phase 3: User Story 1 - Ein gerade beendeter Lauf, dessen Zahlen sich widersprechen, fällt sofort auf (Priority: P1) 🎯 MVP

**Goal**: Sobald die Messung eines abgeschlossenen Laufs endgültig ist, wird sie beurteilt: Tokens
ohne Betrag (Befund A) und Fehlstart statt Fehlschlag (Befund B) erscheinen als eigene Meldung mit
Feature, Schritt und auffälliger Zahl. Ab dem ersten Lauf wächst kein unbemerkter Widerspruch nach.

**Independent Test**: Einen Lauf mit Tokens ohne Betrag und einen Lauf mit 2,4 s Laufzeit und
Exitcode 1 abschliessen — je Fall genau eine Meldung. Danach die nahen unauffälligen Fälle
(Betrag vorhanden, kurzer Lauf mit Exitcode 0, langer Lauf mit Fehler, Abbruch, verwaist) — keine
Meldung.

### Tests für User Story 1

> Vor der Implementierung schreiben und fehlschlagen sehen. T012–T014 liegen in **derselben**
> Datei und laufen deshalb nacheinander (je eigener `describe`-Block).

- [X] T012 [US1] Tests für `isUnpricedRun` in `packages/shared/src/plausibility.test.ts`: Erkennung (Tokens > 0, `costMicros === null`, ausserhalb `graceMs`) plus die drei Nicht-Melde-Regeln aus FR-005 — Betrag vorhanden (US1-2), keine bzw. `null` Tokens (US1-3), noch innerhalb des Nachtragsfensters (US1-4) — und `status === 'orphaned'` meldet nicht ([research.md](./research.md) D8)
- [X] T013 [US1] Tests für `isPhaseFalseStart` in `packages/shared/src/plausibility.test.ts`: Erkennung (2,4 s, Exitcode 1, `status: 'failed'`) plus die Nicht-Melde-Regeln aus FR-007 — Exitcode 0 (US1-6), 40 s Laufzeit (US1-7), Laufzeit **genau** 6000 ms (Edge Case), Exitcode 130/137/143 (US1-8), `status: 'orphaned'`, `kind !== 'phase'`
- [X] T014 [US1] Tests für `unpricedMessage` und `falseStartMessage` in `packages/shared/src/plausibility.test.ts`: jeder Text nennt Anzahl und konkretes Beispiel (FR-015), `falseStartMessage` enthält das Wort „Fehlstart" und die Aussage, dass die Phase nie anlief; `unpricedMessage` nennt bei `featureName: null` die Lauf-Art statt Feature und Schritt

### Implementation für User Story 1

- [X] T015 [US1] `PlausibilityService`-Grundgerüst in neuer Datei `packages/server/src/services/plausibilityService.ts`: `PlausibilityDeps` (executions, features, projects, attention, state, optional `graceMs`), Default `TELEMETRY_GRACE_MS` aus `packages/server/src/telemetry/telemetryStore.ts` **importiert** (nicht kopiert), `check(now = Date.now())` mit vollständig umschliessendem `try/catch` und `console.warn` im Fehlerfall — die Methode wirft unter keinen Umständen (FR-003)
- [X] T016 [US1] Befund A in `check()` in `packages/server/src/services/plausibilityService.ts`: `executions.listAll()` über `isUnpricedRun` filtern, nach `projectId` gruppieren, Beispiel = Lauf mit der **grössten** Tokenzahl, `decideFinding` mit `state.getMark(...)` und offener Meldung aus `attention.listOpen()` auswerten, bei `raise` `attention.raise({ kind: 'run_unpriced', projectId, featureId: null, message: unpricedMessage(...) })` plus `bus.emitEvent('attention_raised', item)` und `state.setMark(...)`; bei `refresh` nur die Marke nachziehen, bei `clear` `state.clearMark(...)`
- [X] T017 [US1] Befund B in `check()` in `packages/server/src/services/plausibilityService.ts`: `isPhaseFalseStart` **und** `featureId` in `features.listAll()` (nur nicht archivierte — bewusste Verengung, [research.md](./research.md) D6), nach `featureId` gruppieren, Beispiel = **kürzester** Fehlstart mit min/max-Laufzeit und Exitcode, `kind: 'phase_false_start'` mit `featureId`, sonst identischer Wasserstands-Pfad wie T016
- [X] T018 [US1] Service-Tests für A und B in neuer Datei `packages/server/src/services/plausibilityService.test.ts` über `openMemoryDatabase()`: je Bezugsobjekt **genau eine** offene Meldung (SC-001), mehrere betroffene Läufe eines Features ergeben **eine** Meldung mit Anzahl (Edge Case), Meldungstext enthält Anzahl und Beispiel (FR-015), Läufe archivierter Features erzeugen keine B-Meldung, Läufe archivierter und gelöschter Features zählen bei A mit
- [X] T019 [US1] Aufhängepunkt in `packages/server/src/services/orchestrator.ts`: optionale Abhängigkeit `plausibility?: PlausibilityService` in den Deps ergänzen und `this.deps.plausibility?.check()` als **letzte** Anweisung des `last`-Zweigs von `scheduleLateReconcile()` (nach `telemetry?.forget()` und `telemetryAccum.delete()`) in eigenem `try/catch` aufrufen (FR-001, [research.md](./research.md) D3)
- [X] T020 [US1] Test FR-003/SC-006 in `packages/server/src/services/plausibilityService.test.ts`: mit `vi.useFakeTimers()` einen Phasenlauf abschliessen, einen `check()` mit `throw` einhängen, Timer bis `TELEMETRY_GRACE_MS` vorspulen — Status, `finished_at`, Exitcode und Tokenzahl des Laufs bleiben unverändert, der Abschluss geht vollständig durch

**Checkpoint**: US1 steht allein: ein Lauf mit Tokens ohne Betrag und ein Fehlstart erzeugen je
genau eine Meldung, fünf Minuten nach ihrem Ende. Der Laufabschluss verhält sich unverändert.

---

## Phase 4: User Story 2 - Der bereits vorhandene Bestand wird beurteilt, nicht nur der nächste Lauf (Priority: P2)

**Goal**: Die Prüfung läuft beim Start und danach im Minutentakt über den vorhandenen Bestand —
damit werden die 160 unbepreisten Läufe und 19 Fehlstarts sichtbar, und Befund C („Projekt mit
Features, aber nie ein Phasenlauf") fällt überhaupt erst auf, denn dort endet nie ein Lauf.

**Independent Test**: Datenlage mit vorhandenen unbepreisten Läufen, vorhandenen Fehlstarts und
einem Projekt mit Features ohne Lauf anlegen, Prüfung auslösen — je Zustand genau eine Meldung.
Ein Projekt ohne Features, ein Projekt mit mindestens einem (auch fehlgeschlagenen) Phasenlauf, ein
Projekt mit frisch angelegten Features und ein Projekt mit ausschliesslich archivierten Features
erzeugen keine.

### Tests für User Story 2

- [X] T021 [P] [US2] Tests für `isProjectWithoutRuns` und `projectWithoutRunsMessage` in `packages/shared/src/plausibility.test.ts`: Erkennung (Features vorhanden, `phaseRuns === 0`, Karenzzeit abgelaufen — US2-1) plus die Nicht-Melde-Regeln aus FR-009 — `activeFeatures === 0` (US2-3), `phaseRuns > 0` (US2-4), Karenzzeit noch offen (US2-2), `newestFeatureAt === null` (alle archiviert, US2-5); der Text nennt Projektname, Anzahl Features und Alter
- [X] T022 [P] [US2] `PlausibilityRepo.listProjectStats(): ProjectRunStats[]` in `packages/server/src/db/plausibilityRepo.ts`: **eine** Abfrage mit drei Unterabfragen nach [research.md](./research.md) D7 — Phasenläufe über `executions.project_id` und ausdrücklich **nicht** über einen Join auf `features`, kein Status-Filter
- [X] T023 [US2] Repo-Tests in neuer Datei `packages/server/src/db/plausibilityRepo.test.ts` über `openMemoryDatabase()`: Projekt ohne Features, Projekt mit ausschliesslich archivierten Features (`activeFeatures === 0`, `newestFeatureAt === null`), Projekt mit fehlgeschlagenem Phasenlauf (`phaseRuns === 1`), Projekt mit Lauf eines inzwischen gelöschten Features (zählt weiter als „es lief etwas"), Projekt mit `chat_work`-Lauf aber ohne Phasenlauf (`phaseRuns === 0`); zusätzlich `getMark`/`setMark`/`clearMark` inklusive `featureId: ''`
- [X] T024 [US2] Befund C in `check()` in `packages/server/src/services/plausibilityService.ts`: `state.listProjectStats()` über `isProjectWithoutRuns` auswerten, `kind: 'project_without_runs'` mit `featureId: null`, Anzahl für den Wasserstand = `activeFeatures`, identischer `decideFinding`-Pfad wie T016
- [X] T025 [US2] Service-Tests für C in `packages/server/src/services/plausibilityService.test.ts`: genau eine Meldung für das betroffene Projekt (US2-1) und je ein Test für die fünf Nicht-Melde-Fälle aus FR-009 auf Service-Ebene (US2-2 bis US2-5)

### Implementation für User Story 2

- [X] T026 [US2] Verdrahtung in `packages/server/src/index.ts`: `new PlausibilityRepo(db)` und `new PlausibilityService({ executions, features, projects, attention, state })` **vor** `new Orchestrator({...})` bauen und als `plausibility` in die Orchestrator-Deps geben
- [X] T027 [US2] Takt in `packages/server/src/index.ts`: erster `plausibility.check()` **nach** `orchestrator.reapOnBoot()` (verbindliche Reihenfolge, [contracts/plausibility-service.md](./contracts/plausibility-service.md)), dazu `const plausibilityInterval = setInterval(() => plausibility.check(), 60_000)` neben `workWithoutRunInterval` und `clearInterval(plausibilityInterval)` im `shutdown` (FR-002)

**Checkpoint**: US1 und US2 stehen. Ein Serverstart macht den ganzen vorhandenen Bestand sichtbar —
erwartet sind fünf Meldungen ([research.md](./research.md) D8).

---

## Phase 5: User Story 3 - Eine verworfene Nachkorrektur verschwindet nicht in der Konsole (Priority: P3)

**Goal**: Wird eine Nachkorrektur abgelehnt, weil sie die Zahl um Faktor 2 oder mehr senken würde,
entsteht eine Meldung mit bestehender Zahl, verworfener Zahl und Faktor. Die alltäglichen kleinen
Abweichungen und die Preis-Ablehnung bleiben auf der Konsole.

**Independent Test**: Für einen fertigen Lauf eine Nachkorrektur mit halbierter Zahl und eine mit
leicht kleinerer Zahl versuchen — nur die erste meldet; eine angenommene Korrektur meldet nicht.

### Tests für User Story 3

- [X] T028 [P] [US3] Tests für `meteringConflictFactor` und `meteringConflictMessage` in `packages/shared/src/plausibility.test.ts`: Faktor ≥ 2 (US3-1) und < 2 (US3-2), `rejectedTokens === 0` läuft über `Math.max(…, 1)` statt in eine Division durch 0, der Text nennt Lauf-ID, beide Zahlen und den Faktor (FR-010)
- [X] T029 [P] [US3] Tests in `packages/server/src/db/executionRepo.test.ts`: die Ablehnung „Nachtrag würde die Messung senken" liefert `rejection: 'lowered'`, `existingTokens`, `rejectedTokens` und `factor`; die Ablehnung „Nachtrag würde den Preis löschen" liefert `rejection: 'price_loss'`; das `reason`-Feld ist in beiden Fällen **wortgleich** wie bisher (FR-018)

### Implementation für User Story 3

- [X] T030 [US3] `TelemetryUpdateOutcome` in `packages/server/src/db/repos.ts` um `rejection: 'lowered' | 'price_loss'`, `existingTokens`, `rejectedTokens` und `factor` im `applied: false`-Zweig erweitern und in `ExecutionRepo.updateTelemetry()` an **beiden** Ablehnungsstellen füllen — `reason` bleibt unverändert, die Ablehnungsregel selbst wird nicht angetastet (Out of Scope)
- [X] T031 [US3] `reportMeteringConflict(run, outcome)` in `packages/server/src/services/plausibilityService.ts`: meldet nur bei `rejection === 'lowered' && factor >= METERING_CONFLICT_MIN_FACTOR`, `kind: 'metering_conflict'` mit `featureId` des Laufs, Text über `meteringConflictMessage`, `bus.emitEvent('attention_raised', …)`, **kein** Wasserstand ([research.md](./research.md) D10), vollständig in `try/catch` — wirft nie
- [X] T032 [US3] Aufrufe in `packages/server/src/services/orchestrator.ts`: `this.deps.plausibility?.reportMeteringConflict(...)` an **beiden** Ablehnungsstellen ergänzen — im `last`-Zweig von `scheduleLateReconcile()` und in `reconcileTranscriptTail()` — jeweils **nach** dem bestehenden `console.warn`, das wortgleich stehen bleibt (FR-018)
- [X] T033 [US3] Service-Tests in `packages/server/src/services/plausibilityService.test.ts`: Faktor ≥ 2 mit `rejection: 'lowered'` erzeugt genau eine Meldung (US3-1); Faktor < 2 (US3-2), `rejection: 'price_loss'` (US3-3) und ein angenommener Nachtrag (US3-4) erzeugen keine; ein zweiter Widerspruch desselben Features legt bei offener Meldung keine zweite an (FR-013)

**Checkpoint**: Alle vier Befunde erzeugen Meldungen; alle drei Stories sind einzeln nachweisbar.

---

## Phase 6: User Story 4 - Die Meldungen bleiben handhabbar (Priority: P4)

**Goal**: Wer eine Meldung auflöst, sieht sie nicht im nächsten Prüfintervall wieder — erst wenn
ein weiterer betroffener Lauf hinzukommt. Ein wieder arbeitender Agent und ein Neustart lassen die
Meldungen unberührt, und die vier Befunde sind in der Inbox als eigene Arten einzeln auflösbar.

**Independent Test**: Prüfung zehnmal über einen unveränderten Bestand laufen lassen und die Anzahl
offener Meldungen mit der nach dem ersten Lauf vergleichen; danach eine Meldung auflösen und erneut
prüfen.

### Tests für User Story 4

- [X] T034 [P] [US4] Wahrheitstabelle von `decideFinding` in `packages/shared/src/plausibility.test.ts`: alle **neun** Zeilen aus [contracts/plausibility-module.md](./contracts/plausibility-module.md) als je eigener Testfall — insbesondere `(5, 3, true) → refresh` (FR-014: Quittierung erfasst den Stand bei Auflösung), `(3, 3, false) → suppress` (SC-005) und `(4, 3, false) → raise` (Wiederkehr bei Wachstum)
- [X] T035 [P] [US4] Vier `case`-Zweige mit `return true` in `isAttentionValid()` in `packages/server/src/services/attentionReconciler.ts` ergänzen, mit Kommentar nach [contracts/attention-kinds.md](./contracts/attention-kinds.md): Datenbefunde bestehen unabhängig von laufender Arbeit (FR-016) und überleben den Neustart (FR-017); **kein** Eintrag in `STAGE_FOR_KIND`
- [X] T036 [US4] Tests in `packages/server/src/services/attentionReconciler.test.ts`: eine offene `phase_false_start`-Meldung bleibt gültig, während eine Session desselben Features wieder arbeitet (US4-4, FR-016); `findStaleOnBoot()` liefert keine der vier neuen Arten (US4-5, FR-017)
- [X] T037 [US4] Wasserstands-Tests in `packages/server/src/services/plausibilityService.test.ts`: zehn `check()`-Aufrufe über unverändertem Bestand ergeben dieselbe Anzahl offener Meldungen wie der erste (US4-1, SC-004); aufgelöste Meldung + unveränderter Bestand ⇒ keine neue (US4-2, SC-005); aufgelöste Meldung + ein weiterer betroffener Lauf ⇒ genau eine neue (US4-3, SC-005); Befund verschwindet ganz ⇒ Marke gelöscht, ein späterer Einzelfall meldet wieder

### Implementation für User Story 4

- [X] T038 [US4] Darstellung in der Inbox gegen die Probe-Instanz prüfen (`packages/web/src/components/AttentionInbox.tsx`, [quickstart.md](./quickstart.md) Stufe 4.1): die vier Arten tragen eigene Bezeichnung und eigenes Icon, jede Zeile hat einen ✓-Knopf zum einzelnen Auflösen (FR-012, US4-6); projektbezogene Meldungen (A, C) zeigen korrekt keinen Aktionsknopf, featurebezogene (B, D) den vorhandenen „Zur Konsole →"-Knopf

**Checkpoint**: Alle vier User Stories funktionieren einzeln; die Inbox wächst nicht zu.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Vollständige Verifikation gegen den echten Bestand. Ports und Prozesse nach der Regel
aus `CLAUDE.md`: eigene Ports, Abbau nur über eigenen Port oder gemerkte PID, **kein** `pkill -f`
mit unspezifischem Muster.

- [X] T039 `pnpm -r typecheck && pnpm -r test` über die Skripte in `package.json` an der Repo-Wurzel grün ([quickstart.md](./quickstart.md) Stufe 1) — die Typprüfung ist Teil der Abnahme, weil `KIND_META` die vier neuen Arten erzwingt
- [X] T040 [quickstart.md](./quickstart.md) Stufe 3 gegen eine **Kopie** der Produktivdatenbank auf Port 4899 ausführen: erwartet fünf Meldungen (2× `run_unpriced`, 2× `phase_false_start`, 1× `project_without_runs`), Gegenprobe-SQL bestätigt die Abgrenzung (`A_gesamt 171`, `A_orphaned 11`, `B_signatur 33`, `B_lange_fehlschlaege 12`); Probe-Instanz ausschliesslich über `lsof -ti:4899 | xargs kill` bzw. die gemerkte PID beenden und das Probe-Verzeichnis entfernen
- [ ] T041 [quickstart.md](./quickstart.md) Stufe 4.2–4.5 am Probe-Bestand nachweisen: kein Nachwachsen über zehn Intervalle, aufgelöste Meldung bleibt weg, Wiederkehr nach einem eingefügten betroffenen Lauf, offene Meldungen überleben den Neustart der Probe-Instanz
- [ ] T042 [quickstart.md](./quickstart.md) Stufe 5 nachweisen: Laufabschluss unverändert (5.1), Prüfsumme über `executions` vor/nach mehreren Prüfdurchläufen identisch (5.3, SC-007), `[metering] …: Nachtrag verworfen — …` steht wortgleich im Protokoll (5.4, FR-018)
- [ ] T043 Abnahme-Checkliste in [quickstart.md](./quickstart.md) abhaken und die drei bewussten Festlegungen aus [plan.md](./plan.md#bewusste-festlegungen-zur-kenntnis) (160 statt 171, archivierte Features bei Befund B, Exitcode-Regel) im Ergebnis festhalten, damit die Abweichung von den Zahlen in SC-003 dokumentiert bleibt

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeit — startet sofort
- **Foundational (Phase 2)**: nach Setup — **blockiert alle** User Stories (ohne `AttentionKind`
  und `KIND_META` kompiliert kein `raise()`, ohne `plausibility_state` gibt es keinen Wasserstand)
- **US1 (Phase 3)**: nach Foundational
- **US2 (Phase 4)**: nach US1 — T024 erweitert `check()`, T016/T017 müssen stehen
- **US3 (Phase 5)**: nach T015 (Service-Datei existiert); unabhängig von US2
- **US4 (Phase 6)**: nach US1; T037 braucht zusätzlich US2 (Befund C im Bestand)
- **Polish (Phase 7)**: nach allen gewünschten Stories

### User Story Dependencies

- **US1 (P1)**: unabhängig, nur Foundational — der MVP
- **US2 (P2)**: **hängt an US1**. Das ist gewollt: Laufabschluss und Bestandsprüfung rufen
  denselben `check()` ([research.md](./research.md) D1), damit „zehn Prüfungen ⇒ eine Meldung"
  strukturell gilt statt von zwei Pfaden eingehalten werden zu müssen. Der eigenständige Anteil
  von US2 (Befund C, Start und Takt) ist trotzdem einzeln testbar.
- **US3 (P3)**: hängt nur am Service-Grundgerüst (T015), nicht an `check()` — parallel zu US2
  umsetzbar
- **US4 (P4)**: hängt an US1; T036/T038 sind vollständig unabhängig und jederzeit machbar

### Innerhalb einer Story

- Tests vor Implementierung schreiben und fehlschlagen sehen
- Pure Prädikate vor Service, Service vor Verdrahtung
- `packages/shared/src/plausibility.test.ts` wird von **allen vier** Stories berührt (je eigener
  `describe`-Block) — diese Aufgaben nie gleichzeitig bearbeiten
- Ebenso `packages/server/src/services/plausibilityService.test.ts` (T018, T020, T025, T033, T037)
  und `packages/server/src/services/plausibilityService.ts` (T015–T017, T024, T031)

### Parallel Opportunities

Das Feature konzentriert sich auf wenige Dateien — echte Parallelität ist begrenzt und wird hier
nicht schöngerechnet:

- **Phase 2**: T003, T007, T009 und T011 liegen in vier verschiedenen Dateien und laufen parallel.
  T004–T006 folgen T003 (gleiche Datei), T008 folgt T007 (Typprüfung), T010 folgt T009 (Tabelle).
- **Phase 4**: T021 (shared-Test) und T022 (Repo) parallel; T023 folgt T022.
- **Phase 5**: T028 (shared-Test) und T029 (Repo-Test) parallel — verschiedene Pakete.
- **Phase 6**: T034 (shared-Test) und T035 (Reconciler) parallel.
- **Story-übergreifend**: US3 (Phase 5) läuft neben US2 (Phase 4), sobald T015 steht.

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Vier Dateien, keine gegenseitige Abhängigkeit:
Task: "T003 Konstanten und ProjectRunStats in packages/shared/src/plausibility.ts"
Task: "T007 AttentionKind erweitern in packages/shared/src/types.ts"
Task: "T009 Migration plausibility_state in packages/server/src/db/database.ts"
Task: "T011 hardDelete räumt Marken mit ab in packages/server/src/db/repos.ts"
```

## Parallel Example: US2 und US3 gleichzeitig

```bash
# Nach T015 (Service-Grundgerüst) — verschiedene Dateien, verschiedene Befunde:
Task: "T022 listProjectStats in packages/server/src/db/plausibilityRepo.ts"     # US2
Task: "T029 Ablehnungsdaten-Tests in packages/server/src/db/executionRepo.test.ts"  # US3
```

---

## Implementation Strategy

### MVP First (nur User Story 1)

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T011) — blockiert alles
3. Phase 3: US1 (T012–T020)
4. **STOP und validieren**: ein Lauf mit Tokens ohne Betrag und ein Fehlstart erzeugen je genau
   eine Meldung, fünf Minuten nach ihrem Ende; der Laufabschluss verhält sich unverändert
5. Wert des MVP: die beiden **wachsenden** Bestände (unbepreiste Läufe, Fehlstarts) wachsen ab
   jetzt nicht mehr unbemerkt weiter — auch wenn der Altbestand noch unsichtbar ist

### Incremental Delivery

1. Setup + Foundational → Fundament steht, `pnpm -r typecheck` grün
2. US1 → MVP: die Quelle ist geschlossen
3. US2 → der Altbestand wird sichtbar: fünf Meldungen beim ersten Start (das ist der Moment, in
   dem SC-003 erfüllt ist)
4. US3 → verworfene Nachkorrekturen verschwinden nicht mehr in der Konsole
5. US4 → die Inbox bleibt dauerhaft handhabbar; ohne diesen Schritt ist das Feature nach kurzer
   Zeit **schädlich** (US4-Begründung), also nicht ohne US4 ausliefern
6. Phase 7 → Verifikation am echten Bestand

### Parallel Team Strategy

Mit mehreren Entwicklern:

1. Foundational gemeinsam (vier parallele Dateien, siehe Beispiel oben)
2. Danach: Entwickler A auf US1 → anschliessend US2; Entwickler B auf US3, sobald T015 steht;
   Entwickler C auf T035/T036 (Reconciler) und T038 (Inbox), die von Anfang an unabhängig sind

---

## Notes

- `[P]` = andere Datei, keine Abhängigkeit auf eine unfertige Aufgabe
- Zwei Dateien werden von mehreren Stories berührt (`plausibility.test.ts`,
  `plausibilityService.test.ts`) — dort nie parallel arbeiten
- **Nur beurteilen, nie eingreifen**: kein `UPDATE`/`INSERT` auf `executions`, `features`,
  `projects`. Geschrieben wird ausschliesslich in `attention` und `plausibility_state` (SC-007)
- Die bestehenden `console.warn`-Ausgaben bleiben **wortgleich** — eine Meldung ersetzt kein
  Protokoll (FR-018)
- `checkWorkWithoutRun` und die Ablehnungsregel von `updateTelemetry` werden nicht angetastet
  (Out of Scope)
- Prozess-Regel aus `CLAUDE.md`: Probe-Instanzen auf eigenen Ports (4899, nicht 4820/4830),
  Abbau nur über eigenen Port oder gemerkte PID
- Nach jeder Aufgabe oder logischen Gruppe committen; an jedem Checkpoint kann die Story einzeln
  validiert werden
