# Contract — Aktions-Policy (`@sdd/shared/actionPolicy`)

Die verbindliche Festlegung nach FR-022. Web und Server importieren dieselbe Funktion; jede Abweichung einer Oberfläche ist ein Fehler, kein Gestaltungsspielraum.

```ts
evaluateAction(action: FeatureActionId, ctx: FeatureActionContext, opts?: { phase?: FeaturePhase }): ActionVerdict
```

**Invariante**: `verdict.reason === null` **genau dann**, wenn `verdict.availability === 'available'`. `hidden` und `blocked` tragen immer einen Grund — die UI *zeigt* ihn nur bei `blocked` an (FR-028), der Server verwendet ihn in beiden Fällen als Ablehnungstext (FR-003).

---

## 1. Entscheidungsmatrix

Die Bedingungen jeder Zeile werden **von oben nach unten** geprüft; der erste Treffer gewinnt.

### `phase_start` (▶ Schritt starten)

| # | Bedingung | Befund | Grund |
|---|---|---|---|
| 1 | `archived` | `hidden` | „Das Feature ist archiviert." |
| 2 | `STAGE_CLASS[integration] === 'terminal'` | `hidden` | „Das Feature ist abgeschlossen." |
| 3 | `phase ∉ phases` | `hidden` | „Dieser Schritt ist im Projekt nicht aktiv." |
| 4 | `phases[phase].status !== 'idle'` | `hidden` | „Der Schritt ist nicht offen." |
| 5 | `!hasWorktree` | `hidden` | „Kein Arbeitsverzeichnis vorhanden." |
| 6 | `busyReason(ctx) !== null` | `blocked` | «busyReason» |
| 7 | `STAGE_CLASS[integration] === 'decision'` | `blocked` | «Entscheidungs-Satz», s. §2 |
| 8 | ein vorgelagerter aktiver Schritt ist nicht `approved` | `blocked` | „Der vorherige Schritt „«phase»" ist noch nicht freigegeben." |
| – | sonst | `available` | `null` |

### `phase_approve` (✓ freigeben) und `phase_discard` (↺ verwerfen)

| # | Bedingung | Befund | Grund |
|---|---|---|---|
| 1 | `archived` | `hidden` | „Das Feature ist archiviert." |
| 2 | `STAGE_CLASS[integration] === 'terminal'` | `hidden` | „Das Feature ist abgeschlossen." |
| 3 | `phase ∉ phases` | `hidden` | „Dieser Schritt ist im Projekt nicht aktiv." |
| 4 | `phases[phase].status !== 'awaiting_review'` | `hidden` | „Der Schritt wartet nicht auf eine Freigabe." |
| 5 | `busyReason(ctx) !== null` | `blocked` | «busyReason» |
| 6 | `STAGE_CLASS[integration] === 'decision'` | `blocked` | «Entscheidungs-Satz», s. §2 |
| – | sonst | `available` | `null` |

### `integrate` (⇥ Integrieren) — **das Kernproblem der Spec**

| # | Bedingung | Befund | Grund |
|---|---|---|---|
| 1 | `archived` | `hidden` | „Das Feature ist archiviert." |
| 2 | `integration !== 'none'` | `hidden` | „Das Feature ist bereits in der Integration — «Stufen-Label»." |
| 3 | `!isFeatureComplete(phases)` | `hidden` | „Erst integrierbar, wenn alle aktiven Schritte freigegeben sind." |
| 4 | `!hasWorktree` | `hidden` | „Kein Arbeitsverzeichnis vorhanden." |
| 5 | `busyReason(ctx) !== null` | `blocked` | «busyReason» |
| 6 | `hasChanges === false` | `blocked` | „Keine Änderungen zu integrieren." |
| – | sonst (auch `hasChanges === 'unknown'`) | `available` | `null` |

Zeile 3 ist FR-002/US1: vor der Fertigstellung wird die Aktion **gar nicht angeboten** (SC-001). Zeile 2 deckt zugleich den Edge Case „Automatischer Integrationsstart" ab — sobald `autoVerify` die Pipeline gestartet hat, ist `integration !== 'none'` und die manuelle Aktion verschwindet.

### `integration_retry` (↻ Integration erneut anstoßen)

| # | Bedingung | Befund | Grund |
|---|---|---|---|
| 1 | `archived` | `hidden` | „Das Feature ist archiviert." |
| 2 | `integration ∉ {verify_failed, gate_failed, conflict_escalated}` | `hidden` | „Es gibt keine fehlgeschlagene Integration zum Wiederholen." |
| 3 | `busyReason(ctx) !== null` | `blocked` | «busyReason» |
| – | sonst | `available` | `null` |

Zeile 2 ist FR-015: dieselben drei Stufen an **allen** Oberflächen — die heutige Lücke der Board-Karte bei `gate_failed` schließt sich damit automatisch.

### `review_approve` (✓ Freigeben & Integrieren) und `review_reject` (✗ Zurückweisen)

| # | Bedingung | Befund | Grund |
|---|---|---|---|
| 1 | `archived` | `hidden` | „Das Feature ist archiviert." |
| 2 | `integration !== 'awaiting_human_review'` | `hidden` | „Das Feature wartet nicht auf ein Review." |
| 3 | `busyReason(ctx) !== null` | `blocked` | «busyReason» |
| – | sonst | `available` | `null` |

Zeile 2 ist FR-019: ein aus der Review-Übersicht als Vorschau geöffnetes Feature in Entwicklung (`integration === 'none'`) bietet keine Entscheidung an.

### `archive` (🗄 Archivieren) und `delete` (Feature löschen)

| # | Bedingung | Befund | Grund | `confirmAbortsWork` |
|---|---|---|---|---|
| 1 | `archive` und `archived` | `hidden` | „Das Feature ist bereits archiviert." | – |
| – | sonst | `available` | `null` | `busyReason(ctx) !== null` |

