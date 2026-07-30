# Phase 0 — Research & Leitentscheidungen: Lebenszyklus-Schritte sichtbar machen

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-07-30

Die Spezifikation enthält **keine offenen `[NEEDS CLARIFICATION]`-Marker**. Ort (`shared/`),
Typisierungsmuster (Drift-Guard wie `workflowModel.ts`) und Darstellungsort (bestehende
Workflow-Übersicht) sind laut Assumptions Vorgabe, keine offene Entscheidung. Die Unbekannten
dieses Plans sind daher rein technischer Natur — jede unten mit Entscheidung, Begründung und
verworfenen Alternativen.

---

## D1 — Katalog als statische Daten im Frontend-Bundle, nicht über die API

**Decision**: Der Katalog ist ein Objektliteral in `@sdd/shared` und wird von
`WorkflowOverview.tsx` direkt importiert. Kein Endpunkt, kein Laden, kein Ladezustand.

**Rationale**: FR-015 verlangt Vollständigkeit **ohne ausgewähltes Feature und ohne
zusätzliche Serveranfrage**, SC-006 verlangt „lädt ohne zusätzliche Serveranfragen gegenüber
heute". Die Beschreibungen sind für alle Projekte identisch und hängen an keinerlei
Laufzeitdaten — es gibt schlicht nichts zu erfragen. `@sdd/shared` wird von der Web-App bereits
per Quelltext eingebunden (`"main": "./src/index.ts"`, Vite bündelt), genau wie `PHASE_META`
und `INTEGRATION_STEPS` heute.

**Alternatives considered**:
- *`GET /api/lifecycle-catalog`*: verworfen — verletzt FR-015/SC-006, erzeugt Ladezustand,
  Fehlerfall und Serialisierungsvertrag für Daten, die zur Bauzeit feststehen.
- *Markdown-Datei im Repo, zur Laufzeit gelesen*: verworfen — nicht typprüfbar (der
  Drift-Guard aus FR-010 wäre unmöglich) und ohne Serveranfrage im Browser nicht lesbar.

---

## D2 — Eigenes Modul `lifecycleCatalog.ts` statt Erweiterung von `workflowModel.ts`

**Decision**: Neues Modul `packages/shared/src/lifecycleCatalog.ts`, aus `index.ts`
re-exportiert. `workflowModel.ts` bleibt inhaltlich unverändert.

