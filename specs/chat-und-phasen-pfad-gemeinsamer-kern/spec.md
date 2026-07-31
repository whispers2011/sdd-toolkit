# Feature Specification: Chat- und Phasen-Pfad — gemeinsamer Kern

**Feature Branch**: `feature/chat-und-phasen-pfad-gemeinsamer-kern`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "ChatWorkService und Orchestrator lösen dieselben Aufgaben doppelt: Session sicherstellen, Turn messen, Worktree anlegen. Gepflegt wurde über Monate nur der Phasen-Pfad. Jeder am 28.07.2026 gefundene Chat-Fehler war eine Lösung, die im Repo schon existierte, nur nicht im Chat (Doppel-Sessions bei parallelem Start; Turn ohne Kosten abgerechnet). Am 30.07.2026 sind vier weitere Verbesserungen ausschliesslich in den Phasen-Pfad geflossen: telemetryStore.hold/release (Puffer eines laufenden Laufs schützen), der monotone Telemetrie-Akkumulator, die Sperre gegen Integration bei schreibendem Agenten, und der Zuordnungswächter checkWorkWithoutRun. Der Chat hat von keiner davon etwas. Aufgabe: Die geteilten Aufgaben in einen gemeinsamen Kern ziehen, statt sie zweimal zu pflegen. Vor jeder Änderung an orchestrator.ts sollte die Entsprechung in chatWorkService.ts nicht mehr gesucht werden müssen. Kein Eilfall — aber der einzige Punkt, der mit jedem weiteren Fix teurer wird statt billiger. Abnahme: Session sicherstellen, Turn messen und Worktree anlegen existieren je einmal; Chat- und Phasen-Pfad benutzen dieselbe Implementierung. Bestehende Tests beider Pfade bleiben grün."

## Das Problem in Zahlen

Drei Aufgaben existieren heute zweimal, in zwei Dateien, die niemand gemeinsam liest:

| Aufgabe | Phasen-Pfad | Chat-Pfad |
|--------|-------------|-----------|
| Session sicherstellen | `Orchestrator.ensureSession` / `ensureSessionInner` | `ChatWorkService.ensure` / `ensureUnlocked` |
| Turn messen | `finishWithMetering` → `meterFromTelemetry` → `meterTurn` | `meterTurn` → `usageForTurn` |
| Arbeitskopie anlegen | `createFeature`, `ensureSessionInner` | `ensureUnlocked` |

Die Pflege war einseitig. Was am 28.07.2026 im Chat als Fehler auffiel, stand im Phasen-Pfad
längst richtig: der Doppelstart-Schutz über ein in-flight-Promise und die Messkaskade
Telemetrie-vor-Transkript-vor-Schätzung. Am 30.07.2026 wiederholte sich das Muster mit vier
Verbesserungen, von denen der Chat keine erhielt:

- **`telemetryStore.hold`/`release`** — schützt den Ereignispuffer eines laufenden Laufs vor dem
  Kehraus nach Alter. Ohne die Sperre verlor ein 33-Minuten-Lauf rund 83 % seines Verbrauchs,
  bevor er zum ersten Mal verrechnet wurde. Der Chat meldet keinen Lauf an.
- **Der monotone Telemetrie-Akkumulator** — schreibt je Lauf fort, was noch nicht verrechnet ist,
  statt das Fenster neu zu summieren. Damit kann eine Zahl nie wieder sinken. Der Chat summiert
  einmalig ein Fenster und trägt nie nach.
- **Die Sperre gegen Integration bei schreibendem Agenten** — verweigert die Integration, solange
  die Ausgabe der Session jünger als 20 Sekunden ist.
- **Der Zuordnungswächter `checkWorkWithoutRun`** — meldet einen Agenten, der arbeitet, während
  kein Lauf offen ist. Er überspringt jede Session, die nicht `kind === 'feature'` ist, also
  jeden Chat.

Die Folge ist messbar: In einem Chat vom 28.07.2026 standen 7,0 Mio. gelesene Cache-Tokens
45k Ausgabe-Tokens gegenüber. Verbucht waren 94k Tokens und 0 $ statt real gut 5 $.

## Clarifications

### Session 2026-07-30

- Q: Wie verhält sich die Anmeldung des Ereignispuffers, wenn auf derselben Session ein zweiter
  Lauf beginnt, während das Nachlauffenster des ersten noch offen ist? → A: Zählend je Session —
  Anmelden und Abmelden paarweise je Lauf, freigegeben wird erst, wenn sich der letzte Lauf
  abgemeldet hat; beim Freigeben wird nach Alter beschnitten statt der Puffer ganz verworfen.
