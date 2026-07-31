# Feature Specification: Server-Ausfälle sichtbar machen

**Feature Branch**: `feature/server-ausfaelle-sichtbar-machen`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Am 30.07.2026 endete der Server um 12:59:10 mitten in zwei laufenden Features. Im Log steht die letzte normale Anfrage, dann „Node.js v22.19.0" und ELIFECYCLE — kein Fehlertext, keine Stack-Trace, null Fehlermarker, kein Crash-Report. Umstände: 813 MB freier Plattenplatz, Swap 4,1 von 5,1 GB belegt, zwei Rust-Builds parallel. Der eigentliche Mangel ist nicht der Absturz, sondern die Stille danach: in der Datenbank steht KEIN Hinweis darauf. Kein Attention-Item, kein Ereignis. Der Ausfall ist nachträglich nicht rekonstruierbar; von aussen sieht ein toter Server aus wie „nichts passiert". Aufgabe: 1. Herzschlag: Der Server schreibt periodisch einen Zeitstempel. Beim Start prüft die Boot-Recovery, ob der letzte Herzschlag lange her ist, und legt ein Attention-Item an: „Server war zwischen X und Y unerwartet weg, N Läufe betroffen". 2. Absturzursache festhalten: process.on('exit') plus Signal-Handler protokollieren mit Zeitstempel in eine Datei neben der Datenbank, damit ein stiller Abgang einen Eintrag hat. 3. Ressourcendruck anzeigen: freier Plattenplatz und Swap-Nutzung, mit Warnung bei knappem Platz und einem Hinweis, wenn mehrere Features parallel laufen. Abnahme: Nach einem `kill -9` des Servers erzeugt der nächste Start ein Attention-Item mit dem Zeitfenster und den betroffenen Läufen. Tests für die Lückenerkennung."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nach einem Absturz überhaupt erfahren, dass es einen gab (Priority: P1)

Der Server endet unerwartet, während an einem oder mehreren Features gearbeitet wird. Beim
nächsten Start meldet das Toolkit von sich aus: „Server war zwischen 12:59 und 14:07 unerwartet
weg — 2 Läufe betroffen". Der Nutzer sieht die Meldung dort, wo er ohnehin nach offenen Punkten
schaut, kann Beginn, Ende und Dauer des Ausfalls ablesen und weiss, welche Arbeit davon getroffen
wurde. Der Ausfall bleibt dauerhaft nachschlagbar, auch wenn die Meldung erledigt wurde.

**Why this priority**: Das ist der Kern des Befunds. Heute steht in den Betriebsdaten des Toolkits
kein einziger Hinweis auf den Ausfall vom 30.07.; von aussen sieht ein toter Server aus wie
„nichts passiert". Ohne diese Story bleibt jede weitere Massnahme wirkungslos, weil niemand den
Anlass zum Nachschauen bekommt. Die Story trägt allein: sie liefert die geforderte Abnahme
(`kill -9` → Meldung beim nächsten Start) ohne die Stories 2 und 3.

**Independent Test**: Vollständig testbar, indem der laufende Server mit `kill -9` abgebrochen und
neu gestartet wird — nach dem Start existiert eine Meldung mit Ausfallfenster und Zahl der
betroffenen Läufe. Gegenprobe: ein geordnetes Herunterfahren mit anschliessendem Neustart erzeugt
keine solche Meldung.

**Acceptance Scenarios**:

1. **Given** ein laufender Server mit zwei arbeitenden Features, **When** der Serverprozess hart
   abgebrochen wird (kein Herunterfahren) und danach neu startet, **Then** erscheint eine Meldung
   „Server war zwischen X und Y unerwartet weg — N Läufe betroffen" mit dem Zeitpunkt des letzten
   Lebenszeichens als X, der Startzeit als Y und der Zahl der zum Ausfallzeitpunkt noch laufenden
   Läufe als N.
2. **Given** derselbe Ausfall, **When** die Meldung geöffnet wird, **Then** sind Beginn, Ende und
   Dauer des Ausfalls sowie die betroffenen Features benannt.
3. **Given** ein Server, der geordnet heruntergefahren wurde, **When** er nach beliebig langer
   Pause (auch Tagen) wieder startet, **Then** wird kein Ausfall gemeldet.
