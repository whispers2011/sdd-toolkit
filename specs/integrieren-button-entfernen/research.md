# Phase 0 — Research & Entscheidungen

Die Spec enthält keine offenen `NEEDS CLARIFICATION`; alle sieben Klärungen wurden in Session 2026-07-26 beantwortet. Diese Phase klärt daher die *technischen* Unbekannten: wo die gemeinsame Festlegung lebt, wie der einzige asynchrone Fakt beschafft wird, und was genau an bestehendem Verhalten verschwindet.

Der Bestand wurde vollständig gelesen: `KanbanBoard.tsx`, `FeatureConsole.tsx`, `ReviewOverview.tsx`, `ReviewPortal.tsx`, `api.ts`, `store.tsx`, `server.ts`, `reviewRoutes.ts`, `orchestrator.ts`, `mergeQueueService.ts`, `phaseMachine.ts`, `sessionMachine.ts`, `workflowModel.ts`, `types.ts`, `database.ts`, `git.ts`.

---

## D1 — Wo lebt die gemeinsame Festlegung?

**Decision**: Ein neues pures Modul `packages/shared/src/actionPolicy.ts` mit `evaluateAction(action, context)` → `ActionVerdict`. Kein I/O, keine React-Importe, keine Fastify-Importe. Web und Server importieren dasselbe Modul.

**Rationale**:
- FR-022 verlangt „eine einzige, gemeinsam genutzte Festlegung, sodass alle Oberflächen zwangsläufig dasselbe Ergebnis zeigen". Ein gemeinsames Modul ist die einzige Variante, in der „zwangsläufig" wörtlich gilt — jede andere Variante verlässt sich auf Disziplin.
- `@sdd/web` hat keinen Test-Runner (`"test": "echo 'keine Web-Tests (MVP)'"`). Logik in Web-Komponenten ist damit strukturell ungetestet. `@sdd/shared` hat Vitest und enthält bereits genau dieses Muster (`phaseMachine.ts`, `sessionMachine.ts`, `workflowModel.ts`).
- FR-024 (serverseitige Prüfung derselben Bedingungen) fällt dadurch fast kostenlos ab: der Server baut denselben Kontext und ruft dieselbe Funktion.

**Alternatives considered**:
- *Regeln in jeder Oberfläche belassen und nur korrigieren* (Status quo minimal repariert) — verworfen: genau dieses Muster hat die vier widersprüchlichen Fassungen erzeugt; SC-004 wäre nicht überprüfbar.
- *Server berechnet die Befunde und liefert sie als DTO je Feature* — verworfen: die Befunde ändern sich bei jedem `feature_updated`/`session_status`/`agent_gate`-Ereignis. Die UI müsste nach jedem WS-Ereignis nachladen; das verletzt FR-023 (Aktualisierung ohne Neuladen, ohne spürbare Verzögerung) und macht die UI von der Netzwerklatenz abhängig. Der Zustand liegt ohnehin bereits vollständig im Store.
- *Regel-Engine / deklarative Tabelle mit Interpreter* — verworfen: 10 Aktionen, überschaubare Bedingungen. Eine Funktion mit `switch` ist kürzer, direkt lesbar und ohne Meta-Ebene testbar.

---

## D2 — Der asynchrone Fakt: „Gibt es überhaupt etwas zu integrieren?" (FR-027)

**Decision**: Neue Route `GET /api/features/:id/integration-readiness` → `{ hasChanges: boolean }`, berechnet über das vorhandene `collectUnmergedChanges(worktree, ziel)` (`hasChanges = files.length > 0 || commits.length > 0`). Der Kontexttyp der Policy führt `hasChanges: boolean | 'unknown'`; `'unknown'` gilt als *nicht sperrend* (die Aktion bleibt auslösbar), und der Server lehnt den Start notfalls mit demselben Satz ab. Die UI fragt die Route **nur** für Features ab, die bereits fertig und nicht beschäftigt sind — also für die kleine Menge, bei der die Integrations-Aktion überhaupt sichtbar wird.

