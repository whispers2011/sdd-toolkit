# Phase 1 — Datenmodell: Workflow-Ansicht verschlanken

Dieses Feature führt **keine** persistierte Entität ein. Die Entitäten der Spec sind entweder
bereits vorhandene Typen oder reine Sichtstrukturen, die beim Rendern entstehen. Die Tabelle unten
bindet jede Spec-Entität an ihren konkreten Ort im Code.

## Spec-Entität → Typ im Code

| Spec-Entität | Typ / Konstante | Ort | Status |
|---|---|---|---|
| **Knoten** | `WorkflowNode` (neu, nur Sicht) | `WorkflowTriggerHub.tsx` | NEU |
| **Auslöserpunkt** | `LifecycleTrigger`, `AgentTrigger` | `packages/shared/src/types.ts` | vorhanden |
| ↳ Beschriftung | `LIFECYCLE_TRIGGER_META`, `AGENT_TRIGGER_META` | `workflowModel.ts` | vorhanden |
| ↳ Sichtform mit Einträgen | `TriggerPoint` (neu, nur Sicht) | `WorkflowTriggerHub.tsx` | NEU |
| **Eintrag** | `NodeStep`, `NodeAgent` | `WorkflowOverview.tsx:62` / `:69` | vorhanden |
| **Katalog-Eintrag** | `LifecycleCatalogStep` | `lifecycleCatalog.ts:58` | vorhanden, unverändert |
| **Integrationsstufe** | `IntegrationStep`, `LifecycleStageId` | `workflowModel.ts:302`, `types.ts:595` | ÄNDERT (`icon` entfällt) |
| **Board-Spalte** | `IntegrationColumn`, `INTEGRATION_COLUMN_LABELS` | `boardColumns.tsx:31` / `:44` | vorhanden (aus der Abhängigkeit) |
| ↳ Zuordnung Stufe → Spalte | `COLUMN_FOR_STEP` | `boardColumns.tsx` | NEU |

---

## Geänderte Typen

### `IntegrationStep` (`packages/shared/src/workflowModel.ts`)

```diff
 export interface IntegrationStep {
   id: LifecycleStageId;
   label: string;
   detail: string;
-  icon: string;
   requires?: keyof AutomationSettings;
   humanUnless?: keyof AutomationSettings;
   autoBy?: keyof AutomationSettings;
   escalatesTo?: IntegrationStage;
   showsReviewGateAgents?: boolean;
   terminal?: boolean;
 }
```

Und die sechs `icon: '…'`-Zeilen aus `INTEGRATION_STEPS` (FR-016).

**Verträglichkeit**: Kein Konsument im Baum liest das Feld — weder Anwendung noch Test. Der Wegfall
ist deshalb ohne Ersatz möglich; es gibt kein Fallback zu pflegen.

**Regel (FR-017)**: Jede Stufe besitzt genau ein SVG-Icon. Die Zuordnung liegt in der Ansicht
(`STEP_ICON`), nicht im Modell — das Modell ist UI-frei (`KEINE UI, KEIN IO`, Dateipräambel).

---

## Neue Typen

### `rejectTargetPhase` (`packages/shared/src/workflowModel.ts`)

```ts
/**
 * Phase, auf die eine abgelehnte manuelle Abnahme zurücksetzt: `specify`, wenn
 * aktiv, sonst die erste geordnete Phase. `null` bei leerer Phasenliste.
 */
export function rejectTargetPhase(ordered: readonly FeaturePhase[]): FeaturePhase | null;
```

| Regel | Ergebnis |
|---|---|
| `ordered` enthält `specify` | `'specify'` |
| `ordered` ohne `specify`, nicht leer | `ordered[0]` |
| `ordered` leer | `null` |

**Konsumenten**: `mergeQueueService.rejectManualTest` (mit `orderedPhases(feature.phases)`) und
`WorkflowOverview` (mit `orderedEnabledPhases(project.enabledPhases)`). Eine Regel, zwei Aufrufer —
das ist der Punkt (FR-013).

### `COLUMN_FOR_STEP` (`packages/web/src/components/boardColumns.tsx`)

```ts
/** Board-Spalte je Pipeline-Stufe — Gegenstück zu COLUMN_FOR_STAGE für die Stufen. */
export const COLUMN_FOR_STEP: Record<LifecycleStageId, IntegrationColumn> = {
  verify: 'verify',
  review_gate: 'verify',
  manual_test: 'accept',
  human_review: 'review',
  merge_queue: 'merge',
  merged: 'done',
};
```

