# Tasks: Server-Ausfälle sichtbar machen

**Input**: Design-Dokumente aus `specs/server-ausfaelle-sichtbar-machen/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (D1–D18),
[data-model.md](./data-model.md), [contracts/](./contracts/) (C1–C4), [quickstart.md](./quickstart.md)

**Tests**: Tests sind hier **verlangt**, nicht optional — FR-025 („eigenständig prüfbare Einheit"),
FR-026 (sechs namentlich genannte Fälle) und SC-009. Die Testaufgaben sind deshalb reguläre
Aufgaben, keine Kann-Aufgaben. `@sdd/web` hat im Repo keine Tests; die Oberfläche wird über
quickstart.md Teil C abgenommen.

**Organization**: Aufgaben sind nach User Story gruppiert, damit jede Story einzeln umgesetzt,
geprüft und ausgeliefert werden kann.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel möglich (andere Datei, keine Abhängigkeit auf unfertige Aufgaben)
- **[Story]**: zugehörige User Story (US1, US2, US3)
- Jede Beschreibung nennt den genauen Dateipfad

## Pfadkonventionen

pnpm-Monorepo (siehe plan.md „Project Structure"). Alle Pfade sind relativ zum Repo-Stamm:

- Pure Logik: `packages/shared/src/`
- Datei-/Betriebssystemzugriff: `packages/server/src/services/`
- HTTP: `packages/server/src/api/`
- Oberfläche: `packages/web/src/`
- Tests liegen als `*.test.ts` **neben** der geprüften Datei — kein eigener `tests/`-Baum

---

## Phase 1: Setup

**Purpose**: Ausgangsstand sichern. Kein neues Paket, keine neue Abhängigkeit, keine Migration —
das Feature baut ausschliesslich auf Bordmitteln (plan.md „Primary Dependencies").

- [X] T001 Ausgangsstand sichern: `pnpm install`, `pnpm typecheck` und `pnpm -r test` im Repo-Stamm ausführen und als grün festhalten; nur so ist später unterscheidbar, ob ein roter Lauf vom Feature kommt

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Die Bausteine, die **alle drei** Stories brauchen — Transporttypen, der Lesezugriff auf
laufende Läufe und die Protokolldatei. US1 schreibt darin den Ausfall, US2 die Abgänge, US3 liest
daraus den letzten Ausfall.

**⚠️ CRITICAL**: Vor Abschluss dieser Phase kann keine Story beginnen.

- [X] T002 Transporttypen in `packages/shared/src/types.ts` ergänzen: `Heartbeat` (`ts`, `instanceId`, `clean`, `startedAt`), `OutageRecord` (`from`, `to`, `durationMs`, `affectedRuns`, `silent`, `undetermined`), `OperationsEntryKind` (`'startup' | 'shutdown' | 'uncaught' | 'exit' | 'outage'`) und `OperationsEntry` — Feldbedeutungen wörtlich nach data-model.md, deutsche Doc-Kommentare
- [X] T003 [P] `ExecutionRepo.listRunning(): ExecutionRecord[]` in `packages/server/src/db/repos.ts` ergänzen (`SELECT * FROM executions WHERE status='running'`, Mapping wie in `list()`; Klasse ab Zeile 429, `reapOrphans()` bleibt unverändert) — Quelle für betroffene Läufe (FR-005) und für „gleichzeitig arbeitende Features" (D12)
- [X] T004 [P] `OperationsLog` in `packages/server/src/services/operationsLog.ts` anlegen: `constructor(dataDir)`, `rotateIfNeeded()`, `append()`, `appendFarewell()` mit Once-Flag, `tail(n)`; Anhängen synchron über `appendFileSync` (`flag:'a'`, `mode:0o600`), jeder Schreibvorgang in `try/catch` — das Modul wirft nie (C2.5, C2.7, FR-017)
- [X] T005 `packages/server/src/services/operationsLog.test.ts` gegen ein temporäres Datenverzeichnis: ein `startup` je Instanz (C2.1), höchstens ein Abgangseintrag durch das Once-Flag (C2.2), Rotation ab 1 MB auf 1000 Zeilen atomar über Temp-Datei + `rename` (C2.6), Schreibfehler im schreibgeschützten Verzeichnis bleibt folgenlos (C2.5), `tail()` überspringt eine halb geschriebene letzte Zeile still

**Checkpoint**: Typen, `listRunning()` und die Protokolldatei stehen — die Stories können beginnen.

---

## Phase 3: User Story 1 - Nach einem Absturz überhaupt erfahren, dass es einen gab (Priority: P1) 🎯 MVP

**Goal**: Der Server hinterlässt alle 30 s ein Lebenszeichen. Beim Start erkennt eine reine Funktion
die Lücke, hält den Ausfall im Betriebsprotokoll fest und legt je betroffenem Projekt genau eine
Meldung `server_outage` in „Braucht dich" an — mit Zeitfenster, Dauer und Zahl der betroffenen Läufe.

**Independent Test**: `kill -9` auf die eigene Testinstanz (Port 4899), zwei Minuten warten, neu
starten → Meldung „🕳 Server-Ausfall — Server war zwischen X und Y unerwartet weg (…) — N Läufe
betroffen". Gegenprobe: geordnetes Herunterfahren + Neustart erzeugt keine Meldung. Ablauf in
quickstart.md Teil A und B1–B3.

### Tests für User Story 1

> Zuerst schreiben, rot laufen lassen, dann implementieren.

- [X] T006 [P] [US1] `packages/shared/src/outage.test.ts`: die fünf Zusicherungen C1.1–C1.5 mit **gesetzten** Zeitpunkten (kein `Date.now()`), darunter namentlich die FR-026-Fälle „Ausfall mit betroffenen Läufen", „gewollter Abgang auch nach Tagen", „Erststart ohne Lebenszeichen", „Uhr springt rückwärts"; dazu die Tabelle von `formatOutageDuration` (`47 s`, `1 min`, `1 h 8 min`, `3 Tage 4 h`) und die Regeln von `outageMessage` (`de-CH` ohne Sekunden, Datum bei Tageswechsel, höchstens fünf Feature-Namen, Singular bei einem Lauf, `Chat` ohne Feature)
- [X] T007 [P] [US1] `packages/server/src/services/heartbeatStore.test.ts` gegen ein temporäres Datenverzeichnis: Schreiben/Lesen eines vollständigen Satzes, unlesbarer und abgeschnittener Inhalt gilt als „nicht vorhanden" (kein Wurf), fehlende Datei = Erststart, `markClean()` behält `ts`/`instanceId`/`startedAt` und setzt nur `clean: true`, Schreibfehler im schreibgeschützten Verzeichnis bleibt folgenlos (FR-011)
- [X] T008 [P] [US1] `packages/server/src/services/outageMonitor.test.ts` mit `openMemoryDatabase()` und temporärem Datenverzeichnis: die **Startreihenfolge** (betroffene Läufe werden gelesen, solange `status='running'` gilt — ein anschliessendes `reapOnBoot()` darf das Ergebnis nicht mehr verändern), je Projekt genau eine Meldung mit den eigenen Zahlen (C4.1, US1-5), FR-026-Fall „Ausfall ohne betroffene Läufe" → Protokolleintrag ohne Meldung (C4.2), FR-026-Fall „wiederholter Start nach gemeldetem Ausfall" → keine zweite Meldung (C4.4), `undetermined` erzeugt Protokolleintrag aber keine Meldung (D15)

### Implementierung für User Story 1

- [X] T009 [US1] `packages/shared/src/outage.ts` anlegen: Konstanten `HEARTBEAT_INTERVAL_MS = 30_000` und `OUTAGE_THRESHOLD_MS = 90_000`, Typ `OutageDetection`, `detectOutage({ heartbeat, now, thresholdMs? })` in der verbindlichen Prüfreihenfolge `null` → `clean` → `ts > now` → Schwelle, dazu `formatOutageDuration()` und `outageMessage()` — rein, ohne `Date.now()` und ohne Dateizugriff (C1, D16, FR-025)
- [X] T010 [US1] `export * from './outage.js';` in `packages/shared/src/index.ts` ergänzen
- [X] T011 [US1] `packages/server/src/services/heartbeatStore.ts` anlegen: `read()`, `write()`, `markClean()` auf `$SDD_DATA_DIR/heartbeat.json`, atomar über Temp-Datei + `renameSync` (D1); jeder Takt schreibt den Satz vollständig neu mit `clean: false` (D5); unlesbarer Inhalt wird als `null` zurückgegeben, Fehler werden geschluckt (FR-011)
- [X] T012 [US1] `'server_outage'` an `AttentionKind` in `packages/shared/src/types.ts` (Zeile 222–232) anhängen — kein Migrationsschritt nötig, `attention.kind` ist `TEXT` ohne `CHECK` (C4)
- [X] T013 [P] [US1] `server_outage: { label: 'Server-Ausfall', icon: '🕳', tone: 'text-red-400' }` in `KIND_META` in `packages/web/src/components/AttentionInbox.tsx` (Zeile 8–19) ergänzen — der `Record<AttentionKind, …>` erzwingt den Eintrag, ohne ihn ist `pnpm typecheck` rot
- [X] T014 [P] [US1] Expliziten `case 'server_outage': return true;` in `isAttentionValid()` in `packages/server/src/services/attentionReconciler.ts` (Zeile 43–75) ergänzen und in `findStaleOnBoot()` (Zeile 89–99) sicherstellen, dass die Art nicht in den pauschalen Stale-Zweig von `awaiting_input`/`agent_errored` fällt — mit deutschem Kommentar, warum ein Ausfall keinen „aktiven Zustand" hat (D14, C4.6/C4.7)
- [X] T015 [US1] `packages/server/src/services/attentionReconciler.test.ts` um zwei Fälle erweitern: `findStaleRuntime()` löst `server_outage` nie auf, `findStaleOnBoot()` löst `server_outage` nie auf (C4.6, C4.7)
- [X] T016 [US1] `packages/server/src/services/outageMonitor.ts` anlegen: `detectOnBoot()` genau in der Reihenfolge aus C4 — `rotateIfNeeded()`, `append(startup)`, `listRunning()` lesen, `detectOutage(heartbeat, now)`, bei `outage`/`undetermined` `append(outage)` mit `silent` aus `tail()` (kein Abgangseintrag zum letzten `startup` → `silent: true`), `attention.raise('server_outage')` je Projekt mit betroffenen Läufen, dann `heartbeatStore.write()` (D4); dazu der Takt per `setInterval(…, HEARTBEAT_INTERVAL_MS).unref()`, `markClean()` für den geordneten Abgang und ein `lastOutage`-Zugriff für FR-023 (D13)
- [X] T017 [US1] Verdrahtung in `packages/server/src/index.ts`: `instanceId` (nanoid) und `startedAt` erzeugen, `OperationsLog`/`HeartbeatStore`/`OutageMonitor` nach dem Aufbau der Repos (Zeile 44–54) bauen, `outageMonitor.detectOnBoot()` **vor** `orchestrator.reapOnBoot()` (Zeile 147) aufrufen, den Takt starten und in `shutdown()` (Zeile 223–236) `clearInterval` + `heartbeatStore.markClean()` vor `db.close()` ergänzen — vertauschte Reihenfolge zählt null betroffene Läufe (D3, C4)
- [X] T018 [US1] Aufklappbare Zeile für `server_outage` in `packages/web/src/components/AttentionInbox.tsx`: der Meldungstext wird auf Klick vollständig gezeigt statt per `truncate` abgeschnitten, sodass Beginn, Ende, Dauer und betroffene Features lesbar sind; ohne `featureId`/`conversationId` bleibt es beim Erledigt-Haken (C4.8, C4.9, US1-2)
- [X] T019 [US1] Abnahme nach quickstart.md Teil A und B1–B3 auf der eigenen Testinstanz (`SDD_PORT=4899`, eigenes `SDD_DATA_DIR`): `pnpm --filter @sdd/shared test`, `pnpm --filter @sdd/server test`, dann `lsof -ti:4899 | xargs kill -9` → Neustart → Meldung mit Zeitfenster; **niemals** `pkill` mit generischem Muster (CLAUDE.md)

**Checkpoint**: US1 trägt allein die geforderte Abnahme — `kill -9` → Neustart → Meldung. SC-001,
SC-002, SC-003 und SC-009 sind erfüllt.

---

## Phase 4: User Story 2 - Nachlesen, wie der Server gegangen ist (Priority: P2)

**Goal**: Jeder erreichbare Abgang hinterlässt einen datierten Eintrag in `operations.jsonl` mit
unterscheidbarem Anlass — geordnetes Herunterfahren mit Signal und Laufzeit, unbehandelter Fehler mit
Beschreibung, sonstiges Prozessende mit Rückgabewert. Ein stiller Abgang wird beim nächsten Start
nachgetragen.

**Independent Test**: Instanz nacheinander mit `SIGINT`, mit `SIGTERM` und hart beenden; das
Protokoll enthält für die ersten beiden je einen Eintrag mit unterschiedlichem Signal, für den
dritten belegt das Fehlen zusammen mit dem `outage`-Eintrag den stillen Abgang. Ablauf in
quickstart.md B4–B8.

- [X] T020 [US2] Signal an `shutdown()` in `packages/server/src/index.ts` durchreichen (`process.on('SIGINT'|'SIGTERM'|'SIGHUP')`, Zeile 237–238) und dort `operationsLog.appendFarewell({ kind:'shutdown', signal, uptimeMs })` **vor** `db.close()` schreiben — SIGINT und SIGTERM laufen beide durch den geordneten Pfad, unterscheidbar bleiben sie über das mitgeführte Signal (D8, US2-1, US2-2)
- [X] T021 [US2] `process.on('exit')` in `packages/server/src/index.ts` ergänzen: `appendFarewell({ kind:'exit', exitCode, uptimeMs })` — synchron, weil `'exit'` asynchrone Arbeit verwirft; das Once-Flag verhindert die Dublette aus `shutdown()` → `process.exit(0)` → `'exit'` (C2.2, C2.7)
- [X] T022 [US2] Fatal-Guard in `packages/server/src/index.ts` (Zeile 244–249) um `operationsLog.append({ kind:'uncaught', error })` erweitern, Fehlerbeschreibung auf 2000 Zeichen gekürzt; der Guard beendet den Server weiterhin **nicht** und der Eintrag ist kein Abgang — das Once-Flag bleibt unberührt (C2.3, FR-013)
- [X] T023 [US2] `silent`-Unterscheidung in `packages/server/src/services/outageMonitor.ts` schärfen: existiert zum letzten `startup` ein `shutdown`- oder `exit`-Eintrag, wird `silent: false` festgehalten, sonst `silent: true` mit nachgetragenem stillem Abgang (C2.4, FR-014)
- [X] T024 [US2] Tests in `packages/server/src/services/outageMonitor.test.ts` und `packages/server/src/services/operationsLog.test.ts` ergänzen: `shutdown` mit Signal und `uptimeMs`, `uncaught` mit gekürzter Beschreibung, `exit` mit Rückgabewert, `silent: false` bei vorhandenem Abgangseintrag, `silent: true` ohne, sowie Zuordnung von `startup` und Abgang je `instanceId` in zeitlicher Reihenfolge (US2-5, FR-015)
- [ ] T025 [US2] Abnahme nach quickstart.md B4–B8 auf der eigenen Testinstanz: geordnetes Herunterfahren (`clean: true`, kein Ausfall beim Neustart), `SIGTERM`-Eintrag, je Instanz genau ein Abgangseintrag, Protokoll ohne laufenden Server über `tail -5` lesbar, schreibgeschütztes Datenverzeichnis (`chmod a-w`) beeinträchtigt Start, Betrieb und Abgang nicht

**Checkpoint**: US1 und US2 funktionieren unabhängig. SC-004 und SC-005 sind erfüllt.

---

## Phase 5: User Story 3 - Ressourcendruck sehen, bevor die Maschine kippt (Priority: P3)

**Goal**: Freier Plattenplatz, Auslastung des Auslagerungsspeichers, Zahl gleichzeitig arbeitender
Features und der letzte registrierte Ausfall stehen dauerhaft in der Kopfleiste — bei knappem Platz
als Warnung, nicht ermittelbare Kennzahlen als `–` statt geraten.

**Independent Test**: Oberfläche öffnen, Kopfleiste rechts lesen; `curl` auf
`/api/system/status` liefert die Form aus C3 mit `collectedAt` höchstens 30 s alt. Für die Warnung
wird `DISK_WARN_BYTES` testweise angehoben. Ablauf in quickstart.md Teil C.

### Tests für User Story 3

- [X] T026 [P] [US3] `packages/shared/src/resourcePressure.test.ts`: Level `warn` unter 2 GB, `notice` unter 10 GB oder ab 80 % Swap, sonst `ok`; `null`-Kennzahlen gehen **nicht** in die Bewertung ein (Unwissen ist keine Warnung, FR-022); Kurzform mit `–` für Unbekanntes, ohne den Teil `<n> parallel` bei weniger als zwei Features, Plattenplatz mit einer Nachkommastelle ab GB und ganzzahlig in MB darunter; `notice` gesetzt bei Druck **und** Parallelität, sonst `null` (US3-4)
- [X] T027 [P] [US3] `packages/server/src/services/resourceMonitor.test.ts`: Parser der `sysctl vm.swapusage`-Zeile (`total = 6144.00M  used = 4555.38M  free = 1588.62M  (encrypted)`), Degradation einzelner Kennzahlen zu `null` ohne die übrigen zu unterdrücken (`Promise.allSettled`, C3.7), 10-s-Cache liefert denselben `collectedAt` (C3.2), Zählung gleichzeitig arbeitender Features über verschiedene `feature_id` bzw. `project_id` bei Chat-Läufen (D12)

### Implementierung für User Story 3

- [X] T028 [US3] `ResourceSnapshot` (`diskFreeBytes`, `diskTotalBytes`, `swapUsedRatio`, `swapUsedBytes`, `swapTotalBytes`, `activeFeatures`, `collectedAt` — jede Kennzahl einzeln `null`-fähig) und `SystemStatus` (`resources`, `pressure`, `lastOutage`) in `packages/shared/src/types.ts` ergänzen
- [X] T029 [US3] `packages/shared/src/resourcePressure.ts` anlegen: Konstanten `DISK_NOTICE_BYTES`, `DISK_WARN_BYTES`, `SWAP_NOTICE_RATIO`, `PARALLEL_NOTICE`, Typen `PressureLevel`/`PressureVerdict` sowie die reine Bewertung mit Kurzform und Hinweistext — die Oberfläche entscheidet keine Schwellen selbst (C3.5, D16)
- [X] T030 [US3] `export * from './resourcePressure.js';` in `packages/shared/src/index.ts` ergänzen
- [X] T031 [US3] `packages/server/src/services/resourceMonitor.ts` anlegen: `snapshot()` erhebt `fs.promises.statfs(dataDir)` → `bavail * bsize` (D9), auf `darwin` `execFile('sysctl', ['-n','vm.swapusage'])` mit 2-s-Timeout und exportiertem reinem Parser, sonst `null` (D10), `activeFeatures` über `ExecutionRepo.listRunning()` (D12); alles über `Promise.allSettled`, 10-s-Cache, kein Hintergrund-Timer, jeder Aufruf in `try/catch` (D11, C3.6, FR-024)
- [X] T032 [US3] `GET /api/system/status` in `packages/server/src/api/server.ts` registrieren (`ApiDeps` um `resourceMonitor` und `outageMonitor` erweitern, Zeile 90–114): Antwort aus `snapshot()`, der reinen Bewertung und `outageMonitor.lastOutage` (`null`, wenn kein Ausfall im Protokoll steht); antwortet immer `200`, auch wenn jede Kennzahl fehlschlägt (C3.1, C3.4, FR-023)
- [X] T033 [US3] `ResourceMonitor` in `packages/server/src/index.ts` bauen und samt `outageMonitor` an `buildServer({ … })` (Zeile 186–217) übergeben
- [X] T034 [P] [US3] `systemStatus: () => request<SystemStatus>('GET', '/api/system/status')` in `packages/web/src/api.ts` (Objekt `api`, ab Zeile 171) ergänzen; `SystemStatus` aus `@sdd/shared` importieren statt den Typ zu duplizieren
- [X] T035 [US3] `packages/web/src/components/SystemStatus.tsx` anlegen: kompakte Kurzform als Icon-Schaltfläche, bei `warn`/`notice` eingefärbt, Aufklapp-Feld mit Einzelwerten, Erhebungszeitpunkt und letztem registriertem Ausfall (Zeitfenster und Dauer, auch wenn folgenlos); Polling alle 20 s nach dem Vorbild `WorktreeOverview.tsx:104` (D17, US3-6, C3.3)
- [X] T036 [US3] `SystemStatus` in die Kopfleiste von `packages/web/src/App.tsx` einsetzen — in den rechten Block neben `ThemeToggle` und `AutomationDial` (Zeile 105–124), damit die Warnung sichtbar ist, bevor ein weiteres Feature gestartet wird (SC-007)
- [ ] T037 [US3] Abnahme nach quickstart.md Teil C: Sichtbarkeit in der Kopfleiste und `curl` auf `/api/system/status`, Warnschwelle testweise anheben und **zurücksetzen**, nicht ermittelbare Swap-Kennzahl erscheint als `–`, letzter Ausfall bleibt nach dem Erledigen der Meldung ablesbar

**Checkpoint**: Alle drei Stories funktionieren unabhängig. SC-006 und SC-007 sind erfüllt.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T038 `pnpm typecheck` und `pnpm -r test` im Repo-Stamm grün — die `AttentionKind`-Erweiterung erzwingt Folgestellen, die der Typecheck findet (data-model.md „Folgeänderungen")
- [ ] T039 Lastmessung nach quickstart.md Teil D: Prozessorlast der Testinstanz im Leerlauf über 60 s im Mittel unter 1 %, Startverzögerung höchstens 200 ms — gemessen am Abstand zwischen dem `startup`-Eintrag in `operations.jsonl` und der Konsolenzeile „sdd-toolkit Server läuft auf …" (SC-008)
- [ ] T040 Abdeckung gegenprüfen: jede Zeile der Tabelle „Abdeckungsübersicht" in quickstart.md und jeder der sechs FR-026-Fälle ist einem tatsächlich existierenden Testfall oder Abnahmeschritt zugeordnet; Lücken als Aufgabe nachtragen statt abhaken
- [ ] T041 Abnahme-Instanz abräumen: `lsof -ti:4899 | xargs kill`, `rm -rf "$SDD_DATA_DIR"`, danach prüfen, dass die reguläre Toolkit-Instanz auf 4820/4830 unberührt weiterläuft (`lsof -ti:4820`) — **kein** `pkill`/`killall` mit generischem Muster (CLAUDE.md, quickstart.md Warnblock)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeit
- **Foundational (Phase 2)**: nach Setup — **blockiert alle Stories**
- **User Stories (Phase 3–5)**: alle nach Phase 2; danach parallel oder in Prioritätsfolge P1 → P2 → P3
- **Polish (Phase 6)**: nach den gewünschten Stories

### User Story Dependencies

- **US1 (P1)**: nach Phase 2. Keine Abhängigkeit auf US2 oder US3. Trägt die geforderte Abnahme allein.
- **US2 (P2)**: nach Phase 2. Nutzt `OperationsLog` aus Phase 2 und schärft in T023 den `silent`-Fall des `outageMonitor` aus US1 — ohne US1 sind T020–T022 und T024 trotzdem lauffähig; T023 setzt US1 (T016) voraus.
- **US3 (P3)**: nach Phase 2. `lastOutage` in T032 kommt aus `outageMonitor` (US1, T016); ohne US1 liefert das Feld schlicht `null`, die übrigen Kennzahlen funktionieren unabhängig.

### Innerhalb der Stories

- Tests zuerst schreiben und rot laufen lassen
- Reine Module (`packages/shared/`) vor den Diensten, die sie aufrufen
- Dienste vor der Verdrahtung in `index.ts` und vor den HTTP-Routen
- Oberfläche zuletzt

### Kritische Reihenfolge (kein [P], nicht vertauschbar)

- T002 vor T004 (`OperationsLog` nutzt `OperationsEntry`)
- T009 vor T016 (`outageMonitor` ruft `detectOutage`/`outageMessage`)
- T011 und T016 vor T017 (Verdrahtung braucht beide Dienste)
- **T017: `detectOnBoot()` vor `orchestrator.reapOnBoot()`** — vertauscht zählt der Ausfall null betroffene Läufe; der wahrscheinlichste Regressionsfehler dieses Features, festgehalten durch T008
- T012 vor T013 und T014 (der erweiterte `AttentionKind` erzwingt beide Stellen; bis dahin ist `pnpm typecheck` rot)
- T013 vor T018 (dieselbe Datei `AttentionInbox.tsx`)
- T029 vor T032 (die Route leitet `pressure` aus dem reinen Modul ab)
- T031 und T032 vor T033 (Verdrahtung braucht Dienst und Route)
- T020, T021, T022 nacheinander (alle in `index.ts`)

### Parallel Opportunities

- **Phase 2**: T003 und T004 parallel (verschiedene Dateien) — beide nach T002
- **US1**: die drei Testaufgaben T006, T007, T008 parallel; später T013 und T014 parallel (Web bzw. Server)
- **US3**: T026 und T027 parallel; T034 parallel zu T031/T032 (Web gegen Server)
- **Zwischen Stories**: nach Phase 2 können US1, US2 und US3 von verschiedenen Bearbeitern gleichzeitig gemacht werden — Kollisionen gibt es nur in `packages/server/src/index.ts` (T017 gegen T020–T022 gegen T033) und in `types.ts` (T012 gegen T028)

---

## Parallel Example: User Story 1

```bash
# Die drei Testaufgaben zuerst und gemeinsam:
Task: "T006 packages/shared/src/outage.test.ts — C1.1–C1.5, Dauerformat, Meldungstext"
Task: "T007 packages/server/src/services/heartbeatStore.test.ts — atomar, unlesbar, markClean"
Task: "T008 packages/server/src/services/outageMonitor.test.ts — Startreihenfolge, je Projekt eine Meldung"

