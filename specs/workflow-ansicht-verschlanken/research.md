# Phase 0 — Research: Workflow-Ansicht verschlanken

Erhoben am 31.07.2026 am Branch-Stand `fc48bf0`. Alle Aussagen über den Code sind nachgeprüft,
nicht aus der Spec übernommen.

## Bestandsaufnahme (was tatsächlich da ist)

| Frage | Befund | Fundstelle |
|---|---|---|
| Gibt es schon eine Popover-Mechanik? | Nein. Es gibt `TooltipLayer` — ein globaler Hover-Layer per Event-Delegation über `[title]`/`[data-tip]`. Er ignoriert `pointerType !== 'mouse'` (also **kein Touch**) und reagiert **nicht auf Fokus**. | `packages/web/src/components/Tooltip.tsx:63` |
| Gibt es einen wiederverwendbaren Dialog? | Ja: `Dialog({title, onClose, children, wide})`, schließt bei Klick auf den Hintergrund. Kein Escape-Handler, keine Fokusfalle. | `packages/web/src/components/Sidebar.tsx:635` |
| Sind SVG-Icons für alle sechs Stufen vorhanden? | Ja: `VerifyIcon`, `ScalesIcon`, `FlaskIcon`, `ReviewIcon`, `GitMergeIcon`, `CheckIcon`. Kein neues Icon nötig. | `packages/web/src/components/icons.tsx` |
| Wird `IntegrationStep.icon` irgendwo gelesen? | Nein — kein einziger Konsument im ganzen Baum, auch nicht in `workflowModel.test.ts`. Reines totes Feld. | grep über `packages/**` |
| Ist `STEP_ICON` wirklich unvollständig? | Ja: `manual_test` fehlt, `?? VerifyIcon` fängt das still ab → Abnahme zeigt das Icon der Verifikation. Zusätzlich kollidieren `review_gate → ShieldIcon` und `human_review → UserIcon` mit den Legendensymbolen für „Agent-Gate" und „Human-in-the-Loop". | `WorkflowOverview.tsx:1132`, `:1175` |
| Kann `@sdd/web` die Oberfläche testen? | Nein. `vitest.config.ts`: `include: ['src/**/*.test.ts']` (kein `.tsx`), `environment: 'node'`, kein testing-library im Baum. Die drei vorhandenen Tests prüfen reine Module. | `packages/web/vitest.config.ts` |
| Liegt die Board-Abhängigkeit im Branch? | Nein. `boardColumns.tsx` und `manualTestPrompt.ts` existieren nur uncommittet im Haupt-Checkout; beide Checkouts stehen auf `fc48bf0`. Im Branch setzt `rejectManualTest` noch `reopenLastPhase`. | `git status` in beiden Checkouts |

---

## D1 — Eine Info-Mechanik statt zwei

**Decision**: Ein einziges Bedienelement `InfoPopover` für **jede** hinter ein Info-Icon
verschobene Erklärung — kurz wie lang. Ein fokussierbarer `<button>` mit `InfoIcon`, der ein per
Portal an `document.body` gehängtes Panel öffnet (Klick oder Enter/Space), schließend auf Escape,
Klick daneben und Scrollen außerhalb des Panels.

**Rationale**: Die Spec-Assumption erlaubt zwei Wege (Tooltip-Layer für Kurztexte, Popover für
mehrteilige) — aber **FR-028 verlangt Tastaturfokus**, und der vorhandene `TooltipLayer` liefert
den nicht: er hängt an `pointerover` und steigt bei `pointerType !== 'mouse'` sofort aus. Ein
`title` auf einem nicht fokussierbaren `<span>` wäre auf Touch und Tastatur schlicht nicht
erreichbar — gegenüber dem heutigen Fließtext ein Funktionsverlust, genau der, den die Spec unter
„Bedienung ohne Maus" ausschließt. Eine Mechanik ist außerdem weniger Code als zwei und erfüllt die
Assumption-Vorgabe „Beides über dasselbe SVG-Info-Icon, damit die Bedienung einheitlich bleibt".