**Rationale**:
- Der Fakt ist git-basiert und damit asynchron; die restliche Policy ist synchron aus dem Store ableitbar. Ihn als optionalen Kontextwert zu führen hält die Policy pur und den Rest der UI latenzfrei.
- Die teure Abfrage wird an die Menge gekoppelt, für die sie fachlich überhaupt eine Bedeutung hat. Für ein Feature in Arbeit wird nie ein git-Kommando ausgelöst.
- `'unknown'` optimistisch zu behandeln ist die ehrliche Variante: die UI behauptet nie fälschlich „gesperrt", und FR-003/FR-024 garantieren, dass ein trotzdem abgeschickter Start sauber abgelehnt wird.

**Alternatives considered**:
- *Feld am `Feature`-DTO* — verworfen: `Feature` wird bei jedem `feature_updated` über WS gepusht und in `/api/state` für alle Features geliefert. Ein git-Aufruf pro Emission und pro Feature ist unverhältnismäßig und macht Statusereignisse langsam.
- *Nur in `/api/state` berechnen* — verworfen: der Wert veraltet sofort beim ersten WS-Ereignis; die UI zeigte dann eine falsch gesperrte oder falsch freigegebene Schaltfläche.
- *Erst beim Klick prüfen* — verworfen: FR-027 verlangt ausdrücklich, dass die Aktion **sichtbar gesperrt** ist und den Grund nennt, nicht dass sie erst nach dem Klick meckert.

**Fallstrick, der dadurch geschlossen wird**: Heute läuft ein Integrationsstart eines änderungsfreien Features in `beginIntegration` → `reconcile()`. Ein Branch ohne eigene Commits ist trivialer Vorfahre des Ziels; `isBranchMergedInto` liefert `true` und `finalizeMerged()` setzt das Feature auf `merged` — ein zweiter, unbeabsichtigter Weg in den Endzustand „abgeschlossen", genau das, was SC-003 ausschließt. Die Vorprüfung muss deshalb **vor** `reconcile()` stehen (siehe D5).

---

## D3 — „Beschäftigt" vs. „Entscheidungszustand" (FR-005 / FR-025)

**Decision**: Die 11 Werte von `IntegrationStage` werden in `actionPolicy.ts` über ein `Record<IntegrationStage, StageClass>` klassifiziert:

| Klasse | Stufen | Wirkung |
|---|---|---|
| `idle` | `none` | Schritt-Aktionen normal möglich |
| `active` | `verifying`, `review_gate`, `queued`, `merging`, `conflict_resolving` | macht das Feature **beschäftigt** |
| `decision` | `awaiting_human_review`, `verify_failed`, `gate_failed`, `conflict_escalated` | **nicht** beschäftigt; nur die dort vorgesehene Aktion wird angeboten |
| `terminal` | `merged` | keine zustandsverändernde Aktion mehr |

Beschäftigt ist ein Feature genau dann, wenn mindestens eines gilt: ein Schritt hat `status === 'running'`, die Session ist `working` oder `awaiting_input`, ein Agenten-Gate läuft, oder die Integrationsstufe ist `active`.

**Rationale**: Der `Record<IntegrationStage, …>`-Zwang ist die im Repo etablierte Technik (`workflowModel.ts`, dort ausdrücklich begründet): eine künftige zwölfte Stufe bricht `pnpm typecheck` an dieser Stelle, statt still in die falsche Klasse zu fallen. Die Klassifikation ist zugleich die Umsetzung der Klärung vom 2026-07-26 und macht FR-005/FR-025 an einer Stelle nachlesbar.

**Alternatives considered**: Zwei separate `IntegrationStage[]`-Arrays — verworfen: eine neue Stufe fehlt dann schlicht in beiden Listen, ohne dass der Compiler etwas merkt (genau das Veralten, das `workflowModel.ts` bereits einmal bewusst verhindert hat).

---

## D4 — Zurückweisung im Review: Rückstellung des letzten Schritts (FR-020 / FR-026)

**Decision**: Drei Teile.
1. Neue pure Funktion `reopenLastPhase(phases): PhaseTransition` in `phaseMachine.ts` — setzt den letzten *aktiven* Schritt auf `awaiting_review` und gibt **keine Effekte** zurück (FR-021: kein automatischer Folgestart).
2. Die Route `POST /api/features/:id/reject-review` ruft sie zusätzlich zum bereits vorhandenen `setIntegration('none')` + `setIntegrationTarget(null)` auf.
3. Neues Feld `Feature.reviewRejectedAt: number | null` (Migration `ALTER TABLE features ADD COLUMN review_rejected_at INTEGER`), gesetzt beim Zurückweisen, geleert beim erneuten Freigeben des letzten Schritts. Board und Konsole zeigen daraus einen Hinweis „↩ im Review zurückgewiesen".

