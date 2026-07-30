# Implementation Plan: Eigene Schritte an den Lebenszyklus hängen

**Branch**: `feature/eigene-schritte-an-den-lebenszyklus-haengen` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/eigene-schritte-an-den-lebenszyklus-haengen/spec.md`

## Summary

**Lebenszyklus-Schritte** sind benannte Shell-Kommandos, die an sechs definierten Punkten des
Feature-Lebenszyklus automatisch laufen: `before_worktree_create`, `after_worktree_create`,
`before_phase`, `after_phase`, `before_stage`, `after_stage`. Bedienung, Ebenen-Modell
(global → Projekt → Feature mit ausnehmen/hinzunehmen) und Fehlerverhalten (blockierend = hält
an, beratend = nur verbucht) übernehmen 1:1 die eingeführten Muster der **Agent-Gates** — es
entsteht kein zweites Bedienkonzept.

Technischer Kern in vier Teilen:

1. **Pure Domäne in `packages/shared`** (`lifecycleSteps.ts`): die Auslöser-Union, die
   Auflösungslogik „welche Schritte laufen für dieses Feature an diesem Auslöser?" (exakt die
   Regeln aus `agentSelect.ts`), die **eine** Stelle, die den Variablensatz aufbaut
   (`buildLifecycleEnv`, FR-011/FR-013/FR-014), und die Regel, in welchem Verzeichnis ein
   Auslöser läuft (`lifecycleCwdKind`). Alles pure Funktionen mit vitest-Tests.
2. **Ausführung in `packages/server`** (`lifecycleStepService.ts`): ein Trigger-Aufruf führt die
   geltenden Schritte **sequentiell** aus — je Schritt eine Execution der neuen Art
   `lifecycle_step`, Login-Shell im Zielverzeichnis, Zeitlimit mit SIGKILL, vollständige Ausgabe
   nach `<dataDir>/logs/<execId>.log` (⇒ der bestehende Log-Endpunkt funktioniert unverändert)
   und ein Ringpuffer der letzten Ausgabezeilen für das Inbox-Item. Erster blockierender
   Fehlschlag bricht die Kette ab und meldet `{ ok: false }`.
3. **Einhängen an genau acht Stellen**: `Orchestrator.prepareWorktree()` (eine Methode für beide
   Worktree-Anlagepfade), `startPhaseRun`/`handleTurnCompleted` für die Phasen-Auslöser,
   `mergeQueueService` für die fünf Stufen der Integrations-Pipeline. Regel überall gleich:
   **Schritte vor den Agents am selben Punkt** — Schritte bereiten vor, Agents beurteilen.
4. **Sichtbarkeit**: neue Sidebar-Ansicht „Lebenszyklus-Schritte" (Zwilling von `AgentsPanel`),
   Schritt-Chips in der Workflow-Übersicht an allen sechs Punkten, per-Feature-Auswahl,
   neue Lauf-Art in der Läufe-Ansicht.

**Eine additive DB-Migration** (zwei Tabellen + eine nullable Spalte auf `executions`),
**keine neuen Runtime-Dependencies**, **kein neues WS-Event-Schema** (bestehendes
`feature_updated`/`attention_raised` genügt). Portbereich und Profil sind ausdrücklich nicht
Teil dieses Features (FR-013/FR-014) — `buildLifecycleEnv` ist der eine Erweiterungspunkt, an
dem F1c sie ohne Bruch ergänzt.

## Technical Context

**Language/Version**: TypeScript 5.8, Node ≥ 22 (ESM), pnpm-10-Workspace

**Primary Dependencies**: Fastify 5 (API), React 19 + Tailwind 4 (Web), better-sqlite3 12 (DB +
Migration), `node:child_process.spawn` über den bestehenden Login-Shell-Helfer
(`pty/loginShellEnv.ts`). Bewusst **keine neuen Runtime-Dependencies** — kein Task-Runner, kein
Scheduler, keine Prozess-Bibliothek.

**Storage**: SQLite, eine neue Migration am Ende von `MIGRATIONS` in `db/database.ts`:
- `lifecycle_steps` (`project_id` NULL = global) — Muster: `agents`
- `lifecycle_step_feature_selection` — Muster: `agent_feature_selection`
- `ALTER TABLE executions ADD COLUMN label TEXT` — trägt den Schrittnamen, damit Läufe eines
  später gelöschten Schritts lesbar bleiben (FR-028) ohne Join
Kein Backfill, keine Änderung bestehender Spalten, alle Zusätze nullable/defaulted ⇒ eine
bestehende Datenbank verhält sich ohne konfigurierte Schritte unverändert (FR-027).

**Testing**: vitest 3 (`pnpm -r test`), Typprüfung `pnpm -r typecheck`. Pure Logik in
`packages/shared` mit Unit-Tests; Server-Services mit In-Memory-DB (`openMemoryDatabase()`) und
injizierbarem Runner nach dem Muster von `AgentGateService`/`HeadlessRunner`; Prozess-Ausführung
gegen echte, triviale Shell-Kommandos (`true`, `exit 3`, `sleep`) in Temp-Verzeichnissen nach dem
Muster von `mergeQueueService.test.ts`.

**Target Platform**: lokaler Entwickler-Server (macOS/Linux), Web-UI im Browser

**Project Type**: pnpm-Monorepo — `packages/shared` (pure Typen/Funktionen), `packages/server`
(API + Services + git), `packages/web` (React-SPA)

**Performance Goals**:
- Projekt **ohne** konfigurierte Schritte: exakt null zusätzliche Prozesse, null zusätzliche
  Executions, keine messbare Verzögerung bis zum Start der ersten Phase (SC-008). Der Fast-Path
  ist ein indizierter SQLite-Zähl-Query auf `lifecycle_steps` (bei leerer Tabelle < 1 ms).
- Blockierender Fehlschlag → Inbox-Item innerhalb von 5 s nach Schrittende (SC-003): das Item
  wird synchron im Abschluss-Pfad des Schritts erzeugt, keine Zwischenschleife.
- Zeitlimit → Lauf innerhalb von 10 s als fehlgeschlagen verbucht (SC-006): SIGKILL, danach
  unmittelbar `executions.finish(execId, 137)`.

**Constraints**:
- **Kein Urteil aus der Ausgabe** — bewertet werden ausschließlich Exit-Code und Zeitlimit
  (Assumption „Bewertung nur über Exit-Code und Zeitlimit"). Kein Berichtsformat, kein Parser.
- **Kein Verbrauchswert** — Schritt-Läufe schreiben `tokens = NULL`, `tokens_source = NULL`,
  `cost_micros = NULL`; nie 0 oder eine Schätzung als gemessener Verbrauch (FR-020).
- **Kein Prozess-Kill über generische Muster** (CLAUDE.md): der Runner beendet ausschließlich das
  eigene Child über dessen Handle, nie über `pkill`/`killall`.
- **Sequentiell je Auslöser** (Out of Scope: parallele Ausführung); Schritte verschiedener
  Features laufen unabhängig und dürfen sich nicht behindern (SC-005).
- **Kein manueller Einzellauf** eines Schritts (Out of Scope) — anders als bei Agents gibt es
  bewusst kein „Jetzt ausführen"; die Stufe wird als Ganzes erneut angestoßen.
- Deutsche UI, dunkles Layout, **Symbole als SVG-Icons** aus `components/icons.tsx`
  (Konvention `specs/emojis-im-projekt-immer-als-svg-icon-hinterlegen`).
- Ein blockierender Fehlschlag hält an, **verhindert aber keinen menschlichen Override** —
  dieselbe Linie wie bei `phase_gate_failed` („Human-Override bleibt möglich").

**Scale/Scope**: Einzelnutzer/Kleinteam; wenige Projekte, pro Projekt eine Handvoll Schritte,
mehrere Features gleichzeitig aktiv. Zeitlimit-Vorgabewert 15 min (identisch mit den
Verifikations-Kommandos). Ausgabe-Tail im Inbox-Item: letzte 20 Zeilen, hart auf 2000 Zeichen
gekappt; vollständige Ausgabe bleibt über den Lauf erreichbar.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein **unausgefülltes Template** — es existiert keine
ratifizierte Projekt-Constitution. Ersatzweise gelten die etablierten Repo-Konventionen als
Gates; alle erfüllt:

- ✅ **Pure Logik in `shared`, mit vitest getestet**: Auslöser-Union, Auflösung
  (exclude > include > enabled), Reihenfolge-Vergleicher, Variablensatz-Builder und
  Verzeichnis-Regel sind pure Funktionen ohne IO.
- ✅ **Keine neuen Runtime-Dependencies**: bestätigt (0 neue Deps).
- ✅ **Bestehende Muster wiederverwenden statt neue erfinden**: Repo nach `agentRepo.ts`,
  Auflösung nach `agentSelect.ts`, Prozessausführung nach `verifyService.ts`, Deferral des
  Phasenstarts nach `runBeforePhaseGate`, Verwaltungs-UI nach `AgentsPanel`/`AgentEditDialog`,
  per-Feature-Auswahl nach `FeatureAgentSelect`, Routen nach den `/api/agents`-Routen.
- ✅ **Drift-Guard statt still veraltender Übersicht** (FR-008): der Auslöser-Katalog ist über
  `Record<LifecycleTriggerKind, …>` und `Record<IntegrationStageId, …>` getypt und zusätzlich
  durch Laufzeit-Exhaustiveness in `workflowModel.test.ts` abgesichert — eine neue Auslöser-Art
  oder eine neue Pipeline-Stufe bricht `pnpm typecheck` bzw. `pnpm test`.
- ✅ **Additive Migration, keine Vertragsbrüche**: `ExecutionRecord` wächst um zwei nullable
  Felder (`kind`-Union + `label`); alle bestehenden Aufrufer bleiben gültig.
- ✅ **Rückwärtsverhalten explizit geschützt** (FR-027/SC-008): Fast-Path ohne Schritte, durch
  einen eigenen Test abgesichert („keine zusätzliche Execution, kein Spawn").
- ✅ **Messung nicht verfälschen**: keine Ersatzwerte (FR-020); Schritt-Läufe werden aus dem
  Nenner der Mess-Herkunft (`sourceMix`) ausgenommen, weil an ihnen nichts zu messen ist.
- ✅ **Prozess-Disziplin** (CLAUDE.md/Global): kein `pkill`/`killall`, keine generischen Muster;
  nur das eigene Child-Handle wird beendet.
- ✅ **Deutsche UI + SVG-Icons statt Emojis**: eingehalten.

**Post-Design-Re-Check (nach Phase 1)**: unverändert bestanden. Das Design führt kein neues
Paket, kein Framework und keine zweite Persistenzschicht ein; die einzige strukturelle Änderung
an Bestandscode ist die Umstellung der Reihenfolge in `Orchestrator.createFeature`
(Feature-Datensatz vor Worktree, mit Rollback bei Git-Fehler) — begründet und in
[research.md](./research.md) (E5) dokumentiert. **Complexity Tracking bleibt leer.**

## Project Structure

### Documentation (this feature)

```text
specs/eigene-schritte-an-den-lebenszyklus-haengen/
├── plan.md                      # Diese Datei
├── research.md                  # Phase 0: Leitentscheidungen mit Begründung
├── data-model.md                # Phase 1: Entitäten, Schema, Zustände, Ableitungsregeln
├── quickstart.md                # Phase 1: End-to-End-Validierungsszenarien
├── contracts/
│   ├── lifecycle-triggers.md    # Auslöser-Katalog + Kommando-Vertrag (Env, cwd, Bewertung)
│   ├── http-api.md              # Verwaltung + per-Feature-Auswahl
│   └── ui-contract.md           # Einstiegspunkte, Zustände, Aktionen
├── checklists/requirements.md
└── tasks.md                     # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── types.ts                          # + LifecycleStep, LifecycleTrigger(-Kind), LifecycleStageId,
│                                     #   LifecycleStepFeatureDecision, FeatureLifecycleStepView,
│                                     #   LifecycleContext; ExecutionRecord.kind += 'lifecycle_step',
│                                     #   ExecutionRecord.label; AttentionKind += 'lifecycle_step_failed'
├── lifecycleSteps.ts (NEU)           # pure Domäne: LIFECYCLE_TRIGGER_KINDS, triggerMatches,
│                                     #   resolveLifecycleSteps, compareStepOrder,
│                                     #   buildLifecycleEnv (DIE eine Stelle, FR-013/FR-014),
│                                     #   lifecycleCwdKind, DEFAULT_STEP_TIMEOUT_MS, tailLines
├── lifecycleSteps.test.ts (NEU)
├── workflowModel.ts                  # + INTEGRATION_STAGE_IDS (as const) und IntegrationStep.id
│                                     #   darauf getypt; + LIFECYCLE_TRIGGER_META
│                                     #   (Record<LifecycleTriggerKind, …>) für die Übersicht
├── workflowModel.test.ts             # + Exhaustiveness: jede Auslöser-Art, jede Stufen-ID,
│                                     #   INTEGRATION_STEPS-IDs == INTEGRATION_STAGE_IDS
├── runSummary.ts                     # categorizeExecution: 'lifecycle_step' → 'overhead';
│                                     #   STEP_ORDER erweitert; sourceMix-Nenner ohne Schritt-Läufe
├── runSummary.test.ts                # + Tests dafür
└── index.ts                          # Re-Export von lifecycleSteps.js

