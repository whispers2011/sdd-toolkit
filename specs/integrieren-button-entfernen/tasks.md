---
description: "Task list for feature implementation"
---

# Tasks: Aktions-Buttons kontextabhängig — ein Standardweg in die Anwendung

**Input**: Design-Dokumente aus `/specs/integrieren-button-entfernen/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/action-policy.md](./contracts/action-policy.md), [contracts/http-api.md](./contracts/http-api.md), [quickstart.md](./quickstart.md)

**Tests**: Test-Tasks sind enthalten — die Spec fordert sie ausdrücklich (research D10 „Testabdeckung", contracts/action-policy.md §6 „Testverpflichtung"). Grund: `@sdd/web` hat keinen Test-Runner; die Shared-/Server-Suiten sind die einzige belastbare Absicherung der UI-Regeln.

**Organization**: Tasks sind nach User Story gruppiert, damit jede Story unabhängig umgesetzt und geprüft werden kann.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallelisierbar (andere Datei, keine Abhängigkeit auf unfertige Tasks)
- **[Story]**: Zuordnung zur User Story (US1…US4)
- Jede Beschreibung nennt den exakten Dateipfad

## Path Conventions

pnpm-Workspace mit drei Paketen (siehe plan.md → Project Structure):

- `packages/shared/src/` — pure Logik + Vitest
- `packages/server/src/` — Fastify-API, Services, SQLite + Vitest
- `packages/web/src/` — React-SPA (**kein** Test-Runner)

---

## Phase 1: Setup

**Purpose**: Ausgangslage festhalten, damit spätere Testläufe eine Vergleichsbasis haben

- [X] T001 Baseline sichern: `pnpm install`, danach `pnpm typecheck && pnpm test` im Repo-Root ausführen und das Ergebnis als Referenzpunkt notieren (alle Suiten müssen vor der ersten Änderung grün sein)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Die gemeinsame Festlegung nach FR-022 und ihre beiden Konsumenten-Gerüste. Ohne diese Phase kann keine User Story umgesetzt werden — sämtliche Sichtbarkeits- und Sperrregeln aller vier Oberflächen und aller bewachten Routen stammen aus diesem einen Modul.

**⚠️ CRITICAL**: Keine User-Story-Arbeit vor Abschluss dieser Phase.

- [X] T002 Modul `packages/shared/src/actionPolicy.ts` anlegen mit den Typen `FeatureActionId` (9 Aktionen), `ActionAvailability`, `ActionVerdict` (`availability`, `reason`, `confirmAbortsWork`), `FeatureActionContext` (`phases`, `integration`, `archived`, `hasWorktree`, `session`, `gateRunning`, `hasChanges`) und `StageClass` sowie der Klassifikation `export const STAGE_CLASS: Record<IntegrationStage, StageClass>` gemäß data-model.md §1/§2/§3 und research.md D3
- [X] T003 In `packages/shared/src/actionPolicy.ts` den vollständigen Textkatalog aus contracts/action-policy.md §2 als Konstanten ergänzen: Beschäftigt-Sätze, `DECISION_REASON` als `Record<'awaiting_human_review' | 'verify_failed' | 'gate_failed' | 'conflict_escalated', string>` und die Sperr-/Ausblendgründe; Stufennamen ausschließlich über `INTEGRATION_STAGE_META[stage].label` aus `packages/shared/src/workflowModel.ts` einsetzen (keine zweite Textquelle)
- [X] T004 In `packages/shared/src/actionPolicy.ts` `isFeatureComplete(phases: PhaseMap): boolean` (FR-001; `stale` gilt als freigegeben, leere Phasenmenge = nicht fertig) und `busyReason(ctx: FeatureActionContext): string | null` (FR-005, Prioritätsfolge aus data-model.md §1) implementieren
- [X] T005 In `packages/shared/src/actionPolicy.ts` `evaluateAction(action, ctx, opts?: { phase?: FeaturePhase }): ActionVerdict` mit allen neun Aktionen exakt nach der Entscheidungsmatrix in contracts/action-policy.md §1 implementieren (Bedingungen von oben nach unten, erster Treffer gewinnt; Invariante `reason === null` ⟺ `availability === 'available'`)
- [X] T006 Testsuite `packages/shared/src/actionPolicy.test.ts` anlegen mit den sechs Pflichtinhalten aus contracts/action-policy.md §6: (1) je Aktion jede Matrixzeile als eigener Fall inkl. Grundsatz, (2) Invariante über eine erzeugte Kontextmenge, (3) Laufzeit-Exhaustiveness von `STAGE_CLASS` über alle `IntegrationStage`-Werte nach dem Muster aus `packages/shared/src/workflowModel.test.ts`, (4) SC-001, (5) SC-002, (6) FR-011
- [X] T007 [P] `export * from './actionPolicy.js';` in `packages/shared/src/index.ts` ergänzen
- [X] T008 [P] Accessor `isGateRunning(featureId: string): boolean` in `packages/server/src/services/orchestrator.ts` ergänzen, der die vorhandene private Menge `runningGates` (Schlüssel `${featureId}:${phase}`) auf einen Treffer für das Feature prüft
- [X] T009 Modul `packages/server/src/services/actionGuard.ts` anlegen mit `buildContext(featureId): FeatureActionContext` (Feldherkunft nach contracts/http-api.md §3: Repos für `phases`/`integration`/`archived`/`hasWorktree`, `displayStatus(ptys.forFeature(id)?.machine.state) ?? null` für `session`, `orchestrator.isGateRunning(id)` für `gateRunning`, `'unknown'` für `hasChanges` sofern die Route keinen Wert hereinreicht) und `assertAllowed(action, featureId, opts?)`, das bei einem Befund ≠ `available` per `httpError(409, verdict.reason)` abbricht
- [X] T010 Testsuite `packages/server/src/services/actionGuard.test.ts` anlegen: Kontextaufbau aus Repos/PTY-Manager/Orchestrator und Ablehnung mit wortgleichem Grundsatz aus der Policy
- [X] T011 [P] Komponente `packages/web/src/components/FeatureAction.tsx` anlegen mit `ActionGroup` (rendert Aktionen und darunter dauerhaft den Grundsatz als `<p id="reason-…">`, kein Tooltip), `ActionButton` (bei `blocked`: sichtbar, `aria-disabled="true"` statt `disabled`, fokussierbar, `aria-describedby` auf das Grund-Element, Klick wirkungslos; bei `hidden`: kein Rendering) und dem Hook `useAction` mit `inFlight`-Referenz je Aktion (research D6/D7)
- [X] T012 In `packages/web/src/store.tsx` einen Selector `featureActionContext(featureId): FeatureActionContext` ergänzen, der den Kontext rein synchron aus dem vorhandenen Store-Zustand baut (Session aus `state.app.sessions`, Gate aus `state.gateRunning`); `hasChanges` liefert in dieser Phase fest `'unknown'`

**Checkpoint**: Die gemeinsame Festlegung existiert, ist getestet, wird vom Server durchgesetzt und ist in der Web-Oberfläche darstellbar — User Stories können beginnen.

---

## Phase 3: User Story 1 - Integrieren erst, wenn das Feature fertig ist (Priority: P1) 🎯 MVP

**Goal**: Die Integrations-Aktion erscheint an keiner Oberfläche, solange noch ein aktiver Schritt offen ist, und ein Start auf jedem anderen Bedienweg wird abgelehnt, ohne Arbeit festzuschreiben. Ist das Feature fertig, aber änderungsfrei, bleibt die Aktion sichtbar und gesperrt.

**Independent Test**: Neues Feature anlegen und in jedem Zwischenzustand (kein Schritt gestartet, erster Schritt wartet auf Freigabe, mittlerer Schritt freigegeben, letzter Schritt offen) prüfen, dass weder Board noch Feature-Konsole eine Integrations-Aktion anbieten; danach alle Schritte freigeben und prüfen, dass die Aktion erscheint und die Pipeline startet. Zusätzlich `POST /api/features/<ID>/integrate` per curl gegen ein unfertiges Feature: 409 mit Grundsatz, `git status`/`git log` im Worktree vorher/nachher identisch.

### Implementation for User Story 1

- [X] T013 [US1] Route `GET /api/features/:id/integration-readiness` in `packages/server/src/api/server.ts` ergänzen: `hasChanges = files.length > 0 || commits.length > 0` aus `collectUnmergedChanges(worktreePath, feature.integrationTarget ?? project.defaultBranch)` (`packages/server/src/services/unmergedChanges.ts`); 404 bei unbekanntem Feature/Projekt, `{ hasChanges: false }` bei fehlendem oder unlesbarem Worktree (contracts/http-api.md §2)
- [X] T014 [P] [US1] Client-Methode `integrationReadiness(featureId): Promise<{ hasChanges: boolean }>` in `packages/web/src/api.ts` ergänzen
- [X] T015 [US1] In `packages/web/src/store.tsx` einen Bereitschafts-Cache je Feature ergänzen: Abruf ausschließlich für Features mit `isFeatureComplete(phases) && integration === 'none' && !archived && hasWorktree`, Verwerfen des Eintrags beim WS-Ereignis `feature_updated` für dieses Feature, und Einspeisung des Werts (sonst `'unknown'`) in den Selector `featureActionContext` aus T012
- [X] T016 [US1] `beginIntegration()` in `packages/server/src/services/mergeQueueService.ts` auf `Promise<{ started: boolean; reason?: string }>` umstellen und die drei Vorprüfungen (bereits in Integration · kein Worktree · keine Änderungen) **vor** `reconcile()`, `setStage('verifying')` und `commitWorktree()` ausführen, sodass bei Ablehnung weder Feature-Zustand noch Worktree verändert werden (FR-004/FR-027, research D5)
- [X] T017 [US1] Aufrufer der geänderten Signatur anpassen — insbesondere den `start_integration`-Effekt im automatischen Pfad in `packages/server/src/services/orchestrator.ts` — sodass ein `{ started: false }` sauber ausgewertet und nicht als Erfolg behandelt wird
- [X] T018 [US1] Route `POST /api/features/:id/integrate` in `packages/server/src/api/server.ts` (ca. Z. 525) mit `assertAllowed('integrate', id)` bewachen und dabei den serverseitig ermittelten `hasChanges`-Wert in den Kontext hereinreichen; Ablehnung als 409 mit dem Grundsatz aus der Policy
- [X] T019 [US1] „⇥ Integrieren" in der Schrittleiste von `packages/web/src/components/FeatureConsole.tsx` (ca. Z. 288) durch `ActionGroup`/`ActionButton` mit dem Befund aus `evaluateAction('integrate', ctx)` ersetzen; die bisherige lokale Bedingung entfernen
- [X] T020 [US1] Karten-Aktion „⇥ Integrieren" in `packages/web/src/components/KanbanBoard.tsx` (ca. Z. 344) auf denselben Befund umstellen und die bisherige spaltenbasierte Bedingung entfernen
- [X] T021 [US1] Drop-Ziel „Integrations-Spalte" in `packages/web/src/components/KanbanBoard.tsx` (`onDrop` ca. Z. 80, `onDragOver` ca. Z. 122) an `evaluateAction('integrate', ctx).availability === 'available'` binden: Zug sonst nicht annehmen, keine Drop-Markierung zeigen und bei `blocked` den Grundsatz als Meldung ausgeben (FR-018)

### Tests for User Story 1

- [X] T022 [US1] `packages/server/src/api/server.test.ts` um Ablehnungstests für `POST /api/features/:id/integrate` erweitern: unfertiges Feature → 409 „Erst integrierbar, wenn alle aktiven Schritte freigegeben sind.", bereits in Integration → 409, änderungsfreies Feature → 409 „Keine Änderungen zu integrieren."; zusätzlich ein Erfolgsfall für das fertige Feature
- [X] T023 [US1] `packages/server/src/services/mergeQueueService.test.ts` um Tests für die Vorprüfung erweitern: bei `{ started: false }` wurden weder `setStage` noch `commitWorktree` noch `reconcile` aufgerufen, und ein änderungsfreier Branch landet **nicht** über `finalizeMerged()` auf `merged` (research D2/D5)

**Checkpoint**: US1 ist eigenständig prüfbar — Szenarien 1, 2 und 5 aus quickstart.md laufen durch.

---

## Phase 4: User Story 2 - Keine Aktionen, während gearbeitet wird (Priority: P1)

**Goal**: Solange ein Feature beschäftigt ist (Schritt läuft, Session arbeitet/wartet, Gate läuft, Pipeline in aktiver Stufe), sind alle aktionsauslösenden Bedienelemente aller vier Oberflächen sichtbar gesperrt und nennen den Grund; betrachtende Bedienelemente und der Prompt an die Session bleiben unberührt.

**Independent Test**: Für ein Feature einen Schritt starten und während der Laufzeit jede aktionsauslösende Schaltfläche in Board, Feature-Konsole, Review-Übersicht und Review-Portal anklicken — keine löst aus, jede nennt den Grund ohne Hover. Diff, Artefakte, „Im Editor öffnen", „Pfad kopieren" und der Prompt funktionieren unverändert. Nach Ende des Laufs sind die sinnvollen Aktionen ohne Neuladen wieder verfügbar. Gegenprobe: ein zweites, untätiges Feature bleibt unbeeinflusst.

### Implementation for User Story 2

- [X] T024 [US2] Die drei Schritt-Routen in `packages/server/src/api/server.ts` (`POST /api/features/:id/phases/:phase/start`, `/approve`, `/discard`) je mit `assertAllowed('phase_start' | 'phase_approve' | 'phase_discard', id, { phase })` vor jeder Wirkung bewachen (contracts/http-api.md §3)
- [X] T025 [US2] Die Routen `POST /api/features/:id/approve-merge` (ca. Z. 531), `/retry-integration` (ca. Z. 543), `/archive` (ca. Z. 568) und `/reject-review` (ca. Z. 605) in `packages/server/src/api/server.ts` mit `assertAllowed('review_approve' | 'integration_retry' | 'archive' | 'review_reject', id)` bewachen; `DELETE /api/features/:id` bleibt bewusst ungeschützt
- [X] T026 [US2] Schrittleiste in `packages/web/src/components/FeatureConsole.tsx` (ca. Z. 237–270) auf `evaluateAction('phase_start' | 'phase_approve', ctx, { phase })` umstellen: keine eigene Statusabfrage mehr, Rendering ausschließlich über `ActionButton`
- [X] T027 [US2] Karten-Schritt-Aktionen „▶ Start", „✓ Approve" und „↺ Verwerfen" in `packages/web/src/components/KanbanBoard.tsx` auf die entsprechenden Policy-Befunde umstellen und die bisherigen lokalen Bedingungen (Session-Status, Spaltenzugehörigkeit) entfernen
- [X] T028 [US2] „✓ Freigeben & Integrieren" und „✗ Zurückweisen" in `packages/web/src/components/ReviewPortal.tsx` (ca. Z. 299–321) über `evaluateAction('review_approve' | 'review_reject', ctx)` rendern und das lokale Flag `reviewable` (Z. 42) als Sichtbarkeitsquelle ablösen
- [X] T029 [US2] Rückfragen destruktiver Aktionen um den Hinweis auf den Abbruch laufender Arbeit erweitern, gesteuert über `verdict.confirmAbortsWork`: Archivieren-Dialog in `packages/web/src/components/KanbanBoard.tsx` (ca. Z. 375) und Lösch-Dialog in `packages/web/src/components/FeatureConsole.tsx` (ca. Z. 108); beide Aktionen bleiben in jedem Zustand auslösbar (FR-008/FR-017)
- [X] T030 [US2] Doppelauslösung über `useAction` aus `FeatureAction.tsx` absichern und die Notlösung `if (/läuft bereits/i.test(e.message)) return;` ersatzlos entfernen: `packages/web/src/components/KanbanBoard.tsx` (Z. 75 und Z. 191) sowie `packages/web/src/components/FeatureConsole.tsx` (Z. 225) — FR-010, research D7
- [X] T031 [US2] Sicherstellen, dass betrachtende Bedienelemente **nicht** über `ActionButton` laufen und damit nie gesperrt werden (Review-Portal öffnen, Ergebnis-/Artefakt-Ansicht, Diff und Historie, Datei im Editor öffnen, Pfad kopieren, Kommentare erfassen, Prompt an die laufende Session) — betroffen sind `packages/web/src/components/FeatureConsole.tsx`, `KanbanBoard.tsx`, `ReviewPortal.tsx` und `ReviewOverview.tsx` (FR-007)

### Tests for User Story 2

- [X] T032 [US2] `packages/server/src/api/server.test.ts` um je einen Ablehnungstest pro bewachter Route bei beschäftigtem Feature erweitern (laufender Schritt, arbeitende Session, laufendes Gate, aktive Integrationsstufe) und um eine Gegenprobe nach FR-011, dass ein beschäftigtes Feature A die Routen von Feature B nicht beeinflusst

**Checkpoint**: US2 ist eigenständig prüfbar — Szenario 3 und Szenario 9 aus quickstart.md laufen durch.

---

## Phase 5: User Story 3 - Genau ein Standardweg in die Anwendung (Priority: P1)

**Goal**: Die Integrations-Pipeline ist der einzige Weg in den Endzustand „abgeschlossen". Die beiden Abkürzungen („Als abgeschlossen markieren", Kartenzug auf eine Schritt-Spalte) verschwinden ersatzlos, Archivieren steht dafür überall bereit, die Wiederaufnahme-Aktion erscheint an allen drei Stellen gleich, die Review-Übersicht kennzeichnet Vorschauen, und eine Zurückweisung setzt den letzten Schritt sichtbar zurück.

**Independent Test**: Für ein Feature alle Oberflächen durchgehen und die auslösbaren Wege nach „abgeschlossen" zählen — genau einer. `POST /api/features/<ID>/mark-done` und `POST /api/features/<ID>/advance` antworten mit 404. Eine Karte mit mehreren offenen Schritten auf eine spätere Schritt-Spalte ziehen: kein Drop, keine Freigabe, kein Start. Ein Feature bis `awaiting_human_review` bringen, zurückweisen und prüfen: Karte zurück in der Entwicklungs-Spalte, letzter Schritt auf „wartet auf Freigabe", Hinweis sichtbar (auch nach Server-Neustart), keine automatische Integration; nach erneuter Freigabe beginnt die Pipeline von vorn.

### Implementation for User Story 3

- [X] T033 [P] [US3] Feld `reviewRejectedAt: number | null` zum `Feature`-DTO in `packages/shared/src/types.ts` ergänzen (contracts/http-api.md §5)
- [X] T034 [US3] Neuen Eintrag am Ende des `MIGRATIONS`-Arrays in `packages/server/src/db/database.ts` ergänzen: `ALTER TABLE features ADD COLUMN review_rejected_at INTEGER` (append-only, `user_version`-gesteuert; Bestandszeilen bleiben `NULL`)
- [X] T035 [US3] In `packages/server/src/db/repos.ts` `review_rejected_at` in `FeatureRow` und `toFeature` abbilden und den Setter `setReviewRejected(featureId, ts: number | null)` ergänzen
- [X] T036 [P] [US3] Pure Funktion `reopenLastPhase(phases: PhaseMap): PhaseTransition` in `packages/shared/src/phaseMachine.ts` ergänzen: setzt den letzten **aktiven** Schritt auf `awaiting_review` und gibt eine **leere** Effektliste zurück (FR-021, research D4)
- [X] T037 [US3] `packages/shared/src/phaseMachine.test.ts` um Tests zu `reopenLastPhase` erweitern: es trifft den letzten aktiven Schritt (auch bei abgeschalteten optionalen Schritten), erzeugt keine Effekte und lässt vorgelagerte Schritte unverändert
- [X] T038 [US3] Route `POST /api/features/:id/reject-review` in `packages/server/src/api/server.ts` (ca. Z. 605) erweitern: zusätzlich zum bestehenden `setIntegration('none')` / `setIntegrationTarget(null)` das Ergebnis von `reopenLastPhase(feature.phases)` speichern und `setReviewRejected(id, Date.now())` setzen — ohne Auto-Progress und ohne automatischen Integrationsstart; `feature_updated` wie bisher emittieren (FR-020/FR-021/FR-026)
- [X] T039 [US3] Route `POST /api/features/:id/phases/:phase/approve` in `packages/server/src/api/server.ts` erweitern: ist `feature.reviewRejectedAt !== null` und der freigegebene Schritt der letzte aktive, `setReviewRejected(id, null)` setzen; der weitere Weg bleibt unverändert
- [X] T040 [US3] „Als abgeschlossen markieren" vollständig entfernen: Route `POST /api/features/:id/mark-done` in `packages/server/src/api/server.ts` (Z. 549), `markDone` in `packages/web/src/api.ts` (Z. 170) und der Menüeintrag in `packages/web/src/components/KanbanBoard.tsx` (Z. 299–303) — ersatzlos, ohne Kompatibilitätshülle (FR-016)
- [X] T041 [US3] „advance" vollständig entfernen: Route `POST /api/features/:id/advance` in `packages/server/src/api/server.ts` (Z. 509–510), `advance` in `packages/web/src/api.ts` (Z. 162) und `Orchestrator.advanceTo()` in `packages/server/src/services/orchestrator.ts` (Z. 474) samt dem darauf verweisenden Kommentar (Z. 443) — ersatzlos (FR-029)
- [X] T042 [US3] Schritt-Spalten in `packages/web/src/components/KanbanBoard.tsx` als Drop-Ziel entfernen: `onDragOver`/`onDrop` nur noch für die Integrations-Spalte, keine Drop-Markierung und keine Sammel-Freigabe mehr (contracts/action-policy.md §5)
- [X] T043 [US3] „🗄 Archivieren" in `packages/web/src/components/KanbanBoard.tsx` (ca. Z. 369) über `evaluateAction('archive', ctx)` für jedes nicht archivierte Feature anbieten (nicht mehr nur in der Done-Spalte) und als Aufräumen statt als Abschluss beschriften (FR-017)
- [X] T044 [US3] „↻ Erneut" an allen drei Stellen über `evaluateAction('integration_retry', ctx)` rendern, sodass alle drei Fehlerstufen (`verify_failed`, `gate_failed`, `conflict_escalated`) überall gleich behandelt werden: `packages/web/src/components/KanbanBoard.tsx` (Z. 350), `ReviewOverview.tsx` (Z. 105) und `ReviewPortal.tsx` (Z. 334) — FR-015
- [X] T045 [US3] Vorschau kennzeichnen (FR-019): in `packages/web/src/components/ReviewOverview.tsx` Zeilen mit `stage === 'none'` als „Vorschau" markieren und die Schaltfläche (Z. 189) auf „Vorschau öffnen" umbenennen; in `packages/web/src/components/ReviewPortal.tsx` den Fußtext (Z. 330) für diese Stufe auf „Vorschau — dieses Feature ist noch nicht in der Integration." ändern
- [X] T046 [US3] Hinweis „↩ im Review zurückgewiesen" aus `feature.reviewRejectedAt` in `packages/web/src/components/KanbanBoard.tsx` (Karte) und `packages/web/src/components/FeatureConsole.tsx` (Kopfzeile) anzeigen, solange das Feld gesetzt ist

### Tests for User Story 3

- [X] T047 [US3] `packages/server/src/api/server.test.ts` erweitern: `POST /api/features/:id/mark-done` und `POST /api/features/:id/advance` antworten mit 404; `reject-review` setzt Integrationsstufe auf `none`, den letzten Schritt auf `awaiting_review` und `reviewRejectedAt` auf einen Zeitstempel, ohne einen Integrationsstart auszulösen (auch bei aktivem `autoVerify`); die erneute Freigabe des letzten Schritts löscht `reviewRejectedAt`

**Checkpoint**: US3 ist eigenständig prüfbar — Szenarien 4 und 6 aus quickstart.md laufen durch.

---

## Phase 6: User Story 4 - Erkennen, warum etwas nicht geht (Priority: P2)

**Goal**: Grundsätzlich sinnlose Aktionen werden ausgeblendet, gerade blockierte bleiben sichtbar und nennen den Grund ohne Hover — per Tastatur, Screenreader und auf Touch erreichbar; alle Ansichten zeigen dieselbe Menge und aktualisieren sich ohne Neuladen.

**Independent Test**: Ein Feature durch alle Zustände führen (in Arbeit → fertig → `verifying` → `awaiting_human_review` → `verify_failed` → `merged`) und dabei Board, Feature-Konsole und Review-Übersicht parallel geöffnet halten: an jeder Stelle nennt jede gesperrte Schaltfläche einen Grund, keine Schaltfläche fehlt ohne erkennbaren Grund, und alle drei Ansichten zeigen dieselbe Menge erlaubter Aktionen ohne Neuladen.

### Implementation for User Story 4

- [X] T048 [US4] Durchgang durch `packages/web/src/components/KanbanBoard.tsx`, `FeatureConsole.tsx`, `ReviewOverview.tsx` und `ReviewPortal.tsx`: jede verbliebene lokale Sichtbarkeits- oder Sperrbedingung für eine der neun Aktionen entfernen, sodass ausschließlich der Befund aus `evaluateAction` gerendert wird (FR-014/FR-022, SC-004)
- [X] T049 [US4] `title`-Attribute, die einen Sperrgrund transportieren, in denselben vier Komponenten entfernen; der Grund erscheint stattdessen dauerhaft als Satz der `ActionGroup` (FR-028, research D6)
- [X] T050 [US4] In `packages/web/src/components/FeatureAction.tsx` verifizieren und ergänzen, dass gesperrte Schaltflächen `aria-disabled="true"` (kein natives `disabled`) tragen, in der Tabulator-Reihenfolge bleiben und per `aria-describedby` auf das Grund-Element zeigen (SC-006)
- [X] T051 [US4] In `packages/web/src/store.tsx` sicherstellen, dass der Kontext-Selector aus T012/T015 auf die Ereignisse `feature_updated`, `session_status` und `agent_gate` reagiert, sodass Sichtbarkeit und Sperrung ohne Neuladen nachziehen (FR-023)

### Tests for User Story 4

- [X] T052 [US4] `packages/shared/src/actionPolicy.test.ts` um die Unterscheidung der Darstellungsregeln erweitern: für jede der neun Aktionen mindestens ein `hidden`-Fall (grundsätzlich sinnlos) und ein `blocked`-Fall (gerade verhindert), jeweils mit geprüftem Grundsatz

**Checkpoint**: US4 ist eigenständig prüfbar — Szenarien 7 und 8 aus quickstart.md laufen durch.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T053 `pnpm typecheck && pnpm test` im Repo-Root ausführen; der Typecheck belegt zugleich, dass `STAGE_CLASS` vollständig ist und dass `api.markDone`, `api.advance` und `Orchestrator.advanceTo` restlos verschwunden sind
- [X] T054 Verbliebene tote Importe und ungenutzte Helfer entfernen, die durch T040/T041/T042 aufgehört haben, Aufrufer zu haben (`packages/web/src/api.ts`, `packages/web/src/components/KanbanBoard.tsx`, `packages/server/src/api/server.ts`, `packages/server/src/services/orchestrator.ts`)
- [X] T055 Szenarien 1–9 aus `specs/integrieren-button-entfernen/quickstart.md` gegen die laufende Anwendung (`pnpm dev`) manuell durchgehen und Abweichungen festhalten
- [X] T056 Abnahme-Checkliste aus `specs/integrieren-button-entfernen/quickstart.md` abhaken: SC-001 bis SC-008 je mit dem dort genannten Nachweis belegen

---

## Validierungsprotokoll (T055/T056)

Geprüft am 26.07.2026 gegen eine **isolierte** Toolkit-Instanz (eigener `SDD_DATA_DIR`,
Ports 4899/4831 — die laufende Instanz auf 4820 blieb unberührt) mit einem eigens
angelegten Git-Projekt und Feature.

| Szenario | Nachweis |
|---|---|
| 1 — Integrieren erst, wenn fertig | Live: in der Schrittleiste fehlt „⇥ Integrieren" bei offenen Schritten und erscheint, sobald alle freigegeben sind. Zusätzlich `actionPolicy.test.ts` (SC-001 über alle Zwischenzustände). |
| 2 — Kein Weg vorbei | Live: `POST /integrate` → 409 „Erst integrierbar, wenn alle aktiven Schritte freigegeben sind."; `git status --porcelain` leer und `git log -1` unverändert **nach** der Ablehnung. |
| 3 — Keine Aktionen während der Arbeit | Live: gesperrte Schaltflächen sichtbar, Grundsatz dauerhaft darunter; im Browser geprüft: kein natives `disabled`, `aria-disabled="true"`, fokussierbar, `aria-describedby` → Grundsatz, Klick wirkungslos. Alle vier Beschäftigt-Quellen je bewachter Route in `server.test.ts`. |
| 4 — Genau ein Standardweg | Live: `mark-done` und `advance` → 404; „🗄 Aufräumen (archivieren)" steht auch am nie integrierten Feature. Schritt-Spalten sind im Code kein Drop-Ziel mehr (kein `onDragOver`/`onDrop`). |
| 5 — Fertig, aber änderungsfrei | Live: `integration-readiness` → `{"hasChanges":false}`, `POST /integrate` → 409 „Keine Änderungen zu integrieren.", Stufe bleibt `none` (kein Rutsch auf `merged` über `reconcile()`). |
| 6 — Zurückweisung im Review | Live vollständig: Stufe → `none`, Ziel → null, letzter Schritt → `awaiting_review`, `reviewRejectedAt` gesetzt, kein Auto-Start; erneute Freigabe löscht den Marker. Hinweis „↩ im Review zurückgewiesen" auf Karte und in der Kopfzeile sichtbar. |
| 7 — Gleiches Bild überall | Live: Review-Übersicht kennzeichnet „VORSCHAU" und beschriftet „Vorschau öffnen"; das Portal zeigt „Vorschau — dieses Feature ist noch nicht in der Integration." statt der technischen Zustandsmeldung. Gleichheit der drei Ansichten ist strukturell erzwungen (eine Policy, keine lokale Bedingung mehr). |
| 8 — Doppelklick | Nicht live geklickt. Abgesichert durch `useAction` (`inFlight`-Referenz je Aktion) in `FeatureAction.tsx`; der frühere Fehlertext-Filter `/läuft bereits/i` ist restlos entfernt. |
| 9 — Destruktive Aktionen bei laufender Arbeit | Nicht live geklickt. Der Rückfragetext hängt an `verdict.confirmAbortsWork`; dessen Verhalten ist in `actionPolicy.test.ts` je Zustand geprüft. |

**Abweichung/Nachtrag**: Der Live-Durchgang hat eine Fehlabbildung aufgedeckt — die
Selbstheilung in `reconcile()` (Branch bereits gemergt, Worktree defekt) liefert
`{ started: false }` **ohne** Grund und wurde zunächst als generischer 409 gemeldet.
Nur die drei Vorprüfungen tragen einen Grund und sind echte Ablehnungen; die
Selbstheilung meldet sich über die Inbox. Die Route unterscheidet das jetzt
(Regressionstest: „behandelt die Selbstheilung (kein Grund) nicht als Ablehnung").

Szenarien, die einen echten Agentenlauf brauchen (Schritt starten → Artefakt →
Freigabe), wurden über direkt gesetzte Zustände nachgestellt; die Phasenläufe selbst
sind nicht Gegenstand dieses Features.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten
- **Foundational (Phase 2)**: nach Setup — **blockiert alle User Stories**
- **US1 (Phase 3)**: nach Phase 2
- **US2 (Phase 4)**: nach Phase 2
- **US3 (Phase 5)**: nach Phase 2
- **US4 (Phase 6)**: nach Phase 2; setzt fachlich voraus, dass die Oberflächen bereits auf die Policy umgestellt sind (US1–US3), da sie deren Ergebnis prüft und nachschärft
- **Polish (Phase 7)**: nach allen gewünschten Stories

### User Story Dependencies

- **US1 (P1)**: unabhängig nach Phase 2 umsetzbar
- **US2 (P1)**: unabhängig nach Phase 2 umsetzbar; berührt andere Bedienelemente als US1 und ist getrennt prüfbar
- **US3 (P1)**: unabhängig nach Phase 2 umsetzbar; einzige Story mit Schema-Änderung (T033–T035 vor T038)
- **US4 (P2)**: prüft und schärft die Darstellung der drei P1-Stories — sinnvoll erst danach

### Within Each User Story

- Innerhalb von `actionPolicy.ts` gilt: T002 → T003 → T004 → T005 → T006 (eine Datei, aufeinander aufbauend)
- US1: T013 → T014/T015 (Datenweg) · T016 → T017 → T018 (Server) · T019/T020/T021 (Oberflächen) · Tests T022/T023 zuletzt
- US3: T033 → T034 → T035 (Persistenz) vor T038/T039; T036 → T037 vor T038
- Test-Tasks folgen der jeweiligen Implementierung derselben Story

### Parallel Opportunities

- **Phase 2**: T007, T008 und T011 laufen parallel, sobald T002–T005 stehen (drei verschiedene Pakete)
- **Phase 3**: T014 parallel zu T013; T019, T020 und T021 berühren zwei Dateien und laufen nacheinander innerhalb von `KanbanBoard.tsx`, aber parallel zu den Server-Tasks T016–T018
- **Phase 5**: T033 (shared/types.ts) und T036 (shared/phaseMachine.ts) parallel; T040 und T041 betreffen dieselben drei Dateien und laufen nacheinander
- **Stories**: US1, US2 und US3 können nach Phase 2 von drei Personen parallel bearbeitet werden — Konfliktpunkte sind nur `server.ts` und `KanbanBoard.tsx`

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Nach Abschluss von T002–T006 gleichzeitig startbar:
Task: "export * from './actionPolicy.js' in packages/shared/src/index.ts"          # T007
Task: "isGateRunning() in packages/server/src/services/orchestrator.ts"            # T008
Task: "FeatureAction.tsx in packages/web/src/components/ anlegen"                  # T011
```