Beide sind Aufräum-Aktionen und bleiben nach FR-017 in **jedem** Zustand verfügbar, also auch für nie integrierte Features. Sie werden nie gesperrt — stattdessen weist die Rückfrage nach FR-008 ausdrücklich auf den Abbruch laufender Arbeit hin, sobald `confirmAbortsWork` gesetzt ist.

---

## 2. Textkatalog

Alle Sätze sind Konstanten im Modul — sie erscheinen wortgleich in der UI und in der HTTP-Ablehnung (FR-014).

**Beschäftigt** (`busyReason`, erster Treffer gewinnt):

| Auslöser | Satz |
|---|---|
| Schritt `running` | „Es wird gerade gearbeitet — Schritt „«phase»" läuft." |
| Session `working` | „Es wird gerade gearbeitet — die Session läuft." |
| Session `awaiting_input` | „Die Session wartet auf eine Eingabe." |
| Agenten-Gate läuft | „Ein Qualitäts-Gate läuft." |
| Stufe ist `active` | „Die Integration läuft — «Stufen-Label»." |

**Entscheidungszustände** (`Record<'awaiting_human_review' | 'verify_failed' | 'gate_failed' | 'conflict_escalated', string>`):

| Stufe | Satz |
|---|---|
| `awaiting_human_review` | „Das Feature wartet auf dein Review — dort entscheiden." |
| `verify_failed` | „Die Verifikation ist fehlgeschlagen — Integration erneut anstoßen." |
| `gate_failed` | „Das Review-Gate ist fehlgeschlagen — Integration erneut anstoßen." |
| `conflict_escalated` | „Der Merge-Konflikt ist eskaliert — Integration erneut anstoßen." |

«Stufen-Label» stammt aus `INTEGRATION_STAGE_META[stage].label` (`workflowModel.ts`) — keine zweite Textquelle für Stufennamen.

---

## 3. Oberflächen-Contract

Welche Aktion welche Oberfläche rendert. Jede Zelle rendert **ausschließlich** den Befund aus `evaluateAction`; keine Oberfläche fügt eine eigene Bedingung hinzu (FR-014/SC-004).

| Aktion | Board-Karte | Feature-Konsole | Review-Übersicht | Review-Portal |
|---|---|---|---|---|
| `phase_start` | ✓ (Spalte = Schritt) | ✓ (Schrittleiste) | – | – |
| `phase_approve` | ✓ | ✓ | – | – |
| `phase_discard` | ✓ | – | – | – |
| `integrate` | ✓ (Integrations-Spalte **und** Kartenzug dorthin) | ✓ (Schrittleiste) | – | – |
| `integration_retry` | ✓ | – | ✓ | ✓ |
| `review_approve` | – | – | – | ✓ |
| `review_reject` | – | – | – | ✓ |
| `archive` | ✓ (Menü, jedes Feature) | – | – | – |
| `delete` | – | ✓ (Kopfzeile) | – | – |

Betrachtende Bedienelemente (Review-Portal öffnen, Ergebnisse ansehen, Diff/Historie lesen, im Editor öffnen, Pfad kopieren, Kommentare erfassen, Prompt an die Session senden) sind **nicht** in der Matrix und bleiben nach FR-007 unter allen Umständen verfügbar.

---

## 4. Darstellungsregeln (FR-009 / FR-028)

| Befund | Darstellung |
|---|---|
| `available` | Schaltfläche normal, klickbar |
| `blocked` | Schaltfläche sichtbar, `aria-disabled="true"`, **fokussierbar**, `aria-describedby` → Grund-Element; Klick wird wirkungslos verworfen. Der Grund steht **dauerhaft sichtbar** als ein Satz bei der Aktionsgruppe — kein Tooltip, kein Hover |
| `hidden` | Schaltfläche wird nicht gerendert |

Mehrfaches Auslösen derselben Aktion während eines laufenden Aufrufs wird still verworfen (FR-010) — kein Fehlertext, keine zweite Anfrage.

---

## 5. Drag & Drop (FR-018 / FR-029)

| Ziel-Spalte | Verhalten |
|---|---|
| Integrations-Spalte | Zug erlaubt **genau dann**, wenn `evaluateAction('integrate', ctx).availability === 'available'`. Sonst wird der Zug nicht angenommen; bei `blocked` erscheint der Grundsatz als Meldung. |
| Schritt-Spalten | **Kein Drop-Ziel mehr.** Kein `onDragOver`, kein Drop-Highlight, keine Sammel-Freigabe. |
| Done-Spalte | Unverändert kein Drop-Ziel. |

---

## 6. Testverpflichtung

`packages/shared/src/actionPolicy.test.ts` muss enthalten:

1. **Vollständigkeit**: für jede der 9 Aktionen jede Zeile der Matrix aus §1 als eigener Fall (Befund **und** Grundsatz geprüft).
2. **Invariante**: über eine erzeugte Kontext-Menge gilt `reason === null` ⟺ `availability === 'available'`.
3. **Exhaustiveness**: `STAGE_CLASS` deckt zur Laufzeit alle Werte von `IntegrationStage` ab (Muster aus `workflowModel.test.ts`).
4. **SC-001**: über alle Zwischenzustände eines Features (kein Schritt gestartet → letzter Schritt offen) ist `integrate` niemals `available`.
5. **SC-002**: bei gesetztem `busyReason` ist keine der Aktionen `phase_start`, `phase_approve`, `phase_discard`, `integrate`, `integration_retry`, `review_approve`, `review_reject` `available`.
6. **FR-011**: die Policy liest ausschließlich aus dem übergebenen Kontext — Zustände anderer Features können per Konstruktion nicht einfließen.
