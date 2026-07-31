# Feature Specification: Plausibilitätsprüfung gemessener Läufe

**Feature Branch**: `feature/plausibilitaetspruefung`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Das Toolkit schreibt viele Kennzahlen und beurteilt keine davon. Vier kaputte Zustände stehen als auffällige Zahlen in der Datenbank, jeder mit einer SQL-Zeile auffindbar, keiner wird geprüft: 171 Läufe mit Tokens, aber cost_micros IS NULL (Widerspruch, wächst weiter); 43 Phasenläufe „failed" nach 2,1–2,7 s (Signatur: die Phase lief nie an); 31 orphaned; 22 Features in einem Projekt ohne einen einzigen Phasenlauf. Aufgabe: Beim Abschluss eines Laufs auf Widersprüche prüfen und als Attention melden — Tokens gesetzt, aber keine Kosten; Phasenlauf kürzer als ~6 s mit exit != 0 (Fehlstart, nicht Fehlschlag); Projekt mit Features, aber ohne Läufe; nachträgliche Korrektur eines fertigen Laufs um Faktor >= 2 (heute nur console.warn in orchestrator.ts, siehe updateTelemetry in db/repos.ts — die Ablehnung soll sichtbar werden). Das ist kein Feature im Sinne neuer Funktion, sondern ein Alarm auf Daten, die es bereits gibt. Bereits erledigt und NICHT erneut zu bauen: „Arbeit läuft, aber kein Lauf offen" (orchestrator.checkWorkWithoutRun). Abnahme: Jeder der vier Zustände erzeugt genau ein Attention-Item, mit Tests für Erkennung und für die Fälle, die NICHT melden dürfen. Keine Dauermeldungen für denselben Zustand."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ein gerade beendeter Lauf, dessen Zahlen sich widersprechen, fällt sofort auf (Priority: P1)

Ein Phasenlauf endet. Sobald seine Messung endgültig ist, beurteilt das Toolkit sie: Wurden
Tokens verbucht, ohne dass ein Betrag dazu existiert, erscheint das als eigene Meldung in der
Inbox — mit der Aussage, dass der Verbrauch dieses Laufs gezählt, aber nicht bepreist ist. Endete
der Lauf nach wenigen Sekunden mit einem Fehler-Exitcode, erscheint er als *Fehlstart*: die Phase
lief nie an, es ist kein inhaltlicher Fehlschlag. Beide Meldungen nennen Feature, Schritt und die
auffällige Zahl, sodass niemand eine Datenbankabfrage schreiben muss.

**Why this priority**: Das ist der Kern der Aufgabe und der einzige Teil, der die beiden
wachsenden Bestände (171 unbepreiste Läufe, 43 Fehlstarts) an der Quelle stoppt. Schon allein
ausgeliefert hat er Wert: ab dem ersten Lauf wächst kein unbemerkter Widerspruch mehr nach.

**Independent Test**: Vollständig testbar, indem ein Lauf mit Tokens ohne Betrag und ein Lauf mit
kurzer Laufzeit und Fehler-Exitcode abgeschlossen werden — je Fall entsteht genau eine Meldung —
und danach die nahe verwandten, unauffälligen Fälle (Betrag vorhanden; kurzer Lauf mit Exitcode 0;
langer Lauf mit Fehler) abgeschlossen werden, die keine Meldung erzeugen dürfen.

**Acceptance Scenarios**:

1. **Given** ein abgeschlossener Phasenlauf mit verbuchten Tokens und ohne Betrag, **When** seine
   Messung endgültig ist, **Then** existiert genau eine offene Meldung, die diesen Widerspruch
   benennt und Feature und Schritt nennt.
2. **Given** ein abgeschlossener Lauf mit verbuchten Tokens und vorhandenem Betrag, **When** seine
   Messung endgültig ist, **Then** entsteht keine Meldung.
3. **Given** ein abgeschlossener Lauf ohne verbuchte Tokens und ohne Betrag, **When** seine Messung
   endgültig ist, **Then** entsteht keine Meldung — nicht gemessen ist kein Widerspruch.
4. **Given** ein Lauf, dessen Betrag erst verspätet nachgetragen wird, **When** der Nachtrag
   innerhalb des bestehenden Nachtragsfensters eintrifft, **Then** entsteht keine Meldung, weil die
   Beurteilung erst nach Ablauf des Fensters stattfindet.