`STEPS_FOR_COLUMN` wird daraus abgeleitet, statt weiter parallel gepflegt zu werden:

```ts
const STEPS_FOR_COLUMN = (column: IntegrationColumn): LifecycleStageId[] =>
  INTEGRATION_STEPS.filter((s) => COLUMN_FOR_STEP[s.id] === column).map((s) => s.id);
```

**Invarianten**

1. Vollständig über `Record<LifecycleStageId, …>` — eine neue Stufe bricht den Typcheck (FR-012, SC-010).
2. Die Werte sind eine Teilmenge von `IntegrationColumn` — eine neue Spalte ohne Zuordnung bricht
   den Typcheck an der Union.
3. Reihenfolge kommt **nicht** aus dieser Struktur, sondern aus `INTEGRATION_STEPS` (FR-010:
   „in Ausführungsreihenfolge").
4. Diese Zuordnung ist mit `COLUMN_FOR_STAGE` konsistent zu halten: die Stufe `manual_test` liegt in
   derselben Spalte wie der Zustand `awaiting_manual_test`, usw. Beide stehen bewusst nebeneinander
   in derselben Datei, damit die Konsistenz beim Lesen auffällt.

### `WorkflowNode` und `TriggerPoint` (`packages/web/src/components/WorkflowTriggerHub.tsx`)

Reine Sichtstrukturen, entstehen beim Rendern, werden nie gespeichert.

```ts
export type WorkflowNode =
  | { kind: 'worktree' }
  | { kind: 'phase'; phase: FeaturePhase }
  | { kind: 'stage'; step: IntegrationStep };

export type TriggerPoint =
  | { kind: 'step';  title: string; trigger: LifecycleTrigger; entries: NodeStep[] }
  | { kind: 'agent'; title: string; trigger: AgentTrigger;     entries: NodeAgent[] };
```

**Ableitungsregel** (`triggerPointsOf(node)` — die Liste wird **nicht** aufgezählt, sondern erzeugt):

| Knoten | Schritt-Punkte | Agent-Punkte |
|---|---|---|
| `worktree` | `before_worktree_create`, `after_worktree_create` | — |
| `phase` | `before_phase`, `after_phase` (je mit `phase`) | `before_phase`, `after_phase` (je mit `phase`) |
| `stage` | `before_stage`, `after_stage` (je mit `stage = step.id`) | `review_gate` — **nur wenn** `step.showsReviewGateAgents` |

`title` kommt immer aus `LIFECYCLE_TRIGGER_META[kind].title` bzw. `AGENT_TRIGGER_META[kind].label`,
nie aus einem lokalen Literal (FR-026).

**Reihenfolge innerhalb eines Knotens**: Schritt-Punkt „vor" → Agent-Punkt „vor" → Schritt-Punkt
„nach" → Agent-Punkt „nach". Das ist die Ausführungsreihenfolge und dieselbe, die die Ansicht heute
inline zeigt (Kommentar `WorkflowOverview.tsx:653`).

---

## Zustandsübergänge

Dieses Feature ändert **keine** Zustandsmaschine. Der einzige berührte Übergang ist der
Rücksprung, und er wird nur **dargestellt**, nicht verändert:

```text
awaiting_manual_test  --(Ablehnung mit Befund/Anmerkung)-->  integration = none
                                                             Zielphase = rejectTargetPhase(…) → idle
                                                             alles Nachgelagerte → stale
                                                             Befunde → Arbeitsauftrag an die Phase
```

Quelle: `mergeQueueService.rejectManualTest` (Fassung aus der Abhängigkeit). Die Ansicht liest
davon ausschließlich das Ziel über `rejectTargetPhase` und beschreibt die Wirkung im Popover-Text.

---

## Nicht-Entitäten (bewusst kein Modell)

| Was | Warum kein Typ |
|---|---|
| Offen/Zu eines `InfoPopover` | flüchtiger lokaler `useState`, je Instanz unabhängig — wie schon bei `LifecycleSteps` |
| Auf-/Zugeklappt eines Katalog-Abschnitts | ebenso, Startzustand zugeklappt (bestehendes Verhalten) |
| Sichtbarkeit der Rückkante | abgeleitet aus `automation.manualTestGate` (FR-015), kein eigener Zustand |
| Gruppierte Stufenliste | beim Rendern aus `INTEGRATION_STEPS` + `COLUMN_FOR_STEP` erzeugt, nicht gehalten |