# Nach T012 (AttentionKind) die beiden erzwungenen Folgestellen gemeinsam:
Task: "T013 KIND_META-Eintrag in packages/web/src/components/AttentionInbox.tsx"
Task: "T014 expliziter case in packages/server/src/services/attentionReconciler.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T026 packages/shared/src/resourcePressure.test.ts — Schwellen, Kurzform, null-Degradation"
Task: "T027 packages/server/src/services/resourceMonitor.test.ts — Swap-Parser, allSettled, Cache"
```

---

## Implementation Strategy

### MVP First (nur User Story 1)

1. Phase 1: Setup (T001)
2. Phase 2: Foundational (T002–T005) — blockiert alles
3. Phase 3: User Story 1 (T006–T019)
4. **STOP und PRÜFEN**: quickstart.md Teil A und B1–B3 — `kill -9` → Neustart → Meldung
5. Damit ist die in der Spec geforderte Abnahme erfüllt; US2 und US3 sind Zugabe

### Incremental Delivery

1. Setup + Foundational → Fundament steht
2. US1 → einzeln prüfen → MVP, SC-001/002/003/009
3. US2 → einzeln prüfen → SC-004/005
4. US3 → einzeln prüfen → SC-006/007
5. Polish → SC-008 und Abdeckungsabgleich

### Parallel Team Strategy

Nach Phase 2 parallel: Bearbeiter A übernimmt US1, B übernimmt US2, C übernimmt US3. Die einzigen
gemeinsamen Dateien sind `packages/server/src/index.ts` und `packages/shared/src/types.ts` — dort
nacheinander arbeiten oder US1 vorziehen, weil sie beide Dateien ohnehin anfasst.

---

## Notes

- `[P]` bedeutet: andere Datei, keine Abhängigkeit auf eine unfertige Aufgabe
- Jeder neue Schreibvorgang liegt in `try/catch` — kein Lebenszeichen und kein Protokolleintrag darf den Server beenden (FR-011, FR-017, FR-024); genau der Zustand „Platte voll" ist der, in dem das Feature gebraucht wird
- Deutsche Prosa in Kommentaren, englische Bezeichner (Repo-Konvention)
- Reine Logik in `@sdd/shared` bekommt `now` als Parameter und liest nie `Date.now()` (D16, FR-025)
- Für jede Abnahme eigene Ports (4899/4898) und ein eigenes `SDD_DATA_DIR`; beendet wird über `lsof -ti:<port>` oder die gemerkte PID — `pkill`/`killall` mit generischem Muster reisst die laufende Toolkit-Instanz und die eigene Session mit (CLAUDE.md)
- Nach jeder Aufgabe oder Gruppe committen; an jedem Checkpoint kann die Story einzeln geprüft werden