5. **Given** ein Phasenlauf, der nach 2,4 s mit einem Fehler-Exitcode endet, **When** er
   abgeschlossen wird, **Then** existiert genau eine offene Meldung, die ihn als Fehlstart
   bezeichnet und die Laufzeit nennt.
6. **Given** ein Phasenlauf, der nach 2,4 s mit Exitcode 0 endet, **When** er abgeschlossen wird,
   **Then** entsteht keine Meldung.
7. **Given** ein Phasenlauf, der nach 40 s mit einem Fehler-Exitcode endet, **When** er
   abgeschlossen wird, **Then** entsteht keine Fehlstart-Meldung — das ist ein Fehlschlag, nicht
   ein Fehlstart.
8. **Given** ein Phasenlauf, der nach 2,4 s endet, weil ein Mensch ihn abgebrochen hat, **When** er
   abgeschlossen wird, **Then** entsteht keine Fehlstart-Meldung.

---

### User Story 2 - Der bereits vorhandene Bestand wird beurteilt, nicht nur der nächste Lauf (Priority: P2)

Die vier Zustände stehen heute schon in der Datenbank. Das Toolkit prüft den vorhandenen Bestand
beim Start und danach regelmäßig, und meldet, was es findet: unbepreiste Läufe und Fehlstarts, die
schon da sind, sowie Projekte, in denen Features angelegt wurden, aber nie ein Phasenlauf
stattfand. Für die letzte Prüfung gibt es keinen Laufabschluss, an den sie sich hängen könnte —
gerade weil dort nie ein Lauf endet.

**Why this priority**: Ohne diesen Teil liefert das Feature am ersten Tag nichts: die 171
unbepreisten Läufe, die 43 Fehlstarts und die 22 Features ohne Lauf bleiben unsichtbar, weil sie
alle in der Vergangenheit entstanden sind. Nachgelagert ist er dennoch, weil Story 1 die Quelle
schliesst und damit den dauerhaften Nutzen trägt.

**Independent Test**: Testbar, indem eine Datenlage mit vorhandenen unbepreisten Läufen,
vorhandenen Fehlstarts und einem Projekt mit Features ohne Lauf angelegt und die Prüfung ausgelöst
wird — je Zustand entsteht genau eine Meldung; ein Projekt ohne Features, ein Projekt mit
mindestens einem Phasenlauf und ein Projekt mit gerade erst angelegten Features erzeugen keine.

**Acceptance Scenarios**:

1. **Given** ein Projekt mit mehreren nicht archivierten Features und ohne einen einzigen
   Phasenlauf, deren jüngstes Feature älter als die Karenzzeit ist, **When** die Bestandsprüfung
   läuft, **Then** existiert genau eine offene Meldung für dieses Projekt, die die Anzahl der
   Features nennt.
2. **Given** ein Projekt, dessen Features erst vor wenigen Minuten angelegt wurden, **When** die
   Bestandsprüfung läuft, **Then** entsteht keine Meldung — das Projekt hatte noch keine
   Gelegenheit, einen Lauf zu starten.
3. **Given** ein Projekt ohne jedes Feature, **When** die Bestandsprüfung läuft, **Then** entsteht
   keine Meldung.
4. **Given** ein Projekt mit Features und genau einem Phasenlauf, der fehlgeschlagen ist, **When**
   die Bestandsprüfung läuft, **Then** entsteht keine Meldung — es lief etwas, nur nicht gut.
5. **Given** ein Projekt, dessen Features alle archiviert sind und in dem nie ein Lauf stattfand,
   **When** die Bestandsprüfung läuft, **Then** entsteht keine Meldung.
6. **Given** vorhandene abgeschlossene Läufe mit Tokens ohne Betrag, **When** die Bestandsprüfung
   das erste Mal läuft, **Then** existiert je betroffenem Projekt genau eine offene Meldung, die
   die Anzahl betroffener Läufe und einen konkreten Lauf als Beispiel nennt.
7. **Given** vorhandene Fehlstarts, **When** die Bestandsprüfung das erste Mal läuft, **Then**
   existiert je betroffenem Feature genau eine offene Meldung mit Anzahl und Beispiel.

---

