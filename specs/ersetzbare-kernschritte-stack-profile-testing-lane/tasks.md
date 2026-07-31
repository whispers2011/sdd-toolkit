---
description: "Aufgabenliste für die Umsetzung: Ersetzbare Kernschritte, Stack-Profile und Testing-Lane"
---

# Tasks: Ersetzbare Kernschritte, Stack-Profile und Testing-Lane

**Input**: Entwurfsdokumente aus `specs/ersetzbare-kernschritte-stack-profile-testing-lane/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Tests sind Teil des Auftrags. Die Spec fordert sie ausdrücklich (SC-007 „nachgewiesen
durch automatisierte Tests"), der Constitution Check des Plans macht sie zum Gate, und das
Repo-Muster (`*.test.ts` neben dem Modul, vitest 3) gilt unverändert. Testaufgaben stehen deshalb
je Story **vor** der Implementierung.

**Organisation**: Aufgaben sind nach User Story gruppiert, damit jede Story unabhängig umgesetzt und
geprüft werden kann.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel ausführbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: zugehörige User Story (US1–US5)
- Jede Beschreibung nennt den genauen Dateipfad

## Pfadkonventionen

pnpm-Monorepo mit drei Paketen (Structure Decision des Plans, unverändert):

- `packages/shared/src/` — pure Typen und Funktionen, ohne IO
- `packages/server/src/` — API, Services, DB, git, pty
- `packages/web/src/` — React-SPA

## Durchgehende Regeln (gelten für **jede** Aufgabe)

- **Kein Prozess-Kill über Namensmuster.** `pkill`/`killall` kommen im Code, in Tests und in
  Kommandobeispielen nicht vor — beendet wird ausschließlich die **eigene** Prozessgruppe über die
  gemerkte PID (FR-040/FR-041, `CLAUDE.md` global + Projekt).
- **Eigene Test-Instanz auf eigenen Ports.** 4820/4830 gehören der laufenden Toolkit-Instanz;
  eigene Läufe nutzen einen eigenen Port und ein eigenes `SDD_DATA_DIR`
  ([quickstart.md §0](./quickstart.md)).
  **Vor dem Start prüfen, ob der Port wirklich frei ist** (`lsof -ti:<port>`) — 4899 aus der
  quickstart.md ist nicht reserviert, dort lief am 31.07.2026 die Test-Instanz eines
  Nachbar-Worktrees. Abgeräumt wird nur ein Port, den man selbst nachweislich gebunden hat;
  sonst trifft `lsof -ti:<port> | xargs kill` einen fremden Prozess — derselbe Fehler wie ein
  `pkill` ohne Port, nur mit anderem Werkzeug.
- **Keine neuen Runtime-Dependencies.** Portprüfung und Statusprobe über `node:net`, Größe über
  `du -sk` via `node:child_process`.
- **Nichts wird in Kommandotexte interpoliert.** Kontext ausschließlich über Umgebungsvariablen.
- **Deutsche UI, Symbole als SVG-Icons** aus `components/icons.tsx`; keine Rohbezeichner einer Stufe
  oder eines Profils in einer Zeile — Texte kommen aus den geteilten Katalogen.
- **Jede neue Aktion** läuft über `actionPolicy.evaluateAction()` und wird serverseitig über
  `ActionGuard` durchgesetzt.

---

## Phase 1: Setup (Gemeinsame Grundlagen)

**Zweck**: Konfigurationswerte, von denen alle weiteren Phasen lesen

- [X] T001 Portbereich- und Plattenkonfiguration in `packages/server/src/config.ts` ergänzen:
  `portRangeStart` (`SDD_PORT_RANGE_START`, Vorgabe 21000), `portRangeEnd`
  (`SDD_PORT_RANGE_END`, Vorgabe 29980), `portBlockSize` (`SDD_PORT_BLOCK_SIZE`, Vorgabe 20) und
  `diskWarnBytes` (`SDD_DISK_WARN_BYTES`, Vorgabe 10 GiB), jeweils mit Zahlenprüfung und
  dokumentiertem Vorgabewert nach dem Muster der bestehenden Einträge (research E2/E15)

---

## Phase 2: Foundational (Blockierende Voraussetzungen)

**Zweck**: Schema, Typen und der **eine** Ausführungspfad — ohne diese Phase kann keine Story beginnen

**⚠️ KRITISCH**: Keine Story-Arbeit vor Abschluss dieser Phase

- [X] T002 Additive Migration am Ende von `MIGRATIONS` in `packages/server/src/db/database.ts`:
  Tabellen `port_blocks` (mit `CREATE UNIQUE INDEX idx_port_blocks_base_live ON port_blocks(base)
  WHERE released_at IS NULL`), `feature_stacks`, `manual_test_decisions` (+ Index auf `feature_id`)
  sowie `ALTER TABLE projects ADD COLUMN stack TEXT NOT NULL DEFAULT '{}'` und
  `ALTER TABLE features ADD COLUMN cleanup_error TEXT` — wortgleich zu
  [data-model.md §11](./data-model.md); kein Seed, kein Backfill
- [X] T003 [P] Additive Typen in `packages/shared/src/types.ts` ergänzen: `PortBlockOwnerKind`,
  `PortBlock`, `STACK_PROFILE_NAMES`/`StackProfileName`, `StackProfile`, `StackService`,
  `StackConfig`, `FeatureStackIntent`, `StackServiceStatus`, `StackServiceView`, `FeatureStackView`,
  `TestingLaneEntry`, `ManualTestDecision`, `WorktreeDiskInfo`; `Project.stack`,
  `Feature.cleanupError`, `WorktreeEntry.sizeBytes` + `WorktreeEntry.portBase`,
  `WorktreeOverview.disk`, `LifecycleContext.portBase` + `LifecycleContext.profile`; `AttentionKind`
  um `manual_test_due | stack_failed | worktree_cleanup_failed | orphan_worktree` erweitern
  (data-model.md §1/§3/§4/§5/§6/§9/§10) — die Stufen- und Schalter-Erweiterung folgt bewusst erst in
  Phase US3, weil sie die vier Kataloge compile-koppelt
- [X] T004 `packages/server/src/db/repos.ts`: `ProjectRepo` liest/schreibt die Spalte `stack` als
  JSON (`'{}'` ⇒ leere `StackConfig`), `FeatureRepo` liest/schreibt `cleanup_error` als
  `cleanupError`; Row-Mapper beider Repos entsprechend erweitern, damit `pnpm -r typecheck` nach T003
  wieder grün ist
- [X] T005 Prozess-Runner nach `packages/server/src/services/stepRunner.ts` (NEU) herausziehen:
  `defaultRunner` aus `services/lifecycleStepService.ts` unverändert übernehmen (Login-Shell
  `$SHELL -l -c`, gestreamtes Log, Tail-Puffer 20 Zeilen / 2000 Zeichen, Zeitlimit) und **genau eine**
  Änderung ergänzen — `spawn(..., { detached: true })` sowie Beenden über
  `process.kill(-child.pid, 'SIGKILL')` bei Zeitüberschreitung, gefasst in `try/catch` und mit
  `pid > 0`-Prüfung (research E6/E12, FR-040/FR-041)
- [X] T006 `packages/server/src/services/lifecycleStepService.ts` auf den herausgezogenen
  `stepRunner` umstellen, ohne Verhaltensänderung; `services/lifecycleStepService.test.ts` muss
  unverändert grün bleiben
- [X] T007 [P] `packages/server/src/services/stepRunner.test.ts` (NEU): Exit-Code 0 und ≠ 0 gegen
  echte triviale Kommandos (`true`, `exit 3`) in einem Temp-Verzeichnis, Zeitlimit gegen `sleep`,
  Tail-Ausschnitt, fehlendes Kommando ⇒ exit 127, und der Nachweis, dass bei Zeitüberschreitung die
  **Kindprozesse** der eigenen Gruppe mitsterben (gestarteter Enkelprozess ist danach fort)

**Checkpoint**: Schema, Typen und ein einziger Ausführungspfad stehen — die Stories können beginnen

---

## Phase 3: User Story 1 - Zwei Features gleichzeitig laufen lassen (Priority: P1) 🎯 MVP

**Goal**: Jeder Worktree bekommt beim Anlegen genau einen exklusiven Portblock, an **einer** Stelle
vergeben, stabil über Läufe und Sitzungen, lesbar aus einer Env-Datei im Worktree und sichtbar in
jedem Lebenszyklus-Schritt als `$SDD_PORT_BASE`.

**Independent Test**: Zwei Features desselben Projekts anlegen, in beiden Worktrees
`cat .sdd/env` lesen und die Blöcke vergleichen (Differenz ≥ `SDD_PORT_SPAN`, keine Überschneidung);
anschließend in beiden einen Schritt „nach Worktree-Anlage" mit
`echo "$SDD_PORT_BASE / $SDD_PROFILE"` laufen lassen und den Log gegen die Env-Datei des **eigenen**
Worktrees halten. Liefert Wert ohne Stack-Profile und ohne Testing-Lane.

### Tests für User Story 1 ⚠️

> **Zuerst schreiben, Fehlschlag bestätigen, dann implementieren.**

- [X] T008 [P] [US1] `packages/shared/src/ports.test.ts` (NEU): `blockStarts()` liefert die
  Kandidatenreihenfolge aus `PortRangeConfig` (Start/Ende/Breite, letzter Blockanfang inklusive),
  `portFor(base, service)` = `base + portOffset`, `stackUrl()` bildet
  `http://localhost:<primary-port>` und liefert `null` ohne Haupteingang — pure Funktionen, kein IO
