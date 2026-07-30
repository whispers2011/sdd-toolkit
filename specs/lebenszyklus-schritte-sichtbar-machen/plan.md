# Implementation Plan: Lebenszyklus-Schritte sichtbar machen

**Branch**: `feature/lebenszyklus-schritte-sichtbar-machen` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/lebenszyklus-schritte-sichtbar-machen/spec.md`

## Summary

Ein **deklarativer Katalog der fest verdrahteten Lebenszyklus-Schritte** des Toolkits als neues
pures Modul `packages/shared/src/lifecycleCatalog.ts`, plus die **aufklappbare Anzeige dieser
Schritte an den vorhandenen Knoten der Workflow-Übersicht**. Fünf Stufen — Worktree-Anlage,
Phasenstart, Phasenende, Integration, Merge — beschreiben je Schritt Name, Beschreibung,
Zeitpunkt/Auslöser und Ort im Code (Datei + benanntes Symbol, **ohne Zeilennummern**), bei den
heiklen Stellen zusätzlich die zwingende Reihenfolge bzw. die Bedingung, unter der ein Schritt
entfällt.

Gegen stilles Veralten wirken zwei getypte Bindungen an die bestehenden Domänen-Unions —
dasselbe Drift-Guard-Muster wie in `workflowModel.ts`: `Record<FeaturePhase, …>` für die
Phasen-Abdeckung und `Record<IntegrationStage, …>` für die Herkunft jeder Integrations-Stufe.
Eine neue Phase oder Stufe bricht damit `pnpm typecheck` **an der Stelle des Katalogs**.
Ergänzend prüfen Laufzeit-Tests Vollständigkeit und Nicht-Leere aller Felder (in `shared`,
pure) sowie die Existenz jeder genannten Code-Stelle (in `server`, mit Dateisystem-Zugriff).

Die Anzeige ist **rein additiv**: ein kleines Disclosure-Element in `WorkflowOverview.tsx`,
standardmäßig zugeklappt, je Knoten unabhängig schaltbar, Zustand flüchtig (`useState`). Der
Katalog wird statisch importiert — **keine neue API, keine neue Serveranfrage, keine
DB-Migration, keine neue Dependency, keine Verhaltensänderung am Toolkit**.

## Technical Context

**Language/Version**: TypeScript 5.8, Node ≥ 22 (ESM, `module: NodeNext`), pnpm-10-Workspace

**Primary Dependencies**: React 19 + Tailwind 4 (Web), `@sdd/shared` (workspace). Bewusst
**keine neuen Runtime- oder Dev-Dependencies**. `@sdd/shared` bleibt frei von Node-Builtins
(heute 0 `node:`-Importe) — der Dateisystem-Test liegt deshalb in `@sdd/server`, das
`@types/node` bereits führt.

**Storage**: Keine. Der Katalog ist statischer Quelltext; der Aufklappzustand lebt nur im
Komponenten-State (nicht persistiert, siehe Assumption „Aufklappzustand ist flüchtig").

**Testing**: vitest 3 (`pnpm -r test`), Typprüfung `pnpm -r typecheck`. Neue Tests:
`packages/shared/src/lifecycleCatalog.test.ts` (pure Vollständigkeit) und
`packages/server/src/services/lifecycleCatalogPaths.test.ts` (Existenz der Code-Orte).
`packages/web` hat konventionsgemäß keine Tests (`"test": "echo 'keine Web-Tests (MVP)'"`) —
die UI-Kriterien werden über [quickstart.md](./quickstart.md) manuell nachgewiesen.

**Target Platform**: lokaler Entwickler-Server (macOS/Linux), Web-UI im Browser

**Project Type**: pnpm-Monorepo — `packages/shared` (pure Typen/Daten/Funktionen),
`packages/server` (API + Services + git), `packages/web` (React-SPA)

**Performance Goals**: Keine messbare Auswirkung. Der Katalog ist ein statisches Objektliteral
(< 20 KB Quelltext), das im bereits geladenen `@sdd/shared`-Bundle mitkommt. Die Übersicht
macht **exakt so viele Serveranfragen wie heute** (SC-006) — der Katalog erzeugt keine.

**Constraints**:
- **Nur beschreiben und anzeigen** (FR-016): keine editierbaren Kommandos, keine neuen
  Auslöser, keine Stack-Verwaltung, keine Verknüpfung mit Laufzeit-Fortschritt.
- **Bestehender Code bleibt inhaltlich unangetastet**: `worktrees.ts`, `orchestrator.ts`,
  `mergeQueueService.ts`, `workflowModel.ts` werden nicht verändert. Der Katalog *beschreibt*
  sie, er greift nicht ein.
- **Code-Orte ohne Zeilennummern** (FR-012, Edge Case „Veraltender Ort im Code"): Datei +
  benanntes Symbol, repo-relativer POSIX-Pfad.
- **Katalog ist konfigurationsunabhängig** (FR-015): identisch für alle Projekte, vollständig
  auch ohne ausgewähltes Feature; konfigurationsabhängige Schritte bleiben sichtbar und nennen
  ihre Bedingung im Text.
- Deutsche UI, dunkles Layout, **SVG-Icons statt Emojis** (Konvention aus
  `specs/emojis-im-projekt-immer-als-svg-icon-hinterlegen`) — der vorhandene `ChevronDownIcon`
  wird wiederverwendet.
- **Kompaktheit gewahrt** (FR-014, SC-007): zugeklappt kostet eine Stufe nur die Zeile ihres
  Bedienelements.

**Scale/Scope**: 5 Stufen, ~32 Schritte, ein neues Shared-Modul (~350 Zeilen Daten), zwei neue
Testdateien, additive Änderungen an genau einer Web-Komponente.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein **unausgefülltes Template** — es existiert keine
ratifizierte Projekt-Constitution. Ersatzweise gelten die etablierten Repo-Konventionen als
Gates; alle erfüllt:

- ✅ **Pure Logik in `shared`, mit vitest getestet**: Der Katalog ist reine Daten + zwei kleine
  Helfer, ohne IO und ohne UI — exakt der Vertrag von `workflowModel.ts` („KEINE UI, KEIN IO").
- ✅ **`@sdd/shared` bleibt node-frei**: kein `node:`-Import im Modul und keine neue
  `@types/node`-Abhängigkeit; der Dateisystem-Test liegt in `@sdd/server`.
- ✅ **Keine neuen Dependencies**: bestätigt (0 neue Runtime- und Dev-Deps).
- ✅ **Bestehende Muster wiederverwenden**: Drift-Guard nach `workflowModel.ts`
  (`Record<Union, …>` + Laufzeit-Exhaustiveness-Test), Disclosure nach dem vorhandenen
  `SettingsPanel`-Muster (`aria-expanded` + rotierender `ChevronDownIcon`).
- ✅ **Keine Migration, kein Umbau bestehender Verträge**: keine DB-Änderung, keine
  API-Änderung, kein neues WS-Event; `workflowModel.ts` unverändert.
- ✅ **Deutsche UI + SVG-Icons statt Emojis**: eingehalten.
- ✅ **Read-only-Prinzip**: das Feature verändert nichts am Verhalten des Toolkits (FR-016).

**Post-Design-Re-Check (nach Phase 1)**: unverändert bestanden. Das Design führt keine neuen
Projekte, Frameworks oder Persistenzschichten ein und keine neue Netzwerklast. Complexity
Tracking bleibt leer.

## Project Structure

### Documentation (this feature)

```text
specs/lebenszyklus-schritte-sichtbar-machen/
├── plan.md                       # Diese Datei
├── research.md                   # Phase 0: Leitentscheidungen mit Begründung
├── data-model.md                 # Phase 1: Entitäten, Typen, Bindungen, Validierungsregeln
├── quickstart.md                 # Phase 1: End-to-End-Validierungsszenarien
├── contracts/
│   ├── lifecycle-catalog.md      # Öffentliche API des Shared-Moduls (Datenvertrag)
│   └── ui-contract.md            # Platzierung, Aufklapp-Verhalten, Zustände, A11y
├── checklists/
└── tasks.md                      # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── lifecycleCatalog.ts (NEU)      # Typen (LifecycleStep, LifecycleStage, CodeLocation),
│                                  #   LIFECYCLE_CATALOG, PHASE_LIFECYCLE_STAGES (Drift-Guard
│                                  #   über FeaturePhase), INTEGRATION_STAGE_ORIGIN (Drift-Guard
│                                  #   über IntegrationStage), stageFor()/allLifecycleSteps()
├── lifecycleCatalog.test.ts (NEU) # Vollständigkeit, Nicht-Leere, Reihenfolge, FR-009-Hinweis,
│                                  #   Abdeckung beider Domänen-Unions
└── index.ts                       # + export * from './lifecycleCatalog.js'