### User Story 3 - Eine verworfene Nachkorrektur verschwindet nicht in der Konsole (Priority: P3)

Wird die Messung eines fertigen Laufs nachträglich korrigiert und die Korrektur abgelehnt, weil
sie die Zahl deutlich senken würde, ist das heute nur eine Zeile auf der Konsole. Künftig wird
daraus eine Meldung, wenn die verworfene Zahl um Faktor 2 oder mehr von der bestehenden abweicht:
sie nennt beide Zahlen, den Faktor und den Grund der Ablehnung. Die alltäglichen kleinen
Abweichungen und die routinemässige Ablehnung „Nachtrag ohne Betrag, bepreiste Zahl bleibt stehen"
bleiben auf der Konsole.

**Why this priority**: Eine Abweichung um Faktor 2 bedeutet, dass zwei Messwege für denselben Lauf
grob verschiedene Ergebnisse liefern — einer davon ist falsch, und es ist unbekannt welcher. Die
Ablehnung schützt heute die bessere Zahl, verbirgt aber den Widerspruch. Nachgelagert, weil sie
selten auftritt und keine Zahl verfälscht.

**Independent Test**: Testbar, indem für einen fertigen Lauf eine Nachkorrektur mit halbierter und
eine mit leicht kleinerer Zahl versucht wird — nur die erste erzeugt eine Meldung — und eine
Korrektur, die angenommen wird, keine erzeugt.

**Acceptance Scenarios**:

1. **Given** ein fertiger Lauf mit verbuchten Tokens, **When** eine Nachkorrektur abgelehnt wird,
   deren Zahl um Faktor 2 oder mehr unter der bestehenden liegt, **Then** existiert genau eine
   offene Meldung mit bestehender Zahl, verworfener Zahl und Faktor.
2. **Given** ein fertiger Lauf, **When** eine Nachkorrektur abgelehnt wird, deren Zahl um weniger
   als Faktor 2 abweicht, **Then** entsteht keine Meldung; die Konsolenausgabe bleibt wie bisher.
3. **Given** ein fertiger, bepreister Lauf, **When** eine Nachkorrektur ohne Betrag abgelehnt wird,
   die die Zahl nicht um Faktor 2 senkt, **Then** entsteht keine Meldung — das ist der Regelfall
   der Transkript-Rückfallebene.
4. **Given** ein fertiger Lauf, **When** eine Nachkorrektur angenommen wird, **Then** entsteht
   keine Meldung.

---

### User Story 4 - Die Meldungen bleiben handhabbar (Priority: P4)

Wer eine dieser Meldungen gelesen und den Befund zur Kenntnis genommen hat, löst sie auf — und sie
kehrt nicht beim nächsten Prüfintervall wieder. Sie kommt erst zurück, wenn der Bestand sich
verändert hat, also ein neuer betroffener Lauf hinzukommt. Solange ein Befund offen ist, legt
wiederholtes Prüfen keine zweite Meldung an, und ein wieder arbeitender Agent löst die Meldung
nicht auf — der Widerspruch in den Daten besteht unabhängig davon weiter.

**Why this priority**: Ohne diesen Teil ist das Feature nach kurzer Zeit schädlich: eine Inbox, in
der dieselben vier Befunde im Minutentakt nachwachsen, wird ignoriert — mit ihr die Meldungen, die
wirklich dringend sind. Nachgelagert, weil die Erkennung zuerst existieren muss.

**Independent Test**: Testbar, indem die Prüfung zehnmal über einen unveränderten Bestand läuft
und danach die Anzahl offener Meldungen mit der nach dem ersten Lauf verglichen wird; anschliessend
wird eine Meldung aufgelöst und die Prüfung erneut ausgelöst.

**Acceptance Scenarios**:

1. **Given** einen unveränderten Bestand mit allen vier Befunden, **When** die Prüfung zehnmal
   läuft, **Then** ist die Anzahl offener Meldungen dieselbe wie nach dem ersten Lauf.
2. **Given** eine aufgelöste Befund-Meldung und einen unveränderten Bestand, **When** die Prüfung
   erneut läuft, **Then** entsteht keine neue Meldung für denselben Befund.
3. **Given** eine aufgelöste Befund-Meldung, **When** ein weiterer betroffener Lauf hinzukommt und
   die Prüfung läuft, **Then** entsteht wieder genau eine Meldung.