- [X] T009 [P] [US1] `packages/server/src/db/portRepo.test.ts` (NEU) gegen
  `openMemoryDatabase()`: Block belegen, belegte Blöcke lesen, Freigabe setzt `released_at`, ein
  freigegebener Block ist wieder vergebbar, zwei belegte Blöcke mit derselben `base` verletzen den
  partiellen Index, Blöcke der Besitzerart `project` stehen neben denen der Art `worktree`
- [X] T010 [P] [US1] `packages/server/src/services/portAllocator.test.ts` (NEU) mit injizierter
  Bind-Probe: `ensureFor()` weist genau einmal zu und liefert bei erneutem Aufruf denselben Block
  (FR-004), ein belegter Port im Kandidatenblock verwirft den **ganzen** Block und der nächste freie
  wird genommen (FR-003), erschöpfter Bereich wirft mit klarem Text (FR-010), `release()` gibt frei
  und der Block ist wiederverwendbar (FR-005), `reconcile()` gibt Blöcke nicht mehr existierender
  Verzeichnisse frei; zusätzlich ein Test mit einem **echten**, im Test selbst geöffneten Listener
  gegen die reale Bind-Probe
- [X] T011 [P] [US1] `packages/shared/src/lifecycleSteps.test.ts` erweitern: `buildLifecycleEnv()`
  liefert **acht** Schlüssel, immer alle vorhanden, nicht zutreffende als leerer String;
  `SDD_PORT_BASE` trägt den Blockanfang als Dezimalzahl; `SDD_PROFILE` ist bei einem gewöhnlichen
  Schritt leer; und der Rückwärts-Test „ein Kommando, das die neuen Variablen nicht verwendet, läuft
  unverändert" (FR-008, SC-007)

### Implementierung für User Story 1

- [X] T012 [P] [US1] `packages/shared/src/ports.ts` (NEU): `PORT_DEFAULTS`, `PortRangeConfig`,
  `blockStarts()`, `portFor()`, `stackUrl()` — pure Blockarithmetik ohne IO (research E2)
- [X] T013 [US1] `packages/shared/src/index.ts` um `export * from './ports.js';` erweitern
- [X] T014 [P] [US1] `packages/server/src/db/portRepo.ts` (NEU): Buchführung der Blöcke —
  `list()`, `liveByBase()`, `findByOwner()`, `allocate()`, `release()`, `releaseByOwner()`;
  einzige Klasse mit Schreibzugriff auf `port_blocks`
- [X] T015 [US1] `packages/server/src/services/portAllocator.ts` (NEU): `ensureFor(owner)` mit
  nebenläufiger Bind-Probe über **alle** Ports des Kandidatenblocks (`node:net`,
  `listen({ host: '0.0.0.0', port })`, sofort schließen, Zeitlimit 500 ms je Block), Überspringen
  belegter Blöcke, Wurf bei Erschöpfung; `release(owner)`; `reconcile()` für verwaiste Blöcke
  (research E1/E3, FR-001–FR-005, FR-010)
- [X] T016 [US1] Env-Datei in `packages/server/src/services/portAllocator.ts` ergänzen:
  `<worktree>/.sdd/env` mit den **stabilen** Angaben (`SDD_PORT_BASE`, `SDD_PORT_SPAN`,
  `SDD_WORKTREE`, `SDD_PROJECT`, `SDD_FEATURE`, `SDD_BRANCH`) bei jeder Bereitstellung neu schreiben;
  davor `/.sdd/` idempotent in `$GIT_COMMON_DIR/info/exclude` eintragen und mit
  `git check-ignore -q .sdd/env` **nachprüfen** — scheitert die Prüfung, entsteht eine
  „Braucht dich"-Meldung statt eines stillen Commits (research E4, FR-006/FR-009)
- [X] T017 [US1] `packages/shared/src/lifecycleSteps.ts`: `buildLifecycleEnv()` um `SDD_PORT_BASE`
  und `SDD_PROFILE` erweitern — an **der** einen Stelle, die F1b dafür gebaut hat; kein zweiter Weg,
  kein bestehender Schlüssel ändert Name oder Bedeutung (FR-007/FR-008/FR-018, research E5)