- Q: Welche Verbrauchsfelder trägt die Lauf-Zeile eines Chat-Turns nach der Zusammenlegung? → A:
  Dieselben wie ein Phasenlauf, ohne Ausnahme und ohne chat-eigene Sonderfelder — genau das ist
  der Zweck der Zusammenlegung. Also: die vier Token-Klassen einzeln (Eingabe, Ausgabe,
  Cache-Lesen, Cache-Anlegen), die Summe, die Messquelle, die Kosten und das Modell; dazu die
  Subagenten-Anteile, sofern der Turn welche erzeugt hat. Kein eigener Satz „Chat-Felder", keine
  zweite Rechenvorschrift: derselbe monotone Akkumulator, dieselbe Sperre gegen verschlechternde
  Nachträge, dieselbe Behandlung des Nachlauffensters.
- Q: Was ist mit der Laufzeit? → A: Sie gehört zwingend dazu. Heute haben **alle 33
  chat_work-Läufe in der Datenbank die Dauer 0 ms** (`started_at == finished_at`), zusammen
  $16.55. Solange das so bleibt, ist jede Beurteilung über die Dauer für den Chat blind: die
  Fehlstart-Regel „unter 6 s mit exit != 0" kann dort nie greifen, und Kosten pro Minute sind
  nicht bildbar. Wenn „Turn messen" in den gemeinsamen Kern wandert, MUSS `finished_at` beim
  tatsächlichen Turn-Ende gesetzt werden. Ein Test, der eine Chat-Turn-Dauer > 0 fordert, hält
  das fest.
- Q: Die Entwurfsartefakte sind vollständig, ein erneuter Durchlauf würde `setup-plan.sh` aber die
  Vorlage über `plan.md` kopieren — und die Datei ist nicht in git. Wie weitermachen? → A: **Nicht
  erneut planen. Die vorhandenen Artefakte benutzen und daraus `tasks.md` erzeugen.** Sie sind
  vollständig und in sich konsistent: `spec.md` ist seit dem 30.07. 17:49 unverändert, `plan.md`,
  `research.md`, `data-model.md`, `quickstart.md` und die vier Verträge stammen vom 31.07.
  00:30–00:36. Es gibt keinen inhaltlichen Grund, sie neu zu erzeugen — und einen handfesten
  dagegen. Die Beobachtung war richtig und wichtig: **alle fünf Artefakte waren untracked**, die
  gesamte Entwurfsarbeit hing an nicht gesicherten Dateien. Sie sind jetzt committet
  (`17072ca`), damit dieser Weg nicht mehr offensteht. Aufgabe bleibt: `tasks.md` aus den
  bestehenden Dokumenten ableiten, mit Kästchen im Format `- [ ] T001 …`, und am Ende selbst
  prüfen, dass die Datei existiert und Kästchen enthält. Nach jeder erledigten Aufgabe später
  einzeln abhaken, nicht erst am Schluss.

## User Scenarios & Testing *(mandatory)*

Die Nutzer dieses Features sind die Menschen, die das Toolkit weiterentwickeln, und die Menschen,
die seinen Zahlen glauben müssen.

### User Story 1 - Ein Verbrauchs-Fix wirkt in beiden Pfaden (Priority: P1)

Ein Chat-Turn wird nach genau derselben Regel abgerechnet wie ein Phasenlauf: Meldungen der CLI
schlagen das Transkript, das Transkript schlägt die Schätzung; der Puffer des laufenden Turns ist
gegen den Kehraus geschützt; verspätet eintreffende Meldungen werden nachgetragen und die Zahl
kann dabei nur steigen. Wer die Messung verbessert, verbessert sie für Chat und Phase in einem
Schritt — ohne die zweite Fundstelle zu kennen.

**Why this priority**: Hier ist der Schaden bereits eingetreten und bezifferbar. Ein Chat-Turn,
der 5 $ kostet und mit 0 $ verbucht wird, macht jede Kostenansicht des Toolkits unbrauchbar.
Diese Story liefert eigenständigen Wert, selbst wenn Session und Arbeitskopie doppelt bleiben.