4. **Given** eine offene Befund-Meldung zu einem Feature, **When** ein Agent dieses Features wieder
   arbeitet, **Then** bleibt die Meldung offen.
5. **Given** offene Befund-Meldungen, **When** das Toolkit neu startet, **Then** sind sie weiterhin
   offen.
6. **Given** die Inbox mit Meldungen aller vier Befunde, **When** der Nutzer sie ansieht, **Then**
   sind die vier Befunde als eigene Arten voneinander unterscheidbar und einzeln auflösbar.

---

### Edge Cases

- Ein Lauf ist noch nicht abgeschlossen: Er wird nicht beurteilt — eine laufende Messung ist per
  Definition unvollständig.
- Ein Lauf wurde beim Start als verwaist aufgeräumt (Prozess ohne Abschluss): Er zählt nicht als
  Fehlstart; für diesen Fall gibt es die bestehende Meldung über unterbrochene Läufe.
- Ein Lauf mit Laufzeit von genau der Schwelle (6 s) und Fehler-Exitcode: gilt nicht als Fehlstart
  — die Schwelle ist ausschliessend, damit der Grenzfall eindeutig ist.
- Eine Nachkorrektur trifft nach Ablauf des Nachtragsfensters ein: Sie wird wie bisher verworfen;
  Befund D greift nur, wenn die Ablehnung wegen einer Abweichung um Faktor 2 oder mehr erfolgt.
- Ein Projekt hat Features und Läufe, aber alle Läufe gehören zu einem inzwischen gelöschten
  Feature: Es lief etwas — keine Meldung über ein Projekt ohne Läufe.
- Die Prüfung selbst schlägt fehl (unerwartete Datenlage): Der Laufabschluss geht dennoch
  vollständig durch; die Prüfung ist eine Beurteilung, kein Tor.
- Ein Befund betrifft mehrere Läufe desselben Features gleichzeitig: Es entsteht eine Meldung mit
  Anzahl, nicht eine Meldung je Lauf.

## Requirements *(mandatory)*

### Functional Requirements

**Zeitpunkt der Beurteilung**

- **FR-001**: Das Toolkit MUSS einen abgeschlossenen Lauf auf Widersprüche beurteilen, sobald seine
  Messung als endgültig gilt — also nach Ablauf des bestehenden Nachtragsfensters, nicht im Moment
  des Prozessendes.
- **FR-002**: Das Toolkit MUSS den vorhandenen Bestand zusätzlich beim Start und danach in einem
  festen Intervall beurteilen, damit bereits entstandene Zustände sichtbar werden und Befunde ohne
  Laufabschluss überhaupt auffallen können.
- **FR-003**: Die Beurteilung DARF den Abschluss eines Laufs nicht verzögern, verändern oder zum
  Scheitern bringen; ein Fehler in der Beurteilung MUSS ohne Auswirkung auf den Lauf bleiben.

**Befund A — gemessen, aber nicht bepreist**

- **FR-004**: Das Toolkit MUSS einen Lauf melden, der Tokens verbucht hat und für den kein Betrag
  vorliegt.
- **FR-005**: Das Toolkit DARF NICHT melden, wenn ein Betrag vorliegt, wenn keine Tokens verbucht
  sind, oder wenn die Messung des Laufs noch nachtragsfähig ist.

**Befund B — Fehlstart statt Fehlschlag**

- **FR-006**: Das Toolkit MUSS einen Phasenlauf melden, dessen Laufzeit unter 6 Sekunden liegt und
  der mit einem Exitcode ungleich 0 endete, und ihn als Fehlstart bezeichnen — die Phase lief nie
  an.
- **FR-007**: Das Toolkit DARF NICHT melden, wenn der Exitcode 0 ist, wenn die Laufzeit 6 Sekunden
  oder mehr beträgt, wenn der Lauf auf Anforderung abgebrochen wurde, oder wenn der Lauf als
  verwaist aufgeräumt wurde.

**Befund C — Projekt mit Features, aber ohne Lauf**

- **FR-008**: Das Toolkit MUSS ein Projekt melden, das mindestens ein nicht archiviertes Feature
  besitzt, in dem nie ein Phasenlauf stattfand und dessen jüngstes Feature älter als die Karenzzeit
  ist.
