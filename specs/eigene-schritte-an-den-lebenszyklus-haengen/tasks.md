---
description: "Aufgabenliste für die Umsetzung — eigene Schritte an den Lebenszyklus hängen"
---

# Tasks: Eigene Schritte an den Lebenszyklus hängen

**Input**: Design-Dokumente aus `specs/eigene-schritte-an-den-lebenszyklus-haengen/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: **erforderlich.** Die Spezifikation verlangt sie ausdrücklich — SC-007 („nachgewiesen
durch automatisierte Tests über alle drei Ebenen") und SC-009 („Beide Fehlerverhalten … durch
automatisierte Tests abgedeckt"). Zusätzlich sichern die Drift-Guards aus FR-008 den
Auslöser-Katalog gegen stilles Veralten. Testdateien liegen nach Repo-Konvention **neben** der
Implementierung (`foo.ts` → `foo.test.ts`), nicht in einem `tests/`-Baum.

**Organization**: Aufgaben sind nach User Story gruppiert, damit jede Story eigenständig
umsetzbar, prüfbar und auslieferbar ist.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallelisierbar (andere Datei, keine Abhängigkeit auf unfertige Aufgaben)
- **[Story]**: zugehörige User Story (US1 … US5)
- Jede Aufgabe nennt den exakten Dateipfad

## Path Conventions

pnpm-Monorepo mit drei Paketen (plan.md „Project Type"):

- `packages/shared/src/` — pure Typen und Funktionen, Tests co-lokiert
- `packages/server/src/` — `db/`, `services/`, `api/`
- `packages/web/src/` — `components/`, `api.ts`, `store.tsx`, `App.tsx`

---

## Phase 1: Setup (gemeinsame Grundlage)

**Purpose**: Ausgangsstand festhalten und die eigene Test-Instanz vorbereiten

- [X] T001 Ausgangsstand festhalten: `pnpm install && pnpm -r typecheck && pnpm -r test` im
      Repo-Root ausführen und das Ergebnis notieren — spätere Fehlschläge müssen diesem Feature
      zuordenbar sein
- [X] T002 [P] Eigene Test-Instanz nach [quickstart.md](./quickstart.md) §0 vorbereiten:
      `SDD_PORT=4899 SDD_WEB_PORT=4898 SDD_DATA_DIR="$(mktemp -d)/sdd-test"` und ein
      Wegwerf-Git-Projekt unter `/tmp/sdd-demo`. **Niemals 4820/4830 belegen und niemals
      `pkill -f vite|tsx`** — die laufende Toolkit-Instanz ist der Elternprozess dieser Arbeit
      (CLAUDE.md); Abräumen ausschließlich über `lsof -ti:4899 | xargs -r kill`

---

## Phase 2: Foundational (blockierende Voraussetzungen)

**Purpose**: Typen, pure Domäne und Schema — ohne diese Phase kann keine User Story beginnen

**⚠️ CRITICAL**: Keine Story-Arbeit vor Abschluss dieser Phase

- [X] T003 Typen in `packages/shared/src/types.ts` ergänzen: `LIFECYCLE_TRIGGER_KINDS` (`as const`)
      + `LifecycleTriggerKind`, `INTEGRATION_STAGE_IDS` (`as const`) + `LifecycleStageId`,
      `LifecycleTrigger`, `LifecycleStep`, `LifecycleStepFeatureDecision`, `LifecycleContext`,
      `FeatureLifecycleStepView` nach [data-model.md](./data-model.md) §1–§3, §5, §7; außerdem
      `ExecutionRecord.kind` += `'lifecycle_step'`, neues `ExecutionRecord.label: string | null`
      und `AttentionKind` += `'lifecycle_step_failed'`.
      **Abweichung von plan.md, bewusst**: `INTEGRATION_STAGE_IDS` liegt in `types.ts`, nicht in
      `workflowModel.ts` — `workflowModel.ts` importiert bereits aus `types.ts` (Zeile 14), die
      Gegenrichtung wäre ein Zyklus. `workflowModel.ts` verwendet die Konstante (T006)
- [X] T004 `packages/shared/src/lifecycleSteps.ts` (NEU) anlegen mit der puren Domäne nach
      research.md E3/E4/E12: `triggerMatches()`, `resolveLifecycleSteps(steps, selection, trigger)`
      (Regeln exakt wie `resolveAgentsForTrigger` in `packages/shared/src/agentSelect.ts`),
      `compareStepOrder()` (global vor Projekt, dann `sortOrder`, dann `name`),
      `lifecycleCwdKind(trigger)`, `buildLifecycleEnv(ctx)` (genau sechs Schlüssel,
      nicht Zutreffendes = `''`), `DEFAULT_STEP_TIMEOUT_MS = 15 * 60_000`, `tailLines(text, 20, 2000)`.
      Kein IO, keine Node-Importe (hängt von T003 ab)
- [X] T005 `packages/shared/src/index.ts` um `export * from './lifecycleSteps.js';` erweitern
      (hängt von T004 ab)
- [X] T006 `packages/shared/src/workflowModel.ts`: `IntegrationStep.id` (Zeile 230 ff.) von
      `string` auf `LifecycleStageId` verengen und `LIFECYCLE_TRIGGER_META:
      Record<LifecycleTriggerKind, { title: string; short: string }>` mit den Titeln aus
      [contracts/lifecycle-triggers.md](./contracts/lifecycle-triggers.md) §1 und den Chip-Texten
      aus [contracts/ui-contract.md](./contracts/ui-contract.md) §2 ergänzen (hängt von T003 ab)
- [X] T007 [P] Drift-Guards in `packages/shared/src/workflowModel.test.ts` (FR-008): jede Art aus
      `LIFECYCLE_TRIGGER_KINDS` hat einen nicht-leeren Eintrag in `LIFECYCLE_TRIGGER_META`, und
      `INTEGRATION_STEPS.map(s => s.id)` ist gleich `INTEGRATION_STAGE_IDS` (Reihenfolge inklusive)
- [X] T008 [P] `packages/shared/src/lifecycleSteps.test.ts` (NEU) mit den Grundfällen:
      `triggerMatches` (Art, Phase, Stufe; Nichttreffer), `compareStepOrder` (global vor Projekt,
      Gleichstand nach Name), `lifecycleCwdKind` (`before_worktree_create` und
      `after_stage:merged` → `'main'`, sonst `'worktree'`)
- [X] T009 Migration am **Ende** von `MIGRATIONS` in `packages/server/src/db/database.ts` nach
      [data-model.md](./data-model.md) §8: Tabellen `lifecycle_steps` und
      `lifecycle_step_feature_selection`, Indizes `idx_lifecycle_steps_project` /
      `idx_lifecycle_steps_trigger`, `ALTER TABLE executions ADD COLUMN label TEXT`. Additiv,
      kein Backfill, keine Seeds
- [X] T010 `packages/server/src/db/repos.ts`: `ExecutionStartInput.label?: string | null`
      (Zeile 394 ff.), `label` in das INSERT von `ExecutionRepo.start()` (Zeile 426 ff.) und in
      `map()` aufnehmen (hängt von T009 ab)
- [X] T011 [P] `packages/server/src/db/executionRepo.test.ts`: `label` wird gespeichert und
      gelesen; `reapOrphans()` markiert einen laufenden `lifecycle_step`-Eintrag beim Boot als
      `orphaned` (FR-021 — nagelt die vorhandene Kopplung fest)

**Checkpoint**: Typen, pure Domäne und Schema stehen — die User Stories können beginnen

---

## Phase 3: User Story 1 - Kommando nach der Worktree-Anlage automatisch ausführen (Priority: P1) 🎯 MVP

**Goal**: Ein am Projekt hinterlegter Schritt „nach Worktree-Anlage" läuft bei jeder Feature-Anlage
automatisch im neuen Worktree, bevor die erste Phase startet, und erscheint mit Dauer, Ergebnis und
Exit-Code in der Läufe-Ansicht.

**Independent Test**: Über die neue Sidebar-Ansicht am Projekt einen Schritt mit Auslöser „Nach
Worktree-Anlage" und Kommando `echo "vorbereitet für $SDD_FEATURE" > .sdd-prepared` anlegen, ein
Feature erzeugen und prüfen: (a) die Datei liegt im neuen Worktree, (b) der Lauf steht in der
Läufe-Ansicht mit Name, Startzeit, Dauer, `erfolgreich`, `exit 0`, (c) ohne konfigurierten Schritt
verhält sich das Toolkit unverändert.

### Persistenz und Ausführung

- [X] T012 [US1] `packages/server/src/db/lifecycleStepRepo.ts` (NEU) nach dem Muster von
      `packages/server/src/db/agentRepo.ts`: `list()`, `forProject(projectId)` mit
      `WHERE project_id IS NULL OR project_id = ?` und
      `ORDER BY project_id IS NOT NULL, sort_order, name`, `get(id)`, `upsert(step)` mit
      Trigger-Normalisierung (nicht zutreffende `trigger_phase`/`trigger_stage` auf `NULL`),
      `delete(id)`
- [X] T013 [P] [US1] `packages/server/src/db/lifecycleStepRepo.test.ts` (NEU) gegen
      `openMemoryDatabase()`: Union global ∪ Projekt, Sortierung global vor Projekt,
      Trigger-Normalisierung, idempotentes Löschen
- [X] T014 [US1] `packages/server/src/services/lifecycleStepService.ts` (NEU) — Kern nach
      research.md E6/E7: `hasStepsFor(projectId, featureId, trigger)` als Fast-Path und
      `runTrigger(...)`, das die geltenden Schritte **sequentiell** ausführt. Je Schritt:
      `executions.start({ kind: 'lifecycle_step', label: step.name, phase: trigger.phase ?? null,
      logPath: <dataDir>/logs/<execId>.log })`, `spawn($SHELL, ['-l','-c', command])` über
      `packages/server/src/pty/loginShellEnv.ts`, `stdin: 'ignore'`, stdout+stderr **gestreamt** in
      die Log-Datei mit Kopfzeile `=== <name>: <command> ===`, `cwd` = Worktree,
      Umgebung = Login-Shell + `buildLifecycleEnv()` aus T004, Abschluss über
      `executions.finish(execId, exitCode)` **ohne** `tokens`/`tokensSource`/`costMicros`
      (FR-020: nie 0, nie geschätzt)
- [X] T015 [P] [US1] `packages/server/src/services/lifecycleStepService.test.ts` (NEU) —
      Erfolgspfad und Fast-Path: ein Schritt `true` erzeugt genau eine `succeeded`-Execution mit
      `label` und Log-Datei; zwei Schritte laufen **nacheinander** (Zeiträume überlappen nicht);
      bei leerer `lifecycle_steps`-Tabelle wird **weder** `spawn` **noch** `executions.start`
      gerufen (SC-008)
- [X] T016 [US1] `packages/server/src/services/orchestrator.ts`: `prepareWorktree(feature)` als
      neue private Methode einführen (Worktree anlegen, Pfad persistieren,
      `after_worktree_create`-Schritte ausführen) und `createFeature()` (Zeile 163 ff.) auf die
      Reihenfolge aus research.md E5 umstellen — `features.create({ worktreePath: null })` →
      `prepareWorktree()` → Session + erste Phase; bei Fehler aus `git worktree add`
      `FeatureRepo.hardDelete(id)` und Rethrow. `ensureSessionInner()` (Zeile 215 ff.) nutzt
      dieselbe Methode, damit ein erneutes Anstoßen denselben Weg geht
- [X] T017 [P] [US1] `packages/server/src/services/orchestrator.test.ts`: der
      `after_worktree_create`-Schritt läuft **im neuen Worktree** und **vor** dem Start der ersten
      Phase; ohne konfigurierte Schritte entsteht keine zusätzliche Execution (FR-027); bei einem
      Git-Fehler bleibt kein Feature-Datensatz zurück (Rollback aus T016)
- [X] T018 [US1] `packages/server/src/index.ts`: `LifecycleStepRepo` und `LifecycleStepService`
      instanziieren und in `Orchestrator` sowie die API-Registrierung einhängen

### API und Verwaltungsoberfläche

- [X] T019 [US1] Drei Routen in `packages/server/src/api/server.ts` **direkt neben** den
      `/api/agents`-Routen nach [contracts/http-api.md](./contracts/http-api.md):
      `GET /api/lifecycle-steps` (optional `?projectId=`), `PUT /api/lifecycle-steps` (Upsert),
      `DELETE /api/lifecycle-steps/:id` (idempotent) — inklusive der acht Validierungsregeln
      (Name/Kommando nicht leer, Auslöser-Art bekannt, Phase/Stufe je Art Pflicht bzw. verboten,
      Zeitlimit 1 ms … 24 h) mit den dort wörtlich festgelegten Meldungen
- [X] T020 [P] [US1] `packages/server/src/api/server.test.ts`: je ein Fall pro Validierungsregel
      (400), `404 Projekt nicht gefunden`, Upsert-Rundlauf und idempotentes Löschen
- [X] T021 [P] [US1] `packages/web/src/api.ts` um `lifecycleSteps(projectId?)`,
      `saveLifecycleStep(step)` und `deleteLifecycleStep(id)` erweitern
- [X] T022 [P] [US1] `packages/web/src/components/icons.tsx`: `StepsIcon` als SVG ergänzen (keine
      Emojis — Konvention `specs/emojis-im-projekt-immer-als-svg-icon-hinterlegen`)
- [X] T023 [P] [US1] `packages/web/src/store.tsx`: `View` um `{ kind: 'lifecycle_steps'; projectId:
      string | null }` erweitern
- [X] T024 [US1] `packages/web/src/App.tsx`: die neue View rendern (hängt von T023 und T026 ab)
- [X] T025 [P] [US1] `packages/web/src/components/Sidebar.tsx`: Icon-Button
      „Lebenszyklus-Schritte" in der Projektzeile (Hover), Vorbild der `⚖`-Button für Agenten
- [X] T026 [US1] `packages/web/src/components/LifecycleStepsPanel.tsx` (NEU) als Zwilling von
      `AgentsPanel.tsx`: Abschnitte „Global (alle Projekte)" und „Projekt: <Name>", verbindlicher
      Kopftext, Zeilendarstellung (Name · Auslöser-Chip aus `LIFECYCLE_TRIGGER_META` ·
      Blockierend/Hinweis · Zeitlimit-Chip nur bei Abweichung · Kommando-Vorschau · ↑ ↓ ·
      Aktiv/Inaktiv · Bearbeiten · Löschen mit Bestätigungstext) nach
      [contracts/ui-contract.md](./contracts/ui-contract.md) §2
- [X] T027 [US1] `packages/web/src/components/LifecycleStepEditDialog.tsx` (NEU) nach
      [contracts/ui-contract.md](./contracts/ui-contract.md) §3: Felder Name, Kommando (mehrzeilig,
      `font-mono`), Auslöser, Phase/Stufe je nach Art, Zeitlimit in Minuten, Blockierend, Aktiv,
      Geltungsbereich — inklusive des verbindlichen Hilfetexts zum Umgebungsvertrag; Speichern
      deaktiviert bei leerem Namen oder Kommando

### Sichtbarkeit der Läufe

- [X] T028 [P] [US1] `packages/shared/src/runSummary.ts`: `categorizeExecution` bildet
      `'lifecycle_step'` auf `'overhead'` ab, `STEP_ORDER` wird erweitert, und der `sourceMix`-Nenner
      schließt Schritt-Läufe aus (research.md E11 — sie haben nichts zu messen)
- [X] T029 [P] [US1] `packages/shared/src/runSummary.test.ts`: Kategorie, Position in `STEP_ORDER`
      und „Schritt-Läufe drücken den Messanteil nicht"
- [X] T030 [US1] `packages/web/src/components/ExecutionsView.tsx`: `KIND_LABELS` +=
      `lifecycle_step: 'Schritt'`, `STEP_LABELS` += `lifecycle_step: 'Schritte'`; Detailzeile zeigt
      `Schritt · <label> · <Dauer> · <Ergebnis> · exit <code>` mit Log-Öffner und **ohne**
      Token-/Betragsspalte (FR-020)
- [X] T031 [US1] [quickstart.md](./quickstart.md) §1 manuell gegen die eigene Test-Instanz
      durchlaufen (Prüfungen 1.1–1.5, Szenario 3 und Szenario 4)

**Checkpoint**: US1 ist vollständig — ein Projekt-Schritt läuft automatisch und ist in der
Läufe-Ansicht sichtbar. Auslieferbar als MVP.

---

## Phase 4: User Story 2 - Fehlerverhalten: blockierend hält an, beratend läuft weiter (Priority: P1)

**Goal**: Ein blockierender Fehlschlag hält die Stufe an und meldet sich mit Kommando, Exit-Code und
den letzten Ausgabezeilen in der „Braucht dich"-Inbox; ein beratender Fehlschlag hält nichts an,
bleibt aber am Lauf sichtbar. Zeitlimit-Überschreitung verhält sich wie jeder andere Fehlschlag.

**Independent Test**: Drei Schritte am Auslöser „Nach Worktree-Anlage" anlegen — `exit 4` beratend
(Position 0), `echo "zeile a"; echo "zeile b"; exit 3` blockierend (Position 10),
`touch .sdd-should-not-exist` blockierend (Position 20) — ein Feature erzeugen und prüfen: beide
Fehlschläge sind als Läufe verbucht, der dritte Schritt lief **nicht**, es existiert **genau ein**
Inbox-Item (vom blockierenden Schritt) mit Kommando/Exit-Code/Tail, und das Feature hat keine
laufende Phase.

- [X] T032 [US2] Zeitlimit in `packages/server/src/services/lifecycleStepService.ts`:
      `step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS`, bei Ablauf SIGKILL **ausschließlich auf dem
      eigenen Child-Handle** (nie `pkill`/`killall` — CLAUDE.md), danach unmittelbar
      `executions.finish(execId, 137)`; der Timer wird im Abschlusspfad in jedem Fall gelöscht
- [X] T033 [US2] Tail-Ringpuffer (letzte 20 Zeilen / 2000 Zeichen über `tailLines` aus T004) in
      `packages/server/src/services/lifecycleStepService.ts` — die Ausgabe wird weiterhin gestreamt
      geschrieben und **nie** vollständig im Speicher gehalten
- [X] T034 [US2] Kettenlogik in `packages/server/src/services/lifecycleStepService.ts`: bei
      `exit ≠ 0` und `blocking` die Kette abbrechen und `{ ok: false, failed: step }` liefern; bei
      `exit ≠ 0` und beratend mit dem nächsten Schritt fortfahren; bei vollständigem Durchlauf ohne
      blockierenden Fehlschlag `{ ok: true }`
- [X] T035 [US2] Inbox-Item in `packages/server/src/services/lifecycleStepService.ts`: bei
      blockierendem Fehlschlag `attention.raise({ kind: 'lifecycle_step_failed', … })` synchron im
      Abschlusspfad (SC-003) mit dem Meldungsmuster aus [data-model.md](./data-model.md) §6
      (Schrittname, Kommando, Exit-Code, Tail; bei Zeitlimit der abweichende Kopf); bei
      vollständigem Durchlauf `attention.resolveFor({ featureId, kinds: ['lifecycle_step_failed'] })`
      (FR-025). Ein **beratender** Fehlschlag erzeugt **kein** Item (FR-024)
- [X] T036 [US2] Infrastruktur-Guard in `packages/server/src/services/lifecycleStepService.ts` nach
      dem Muster `AgentGateService.guardWorktree`: fehlt der Worktree unerwartet, wird geworfen und
      `agent_errored` gemeldet — **kein** Schritt-Lauf, **kein** FAIL (FR-026)
- [X] T037 [US2] `packages/server/src/services/attentionReconciler.ts`: expliziter Zweig für
      `lifecycle_step_failed` — **kein** Eintrag in `STAGE_FOR_KIND`, in `isAttentionValid` immer
      gültig (weder eine laufende Session noch ein Stufenwechsel darf die Meldung entfernen), in
      `findStaleOnBoot` nicht stale (überlebt den Neustart)
- [X] T038 [P] [US2] `packages/server/src/services/attentionReconciler.test.ts`: Meldung überlebt
      eine laufende Session, einen Stufenwechsel und einen Neustart; manuelles Auflösen bleibt
      möglich
- [X] T039 [US2] `packages/server/src/services/orchestrator.ts`: `{ ok: false }` aus
      `prepareWorktree()` hält an — keine Session, keine erste Phase; das Feature bleibt ohne
      laufende Phase stehen (Wirkungstabelle [data-model.md](./data-model.md) §9)
- [X] T040 [P] [US2] `packages/server/src/services/lifecycleStepService.test.ts` erweitern
      (SC-009): beratender Fehlschlag → nächster Schritt läuft, kein Item; blockierender Fehlschlag
      → Kette bricht ab, genau ein Item mit Kommando/Exit-Code/Tail; `sleep`-Kommando mit kurzem
      Zeitlimit → `failed` mit `exit 137`; nicht existierendes Kommando → `exit 127` statt stillem
      Erfolg; erfolgreicher Wiederanlauf löst das Item auf; fehlender Worktree erzeugt keinen
      FAIL-Lauf
- [X] T041 [P] [US2] `packages/server/src/services/orchestrator.test.ts` erweitern: blockierender
      Fehlschlag am Worktree-Auslöser verhindert Session und erste Phase; beratender Fehlschlag
      verhindert nichts
- [X] T042 [P] [US2] `packages/web/src/components/AttentionInbox.tsx`: Art
      `lifecycle_step_failed` beschriften, Ton **escalation** (rot), Klick springt zum Feature —
      falls die Komponente Arten generisch rendert, genügt der Titel-/Ton-Eintrag
- [X] T043 [US2] [quickstart.md](./quickstart.md) §2 manuell durchlaufen (Prüfungen 2.1–2.6,
      Szenario 5 Wiederanlauf, Szenario 4 Zeitlimit)

**Checkpoint**: US1 **und** US2 funktionieren unabhängig voneinander — beide Fehlerverhalten sind
durch Tests belegt.

---

## Phase 5: User Story 3 - Kontext, damit Kommandos nicht an absoluten Pfaden hängen (Priority: P2)

**Goal**: Jedes Kommando kennt Worktree, Projekt, Feature, Branch, Phase und Stufe über genau sechs
Umgebungsvariablen aus **einer** Stelle; nicht zutreffende Angaben sind leer. Der Auslöser „vor
Worktree-Anlage" läuft im Haupt-Checkout und kennt trotzdem den künftigen Worktree-Pfad.

**Independent Test**: Einen Schritt anlegen, dessen Kommando alle sechs Variablen und `$PWD` in eine
Datei schreibt, ihn an „Nach Worktree-Anlage" und an „Vor Worktree-Anlage" hängen und prüfen, dass
alle Angaben für das jeweilige Feature korrekt gesetzt bzw. korrekt leer sind und das
Arbeitsverzeichnis stimmt.

- [X] T044 [US3] Arbeitsverzeichnis in `packages/server/src/services/lifecycleStepService.ts` über
      `lifecycleCwdKind(trigger)` aus T004 bestimmen statt fest auf den Worktree zu zeigen:
      `'main'` → Haupt-Checkout des Projekts, `'worktree'` → Worktree des Features
- [X] T045 [US3] `before_worktree_create` in `Orchestrator.prepareWorktree()`
      (`packages/server/src/services/orchestrator.ts`): den Auslöser **vor** `worktrees.create()`
      feuern, mit dem **künftigen** Worktree-Pfad im Kontext und Ausführung im Haupt-Checkout
      (FR-010, US3 Szenario 5); ein blockierender Fehlschlag verhindert `git worktree add`
- [X] T046 [P] [US3] `packages/shared/src/lifecycleSteps.test.ts` erweitern: `buildLifecycleEnv`
      liefert **genau** die sechs Schlüssel `SDD_WORKTREE`, `SDD_PROJECT`, `SDD_FEATURE`,
      `SDD_BRANCH`, `SDD_PHASE`, `SDD_STAGE` (Schlüsselmenge festgenagelt — der Beweis für die
      **eine** Stelle aus FR-013/US3 Szenario 4); `SDD_PORT_BASE`/`SDD_PROFILE` sind **nicht**
      enthalten; nicht zutreffende Angaben sind `''` und nie ein Wert aus einem anderen Vorgang
      (FR-012)
- [X] T047 [P] [US3] `packages/server/src/services/lifecycleStepService.test.ts` erweitern: ein
      Kommando, das die Variablen ausgibt, bekommt sie tatsächlich gesetzt; `$PWD` entspricht dem
      erwarteten Arbeitsverzeichnis je Auslöser (Worktree bzw. Haupt-Checkout)
- [X] T048 [US3] [quickstart.md](./quickstart.md) §3 manuell durchlaufen (3.1–3.5) sowie SC-005:
      drei gleichzeitig angelegte Features desselben Projekts schreiben je eigene, konsistente
      Kontextwerte und keiner schreibt in den Worktree eines anderen

**Checkpoint**: Dieselbe Konfiguration trägt für alle Features eines Projekts — ohne absolute Pfade.

---

## Phase 6: User Story 4 - Drei Ebenen: global, Projekt, Feature (Priority: P2)

**Goal**: Schritte gelten global, pro Projekt und pro Feature abweichend (ausnehmen / hinzunehmen),
in einer nachvollziehbaren, stabilen Reihenfolge — Bedienung wie bei den Agents.

**Independent Test**: Denselben Auslöser mit einem globalen und einem Projekt-Schritt belegen, für
ein Feature den globalen auf „Aus" und einen deaktivierten auf „Ein" stellen, dann prüfen, welche
Schritte für dieses und für ein zweites Feature desselben Projekts laufen — und dass die Reihenfolge
global vor Projekt über mehrere Feature-Anlagen stabil bleibt.

- [X] T049 [US4] `packages/server/src/db/lifecycleStepRepo.ts` um die Feature-Auswahl erweitern
      (Muster `agent_feature_selection`): `selectionFor(featureId)` als `Map<stepId, decision>`,
      `setDecision(featureId, stepId, decision)` und Löschen der Zeile bei `'auto'`
- [X] T050 [US4] `packages/server/src/services/lifecycleStepService.ts`: `hasStepsFor()` und
      `runTrigger()` reichen die Feature-Auswahl an `resolveLifecycleSteps()` durch, damit
      `exclude`/`include` wirken (FR-003/FR-005)
- [X] T051 [US4] Zwei Routen in `packages/server/src/api/server.ts` nach
      [contracts/http-api.md](./contracts/http-api.md): `GET /api/features/:id/lifecycle-steps`
      liefert `FeatureLifecycleStepView[]` inklusive `decision`, `effective` und `lastRun`
      (jüngste Execution mit `kind='lifecycle_step'`, passendem `feature_id` und
      `label = step.name`); `PUT /api/features/:id/lifecycle-steps/selection` setzt
      `include|exclude|auto`
- [X] T052 [P] [US4] `packages/server/src/db/lifecycleStepRepo.test.ts` erweitern: Auswahl setzen,
      überschreiben und über `'auto'` wieder entfernen; `ON DELETE CASCADE` räumt Auswahlzeilen beim
      Löschen von Schritt und Feature ab
- [X] T053 [P] [US4] `packages/shared/src/lifecycleSteps.test.ts` erweitern (SC-007): die
      vollständige Matrix `{global, projekt} × {enabled, disabled} × {auto, include, exclude}` gegen
      `resolveLifecycleSteps()` — `exclude` schlägt alles, `include` erzwingt auch bei
      deaktiviertem Schritt, sonst entscheidet `enabled`; zusätzlich die stabile Reihenfolge global
      vor Projekt bei gleichem `sortOrder`
- [X] T054 [P] [US4] `packages/server/src/api/server.test.ts` erweitern: `effective`-Berechnung,
      `404 Feature nicht gefunden` / `Schritt nicht gefunden`,
      `400 decision muss include|exclude|auto sein`
- [X] T055 [P] [US4] `packages/web/src/api.ts` um `featureLifecycleSteps(featureId)` und
      `setLifecycleStepSelection(featureId, stepId, decision)` erweitern
- [X] T056 [US4] `packages/web/src/components/FeatureLifecycleStepSelect.tsx` (NEU) nach
      [contracts/ui-contract.md](./contracts/ui-contract.md) §4: Punkt (grün/grau), Name,
      Auslöser-Chip, `Hinweis`-Chip bei beratend, Umschalter `Auto | Ein | Aus`, jüngster Lauf je
      Zeile, Leerzustand — **kein** „Jetzt ausführen"-Button (Out of Scope)
- [X] T057 [US4] `packages/web/src/components/FeatureConsole.tsx`: Button „Schritte" neben dem
      bestehenden Button „Agents", der den Dialog aus T056 öffnet
- [X] T058 [P] [US4] `packages/server/src/services/lifecycleStepService.test.ts` erweitern
      (FR-028): ein Lauf behält seinen `label`, nachdem der Schritt umbenannt oder gelöscht wurde
- [X] T059 [US4] [quickstart.md](./quickstart.md) §4 manuell durchlaufen (4.1–4.5)

**Checkpoint**: Alle P1- und P2-Stories sind fertig — das Feature ist ohne die Phasen- und
Stufen-Auslöser bereits vollständig nutzbar.

---

## Phase 7: User Story 5 - Weitere Auslöser: Phasen und Integrationsstufen (Priority: P3)

**Goal**: Schritte hängen auch vor und nach jeder Phase sowie vor und nach jeder der fünf Stufen der
Integrations-Pipeline; die Auslöserpunkte sind in der Workflow-Übersicht sichtbar und können nicht
still veralten.

**Independent Test**: Je einen Schritt an einem Phasen- und einem Stufen-Auslöser hinterlegen und
prüfen, dass er zum richtigen Zeitpunkt läuft (vor dem Agent-Gate bzw. vor der Stufenarbeit), dass
ein blockierender Fehlschlag Phase bzw. Stufe anhält, und dass beide in der Workflow-Übersicht an
der passenden Stelle als Chip erscheinen.

- [X] T060 [US5] `before_phase` in `packages/server/src/services/orchestrator.ts` einhängen: in
      `runBeforePhaseGate()` (Zeile 341 ff., in plan.md `runBeforePhaseChecks`) laufen die Schritte
      **vor** dem Agent-Gate (research.md E8); ein blockierender Fehlschlag verhindert den
      Phasenstart, die Phase bleibt `idle`
- [X] T061 [US5] `after_phase` in `packages/server/src/services/orchestrator.ts` einhängen: in
      `handleTurnCompleted()` (Zeile 688 ff.) laufen die Schritte **vor** `runAfterPhaseGate()`
      (Zeile 764 ff.) und vor jedem Auto-Progress (FR-009); ein blockierender Fehlschlag verhindert
      Gate und Weiterlauf
- [X] T062 [P] [US5] `packages/server/src/services/orchestrator.test.ts` erweitern: Schritt läuft
      vor dem Agent-Gate; blockierender Fehlschlag an `before_phase` hält die Phase auf `idle`;
      blockierender Fehlschlag an `after_phase` verhindert den Auto-Progress
- [X] T063 [US5] `runStageSteps()` (privat) in
      `packages/server/src/services/mergeQueueService.ts` einführen und an allen zehn Punkten der
      Tabelle aus research.md E9 aufrufen: `verify` (in `beginIntegration()` Zeile 217 ff.),
      `review_gate`, `human_review` (auch in `approveForMerge()`, Zeile 318 ff.), `merge_queue`
      (in `processItem()`, Zeile 426 ff.) und `merged` (vor/nach `cleanupMerged()`, Zeile 128 ff.)
- [X] T064 [US5] Halt-Semantik in `packages/server/src/services/mergeQueueService.ts`: ein
      blockierender Fehlschlag stoppt die Stufe **und** den Queue-Worker (früher Ausstieg in
      `beginIntegration`, `return false` in `processItem`) — dieselbe Wirkung wie jede bestehende
      Eskalation; bei `after_stage:merged` unterbleibt `setStage(feature, 'merged')` (Zeile 556),
      der Abschluss wird also nicht vermerkt (Edge Case)
- [X] T065 [P] [US5] `packages/server/src/services/mergeQueueService.test.ts` erweitern: je Stufe
      läuft `before_stage` vor der Arbeit und `after_stage` nach dem Erfolg; blockierender
      Fehlschlag hält die jeweilige Stufe an; `after_stage:merged` mit `exit 1` lässt den Merge
      bestehen, verhindert aber den Abschluss-Vermerk und erzeugt ein Inbox-Item
- [X] T066 [US5] `packages/web/src/components/WorkflowOverview.tsx`: neue Komponente `StepZone`
      neben `AgentZone` (gleiche Optik, `+`-Button, Leerzustand „— keiner") an allen sechs Punkten
      platzieren — `PromptCard` (vor/nach Worktree-Anlage), `PhaseCard` (vor/nach Phase, jeweils
      **über** der `AgentZone`) und `IntegrationStepPill` (vor/nach Stufe); die Zonen werden
      ausschließlich aus `LIFECYCLE_TRIGGER_META` und `INTEGRATION_STAGE_IDS` erzeugt, nie aus
      lokalen Literalen
- [X] T067 [US5] Schritt-Chip in `packages/web/src/components/WorkflowOverview.tsx`: Name ·
      `Blockierend`/`Hinweis` · `global`-Marke · `erzwungen`/`aus` bei Feature-Ausnahme; nicht
      wirksame Schritte ausgegraut; Klick öffnet `LifecycleStepEditDialog`
- [X] T068 [US5] [quickstart.md](./quickstart.md) §5 manuell durchlaufen (5.1–5.7)

**Checkpoint**: Alle fünf User Stories sind unabhängig funktionsfähig.

---

## Phase 8: Polish & übergreifende Belange

**Purpose**: Absicherungen und Nachweise, die mehrere Stories betreffen

- [X] T069 Doppelstart-Guard in `packages/server/src/services/lifecycleStepService.ts`: Set
      `runningTriggers` mit Schlüssel `${featureId}:${triggerKey}` nach dem Muster
      `Orchestrator.runningGates` (Zeile 129) — derselbe Auslöser desselben Features läuft nie
      zweimal gleichzeitig, verschiedene Features bleiben unabhängig (SC-005)
- [X] T070 [P] `packages/server/src/services/lifecycleStepService.test.ts` erweitern: zwei
      gleichzeitige `runTrigger()`-Aufrufe für dasselbe Feature erzeugen nur einen Durchlauf; für
      zwei verschiedene Features laufen beide
- [X] T071 [P] [quickstart.md](./quickstart.md) §6 Edge Cases manuell durchlaufen: fehlendes
      Kommando (`exit 127`), sehr viel Ausgabe (`seq 1 200000`), Toolkit-Ende während eines Laufs
      (`orphaned`), unerwartet fehlender Worktree, Umbenennung während des Laufs, wirkungsloses
      Kommando
- [X] T072 Migration gegen eine **bestehende** Datenbank prüfen (nicht nur gegen eine frische):
      läuft durch, erzeugt ohne konfigurierte Schritte keine zusätzlichen Läufe und ändert kein
      Verhalten (FR-027/SC-008)
- [X] T073 `pnpm -r typecheck && pnpm -r test` im Repo-Root grün — inklusive aller neuen
      Testdateien
- [X] T074 Test-Instanz ausschließlich über die eigenen Ports abräumen
      (`lsof -ti:4899 | xargs -r kill`, `lsof -ti:4898 | xargs -r kill`) und die
      Abschluss-Checkliste in [quickstart.md](./quickstart.md) §7 abhaken

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten
- **Foundational (Phase 2)**: hängt von Setup ab — **blockiert alle User Stories**
- **US1 (Phase 3)**: hängt nur von Foundational ab
- **US2 (Phase 4)**: hängt von Foundational ab; setzt für den vollständigen Nachweis auf dem
  Runner aus US1 (T014) auf
- **US3 (Phase 5)**: hängt von Foundational ab; verallgemeinert das Arbeitsverzeichnis des Runners
  aus US1 (T014)
- **US4 (Phase 6)**: hängt von Foundational ab; nutzt Repo und Routen aus US1 (T012, T019)
- **US5 (Phase 7)**: hängt von Foundational ab; nutzt Service und UI aus US1 (T014, T027) und die
  Halt-Semantik aus US2 (T034)
- **Polish (Phase 8)**: hängt von den gewünschten Stories ab

### User Story Dependencies

- **US1 (P1)**: nach Foundational sofort startbar, keine Story-Abhängigkeit — allein auslieferbar
- **US2 (P1)**: erweitert den Runner aus US1 um Fehlerverhalten; unabhängig prüfbar über die eigenen
  Fehlschlag-Szenarien
- **US3 (P2)**: erweitert Kontext und Arbeitsverzeichnis; unabhängig prüfbar über ein
  kontextausgebendes Kommando
- **US4 (P2)**: ergänzt die Feature-Ebene; unabhängig prüfbar über die Ebenen-Matrix
- **US5 (P3)**: ergänzt vier weitere Auslöserarten; unabhängig prüfbar an einem Phasen- und einem
  Stufen-Auslöser

### Innerhalb der Stories

- Repo vor Service, Service vor Einhängepunkt, Server vor Web
- `packages/shared` vor `packages/server` vor `packages/web`
- Tests laufen jeweils gegen die Datei, die die Aufgabe davor erzeugt hat
- Der manuelle Quickstart-Durchlauf steht am Ende jeder Story

### Parallel Opportunities

- **Phase 2**: T007, T008 und T011 sind unabhängig (drei verschiedene Testdateien); T009/T010
  laufen parallel zu T004–T008 (anderes Paket)
- **Phase 3**: T013, T015, T017, T020 (vier Testdateien) sowie T021, T022, T023, T025, T028, T029
  (Web bzw. `shared`) sind untereinander parallelisierbar
- **Phase 4**: T038, T040, T041, T042 betreffen vier verschiedene Dateien
- **Phase 6**: T052, T053, T054, T055, T058 betreffen fünf verschiedene Dateien
- Nach Abschluss von Phase 2 können US1–US5 grundsätzlich von verschiedenen Personen parallel
  bearbeitet werden; die Berührungspunkte sind `lifecycleStepService.ts` (US1/US2/US3) und
  `api/server.ts` (US1/US4)

---

## Parallel Example: User Story 1

```bash
# Nach T012/T014/T016/T019 die vier Testdateien gemeinsam anlegen:
Task: "packages/server/src/db/lifecycleStepRepo.test.ts — Union, Sortierung, Normalisierung"
Task: "packages/server/src/services/lifecycleStepService.test.ts — Erfolgspfad und Fast-Path"
Task: "packages/server/src/services/orchestrator.test.ts — Worktree-Auslöser und Rollback"
Task: "packages/server/src/api/server.test.ts — Routen und Validierung"

