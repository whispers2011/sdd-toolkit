# Phase 0 — Untersuchung: Chat- und Phasen-Pfad, gemeinsamer Kern

**Feature**: [spec.md](./spec.md) · **Datum**: 2026-07-31

Alle Aussagen sind am Stand des Repositories auf `feature/chat-und-phasen-pfad-gemeinsamer-kern`
(Basis-Commit `7b1c6ce`) belegt. Zeilenangaben beziehen sich auf diesen Stand.

## Ausgangsbefund: was heute wirklich doppelt ist

Die Spec nennt drei Aufgaben. Der Quellcode bestätigt sie, und die Lesung zeigt zusätzlich, **wie
weit** die beiden Fassungen auseinandergelaufen sind.

| Aufgabe | Phasen-Pfad | Chat-Pfad | Abstand |
|---|---|---|---|
| Session sicherstellen | `orchestrator.ts:249` `ensureSession` / `:259` `ensureSessionInner` | `chatWorkService.ts:101` `ensure` / `:109` `ensureUnlocked` | gering — beide koaleszieren, beide prüfen das Transkript vor dem Resume |
| Turn messen | `:942` `finishWithMetering` → `:1050` `meterFromTelemetry` → `:1114` `meterTurn` + `:977` `scheduleLateReconcile` | `:392` `meterTurn` → `:415` `usageForTurn` | **gross** — vier Bausteine fehlen im Chat |
| Arbeitskopie anlegen | `:214` (createFeature), `:273–284` (ensureSessionInner, inkl. Waisen-Reparatur) | `:119–129` (ohne Waisen-Reparatur) | mittel |

Nur drei Aufrufer von `ptys.spawn` existieren: Orchestrator, ChatWorkService und die
Projekt-Terminal-Route (`api/server.ts:289`, `kind: 'shell'`, keine Claude-Session). Genau zwei
Aufrufer von `buildClaudeArgv` und genau zwei von `worktrees.create` (drei Fundstellen, weil
`createFeature` und `ensureSessionInner` beide anlegen). Der Kern hat also eine überschaubare
Oberfläche — es gibt keinen dritten, versteckten Zwilling.

**Was dem Chat heute konkret fehlt** (alle vier im Phasen-Pfad vorhanden):

1. `telemetryStore.hold(session.id)` — der Chat meldet keinen Lauf an; sein Ereignispuffer wird
   nach Alter beschnitten (`telemetryStore.ts:122` `sweep`).
2. Der monotone Akkumulator (`orchestrator.ts:178` `telemetryAccum`) — der Chat summiert das
   Fenster genau einmal (`chatWorkService.ts:418`) und trägt nie nach.
3. Das Nachlauffenster (`scheduleLateReconcile`) — es gibt im Chat keinen Nachtrag; was 5 s nach
   dem Stop eintrifft, ist verloren.
4. Subagenten-Anteil, `telemetryFinalAt` und die Transkript-Startmarke `startOffsetIn`
   (`orchestrator.ts:1168`) — der Chat misst sein Transkript-Delta ab einem selbst geführten
   Byte-Offset ohne die drei Fallunterscheidungen (Dateiwechsel, unbekannte Startdatei).

Und ein Befund, den die Spec nur als Frage stellte und der sich bestätigt: der Chat legt seinen
Lauf erst beim Turn-Ende an (`chatWorkService.ts:404` `executions.start`) und schliesst ihn in
derselben Millisekunde ab (`:411`). `started_at == finished_at` ist damit **strukturell**, nicht
zufällig — jeder chat_work-Lauf hat Dauer 0.

---

## D1 — Ort und Zuschnitt des gemeinsamen Kerns

**Entscheidung**: Ein neuer Ordner `packages/server/src/services/core/` mit drei Bausteinen:

```text
services/core/
├── workspace.ts     # Arbeitskopie anlegen  (FR-003)
├── sessionCore.ts   # Session sicherstellen (FR-001)
├── runMeter.ts      # Turn messen           (FR-002)
└── *.test.ts
```