- **FR-009**: Das Toolkit DARF NICHT melden, wenn das Projekt kein Feature besitzt, wenn mindestens
  ein Phasenlauf existiert (auch ein fehlgeschlagener), wenn alle Features archiviert sind, oder
  wenn die Karenzzeit noch nicht abgelaufen ist.

**Befund D — verworfene Nachkorrektur**

- **FR-010**: Das Toolkit MUSS eine abgelehnte Nachkorrektur eines fertigen Laufs melden, wenn die
  verworfene Zahl um Faktor 2 oder mehr von der bestehenden abweicht; die Meldung MUSS bestehende
  Zahl, verworfene Zahl und Faktor nennen.
- **FR-011**: Das Toolkit DARF NICHT melden, wenn die Nachkorrektur angenommen wurde oder wenn die
  Abweichung unter Faktor 2 liegt; diese Fälle behalten ihre bisherige Konsolenausgabe.

**Meldungen**

- **FR-012**: Die vier Befunde MÜSSEN in der Inbox als eigene, voneinander unterscheidbare Arten
  erscheinen, deren Bezeichnung den Befund benennt, und einzeln auflösbar sein.
- **FR-013**: Je Befund und Bezugsobjekt DARF höchstens eine offene Meldung existieren:
  Befund A und C beziehen sich auf ein Projekt, Befund B und D auf ein Feature. Wiederholtes
  Beurteilen desselben Zustands DARF keine zweite Meldung anlegen.
- **FR-014**: Eine aufgelöste Meldung DARF NICHT erneut angelegt werden, solange sich der
  zugrundeliegende Bestand nicht verändert hat; sie DARF erst wiederkehren, wenn ein weiterer
  betroffener Lauf oder ein weiteres betroffenes Projekt hinzukommt.
- **FR-015**: Eine Befund-Meldung MUSS die Anzahl betroffener Läufe und ein konkretes Beispiel
  (Feature, Schritt, auffällige Zahl) nennen, sodass der Befund ohne Datenbankabfrage
  nachvollziehbar ist.
- **FR-016**: Eine Befund-Meldung DARF NICHT dadurch ungültig werden, dass ein Agent desselben
  Features wieder arbeitet — anders als bei Prozess-Meldungen besteht der Widerspruch in den Daten
  unabhängig von laufender Arbeit weiter.
- **FR-017**: Befund-Meldungen MÜSSEN einen Neustart des Toolkits überleben und dürfen dabei nicht
  als veraltet verworfen werden.
- **FR-018**: Die bestehenden Konsolenausgaben MÜSSEN erhalten bleiben; eine Meldung ersetzt kein
  Protokoll.

### Key Entities

- **Befund**: Eine benannte Plausibilitätsregel über bereits gespeicherte Daten — Bedingung,
  Bezugsobjekt (Projekt oder Feature), Schwellwert und Text der Meldung. Vier Stück, jeder für
  sich prüfbar.
- **Meldung**: Ein Eintrag in der bestehenden Inbox, der einen Befund für ein Bezugsobjekt
  festhält: Art, Projekt, ggf. Feature, Text mit Anzahl und Beispiel, Zeitpunkt, Auflösung.
- **Lauf**: Ein bereits erfasster Vorgang mit Start- und Endzeitpunkt, Exitcode, Status, Tokenzahl,
  Betrag und Herkunft der Messung — Grundlage der Befunde A, B und D. Wird durch dieses Feature
  nicht verändert.
- **Projekt / Feature**: Bezugsobjekte der Meldungen und Grundlage von Befund C (Anzahl nicht
  archivierter Features, Alter des jüngsten Features, Vorhandensein von Phasenläufen).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Jeder der vier Zustände erzeugt bei einer Beurteilung genau eine Meldung — nicht
  keine und nicht mehrere.
- **SC-002**: Zu jedem der vier Befunde existiert mindestens ein Test, der die Erkennung belegt,
  und mindestens ein Test je Nicht-Melde-Regel aus FR-005, FR-007, FR-009 und FR-011.
- **SC-003**: Nach dem ersten Start mit dieser Beurteilung sind die heute unbemerkten Zustände
  (171 unbepreiste Läufe, 43 Fehlstarts, 22 Features ohne Lauf) in der Inbox sichtbar, ohne dass
  jemand eine Datenbankabfrage formuliert.
