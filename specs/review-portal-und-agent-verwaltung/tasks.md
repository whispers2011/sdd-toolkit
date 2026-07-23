# Tasks: Review-Portal & Agent-Verwaltung

**Input**: Design documents from `specs/review-portal-und-agent-verwaltung/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests sind Teil der Repo-Konvention für pure Module, Repos und Services
(vitest). UI-Komponenten ohne eigene Unit-Tests (bestehende Konvention); Validierung über
quickstart.md-Flows.

**Organization**: Nach User Story (US1–US9 aus spec.md). Foundational (Phase 2) folgt der
verbindlichen Umsetzungsreihenfolge aus plan.md: Shared → DB → AgentGateService-Parität.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Feature-Branch `feature/review-portal-und-agent-verwaltung` von `main` erstellen; bestehende uncommittete Fremdänderungen auf main unangetastet lassen (nicht stashen, nicht committen)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared-Typen, pure Module, beide Migrationen, Repos und der 1:1-Ersatz des
reviewGateService — danach verhält sich das System exakt wie heute (Paritäts-Checkpoint),
und alle Stories können unabhängig aufsetzen.

- [X] T002 Shared-Typen in `packages/shared/src/types.ts`: `AgentTriggerKind`, `AgentTrigger`, `AgentDefinition`, `AgentFeatureDecision`, `AgentRunSummary`, `ReviewComment`, `ReviewOverviewItem`, `BranchInfo`, `ApproveMergeRequest`; `AttentionKind` um `'phase_gate_failed' | 'approval_required'` erweitern (Signaturen aus data-model.md)
- [X] T003 [P] `packages/shared/src/diffParse.ts` + `diffParse.test.ts`: `parseUnifiedDiff()` → Dateien/Hunks/Zeilen mit oldNo/newNo (Basis für Diff-Renderer und Kommentar-Anker)
- [X] T004 [P] `packages/shared/src/branchSuggest.ts` + `branchSuggest.test.ts`: `suggestBranchName()` (`integration/<slug>` mit Kollisions-Suffix), `isValidBranchName()` (check-ref-format-Subset)
- [X] T005 [P] `packages/shared/src/reviewPrompt.ts` + `reviewPrompt.test.ts`: `compileReviewPrompt(offeneKommentare, freitext)` → strukturierter deutscher Arbeitsauftrag
- [X] T006 [P] `packages/shared/src/agentSelect.ts` + `agentSelect.test.ts`: `resolveAgentsForTrigger()` (Trigger-Match, exclude schlägt alles, include erzwingt disabled, sonst enabled) + Parser `parseVerdict` (aus reviewGateService übernehmen), `parseDecisionLabel`, `extractSummary` (ZUSAMMENFASSUNG:-Zeile sonst erster Absatz ≤ 300 Zeichen), `parseApprovalItems` (FREIGABE ERFORDERLICH:-Zeilen)
- [X] T007 Migration B in `packages/server/src/db/database.ts`: `personas` RENAME TO `agents` + Spalten description/model/trigger_kind/trigger_phase/blocking; Tabellen `agent_feature_selection`, `agent_runs` + Index; descriptions für `default-code-review`/`default-security-review` (SQL aus data-model.md; VOR Migration A einreihen)
- [X] T008 Migration A in `packages/server/src/db/database.ts`: Tabelle `review_comments` + Index; `features.integration_target`; `merge_queue.force_verify` (nach Migration B)
- [X] T009 [P] `packages/server/src/db/agentRepo.ts` (neu) + `agentRepo.test.ts`: `AgentRepo` (list, forProject = **Union** global ∪ Projekt, get, upsert, remove, listSelection/setSelection/clearSelection) + `AgentRunRepo` (start, finish, listForFeature, latestPerAgent); Tests via openMemoryDatabase
- [X] T010 [P] `packages/server/src/db/repos.ts` + Tests: PersonaRepo ENTFERNEN; `ReviewCommentRepo` (Muster AttentionRepo); `FeatureRepo.setIntegrationTarget`; `QueueRepo.enqueue(opts.forceVerify)`
- [X] T011 `packages/server/src/services/agentGateService.ts` (neu) + `agentGateService.test.ts`: ersetzt reviewGateService 1:1 (Worktree-Guard als throw, {reviewFile}-Platzhalter, buildHeadlessArgv, loginShellEnv, 20-min-SIGKILL, meter(), executions kind='review') PLUS: `model` → `buildHeadlessArgv(prompt, {model})`, agent_runs start/finish, executions.phase = trigger_phase, blocking-FAIL stoppt Gate / advisory-FAIL wird nur verbucht, Parser aus `agentSelect.ts`; API `hasAgentsFor`, `runTrigger(feature, project, trigger)`, `runAgent(agentId, …)`; Runner injizierbar für Tests (Reihenfolge, blocking-Stopp, advisory-Weiterlauf, model→argv, Worktree-Guard)
- [X] T012 `packages/server/src/services/reviewGateService.ts` LÖSCHEN; Aufrufer umverdrahten: `packages/server/src/services/mergeQueueService.ts` (runTrigger review_gate) + `packages/server/src/index.ts` (Wiring); `pnpm -r typecheck && pnpm -r test` grün

**Checkpoint**: Verhalten identisch zu heute (review_gate-Parität, Alt-Personas laufen);
phaseMachine.test.ts unverändert grün; `grep -rn PersonaRepo packages/` leer.

---

## Phase 3: User Story 1 - Integrationsbereite Features prüfen und freigeben (P1) 🎯 MVP

**Goal**: Review-Übersicht als Top-Level-View + Portal-Rework (Diff mit Zeilennummern,
Historie, Freigeben/Zurückweisen).

**Independent Test**: Feature in `awaiting_human_review` bringen → Review-Tab zeigt es;
Portal öffnen, Diff + Historie sichten, einmal zurückweisen, einmal freigeben (quickstart e1).

- [ ] T013 [US1] `packages/server/src/api/reviewRoutes.ts` (neu) mit `GET /api/review/overview?projectId=` (Stages awaiting_human_review/verify_failed/gate_failed/conflict_escalated; numstat-Kennzahlen, Audit-Zähler aus agent_runs, offene Kommentare, Verify-Status) und Einhängen in `packages/server/src/api/server.ts` / `index.ts`
- [ ] T014 [P] [US1] `packages/web/src/api.ts`: `reviewOverview(projectId)`
- [ ] T015 [US1] `packages/web/src/store.tsx`: View `'review'`; `packages/web/src/App.tsx`: Nav-Tab „Review" mit Badge (# awaiting_human_review im aktiven Projekt)
- [ ] T016 [US1] `packages/web/src/components/ReviewOverview.tsx` (neu): Abschnitte „Bereit zum Review" / „Braucht Eingriff" (mit ↻ retry-integration-Aktion), Klick öffnet Portal
- [ ] T017 [US1] `packages/web/src/components/review/DiffViewer.tsx` (neu): Renderer auf `parseUnifiedDiff` mit alt/neu-Zeilennummern und vorbereitetem Kommentar-Gutter
- [ ] T018 [US1] `packages/web/src/components/ReviewPortal.tsx` Rework: 3-Spalten-Layout, Header-Kennzahlen (Dateien/Zeilen, Audit-Stand, Verify-Status), linke Tabs Dateien/Historie, Mitte DiffViewer bzw. bestehende Konfliktauflösungs-Ansicht, Footer Freigeben/Zurückweisen (Ziel vorerst Default-Branch); Öffnung aus ReviewOverview UND Kanban-Karte wie bisher

**Checkpoint**: US1 komplett — Review über Übersicht + Portal ohne Kommentare/Editor/Zielwahl.

---

## Phase 4: User Story 2 - Integrationsziel wählen (P1)

**Goal**: Freigabe in bestehenden ODER neuen Branch (Namensvorschlag, Validierung);
Default-Pfad byte-identisch; Haupt-Checkout wird nie umgeschaltet.

**Independent Test**: Freigabe in neuen Branch → Feature-Commits im Ziel, `main` und
Haupt-Checkout unberührt, Done-Badge „→ <ziel>" (quickstart e5, h).

- [ ] T019 [US2] `packages/server/src/git/mergeEngine.ts` + `mergeEngine.test.ts`: `rebaseOntoDefault` → `rebaseOnto(worktreePath, ontoBranch)`; `ensureBranch(projectPath, name, base)` (idempotent, kein Checkout); `isBranchMerged` gegen Ziel; `mergeIntoTarget({projectPath, branch, target, mode, message, tmpWorktreeDir})` — Fall A: Ziel im Haupt-Checkout = heutiger Pfad; Fall B: ephemerer `git worktree add <dataDir>/merge-tmp/<id>` → ff/squash → remove (finally, prune bei Fehler); Ziel in fremdem Worktree → sauberer Fehler
- [ ] T020 [US2] `packages/server/src/services/mergeQueueService.ts`: überall `target = feature.integrationTarget ?? project.defaultBranch`; processItem: rebase auf target (falls existiert, sonst defaultBranch), `ensureBranch` vor Merge, `mergeIntoTarget`, Notification `feature → target`; createPullRequest: bei lokal neuem Ziel `git push -u origin <target>` dann `--base <target>`; Self-Heal (reconcile/finalizeMerged/cleanupMerged/reconcileMergedLeftovers) gegen integrationTarget, extern gelöschtes Ziel → safeOnly-Skip mit Warnung; reject-review setzt integration_target := NULL
- [ ] T021 [US2] `approveForMerge(id, ApproveMergeRequest)` (wird async) + Tests in `mergeQueueService.test.ts`: Guard awaiting_human_review; Validierung (isValidBranchName; createBranch ⇒ darf nicht existieren; sonst ⇒ muss existieren und ≠ feature.branch); setIntegrationTarget (NULL wenn == defaultBranch); enqueue; attention resolve; `POST /api/features/:id/approve-merge` in `server.ts` nimmt Body entgegen
- [ ] T022 [US2] `GET /api/projects/:id/branches` (git for-each-ref, BranchInfo[]) in `packages/server/src/api/reviewRoutes.ts`
- [ ] T023 [P] [US2] `packages/web/src/api.ts`: `branches(projectId)`, `approveMerge(featureId, body)`
- [ ] T024 [US2] `packages/web/src/components/review/MergeTargetChooser.tsx` (neu): Radio bestehend/neu, Branch-Combobox, Namens-Input mit `suggestBranchName`-Vorschlag + Live-Validierung; Einbau in ReviewPortal-Footer
- [ ] T025 [P] [US2] `packages/web/src/components/KanbanBoard.tsx`: Done-Badge „→ <ziel>" wenn integrationTarget ≠ defaultBranch

**Checkpoint**: US1+US2 — vollständige Integrations-Entscheidung im Portal.

---

## Phase 5: User Story 6 - Agents verwalten (P1)

**Goal**: Verwaltungs-UI für Agents (CRUD, Trigger, blocking, Modell, global/Projekt).

**Independent Test**: Projekt-Agent „nach Phase plan, blockierend" anlegen, listen,
bearbeiten, deaktivieren, löschen; Alt-Personas erscheinen als review_gate-Gates (quickstart
Stufe 2 Punkt 2).

- [ ] T026 [US6] Agents-Endpunkte in `packages/server/src/api/server.ts` (ersetzen Personas-Block Z.668-678): `GET /api/agents?projectId=`, `PUT /api/agents` (upsert, Validierung trigger_phase ⇔ trigger_kind), `DELETE /api/agents/:id`
- [ ] T027 [P] [US6] `packages/web/src/api.ts`: agents-CRUD-Methoden
- [ ] T028 [US6] `packages/web/src/store.tsx`: View `{kind:'agents', projectId}`; `packages/web/src/components/Sidebar.tsx`: Button „Agenten" pro Projekt (Muster Knowledge-Button Z.71-81)
- [ ] T029 [P] [US6] `packages/web/src/components/AgentsPanel.tsx` (neu, Vorbild KnowledgePanel): Abschnitte Global/Projekt; Zeile = Name, Trigger-Badge, Gate/Hinweis-Badge, Modell, letzter Verdict-Chip, Aktiv-Toggle, ↑↓-Umordnung, Edit, Delete
- [ ] T030 [P] [US6] `packages/web/src/components/AgentEditDialog.tsx` (neu): Name, Beschreibung, Prompt (Hinweis {reviewFile} + VERDICT-Pflicht), Modell (datalist Standard/haiku/sonnet/opus + Freitext), Trigger-Select + Phasen-Select, Blockierend-Toggle, Aktiv-Toggle, Scope Global/Projekt (nur Neuanlage)

**Checkpoint**: Alle P1-Stories fertig — sinnvolles Release möglich.

---

## Phase 6: User Story 3 - Kommentieren und strukturiert zurückweisen (P2)

**Goal**: Persistierte zeilen-/dateiverankerte Kommentare; Zurückweisung kompiliert sie zum
Arbeitsauftrag.

**Independent Test**: 2 Zeilen-Kommentare anlegen, Portal neu öffnen (persistent),
zurückweisen → Prompt enthält beide mit Datei/Zeile (quickstart e2, e4).

- [ ] T031 [US3] Comments-CRUD in `packages/server/src/api/reviewRoutes.ts` (`GET/POST /api/features/:id/comments`, `PATCH/DELETE /api/comments/:id`) + WS-Event `review_comments_updated` in `packages/server/src/api/events.ts` (Broadcast bei jeder Mutation)
- [ ] T032 [P] [US3] `packages/web/src/api.ts`: comments-CRUD; `packages/web/src/store.tsx`: WS-Case `review_comments_updated`
- [ ] T033 [US3] `packages/web/src/components/review/CommentsPanel.tsx` (neu) + Kommentar-Gutter im `DiffViewer.tsx` aktivieren: Anlegen an Zeile (side old/new) oder Datei, offen/erledigt, Anker-Sprung, Hinweis „Anker evtl. veraltet", VoiceButton wie in FeatureConsole
- [ ] T034 [US3] reject-review-Umbau in `packages/server/src/api/server.ts` + `mergeQueueService.ts`: offene Kommentare + Freitext via `compileReviewPrompt` → Prompt an Feature-Konsole; Kommentar-Vorschau im Zurückweisen-Dialog des Portals

**Checkpoint**: Zurückweisungen sind präzise und reproduzierbar.

---

## Phase 7: User Story 4 - Projektdateien einsehen und korrigieren (P2)

**Goal**: Dateibaum + Editor im Portal; Reviewer-Edits werden committet und erzwingen
Re-Verify.

**Independent Test**: Datei im Portal editieren/speichern, freigeben → Commit
`review(<name>): reviewer-korrekturen` existiert, Re-Verify lief vor Merge (quickstart e3, e5).

- [ ] T035 [US4] In `packages/server/src/api/reviewRoutes.ts`: `GET /api/features/:id/tree` (git ls-files -co --exclude-standard, 409 ohne Worktree), `GET /api/features/:id/file?path=` (Traversal-Guard, Binär-Erkennung, 2-MB-Limit), `PUT /api/features/:id/file` (nur awaiting_human_review, mtime-409-Protokoll nach featureArtifacts-Muster)
- [ ] T036 [P] [US4] `packages/web/src/api.ts`: `featureTree`, `featureFile`, `saveFeatureFile`
- [ ] T037 [US4] `packages/web/src/components/review/FileTreePane.tsx` + `FileEditor.tsx` (neu): Baum-Navigation, Monospace-Textarea, Markdown-Preview-Toggle (react-markdown), 409-Konfliktmeldung; Portal-Tab „Projektdateien"
- [ ] T038 [US4] Reviewer-Commit in `approveForMerge` (`packages/server/src/services/mergeQueueService.ts`): uncommittete Worktree-Änderungen → Commit `review(<name>): reviewer-korrekturen` ⇒ enqueue forceVerify=1; processItem: Re-Verify wenn `attempts>0 || forceVerify` (FAIL → verify_failed); Tests in `mergeQueueService.test.ts`

**Checkpoint**: Trivial-Korrekturen ohne Zurückweisungs-Schleife.

---

## Phase 8: User Story 5 - Test- und Audit-Ergebnisse im Portal (P2)

**Goal**: Verify-Dashboard + Audit-Sidebar (agent_runs-first, Markdown-Fallback).

**Independent Test**: Feature mit Verify-Lauf + Agent-Lauf → TestsPane zeigt Status/Logs/
Kosten, AuditSidebar zeigt Verdict + öffenbaren Bericht; Alt-Feature zeigt
Vor-Migrations-Reviews (quickstart f, Stufe 2 Punkt 3).

- [ ] T039 [US5] In `packages/server/src/api/reviewRoutes.ts`: `GET /api/features/:id/agent-runs` (AgentRunSummary[] + costUsd/totalTokens via executions-Join; Markdown-Fallback `specs/<f>/reviews/*.md` + parseVerdict für Vor-Migrations-Features, `source:'markdown'`) und `GET /api/features/:id/agent-runs/:runId/report`
- [ ] T040 [P] [US5] `packages/web/src/api.ts`: `agentRuns`, `agentRunReport`
- [ ] T041 [US5] `packages/web/src/components/review/TestsPane.tsx` (neu): Verify-Executions als Dashboard (Status/Dauer/Exit-Code/Log-Viewer + Token/Kosten, charts.tsx-Bausteine); Portal-Tab „Tests"
- [ ] T042 [US5] `packages/web/src/components/review/AuditSidebar.tsx` (neu): Gruppierung nach Trigger, SVG-Progress-Ring bestanden/gesamt, Verdict-Pills, decision_label, Summary, Kosten, Bericht-Dialog; rechte Portal-Spalte + Header-Kennzahlen aus echten Daten

**Checkpoint**: Entscheidungsgrundlage vollständig im Portal.

---

## Phase 9: User Story 7 - Automatische Qualitäts-Gates im Lebenszyklus (P2)

**Goal**: after_phase/before_phase-Trigger im Orchestrator (phaseMachine UNVERÄNDERT),
neue AttentionKinds, agent_gate-Event, Inbox-Aktionen.

**Independent Test**: Agent „nach plan, blockierend" → FAIL stoppt Auto-Progress + Inbox-
Eintrag, manuelles Approve geht; „vor implement" → Start deferrt bis PASS (quickstart a–c, i).

- [ ] T043 [US7] `packages/server/src/services/attentionReconciler.ts`: Defaults/Verhalten für `phase_gate_failed` + `approval_required` (NICHT an STAGE_FOR_KIND koppeln); Tests
- [ ] T044 [US7] after_phase-Hook in `packages/server/src/services/orchestrator.ts` `handleTurnCompleted` (nach finishPhase/savePhases, VOR Auto-Progress): `agentGate.runTrigger({kind:'after_phase', phase})`; blockierender FAIL ⇒ Phase bleibt awaiting_review, Attention `phase_gate_failed`, kein Auto-Approve; Human-Override via manuellem Approve; Approve/Discard/Neustart ⇒ `attention.resolveFor` beider neuer Kinds; approval_required-Items aus `parseApprovalItems` ⇒ Attention mit Thema + Berichts-Pfad (auch bei PASS)
- [ ] T045 [US7] before_phase-Deferral in `orchestrator.ts`: `startPhaseRun(..., {skipGates})` — Gates vorhanden && !skipGates ⇒ Start deferren (Phase bleibt idle), runningGates-Map gegen Doppelstart, async Gate → PASS ⇒ `startPhaseRun({skipGates:true})`, FAIL ⇒ Attention; Auto-Progress-Umleitung in `approve` per vorhandenem Effekt-Unterdrückungs-Muster (advanceTo); Bus-Event `agent_gate {featureId, projectId, trigger, status}` in `packages/server/src/api/events.ts`; HTTP-Antwort `{gateRunning:true}`
- [ ] T046 [US7] `packages/server/src/services/orchestrator.test.ts`: after_phase-FAIL blockiert Auto-Progress, before_phase deferrt/startet nach PASS, Human-Override, Attention-Resolve; `phaseMachine.test.ts` bleibt UNVERÄNDERT grün
- [ ] T047 [US7] Web: `packages/web/src/store.tsx` WS-Case `agent_gate` + gateRunning-Badge in `FeatureConsole.tsx`/`KanbanBoard.tsx`; `packages/web/src/components/AttentionInbox.tsx`: Aktionen für `phase_gate_failed` (Feature öffnen, manuell freigeben) und `approval_required` („Bericht öffnen" via api.openInEditor, „Erledigt", optional „Feedback an Agent senden" nach reject-review-Muster)

**Checkpoint**: Meeting-Beschlüsse 2+3 (Human-in-the-loop-Gates) funktionsfähig.

---

## Phase 10: User Story 8 - Per-Feature-Steuerung und manueller Lauf (P3)

**Goal**: Include/Exclude pro Feature + „Jetzt ausführen".

**Independent Test**: Global aktiven Agent per Feature ausschließen → läuft nicht;
manueller Lauf → 202 + Ergebnis; ohne Worktree → 409 (quickstart g).

- [ ] T048 [US8] In `packages/server/src/api/server.ts`: `GET /api/features/:id/agents` (effektiv + decision + lastRun via latestPerAgent), `PUT /api/features/:id/agents/selection` {agentId, decision include|exclude|auto}, `POST /api/features/:id/agents/:agentId/run` → 202 (agentGate.runAgent async), 409 ohne Worktree
- [ ] T049 [P] [US8] `packages/web/src/api.ts`: `featureAgents`, `setAgentSelection`, `runAgent`
- [ ] T050 [US8] `packages/web/src/components/FeatureAgentSelect.tsx` (neu, Klon FeatureKnowledgeSelect): effektive Agents mit Auto/Ein/Aus, letzter Lauf (Verdict/Summary/Kosten/Bericht), „Jetzt ausführen"; Button im `FeatureConsole.tsx`-Header

**Checkpoint**: Union-Semantik hat ihren Escape-Hatch.

---

## Phase 11: User Story 9 - Mitgelieferte Standard-Agents (P3)

**Goal**: Drei deutsche Seed-Definitionen in Migration B (VOR dem Migrations-Smoke ergänzen).

**Independent Test**: Frische Migration zeigt 5 globale Agents; DoR-Probelauf auf Feature
mit offenen Fragen ⇒ FAIL mit nummerierter Liste (quickstart Stufe 2, i).

- [ ] T051 [P] [US9] Seeds `default-dor-gate` (before_phase:implement, blocking; prüft spec/plan/tasks auf offene Fragen/[NEEDS CLARIFICATION]/unentschiedene Annahmen/prüfbare Akzeptanzkriterien; FAIL ⇒ nummerierte Fragenliste) und `default-doku-policy` (review_gate, advisory, sort_order 2; Meta-Kommentare/redundante DocBlocks/Ticketnummern-Historie im Diff; Regel: Rationale in Commit-Messages, git-Historie LESEN statt schreiben) als INSERTs in Migration B in `packages/server/src/db/database.ts`
- [ ] T052 [P] [US9] Seed `default-plan-quality` (after_phase:plan, blocking): `docs/solution-plan-quality-review.md` auf ~80–100 Zeilen eindampfen (Evidenz vor Vermutung, Qualitätsprofile, Mandatory Gates, Pattern-Suitability, adversarialer Gegencheck; Ausgabe GESAMTENTSCHEIDUNG/ZUSAMMENFASSUNG/FREIGABE ERFORDERLICH + VERDICT-Mapping FREIGEGEBEN [MIT ÄNDERUNGEN]→PASS, PLAN ÜBERARBEITEN→FAIL) und in Migration B einbetten

**Checkpoint**: Meeting-Beschlüsse 1–3 als Daten ausgeliefert.

---

## Phase 12: Polish & Verifikation

- [ ] T053 `pnpm -r typecheck && pnpm -r test` gesamt grün; `grep -rn "PersonaRepo" packages/` leer; `git diff --stat main -- packages/server/src/services/phaseMachine.ts` leer
- [ ] T054 Migrations-Smoke gegen KOPIE der Dev-DB (quickstart Stufe 2): Boot ohne Fehler, 5 globale Agents sichtbar, Alt-Personas als blockierende review_gate-Gates, Alt-Reviews via Markdown-Fallback
- [ ] T055 Manuelle End-to-End-Flows aus quickstart.md Stufe 3 (a)–(i) durchgehen und Abweichungen fixen

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2**: T001 zuerst. In Phase 2: T002 vor T003–T006 (Typen) und vor T009/T010; T007 vor T008 (Migrations-Reihenfolge B→A) und vor T009; T009+T010 vor T011; T011 vor T012.
- **Phase 2 blockiert ALLE Stories** (Paritäts-Checkpoint T012).
- **US1 (Phase 3)**: nur Foundational nötig. **US2 (Phase 4)**: unabhängig von US1-UI testbar (API-seitig), MergeTargetChooser (T024) baut in Portal-Footer aus T018 ein. **US6 (Phase 5)**: unabhängig.
- **US3 (Phase 6)**: braucht DiffViewer (T017) für Gutter. **US4 (Phase 7)**: T038 erweitert approveForMerge aus T021. **US5 (Phase 8)**: unabhängig (agent_runs existieren ab T011).
- **US7 (Phase 9)**: braucht nur Foundational; T047-Inbox-Berichtszugriff nutzt T039-Endpoint (sonst api.openInEditor-Fallback).
- **US8 (Phase 10)**: braucht T011 (runAgent). **US9 (Phase 11)**: editiert Migration B aus T007 — MUSS vor T054-Smoke liegen; DoR-Validierung braucht US7.
- **Polish (Phase 12)**: nach allen Stories; T051/T052 zwingend vor T054.

### Parallel Opportunities

- Phase 2: T003, T004, T005, T006 parallel (verschiedene shared-Dateien); T009 ∥ T010 (agentRepo.ts vs repos.ts).
- Nach T012: US1, US2 (API-Teil), US6 parallel; später US3/US4/US5/US7 weitgehend parallel (Konfliktpunkte: ReviewPortal.tsx bei T018/T024/T033/T037/T042 nacheinander; mergeQueueService.ts bei T020/T021/T034/T038 nacheinander; reviewRoutes.ts bei T013/T022/T031/T035/T039 nacheinander).
- api.ts-Tasks (T014, T023, T027, T032, T036, T040, T049) je [P] zu ihren Server-Tasks, untereinander aber sequenziell (gleiche Datei) — bei paralleler Bearbeitung zusammenfassen.
- T051 ∥ T052 (verschiedene Seed-Blöcke, gleiche Datei — koordinieren).

## Implementation Strategy

**MVP** = Phase 1–3 (US1): Review-Übersicht + Portal mit Diff/Historie/Approve/Reject auf
Default-Branch. **Release-Kandidat** = + Phase 4–5 (US2 Zielwahl, US6 Agent-Verwaltung).
Danach inkrementell US3→US4→US5→US7→US8→US9, jede Story einzeln validierbar
(Independent-Test-Kriterien oben), abschließend Phase 12.