**Alternatives considered**:
- *`title` + TooltipLayer für Kurztexte*: verworfen — scheitert an FR-028 (Touch/Tastatur).
- *Natives `popover`-Attribut + CSS-Anchor-Positioning*: verworfen — Anchor-Positioning ist im
  Ziel-Browser zwar verfügbar, aber die App benutzt es nirgends; ein Portal mit
  `getBoundingClientRect` ist der Weg, den `TooltipLayer` bereits geht.
- *`Dialog` (Modal) für jede Erklärung*: verworfen — bei 7 Katalogeinträgen je Phase ist ein
  Vollbild-Modal je Zeile grob unverhältnismäßig und verdeckt genau den Ablauf, den man vergleicht.

**Folge für den Rest der App**: `TooltipLayer` bleibt unangetastet und weiterhin für die kurzen
Hover-Hinweise zuständig, die **nicht** durch dieses Feature verschoben werden (z. B. Statuspunkt,
„optional"-Marke, Chip-Titel).

---

## D2 — Langer Text im Popover: begrenzen und intern scrollen

**Decision**: Panel mit `max-width` ≈ 22rem, `max-height` ≈ 60vh und `overflow-y: auto`;
Platzierung unter dem Auslöser, oben wenn unten kein Platz ist; horizontal am Viewport geklemmt.
Ein Scroll-Ereignis **innerhalb** des Panels schließt es nicht.

**Rationale**: Edge Case der Spec: „Sehr langer Erklärtext (z. B. Präambel-Text,
Reihenfolge-Hinweis) muss vollständig lesbar bleiben, ohne die Ansicht zu verdecken oder
abgeschnitten zu werden." Der längste reale Text ist die `condition` von `run-verify-commands`
(≈ 380 Zeichen) und der Präambel-Block des Wissens-Abschnitts. Der linke Fluss liegt in einem
`overflow-auto`-Container — ohne Portal würde das Panel dort abgeschnitten.

**Alternatives considered**: Panel ohne Höhenbegrenzung (kann bei kleinen Fenstern über den
Viewport hinausragen); Inline-Aufklappen statt Popover (verlängert wieder genau die Zeile, die
einzeilig sein soll — FR-007).

---

## D3 — Ein Einstieg je Knoten: Dialog statt Inline-Menü

**Decision**: `WorkflowTriggerHub` — ein unbeschriftetes `+`-Bedienelement im Kopf jedes Knotens
öffnet einen `Dialog` (wiederverwendet aus `Sidebar.tsx`), der **alle** Auslöserpunkte dieses
Knotens auflistet: je Punkt Titel aus `LIFECYCLE_TRIGGER_META`/`AGENT_TRIGGER_META`, die dort
hängenden Einträge und eine Anlege-Schaltfläche. Bei Agent-Punkten führt sie in den vorhandenen
`AgentSlotPicker` („neu erstellen ODER bestehenden einhängen"), bei Schritt-Punkten direkt in den
`LifecycleStepEditDialog` mit vorbelegtem Auslöser.

**Rationale**: SC-002 verlangt „höchstens zwei Interaktionen (Einstieg öffnen, Punkt wählen)" —
genau die Struktur eines Dialogs mit Punktliste. FR-003 verlangt, dass der heutige Funktionsumfang
inklusive Agent-Slot-Auswahl erhalten bleibt; der `AgentSlotPicker` existiert bereits und wird
weiterverwendet statt nachgebaut. `Dialog` bringt Hintergrundklick-Schließen mit.

**Alternatives considered**:
- *Popover-Menü statt Dialog*: verworfen — die Punktliste zeigt pro Punkt bereits vorhandene
  Einträge; das wird schnell höher als ein Popover trägt.
- *„+" an jeder Zone belassen und Zonen nur ausblenden*: verworfen — dann wäre der leere Punkt
  gar nicht mehr erreichbar (FR-002 fordert ausdrücklich Erreichbarkeit **auch der leeren**).

**Konsequenz**: Die heutigen „+"-Schaltflächen in `AgentZone`/`StepZone` und in der
Review-Gate-Agentenzone entfallen — es bleibt **genau einer** je Knoten (FR-002).

---

## D4 — Die Auslöserpunkte eines Knotens werden abgeleitet, nicht aufgezählt

**Decision**: Eine reine Funktion liefert je Knotenart die Punkte:

- `worktree` → Schritt-Punkte `before_worktree_create`, `after_worktree_create`
- `phase` → Schritt-Punkte `before_phase`/`after_phase` + Agent-Punkte `before_phase`/`after_phase`
- `stage` → Schritt-Punkte `before_stage`/`after_stage` + Agent-Punkt `review_gate`, **abgeleitet
  aus `step.showsReviewGateAgents`**, nicht aus dem Literal `'review_gate'`

**Rationale**: FR-026 („kein handgeschriebener Zweittext, der veralten kann") gilt auch für die
Struktur. `showsReviewGateAgents` ist das bereits vorhandene Flag im Modell, das genau diese Frage
beantwortet; würden die Review-Agents an eine andere Stufe wandern, zöge der Hub automatisch mit.

**Alternatives considered**: eine Konstante `TRIGGER_POINTS_PER_NODE` — verworfen, wäre eine dritte
Liste neben `LIFECYCLE_TRIGGER_META` und `AGENT_TRIGGER_META`.

---

## D5 — Zuordnung Stufe → Board-Spalte: `COLUMN_FOR_STEP` in `boardColumns.tsx`

**Decision**: In `boardColumns.tsx` wird `COLUMN_FOR_STEP: Record<LifecycleStageId,
IntegrationColumn>` ergänzt; das vorhandene, heute handgepflegte `STEPS_FOR_COLUMN` wird **daraus
abgeleitet** (Filter über `INTEGRATION_STEPS` in Modellreihenfolge) statt weiter parallel gepflegt.
Die Spaltenreihenfolge der Workflow-Ansicht entsteht ebenfalls aus `INTEGRATION_STEPS` (erste
Stufe je Spalte gibt die Position), nicht aus einer Reihenfolge-Konstante.

**Rationale**: FR-011 verbietet eine zweite, in der Ansicht gepflegte Liste. `COLUMN_FOR_STAGE`
beantwortet eine **andere** Frage (in welcher Spalte liegt eine Karte im Zustand X) als die
Workflow-Ansicht stellt (unter welcher Spaltenüberschrift steht Pipeline-Stufe Y) — die beiden
Schlüsselmengen (`IntegrationStage` vs. `LifecycleStageId`) überschneiden sich nur zufällig. Statt
eine der beiden zu verbiegen, bekommt die Stufen-Frage ihre eigene, **eine** getypte Antwort, die
neben `COLUMN_FOR_STAGE` in derselben Datei steht und von beiden Ansichten benutzt wird. Dass
`STEPS_FOR_COLUMN` daraus abgeleitet wird, entfernt zugleich die heute schon vorhandene Dopplung.

**Alternatives considered**:
- *Spaltenzuordnung nach `packages/shared` verschieben*: verworfen — `Column` schließt
  `FeaturePhase` ein und die Datei enthält React-Komponenten; ein Umzug wäre ein eigenes Refactoring
  ohne Nutzen für dieses Feature (beide Konsumenten liegen in `web/components`).
- *`COLUMN_FOR_STEP` in `WorkflowOverview.tsx`*: verworfen — genau die von FR-011 verbotene zweite
  Liste.
- *Ableitung aus `COLUMN_FOR_STAGE` über eine „repräsentative Stage je Stufe"*: verworfen — das
  wäre eine weitere Zuordnung, um eine Zuordnung zu vermeiden.

**Drift-Guard**: `Record<LifecycleStageId, IntegrationColumn>` bricht bei einer neuen Stufe,
`Record<IntegrationStage, Column>` bei einem neuen Zustand, `IntegrationColumn` als Union bei einer
neuen Spalte (SC-010, FR-012). Ein zusätzlicher Unit-Test ist **nicht** vorgesehen: er könnte nur
wiederholen, was der Typ schon erzwingt, und `boardColumns.tsx` ist wegen des JSX im node-Vitest
ohne React-Plugin gar nicht importierbar (siehe Bestandsaufnahme).

---

## D6 — Rücksprungziel: ein geteilter Helfer in `workflowModel.ts`

**Decision**: Neu in `packages/shared/src/workflowModel.ts`:

```ts
/** Phase, auf die eine abgelehnte manuelle Abnahme zurücksetzt. */
export function rejectTargetPhase(ordered: readonly FeaturePhase[]): FeaturePhase | null
```

Regel unverändert aus dem Server übernommen: `specify`, wenn aktiv, sonst die erste geordnete Phase,
sonst `null`. `mergeQueueService.rejectManualTest` ruft den Helfer mit
`orderedPhases(feature.phases)`; die Workflow-Ansicht ruft ihn mit `orderedEnabledPhases(project.enabledPhases)`.

**Rationale**: FR-013 verlangt ausdrücklich, dass die Zielphase „aus dem geltenden Rücksprungziel
abgeleitet und nicht als Literal in der Ansicht hinterlegt" ist. Ein Literal `'specify'` in der
Ansicht wäre heute richtig und ab dem Tag falsch, an dem `specify` abschaltbar wird — still. Die
Extraktion ist verhaltensgleich (dieselbe Bedingung, dieselbe Reihenfolge) und von der
Spec-Assumption „falls nötig … das Bereitstellen der Spalten- und Rücksprung-Zuordnung an einer von
beiden Ansichten nutzbaren Stelle" gedeckt.

**Alternatives considered**: Helfer in `phaseMachine.ts` — verworfen, dort steht die
Zustandsmaschine der Phasen; die Rücksprungregel gehört zur Workflow-*Struktur*, die die Ansicht
rendert. Server-Endpunkt, der das Ziel liefert — verworfen, ein Netzaufruf für eine reine Funktion.

**Testbar**: ja, pure Funktion → ein Fall je Zweig in `workflowModel.test.ts` (mit `specify`, ohne
`specify`, leere Liste).

---

## D7 — Icon-Zuordnung je Stufe

**Decision**: `icon: string` entfällt aus `IntegrationStep`. In `WorkflowOverview.tsx` wird
`STEP_ICON` zu `Record<LifecycleStageId, ComponentType<IconProps>>` **ohne** `??`-Fallback:

| Stufe | Icon | heute | Grund |
|---|---|---|---|
| `verify` | `VerifyIcon` | `VerifyIcon` | unverändert |
| `review_gate` | `ScalesIcon` | `ShieldIcon` | `⚖` des alten Emoji-Feldes; `ShieldIcon` ist in der Legende „Agent-Gate" |
| `manual_test` | `FlaskIcon` | *(fehlt → VerifyIcon)* | `🧪`; dasselbe Icon, das das Board für die Spalte „Abnahme" benutzt |
| `human_review` | `ReviewIcon` | `UserIcon` | `UserIcon` ist in der Legende „Human-in-the-Loop"; `ReviewIcon` ist das Board-Icon der Spalte „Review" |
| `merge_queue` | `GitMergeIcon` | `GitMergeIcon` | unverändert |
| `merged` | `CheckIcon` | `CheckIcon` | unverändert |

**Rationale**: SC-007 verlangt sechs **paarweise verschiedene** Icons. Die beiden Umbelegungen
lösen zusätzlich eine Doppelbedeutung gegenüber der Legende und lassen Workflow-Ansicht und Board
dieselben Symbole für dieselben Abschnitte zeigen — Rückenwind für US3.

**Alternatives considered**: `COLUMN_ICONS` des Boards direkt wiederverwenden — verworfen, das ist
je *Spalte*; `verify` und `review_gate` liegen in derselben Spalte und bekämen dasselbe Icon.

---

## D8 — Darstellung der Rückkante

**Decision**: Unterhalb der Spaltengruppe „Abnahme" eine eigene, farblich abgesetzte Zeile:
Pfeil nach oben (`ArrowRightIcon` um −90° gedreht), Kurzbeschriftung
„Ablehnung → «Zielphasen-Label»" und ein `InfoPopover` mit der Wirkung (Befunde als Arbeitsauftrag
in die bestehende Spezifikation, Nachgelagertes als veraltet markiert, Lebenszyklus läuft erneut).
Gerendert nur, wenn `automation.manualTestGate === true` (FR-015).

**Rationale**: SC-006 („erkennbar, ohne einen Fließtext zu lesen") verlangt eine Richtung und ein
Ziel, nicht eine gezeichnete Kurve. Der Fluss ist ein vertikaler Flex-Stapel; eine echte
SVG-Overlay-Kante bräuchte Positionsmessung aller Knoten und würde bei jedem Aufklappen neu
berechnet werden müssen — viel Mechanik für dieselbe Aussage.

**Alternatives considered**: SVG-Overlay mit gemessenen Ankerpunkten (deutlich mehr Code, bricht
bei aufklappbaren Abschnitten); ein Rand-„Gutter" mit durchgezogener Linie über die ganze Höhe
(optisch schwer, verdrängt Inhalt).

---

## D9 — Zwei Abschnitte je Phase: Titel und Einzeiler

**Decision**: `LifecycleSteps` beschriftet sich mit `lifecycleStage(stage).title` plus Anzahl —
also „Phasenstart (7)" und „Phasenende (6)". Aufgeklappt: je Eintrag **eine** Zeile
`«n». «name»` + `InfoPopover` mit `description`, `trigger` („Wann"), `location.file · location.symbol`,
`condition` („Nur wenn") und `orderNote` („Reihenfolge"). Am Abschnitt selbst ein zweites
`InfoPopover` mit `when` und `notDoneHere`.

**Rationale**: FR-006 verlangt Ableitung aus dem Katalog — die Titel stehen dort seit jeher
(`LIFECYCLE_CATALOG.phase_start.title = 'Phasenstart'`), die Ansicht benutzt sie nur nicht. FR-007
verlangt genau eine Zeile, FR-008 die Vollständigkeit aller fünf Felder. Der Zähler bleibt, weil
er heute den einzigen Hinweis auf den Umfang gibt und FR-024 die kurzen Statusangaben schützt.

**Alternatives considered**: Titel + Untertitel zweizeilig — verworfen (FR-007). `orderNote` weiter
inline hervorgehoben lassen, weil er wichtig ist — verworfen: FR-008 nennt ihn ausdrücklich als
Popover-Inhalt, und er ist mit Abstand der längste Text je Eintrag.

---

## D10 — Was inline bleibt, damit die Zuordnung ohne Dialog erkennbar ist

**Decision**: Belegte Auslöserpunkte bleiben als Zone bestehen — mit Titel aus
`LIFECYCLE_TRIGGER_META`/`AGENT_TRIGGER_META`, aber **ohne** „+"-Schaltfläche und **ohne**
„— keiner"-Zweig. Eine Zone ohne Einträge wird gar nicht erst gerendert.

**Rationale**: FR-005 („Zu welchem Auslöserpunkt ein sichtbarer Eintrag gehört, MUSS ohne Öffnen
eines Dialogs erkennbar sein") ist mit der vorhandenen Zonenüberschrift bereits erfüllt — die
kleinste Änderung ist, die Zone bedingt zu rendern und ihr die Schaltfläche zu nehmen. Alle
Kennzeichen der Chips (blockierend/beratend, global, erzwungen/aus, wirksam/unwirksam) bleiben
unverändert (FR-004), ebenso der Edge Case „konfiguriert, aber für dieses Feature unwirksam": das
ist ein belegter Punkt und bleibt sichtbar.

**Alternatives considered**: Einträge ohne Zonengruppierung als flache Liste mit Auslöser-Chip je
Eintrag (`lifecycleTriggerChip` existiert dafür) — verworfen: bei mehreren Einträgen am selben
Punkt wiederholt sich der Chip, und die Ausführungsreihenfolge Schritte→Agents wäre nicht mehr
ablesbar.

---

## Offene Punkte

Keine. Alle Fragen der Technical Context sind beantwortet; kein `NEEDS CLARIFICATION` verbleibt.
Die einzige Unbekannte ist **kein Wissensproblem, sondern ein Termin**: wann der Board-Stand aus
dem Haupt-Checkout im Branch liegt (siehe Blocker in [plan.md](./plan.md)).