**Independent Test**: Vollständig testbar, indem für einen Chat-Turn und einen Phasenlauf
dieselben Telemetrie-Ereignisse eingespielt werden — beide Läufe müssen identische Tokenzahlen,
identische Kosten und dieselbe Quellenangabe verbuchen.

**Acceptance Scenarios**:

1. **Given** ein Chat-Turn, für den Meldungen der CLI vorliegen, **When** der Turn abgeschlossen
   wird, **Then** werden Tokens, Kosten, Modell und die Quelle „Telemetrie" verbucht — nicht die
   Schätzung aus dem Terminal-Scrollback.
2. **Given** ein laufender Chat-Turn, dessen Meldungen älter als das Nachlauffenster sind,
   **When** der Kehraus des Puffers läuft, **Then** bleiben seine Meldungen erhalten und werden
   vollständig verrechnet.
3. **Given** ein abgeschlossener Chat-Turn, dessen letzte Meldungen erst nach dem Abschluss
   eintreffen, **When** das Nachlauffenster noch offen ist, **Then** wird die Zahl des Turns
   nachgezogen und die Ansicht aktualisiert.
4. **Given** ein bereits verrechneter Chat-Turn, **When** ein Nachtrag einen inzwischen
   beschnittenen Puffer sieht, **Then** bleibt die zuvor verbuchte Zahl stehen und sinkt nicht.
5. **Given** ein Chat-Turn ohne jede Meldung der CLI, aber mit vorhandenem Transkript, **When**
   der Turn abgeschlossen wird, **Then** wird die Zahl aus dem Transkript-Delta verbucht und als
   solche gekennzeichnet.
6. **Given** ein Phasenlauf, **When** er nach dieser Umstellung abgeschlossen wird, **Then**
   verbucht er dieselben Zahlen wie vor der Umstellung.

---

### User Story 2 - Ein Session-Fix wirkt in beiden Pfaden (Priority: P2)

Eine Session wird in beiden Pfaden nach derselben Regel sichergestellt: höchstens eine Session je
Bezugsobjekt, auch bei gleichzeitigen Aufrufen; eine gespeicherte Claude-Session-Kennung wird nie
blind fortgesetzt, sondern erst gegen das vorhandene Transkript geprüft; der Berechtigungsmodus
folgt der aufgelösten Automatisierungs-Einstellung.

**Why this priority**: Der Doppelstart war am 28.07.2026 fünfmal beobachtet worden, zuletzt mit
zwei gleichzeitig arbeitenden Claude-Prozessen in derselben Arbeitskopie. Der Schutz existiert
jetzt in beiden Pfaden, aber zweimal — und genau dieses Muster hat das Problem erzeugt.

**Independent Test**: Vollständig testbar, indem für Chat und Feature je zwei Aufrufe gleichzeitig
abgesetzt werden — beide Pfade dürfen nur einen Prozess starten und müssen dieselbe
Session-Kennung zurückgeben.

**Acceptance Scenarios**:

1. **Given** kein laufender Prozess, **When** zwei Aufrufe zum Sicherstellen einer Chat-Session
   gleichzeitig eintreffen, **Then** wird genau ein Prozess gestartet und beide Aufrufe erhalten
   dieselbe Session-Kennung.
2. **Given** dieselbe Ausgangslage im Phasen-Pfad, **When** zwei Aufrufe gleichzeitig eintreffen,
   **Then** gilt dasselbe Ergebnis.
3. **Given** eine gespeicherte Claude-Session-Kennung, deren Transkript nicht mehr existiert,
   **When** die Session sichergestellt wird, **Then** wird die Kennung verworfen und eine frische
   Session ohne Fortsetzung gestartet — in beiden Pfaden.
4. **Given** eine bereits laufende Session, **When** sie erneut sichergestellt wird, **Then** wird
   kein zweiter Prozess gestartet und die vorhandene Session zurückgegeben.
5. **Given** das Starten eines Prozesses schlägt fehl, **When** der Fehler den Aufrufer erreicht,
   **Then** antwortet der Chat-Pfad weiterhin mit seinem bisherigen Fehlerbild (HTTP-Status samt
   Meldung) und der Phasen-Pfad mit seinem — der gemeinsame Kern schreibt keinem Pfad seine
   Fehlerdarstellung vor.

---

### User Story 3 - Eine Arbeitskopie entsteht nach einer Regel (Priority: P3)

Chat und Feature legen ihre Arbeitskopie über denselben Weg an: serialisiert je Repository,
idempotent, und mit derselben Behandlung eines gespeicherten Pfads, der auf der Festplatte fehlt.

