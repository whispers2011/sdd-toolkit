# Implementation Plan: Ersetzbare Kernschritte, Stack-Profile und Testing-Lane

**Branch**: `feature/ersetzbare-kernschritte-stack-profile-testing-lane` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/ersetzbare-kernschritte-stack-profile-testing-lane/spec.md`

## Summary

Drei zusammenhängende Anliegen, ein technischer Kern: **das Toolkit erfährt, wo ein Feature
läuft.**

1. **Eine einzige Quelle der Portvergabe.** Ein `PortAllocator` weist jedem Worktree beim Anlegen
   einen exklusiven Portblock fester Breite zu — aufgerufen **ausschließlich** aus
   `WorktreeManager.create()`, durch die beide Anlagepfade (Feature-Worktree und Chat-Worktree)
   ohnehin laufen. Freigabe in `WorktreeManager.remove()`. Der Block steht in einer Env-Datei
   `<worktree>/.sdd/env` und wird über `buildLifecycleEnv()` als `$SDD_PORT_BASE` in jeden
   Lebenszyklus-Schritt gereicht — an **der** einen Stelle, die F1b dafür gebaut hat (F1b FR-013).
2. **Stack-Profile als ersetzbare Kernschritte.** Drei benannte Profile (`test`, `full`, `down`)
   ohne mitgeliefertes Kommando: das Projekt ersetzt jedes vollständig durch sein eigenes. Sie
   laufen über **denselben** Prozess-Runner wie die Lebenszyklus-Schritte (aus
   `lifecycleStepService.ts` nach `services/stepRunner.ts` herausgezogen) — gleiche Login-Shell,
   gleiches Log, gleicher Ausgabe-Ausschnitt, gleiche „Braucht dich"-Meldung, Bewertung
   ausschließlich über Exit-Code und Zeitlimit. `test` läuft ab Beginn von `implement` und bleibt
   stehen; `full` nur auf Anforderung aus der Testing-Lane; `down` an Session-Ende, Merge und
   Worktree-Entfernen.
3. **Manuelles Test-Gate und Testing-Lane.** Eine neue Integrationsstufe `awaiting_manual_test`
   **vor** `awaiting_human_review`, geschaltet über den neuen Automation-Schalter
   `manualTestGate` (Stufe 2 an, Stufe 3 aus). Die Lane zeigt je Feature Worktree-Pfad, Branch,
   klickbare Stack-URL, Anlagedatum und je Dienst Status samt Port — der Dienststatus wird
   **erhoben** (TCP-Probe auf den abgeleiteten Ports), nie aus einem gemerkten Stand behauptet.

Dazu zwei Reparaturen an beobachteten Schäden: das Aufräumen nach dem Merge **prüft** das
Entfernen, bevor es den Worktree-Pfad leert (heute wird der Pfad auch nach einem Fehlschlag
geleert — so wuchs ein 10-GB-Verzeichnis unauffindbar weiter), und Prozesse werden über ihre
**Prozessgruppe** beendet statt über Namensmuster (`process.kill(-pid)`; node-pty macht das Kind
zum Sessionführer). Die Worktree-Übersicht bekommt Größe je Eintrag und eine Plattenwarnung.

**Eine additive DB-Migration** (drei Tabellen + zwei nullable Spalten), **keine neuen
Runtime-Dependencies** (Portprüfung über `node:net`, Größe über `du -sk`, Statusprobe über
`node:net`), **kein neues WS-Event-Schema**. Vier getypte Kataloge (`INTEGRATION_STAGE_META`,
`STAGE_CLASS`, `INTEGRATION_STAGE_IDS`, `AUTOMATION_META`) erzwingen per `Record<Union, …>`, dass
die neue Stufe und der neue Schalter überall beantwortet werden — `pnpm typecheck` bricht sonst.

## Technical Context

**Language/Version**: TypeScript 5.8, Node ≥ 22 (ESM), pnpm-10-Workspace

**Primary Dependencies**: Fastify 5 (API), React 19 + Tailwind 4 (Web), better-sqlite3 12 (DB +
Migration), node-pty (Sessions), `node:net` (Portprüfung + Statusprobe), `node:child_process`
(Profil-/Schritt-Runner, `du -sk`). Bewusst **keine neuen Runtime-Dependencies** — kein
Docker-SDK, kein Compose-Parser, keine Prozess-Bibliothek, kein Portmanager-Paket.

**Storage**: SQLite, eine neue Migration am Ende von `MIGRATIONS` in `db/database.ts`:

- `port_blocks` — die einzige Buchführung der Portvergabe (Besitzer = Worktree **oder** Projekt,
  letzteres für projektweit geteilte Dienste)
- `feature_stacks` — welches Profil für ein Feature betrieben werden **soll** (Absicht, nie Status)
- `manual_test_decisions` — Bestätigung/Ablehnung der manuellen Abnahme mit Zeitpunkt und Grund
- `ALTER TABLE projects ADD COLUMN stack TEXT NOT NULL DEFAULT '{}'` — Profilkommandos + Dienstliste
- `ALTER TABLE features ADD COLUMN cleanup_error TEXT` — Grund eines fehlgeschlagenen Aufräumens

Kein Backfill, alle Zusätze nullable/defaulted ⇒ eine bestehende Datenbank verhält sich ohne
konfigurierte Stack-Profile unverändert (FR-013, SC-010).

**Testing**: vitest 3 (`pnpm -r test`), `pnpm -r typecheck`. Pure Logik in `packages/shared`
(Portblock-Arithmetik, Dienstport-Ableitung, URL-Bildung, Profil-Auswahl je Lane-Aktion,
Stufen-Kataloge) als Unit-Tests ohne IO. Server-Services gegen In-Memory-DB
(`openMemoryDatabase()`) mit injizierten Sonden (`probePort`, `readDirSize`) und injiziertem
Runner — Muster: `AgentGateService`, `LifecycleStepService`, `ResourceMonitor`. Prozess-Ausführung
gegen echte triviale Kommandos (`true`, `exit 3`, `sleep`) in Temp-Verzeichnissen; Portprüfung
gegen einen echten, im Test selbst geöffneten Listener.

**Target Platform**: lokaler Entwickler-Server (macOS/Linux), Web-UI im Browser

**Project Type**: pnpm-Monorepo — `packages/shared` (pure Typen/Funktionen), `packages/server`
(API + Services + git + pty), `packages/web` (React-SPA)

**Performance Goals**:

- Projekt **ohne** Stack-Konfiguration: null zusätzliche Prozesse, null zusätzliche Executions,
  keine messbare Verzögerung bis zum Start der ersten Phase (SC-010). Fast-Path ist ein Blick auf
  ein leeres Konfigurationsobjekt, kein Query und kein Spawn.
- Portvergabe beim Anlegen eines Worktrees: < 200 ms für einen Block (nebenläufige Bind-Probe über
  alle Ports des Blocks, Zeitlimit 500 ms je Block).
- Statuserhebung eines Stacks: < 1 s für sieben Dienste (nebenläufige TCP-Probe, 300 ms
  Verbindungs-Zeitlimit je Dienst, 3-s-Cache) — die Lane bleibt bedienbar.
- Größenerhebung je Worktree: Zeitlimit 3 s, nebenläufig mit derselben Bremse (6) wie die übrige
  Worktree-Erhebung; Zeitüberschreitung ⇒ Größe „unbekannt", der Eintrag bleibt vollständig
  sichtbar (FR-044).

**Constraints**:

- **Keine mitgelieferten Profilkommandos** und keine vorausgesetzte Container-Technik (FR-012).
  Das Toolkit kennt Profilnamen, Portblock und Dienstliste — nicht Docker, nicht Compose.
- **Kein Urteil aus der Ausgabe**: Profilläufe werden ausschließlich über Exit-Code und Zeitlimit
  bewertet (identisch mit F1b).
- **Kein Prozess-Kill über generische Muster** (CLAUDE.md, global + Projekt): beendet wird
  ausschließlich die **eigene** Prozessgruppe über die gemerkte PID. `pkill`/`killall` kommen im
  gesamten Feature nicht vor — das ist FR-040/FR-041 und zugleich Projektregel.
- **Nur zwei neue Variablen im Variablensatz** (`SDD_PORT_BASE`, `SDD_PROFILE`), ergänzt in
  `buildLifecycleEnv()`; kein zweiter Weg zur Portvergabe oder zum Variablensatz (FR-007).
- **Der Worktree-Pfad wird erst nach nachgewiesenem Entfernen geleert** (FR-036) — die Prüfung ist
  `existsSync` **nach** dem `git worktree remove`, nicht der Rückgabewert allein.
- **Env-Datei ist ein Erzeugnis** und darf nie in einen Commit geraten (FR-009): Ausschluss über
  `$GIT_COMMON_DIR/info/exclude` (nicht versioniert) **und** Nachprüfung mit `git check-ignore`.
- Deutsche UI, dunkles Layout, **Symbole als SVG-Icons** aus `components/icons.tsx`
  (Konvention `specs/emojis-im-projekt-immer-als-svg-icon-hinterlegen`).
- Jede neue Aktion durchläuft `actionPolicy.evaluateAction()` und wird serverseitig über
  `ActionGuard` durchgesetzt — keine Bedingung nur in der Oberfläche (bestehende Regel FR-024 des
  Features „ehrlichkeit-vor-dem-merge").

**Scale/Scope**: Einzelnutzer/Kleinteam auf einer Maschine. Bis ~10 Projekte, je Projekt eine
Handvoll Dienste, 2–4 Features gleichzeitig aktiv. Portblöcke: Vorgabe Start 21000, Breite 20,
Ende 29980 ⇒ 449 Blöcke (Konfiguration `SDD_PORT_RANGE_START` / `SDD_PORT_BLOCK_SIZE` /
`SDD_PORT_RANGE_END`). Plattenwarnung: Vorgabeschwelle 10 GiB freier Platz
(`SDD_DISK_WARN_BYTES`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein **unausgefülltes Template** — es existiert keine
ratifizierte Projekt-Constitution. Ersatzweise gelten die etablierten Repo-Konventionen als
Gates; alle erfüllt:

- ✅ **Pure Logik in `shared`, mit vitest getestet**: Portblock-Arithmetik und Dienstport-Ableitung
  (`ports.ts`), Profil-Auswahl je Lane-Aktion und URL-Bildung (`stackProfiles.ts`), alle
  Stufen-/Schalter-Kataloge — pure Funktionen ohne IO.
- ✅ **Keine neuen Runtime-Dependencies**: bestätigt (0 neue Deps).
- ✅ **Bestehende Muster wiederverwenden statt neue erfinden**: Profil-Ausführung über den
  herausgezogenen Runner von F1b; Konfigurations-UI nach `ProjectSettings.verifyCommands`;
  Statuserhebung mit Cache nach `ResourceMonitor`/`WorktreeOverviewService`; neue Stufe nach dem
  Muster `verification_unconfigured`; neuer Schalter nach `autoVerify`; Lane-Ansicht nach
  `ReviewOverview`; Aktionsfreigabe über `actionPolicy` + `ActionGuard`; Routen der Lane in einer
  eigenen Datei nach `worktreeRoutes.ts`.
- ✅ **Drift-Guard statt still veraltender Kataloge**: die neue Stufe `awaiting_manual_test` und
  der Schalter `manualTestGate` sind über `Record<IntegrationStage, …>` bzw.
  `Record<keyof AutomationSettings, …>` in vier Katalogen erzwungen, plus Laufzeit-Exhaustiveness
  in `workflowModel.test.ts` / `actionPolicy.test.ts`.
- ✅ **Additive Migration, keine Vertragsbrüche**: drei neue Tabellen, zwei nullable/defaulted
  Spalten; kein bestehender Typ verliert ein Feld.
- ✅ **Rückwärtsverhalten explizit geschützt** (FR-008/FR-013/FR-027, SC-007/SC-010): eigene Tests
  „Schritt ohne neue Variablen unverändert", „Projekt ohne Stack-Konfiguration unverändert",
  „Gate aus ⇒ Stufe wird nicht betreten".
- ✅ **Messen und beurteilen, nicht behaupten**: der Dienststatus wird erhoben (FR-023), das
  Entfernen des Worktrees wird geprüft (FR-034), ein verwaister Worktree wird aktiv gemeldet
  (FR-039) — die drei Stellen, an denen das Toolkit bisher einen Stand angenommen hat.
- ✅ **Prozess-Disziplin** (CLAUDE.md/Global): ausschließlich eigene Prozessgruppen über gemerkte
  PIDs; kein `pkill`/`killall`, keine generischen Muster — im Code **und** in der quickstart.md.
- ✅ **Deutsche UI + SVG-Icons statt Emojis**: eingehalten.

**Post-Design-Re-Check (nach Phase 1)**: unverändert bestanden. Das Design führt kein neues Paket,
kein Framework und keine zweite Persistenzschicht ein. Zwei strukturelle Änderungen an
Bestandscode sind begründet und dokumentiert: der Prozess-Runner wird aus
`lifecycleStepService.ts` nach `services/stepRunner.ts` herausgezogen, damit Schritte und Profile
**einen** Ausführungspfad haben (research.md E6), und `WorktreeManager` bekommt den
`PortAllocator` injiziert, damit die Zuweisung an genau einer Stelle sitzt (E1).
**Complexity Tracking bleibt leer.**

## Project Structure

### Documentation (this feature)

```text
specs/ersetzbare-kernschritte-stack-profile-testing-lane/
├── plan.md                      # Diese Datei
├── research.md                  # Phase 0: Leitentscheidungen mit Begründung (E1–E15)
├── data-model.md                # Phase 1: Entitäten, Schema, Zustände, Ableitungsregeln
├── quickstart.md                # Phase 1: End-to-End-Validierungsszenarien
├── contracts/
│   ├── stack-profiles.md        # Profil-/Kommando-Vertrag: Env, cwd, Bewertung, geteilte Dienste
│   ├── http-api.md              # Testing-Lane, Stack-Aktionen, Abnahme, Aufräumen, Konfiguration
│   └── ui-contract.md           # Testing-Lane, Worktree-Übersicht, Dial-Schalter, Inbox
└── tasks.md                     # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── types.ts                          # + IntegrationStage 'awaiting_manual_test';
│                                     #   LifecycleStageId += 'manual_test';
│                                     #   AutomationSettings.manualTestGate (+ LEVEL2/LEVEL3);
│                                     #   LifecycleContext += portBase/profile;
│                                     #   StackConfig, StackProfile, StackService, StackProfileName,
│                                     #   FeatureStackView, StackServiceView, TestingLaneEntry,
│                                     #   ManualTestDecision, PortBlock;
│                                     #   WorktreeEntry.sizeBytes, WorktreeOverview.disk;
│                                     #   AttentionKind += manual_test_due | stack_failed |
│                                     #   worktree_cleanup_failed | orphan_worktree
├── ports.ts (NEU)                    # pure Portblock-Domäne: blockStarts(), portFor(service),
│                                     #   stackUrl(), PORT_DEFAULTS
├── ports.test.ts (NEU)
├── stackProfiles.ts (NEU)            # pure Profil-Domäne: profilesForLaneAction(),
│                                     #   isStackConfigured(), primaryService(), STACK_PROFILE_META
├── stackProfiles.test.ts (NEU)
├── lifecycleSteps.ts                 # buildLifecycleEnv(): + SDD_PORT_BASE, SDD_PROFILE (DIE Stelle)
├── lifecycleSteps.test.ts            # + „acht Schlüssel, immer alle da", + Alt-Kommando unverändert
├── workflowModel.ts                  # + INTEGRATION_STAGE_META['awaiting_manual_test'],
│                                     #   INTEGRATION_STEPS += manual_test, AUTOMATION_META.manualTestGate
├── workflowModel.test.ts             # + Exhaustiveness (Stufe, Schalter, IDs == STAGE_IDS)
├── actionPolicy.ts                   # + STAGE_CLASS-Eintrag, DECISION_REASON-Eintrag,
│                                     #   FeatureActionId += manual_test_confirm|manual_test_reject|
│                                     #   stack_up|stack_stop|stack_restart|stack_down,
│                                     #   FeatureActionContext += stackConfigured/stackRunning
├── actionPolicy.test.ts              # + Matrix der sechs neuen Aktionen
└── index.ts                          # Re-Export von ports.js, stackProfiles.js

