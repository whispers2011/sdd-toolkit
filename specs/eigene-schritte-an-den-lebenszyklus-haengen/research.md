# Phase 0 — Research & Leitentscheidungen

**Feature**: Eigene Schritte an den Lebenszyklus hängen · **Datum**: 2026-07-30

Die Spezifikation enthält **keine offenen `NEEDS CLARIFICATION`-Marker**: FR-013 (Portbereich)
und FR-014 (Profil) wurden am 30.07.2026 durch eine Umfangsentscheidung geschlossen — beide sind
nicht Teil dieses Features, verlangen aber **einen** Erweiterungspunkt (E4). Der Hinweis in
`checklists/requirements.md` bezieht sich auf den Stand vor dieser Entscheidung.

Untersucht wurde stattdessen der Bestandscode, weil die Spec ihn ausdrücklich als Vorbild
benennt („Bedienung nach Vorbild der Agents"). Jede Entscheidung unten nennt die Fundstelle,
an der das Muster bereits existiert.

---

## E1 — Auslöser-Katalog als getypte Domänen-Union mit doppeltem Drift-Guard

**Entscheidung**: `LifecycleTriggerKind` ist eine String-Union in `packages/shared/src/types.ts`;
`LIFECYCLE_TRIGGER_KINDS` ist das zugehörige `as const`-Array. Die Anzeige-Metadaten liegen als
`LIFECYCLE_TRIGGER_META: Record<LifecycleTriggerKind, LifecycleTriggerMeta>` in
`workflowModel.ts`. Zusätzlich prüft `workflowModel.test.ts` zur Laufzeit, dass jede Art einen
nicht-leeren Titel besitzt.

**Begründung**: FR-008 verlangt, dass eine neue Auslöser-Art nicht still an der
Workflow-Übersicht vorbeigehen kann. Genau dieses Verfahren ist im Repo schon etabliert und im
Kopf von `workflowModel.ts` begründet: „die Meta-Maps sind über die Domänen-Unions getypt …,
sodass jede künftige Erweiterung `pnpm typecheck` an genau dieser Stelle bricht". `Record<K, …>`
erzwingt den Eintrag beim Kompilieren, der Laufzeit-Test fängt einen leeren Platzhalter.

**Alternativen**:
- *Auslöser als freier String in der DB, Anzeige aus einer Liste in der UI*: verworfen — genau
  die still veraltende Übersicht, die FR-008 ausschließt.
- *Nur Laufzeit-Test ohne `Record`*: verworfen — der Fehler fällt erst im Testlauf auf, nicht
  beim Tippen.

---

## E2 — Stufen-Identität ist die ID der Integrations-Pipeline, nicht die `IntegrationStage`

**Entscheidung**: Stufen-Auslöser beziehen sich auf `LifecycleStageId =
'verify' | 'review_gate' | 'human_review' | 'merge_queue' | 'merged'`. Diese Werte kommen aus
einem neuen `INTEGRATION_STAGE_IDS`-`as const`-Array in `workflowModel.ts`; `IntegrationStep.id`
wird darauf getypt (heute `string`). Ein Test prüft
`INTEGRATION_STEPS.map(s => s.id) === INTEGRATION_STAGE_IDS`.

**Begründung**: Die Assumption der Spec nennt die Stufen wörtlich „Verifikation, Review-Gate,
menschliches Review, Merge-Queue, Abschluss" — das ist Zeichen für Zeichen `INTEGRATION_STEPS`.
Der `IntegrationStage`-Union wäre der falsche Anker: er enthält Fehlerzustände
(`verify_failed`, `gate_failed`, `conflict_escalated`) und Zwischenzustände
(`conflict_resolving`), an die man keinen Schritt hängen will, und die Spec grenzt ausdrücklich
ab: „nicht auf jeden internen Zwischenzustand". Durch die Kopplung an `INTEGRATION_STEPS`
erzwingt eine neue Pipeline-Stufe automatisch einen Eintrag im Auslöser-Katalog (FR-008 in beide
Richtungen).

**Alternativen**:
- *`IntegrationStage` verwenden*: verworfen (Fehler-/Zwischenzustände, s. o.).
- *Eigene, unabhängige Stufen-Liste*: verworfen — zweite Quelle für dieselbe Pipeline; genau der
  Drift, den FR-008 verhindern soll.

---

## E3 — Arbeitsverzeichnis: Worktree, außer der Lebenszyklus hat dort per Definition keinen

**Entscheidung**: `lifecycleCwdKind(trigger): 'worktree' | 'main'` ist eine pure Funktion.
Sie liefert `'main'` für genau zwei Punkte:
- `before_worktree_create` — der Worktree existiert noch nicht (FR-010, US3 Szenario 5);
- `after_stage:merged` — der Worktree ist durch das Cleanup der letzten Stufe bereits entfernt.

Für alle übrigen Auslöser gilt `'worktree'`; ist dort **unerwartet** kein Worktree vorhanden,
ist das ein **behebbarer Infrastrukturfehler** (Wurf + `agent_errored`-Meldung), **kein**
fachlicher Fehlschlag des Kommandos und **kein** FAIL-Lauf.

**Begründung**: FR-010 fordert die Ausführung im Worktree und nennt eine Ausnahme; der Edge Case
„Auslöser feuert ohne existierenden Worktree" fordert zusätzlich die Unterscheidung
Infrastruktur vs. Fachlichkeit (FR-026). Genau diese Unterscheidung existiert schon als
`AgentGateService.guardWorktree()` mit ausformulierter Begründung („darf KEIN dauerhaftes FAIL
verbuchen — stattdessen als behebbaren Fehler eskalieren"). Die zweite `'main'`-Stelle folgt
zwingend aus E9: nach dem Cleanup ist der Worktree weg, der Abschluss aber noch nicht vermerkt.

**Alternativen**:
- *Generischer Fallback „Worktree, sonst Haupt-Checkout"*: verworfen — dann läuft ein Schritt
  bei einem versehentlich gelöschten Worktree stumm am falschen Ort und produziert einen
  scheinbaren Erfolg. FR-026 verlangt das Gegenteil.
- *`after_stage:merged` weglassen*: verworfen — die Spec nennt „Abschluss" als Stufe und
  beschreibt den zugehörigen Edge Case ausdrücklich.

---

## E4 — Der Variablensatz entsteht an genau einer Stelle (Erweiterungspunkt für F1c)

**Entscheidung**: `buildLifecycleEnv(ctx: LifecycleContext): Record<string, string>` in
`packages/shared/src/lifecycleSteps.ts` ist die **einzige** Stelle, an der Umgebungsvariablen für
Schritte entstehen. Sie liefert genau sechs Schlüssel:
`SDD_WORKTREE`, `SDD_PROJECT`, `SDD_FEATURE`, `SDD_BRANCH`, `SDD_PHASE`, `SDD_STAGE`.
Nicht zutreffende Angaben sind der **leere String** (FR-012), nie ein Platzhalter und nie ein
Wert aus einem anderen Vorgang. `SDD_PORT_BASE` und `SDD_PROFILE` werden **nicht** gesetzt
(FR-013/FR-014); F1c ergänzt sie in dieser einen Funktion und in `LifecycleContext`.

`SDD_PROJECT` trägt den **Projektnamen** (Symmetrie zu `SDD_FEATURE`, das den Slug trägt).
`SDD_WORKTREE` trägt bei `before_worktree_create` den **künftigen** Pfad (US3 Szenario 5) und ist
sonst identisch mit dem Arbeitsverzeichnis.

**Begründung**: FR-013 verlangt wörtlich „**eine** Stelle, die den Variablensatz aufbaut, nicht
mehrere verstreute Zuweisungen". Eine pure Funktion in `shared` ist zugleich der Ort, an dem sich
US3 Szenario 4 („genügt eine Änderung an dieser Stelle") ohne Integrationstest nachweisen lässt.
Der leere String statt eines fehlenden Schlüssels macht `$SDD_PHASE` in einem Shell-Skript
verlässlich auswertbar (`[ -z "$SDD_PHASE" ]`), ohne dass `set -u` zuschlägt.

**Bewusst nicht ergänzt**: kein `SDD_PROJECT_PATH`. Die Spec listet den Variablensatz
abschließend auf, und der Haupt-Checkout ist aus dem Worktree heraus per Git erreichbar
(`git rev-parse --git-common-dir`). Eine zusätzliche Variable wäre unbestellte Erweiterung des
Vertrags, den F1c fortschreiben soll.

**Alternativen**:
- *Platzhalter-Ersetzung im Kommandotext (`{worktree}`) wie bei `{reviewFile}` der Agents*:
  verworfen — Textersatz in einer Shell-Zeile ist eine Injection-Fläche und bricht bei
  Leerzeichen in Pfaden. Umgebungsvariablen sind quoting-sicher.
- *Variablen im Service statt in `shared`*: verworfen — nicht ohne Prozessstart testbar, und der
  Erweiterungspunkt läge im IO-Code.

---

## E5 — `createFeature`: Feature-Datensatz vor dem Worktree, mit Rollback

**Entscheidung**: `Orchestrator.createFeature()` wird umgestellt auf
*(1)* `features.create({ worktreePath: null })` → *(2)* `prepareWorktree(feature)` → *(3)*
Session + erste Phase. `prepareWorktree()` führt `before_worktree_create`-Schritte aus, ruft
`worktrees.create()`, persistiert den Pfad und führt `after_worktree_create`-Schritte aus.
Scheitert `git worktree add`, wird der frisch angelegte Datensatz über das vorhandene
`FeatureRepo.hardDelete(id)` zurückgerollt und der Fehler weitergeworfen.

**Begründung**: Jeder Schritt-Lauf braucht einen Lauf-Eintrag beim **zugehörigen Feature**
(FR-017), und `buildRunSummaries()` überspringt Executions ohne `featureId` ausdrücklich. Ein
`before_worktree_create`-Lauf ist damit nur attribuierbar, wenn der Datensatz vorher existiert.
Der Rollback hält die heutige Fehlersemantik („Worktree kaputt ⇒ kein Feature in der Ansicht")
exakt aufrecht.

Die Ausführung bleibt **awaited** (der HTTP-`POST` wartet). Der naheliegende Gegenentwurf —
Worktree-Vorbereitung asynchron, Phasenstart verzögert wie bei `runBeforePhaseGate` — ist nicht
tragfähig: `POST /api/projects/:id/features/with-documents` ruft direkt nach `createFeature`
`featureDocuments.writeDocuments()`, und das wirft bei `!feature.worktreePath`
(„Feature hat keinen Worktree — Dokumente nicht ablegbar"). Der Worktree muss also fertig sein,
wenn `createFeature` zurückkehrt. Die Spec fordert Verzögerungsfreiheit ausdrücklich nur für
Projekte **ohne** Schritte (US1 Szenario 3, SC-008) — dieser Fall bleibt über den Fast-Path (E6)
unangetastet.

**Alternativen**:
- *Schritte mit `featureId = null` laufen lassen*: verworfen — verletzt FR-017.
- *`with-documents` auf Worktree-Bereitschaft warten lassen*: verworfen — zusätzlicher
  Wartemechanismus für denselben Effekt, den das Awaiten schon hat.
- *Reihenfolge unverändert und Worktree-Auslöser nur nach `features.create` feuern*: verworfen —
  dann gibt es kein „vor Worktree-Anlage" mehr (FR-006).

---

## E6 — Fast-Path: ohne konfigurierte Schritte passiert nichts

**Entscheidung**: `LifecycleStepService.hasStepsFor(projectId, featureId, trigger)` ist die
Vorschaltprüfung an jedem Einhängepunkt. Sie löst über dieselbe pure Funktion auf wie die
Ausführung und liefert `false`, sobald keine Schritte gelten. In diesem Fall entsteht **keine
Execution, kein Prozess, kein Log, keine Zustandsänderung**.

**Begründung**: FR-027/SC-008 verlangen „exakt wie bisher". Das Muster existiert wörtlich als
`AgentGateService.hasAgentsFor()` samt Kommentar „Fast-Path: gibt es für diesen Trigger überhaupt
laufende Agents?" und wird in `startPhaseRun`/`runAfterPhaseGate` genau so benutzt. Bei leerer
`lifecycle_steps`-Tabelle ist die Prüfung ein indizierter Zähl-Query.

**Zusicherung im Test**: ein Test mit gespähtem Runner weist nach, dass bei leerer Tabelle
`spawn` **nicht** gerufen und `executions.start` **nicht** aufgerufen wird.

---

## E7 — Eigener Runner statt Umbau von `verifyService`

**Entscheidung**: Die Prozessausführung entsteht neu in `lifecycleStepService.ts` (Login-Shell
über `loginShellEnv()`, `spawn(shell, ['-l','-c', command])`, Timeout mit SIGKILL auf dem
eigenen Child-Handle, Ausgabe gestreamt in `<dataDir>/logs/<execId>.log`, Ringpuffer für die
letzten Zeilen). `verifyService.ts` bleibt **unangetastet**.

**Begründung**: `verifyService.ts` hat keine eigene Testdatei und sitzt im Merge-Pfad; ein
Refactoring dorthin wäre ein ungedeckter Eingriff in die Integrations-Pipeline. Der neue Runner
braucht zusätzlich zwei Dinge, die `verifyService` nicht kennt: einen **Tail-Puffer** für das
Inbox-Item (FR-023) und ein **pro Schritt konfigurierbares** Zeitlimit (FR-016). Der Preis sind
~25 strukturell ähnliche Zeilen; der Nutzen ist ein vollständig getesteter neuer Pfad ohne
Regressionsrisiko im Merge.

Die Login-Shell (`-l`) wird bewusst übernommen: Version-Manager (nvm, mise) hängen in
`.zprofile`, ohne sie findet ein `pnpm`-Kommando sein Node nicht — dieselbe Begründung wie in
`verifyService` und `agentGateService`.

**Alternativen**:
- *Gemeinsamer `shellRunner.ts`, auf den beide umgestellt werden*: als Folgearbeit sinnvoll,
  hier verworfen (ungedeckter Eingriff, s. o.).
- *`exec` statt `spawn`*: verworfen — puffert die gesamte Ausgabe im Speicher (Edge Case „sehr
  viel Ausgabe").

---

## E8 — Reihenfolge am gemeinsamen Punkt: Schritte vor Agents

**Entscheidung**: Treffen an einem Punkt Schritte und Agents zusammen, laufen **immer zuerst die
Schritte**, danach die Agents:
- `before_phase`: Schritte → Agent-Gate → Phasenstart;
- `after_phase`: Schritte → Agent-Gate → Auto-Progress;
- `review_gate`-Stufe: `before_stage`-Schritte → Review-Agents → `after_stage`-Schritte.

**Begründung**: Schritte bereiten mechanisch vor (installieren, generieren, formatieren), Agents
urteilen. Ein Agent soll den **vorbereiteten** Stand beurteilen, nicht einen halb vorbereiteten —
sonst meldet das DoR-Gate Fehler, die der nachfolgende Schritt gerade behoben hätte. Eine
einzige, merkbare Regel für alle Punkte statt einer Tabelle mit Ausnahmen.

**Alternativen**:
- *Agents zuerst*: verworfen — würde am `before_phase`-Punkt gegen ein unvorbereitetes
  Arbeitsverzeichnis urteilen.
- *Konfigurierbare Reihenfolge*: verworfen — YAGNI; die Spec verlangt nichts dergleichen.

---

## E9 — Einhängepunkte der Stufen-Auslöser (verbindliche Tabelle)

**Entscheidung**: `before_stage:X` läuft unmittelbar bevor die Arbeit der Stufe X beginnt,
`after_stage:X` unmittelbar nachdem sie **erfolgreich** beendet ist und **bevor** die Pipeline
weiterläuft (FR-009). Konkret in `mergeQueueService.ts`:

| Stufe | `before_stage` | `after_stage` | Halt bei blockierendem FAIL |
|---|---|---|---|
| `verify` | in `beginIntegration()` vor `runVerification` | nach grüner Verifikation | Stufe bleibt `verifying`, keine Verifikation bzw. kein Review-Gate |
| `review_gate` | vor `agentGate.runTrigger({kind:'review_gate'})` | nach bestandenem Gate | Gate läuft nicht bzw. es folgt kein Einreihen/Review |
| `human_review` | vor `setStage('awaiting_human_review')` | in `approveForMerge()` nach der Freigabe, vor `enqueue()` | Feature wird nicht zum Review übergeben bzw. nicht eingereiht |
| `merge_queue` | in `processItem()` vor dem Rebase | nach erfolgreichem Merge (Worktree existiert noch) | kein Rebase/Merge bzw. kein Übergang zur Abschluss-Stufe |
| `merged` | nach dem Merge, **vor** `cleanupMerged()` | nach `cleanupMerged()`, **vor** `setStage('merged')` (cwd = Haupt-Checkout, E3) | kein Cleanup bzw. **der Abschluss wird nicht vermerkt** |

Ein blockierender Fehlschlag hält zusätzlich den Queue-Worker an (`return false` in `processItem`
bzw. früher Ausstieg in `beginIntegration`) — dieselbe Wirkung wie jede bestehende Eskalation:
„eskaliert → Queue anhalten bis Mensch eingreift".

**Begründung**: Die letzte Zeile setzt den Edge Case wörtlich um („Der Abschluss wird nicht
vermerkt; das Feature bleibt vor dem Abschluss stehen und meldet sich in der Inbox"). Das Cleanup
entfernt den Worktree — deshalb muss `before_stage:merged` davor liegen (letzte Gelegenheit, im
Worktree zu arbeiten) und `after_stage:merged` danach im Haupt-Checkout laufen. Bleibt das
Feature so unvermerkt stehen, führt es der bestehende Selbstheilungspfad
(`reconcile()` → „Branch bereits im Ziel" → `finalizeMerged()`) beim nächsten Anstoßen sauber
zu Ende — es entsteht keine Sackgasse.

**Alternativen**:
- *Beide `merged`-Auslöser vor dem Cleanup*: verworfen — zwei Auslöser ohne Arbeit dazwischen
  sind für den Nutzer nicht unterscheidbar.
- *Stufen-Auslöser nur an `verify` und `merge_queue`*: verworfen — FR-007 verlangt „eine konkrete
  Stufe der Integrations-Pipeline", die Assumption nennt alle fünf.

---

## E10 — Ein Inbox-Item eigener Art, das nur ein erfolgreicher Wiederanlauf löst

**Entscheidung**: neue `AttentionKind` `lifecycle_step_failed`. Der Reconciler
(`attentionReconciler.ts`) erhält einen **expliziten** Zweig: die Meldung bleibt gültig, bis sie
aufgelöst wird — sie ist weder an eine Session noch an eine `IntegrationStage` gekoppelt und
überlebt einen Neustart. Aufgelöst wird sie an genau einer Stelle: wenn ein Trigger-Durchlauf
desselben Features **alle** seine Schritte erfolgreich beendet
(`attention.resolveFor({ featureId, kinds: ['lifecycle_step_failed'] })`, FR-025).

**Begründung**: Die bestehende Art `phase_gate_failed` wäre falsch: sie liegt im Zweig der
„Prozess"-Meldungen und wird ungültig, „sobald eine Live-Session desselben Features wieder
arbeitet". Ein fehlgeschlagener `pnpm install` ist dadurch nicht behoben — eine beliebige andere
Sitzung würde die Meldung stillschweigend wegräumen. `STAGE_FOR_KIND` bleibt bewusst unberührt
(kein Stage-Bezug, sonst löscht `setStage()` das Item bei jedem Stufenwechsel).

Das Item trägt laut FR-023 Schrittname, ausgeführtes Kommando, Exit-Code und die letzten
Ausgabezeilen; die vollständige Ausgabe bleibt über den Lauf erreichbar (Edge Case „sehr viel
Ausgabe"). Die Dedup-Regel von `AttentionRepo.raise()` (gleiche Art + gleiches Feature ⇒ ein
Item) wird akzeptiert: mehrere Fehlschläge desselben Features erzeugen eine Meldung, deren Text
vom ersten Fehlschlag stammt. Das ist gewollt — die Inbox soll nicht fluten.

**Alternativen**:
- *`phase_gate_failed` mitbenutzen*: verworfen (falsche Ungültigkeits-Regel, s. o.).
- *`verify_failed` mitbenutzen*: verworfen — an `feature.integration === 'verify_failed'`
  gekoppelt, für Worktree- und Phasen-Auslöser sinnlos.

---

## E11 — Lauf-Buchführung: eigene Art, Name auf der Execution, kein Verbrauchswert

**Entscheidung**:
- Neue Execution-Art `kind = 'lifecycle_step'` (FR-018).
- Neue nullable Spalte `executions.label` trägt den **Schrittnamen zum Startzeitpunkt** (FR-028,
  Edge Case „Schritt wird geändert oder gelöscht, während er läuft").
- `phase` wird bei Phasen-Auslösern gesetzt, sonst `NULL`; `exit_code`, `started_at`,
  `finished_at` liefern Ergebnis und Dauer (FR-019).
- `tokens`, `tokens_source`, `cost_micros` bleiben `NULL` — nie 0, nie geschätzt (FR-020).
- Die vollständige Ausgabe liegt als `<dataDir>/logs/<execId>.log`; damit bedient der bestehende
  Endpunkt `GET /api/executions/:id/log` sie über „Fall A: physische Log-Datei" **ohne
  Änderung**.
- `reapOrphans()` im Boot markiert unterbrochene Läufe als `orphaned` (FR-021) — bereits
  vorhanden, wird durch einen Test festgenagelt.

**Begründung**: Eine Spalte statt einer Tabelle `lifecycle_step_runs`: Anders als bei Agents gibt
es kein strukturiertes Urteil, keinen Berichtspfad und keine Zusammenfassung zu speichern —
`agent_runs` existiert für genau diese Zusatzdaten. Für Name + Exit-Code + Zeitraum genügt die
Execution; eine zweite Tabelle mit Join wäre Aufwand ohne Informationsgewinn. `label` ist
absichtlich generisch benannt und dokumentiert („Bezeichnung des Laufs; bei
`kind='lifecycle_step'` der Schrittname").

**Nebenwirkung, bewusst akzeptiert**: `aggregateBreakdown()` gruppiert nach `phase`
unabhängig von `kind`. Ein Schritt-Lauf an einem Phasen-Auslöser erhöht damit die
`runs`-Zahl dieser Phase um 1, ohne Tokens beizutragen. Die dokumentierte Invariante
(„Summe(byPhase) + phasenlose Läufe == total") bleibt gültig.

**Notwendige Korrektur an `runSummary.ts`**: `sourceMix` zählt als Nenner „ALLE Läufe, nicht nur
die bereits gemessenen". Schritt-Läufe haben **nichts** zu messen; als „ungemessen" gezählt
würden sie den Messanteil eines Laufs künstlich drücken. Sie werden deshalb aus dem Nenner
ausgenommen — mit Test.

---

## E12 — Auflösungsregeln und Reihenfolge

**Entscheidung**: `resolveLifecycleSteps(steps, selection, trigger)` in `shared` spiegelt
`resolveAgentsForTrigger()` exakt: *(1)* Auslöser muss passen (Art **und** ggf. Phase/Stufe),
*(2)* per-Feature `exclude` schlägt alles, *(3)* `include` erzwingt den Lauf auch bei
deaktiviertem Schritt, *(4)* sonst entscheidet `enabled` (FR-005). Ohne Eintrag gilt die Ebene
darüber (FR-003).

Die Reihenfolge (FR-004: deterministisch **und** für die Person sichtbar) ist:
**globale Schritte zuerst, dann projektspezifische; je Gruppe nach `sortOrder`, bei Gleichstand
nach `name`.** Derselbe Vergleicher liegt im SQL (`ORDER BY project_id IS NOT NULL, sort_order,
name`) und in der puren Funktion, und die Verwaltungs-UI beschriftet ihn wörtlich.

**Begründung**: Die Union-Semantik (global **und** Projekt gelten) ist bei den Agents bereits
begründet: „mit Gates würde EIN Projekt-Agent sonst still alle globalen Gates abschalten.
Escape-Hatch ist der Per-Feature-Exclude." Dieselbe Begründung trägt hier — eine Hausregel
(„niemals ohne Lint mergen") darf nicht dadurch verschwinden, dass ein Projekt einen eigenen
Schritt anlegt.

Die zusätzliche Gruppierung *global vor Projekt* geht über die Agent-Sortierung
(`ORDER BY sort_order, name`) hinaus, weil US4 Szenario 2 eine „nachvollziehbare, stabile
Reihenfolge" über Ebenen hinweg fordert: bei Schritten hängt die **Wirkung** von der Reihenfolge
ab (erst installieren, dann bauen), bei Agent-Urteilen nicht. Ohne Gruppierung entschiede bei
zwei Schritten mit `sortOrder = 0` der Name über die Ebene — nicht erklärbar.

**Alternativen**:
- *Projekt überschreibt global (Fallback statt Union)*: verworfen — genau die im Bestand
  verworfene Semantik.
- *Nur `sortOrder, name` wie bei Agents*: verworfen (s. o.).
- *Reihenfolge über eine explizite Liste am Auslöser*: verworfen — neues Bedienkonzept, das die
  Spec ausschließt („Neue Bedienkonzepte werden nicht eingeführt").