4. **Given** ein Datenverzeichnis ohne jedes frühere Lebenszeichen (Erststart), **When** der Server
   startet, **Then** wird kein Ausfall gemeldet.
5. **Given** ein Ausfall, bei dem Läufe mehrerer Projekte betroffen waren, **When** der Server neu
   startet, **Then** erhält jedes betroffene Projekt genau eine Ausfallmeldung, die nur seine
   eigenen Läufe zählt.
6. **Given** ein Ausfall, bei dem gar keine Arbeit lief, **When** der Server neu startet, **Then**
   wird keine Aufmerksamkeitsmeldung erzeugt, der Ausfall ist aber im Betriebsprotokoll mit
   Zeitfenster verzeichnet und nachträglich rekonstruierbar.
7. **Given** ein Ausfall mit unterbrochenen Läufen, **When** der Server neu startet, **Then**
   ergänzt die Ausfallmeldung die bestehenden Meldungen zu unterbrochenen Läufen, ersetzt sie
   nicht und erzeugt keine Dublette.
8. **Given** ein bereits gemeldeter Ausfall, **When** der Server ohne zwischenzeitlichen Ausfall
   erneut startet, **Then** wird derselbe Ausfall nicht ein zweites Mal gemeldet.

---

### User Story 2 - Nachlesen, wie der Server gegangen ist (Priority: P2)

Nach einem Ausfall will der Nutzer wissen, ob der Server geordnet beendet, von aussen abgeschossen
oder an einem Fehler gestorben ist. Er öffnet ein fortlaufendes Betriebsprotokoll neben den
Betriebsdaten und findet dort für jeden Abgang einen datierten Eintrag mit Anlass — geordnetes
Herunterfahren, Abbruchsignal von aussen, unbehandelter Fehler — sowie den Umständen zum Zeitpunkt
des Abgangs.

**Why this priority**: Der Ausfall vom 30.07. hinterliess null Fehlermarker; die Unterscheidung
„abgeschossen" gegen „selbst gestorben" war nur durch Indizienrekonstruktion möglich und blieb
unbewiesen. Ein Eintrag beim Gehen ist die einzige Stelle, an der diese Information ohne Rätselraten
entsteht. Nachgelagert zu Story 1, weil ein stiller Abgang per Definition auch diesen Eintrag
verfehlen kann — die Lückenerkennung aus Story 1 ist die verlässlichere Absicherung.

**Independent Test**: Testbar, indem der Server nacheinander geordnet beendet, mit Abbruchsignal
beendet und hart abgebrochen wird; das Protokoll enthält danach für die ersten beiden Fälle je
einen datierten Eintrag mit unterschiedlichem Anlass, und für den dritten Fall belegt das Fehlen
eines Eintrags zusammen mit dem Ausfalleintrag aus Story 1 den stillen Abgang.

**Acceptance Scenarios**:

1. **Given** ein laufender Server, **When** er geordnet heruntergefahren wird, **Then** enthält das
   Betriebsprotokoll einen Eintrag mit Zeitstempel, Anlass „geordnetes Herunterfahren" und der
   Laufzeit der Instanz.
2. **Given** ein laufender Server, **When** er ein Abbruchsignal von aussen erhält, **Then** enthält
   das Protokoll einen Eintrag mit Zeitstempel und dem empfangenen Signal.
3. **Given** ein laufender Server, **When** er an einem unbehandelten Fehler endet, **Then** enthält
   das Protokoll einen Eintrag mit Zeitstempel und der Fehlerbeschreibung.
4. **Given** ein Server, der hart abgebrochen wurde und deshalb keinen Eintrag mehr schreiben
   konnte, **When** der nächste Start die Lücke erkennt, **Then** hält das Protokoll den Ausfall
   nachträglich als „stiller Abgang, kein Abschiedseintrag" fest.
5. **Given** mehrere Starts hintereinander, **When** das Protokoll gelesen wird, **Then** stehen die
   Einträge in zeitlicher Reihenfolge und Start und Abgang je Instanz sind einander zuzuordnen.
6. **Given** ein volles oder schreibgeschütztes Datenverzeichnis, **When** ein Eintrag geschrieben
   werden soll, **Then** läuft der Server unbeeinträchtigt weiter und beendet sich nicht wegen des
   fehlgeschlagenen Schreibvorgangs.

---

