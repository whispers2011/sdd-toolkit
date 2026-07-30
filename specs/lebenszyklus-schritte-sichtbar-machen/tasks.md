---
description: "Task list für Lebenszyklus-Schritte sichtbar machen"
---

# Tasks: Lebenszyklus-Schritte sichtbar machen

**Input**: Design-Dokumente aus `specs/lebenszyklus-schritte-sichtbar-machen/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/lifecycle-catalog.md](./contracts/lifecycle-catalog.md),
[contracts/ui-contract.md](./contracts/ui-contract.md), [quickstart.md](./quickstart.md)

**Tests**: Die Spezifikation fordert Tests **ausdrücklich** (FR-011, FR-012, US2-AS3/AS4,
US3-AS3, SC-003/SC-004/SC-005) — die Testaufgaben unten sind deshalb Pflicht, nicht optional.
Sie sind allerdings keine TDD-Vorab-Tests: der Katalog ist reine Daten, die Tests prüfen seine
Vollständigkeit und liegen darum in Phase 4 (US2), wo sie inhaltlich hingehören.
`packages/web` hat konventionsgemäß keine Tests — die UI-Kriterien werden über
[quickstart.md](./quickstart.md) manuell nachgewiesen.

**Organization**: Aufgaben sind nach User Story gruppiert, damit jede Story unabhängig
umgesetzt und geprüft werden kann.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallelisierbar (andere Datei, keine Abhängigkeit auf unfertige Aufgaben)
- **[Story]**: Zuordnung zur User Story (US1, US2, US3)
- Jede Aufgabe nennt den exakten Dateipfad

## Pfad-Konventionen

pnpm-Monorepo (Project Type aus plan.md), Pfade repo-relativ:

- `packages/shared/src/` — pure Typen/Daten/Funktionen, **kein `node:`-Import**
- `packages/server/src/` — API, Services, git; führt `@types/node`
- `packages/web/src/` — React-SPA, keine Tests

> **Hinweis zur Parallelität**: Dieses Feature ist bewusst auf **zwei** Produktivdateien
> konzentriert (`lifecycleCatalog.ts`, `WorkflowOverview.tsx`). Echte `[P]`-Paare gibt es
> deshalb nur wenige — sie sind unten markiert. Aufgaben in derselben Datei sind seriell
> auszuführen, auch wenn sie logisch unabhängig wirken.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Modul-Skelett anlegen und verdrahten. Keine neuen Dependencies, keine Migration,
kein Tooling-Umbau (plan.md „Primary Dependencies": 0 neue Runtime- und Dev-Deps).

- [X] T001 Modul `packages/shared/src/lifecycleCatalog.ts` neu anlegen mit Kopfkommentar (Zweck: fest verdrahtete Arbeit des Toolkits beschreiben; Vertrag „pure Daten, KEINE UI, KEIN IO, kein `node:`-Import" analog `packages/shared/src/workflowModel.ts`; Abgrenzung zu `workflowModel.ts` gemäß data-model.md §2.3) sowie `LIFECYCLE_STAGES` als `readonly`-Tupel der fünf Werte `worktree_create`, `phase_start`, `phase_end`, `integration`, `merge` (Array-Reihenfolge = Lebenszyklus-Reihenfolge) und dem abgeleiteten Typ `LifecycleStageId`
- [X] T002 Re-Export `export * from './lifecycleCatalog.js';` in `packages/shared/src/index.ts` ergänzen (unmittelbar nach der Zeile `export * from './workflowModel.js';`)
- [X] T003 Baseline für den späteren Vergleich festhalten: `pnpm -r typecheck && pnpm -r test` grün, und für die Workflow-Ansicht Anzahl der Netzwerkanfragen sowie Seitenhöhe/Scrollposition notieren (DevTools, quickstart.md Stufe 3 und 5) — Vergleichswerte für T019/T032 (SC-006) und T031 (SC-007)

**Checkpoint**: Das Modul existiert, ist aus `@sdd/shared` importierbar, und der Ausgangszustand ist messbar dokumentiert.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Typen, Katalog-Gerüst und Helfer — die Grundlage, auf der alle drei Stories aufsetzen.

**⚠️ CRITICAL**: Ohne diese Phase kann keine User Story beginnen.

- [X] T004 Typen `CodeLocation`, `LifecycleStep` und `LifecycleStage` in `packages/shared/src/lifecycleCatalog.ts` definieren, exakt nach contracts/lifecycle-catalog.md §1: Pflichtfelder `id`/`name`/`description`/`trigger`/`location` bzw. `id`/`title`/`when`/`steps`, optionale Felder `orderNote?`, `condition?`, `notDoneHere?` (`exactOptionalPropertyTypes: true` — Felder werden weggelassen, nie auf `undefined` gesetzt), `steps: readonly LifecycleStep[]`, jedes Feld mit TSDoc-Kommentar aus dem Vertrag
- [X] T005 `LIFECYCLE_CATALOG: Record<LifecycleStageId, LifecycleStage>` als Gerüst in `packages/shared/src/lifecycleCatalog.ts` anlegen: fünf Einträge mit `id` (= Schlüssel), `title` und `when` gemäß data-model.md §5.1–§5.5; `steps` bleibt vorerst `[]` und wird in Phase 3 gefüllt (die ≥1-Schritt-Invariante sichert erst T021)
- [X] T006 Helfer `lifecycleStage(id: LifecycleStageId): LifecycleStage` (Total-Funktion, wirft nie) und `orderedLifecycleStages(): readonly LifecycleStage[]` (Reihenfolge aus `LIFECYCLE_STAGES`) in `packages/shared/src/lifecycleCatalog.ts` ergänzen
- [X] T007 Checkpoint verifizieren: `pnpm --filter @sdd/shared typecheck` grün und `grep -n "node:" packages/shared/src/lifecycleCatalog.ts` ohne Treffer (Constitution-Gate „`@sdd/shared` bleibt node-frei")

**Checkpoint**: Typen und Gerüst stehen, `@sdd/shared` kompiliert und bleibt pur — die User Stories können beginnen.

---

## Phase 3: User Story 1 - Nachlesen, was das Toolkit an einer Stelle tatsächlich tut (Priority: P1) 🎯 MVP

**Goal**: Alle fünf Lebenszyklus-Stufen sind inhaltlich beschrieben und in der bestehenden
Workflow-Übersicht an ihrem Knoten aufklappbar lesbar — je Schritt Name, Beschreibung,
Zeitpunkt und Ort im Code, ohne zusätzliche Serveranfrage und ohne ausgewähltes Feature.

**Independent Test**: Workflow-Übersicht öffnen und für jede der fünf Stufen (Worktree-Anlage,
Phasenstart, Phasenende, Integration, Merge) die Schrittliste aufklappen — jede Stufe zeigt
mindestens einen Schritt mit Name und Beschreibung; die Integrations-Stufe zeigt die Schritte in
der Reihenfolge aus FR-007. Funktioniert auch bei Geltung „Projekt-Standard" ohne Feature.

### Katalog-Inhalt für User Story 1

> Alle fünf Aufgaben schreiben in **dieselbe** Datei `packages/shared/src/lifecycleCatalog.ts` und
> sind daher seriell auszuführen. Vorlage ist jeweils die Tabelle in data-model.md; `orderNote`
> und `notDoneHere` bleiben ausdrücklich Phase 5 (US3), `condition` gehört hier dazu (research.md D8).

- [X] T008 [US1] Stufe `worktree_create` in `packages/shared/src/lifecycleCatalog.ts` mit den 6 Schritten aus data-model.md §5.1 füllen (Anlage serialisieren, verwaiste Registry-Einträge entfernen, bestehenden Worktree idempotent wiederverwenden, Worktree anlegen/Branch abzweigen, Wettlauf-Wiederholung, Agent-Konfiguration spiegeln) — je Schritt kebab-case-`id`, deutscher `name` (≤ 60 Zeichen), `description` (1–3 Sätze, ≤ 400 Zeichen), `trigger`, `location` aus `packages/server/src/git/worktrees.ts` mit dem dort genannten Symbol, `condition` bei Schritt 3 und 5 (FR-004)
- [X] T009 [US1] Stufe `phase_start` in `packages/shared/src/lifecycleCatalog.ts` mit den 7 Schritten aus data-model.md §5.2 füllen (`before_phase`-Gate, Session sicherstellen, Transkript-Startmarke, Kontext-Reset gemäß Strategie, Wissens-Präambel, Dokument-Verweise, Slash-Kommando bauen und senden) — Locations verweisen auf `packages/server/src/services/orchestrator.ts`, `packages/server/src/services/contextOptimizer.ts`, `packages/shared/src/featureDocuments.ts` und `packages/server/src/pty/commandBuilder.ts`; `condition` bei Gate, Reset und Präambel (FR-005)
- [X] T010 [US1] Stufe `phase_end` in `packages/shared/src/lifecycleCatalog.ts` mit den 6 Schritten aus data-model.md §5.3 füllen (Reset-Turn aussortieren, Verbrauch messen, Zahlen nachtragen, Transkript-Grenzen festhalten, Aufgaben aus `tasks.md` erneut zählen, `after_phase`-Gate) — Locations aus `packages/server/src/services/orchestrator.ts` und `packages/server/src/services/artifacts.ts`; `condition` bei Nachtragen und Gate (FR-006)
- [X] T011 [US1] Stufe `integration` in `packages/shared/src/lifecycleCatalog.ts` mit den 7 Schritten aus data-model.md §5.4 in **genau dieser Reihenfolge** füllen: Vorprüfungen → Worktree festschreiben → Zustand mit Git abgleichen → Verify-Kommandos → Review-Gate-Agents → Review-Berichte committen → Übergabe an Queue bzw. Human-Review; Locations aus `packages/server/src/services/mergeQueueService.ts`, `packages/server/src/services/verifyService.ts` und `packages/server/src/services/agentGateService.ts`; `condition` bei Verify, Review-Gate, Berichte-Commit und Übergabe (FR-007)
- [X] T012 [US1] Stufe `merge` in `packages/shared/src/lifecycleCatalog.ts` mit den 6 Schritten aus data-model.md §5.5 füllen (erneuter Git-Abgleich, Rebase auf das Ziel, Konflikte headless auflösen mit höchstens 3 Versuchen, erneut verifizieren, Merge nach Strategie fast-forward/squash, Abschluss und Aufräumen inkl. Session beenden/Worktree entfernen/Worktree-Pfad leeren) — Locations aus `packages/server/src/services/mergeQueueService.ts`, `packages/server/src/git/mergeEngine.ts` und `packages/server/src/services/conflictResolver.ts`; `condition` bei Konfliktauflösung, Re-Verify und PR-Modus (FR-008)

### UI-Anzeige für User Story 1

- [X] T013 [P] [US1] Disclosure-Komponente `LifecycleSteps({ stage }: { stage: LifecycleStageId })` in `packages/web/src/components/WorkflowOverview.tsx` ergänzen: `useState(false)` (zugeklappt als Startzustand), `<button aria-expanded={open}>` mit vorhandenem `ChevronDownIcon` aus `packages/web/src/components/icons.tsx` (180°-Rotation im offenen Zustand, Muster aus `ConfigHeader`), Kopfzeile „Was das Toolkit hier tut (n)" mit Schrittanzahl, aufgeklappt `stage.when` als Einordnungssatz und eine `<ol>` mit je Nummer, `name`, `description`, „Wann:" + `trigger`, `file · symbol` in Monospace mit `break-words` und „Nur wenn:" + `condition` (nur wenn gesetzt) — Katalog per statischem Import aus `@sdd/shared`, kein `api.*`-Aufruf, kein `useEffect` (kann parallel zu T008–T012 laufen: andere Datei, hängt nur an Phase 2)
- [X] T014 [US1] `<LifecycleSteps stage="worktree_create" />` in `PromptCard` in `packages/web/src/components/WorkflowOverview.tsx` unterhalb des bestehenden Beschreibungstexts einbauen, bestehende Inhalte unverändert (ui-contract.md §2)
- [X] T015 [US1] `<LifecycleSteps stage="phase_start" />` und darunter `<LifecycleSteps stage="phase_end" />` in `PhaseCard` in `packages/web/src/components/WorkflowOverview.tsx` unter dem Zweck-Text (`meta.purpose`) und oberhalb der `AgentZone`-Blöcke einbauen — je Instanz eigener Zustand, `PhaseCard` rendert weiterhin nur aktive Phasen
- [X] T016 [US1] `<LifecycleSteps stage="integration" />` im Kopfbereich von `IntegrationBlock` in `packages/web/src/components/WorkflowOverview.tsx` oberhalb der Schritt-Pills einbauen, Kurzbeschreibungen der Integrations-Schritte bleiben erhalten
- [X] T017 [US1] `<LifecycleSteps stage="merge" />` in `IntegrationStepPill` in `packages/web/src/components/WorkflowOverview.tsx` nur für `step.id === 'merge_queue'` unterhalb des bestehenden `detail`-Textes einbauen (research.md D6: die Arbeit passiert an `merge_queue`, nicht am terminalen `merged`)
- [X] T018 [US1] `pnpm --filter @sdd/web typecheck` grün stellen und die Anzeige gemäß quickstart.md Stufe 4 gegenlesen: je Stufe Name, Beschreibung, „Wann:" und Code-Ort vorhanden; Integration in der FR-007-Reihenfolge
- [X] T019 [US1] Nachweis quickstart.md Stufe 3 (US1-AS7, FR-015, SC-006): Geltung auf „Projekt-Standard (global + Projekt)" stellen, Netzwerk-Panel leeren, neu laden — alle fünf Aufklapp-Zeilen vollständig lesbar, keine zusätzliche Anfrage gegenüber der Baseline aus T003, kein Request mit „lifecycle" oder „catalog"

**Checkpoint**: User Story 1 ist vollständig nutzbar — alle fünf Stufen sind in der Übersicht aufklappbar lesbar. Das ist der MVP und kann hier ausgeliefert werden.

---

## Phase 4: User Story 2 - Der Katalog veraltet nicht still (Priority: P2)

**Goal**: Eine neue Feature-Phase oder Integrations-Stufe ohne Katalogeintrag bricht
`pnpm typecheck` **an der Stelle des Katalogs**; leere Felder und tote Code-Orte lassen die
Tests fehlschlagen und nennen den betroffenen Schritt.

**Independent Test**: Der Domäne testweise einen Wert hinzufügen (`FEATURE_PHASES` um `review`,
`IntegrationStage` um `canary_check`) und prüfen, dass `pnpm -r typecheck` in
`packages/shared/src/lifecycleCatalog.ts` bricht; anschließend eine `description` leeren bzw.
einen `location.file`/`location.symbol` verfälschen und prüfen, dass die Tests mit Nennung von
Stufe und Schritt fehlschlagen.

### Drift-Guard-Bindung

- [X] T020 [US2] `STANDARD_PHASE_STAGES` und `PHASE_LIFECYCLE_STAGES` in `packages/shared/src/lifecycleCatalog.ts` ergänzen: `const STANDARD_PHASE_STAGES = ['phase_start', 'phase_end'] as const;` plus ein Objektliteral mit einem Eintrag je Wert aus `FEATURE_PHASES` (`specify`, `clarify`, `plan`, `checklist`, `analyze`, `tasks`, `implement`), alle auf `STANDARD_PHASE_STAGES` verweisend, abgeschlossen mit `satisfies Record<FeaturePhase, readonly LifecycleStageId[]>` — `FeaturePhase` als Typ-Import aus `./types.js` (data-model.md §2.1, FR-010)
- [X] T021 [US2] `INTEGRATION_STAGE_ORIGIN` in `packages/shared/src/lifecycleCatalog.ts` ergänzen: Objektliteral mit einem Eintrag je Wert des `IntegrationStage`-Unions (`none: null`; `verifying`/`verify_failed`/`review_gate`/`gate_failed`/`awaiting_human_review`/`queued` → `'integration'`; `merging`/`conflict_resolving`/`conflict_escalated`/`merged` → `'merge'`), abgeschlossen mit `satisfies Record<IntegrationStage, LifecycleStageId | null>`, plus TSDoc zur Semantik „welche Stufe beschreibt den Ablauf, der zu dieser Stufe führt" (data-model.md §2.2, FR-010)

### Vollständigkeits- und Existenztests

- [X] T022 [P] [US2] `packages/shared/src/lifecycleCatalog.test.ts` neu anlegen (vitest, pure) mit den Regeln aus data-model.md §4: jede `LifecycleStageId` hat einen Eintrag mit `id` = Schlüssel; jede Stufe hat ≥ 1 Schritt; `title`/`when`/`name`/`description`/`trigger`/`location.file`/`location.symbol` nicht leer; gesetzte `orderNote`/`condition`/`notDoneHere` nicht leer; `name` ≤ 60 und `description` ≤ 400 Zeichen; Schritt-`id`s je Stufe eindeutig; `location.file` beginnt mit `packages/`, endet auf `.ts`/`.tsx` und enthält keine Zeilenangabe (`:` gefolgt von Ziffern); jede `FeaturePhase` hat einen `PHASE_LIFECYCLE_STAGES`-Eintrag mit existierenden, nicht-leeren Stufen; jede `IntegrationStage` hat einen `INTEGRATION_STAGE_ORIGIN`-Eintrag und jeder Nicht-`null`-Wert existiert im Katalog; die Stufe `integration` bildet die FR-007-Reihenfolge ab (Festschreiben **vor** Git-Abgleich) — Fehlermeldungen nennen Stufe und Schritt-`name`
- [X] T023 [P] [US2] `packages/server/src/services/lifecycleCatalogPaths.test.ts` neu anlegen (vitest, Dateisystem) mit Kopfkommentar zur Paket-Zugehörigkeit (research.md D5): Repo-Wurzel von `import.meta.url` aufwärts über das Vorhandensein von `pnpm-workspace.yaml` suchen (keine festen `..`-Sprünge), dann über `orderedLifecycleStages()` je Schritt prüfen, dass `<repo-root>/<location.file>` mit `existsSync` existiert und das letzte Glied von `location.symbol` (nach dem letzten `.`) als Text in der Datei vorkommt — Fehlermeldung nennt Stufe **und** Schritt-`name` (FR-012, SC-004, US2-AS4)
- [ ] T024 [US2] Drift-Guard beweisen gemäß quickstart.md Stufe 2: (a) `FEATURE_PHASES` in `packages/shared/src/types.ts` testweise um `'review'` erweitern → `pnpm -r typecheck` bricht an `PHASE_LIFECYCLE_STAGES` in `packages/shared/src/lifecycleCatalog.ts`; (b) `IntegrationStage` um `| 'canary_check'` erweitern → Fehler an `INTEGRATION_STAGE_ORIGIN`; (c) eine `description` leeren sowie `location.file`/`location.symbol` verfälschen → `pnpm --filter @sdd/shared test` bzw. `pnpm --filter @sdd/server test` schlagen mit Nennung des Schritts fehl; jeden Eingriff einzeln machen und mit `git checkout --` vollständig zurücknehmen

**Checkpoint**: User Stories 1 und 2 funktionieren unabhängig — die Übersicht ist lesbar **und** gegen stilles Veralten gesichert.

---

## Phase 5: User Story 3 - Fragile Reihenfolgen und Nicht-Zuständigkeiten sind festgehalten (Priority: P3)

**Goal**: Die zwingende Reihenfolge „Festschreiben vor Git-Abgleich" samt Folge ihrer Umkehrung
und die Nicht-Zuständigkeit „Abhängigkeiten installiert das Toolkit nicht" stehen im Katalog,
sind in der Oberfläche abgesetzt lesbar und durch Tests gegen Verlust gesichert.

**Independent Test**: Die Beschreibung des Schritts „Worktree festschreiben" auf die Begründung
der Reihenfolge prüfen und in der aufgeklappten Stufe „Worktree-Anlage" den Hinweis auf die
nicht vom Toolkit erledigte Installation von Abhängigkeiten finden; zusätzlich prüfen, dass die
Tests fehlschlagen, wenn einer der beiden Texte fehlt oder leer ist.

- [X] T025 [US3] `orderNote` am Integration-Schritt „Worktree festschreiben" in `packages/shared/src/lifecycleCatalog.ts` ergänzen mit dem Wortlaut aus data-model.md §5.4 Zeile 2: MUSS vor dem Git-Abgleich laufen; andernfalls hat der Branch keinen eigenen Commit, gilt trivial als Vorfahre des Ziels, der Abgleich hält ihn für „bereits gemergt" und eskaliert wegen der uncommitteten Dateien — jede Integration eskaliert, ohne dass je committet würde (FR-009, SC-005)
- [X] T026 [US3] `notDoneHere` an der Stufe `worktree_create` in `packages/shared/src/lifecycleCatalog.ts` ergänzen: das Toolkit installiert keine Abhängigkeiten (kein `pnpm install`, kein Build) — der Worktree kommt mit ausgecheckten Dateien plus gespiegelter Agent-Konfiguration, alles Weitere macht der Agent im Worktree (FR-004, US3-AS2)
- [X] T027 [US3] Die übrigen `orderNote`s aus data-model.md in `packages/shared/src/lifecycleCatalog.ts` nachtragen (research.md D9: dieselbe Art fragiles Wissen): Stufe `worktree_create` Schritt 1 (zwei parallele Aufrufe lesen sonst beide „Branch fehlt" → „cannot lock ref … reference already exists"), Stufe `phase_start` Schritt 3 (Startmarke **vor** dem Kontext-Reset, damit dessen Verbrauch zum Lauf zählt), Stufe `phase_end` Schritt 1 (Reset-Turn vor jeder Abrechnung aussortieren, sonst meldet er Erfolg ohne Arbeit)
- [X] T028 [US3] Tests in `packages/shared/src/lifecycleCatalog.test.ts` ergänzen: der Integration-Schritt „Worktree festschreiben" trägt einen nicht-leeren `orderNote`, der den Git-Abgleich und die Eskalations-Folge benennt; die Stufe `worktree_create` trägt ein nicht-leeres `notDoneHere` zum Thema Abhängigkeiten (US3-AS3, SC-005)
- [X] T029 [US3] Rendering in `packages/web/src/components/WorkflowOverview.tsx` ergänzen: `step.orderNote` abgesetzt hervorgehoben im Warn-Ton (Rahmen + Amber, damit er beim Überfliegen nicht untergeht) und `stage.notDoneHere` am Fuß der aufgeklappten Liste mit dem Label „Nicht Aufgabe des Toolkits:" — beide nur wenn gesetzt (ui-contract.md §3, §6)
- [X] T030 [US3] Nachweis in der Oberfläche gemäß quickstart.md Stufe 4 „Zusätzlich (US3)": Integration → „Worktree festschreiben" zeigt den Reihenfolge-Hinweis mit Voranstellung und Folge (US3-AS1); Worktree-Anlage → „Nicht Aufgabe des Toolkits" nennt die Installation von Abhängigkeiten (US3-AS2)

**Checkpoint**: Alle drei User Stories sind unabhängig funktionsfähig.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Abnahme der querschnittlichen Kriterien — Kompaktheit, Nicht-Veränderung, Genauigkeit.

- [X] T031 Aufklapp-Verhalten und Kompaktheit gemäß quickstart.md Stufe 5 abnehmen (`packages/web/src/components/WorkflowOverview.tsx`): frisch geladen alles zugeklappt; Seitenhöhe gegen die Baseline aus T003 nur um die Umschaltzeilen gewachsen (SC-007); eine Stufe öffnen lässt alle anderen zu — auch die zweite Disclosure derselben Phasen-Karte und die gleichnamigen Stufen anderer Phasen; erneuter Klick klappt zu (US1-AS6); Ansicht wechseln und zurück → wieder zugeklappt; bei ~900 px Fensterbreite kein horizontales Scrollen; höchstens zwei Interaktionen bis zu den Schritten (SC-002)
- [ ] T032 Nicht-Verhaltensänderung gemäß quickstart.md Stufe 6 belegen: `git diff --stat main...HEAD` zeigt außer den Spec-Artefakten ausschließlich `packages/shared/src/lifecycleCatalog.ts`, `packages/shared/src/lifecycleCatalog.test.ts`, `packages/shared/src/index.ts` (eine Zeile), `packages/server/src/services/lifecycleCatalogPaths.test.ts` und `packages/web/src/components/WorkflowOverview.tsx`; `packages/server/src/services/orchestrator.ts`, `packages/server/src/services/mergeQueueService.ts`, `packages/server/src/git/worktrees.ts`, `packages/shared/src/workflowModel.ts`, DB, API-Routen, WS-Events und `package.json`-Dependencies sind unverändert (FR-016, SC-006)
- [ ] T033 Vollständiger Lauf `pnpm -r typecheck && pnpm -r test` grün, insbesondere `packages/shared/src/workflowModel.test.ts` unverändert bestanden (SC-006)
- [ ] T034 [P] Prosa-Genauigkeit der Katalogtexte in `packages/shared/src/lifecycleCatalog.ts` gegen den Quelltext der referenzierten Symbole gegenlesen (Risiko-Tabelle in plan.md: kein Test kann Prosa prüfen) und das Ergebnis als Notiz in `specs/lebenszyklus-schritte-sichtbar-machen/checklists/requirements.md` festhalten

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten — startet sofort
- **Foundational (Phase 2)**: braucht Phase 1 — **blockiert alle User Stories**
- **User Story 1 (Phase 3)**: braucht Phase 2 — keine Abhängigkeit auf US2/US3
- **User Story 2 (Phase 4)**: braucht Phase 2; T022–T024 setzen den Katalog-Inhalt aus Phase 3 voraus (sie prüfen ihn)
- **User Story 3 (Phase 5)**: braucht Phase 2 und die Stufen-Inhalte aus T008 und T011; T029 setzt die Komponente aus T013 voraus
- **Polish (Phase 6)**: braucht alle gewünschten Stories

### User Story Dependencies

- **US1 (P1)**: unabhängig lieferbar — der MVP
- **US2 (P2)**: unabhängig testbar; die Vollständigkeitstests brauchen aber Katalog-Inhalt, der erst mit US1 entsteht (eine leere Stufe ist per Invariante ein Fehler, kein Leerzustand)
- **US3 (P3)**: unabhängig testbar; ergänzt Textfelder und deren Rendering an den von US1 gelegten Stufen

### Within Each User Story

- Katalog-Inhalt vor UI-Verifikation (T008–T012 vor T018/T019)
- Drift-Guard-Records vor dem Test, der sie prüft (T020/T021 vor T022)
- Textfelder vor Test und Rendering (T025–T027 vor T028/T029)
- Nachweise am Ende der Phase, nicht zwischendurch

### Parallel Opportunities

Echte Parallelität ist knapp, weil zwei Produktivdateien fast alles tragen:

- **T013** (Disclosure-Komponente in `WorkflowOverview.tsx`) läuft parallel zu **T008–T012** (Katalog-Inhalt in `lifecycleCatalog.ts`) — andere Datei, hängt nur an Phase 2
- **T022** (`packages/shared/src/lifecycleCatalog.test.ts`) und **T023** (`packages/server/src/services/lifecycleCatalogPaths.test.ts`) laufen parallel — verschiedene Pakete, verschiedene Dateien
- **T034** läuft parallel zu T031–T033 — reine Review-Arbeit an der Spec-Checkliste
- **Nicht parallel**: T008–T012, T020, T021, T025–T027 (alle in `lifecycleCatalog.ts`); T014–T017, T029 (alle in `WorkflowOverview.tsx`)

---

## Parallel Example: User Story 1

```bash
# Nach Abschluss von Phase 2 gleichzeitig startbar:
Task: "T013 Disclosure-Komponente LifecycleSteps in packages/web/src/components/WorkflowOverview.tsx"
Task: "T008 Stufe worktree_create in packages/shared/src/lifecycleCatalog.ts"   # dann T009 … T012 seriell
```

## Parallel Example: User Story 2

```bash
# Nach T021 gleichzeitig startbar:
Task: "T022 packages/shared/src/lifecycleCatalog.test.ts"
Task: "T023 packages/server/src/services/lifecycleCatalogPaths.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup (T001–T003)
2. Phase 2: Foundational (T004–T007) — **blockiert alles Weitere**
3. Phase 3: User Story 1 (T008–T019)
4. **STOP und VALIDIEREN**: alle fünf Stufen in der Übersicht aufklappen, quickstart.md Stufe 3 und 4
5. Auslieferbar: die Sichtbarkeit, die das Feature verspricht, steht