**Why this priority**: Diese Aufgabe ist heute die am wenigsten auseinandergelaufene der drei —
beide Pfade rufen dieselbe Verwaltung der Arbeitskopien auf. Zusammengeführt werden müssen die
Regeln darum herum (Namensbildung, Behandlung eines verwaisten Pfads, Fehlerbehandlung), nicht
das Anlegen selbst. Deshalb der geringste Nutzen pro Aufwand, aber Teil der Abnahme.

**Independent Test**: Vollständig testbar, indem für Chat und Feature eine Arbeitskopie angelegt,
ihr Verzeichnis anschliessend von aussen entfernt und die Anlage erneut angefordert wird — beide
Pfade müssen dieselbe Erholung zeigen.

**Acceptance Scenarios**:

1. **Given** ein Chat ohne Arbeitskopie, **When** seine Session sichergestellt wird, **Then**
   entsteht die Arbeitskopie über denselben Weg wie die eines Features.
2. **Given** ein gespeicherter Pfad zu einer Arbeitskopie, die auf der Festplatte fehlt, **When**
   die Session sichergestellt wird, **Then** wird der verwaiste Eintrag aufgeräumt und die
   Arbeitskopie neu angelegt — in beiden Pfaden.
3. **Given** das Anlegen der Arbeitskopie schlägt fehl, **When** der Fehler den Aufrufer erreicht,
   **Then** bleibt das nach aussen sichtbare Fehlerbild beider Pfade unverändert.

---

### User Story 4 - Der nächste Fix findet nur eine Fundstelle (Priority: P3)

Wer eine der drei Aufgaben ändern will, findet genau eine Stelle im Quellcode. Es gibt keine
zweite Implementierung, die man kennen müsste, und keine Datei, in der man nach der Entsprechung
suchen müsste.

**Why this priority**: Das ist das eigentliche Ziel — die drei anderen Stories sind seine
heutigen Symptome. Als eigene Story geführt, weil sie ihr eigenes Abnahmekriterium hat: die
Abwesenheit der Zwillingsstelle, prüfbar unabhängig vom Verhalten.

**Independent Test**: Vollständig testbar, indem der Quellcode nach den charakteristischen
Bestandteilen jeder Aufgabe durchsucht wird — jede darf höchstens einmal vorkommen, ausserhalb
von Tests.

**Acceptance Scenarios**:

1. **Given** das umgestellte Repository, **When** nach der Messkaskade (Meldungen → Transkript →
   Schätzung) gesucht wird, **Then** findet sich genau eine Implementierung.
2. **Given** das umgestellte Repository, **When** nach dem Doppelstart-Schutz für Sessions gesucht
   wird, **Then** findet sich genau eine Implementierung.
3. **Given** das umgestellte Repository, **When** nach der Anlage-Regel für Arbeitskopien gesucht
   wird, **Then** findet sich genau eine Implementierung.
4. **Given** das umgestellte Repository, **When** die vollständige Testsuite läuft, **Then** ist
   sie grün — die bestehenden Tests beider Pfade eingeschlossen.

---

### Edge Cases

- Ein Chat-Turn schliesst ab, während gar kein Telemetrie-Speicher vorhanden ist (er ist optional
  konfiguriert): die Kaskade fällt auf Transkript und dann auf Schätzung zurück, ohne Fehler.
- Eine Session wird beendet, während ein Nachtrag ihres letzten Turns noch aussteht: der Nachtrag
  läuft ins Leere, ohne den Serverprozess zu reissen, und der Puffer wird freigegeben.
- Ein Chat wird neu gestartet, während ein Sicherstellen-Aufruf noch läuft: es entsteht keine
  Session auf einer bereits deaktivierten Unterhaltung.
- Ein Chat-Turn und ein Phasenlauf laufen gleichzeitig in Sessions desselben Projekts: die
  Puffer-Anmeldungen und Akkumulatoren beider dürfen sich nicht überschreiben.
- Ein zweiter Turn derselben Chat-Session beginnt, während das Nachlauffenster des ersten noch
  offen ist (bei Chats der Regelfall, weil Turns Sekunden auseinanderliegen): das Abmelden des
  ersten darf dem zweiten weder die Anmeldung noch die Meldungen entziehen. Dasselbe gilt für
  zwei aufeinanderfolgende Phasenläufe desselben Features.