packages/server/src/
├── db/database.ts                    # + Migration (lifecycle_steps, …_feature_selection,
│                                     #   executions.label)
├── db/lifecycleStepRepo.ts (NEU)     # CRUD + forProject (Union global∪Projekt) + Selektion
├── db/lifecycleStepRepo.test.ts (NEU)
├── db/repos.ts                       # ExecutionStartInput.label; map()/start() um label erweitert
├── services/lifecycleStepService.ts (NEU)   # hasStepsFor(), runTrigger(); Ausführung, Zeitlimit,
│                                            #   Log + Tail, Execution-Buchführung, Inbox-Item,
│                                            #   Auflösung des Items bei Erfolg (FR-025)
├── services/lifecycleStepService.test.ts (NEU)
├── services/attentionReconciler.ts   # 'lifecycle_step_failed' explizit: bleibt gültig bis
│                                     #   erfolgreicher Wiederanlauf (kein Session-/Stage-Bezug)
├── services/attentionReconciler.test.ts     # + Fälle dafür
├── services/orchestrator.ts          # prepareWorktree() (NEU, beide Anlagepfade);
│                                     #   createFeature umgestellt; before/after_phase-Schritte
│                                     #   in runBeforePhaseChecks bzw. handleTurnCompleted
├── services/orchestrator.test.ts     # + Worktree-/Phasen-Auslöser, Halt, Fast-Path
├── services/mergeQueueService.ts     # runStageSteps() (NEU, privat) an den fünf Stufen
├── services/mergeQueueService.test.ts       # + Halt je Stufe
├── api/server.ts                     # 5 Routen (Verwaltung + per-Feature-Auswahl) + Validierung
├── api/server.test.ts                # + Routen-/Validierungsfälle
└── index.ts                          # LifecycleStepRepo + LifecycleStepService verdrahten

