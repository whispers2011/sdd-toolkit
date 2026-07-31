# Contract — Sichtstruktur der Workflow-Ansicht

Der prüfbare Vertrag der Oberfläche: **was sichtbar bleibt, was hinter ein Info-Icon wandert, was
ersatzlos verschwindet.** Jede Zeile ist gegen die laufende Anwendung prüfbar (SC-009); die
Sichtbarkeitsspalte ist die Abnahmegrundlage.

Legende: **sichtbar** = ohne Interaktion lesbar · **hinter ⓘ** = im `InfoPopover` · **aufklappbar** =
hinter dem bestehenden Chevron · **im Hub** = im `WorkflowTriggerHub` · **entfällt** = ersatzlos weg

---

## Kopfbereich (unverändert)

| Element | Sichtbarkeit | Bezug |
|---|---|---|
| Titel „Workflow", Projektname | sichtbar | — |
| Einstellungen ein-/ausklappen samt Inhalt | aufklappbar | FR-027 |
| Geltungs-Umschaltung (Projekt-Standard / einzelnes Feature) | sichtbar | FR-025, FR-027 |
| „Konfiguration neu laden" | sichtbar | FR-027 |
| spec-kit-Warnhinweis | sichtbar (wenn zutreffend) | FR-027, Edge Case |

Der Einstellungsbereich bleibt, wie er ist — er ist bereits aufgerufener Inhalt, kein Dauertext.

---

## Knoten „User-Prompt / Worktree-Anlage"

| Element | heute | künftig | Bezug |
|---|---|---|---|
| Kopf mit Icon und Titel | sichtbar | sichtbar | — |
| Absatz „Feature-Anlage: Name + Beschreibung …" | sichtbar (3 Zeilen) | **hinter ⓘ** | FR-022 |
| Entstehende Artefakte (Branch `feature/<slug>`, Worktree, Claude-Session) | im Absatz vergraben | **sichtbar**, kompakt | FR-022 |
| Kasten „Die Beschreibung wird an `/speckit-<erste Phase>` angehängt" | sichtbar (2 Zeilen) | Kommando **sichtbar**, Erklärung **hinter ⓘ** | FR-022 |
| „Was das Toolkit hier tut (6)" | aufklappbar | aufklappbar als **„Worktree-Anlage (6)"** | FR-006 |
| Zone „Vor Worktree-Anlage" ohne Einträge | sichtbar mit „— keiner" | **entfällt** | FR-001 |
| Zone „Nach Worktree-Anlage" ohne Einträge | sichtbar mit „— keiner" | **entfällt** | FR-001 |
| dieselben Zonen **mit** Einträgen | sichtbar | sichtbar, ohne „+" | FR-004, FR-005 |
| „+" je Zone | 2 Stück | **einer** im Knotenkopf → Hub | FR-002 |

---

## Knoten „Phase" (je aktiver Phase)

| Element | heute | künftig | Bezug |
|---|---|---|---|
| Statuspunkt, Titel, Marke „optional" | sichtbar | sichtbar | FR-024 |
| Kommando `/speckit-<phase> specs/<feature>` | sichtbar | sichtbar | FR-023 |
| Zwecksatz der Phase (`PHASE_META.purpose`) | sichtbar | **hinter ⓘ** | FR-023 |
| „Prompt ansehen / bearbeiten" (Split-Screen) | sichtbar | sichtbar, unverändert | FR-027 |
| „Projektwissen injiziert" | sichtbar | sichtbar | FR-024 |
| Abschnitt 1 „Was das Toolkit hier tut (7)" | aufklappbar | **„Phasenstart (7)"** | FR-006, SC-003 |
| Abschnitt 2 „Was das Toolkit hier tut (6)" | aufklappbar | **„Phasenende (6)"** | FR-006, SC-003 |
| Stufentext (`when`) + „Nicht Aufgabe des Toolkits" | im aufgeklappten Abschnitt | **hinter ⓘ am Abschnitt** | FR-009 |
| Katalog-Eintrag: Name | 1 Zeile | 1 Zeile — **die einzige** | FR-007, SC-004 |
| Katalog-Eintrag: Beschreibung, „Wann", Datei · Symbol, „Nur wenn", Reihenfolge | 4–5 weitere Zeilen | **hinter ⓘ an der Zeile** | FR-008, SC-004 |
| 4 Zonen (Schritte vor/nach, Agents vor/nach) ohne Einträge | sichtbar mit „— keiner" | **entfallen** | FR-001 |
| dieselben Zonen **mit** Einträgen | sichtbar | sichtbar, ohne „+", Reihenfolge unverändert | FR-004, FR-005 |
| „+" je Zone | 4 Stück | **einer** im Knotenkopf → Hub | FR-002 |
| Verbindung zur nächsten Phase („automatisch"/„Freigabe") | sichtbar | sichtbar | FR-024 |