packages/server/src/
├── config.ts                         # + portRangeStart/portRangeEnd/portBlockSize, diskWarnBytes
├── db/database.ts                    # + Migration (port_blocks, feature_stacks,
│                                     #   manual_test_decisions, projects.stack, features.cleanup_error)
├── db/portRepo.ts (NEU)              # Buchführung der Blöcke (belegen/freigeben/lesen)
├── db/portRepo.test.ts (NEU)
├── db/stackRepo.ts (NEU)             # feature_stacks + manual_test_decisions
├── db/stackRepo.test.ts (NEU)
├── db/repos.ts                       # ProjectRepo: stack lesen/schreiben; FeatureRepo: cleanupError
├── services/portAllocator.ts (NEU)   # DIE Zuweisung: ensureFor(), release(),
│                                     #   reconcile() (verwaiste Blöcke), Env-Datei + git-Ausschluss
├── services/portAllocator.test.ts (NEU)
├── services/stepRunner.ts (NEU)      # aus lifecycleStepService herausgezogen: Login-Shell,
│                                     #   Log-Stream, Tail, Zeitlimit, Prozessgruppen-Kill
├── services/stepRunner.test.ts (NEU)
├── services/lifecycleStepService.ts  # nutzt stepRunner; portBase/profile in den Kontext
├── services/stackService.ts (NEU)    # up('test'|'full'), stop(), restart(), down(),
│                                     #   probe() (erhobener Status), geteilte Dienste (letzter räumt ab)
├── services/stackService.test.ts (NEU)
├── services/testingLaneService.ts (NEU)  # Lane-Einträge, confirm(), reject()
├── services/testingLaneService.test.ts (NEU)
├── services/orchestrator.ts          # `test`-Profil ab Beginn `implement` (vor Schritten/Agents);
│                                     #   `down` bei Session-Ende/Archiv/Löschen
├── services/mergeQueueService.ts     # neue Stufe im Ablauf; cleanupMerged prüft das Entfernen
│                                     #   (FR-034/035/036) und ruft `down` davor
├── services/actionGuard.ts           # buildContext + stackConfigured/stackRunning
├── services/attentionReconciler.ts   # vier neue Arten: Gültigkeitsregeln
├── services/worktreeOverviewService.ts   # + Größe je Eintrag, Plattenwarnung,
│                                         #   verwaiste Worktrees als Meldung (FR-039)
├── git/worktrees.ts                  # create(): Block zuweisen; remove(): prüfen + freigeben
├── pty/sessionManager.ts             # terminate(): Prozessgruppe statt nur PTY-Handle
├── api/server.ts                     # Stack-Aktionen + manuelle Abnahme + Aufräum-Wiederholung
├── api/testingLaneRoutes.ts (NEU)    # GET /api/testing-lane, Stack-/Abnahme-Routen
└── index.ts                          # PortAllocator, StackService, TestingLaneService verdrahten

