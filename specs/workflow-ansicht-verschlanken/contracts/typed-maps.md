# Contract — Modul-Schnittstellen

Die Workflow-Ansicht ist ein internes UI-Modul ohne HTTP-, CLI- oder Bibliotheks-Schnittstelle nach
außen. Der Vertrag, der hier zählt, ist der zwischen den Modulen: **welche Exporte andere Module
sehen und welche Zusicherung der Typ trägt.** Genau daran hängen FR-011, FR-012, FR-016, FR-017 und
SC-010.

Legende: ⊕ neu · ✎ geändert · = unverändert (nur zur Abgrenzung genannt)

---

## `@sdd/shared` — `packages/shared/src/workflowModel.ts`

### ✎ `IntegrationStep`

```ts
export interface IntegrationStep {
  id: LifecycleStageId;
  label: string;
  detail: string;
  // icon: string;   ← ENTFÄLLT (FR-016)
  requires?: keyof AutomationSettings;
  humanUnless?: keyof AutomationSettings;
  autoBy?: keyof AutomationSettings;
  escalatesTo?: IntegrationStage;
  showsReviewGateAgents?: boolean;
  terminal?: boolean;
}
```

**Zusicherung**: Das Modell trägt kein Darstellungssymbol mehr. Wer eine Stufe anzeigt, holt ihr
Icon aus der Ansicht-seitigen Zuordnung (siehe `STEP_ICON` unten).

**Bruchverhalten**: Ein zurückgelassenes `icon:`-Feld in `INTEGRATION_STEPS` ist ein
Excess-Property-Fehler → `pnpm typecheck` bricht. Kein Konsument liest das Feld heute (geprüft über
den gesamten Baum), es entfällt daher ersatzlos.

### ⊕ `rejectTargetPhase`

```ts
export function rejectTargetPhase(ordered: readonly FeaturePhase[]): FeaturePhase | null;
```

**Zusicherung**: Genau eine Definition des Rücksprungziels für Server **und** Ansicht.
`'specify'`, wenn in `ordered` enthalten; sonst `ordered[0]`; sonst `null`.

**Bruchverhalten**: rein; keine Ausnahme, kein IO. Abgesichert in `workflowModel.test.ts`
(drei Fälle, siehe [data-model.md](../data-model.md)).

### = `INTEGRATION_STEPS`, `stageTitle`, `LIFECYCLE_TRIGGER_META`, `AGENT_TRIGGER_META`, `PHASE_META`

Unverändert. Bleiben die Quelle **aller** Beschriftungen der Ansicht (FR-026).

---

## `@sdd/server` — `packages/server/src/services/mergeQueueService.ts`

### ✎ `MergeQueueService.rejectManualTest` (verhaltensgleich)

```diff
- const target = 'specify' in feature.phases ? 'specify' : orderedPhases(feature.phases)[0];
+ const target = rejectTargetPhase(orderedPhases(feature.phases));
```

**Zusicherung**: Öffentliches Verhalten unverändert — dieselbe Zielphase, derselbe
`discardPhase`/`reopenLastPhase`-Zweig, derselbe Arbeitsauftrag. Es ist eine Extraktion, keine
Logikänderung.

> **Achtung Reihenfolge**: `'specify' in feature.phases` prüft heute die **Existenz des Schlüssels**
> in der Phasenmap, `orderedPhases` liefert die **aktiven** Phasen in Modellreihenfolge. Beim
> Umstellen ist sicherzustellen, dass `orderedPhases(feature.phases)` `specify` genau dann enthält,
> wenn es der alte Ausdruck getan hätte. Ist das nicht der Fall, gilt das alte Verhalten und der
> Helfer bekommt stattdessen die Phasenmap als Eingabe. Die vorhandenen Tests in
> `mergeQueueService.test.ts` müssen unverändert grün bleiben — sie sind hier das Urteil.

---

## `@sdd/web` — `packages/web/src/components/boardColumns.tsx`

### ⊕ `COLUMN_FOR_STEP`

```ts
export const COLUMN_FOR_STEP: Record<LifecycleStageId, IntegrationColumn>;
```

**Zusicherung**: Die **eine** Zuordnung Pipeline-Stufe → Board-Spalte, benutzt vom
Spalten-Erklärdialog des Boards und von der Workflow-Ansicht (FR-011).

**Bruchverhalten**: Neue Stufe in `INTEGRATION_STAGE_IDS` ohne Eintrag → Typcheck bricht hier.
Neue Spalte, die nirgends zugeordnet wird → sie erscheint in keiner Ansicht, und der Erklärdialog
des Boards hat für sie keine Schritte; die Union `IntegrationColumn` erzwingt beim Ergänzen die
Entscheidung an dieser Stelle (FR-012, SC-010).

### ✎ `STEPS_FOR_COLUMN` — abgeleitet statt gepflegt

Die heute handgeschriebene Konstante wird durch eine Ableitung über `INTEGRATION_STEPS` und
`COLUMN_FOR_STEP` ersetzt. Damit gibt es die Zuordnung nur noch einmal.