### User Story 3 - Ressourcendruck sehen, bevor die Maschine kippt (Priority: P3)

Der Nutzer sieht in der Oberfläche dauerhaft, wie viel Plattenplatz frei ist, wie stark der
Auslagerungsspeicher belegt ist und wie viele Features gerade gleichzeitig arbeiten. Wird der
Platz knapp, wird die Anzeige zur Warnung. Startet er bei knappem Platz ein weiteres Feature,
weiss er vorher, worauf er sich einlässt.

**Why this priority**: Am 30.07. lief die Platte auf 813 MB und der Auslagerungsspeicher auf 4,1 von
5,1 GB, während zwei Rust-Builds parallel liefen — die Zahl war zum Zeitpunkt der Entscheidung
nirgends erhoben. Ein Hinweis vorher ist billiger als jede Absturzanalyse. Zuletzt priorisiert,
weil er den Ausfall nur wahrscheinlicher vermeidbar macht, während die Stories 1 und 2 ihn
überhaupt erst sichtbar machen.

**Independent Test**: Testbar, indem die Oberfläche geöffnet wird — freier Plattenplatz,
Auslagerungsauslastung und Zahl gleichzeitig arbeitender Features sind ohne Terminal ablesbar und
aktualisieren sich fortlaufend. Für die Warnung wird die Schwelle testweise angehoben.

**Acceptance Scenarios**:

1. **Given** die geöffnete Oberfläche, **When** der Nutzer auf die Systemanzeige schaut, **Then**
   sind freier Plattenplatz des Datenverzeichnisses und Auslastung des Auslagerungsspeichers mit
   höchstens 60 Sekunden altem Stand lesbar.
2. **Given** freier Platz unterhalb der Warnschwelle, **When** die Anzeige aktualisiert wird,
   **Then** ist sie deutlich als Warnung gekennzeichnet und benennt den verbleibenden Platz.
3. **Given** zwei oder mehr gleichzeitig arbeitende Features, **When** der Nutzer auf die Anzeige
   schaut, **Then** nennt sie deren Zahl.
