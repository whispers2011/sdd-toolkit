# Tasks: Worktree-Übersicht in den Einstellungen

**Input**: Design documents from `/specs/worktree-uebersicht/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/http-api.md](./contracts/http-api.md), [contracts/ui-contract.md](./contracts/ui-contract.md), [quickstart.md](./quickstart.md)

**Tests**: Enthalten — Plan (Testing: vitest 3) und quickstart.md Stufe 1 benennen konkrete neue Testdateien; Repo-Konvention verlangt vitest-Tests für pure `shared`-Module und Git-Services gegen Temp-Repos.

**Organization**: Aufgaben sind nach User Story gruppiert, damit jede Story eigenständig umsetzbar und prüfbar ist.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallel ausführbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: Zugehörige User Story (US1–US5)
- Jede Aufgabe nennt den exakten Dateipfad

## Path Conventions

pnpm-Monorepo (siehe plan.md → Project Structure):

- `packages/shared/src/` — pure Typen und Funktionen (Server + Web geteilt)
- `packages/server/src/` — Fastify-API, Services, Git-Leser
- `packages/web/src/` — React-SPA

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ausgangszustand absichern. Keine neuen Dependencies, keine Migration, kein Gerüstbau nötig — das Monorepo besteht bereits.

- [X] T001 Baseline absichern: `pnpm -r typecheck && pnpm -r test` im Repo-Root (pnpm-Workspace, `pnpm-workspace.yaml`) ausführen und grünen Ausgangszustand festhalten

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Gemeinsamer Typvertrag, Git-Leser und die durchgehende Verdrahtung Server↔Web. Ohne diese Basis kann keine Story rendern oder Daten beziehen.

**⚠️ CRITICAL**: Keine User-Story-Arbeit vor Abschluss dieser Phase.

- [X] T002 [P] Neue Typen in `packages/shared/src/types.ts` ergänzen: `WorktreeOverview`, `WorktreeProjectGroup`, `MainCheckoutInfo`, `WorktreeEntry`, `WorktreeFileChange`, `WorktreeWarning` sowie die Aufzählungen `WorktreeEntryKind`, `WorktreeDirState`, `FileChangeKind`, `FileChangeState`, `WorktreeWarningKind` exakt nach data-model.md §1–§7
- [X] T003 [P] `packages/server/src/git/worktreeInventory.ts` (NEU): `readWorktreeInventory(projectPath)` — `git worktree list --porcelain` über den asynchronen `git()`-Wrapper aus `packages/server/src/git/git.ts` vollständig parsen (`path`, `branch`, `HEAD`, `detached`, `bare`, `locked`, `prunable`); niemals `execSync`
- [X] T004 `packages/server/src/git/worktreeInventory.test.ts` (NEU): Parser-Tests für Porcelain-Ausgabe inkl. `detached`, `bare`, `locked`, `prunable`, mehrerer Einträge und leerer Ausgabe
- [X] T005 `packages/server/src/git/worktrees.ts`: `WorktreeManager.list()` an `readWorktreeInventory` delegieren — Rückgabetyp `{ path: string; branch: string | null }[]` unverändert; `packages/server/src/git/worktreesCreate.test.ts` bleibt grün
- [X] T006 `packages/server/src/services/worktreeOverviewService.ts` (NEU): Klasse `WorktreeOverviewService` mit Deps (`ProjectRepo`, `FeatureRepo` aus `packages/server/src/db/repos.ts`, `SessionManager` aus `packages/server/src/pty/sessionManager.ts`, Event-Bus) und `buildOverview(): Promise<WorktreeOverview>` — ein `WorktreeProjectGroup` je Projekt, Erhebung je Projekt in `try/catch` gekapselt (`error` gesetzt ⇒ `main: null`, `worktrees: []`, `worktreeCount: 0`), `collectedAt` gesetzt (FR-032)
- [X] T007 `packages/server/src/api/worktreeRoutes.ts` (NEU): `registerWorktreeRoutes(app, deps)` mit `GET /api/worktrees` → `service.buildOverview()`, nach dem Muster von `packages/server/src/api/reviewRoutes.ts`
- [X] T008 `packages/server/src/api/server.ts`: `ApiDeps` um das Service-Feld erweitern und `registerWorktreeRoutes(app, …)` in `buildServer()` einhängen
- [X] T009 `packages/server/src/index.ts`: `WorktreeOverviewService` instanziieren und an `buildServer()` übergeben
- [X] T010 [P] `packages/web/src/api.ts`: Client-Funktion `worktrees(refresh?: boolean)` → `WorktreeOverview` (`GET /api/worktrees` bzw. `?refresh=1`)
- [X] T011 [P] `packages/web/src/components/icons.tsx`: `WorktreeIcon` als SVG-Icon im Stil der bestehenden Icons ergänzen (keine Emojis — Projekt-Konvention)

**Checkpoint**: `GET /api/worktrees` liefert für jedes konfigurierte Projekt einen Block (ggf. mit `error`); der Web-Client kann ihn abrufen.

---

## Phase 3: User Story 1 - Überblick: welcher Worktree gehört zu welchem Feature (Priority: P1) 🎯 MVP

**Goal**: Über Einstellungen unten links erreichbare Ansicht, die je Projekt den Haupt-Checkout und alle offenen Worktrees mit Feature-Zuordnung, Branch, Pfad und Bearbeitungsstand zeigt — inklusive verwaister, fehlender und Chat-Worktrees.

**Independent Test**: Bei mindestens zwei Features mit Worktree die Übersicht über Einstellungen → „Worktree-Übersicht" öffnen und prüfen, dass jeder tatsächlich existierende Worktree mit korrekter Feature-Zuordnung sowie der Haupt-Checkout jedes Projekts erscheint (SC-001, SC-002).

### Implementation for User Story 1

- [X] T012 [P] [US1] `packages/shared/src/workflowModel.ts`: pure Funktion `featureProgressLabel(feature)` ergänzen, die aus `phases`/`integration` das Label („Umsetzen läuft", „Bereit zum Review", „Abgeschlossen" …) auf Basis von `PHASE_META`/`INTEGRATION_STAGE_META` ableitet (FR-007, research.md D11)
- [X] T013 [US1] `packages/shared/src/workflowModel.test.ts`: Tests für `featureProgressLabel` — laufende Phase, Review-Bereitschaft, Integration, `merged`
- [X] T014 [US1] `packages/server/src/services/worktreeOverviewService.ts`: Haupt-Checkout je Projekt erheben (`currentBranch`, `defaultBranch`, `uncommittedFileCount` aus `packages/server/src/git/git.ts`) → `MainCheckoutInfo` ohne Dateiliste und ohne Warnungen (FR-003, data-model.md §3)
- [X] T015 [US1] `packages/server/src/services/worktreeOverviewService.ts`: `WorktreeEntry` je geführtem Worktree bilden — Zuordnung zu Features über `realpathSync` beider Seiten (Fallback `resolve()`, danach Branch-Gleichheit), Klassifikation `kind` als `feature | chat | orphan` (Verzeichnis `chat-<id>` bzw. Branch `chat/<id>` ⇒ „Wissens-Chat"), `label`, `path`, `branch`, `id = <projectId>::<realpath>`, `targetBranch = feature.integrationTarget ?? project.defaultBranch`, `createdAt` (FR-005, FR-006, FR-008; research.md D2/D3)
- [X] T016 [US1] `packages/server/src/services/worktreeOverviewService.ts`: `dirState` ableiten (`present` | `registry_only` bei `prunable`/fehlendem Verzeichnis | `missing` für Features mit `worktreePath`, den git nicht kennt), `sessionActive` (nicht beendete PTY-Session mit `cwd` innerhalb des Worktrees), `removable = dirState === 'present' && !sessionActive`, Sortierung `feature` → `chat` → `orphan` (je Gruppe alphabetisch nach `label`) und `worktreeCount` (FR-004, FR-009, data-model.md §4)
- [X] T017 [US1] `packages/server/src/services/worktreeOverviewService.test.ts` (NEU): Tests gegen ein echtes Temp-Repo (`mkdtemp`, liegt real unter `/private/var`) — realpath-Zuordnung erzeugt **kein** falsches „verwaist", `orphan`, `chat`, `dirState` `missing`/`registry_only`, `worktreeCount`, unerreichbares Projekt bleibt auf seinen Block beschränkt
- [X] T018 [P] [US1] `packages/web/src/store.tsx`: View-Union um `{ kind: 'worktrees' }` erweitern
- [X] T019 [US1] `packages/web/src/App.tsx`: View `worktrees` rendert `WorktreeOverview` im Hauptbereich (Muster der bestehenden Top-Level-Views `review`/`workflow`/`agents`)
- [X] T020 [US1] `packages/web/src/components/Sidebar.tsx`: im `ToolSettings`-Dialog unter „Jira-Verbindung" den Eintrag „Worktree-Übersicht" mit Untertitel „Offene Worktrees aller Projekte, geänderte Dateien, Aufräumen" ergänzen; Klick schließt den Dialog und dispatcht `set_view` auf `{ kind: 'worktrees' }` (FR-001, ui-contract C1)
- [X] T021 [US1] `packages/web/src/components/WorktreeOverview.tsx` (NEU): Grundgerüst — Abruf über `api.worktrees()`, Kopfzeile „Worktree-Übersicht", je Projekt ein Block mit Projektname, Branch des Haupt-Checkouts und Anzahl offener Worktrees (ui-contract C2.1)
- [X] T022 [US1] `packages/web/src/components/WorktreeOverview.tsx`: Haupt-Checkout als erster, optisch abgesetzter Eintrag im Block mit Pfad und `uncommittedFileCount` — nie mit Entfernen-Aktion (ui-contract C2.2, FR-026)
- [X] T023 [US1] `packages/web/src/components/WorktreeOverview.tsx`: Worktree-Zeilen mit Label, Branch, Pfad und Bearbeitungsstand via `featureProgressLabel`; sichtbare Kennzeichnungen „ohne Feature-Zuordnung", „Wissens-Chat", „Worktree-Verzeichnis fehlt" (`missing`) und „nur in der Git-Verwaltung geführt" (`registry_only`) (ui-contract C2.3–C2.5)
- [X] T024 [US1] `packages/web/src/components/WorktreeOverview.tsx`: Klick auf einen zugeordneten Eintrag löst `select_project` + `set_view` auf die Feature-Konsole aus (FR-010); Leerzustände „Keine offenen Worktrees" je Projekt und „Noch keine Projekte konfiguriert."; `group.error` wird im jeweiligen Block als Klartext angezeigt, ohne die anderen Blöcke zu beeinträchtigen (ui-contract C2.6–C2.8, FR-032)

**Checkpoint**: US1 ist eigenständig nutzbar — Übersicht in zwei Interaktionen erreichbar, Zuordnung Feature↔Worktree ablesbar.

---

## Phase 4: User Story 2 - Sehen, welche Dateien ein Worktree verändert hat (Priority: P2)

**Goal**: Je Worktree die gegenüber dem Zielbranch geänderten Dateien mit Änderungsart und Commit-Zustand, aufklappbar, mit sichtbarer Anzahl bereits im eingeklappten Zustand.

**Independent Test**: In einem Worktree eine Datei ändern und eine neue Datei anlegen; die aufgeklappte Dateiliste zeigt beide mit korrekter Änderungsart und korrektem Commit-Zustand, die Anzahl war vorher schon sichtbar (SC-005).

### Implementation for User Story 2

- [X] T025 [P] [US2] `packages/shared/src/worktreeStatus.ts` (NEU): pure Funktionen `parseNameStatusZ`, `parseNulList`, `parsePorcelainStatusZ` und `mergeFileChanges` — liefern `WorktreeFileChange[]` mit `kind` (`added|modified|deleted|renamed`, Rename-Paare aus zwei aufeinanderfolgenden `-z`-Feldern) und `state` (`committed|uncommitted|both`) nach der Herleitung in data-model.md §5 (research.md D4/D5); keine Git-Aufrufe in diesem Modul
- [X] T026 [US2] `packages/shared/src/worktreeStatus.test.ts` (NEU): Tests für Rename-Paare (inkl. `oldPath`), Löschungen, Untracked, Pfade mit Leerzeichen und Umlauten, die vollständige `state`-Matrix (`committed`/`uncommitted`/`both`) und die Invariante „jeder Pfad höchstens einmal"
- [X] T027 [US2] `packages/shared/src/index.ts`: `export * from './worktreeStatus.js';` ergänzen
- [X] T028 [US2] `packages/server/src/services/worktreeChanges.ts` (NEU): `collectWorktreeChanges(cwd, targetBranch)` — `merge-base(<target>, HEAD)`, `git diff --name-status -M -z <base>`, `git ls-files --others --exclude-standard -z`, `git diff --name-only -z <base>..HEAD`, `git status --porcelain -z`; Zusammenführung über `mergeFileChanges` aus `packages/shared`
- [X] T029 [US2] `packages/server/src/services/worktreeChanges.test.ts` (NEU): Erhebung gegen ein echtes Temp-Repo — neu, geändert, gelöscht, per `git mv` umbenannt, untracked, sowie committet vs. uncommittet vs. `both`
- [X] T030 [US2] `packages/server/src/services/worktreeOverviewService.ts`: Dateierhebung für Einträge mit `dirState === 'present'` einbinden — Nebenläufigkeitslimit 6, `changedFileCount` (Gesamtzahl) und `uncommittedFileCount`, `files` auf 300 Einträge gekürzt mit `filesTruncated`; Fehler einer Einzel-Erhebung landen in `entry.error`, der Eintrag bleibt sichtbar (FR-011–FR-016, research.md D9)
- [X] T031 [US2] `packages/server/src/services/worktreeOverviewService.test.ts`: Tests ergänzen für Zählwerte, Kürzung bei > 300 Dateien (`filesTruncated`, `changedFileCount` bleibt vollständig) und einen änderungsfreien Worktree (`changedFileCount === 0`)
- [X] T032 [US2] `packages/web/src/components/WorktreeOverview.tsx`: eingeklappte Zeile zeigt „`<n>` Dateien · `<m>` uncommittet" bereits ohne Aufklappen (FR-014, ui-contract C2.3)
- [X] T033 [US2] `packages/web/src/components/WorktreeOverview.tsx`: aufklappbare Dateiliste je Eintrag — Pfad, Änderungsart als Kürzel mit Tooltip (`+` neu, `~` geändert, `−` gelöscht, `→` umbenannt inkl. `oldPath`), Commit-Zustand „committet"/„uncommittet"/„committet + geändert"; scrollbare Liste fester Höhe (`max-h`), Hinweis „… zeigt 300 von N Dateien" bei `filesTruncated`, ausdrückliches „Keine Änderungen gegenüber `<targetBranch>`" bei `changedFileCount === 0`, Aufklappzustand über `entry.id` stabil (ui-contract C3.1–C3.7)

**Checkpoint**: US1 + US2 laufen unabhängig — Umfang jedes Worktrees ist ohne Terminal erkennbar.

---

## Phase 5: User Story 3 - Vor Doppelarbeit und veralteten Worktrees gewarnt werden (Priority: P3)

**Goal**: Drei Warnlagen aktiv erkennen und benennen — Überschneidung mit anderen offenen Worktrees, gegenüber Zielbranch überholt, bereits integriert — ohne Fehlalarme.

**Independent Test**: Zwei Worktrees dieselbe Datei ändern lassen; beide Einträge zeigen einen Überschneidungshinweis mit Nennung der Datei und des jeweils anderen Features (SC-006).

### Implementation for User Story 3

- [X] T034 [P] [US3] `packages/shared/src/worktreeStatus.ts`: pure Funktion `detectOverlaps(entries)` ergänzen — derselbe Pfad in ≥ 2 Einträgen desselben Projekts mit `dirState === 'present'`; Schlüssel ist bei Umbenennungen der **neue** Pfad, `oldPath` erzeugt keinen Treffer
- [X] T035 [US3] `packages/shared/src/worktreeStatus.test.ts`: Tests für Überschneidung über zwei und drei Einträge, „`oldPath` erzeugt keinen Treffer", Ausschluss von Einträgen mit `dirState ≠ present`
- [X] T036 [US3] `packages/server/src/services/worktreeChanges.ts`: `changedOnTargetSince(projectPath, base, targetBranch)` — `git diff --name-only -z <base>..<target>` als Pfadmenge
- [X] T037 [US3] `packages/server/src/services/worktreeOverviewService.ts`: Warnung `already_merged` — Branch existiert nicht mehr **oder** `isBranchMergedInto(project.path, branch, target)` aus `packages/server/src/git/git.ts` trifft zu; `files: []`, `fileCount: 0` (FR-019)
- [X] T038 [US3] `packages/server/src/services/worktreeOverviewService.ts`: Warnung `behind_target` — Schnittmenge der geänderten Worktree-Dateien mit `changedOnTargetSince`, je (Projekt, `target`, `base`) nur **einmal** erhoben und gecacht; bei `already_merged` am selben Eintrag unterdrückt (FR-018, research.md D6)
- [X] T039 [US3] `packages/server/src/services/worktreeOverviewService.ts`: Warnung `overlap` über `detectOverlaps` auf den **ungekürzten** Dateilisten, `others` mit `entryId`/`label`/`featureId`; Dateiflags `overlapping`/`behindTarget` setzen; `warnings`-Reihenfolge stabil `already_merged` → `overlap` → `behind_target`; `files` je Warnung auf 20 gekürzt bei vollständigem `fileCount` (FR-017, FR-021, data-model.md §6)
- [X] T040 [US3] `packages/server/src/services/worktreeOverviewService.test.ts`: Tests für alle drei Warnarten, die Unterdrückungsregel `already_merged` ⇒ kein `behind_target`, „keine Warnung bei sauberem Worktree" (FR-020), keine Warnungen bei `dirState ≠ present` und ein warnungsfreier Haupt-Checkout (SC-010)
- [X] T041 [US3] `packages/web/src/components/WorktreeOverview.tsx`: Warn-Badges samt Detailzeilen mit den Texten aus ui-contract C4 („bereits integriert — Worktree kann entfernt werden", „Überschneidung mit … : `<n>` Datei(en)", „gegenüber `<targetBranch>` veraltet: `<n>` Datei(en) dort ebenfalls geändert"); mehrere Warnungen gleichzeitig und optisch unterscheidbar, betroffene Dateien aufklappbar bei `fileCount > files.length`, Markierung von `overlapping`/`behindTarget` in der Dateiliste (ui-contract C3.6, C4.1–C4.3)

**Checkpoint**: US1–US3 laufen unabhängig — die Übersicht ist ein Frühwarninstrument.

---

## Phase 6: User Story 4 - Veraltete Worktrees direkt aus der Übersicht entfernen (Priority: P4)

**Goal**: Einzelne Worktrees aus der Ansicht entfernen — mit Bestätigung, zusätzlicher expliziter Zweitbestätigung bei uncommitteten Änderungen und harter Sperre bei laufender Session.

**Independent Test**: Einen sauberen, bereits integrierten Worktree über die Übersicht entfernen und prüfen, dass er weder auf der Festplatte noch in `git worktree list` noch in der Übersicht erscheint (SC-008).

### Implementation for User Story 4

- [X] T042 [US4] `packages/server/src/services/worktreeOverviewService.ts`: `removeWorktree({ projectId, path, force })` mit allen Guards in dieser Reihenfolge — Projekt unbekannt (404), Pfad nicht in der **frisch gelesenen** Worktree-Liste des Projekts (`not_a_worktree`), Haupt-Checkout (`main_checkout`), `dirState` `registry_only`/`missing` (`not_removable`), aktive Session (`session_active`), uncommittete Änderungen ohne `force` (`uncommitted` inkl. Anzahl); erst danach `WorktreeManager.remove(projectPath, path, { force })` aus `packages/server/src/git/worktrees.ts` (research.md D10)
- [X] T043 [US4] `packages/server/src/services/worktreeOverviewService.ts`: Nachwirkungen bei Erfolg — `FeatureRepo.setWorktree(featureId, null)` nur bei bestehender Zuordnung, `bus.emitEvent('feature_updated', <frisches Feature>)`, Übersicht-Cache verwerfen; bei Fehlschlag keine DB-Änderung und Klartextfehler (FR-027, data-model.md §8)
- [X] T044 [US4] `packages/server/src/api/worktreeRoutes.ts`: `POST /api/worktrees/remove` ergänzen — Body `{ projectId, path, force? }`, Erfolg `200 { ok: true, featureId }`, Fehlercodes exakt nach contracts/http-api.md (`400 not_a_worktree|main_checkout|not_removable`, `404`, `409 session_active`, `409 uncommitted` mit `uncommittedFileCount`, `500 remove_failed`)
- [X] T045 [US4] `packages/server/src/services/worktreeOverviewService.test.ts`: Guard-Pfade testen — unbekannter Pfad, Haupt-Checkout, `registry_only`, aktive Session, uncommittet ohne `force` (409 mit Anzahl) und mit `force` (Erfolg), Erfolgspfad inkl. `setWorktree(id, null)` und verworfenem Cache
- [X] T046 [P] [US4] `packages/web/src/api.ts`: `removeWorktree({ projectId, path, force })` mit typisierten Fehlerfällen (`uncommitted` inkl. `uncommittedFileCount`, `session_active`, `not_a_worktree`, `main_checkout`, `not_removable`, `remove_failed`)
- [X] T047 [US4] `packages/web/src/components/WorktreeOverview.tsx`: Entfernen-Aktion ausschließlich bei `removable === true`; bei `sessionActive` stattdessen der deaktivierte Hinweis „Session aktiv — Entfernen gesperrt"; keine Aktion bei Haupt-Checkout, `registry_only` und `missing` (ui-contract C5.1, C5.6)
- [X] T048 [US4] `packages/web/src/components/WorktreeOverview.tsx`: zweistufiger Bestätigungsfluss über den bestehenden `ConfirmDialog` aus `packages/web/src/components/Sidebar.tsx` — erste Bestätigung nennt Label/Feature, Branch, Pfad und Anzahl betroffener Änderungen; bei `409 uncommitted` eine zweite, deutlich formulierte Bestätigung mit der Anzahl uncommitteter Dateien, die erst `force: true` sendet; Klartextmeldung bei `session_active`/`remove_failed`; Refetch nach jedem Ausgang (ui-contract C5.2–C5.5, FR-023, FR-024, SC-009)

**Checkpoint**: US1–US4 laufen unabhängig — Befund und Bereinigung ohne Terminalwechsel.

---

## Phase 7: User Story 5 - Die Ansicht bildet immer den tatsächlichen Zustand ab (Priority: P5)

**Goal**: Selbsttätige Aktualisierung bei geöffneter Ansicht, manuelles Aktualisieren, unterscheidbare Lade-/Leer-/Fehlerzustände — bei serverseitig gebremster Git-Last.

**Independent Test**: Bei geöffneter Übersicht extern `git worktree add …` ausführen; der neue Eintrag erscheint ohne Zutun innerhalb von 5 s (SC-004).

### Implementation for User Story 5

- [X] T049 [US5] `packages/server/src/services/worktreeOverviewService.ts`: TTL-Cache (2000 ms) über die gesamte Übersicht mit In-Flight-Dedupe (parallele Abrufe teilen dieselbe laufende Erhebung) und `invalidate()`; `collectedAt` weist stets den tatsächlichen Erhebungszeitpunkt aus (contracts/http-api.md → Caching-Verhalten, research.md D8/D9)
- [X] T050 [US5] `packages/server/src/api/worktreeRoutes.ts`: Query-Parameter `?refresh=1` umgeht den Cache (FR-030)
- [X] T051 [US5] `packages/server/src/services/worktreeOverviewService.test.ts`: Tests für Cache-Verhalten — zwei Abrufe innerhalb der TTL liefern denselben `collectedAt`, `refresh` erhöht ihn, parallele Abrufe lösen nur **eine** Erhebung aus, erfolgreiches Entfernen verwirft den Cache
- [X] T052 [US5] `packages/web/src/components/WorktreeOverview.tsx`: Polling alle 5 s, ausschließlich solange die View sichtbar ist; Intervall beim Verlassen abräumen (Muster `packages/web/src/components/ExecutionsView.tsx`) (ui-contract C6.1, FR-029)
- [X] T053 [US5] `packages/web/src/components/WorktreeOverview.tsx`: zusätzlicher Refetch, sobald sich die Feature-Signatur im Store ändert (WS `feature_updated`/`feature_deleted`, Muster `packages/web/src/components/ReviewOverview.tsx`) (ui-contract C6.2)
- [X] T054 [US5] `packages/web/src/components/WorktreeOverview.tsx`: Zustände gemäß ui-contract C6 — „Lade Worktree-Übersicht …" beim Erstladen (keine Platzhalterdaten), „wird aktualisiert …" beim Nachladen statt eines frischen Stands, „Stand `HH:MM:SS`" aus `collectedAt`, Fehlerzeile mit Wiederholen-Möglichkeit, Schaltfläche „↻ Aktualisieren" mit `?refresh=1` und sichtbarem Ladefortschritt (FR-028, FR-030, FR-031)

**Checkpoint**: Alle User Stories sind unabhängig funktionsfähig.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T055 [P] `pnpm -r typecheck && pnpm -r test` im Repo-Root grün — inkl. der unverändert bestehenden Suiten `packages/server/src/git/worktreesCreate.test.ts` und `packages/server/src/services/mergeQueueService.test.ts` (quickstart.md Stufe 1)
- [X] T056 [P] Konventionsprüfung: keine neuen Runtime-Dependencies in `package.json` und `packages/*/package.json`, kein `execSync` in den neuen Server-Dateien, ausschließlich SVG-Icons aus `packages/web/src/components/icons.tsx` (keine Emojis) und durchgängig deutsche UI-Texte in `packages/web/src/components/WorktreeOverview.tsx`
- [X] T057 API-Rauchtest nach [quickstart.md](./quickstart.md) Stufe 2 ausführen (curl + jq auf `localhost:4820/api/worktrees`, Abgleich gegen `git -C <projektpfad> worktree list`) — Nachweis SC-002 und `worktreeCount === (worktrees | length)`
- [X] T058 Manuelle End-to-End-Flows nach [quickstart.md](./quickstart.md) Stufe 3 (a)–(f) durchspielen und Abweichungen beheben (SC-001, SC-005–SC-009)
- [X] T059 Robustheit und Edge Cases nach [quickstart.md](./quickstart.md) Stufe 4 prüfen — unerreichbares Projekt, Verzeichnis ohne `.git`, gleichnamige Features, abweichendes `integrationTarget`, `/var`-Symlink, Chat-Worktree, sowie Lastprüfung „Übersicht 60 s offen, `pgrep -c git` bleibt niedrig" (SC-003, SC-010)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten
- **Foundational (Phase 2)**: nach Setup — **blockiert alle User Stories**
- **US1 (Phase 3)**: nach Foundational — keine Abhängigkeit zu anderen Stories
- **US2 (Phase 4)**: nach Foundational; ergänzt die in US1 gerenderten Einträge um die Dateiebene
- **US3 (Phase 5)**: nach US2 — die Warnlogik setzt die Dateilisten aus US2 voraus (`overlap`, `behind_target`)
- **US4 (Phase 6)**: nach US1 (benötigt Einträge, `removable`, `sessionActive`); inhaltlich sinnvoll nach US3, technisch davon unabhängig
- **US5 (Phase 7)**: nach US1; wirkt auf alle bis dahin gerenderten Inhalte
- **Polish (Phase 8)**: nach allen gewünschten Stories

### User Story Dependencies

- **US1 (P1)**: eigenständig — liefert allein bereits den Kernnutzen (MVP)
- **US2 (P2)**: eigenständig testbar, baut auf den Einträgen aus US1 auf
- **US3 (P3)**: **echte Abhängigkeit zu US2** (Dateilisten sind die Datenbasis der Warnungen)
- **US4 (P4)**: eigenständig testbar, benötigt Einträge aus US1
- **US5 (P5)**: eigenständig testbar, benötigt eine gerenderte Ansicht aus US1

### Within Each User Story

- Pure `shared`-Funktionen vor den Server-Services, die sie nutzen
- Server-Services vor den Routen, Routen vor der Web-Anbindung
- Tests unmittelbar nach (oder TDD-artig vor) der jeweiligen Implementierung, jedenfalls vor dem Story-Checkpoint
- Aufgaben, die dieselbe Datei anfassen (`worktreeOverviewService.ts`, `WorktreeOverview.tsx`), laufen **seriell** — sie sind bewusst **nicht** mit [P] markiert

### Parallel Opportunities

- Phase 2: T002, T003, T010 und T011 parallel (`shared/types.ts`, `server/git/worktreeInventory.ts`, `web/api.ts`, `web/components/icons.tsx`); T005–T009 seriell, da sie aufeinander aufbauen
- Phase 3: T012 (shared) und T018 (store) parallel zur Service-Kette T014–T017
- Phase 4: T025 (shared-Parser) parallel zu offenen Web-Arbeiten aus Phase 3
- Phase 5: T034 (pure `detectOverlaps`) parallel zu T036 (`worktreeChanges.ts`)
- Phase 6: T046 (`web/api.ts`) parallel zur Server-Kette T042–T045
- Phase 8: T055 und T056 parallel
- Mit mehreren Entwickelnden: US1, US2 und US4 nach Phase 2 parallel bearbeitbar; US3 wartet auf US2

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Gleichzeitig startbar — vier verschiedene Dateien, keine gegenseitige Abhängigkeit:
Task: "T002 Neue Typen in packages/shared/src/types.ts ergänzen"
Task: "T003 packages/server/src/git/worktreeInventory.ts — Porcelain-Parser"
Task: "T010 packages/web/src/api.ts — worktrees()-Client"
Task: "T011 packages/web/src/components/icons.tsx — WorktreeIcon"
```

## Parallel Example: Phase 3 (User Story 1)

```bash
# Gleichzeitig startbar:
Task: "T012 featureProgressLabel in packages/shared/src/workflowModel.ts"
Task: "T018 View { kind: 'worktrees' } in packages/web/src/store.tsx"
# Seriell dazu (alle in worktreeOverviewService.ts):
Task: "T014 → T015 → T016 → T017"
```

---

## Implementation Strategy

### MVP First (nur User Story 1)

1. Phase 1 (Setup) abschließen
2. Phase 2 (Foundational) abschließen — **blockiert alles Weitere**
3. Phase 3 (US1) abschließen
4. **STOPP und VALIDIEREN**: quickstart.md Stufe 3 (a) und (b) — Übersicht in zwei Klicks erreichbar, jeder Worktree korrekt zugeordnet, Haupt-Checkout sichtbar, verwaist/fehlend gekennzeichnet
5. Auslieferbar: der ausdrückliche Kernwunsch („durch welches Feature entstand welcher Worktree") ist erfüllt

### Incremental Delivery

1. Setup + Foundational → Basis steht
2. + US1 → unabhängig testen → **MVP**
3. + US2 → Dateiebene, unabhängig testen
4. + US3 → Warnungen (setzt US2 voraus), unabhängig testen
5. + US4 → Entfernen, unabhängig testen
6. + US5 → Selbstaktualisierung, unabhängig testen
7. Polish (Phase 8) → quickstart.md Stufen 1–4 vollständig

### Parallel Team Strategy

1. Phase 1 + 2 gemeinsam abschließen
2. Danach: Entwickler A → US1, Entwickler B → US2 (Parser/Änderungserhebung), Entwickler C → US4 (Entfern-Endpunkt + Guards)
3. US3 startet, sobald US2 die Dateilisten liefert; US5 startet, sobald US1 die Ansicht rendert
4. Achtung: `worktreeOverviewService.ts` und `WorktreeOverview.tsx` sind gemeinsame Dateien — Änderungen dort koordinieren (kein [P])

---

## Notes

- [P] = andere Datei, keine offene Abhängigkeit
- Die zwei Sammelpunkte `packages/server/src/services/worktreeOverviewService.ts` und `packages/web/src/components/WorktreeOverview.tsx` wachsen über mehrere Stories — Aufgaben darauf sind bewusst seriell
- Keine neuen Dependencies, keine DB-Migration, kein neues WS-Event (research.md D8)
- Einzige verändernde Aktion des Features ist `git worktree remove`; Branch-Löschen, `prune` und `repair` bleiben außerhalb des Umfangs
- Nach jeder Aufgabe oder logischen Gruppe committen; an jedem Checkpoint kann die Story eigenständig validiert werden
