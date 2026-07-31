# Implementation Plan: Review-Portal & Agent-Verwaltung

**Branch**: `feature/review-portal-und-agent-verwaltung` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/review-portal-und-agent-verwaltung/spec.md`

**Note**: Dieser Plan übernimmt den im Vorfeld mit dem Nutzer abgestimmten, verbindlichen
technischen Plan (Exploration + Plan-Agent + AskUserQuestion-Entscheidungen). Alle
Leitentscheidungen sind in [research.md](./research.md) mit Begründung dokumentiert.

## Summary

Zwei zusammenhängende Ausbaustufen: **(A)** Ein vollwertiges Review-Portal (neue Top-Level-View
über alle integrationsnahen Features; pro Feature Diff mit Zeilennummern, Git-Historie,
Dateibrowser + Editor mit mtime-Konfliktschutz, Verify-Dashboard, Audit-Sidebar, persistierte
zeilenverankerte Kommentare, Branch-Zielwahl mit Namensvorschlag) und **(B)** die Generalisierung
der Review-Personas zu konfigurierbaren **Agents** (Trigger manual | review_gate | after_phase |
before_phase, blocking/advisory, Modellwahl, Union global∪Projekt, Per-Feature-Override,
strukturierte `agent_runs`-Ablage, Verwaltungs-UI, drei Seed-Agents: DoR-Gate,
Plan-Qualitätsreview, Doku-Policy).

Technischer Kern: `personas`→`agents`-Migration (RENAME + Spalten), neue Tabellen `agent_runs`,
`review_comments`, `agent_feature_selection`; `features.integration_target` +
`merge_queue.force_verify`; `AgentGateService` ersetzt `reviewGateService`;
Trigger-Verdrahtung im Orchestrator (OHNE Änderung an `phaseMachine.ts`);
`MergeEngine.mergeIntoTarget` mit ephemerem Worktree für Nicht-Default-Ziele;
neue `api/reviewRoutes.ts`; Web-Views „Review" und „Agenten".

## Technical Context

**Language/Version**: TypeScript 5.8, Node ≥ 22 (ESM), pnpm-10-Workspace

**Primary Dependencies**: better-sqlite3 12 (DB), React 19 (Web), node-pty (Phasen-Sessions),
`claude`-CLI (Headless-Agent-Läufe via `commandBuilder.ts`), vite/esbuild. Bewusst KEINE neuen
Dependencies (kein CodeMirror, keine Diff-Lib, keine Chart-Lib — vorhandene `charts.tsx` genügt).

**Storage**: SQLite (`packages/server/src/db/database.ts`, sequenzielle Migrationen im
`migrate()`-Block; `openMemoryDatabase()` für Tests)

**Testing**: vitest 3 (`pnpm -r test`), Typprüfung `pnpm -r typecheck`

**Target Platform**: lokaler Entwickler-Server (macOS/Linux), Web-UI im Browser, WS-Events

**Project Type**: pnpm-Monorepo: `packages/shared` (pure Typen/Funktionen),
`packages/server` (API + Services + git), `packages/web` (React-SPA)

**Performance Goals**: UI-Interaktionen < 200 ms gefühlt; Diff-/Tree-Endpunkte sind reine
git-Reads; sequentielle Gate-Läufe bewusst akzeptiert (kein Parallel-Scheduling in v1)

**Constraints**: Haupt-Checkout des Projekts darf NIE umgeschaltet werden (ephemerer Worktree
für Nicht-Default-Merges); `phaseMachine.ts` bleibt unverändert (pure Function + Tests);
Default-Merge-Pfad (autoMerge → defaultBranch) bleibt byte-identisch; Datei-Zugriffe im Portal
mit Pfad-Traversal-Guard, Binär-Erkennung, 2-MB-Limit; Editieren nur bei
`awaiting_human_review`; deutsche UI.

**Scale/Scope**: Einzelnutzer/Kleinteam; Dutzende Features pro Projekt, ≤ ~10 Agents,
Diffs bis einige hundert Dateien; keine Rechte-/Rollentrennung.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein unausgefülltes Template — es existiert keine
ratifizierte Projekt-Constitution. Ersatzweise gelten die etablierten Repo-Konventionen als
Gates, alle erfüllt:

- ✅ **Pure-Logik in shared, getestet**: diffParse, branchSuggest, reviewPrompt,
  resolveAgentsForTrigger, Verdict-Parser als pure Module mit vitest-Tests.
- ✅ **Keine neuen Runtime-Dependencies** ohne Not: bestätigt (0 neue Deps).
- ✅ **Bestehende Muster wiederverwenden**: Repos nach AttentionRepo-Muster, Selektion nach
  knowledge_feature_selection-Muster, Save-Konflikt nach featureArtifacts-Muster,
  Views nach ExecutionsView-Muster.
- ✅ **Tests bleiben grün, phaseMachine unangetastet**: Trigger hängen im Orchestrator, nicht
  in der State-Machine.
- ✅ **Verlustfreie Migration**: personas→agents via RENAME + Defaults, Alt-Verhalten identisch.

**Post-Design-Re-Check (nach Phase 1)**: unverändert bestanden — Design führt keine neuen
Projekte, Frameworks oder Patterns ein, die Rechtfertigung bräuchten. Complexity Tracking leer.

## Project Structure

### Documentation (this feature)

```text
specs/review-portal-und-agent-verwaltung/
├── plan.md              # Diese Datei
├── research.md          # Phase 0: Leitentscheidungen mit Begründung
├── data-model.md        # Phase 1: Tabellen, Typen, Zustandsübergänge
├── quickstart.md        # Phase 1: End-to-End-Validierungsszenarien
├── contracts/
│   ├── http-api.md      # Neue/geänderte REST-Endpunkte
│   └── ws-events.md     # Neue WS-Events (review_comments_updated, agent_gate)
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared/src/
├── types.ts                    # +Agent*, ReviewComment, PersonaAudit→AgentRunSummary,
│                               #  ReviewOverviewItem, ApproveMergeRequest, BranchInfo,
│                               #  AttentionKind +phase_gate_failed +approval_required
├── diffParse.ts (+.test.ts)    # NEU: parseUnifiedDiff → Hunks mit oldNo/newNo
├── branchSuggest.ts (+.test.ts)# NEU: suggestBranchName, isValidBranchName
├── reviewPrompt.ts (+.test.ts) # NEU: compileReviewPrompt (Kommentare+Freitext → Prompt)
└── agentSelect.ts (+.test.ts)  # NEU: resolveAgentsForTrigger + parseVerdict,
                                #  parseDecisionLabel, extractSummary, parseApprovalItems

