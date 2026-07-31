# Phase 1 — Datenmodell: Lebenszyklus-Schritte sichtbar machen

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) |
**Entscheidungen**: [research.md](./research.md) | **API**: [contracts/lifecycle-catalog.md](./contracts/lifecycle-catalog.md)

Alle Typen leben in `packages/shared/src/lifecycleCatalog.ts`. **Pure Daten, kein IO, keine
UI** — derselbe Vertrag wie `workflowModel.ts`.

---

## 1. Entitäten

### 1.1 `CodeLocation` — Ort im Code

| Feld | Typ | Pflicht | Regel |
|---|---|---|---|
| `file` | `string` | ja | Repo-relativer POSIX-Pfad, z. B. `packages/server/src/git/worktrees.ts`. Kein führender `./`, kein absoluter Pfad, **keine Zeilennummer** (FR-012). |
| `symbol` | `string` | ja | Benannte Stelle: Funktion, Methode oder Konstante. Punktnotation für Methoden: `WorktreeManager.createUnlocked`. |

### 1.2 `LifecycleStep` — eine Handlung innerhalb einer Stufe

| Feld | Typ | Pflicht | Regel |
|---|---|---|---|
| `id` | `string` | ja | kebab-case, **eindeutig innerhalb der Stufe**, stabil (dient als React-Key). |
| `name` | `string` | ja | Deutsch, nicht leer, ≤ 60 Zeichen. |
| `description` | `string` | ja | Deutsch, 1–3 Sätze, nicht leer, ≤ 400 Zeichen (D11). |
| `trigger` | `string` | ja | Wodurch/wann der Schritt ausgelöst wird, nicht leer. |
| `location` | `CodeLocation` | ja | s. o. |
| `orderNote` | `string?` | nein | Zwingende Reihenfolge **und deren Konsequenz bei Umkehrung** (FR-009, D9). |
| `condition` | `string?` | nein | Bedingung, unter der der Schritt läuft bzw. entfällt (D8). |

Optionale Felder sind bei Anwesenheit nicht leer (`exactOptionalPropertyTypes: true` ist im
Repo aktiv — Felder werden weggelassen, nicht auf `undefined` gesetzt).

### 1.3 `LifecycleStage` — eine der fünf Stellen im Ablauf