**Begründung**: Die drei Aufgaben brauchen IO (git, PTY, SQLite, Dateisystem) und können deshalb
nicht nach `@sdd/shared` — dort liegt ausschliesslich reine Logik. Innerhalb des Servers ist
`services/` der Ort beider Aufrufer; ein Unterordner hält die drei zusammen, wie es
`telemetry/` für die vier Bausteine der Messung vorgemacht hat. Ein Ordner auf oberster Ebene
(`src/core/`) würde eine tool-weite Rolle behaupten, die diese drei Bausteine nicht haben — sie
bedienen genau zwei Dienste.

**Verworfene Alternativen**:

- *Kein eigener Ordner, Kern in `orchestrator.ts` belassen und vom Chat importieren.* Der
  Orchestrator hat 1392 Zeilen und trägt Phasenlogik, Gates, Merge-Anstoss und Attention. Der
  Chat müsste ihn importieren, um zu messen — die Abhängigkeitsrichtung wäre dann in beide
  Richtungen (der Orchestrator hält bereits `chatWork`), und die nächste Änderung an einer der
  drei Aufgaben stünde wieder in einer Datei, die man aus zehn anderen Gründen öffnet.
- *Die beiden Dienste zu einem verschmelzen.* Die Spec schliesst das aus („der Chat-Pfad bleibt
  ein eigener Dienst mit eigenen Aufgaben", Assumptions) und FR-019 zählt auf, was
  ausdrücklich beim jeweiligen Pfad bleibt.
- *Vererbung: `ChatWorkService extends AgentSessionService`.* Eine Basisklasse müsste
  Feature-Felder kennen oder generisch werden; jeder neue Unterschied landet als
  `protected`-Haken in der Basis. Komposition über einen Auftrag (D3) hält die Unterschiede an
  der Aufrufstelle, wo sie lesbar sind.

---

## D2 — Bauform je Baustein: Funktion oder Klasse

**Entscheidung**:

| Baustein | Form | Warum |
|---|---|---|
| `ensureWorkspace()` | freie `async`-Funktion | zustandslos; die Serialisierung je (Repo, Branch) liegt bereits im `WorktreeManager` (`worktrees.ts:169`) |
| `SessionCore` | Klasse | hält die In-Flight-Karte des Doppelstart-Schutzes |
| `RunMeter` | Klasse | hält Akkumulatoren je Lauf, offene Turn-Fenster je Session und die Nachtrags-Timer |

**Begründung**: Genau die zwei Bausteine mit Gedächtnis werden Klassen — dieselbe Regel, nach der
das Repo heute `TelemetryStore` als Klasse und `telemetryAttribution` als Funktionsmodul führt.
Konstruktor-Deps als Objekt (`{ executions, telemetry, ... }`) folgt dem Muster aller
bestehenden Dienste.

---

## D3 — Wie der Kern die Unterschiede aufnimmt (FR-004)

**Entscheidung**: Über einen **Auftrag**, den der Aufrufer *innerhalb* des koaleszierten Laufs
erzeugt — eine Funktion `resolve(): SessionSpec`, nicht ein vorab gebautes Objekt.

```ts
core.ensure(`chat:${projectId}`, () => this.chatSpec(projectId))
core.ensure(`feature:${featureId}`, () => this.featureSpec(featureId))
```

**Begründung**: Beide Pfade lesen ihren Zustand heute **nach** dem Betreten des Schutzes neu
(`ensureSessionInner` holt das Feature frisch, `ensureUnlocked` ruft `chatRepo.ensureActive`).
Das ist kein Zufall: Zwischen dem ersten und dem zweiten gleichzeitigen Aufruf kann sich der
Zustand geändert haben (Neustart, gelöschte Arbeitskopie). Ein vorab gebauter Auftrag würde den
zweiten Aufrufer mit veralteten Daten bedienen. Die Auflösefunktion trägt zugleich alle
pfadspezifischen Vorprüfungen (Projekt fehlt → `ChatError(404)`; Feature abgeschlossen →
`Error`), sodass FR-005 ohne Sonderweg erfüllt ist.

**Felder des Auftrags** (vollständig in [contracts/session-core.md](./contracts/session-core.md)):
Bezugsobjekt (`featureId` / `conversationId`), `kind`, bereits laufende Session, Auftrag für die
Arbeitskopie, vorherige Session (Resume-Kandidat), aufgelöste Automatisierung, optionaler
System-Prompt, optionales Modell, `onWorktreeReady`-Rückruf und `wrapError`.

**Eine Reihenfolge muss dabei bewusst gesetzt werden**: Heute prüft der Phasen-Pfad zuerst
„läuft schon eine Session?" (`orchestrator.ts:262`) und *danach* „ist das Feature abgeschlossen?"
(`:267`) — ein abgeschlossenes Feature mit laufender Session bekommt also seine Session zurück
statt eines Fehlers. Die Auflösefunktion muss diese Reihenfolge beibehalten (erst
`ptys.forFeature`, dann die Abschluss-Prüfung), sonst ändert sich sichtbares Verhalten. Das ist
die einzige Stelle, an der die Umstellung eine Reihenfolge explizit machen muss.

**Verworfene Alternative**: ein `isChat`-Schalter im Kern. Das wäre dieselbe Aufgabe zweimal
ausgeschrieben, nur in einer Datei statt in zweien — SC-001 wäre formal erfüllt, das Ziel
(US4: „genau eine Stelle ändern") aber nicht.

---

## D4 — Wann beginnt das Turn-Fenster eines Chats?

Die Frage ist neu: der Phasen-Pfad hat mit `launchPhase` einen expliziten Startpunkt, der Chat
hat keinen.

**Entscheidung**: Das Fenster öffnet beim **ersten Übergang nach `working`** nach dem letzten
Turn-Ende. `ChatWorkService.handleStatusChange` berechnet den Status ohnehin
(`chatWorkService.ts:331`); dort wird `runMeter.openTurn(session)` gerufen — idempotent, ein
zweiter `working`-Übergang innerhalb desselben Turns (nach einer Berechtigungs-Rückfrage) öffnet
kein zweites Fenster.

**Begründung**: Drei Dinge hängen an diesem Zeitpunkt, und nur dieser Zeitpunkt trägt alle drei:

1. **`started_at` des Laufs** — soll die Turn-Dauer ergeben. Die heutige Marke („Ende des
   Vorgängerturns", `chatWorkService.ts:399`) enthält die Lesezeit des Nutzers: Ein Turn von 10
   Sekunden nach 5 Minuten Nachdenken bekäme die Dauer 5:10 und wäre als Kennzahl wertlos.
2. **Das Ereignisfenster** (`selectEventsForWindow`) — je enger, desto weniger fremder Verbrauch
   fällt hinein.
3. **`telemetryStore.hold`** — gehalten wird genau so lange, wie gearbeitet wird.

Der heutige Startwert hat zusätzlich einen Fehler: `turnStartedAt` wird beim Spawn nie gesetzt,
also gilt für den ersten Turn `startedAt = 0` — das Fenster umfasst alles, was jemals im Puffer
dieser Marke lag. Mit dem `working`-Übergang verschwindet das ohne eigene Massnahme.

**Rückfallebene**: Kommt `turn_completed`, ohne dass je ein Fenster geöffnet wurde (kein
`working`-Übergang gesehen — praktisch nur denkbar, wenn Hooks und Transkript beide ausfallen),
öffnet der Meter das Fenster rückwirkend mit dem Ende des Vorgängerturns dieser Session,
ersatzweise mit `session.startedAt`. Damit ist eine Turn-Dauer nie 0 und nie negativ.

**Verworfene Alternative**: ein eigenes `turn_started`-Effekt in `sessionMachine.ts`. Die
Maschine ist rein und wird von beiden Pfaden geteilt; ein neuer Effekt zwänge alle Aufrufer zu
einer Fallunterscheidung, obwohl der Zustandsübergang `→ working` dieselbe Information bereits
trägt.

---

## D5 — Zählende Anmeldung des Ereignispuffers (FR-007a)

**Entscheidung**: `TelemetryStore.hold`/`release` werden zählend (`Map<string, number>` statt
`Set<string>`). Der Kehraus überspringt eine Marke, solange ihr Zähler > 0 ist. Beim Abmelden des
letzten Laufs wird der Puffer **nicht** verworfen, sondern dem Kehraus nach Alter überlassen.
`forget(key)` bleibt bestehen (Puffer weg, Zähler auf 0) und wird nur noch beim endgültigen
Abräumen benutzt, nicht mehr am Ende eines Nachlauffensters.

**Begründung**: Der heutige Abschluss ruft `telemetry?.forget(session.id)`
(`orchestrator.ts:1003`) — das löscht den Puffer **der Session**, nicht des Laufs. Bei Chats ist
das der Regelfall und kein Randfall: Turns liegen Sekunden auseinander, das Nachlauffenster ist
5 Minuten lang. Der zweite Turn verlöre bei jedem Abschluss des ersten seine Meldungen. Derselbe
Fehler trifft zwei aufeinanderfolgende Phasenläufe desselben Features — dort fällt er heute nur
seltener auf, weil Phasen länger dauern.

Der Zähler ist die kleinste Lösung, die den Fall trägt: Anmelden und Abmelden gehören paarweise
zu einem Lauf, und die Freigabe hängt am letzten. Bestehende Tests bleiben grün, weil ein
einzelnes `hold` + `release` sich unverändert verhält (`telemetryStore.test.ts:120–131`).

**Verworfene Alternative**: Anmeldung je `(Marke, executionId)` mit Mengenschlüsseln. Gleiches
Verhalten, mehr Zustand — der Zähler reicht, weil der Kehraus nur eine Ja/Nein-Frage stellt.

---

## D6 — Woher die Laufzeit eines Chat-Turns kommt

**Entscheidung**: `ExecutionStartInput` bekommt ein optionales Feld `startedAt?: number`
(Vorgabe: `Date.now()`). Der Chat legt seinen Lauf weiterhin **erst beim Turn-Abschluss** an und
gibt dabei den Beginn des Turn-Fensters mit; `finishWithUsage` setzt `finished_at` wie bisher auf
`Date.now()`.

**Begründung**: Die Clarification verlangt `finished_at` am tatsächlichen Turn-Ende und eine
Dauer > 0; die Assumptions verbieten zugleich einen über die Turn-Dauer offenen Laufdatensatz
(„Der Chat verbucht seinen Lauf weiterhin atomar beim Turn-Abschluss"). Beides zusammen geht nur,
wenn der Startzeitpunkt beim Anlegen mitgegeben werden kann. Die Spalte `started_at` existiert
bereits — **keine Migration**. Der Phasen-Pfad ruft `start()` ohne das neue Feld und ist
unberührt (FR-018).

**Verworfene Alternative**: Nachträgliches `UPDATE executions SET started_at=?`. Zwei
Schreibvorgänge statt einem, und ein Zeitfenster, in dem eine falsche Dauer in der Datenbank
steht.

---

## D7 — Wie der Chat seine Ansicht nachzieht (FR-009)

**Entscheidung**: Der Kern sendet nach einem angewandten Nachtrag
`bus.emitEvent('execution_updated', { executionId, featureId })` — für Chat-Läufe ist `featureId`
schlicht `null`.

**Begründung**: Der Web-Reducer wertet die Nutzlast gar nicht aus, sondern erhöht nur
`executionsVersion` (`packages/web/src/store.tsx:253`), woraufhin die Läufe-Ansicht neu lädt. Der
bestehende Weg trägt den Chat ohne jede Änderung im Web. Ein zweites Ereignis („chat_updated")
wäre eine neue Meldung in der Oberfläche und damit gegen die Assumptions.

---

## D8 — Was der Kern *nicht* übernimmt (FR-019)

Geprüft, welche Nachbarschaft der drei Aufgaben mitwandern *könnte*, und bewusst dagegen
entschieden:

| Bleibt beim Pfad | Warum |
|---|---|
| `handleStatusChange` (beide) | Erzeugt pfadeigene Meldungstexte und Attention-Arten. FR-019 nennt es nicht, „Out of Scope" merkt es als Folge-Feature vor. |
| `handleExit` (beide) | dito — der Chat unterdrückt den Fehler-Alarm bei absichtlicher Termination, der Phasen-Pfad rollt eine laufende Phase zurück. Der Kern bekommt nur einen Aufruf `abandon(sessionId)`, damit ein offenes Turn-Fenster freigegeben wird. |
| `persistTranscriptRange` | Dient dem Lauf-Log der Phasen-Ansicht, nicht der Messung. Der Kern stellt `startOffsetIn` bereit; der Orchestrator ruft es weiter selbst. |
| Feature-Vorschläge, Marker-Erkennung, Neustart, Leerlauf-Reaper, Pausiert-Karte | Chat-eigen, FR-019. |
| Phasenzustand, Gates, Wissens-Präambel, Kontext-Optimierung, `templateHint` | Phasen-eigen, FR-019. |
| `checkWorkWithoutRun` | FR-020: unverändert feature-only. Der bestehende Filter `session.kind !== 'feature'` (`orchestrator.ts:608`) bleibt stehen und bekommt einen Test, der ihn festnagelt. |

---

## D9 — Wie die Rückkehr des Zwillings verhindert wird (US4, SC-001)

**Entscheidung**: Ein Test `services/core/singleImplementation.test.ts`, der die Quellen unter
`packages/server/src` liest (ohne `*.test.ts`) und für jede der drei Aufgaben prüft, dass ihr
charakteristischer Aufruf nur im Kern vorkommt:

| Merkmal | Erlaubte Fundstelle |
|---|---|
| `selectEventsForWindow(` · `summarizeEvents(` | `services/core/runMeter.ts` |
| `buildClaudeArgv(` | `services/core/sessionCore.ts` (+ Definition in `pty/commandBuilder.ts`) |
| `worktrees.create(` / `.create({` auf dem WorktreeManager | `services/core/workspace.ts` |
| `ptys.spawn(` | `services/core/sessionCore.ts` **und** `api/server.ts` (Projekt-Terminal, `kind: 'shell'`, keine Claude-Session — mit Begründung in der Erlaubnisliste) |

**Begründung**: Es ist das einzige Abnahmekriterium der Spec, das über *Abwesenheit* redet
(„keine zweite Implementierung"). Ein Test kann Abwesenheit prüfen, ein Review-Vorsatz nicht. Er
läuft im bestehenden `pnpm test`, braucht keine neue Abhängigkeit (`readdirSync` rekursiv) und
schlägt beim nächsten Copy-Paste sofort fehl — genau der Vorgang, der dieses Feature nötig
gemacht hat.

**Verworfene Alternativen**: ESLint-Regel (neue Abhängigkeit, eigene Regel-Datei für eine
Prüfung); Shell-Skript in CI (dieses Repo hat keine CI-Pipeline, `pnpm test` ist das Tor).

---

## D10 — Reihenfolge der Umstellung

**Entscheidung**: `workspace.ts` → `runMeter.ts` → `sessionCore.ts` → Wächter. Nach jedem Schritt
ist die volle Testsuite grün.

**Begründung**: Die Spec ordnet nach Nutzen (US1 Messung = P1, US2 Session = P2, US3 Arbeitskopie
= P3). Die Bauabhängigkeit steht dazu quer: `sessionCore` *benutzt* `ensureWorkspace`. Die
Auflösung: Der Baustein aus US3 entsteht zuerst, weil er 20 Zeilen umfasst und Baumaterial für
US2 ist — die **Abnahme** von US3 fällt trotzdem erst mit US2 zusammen, weil der Chat die
Arbeitskopie erst dann über den gemeinsamen Weg anlegt. US1 bleibt der erste Schritt mit
sichtbarem Nutzen und ist von den anderen beiden unabhängig.

---

## Offene Punkte

Keine. Alle in der Technical Context markierten Unbekannten sind mit D1–D10 beantwortet; die
Spec enthält keine `[NEEDS CLARIFICATION]`-Marker mehr (Clarifications-Sitzung vom 30.07.2026).