packages/server/src/services/
└── lifecycleCatalogPaths.test.ts (NEU)  # jede CodeLocation: Datei existiert im Repo,
                                         #   Symbol-Endglied kommt im Dateitext vor

packages/web/src/components/
└── WorkflowOverview.tsx           # + <LifecycleSteps stage=… /> (Disclosure, lokaler State)
                                   #   an PromptCard (Worktree-Anlage), PhaseCard (Phasenstart +
                                   #   Phasenende), IntegrationBlock-Kopf (Integration) und
                                   #   am merge_queue-Pill (Merge)
```

**Structure Decision**: Das bestehende 3-Paket-Monorepo bleibt unverändert. Der Katalog kommt
als **eigenes Modul neben `workflowModel.ts`**, nicht als dessen Erweiterung: `workflowModel.ts`
beschreibt die *konfigurierbare Struktur* des Workflows (Phasen, Flags, Trigger, Pipeline-Ansicht),
der neue Katalog beschreibt die *fest verdrahtete Arbeit des Toolkits*. Getrennte Dateien halten
beide Verantwortlichkeiten lesbar und lassen `workflowModel.ts` inhaltlich unangetastet, sodass
dessen Tests garantiert grün bleiben (SC-006). Begründung im Detail: [research.md](./research.md) D2.

## Umsetzungsreihenfolge (empfohlen, Story-Prioritäten folgend)

1. **Shared-Fundament (US1)**: `lifecycleCatalog.ts` mit Typen, den fünf Stufen und allen
   Schritten gemäß [data-model.md](./data-model.md) und
   [contracts/lifecycle-catalog.md](./contracts/lifecycle-catalog.md); Re-Export in `index.ts`.
   Inhaltlich zuerst die von FR-004…FR-008 geforderten Pflichtschritte, dann die ergänzenden.
2. **Drift-Guard-Bindung (US2)**: `PHASE_LIFECYCLE_STAGES: Record<FeaturePhase, …>` und
   `INTEGRATION_STAGE_ORIGIN: Record<IntegrationStage, …>` ergänzen; `pnpm -r typecheck` grün.
3. **Vollständigkeitstests (US2)**: `lifecycleCatalog.test.ts` — jede Stufe hat ≥ 1 Schritt,
   jedes Pflichtfeld ist nicht leer, jede Phase und jede Integrations-Stufe ist abgedeckt,
   Beschreibungen bleiben in der Längengrenze, Integrations-Schrittfolge in der geforderten
   Reihenfolge (FR-007).
4. **Reihenfolge- und Nicht-Zuständigkeits-Texte (US3)**: `orderNote` am Schritt
   „Worktree festschreiben" (FR-009) und `notDoneHere` an der Stufe „Worktree-Anlage"
   (FR-004, Abhängigkeiten installiert der Agent, nicht das Toolkit) — mit den Tests, die
   ihre Existenz sichern.
5. **Code-Ort-Test (US2/SC-004)**: `lifecycleCatalogPaths.test.ts` in `packages/server` —
   Repo-Wurzel aus `import.meta.url` ableiten, `existsSync` je Datei, Symbol-Endglied im
   Dateitext; Fehlermeldung nennt Stufe + Schritt.
6. **UI-Anzeige (US1)**: Disclosure-Komponente in `WorkflowOverview.tsx` und Einbau an den
   vier Knoten gemäß [contracts/ui-contract.md](./contracts/ui-contract.md); zugeklappter
   Startzustand, unabhängige Schaltbarkeit, `aria-expanded`.
7. **Verifikation**: `pnpm -r typecheck && pnpm -r test` grün; manuelle Flows und der
   Drift-Guard-Nachweis gemäß [quickstart.md](./quickstart.md).

## Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Katalogtexte weichen vom Code ab, ohne dass ein Test anschlägt (Prosa ist nicht typprüfbar) | Ort als Datei **+ Symbol** führen und beides testen (Datei existiert, Symbol-Endglied kommt vor) — eine Umbenennung oder ein Verschieben bricht den Test; Prosa-Genauigkeit bleibt Review-Sache und wird in der Checkliste geführt |
| Drift-Guard greift nicht, weil Phasenschritte für alle Phasen gleich sind und ein `Record<FeaturePhase, …>` künstlich wirkt | Der Record trägt echte Information („welche Stufen hängen an dieser Phase") und ist auf eine gemeinsame Konstante referenziert — redundanzfrei, aber pro Phase bewusst zu entscheiden (research.md D3) |
| Neue `IntegrationStage` bleibt unbemerkt, weil sie kein eigener Schritt ist | `INTEGRATION_STAGE_ORIGIN: Record<IntegrationStage, LifecycleStageId \| null>` — jede Stufe muss einer beschreibenden Lebenszyklus-Stufe zugeordnet oder ausdrücklich als `null` (Ruhezustand) markiert werden |
| `@sdd/shared` bekommt durch den Dateisystem-Test eine Node-Abhängigkeit und ist nicht mehr browser-rein | Test liegt in `packages/server` (hat `@types/node`); das Shared-Modul selbst bleibt ohne `node:`-Import (research.md D5) |
| Aufgeklappte Listen machen die Übersicht unlesbar (Edge Case „Sehr lange Beschreibungen") | Beschreibungen 1–3 Sätze mit getesteter Längengrenze; Listen umbrechen, kein horizontales Scrollen; zugeklappt ist der Startzustand |
| Der Katalog wirkt wie eine Statusanzeige („dieser Schritt läuft gerade") | Bewusst keine Laufzeit-Verknüpfung (Assumption); die Disclosure trägt einen neutralen Titel („Was das Toolkit hier tut") und keine Zustandsfarben |
| Zusätzliche Serveranfrage schleicht sich ein | Katalog wird statisch importiert, keine `api.*`-Aufrufe im neuen Code; Nachweis über DevTools-Netzwerkvergleich in quickstart.md Stufe 4 |
| Repo-Wurzel-Ableitung im Pfad-Test bricht bei Verschiebung der Testdatei | Wurzel wird über das Vorhandensein von `pnpm-workspace.yaml` aufwärts gesucht statt über eine feste Anzahl `..`-Sprünge |

## Complexity Tracking

> Keine Constitution-Verstöße — Tabelle bleibt leer.