### Incremental Delivery

1. Setup + Foundational → Modul kompiliert und ist importierbar
2. US1 → unabhängig prüfen → ausliefern (**MVP**)
3. US2 → Drift-Guard und Tests → unabhängig prüfen (quickstart.md Stufe 2) → ausliefern
4. US3 → Reihenfolge- und Nicht-Zuständigkeits-Texte → unabhängig prüfen → ausliefern
5. Phase 6 → Abnahme von SC-006 und SC-007

### Parallel Team Strategy

Der Nutzen ist hier begrenzt (zwei Dateien tragen fast alles). Sinnvoller Schnitt:

1. Team macht Setup + Foundational gemeinsam
2. Danach: Entwickler A den Katalog-Inhalt (`lifecycleCatalog.ts`, T008–T012), Entwickler B die UI (`WorkflowOverview.tsx`, T013–T017)
3. Anschließend die Tests aus US2 parallel (T022 shared, T023 server), dann US3 seriell auf beiden Dateien

---

## Notes

- `[P]` = andere Datei, keine Abhängigkeit — in diesem Feature bewusst sparsam markiert
- `[Story]`-Label verknüpft die Aufgabe mit der User Story (Traceability)
- Nach jeder Aufgabe oder jeder logischen Gruppe committen
- An jedem Checkpoint kann die Story unabhängig validiert werden
- **Keine neuen Dependencies**, keine Migration, keine API- oder WS-Änderung — jede Abweichung davon ist ein Verstoß gegen FR-016/SC-006
- **`@sdd/shared` bleibt node-frei**: der Dateisystem-Test liegt bewusst in `packages/server` (research.md D5)
- Code-Orte immer als Datei **plus** Symbol, **nie** mit Zeilennummer (FR-012)
- Beim Testen eigener Instanzen: nur freie Ports nutzen und nur diese über Port oder gemerkte PID abräumen — kein `pkill -f vite`/`node`/`tsx`, die eigene Session ist Kindprozess der laufenden Toolkit-Instanz
