---
description: "Aufgabenliste zur Umsetzung von „Ehrlichkeit vor dem Merge""
---

# Tasks: Ehrlichkeit vor dem Merge

**Input**: Entwurfsdokumente aus `specs/ehrlichkeit-vor-dem-merge/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/domain.md](./contracts/domain.md),
[contracts/http.md](./contracts/http.md), [quickstart.md](./quickstart.md)

**Tests**: Tests sind Teil der Abnahme (research.md D14, quickstart.md §1) — die Textwahl (SC-001,
SC-003) und die Lebensdauer des Aufmerksamkeits-Eintrags (FR-004 … FR-007) werden ausschließlich
über Tests nachgewiesen. Für die Oberflächen gibt es im Repo keine Komponententests; dort ist die
Sichtprüfung aus `quickstart.md` die Abnahme.

**Organisation**: Aufgaben sind je User Story gruppiert, damit jede Story unabhängig umgesetzt und
geprüft werden kann.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel ausführbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: Zuordnung zur User Story (US1, US2, US3)
- Jede Beschreibung nennt den genauen Dateipfad

## Pfad-Konventionen

pnpm-Monorepo (plan.md § Project Structure):

- Geteilte Domäne: `packages/shared/src/`
- Backend: `packages/server/src/`
- Oberfläche: `packages/web/src/`
- Tests liegen **neben** der Quelle (`*.test.ts`), bestehendes Muster im Repo

**Keine Migration**: `features.integration` und `attention.kind` sind `TEXT` ohne `CHECK`
(research.md D10) — `packages/server/src/db/database.ts` bleibt unangetastet.

---

## Phase 1: Setup

**Purpose**: Ausgangslage festhalten, damit „unverändert" später belegbar ist (FR-011, SC-005, SC-008)

- [X] T001 Baseline sichern: `pnpm install` (falls nötig), dann `pnpm typecheck` und `pnpm test` im Repo-Root ausführen und das grüne Ergebnis notieren (quickstart.md §0); zusätzlich den heutigen Wortlaut der review_due-Meldung aus `packages/server/src/services/mergeQueueService.ts:296` (`${feature.name}: verifiziert — bereit für dein Review & Merge`) wörtlich sichern — er ist die Vergleichsgrundlage für INV-4

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Das pure Meldungs-Modul, aus dem US1 (Verifikations-Wortlaut, FR-003) und US2
(Aufgabenstand, FR-012/FR-012a) ihre Texte beziehen. Genau eine Quelle je Text.

**⚠️ KRITISCH**: Ohne diese Phase kann keine der beiden Meldungs-Anforderungen erfüllt werden.

- [X] T002 Test zuerst (muss rot sein): `packages/shared/src/integrationMessages.test.ts` neu anlegen — alle Zeilen der Ausgabetabelle für `taskProgressText` aus contracts/domain.md §2 (`68/76 erledigt, 8 offen`, `76/76 erledigt, keine offen`, `0/76 erledigt, 76 offen`, `keine Aufgabenliste vorhanden`, `80/76 erledigt, keine offen`) sowie `reviewDueMessage` in beiden Varianten, inklusive INV-2 (kein „verifiziert"/„Verifikation läuft" im unkonfigurierten Text) und INV-4 (der Teil vor `·` ist bei `verificationConfigured: true` zeichengleich mit dem in T001 gesicherten Wortlaut)
- [X] T003 `packages/shared/src/integrationMessages.ts` neu anlegen: pures Modul ohne IO mit `taskProgressText`, `reviewDueMessage`, `mergedNotificationBody` genau nach den Signaturen aus contracts/domain.md §2; offene Aufgaben über `Math.max(0, tasksTotal - tasksDone)` (research.md D4), `tasksTotal === 0` ⇒ `keine Aufgabenliste vorhanden` (FR-013)
- [X] T004 Das neue Modul in `packages/shared/src/index.ts` exportieren (`export * from './integrationMessages.js';`, neben `export * from './runSummary.js';` in Zeile 12), damit Server und Web dieselben Texte lesen

**Checkpoint**: `pnpm --filter @sdd/shared test` grün; die Texte stehen fest, aber noch nirgends in Gebrauch.

---

## Phase 3: User Story 1 - Eine Freigabe, die nicht behauptet, geprüft worden zu sein (Priority: P1) 🎯 MVP

**Goal**: „Für dieses Projekt ist keine Verifikation konfiguriert" wird ein eigener, persistierter
Zustand — als Integrationsstufe `verification_unconfigured` und als projektbezogener
Aufmerksamkeits-Eintrag. Keine Oberfläche und keine Meldung behauptet für ein solches Projekt eine
Verifikation; gesperrt wird nichts (FR-001 … FR-011).

**Independent Test**: Projekt ohne `verifyCommands` anlegen, ein Feature mit mindestens einer
erledigten Aufgabe integrieren: Board, Review-Übersicht, Review-Portal und die Review-Meldung nennen
die fehlende Verifikation, es entsteht genau **ein** Aufmerksamkeits-Eintrag (`featureId === null`),
ein zweites Feature erzeugt keinen weiteren, und nach Hinterlegen eines Verifikationskommandos ist
der Eintrag ohne manuelles Abhaken verschwunden (quickstart.md §2).

### Tests for User Story 1

> **Zuerst schreiben, rot sehen, dann umsetzen.**

- [ ] T005 [P] [US1] `packages/server/src/services/verificationGap.test.ts` neu anlegen — die vollständige Matrix aus quickstart.md §1 über `openMemoryDatabase()` (Muster: `packages/server/src/services/mergeQueueService.attention.test.ts`): erster Versuch ⇒ genau ein offener Eintrag mit `featureId === null`; zweiter/dritter Versuch ⇒ kein weiterer; Stufenwanderung bis `merged` ⇒ Eintrag bleibt; `verifyCommands` gefüllt + Reconcile ⇒ Eintrag weg ohne Abhaken; abgehakt + weiterhin leer ⇒ kein neuer Eintrag; gefüllt und wieder geleert ⇒ Eintrag entsteht erneut
- [ ] T006 [P] [US1] `packages/server/src/services/mergeQueueService.attention.test.ts` erweitern: ein Stufenwechsel eines Features lässt einen offenen `verification_unconfigured`-Eintrag desselben Projekts unberührt (FR-006, R3.2)
- [ ] T007 [P] [US1] `packages/server/src/services/attentionReconciler.test.ts` erweitern: `isAttentionValid` hält die neue Art unabhängig von `featureStages` für gültig, `findStaleRuntime` und `findStaleOnBoot` lassen sie stehen (nicht stage-gekoppelt, restart-sicher)
- [ ] T008 [P] [US1] `packages/shared/src/workflowModel.test.ts` erweitern: `INTEGRATION_STAGE_META.verification_unconfigured` hat ein nicht leeres Label mit Ton `human`, und das Label enthält weder „verifiziert" noch „Verifikation läuft" (INV-2, SC-001)

### Implementation for User Story 1 — geteilte Domäne

- [ ] T009 [US1] `packages/shared/src/types.ts`: `'verification_unconfigured'` in `IntegrationStage` unmittelbar nach `'verifying'` (Zeile 34) ergänzen, `'verification_unconfigured'` in `AttentionKind` (Zeile 222-232) ergänzen und `ReviewOverviewItem['verify']['status']` (Zeile 549) um `'unconfigured'` erweitern — bricht absichtlich den Typecheck in allen Katalogen (FR-001a)
- [ ] T010 [P] [US1] `packages/shared/src/workflowModel.ts:171` (`INTEGRATION_STAGE_META`): `verification_unconfigured: { label: 'keine Verifikation konfiguriert', tone: 'human' }` (research.md D1)
- [ ] T011 [P] [US1] `packages/shared/src/actionPolicy.ts:93` (`STAGE_CLASS`): `verification_unconfigured: 'active'` ergänzen; `RETRYABLE_STAGES` (Zeile 108) bleibt unverändert — die Stufe ist kein Fehlzustand (INV-3, research.md D11)
- [ ] T012 [P] [US1] `packages/shared/src/lifecycleCatalog.ts`: `INTEGRATION_STAGE_ORIGIN` (Zeile 550) um `verification_unconfigured: 'integration'` ergänzen und die `condition` des Schritts `run-verify-commands` (Zeile 384-396) so umschreiben, dass sie den Zweig ohne Konfiguration benennt (Feature läuft durch die Stufe „keine Verifikation konfiguriert", einmal je Projekt entsteht ein Aufmerksamkeits-Eintrag) — research.md D13

### Implementation for User Story 1 — Server

- [ ] T013 [US1] `packages/server/src/db/repos.ts` (`AttentionRepo`, ab Zeile 706): `hasEver({ kind, projectId }): boolean` (irgendeine Zeile, offen ODER aufgelöst) und `forget({ kind, projectId }): string[]` (löscht alle Zeilen dieser Art des Projekts, liefert die IDs der zuvor offenen) ergänzen — data-model.md §3.2
- [ ] T014 [US1] `packages/server/src/services/verificationGap.ts` neu anlegen: `raiseVerificationGap({ attention, project })` erzeugt den Eintrag nur, wenn `project.verifyCommands.length === 0` und `attention.hasEver(...) === false` ist, mit `featureId: null` und der Meldung `'<Projektname>: Projekt hat keine Verifikation konfiguriert — Features werden ungeprüft integriert.'`; `resolveVerificationGaps({ attention, projects })` ruft `forget` für jedes Projekt mit mindestens einem Verifikationskommando und liefert die aufgelösten IDs (FR-004 … FR-007, data-model.md §3.1)
- [ ] T015 [US1] `packages/server/src/services/mergeQueueService.ts:239`: `this.setStage(feature, 'verifying')` zur Verzweigung machen — bei `project.verifyCommands.length === 0` wird `'verification_unconfigured'` gesetzt, sonst unverändert `'verifying'` (FR-001a, FR-002, research.md D2)
- [ ] T016 [US1] `packages/server/src/services/mergeQueueService.ts:252`: im `else`-Zweig von `if (project.verifyCommands.length > 0)` — also nach `commitWorktree()` und nach `reconcile() === 'proceed'` — `raiseVerificationGap` aufrufen und für einen neu entstandenen Eintrag `attention_raised` über den Bus melden; nichts blockieren, nichts eskalieren (FR-010, research.md D2)
- [ ] T017 [US1] `packages/server/src/services/mergeQueueService.ts:296`: die review_due-Meldung über `reviewDueMessage(feature, { verificationConfigured: project.verifyCommands.length > 0 })` aus `@sdd/shared` bauen statt über den inline formulierten Text (FR-003 + FR-012 treffen hier zusammen)
- [ ] T018 [US1] `packages/server/src/services/attentionReconciler.ts`: in `isAttentionValid` einen eigenen `case 'verification_unconfigured': return true;` mit Begründungs-Kommentar ergänzen (Gültigkeit kommt aus der Projektkonfiguration, nicht aus Session- oder Stufenzustand) und `STAGE_FOR_KIND` (Zeile 22-27) ausdrücklich **nicht** erweitern — mit Kommentar, warum nicht (FR-006, R3.2/R3.5)
- [ ] T019 [US1] `packages/server/src/services/orchestrator.ts:1302` (`reconcileOpenAttention`): `resolveVerificationGaps({ attention: this.deps.attention, projects: this.deps.projects })` im bestehenden Durchlauf aufrufen und für jede aufgelöste ID `attention_resolved` senden — keine neue Route (FR-007, contracts/http.md §1)
- [ ] T020 [US1] `packages/server/src/api/reviewRoutes.ts:110-117`: `verify` in der Reihenfolge aus contracts/domain.md §4 belegen — abgeschlossene `verify`-Execution schlägt Konfiguration (`'passed'`/`'failed'`), sonst `project.verifyCommands.length === 0` ⇒ `'unconfigured'`, sonst `'none'` (FR-009, research.md D6)

### Implementation for User Story 1 — Oberfläche

- [ ] T021 [P] [US1] `packages/web/src/components/AttentionInbox.tsx:8` (`KIND_META`): `verification_unconfigured: { label: 'Verifikation fehlt', icon: '⚠', tone: 'text-amber-400' }` ergänzen (Typecheck-Pflicht, contracts/domain.md §1)
- [ ] T022 [P] [US1] `packages/web/src/components/ReviewOverview.tsx:10-16`: `STAGE_LABEL` auf `Partial<Record<IntegrationStage, string>>` typen und den Fallback `?? item.stage` auf `?? INTEGRATION_STAGE_META[item.stage].label` umstellen — kein Rohbezeichner mehr in der Zeile (research.md D9)
- [ ] T023 [US1] `packages/web/src/components/ReviewOverview.tsx:169-180`: die Ternär-Kette der Verifikations-Anzeige durch eine vollständige `Record<ReviewOverviewItem['verify']['status'], { text: string; className: string }>`-Tabelle ersetzen, mit unterscheidbaren Texten `Verify ✓` / `Verify ✗` / `Verify – (kein Lauf)` / `Verify nicht konfiguriert` (FR-009, R4.2)
- [ ] T024 [P] [US1] `packages/web/src/components/ExecutionsView.tsx:81` (`IntegrationBadge`): statt des Rohwerts `{s}` das Label aus `INTEGRATION_STAGE_META[s].label` zeigen (Sonderfall `none` → „offen" bleibt) — damit die neue Stufe auch im Rückblick benannt ist (FR-001a, research.md D9)
- [ ] T025 [P] [US1] `packages/web/src/components/review/TestsPane.tsx`: Prop `verificationConfigured: boolean` aufnehmen und den Leerfall (Zeile 39-45) unterscheiden — ohne Konfiguration „Für dieses Projekt ist keine Verifikation konfiguriert — es wurde nichts geprüft.", mit Konfiguration aber ohne Lauf der bisherige Hinweis (FR-008)
- [ ] T026 [US1] `packages/web/src/components/ReviewPortal.tsx`: `verificationConfigured` aus dem bereits geladenen `project` (Zeile 44) ableiten und an `TestsPane` (Zeile 298) weitergeben; die Kopf-Kennzahl `Verify` (Zeile 177-181) auf `nicht konfiguriert` setzen, wenn kein Lauf existiert und nichts konfiguriert ist; `HeaderStat` (Zeile 434) um den Ton `'warn'` (amber) neben `ok`/`bad` erweitern (FR-008, research.md D7)

**Checkpoint**: `pnpm typecheck` und `pnpm test` grün; Sichtprüfung A aus quickstart.md §2 vollständig
durchführbar. US1 liefert allein Wert — die falsche Zusicherung ist weg.

---

## Phase 4: User Story 2 - Der Aufgabenstand steht dort, wo entschieden wird (Priority: P2)

**Goal**: Jede Meldung an der Entscheidungsstelle nennt den Aufgabenstand — die review_due-Meldung
und, wenn ohne Review gemergt wird, die Meldung über den vollzogenen Merge bzw. den erstellten PR.
Im Review-Portal steht der Stand ohne Reiterwechsel, offene Aufgaben sind hervorgehoben. Gesperrt
wird nichts (FR-012 … FR-016).

**Independent Test**: Feature mit teilweise abgehakter `tasks.md` (68/76) ohne Auto-Merge
integrieren: die Meldung „Review fällig" nennt `68/76 erledigt, 8 offen`, dasselbe steht beim Öffnen
des Portals in der Kopfzeile, die Freigabe funktioniert unverändert. Mit Auto-Merge trägt die
Meldung „Feature gemergt" denselben Stand (quickstart.md §3).

> **Hinweis zur Reihenfolge**: Die review_due-Meldung erhält den Aufgabenstand durch dieselbe
> Call-Site-Änderung wie US1 (**T017**) — dort treffen FR-003 und FR-012 auf eine Zeile. Wird US2
> ohne US1 umgesetzt, ist T017 vorzuziehen.

### Tests for User Story 2

- [ ] T027 [US2] `packages/shared/src/integrationMessages.test.ts` erweitern: `mergedNotificationBody` liefert `<name> → <target> · <taskProgressText>` für 68/76, für 76/76 und für ein Feature ohne Aufgabenliste (`keine Aufgabenliste vorhanden` statt `0/0`) — FR-012a, FR-013

### Implementation for User Story 2

- [ ] T028 [US2] `packages/server/src/services/mergeQueueService.ts:564-569`: `body` der Meldung `kind: 'merged'` über `mergedNotificationBody(feature, target)` bauen (FR-012a, research.md D5)
- [ ] T029 [US2] `packages/server/src/services/mergeQueueService.ts:618-623` (PR-Modus): den Aufgabenstand aus `taskProgressText(feature)` an den `body` anfügen, ohne die PR-URL zu verlieren — der PR-Pfad hat ebenfalls kein menschliches Review-Halt (FR-012a, research.md D5, Edge Case „Integration über Pull Request")
- [ ] T030 [US2] `packages/web/src/components/ReviewPortal.tsx:163-181`: eine `HeaderStat`-Kennzahl `Aufgaben` mit `feature.tasksDone`/`feature.tasksTotal` ergänzen (bei `tasksTotal === 0` „keine Liste"), Ton `'warn'` sobald offene Aufgaben > 0 — sichtbar ohne Reiterwechsel und ohne Klick (FR-014, FR-015)
- [ ] T031 [US2] `packages/web/src/components/ReviewOverview.tsx`: je Zeile den Aufgabenstand aus `item.feature.tasksDone`/`tasksTotal` neben den übrigen Kennzahlen zeigen, offene Aufgaben amber; keine zusätzliche Anfrage — die Werte liegen in `item.feature` (FR-012, contracts/http.md §4)

**Checkpoint**: US1 und US2 funktionieren unabhängig; Sichtprüfung B aus quickstart.md §3 vollständig
durchführbar, die Freigabe ist nachweislich nicht gesperrt (FR-016, SC-005).

---

## Phase 5: User Story 3 - Läufe mit Bezugsgrösse vergleichen (Priority: P3)

**Goal**: Die Läufe-Ansicht führt je Lauf den Aufgabenstand und die Kosten pro erledigter Aufgabe —
in der Liste ohne Aufklappen und im aufgeklappten Dashboard derselbe Wert. Wo die Bezugsgrösse nicht
bestimmbar ist, steht ein Strich (FR-017 … FR-021).

**Independent Test**: Zwei Läufe unterschiedlicher Aufgabenzahl in der Läufe-Ansicht: beide Zeilen
zeigen Aufgabenstand und Kosten pro Aufgabe, ein Lauf ohne erledigte Aufgabe zeigt einen Strich, ein
Lauf mit Ausführungen ohne gemeldeten Betrag ist als unvollständig gekennzeichnet (quickstart.md §4).

### Tests for User Story 3

- [ ] T032 [US3] `packages/shared/src/runSummary.test.ts` erweitern: `buildRunSummaries` reicht `tasksDone`/`tasksTotal` unverändert vom Feature durch (FR-017); `costPerTask` liefert `micros === null` bei `tasksDone === 0` (INV-5) und bei `total.costMicros === 0` trotz erledigter Aufgaben (INV-6, nie `0`), `Math.round(costMicros / tasksDone)` sonst, `incomplete === true` sobald `total.runsWithoutCost > 0` (FR-021), und zeigt bei `tasksDone > tasksTotal` die Rohwerte

### Implementation for User Story 3

- [ ] T033 [US3] `packages/shared/src/runSummary.ts`: `RunSummary` (Zeile 44-62) um `tasksDone: number` und `tasksTotal: number` erweitern, in `buildOne()` (Rückgabeobjekt ab Zeile 146) aus `feature.tasksDone`/`feature.tasksTotal` kopieren, sowie `export interface CostPerTask` und `export function costPerTask(run: Pick<RunSummary, 'total' | 'tasksDone'>): CostPerTask` nach contracts/domain.md §3 ergänzen — kein gespeichertes Kostenfeld (SC-008, INV-8)
- [ ] T034 [US3] `packages/web/src/components/ExecutionsView.tsx` (`RunCard`, Kopfzeile ab Zeile 281): den Aufgabenstand als eigene, ohne Aufklappen sichtbare Angabe zeigen (`68/76`, bei `tasksTotal === 0` „keine Aufgabenliste") und darunter die Kosten pro Aufgabe aus `costPerTask(run)` — `micros === null` ⇒ „—", `incomplete` ⇒ als unvollständig gekennzeichnet, analog zur bestehenden Kennzeichnung „ohne Betrag" (FR-018, FR-019, FR-020, FR-021)
- [ ] T035 [US3] `packages/web/src/components/ExecutionsView.tsx` (aufgeklappter Bereich von `RunCard`): denselben Wert aus `costPerTask(run)` neben den übrigen Kennzahlen des Lauf-Dashboards ausgeben — dieselbe Funktion, damit Liste und Dashboard nicht auseinanderlaufen (FR-019, R5.2); `packages/web/src/components/FeatureDashboard.tsx:105` erbt die Anzeige über dieselbe Komponente und braucht keine eigene Änderung

**Checkpoint**: Alle drei Stories unabhängig funktionsfähig; Sichtprüfung C aus quickstart.md §4
durchführbar, `/api/runs` trägt die neuen Felder ohne Server-Änderung (contracts/http.md §5).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Die Zusicherungen der Spezifikation belegen, statt sie zu behaupten

- [ ] T036 `pnpm typecheck` im Repo-Root: muss grün sein — und war vor T010/T011/T012/T021 rot; ein Typecheck, der die neue Stufe ohne Katalog-Einträge durchlässt, bedeutet, dass ein Katalog nicht getroffen wurde (FR-001a, quickstart.md §0)
- [ ] T037 `pnpm test` im Repo-Root (bzw. `pnpm --filter @sdd/shared test` und `pnpm --filter @sdd/server test`): alle Tests grün, insbesondere die in T002/T005-T008/T027/T032 geschriebenen
- [ ] T038 [P] Nicht-Erhebungs-Nachweis aus quickstart.md §5 führen: `git diff main --stat` über `packages/server/src/telemetry`, `packages/shared/src/costMeter.ts`, `packages/shared/src/transcriptUsage.ts`, `packages/shared/src/telemetryAttribution.ts` und `packages/server/src/db/database.ts` muss leer sein, und `git diff main -- packages/server/src/api/server.ts` darf keine neue Route enthalten (FR-022, SC-008)
- [ ] T039 [P] SC-001 per Suche belegen: in `packages/web/src` und `packages/server/src` prüfen, dass kein Pfad für ein Projekt ohne `verifyCommands` die Texte „verifiziert" oder „Verifikation läuft" erzeugt, und dass die Integrationsstufe nirgends mehr als Rohbezeichner gerendert wird (`grep -rn "item.stage\|run.integration" packages/web/src`)
- [ ] T040 Sichtprüfungen A, B und C aus quickstart.md §2-§4 in einer eigenen Instanz durchführen: `SDD_PORT=4899 SDD_WEB_PORT=4898 SDD_DATA_DIR=/tmp/sdd-abnahme-ehrlichkeit pnpm dev`, danach ausschließlich über den eigenen Port abräumen (`lsof -ti:4899 | xargs kill`, `lsof -ti:4898 | xargs kill`) — die laufende Instanz auf 4820/4830 und generische `pkill`-Muster sind verboten (CLAUDE.md)

---

## Dependencies & Execution Order

### Phasen-Abhängigkeiten

- **Setup (Phase 1)**: keine Abhängigkeit
- **Foundational (Phase 2)**: nach Setup — blockiert die Meldungstexte von US1 und US2
- **US1 (Phase 3)**: nach Foundational — unabhängig von US2 und US3
- **US2 (Phase 4)**: nach Foundational — teilt mit US1 genau eine Zeile (T017, siehe Hinweis in Phase 4)
- **US3 (Phase 5)**: nach Setup — berührt weder das Meldungs-Modul noch die neue Stufe; einzige
  Überschneidung ist die Datei `ExecutionsView.tsx` (T024 aus US1 vs. T034/T035)
- **Polish (Phase 6)**: nach allen umgesetzten Stories

### Abhängigkeiten innerhalb von US1

- T009 (`types.ts`) blockiert T010, T011, T012, T020, T021, T023 — ohne den Enum-Wert compilieren sie nicht
- T013 (`AttentionRepo`) blockiert T014
- T014 (`verificationGap.ts`) blockiert T016 und T019
- T025 (`TestsPane`-Prop) blockiert T026 (`ReviewPortal` gibt die Prop weiter)
- T015, T016, T017 liegen in derselben Datei (`mergeQueueService.ts`) und laufen nacheinander
- T022 und T023 liegen in derselben Datei (`ReviewOverview.tsx`) und laufen nacheinander

### Abhängigkeiten innerhalb von US2

- T028 und T029 liegen in derselben Datei (`mergeQueueService.ts`) und laufen nacheinander
- T031 (`ReviewOverview.tsx`) setzt T023 aus US1 nicht voraus, kollidiert aber mit ihm in derselben Datei

### Abhängigkeiten innerhalb von US3

- T033 (`runSummary.ts`) blockiert T034 und T035
- T034 und T035 liegen in derselben Datei (`ExecutionsView.tsx`) und laufen nacheinander

### Parallel-Gelegenheiten

- Die vier Testaufgaben von US1 (T005-T008) betreffen vier verschiedene Dateien und laufen parallel
- Die drei Katalog-Aufgaben T010, T011, T012 laufen nach T009 parallel (drei Dateien)
- T021, T022, T024, T025 sind vier verschiedene Oberflächendateien und laufen parallel
- T038 und T039 sind reine Prüfungen ohne Schreibzugriff und laufen parallel
- US3 ist gegenüber US1/US2 vollständig unabhängig und kann von Anfang an parallel laufen — außer der
  gemeinsamen Datei `ExecutionsView.tsx`

---

## Parallel Example: User Story 1

```bash
# Testaufgaben gemeinsam starten (vier Dateien, keine Überschneidung):
Task: "T005 verificationGap.test.ts neu anlegen — Matrix aus quickstart.md §1"
Task: "T006 mergeQueueService.attention.test.ts erweitern — Eintrag übersteht Stufenwechsel"
Task: "T007 attentionReconciler.test.ts erweitern — nicht stage-gekoppelt, restart-sicher"
Task: "T008 workflowModel.test.ts erweitern — Label der neuen Stufe, INV-2"

