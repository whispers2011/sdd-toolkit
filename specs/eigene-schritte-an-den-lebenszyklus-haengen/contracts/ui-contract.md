# Vertrag: Oberfläche

Deutsche UI, dunkles Layout, **Symbole als SVG-Icons** aus `components/icons.tsx` (keine Emojis).
Jede Ansicht ist der Zwilling einer bestehenden — es entsteht kein neues Bedienkonzept
(Assumption „Bedienung nach Vorbild der Agents").

---

## 1. Einstiegspunkte

| Ort | Aktion | Vorbild |
|---|---|---|
| Sidebar → Projektzeile (Hover) | Icon-Button **„Lebenszyklus-Schritte"** → View `{ kind: 'lifecycle_steps', projectId }` | der `⚖`-Button für Agenten (`Sidebar.tsx`) |
| Feature-Konsole | Button **„Schritte"** → Dialog `FeatureLifecycleStepSelect` | Button „Agents" → `FeatureAgentSelect` |
| Workflow-Übersicht | Schritt-Chips an allen sechs Auslöserpunkten, `+`-Button je Punkt | `AgentZone`/`AgentChip` |
| Läufe-Ansicht | Schritt-Läufe als eigene Art mit Schrittname, Exit-Code und Log-Öffner | bestehende Lauf-Detailliste |
| „Braucht dich"-Inbox | Meldung `lifecycle_step_failed` mit Sprung zum Feature | bestehende Inbox-Einträge |

---

## 2. Verwaltung — `LifecycleStepsPanel`

Aufbau exakt wie `AgentsPanel`: zwei Abschnitte **„Global (alle Projekte)"** und
**„Projekt: &lt;Name&gt;"**, je mit Anzahl, `+ Schritt anlegen` und einer Zeilenliste.

**Kopftext** (verbindlich, weil er FR-004 sichtbar macht):

> Schritte laufen automatisch an ihren Auslösern. Globale UND projektspezifische Schritte gelten
> gemeinsam; sie laufen nacheinander — zuerst die globalen, dann die des Projekts, je Gruppe in
> der eingestellten Position. Pro Feature einzeln an-/abwählbar (Feature-Konsole → Schritte).

**Je Zeile**: Name · Auslöser-Chip · `Blockierend`/`Hinweis`-Chip · Zeitlimit-Chip (nur wenn vom
Vorgabewert abweichend) · Kommando als einzeilige `<code>`-Vorschau (`truncate`) ·
Aktionen ↑ ↓ · `Aktiv`/`Inaktiv` · `Bearbeiten` · Löschen.

**Auslöser-Chip-Text** (aus `LIFECYCLE_TRIGGER_META`, nie aus einem lokalen Literal):

| Auslöser | Chip |
|---|---|
| `before_worktree_create` | `vor Worktree` |
| `after_worktree_create` | `nach Worktree` |
| `before_phase` / `after_phase` | `vor <Phasentitel>` / `nach <Phasentitel>` |
| `before_stage` / `after_stage` | `vor <Stufentitel>` / `nach <Stufentitel>` |

**Löschen**: Bestätigung „Schritt „&lt;Name&gt;" löschen? Bisherige Läufe bleiben lesbar."
(wörtlich das Agent-Muster, deckt FR-028 sichtbar ab).

**Umordnen** ↑ ↓ tauscht `sortOrder` **innerhalb** des Abschnitts — global und Projekt sind
getrennte Gruppen, weil die Ausführungsreihenfolge sie ohnehin gruppiert.

---

## 3. Anlegen/Bearbeiten — `LifecycleStepEditDialog`

Felder (Layout wie `AgentEditDialog`, zweispaltiges Grid):

| Feld | Steuerelement | Regel |
|---|---|---|
| Name | Textfeld, `autoFocus` | Pflicht |
| Kommando | mehrzeiliges `textarea`, `font-mono`, `spellCheck={false}` | Pflicht |
| Auslöser | `select` über `LIFECYCLE_TRIGGER_KINDS` mit Titeln aus `LIFECYCLE_TRIGGER_META` | — |
| Phase | `select` über `FEATURE_PHASES` | nur bei `before_phase`/`after_phase` sichtbar |
| Stufe | `select` über `INTEGRATION_STAGE_IDS` mit Stufentiteln | nur bei `before_stage`/`after_stage` sichtbar |
| Zeitlimit (Minuten) | Zahlenfeld, Platzhalter `15` | leer = Vorgabewert; > 0, ≤ 1440 |
| Blockierend | Checkbox, Vorbelegung **an** | Hilfetext: „Fehlschlag hält die Stufe an; sonst nur Hinweis" |
| Aktiv | Checkbox, Vorbelegung **an** | — |
| Geltungsbereich | Nur-Text bei Neuanlage („dieses Projekt" / „global") | bei Bearbeitung fix |

**Hilfetext unter dem Kommandofeld** (verbindlich — er ist der einzige Ort, an dem der
Umgebungsvertrag in der UI steht):

> Läuft in einer Login-Shell im Worktree. Verfügbar: `$SDD_WORKTREE`, `$SDD_PROJECT`,
> `$SDD_FEATURE`, `$SDD_BRANCH`, `$SDD_PHASE`, `$SDD_STAGE` — nicht zutreffende Angaben sind
> leer. Bewertet werden nur Exit-Code und Zeitlimit; die Ausgabe wird nicht ausgewertet.

Speichern ist deaktiviert, solange Name oder Kommando leer sind.

---

## 4. Per-Feature-Auswahl — `FeatureLifecycleStepSelect`

Dialog „Lebenszyklus-Schritte für dieses Feature", Aufbau wie `FeatureAgentSelect`:
Punkt (grün = läuft / grau = läuft nicht) · Name · Auslöser-Chip · `Hinweis`-Chip bei beratend ·
Umschalter `Auto | Ein | Aus`. **Kein** „Jetzt ausführen"-Button (Out of Scope).

Kopftext:

> „Aus" schließt den Schritt für dieses Feature aus (auch globale). „Ein" erzwingt ihn auch, wenn
> er deaktiviert ist. Ohne Festlegung gilt die Ebene darüber.

Unter jeder Zeile der jüngste Lauf: Zeitpunkt, Dauer, Ergebnis-Pille (`erfolgreich` /
`fehlgeschlagen (exit N)` / `unterbrochen`) — leer, wenn noch keiner lief.

Leerzustand: „Keine Schritte definiert (Sidebar → Lebenszyklus-Schritte)."

---

## 5. Workflow-Übersicht — `StepZone`

Neue Komponente neben `AgentZone`, gleiche Optik (Trennlinie, Kleinkapitälchen-Titel, `+`-Button,
Leerzustand „— keiner"). Platzierung:

| Knoten | Zonen |
|---|---|
| `PromptCard` (Feature-Anlage) | **Vor Worktree-Anlage**, **Nach Worktree-Anlage** |
| `PhaseCard` (je Phase) | **Vor Phase** und **Nach Phase**, jeweils **über** der jeweiligen `AgentZone` — die Anordnung spiegelt die Ausführungsreihenfolge |
| `IntegrationStepPill` (je Stufe) | **Vor Stufe**, **Nach Stufe** |

**Chip**: Name · `Blockierend`/`Hinweis` · `global`-Marke · `erzwungen`/`aus` bei
Feature-Ausnahme; Klick öffnet den Bearbeiten-Dialog. Nicht wirksame Schritte werden
ausgegraut — identisch mit `AgentChip`.

**Zusicherung**: Die Zonen werden aus `LIFECYCLE_TRIGGER_META` und `INTEGRATION_STAGE_IDS`
erzeugt, nie aus lokalen Literalen. Eine neue Auslöser-Art oder Stufe erscheint damit
automatisch bzw. bricht den Typcheck (FR-008, US5 Szenario 4).

---

## 6. Läufe-Ansicht — `ExecutionsView`

- `KIND_LABELS` (`Record<ExecutionInfo['kind'], string>`) += `lifecycle_step: 'Schritt'` — der
  `Record`-Typ erzwingt den Eintrag beim Kompilieren.
- `STEP_LABELS` += `lifecycle_step: 'Schritte'`.
- In der Detailliste eines Laufs zeigt eine Zeile mit `kind === 'lifecycle_step'`:
  `Schritt · <label> · <Dauer> · <Ergebnis> · exit <code>` und den Log-Öffner.
- **Keine** Token-/Betragsspalte für diese Zeilen — es gibt keinen Wert, und ein „0" wäre eine
  Falschaussage (FR-020).
- Der Anteil „gemessen" eines Laufs bezieht Schritt-Läufe nicht in den Nenner ein.

---

## 7. Inbox

Eintrag der Art `lifecycle_step_failed`, Ton **escalation** (rot), mit dem Meldungstext aus
`data-model.md` §6: Schrittname, Kommando, Exit-Code, letzte Ausgabezeilen. Klick springt zum
Feature. Manuelles Auflösen bleibt möglich; bei erfolgreichem Wiederanlauf verschwindet der
Eintrag von selbst (FR-025).

---

## 8. Zustände

| Zustand | Darstellung |
|---|---|
| Lädt | „Lade Schritte …" (Muster `AgentsPanel`) |
| Leer (global und Projekt) | „Keine Schritte." je Abschnitt — **kein** Fehler |
| Speichern läuft | Speichern-Button deaktiviert |
| Fehler | bestehender `error`-Dispatch des Stores (Toast) |