packages/web/src/
├── api.ts                            # + testingLane(), featureStack(), stackAction(),
│                                     #   confirmManualTest(), rejectManualTest(), retryCleanup()
├── store.tsx                         # + View { kind: 'testing' }; featureActionContext um
│                                     #   stackConfigured/stackRunning
├── App.tsx                           # Rendering der neuen View
├── components/Sidebar.tsx            # Einstieg „Testing-Lane" (SVG-Icon, Zähler)
├── components/icons.tsx              # + FlaskIcon/StackIcon (SVG)
├── components/TestingLane.tsx (NEU)  # Lane-Ansicht: fünf Angaben, Dienstliste, vier Stack-Aktionen,
│                                     #   Abnahme bestätigen/ablehnen
├── components/StackPanel.tsx (NEU)   # Dienstliste + Aktionen (auch in der Feature-Konsole)
├── components/ProjectSettings.tsx    # Stack-Profile + Dienstliste konfigurieren
├── components/AutomationDial.tsx     # Schalter „Manuelles Test-Gate"
├── components/WorktreeOverview.tsx   # Größe je Eintrag + Plattenwarnung
├── components/KanbanBoard.tsx        # neue Stufe auf der Kachel (aus dem Katalog, kein Rohtext)
└── components/ReviewOverview.tsx     # neue Stufe in der Abschnitts-Einteilung
```

**Structure Decision**: Das bestehende 3-Paket-Monorepo bleibt unverändert. Die neue Logik folgt
der etablierten Schichtung (pure `shared`-Module → `server`-Repo/Service → Web-Komponenten). Die
Routen der Testing-Lane liegen in einer **eigenen** Datei (`testingLaneRoutes.ts`) nach dem
Vorbild `worktreeRoutes.ts` — `server.ts` ist mit ~1720 Zeilen bereits am Limit; die Stack-Aktionen
eines Features bleiben dagegen bei den übrigen `/api/features/:id/*`-Routen, weil sie zu deren
Wach-/Guard-Muster gehören.

## Umsetzungsreihenfolge (empfohlen, Story-Prioritäten folgend)

1. **Portblock-Fundament** (US1, P1): `ports.ts` (Blockarithmetik, Dienstport, URL) mit Tests;
   `port_blocks`-Migration + `PortRepo`; `PortAllocator` mit Bind-Probe, Erschöpfungsfehler
   (FR-010) und Env-Datei-Schreiben; Einhängen in `WorktreeManager.create()/remove()`
   (**die** eine Stelle); `reconcile()` für extern gelöschte Worktrees.
2. **Variablensatz** (US1 Szenario 2/6, SC-007): `LifecycleContext` + `buildLifecycleEnv()` um
   `SDD_PORT_BASE`/`SDD_PROFILE` erweitern; `LifecycleStepService` reicht den Block des eigenen
   Worktrees herein; Test „Alt-Kommando ohne die neuen Variablen unverändert".
3. **Ein Ausführungspfad** (Basis für US2): Runner aus `lifecycleStepService.ts` nach
   `services/stepRunner.ts` herausziehen, dabei **Prozessgruppen-Kill** ergänzen (`detached: true`,
   `kill(-pid)`) — deckt FR-040/FR-041 für Schritte und Profile in einem Zug.
4. **Prozessende der Sessions** (US4 Szenario 6, SC-008): `sessionManager.terminate()` beendet die
   Prozessgruppe des eigenen PTY; Test mit zwei gleichnamigen Prozessen aus zwei Sessions.
5. **Stack-Konfiguration + Profile** (US2, P1): `projects.stack` (Migration, Repo, Typen);
   `stackProfiles.ts`; `StackService` mit `up/stop/restart/down`, Idempotenz (FR-015),
   Fehlschlag → `stack_failed`-Meldung mit Ausschnitt (FR-019), geteilte Dienste (genau einmal;
   letzter räumt ab — FR-022); `feature_stacks` als Absichts-Buchführung.
6. **Statuserhebung** (US2/US3, FR-023): TCP-Probe je Dienst mit Cache; `FeatureStackView`;
   `GET /api/features/:id/stack`.
7. **`test` ab `implement`** (US2 Szenario 1/2/5, SC-006): Einhängen in den before-phase-Vorlauf
   des Orchestrators **vor** Schritten und Agents; kein Neustart über Läufe hinweg.
8. **`down` an allen drei Punkten** (US2/US4, FR-017): Session-Ende, Merge-Abschluss,
   Worktree-Entfernen — plus Archivieren/Löschen (Edge Case).
9. **Neue Stufe + Schalter** (US3, P1): `awaiting_manual_test` in allen vier Katalogen;
   `manual_test` in `INTEGRATION_STAGE_IDS`/`INTEGRATION_STEPS`; `manualTestGate` in
   `AutomationSettings` + Level-Vorgaben; Einbau in `beginIntegration()`; Gate aus ⇒ Ablauf
   unverändert (FR-027).
10. **Manuelle Abnahme** (US3 Szenarien 6/7): `manual_test_decisions`; `confirm()` führt weiter
    (Queue oder menschliches Review), `reject()` über den bestehenden Zurückweisungs-Pfad zurück
    in die Nacharbeit; `manual_test_due`-Meldung + Reconciler-Regel.
11. **Testing-Lane** (US3, der eigentliche Zweck): `testingLaneService` + Routen;
    `TestingLane.tsx` mit den fünf Angaben, Dienstliste und vier Aktionen; Sidebar-Einstieg;
    Aktionsfreigabe über `actionPolicy`/`ActionGuard`; „kein Stack konfiguriert" / „nicht
    erreichbar" statt Link ins Leere (FR-033).
12. **Aufräumen mit Nachweis** (US4, P2): `WorktreeManager.remove()` prüft `existsSync`;
    `cleanupMerged()` leert den Pfad erst danach, sonst `worktree_cleanup_failed` +
    `features.cleanup_error`; Wiederholung über `POST /api/features/:id/cleanup` (FR-037).
13. **Verwaiste Worktrees melden** (US4 Szenario 5, SC-011): `orphan_worktree` aus der
    Worktree-Erhebung, Auflösung wenn der Eintrag verschwindet.
14. **Plattenplatz** (US5, P3): Größe je Worktree (`du -sk`, Zeitlimit, „unbekannt" erlaubt),
    Plattenwarnung mit Schwelle und den größten Worktrees.
15. **Verifikation**: `pnpm -r typecheck && pnpm -r test` grün; manuelle Flows gemäß
    [quickstart.md](./quickstart.md), insbesondere der Zwei-Feature-Durchlauf (SC-001) und die
    Klickprobe der Stack-URL (SC-002).

Schritte 1–11 liefern die drei P1-Stories und sind allein auslieferbar; 12–13 sind US4 (P2),
14 ist US5 (P3).

## Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Zwei Quellen der Portvergabe entstehen doch (F1b FR-013 warnt davor) | Die Zuweisung sitzt **ausschließlich** in `WorktreeManager.create()`, durch die beide Anlagepfade laufen; `PortAllocator` ist die einzige Klasse mit Schreibzugriff auf `port_blocks`; ein Test belegt, dass `prepareWorktree()` und der Chat-Pfad denselben Block sehen (E1) |
| Env-Datei landet über `git add -A` in `commitWorktree()` im Merge (FR-009) | Ausschluss in `$GIT_COMMON_DIR/info/exclude` (nicht versioniert, gilt für alle Worktrees des Repos), **plus** Nachprüfung mit `git check-ignore -q` nach dem Schreiben; scheitert sie, entsteht eine Meldung statt eines stillen Commits (E4) |
| Fremdprozess belegt einen Port erst nach der Zuweisung | Bewusst akzeptiert (Edge Case der Spec): die Zuweisung bleibt stabil (FR-004), der Fehlschlag beim Hochfahren nennt den Port über den Ausgabe-Ausschnitt der `stack_failed`-Meldung |
| Portblöcke erschöpft | `PortAllocator` wirft mit klarem Text; `createFeature()` rollt den Datensatz wie heute zurück (bestehender Pfad) — keine stille Doppelvergabe (FR-010) |
| Ein voller Stack pro Feature stellt die Kostenlage wieder her | `full` fährt **nur** auf Anforderung hoch (FR-016, Assumption der Spec); die Lane zeigt es als Aktion, nie automatisch; SC-005 durch Test „drei Features ⇒ drei `test`, höchstens ein `full`" |
| Geteilter Dienst wird von zwei Features gleichzeitig gestartet | Serialisierung pro `(projectId, 'shared')` über dasselbe `serialize()`-Muster wie `WorktreeManager`; davor eine Statusprobe ⇒ er entsteht genau einmal (FR-022, Edge Case) |
| Geteilter Dienst wird zu früh abgebaut | Abbau nur, wenn kein weiteres Feature des Projekts eine Stack-Absicht in `feature_stacks` hat; sonst läuft nur das feature-eigene Kommando (E7) |
| Gemerkter Stack-Zustand widerspricht der Realität nach Server-Neustart | `feature_stacks` hält **nur die Absicht**; jeder angezeigte Dienststatus kommt aus einer frischen TCP-Probe (FR-023, Edge Case „Server startet neu") |
| Der Merge räumt halb auf und meldet Erfolg | `remove()` prüft nach dem Git-Aufruf `existsSync`; `cleanupMerged()` leert `worktree_path` nur bei Nachweis, sonst `worktree_cleanup_failed` + `cleanup_error`; Test „Entfernen scheitert ⇒ Pfad bleibt" (FR-034–036, SC-004) |
| `down` vor dem Entfernen scheitert und blockiert den Merge | `down`-Fehlschlag meldet sich (FR-019) und **verhindert** das Leeren des Pfades, lässt den Merge aber bestehen — dieselbe Linie wie ein fehlgeschlagener `after_stage merged`-Schritt in F1b |
| Prozessgruppen-Kill trifft fremde Prozesse | Es wird ausschließlich `-pid` der **selbst gestarteten** PTY-/Child-Prozesse verwendet (node-pty macht das Kind zum Sessionführer, `spawn(detached:true)` setzt eine eigene Gruppe); `pkill`/`killall` kommen nicht vor; Test mit zwei gleichnamigen Prozessen aus zwei Sessions (FR-041, SC-008) |
| Neue Stufe veraltet eine Aufzählung still | Vier `Record<Union, …>`-Kataloge erzwingen Einträge (Compile-Fehler) + Laufzeit-Exhaustiveness; die Spec nennt das ausdrücklich als Abhängigkeit („alle Stellen, die Stufen vollständig aufzählen") |
| Gate wird eingeschaltet, während ein Feature schon auf `awaiting_human_review` steht | Der Schalter wird **beim Durchlauf** gelesen, nie rückwirkend angewandt; kein Rückwärts-Übergang im Code — Test dafür (Edge Case) |
| Größenerhebung bremst die Worktree-Übersicht | `du -sk` mit 3-s-Zeitlimit in derselben Nebenläufigkeitsbremse; Fehlschlag ⇒ `sizeBytes: null` („unbekannt"), Eintrag bleibt vollständig (FR-044) |
| Stack-Kommando aus der DB = Command-Injection-Fläche | Bewusst, identisch mit Verifikations-Kommandos und F1b-Schritten: vom Menschen konfiguriert, **nichts wird interpoliert** — Kontext kommt ausschließlich als Umgebungsvariablen |
| Projekt ohne Stack-Konfiguration wird schlechter bedienbar | Fast-Path ohne Query und ohne Spawn; die Lücke ist in Lane und Feature-Konsole benannt, erzeugt aber **kein** Inbox-Item (E13) — sie blockiert nichts (FR-013, SC-010) |

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Keine Verstöße — Tabelle bleibt leer.