- Der Leerlauf-Reaper beendet eine Chat-Session, für die noch ein Turn-Zustand im Speicher steht:
  der Zustand wird abgeräumt, ohne eine halbe Messung zu verbuchen.
- Eine Unterhaltung hat einen gespeicherten Session-Eintrag, aber nie eine echte Claude-Session
  gehabt: das Fortsetzen darf nicht versucht werden.

## Requirements *(mandatory)*

### Functional Requirements

**Gemeinsamer Kern**

- **FR-001**: Das Sicherstellen einer Session MUSS genau einmal implementiert sein; Chat- und
  Phasen-Pfad MÜSSEN diese Implementierung benutzen.
- **FR-002**: Das Messen eines Turns MUSS genau einmal implementiert sein; Chat- und Phasen-Pfad
  MÜSSEN diese Implementierung benutzen.
- **FR-003**: Das Anlegen einer Arbeitskopie MUSS genau einmal implementiert sein; Chat- und
  Phasen-Pfad MÜSSEN diese Implementierung benutzen.
- **FR-004**: Der gemeinsame Kern MUSS die Unterschiede beider Pfade über Parameter aufnehmen
  (Bezugsobjekt: Feature oder Unterhaltung; Session-Art; Namensbildung von Zweig und
  Arbeitskopie; zusätzlicher System-Prompt; Fehlerdarstellung), ohne dass eine der drei Aufgaben
  ein zweites Mal ausgeschrieben wird.
- **FR-005**: Der gemeinsame Kern MUSS die nach aussen sichtbaren Fehlerbilder beider Pfade
  erhalten: der Chat-Pfad antwortet weiterhin mit seinen HTTP-Status-Fehlern, der Phasen-Pfad mit
  seinen.

**Verbrauchsmessung, die beide Pfade erhalten**

- **FR-006**: Ein Chat-Turn MUSS nach derselben Quellen-Rangfolge abgerechnet werden wie ein
  Phasenlauf: Meldungen der CLI vor Transkript-Delta vor Schätzung.
- **FR-007**: Ein Chat-Turn MUSS seinen Ereignispuffer für die Dauer des Turns anmelden, sodass
  der Kehraus dessen Meldungen nicht nach Alter verwirft; nach Ablauf des Nachlauffensters MUSS
  er ihn wieder abmelden.
- **FR-007a**: Die Anmeldung MUSS zählend sein: Anmelden und Abmelden gehören paarweise zu je
  einem Lauf, und der Puffer einer Session MUSS angemeldet bleiben, solange noch ein Lauf auf ihr
  offen ist. Das Abmelden des letzten Laufs DARF den Puffer nicht vollständig verwerfen, sondern
  MUSS ihn dem normalen Kehraus nach Alter überlassen. Diese Regel gilt für beide Pfade.
- **FR-008**: Die verbuchte Zahl eines Turns MUSS monoton sein: ein Nachtrag darf sie nur
  erhöhen, niemals senken — auch wenn der Puffer inzwischen beschnitten wurde.
- **FR-009**: Ein Chat-Turn MUSS bis zum Ablauf des Nachlauffensters nachtragsfähig bleiben und
  die Ansicht bei einem erfolgreichen Nachtrag aktualisieren.
- **FR-010**: Eine Meldung der CLI DARF für einen Lauf höchstens einmal zählen, auch über
  mehrere Nachträge hinweg.
- **FR-011**: Ein Chat-Turn MUSS Kosten und Modell verbuchen, wenn die Quelle sie liefert —
  nicht nur eine Tokenzahl.
- **FR-012**: Die verbuchte Quelle MUSS je Lauf erkennbar bleiben (Meldungen, Transkript,
  Schätzung), damit eine unbepreiste Zahl von einer bepreisten unterscheidbar ist.

**Session-Lebenszyklus, den beide Pfade erhalten**

- **FR-013**: Gleichzeitige Aufrufe zum Sicherstellen einer Session MÜSSEN in beiden Pfaden
  koalesziert werden: genau ein Prozess, dieselbe Session-Kennung für alle Aufrufer.
- **FR-014**: Eine gespeicherte Claude-Session-Kennung DARF NICHT fortgesetzt werden, ohne dass
  ihr Transkript zuvor gefunden wurde; fehlt es, MUSS die Kennung verworfen und frisch gestartet
  werden.
- **FR-015**: Der Berechtigungsmodus MUSS in beiden Pfaden aus derselben aufgelösten
  Automatisierungs-Einstellung folgen.