## Parallel Example: User Story 3

```bash
# Zwei unabhängige Shared-Dateien gleichzeitig:
Task: "Feature.reviewRejectedAt in packages/shared/src/types.ts"                   # T033
Task: "reopenLastPhase() in packages/shared/src/phaseMachine.ts"                   # T036
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup (T001)
2. Phase 2: Foundational (T002–T012) — **blockierend**
3. Phase 3: User Story 1 (T013–T023)
4. **STOP und VALIDIEREN**: Szenarien 1, 2 und 5 aus quickstart.md
5. Damit ist die ausdrücklich gemeldete Fehlbedienung behoben: kein Integrationsstart mehr an einem unfertigen Feature, über keinen Bedienweg

### Incremental Delivery

1. Setup + Foundational → die gemeinsame Festlegung steht und ist getestet
2. + US1 → Integration nur noch bei fertigen Features (MVP)
3. + US2 → keine Aktion mehr während laufender Arbeit
4. + US3 → genau ein Standardweg; Abkürzungen entfernt, Zurückweisung setzt zurück
5. + US4 → Begründungen und Gleichheit aller Ansichten nachgeschärft
6. Polish → Typecheck, Quickstart, Abnahme-Checkliste

### Parallel Team Strategy

1. Phase 1 + Phase 2 gemeinsam abschließen (die Policy ist die Grundlage aller weiteren Arbeit)
2. Danach:
   - Person A: US1 (Integrationsbedingung + Bereitschaft)
   - Person B: US2 (Sperren während laufender Arbeit)
   - Person C: US3 (Standardweg, Entfernungen, Zurückweisung)
3. US4 anschließend gemeinsam als Durchgang über alle vier Oberflächen

---

## Notes

- **[P]** = andere Datei, keine offene Abhängigkeit
- Die Web-Komponenten dürfen **keine** eigene Bedingung mehr enthalten — jede Abweichung von `evaluateAction` ist ein Fehler, kein Gestaltungsspielraum (FR-022/SC-004)
- Sperrgründe sind wortgleich in UI und HTTP-Antwort; die Texte stehen ausschließlich in `packages/shared/src/actionPolicy.ts` (contracts/action-policy.md §2)
- Entfernungen (T040/T041) erfolgen ersatzlos, ohne Rückwärtskompatibilitäts-Hülle
- Nach jedem Task oder jeder logischen Gruppe committen
- An jedem Checkpoint kann angehalten und die Story eigenständig geprüft werden
