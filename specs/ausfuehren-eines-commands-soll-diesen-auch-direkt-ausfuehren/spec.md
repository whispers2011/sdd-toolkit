# Feature Specification: Kommandos direkt ausführen statt nur vorausfüllen

**Feature Branch**: `feature/ausfuehren-eines-commands-soll-diesen-auch-direkt-ausfuehren`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Wenn ein Claude Command z.B. "Run" auf der Kachel ausgeführt wird, soll dieser auch direkt starten. Aktuell wird nur der befehl in die konsole kopiert und die kachel aus "laufend..." angezeigt. Obwohl die session noch nicht effektiv läuft. Der chat wird einfach nur vorausgefüllt. Überall wo bisher nur der chat vorausgefüllt wird, soll dieser auch direkt den command starten"

## Clarifications

### Session 2026-07-23

- Q: Soll der bewusst als Bestätigungsschritt gestaltete Setup-/Init-Befehl (heute nur vorausgefüllt) auch direkt ausführen? → A: Nein — Setup/Init bleibt ein bewusster manueller Bestätigungsschritt (vom Auto-Start ausgenommen).
- Q: Dieselbe Fehlanzeige tritt auch bei unterbrochenen Sessions auf (PC-Ruhezustand, Stack-/Server-Neustart mit noch laufendem Task): „Run" füllt nur vor, der Status wechselt aber schon auf „läuft …". Was soll die Kachel BEVOR dem Fortsetzen anzeigen? → A: Den bestehenden „braucht dich"/Aufmerksamkeits-Zustand (nicht „läuft …"); „Run" setzt den unterbrochenen Task tatsächlich fort.
- Q: Wie soll die Kachel reagieren, wenn „Run" ausgelöst wird, das Kommando aber gar nicht gestartet/abgeschickt werden kann? → A: „Braucht dich"/Aufmerksamkeits-Zustand mit erkennbarem Fehlerhinweis (statt „läuft …").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Kommando auf der Kachel startet sofort (Priority: P1)

Ein Nutzer klickt auf einer Feature-Kachel (oder in der zugehörigen Phasenleiste) auf eine Kommando-Aktion wie „Run" / „Start". Das zugehörige Kommando wird daraufhin tatsächlich ausgeführt: Die Session startet und beginnt sofort mit der Arbeit — ohne dass der Nutzer noch manuell in die Konsole klicken und Enter drücken muss.

**Why this priority**: Das ist der Kern der Beschwerde. Heute wird der Befehl nur in die Konsole eingefügt und bleibt dort unbestätigt stehen; die Kachel behauptet trotzdem „läuft …". Der Nutzer glaubt, die Arbeit sei gestartet, obwohl nichts passiert. Ohne diese Änderung liefert die zentrale Aktion des Tools („Kommando ausführen") ihren erwarteten Nutzen nicht.

**Independent Test**: Ein Feature auswählen und auf einer Kachel „Run" / „Start" für eine Phase klicken. Erfolgreich, wenn das Kommando ohne jede weitere Nutzeraktion (kein manuelles Enter) ausgeführt wird und die Session sichtbar zu arbeiten beginnt.

**Acceptance Scenarios**:

1. **Given** eine Feature-Kachel mit einer startbereiten Phase, **When** der Nutzer die Kommando-Aktion („Run" / „Start") auslöst, **Then** wird das Kommando automatisch abgeschickt und die Session beginnt mit der Ausführung — ohne manuelles Bestätigen.
2. **Given** die Session für das Feature ist noch nicht gestartet, **When** der Nutzer die Kommando-Aktion auslöst, **Then** wird die Session gestartet und das Kommando anschließend zuverlässig ausgeführt (nicht nur vorausgefüllt).
3. **Given** ein Kommando wurde über die Kachel ausgelöst, **When** der Nutzer in die Konsole schaut, **Then** ist das Kommando bereits abgeschickt und in Bearbeitung (keine unbestätigte Eingabezeile).
4. **Given** eine zuvor unterbrochene/fortsetzbare Session (nach PC-Ruhezustand oder Stack-/Server-Neustart), **When** der Nutzer die Kommando-Aktion („Run") auslöst, **Then** wird der unterbrochene Task tatsächlich fortgesetzt (Kommando wird abgeschickt) und nicht nur vorausgefüllt.

---

### User Story 2 - „Läuft …"-Anzeige spiegelt den echten Zustand (Priority: P2)

Die „läuft …"-Anzeige einer Kachel/Phase erscheint nur dann, wenn das Kommando tatsächlich zu laufen begonnen hat. Konnte ein Kommando nicht gestartet werden — oder wurde eine Session unterbrochen (PC-Ruhezustand, Stack-/Server-Neustart) und wartet auf Fortsetzung — zeigt die Kachel nicht fälschlich „läuft …", sondern erscheint im bestehenden „braucht dich"/Aufmerksamkeits-Zustand.

**Why this priority**: Die falsche „läuft …"-Anzeige ist der zweite Teil der Beschwerde. Sie täuscht dem Nutzer Fortschritt vor, der nicht existiert, und untergräbt das Vertrauen in den Statusüberblick. Der Statuswert muss der Realität entsprechen, damit der Nutzer sich auf das Board verlassen kann.

**Independent Test**: Eine Kommando-Aktion auslösen und beobachten, dass die Kachel erst dann „läuft …" zeigt, wenn die Ausführung tatsächlich begonnen hat; einen Fall provozieren, in dem der Start fehlschlägt bzw. eine Session unterbrochen wurde, und prüfen, dass die Kachel nicht „läuft …" behauptet, sondern im „braucht dich"/Aufmerksamkeits-Zustand erscheint.

**Acceptance Scenarios**:

1. **Given** ein Kommando wurde ausgelöst und ist tatsächlich gestartet, **When** der Nutzer die Kachel betrachtet, **Then** zeigt sie „läuft …".
2. **Given** der Start eines Kommandos schlägt fehl oder das Kommando wird nie tatsächlich abgeschickt, **When** der Nutzer die Kachel betrachtet, **Then** zeigt sie **nicht** „läuft …", sondern erscheint im „braucht dich"/Aufmerksamkeits-Zustand mit erkennbarem Fehlerhinweis.
3. **Given** eine Session wurde unterbrochen (PC-Ruhezustand oder Stack-/Server-Neustart) und ihr Task war mittendrin, **When** der Nutzer das Board betrachtet, **Then** zeigt die Kachel **nicht** „läuft …", sondern erscheint im „braucht dich"/Aufmerksamkeits-Zustand (fortsetzbar).

---

### User Story 3 - Einheitliches Verhalten an allen Auslösepunkten (Priority: P3)

Überall, wo bisher ein Kommando nur in den Chat/die Konsole vorausgefüllt wurde, wird es künftig direkt ausgeführt. Das gilt konsistent für alle Kommando-Auslösepunkte (Kachel-Aktionen und Phasenleiste). Das manuelle Absenden frei eingegebener Prompts funktioniert unverändert weiter.

**Why this priority**: Der Nutzer verlangt ausdrücklich „überall". Ein einheitliches Verhalten verhindert, dass an einer Stelle direkt gestartet und an einer anderen nur vorausgefüllt wird — was verwirrend wäre. Diese Konsistenz ist wichtig, aber baut auf dem Kernverhalten aus Story 1 auf.

**Independent Test**: Jeden Auslösepunkt, der bisher nur vorausgefüllt hat, einzeln betätigen und prüfen, dass in jedem Fall das Kommando tatsächlich ausgeführt wird; zusätzlich einen frei eingegebenen Prompt absenden und prüfen, dass dieser wie bisher abgeschickt wird.

**Acceptance Scenarios**:

1. **Given** ein beliebiger Auslösepunkt, der bisher nur vorausgefüllt hat, **When** der Nutzer ihn betätigt, **Then** wird das Kommando direkt ausgeführt (kein manuelles Enter nötig).
2. **Given** ein frei formulierter Prompt in der Eingabeleiste, **When** der Nutzer ihn absendet, **Then** wird er wie bisher automatisch abgeschickt (keine Regression).

---

### Edge Cases

- **Session noch nicht bereit**: Wird eine Kommando-Aktion ausgelöst, bevor die Session vollständig hochgefahren ist, muss das Kommando trotzdem zuverlässig ausgeführt werden, sobald die Session bereit ist — es darf nicht unbestätigt in der Eingabezeile hängenbleiben.
- **Session unterbrochen / wird fortgesetzt**: Wurde eine Session unterbrochen (PC-Ruhezustand, Stack-/Server-Neustart) und ihr Task war mittendrin, erscheint die Kachel im „braucht dich"/Aufmerksamkeits-Zustand (nicht „läuft …"). Löst der Nutzer „Run" aus, um fortzusetzen, wird das Kommando tatsächlich abgeschickt und der Task fortgesetzt — nicht nur vorausgefüllt.
- **Start schlägt fehl**: Kann die Session nicht gestartet oder das Kommando nicht abgeschickt werden, darf die Kachel nicht „läuft …" anzeigen; sie erscheint stattdessen im „braucht dich"/Aufmerksamkeits-Zustand mit erkennbarem Fehlerhinweis.
- **Mehrfaches/schnelles Auslösen**: Wird dieselbe Kommando-Aktion mehrfach oder sehr schnell hintereinander betätigt, während sie bereits startet oder läuft, darf keine doppelte Ausführung entstehen.
- **Reine Inhalts-Einfügung (kein Kommando)**: Aktionen, die lediglich Inhalt in die Eingabe einfügen, ohne ein auszuführendes Kommando darzustellen (z. B. das Einfügen eines Dateipfads für ein Bild), bleiben Einfüge-Aktionen und werden **nicht** automatisch abgeschickt.
- **Bewusster Bestätigungs-/Setup-Ablauf**: Ein bewusst als Bestätigungsschritt gestalteter Einrichtungs-/Setup-Befehl (z. B. Init) wird weiterhin nur vorausgefüllt und **nicht** automatisch abgeschickt; der Nutzer bestätigt ihn absichtlich selbst.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Wenn ein Nutzer eine Kommando-Aktion (z. B. „Run" / „Start" / Phasen-Aktion) auf einer Kachel oder in der Phasenleiste auslöst, MUSS das System das zugehörige Kommando automatisch ausführen — ohne dass der Nutzer manuell bestätigen (Enter drücken) muss.
- **FR-002**: Ist die zugehörige Session noch nicht gestartet, MUSS das System die Session starten und das Kommando anschließend zuverlässig ausführen (nicht nur vorausfüllen), auch wenn die Session zum Zeitpunkt des Auslösens noch nicht bereit war.
- **FR-003**: Das System MUSS den „läuft …"-Zustand einer Kachel/Phase nur dann anzeigen, wenn das Kommando tatsächlich zu laufen begonnen hat.
- **FR-004**: Kann ein Kommando nicht gestartet bzw. nicht abgeschickt werden, MUSS das System die Kachel/Phase **nicht** im „läuft …"-Zustand belassen, sondern sie im bestehenden „braucht dich"/Aufmerksamkeits-Zustand mit erkennbarem Fehlerhinweis anzeigen.
- **FR-005**: Alle Auslösepunkte, die bisher ein Kommando nur in Chat/Konsole vorausgefüllt haben, MÜSSEN das Kommando künftig direkt ausführen (einheitliches Verhalten über alle Kommando-Auslösepunkte) — mit Ausnahme der in FR-007 und FR-010 genannten Fälle.
- **FR-006**: Frei eingegebene Prompts, die der Nutzer manuell absendet, MÜSSEN weiterhin automatisch abgeschickt werden (keine Regression).
- **FR-007**: Aktionen, die reinen Inhalt in die Eingabe einfügen, ohne ein auszuführendes Kommando darzustellen (z. B. Einfügen eines Dateipfads), MÜSSEN Einfüge-Aktionen bleiben und dürfen **nicht** automatisch abgeschickt werden.
- **FR-008**: Wird dieselbe Kommando-Aktion ausgelöst, während sie bereits startet oder läuft, MUSS das System eine doppelte Ausführung verhindern.
- **FR-009**: Wurde eine Session unterbrochen (PC-Ruhezustand, Stack-/Server-Neustart) und ihr Task war mittendrin, MUSS das System die Kachel im „braucht dich"/Aufmerksamkeits-Zustand (fortsetzbar) anzeigen — **nicht** „läuft …". Löst der Nutzer die Kommando-Aktion („Run") aus, MUSS das System den unterbrochenen Task tatsächlich fortsetzen (Kommando abschicken), nicht nur vorausfüllen.
- **FR-010**: Ein bewusst als Bestätigungsschritt gestalteter Einrichtungs-/Setup-Befehl (z. B. Init) MUSS weiterhin nur vorausgefüllt werden und darf **nicht** automatisch abgeschickt werden; der Nutzer bestätigt ihn absichtlich selbst.

### Key Entities

- **Feature-Kachel**: Repräsentiert ein Feature auf dem Board mit Kommando-Aktionen (z. B. „Run"/„Start") und einer Status-Anzeige („läuft …").
- **Kommando-Aktion**: Eine vom Nutzer ausgelöste Aktion, die ein konkretes Kommando in einer Session ausführen soll (z. B. eine Phase starten).
- **Session**: Der laufende Arbeitskontext, in dem ein ausgelöstes Kommando ausgeführt wird.
- **Ausführungsstatus**: Der Zustand, der anzeigt, ob ein Kommando tatsächlich läuft (Grundlage für die „läuft …"-Anzeige) bzw. ob eine Kachel Aufmerksamkeit benötigt („braucht dich").
- **Unterbrochene/fortsetzbare Session**: Eine Session, deren Task durch Ruhezustand oder Stack-/Server-Neustart unterbrochen wurde und auf Fortsetzung wartet.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % der über eine Kachel oder Phasenleiste ausgelösten Kommando-Aktionen führen das Kommando tatsächlich aus, ohne dass der Nutzer manuell Enter drücken muss.
- **SC-002**: Zwischen dem Auslösen einer Kommando-Aktion und dem tatsächlichen Ausführungsbeginn sind **null** zusätzliche manuelle Schritte erforderlich.
- **SC-003**: Die „läuft …"-Anzeige entspricht in 100 % der Fälle dem tatsächlichen Ausführungszustand — keine Kachel zeigt „läuft …", ohne dass das zugehörige Kommando tatsächlich läuft (auch nicht nach Unterbrechung durch Ruhezustand/Neustart oder bei fehlgeschlagenem Start).
- **SC-004**: Das Kommando beginnt nach dem Auslösen ohne wahrnehmbare Verzögerung mit der Ausführung (vom Nutzer als „sofort" erlebt, innerhalb weniger Sekunden nach Bereitschaft der Session).
- **SC-005**: Kein bestehender Auslösepunkt für frei eingegebene Prompts verliert seine bisherige Absende-Funktion (0 Regressionen).

## Assumptions

- Es existiert bereits ein funktionierender Weg, ein Kommando in einer Session tatsächlich auszuführen (das manuelle Absenden eines Prompts funktioniert heute). Die vorausfüllenden Auslösepunkte sollen dieses bestehende, tatsächlich ausführende Verhalten nutzen.
- „Überall" bezieht sich auf Auslösepunkte, die ein **auszuführendes Kommando** darstellen (Kachel-/Phasen-Aktionen). Reine Inhalts-Einfügungen (z. B. Bild-/Dateipfad einfügen) sind kein Kommando und daher ausgenommen (siehe FR-007). Der bewusst als Bestätigungsschritt gestaltete Setup-/Init-Befehl ist ebenfalls ausgenommen (siehe FR-010, geklärt in Session 2026-07-23).
- Der „läuft …"-Status soll den tatsächlichen Ausführungsbeginn widerspiegeln; ein kurzer Übergangszustand (z. B. „wird gestartet …") zwischen Auslösen und Ausführungsbeginn ist akzeptabel, solange kein falsches „läuft …" ohne laufende Ausführung angezeigt wird.