**Rationale**: Die beiden Modelle beantworten verschiedene Fragen. `workflowModel.ts`
beschreibt die **konfigurierbare Struktur** („welche Phasen sind aktiv, was bewirkt welches
Automation-Flag, wie heißt welche Stufe") und wird gegen Live-Konfiguration gerendert. Der
Katalog beschreibt die **fest verdrahtete Arbeit des Toolkits** — konfigurationsunabhängig,
mit Code-Orten und Reihenfolge-Begründungen. Zusammengelegt entstünde eine Datei mit zwei
Verantwortlichkeiten und doppelter Größe. Getrennt bleibt zusätzlich SC-006 („alle vorhandenen
Tests bleiben grün") trivial nachweisbar, weil an `workflowModel.ts`/`workflowModel.test.ts`
keine Zeile geändert wird.

Die Spec fordert „dasselbe Drift-Guard-**Muster**, das `workflowModel.ts` schon benutzt" —
das Muster, nicht die Datei. Das Muster wird 1:1 übernommen: `Record<Union, …>` für den
Compile-Bruch, ergänzt um einen Laufzeit-Exhaustiveness-Test, wie es
`workflowModel.test.ts` mit „deckt die Domäne vollständig ab" vormacht.

**Alternatives considered**:
- *Alles in `workflowModel.ts`*: verworfen (s. o.); zusätzlich wächst die Datei um ~350 Zeilen
  reine Daten und die bestehende Kopfdokumentation („Einzige Quelle der Wahrheit für die
  STRUKTUR") würde unscharf.
- *Je Stufe eine eigene Datei*: verworfen — fünf Dateien für einen Katalog, dessen Wert gerade
  darin liegt, an einer Stelle vollständig lesbar zu sein.

---

## D3 — Drift-Guard über zwei getypte Abdeckungs-Records

**Decision**: Zwei Konstanten binden den Katalog an die bestehenden Domänen-Unions:

```ts
/** Welche Lebenszyklus-Stufen an einer Phase hängen. */
export const PHASE_LIFECYCLE_STAGES: Record<FeaturePhase, readonly LifecycleStageId[]>

/** Welche Stufe beschreibt, wie diese Integrations-Stufe zustande kommt (null = Ruhezustand). */
export const INTEGRATION_STAGE_ORIGIN: Record<IntegrationStage, LifecycleStageId | null>
```

**Rationale**: FR-010 und US2-AS1/AS2 verlangen, dass eine neue Phase **oder** eine neue
Integrations-Stufe `pnpm typecheck` *an der Stelle des Katalogs* bricht. `Record<Union, …>` ist
genau das Mittel, das `workflowModel.ts` dafür bereits einsetzt (`PHASE_META`,
`AUTOMATION_META`, `AGENT_TRIGGER_META`, `INTEGRATION_STAGE_META`): ein fehlender Schlüssel ist
ein Compile-Fehler in der Katalogdatei, nicht irgendwo an einer Verwendungsstelle.

Die Spannung zur Assumption „Phasenstart und Phasenende laufen für jede Phase identisch ab"
wird aufgelöst, indem alle Werte auf **eine gemeinsame Konstante** zeigen:

```ts
const STANDARD_PHASE_STAGES = ['phase_start', 'phase_end'] as const;
export const PHASE_LIFECYCLE_STAGES = {
  specify: STANDARD_PHASE_STAGES,
  clarify: STANDARD_PHASE_STAGES,
  …
} satisfies Record<FeaturePhase, readonly LifecycleStageId[]>;
```

Damit ist nichts dupliziert (ein Text, eine Quelle), die Entscheidung „diese Phase läuft nach
dem Standard-Schema" wird aber pro Phase bewusst getroffen — und eine künftige Phase mit
abweichendem Ablauf (z. B. ohne Phasenende) kann ihre Abweichung hier hinterlegen, statt die
Übersicht still falsch werden zu lassen.

Für `IntegrationStage` ist die Zuordnung inhaltlich sinnvoll statt formal: `verifying`,
`verify_failed`, `review_gate`, `gate_failed`, `awaiting_human_review` und `queued` entstehen
in der Stufe **Integration**; `merging`, `conflict_resolving`, `conflict_escalated` und
`merged` in der Stufe **Merge**; `none` ist der Ruhezustand und damit ausdrücklich `null`. Wer
eine Stufe ergänzt, muss beantworten, welcher Ablauf sie erzeugt.

**Alternatives considered**:
- *Nur ein Laufzeit-Test ohne Typbindung*: verworfen — US2-AS1/AS2 fordern ausdrücklich das
  Scheitern der **statischen** Prüfung; ein Test allein schlägt erst beim Testlauf an.
- *`Record<FeaturePhase, LifecycleStep[]>` mit je eigener Schrittliste pro Phase*: verworfen —
  erzeugt sieben Kopien desselben Textes, die sofort auseinanderlaufen; widerspricht der
  Assumption und der Idee einer einzigen Quelle der Wahrheit (FR-001).
- *Schritte tragen selbst ein `stage: IntegrationStage`-Feld*: verworfen — bindet nur die
  benutzten Stufen; eine **neue, unbenutzte** Stufe bräche nichts. Der Record deckt den Union
  vollständig ab, das Feld nicht.

---

## D4 — Code-Ort als `{ file, symbol }`, geprüft auf Datei **und** Symbol

**Decision**: `CodeLocation = { file: string; symbol: string }` mit repo-relativem
POSIX-Pfad (`packages/server/src/...`) und benanntem Symbol (`WorktreeManager.createUnlocked`,
`beginIntegration`, `mirrorAgentConfig`). Der Test prüft: Datei existiert **und** das letzte
Glied des Symbols kommt als Text in der Datei vor.

**Rationale**: Der Edge Case „Veraltender Ort im Code" schließt Zeilennummern aus (FR-012).
Die reine Dateiexistenz (SC-004) fängt Verschiebungen, aber keine Umbenennung einer Funktion —
und genau eine umbenannte Funktion macht die Angabe wertlos, ohne dass etwas anschlägt. Der
zusätzliche Textcheck auf das Symbol-Endglied (`createUnlocked` aus
`WorktreeManager.createUnlocked`) kostet einen `readFileSync` je Eintrag und deckt US2-AS4
(„angegebener Ort im Code existiert nicht mehr") wörtlicher ab. Bewusst nur das Endglied und
bewusst per Textsuche: eine AST-Analyse wäre für den Nutzen unverhältnismäßig, und
`private`-Methoden sind über einen Import ohnehin nicht referenzierbar.

**Alternatives considered**:
- *Nur Dateiexistenz*: erfüllt SC-004 wortgetreu, lässt aber Umbenennungen durch — verworfen
  als zu schwach für den erklärten Zweck (der Ort soll zum Nachlesen taugen).
- *Direkter Import des Symbols im Test*: verworfen — die interessantesten Schritte liegen in
  `private`-Methoden (`createUnlocked`, `commitWorktree`, `reconcile`, `launchPhase`), die
  nicht exportiert sind und es dieses Features wegen auch nicht werden sollen (FR-016).
- *Zeilenbereiche mit CI-Abgleich*: verworfen durch den Edge Case selbst.

---

## D5 — Der Dateisystem-Test liegt in `packages/server`, nicht in `packages/shared`

**Decision**: `packages/shared/src/lifecycleCatalog.test.ts` prüft alles Pure (Vollständigkeit,
Nicht-Leere, Reihenfolge, Abdeckung der Unions). Die Existenz der Code-Orte prüft
`packages/server/src/services/lifecycleCatalogPaths.test.ts`.

**Rationale**: `@sdd/shared` enthält heute **null** `node:`-Importe und führt weder
`@types/node` noch eine Runtime-Dependency — es ist bewusst ein pures, isomorphes Paket, das
die Web-App per Quelltext einbindet. Ein `import { existsSync } from 'node:fs'` in einer
Shared-Testdatei würde `tsc --noEmit` dort ohne neue Dev-Dependency gar nicht durchlaufen und
mit ihr eine Eigenschaft des Pakets aufweichen, die niemand angefragt hat. `@sdd/server` führt
`@types/node` bereits, hängt von `@sdd/shared` ab und beherbergt sämtliche dateisystemnahen
Tests — und die geprüften Dateien liegen ganz überwiegend genau dort.

**Alternatives considered**:
- *`@types/node` zu `@sdd/shared` hinzufügen*: verworfen — eine Dependency-Änderung an einem
  bewusst puren Paket für einen einzigen Test.
- *Prüfung als Skript in `package.json` statt als Test*: verworfen — US2-AS4 verlangt, dass
  **die Tests** fehlschlagen; ein separates Skript liefe in `pnpm -r test` nicht mit.

**Trade-off**: Die Prüfung eines Shared-Artefakts liegt in einem anderen Paket. Der Testname
und ein Kopfkommentar machen die Zugehörigkeit explizit; die Repo-Wurzel wird aufwärts über
`pnpm-workspace.yaml` gesucht statt über eine feste Zahl `..`-Sprünge, damit ein Verschieben
der Datei den Test nicht stillschweigend entwertet.

---

## D6 — Platzierung im Fluss: vier Andockpunkte an den vorhandenen Knoten

**Decision**: Keine eigene Ansicht, kein eigener Block. Die Schrittlisten hängen an den
Knoten, an denen die Stufe im dargestellten Ablauf ohnehin sitzt:

| Stufe | Knoten in `WorkflowOverview.tsx` |
|---|---|
| Worktree-Anlage | `PromptCard` (Feature-Anlage — beschreibt bereits Branch, Worktree, Session) |
| Phasenstart | `PhaseCard`, je angezeigter Phase |
| Phasenende | `PhaseCard`, je angezeigter Phase |
| Integration | Kopfbereich von `IntegrationBlock` |
| Merge | `IntegrationStepPill` des Schritts `merge_queue` |

**Rationale**: FR-013 verlangt die Anzeige „an der Stelle, an der die Stufe im dargestellten
Ablauf sitzt … keine separate, vom Ablauf getrennte Ansicht", die Assumption begründet das mit
dem sonst verlorenen Bezug „wann passiert das". Die vier Knoten existieren bereits und tragen
genau diese Semantik. Merge an `merge_queue` statt am terminalen Schritt `merged`, weil dort
die Arbeit stattfindet (Rebase, Konfliktauflösung, Re-Verify, Merge) — `merged` ist das
Ergebnis; der Cleanup-Schritt der Merge-Stufe nennt es im Text.

Der Edge Case „im Projekt abgeschaltete Phase" löst sich damit von selbst: `PhaseCard` wird
ohnehin nur für aktive Phasen gerendert (`orderedEnabledPhases`), abgeschaltete Phasen erzeugen
also keine leeren Einträge.

**Alternatives considered**:
- *Eigene Seite „Lebenszyklus"*: durch FR-013 und die Assumption ausgeschlossen.
- *Ein einziger Sammelblock unter der Übersicht*: verworfen — verliert den Ortsbezug, den das
  Feature herstellen soll.
- *Merge-Schritte am Knoten `merged`*: verworfen (s. o.).

---

## D7 — Aufklappzustand lokal in der Disclosure-Komponente

**Decision**: Eine kleine Komponente `LifecycleSteps` in `WorkflowOverview.tsx` mit eigenem
`useState(false)`. Kein globaler Zustand, keine Persistenz, kein `localStorage`.

**Rationale**: FR-014 fordert „standardmäßig zugeklappt" und „je Stufe unabhängig", die
Assumption fordert ausdrücklich Flüchtigkeit („nicht projekt- oder nutzerbezogen persistiert,
startet in jeder Sitzung zugeklappt"). Lokaler State erfüllt beides ohne Verdrahtung und ohne
Schlüsselvergabe; jede Instanz — auch die zwei Instanzen je `PhaseCard` und die n Instanzen
über alle Phasen — ist automatisch unabhängig. Das Muster existiert im selben Modul bereits
(`ConfigHeader`/`showSettings` mit `aria-expanded` und rotierendem `ChevronDownIcon`) und wird
übernommen, statt ein zweites zu erfinden.

**Alternatives considered**:
- *`Set<string>` offener Stufen in `WorkflowOverview`*: verworfen — Prop-Drilling durch vier
  Komponenten und Schlüsselvergabe (`stage:phase`) für null zusätzlichen Nutzen.
- *Persistenz je Projekt/Nutzer*: durch die Assumption ausgeschlossen.
- *`<details>/<summary>` nativ*: naheliegend und zustandsfrei, aber im Projekt nirgends im
  Einsatz und mit Tailwind-4-Styling im dunklen Layout aufwändiger zu vereinheitlichen als das
  vorhandene Button-Muster. Verworfen zugunsten von Konsistenz.

---

## D8 — Konfigurationsabhängige Schritte bleiben sichtbar und nennen ihre Bedingung

**Decision**: Ein optionales Feld `condition?: string` je Schritt. Schritte, die je nach
Konfiguration entfallen (Verify ohne Kommandos, Review-Gate bei abgeschalteten Review-Agents,
Re-Verify nur nach Konfliktauflösung oder Reviewer-Edits, PR-Modus statt lokalem Merge), werden
**immer** angezeigt; der Bedingungstext steht dabei.

**Rationale**: Der Edge Case sagt es wörtlich: „Der Schritt bleibt beschrieben und sichtbar;
die Beschreibung nennt die Bedingung … Die Übersicht beschreibt den Ablauf, nicht nur den
aktuell konfigurierten Ausschnitt." Zusätzlich hält es den Katalog konfigurationsfrei (FR-015)
— die Live-Konfiguration wird direkt daneben schon von `IntegrationStepPill` ausgewiesen
(„übersprungen", „automatisch", „X Verify-Kommando(s)"), und beide Ebenen bleiben so klar
getrennt: Katalog = was es gibt, Pill = was gerade gilt.

**Alternatives considered**:
- *Schritte nach aktueller Konfiguration ausblenden*: verworfen — widerspricht dem Edge Case
  und würde den Katalog von `AutomationSettings` abhängig machen (FR-015).
- *Bedingung in die Beschreibung einweben*: verworfen — als eigenes Feld ist sie im UI
  abgesetzt darstellbar und bleibt maschinell prüfbar.

---

## D9 — Reihenfolge-Begründung als eigenes Feld `orderNote`, testgesichert

**Decision**: Optionales Feld `orderNote?: string` am Schritt. Der Schritt „Worktree
festschreiben" trägt ihn verpflichtend; ein Test prüft namentlich, dass er vorhanden, nicht
leer ist und sowohl auf die Voranstellung vor dem Git-Abgleich als auch auf die Folge der
Umkehrung eingeht.

**Rationale**: FR-009 und SC-005 verlangen genau das, US3-AS3 fordert einen Test. Als eigenes
Feld ist der Hinweis (a) im UI hervorhebbar, (b) gezielt testbar ohne Volltextsuche in der
Beschreibung und (c) für weitere fragile Reihenfolgen wiederverwendbar — die
Transkript-Startmarke des Phasenstarts (vor dem Reset festhalten, damit dessen Kosten zum Lauf
zählen) und die Serialisierung der Worktree-Anlage sind dieselbe Art von Wissen.

Der Sachverhalt selbst ist im Code belegt (`mergeQueueService.beginIntegration`): Solange die
Arbeit uncommittet ist, hat der Feature-Branch keinen eigenen Commit, ist damit trivial Vorfahre
des Ziels, `reconcile()` hält ihn für „bereits gemergt" und eskaliert wegen der uncommitteten
Dateien — jede Integration eskaliert, ohne dass je committet würde.

**Alternatives considered**:
- *Begründung nur im Beschreibungstext*: verworfen — Test müsste auf Formulierungen matchen und
  bräche bei jeder harmlosen Umformulierung, oder er wäre so lax, dass er nichts sichert.
- *Nur ein `order: number` ohne Prosa*: verworfen — die Zahl transportiert die Konsequenz nicht,
  und genau die Konsequenz verhindert den Rückschritt.

---

## D10 — Nicht-Zuständigkeit auf Stufenebene (`notDoneHere`)

**Decision**: Optionales Feld `notDoneHere?: string` an der **Stufe** (nicht am Schritt). Die
Stufe „Worktree-Anlage" trägt: Abhängigkeiten (`pnpm install` o. Ä.) installiert das Toolkit
nicht — das ist Sache des Agents im Worktree.

**Rationale**: FR-004 und US3-AS2 verlangen die Aussage ausdrücklich. Sie gehört auf die Stufe,
weil sie kein Schritt ist, sondern das Fehlen eines Schritts beschreibt — ein Pseudo-Schritt
„Abhängigkeiten installieren (passiert nicht)" wäre in einer Schrittliste irreführend und würde
die Vollständigkeitstests (jeder Schritt braucht einen Code-Ort) sinnlos aufweichen. Die
Aussage ist im Code belegt: `WorktreeManager.createUnlocked` legt den Worktree an und spiegelt
via `mirrorAgentConfig` nur `.claude`, `CLAUDE.md` und `AGENTS.md`; ein Installationsschritt
existiert nirgends.

**Alternatives considered**:
- *Als gewöhnlicher Schritt mit Negativ-Beschreibung*: verworfen (s. o.).
- *Nur im UI-Fließtext*: verworfen — nicht testbar, damit nicht gegen Verlust gesichert.

---

## D11 — Längengrenze für Beschreibungen als Test statt als Konvention

**Decision**: Der Vollständigkeitstest prüft neben „nicht leer" auch eine Obergrenze je
Beschreibung (Richtwert 400 Zeichen ≈ 1–3 Sätze) und einen kurzen Namen (Richtwert 60 Zeichen).

**Rationale**: Der Edge Case „Sehr lange Beschreibungen" und SC-007 („bleibt lesbar … ohne
horizontales Scrollen") sind sonst reine Absichtserklärungen. Eine Zahl im Test hält die
Übersicht auch nach dem zwanzigsten gut gemeinten Zusatz kompakt. Die Grenze ist ein
Lesbarkeits-Guard, keine Fachregel — sie darf bewusst angehoben werden, aber nur sichtbar im
Test.

**Alternatives considered**:
- *Satzzählung statt Zeichenzahl*: verworfen — Satzerkennung über Punkte scheitert an
  Abkürzungen („z. B.", „u. a.") und Dateinamen (`tasks.md`).
- *Keine Grenze*: verworfen — der Edge Case fordert eine.

---

## Offene Punkte

Keine. Alle Unbekannten sind entschieden; die Umsetzung braucht keine weitere Recherche.