packages/web/src/
├── api.ts                            # + lifecycleSteps(), saveLifecycleStep(),
│                                     #   deleteLifecycleStep(), featureLifecycleSteps(),
│                                     #   setLifecycleStepSelection()
├── store.tsx                         # + View { kind: 'lifecycle_steps'; projectId }
├── App.tsx                           # Rendering der neuen View
├── components/Sidebar.tsx            # Projekt-Eintrag „Lebenszyklus-Schritte" (SVG-Icon)
├── components/icons.tsx              # + StepsIcon (SVG)
├── components/LifecycleStepsPanel.tsx (NEU)      # Verwaltung global/Projekt (Zwilling AgentsPanel)
├── components/LifecycleStepEditDialog.tsx (NEU)  # Name, Kommando, Auslöser(+Phase/Stufe),
│                                                 #   Fehlerverhalten, Zeitlimit, Aktiv, Position
├── components/FeatureLifecycleStepSelect.tsx (NEU)# per-Feature Auto/Ein/Aus
├── components/FeatureConsole.tsx      # Einstieg in die per-Feature-Auswahl (neben Agents)
├── components/WorkflowOverview.tsx   # StepZone an Worktree-, Phasen- und Stufen-Knoten
└── components/ExecutionsView.tsx      # KIND_LABELS/STEP_LABELS + Anzeige von label/Exit-Code
```

**Structure Decision**: Das bestehende 3-Paket-Monorepo bleibt unverändert. Die neue Logik folgt
der etablierten Schichtung (pure `shared`-Module → `server`-Repo/Service → Web-Komponenten). Die
fünf neuen Routen liegen bewusst **in `server.ts` direkt neben den `/api/agents`-Routen** (nicht
in einer eigenen Datei wie `reviewRoutes.ts`): sie sind der wörtliche Zwilling dieser Routen, und
Nachbarschaft macht die Symmetrie sichtbar und prüfbar.

## Umsetzungsreihenfolge (empfohlen, Story-Prioritäten folgend)

1. **Shared-Fundament** (Basis für alles, US2/US3/US4): Typen in `types.ts`;
   `lifecycleSteps.ts` mit `resolveLifecycleSteps`, `compareStepOrder`, `buildLifecycleEnv`,
   `lifecycleCwdKind`, `DEFAULT_STEP_TIMEOUT_MS`, `tailLines`; `INTEGRATION_STAGE_IDS` +
   `LIFECYCLE_TRIGGER_META` in `workflowModel.ts`; Tests inkl. Exhaustiveness-Guards.
2. **Persistenz** (US4): Migration, `LifecycleStepRepo` (CRUD, Union global∪Projekt, Selektion),
   `executions.label` in `ExecutionStartInput`/`map()`; Repo-Tests inkl. Ebenen-Auflösung.
3. **Ausführung** (US2, das Herz): `lifecycleStepService.ts` — `hasStepsFor()` (Fast-Path),
   `runTrigger()` mit sequentieller Ausführung, Zeitlimit, Log-Datei + Tail-Puffer,
   Execution ohne Verbrauchswert, `lifecycle_step_failed`-Item mit Name/Kommando/Exit-Code/Tail,
   Auflösung des Items bei erfolgreichem Durchlauf. Tests für alle Fehlerpfade.
4. **Worktree-Auslöser** (US1, Abnahmebedingung): `Orchestrator.prepareWorktree()`;
   `createFeature` auf die neue Reihenfolge umstellen (Rollback bei Git-Fehler);
   `ensureSessionInner` nutzt dieselbe Methode; Fast-Path-Test („ohne Schritte unverändert").
5. **Aufmerksamkeit & Reconciler** (US2): `attentionReconciler` um
   `lifecycle_step_failed` erweitern (bleibt gültig, überlebt Neustart, wird nur durch
   erfolgreichen Wiederanlauf oder manuelles Auflösen erledigt).
6. **Verwaltung + API** (US4): 5 Routen mit Validierung (Auslöser braucht Phase/Stufe,
   Kommando nicht leer, Zeitlimit > 0), `api.ts`, `store.tsx`, `App.tsx`, Sidebar-Einstieg,
   `LifecycleStepsPanel` + `LifecycleStepEditDialog`.
7. **Sichtbarkeit der Läufe** (US1 Szenario 2): `runSummary.ts` (Kategorie, STEP_ORDER,
   sourceMix-Ausschluss), `ExecutionsView` (Labels, `label`, Exit-Code, Log-Öffner).
8. **Per-Feature-Ausnahmen** (US4 Szenarien 3/4): `FeatureLifecycleStepSelect` + Einstieg in der
   Feature-Konsole.
9. **Phasen-Auslöser** (US5): Schritte in `runBeforePhaseChecks` (vor dem Agent-Gate) und in
   `handleTurnCompleted` (vor `runAfterPhaseGate`); Halt-Semantik + Tests.
10. **Stufen-Auslöser** (US5): `runStageSteps()` an den fünf Stufen der Pipeline; Halt-Semantik
    je Stufe + Tests (inkl. „nach"-Auslöser der letzten Stufe).
11. **Workflow-Übersicht** (US5 Szenario 4): `StepZone` an Worktree-, Phasen- und
    Stufen-Knoten, rein aus `LIFECYCLE_TRIGGER_META` + `INTEGRATION_STAGE_IDS` gerendert.
12. **Verifikation**: `pnpm -r typecheck && pnpm -r test` grün; manuelle Flows gemäß
    [quickstart.md](./quickstart.md).

Schritte 1–8 liefern die vollständigen P1/P2-Stories und sind allein auslieferbar; 9–11 ergänzen
die P3-Auslöser.

## Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Lange Schritte (`pnpm install`) blockieren die Feature-Anlage-Antwort | Bewusst akzeptiert (Spec verlangt Verzögerungsfreiheit nur ohne Schritte, US1 Szenario 3): der Lauf erscheint beim Start sofort als `running` in der Läufe-Ansicht, der Dialog zeigt einen Fortschrittszustand. Alternative „asynchron + verzögerter Phasenstart" verworfen — `with-documents` schreibt direkt nach `createFeature` in den Worktree (E5 in research.md) |
| Umgestellte Reihenfolge in `createFeature` lässt bei Git-Fehler ein halbes Feature zurück | Rollback über das vorhandene `FeatureRepo.hardDelete(id)` + Rethrow ⇒ nach außen identische Fehlersemantik wie heute; eigener Test |
| Blockierender Fehlschlag hinterlässt ein Feature ohne Worktree und ohne Session | Genau das ist die gewollte Wirkung (US2). Erneutes Anstoßen (`POST /api/features/:id/session`) läuft über dieselbe `prepareWorktree()`-Methode, wiederholt den Auslöser und löst das Item bei Erfolg auf (FR-025) |
| Schritt-Läufe verwässern die Verbrauchssicht | `tokens/cost_micros = NULL` (nie 0); `sourceMix`-Nenner ohne Schritt-Läufe; eigene Kategorie-Zuordnung `overhead`; Test auf „kein Ersatzwert" |
| Kommando hängt, Stufe blockiert stumm | Zeitlimit ist Pflicht (FR-016), Vorgabewert 15 min; SIGKILL + sofortige Buchung als Fehlschlag; `unref`-freier, im Abschlusspfad gelöschter Timer |
| Nach Server-Neustart bleibt ein Lauf auf „läuft" | Kein Zusatzcode nötig: `ExecutionRepo.reapOrphans()` im Boot markiert alle `running` als `orphaned` (FR-021) — durch Test abgesichert, damit die Kopplung nicht unbemerkt bricht |
| Ausgabe mit vielen MB sprengt Speicher/Item | Ausgabe wird gestreamt in die Log-Datei geschrieben (nie im RAM gehalten); nur ein Ringpuffer der letzten 20 Zeilen / 2000 Zeichen bleibt im Speicher (FR-023, Edge Case „sehr viel Ausgabe") |
| Fehlender Worktree wird als fachlicher Fehlschlag verbucht | Eigener Infrastruktur-Guard nach dem Muster `AgentGateService.guardWorktree`: wirft, meldet `agent_errored` (behebbar) und erzeugt **keinen** FAIL-Lauf (FR-026) |
| Schritt wird während des Laufs geändert/gelöscht | Der Lauf arbeitet auf dem beim Start gelesenen Objekt; `executions.label` hält den damaligen Namen fest (FR-028, Edge Case) |
| Zwei Auslöser desselben Features feuern gleichzeitig | Guard-Set `runningTriggers` (`${featureId}:${triggerKey}`) im Service, Muster `Orchestrator.runningGates`; verschiedene Features sind unabhängig (SC-005) |
| Neue Auslöser-Art veraltet die Workflow-Übersicht still | `Record<LifecycleTriggerKind, …>` (Compile-Fehler) + Laufzeit-Exhaustiveness in `workflowModel.test.ts` + Test „INTEGRATION_STEPS-IDs == INTEGRATION_STAGE_IDS" (FR-008) |
| Shell-Kommando aus der DB = Command-Injection-Fläche | Bewusst: Schritte sind vom Menschen konfigurierte Kommandos mit denselben Rechten wie die Verifikations-Kommandos (Assumption „Keine gesonderte Rechteprüfung"). Es wird **nichts interpoliert** — Kontext kommt ausschließlich als Umgebungsvariablen, nie als Textersatz im Kommando |
| Doppelte Timeout-/Spawn-Logik neben `verifyService` | Bewusst getrennt gehalten: `verifyService.ts` hat keine eigenen Tests, ein Refactoring dorthin wäre ein ungedeckter Eingriff in den Merge-Pfad. Der neue Runner ist eigenständig und getestet (E7 in research.md) |