---

## Knoten „Integration" (Rahmen)

| Element | heute | künftig | Bezug |
|---|---|---|---|
| Kopf mit Icon, „Integration", „nach der letzten Phase" | sichtbar | sichtbar | — |
| Aktueller Stufen-Badge („aktuell: …") | sichtbar (bei Feature-Geltung) | sichtbar | FR-024 |
| „Was das Toolkit hier tut (7)" | aufklappbar | **„Integration (7)"** | FR-006 |
| Eskalations-Absatz („Scheitert Verify/Gate/Merge …", 4 Zeilen) | sichtbar | **hinter ⓘ am Knotenkopf** | FR-019 |
| Eskalationsfolge je Stufe (rote Zeile mit Zustandsnamen) | sichtbar | sichtbar | FR-019 |

### Gruppierung nach Board-Spalten (US3)

```text
Integration
├─ Prüfung        ← INTEGRATION_COLUMN_LABELS.verify
│   ├─ Verifikation      (VerifyIcon)
│   └─ Review-Gate       (ScalesIcon)
├─ Abnahme        ← .accept
│   └─ Manuelle Abnahme  (FlaskIcon)
│   ↑ Ablehnung → «Zielphase»   ⓘ            ← nur bei manualTestGate (FR-015)
├─ Review         ← .review
│   └─ Menschliches Review (ReviewIcon)
├─ Merge          ← .merge
│   └─ Merge-Queue      (GitMergeIcon)
└─ Done           ← .done
    └─ Gemergt          (CheckIcon)
```

| Zusicherung | Bezug |
|---|---|
| Spaltenüberschriften sind wortgleich mit denen des Boards (`INTEGRATION_COLUMN_LABELS`) | FR-010, SC-005 |
| Spaltenreihenfolge und Stufenreihenfolge folgen `INTEGRATION_STEPS` | FR-010 |
| Jede Stufe steht unter der Spalte aus `COLUMN_FOR_STEP` — dieselbe Zuordnung wie im Board | FR-011, SC-005 |
| Eine bei der Geltung übersprungene Stufe bleibt **in ihrer Spalte** sichtbar und als übersprungen markiert | FR-010, US3-AS3 |

---

## Knoten „Integrationsstufe" (je Stufe)

| Element | heute | künftig | Bezug |
|---|---|---|---|
| Icon | teils falsch (`manual_test` → Verify) | **eigenes SVG je Stufe**, paarweise verschieden | FR-017, SC-007 |
| Label | sichtbar | sichtbar | — |
| Badge (automatisch / manuell / übersprungen / entfällt / Human-Review / Ziel) | sichtbar | sichtbar | FR-024 |
| `detail`-Text der Stufe | sichtbar (2–3 Zeilen) | **hinter ⓘ** | FR-019-Geist, „Ansicht = Ablaufdiagramm" |
| „N Verify-Kommando(s)" bzw. „keine konfiguriert" | sichtbar | sichtbar | FR-024 |
| „lokaler Merge (ff)" / „GitHub-PR" | sichtbar | sichtbar | FR-024 |
| Eskalationsziel (rote Zeile) | sichtbar | sichtbar | FR-019 |
| „Was das Toolkit hier tut" an `merge_queue` | aufklappbar | **„Merge (6)"** | FR-006 |
| Zonen „Vor Stufe"/„Nach Stufe" ohne Einträge | sichtbar mit „— keiner" | **entfallen** | FR-001 |
| Agent-Zone am Review-Gate ohne Einträge | sichtbar mit „— keiner" | **entfällt** | FR-001 |
| dieselben Zonen **mit** Einträgen | sichtbar | sichtbar, ohne „+" | FR-004, FR-005 |
| „+" je Zone (2, am Review-Gate 3) | mehrere | **einer** im Stufenkopf → Hub | FR-002 |

> Der `detail`-Text ist nicht ausdrücklich in einer FR benannt, aber er ist Fließtext je Stufe
> (6 × 2–3 Zeilen) in einer Ansicht, die laut Spec-Ziel ein Ablaufdiagramm sein soll, und er wird
> für SC-008 gebraucht. Er wandert deshalb nach derselben Regel wie der übrige Erklärtext hinter ⓘ
> — verlustfrei, unverändert aus `INTEGRATION_STEPS.detail`.

---

## Rückkante (US4)

| Zusicherung | Bezug |
|---|---|
| Sichtbare Kante von der Stufe „Manuelle Abnahme" zur Zielphase, Pfeilrichtung nach oben | FR-013, SC-006 |
| Kurzbeschriftung nennt den Ablehnungsweg und das Ziel-Phasenlabel aus `PHASE_META` | FR-014 |
| Zielphase kommt aus `rejectTargetPhase(orderedEnabledPhases(project.enabledPhases))` — kein Literal | FR-013 |
| ⓘ nennt: Befunde als Arbeitsauftrag in die bestehende Spezifikation · Nachgelagertes als veraltet markiert · Lebenszyklus läuft erneut | FR-014, US4-AS2 |
| Wird **nicht** gezeichnet, wenn `manualTestGate` aus ist | FR-015, US4-AS3 |

---

## Wissens-Abschnitt

| Element | heute | künftig | Bezug |
|---|---|---|---|
| Kopfzeile mit Icon, Titel, „wird vor jeder Phase injiziert" | sichtbar | sichtbar | FR-020 |
| „Wissen verwalten" | sichtbar | sichtbar, unverändert | FR-020, FR-027 |
| Absatz „Vor jedem Phasenstart wird das relevante Wissen …" | sichtbar (4 Zeilen) | **hinter ⓘ** | FR-020 |
| Kasten „An den Prompt angehängt" mit vollem Präambel-Text | sichtbar (5 Zeilen) | **hinter ⓘ** (im selben Popover) | FR-020 |
| Liste der Wissenseinträge samt „relevant"-Marke und Anwendbarkeit | sichtbar | sichtbar | FR-020 |
| Hinweis „Noch kein Projektwissen hinterlegt" | sichtbar | sichtbar | Edge Case |

---

## Legende

| Element | heute | künftig | Bezug |
|---|---|---|---|
| Achtteilige Legende als Textzeile am Fuß | sichtbar | **hinter einem einzigen ⓘ** am Fuß | FR-021, US6-AS3 |

Inhalt unverändert: automatisch · Human-in-the-Loop · Eskalation → Braucht dich · Agent-Gate
(blockierend) · Agent-Hinweis (beratend) · Schritt (blockierend) · Schritt (beratend) ·
Projektwissen-Injektion.

---

## Was nirgends verlorengehen darf (FR-027 — Bedienwege)

| Bedienweg | Weiterhin erreichbar über |
|---|---|
| Prompt ansehen/bearbeiten (Split-Screen) | Schaltfläche auf der Phasenkarte, unverändert |
| Agent anlegen | Hub → Agent-Punkt → `AgentSlotPicker` → „Neuen Agent erstellen" |
| Bestehenden Agent einhängen | Hub → Agent-Punkt → `AgentSlotPicker` → Liste |
| Agent bearbeiten | Klick auf den Chip (inline **oder** im Hub) |
| Schritt anlegen | Hub → Schritt-Punkt → `LifecycleStepEditDialog` mit vorbelegtem Auslöser |
| Schritt bearbeiten | Klick auf den Chip (inline **oder** im Hub) |
| Geltung umschalten | Auswahlfeld im Kopf, unverändert |
| Einstellungen ein-/ausklappen | Schaltfläche im Kopf, unverändert |
| Konfiguration neu laden | Schaltfläche im Kopf, unverändert |
| Wissen verwalten | Schaltfläche im Wissens-Abschnitt, unverändert |
| spec-kit-Warnhinweis | oben im Fluss, unverändert |