**Rationale**:
- FR-026 verlangt ausdrücklich, dass „die Zurückweisung als Hinweis sichtbar bleibt", während die Karte in die Entwicklungs-Spalte zurückwandert. Ohne persistierten Marker wäre eine Zurückweisung nach einem Server-Neustart nicht mehr von „noch nie integriert" unterscheidbar.
- Die Rückstellung gehört in die pure Phasenmaschine, nicht in die Route: sie ist eine Zustandsregel und muss getestet werden können (`phaseMachine.test.ts` existiert bereits).
- Der Effektfreiheit-Teil ist der eigentliche Kern von FR-021. `approvePhase()` löst bei `autoVerify` einen `start_integration`-Effekt aus — beim *Zurücksetzen* darf davon nichts passieren. Nur die spätere, ausdrückliche Freigabe des Bedienenden geht wieder durch `approvePhase()` und startet die Pipeline dann von vorn.

**Alternatives considered**:
- *Marker als AttentionItem* — verworfen: `setStage()` in `mergeQueueService` löst Inbox-Items zustandsgekoppelt automatisch auf; ein Hinweis-Item würde beim nächsten Stufenwechsel unkontrolliert verschwinden.
- *Kein Marker, nur der zurückgesetzte Schritt* — verworfen: erfüllt FR-026 nicht; ein `awaiting_review`-Schritt sieht identisch aus wie ein frisch gelaufener.
- *Alle Schritte zurücksetzen* — verworfen: die Klärung sagt ausdrücklich „der **letzte** Schritt braucht eine neue Freigabe".

---

## D5 — Reihenfolge im Integrationsstart (FR-004 / FR-027)

**Decision**: `beginIntegration()` prüft **als Erstes** die Änderungslage und kehrt ohne jede Zustandsänderung zurück, wenn nichts zu integrieren ist. Erst danach folgen `reconcile()`, `setStage('verifying')` und `commitWorktree()`. Die Signatur wird zu `Promise<{ started: boolean; reason?: string }>`, damit sowohl die manuelle Route (→ HTTP 409 mit Grund) als auch der automatische Pfad (`PhaseEffect start_integration`) dasselbe Ergebnis auswerten können.

**Rationale**: FR-004 verlangt, dass ein abgelehnter Start den Feature-Zustand *und* das Arbeitsverzeichnis unverändert lässt — „insbesondere darf keine Arbeit festgeschrieben werden". Die heutige Reihenfolge schreibt in `commitWorktree()` bereits fest, bevor irgendetwas geprüft wurde. Zusätzlich schließt die Vorwegprüfung den in D2 beschriebenen `reconcile()`-Fallstrick.

**Alternatives considered**: Prüfung nur in der Route — verworfen: der automatische Pfad (`autoVerify`) umgeht Routen vollständig und liefe weiter in den Fallstrick.

---

## D6 — Sperrgrund ohne Hover darstellen (FR-028 / SC-006)

**Decision**: Eine neue Web-Komponente `FeatureAction.tsx` mit zwei Bausteinen:
- `<ActionGroup reason={…}>` rendert die Aktionen und darunter — wenn ein Grund vorliegt — **dauerhaft** einen Satz (`<p id="reason-…">`), nicht als Tooltip.
- `<ActionButton verdict={…}>` rendert gesperrte Aktionen mit `aria-disabled="true"` (statt `disabled`), bleibt damit **fokussierbar**, trägt `aria-describedby` auf den Grund-Satz und verwirft den Klick wirkungslos.

**Rationale**: Ein natives `disabled`-Attribut nimmt das Element aus der Tabulator-Reihenfolge; ein Screenreader-Nutzer kann es nicht anspringen und erfährt den Grund nie. `aria-disabled` + `aria-describedby` erfüllt „auch per Tastatur, Screenreader und auf Touch-Geräten erkennbar" wörtlich. Der klickverwerfende Handler erfüllt zugleich FR-010 (mehrfaches Auslösen bleibt wirkungslos und meldet keinen Fehler).