packages/server/src/
├── db/database.ts              # Migration B (personas→agents, agent_runs, Seeds),
│                               #  Migration A (review_comments, integration_target, force_verify)
├── db/repos.ts                 # PersonaRepo RAUS; FeatureRepo.setIntegrationTarget,
│                               #  QueueRepo.enqueue({forceVerify}), ReviewCommentRepo
├── db/agentRepo.ts             # NEU: AgentRepo (Union-Semantik), AgentRunRepo
├── services/agentGateService.ts# NEU: ersetzt reviewGateService.ts (wird gelöscht)
├── services/mergeQueueService.ts# target-bewusst, approveForMerge(body), forceVerify
├── services/orchestrator.ts    # after_phase-Hook (handleTurnCompleted),
│                               #  before_phase-Deferral (startPhaseRun/approve, runningGates)
├── services/attentionReconciler.ts # Defaults für neue AttentionKinds
├── git/mergeEngine.ts          # rebaseOnto, mergeIntoTarget (ephemerer Worktree),
│                               #  ensureBranch, isBranchMerged(target)
├── api/server.ts               # Personas-Block → Agents-Endpunkte; reviewRoutes einhängen
├── api/reviewRoutes.ts         # NEU: overview, branches, tree, file GET/PUT, comments, audits
├── api/events.ts               # +review_comments_updated, +agent_gate
└── index.ts                    # Wiring AgentGateService

