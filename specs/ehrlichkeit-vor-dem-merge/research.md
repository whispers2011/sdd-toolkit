# Phase 0 — Research: Ehrlichkeit vor dem Merge

**Offene Punkte aus Technical Context**: keine. Die Spezifikation enthält eine
Clarification-Session (30.07.2026), die die vier offenen Fragen entschieden hat; alle übrigen
Angaben ließen sich am Code belegen. Es bleibt kein `NEEDS CLARIFICATION`.

Alle Befunde unten sind am Stand des Branches `feature/ehrlichkeit-vor-dem-merge` geprüft
(Dateien und Zeilen sind angegeben, damit die Umsetzung nicht erneut suchen muss).

---

## D1 — Name, Beschriftung und Ton der neuen Integrationsstufe

**Decision**: Stufe `verification_unconfigured` in `IntegrationStage`
(`packages/shared/src/types.ts:32-43`), eingefügt unmittelbar nach `verifying`. Beschriftung in
`INTEGRATION_STAGE_META` (`workflowModel.ts:171`): `label: 'keine Verifikation konfiguriert'`,
`tone: 'human'`.

**Rationale**: Der Bezeichner sagt genau, was der Zustand ist, und ist von `verify_failed`
(gelaufen und rot) sowie von `verifying` (läuft) nicht verwechselbar. `tone: 'human'` ist der
bestehende Amber-Ton, dessen Konvention laut Kopfkommentar in `workflowModel.ts:150-158` „hier ist
der Mensch am Zug" bedeutet — das trifft zu: die Konfiguration fehlt und nur ein Mensch kann sie
nachholen. `escalation` (rot) wäre falsch, weil FR-010 jede Eskalation ausschließt; `progress`
(sky) wäre falsch, weil nichts läuft.

**Alternatives considered**:
- Neuer Ton `warning` in `INTEGRATION_TONE_CLASS`: zusätzliche Farbe, die sich von Amber kaum
  unterscheiden ließe, ohne dass ein neuer Bedeutungsunterschied entstünde.
- Stufenname `unverified`: kürzer, aber nicht von „Verifikation lief und war rot" abgrenzbar.

---

## D2 — Wo die Stufe gesetzt und wo der Aufmerksamkeits-Eintrag erzeugt wird

**Decision**: In `MergeQueueService.beginIntegration()`
(`packages/server/src/services/mergeQueueService.ts:217-303`):

1. Zeile 239 (`this.setStage(feature, 'verifying')`) wird zur Verzweigung: bei
   `project.verifyCommands.length === 0` wird `verification_unconfigured` gesetzt, sonst
   unverändert `verifying`.
2. Der Aufmerksamkeits-Eintrag entsteht im `else`-Zweig der bestehenden Prüfung
   `if (project.verifyCommands.length > 0)` (Zeile 252) — also **nach** `commitWorktree()` und
   **nach** `reconcile() === 'proceed'`, an genau der Stelle, an der sonst
   `runVerification()` läuft.

**Rationale**: Die Stufe wird früh gesetzt, damit kein Zeitfenster existiert, in dem eine
Oberfläche „Verifikation läuft" zeigt, obwohl keine konfiguriert ist (FR-002). Der *Eintrag*
entsteht dagegen erst am Punkt der Verifikation: die Spec-Annahme lautet „erst wenn ein
Integrationsversuch die Verifikationsstufe tatsächlich erreicht — also nach den bestehenden
Vorprüfungen", und der Edge Case „Versuch scheitert an einer Vorprüfung ⇒ kein Eintrag" fällt damit
automatisch heraus. Auch die Abzweigungen von `reconcile()` (`'merged'`, `'lost'`) erzeugen so
keinen Eintrag — sie erreichen die Verifikation nie.

**Alternatives considered**:
- Eintrag direkt beim Setzen der Stufe: würde bei einem Feature, das `reconcile()` sofort als
  „bereits gemergt" abschließt, eine Meldung erzeugen, obwohl nie ein Integrationsversuch bis zur
  Verifikation kam — widerspricht dem Edge Case.
- Eintrag beim Speichern der Projektkonfiguration (leere `verifyCommands`): würde Projekte melden,
  die nie ein Feature integrieren; FR-004 knüpft ausdrücklich an den ersten Integrationsversuch.

---

## D3 — Lebensdauer des Projekt-Eintrags: eine Wahrheit, kein Parallel-Flag

