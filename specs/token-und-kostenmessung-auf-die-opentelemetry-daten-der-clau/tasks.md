---
description: "Aufgabenliste für die Umsetzung"
---

# Tasks: Token- und Kostenmessung aus der Telemetrie der Claude-CLI

**Input**: Design-Dokumente aus `specs/token-und-kostenmessung-auf-die-opentelemetry-daten-der-clau/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Ja. Der Plan verlangt sie ausdrücklich („Schwerpunkt auf reinen Funktionen in
`@sdd/shared` — Parser, Einstufung, Zuordnung, Aggregation sind ohne IO testbar und tragen die
Korrektheitsargumente des Features"), und im Repo hat jedes `shared`-Modul heute schon eine
`.test.ts` daneben. Für die reinen Funktionen gilt TDD: Test zuerst, rot sehen, dann bauen.

**Organization**: Nach User Story gruppiert, damit jede Stufe eigenständig prüfbar ist.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1–US4 laut spec.md
- Dateipfade sind exakt und repo-relativ

---

## Phase 1: Setup

**Zweck**: Ausgangslage sichern und die eine offene technische Frage klären, bevor darauf
gebaut wird.

- [X] T001 Ausgangslage grün stellen: `pnpm typecheck && pnpm test` im Repo-Root ausführen und das Ergebnis notieren — insbesondere muss `packages/server/src/pty/transcriptOffsetAtTimestamp.test.ts` bestehen (Regressionstest der Startmarke, bleibt unangetastet) → **grün, 670 Tests** (322 shared + 348 server)
- [X] T002 Rangfolge empirisch klären (contracts/telemetry-env.md, Abschnitt „Bei der Umsetzung zu prüfen") — geprüft über eine eigene Datei via `--settings` statt über `~/.claude/settings.json`, damit die Konfiguration des Nutzers unberührt bleibt. **Ergebnis: `settings.json`-`env` schlägt die Prozessumgebung** (Fall A: 0 Ereignisse, Fall B: Ereignis inkl. Marke). Nachgetragen in `specs/token-und-kostenmessung-auf-die-opentelemetry-daten-der-clau/research.md` unter D5. Folge: Die Variablen gehören in den `env`-Block der Settings-Datei — für PTY-Sessions in `packages/server/src/pty/hookBridge.ts` (`writeHookSettings`), für Headless-Läufe in eine eigene Datei je Lauf plus `--settings` (siehe T019a/T025/T026–T029)
- [X] T003 Verzeichnis `packages/server/src/telemetry/` anlegen

**⚠️ Prozessregel** (`CLAUDE.md`): Für eigene Testinstanzen freie Ports nehmen (nicht 4820/4830)
und ausschliesslich über gemerkte PID bzw. `lsof -ti:<port> | xargs -r kill` abräumen. **Nie**
`pkill -f` / `killall` mit generischen Mustern — das reisst die laufende Toolkit-Instanz und
damit die eigene Session mit runter.

---

## Phase 2: Foundational (blockierende Voraussetzungen)

**Zweck**: Typen, reine Logik, Ablage und Umgebung. Ohne diese Phase kann keine Story beginnen.

**⚠️ CRITICAL**: Vor Abschluss dieser Phase startet keine User-Story-Arbeit.

**Hinweis zur Bündelung**: T004 und T010 fassen Änderungen zusammen, die typsystematisch
zusammenhängen. `TokensSource` ist aus `ExecutionRecord['tokensSource']` abgeleitet — sobald
`'telemetry'` dazukommt, brechen alle erschöpfenden `Record<TokensSource, …>`-Literale. Sie
müssen gemeinsam nachgezogen werden, sonst ist der Build zwischen zwei Stories rot. Ebenso
teilen sich US2 und US4 dieselben vier Funktionen in `costBreakdown.ts`/`runSummary.ts`; die
Felder entstehen deshalb einmal hier, die Stories füllen und zeigen sie.

### Typen und Ablage

- [X] T004 `UsageOrigin`-Typ und Telemetrie-Felder in `packages/shared/src/types.ts`: `tokensSource` um `'telemetry'` erweitern (neue höchste Stufe), `ExecutionRecord` um `costMicros`, `subagentTokens`, `subagentCostMicros`, `model`, `telemetryFinalAt` ergänzen (alle `number | string | null`, jeweils `| null`) — laut data-model.md Abschnitt 4
- [X] T005 Migration in `packages/server/src/db/database.ts` an das Ende der `MIGRATIONS`-Liste anhängen: fünf `ALTER TABLE executions ADD COLUMN` (`cost_micros`, `subagent_tokens`, `subagent_cost_micros`, `model`, `telemetry_final_at`) mit erklärendem Kommentar im Stil der bestehenden Einträge
- [X] T006 `ExecutionRepo` in `packages/server/src/db/repos.ts` erweitern: `map()` um die fünf neuen Spalten, `ExecutionUsageInput` um die neuen Felder, neue Methode `finishWithTelemetry(id, exitCode, usage)` und `updateTelemetry(id, usage)` für den Nachtrag ohne Statuswechsel
- [X] T007 [P] Repo-Tests in `packages/server/src/db/executionRepo.test.ts` ergänzen: neue Spalten werden geschrieben und gelesen, Bestandszeilen bleiben `NULL`, `updateTelemetry` ändert den Status nicht
- [X] T008 [P] Bus-Ereignis `execution_updated` in `packages/server/src/events.ts` deklarieren (`{ executionId: string; featureId: string | null }`) und in `BUS_EVENT_NAMES` aufnehmen

### Reine Logik in `@sdd/shared`

- [X] T009 [P] Tests zuerst in `packages/shared/src/telemetryEvent.test.ts`: OTLP/JSON-Rumpf → `UsageEvent[]`; deckt ab — nur `claude_code.api_request` wird gelesen, `intValue` als String **und** als Zahl, Marke aus `resource.attributes` **und** aus Datensatz-Attributen, Datensatz ohne `request_id`/Zeitstempel wird übersprungen, Datensatz ohne beide `sdd.*`-Marken wird verworfen, kaputtes JSON wirft nicht. Als Beispieldaten den verifizierten Mitschnitt aus research.md D1 verwenden
- [X] T010 [P] Tests zuerst in `packages/shared/src/telemetryAttribution.test.ts`: `classifyOrigin` nach der CLI-Regel (fehlend/`sdk`/`repl_main_thread*` → `main`, `agent:*`/`hook_agent` → `subagent`, Rest → `auxiliary`), Fensterfilter `[startedAt, finishedAt]` mit offener Obergrenze, Dedupe über `requestId`, `summarizeEvents` liefert Gesamtsumme **und** Aufteilung je Herkunft
- [X] T011 `packages/shared/src/telemetryEvent.ts` implementieren, bis T009 grün ist — reiner Parser, keine IO, laut contracts/otlp-receiver.md
- [X] T012 `packages/shared/src/telemetryAttribution.ts` implementieren, bis T010 grün ist: `classifyOrigin`, `selectEventsForWindow`, `summarizeEvents` (Rückgabe `{ total, byOrigin }`) — laut data-model.md Abschnitt 7
- [X] T013 Exporte in `packages/shared/src/index.ts` um `./telemetryEvent.js` und `./telemetryAttribution.js` ergänzen

### Aggregat-Felder und erschöpfende Zuordnungen nachziehen

- [X] T014 `packages/shared/src/costBreakdown.ts`: `sourceCounts`/`sourceMix`-Literale um `telemetry: 0` erweitern (die Zählung selbst greift dann automatisch), `CostRollup` um `costMicros`, `runsWithoutCost`, `subagentTokens` ergänzen und in `emptyRollup()` sowie `add()` berücksichtigen
- [X] T015 `packages/shared/src/runSummary.ts`: dieselben Erweiterungen in `sourceCounts`/`sourceMix`, `emptyRollup()` und `add()` — Nenner von `sourceMix` bleibt ausdrücklich **alle** Läufe (bestehender Kommentar gilt unverändert)
- [X] T016 [P] Tests in `packages/shared/src/costBreakdown.test.ts` und `packages/shared/src/runSummary.test.ts` um die neue Herkunft und die neuen Rollup-Felder ergänzen
- [X] T017 [P] `SOURCE_LABELS` in `packages/web/src/components/ExecutionsView.tsx` um `telemetry: 'von der CLI gemeldet'` ergänzen und `ExecutionInfo` in `packages/web/src/api.ts` um die neuen Felder erweitern — hält den Typecheck des Web-Pakets grün

### Umgebung der Kindprozesse

- [X] T018 [P] Tests zuerst in `packages/server/src/telemetry/telemetryEnv.test.ts`: erzeugte Variablen laut contracts/telemetry-env.md, Marke wird an bestehende `OTEL_RESOURCE_ATTRIBUTES` **angehängt** statt sie zu ersetzen, unzulässige Zeichen im Wert (`,` `;` `\`, >255 Zeichen, Nicht-ASCII) führen zum Weglassen der Marke statt zu einer kaputten Liste, Erkennung einer abweichenden geerbten Konfiguration
- [X] T019 `packages/server/src/telemetry/telemetryEnv.ts` implementieren, bis T018 grün ist: `telemetryEnvFor({ sessionId } | { runId }, port)` liefert die Überlagerung, `detectForeignOtelConfig(env)` meldet eine abweichende Nutzerkonfiguration. `OTEL_METRICS_EXPORTER` und `OTEL_TRACES_EXPORTER` werden **nicht** gesetzt

**Checkpoint**: `pnpm typecheck && pnpm test` ist grün. Es fliesst noch keine Telemetrie, aber
Typen, Ablage, Parser, Zuordnung und Umgebung stehen.

---

## Phase 3: User Story 1 — Der Verbrauch eines Laufs stimmt (P1) 🎯 MVP

**Goal**: Jeder Lauf weist den Verbrauch aus, den die CLI für genau diesen Lauf gemeldet hat —
ohne aus Byte-Positionen rekonstruierte Startmarke.

**Independent Test**: Eine bestehende Claude-Session fortsetzen (Zuordnung beim Start also
unbekannt), darin einen kurzen Phasenlauf ausführen und den ausgewiesenen Verbrauch mit dem
vergleichen, was die CLI für denselben Zeitraum selbst nennt. Beide Zahlen stimmen überein; der
Lauf enthält keinen Verbrauch früherer Läufe derselben Session. (quickstart.md, Szenario 2)

### Empfang

- [X] T020 [P] [US1] Tests zuerst in `packages/server/src/telemetry/telemetryStore.test.ts`: Ereignisse landen im Puffer ihrer Marke, `requestId` doppelt zählt nur einmal, Mengendeckel wirft die ältesten zuerst raus, Kehraus entfernt Puffer beendeter Sessions und Ereignisse ausserhalb des Nachlauffensters, Ereignisse für einen bereits endgültigen Lauf werden verworfen
- [X] T021 [US1] `packages/server/src/telemetry/telemetryStore.ts` implementieren, bis T020 grün ist: Puffer je `sdd.session.id`/`sdd.run.id`, Dedupe, drei Deckel laut data-model.md Abschnitt 3, Zähler `eventsReceived`/`lastEventAt` für den Statusendpunkt, periodischer Kehraus
- [X] T022 [US1] `packages/server/src/telemetry/otlpRoute.ts`: `POST /v1/logs` mit erhöhtem `bodyLimit`, Rumpf über `telemetryEvent.ts` parsen, Ergebnis in den Store geben, **immer** `200 {}` antworten — auch bei kaputtem Rumpf oder Auswertungsfehler (contracts/otlp-receiver.md)
- [X] T023 [P] [US1] Routen-Test in `packages/server/src/telemetry/otlpRoute.test.ts`: kaputtes JSON, fehlendes `resourceLogs`, fremdes Ereignis und gültiger Stapel liefern alle `200`; nur der gültige Stapel erhöht den Zähler im Store
- [X] T024 [US1] Route in `packages/server/src/api/server.ts` registrieren und den Store in `packages/server/src/index.ts` erzeugen sowie an `buildServer` und den Orchestrator durchreichen

### Marke an allen Startpunkten (FR-026)

- [X] T025 [US1] `packages/server/src/pty/sessionManager.ts`: in `spawn()` die Überlagerung aus `telemetryEnvFor({ sessionId: id }, port)` in das `env` des PTY-Aufrufs mischen (neben dem bestehenden `SDD_SESSION_ID`) — der Server-Port muss dafür in den `PtySessionManager` gereicht werden
- [X] T026 [P] [US1] `packages/server/src/services/agentGateService.ts`: Headless-Spawn um `telemetryEnvFor({ runId: execId }, port)` ergänzen
- [X] T027 [P] [US1] `packages/server/src/services/conflictResolver.ts`: dito
- [X] T028 [P] [US1] `packages/server/src/services/chatService.ts`: dito
- [X] T029 [P] [US1] `packages/server/src/services/chatWorkService.ts`: dito

### Zuordnung im Orchestrator

- [X] T030 [US1] `packages/server/src/services/orchestrator.ts`: neue Methode `meterFromTelemetry(session, running)` — Ereignisse der Session im Fenster `[running.startedAt, jetzt]` über `selectEventsForWindow` + `summarizeEvents` zusammenfassen; liefert `null`, wenn keine vorliegen
- [X] T031 [US1] `packages/server/src/services/orchestrator.ts`: in `handleTurnCompleted` und `handleExit` zuerst `meterFromTelemetry` befragen. Liegen Ereignisse vor → `finishWithTelemetry` mit `tokensSource: 'telemetry'`, Modell und `telemetryFinalAt = jetzt + 5 min`; `meterTurn` läuft dann **gar nicht erst** (FR-014/FR-016). Sonst unverändert `meterTurn` wie heute (FR-015)
- [X] T032 [US1] `packages/server/src/services/orchestrator.ts`: Nachlauf-Verrechnung — ein Zeitgeber verrechnet bis `telemetryFinalAt` eintreffende Ereignisse nach (`updateTelemetry`) und meldet `execution_updated` auf dem Bus; nach `telemetryFinalAt` wird der Lauf nicht mehr angefasst (FR-011/FR-012)
- [X] T033 [P] [US1] Test in `packages/server/src/services/orchestrator.test.ts`: bei vorhandenen Telemetrie-Ereignissen wird `meterTurn` nicht aufgerufen und `tokensSource` ist `'telemetry'`; ohne Ereignisse bleibt das heutige Verhalten samt `tokensSource: 'transcript'` unverändert

### Oberfläche folgt Nachträgen

- [X] T034 [P] [US1] `packages/web/src/store.tsx`: `execution_updated` im WebSocket-`switch` behandeln und die Läufe-Daten neu laden, damit sich die Ansicht ohne Zutun des Nutzers aktualisiert (US1, Szenario 4)

**Checkpoint**: US1 ist vollständig und eigenständig prüfbar — quickstart.md Szenarien 2, 3, 4
und 5 laufen durch, einschliesslich der Zusatzprüfung zum Kontext-Reset (FR-007).

---

## Phase 4: User Story 2 — Verbrauch von Subagenten zählt mit (P2)

**Goal**: Der Verbrauch von Subagenten ist im Lauf enthalten und als eigener Anteil erkennbar.

**Independent Test**: Einen Lauf ausführen, der ausdrücklich Subagenten einsetzt, und prüfen,
dass der ausgewiesene Verbrauch grösser ist als der reine Hauptagent-Anteil und dass der
Subagenten-Anteil getrennt ablesbar ist. (quickstart.md, Szenario 6)

- [X] T035 [US2] `packages/server/src/services/orchestrator.ts`: aus `summarizeEvents(...).byOrigin` den Subagenten-Anteil in `subagentTokens` schreiben — `null`, wenn keine `subagent`-Ereignisse vorlagen (keine Null-Zeile, FR-010 Szenario 3). `auxiliary` zählt in die Gesamtsumme, aber nicht in den Subagenten-Anteil
- [X] T036 [P] [US2] `packages/shared/src/costBreakdown.ts` und `packages/shared/src/runSummary.ts`: `subagentTokens` in `add()` aufsummieren, damit Feature-Summe und Step-Rollups den Anteil enthalten (FR-010 Szenario 4)
- [X] T037 [P] [US2] Tests in `packages/shared/src/runSummary.test.ts`: Feature-Summe ist die Summe der Einzelläufe **inklusive** Subagenten-Anteile; Läufe ohne Subagenten tragen nichts bei
- [X] T038 [US2] `packages/web/src/components/ExecutionsView.tsx`: im aufgeklappten Lauf den Subagenten-Anteil je Ausführung ausweisen — nur wenn `subagentTokens !== null`, sonst erscheint nichts

**Checkpoint**: US1 und US2 funktionieren beide eigenständig.

---

## Phase 5: User Story 3 — Herkunft sichtbar, Messung mit Rückfallebene (P2)

**Goal**: Zu jedem Lauf ist erkennbar, woher seine Zahl stammt, und jeder Lauf bekommt eine
Zahl — auch ohne Telemetrie.

**Independent Test**: Denselben Lauf einmal mit aktiver und einmal mit abgeschalteter
Telemetrie ausführen. Beide Läufe tragen eine Zahl; die Herkunftskennzeichnung unterscheidet
sich und ist in der Ansicht ablesbar. (quickstart.md, Szenarien 7 und 8)

- [X] T039 [US3] `packages/web/src/components/ExecutionsView.tsx`: die Kennzahl „% gemessen" auf `sourceMix.telemetry + sourceMix.transcript` umstellen (heute nur `transcript`) — sonst fällt die Anzeige beim Umstieg scheinbar auf 0. Ebenso `dominantSource` in `RunCard` um die neue Stufe erweitern
- [X] T040 [P] [US3] `packages/web/src/components/ExecutionsView.tsx`: `SourceBadge` bekommt eine eigene, deutlich abgesetzte Darstellung für `telemetry`, damit „von der CLI gemeldet" nicht wie „gemessen" aussieht (FR-017, SC-009)
- [X] T041 [US3] `GET /api/telemetry/status` in `packages/server/src/api/server.ts` ergänzen: `active`, `reason` (`null` | `route_unavailable` | `no_events_yet`), `endpoint`, `eventsReceived`, `lastEventAt`, `overridesUserConfig` — Werte aus dem Store und aus `detectForeignOtelConfig` (contracts/runs-api.md)
- [X] T042 [P] [US3] `packages/web/src/api.ts`: Typ und Abruffunktion für `/api/telemetry/status`
- [X] T043 [US3] `packages/web/src/components/ProjectSettings.tsx`: Telemetrie-Zustand anzeigen — bei inaktiver Erfassung der Hinweis **mit Grund** (FR-019), bei `overridesUserConfig` der Hinweis, dass eine bestehende Konfiguration für Toolkit-Sessions übersteuert wird (research.md D5)
- [X] T044 [P] [US3] Test in `packages/server/src/api/server.test.ts`: `/api/telemetry/status` liefert `no_events_yet` vor dem ersten Ereignis und `active: true` mit Zählerstand danach

**Checkpoint**: Alle drei Stories funktionieren eigenständig; die Rückfallebene ist belegt.

---

## Phase 6: User Story 4 — Kosten stammen von der CLI (P3)

**Goal**: Der ausgewiesene Geldbetrag ist der von der CLI gemeldete, klar als gemeldet
gekennzeichnet — nie aus einer Preistabelle errechnet.

**Independent Test**: Einen Lauf ausführen und den ausgewiesenen Betrag mit dem vergleichen,
den die CLI für dieselbe Session selbst nennt (`/cost`). Kein Betrag stammt aus einer im
Toolkit hinterlegten Preistabelle. (quickstart.md, Szenario 9)

- [X] T045 [US4] `packages/server/src/services/orchestrator.ts`: `costMicros` und `subagentCostMicros` aus den Ereignissen summieren und schreiben — `null`, wenn kein Ereignis einen Betrag trug (nie `0` als Ersatz, FR-023)
- [X] T046 [P] [US4] `packages/shared/src/costBreakdown.ts` und `packages/shared/src/runSummary.ts`: `costMicros` aufsummieren und `runsWithoutCost` hochzählen, wenn eine Ausführung keinen Betrag beiträgt (FR-024)
- [X] T047 [P] [US4] Tests in `packages/shared/src/costBreakdown.test.ts`: Summen enthalten ausschliesslich gemeldete Beträge; `runsWithoutCost` zählt die übrigen; Bestandsläufe ohne Betrag verändern die Summe nicht
- [X] T048 [US4] `packages/web/src/components/ExecutionsView.tsx`: gemeldeten Betrag je Ausführung und je Lauf anzeigen, deutlich als **gemeldet** gekennzeichnet; Läufe ohne Betrag zeigen keinen Betrag und keine Ersatzschätzung
- [X] T049 [US4] `packages/web/src/components/ExecutionsView.tsx`: bei Summen über mehrere Läufe ausweisen, wie viele der enthaltenen Läufe keinen Betrag beitragen (FR-024)

**Checkpoint**: Alle vier Stories sind eigenständig funktionsfähig.

---

## Phase 7: Polish & Querschnitt

- [X] T050 Gegenprobe FR-022/SC-008: `grep -rn` über `packages/` nach einer Preistabelle (Preise je Modell/Token) — es darf keine geben, und kein angezeigter Betrag darf aus einer Preisannahme stammen. `packages/shared/src/costMeter.ts` behält ausschliesslich seine Rolle für die Token-**Schätzung** der Rückfallebene
- [X] T051 Datenschutz-Gegenprobe (quickstart.md Szenario 10): Empfänger roh mitschreiben lassen, Lauf mit auffälligem Prompt-Text ausführen — der Text darf nirgends erscheinen; in der Ablage stehen keine personenbezogenen Attribute (`user.email`, `user.account_uuid`, `organization.id`)
- [ ] T052 Speicher-Gegenprobe FR-030 (quickstart.md Szenario 10, zweiter Teil): lange Session (> 30 min) mit Phasen ohne aktiven Lauf; der Speicherbedarf des Servers wächst nicht fortlaufend und die Puffer in `packages/server/src/telemetry/telemetryStore.ts` sammeln keine Ereignisse ohne zugehörigen Lauf an — **OFFEN: braucht eine echte Langzeit-Session.** Die drei Deckel sind aber einzeln durch Tests belegt (`telemetryStore.test.ts`: Mengendeckel wirft die ältesten raus, Kehraus entfernt Ereignisse ausserhalb des Nachlauffensters, `forget` räumt den Puffer einer beendeten Session ab)
- [X] T053 [P] `contracts/runs-api.md` korrigieren: der bestehende Endpunkt heisst `GET /api/features/:featureId/cost-breakdown` (nicht `/api/features/:id/breakdown`) — Vertrag an den tatsächlichen Pfad in `packages/server/src/api/server.ts` angleichen
- [X] T054 [P] Kurzer Abschnitt zur Telemetrie-Messung in `README.md` oder `docs/`: was gemessen wird, dass es lokal bleibt, und wie man erkennt, ob die Erfassung läuft
- [ ] T055 Alle Prüfszenarien aus `specs/token-und-kostenmessung-auf-die-opentelemetry-daten-der-clau/quickstart.md` durchspielen und die Abdeckungsübersicht am Ende der Datei abhaken — **TEILWEISE.** Live gegen die echte Umsetzung belegt: Szenario 1 (Empfang inkl. Marke, Modell, `request_id`, Betrag, `query_source`), Szenario 9 Gegenprobe (keine Preistabelle im Code) und Szenario 10 erster Teil (Prompt-Text weder im Log noch in der Ablage, keine personenbezogenen Attribute, nur `127.0.0.1`). **Offen sind die Szenarien 2–8**: sie brauchen echte Phasenläufe in einer laufenden Toolkit-Instanz mit Projekt und Feature (fortgesetzte Session, zwei Läufe hintereinander, Nachtrag, parallele/fremde Sessions, Subagenten, Herkunftsanzeige, Rückfallebene)
- [X] T056 Abschluss: `pnpm typecheck && pnpm test` grün, einschliesslich des unveränderten `packages/server/src/pty/transcriptOffsetAtTimestamp.test.ts`

---

## Dependencies & Execution Order

### Phasen-Abhängigkeiten

- **Setup (Phase 1)**: keine Abhängigkeiten. T002 ist ein Entscheidungs-Gate für T019/T025
- **Foundational (Phase 2)**: hängt an Setup — **blockiert alle Stories**
- **US1 (Phase 3)**: hängt an Foundational
- **US2 (Phase 4)**: hängt an Foundational; nutzt den Schreibpfad aus US1 (T031)
- **US3 (Phase 5)**: hängt an Foundational; die Anzeige wird erst mit Läufen aus US1 aussagekräftig
- **US4 (Phase 6)**: hängt an Foundational; nutzt den Schreibpfad aus US1 (T031)
- **Polish (Phase 7)**: hängt an den gewünschten Stories

### Abhängigkeiten innerhalb der Phasen

- T004 vor T005, T006, T014, T015, T017 (Typänderung zuerst, sonst ist der Build rot)
- T009 vor T011, T010 vor T012 (Test zuerst, rot sehen)
- T011/T012 vor T013, T021, T030
- T018 vor T019, T019 vor T025–T029
- T021 vor T022, T022 vor T023/T024
- T024 und T025 vor T030 (ohne Route und Marke kommt nichts an)
- T030 vor T031, T031 vor T032, T032 vor T034
- T031 vor T035 und T045 (gemeinsamer Schreibpfad — nacheinander bearbeiten)
- T041 vor T042, T042 vor T043

### Story-Unabhängigkeit

US2, US3 und US4 hängen jeweils an Foundational und an dem einen Schreibpfad aus T031, sind
untereinander aber unabhängig und einzeln prüfbar. **Ausnahme, die zu beachten ist**: T035
(US2) und T045 (US4) ändern dieselbe Stelle in `orchestrator.ts` und T036/T046 dieselben
Funktionen in `costBreakdown.ts`/`runSummary.ts` — diese Paare nicht gleichzeitig bearbeiten.

---

## Parallel Example: Phase 2

```bash
# Nach T004 (Typänderung) parallel möglich:
Task: "T007 Repo-Tests in packages/server/src/db/executionRepo.test.ts"
Task: "T008 Bus-Ereignis execution_updated in packages/server/src/events.ts"
Task: "T009 Parser-Tests in packages/shared/src/telemetryEvent.test.ts"
Task: "T010 Zuordnungs-Tests in packages/shared/src/telemetryAttribution.test.ts"
Task: "T018 Umgebungs-Tests in packages/server/src/telemetry/telemetryEnv.test.ts"
```

## Parallel Example: US1 — Marke an den Headless-Startpunkten

```bash
# Nach T019, vier verschiedene Dateien:
Task: "T026 agentGateService.ts"
Task: "T027 conflictResolver.ts"
Task: "T028 chatService.ts"
Task: "T029 chatWorkService.ts"
```

---

## Implementation Strategy

### MVP zuerst (nur US1)

1. Phase 1: Setup — insbesondere T002, weil es den Weg für T019 festlegt
2. Phase 2: Foundational (blockiert alles)
3. Phase 3: US1
4. **STOPP und PRÜFEN**: quickstart.md Szenario 2 — fortgesetzte Session, kurzer Lauf, Vergleich
   mit dem, was die CLI selbst nennt. Das ist der Beleg, dass der 62-Mio.-Fehlerpfad weg ist
5. Ausliefern, wenn es steht

Nach dieser Stufe ist der belegte Schaden behoben. Alles Weitere baut darauf auf.

### Inkrementelle Auslieferung

1. Setup + Foundational → Grundlage steht, Build grün, noch keine Verhaltensänderung
2. + US1 → korrekte Zahlen (MVP)
3. + US2 → Subagenten zählen mit, Untererfassung weg
4. + US3 → Herkunft sichtbar, Rückfallebene belegt
5. + US4 → gemeldete Kosten sichtbar

Jede Stufe ist für sich prüfbar und macht nichts kaputt, was vorher ging.

---

## Notes

- Die Transkript-Messung wird **nicht** abgebaut. `orchestrator.meterTurn`,
  `startOffsetIn`, `offsetAtTimestamp` und ihr Regressionstest bleiben unverändert bestehen —
  sie sind ab T031 nur noch nachrangig (FR-015)
- Die Werte beider Quellen werden **nie** addiert. Das ist keine einzuhaltende Regel, sondern
  folgt daraus, dass T031 je Lauf genau einen Schreibpfad wählt (FR-016)
- Bestandsläufe werden nicht angefasst: alle neuen Spalten sind `NULL`-fähig, es gibt keine
  Rückrechnung (FR-025)
- `[P]` heisst: andere Datei, keine offene Abhängigkeit
- Nach jeder Aufgabe oder logischen Gruppe committen; an jedem Checkpoint kann gestoppt und
  die Story eigenständig geprüft werden