### = `COLUMN_FOR_STAGE`, `columnOf`, `INTEGRATION_COLUMN_LABELS`, `IntegrationColumnDialog`

Unverändert. `COLUMN_FOR_STAGE` beantwortet weiterhin die Zustandsfrage („wo liegt eine Karte im
Zustand X"), `COLUMN_FOR_STEP` die Stufenfrage („unter welcher Überschrift steht Stufe Y").

---

## `@sdd/web` — `packages/web/src/components/InfoPopover.tsx` (⊕ neu)

```ts
export function InfoPopover(props: {
  /** Kurzer Titel im Panelkopf — benennt, was erklärt wird. */
  label: string;
  /** Panelinhalt. Beliebige Knoten, damit Felder strukturiert bleiben können. */
  children: React.ReactNode;
  /** Optische Größe/Ton des Auslösers, Vorgabe: unauffällig (text-zinc-600). */
  className?: string;
}): React.ReactElement;
```

**Verhaltensvertrag** (das ist der prüfbare Teil — FR-028, Edge Cases „Bedienung ohne Maus" und
„Sehr langer Erklärtext"):

| Zusicherung | Prüfung |
|---|---|
| Auslöser ist ein echter `<button type="button">` mit `aria-expanded` und `aria-label` aus `label` | Tab-Fokus erreicht ihn; Screenreader liest ihn |
| Öffnet per Klick, Enter und Space | Tastaturbedienung ohne Maus |
| Öffnet auch per Touch (kein Hover-Zwang) | Bedienung auf Touch-Geräten |
| Schließt per Escape, Klick daneben, Fokusverlust nach außen | keine hängenden Panels |
| Schließt beim Scrollen **außerhalb** des Panels, nicht beim Scrollen **darin** | langer Text bleibt lesbar |
| Panel hängt per Portal an `document.body`, `position: fixed` | wird vom `overflow-auto`-Container des Flusses nicht abgeschnitten |
| `max-height` mit eigenem `overflow-y`, `max-width` begrenzt, Platzierung kippt bei Platzmangel nach oben | vollständig lesbar, verdeckt die Ansicht nicht |
| Fokus kehrt beim Schließen auf den Auslöser zurück | Tastaturfluss bleibt erhalten |

**Abgrenzung**: `InfoPopover` ersetzt **nicht** den globalen `TooltipLayer`. Der bleibt für die
kurzen Hover-Hinweise zuständig, die dieses Feature nicht anfasst (Statuspunkt, „optional"-Marke,
Chip-Titel, Einstellungszeilen).

---

## `@sdd/web` — `packages/web/src/components/WorkflowTriggerHub.tsx` (⊕ neu)

```ts
export type WorkflowNode =
  | { kind: 'worktree' }
  | { kind: 'phase'; phase: FeaturePhase }
  | { kind: 'stage'; step: IntegrationStep };

/** Das unbeschriftete „+" am Knoten — genau eines je Knoten (FR-002). */
export function TriggerHubButton(props: { onOpen: () => void; nodeLabel: string }): React.ReactElement;

/** Der Dialog dahinter: alle Auslöserpunkte des Knotens, auch die leeren (FR-003). */
export function WorkflowTriggerHub(props: {
  node: WorkflowNode;
  nodeLabel: string;
  stepsFor: (t: LifecycleTrigger) => NodeStep[];
  agentsFor: (kind: AgentTrigger['kind'], phase?: FeaturePhase) => NodeAgent[];
  onAddStep: (t: LifecycleTrigger) => void;
  onAddAgent: (t: AgentTrigger) => void;
  onEditStep: (s: LifecycleStep) => void;
  onEditAgent: (a: AgentDefinition) => void;
  onClose: () => void;
}): React.ReactElement;
```

**Verhaltensvertrag**:

| Zusicherung | Bezug |
|---|---|
| Zeigt **alle** Auslöserpunkte des Knotens, belegte wie leere | FR-002 |
| Je Punkt: Titel aus den Meta-Konstanten, die dort hängenden Einträge, eine Anlege-Schaltfläche | FR-003, FR-026 |
| Anlegen eines Schritts ⇒ `onAddStep` mit vorbelegtem Auslöser ⇒ `LifecycleStepEditDialog` | FR-003 |
| Anlegen eines Agents ⇒ `onAddAgent` ⇒ vorhandener `AgentSlotPicker` („neu erstellen ODER bestehenden einhängen") | FR-003, FR-027 |
| Bestehende Einträge sind aus dem Hub heraus per Klick editierbar | FR-004 |
| Erreichbarkeit jedes Punktes: Hub öffnen → Punkt wählen = 2 Interaktionen | SC-002 |
| Der Hub bleibt auch dann vorhanden, wenn alle Punkte belegt sind | Edge Case „Alle Auslöserpunkte belegt" |
| Eine abgeschaltete Phase erzeugt keinen Knoten, also auch keinen Hub | Edge Case „Phase abgeschaltet" |