packages/web/src/
├── api.ts                      # neue Methoden (review*, agents*, comments*, audits*)
├── store.tsx                   # Views 'review' + 'agents', WS-Cases
├── App.tsx                     # Tab „Review" mit Badge
├── components/ReviewOverview.tsx   # NEU
├── components/ReviewPortal.tsx     # Rework (3 Spalten)
├── components/review/              # NEU: DiffViewer, FileTreePane, FileEditor, TestsPane,
│   └── …                           #  AuditSidebar, CommentsPanel, MergeTargetChooser
├── components/AgentsPanel.tsx      # NEU (Vorbild KnowledgePanel)
├── components/AgentEditDialog.tsx  # NEU
├── components/FeatureAgentSelect.tsx # NEU (Klon FeatureKnowledgeSelect)
├── components/AttentionInbox.tsx   # Aktionen für neue Kinds
├── components/KanbanBoard.tsx      # Done-Badge „→ <ziel>"
└── components/Sidebar.tsx          # Button „Agenten"
```

**Structure Decision**: Bestehendes 3-Paket-Monorepo wird beibehalten; neue Logik folgt der
etablierten Schichtung (pure shared-Module → server-Services/Repos → Web-Komponenten). Neue
Routen-Datei `reviewRoutes.ts`, weil `server.ts` bereits ~1100 Zeilen hat.

## Umsetzungsreihenfolge (verbindlich, aus Abstimmung)

1. **Shared-Fundament**: Typen (A+B) + pure Module + Tests (diffParse, branchSuggest,
   reviewPrompt, resolveAgentsForTrigger, Verdict/Summary/Approval-Parser).
2. **DB**: Migration B (personas→agents + agent_runs + agent_feature_selection + Seeds),
   dann Migration A (review_comments + integration_target + force_verify); AgentRepo +
   AgentRunRepo (neue Datei `agentRepo.ts`), ReviewCommentRepo, FeatureRepo/QueueRepo-
   Erweiterungen; Repo-Tests (openMemoryDatabase); Migrations-Smoke gegen Kopie der Dev-DB.
3. **AgentGateService** + Tests (Runner-Injektion: Reihenfolge, blocking-Stopp,
   advisory-Weiterlauf, model→argv, Worktree-Guard); `reviewGateService.ts` löschen;
   `mergeQueueService.ts` + `index.ts` umverdrahten.
4. **Orchestrator-Trigger**: after_phase in `handleTurnCompleted` (nach finishPhase/savePhases,
   VOR Auto-Progress), before_phase in `approve`/`startPhaseRun` (Deferral + skipGates +
   runningGates-Map), neue AttentionKinds + attentionReconciler-Defaults, `agent_gate`-Event;
   orchestrator.test.ts + reconciler-Tests. `phaseMachine.ts` UNVERÄNDERT.
5. **Merge-Ziel**: MergeEngine (rebaseOnto, mergeIntoTarget mit Tmp-Worktree unter
   `<dataDir>/merge-tmp/`, ensureBranch, isBranchMerged gegen Ziel) + Tests;
   MergeQueueService (approveForMerge async mit Validierung + Reviewer-Commit
   `review(<name>): reviewer-korrekturen` + forceVerify, processItem gegen Ziel, PR `--base`
   + Push neuer Basis-Branches, Self-Heal gegen Ziel, reject setzt Ziel zurück) + Tests.
6. **API**: reviewRoutes.ts (overview, branches, tree, file GET/PUT mit Traversal-Guard/
   Binär-Erkennung/2-MB-Limit/mtime-409, comments CRUD, audits runs-first + Markdown-Fallback);
   Agents-Endpunkte in server.ts (ersetzen Personas-Block); approve-merge/reject-review-Umbau;
   events.ts; index.ts-Wiring.
7. **Web**: api.ts; store.tsx (Views review+agents, WS-Cases); App.tsx (Review-Tab + Badge);
   AgentsPanel + AgentEditDialog + FeatureAgentSelect + FeatureConsole-Button; ReviewOverview;
   ReviewPortal-Rework + components/review/*; AttentionInbox-Aktionen; Kanban-Done-Badge.
8. **Verifikation**: `pnpm -r typecheck && pnpm -r test` (phaseMachine-Tests UNVERÄNDERT grün;
   `grep -r PersonaRepo` leer); Migrations-Smoke; manuelle Flows gemäß
   [quickstart.md](./quickstart.md).

## Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Kommentar-Anker-Drift nach neuen Commits | v1 akzeptiert; UI-Hinweis „Anker evtl. veraltet" |
| merged, aber Ziel ≠ main | gewollt; Done-Badge `→ <ziel>` |
| Ziel-Branch extern gelöscht | Self-Heal `safeOnly` überspringt mit Warnung |
| PR-Modus, neuer Basis-Branch | vor `gh pr create --base` erst `git push -u origin <target>` (braucht Push-Rechte) |
| Reviewer-Edit bricht Build | forceVerify vor Merge (setzt verifyCommands voraus) |
| Before-Gate: Phase wirkt „idle" | `agent_gate`-Event + gateRunning-Badge; Crash hinterlässt nur ungestartete Phase |
| Audit-Kosten im Markdown-Fallback | positionsbasierte Näherung, nur für Alt-Reviews vor Migration |
| Verdict-Parsing vertrauensbasiert | unverändertes Trust-Modell; Bericht ohne Urteil ⇒ FAIL/unklar, nie PASS |
| Eingedampfte Plan-Quality-Fassung | Team-Review gegen `docs/solution-plan-quality-review.md` nach Umsetzung |

## Complexity Tracking

> Keine Constitution-Verstöße — Tabelle leer.