| Feld | Typ | Pflicht | Regel |
|---|---|---|---|
| `id` | `LifecycleStageId` | ja | einer der fünf Werte aus `LIFECYCLE_STAGES`. |
| `title` | `string` | ja | Deutscher Titel, nicht leer. |
| `when` | `string` | ja | Einordnungssatz („wann in der Reihenfolge"), nicht leer. |
| `steps` | `readonly LifecycleStep[]` | ja | **≥ 1**; Reihenfolge im Array = tatsächliche Ausführungsreihenfolge (FR-007). |
| `notDoneHere` | `string?` | nein | Was das Toolkit hier bewusst **nicht** tut (FR-004, D10). |

### 1.4 `LifecycleStageId` — die neue Stufen-Aufzählung

```ts
export const LIFECYCLE_STAGES = [
  'worktree_create',
  'phase_start',
  'phase_end',
  'integration',
  'merge',
] as const;
export type LifecycleStageId = (typeof LIFECYCLE_STAGES)[number];
```

Reihenfolge im Array = Reihenfolge im Lebenszyklus. Diese Aufzählung wird mit diesem Feature
**neu eingeführt** (Assumption „Neue Stufen-Aufzählung"); sie ist keine bestehende
Domänen-Union.

### 1.5 `LIFECYCLE_CATALOG` — der Katalog

```ts
export const LIFECYCLE_CATALOG: Record<LifecycleStageId, LifecycleStage>
```

Einzige Quelle der Wahrheit für die Beschreibung dieser Schritte (FR-001). Eine neue
`LifecycleStageId` erzwingt hier einen Eintrag (Compile-Fehler sonst).

---

## 2. Bindung an die bestehende Domäne (Drift-Guard, FR-010)

### 2.1 Phasen

```ts
const STANDARD_PHASE_STAGES = ['phase_start', 'phase_end'] as const;

export const PHASE_LIFECYCLE_STAGES = {
  specify:   STANDARD_PHASE_STAGES,
  clarify:   STANDARD_PHASE_STAGES,
  plan:      STANDARD_PHASE_STAGES,
  checklist: STANDARD_PHASE_STAGES,
  analyze:   STANDARD_PHASE_STAGES,
  tasks:     STANDARD_PHASE_STAGES,
  implement: STANDARD_PHASE_STAGES,
} satisfies Record<FeaturePhase, readonly LifecycleStageId[]>;
```

Eine neue Phase in `FEATURE_PHASES` ohne Eintrag ⇒ **Compile-Fehler an dieser Stelle**
(US2-AS1). Alle Werte zeigen auf dieselbe Konstante: kein duplizierter Text, aber eine bewusste
Entscheidung je Phase (D3).

### 2.2 Integrations-Stufen

```ts
export const INTEGRATION_STAGE_ORIGIN = {
  none:                  null,          // Ruhezustand — kein Ablauf erzeugt ihn
  verifying:             'integration',
  verify_failed:         'integration',
  review_gate:           'integration',
  gate_failed:           'integration',
  awaiting_human_review: 'integration',
  queued:                'integration',
  merging:               'merge',
  conflict_resolving:    'merge',
  conflict_escalated:    'merge',
  merged:                'merge',
} satisfies Record<IntegrationStage, LifecycleStageId | null>;
```

Eine neue `IntegrationStage` ohne Eintrag ⇒ **Compile-Fehler an dieser Stelle** (US2-AS2).
Semantik: „Welche Lebenszyklus-Stufe beschreibt den Ablauf, der zu dieser Stufe führt?"

### 2.3 Abgrenzung zu `workflowModel.ts`

| Modell | Frage | Abhängig von Konfiguration? |
|---|---|---|
| `workflowModel.ts` | Welche Phasen/Flags/Stufen gibt es, wie heißen sie, wie sieht die Pipeline aus? | ja (rendert gegen Live-Konfiguration) |
| `lifecycleCatalog.ts` | Was tut das Toolkit an dieser Stelle konkret, wann, und wo steht das im Code? | **nein** (FR-015) |

Keine Datei wird von der anderen importiert; beide importieren nur `types.js`.

---

## 3. Helfer (rein abgeleitet, kein Zustand)

| Funktion | Signatur | Zweck |
|---|---|---|
| `lifecycleStage` | `(id: LifecycleStageId) => LifecycleStage` | Zugriff auf eine Stufe (Total-Funktion, kein `undefined`). |
| `orderedLifecycleStages` | `() => readonly LifecycleStage[]` | Alle Stufen in Lebenszyklus-Reihenfolge (für Tests und mögliche Sammelansichten). |

Die UI braucht nur `lifecycleStage(id)`; `orderedLifecycleStages()` deckt die Testschleifen ab.

---

## 4. Validierungsregeln (Laufzeit-Tests, FR-011)

Geprüft in `packages/shared/src/lifecycleCatalog.test.ts` (pure):

| Regel | Quelle |
|---|---|
| Jede `LifecycleStageId` hat einen Katalogeintrag; `id` im Eintrag = Schlüssel. | FR-003 |
| Jede Stufe hat **≥ 1** Schritt (leere Stufe = Fehler, kein Leerzustand). | FR-011, Edge Case |
| Jeder Schritt hat nicht-leeren `name`, `description`, `trigger`, `location.file`, `location.symbol`. | FR-011, US2-AS3 |
| `location.file` beginnt mit `packages/`, endet auf `.ts`/`.tsx`, enthält keine Zeilenangabe (`:` gefolgt von Ziffern). | FR-012 |
| Schritt-`id`s sind innerhalb einer Stufe eindeutig. | Implementierungsvertrag (React-Key) |
| `name` ≤ 60, `description` ≤ 400 Zeichen. | Edge Case, SC-007, D11 |
| Optionale Felder sind, wenn gesetzt, nicht leer. | US2-AS3 |
| Jede `FeaturePhase` hat einen Eintrag in `PHASE_LIFECYCLE_STAGES`, dessen Stufen im Katalog existieren und Schritte haben. | FR-010, SC-003 |
| Jede `IntegrationStage` hat einen Eintrag in `INTEGRATION_STAGE_ORIGIN`; jeder Nicht-`null`-Wert existiert im Katalog. | FR-010, SC-003 |
| Stufe `integration` enthält die geforderten Schritte in genau dieser Reihenfolge: Worktree festschreiben → Git-Abgleich → Verify → Review-Gate → Review-Berichte committen → Queue/Human-Review. | FR-007 |
| Der Schritt „Worktree festschreiben" trägt einen nicht-leeren `orderNote`, der den Git-Abgleich und die Eskalations-Folge benennt. | FR-009, SC-005, US3-AS1/AS3 |
| Die Stufe `worktree_create` trägt ein nicht-leeres `notDoneHere` zum Thema Abhängigkeiten. | FR-004, US3-AS2 |

Geprüft in `packages/server/src/services/lifecycleCatalogPaths.test.ts` (Dateisystem):

| Regel | Quelle |
|---|---|
| Für jeden Schritt existiert `<repo-root>/<location.file>`. | FR-012, SC-004, US2-AS4 |
| Das letzte Glied von `location.symbol` kommt als Text in dieser Datei vor. | D4, US2-AS4 |
| Fehlermeldungen nennen Stufe **und** Schritt-`name`. | US2-AS4 |

Repo-Wurzel: aufwärts vom Testverzeichnis suchen, bis `pnpm-workspace.yaml` gefunden ist (D5).

---

## 5. Katalog-Inhalt (Sollbestand)

Verbindlicher Umfang für die Umsetzung. Die Spalte „Ort im Code" ist der zu hinterlegende
`CodeLocation`-Wert; alle Angaben wurden im Quelltext dieses Branches verifiziert.

### 5.1 Stufe `worktree_create` — „Worktree-Anlage"

*when*: „Beim Anlegen eines Features — und erneut beim Aufbau einer Session, falls der
gespeicherte Worktree auf der Platte fehlt."

*notDoneHere*: Abhängigkeiten installiert das Toolkit **nicht** (kein `pnpm install`, kein
Build). Der Worktree kommt mit ausgecheckten Dateien plus gespiegelter Agent-Konfiguration —
alles Weitere macht der Agent im Worktree. (FR-004)

| # | Schritt | Auslöser | Ort im Code | Zusatz |
|---|---|---|---|---|
| 1 | Anlage je Repo und Branch serialisieren | jeder `create()`-Aufruf | `packages/server/src/git/worktrees.ts` · `WorktreeManager.create` | `orderNote`: zwei parallele Aufrufe (Boot-Recovery + reconnectender Client) lesen sonst beide „Branch fehlt" und rufen beide `add -b` → „cannot lock ref … reference already exists" |
| 2 | Verwaiste Registry-Einträge entfernen | vor jedem Anlege-Versuch | `packages/server/src/git/worktrees.ts` · `WorktreeManager.createUnlocked` | — |
| 3 | Bestehenden Worktree idempotent wiederverwenden | Zielverzeichnis existiert bereits | `packages/server/src/git/worktrees.ts` · `WorktreeManager.ensureValid` | `condition`: nur bei vorhandenem Zielverzeichnis; kaputte Verknüpfung wird repariert, unrettbare Hülle entfernt |
| 4 | Worktree anlegen, Branch bei Bedarf abzweigen | kein gültiger Worktree vorhanden | `packages/server/src/git/worktrees.ts` · `WorktreeManager.createUnlocked` | — |
| 5 | Wettlauf-Wiederholung | `git worktree add` meldet „already exists/checked out/used by worktree" | `packages/server/src/git/worktrees.ts` · `WorktreeManager.createUnlocked` | `condition`: nur nach dieser Fehlermeldung |
| 6 | Agent-Konfiguration spiegeln | auf **jedem** Erfolgspfad der Anlage | `packages/server/src/git/worktrees.ts` · `mirrorAgentConfig` | `.claude`, `CLAUDE.md`, `AGENTS.md`; nur was im Worktree fehlt — getrackte Dateien gewinnen |

### 5.2 Stufe `phase_start` — „Phasenstart"

*when*: „Vor jedem Phasen-Lauf — für jede Phase identisch."

| # | Schritt | Auslöser | Ort im Code | Zusatz |
|---|---|---|---|---|
| 1 | `before_phase`-Gate | Start einer Phase | `packages/server/src/services/orchestrator.ts` · `Orchestrator.runBeforePhaseGate` | `condition`: nur wenn für diesen Auslöser Agents existieren; blockierender FAIL verhindert den Start |
| 2 | Session sicherstellen | Phasenstart ohne laufende Session | `packages/server/src/services/orchestrator.ts` · `Orchestrator.ensureSessionInner` | eine persistente Session je Feature, pro Feature serialisiert; Resume nur bei noch vorhandenem Transkript |
| 3 | Transkript-Startmarke festhalten | unmittelbar vor dem Reset | `packages/server/src/services/orchestrator.ts` · `Orchestrator.transcriptMarkFor` | `orderNote`: **vor** dem Kontext-Reset, damit dessen Verbrauch zum Lauf zählt (faires A/B) |
| 4 | Kontext-Reset gemäß Strategie | vor dem Phasenprompt, ab der zweiten Phase | `packages/server/src/services/contextOptimizer.ts` · `prepareForPhase` | `condition`: nur bei Strategie `compact`/`fresh`, nie in der ersten Phase; fehlt `spec.md`, wird auf vollen Kontext zurückgefallen |
| 5 | Wissens-Präambel anhängen | Phasenprompt wird gebaut | `packages/server/src/services/orchestrator.ts` · `Orchestrator.knowledgePreambleFor` | `condition`: nur bei erster Injektion, geändertem Wissen oder nach einem Reset |
| 6 | Dokument-Verweise anhängen | Phasenprompt wird gebaut | `packages/shared/src/featureDocuments.ts` · `buildDocumentsPreamble` | bewusst **ohne** Dedupe — der Verweis gehört zum Auftrag und muss in jedem Schritt stehen |
| 7 | Slash-Kommando bauen und senden | nach dem Reset | `packages/server/src/pty/commandBuilder.ts` · `phaseSlashCommand` | Präfix je Repo-Stil (`/speckit-` bei Skills, `/speckit.` bei Commands), Ziel `specs/<feature>` |

### 5.3 Stufe `phase_end` — „Phasenende"

*when*: „Wenn der Agent-Turn der Phase abgeschlossen ist (Stop-Signal der Session)."

| # | Schritt | Auslöser | Ort im Code | Zusatz |
|---|---|---|---|---|
| 1 | Reset-Turn aussortieren | Turn-Ende ohne zugestellten Phasenprompt | `packages/server/src/services/orchestrator.ts` · `Orchestrator.handleTurnCompleted` | `orderNote`: vor jeder Abrechnung — sonst meldet ein Reset-Turn Erfolg ohne jede Arbeit |
| 2 | Verbrauch messen | Phasenabschluss | `packages/server/src/services/orchestrator.ts` · `Orchestrator.finishWithMetering` | vorrangig aus den Meldungen der CLI, sonst aus dem Transkript — nie beides addiert |
| 3 | Zahlen nachtragen | 8 s nach Abschluss und am Ende des Nachlauffensters | `packages/server/src/services/orchestrator.ts` · `Orchestrator.scheduleLateReconcile` | `condition`: bis zum Ablauf des Fensters; danach gilt die Zahl als endgültig |
| 4 | Transkript-Grenzen festhalten | Phasenabschluss | `packages/server/src/services/orchestrator.ts` · `Orchestrator.persistTranscriptRange` | Pfad + Start-/End-Offset; Startmarke wird korrigiert, wenn die Datei während der Phase wechselte |
| 5 | Aufgaben erneut zählen | Phasenabschluss mit vorhandenem Worktree | `packages/server/src/services/artifacts.ts` · `parseTaskProgress` | liest `tasks.md` des Features neu |
| 6 | `after_phase`-Gate | nach dem Abschluss, vor dem Auto-Progress | `packages/server/src/services/orchestrator.ts` · `Orchestrator.runAfterPhaseGate` | `condition`: nur wenn Agents existieren; blockierender FAIL hält die Phase auf `awaiting_review` |

### 5.4 Stufe `integration` — „Integration"

*when*: „Nach der letzten Phase — automatisch bei Auto-Verify, sonst per Integrieren-Aktion."

| # | Schritt | Auslöser | Ort im Code | Zusatz |
|---|---|---|---|---|
| 1 | Vorprüfungen | Start der Integration | `packages/server/src/services/mergeQueueService.ts` · `MergeQueueService.beginIntegration` | Stufe muss `none` sein, Worktree vorhanden, ungemergte Änderungen da, mindestens eine Aufgabe erledigt |
| 2 | **Worktree festschreiben** | direkt nach den Vorprüfungen | `packages/server/src/services/mergeQueueService.ts` · `MergeQueueService.commitWorktree` | **`orderNote` (FR-009)**: MUSS vor dem Git-Abgleich laufen. Sonst hat der Branch keinen eigenen Commit, gilt trivial als Vorfahre des Ziels, der Abgleich hält ihn für „bereits gemergt" und eskaliert wegen der uncommitteten Dateien — **jede** Integration eskaliert, ohne dass je committet würde. |
| 3 | Zustand mit Git abgleichen | nach dem Festschreiben | `packages/server/src/services/mergeQueueService.ts` · `MergeQueueService.reconcile` | Selbstheilung: bereits gemergt → finalisieren; Verknüpfung kaputt → reparieren; Worktree weg und nicht gemergt → eskalieren |
| 4 | Verify-Kommandos ausführen | nach erfolgreichem Abgleich | `packages/server/src/services/verifyService.ts` · `runVerification` | `condition`: nur wenn im Projekt Verify-Kommandos konfiguriert sind; Fehlschlag eskaliert als `verify_failed` |
| 5 | Review-Gate-Agents laufen lassen | nach grüner Verifikation | `packages/server/src/services/agentGateService.ts` · `AgentGateService.runTrigger` | `condition`: nur bei eingeschalteten Review-Agents; sequentiell headless, erster blockierender FAIL eskaliert |
| 6 | Review-Berichte committen | nach dem Gate-Lauf | `packages/server/src/services/mergeQueueService.ts` · `MergeQueueService.commitWorktree` | `condition`: nur im Review-Gate-Pfad — die Berichte gehören versioniert zum Feature |
| 7 | Übergabe: Queue oder Human-Review | Abschluss der Integration | `packages/server/src/services/mergeQueueService.ts` · `MergeQueueService.enqueue` | `condition`: bei Auto-Merge in die Merge-Queue, sonst Stufe `awaiting_human_review` + Eintrag „Braucht dich" |

### 5.5 Stufe `merge` — „Merge"

*when*: „Merge-Queue-Worker, je Projekt streng sequentiell."

| # | Schritt | Auslöser | Ort im Code | Zusatz |
|---|---|---|---|---|
| 1 | Erneuter Git-Abgleich vor dem Merge | Item wird aus der Queue gezogen | `packages/server/src/services/mergeQueueService.ts` · `MergeQueueService.processItem` | bereits gemergt → abschließen; Worktree weg und nicht gemergt → eskalieren, Queue anhalten |
| 2 | Rebase auf das Ziel | nach dem Abgleich | `packages/server/src/git/mergeEngine.ts` · `MergeEngine.rebaseOnto` | existiert der Ziel-Branch noch nicht, ist der Default-Branch die Basis |
| 3 | Konflikte headless auflösen | Rebase meldet Konflikte | `packages/server/src/services/conflictResolver.ts` · `resolveConflicts` | `condition`: höchstens 3 Versuche; Diff vor/nach jeder Auflösung wird festgehalten; danach Eskalation |
| 4 | Erneut verifizieren | nach Konfliktauflösung oder Reviewer-Edits | `packages/server/src/services/verifyService.ts` · `runVerification` | `condition`: nur mit konfigurierten Verify-Kommandos und nur nach Auflösung/erzwungener Re-Verifikation — nie blind mergen |
| 5 | Merge nach eingestellter Strategie | grüne Verifikation | `packages/server/src/git/mergeEngine.ts` · `MergeEngine.mergeIntoTarget` | fast-forward oder squash; läuft in einem separaten temporären Worktree, der Haupt-Checkout wird nie umgeschaltet. `condition`: im PR-Modus stattdessen push + `gh pr create` |
| 6 | Abschluss und Aufräumen | erfolgreicher Merge | `packages/server/src/services/mergeQueueService.ts` · `MergeQueueService.cleanupMerged` | Session beenden, Worktree entfernen, Branch löschen, Worktree-Pfad am Feature leeren |

---

## 6. Zustandsübergänge

Der Katalog ist **zustandslos**: statische Beschreibung ohne Bezug zum Fortschritt eines
Features (Assumption „Keine Laufzeit-Verknüpfung"). Der einzige Zustand des Features ist der
Aufklappzustand einer Disclosure — `false` beim Mount, per Klick umgeschaltet, nicht
persistiert, ohne Wirkung auf andere Instanzen. Details:
[contracts/ui-contract.md](./contracts/ui-contract.md).

---

## 7. Nicht Teil des Modells

- Keine Verknüpfung Schritt ↔ laufender Ausführung, kein „läuft gerade".
- Keine editierbaren Felder, keine Persistenz, keine DB-Tabelle, keine Migration.
- Keine Kommandotexte, keine Trigger-Definitionen, keine Stack-Verwaltung (FR-016).