**Decision**: Neue `AttentionKind`-Art `verification_unconfigured` mit `featureId: null`
(projektbezogen). Die Lebensdauer wird ausschließlich aus der `attention`-Tabelle abgeleitet, über
zwei neue `AttentionRepo`-Methoden:

- `hasEver({ kind, projectId })` — existiert für dieses Projekt **irgendeine** Zeile dieser Art
  (offen oder aufgelöst)? Ist sie wahr, wird nicht erneut gemeldet (FR-005 und Clarification:
  „wer ihn wegklickt, verzichtet auf die Erinnerung").
- `forget({ kind, projectId })` — löscht alle Zeilen dieser Art des Projekts und liefert die IDs
  der zuvor offenen zurück (für `attention_resolved`). Wird aufgerufen, sobald das Projekt
  mindestens ein Verifikationskommando hat (FR-007) und stellt zugleich her, dass ein späteres
  Leeren der Konfiguration wieder meldet („beim nächsten Leeren entsteht der Eintrag erneut").

Aufgerufen wird `forget` im bestehenden Reconcile-Durchlauf
(`Orchestrator.reconcileOpenAttention()`, `orchestrator.ts:1302`), der auf dem Lesepfad
(`/api/state` → `server.ts:152`, `/api/attention` → `server.ts:960`) und nach Session-Ereignissen
läuft. Damit löst sich der Eintrag ohne menschliches Zutun und ohne neue Route, auch nach einem
Neustart.

`STAGE_FOR_KIND` (`attentionReconciler.ts:22-27`) erhält **keinen** Eintrag — die Art ist nicht an
eine Stufe gekoppelt (FR-006). In `isAttentionValid()` wird die Art als eigener `case` mit `return
true` und Kommentar geführt, statt in den `default`-Zweig zu fallen: die Gültigkeit kommt aus der
Projektkonfiguration, nicht aus Session- oder Stufenzustand.

**Rationale**: Ein zweites Speicherfeld („schon gemeldet"-Flag in `settings`) würde denselben
Sachverhalt doppelt führen und könnte von der Tabelle abweichen. Die Dedup-Logik von
`AttentionRepo.raise()` (`repos.ts:717-727`) deckt nur *offene* Duplikate ab und reicht daher
nicht: ein abgehakter Eintrag würde beim nächsten Feature erneut entstehen. Mit `hasEver`/`forget`
ist die Tabelle die einzige Quelle, und die Clarification-Semantik („abhakbar, kommt nicht wieder;
Kennzeichnung bleibt") fällt direkt heraus.

Die `attention`-Tabelle hat keine Historien-Oberfläche (gelesen wird ausschließlich über
`listOpen()`), das Löschen verliert also keine sichtbare Information.

**Alternatives considered**:
- Settings-Flag je Projekt (`verifyGapNotified:<projectId>`): zweiter Zustand, driftfähig, mehr
  Code an mehr Stellen.
- Auflösen im `PATCH /api/projects/:id`-Handler statt im Reconcile: griffe nur beim
  Speichern über die Oberfläche und wäre nach einem Neustart oder bei direkter DB-Änderung stumm.
- Art in `STAGE_FOR_KIND` eintragen: würde den Eintrag bei jedem Stufenwechsel eines Features
  auflösen — genau der von FR-006 verbotene Fall.

---

## D4 — Meldungstexte in einem puren Shared-Modul

**Decision**: Neues Modul `packages/shared/src/integrationMessages.ts` mit drei puren Funktionen
(Vertrag in `contracts/domain.md`):

- `taskProgressText({ tasksDone, tasksTotal })`
  → `'68/76 erledigt, 8 offen'` · `'76/76 erledigt, keine offen'` · `'keine Aufgabenliste vorhanden'`
- `reviewDueMessage(feature, { verificationConfigured })`
  → konfiguriert: `'<name>: verifiziert — bereit für dein Review & Merge · 68/76 erledigt, 8 offen'`
  → nicht konfiguriert: `'<name>: keine Verifikation konfiguriert — es wurde nichts geprüft; bereit für dein Review & Merge · 68/76 erledigt, 8 offen'`
- `mergedNotificationBody(feature, target)` → `'<name> → main · 68/76 erledigt, 8 offen'`

**Rationale**: Der Wortlaut ist Teil der Abnahme (SC-001, SC-003) und muss testbar sein, ohne
Server, DB oder Git zu starten — dasselbe Muster wie `ACTION_REASON` in `actionPolicy.ts:121` und
`DECISION_REASON`. Für konfigurierte Projekte bleibt der Verifikationsteil des Satzes wortgleich
zum heutigen `mergeQueueService.ts:296` (FR-011); ergänzt wird ausschließlich der Aufgabenstand,
den FR-011 ausdrücklich ausnimmt.

Bei widersprüchlicher Zählung (`tasksDone > tasksTotal`, Edge Case) werden die Rohwerte gezeigt und
die offenen Aufgaben auf 0 begrenzt (`Math.max(0, total - done)`) — nichts wird zurechtgebogen,
aber es steht auch keine negative Zahl da.

**Alternatives considered**:
- Text inline in `mergeQueueService.ts`: nicht ohne DB testbar, und der Aufgabenstand müsste an
  drei Stellen identisch formuliert werden (review_due, lokaler Merge, PR-Merge).
- Nur den Zahlenteil auslagern: der heikle Teil ist der Verifikationssatz — genau er gehört in den
  Test.

---

## D5 — Meldung über den vollzogenen Merge auf beiden Merge-Pfaden

**Decision**: `mergedNotificationBody()` wird in beiden Merge-Meldungen verwendet: lokaler Merge
(`mergeQueueService.ts:564-569`) und PR-Modus (`:618-623`).

**Rationale**: FR-012a begründet die Ergänzung damit, dass dies auf dem Auto-Merge-Pfad die
einzige Gelegenheit ist, den Stand zu sehen. Der PR-Pfad ist derselbe Fall (auch dort gibt es kein
menschliches Review-Halt), und der Edge Case „Integration über Pull Request" verlangt gleiche
Behandlung. Der Zusatz erscheint auch, wenn zuvor ein Review stattfand — er ist dann redundant,
aber nie falsch; eine Sonderfallunterscheidung wäre mehr Code für weniger Information.

**Alternatives considered**: nur der `autoMerge`-Pfad — bräuchte eine Bedingung, die die
Automation-Auflösung (`automationFor()`) an einer weiteren Stelle wiederholt.

---

## D6 — Verifikationszustand in der Review-Übersicht

**Decision**: `ReviewOverviewItem['verify']['status']` wird um `'unconfigured'` erweitert
(`packages/shared/src/types.ts:549`). Ermittlung in `reviewRoutes.ts:110-117` in dieser Reihenfolge:

1. Es gibt eine abgeschlossene `verify`-Execution ⇒ `'passed'` / `'failed'` (unverändert).
2. Sonst `project.verifyCommands.length === 0` ⇒ `'unconfigured'`.
3. Sonst ⇒ `'none'` („konfiguriert, aber kein Lauf vorhanden").

**Rationale**: Die Reihenfolge hält die Anzeige in allen Fällen wahr — auch für ein Projekt, dessen
Kommandos nach einem grünen Lauf entfernt wurden: der Lauf hat stattgefunden, das darf nicht als
„nicht konfiguriert" verschwinden. Umgekehrt behauptet Fall 2 nichts über Läufe. Die Oberfläche
liest den Zustand über eine `Record<Status, …>`-Tabelle, damit ein vierter Wert nicht stumm in den
Rest-Zweig fällt (heute eine Ternär-Kette in `ReviewOverview.tsx:169-180`).

**Alternatives considered**: eigenes Boolean-Feld `verifyConfigured` neben `verify.status` — zwei
Felder, die gemeinsam gelesen werden müssen, mit vier Kombinationen, von denen zwei unmöglich sind.

---

## D7 — Review-Portal: keine neue Route

**Decision**: `ReviewPortal.tsx` kennt das Projekt bereits (`state.app.projects.find(...)`, Zeile
44) und gibt `verificationConfigured` an `TestsPane` weiter; der Aufgabenstand kommt aus
`feature.tasksDone/tasksTotal` (im Store vorhanden, `types.ts:133-134`). `TestsPane` unterscheidet
im Leerfall zwischen „keine Verifikation konfiguriert — es wurde nichts geprüft" und „konfiguriert,
aber noch kein Lauf vorhanden" (FR-008). Zusätzlich wird die Kopf-Kennzahl `Verify` auf
`nicht konfiguriert` gesetzt, wenn kein Lauf existiert und nichts konfiguriert ist, und eine
Kennzahl `Aufgaben` ergänzt (FR-014), die bei offenen Aufgaben amber hervorgehoben ist (FR-015).

**Rationale**: Beide Werte liegen im Store — FR-022 verbietet zusätzliche Erhebungen, und eine neue
Route wäre genau das. Die Kopfzeile ist ohne Reiterwechsel und ohne Klick sichtbar, was FR-014
verlangt; `HeaderStat` erhält dafür einen dritten Ton (`warn`, amber) neben `ok`/`bad`.

---

## D8 — Aufgabenstand und Kosten pro Aufgabe in `RunSummary`

**Decision**: `RunSummary` (`packages/shared/src/runSummary.ts:44-62`) erhält `tasksDone: number`
und `tasksTotal: number`, kopiert aus dem Feature in `buildOne()` — dort liegt das Feature bereits
vor. Kosten pro Aufgabe werden **nicht** gespeichert, sondern abgeleitet:

```ts
export function costPerTask(run: Pick<RunSummary, 'total' | 'tasksDone'>):
  { micros: number | null; incomplete: boolean }
```

- `micros = null`, wenn `tasksDone <= 0` (FR-020) **oder** kein Betrag gemeldet wurde
  (`total.costMicros <= 0`) — Edge Case „erledigte Aufgaben, aber kein einziger Betrag" ⇒ Strich,
  nicht 0.
- sonst `Math.round(total.costMicros / tasksDone)`.
- `incomplete = total.runsWithoutCost > 0` (FR-021) — die bestehende Kennzeichnung wird auf die
  abgeleitete Grösse übertragen, statt sie dort zu verschweigen.

**Rationale**: Eine Funktion statt eines Feldes garantiert, dass Läufe-Liste und Lauf-Dashboard
denselben Wert zeigen (FR-019), und hält SC-008 ein: es entsteht keine weitere gespeicherte
Kennzahl. `tasksDone`/`tasksTotal` müssen dagegen im Objekt liegen, weil die Läufe-Ansicht das
Feature nicht mitliefert (`/api/runs` gibt nur `RunSummary[]`, `server.ts:1405`).

Widersprüchliche Zählung (`tasksDone > tasksTotal`) wird unverändert angezeigt und ergibt einen
gültigen Kostenwert — die Rohwerte werden nicht korrigiert (Edge Case).

**Alternatives considered**:
- `costPerTaskMicros` als Feld in `RunSummary`: dritter Ort, an dem dieselbe Division stehen kann,
  und ein gespeicherter Wert, der bei Telemetrie-Nachträgen veralten kann.
- Kosten pro *geplanter* Aufgabe (`tasksTotal`): laut Spec-Annahme falsch — gemessen wird, was
  entstanden ist.

---

## D9 — Kein roher Stufenbezeichner in der Oberfläche

**Decision**: Zwei bestehende Stellen werden auf den geteilten Katalog gezogen, damit die neue
Stufe nirgends als Rohwert erscheint (FR-001a, SC-001):

- `packages/web/src/components/ReviewOverview.tsx:10-16`: `STAGE_LABEL` wird
  `Partial<Record<IntegrationStage, string>>` und der Fallback `?? item.stage` wird
  `?? INTEGRATION_STAGE_META[item.stage].label`.
- `packages/web/src/components/ExecutionsView.tsx:81`: `IntegrationBadge` zeigt heute `{s}` — den
  Rohbezeichner — und wird auf `INTEGRATION_STAGE_META[s].label` umgestellt.

**Rationale**: Beides sind Stellen, an denen die Integrationsstufe benannt wird; FR-001a verlangt,
dass jede solche Oberfläche für die neue Stufe eine eigene Beschriftung führt. Über den getypten
Katalog ist das strukturell erfüllt, statt von einer Sichtprüfung abzuhängen. `KanbanBoard.tsx:462`
und `WorktreeOverview.tsx:353` lesen bereits aus dem Katalog bzw. über `featureProgressLabel()` —
dort ist nichts zu tun.

---

## D10 — Keine Datenbank-Migration

**Decision**: Keine Schema-Änderung.

**Rationale**: `features.integration` ist `TEXT NOT NULL DEFAULT 'none'` ohne `CHECK`
(`database.ts`, Tabellendefinition `features`), `attention.kind` ist `TEXT NOT NULL` ohne `CHECK`.
`CHECK`-Constraints existieren im Schema nur für `chat_messages.role/status`,
`chat_conversations.mode`, `review_comments.side/status`, `agents.trigger_kind` und
`knowledge`-Entscheidungen — keine davon ist betroffen. Neue Enum-Werte sind damit sofort
speicherbar; Altdaten bleiben gültig, weil kein bestehender Wert seine Bedeutung ändert.

---

## D11 — Folgen der Stufenklasse `active`

**Decision**: `STAGE_CLASS['verification_unconfigured'] = 'active'` (`actionPolicy.ts:93-105`).

**Rationale**: Die Stufe ist ein Durchgangszustand an derselben Position wie `verifying`; solange
sie gilt, arbeitet die Integrationsstrecke. `'active'` liefert damit unverändert die bestehenden
Sätze aus `integrationRunningReason()` / `alreadyIntegratingReason()` — beide setzen den Text aus
`INTEGRATION_STAGE_META` zusammen und lesen dann „Die Integration läuft — keine Verifikation
konfiguriert." Das behauptet keine Verifikation und blockiert nichts, was nicht auch bei
`verifying` blockiert wäre (FR-010: keine *zusätzliche* Sperre).

**Alternatives considered**: `'decision'` — würde die Stufe zu einem Halt machen, auf den ein
Mensch reagieren muss, und damit Features anhalten, die FR-010 ausdrücklich durchlaufen lässt.

---

## D12 — Auto-Merge-Pfad: kein neuer Meldungstyp

**Decision**: Bei `autoMerge = true` bleibt der Ablauf unverändert (`enqueue()` ohne
`awaiting_human_review`, `mergeQueueService.ts:292-297`); der Aufgabenstand erscheint
ausschließlich in der bestehenden Merge-Meldung (D5). Es entsteht kein Aufmerksamkeits-Eintrag und
kein neuer Meldungstyp.

**Rationale**: Wortlaut der Clarification vom 30.07. und FR-012a.

---

## D13 — Lebenszyklus-Katalog nachziehen

**Decision**: `INTEGRATION_STAGE_ORIGIN` (`lifecycleCatalog.ts:546-560`) erhält
`verification_unconfigured: 'integration'` (Compile-Pflicht durch `satisfies Record<IntegrationStage,
…>`). Zusätzlich wird die `condition` des Schritts `run-verify-commands`
(`lifecycleCatalog.ts:384-396`) so ergänzt, dass sie den Zweig ohne Konfiguration benennt: das
Feature läuft dann durch die Stufe „keine Verifikation konfiguriert" und es entsteht einmal je
Projekt ein Aufmerksamkeits-Eintrag.

**Rationale**: Der Katalog ist die Prosa-Beschreibung des Ablaufs, aus der die Workflow-Übersicht
rendert; er würde sonst still falsch, weil er behauptet, nach dem Git-Abgleich folgten die
Verify-Kommandos. Der Guard erzwingt nur den Enum-Eintrag, nicht den Text — deshalb steht die
Textänderung ausdrücklich hier.

---

## D14 — Teststrategie

**Decision**: Drei Ebenen, alle mit vorhandenem Werkzeug (vitest, `openMemoryDatabase()`):

1. **Pure Einheiten** (`packages/shared`): `integrationMessages.test.ts` (neu) prüft die drei
   Textformen inkl. `tasksTotal === 0` und `tasksDone > tasksTotal`; `runSummary.test.ts` wird um
   Durchreichung und `costPerTask()`-Grenzfälle erweitert; `workflowModel.test.ts` und
   `actionPolicy.test.ts` decken die neue Stufe automatisch ab, weil sie über
   `Object.keys(INTEGRATION_STAGE_META)` iterieren (`actionPolicy.test.ts:25`) — dort ist nur zu
   prüfen, dass keine Erwartung die Stufenzahl fest verdrahtet.
2. **Dienst mit echter DB** (`packages/server`): `verificationGap.test.ts` (neu) für
   Einmaligkeit je Projekt, Unabhängigkeit vom Feature-Stand, automatische Auflösung bei
   Konfiguration, Wiederentstehen nach erneutem Leeren, Abhaken löst nur die Meldung;
   `mergeQueueService.attention.test.ts` wird um den Nachweis erweitert, dass ein Stufenwechsel den
   projektbezogenen Eintrag nicht anfasst.
3. **Sichtprüfung** über `quickstart.md` für die vier Oberflächen (Board, Review-Übersicht,
   Review-Portal, Läufe) — dort ist der Wortlaut die Abnahme (SC-001, SC-004, SC-006).

**Rationale**: Die riskanten Teile sind Textwahl und Lebensdauer — beide vollständig ohne
Oberfläche testbar. Für die Oberflächen gibt es im Repo keine Komponententests; ein neues
Testframework dafür einzuführen wäre außerhalb des Auftrags.