- **FR-016**: Eine bereits laufende Session MUSS unverändert zurückgegeben werden, ohne zweiten
  Prozess.

**Erhaltung des heutigen Verhaltens**

- **FR-017**: Alle bestehenden Tests beider Pfade MÜSSEN nach der Umstellung grün sein, ohne
  Anpassung ihrer Erwartungen — ausgenommen Tests, die genau die für den Chat-Pfad neu
  hinzukommenden Verbesserungen abbilden.
- **FR-018**: Der Phasen-Pfad MUSS nach der Umstellung dieselben Zahlen verbuchen und dieselben
  Ereignisse aussenden wie vorher.
- **FR-019**: Die pfadspezifischen Anteile MÜSSEN bei ihrem Pfad bleiben und DÜRFEN NICHT in den
  gemeinsamen Kern wandern: Feature-Vorschläge und Marker-Erkennung, Neustart samt
  Bestätigungs-Rückfrage, der Leerlauf-Reaper des Chats, Phasenzustand, Gates, Wissens-Präambel
  und Kontext-Optimierung.
- **FR-020**: Der Zuordnungswächter DARF NICHT auf Chat-Sessions ausgedehnt werden; sein heutiges
  Verhalten für Feature-Sessions MUSS unverändert bleiben. Begründung siehe „Out of Scope".

### Key Entities

- **Geteilte Aufgabe**: Eine der drei Zuständigkeiten, die heute doppelt existiert — Session
  sicherstellen, Turn messen, Arbeitskopie anlegen. Nach der Umstellung: genau eine
  Implementierung, aufgerufen von zwei Pfaden.
- **Bezugsobjekt einer Session**: Das, woran eine Session hängt — ein Feature im Phasen-Pfad,
  eine Unterhaltung im Chat-Pfad. Trägt Zweigname, Name der Arbeitskopie, Session-Art und die
  Regel, wie eine frühere Session gefunden wird.
- **Turn-Messung**: Die Verbrauchsangabe eines abgeschlossenen Turns: Tokens nach Art
  (Eingabe, Ausgabe, Cache gelesen, Cache erzeugt), Kosten, Modell und die Quelle, aus der sie
  stammt.
- **Ereignispuffer einer Session**: Die Meldungen der CLI zu einer Session, mit Anmeldung für die
  Dauer eines Laufs und einem Nachlauffenster nach seinem Abschluss. Ein Puffer gehört der
  Session, nicht dem einzelnen Lauf; mehrere Läufe derselben Session können ihn gleichzeitig
  beansprucht haben, und er ist erst frei, wenn keiner mehr offen ist.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Jede der drei Aufgaben ist im Quellcode genau einmal implementiert (ausserhalb von
  Tests) — heute je zweimal.
- **SC-002**: Ein Chat-Turn mit vorliegenden Meldungen der CLI verbucht dieselben Tokens und
  dieselben Kosten wie ein Phasenlauf mit denselben Meldungen; Abweichung 0.
- **SC-003**: Der am 28.07.2026 beobachtete Fall — 7,0 Mio. gelesene Cache-Tokens, 45k
  Ausgabe-Tokens, verbucht als 94k Tokens und 0 $ — wird nach der Umstellung mit vollständiger
  Tokenzahl und einem Preis grösser 0 verbucht.
- **SC-004**: Die verbuchte Zahl eines Turns sinkt über beliebig viele Nachträge nie; in einer
  Testreihe mit beschnittenem Puffer 0 Absenkungen.
- **SC-005**: Zwei gleichzeitige Aufrufe zum Sicherstellen einer Session starten in beiden Pfaden
  genau einen Prozess; in 20 aufeinanderfolgenden Versuchen je Pfad 0 Doppelstarts.
- **SC-006**: Die vollständige Testsuite ist grün, und die Prüfung der Typen läuft ohne Fehler
  durch.
- **SC-007**: Von den vier am 30.07.2026 nur in den Phasen-Pfad geflossenen Verbesserungen sind
  zwei (Puffer-Anmeldung, monotoner Akkumulator) im Chat-Pfad durch einen Test nachweisbar
  wirksam und zwei mit Grund als ausgeschlossen dokumentiert — 4 von 4 beantwortet, 0 offen.
- **SC-008**: Eine Änderung an einer der drei Aufgaben erfordert das Öffnen von genau einer
  Datei; geprüft an einer stichprobenartigen Beispieländerung.