# Web-Anteile gemeinsam:
Task: "packages/web/src/api.ts — drei neue Aufrufe"
Task: "packages/web/src/components/icons.tsx — StepsIcon"
Task: "packages/web/src/store.tsx — View lifecycle_steps"
Task: "packages/web/src/components/Sidebar.tsx — Projekt-Einstieg"
```

---

## Implementation Strategy

### MVP zuerst (nur User Story 1)

1. Phase 1: Setup
2. Phase 2: Foundational (**kritisch** — blockiert alle Stories)
3. Phase 3: User Story 1
4. **STOPP und PRÜFEN**: [quickstart.md](./quickstart.md) §1 vollständig
5. Auslieferbar: ein Projekt-Schritt läuft automatisch nach der Worktree-Anlage und ist sichtbar

### Inkrementelle Auslieferung

1. Setup + Foundational → Grundlage steht
2. + US1 → unabhängig prüfen → ausliefern (**MVP**, Abnahmebedingung des Features)
3. + US2 → unabhängig prüfen → ausliefern (verlässliches Fehlerverhalten, P1 vollständig)
4. + US3 → unabhängig prüfen → ausliefern (Konfiguration ohne absolute Pfade)
5. + US4 → unabhängig prüfen → ausliefern (drei Ebenen, P1+P2 vollständig)
6. + US5 → unabhängig prüfen → ausliefern (Phasen- und Stufen-Auslöser)
7. Phase 8 → Absicherungen und Gesamtnachweis

Nach Schritt 5 ist das Feature ohne die P3-Auslöser bereits vollständig nutzbar (plan.md:
„Schritte 1–8 liefern die vollständigen P1/P2-Stories und sind allein auslieferbar").

### Parallele Teamstrategie

Mit mehreren Personen:

1. Setup + Foundational gemeinsam
2. Danach:
   - Person A: US1 (Kern: Repo, Service, Orchestrator, API)
   - Person B: US1-Web-Anteile (Panel, Dialog, Läufe-Ansicht) und anschließend US4-Web
   - Person C: US5-Einhängepunkte, sobald T014 steht
3. `lifecycleStepService.ts` und `api/server.ts` gehören jeweils **einer** Person zur Zeit —
   sie sind die einzigen echten Berührungspunkte

---

## Nachtrag zur Umsetzung (30.07.2026)

### Gefundener Fehler, der nur im Live-Lauf sichtbar wurde

Bei der Abnahme in der eigenen Test-Instanz liefen **alle Worktree-Schritte doppelt**: vier Läufe
für zwei Schritte, `pnpm install` zweimal je Feature. Ursache: `createFeature()` ruft
`prepareWorktree()` und unmittelbar danach `ensureSession()` — und `ensureSessionInner()` ruft
`prepareWorktree()` erneut (T016 hatte beide Wege bewusst auf dieselbe Methode gelegt).

Die Tests aus T017/T041 sahen es nicht: ihr `ptys.forFeature`-Stub liefert **sofort** eine
Session, `ensureSessionInner()` steigt deshalb vor der Vorbereitung aus. Bei einer echten
Neuanlage gibt es diese Session noch nicht.

**Behoben** über `EnsureSessionOptions.skipPrepare`, das ausschließlich `createFeature()` setzt —
jeder andere Weg zur Session wiederholt die Worktree-Auslöser weiterhin (Wiederanlauf, FR-025).
Zwei Regressionstests in `orchestrator.test.ts` nageln beide Seiten fest; der Stub kennt jetzt
über `existingSession: false` auch den Weg ohne bestehende Session.

### Bewusste Abweichungen

- **T023**: `View` erhielt `{ kind: 'lifecycle_steps'; projectId: string }` statt
  `projectId: string | null`. Der Einstieg ist die Projektzeile der Sidebar, das Panel braucht
  den Projektnamen für den Abschnitt „Projekt: …", und der `agents`-Zwilling ist genauso getypt.
  Ein `null` hätte keinen Aufrufer.
- **T042**: `AttentionInbox` rendert alle Arten generisch aus `KIND_META`; ergänzt wurde deshalb
  nur der Eintrag (Titel „Schritt fehlgeschlagen", Ton rot) — wie in der Aufgabe vorgesehen. Das
  Icon folgt der Konvention der Datei (alle Arten dort nutzen dasselbe Format).
- **T002/T074**: Die Test-Instanz lief auf **4873/4872** statt 4899/4898 — diese Ports waren von
  einem parallel laufenden Feature-Worktree (`plausibilitaetspruefung`) belegt. Abgeräumt wurde
  ausschließlich über die eigenen Ports; die fremde Instanz lief unberührt weiter.

### Abnahme in der eigenen Test-Instanz

Live geprüft (§1–§4 sowie §5.6, §6 und die Abschluss-Checkliste): Marker im neuen Worktree,
Log-Kopfzeile, Reihenfolge global vor Projekt, Kette bricht am blockierenden Fehlschlag ab,
genau ein Inbox-Item mit Kommando/Exit-Code/Tail, beratender Fehlschlag ohne Item, Halt der
Phase, Wiederanlauf löst das Item auf, `before_worktree_create` im Haupt-Checkout mit künftigem
Pfad, Fast-Path ohne Schritte (0 Läufe), Ebenen-Übersteuerung wirkt nur auf ihr Feature,
Verwaltungs-Panel, Bearbeiten-Dialog (inkl. Stufen-Feld und Speichern-Sperre), Schritt-Zonen an
allen 22 Punkten der Workflow-Übersicht, Läufe-Ansicht ohne Token-/Betragsspalte, Inbox-Eintrag.

Die Zeitlimit-Überschreitung (§2 Szenario 4), „sehr viel Ausgabe", `exit 127`, `orphaned` nach
Neustart und die Stufen-Auslöser sind durch automatisierte Tests belegt statt von Hand
durchgespielt.

## Notes

- [P] = andere Datei, keine Abhängigkeit auf eine unfertige Aufgabe
- Deutsche UI, dunkles Layout, **Symbole ausschließlich als SVG-Icons** aus
  `packages/web/src/components/icons.tsx` — keine Emojis
- **Keine neuen Runtime-Dependencies** (plan.md Constitution Check) — kein Task-Runner, kein
  Scheduler, keine Prozess-Bibliothek
- **Prozesse nie über generische Muster beenden**: kein `pkill -f vite|tsx|node`, kein `killall` —
  die laufende Toolkit-Instanz ist der Elternprozess dieser Session (CLAUDE.md). Der Runner
  beendet ausschließlich sein eigenes Child-Handle
- Schritt-Läufe schreiben **nie** `tokens = 0` oder einen geschätzten Betrag (FR-020) — die Felder
  bleiben `NULL`
- Nach jeder Aufgabe oder logischen Gruppe committen; an jedem Checkpoint kann angehalten und die
  Story einzeln geprüft werden
- Zu vermeiden: vage Aufgaben, gleichzeitige Änderungen an derselben Datei, Story-übergreifende
  Abhängigkeiten, die die Unabhängigkeit brechen
