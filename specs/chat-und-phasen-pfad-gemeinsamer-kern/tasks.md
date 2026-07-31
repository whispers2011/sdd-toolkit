# Tasks: Chat- und Phasen-Pfad — gemeinsamer Kern

**Input**: Entwurfsdokumente aus `specs/chat-und-phasen-pfad-gemeinsamer-kern/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [quickstart.md](./quickstart.md), `contracts/` (vier Verträge)

**Tests**: Tests sind hier **verlangt**, nicht optional — SC-004, SC-005 und SC-006 sind als
Testreihen formuliert, FR-017 macht die grüne Suite zur Abnahmebedingung, und der Wächter aus US4
ist selbst ein Test. Testaufgaben stehen deshalb neben den Umsetzungsaufgaben, nicht als Anhang.

**Organization**: Nach User Story gegliedert. Die Bauabhängigkeit steht quer zu den Prioritäten
(`sessionCore` benutzt `ensureWorkspace`), darum liegt der 20-Zeilen-Baustein aus US3 in Phase 2 —
die **Abnahme** von US3 bleibt in ihrer eigenen Phase (research.md D10).

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1…US4 — nur in den Story-Phasen, nicht in Setup/Foundational/Polish
- Jede Aufgabe nennt ihren Dateipfad

## Pfad-Konventionen

TypeScript-Monorepo, drei Pakete. Dieses Feature berührt **nur `packages/server`**:

- Kern: `packages/server/src/services/core/`
- Bestand: `packages/server/src/services/`, `packages/server/src/telemetry/`,
  `packages/server/src/db/`, `packages/server/src/index.ts`
- Tests liegen neben dem Code (`*.test.ts`), nach dem Muster des Repos
- Tor nach jedem Schritt: `pnpm test` und `pnpm typecheck` in der Repository-Wurzel

---

## Phase 1: Setup

**Purpose**: Referenzstand festhalten und den einzigen neuen Ort anlegen. Keine neue Abhängigkeit,
kein neues Paket, keine Migration.

- [X] T001 Referenzstand aufnehmen: `pnpm test` und `pnpm typecheck` in der Repository-Wurzel
      laufen lassen und Ergebnis notieren — das ist der Vergleichsmassstab für FR-017/FR-018
- [X] T002 Ordner `packages/server/src/services/core/` anlegen (leer; die Bausteine folgen in
      Phase 2 und 3)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: `ensureWorkspace` ist Baumaterial für `SessionCore` (US2) und trägt die Abnahme von
US3. Es entsteht zuerst, weil beide darauf aufsetzen.

**⚠️ CRITICAL**: Ohne Phase 2 kann US2 nicht beginnen. US1 ist davon unabhängig und könnte
parallel starten.

- [X] T003 [P] `WorkspaceSpec` und `ensureWorkspace()` nach [contracts/workspace.md](./contracts/workspace.md)
      in `packages/server/src/services/core/workspace.ts` — idempotent (W1), Waisen-Erholung über
      `worktrees.remove` best-effort (W2), wirft roh (W4), schreibt nichts zurück (W5)
- [X] T004 [P] Tests zu W1/W2/W4 in `packages/server/src/services/core/workspace.test.ts`:
      vorhandene Kopie wird übernommen; `recordedPath` gesetzt und Verzeichnis weg → aufgeräumt und
      neu angelegt; Fehler von `worktrees.create` kommt unverändert heraus
- [X] T005 `Orchestrator.createFeature` auf `ensureWorkspace(worktrees, { project, name: slug,
      branch: 'feature/<slug>', recordedPath: null })` umstellen in
      `packages/server/src/services/orchestrator.ts`
- [X] T006 Worktree-Block in `Orchestrator.ensureSessionInner` (heute inkl. eigener Waisen-Reparatur)
      auf `ensureWorkspace` umstellen in `packages/server/src/services/orchestrator.ts`
- [X] T007 Tor Schritt 1: `pnpm test` und `pnpm typecheck` in der Repository-Wurzel — grün, ohne
      Anpassung bestehender Erwartungen

**Checkpoint**: Die Arbeitskopie entsteht im Phasen-Pfad über genau einen Weg. Der Chat kommt in
US2 dazu.

---

## Phase 3: User Story 1 - Ein Verbrauchs-Fix wirkt in beiden Pfaden (Priority: P1) 🎯 MVP

**Goal**: Ein Chat-Turn wird nach derselben Regel abgerechnet wie ein Phasenlauf — Meldungen vor
Transkript vor Schätzung, Puffer angemeldet, Nachtrag monoton. Der Chat erbt die vier Bausteine,
die ihm heute fehlen, und bekommt eine Turn-Dauer.

**Independent Test**: Dieselben Telemetrie-Ereignisse einmal über `meter.finish` (Phase) und
einmal über `meter.openTurn` → `meter.closeTurn` (Chat) einspeisen — identische Tokens, identische
Kosten, dieselbe Quelle. Abweichung 0.

### Vorarbeiten (andere Dateien, parallel)

- [X] T008 [P] [US1] `held: Set<string>` → `holds: Map<string, number>` nach
      [contracts/telemetry-store.md](./contracts/telemetry-store.md) in
      `packages/server/src/telemetry/telemetryStore.ts`: `hold` zählt hoch, `release` zählt runter
      und verwirft den Puffer nicht (T3), `sweep` fragt `holds.has(key)`, `forget` unverändert (T4)
- [X] T009 [P] [US1] Tests zu T1–T3 in `packages/server/src/telemetry/telemetryStore.test.ts`:
      überlappende Anmeldungen zweier Läufe auf derselben Marke (t0 hold, t305 release → Puffer
      bleibt), Zähler wird nie negativ, bestehende Tests (Zeilen 120–131) bleiben unangetastet (T5)
- [X] T010 [P] [US1] `ExecutionStartInput.startedAt?: number` (Vorgabe `Date.now()`) in
      `packages/server/src/db/repos.ts` — schreibt in die vorhandene Spalte `executions.started_at`,
      keine Migration, die übrigen sieben Aufrufer bleiben unverändert
- [X] T011 [P] [US1] Test zu T010 in `packages/server/src/db/repos.test.ts`: `start({ startedAt })`
      schreibt den mitgegebenen Wert, `start()` ohne das Feld weiterhin `Date.now()`

### Der Kern: Turn messen

- [X] T012 [US1] `RunMark`, `markSession(session, startedAt)` und `startOffsetIn(path, mark)` mit
      den drei Fällen aus data-model.md §3 (gleiche Datei / Dateiwechsel → 0 / beim Start unbekannt
      → `offsetAtTimestamp`) in `packages/server/src/services/core/runMeter.ts`
- [X] T013 [US1] `RunMeter` mit `hold`, `measure` und `finish`: die dreistufige Kaskade aus
      [contracts/run-meter.md](./contracts/run-meter.md) — Meldungen im Fenster
      `[mark.startedAt, until]`, sonst Transkript-Delta, sonst Schätzung aus dem Scrollback; Stufe 2
      läuft nur, wenn Stufe 1 `null` liefert (kein Addieren) — in
      `packages/server/src/services/core/runMeter.ts`
- [X] T014 [US1] `TelemetryAccum` je `executionId` (`seen`, `total`, `byOrigin`, `model`) mit
      Dedupe über `requestId` (M2), monotonem Fortschreiben (M1) und `costMicros = null`, solange
      keine Meldung einen Betrag trug (R5) in `packages/server/src/services/core/runMeter.ts`
- [X] T015 [US1] Nachtrag in `packages/server/src/services/core/runMeter.ts`: zweimal nachmessen
      (8 s und 5 min, Timer `unref`'d, M4), abgelehnte Nachträge loggen statt zu senken (M5), am
      Fensterende `telemetry.release(session.id)` statt `forget` (M3), `onApplied`-Rückruf und
      `bus.emitEvent('execution_updated', { executionId, featureId })` (M6)
- [X] T016 [US1] Turn-Fenster in `packages/server/src/services/core/runMeter.ts`: `openTurn`
      (idempotent, `markSession` + `hold`), `closeTurn` (Lauf mit `startedAt` des Fensters anlegen,
      dann `finish` — M10; Rückfallebene: Ende des Vorgängerturns, ersatzweise `session.startedAt`),
      `abandon` (Fenster verwerfen, freigeben, nichts verbuchen — M9), `dispose`

### Die beiden Pfade umhängen

- [X] T017 [US1] `finishWithMetering`, `meterFromTelemetry`, `meterTurn`, `scheduleLateReconcile`,
      `reconcileTranscriptTail`, `telemetryAccum*`, `startOffsetIn`, `transcriptMarkFor`,
      `TelemetryAccum`, `emptyUsageTotals`, `addTotals` aus
      `packages/server/src/services/orchestrator.ts` entfernen; `launchPhase` ruft `markSession` +
      `meter.hold`, `handleTurnCompleted`/`handleExit` rufen `meter.finish`; `RunningPhase` wird
      `RunMark & { phase; promptConfirmed }`
- [X] T018 [US1] `persistTranscriptRange` in `packages/server/src/services/orchestrator.ts` behalten,
      `startOffsetIn` aus dem Kern importieren und die Funktion an den `onApplied`-Rückruf hängen
- [X] T019 [US1] `meterTurn`, `usageForTurn`, `turnStartedAt`, `turnTranscriptOffset` aus
      `packages/server/src/services/chatWorkService.ts` entfernen; in `handleStatusChange` bei
      `status === 'working'` → `meter.openTurn(session)`, beim Effekt `turn_completed` →
      `meter.closeTurn(session, { projectId, featureId: null, kind: 'chat_work' })`; in `handleExit`
      → `meter.abandon(session.id)`; `turnStart` bleibt (Scrollback-Marke der Session)
- [X] T020 [US1] `RunMeter` einmal in `packages/server/src/index.ts` aufbauen und sowohl
      `Orchestrator` als auch `ChatWorkService` mitgeben (ohne diesen Schritt greift T019 nicht)
- [X] T021 [US1] Telemetrie-Attrappe in `packages/server/src/services/orchestrator.test.ts` (Zeile
      ~421) um `release` ergänzen — Ergänzung der Attrappe, **keine** Änderung einer Erwartung
      (FR-017 bleibt erfüllt)

### Tests zu US1

- [X] T022 [P] [US1] Kaskade in `packages/server/src/services/core/runMeter.test.ts`: Szenario 1
      (Meldungen → `tokens_source = 'telemetry'`, Transkript wird nicht gelesen), Szenario 5 (ohne
      Meldungen, mit Transkript → `'transcript'`), Edge Case ohne konfigurierten Telemetrie-Speicher
      → fehlerfreier Durchfall auf Schätzung (M8)
- [X] T023 [P] [US1] SC-002 in `packages/server/src/services/core/runMeter.test.ts`: dieselben
      Ereignisse über den Phasen-Weg und den Chat-Weg → identische vier Token-Klassen, identische
      `cost_micros`, dasselbe `model`, dieselbe Quelle; Abweichung 0
- [X] T024 [P] [US1] SC-004 in `packages/server/src/services/core/runMeter.test.ts`: messen, Puffer
      beschneiden, erneut messen — über mehrere Nachträge 0 Absenkungen, nie `null` (M1, M5,
      US1 Szenario 4)
- [X] T025 [P] [US1] Nachtrag in `packages/server/src/services/core/runMeter.test.ts`: Meldungen
      treffen nach dem Abschluss ein, das Fenster ist noch offen → Zahl wird nachgezogen und
      `execution_updated` gesendet (US1 Szenario 3, M6)
- [X] T026 [P] [US1] Turn-Dauer in `packages/server/src/services/core/runMeter.test.ts`: ein
      Chat-Turn schreibt `finished_at − started_at > 0` (M10, Clarification 30.07.2026)
- [X] T027 [P] [US1] Randfälle in `packages/server/src/services/core/runMeter.test.ts`: `abandon`
      verbucht nichts (M9, Leerlauf-Reaper), `closeTurn` ohne vorheriges `openTurn` öffnet
      rückwirkend und liefert eine Dauer > 0 und nie negativ (research.md D4), zweiter
      `working`-Übergang innerhalb desselben Turns ist ein No-op
- [X] T028 [US1] Tor Schritt 2: `pnpm test` und `pnpm typecheck` in der Repository-Wurzel — die
      bestehenden Metering-Tests in `packages/server/src/services/orchestrator.test.ts`
      (Zeilen 412–619) und `packages/server/src/services/chatWorkService.test.ts` (Zeilen 463, 476)
      bleiben **ohne Anpassung** grün (FR-018, SC-003)

**Checkpoint**: Der teuerste Teil des Problems ist weg — auch dann, wenn Session und Arbeitskopie
noch doppelt wären. US1 ist eigenständig auslieferbar.

---

## Phase 4: User Story 2 - Ein Session-Fix wirkt in beiden Pfaden (Priority: P2)

**Goal**: Eine Session wird in beiden Pfaden nach derselben Regel sichergestellt — höchstens eine
je Bezugsobjekt auch bei gleichzeitigen Aufrufen, keine blinde Fortsetzung einer gespeicherten
Kennung, Berechtigungsmodus aus derselben aufgelösten Automatisierung.

**Independent Test**: Je Pfad zwei Aufrufe gleichzeitig absetzen — genau ein Prozess, dieselbe
Session-Kennung für beide Aufrufer, in 20 aufeinanderfolgenden Versuchen 0 Doppelstarts.

- [X] T029 [US2] `SessionSpec`, `SpawnStage` und `SessionCore.ensure(key, resolve)` nach
      [contracts/session-core.md](./contracts/session-core.md) in
      `packages/server/src/services/core/sessionCore.ts` — In-Flight-Karte, `resolve()` **innerhalb**
      des Schutzes, Ablauf 1–11 einschliesslich Resume-Prüfung über `locateTranscript` (FR-014),
      `permissionMode` aus `automation.autoMode` (FR-015) und `finally`-Freigabe auch im Fehlerfall
- [X] T030 [US2] `Orchestrator.ensureSession` wird ein Aufruf mit `key = 'feature:<featureId>'` in
      `packages/server/src/services/orchestrator.ts`; `ensureSessionInner` und die eigene
      In-Flight-Karte entfallen. Die `resolve`-Funktion behält die heutige Reihenfolge bei: erst
      `ptys.forFeature`, **dann** die Prüfung auf abgeschlossenes Feature
- [X] T031 [US2] `ChatWorkService.ensure` wird ein Aufruf mit `key = 'chat:<projectId>'` in
      `packages/server/src/services/chatWorkService.ts`; `ensureUnlocked`, die Karte `ensuring` und
      der eigene Worktree-Block entfallen. `wrapError` liefert
      `ChatError(503, 'Arbeitskopie konnte nicht erstellt werden: …')` und
      `ChatError(503, 'Session konnte nicht gestartet werden: …')` zeichengleich wie heute; die
      Rückgabe bleibt `{ sessionId }` und setzt weiterhin `turnStart.set(session.id, 0)`
- [X] T032 [US2] `SessionCore` einmal in `packages/server/src/index.ts` aufbauen und beiden
      Diensten mitgeben
- [X] T033 [P] [US2] SC-005 in `packages/server/src/services/core/sessionCore.test.ts`: je Pfad
      20 × zwei gleichzeitige Aufrufe mit künstlich um 10 ms verzögerter Worktree-Anlage — 20 × genau
      ein Spawn, 20 × dieselbe Session-Kennung (S1, US2 Szenarien 1+2)
- [X] T034 [P] [US2] Tote Kennung in `packages/server/src/services/core/sessionCore.test.ts`:
      `locateTranscript` findet nichts → `sessions.setClaudeSessionId(prev.id, null)` und das `argv`
      enthält kein `--resume` (S5, US2 Szenario 3)
- [X] T035 [P] [US2] Laufende Session und Freigabe in
      `packages/server/src/services/core/sessionCore.test.ts`: `spec.existing` gesetzt → kein zweiter
      Prozess (FR-016, Szenario 4); nach Abschluss ist der Schutz frei (S2); ein Fehler in `resolve`,
      Schritt 4 oder 8 erreicht alle Wartenden und gibt frei (S3)
- [X] T036 [P] [US2] Fehlerbild und Berechtigungsmodus in
      `packages/server/src/services/core/sessionCore.test.ts`: ohne `wrapError` fliegt der rohe
      Fehler (S4, Phasen-Pfad), mit `wrapError` kommt der `ChatError(503, …)` heraus (FR-005,
      Szenario 5); `autoMode` → `bypassPermissions`, sonst `acceptEdits` (S6)
- [X] T037 [US2] Tor Schritt 3: `pnpm test` und `pnpm typecheck` in der Repository-Wurzel, inklusive
      der bestehenden Nebenläufigkeits-Tests in
      `packages/server/src/services/chatWorkService.test.ts` (Zeilen 511, 546) und
      `packages/server/src/services/orchestrator.test.ts` (Zeile 402)

**Checkpoint**: Doppelstart-Schutz, Resume-Prüfung und Berechtigungsmodus existieren einmal. Der
Chat legt seine Arbeitskopie ab jetzt über `ensureWorkspace` an — das ist die Grundlage von US3.

---

## Phase 5: User Story 3 - Eine Arbeitskopie entsteht nach einer Regel (Priority: P3)

**Goal**: Chat und Feature legen ihre Arbeitskopie über denselben Weg an — serialisiert je
Repository, idempotent, mit derselben Behandlung eines gespeicherten Pfads, der auf der Platte
fehlt. Der Baustein steht seit Phase 2; hier wird die Abnahme geführt.

**Independent Test**: Für Chat und Feature eine Arbeitskopie anlegen, ihr Verzeichnis von aussen
entfernen und die Anlage erneut anfordern — beide Pfade zeigen dieselbe Erholung.

- [X] T038 [P] [US3] Szenario 1 in `packages/server/src/services/chatWorkService.test.ts`: nach
      `ensure()` existiert `chat-<convId>` mit Zweig `chat/<convId>`, angelegt über `ensureWorkspace`
      — geprüft an der Attrappe, dass `worktrees.create` genau einmal und aus dem Kern gerufen wurde
- [X] T039 [P] [US3] Szenario 2 in `packages/server/src/services/chatWorkService.test.ts`:
      `recordedPath` aus `worktrees.pathFor` gesetzt, Verzeichnis fehlt → `worktrees.remove`
      best-effort, danach neu angelegt, Session startet (W2 — der Chat bekommt sie neu)
- [X] T040 [P] [US3] Szenario 3 in `packages/server/src/services/chatWorkService.test.ts`: scheitert
      das Anlegen, antwortet der Chat unverändert mit
      `ChatError(503, 'Arbeitskopie konnte nicht erstellt werden: …')`
- [X] T041 [US3] Gegenprobe im Quellcode: kein `worktrees.create` mehr in
      `packages/server/src/services/chatWorkService.ts` und kein eigener Worktree-Block mehr in
      `packages/server/src/services/orchestrator.ts` — verbleibende Fundstellen ausserhalb von
      `services/core/workspace.ts` entfernen
- [X] T042 [US3] Tor: `pnpm test` und `pnpm typecheck` in der Repository-Wurzel

**Checkpoint**: Alle drei Aufgaben laufen über den Kern. Was fehlt, ist der Nachweis, dass es so
bleibt.

---

## Phase 6: User Story 4 - Der nächste Fix findet nur eine Fundstelle (Priority: P3)

**Goal**: Wer eine der drei Aufgaben ändern will, findet genau eine Stelle. Das ist das einzige
Abnahmekriterium, das über *Abwesenheit* redet — es braucht einen Test, keinen Vorsatz.

**Independent Test**: Den Quellcode nach den charakteristischen Bestandteilen jeder Aufgabe
durchsuchen — jede kommt ausserhalb von Tests höchstens einmal vor.

- [X] T043 [US4] Wächter in `packages/server/src/services/core/singleImplementation.test.ts`: liest
      `packages/server/src` rekursiv (`readdirSync`, ohne `*.test.ts`) und lässt je Merkmal genau
      eine Fundstelle zu — `selectEventsForWindow(`/`summarizeEvents(` → `services/core/runMeter.ts`,
      `buildClaudeArgv(` → `services/core/sessionCore.ts` (+ Definition in
      `pty/commandBuilder.ts`), `worktrees.create(` → `services/core/workspace.ts`, `ptys.spawn(` →
      `services/core/sessionCore.ts` **und** `api/server.ts` (Projekt-Terminal, `kind: 'shell'`,
      keine Claude-Session — mit Begründung in der Erlaubnisliste, research.md D9)
- [X] T044 [US4] Regressionstest zu FR-020 in `packages/server/src/services/orchestrator.test.ts`:
      `checkWorkWithoutRun` schlägt für eine arbeitende `chat_work`-Session **nicht** an; der Filter
      `session.kind !== 'feature'` bleibt stehen
- [X] T045 [US4] Stichprobe SC-008 durchführen: das Nachtragsfenster in
      `packages/server/src/services/core/runMeter.ts` probeweise von 8 s auf 6 s ändern, die Zahl der
      zu öffnenden Dateien zählen (Erwartung: genau eine), Änderung zurücknehmen und das Ergebnis in
      [quickstart.md](./quickstart.md) §4.2 festhalten
- [X] T046 [US4] Tor Schritt 4: `pnpm test` und `pnpm typecheck` in der Repository-Wurzel — der
      Wächter läuft ab jetzt im bestehenden `pnpm test` mit

**Checkpoint**: Der Zwilling kann nicht zurückkommen, ohne dass die Suite rot wird.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Aufräumen, Buchführung, Gegenprobe an echter Telemetrie.

- [ ] T047 [P] Ungenutzte Importe und toten Code in
      `packages/server/src/services/orchestrator.ts` und
      `packages/server/src/services/chatWorkService.ts` entfernen; Zeilenbilanz gegen die Erwartung
      aus plan.md prüfen (~−200 bzw. ~−90 Zeilen)
- [ ] T048 [P] SC-007 abschliessen: die Tabelle der vier Verbesserungen vom 30.07.2026 in
      [quickstart.md](./quickstart.md) gegen den gebauten Stand prüfen — zwei im Chat wirksam
      (Nachweis T009/T024), zwei mit Grund ausgeschlossen (Nachweis T044) — 4 von 4 beantwortet,
      0 offen
- [ ] T049 **Teilweise — Boot-Gegenprobe erledigt, echter Chat-Turn offen.** Live-Gegenprobe nach
      [quickstart.md](./quickstart.md) §Live: eigene Instanz auf
      `SDD_PORT=4899`/`SDD_WEB_PORT=4898` mit eigenem `SDD_DATA_DIR`, einen echten Chat-Turn fahren
      und die Lauf-Zeile prüfen (`tokens_source = 'telemetry'`, Betrag > 0, Modell, alle vier
      Token-Klassen, Dauer > 0, Nachtrag nach ~8 s steigt und sinkt nie). Abräumen **nur** über die
      gemerkte PID bzw. `lsof -ti:4899 | xargs kill` — 4820/4830 bleiben unangetastet.
      **Stand 31.07.2026**: Boot auf Port 4871 fehlerfrei (0 Fehler im Log, `/api/state` 200,
      Chat-`ensure` liefert das 404-Fehlerbild des Chat-Pfads), Instanz über die gemerkte PID
      abgeräumt. Der echte Chat-Turn wurde **nicht** gefahren — er startet einen realen
      Claude-Prozess und verursacht Kosten; das braucht eine ausdrückliche Entscheidung. Details
      und Nachholanleitung in quickstart.md §Live.
- [ ] T050 Abschluss-Tor: `pnpm test` und `pnpm typecheck` in der Repository-Wurzel; Ergebnis gegen
      den Referenzstand aus T001 halten (SC-006)

---

## Dependencies & Execution Order

### Phasen-Abhängigkeiten

- **Setup (Phase 1)**: keine Abhängigkeit
- **Foundational (Phase 2)**: nach Setup — blockiert **US2** (`SessionCore` benutzt
  `ensureWorkspace`) und trägt die Abnahme von **US3**. Blockiert **US1 nicht**.
- **US1 (Phase 3)**: unabhängig von Phase 2, braucht nur Setup. Der Schritt mit dem sofortigen
  Nutzen.
- **US2 (Phase 4)**: nach Phase 2.
- **US3 (Phase 5)**: nach Phase 4 — der Chat legt seine Arbeitskopie erst über `SessionCore` über
  den gemeinsamen Weg an (research.md D10).
- **US4 (Phase 6)**: nach Phase 3, 4 und 5 — der Wächter prüft Abwesenheit und kann erst grün sein,
  wenn alle drei Aufgaben umgezogen sind.
- **Polish (Phase 7)**: zum Schluss.

### User-Story-Abhängigkeiten

- **US1 (P1)**: keine. Allein auslieferbar und allein bereits den bezifferten Nutzen wert.
- **US2 (P2)**: braucht `ensureWorkspace` aus Phase 2.
- **US3 (P3)**: braucht US2 für die Abnahme (der Baustein selbst steht seit Phase 2).
- **US4 (P3)**: braucht US1 + US2 + US3.

### Innerhalb der Stories

- T012 → T013 → T014 → T015 → T016 (dieselbe Datei, aufeinander aufbauend)
- T017/T018 (Orchestrator) und T019 (Chat) nach T016; T020 (Verdrahtung) nach T019
- T029 → T030/T031 → T032
- Testaufgaben mit [P] liegen in eigenen Dateien und laufen parallel; die Tor-Aufgaben (T007, T028,
  T037, T042, T046, T050) sind Sperren — vor ihnen wird nichts aus der nächsten Phase angefangen

### Parallel-Gelegenheiten

- T003 + T004 (Umsetzung und Test in getrennten Dateien)
- T008–T011: vier Vorarbeiten in vier verschiedenen Dateien
- T022–T027: sechs Testaufgaben, alle in `runMeter.test.ts` — nur parallel *planbar*, beim
  Schreiben in dieselbe Datei nacheinander
- T033–T036: vier Testaufgaben in `sessionCore.test.ts`, dito
- T038–T040: drei Testaufgaben in `chatWorkService.test.ts`, dito
- T047 + T048: Aufräumen und Buchführung berühren verschiedene Dateien
- Mit zwei Personen: US1 (Phase 3) und Phase 2 + US2 (Phase 4) laufen echt parallel — sie berühren
  disjunkte Dateien bis auf `orchestrator.ts` und `chatWorkService.ts`, die dann koordiniert werden
  müssen

---

## Parallel Example: Phase 3 (US1), Vorarbeiten

```bash
# Vier Dateien, keine gemeinsame Abhängigkeit — gleichzeitig ausführbar:
Task: "T008 holds: Map<string, number> in packages/server/src/telemetry/telemetryStore.ts"
Task: "T009 Überlappende Anmeldungen in packages/server/src/telemetry/telemetryStore.test.ts"
Task: "T010 ExecutionStartInput.startedAt in packages/server/src/db/repos.ts"
Task: "T011 start({ startedAt }) in packages/server/src/db/repos.test.ts"
```

---

## Implementation Strategy

### MVP zuerst (nur US1)

1. Phase 1 (T001–T002)
2. Phase 3 (T008–T028) — Phase 2 ist für US1 **nicht** nötig
3. **Anhalten und prüfen**: Ein Chat-Turn verbucht Tokens, Kosten, Modell und eine Dauer > 0; der
   Phasen-Pfad verbucht unverändert
4. Das ist der Punkt, an dem der bezifferte Schaden (5 $ als 0 $ verbucht) behoben ist

### Schrittweise Auslieferung

1. Phase 1 + 2 → `ensureWorkspace` steht
2. + US1 → Messung stimmt in beiden Pfaden (**MVP**, Tor T028)
3. + US2 → Session-Sicherstellung existiert einmal (Tor T037)
4. + US3 → Arbeitskopie-Abnahme (Tor T042)
5. + US4 → Wächter hält den Zustand (Tor T046)
6. + Polish → Live-Gegenprobe und Buchführung

Nach **jedem** Schritt ist die Suite grün — das ist die Bedingung, unter der die Spec eine
schrittweise Umstellung überhaupt erlaubt.

---

## Notes

- **Nach jeder erledigten Aufgabe einzeln abhaken**, nicht erst am Schluss (Clarification vom
  30.07.2026).
- [P] heisst: andere Datei, keine offene Abhängigkeit.
- Bestehende Testerwartungen werden **nicht** angepasst (FR-017). Die einzige erlaubte Berührung ist
  T021 — eine Attrappe bekommt eine fehlende Methode ergänzt.
- Der Phasen-Pfad ist der gepflegte Stand und gibt das Verhalten vor; Schritt 2 verschiebt Code,
  ohne ihn umzuschreiben (FR-018).
- Was doppelt bleiben **darf**, steht in FR-019 und wird nicht angefasst: `handleExit`,
  `handleStatusChange`, Feature-Vorschläge, Marker-Erkennung, Neustart, Leerlauf-Reaper,
  Phasenzustand, Gates, Wissens-Präambel, Kontext-Optimierung.
- `checkWorkWithoutRun` bleibt feature-only (FR-020) — T044 nagelt das fest.
- Keine neue Abhängigkeit, kein neues Paket, keine Migration.
- **Prozesse nur gezielt beenden.** Dieses Repo ist das SDD-Toolkit selbst; die eigene Session ist
  ein Kindprozess der laufenden Instanz auf 4820/4830. `pkill -f vite`, `pkill -f tsx` oder
  `killall node` reissen sie mit — und die eigene Arbeit. Betrifft T049.