## Assumptions

- Die Nutzer dieses Features sind die Entwickler des Toolkits und die Menschen, die seinen
  Kosten- und Verbrauchszahlen glauben müssen. Es entsteht keine neue Oberfläche.
- „Je einmal existieren" heisst: eine Implementierung, die beide Pfade aufrufen. Dass beide
  Pfade dieselbe Klasse benutzen oder ineinander aufgehen, ist nicht gefordert — der Chat-Pfad
  bleibt ein eigener Dienst mit eigenen Aufgaben.
- Der Chat-Pfad erhält durch die Zusammenführung die Verbesserungen des Phasen-Pfads, nicht
  umgekehrt: der Phasen-Pfad ist der gepflegte Stand und gibt das Verhalten vor.
- Das nach aussen sichtbare Verhalten des Chat-Pfads ändert sich nur dort, wo es heute falsch
  ist: bei der Verbrauchsmessung. Sein Bedienablauf — Feature-Vorschläge, Neustart mit Rückfrage,
  Pausiert-Karte, Leerlauf-Beendigung — bleibt unverändert, und es kommen keine neuen Meldungen
  in der Oberfläche hinzu.
- Der Chat verbucht seinen Lauf weiterhin atomar beim Turn-Abschluss; ein über die Dauer eines
  Turns offener Lauf wie im Phasen-Pfad wird nicht eingeführt. Das Anmelden des Ereignispuffers
  (FR-007) und das Nachtragsfenster (FR-009) hängen am Turn selbst, nicht an einem
  Laufdatensatz-Zustand.
- Bereits in der Datenbank stehende Chat-Läufe werden nicht nachträglich korrigiert; die
  Umstellung wirkt ab dem nächsten Turn.
- Die bestehende Verwaltung der Arbeitskopien bleibt die Grundlage; sie wird nicht ersetzt,
  sondern von einer Stelle aus aufgerufen.
- Kein Zeitdruck: die Umstellung darf in Schritten erfolgen, solange nach jedem Schritt die
  Testsuite grün ist.

## Out of Scope

Zwei der vier am 30.07.2026 nur in den Phasen-Pfad geflossenen Verbesserungen kommen mit diesem
Feature im Chat an (Puffer-Anmeldung, monotoner Akkumulator — beide gehören zu „Turn messen").
Die anderen beiden sind bewusst ausgeschlossen, jeweils mit Grund:

- **Der Zuordnungswächter auf Chat-Sessions.** Er prüft, ob ein Agent arbeitet, während kein Lauf
  offen ist. Der Chat verbucht seinen Lauf atomar beim Turn-Abschluss — es gibt also nie ein
  Zeitfenster, in dem ein Lauf „offen" wäre, und der Wächter würde für jede arbeitende
  Chat-Session anschlagen. Ihn sinnvoll auszudehnen hiesse, dem Chat zuerst ein über die
  Turn-Dauer offenes Lauffenster zu geben. Das ist ein eigener Schnitt, der die Form der
  Chat-Laufsätze ändert, und keine der drei Aufgaben der Abnahme. Kandidat für ein Folge-Feature.
- **Die Sperre gegen Integration bei schreibendem Agenten.** Chat-Zweige laufen nicht über die
  Merge-Queue — es gibt dort keine Integration, die zu sperren wäre. Zusammengefasst werden
  könnte allenfalls der geteilte Prüfsatz „schreibt der Agent noch?", der heute mit zwei
  verschiedenen Zeitschwellen (20 s für die Integration, 60 s für den Wächter) an zwei Stellen
  steht. Auch das ist keine der drei Aufgaben der Abnahme.

Ebenfalls ausserhalb dieses Features:

- Zusammenführen weiterer doppelt vorhandener Aufgaben, die nicht in der Abnahme stehen —
  namentlich die Behandlung des Session-Endes (`handleExit`) und die Behandlung von
  Zustandswechseln (`handleStatusChange`), die in beiden Pfaden ähnliche, aber nicht gleiche
  Aufgaben erfüllen. Kandidaten für dasselbe Folge-Feature.
- Nachträgliches Korrigieren bereits verbuchter Chat-Läufe in der Datenbank.
- Neue Ansichten, Einstellungen oder Meldungen in der Oberfläche.
- Änderungen am Prompt-Aufbau, an der Kontext-Optimierung oder an der Phasenlogik.