# Nach T009 die Kataloge gemeinsam nachziehen (drei Dateien):
Task: "T010 INTEGRATION_STAGE_META in packages/shared/src/workflowModel.ts"
Task: "T011 STAGE_CLASS in packages/shared/src/actionPolicy.ts"
Task: "T012 INTEGRATION_STAGE_ORIGIN + Schritt-Prosa in packages/shared/src/lifecycleCatalog.ts"

# Oberflächen gemeinsam (vier Dateien):
Task: "T021 KIND_META in packages/web/src/components/AttentionInbox.tsx"
Task: "T022 STAGE_LABEL-Fallback in packages/web/src/components/ReviewOverview.tsx"
Task: "T024 IntegrationBadge in packages/web/src/components/ExecutionsView.tsx"
Task: "T025 Leerfall-Texte in packages/web/src/components/review/TestsPane.tsx"
```

---

## Implementation Strategy

### MVP zuerst (nur User Story 1)

1. Phase 1 (T001) — Ausgangslage sichern, insbesondere den heutigen Meldungswortlaut für INV-4
2. Phase 2 (T002-T004) — Meldungs-Modul
3. Phase 3 (T005-T026) — US1
4. **Stoppen und prüfen**: Sichtprüfung A aus quickstart.md §2 plus Gegenprobe mit einem Projekt
   MIT `verifyCommands` (FR-011: Stufe, Wortlaut und Aufmerksamkeits-Liste unverändert, nur der
   Aufgabenstand ist neu)
5. Damit ist der schädliche Teil behoben: kein Feature wird mehr als „verifiziert" angekündigt, ohne
   dass geprüft wurde

### Inkrementelle Auslieferung

1. Setup + Foundational → Texte stehen fest
2. US1 → unabhängig prüfen (Sichtprüfung A) → auslieferbar (MVP)
3. US2 → unabhängig prüfen (Sichtprüfung B) → auslieferbar
4. US3 → unabhängig prüfen (Sichtprüfung C) → auslieferbar
5. Polish (T036-T040) → Zusicherungen belegen

### Parallele Bearbeitung

- Person A: US1 (der grösste Block, 22 Aufgaben)
- Person B: US3 — vollständig unabhängig, einzige Absprache ist `ExecutionsView.tsx` (T024 vs.
  T034/T035)
- US2 wartet auf T017 aus US1 oder zieht es vor

---

## Notes

- Jede neue Anzeige ist Durchreichung oder Division bereits erhobener Werte — keine neue Zähl- oder
  Messstelle, keine neue Route, keine Migration (FR-022, SC-008, research.md D10)
- Keine neue Sperre: `hasAnyTaskDone` (`mergeQueueService.ts:230`) bleibt Wort für Wort die einzige
  Mindesthürde (FR-010, FR-016, SC-005)
- `pnpm typecheck` ist die erste Abnahme von FR-001a: nach T009 muss er in `INTEGRATION_STAGE_META`,
  `STAGE_CLASS`, `INTEGRATION_STAGE_ORIGIN` und `KIND_META` brechen
- Prozesse nur über den eigenen Port beenden — generische `pkill`-/`killall`-Muster sind in diesem
  Repo verboten, die eigene Session ist Kindprozess der laufenden Toolkit-Instanz (CLAUDE.md)
- Nach jeder Aufgabe oder logischen Gruppe committen