4. **Given** gleichzeitig arbeitende Features **und** Ressourcendruck, **When** die Anzeige
   aktualisiert wird, **Then** werden beide Umstände zusammen als Hinweis gezeigt (etwa
   „3 Features parallel, Swap 80 %, 813 MB frei").
5. **Given** ein System, auf dem eine der Kennzahlen nicht ermittelbar ist, **When** die Anzeige
   aufgebaut wird, **Then** bleibt die betreffende Kennzahl leer statt geraten, und die übrigen
   werden weiterhin gezeigt.
6. **Given** ein zuvor erkannter Ausfall, **When** der Nutzer die Systemanzeige öffnet, **Then**
   ist der letzte registrierte Ausfall mit Zeitfenster ablesbar — auch wenn er folgenlos war.

---

### Edge Cases

- **Erststart auf leerem Datenverzeichnis**: kein früheres Lebenszeichen vorhanden → kein Ausfall,
  keine Meldung.
- **Ausfall genau während des Schreibens eines Lebenszeichens**: der Eintrag ist unvollständig oder
  unleserlich → er gilt als nicht vorhanden, es wird auf das letzte lesbare Lebenszeichen
  zurückgefallen; der Start scheitert nicht daran.
- **Systemuhr springt rückwärts**: der letzte Zeitstempel liegt in der Zukunft → es wird kein
  negatives Ausfallfenster gemeldet, der Fall wird als „Zeitfenster nicht bestimmbar" behandelt.
- **Zwei Serverinstanzen auf demselben Datenverzeichnis**: die Lebenszeichen überschreiben sich
  gegenseitig → das Verhalten muss definiert sein, damit die zweite Instanz nicht dauerhaft
  Phantom-Ausfälle meldet.
- **Datenträger voll oder Verzeichnis nicht schreibbar**: weder Lebenszeichen noch Protokolleintrag
  dürfen den Server beenden — genau der Zustand, in dem das Feature gebraucht wird.
- **Sehr langer Ausfall** (Rechner tagelang aus, Server dabei nicht geordnet beendet): es wird ein
  Ausfall gemeldet; die Dauer wird lesbar dargestellt statt in Sekunden.
- **Ausfall ohne laufende Arbeit**: keine Aufmerksamkeitsmeldung, aber ein Protokolleintrag.
- **Wiederholter Neustart nach demselben Ausfall**: der Ausfall wird nicht mehrfach gemeldet.
- **Ausfall während einer Integration/eines Merges**: die bestehende Wiederaufnahme bleibt
  zuständig; die Ausfallmeldung tritt daneben und übernimmt keine Reparatur.
- **Erledigte Ausfallmeldung**: der Ausfall bleibt im Protokoll nachschlagbar, auch nachdem die
  Meldung abgehakt wurde.

## Requirements *(mandatory)*

### Functional Requirements

**Lebenszeichen und Lückenerkennung (US1)**

- **FR-001**: Der Server MUSS während des Betriebs in regelmässigem Abstand ein Lebenszeichen mit
  aktuellem Zeitstempel dauerhaft festhalten, sodass es einen harten Prozessabbruch überdauert.
- **FR-002**: Der Server MUSS beim geordneten Herunterfahren vermerken, dass der Abgang gewollt war.
- **FR-003**: Der Server MUSS bei jedem Start prüfen, ob zwischen dem letzten Lebenszeichen und dem
  Start mehr Zeit vergangen ist als die festgelegte Toleranz, ohne dass ein gewollter Abgang
  vermerkt wurde, und diesen Fall als unerwarteten Ausfall behandeln.
- **FR-004**: Ein erkannter Ausfall MUSS mit Beginn (letztes Lebenszeichen), Ende (Startzeitpunkt)
  und Dauer festgehalten werden.
- **FR-005**: Der Server MUSS zu einem erkannten Ausfall ermitteln, welche Läufe zum Ausfallzeitpunkt
  noch als laufend geführt wurden, und diese als betroffen ausweisen.
- **FR-006**: Der Server MUSS je Projekt mit betroffenen Läufen genau eine Aufmerksamkeitsmeldung
  erzeugen, deren Text Zeitfenster und Zahl der betroffenen Läufe dieses Projekts nennt.
- **FR-007**: Die Ausfallmeldung MUSS als eigene Art erkennbar sein und sich in der bestehenden
  Übersicht „braucht dich" wie die übrigen Meldungen öffnen, lesen und erledigen lassen.
- **FR-008**: Der Server MUSS bestehende Meldungen zu unterbrochenen Läufen unberührt lassen; die
  Ausfallmeldung tritt als Erklärung daneben.
- **FR-009**: Der Server MUSS denselben Ausfall bei weiteren Starts nicht erneut melden.
- **FR-010**: Der Server MUSS ohne vorhandenes Lebenszeichen (Erststart) und nach einem vermerkten
  gewollten Abgang auf jede Ausfallmeldung verzichten, unabhängig von der vergangenen Zeit.
- **FR-011**: Das Schreiben des Lebenszeichens DARF den Server bei einem Fehlschlag NICHT beenden
  und MUSS beim nächsten Takt erneut versucht werden.

**Abgangsprotokoll (US2)**

- **FR-012**: Der Server MUSS jeden Start und jeden erreichbaren Abgang mit Zeitstempel in einem
  fortlaufenden Betriebsprotokoll neben den Betriebsdaten festhalten.
- **FR-013**: Jeder Abgangseintrag MUSS den Anlass unterscheiden: geordnetes Herunterfahren,
  empfangenes Abbruchsignal (mit Angabe des Signals), unbehandelter Fehler (mit Fehlerbeschreibung)
  oder sonstiges Prozessende mit Rückgabewert.
- **FR-014**: Der Server MUSS einen erkannten Ausfall ohne zugehörigen Abgangseintrag nachträglich
  als stillen Abgang im Betriebsprotokoll vermerken.
- **FR-015**: Das Betriebsprotokoll MUSS ohne laufenden Server lesbar sein und in zeitlicher
  Reihenfolge vorliegen.
- **FR-016**: Das Betriebsprotokoll MUSS begrenzt wachsen, sodass es das Datenverzeichnis nicht
  unbegrenzt füllt.
- **FR-017**: Ein fehlgeschlagener Protokollschreibvorgang DARF den Start, den Betrieb oder das
  Herunterfahren des Servers NICHT verhindern.

**Ressourcendruck (US3)**

- **FR-018**: Das Toolkit MUSS den freien Plattenplatz des Datenverzeichnisses und die Auslastung
  des Auslagerungsspeichers ermitteln und in der Oberfläche dauerhaft sichtbar anzeigen.
- **FR-019**: Die Anzeige MUSS die Zahl der gerade gleichzeitig arbeitenden Features nennen, sobald
  es mehr als eines ist.
- **FR-020**: Die Anzeige MUSS bei Unterschreiten der Warnschwelle für freien Platz und bei
  Überschreiten der Hinweisschwelle für den Auslagerungsspeicher deutlich als Warnung erscheinen
  und die konkreten Werte nennen.
- **FR-021**: Die Werte MÜSSEN sich selbsttätig aktualisieren und dürfen höchstens 60 Sekunden alt
  sein.
- **FR-022**: Eine nicht ermittelbare Kennzahl MUSS als unbekannt dargestellt werden statt geraten,
  ohne die übrigen Kennzahlen zu unterdrücken.
- **FR-023**: Die Anzeige MUSS den letzten registrierten Ausfall mit Zeitfenster ausweisen, auch
  wenn er folgenlos blieb.
- **FR-024**: Die Ermittlung der Kennzahlen DARF den Server nicht blockieren und bei einem Fehler
  nicht beenden.

**Prüfbarkeit**

- **FR-025**: Die Lückenerkennung MUSS als eigenständig prüfbare Einheit vorliegen, deren Verhalten
  ohne echten Serverabsturz mit gesetzten Zeitpunkten getestet werden kann.
- **FR-026**: Automatisierte Tests MÜSSEN mindestens abdecken: erkannter Ausfall mit betroffenen
  Läufen, gewollter Abgang ohne Meldung, Erststart ohne Lebenszeichen, Ausfall ohne betroffene
  Läufe, rückwärts springende Uhr, wiederholter Start nach bereits gemeldetem Ausfall.

### Key Entities

- **Lebenszeichen**: jüngster Zeitpunkt, zu dem der Server nachweislich lief, dazu die Kennung der
  laufenden Instanz und die Angabe, ob der Abgang gewollt war.
- **Ausfall**: erkanntes Zeitfenster ohne laufenden Server (Beginn, Ende, Dauer), die Zahl und
  Zuordnung der betroffenen Läufe sowie der Vermerk, ob ein Abschiedseintrag vorlag.
- **Betriebsprotokoll-Eintrag**: Zeitstempel, Instanzkennung, Art (Start oder Abgang), Anlass des
  Abgangs und, soweit vorhanden, Fehlerbeschreibung oder Signal.
- **Ressourcen-Momentaufnahme**: freier Plattenplatz des Datenverzeichnisses, Auslastung des
  Auslagerungsspeichers, Zahl gleichzeitig arbeitender Features, Erhebungszeitpunkt.
- **Betroffener Lauf**: ein Lauf, der zum Zeitpunkt des letzten Lebenszeichens als laufend geführt
  wurde, mit seinem Feature und Projekt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nach einem erzwungenen Abbruch des Servers während laufender Arbeit zeigt die
  Oberfläche innerhalb einer Minute nach dem Neustart eine Meldung mit Beginn, Ende und Dauer des
  Ausfalls sowie der Zahl betroffener Läufe.
- **SC-002**: Der gemeldete Ausfallbeginn weicht höchstens 90 Sekunden vom tatsächlichen Zeitpunkt
  des Abbruchs ab.
- **SC-003**: Ein geordnetes Herunterfahren erzeugt in keinem Fall eine Ausfallmeldung, auch nicht
  nach mehrtägiger Pause.
- **SC-004**: Ein Ausfall ist allein aus den Betriebsdaten des Toolkits rekonstruierbar — ohne
  Terminal, ohne Durchsuchen von Konsolenausgaben; für den Ausfall vom Typ 30.07. (still, ohne
  Fehlermarker) gilt das ebenso wie für einen Fehlerabbruch.
- **SC-005**: Für jeden geordneten oder signalbedingten Abgang existiert genau ein datierter
  Protokolleintrag mit unterscheidbarem Anlass; bei hartem Abbruch weist das Protokoll den Ausfall
  spätestens nach dem Neustart als stillen Abgang aus.
- **SC-006**: Freier Plattenplatz, Auslastung des Auslagerungsspeichers und Zahl gleichzeitig
  arbeitender Features sind in der Oberfläche ohne Umweg über ein Terminal ablesbar und höchstens
  60 Sekunden alt.
- **SC-007**: Unterschreitet der freie Platz die Warnschwelle, ist die Warnung sichtbar, bevor der
  Nutzer ein weiteres Feature startet.
- **SC-008**: Lebenszeichen und Kennzahlenerhebung erzeugen im Leerlauf keine spürbare Zusatzlast
  (im Mittel unter 1 % Prozessorlast) und verlängern den Serverstart um höchstens 200 ms.
- **SC-009**: Die Lückenerkennung ist durch automatisierte Tests abgedeckt, die alle in FR-026
  genannten Fälle ohne echten Serverabsturz prüfen.

## Assumptions

- **Ausfallschwelle**: Lebenszeichen alle 30 Sekunden; eine Lücke ab 90 Sekunden (drei ausgefallene
  Takte) ohne vermerkten gewollten Abgang gilt als unerwarteter Ausfall. Werte im Plan
  nachjustierbar; sie müssen deutlich über dem Takt liegen, damit ein verzögerter Takt keinen
  Phantom-Ausfall erzeugt.
- **Warnschwellen**: freier Platz unter 10 GB ist ein Hinweis, unter 2 GB eine Warnung — begründet
  damit, dass ein einzelner Feature-Worktree mit Rust-Build 9–10 GB belegt (Befund A14). Der
  Auslagerungsspeicher gilt ab 80 % Belegung als Hinweis. Ab zwei gleichzeitig arbeitenden Features
  wird deren Zahl genannt.
- **Meldungen sind projektbezogen**: die bestehende Übersicht „braucht dich" zeigt genau ein
  Projekt. Ein Ausfall ist dagegen anlagenweit. Deshalb: eine Meldung je betroffenem Projekt, jede
  mit den eigenen Zahlen. Ein Ausfall ohne laufende Arbeit erzeugt bewusst keine Meldung — nur
  einen Protokolleintrag —, damit die Übersicht nicht mit folgenlosen Ausfällen verrauscht.
- **„Läufe" sind die bereits geführten Ausführungen** (Phasen-, Verify-, Review-, Chat-Läufe); die
  Zählung stützt sich auf denselben Bestand, den die bestehende Start-Bereinigung schon auswertet.
- **Zusammenspiel mit bestehender Wiederaufnahme**: die vorhandene Bereinigung verwaister Läufe und
  die Wiederaufnahme unterbrochener Integrationen bleiben unverändert zuständig. Dieses Feature
  ergänzt nur die Sichtbarkeit; es repariert nichts und startet nichts neu.
- **Ablageort**: Lebenszeichen und Betriebsprotokoll liegen im bestehenden Datenverzeichnis neben
  den Betriebsdaten, damit sie einen Abbruch der Datenbankverbindung überdauern und ohne laufenden
  Server lesbar sind.
- **Ort der Ressourcenanzeige**: die bestehende Kopfleiste der Oberfläche, weil sie unabhängig von
  Projekt und Ansicht sichtbar bleibt.
- **Betriebssystem**: Entwicklung und Betrieb auf macOS; die Kennzahlenermittlung darf
  plattformabhängig sein, muss aber bei fehlender Auskunft sauber degradieren statt zu scheitern.
- **Einzelinstanz**: das Toolkit läuft normalerweise als eine Instanz je Datenverzeichnis. Zwei
  gleichzeitige Instanzen auf demselben Verzeichnis sind kein unterstützter Betriebsfall, dürfen
  aber keine dauerhaften Phantom-Ausfälle erzeugen.

## Out of Scope

- Automatische Ursachenanalyse eines Absturzes (Speicherauszüge, Heap-Analyse, Auswertung von
  Betriebssystem-Absturzberichten).
- Benachrichtigung ausserhalb der Oberfläche (E-Mail, Push, Systemmeldung).
- Automatischer Neustart des Servers oder automatische Wiederaufnahme abgebrochener Läufe über die
  bestehende Wiederaufnahme hinaus.
- Aufräumen der Platte (Entfernen von Build-Verzeichnissen, gemeinsamer Build-Cache) — eigener
  Befund, eigenes Feature.
- Anzeige der Grösse einzelner Worktrees.
- Verhindern des Starts weiterer Features bei knappem Platz; dieses Feature warnt, es blockiert
  nicht.