- [X] T018 [US1] `packages/server/src/git/worktrees.ts`: `PortAllocator` injizieren, `create()` ruft
  `ensureFor()` (innerhalb der bestehenden Serialisierung pro Repo/Branch), `remove()` ruft
  `release()` — **ausschließlich** hier, kein Aufruf aus Orchestrator, ChatWorkService,
  MergeQueueService oder einer Route (FR-001, research E1)
- [X] T019 [US1] `packages/server/src/git/worktreesCreate.test.ts` und
  `packages/server/src/git/worktreesLifecycle.test.ts` erweitern: beide Anlagepfade
  (`Orchestrator.prepareWorktree()` und `ChatWorkService.ensureSession()`) sehen denselben Block,
  zwei Worktrees erhalten sich nicht überschneidende Blöcke, `remove()` gibt frei, `.sdd/env` ist
  nach `create()` vorhanden und wird von `git status --porcelain` nicht gezeigt
- [X] T020 [US1] `packages/server/src/services/lifecycleStepService.ts`: den Block des **eigenen**
  Worktrees in den `LifecycleContext` reichen (`portBase`), `profile` bleibt bei gewöhnlichen
  Schritten `null`
- [X] T021 [US1] `packages/server/src/index.ts`: `PortRepo` und `PortAllocator` erzeugen und in
  `WorktreeManager` verdrahten; `reconcile()` einmalig im Boot-Pfad anstoßen

**Checkpoint**: US1 ist unabhängig prüfbar — zwei Features, zwei Blöcke, `$SDD_PORT_BASE` in jedem
Schritt, Env-Datei im Worktree und nicht im Commit

---

## Phase 4: User Story 2 - Nur den Stack bezahlen, den ich gerade brauche (Priority: P1)

**Goal**: Drei benannte Profile (`test`, `full`, `down`) ohne mitgeliefertes Kommando, ausgeführt
über denselben Runner wie die Lebenszyklus-Schritte. `test` läuft ab Beginn von `implement` und
bleibt stehen; der Zustand der Dienste wird **erhoben**, nie behauptet; geteilte Dienste laufen
projektweit genau einmal.