**Alternatives considered**: `title`-Tooltip beibehalten (heutiges Muster in `FeatureConsole.tsx` und `KanbanBoard.tsx`) — verworfen: die Klärung schließt Hover ausdrücklich aus; auf Touch existiert kein Hover.

---

## D7 — Doppelauslösung (FR-010)

**Decision**: Ein kleiner `useAction`-Hook in `FeatureAction.tsx` hält eine `inFlight`-Referenz je Aktion: ein zweiter Auslöser während eines laufenden Aufrufs wird stillschweigend verworfen. Der heutige String-Filter `if (/läuft bereits/i.test(e.message)) return;` in `KanbanBoard.tsx` und `FeatureConsole.tsx` entfällt damit ersatzlos.

**Rationale**: Der Fehlertext-Filter ist eine Notlösung, die bei jeder Umformulierung der Server-Meldung bricht. Ein Zustandsguard an der Auslösestelle ist deterministisch. Der serverseitige Doppelstart-Schutz in `startPhaseRun` (`runningPhases`/`startingPhases`) bleibt als zweite Ebene bestehen.

---

## D8 — Was ersatzlos verschwindet

| Weg | Entfernte Artefakte | Grund |
|---|---|---|
| „✓ Als abgeschlossen markieren" | Button in `KanbanBoard.tsx`, `api.markDone`, Route `POST /api/features/:id/mark-done` | FR-016 — setzte `integration='merged'` unter Umgehung von Verifikation, Review und Merge |
| Karte auf eine Schritt-Spalte ziehen | `onDrop`/`onDragOver` der Schritt-Spalten, `api.advance`, Route `POST /api/features/:id/advance`, `Orchestrator.advanceTo()` | FR-029 — gab alle übersprungenen wartenden Schritte auf einmal frei (Vier-Augen-Prinzip umgangen) |

Eine Prüfung des Repos zeigt: **kein Test und kein weiterer Aufrufer** referenziert diese Pfade. Die Entfernung ist vollständig und hinterlässt keine toten Enden. Für Features, die außerhalb des Toolkits gebaut wurden, tritt „Archivieren" an die Stelle — künftig für jedes nicht archivierte Feature verfügbar, nicht mehr nur in der Done-Spalte (FR-017).

---

## D9 — Vorschau in der Review-Übersicht (FR-019)

**Decision**: Zeilen mit `stage === 'none'` erhalten in `ReviewOverview.tsx` eine Kennzeichnung „Vorschau" und die Schaltfläche heißt dort „Vorschau öffnen" statt „👀 Öffnen". Der Fußtext des Portals lautet für diese Stufe „Vorschau — dieses Feature ist noch nicht in der Integration." statt der heutigen technischen Meldung „Keine Freigabe möglich — Zustand: none."

**Rationale**: Das Portal bietet für `none` schon heute keine Entscheidung an (`reviewable === false`); es fehlt allein die *Erkennbarkeit*, dass das Absicht ist. FR-019 verlangt genau diese Kennzeichnung, keine Verhaltensänderung.

---

## D10 — Testabdeckung

**Decision**:
- `packages/shared/src/actionPolicy.test.ts` prüft die Matrix aus `contracts/action-policy.md` vollständig: je Aktion alle Zustandsklassen, plus Exhaustiveness der Stufen-Klassifikation zur Laufzeit (Muster aus `workflowModel.test.ts`).
- `packages/shared/src/phaseMachine.test.ts` wird um `reopenLastPhase` erweitert (letzter Schritt, Effektfreiheit, optionale Schritte abgeschaltet).
- `packages/server/src/services/actionGuard.test.ts` prüft den Kontextaufbau aus Repos/PTYs und die Ablehnung mit Grund.
- `packages/server/src/api/server.test.ts` wird um Ablehnungs-Tests je bewachter Route und um den Wegfall von `mark-done`/`advance` (404) erweitert.

**Rationale**: SC-001 bis SC-005 sind Zählaussagen über Zustände — sie sind nur dann überprüfbar, wenn die Zustandsmatrix als Test existiert. Da `@sdd/web` keinen Runner hat, ist die Shared-Testsuite die einzige belastbare Absicherung der UI-Regeln; die Web-Komponenten dürfen deshalb keine eigene Bedingung mehr enthalten.