- **SC-004**: Zehn aufeinanderfolgende Beurteilungen eines unveränderten Bestands erzeugen
  zusammen nicht mehr Meldungen als eine einzige.
- **SC-005**: Eine aufgelöste Meldung kehrt bei unverändertem Bestand nicht zurück und kehrt bei
  einem neu hinzukommenden betroffenen Lauf zurück.
- **SC-006**: Der Abschluss eines Laufs verhält sich für den Nutzer unverändert: gleicher Ablauf,
  gleiche Dauer, gleiches Ergebnis — auch dann, wenn die Beurteilung einen Fehler auslöst.
- **SC-007**: Kein Lauf, kein Feature und kein Projekt wird durch dieses Feature verändert; die
  Beurteilung liest nur und schreibt ausschliesslich Meldungen.

## Assumptions

- **Schwelle Fehlstart: 6 Sekunden.** Beobachtet wurden 2,1–2,7 s. Die Schwelle liegt darüber, um
  die Signatur sicher zu treffen, und weit genug unter der Dauer eines echten inhaltlichen
  Fehlschlags. Die Schwelle ist ausschliessend: genau 6 s meldet nicht.
- **Karenzzeit Befund C: 60 Minuten** nach Anlage des jüngsten Features. Ohne Karenz würde jedes
  neu eingerichtete Projekt sofort melden, bevor überhaupt ein Lauf möglich war. Der reale Fall
  (22 Features, nie ein Lauf) besteht seit Tagen und wird davon nicht verdeckt.
- **Beurteilung nach dem bestehenden Nachtragsfenster.** Beträge treffen regelmässig verspätet ein;
  eine Beurteilung im Moment des Prozessendes wäre bei Befund A zunächst bei nahezu jedem Lauf
  falsch positiv.
- **Bestandsprüfung im Takt der bestehenden regelmässigen Prüfung** (heute eine Minute). Ein
  eigener Takt ist nicht nötig; die Befunde sind nicht zeitkritisch.
- **Befund A gilt für jeden gemessenen Lauf, Befund B und C nur für Phasenläufe.** Der Widerspruch
  „gezählt, aber nicht bepreist" ist unabhängig von der Art des Laufs; die Fehlstart-Signatur und
  „Projekt ohne Lauf" beziehen sich ausdrücklich auf Phasenläufe.
- **Ein Betrag entsteht ausschliesslich aus den Meldungen der CLI**; das Toolkit besitzt keine
  eigene Preistabelle. Befund A sagt daher „der Preis dieses Laufs ist unbekannt", nicht „der
  Preis wurde falsch berechnet" — und es gibt keinen Weg, ihn nachträglich zu berechnen.
- **Die bestehende Inbox wird genutzt**, samt ihres Verhaltens, dieselbe offene Meldung nicht
  doppelt anzulegen. Es entsteht kein zweiter Meldeweg.
- **Die Beurteilung greift nie ein.** Sie repariert nichts, bricht nichts ab und hält nichts auf —
  auch dann nicht, wenn der Befund schwer wiegt.

## Out of Scope

- **„Arbeit läuft, aber kein Lauf offen"** — bereits gebaut (`orchestrator.checkWorkWithoutRun`)
  und ausdrücklich nicht erneut umzusetzen.
- **Die 31 verwaisten Läufe.** In der Bestandsaufnahme genannt, aber keiner der vier Befunde: für
  verwaiste Läufe existiert bereits eine Meldung beim Aufräumen zum Start.
- **Reparatur des Bestands.** Die 171 unbepreisten Läufe werden gemeldet, nicht nachträglich
  bepreist; die 43 Fehlstarts werden nicht neu gestartet.
- **Neue Kennzahlen und neue Messwege.** Es werden ausschliesslich vorhandene Daten beurteilt.
- **Weitere Plausibilitätsregeln** über die vier genannten hinaus, etwa Ausreisser bei Tokenzahlen,
  Läufe ohne Protokoll oder Widersprüche zwischen Phasenzustand und Worktree.
- **Änderungen am Verhalten der Nachkorrektur selbst.** Die Ablehnungsregel bleibt wie sie ist; nur
  ihre Sichtbarkeit ändert sich.