**Independent Test**: Ein Projekt mit den drei Profilkommandos und einer Dienstliste konfigurieren,
ein Feature bis `implement` führen und prüfen, dass ausschließlich die Dienste des `test`-Profils
laufen (Feature-Konsole: „Profil: test", Dienst `● läuft`); danach abbauen und prüfen, dass nichts
zurückbleibt. Unabhängig von der Testing-Lane prüfbar.

**Abhängigkeit**: Phase 2 (stepRunner) und US1 (Portblock + `$SDD_PORT_BASE`/`$SDD_PROFILE`).

### Tests für User Story 2 ⚠️

- [X] T022 [P] [US2] `packages/shared/src/stackProfiles.test.ts` (NEU): `isStackConfigured()`
  (leere `StackConfig` ⇒ `false`), `primaryService()` (genau einer oder `null`),
  `profilesForLaneAction()` liefert je Lane-Aktion die Kommandofolge und das `$SDD_PROFILE`
  ([data-model.md §3](./data-model.md)), `validateStackConfig()` liefert die sechs Prüfsätze wortgleich
  (Abstand im Bereich, Abstände eindeutig, höchstens ein Haupteingang, zustandsbehaftet ⇒
  feature-eigen, `sharedCommand` ohne geteilten Dienst, leeres Kommando)
- [X] T023 [P] [US2] `packages/server/src/db/stackRepo.test.ts` (NEU) gegen `openMemoryDatabase()`:
  Absicht setzen/lesen/löschen in `feature_stacks`, „gibt es ein weiteres Feature des Projekts mit
  Absicht?" als Ableitung (research E7), Entscheidungen in `manual_test_decisions` als **Historie**
  (mehrere Ablehnungen möglich, jüngste zuerst)
- [X] T024 [P] [US2] `packages/server/src/services/stackService.test.ts` (NEU) mit injiziertem
  Runner und injizierter Probe (Muster `AgentGateService`): `up('test')` führt das Kommando einmal
  aus und hält die Absicht fest; erneutes `up` desselben Profils führt **kein** zweites Kommando aus
  (FR-014/FR-015); Fehlschlag ⇒ `stack_failed`-Meldung mit Profil, Kommando, Exit-Code und Tail und
  **keine** festgehaltene Absicht (FR-019); `down` mit zwei Features ⇒ geteiltes Kommando läuft
  **nicht**, mit dem letzten Feature ⇒ es läuft (FR-022); geteiltes Kommando erhält den
  **Projektblock** als `SDD_PORT_BASE`, das feature-eigene den Worktree-Block (research E2/E7);
  `probe()` liefert `up`/`down`/`unknown` aus der Sonde, nie aus der Datenbank (FR-023)

### Implementierung für User Story 2

- [X] T025 [P] [US2] `packages/shared/src/stackProfiles.ts` (NEU): `STACK_PROFILE_META`,
  `isStackConfigured()`, `primaryService()`, `profilesForLaneAction()`, `validateStackConfig()` —
  pure Funktionen, damit Server und Oberfläche denselben Satz zeigen
- [X] T026 [US2] `packages/shared/src/index.ts` um `export * from './stackProfiles.js';` erweitern
- [X] T027 [P] [US2] `packages/server/src/db/stackRepo.ts` (NEU): `feature_stacks` (Absicht setzen,
  lesen, löschen, „weitere Absicht im Projekt?") und `manual_test_decisions` (anlegen, jüngste je
  Feature lesen)
- [X] T028 [US2] `packages/server/src/services/stackService.ts` (NEU), Grundgerüst: `up()`, `stop()`,
  `restart()`, `down()` über den `stepRunner` aus Phase 2, Umgebung ausschließlich über
  `buildLifecycleEnv()` mit gesetztem `SDD_PROFILE`, Arbeitsverzeichnis = Worktree des Features,
  Bewertung ausschließlich über Exit-Code und Zeitlimit, Buchung als Execution der Art
  `lifecycle_step` mit `label: "Stack: <profil>"` und ohne Verbrauchswert
  ([contracts/stack-profiles.md §4/§5](./contracts/stack-profiles.md))
- [X] T029 [US2] `packages/server/src/services/stackService.ts`: geteilte Dienste — geteiltes
  Kommando **vor** dem feature-eigenen beim Hochfahren und **danach** beim Abbau, serialisiert pro
  `(projectId, 'shared')` nach dem `serialize()`-Muster des `WorktreeManager`, Hochfahren nur wenn
  die geteilten Dienste nicht erreichbar sind, Abbau nur wenn kein weiteres Feature des Projekts
  eine Absicht hat; das geteilte Kommando erhält den Projektblock aus dem `PortAllocator`
  (FR-020/FR-022, research E7)
- [X] T030 [US2] `packages/server/src/services/stackService.ts`: `probe()` — nebenläufige TCP-Probe
  auf `portBase + portOffset` je Dienst (`node:net`, 300 ms Verbindungs-Zeitlimit, 3-s-Cache),
  Ergebnis als `FeatureStackView` mit `configured`, `profile`, `portBase`, `url` (nur wenn der
  Haupteingang antwortet), `services[]` und `collectedAt` (FR-023/FR-031/FR-033, research E8)
- [X] T031 [US2] `packages/server/src/services/stackService.ts`: Fehlschlag ⇒ `stack_failed`-Meldung
  über die bestehende `AttentionRepo.raise()` mit Profil/Anlass, Kommando, Exit-Code und den letzten
  20 Ausgabezeilen; ein erfolgreicher Lauf desselben Profils löst offene Meldungen des Features auf
  (FR-019)
- [X] T032 [US2] `packages/server/src/services/attentionReconciler.ts`: Gültigkeitsregel für
  `stack_failed` nach dem Muster `lifecycle_step_failed` — **kein** Eintrag in `STAGE_FOR_KIND`,
  damit kein `setStage()` sie stillschweigend abräumt
- [X] T033 [US2] `packages/server/src/services/orchestrator.ts`: `test`-Profil im
  before-phase-Vorlauf (`runBeforePhaseGate`) bei Beginn der Phase `implement` betreiben —
  **vor** den Lebenszyklus-Schritten und **vor** dem Agent-Gate; Fehlschlag ⇒ die Phase startet
  nicht und bleibt `idle`; keine Wirkung, wenn die Absicht bereits steht (FR-014, research E9)
- [X] T034 [US2] `packages/server/src/services/orchestrator.test.ts` erweitern: Reihenfolge
  „Stack vor Schritten vor Agents", zweiter und dritter Lauf desselben Features lösen **keinen**
  weiteren Profillauf aus (SC-006), Fehlschlag hält die Phase, und ein Projekt **ohne**
  Stack-Konfiguration erzeugt null zusätzliche Executions und null zusätzliche Spawns (FR-013,
  SC-010)
- [X] T035 [US2] `down`-Profil an den restlichen Anlässen anstoßen: Session-Ende im
  `packages/server/src/services/orchestrator.ts` sowie Archivieren und Löschen eines Features
  (`Orchestrator.archive()`, `MergeQueueService.deleteFeature()`) — Fehlschlag meldet sich, der
  Vorgang läuft weiter (FR-017, Edge Case „archiviert ohne Merge")
- [X] T036 [US2] `GET /api/features/:id/stack` in `packages/server/src/api/server.ts` (mit
  `refresh=1`); ohne Portblock oder ohne Konfiguration antwortet die Route
  `{ configured: false, profile: null, portBase: null, url: null, services: [], collectedAt }` —
  kein 409, Lesen ist immer erlaubt ([contracts/http-api.md](./contracts/http-api.md))
- [X] T037 [US2] `PUT /api/projects/:id` in `packages/server/src/api/server.ts` um `stack:
  StackConfig` erweitern; serverseitige Validierung über `validateStackConfig()` aus T025, Verstoß
  ⇒ **400** mit demselben Satz, den die Oberfläche zeigt; `{}` ist gültig und bedeutet „kein Stack"
- [X] T038 [US2] `packages/server/src/api/server.test.ts` erweitern: `GET …/stack` mit und ohne
  Konfiguration, `PUT /api/projects/:id` mit gültiger und mit ungültiger `StackConfig`
  (zustandsbehaftet + geteilt ⇒ 400 mit dem erwarteten Satz)
- [X] T039 [US2] `packages/server/src/index.ts`: `StackRepo` und `StackService` erzeugen und in
  `Orchestrator`, `MergeQueueService` und die Routen verdrahten
- [X] T040 [P] [US2] `packages/web/src/api.ts`: `featureStack(featureId, refresh?)` und
  `stackAction(featureId, action, body?)`
- [X] T041 [P] [US2] `packages/web/src/components/icons.tsx`: `StackIcon` als SVG ergänzen (keine
  Emojis)
- [X] T042 [US2] `packages/web/src/components/StackPanel.tsx` (NEU): Dienstliste (Name, Port, Status
  als Punkt `● läuft` / `○ aus` / `◌ unbekannt`, Kennzeichnung `geteilt` und `Daten`), betriebenes
  Profil, Erhebungsstand, Aktualisieren-Knopf und die vier Stack-Aktionen; jede Schaltfläche rendert
  das Ergebnis von `actionPolicy.evaluateAction()` (gesperrt **mit sichtbarem Grund**)
- [X] T043 [US2] `packages/web/src/components/FeatureConsole.tsx`: Feld „Stack" über `StackPanel`
  einhängen — ab Beginn von `implement` sichtbar, davor eingeklappt; ohne Konfiguration der Satz
  „Kein Stack konfiguriert — Profile in den Projekt-Einstellungen hinterlegen." (FR-013, research E13)
- [X] T044 [US2] `packages/web/src/components/ProjectSettings.tsx`: Abschnitt „Stack-Profile" mit
  drei Blöcken (Kommando, Kommando für geteilte Dienste, Zeitlimit), dem optionalen Kommando zum
  Anhalten und der Dienstliste als Tabelle (Name, Abstand, Betriebsart, zustandsbehaftet,
  Haupteingang) samt Beispielport neben jedem Abstand; Kopfzeile bei leerer Konfiguration nach
  [contracts/ui-contract.md §4](./contracts/ui-contract.md)

**Checkpoint**: US1 **und** US2 laufen unabhängig — `test` steht ab `implement`, der Status wird
erhoben, ein Projekt ohne Konfiguration verhält sich wie vorher

---

## Phase 5: User Story 3 - Ein Feature vor dem Merge von Hand ausprobieren (Priority: P1)

**Goal**: Eine neue Integrationsstufe `awaiting_manual_test` **vor** `awaiting_human_review`,
geschaltet über `manualTestGate`, und eine Testing-Lane, in der ein Mensch alle fünf Angaben in
einer Ansicht sieht, den vollen Stack bedient und die Abnahme bestätigt oder ablehnt.

**Independent Test**: Ein Feature mit eingeschaltetem Gate durch die Verifikation führen, die
Testing-Lane öffnen und die angezeigte Adresse anklicken; prüfen, dass die Anwendung genau dieses
Features erscheint. Mit zwei Features gleichzeitig wiederholen (SC-002).

**Abhängigkeit**: US1 (Portblock/URL) und US2 (Profile, Statuserhebung).

### Tests für User Story 3 ⚠️

- [X] T045 [P] [US3] `packages/shared/src/workflowModel.test.ts` erweitern: Exhaustiveness für
  `INTEGRATION_STAGE_META['awaiting_manual_test']` (Ton `human`), `AUTOMATION_META.manualTestGate`,
  Gleichheit der IDs aus `INTEGRATION_STEPS` und `INTEGRATION_STAGE_IDS` inklusive `manual_test`,
  sowie `LEVEL2_DEFAULTS.manualTestGate === true` / `LEVEL3_DEFAULTS.manualTestGate === false`
  (FR-026)
- [X] T046 [P] [US3] `packages/shared/src/actionPolicy.test.ts` erweitern: `STAGE_CLASS`-Eintrag
  `decision` mit `DECISION_REASON['awaiting_manual_test']`, und die Matrix der sechs neuen Aktionen
  (`manual_test_confirm`, `manual_test_reject`, `stack_up`, `stack_stop`, `stack_restart`,
  `stack_down`) über alle Stufen — jede Sperrung mit ihrem Grund aus
  [contracts/http-api.md](./contracts/http-api.md)
- [X] T047 [P] [US3] `packages/server/src/services/testingLaneService.test.ts` (NEU): Lane-Einträge
  tragen die fünf Pflichtangaben (SC-009), `confirm()` scheitert mit 409 auf jeder anderen Stufe und
  führt sonst nach `autoMerge ? queued : awaiting_human_review`, `reject()` verlangt einen Grund,
  setzt `integration = 'none'`, öffnet die letzte Phase wieder und hält die Entscheidung fest;
  Projekt ohne Stack ⇒ `configured: false`, `url: null`, keine Meldung

### Implementierung für User Story 3

- [X] T048 [US3] `packages/shared/src/types.ts`: `IntegrationStage` um `'awaiting_manual_test'`
  (zwischen `gate_failed` und `awaiting_human_review`), `INTEGRATION_STAGE_IDS` um `'manual_test'`,
  `AutomationSettings` um `manualTestGate: boolean` erweitern; `LifecycleStageId` um `'manual_test'`
  (data-model.md §7/§8)
- [X] T049 [US3] `packages/shared/src/workflowModel.ts`: `INTEGRATION_STAGE_META` um
  `{ label: 'wartet auf manuelle Abnahme', tone: 'human' }`, `INTEGRATION_STEPS` um den Schritt
  `manual_test` (`label: 'Manuelle Abnahme'`, `requires: 'manualTestGate'`, leeres `humanUnless`)
  zwischen `review_gate` und `human_review`, `AUTOMATION_META.manualTestGate` mit dem Hilfetext aus
  [contracts/ui-contract.md §5](./contracts/ui-contract.md), sowie `LEVEL2_DEFAULTS` (an) und
  `LEVEL3_DEFAULTS` (aus) (FR-024–FR-026, research E10)
- [X] T050 [US3] `packages/shared/src/actionPolicy.ts`: `STAGE_CLASS['awaiting_manual_test'] =
  'decision'` und passender `DECISION_REASON`-Eintrag; `FeatureActionId` um die sechs neuen Aktionen
  und `FeatureActionContext` um `stackConfigured` und `stackRunning` erweitern; Bewertungsregeln
  der sechs Aktionen mit den Sperrgründen aus dem HTTP-Vertrag
- [X] T051 [US3] `packages/server/src/services/actionGuard.ts`: `buildContext()` um
  `stackConfigured` und `stackRunning` erweitern (Quelle: `StackService`/Projekt-Konfiguration), damit
  jede Bedingung serverseitig durchgesetzt wird und nicht nur in der Oberfläche steht
- [X] T052 [US3] `packages/server/src/services/testingLaneService.ts` (NEU): Lane-Einträge je Projekt
  (`awaitingManualTest` = Features auf der Stufe, `running` = Features mit betriebenem Stack ohne die
  Stufe), `confirm()` (Entscheidung festhalten → `after_stage manual_test`-Schritte →
  `manual_test_due` auflösen → `autoMerge ? queued : awaiting_human_review`) und `reject()`
  (Entscheidung mit Grund → `integration = 'none'` → `reopenLastPhase` → Grund als Prompt in die
  Feature-Konsole → Meldung auflösen), jeweils **ohne** automatischen Integrationsstart (FR-028/FR-029)
- [X] T053 [US3] `packages/server/src/services/mergeQueueService.ts`: `beginIntegration()` hält nach
  bestandenem Review-Gate auf `awaiting_manual_test`, wenn `resolveAutomation().manualTestGate` beim
  **Durchlauf** an ist; ist das Gate aus, bleibt der Ablauf unverändert; es gibt **keinen** Übergang
  `awaiting_human_review → awaiting_manual_test` (FR-024/FR-027, Edge Case)
- [X] T054 [US3] `packages/server/src/services/mergeQueueService.test.ts` erweitern: Gate an ⇒ Halt
  auf der neuen Stufe **vor** dem Review; Gate aus ⇒ Ablauf unverändert; ein Feature auf
  `awaiting_human_review` wird durch das Einschalten des Gates **nicht** zurückgeschoben
- [X] T055 [US3] `packages/server/src/services/attentionReconciler.ts`: `manual_test_due` mit
  Eintrag in `STAGE_FOR_KIND` (`→ 'awaiting_manual_test'`), damit die Meldung mit dem Stufenwechsel
  verschwindet; Nachricht mit Feature und Adresse nach
  [contracts/ui-contract.md §8](./contracts/ui-contract.md)
- [X] T056 [US3] `packages/server/src/api/testingLaneRoutes.ts` (NEU) nach dem Vorbild
  `worktreeRoutes.ts`: `GET /api/testing-lane` mit `projectId` (Pflicht) und `refresh=1`, Antwort
  wortgleich zum Beispiel in [contracts/http-api.md](./contracts/http-api.md)
- [X] T057 [US3] `POST /api/features/:id/stack/:action` (`up | stop | restart | down`) in
  `packages/server/src/api/server.ts`: optionaler Body `{ profile }` (Vorgabe `full`), Prüfung über
  `ActionGuard` **vor jeder Wirkung** (409 mit dem Grund aus `actionPolicy`), Antwort als frisch
  erhobene `FeatureStackView`, bei Fehlschlag **500** mit `{ message, exitCode, tail }`
- [X] T058 [US3] `POST /api/features/:id/manual-test/confirm` und
  `POST /api/features/:id/manual-test/reject` in `packages/server/src/api/server.ts`: `reject`
  verlangt einen nicht leeren `reason` (sonst 400 „Ein Grund ist erforderlich."), beide antworten
  409 „Das Feature wartet nicht auf eine manuelle Abnahme." auf jeder anderen Stufe
- [X] T059 [US3] `packages/server/src/api/server.test.ts` erweitern: die vier Stack-Aktionen
  (inkl. 409-Gründe), `confirm`/`reject` (inkl. 400 ohne Grund und 409 auf falscher Stufe) und
  `GET /api/testing-lane` mit zwei Features
- [X] T060 [US3] `packages/server/src/index.ts`: `TestingLaneService` erzeugen und
  `testingLaneRoutes` registrieren
- [X] T061 [P] [US3] `packages/web/src/api.ts`: `testingLane(projectId, refresh?)`,
  `confirmManualTest(featureId)`, `rejectManualTest(featureId, reason)`
- [X] T062 [P] [US3] `packages/web/src/components/icons.tsx`: `FlaskIcon` als SVG ergänzen
- [X] T063 [US3] `packages/web/src/store.tsx`: `View { kind: 'testing' }` ergänzen und
  `featureActionContext` um `stackConfigured`/`stackRunning` erweitern
- [X] T064 [US3] `packages/web/src/App.tsx`: Rendering der View `testing`
- [X] T065 [US3] `packages/web/src/components/Sidebar.tsx`: Eintrag „Testing-Lane" mit `FlaskIcon`
  und Zähler der Features auf `awaiting_manual_test`
- [X] T066 [US3] `packages/web/src/components/TestingLane.tsx` (NEU): zwei Abschnitte („Wartet auf
  Abnahme" / „Läuft gerade") mit den Leerzuständen, je Eintrag die **fünf** Pflichtangaben
  (Worktree-Pfad mit Kopieren, Branch, Adresse, Anlagedatum, Dienstliste mit Status und Port), die
  vier Stack-Aktionen über `StackPanel`, „Abnahme bestätigen" mit Rückfrage und „Ablehnen …" mit
  Pflicht-Textfeld; Adresse ausschließlich aus `FeatureStackView.url` — die Oberfläche rechnet keine
  Ports; „nicht erreichbar" bzw. „Kein Stack konfiguriert …" statt eines Links ins Leere
  (FR-030–FR-033, SC-002/SC-009)
- [X] T067 [P] [US3] `packages/web/src/components/AutomationDial.tsx`: Schalter „Manuelles
  Test-Gate" in die bestehende Liste einreihen, Beschriftung und Hilfetext aus
  `AUTOMATION_META.manualTestGate`
- [X] T068 [P] [US3] `packages/web/src/components/KanbanBoard.tsx`: die neue Stufe auf der Kachel aus
  `INTEGRATION_STAGE_META` (Ton `human`, amber) plus Schaltfläche „Testing-Lane öffnen" — kein
  Rohbezeichner
- [X] T069 [P] [US3] `packages/web/src/components/ReviewOverview.tsx`: Abschnitt „Wartet auf manuelle
  Abnahme" **über** „Bereit zum Review", mit Verweis in die Lane statt Freigabe-/Ablehnen-Knöpfen
- [X] T070 [P] [US3] `packages/web/src/components/AttentionInbox.tsx`: `manual_test_due` und
  `stack_failed` mit Nachricht und Sprungziel nach
  [contracts/ui-contract.md §8](./contracts/ui-contract.md)

**Checkpoint**: Die drei P1-Stories stehen und sind allein auslieferbar

---

## Phase 6: User Story 4 - Nach dem Merge bleibt nichts zurück (Priority: P2)

**Goal**: Das Aufräumen **prüft** das Entfernen, statt es anzunehmen; scheitert es, bleibt der
Worktree-Pfad gesetzt und es entsteht eine Meldung, die wiederholbar ist. Prozesse sterben über ihre
Prozessgruppe, nie über ein Namensmuster. Verwaiste Worktrees werden aktiv gemeldet.

**Independent Test**: Ein Feature mergen, während ein Prozess im Worktree läuft; prüfen, dass der
Worktree-Pfad erhalten bleibt und eine `worktree_cleanup_failed`-Meldung entsteht. Danach den
Prozess über die **gemerkte PID** beenden, „Aufräumen erneut anstoßen" und prüfen, dass Verzeichnis,
Dienste und Datenablagen fort sind.

### Tests für User Story 4 ⚠️

- [X] T071 [P] [US4] `packages/server/src/git/worktreesLifecycle.test.ts` erweitern: `remove()`
  wirft, wenn das Verzeichnis nach dem git-Aufruf noch existiert (`existsSync`-Nachweis), und gibt
  den Portblock **nur** im Erfolgsfall frei (FR-034/FR-036)
- [X] T072 [P] [US4] `packages/server/src/services/mergeQueueService.test.ts` erweitern:
  fehlgeschlagenes Entfernen ⇒ `worktree_path` bleibt **gesetzt**, `cleanup_error` trägt den Grund,
  `worktree_cleanup_failed`-Meldung entsteht (SC-004); erfolgreiches Wiederholen leert den Pfad und
  löst die Meldung auf (FR-037); fehlgeschlagenes `down` verhindert das Leeren, lässt den Merge aber
  bestehen
- [X] T073 [P] [US4] `packages/server/src/pty/sessionManager.test.ts` erweitern: zwei Sessions
  starten je einen **gleichnamigen** Kindprozess; `terminate()` der einen beendet nur deren
  Prozessgruppe, der Prozess der anderen läuft weiter (SC-008); Gegenprobe über getrennte
  Prozessgruppen-IDs

### Implementierung für User Story 4

- [X] T074 [US4] `packages/server/src/git/worktrees.ts`: `remove()` prüft nach dem git-Aufruf mit
  `existsSync(path)`, dass das Verzeichnis wirklich fort ist, und wirft sonst mit dem Grund; die
  Freigabe des Portblocks geschieht erst nach diesem Nachweis (FR-034/FR-036, research E11)
- [X] T075 [US4] `packages/server/src/services/mergeQueueService.ts`: `cleanupMerged()` fährt
  **zuerst** das `down`-Profil, beendet die Session über die Prozessgruppe, ruft dann
  `worktrees.remove()` und leert `worktree_path` **nur** bei nachgewiesenem Erfolg; sonst bleibt der
  Pfad, `features.cleanup_error` trägt den Grund und eine `worktree_cleanup_failed`-Meldung entsteht
  — der bestehende `catch { git worktree prune }` mit anschließendem bedingungslosem
  `setWorktree(id, null)` entfällt (FR-034/FR-035/FR-038, SC-004)
- [X] T076 [US4] `POST /api/features/:id/cleanup` in `packages/server/src/api/server.ts`: stößt
  denselben Pfad wie `cleanupMerged()` erneut an und antwortet `{ cleaned, worktreePath,
  cleanupError }`; erneutes Scheitern ist **200 mit `cleaned: false`**, kein 500 (FR-037)
- [X] T077 [US4] `packages/server/src/pty/sessionManager.ts`: `terminate()` sendet nach den zwei
  Ctrl+C und dem Warteintervall `process.kill(-pty.pid, 'SIGTERM')` und nach kurzer Gnade `SIGKILL`;
  jeder Aufruf in `try/catch`, `pid > 0` geprüft (`kill(-0)` träfe die eigene Gruppe — also den
  Toolkit-Server selbst); kein `pkill`, kein `killall`, kein Namensmuster (FR-040/FR-041, research E12)
- [X] T078 [US4] `packages/server/src/services/worktreeOverviewService.ts`: jeder Eintrag mit
  `kind: 'orphan'` erzeugt eine `orphan_worktree`-Meldung (dedupliziert über die bestehende
  `AttentionRepo.raise()`-Regel, Nachricht mit Pfad und Größe); derselbe Durchlauf gibt über
  `PortAllocator.reconcile()` die Blöcke **nicht mehr existierender** Verzeichnisse frei (FR-039,
  SC-011, research E14, Edge Case „Worktree von außen gelöscht")
- [X] T079 [US4] `packages/server/src/api/worktreeRoutes.ts`: `POST /api/worktrees/remove` fährt
  vorher das `down`-Profil und lehnt bei dessen Fehlschlag mit dem Grund ab, statt halb aufzuräumen
  (FR-017, research E9)
- [X] T080 [US4] `packages/server/src/services/attentionReconciler.ts`: Gültigkeitsregeln für
  `worktree_cleanup_failed` (gilt bis ein erfolgreiches Aufräumen sie auflöst) und `orphan_worktree`
  (gilt, solange der verwaiste Eintrag in einer Erhebung erscheint) — beide **ohne** Eintrag in
  `STAGE_FOR_KIND`
- [X] T081 [P] [US4] `packages/web/src/api.ts`: `retryCleanup(featureId)`
- [X] T082 [US4] `packages/web/src/components/WorktreeOverview.tsx`: Schaltfläche „Aufräumen erneut
  anstoßen" an betroffenen Einträgen, verwaiste Einträge behalten ihre Kennzeichnung und verlinken in
  die Inbox; `packages/web/src/components/AttentionInbox.tsx` um die Sprungziele für
  `worktree_cleanup_failed` und `orphan_worktree` erweitern
- [X] T083 [US4] `packages/server/src/services/worktreeOverviewService.test.ts` erweitern:
  verwaister Eintrag ⇒ genau eine `orphan_worktree`-Meldung je Erhebung (keine Dubletten),
  verschwundener Eintrag ⇒ Auflösung, und der Block eines gelöschten Verzeichnisses ist danach wieder
  vergebbar

**Checkpoint**: US4 steht — nach dem Merge bleibt nichts zurück, und ein Fehlschlag ist sichtbar und
wiederholbar

---

## Phase 7: User Story 5 - Sehen, wie viel Platte ein Worktree kostet (Priority: P3)

**Goal**: Je Worktree eine Größe (oder „unbekannt") und eine Warnung, bevor die Platte voll ist.

**Independent Test**: Die Worktree-Übersicht öffnen und die Größen gegen `du -sh <worktree>` halten;
die Warnschwelle über `SDD_DISK_WARN_BYTES` künstlich unterschreiten und prüfen, dass die Warnung mit
freiem Platz und den größten Worktrees erscheint.

### Tests für User Story 5 ⚠️

- [X] T084 [P] [US5] `packages/server/src/services/worktreeOverviewService.test.ts` erweitern (mit
  injizierter `readDirSize`-Sonde): Größe je Eintrag, Zeitüberschreitung oder Fehlschlag ⇒
  `sizeBytes: null` bei **vollständig** sichtbarem Eintrag (FR-044), `disk.warn` genau dann, wenn
  `freeBytes !== null && freeBytes < warnBelowBytes`, und `freeBytes: null` ⇒ keine Warnung

### Implementierung für User Story 5

- [X] T085 [US5] `packages/server/src/services/worktreeOverviewService.ts`: `sizeBytes` je Eintrag
  über `du -sk <path>` (×1024), ausgeführt in derselben Nebenläufigkeitsbremse (6) wie die übrige
  Erhebung, Zeitlimit 3 s je Eintrag, Fehlschlag ⇒ `null`; zusätzlich `portBase` je Eintrag aus dem
  `PortRepo` — dieselbe Erhebung, kein zweiter Abruf (FR-042/FR-044, research E15, data-model.md §9)
- [X] T086 [US5] `packages/server/src/services/worktreeOverviewService.ts`: `disk` auf der Wurzel der
  Übersicht aus `ResourceMonitor.snapshot().diskFreeBytes` und `config.diskWarnBytes` —
  `{ freeBytes, warnBelowBytes, warn }`; keine zweite Plattenmessung (FR-043)
- [X] T087 [US5] `packages/web/src/components/WorktreeOverview.tsx`: Spalte „Größe" (`1,4 GB`, bei
  `null` „unbekannt" in gedämpfter Farbe), Spalte „Portbereich" (`21040–21059`, leer ohne Block) und
  bei `disk.warn` eine Warnung **über** den Projektblöcken (amber, `WarnIcon`) mit freiem Platz,
  Schwelle und den drei größten Worktrees aus derselben Antwort (FR-042–FR-044, SC-012)

**Checkpoint**: Alle fünf Stories sind unabhängig funktionsfähig

---

## Phase 8: Polish & übergreifende Prüfung

- [X] T088 `pnpm -r typecheck` und `pnpm -r test` im Repo-Wurzelverzeichnis grün stellen —
  insbesondere die vier `Record<Union, …>`-Kataloge und die Laufzeit-Exhaustiveness in
  `packages/shared/src/workflowModel.test.ts` und `packages/shared/src/actionPolicy.test.ts`
- [X] T089 [P] Gegenprobe „kein Namensmuster": `grep -rn "pkill\|killall" packages/ specs/` liefert
  keine Treffer in Code, Tests oder Kommandobeispielen (FR-040/FR-041, Projektregel)
- [ ] T090 Quickstart-Abschnitte 1 und 2 aus [quickstart.md](./quickstart.md) auf einer eigenen
  Test-Instanz (`SDD_PORT=4899 SDD_WEB_PORT=4898`, eigenes `SDD_DATA_DIR`,
  `SDD_PORT_RANGE_START=31000`) durchspielen: Zwei-Feature-Durchlauf ohne doppelt belegten Port
  (SC-001), Env-Datei nicht im Commit, `test` ab `implement` ohne Neustart über Läufe (SC-006),
  Projekt ohne Stack unverändert (SC-010)
- [ ] T091 Quickstart-Abschnitt 3 durchspielen: Klickprobe der Adresse mit **zwei** Features
  gleichzeitig in der Lane, 100 % Treffer (SC-002); fünf Angaben in einer Ansicht ohne Terminal
  (SC-009); Bestätigen, Ablehnen, Gate aus, Projekt ohne Stack, „nicht erreichbar"
- [ ] T092 Quickstart-Abschnitte 4 und 5 durchspielen: unabhängige Nachmessung nach dem Merge
  (Verzeichnis, Dienste, Datenablagen — SC-003), fehlgeschlagenes Entfernen ⇒ Meldung und gesetzter
  Pfad (SC-004), zwei gleichnamige Prozesse aus zwei Sessions (SC-008), verwaister Worktree als
  Meldung (SC-011), Größe und Plattenwarnung (SC-012)
- [ ] T093 Abschluss-Checkliste in [quickstart.md §7](./quickstart.md) abhaken und die Test-Instanz
  **ausschließlich** über die eigenen Ports abräumen (`lsof -ti:4899 | xargs -r kill`,
  `lsof -ti:4898 | xargs -r kill`) — kein `pkill`, kein `killall`

---

## Dependencies & Execution Order

### Phasen-Abhängigkeiten

- **Setup (Phase 1)**: keine Abhängigkeit — kann sofort starten
- **Foundational (Phase 2)**: nach Setup — **blockiert alle Stories**
- **US1 (Phase 3, P1)**: nach Phase 2 — keine Abhängigkeit zu anderen Stories
- **US2 (Phase 4, P1)**: nach Phase 2 (`stepRunner`) und US1 (Portblock, `$SDD_PORT_BASE`,
  `$SDD_PROFILE`)
- **US3 (Phase 5, P1)**: nach US1 (Adresse aus dem Portblock) und US2 (Profile, Statuserhebung).
  Die Gate-Anteile (T048–T055) sind bereits ohne US2 prüfbar
- **US4 (Phase 6, P2)**: nach Phase 2 (Prozessgruppe) und US1 (Freigabe des Blocks); der `down`-Anteil
  in T075/T079 setzt US2 voraus. Der Kern (Nachweis beim Entfernen, Prozessgruppe, verwaiste
  Worktrees) ist ohne US2/US3 prüfbar
- **US5 (Phase 7, P3)**: nach Phase 2; `portBase` in der Übersicht setzt US1 voraus
- **Polish (Phase 8)**: nach allen gewünschten Stories

### Abfolge innerhalb einer Story

- Testaufgaben zuerst schreiben und ihren Fehlschlag bestätigen
- Pure `shared`-Module → `server`-Repo → `server`-Service → Route → Web-Komponente
- Innerhalb einer Datei nie parallel (`stackService.ts` in T028–T031, `portAllocator.ts` in
  T015/T016, `worktreeOverviewService.ts` in T078/T085/T086 sind bewusst **ohne** [P])

### Parallele Möglichkeiten

- **Phase 2**: T003 (shared) parallel zu T002 (Migration); T007 parallel zur weiteren Arbeit
- **US1**: T008–T011 (vier Testdateien) vollständig parallel; danach T012 und T014 parallel
- **US2**: T022–T024 parallel; T025 und T027 parallel; T040 und T041 parallel zur Server-Arbeit
- **US3**: T045–T047 parallel; T061/T062 parallel; T067–T070 (vier Bestandskomponenten) parallel
- **US4**: T071–T073 parallel; T081 parallel zur Server-Arbeit
- **Über Stories hinweg**: nach Phase 2 können US1 und der Gate-Anteil von US3 (T045, T048–T050,
  T053–T055) von zwei Personen gleichzeitig bearbeitet werden; US5 ist von US2/US3 unabhängig

---

## Parallel Example: User Story 1

```bash
# Alle vier Testdateien der Story gleichzeitig schreiben:
Task: "packages/shared/src/ports.test.ts — Blockarithmetik, Dienstport, URL"
Task: "packages/server/src/db/portRepo.test.ts — Belegen, Freigeben, partieller Index"
Task: "packages/server/src/services/portAllocator.test.ts — Bind-Probe, Stabilität, Erschöpfung"
Task: "packages/shared/src/lifecycleSteps.test.ts — acht Schlüssel, Alt-Kommando unverändert"

# Danach die beiden unabhängigen Implementierungen gleichzeitig:
Task: "packages/shared/src/ports.ts — PORT_DEFAULTS, blockStarts(), portFor(), stackUrl()"
Task: "packages/server/src/db/portRepo.ts — Buchführung der Blöcke"
```

## Parallel Example: User Story 3 (Oberfläche)

```bash
# Vier Bestandskomponenten, vier Dateien, keine gemeinsame Zeile:
Task: "AutomationDial.tsx — Schalter 'Manuelles Test-Gate'"
Task: "KanbanBoard.tsx — neue Stufe + 'Testing-Lane öffnen'"
Task: "ReviewOverview.tsx — Abschnitt 'Wartet auf manuelle Abnahme'"
Task: "AttentionInbox.tsx — manual_test_due und stack_failed"
```

---

## Implementation Strategy

### MVP zuerst (US1)

1. Phase 1 (Setup) abschließen
2. Phase 2 (Foundational) abschließen — **blockiert alles Weitere**
3. Phase 3 (US1) abschließen
4. **Anhalten und prüfen**: zwei Features, zwei Blöcke, `$SDD_PORT_BASE` in jedem Schritt, Env-Datei
   im Worktree und nicht im Commit (SC-001, SC-007)
5. US1 ist allein auslieferbar: die Portkollision — der Kern des beobachteten Schadens — ist behoben

### Inkrementelle Auslieferung

1. Setup + Foundational → Grundlage steht
2. US1 → unabhängig prüfen → auslieferbar (MVP)
3. US2 → unabhängig prüfen → auslieferbar (nur der bezahlte Stack läuft)
4. US3 → unabhängig prüfen → auslieferbar; **hier ist der Zuschnitt der drei P1-Stories vollständig**
   und der eigentliche Zweck erreicht: die Prüfung vor dem Merge
5. US4 (P2) → das Aufräumen wird ehrlich
6. US5 (P3) → die Platte wird sichtbar

### Parallele Bearbeitung im Team

1. Setup + Foundational gemeinsam
2. Danach:
   - Person A: US1, anschließend US2 (die Kette Portblock → Profile)
   - Person B: die Gate- und Katalog-Anteile von US3 (T045, T048–T055), danach US4
   - Person C: US5 sowie die Web-Anteile von US2/US3, sobald deren Server-Seite steht
3. US3 wird zusammengeführt, sobald US2 die Statuserhebung liefert

---

## Notes

- **[P]** = andere Datei, keine offene Abhängigkeit
- **[Story]** ordnet die Aufgabe einer User Story zu (Nachvollziehbarkeit)
- Jede Story ist für sich abschließbar und prüfbar; an jedem Checkpoint kann angehalten werden
- Tests vor der Implementierung schreiben und ihren Fehlschlag bestätigen
- Nach jeder Aufgabe oder logischen Gruppe committen
- **Nicht** tun: einen zweiten Weg zur Portvergabe oder zum Variablensatz bauen (FR-007), einen
  zweiten Runner neben `stepRunner` (research E6), den Dienststatus in der Datenbank mitschreiben
  (research E8), einen Prozess über ein Namensmuster beenden (FR-040/FR-041) oder den Worktree-Pfad
  ohne Nachweis leeren (FR-036)
