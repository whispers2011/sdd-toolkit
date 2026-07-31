# Phase 0 — Research & Leitentscheidungen

**Feature**: Ersetzbare Kernschritte, Stack-Profile und Testing-Lane
**Datum**: 2026-07-31
**Grundlage**: [spec.md](./spec.md), F1a/F1b (umgesetzt und gemergt), Bestandscode

Es gab **keine offenen NEEDS CLARIFICATION** aus dem Template: die Spec beantwortet über den
Abschnitt „Assumptions" alle Fragen, die den Zuschnitt betreffen (Portbereich als Block, `full`
auf Anforderung, letzter räumt den geteilten Dienst ab, keine mitgelieferten Profilkommandos,
konfigurierbare Warnschwelle, Größe als Schätzung, Ablehnung führt nach `implement` zurück,
Env-Datei als Erzeugnis). Die Recherche dieses Features betrifft deshalb nicht die Fachlichkeit,
sondern **wo im Bestand die Wirkung eingehängt wird, ohne einen zweiten Weg zu schaffen**.

Jede Entscheidung nennt: Entscheidung — Begründung — verworfene Alternativen.

---

## E1 — Die Portvergabe sitzt in `WorktreeManager.create()`, nicht im Orchestrator

**Entscheidung**: Ein `PortAllocator` (Server-Service, einzige Klasse mit Schreibzugriff auf die
Tabelle `port_blocks`) wird in `WorktreeManager` injiziert und **ausschließlich** aus
`create()` (belegen) und `remove()` (freigeben) aufgerufen. Kein Aufruf aus `Orchestrator`,
`ChatWorkService`, `MergeQueueService` oder einer Route.

