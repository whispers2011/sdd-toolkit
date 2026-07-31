# Contract: Anzeige der Lebenszyklus-Schritte in der Workflow-Übersicht

**Komponente**: `packages/web/src/components/WorkflowOverview.tsx`
**Datenquelle**: statischer Import aus `@sdd/shared` ([lifecycle-catalog.md](./lifecycle-catalog.md))
**Entscheidungen**: [../research.md](../research.md) D6, D7, D8

---

## 1. Einstiegspunkt

Unverändert: Sidebar → Workflow (`{ kind: 'workflow' }`). **Kein neuer Menüpunkt, keine neue
View, keine neue Route** (FR-013).

---

## 2. Andockpunkte

Jede Stufe erscheint an dem Knoten, an dem sie im dargestellten Ablauf ohnehin sitzt:

| Stufe | Knoten | Position im Knoten |
|---|---|---|
| `worktree_create` | `PromptCard` („User-Prompt" / Feature-Anlage) | unter dem bestehenden Beschreibungstext |
| `phase_start` | `PhaseCard`, je angezeigter Phase | unter dem Zweck-Text, oberhalb der Agent-Zonen |
| `phase_end` | `PhaseCard`, je angezeigter Phase | direkt unter `phase_start` |
| `integration` | `IntegrationBlock` | im Kopfbereich, oberhalb der Schritt-Pills |
| `merge` | `IntegrationStepPill` des Schritts `merge_queue` | unterhalb des bestehenden `detail`-Textes |

Regeln:
- `PhaseCard` wird nur für aktive Phasen gerendert (`orderedEnabledPhases`) — **abgeschaltete
  Phasen erzeugen keine leeren Einträge** (Edge Case „Im Projekt abgeschaltete Phase").
- Bestehende Inhalte bleiben unverändert erhalten: die Kurzbeschreibungen der
  Integrations-Schritte, die Agent-Zonen, die Wissens-Sektion, die Legende (Assumption
  „Bestehende Kurzbeschreibungen … bleiben erhalten").

---

## 3. Bedienelement (Disclosure)

**Zugeklappt** (Startzustand, FR-014):

```
[›] Was das Toolkit hier tut (6)
```

- eine Zeile, volle Breite des Knotens, Schriftgröße der übrigen Sekundärtexte
- Chevron: vorhandener `ChevronDownIcon`, im aufgeklappten Zustand um 180° rotiert — dasselbe
  Muster wie der Einstellungs-Umschalter in `ConfigHeader`
- Zahl in Klammern = Anzahl der Schritte, ohne Aufklappen sichtbar
- **Keine zusätzliche Höhe** außer dieser Zeile (SC-007)

**Aufgeklappt**: geordnete Liste der Schritte in Katalogreihenfolge. Je Schritt:

| Element | Quelle | Darstellung |
|---|---|---|
| Nummer | Index + 1 | zurückhaltend, macht die Reihenfolge lesbar (FR-007) |
| Name | `step.name` | hervorgehoben |
| Beschreibung | `step.description` | Fließtext |
| Zeitpunkt | `step.trigger` | mit vorangestelltem Label „Wann:" |
| Ort im Code | `step.location` | `file · symbol` in Monospace, umbrechend |
| Reihenfolge-Hinweis | `step.orderNote` | abgesetzt hervorgehoben (Warn-Ton), nur wenn gesetzt |
| Bedingung | `step.condition` | mit Label „Nur wenn:", nur wenn gesetzt |

Zusätzlich am Kopf der aufgeklappten Liste: `stage.when` als Einordnungssatz. Am Fuß:
`stage.notDoneHere`, falls gesetzt, mit dem Label „Nicht Aufgabe des Toolkits:".

---

## 4. Interaktion und Zustand

| Regel | Verhalten |
|---|---|
| Startzustand | zugeklappt, in jeder Sitzung (FR-014, Assumption) |
| Umschalten | Klick auf die Kopfzeile klappt auf; erneuter Klick klappt zu (US1-AS6) |
| Unabhängigkeit | jede Instanz hat eigenen Zustand — auch die beiden Instanzen je `PhaseCard` und die Instanzen verschiedener Phasen |
| Persistenz | keine. Kein `localStorage`, kein Server, kein Store |
| Erreichbarkeit | höchstens zwei Interaktionen bis zu den Schritten einer Stufe: Übersicht öffnen, Stufe aufklappen (SC-002) |

---

## 5. Unabhängigkeit von Laufzeitdaten

- Die Anzeige ist **vollständig ohne ausgewähltes Feature** (Geltung „Projekt-Standard") und
  ohne geladene Agents/Wissen (US1-AS7, FR-015).
- Kein Ladezustand, kein Fehlerzustand, kein Leerzustand: der Katalog ist zur Bauzeit
  vollständig. Eine Stufe ohne Schritte kann nicht auftreten — sie ist ein Testfehler, kein
  UI-Fall (Edge Case „Katalog ohne Eintrag für eine Stufe").
- **Keine zusätzliche Serveranfrage** gegenüber heute (SC-006): der neue Code enthält keinen
  `api.*`-Aufruf, kein `useEffect` mit Fetch und keine neue Abhängigkeit im bestehenden
  `useEffect`-Dependency-Array.
- Konfigurationsabhängige Schritte werden **nicht** ausgeblendet; ihre Bedingung steht im Text
  (research.md D8). Was aktuell gilt, zeigt weiterhin das bestehende Badge am
  `IntegrationStepPill` („übersprungen", „automatisch", „Human-Review").
- Kein Bezug zum Fortschritt eines Features: keine Statusfarben, kein „läuft gerade"
  (Assumption „Keine Laufzeit-Verknüpfung").

---

## 6. Darstellung und Barrierefreiheit

- Deutsche Texte, dunkles Layout, bestehende Zinc-/Sky-/Amber-Palette der Komponente.
- **SVG-Icons statt Emojis** (Projektkonvention): ausschließlich `ChevronDownIcon` aus
  `components/icons.tsx` — kein neues Icon nötig.
- Umschalter ist ein `<button>` mit `aria-expanded={open}`; die Schrittliste ist eine `<ol>`.
- Kein horizontales Scrollen: lange Pfade brechen um (`break-words`/`break-all`), die Karte
  behält ihre bisherige Breite (`max-w-2xl` der Fluss-Spalte).
- Der Reihenfolge-Hinweis wird visuell abgesetzt (Rahmen + Warn-Ton), damit er beim Überfliegen
  nicht untergeht (SC-005).

---

## 7. Abnahmebezug

| Kriterium | Nachweis |
|---|---|
| US1-AS1…AS5 | je Stufe aufklappen, Pflichtschritte aus FR-004…FR-008 lesbar |
| US1-AS6 | erneuter Klick klappt zu, Übersicht so kompakt wie vorher |
| US1-AS7 | Geltung „Projekt-Standard" → alle Listen vollständig |
| US3-AS1 | Integration → Schritt „Worktree festschreiben" zeigt den Reihenfolge-Hinweis |
| US3-AS2 | Worktree-Anlage → „Nicht Aufgabe des Toolkits" nennt die Installation von Abhängigkeiten |
| SC-002 | zwei Interaktionen bis zu den Schritten |
| SC-006 | Netzwerk-Panel: identische Anfragenzahl wie vor der Änderung |
| SC-007 | alles zugeklappt → Seitenhöhe wie vorher plus die Umschaltzeilen |

Durchführung: [../quickstart.md](../quickstart.md).