**Begründung**: FR-001 verlangt wörtlich, dass die Zuweisung „an einer einzigen Stelle" geschieht,
und F1b FR-013 hat `$SDD_PORT_BASE` genau deshalb aus F1b herausgenommen: zwei Quellen erzeugen die
Kollision, die dieses Feature beseitigen soll. Der Bestand hat genau **einen** Ort, durch den jede
Worktree-Anlage läuft — `WorktreeManager.create()`. Beide Anlagepfade nutzen ihn:
`Orchestrator.prepareWorktree()` (Feature-Worktrees, `worktrees.ts:162`) und
`ChatWorkService.ensureSession()` (`chatWorkService.ts:159`). Damit erfüllt eine einzige
Einhängung auch FR-002 („eindeutig projektübergreifend"), weil kein Worktree an ihr vorbeikommt.
`create()` ist zusätzlich bereits **idempotent und pro (Repo, Branch) serialisiert** — genau die
Eigenschaften, die eine Vergabe ohne Doppelbelegung braucht (FR-004).

**Verworfene Alternativen**:

- *Zuweisung in `Orchestrator.prepareWorktree()`*: verworfen — Chat-Worktrees bekämen keinen Block
  und könnten unbemerkt in einen fremden Bereich hineinbinden; FR-002 fordert Eindeutigkeit über
  **alle** gleichzeitig bestehenden Worktrees.
- *Zuweisung erst beim ersten Stack-Start*: verworfen — dann hätte ein Schritt „nach
  Worktree-Anlage" kein `$SDD_PORT_BASE` (US1 Szenario 2 verlangt den Wert an jedem Schritt), und
  die Env-Datei existierte zeitweise nicht (US1 Szenario 1).
- *Ableitung aus einem Hash des Worktree-Pfads (vergabefrei)*: verworfen — ein Hash kollidiert
  ohne Buchführung und lässt FR-003 (belegte Bereiche überspringen) und FR-005 (Freigabe und
  Wiederverwendung) nicht abbilden.

---

## E2 — Portbereich = zusammenhängender Block fester Breite, Dienstports als Abstand

**Entscheidung**: `$SDD_PORT_BASE` ist der **Anfang** eines Blocks fester Breite, der dem Worktree
exklusiv gehört. Ein Dienstport ist `portBase + service.portOffset`. Vorgabewerte (in `config.ts`,
über Umgebung übersteuerbar):

| Konfiguration | Vorgabe | Bedeutung |
|---|---|---|
| `SDD_PORT_RANGE_START` | `21000` | erster vergebbarer Port |
| `SDD_PORT_BLOCK_SIZE` | `20` | Breite eines Blocks |
| `SDD_PORT_RANGE_END` | `29980` | letzter Blockanfang |

Ergibt 449 Blöcke. Projektweit **geteilte** Dienste bekommen einen **eigenen Block je Projekt**
(Besitzerart `project` in derselben Tabelle, dieselbe Arithmetik) — ihr Kommando erhält diesen
Block als `$SDD_PORT_BASE`.

**Begründung**: Die Spec legt den Block in „Assumptions" fest und begründet ihn: das Beispiel
`8080+n/4000+n` ist damit abgedeckt, ohne zwei getrennte Zahlenreihen zu führen. 20 Ports fassen
das genannte Sieben-Dienste-Projekt mit Reserve. Der Startwert 21000 liegt oberhalb der üblichen
Entwicklungsports (3000/4000/5173/8080) und unterhalb des ephemeren Bereichs, den macOS ab 49152
vergibt — Kollisionen mit fremder Software sind damit unwahrscheinlich, aber nicht
ausgeschlossen, weshalb FR-003 (Prüfung) trotzdem gilt. Der **eigene Block je Projekt** für
geteilte Dienste ist die einzige Lösung, die ohne dritte Umgebungsvariable auskommt: ein geteilter
Dienst kann per Definition nicht im Block eines einzelnen Features liegen, sonst stirbt er mit
dessen Abbau.

**Verworfene Alternativen**:

- *Zwei getrennte Zahlenreihen (`8080+n`, `4000+n`)*: verworfen — zwei Buchführungen, zwei
  Erschöpfungsgrenzen, und `$SDD_PORT_BASE` wäre nicht mehr eindeutig belegt.
- *Blockbreite pro Projekt konfigurierbar*: verworfen — die Breite bestimmt die Blockgrenzen
  global; variable Breiten machen Vergabe und Freigabe zu einem Packungsproblem. YAGNI.
- *Geteilte Dienste im Block des ersten Features*: verworfen — der Dienst müsste beim Abbau
  dieses Features umziehen; FR-022 verlangt das Gegenteil (er bleibt stehen).

---

## E3 — Freiheitsprüfung: Bind-Probe auf alle Ports des Blocks, belegte Blöcke überspringen

**Entscheidung**: Vor der Zuweisung wird **jeder** Port des Kandidatenblocks probeweise gebunden
(`node:net`, `server.listen({ host: '0.0.0.0', port })`, sofort wieder geschlossen). `EADDRINUSE`
auf einem einzigen Port verwirft den ganzen Block; der Allocator nimmt den nächsten freien
Blockanfang, der nicht in `port_blocks` steht. Nebenläufig, Zeitlimit 500 ms je Block. Sind alle
Blöcke belegt, wirft der Allocator mit klarem Text (FR-010).

**Begründung**: FR-003 verlangt die Prüfung „ob die Ports des Bereichs frei sind" — nicht nur der
Anfang. Bind statt Connect: ein Dienst, der nur auf `127.0.0.1` lauscht, antwortet keinem
Connect-Versuch auf einer anderen Adresse, blockiert aber ein späteres Binden auf `0.0.0.0`;
`EADDRINUSE` beim Binden ist die Frage, die die Stack-Kommandos später auch stellen. Der Wurf statt
einer stillen Doppelvergabe folgt der Linie des Projekts („lieber sichtbar scheitern als still
falsch werden") und wird durch den bestehenden Rollback in `Orchestrator.createFeature()` sauber
abgefangen: kein halbes Feature.

**Verworfene Alternativen**:

- *Nur den Anfangsport prüfen*: verworfen — die beobachtete Kollision betraf `8080` **und** `4000`;
  ein Block gilt nur als frei, wenn er ganz frei ist.
- *`lsof`/`netstat` auswerten*: verworfen — Prozessaufruf, plattformabhängige Ausgabeformate, und
  weniger aussagekräftig als der Bindeversuch selbst.
- *Nichts prüfen, allein auf die Buchführung vertrauen*: verworfen — FR-003 existiert genau für
  projektfremde Prozesse, die in der Buchführung nie stehen.

---

## E4 — Env-Datei `<worktree>/.sdd/env`: Erzeugnis mit git-Ausschluss **und** Nachprüfung

**Entscheidung**: Der Allocator schreibt `<worktree>/.sdd/env` (Shell-sourcebar,
`KEY=value`-Zeilen) mit den **stabilen** Angaben des Worktrees: `SDD_PORT_BASE`, `SDD_PORT_SPAN`,
`SDD_WORKTREE`, `SDD_PROJECT`, `SDD_FEATURE`, `SDD_BRANCH`. Vor dem ersten Schreiben trägt er
`/.sdd/` idempotent in `$GIT_COMMON_DIR/info/exclude` des Projekt-Repos ein und **prüft**
anschließend mit `git check-ignore -q .sdd/env`, dass die Datei wirklich ignoriert wird; scheitert
die Prüfung, entsteht eine „Braucht dich"-Meldung statt eines stillen Commits. Bei jeder erneuten
Bereitstellung des Worktrees wird die Datei neu geschrieben — die Zuweisung des Toolkits gewinnt
(Edge Case „von Hand verändert").

**Begründung**: FR-009 verlangt, dass die Datei nicht in Commits oder Merges gelangt. Der Bestand
macht das nicht von allein: `MergeQueueService.commitWorktree()` ruft `git add -A`
(`mergeQueueService.ts:763`) und würde eine ungetrackte Datei mitnehmen. `info/exclude` ist die
richtige Ablage, weil git sie aus dem **gemeinsamen** Verzeichnis liest (`$GIT_COMMON_DIR`) — ein
Eintrag deckt alle Worktrees des Repos — und weil sie selbst nie versioniert wird; eine Änderung an
der projekt-eigenen `.gitignore` wäre dagegen eine Änderung am Repo des Nutzers und würde
committet. Die Nachprüfung mit `check-ignore` gehört dazu, weil ein bereits getracktes `.sdd/`
(theoretisch) den Ausschluss aushebelt: das Toolkit soll das **feststellen**, nicht annehmen.

Nur stabile Angaben in der Datei: `SDD_PHASE`/`SDD_STAGE` wechseln pro Lauf und stehen deshalb
ausschließlich in der Prozessumgebung — eine Datei mit veraltetem Phasenwert wäre eine
Falschaussage.

**Verworfene Alternativen**:

- *`.env` im Worktree-Wurzelverzeichnis*: verworfen — viele Projekte haben eine eigene `.env`;
  das Toolkit darf sie nicht überschreiben (Assumption: die Datei ist ein Erzeugnis des Toolkits).
- *Datei außerhalb des Worktrees (z. B. `<dataDir>/ports/<feature>.env`)*: verworfen — FR-006 und
  US1 Szenario 1 verlangen die Datei **im** Worktree, damit Schritte und Agents sie ohne Wissen
  über das Datenverzeichnis finden.
- *Pathspec-Ausschluss beim Commit (`git add -A -- ':(exclude).sdd/'`)*: verworfen als **einziger**
  Schutz — er wirkt nur an der einen Commit-Stelle des Toolkits; ein Agent, der im Worktree selbst
  committet, umgeht ihn. `info/exclude` wirkt für jeden git-Aufruf im Worktree.

---

## E5 — `buildLifecycleEnv()` wächst um genau zwei Schlüssel — kein zweiter Weg

**Entscheidung**: `LifecycleContext` bekommt zwei Felder (`portBase: number | null`,
`profile: StackProfileName | null`), `buildLifecycleEnv()` liefert zwei Schlüssel mehr:
`SDD_PORT_BASE` (Blockanfang als Dezimalzahl, leerer String wenn kein Block bekannt) und
`SDD_PROFILE` (`test`/`full`/`down`, leerer String bei einem gewöhnlichen Schritt). Damit liefert
die Funktion **acht** Schlüssel, immer alle vorhanden. `StackService` ruft **dieselbe** Funktion —
es gibt keinen eigenen Umgebungsaufbau für Profilläufe.

**Begründung**: FR-007 verlangt beide Variablen „über dieselbe Stelle, an der F1b den Variablensatz
aufbaut", und verbietet einen zweiten Weg. F1b hat den Erweiterungspunkt ausdrücklich dafür
vorgesehen (Kommentar in `lifecycleSteps.ts:91` und research E4 von F1b). Der leere String statt
eines fehlenden Schlüssels erhält die F1b-Eigenschaft, dass `set -u` in einem Kommando gefahrlos
ist (`[ -z "$SDD_PROFILE" ]` unterscheidet Schritt von Profillauf). FR-008/SC-007 (Alt-Schritte
unverändert) ist dadurch erfüllt, dass **nur hinzugefügt** wird: kein bestehender Schlüssel ändert
Name oder Bedeutung.

**Verworfene Alternativen**:

- *Eigener Umgebungsaufbau im `StackService`*: verworfen — genau der „zweite Weg", den FR-007
  ausschließt; die Portquelle wäre dann zweimal im Code.
- *Mehr Variablen (`SDD_PORT_SPAN`, `SDD_SERVICES`, `SDD_SHARED`)*: verworfen — die Spec listet
  zwei Ergänzungen; die Blockbreite steht in der Env-Datei, und die Unterscheidung
  feature-eigen/geteilt löst E7 ohne Variable.
- *Textersatz im Kommando (`{portBase}`)*: verworfen aus demselben Grund wie in F1b — Injection
  und Quoting.

---

## E6 — Ein Ausführungspfad: der Runner von F1b wird herausgezogen, nicht kopiert

**Entscheidung**: Der `defaultRunner` aus `lifecycleStepService.ts` (Login-Shell, gestreamtes Log,
Tail-Puffer, Zeitlimit) wandert unverändert nach `services/stepRunner.ts` und wird von
`LifecycleStepService` **und** `StackService` genutzt. Bei der Verlegung kommt genau eine Änderung
hinzu: der Prozess wird mit `detached: true` gestartet und bei Zeitlimit über seine
**Prozessgruppe** beendet (E12). Profilläufe werden wie Schritt-Läufe als Execution der Art
`lifecycle_step` mit `label: 'Stack: test'` verbucht — ohne Verbrauchswert.

**Begründung**: Die Spec nennt die Profile ausdrücklich „ersetzbare **Kernschritte**": sie sind
Schritte, deren Auslöser das Toolkit setzt und deren Kommando das Projekt liefert. Ein zweiter
Runner hätte zwangsläufig abweichendes Verhalten bei Zeitlimit, Log-Ablage und Ausgabe-Ausschnitt —
und würde die Prozessgruppen-Regel (FR-040) an zwei Stellen brauchen. Der Herausziehung steht
nichts entgegen: der Runner ist bereits als injizierbarer `StepRunner`-Typ formuliert und durch
`lifecycleStepService.test.ts` gedeckt.

**Verworfene Alternativen**:

- *Profile als Zeilen in `lifecycle_steps` mit neuen Auslöserarten*: verworfen — `full` hat gar
  keinen Lebenszyklus-Auslöser (nur Anforderung), `down` hat vier, und die Profile brauchen
  Zusatzangaben (Dienstliste, geteiltes Kommando), die in der Schritt-Tabelle nichts zu suchen
  haben. Die Bedienung wäre außerdem irreführend: ein Profil ist nicht abwählbar wie ein Schritt.
- *Eigener Runner im `StackService`*: verworfen (siehe Begründung).
- *`verifyService.ts` als gemeinsame Grundlage*: verworfen mit derselben Begründung wie in F1b (E7
  dort): ungetestet und im Merge-Pfad.

---

## E7 — Feature-eigen vs. projektweit geteilt: zwei Kommandos je Profil, Entscheidung beim Toolkit

**Entscheidung**: Jedes Profil hat ein **feature-eigenes** Kommando (`command`, Pflicht) und ein
optionales **geteiltes** Kommando (`sharedCommand`). Die Dienstliste trägt je Dienst
`scope: 'feature' | 'shared'`. Das Toolkit entscheidet, welches Kommando läuft:

| Anlass | feature-eigen | geteilt |
|---|---|---|
| `up('test' \| 'full')` | immer (idempotent) | nur wenn nicht schon erreichbar; serialisiert pro Projekt |
| `stop` / `down` eines Features | immer | **nur** wenn kein weiteres Feature des Projekts eine Stack-Absicht hat |

Das geteilte Kommando erhält den **Projektblock** als `$SDD_PORT_BASE` (E2), das feature-eigene den
Worktree-Block.

**Begründung**: FR-020 verlangt Konfigurierbarkeit je Dienst, FR-022 legt die Regel „genau einmal
projektweit, Abbau erst mit dem letzten Nutzer" fest — das ist eine **Entscheidung über mehrere
Features hinweg** und kann deshalb nur im Toolkit fallen, nicht in einem Kommando, das immer nur
sein eigenes Feature kennt. Zwei Kommandos statt einer zusätzlichen Umgebungsvariable, weil ein
geteilter Dienst ohnehin einen anderen Aufruf braucht (bei Compose: eine andere Projektkennung und
ein anderer Portblock) — die Trennung ist also nicht künstlich, sondern die Form, die das Kommando
sowieso hat. Ohne `sharedCommand` verhält sich alles wie zuvor: jedes Feature betreibt seinen
vollen Satz Dienste.

**Verworfene Alternativen**:

- *Eine dritte Variable `SDD_SHARED=keep|drop` bzw. `SDD_SERVICES=<liste>`*: verworfen — erweitert
  den Variablenvertrag über die Spec hinaus und verlangt vom Kommando, eine Liste zu zerlegen.
- *Referenzzähler in der Datenbank*: verworfen — ein Zähler driftet bei Abstürzen; die Frage „nutzt
  noch jemand?" wird stattdessen bei jedem Abbau aus `feature_stacks` **abgeleitet**.
- *Geteilte Dienste ganz aus dem Zuschnitt nehmen*: nicht möglich, US2 Szenarien 7/8 verlangen sie.

---

## E8 — Der Stack-Zustand wird erhoben; die Datenbank hält nur die Absicht

**Entscheidung**: `feature_stacks` speichert ausschließlich, **welches Profil betrieben werden
soll** (`test` oder `full`, plus Zeitstempel). Jeder angezeigte Dienststatus entsteht aus einer
frischen TCP-Probe auf `portBase + offset` (`node:net`, 300 ms Verbindungs-Zeitlimit, nebenläufig,
3-s-Cache). Der Status eines Dienstes ist `up` (Verbindung angenommen), `down`
(`ECONNREFUSED`/Zeitüberschreitung) oder `unknown` (kein Port ableitbar, weil nichts konfiguriert
ist).

**Begründung**: FR-023 verlangt Erhebung „statt einen gemerkten Stand zu behaupten — auch nach
einem Neustart des Servers", und der Edge Case „Server startet neu, während Stacks laufen"
verlangt es ausdrücklich. Die Trennung Absicht/Zustand ist zugleich die Antwort auf FR-014
(nicht pro Lauf hoch- und herunterfahren): die **Absicht** überlebt Läufe und Neustarts, ohne dass
das Toolkit behauptet, ein Dienst laufe. Die Probe ist auch die Antwort auf FR-033 und den Edge
Case „läuft, aber nicht erreichbar": ist der Haupteingang `down`, zeigt die Lane „nicht
erreichbar" statt eines Links.

**Verworfene Alternativen**:

- *Container-Status über `docker ps`/Compose auslesen*: verworfen — würde eine Container-Technik
  voraussetzen, was FR-012 verbietet. Ein Port, der antwortet, ist technikneutral.
- *HTTP-Healthcheck je Dienst*: verworfen für die erste Stufe — nicht jeder Dienst ist HTTP (DB!),
  und ein Pfad je Dienst wäre zusätzliche Konfiguration ohne Bedarf in den Szenarien.
- *Status in der Datenbank mitschreiben*: verworfen — genau der „gemerkte Stand", den FR-023
  ausschließt.

---

## E9 — Einhängepunkte der Profile (verbindliche Tabelle)

**Entscheidung**:

| Profil | Anlass | Ort im Bestand | Wirkung bei Fehlschlag |
|---|---|---|---|
| `test` | Beginn der Phase `implement` | `Orchestrator` — im before-phase-Vorlauf, **vor** den Lebenszyklus-Schritten und **vor** dem Agent-Gate | Phase startet nicht, Phase bleibt `idle`, `stack_failed`-Meldung (FR-019, US2 Szenario 5) |
| `test` | jeder weitere Lauf desselben Features | — (nichts; die Absicht steht schon) | — |
| `full` | Aktion in der Testing-Lane | `TestingLaneService`/Route | Aktion antwortet mit Fehler, `stack_failed`-Meldung |
| `down` | Session-Ende | `Orchestrator`/`PtySessionManager`-Rückweg | Meldung; Session ist trotzdem beendet |
| `down` | Merge-Abschluss | `MergeQueueService.cleanupMerged()` **vor** `worktrees.remove()` | Meldung; Worktree-Pfad wird **nicht** geleert (E11) |
| `down` | Worktree entfernen (Übersicht) | `WorktreeOverviewService.removeWorktree()` | Entfernen wird abgelehnt, Grund genannt |
| `down` | Archivieren / Löschen eines Features | `Orchestrator.archive()` / `MergeQueueService.deleteFeature()` | Meldung; Vorgang läuft weiter (Edge Case der Spec verlangt nur, dass der Abbau stattfindet) |

Reihenfolge am gemeinsamen Punkt: **Stack vor Schritten vor Agents.** Ein Schritt darf Migrationen
gegen die frisch hochgefahrene Datenbank fahren; ein Agent soll den vorbereiteten Stand beurteilen.

**Begründung**: FR-014 nennt „ab Beginn der Phase `implement`" — der before-phase-Vorlauf ist der
einzige Ort, an dem der Bestand einen Phasenstart schon aufschiebt (`runBeforePhaseGate`,
`orchestrator.ts:481`); dort einzuhängen kostet keinen neuen Aufschub-Mechanismus. `down` **vor**
`remove()` ist die direkte Behebung des beobachteten Schadens: der laufende Dev-Server hielt das
Arbeitsverzeichnis, deshalb scheiterte das Entfernen. FR-017 nennt drei Punkte; Archivieren und
Löschen kommen aus dem Edge Case „Feature wird archiviert oder abgebrochen, ohne je gemergt zu
werden".

**Verworfene Alternativen**:

- *`test` beim Anlegen des Worktrees hochfahren*: verworfen — dann läuft ein Stack für Features,
  die noch in `specify` stehen; SC-005 will genau das nicht.
- *`full` automatisch beim Eintritt in die Lane*: verworfen, die Spec verwirft es selbst
  („Assumptions": stellt die Kostenlage wieder her).
- *`down` erst beim Löschen des Features*: verworfen — der Merge ist der Punkt, an dem nichts
  zurückbleiben soll (FR-017, SC-003).

---

## E10 — Die neue Stufe muss in vier getypten Katalogen beantwortet werden

**Entscheidung**: `awaiting_manual_test` wird an vier Stellen eingetragen, die alle über
`Record<Union, …>` getypt sind — ein fehlender Eintrag ist ein Compile-Fehler:

1. `INTEGRATION_STAGE_META` (`workflowModel.ts`) — Label „wartet auf manuelle Abnahme", Ton `human`
   (Mensch am Zug, nicht Fortschritt, nicht Eskalation — dieselbe Begründung wie bei
   `verification_unconfigured`).
2. `STAGE_CLASS` (`actionPolicy.ts`) — `decision`: das Feature ist **nicht** beschäftigt, aber nur
   die dort vorgesehene Aktion wird angeboten. Plus Eintrag in `DECISION_REASON`.
3. `INTEGRATION_STAGE_IDS` / `INTEGRATION_STEPS` — neue Pipeline-Stufe `manual_test` zwischen
   `review_gate` und `human_review`, `humanUnless` bleibt leer (die Abnahme ist immer menschlich),
   `requires: 'manualTestGate'`. Damit erscheint sie in der Workflow-Übersicht und wird zum
   möglichen Ziel von Stufen-Auslösern aus F1b (`before_stage`/`after_stage`).
4. `STAGE_FOR_KIND` (`attentionReconciler.ts`) — `manual_test_due → awaiting_manual_test`, damit die
   Meldung mit dem Stufenwechsel verschwindet.

**Begründung**: Die Spec nennt es als Abhängigkeit: „alle Stellen, die Stufen vollständig
aufzählen, müssen die neue Stufe beantworten". Der Bestand hat diese Drift-Guards bewusst gebaut
(Kommentar in `workflowModel.ts:1`); sie zu nutzen ist billiger als eine Suche nach Fundstellen.
`manual_test` in `INTEGRATION_STAGE_IDS` ist zusätzlich nötig, weil ein Test in
`workflowModel.test.ts` die Gleichheit von `INTEGRATION_STEPS`-IDs und `INTEGRATION_STAGE_IDS`
festnagelt.

**Verworfene Alternativen**:

- *Die Abnahme als Flag am bestehenden `awaiting_human_review` führen*: verworfen — FR-024 verlangt
  eine Stufe **vor** dem Review; ein Flag wäre in Board, Review-Übersicht und Inbox unsichtbar.
- *Nur `INTEGRATION_STAGE_META` erweitern und `STAGE_CLASS` per Default behandeln*: nicht möglich
  (Record erzwingt) — und auch nicht gewollt: ein stiller Default hätte die Stufe als `idle`
  eingeordnet und Aktionen freigegeben, die dort nicht hingehören.

---

## E11 — Der Worktree-Pfad wird erst nach nachgewiesenem Entfernen geleert

**Entscheidung**: `WorktreeManager.remove()` prüft nach dem git-Aufruf mit `existsSync(path)`, dass
das Verzeichnis wirklich fort ist, und wirft sonst. `MergeQueueService.cleanupMerged()` ruft
vorher `down` (E9), prüft das Ergebnis und ruft `features.setWorktree(id, null)` **nur** im
Erfolgsfall; sonst bleibt der Pfad gesetzt, `features.cleanup_error` trägt den Grund und eine
`worktree_cleanup_failed`-Meldung entsteht. Die Wiederholung läuft über
`POST /api/features/:id/cleanup` und über den bestehenden Boot-Pfad
`reconcileMergedLeftovers()` — derselbe Code, kein zweiter Weg.

**Begründung**: Heute läuft das Entfernen in `try { … } catch { git worktree prune }`
(`mergeQueueService.ts:163-172`) und danach **bedingungslos** `setWorktree(feature.id, null)`
(Zeile 172). Genau das hat den beobachteten Schaden erzeugt: das Entfernen scheiterte, der Pfad
wurde geleert, das 10-GB-Verzeichnis war für das Toolkit unauffindbar. FR-034 verlangt Prüfung statt
Annahme, FR-035/036 den gesetzten Pfad und die Meldung, SC-004 „in 0 % der Fälle wird der Pfad
geleert". `existsSync` nach dem Aufruf statt nur des Exit-Codes, weil `git worktree remove` in
Randfällen erfolgreich zurückkehrt und Reste hinterlässt (der bestehende
`ensureValid()`-Reparaturpfad zeigt, dass dem git-Ergebnis hier nicht zu trauen ist).

**Verworfene Alternativen**:

- *Den Fehlschlag nur protokollieren*: verworfen — genau das ist der Ist-Zustand.
- *Bei Fehlschlag den Merge zurückrollen*: verworfen — der Merge ist bereits im Ziel; eine
  Rücknahme wäre ein neuer, größerer Eingriff. Die Spec verlangt Sichtbarkeit und Wiederholbarkeit,
  nicht Rücknahme.
- *Löschen mit `rm -rf` erzwingen*: verworfen — ein Prozess, der das Verzeichnis hält, ist der
  eigentliche Befund; ihn zu übergehen verliert Arbeit und verdeckt die Ursache. `down` läuft
  vorher genau deshalb.

---

## E12 — Prozessende über die eigene Prozessgruppe, niemals über Namensmuster

**Entscheidung**: Zwei Stellen werden umgestellt, beide nur auf **selbst gestartete** Prozesse:

- `PtySessionManager.terminate()`: nach den zwei Ctrl+C und dem Warteintervall wird
  `process.kill(-pty.pid, 'SIGTERM')` gesendet, nach kurzer Gnade `SIGKILL`. node-pty startet das
  Kind über `forkpty()`, wodurch es Sessionführer **und** Gruppenführer wird — `-pid` trifft genau
  die Prozesse dieser Session, einschließlich eines darin gestarteten Dev-Servers.
- `stepRunner`: `spawn(..., { detached: true })` (eigene Prozessgruppe) und bei Zeitlimit
  `process.kill(-child.pid, 'SIGKILL')` statt `child.kill()`.

Jeder Aufruf ist in `try/catch` gefasst (der Prozess kann inzwischen weg sein) und prüft
`pid > 0`, weil `kill(-0)` die eigene Gruppe treffen würde — also den Toolkit-Server selbst.

**Begründung**: FR-040/FR-041 und die Projektregel in `CLAUDE.md` verlangen es, und der beobachtete
Schaden ist beidseitig belegt: ein Agent traf mit `pkill -f "dx serve"` fremde Features, und das
Toolkit selbst hat sich zweimal abgeschossen. Der Ist-Zustand hat zusätzlich ein Leck: `pty.kill()`
beendet die Shell, nicht ihre Enkel — ein im PTY gestarteter Dev-Server überlebte und hielt das
Arbeitsverzeichnis (die Ursache des fehlgeschlagenen Entfernens aus E11). Die Prozessgruppe
schließt beides in einer Änderung. SC-008 („zwei gleichnamige Prozesse aus zwei Sessions") ist mit
Gruppen per Konstruktion erfüllt, mit Mustern per Konstruktion nicht.

**Verworfene Alternativen**:

- *Prozessbaum über `ps` ermitteln und einzeln beenden*: verworfen — Rennen zwischen Ermittlung und
  Signal, plattformabhängig, und die Gruppe leistet dasselbe atomar.
- *`pkill -f "<port>"`*: verworfen — Muster bleiben Muster; die globale Regel verbietet sie, und
  ein Port im Muster schützt nicht vor gleichnamigen Prozessen anderer Sessions.
- *Nur SIGKILL*: verworfen — SIGTERM zuerst gibt dem Dev-Server die Gelegenheit, seine Kinder
  selbst abzuräumen.

---

## E13 — Fehlende Stack-Konfiguration ist sichtbar, erzeugt aber kein Inbox-Item

**Entscheidung**: Ein Projekt ohne Stack-Konfiguration bekommt **keine** „Braucht dich"-Meldung.
Die Lücke ist an drei Stellen benannt: in der Testing-Lane („Kein Stack konfiguriert — Profile in
den Projekt-Einstellungen hinterlegen", statt einer URL, FR-033), in der Feature-Konsole (Stack-Feld
mit demselben Satz) und in den Projekt-Einstellungen (leere Profilfelder mit Hinweis). Der Ablauf
ist an keiner Stelle blockiert oder verzögert.

**Begründung**: FR-013 verlangt Sichtbarkeit **und** Nicht-Blockieren; SC-010 verlangt „keine
zusätzlichen Fehlschläge und keine messbar längere Zeit". Ein Inbox-Item je Projekt (analog
`verification_unconfigured`) wäre hier falsch: Verifikation ist für **jedes** Projekt
sinnvoll — ein Stack nicht (eine Bibliothek ohne Dienste hat keinen). Ein Item, das man nur
wegklicken kann, wäre Dauerlast, und die Inbox soll Handlungsbedarf zeigen, nicht Inventar. Die
Stellen, an denen die Lücke wirklich stört (Lane, Konsole), benennen sie dort, wo man sie beheben
will.

**Verworfene Alternativen**:

- *`stack_unconfigured`-Item je Projekt*: verworfen (siehe Begründung).
- *Eigene Integrationsstufe `stack_unconfigured` analog `verification_unconfigured`*: verworfen —
  die Stufe hätte keinen Punkt im Ablauf, an dem sie stünde: der Stack ist keine Pipeline-Station.

---

## E14 — Verwaiste Worktrees: Meldung aus der Erhebung, Auflösung wenn sie verschwinden

**Entscheidung**: `WorktreeOverviewService.buildOverview()` meldet jeden Eintrag mit
`kind: 'orphan'` als `orphan_worktree` (dedupliziert gegen offene Meldungen über die bestehende
`AttentionRepo.raise()`-Regel, Nachricht mit Pfad und Größe). Die Meldung gilt so lange, wie der
verwaiste Eintrag in einer Erhebung erscheint; verschwindet er, löst der Reconciler sie auf.
Zusätzlich gibt derselbe Durchlauf die Portblöcke verwaister, **nicht mehr existierender**
Verzeichnisse frei (Edge Case „Worktree von außen gelöscht, Portbereich noch vergeben").

**Begründung**: FR-039 verlangt „aktiv als Meldung … nicht nur in einer Liste geführt", SC-011
„innerhalb einer Erhebung". Die Erhebung ist der einzige Ort, der Verwaistheit überhaupt bestimmt
(`worktreeOverviewService.ts`, `featureId === null`) — eine zweite Erkennung wäre eine zweite
Wahrheit. Bewusst **kein** Marker-Tabellen-Muster wie bei der Plausibilitätsprüfung: dort war das
Wiederauftauchen einer erledigten Meldung falsch (der Befund war ein Datenwiderspruch, der bestehen
blieb); hier ist es richtig — solange ein 10-GB-Verzeichnis herumliegt, **ist** etwas zu tun.

**Verworfene Alternativen**:

- *Meldung nur beim Boot*: verworfen — ein Worktree verwaist im Betrieb (Feature gelöscht, Projekt
  entfernt), und bis zum nächsten Neustart wüchse er unbemerkt.
- *Automatisches Löschen verwaister Worktrees*: verworfen — dort kann uncommittete Arbeit liegen;
  der Bestand verweigert das Löschen aus genau diesem Grund (`removeAllForProject`).

---

## E15 — Worktree-Größe: `du -sk` mit Zeitlimit, „unbekannt" ist ein gültiger Wert

**Entscheidung**: Die Größe je Worktree kommt aus `du -sk <path>` (Kilobyte-Blöcke, ×1024),
ausgeführt in derselben Nebenläufigkeitsbremse (6) wie die übrige Worktree-Erhebung, mit 3-s-
Zeitlimit je Eintrag. Fehlschlag oder Zeitüberschreitung ⇒ `sizeBytes: null`, in der Oberfläche
„unbekannt", der Eintrag bleibt vollständig. Die Plattenwarnung nutzt den bereits vorhandenen
`statfs`-Weg des `ResourceMonitor` und vergleicht gegen `config.diskWarnBytes` (Vorgabe 10 GiB,
`SDD_DISK_WARN_BYTES`); die Warnung nennt freien Platz und die drei größten Worktrees.

**Begründung**: Die Spec erlaubt es ausdrücklich („Größenerhebung ist eine Schätzung", Zeitlimit,
Rundung), FR-044 verlangt, dass die Erhebung die Übersicht nicht blockiert. `du` statt eigenem
Verzeichnisdurchlauf, weil ein rekursiver `readdir`+`stat` in Node für ein `node_modules` mit
100 000 Einträgen deutlich langsamer ist als das Systemwerkzeug und dieselbe Zahl liefert. Die
Schwelle richtet sich nach **freiem Platz**, nicht nach der Anzahl Worktrees (Assumption der Spec);
der Bestand hat dafür schon eine geprüfte Quelle — sie zweimal zu implementieren wäre eine zweite
Wahrheit über denselben Datenträger.

**Verworfene Alternativen**:

- *Größe zwischenspeichern und alt anzeigen*: verworfen für die erste Stufe — der 2-s-Cache der
  Übersicht reicht; ein längerer Cache müsste sein Alter ausweisen, was die Spec nicht verlangt.
- *Eigene Plattenmessung in der Worktree-Übersicht*: verworfen — `ResourceMonitor.snapshot()`
  liefert `diskFreeBytes` bereits geprüft und gecacht.
- *Warnung an die Kopfleiste hängen statt in die Übersicht*: verworfen — FR-043 verlangt sie dort,
  wo die größten Worktrees stehen; die Kopfleiste hat mit `PressureVerdict` schon ihre eigene,
  gröbere Anzeige.
