# Feature Specification: Token- und Kostenmessung aus der Telemetrie der Claude-CLI

**Feature Branch**: `feature/token-und-kostenmessung-auf-die-opentelemetry-daten-der-clau`

**Created**: 2026-07-27

**Status**: Draft

**Input**: User description: "Die Messung liest heute die Claude-Transkript-JSONL aus (transcriptWatcher.ts + orchestrator.startOffsetIn/meterTurn). Das ist aus drei Gründen die schwächere Quelle: 1. Fragil — die Startmarke eines Laufs muss aus Dateigrösse bzw. Zeitstempeln rekonstruiert werden (ein 2-Minuten-Lauf wurde mit 62 Mio. Tokens verbucht, behoben in 3cc2201). 2. Unvollständig — Subagenten laufen in eigenen Transkripten und werden nicht zuverlässig zugeordnet. 3. Selbst gerechnet — die Kosten entstehen aus einer eigenen Preistabelle. Die Claude-CLI bringt OpenTelemetry mit und meldet Tokens, Kosten und Spans selbst — auch für PTY-Sessions. ZIEL: Telemetrie der CLI als primäre Messquelle; das Transkript-Auslesen bleibt als Rückfallebene erhalten."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Der Verbrauch eines Laufs stimmt, weil ihn die CLI selbst meldet (Priority: P1)

Als Nutzer der „Läufe"-Ansicht möchte ich zu jedem Lauf den Verbrauch sehen, den die
Claude-CLI für genau diesen Lauf selbst gemeldet hat — statt einer Zahl, die das Toolkit aus
Byte-Positionen in einer Protokolldatei rekonstruiert hat.

Heute muss das Toolkit raten, wo in der fortlaufenden Protokolldatei einer Session ein Lauf
beginnt. Ist die Session-Zuordnung beim Start noch nicht bekannt — der Regelfall bei einer
fortgesetzten Session — wird die Startmarke nachträglich aus Zeitstempeln erschlossen. Genau
dort entstand der Fehler, der einem Zwei-Minuten-Lauf 62 Mio. Tokens zuschrieb. Die
Rekonstruktion ist behoben, aber sie bleibt eine Rekonstruktion. Meldet die CLI ihren Verbrauch
selbst und laufend, entfällt die Startmarke als Fehlerquelle vollständig: es kann nur ankommen,
was während des Laufs tatsächlich verbraucht wurde.

**Why this priority**: Das ist der Kern der Anforderung und der einzige Teil, der einen
belegten Schaden behebt. Ohne diese Story bleibt jede weitere Verbesserung auf einer Messung
aufgebaut, deren Grundannahme — „diese Byte-Position markiert den Laufbeginn" — nicht
garantiert werden kann. Alle übrigen Stories setzen darauf auf.

**Independent Test**: Eine bestehende Claude-Session fortsetzen (Session-Zuordnung beim Start
also unbekannt), darin einen kurzen Phasenlauf ausführen und den ausgewiesenen Verbrauch mit
dem vergleichen, was die CLI für denselben Zeitraum selbst berichtet. Beide Zahlen müssen
übereinstimmen; der Lauf darf keinen Verbrauch früherer Läufe derselben Session enthalten.

**Acceptance Scenarios**:

1. **Given** eine fortgesetzte Session, deren Zuordnung beim Start des Laufs noch nicht
   feststeht, **When** ein Phasenlauf abgeschlossen wird, **Then** weist der Lauf nur den
   Verbrauch aus, der zwischen seinem Start und seinem Ende gemeldet wurde — kein Verbrauch
   aus früheren Läufen derselben Session.
2. **Given** zwei aufeinanderfolgende Läufe in derselben Session, **When** beide abgeschlossen
   sind, **Then** ist die Summe beider Läufe gleich dem für die Session insgesamt gemeldeten
   Verbrauch, und kein Anteil erscheint in beiden Läufen.
3. **Given** ein abgeschlossener Lauf, **When** der Nutzer seine Verbrauchsangaben betrachtet,
   **Then** sind Input, Output, Cache-Read und Cache-Creation getrennt ausgewiesen, so wie sie
   gemeldet wurden.
4. **Given** ein Lauf, dessen Verbrauchsmeldungen erst nach seinem Abschluss vollständig
   eintreffen, **When** die nachgereichten Meldungen ankommen, **Then** wird der Lauf
   nachträglich korrigiert, und die Ansicht zeigt die korrigierte Zahl ohne Zutun des Nutzers.
5. **Given** parallel laufende Sessions zu verschiedenen Features, **When** in beiden
   gearbeitet wird, **Then** erhält jeder Lauf ausschliesslich den Verbrauch seiner eigenen
   Session.
6. **Given** eine Claude-Session, die der Nutzer ausserhalb des Toolkits gestartet hat,
   **When** deren Verbrauchsmeldungen eintreffen, **Then** werden sie keinem Lauf des Toolkits
   zugeschrieben.

---

### User Story 2 - Verbrauch von Subagenten zählt mit (Priority: P2)

Als Nutzer möchte ich, dass der Verbrauch von Subagenten, die ein Lauf startet, im Verbrauch
dieses Laufs enthalten und als Subagenten-Anteil erkennbar ist.

Heute fehlt dieser Anteil vollständig: Subagenten schreiben in eigene Protokolle, die das
Toolkit nicht ausliest. Bei Läufen, die einen Grossteil ihrer Arbeit an Subagenten delegieren,
zeigt die Ansicht deshalb einen Bruchteil des tatsächlichen Verbrauchs — und weist ihn trotzdem
als „gemessen" aus. Die CLI kennzeichnet ihre Verbrauchsmeldungen mit der Herkunft
(Hauptagent, Subagent, Hilfsanfrage), sodass beides möglich ist: mitzählen und trennen.

**Why this priority**: Behebt eine systematische Untererfassung, die den ausgewiesenen
Verbrauch nicht nur ungenau, sondern richtungsweisend falsch macht — Läufe mit vielen
Subagenten sehen billiger aus als sie sind, und genau diese Läufe sind die teuren.
Eigenständig prüfbar und liefert für sich genommen Wert, setzt aber die Zuordnung aus US1
voraus.

**Independent Test**: Einen Lauf ausführen, der ausdrücklich Subagenten einsetzt, und prüfen,
dass der ausgewiesene Verbrauch grösser ist als der reine Hauptagent-Anteil und dass der
Subagenten-Anteil getrennt ablesbar ist.

**Acceptance Scenarios**:

1. **Given** ein Lauf, der Subagenten startet, **When** er abgeschlossen ist, **Then** enthält
   sein Gesamtverbrauch den Verbrauch dieser Subagenten.
2. **Given** derselbe Lauf, **When** der Nutzer seine Verbrauchsaufschlüsselung betrachtet,
   **Then** ist der Anteil der Subagenten getrennt vom Hauptagenten ausgewiesen.
3. **Given** ein Lauf ohne Subagenten, **When** er abgeschlossen ist, **Then** wird kein
   Subagenten-Anteil ausgewiesen (kein leerer Platzhalter, keine Null-Zeile).
4. **Given** Läufe eines Features mit und ohne Subagenten, **When** der Nutzer die
   Feature-Summe betrachtet, **Then** ist sie die Summe der Einzelläufe inklusive
   Subagenten-Anteile.

---

### User Story 3 - Herkunft der Zahl ist sichtbar, und die Messung hat eine Rückfallebene (Priority: P2)

Als Nutzer möchte ich zu jedem Lauf erkennen, woher seine Verbrauchszahl stammt, und darauf
zählen können, dass jeder Lauf eine Zahl bekommt — auch wenn die CLI keine Telemetrie liefert.

Die bestehende Kennzeichnung („gemessen" / „geparst" / „geschätzt") bekommt eine weitere,
höchste Stufe: von der CLI gemeldet. Fällt die Telemetrie aus — ältere CLI-Version, Telemetrie
nicht aktiv, keine Daten eingetroffen — greift die heutige Messung aus dem Transkript
unverändert, und der Lauf ist entsprechend gekennzeichnet.

**Why this priority**: Ohne sichtbare Herkunft ist der Umstieg nicht überprüfbar — niemand
könnte erkennen, ob die neue Quelle überhaupt greift oder ob im Stillen weiter die alte
Rekonstruktion zählt. Genau das war die Vorgeschichte des 62-Mio.-Fehlers: eine falsche Zahl,
die aussah wie eine gemessene. Zugleich verhindert die Rückfallebene, dass ein Ausfall der
neuen Quelle die Verbrauchsansicht leerräumt.

**Independent Test**: Denselben Lauf einmal mit aktiver und einmal mit abgeschalteter
Telemetrie ausführen. Beide Läufe tragen eine Zahl; die Herkunftskennzeichnung unterscheidet
sich und ist in der Ansicht ablesbar.

**Acceptance Scenarios**:

1. **Given** ein Lauf mit eingetroffenen Telemetriedaten, **When** der Nutzer ihn betrachtet,
   **Then** ist er als „von der CLI gemeldet" gekennzeichnet.
2. **Given** ein Lauf, für den keine Telemetriedaten eintrafen, **When** er abgeschlossen wird,
   **Then** erhält er die Zahl aus der bestehenden Transkript-Messung und die bisherige
   Kennzeichnung.
3. **Given** eine Mischung aus Läufen beider Herkünfte, **When** der Nutzer die Übersicht
   betrachtet, **Then** zeigt der Messanteil, welcher Anteil der Läufe aus welcher Quelle
   stammt.
4. **Given** ein Lauf, für den beide Quellen Daten hätten, **When** er abgeschlossen wird,
   **Then** gilt die Meldung der CLI, und die Transkript-Zahl wird nicht zusätzlich addiert.
5. **Given** die Telemetrie kann nicht in Betrieb genommen werden (Empfang gestört, Zugang
   belegt), **When** der Nutzer eine Session startet, **Then** startet die Session normal, die
   Messung fällt auf das Transkript zurück, und der Nutzer wird auf die inaktive Telemetrie
   hingewiesen.

---

### User Story 4 - Kosten stammen von der CLI statt aus einer eigenen Preistabelle (Priority: P3)

Als Nutzer möchte ich zu einem Lauf den Geldbetrag sehen, den die Claude-CLI selbst für ihn
ausweist — nicht einen, den das Toolkit aus Tokenzahlen und hinterlegten Preisannahmen
errechnet hat.

Geschätzte Kosten wurden am 26.07.2026 bewusst aus der Oberfläche entfernt, weil sie wie eine
Abrechnung aussahen, ohne eine zu sein, und von niemandem überprüfbar waren
(`specs/kosten-aus-laeufe-entfernen`). Die CLI meldet den Betrag selbst; damit entfällt der
Grund für die Entfernung — sofern die Zahl auch als gemeldeter, nicht geschätzter Betrag
kenntlich ist.

**Geklärt (2026-07-27)**: Der gemeldete Betrag erscheint in der Oberfläche, deutlich als
„gemeldet" gekennzeichnet. Die Entfernung vom 26.07. wird damit ausschliesslich für gemeldete
Beträge zurückgenommen — für geschätzte bleibt sie bestehen (FR-022 verbietet jede eigene
Preistabelle, FR-023 jeden Ersatzwert).

**Why this priority**: Wertvoll, aber nicht Voraussetzung für die Korrektheit der Messung. Die
Tokenzahlen aus US1/US2 sind für sich genommen brauchbar; der Geldbetrag ist eine zusätzliche
Sicht darauf. Nachrangig auch deshalb, weil hier eine bereits getroffene Produktentscheidung
berührt wird.

**Independent Test**: Einen Lauf ausführen und den ausgewiesenen Betrag mit dem vergleichen,
den die CLI für dieselbe Session selbst nennt. Kein Betrag darf aus einer im Toolkit
hinterlegten Preistabelle stammen.

**Acceptance Scenarios**:

1. **Given** ein Lauf mit gemeldetem Geldbetrag, **When** der Nutzer ihn betrachtet, **Then**
   entspricht der Betrag dem von der CLI gemeldeten und ist als gemeldet — nicht geschätzt —
   gekennzeichnet.
2. **Given** ein Lauf ohne gemeldeten Geldbetrag, **When** der Nutzer ihn betrachtet, **Then**
   erscheint kein Betrag und keine Ersatzschätzung.
3. **Given** mehrere Läufe eines Features, **When** der Nutzer die Feature-Summe betrachtet,
   **Then** summiert diese ausschliesslich gemeldete Beträge und weist aus, wie viele Läufe
   ohne Betrag darin enthalten sind.
4. **Given** Läufe aus der Zeit vor diesem Feature, **When** der Nutzer sie betrachtet,
   **Then** erscheint für sie kein rückwirkend errechneter Betrag.

---

### Edge Cases

- **Meldung trifft nach dem Lauf ein**: Verbrauch wird in Intervallen gemeldet, nicht sofort.
  Ein Lauf, der kürzer ist als ein Meldeintervall, kann bei seinem Abschluss noch keine oder
  nur unvollständige Daten haben. Der Lauf muss nachträglich korrigiert werden können, und es
  muss einen definierten Zeitpunkt geben, ab dem seine Zahl als endgültig gilt.
- **Meldung trifft nie ein**: Session endet, bevor das letzte Intervall gemeldet wurde, oder
  die Übertragung schlägt fehl → Rückfall auf die Transkript-Messung, kenntlich gemacht.
- **Doppelzählung**: Kommt dieselbe Meldung erneut an (Wiederholung nach Übertragungsfehler)
  oder wird eine fortlaufende Summe als Einzelwert gelesen, verdoppelt sich der Verbrauch.
  Wiederholte Meldungen dürfen nicht zweimal zählen.
- **Fremde Session**: Läuft parallel eine Claude-Session ausserhalb des Toolkits mit derselben
  Telemetrie-Konfiguration, treffen deren Meldungen ebenfalls ein. Sie dürfen keinem Lauf des
  Toolkits zugeschrieben werden.
- **Session ohne laufende Phase**: Verbrauch, der entsteht, während kein Lauf aktiv ist (der
  Nutzer tippt selbst in die Session), gehört zu keinem Lauf und darf keinen früheren oder
  späteren Lauf aufblähen.
- **Session-Wechsel mitten im Lauf**: Ein Kontext-Reset während einer Phase erzeugt eine neue
  CLI-Session. Der Verbrauch beider Abschnitte gehört demselben Lauf.
- **Ältere CLI ohne Telemetrie**: Keine Meldungen, kein Fehler, kein blockierter Start —
  Rückfall auf die bestehende Messung.
- **Sichtbare Terminalausgabe**: Die Messung darf die im Toolkit sichtbare Terminalausgabe der
  Session nicht verändern oder mit Diagnoseausgaben durchsetzen.
- **Bestehende Telemetrie-Konfiguration des Nutzers**: Hat der Nutzer bereits eine eigene
  Telemetrie-Konfiguration (z. B. auf einen Firmen-Endpunkt), darf das Toolkit sie nicht
  stillschweigend ausser Kraft setzen — und ebenso wenig ungefragt Nutzungsdaten dorthin
  senden. **Geklärt (2026-07-27)**: Die Toolkit-Messung gewinnt — aber ausschliesslich für die
  vom Toolkit gestarteten Prozesse und mit sichtbarem Hinweis. Die Konfiguration des Nutzers
  (Umgebung, Einstellungsdateien) wird nicht verändert; selbst gestartete Sessions bleiben
  unberührt. Eine Weiterleitung an fremde Endpunkte findet nicht statt (FR-028).
- **Datenmenge**: Eine lange Session erzeugt fortlaufend Meldungen. Der Speicherbedarf muss
  begrenzt bleiben; Meldungen ohne zugehörigen Lauf dürfen sich nicht unbegrenzt ansammeln.

## Requirements *(mandatory)*

### Functional Requirements

**Erfassung und Zuordnung**

- **FR-001**: Das System MUSS für jede von ihm gestartete Claude-Session die Verbrauchsmeldungen
  der CLI entgegennehmen, ohne dass der Nutzer dafür etwas konfigurieren muss.
- **FR-002**: Das System MUSS jede eingehende Verbrauchsmeldung eindeutig einer von ihm
  gestarteten Session zuordnen können, und zwar unabhängig davon, ob die Zuordnung zur
  CLI-Session zum Startzeitpunkt des Laufs bereits bekannt war.
- **FR-003**: Das System MUSS Verbrauchsmeldungen, die keiner von ihm gestarteten Session
  zugeordnet werden können, verwerfen und keinem Lauf zuschreiben.
- **FR-004**: Das System MUSS den Verbrauch einer Session demjenigen Lauf zuschreiben, der zum
  Zeitpunkt der Entstehung dieses Verbrauchs aktiv war.
- **FR-005**: Das System MUSS Verbrauch, der entsteht, während in einer Session kein Lauf aktiv
  ist, keinem Lauf zuschreiben.
- **FR-006**: Das System MUSS wiederholt eintreffende oder inhaltlich identische Meldungen
  erkennen und nur einmal zählen.
- **FR-007**: Das System MUSS Verbrauch, der nach einem Kontext-Reset innerhalb desselben Laufs
  entsteht, weiterhin diesem Lauf zuschreiben.

**Auswertung eines Laufs**

- **FR-008**: Das System MUSS den Verbrauch eines Laufs nach Input, Output, Cache-Read und
  Cache-Creation getrennt ausweisen, wie von der CLI gemeldet.
- **FR-009**: Das System MUSS den Verbrauch von Subagenten in den Gesamtverbrauch des
  auslösenden Laufs einrechnen.
- **FR-010**: Das System MUSS den Subagenten-Anteil eines Laufs getrennt vom Hauptagent-Anteil
  ausweisen.
- **FR-011**: Das System MUSS Meldungen, die nach dem Abschluss eines Laufs eintreffen und
  zeitlich zu ihm gehören, nachträglich in dessen Verbrauch einrechnen und die Ansicht
  aktualisieren.
- **FR-012**: Das System MUSS einen Lauf spätestens 5 Minuten nach seinem Abschluss als
  endgültig gemessen behandeln und danach eintreffende Meldungen für diesen Lauf verwerfen.
- **FR-013**: Das System MUSS das verwendete Modell je Lauf aus den Meldungen übernehmen.

**Quelle, Rückfallebene und Transparenz**

- **FR-014**: Das System MUSS die Telemetrie der CLI als vorrangige Quelle verwenden, wenn für
  einen Lauf Meldungen vorliegen.
- **FR-015**: Das System MUSS auf die bestehende Transkript-Messung zurückfallen, wenn für
  einen Lauf keine Meldungen vorliegen, und darf dabei kein bestehendes Verhalten verlieren.
- **FR-016**: Das System DARF die Werte beider Quellen für denselben Lauf NICHT addieren.
- **FR-017**: Das System MUSS je Lauf die Herkunft der Verbrauchszahl ausweisen und dabei die
  Telemetrie-Herkunft von den bestehenden Herkünften („gemessen" / „geparst" / „geschätzt")
  unterscheidbar machen.
- **FR-018**: Das System MUSS in der Lauf-Übersicht ausweisen, welcher Anteil der Läufe aus
  welcher Quelle stammt.
- **FR-019**: Das System MUSS den Nutzer erkennbar darauf hinweisen, wenn die
  Telemetrie-Erfassung nicht in Betrieb ist, und dabei den Grund nennen.
- **FR-020**: Das System MUSS Sessions auch dann normal starten und bedienbar halten, wenn die
  Telemetrie-Erfassung nicht verfügbar ist.

**Kosten**

- **FR-021**: Das System MUSS den von der CLI gemeldeten Geldbetrag je Lauf erfassen.
- **FR-022**: Das System DARF Geldbeträge NICHT aus einer eigenen Preistabelle errechnen.
- **FR-023**: Das System MUSS Läufe ohne gemeldeten Geldbetrag ohne Betrag darstellen, statt
  einen Ersatzwert zu bilden.
- **FR-024**: Das System MUSS bei Summen über mehrere Läufe ausweisen, wie viele der enthaltenen
  Läufe keinen gemeldeten Betrag beitragen.

**Bestand, Umfang und Datenschutz**

- **FR-025**: Das System MUSS bereits erfasste Läufe unverändert lassen; es rechnet keine
  historischen Läufe rückwirkend neu.
- **FR-026**: Das System MUSS die Erfassung auf alle von ihm gestarteten Claude-Sessions
  anwenden — Phasenläufe, Verifikations- und Review-Läufe, Konfliktlösung und Chat-Sessions.
- **FR-027**: Das System DARF weder Prompt-Inhalte noch Werkzeug-Ein-/Ausgaben noch
  Antworttexte über die Telemetrie erfassen; erfasst werden ausschliesslich Zähl- und
  Zuordnungsangaben.
- **FR-028**: Das System MUSS die Erfassung lokal auf dem Rechner des Nutzers halten; es
  übermittelt keine Nutzungsdaten an Dritte.
- **FR-029**: Das System DARF die im Toolkit sichtbare Terminalausgabe einer Session durch die
  Erfassung NICHT verändern.
- **FR-030**: Das System MUSS gespeicherte, keinem Lauf zugeordnete Meldungen begrenzen und
  regelmässig verwerfen, sodass der Speicherbedarf über lange Laufzeiten nicht wächst.

### Key Entities

- **Verbrauchsmeldung**: Eine von der CLI gemeldete Verbrauchsangabe. Trägt Zeitpunkt, Bezug
  zur CLI-Session, Modell, Art des Verbrauchs (Input, Output, Cache-Read, Cache-Creation),
  Menge und Herkunft (Hauptagent, Subagent, Hilfsanfrage).
- **Kostenmeldung**: Ein von der CLI gemeldeter Geldbetrag mit Zeitpunkt, Session-Bezug, Modell
  und Herkunft.
- **Session-Zuordnung**: Die Verbindung zwischen einer vom Toolkit gestarteten Session und den
  Meldungen, die aus ihr stammen. Grundlage der Zuordnung von Verbrauch zu Läufen.
- **Lauf (bestehend)**: Eine Ausführung mit Start- und Endzeit, Art, Status und Verbrauch.
  Erhält zusätzlich die Herkunft „von der CLI gemeldet", einen Subagenten-Anteil und einen
  gemeldeten Geldbetrag.
- **Messquelle (bestehend, erweitert)**: Herkunft der Verbrauchszahl eines Laufs — neu mit der
  Telemetrie als vorrangiger Stufe über den bestehenden Stufen.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein Lauf von zwei Minuten in einer fortgesetzten Session weist einen Verbrauch
  aus, der um weniger als 5 % von dem abweicht, was die CLI für denselben Zeitraum selbst
  nennt. Abweichungen um Grössenordnungen — wie die 62 Mio. Tokens vom Juli 2026 — treten nicht
  mehr auf.
- **SC-002**: Mindestens 95 % der Läufe, die in einer Session mit aktiver Telemetrie
  abgeschlossen werden, tragen die Herkunft „von der CLI gemeldet".
- **SC-003**: Bei Läufen, die Subagenten einsetzen, ist der ausgewiesene Verbrauch nachweislich
  höher als der reine Hauptagent-Anteil; der heute fehlende Subagenten-Anteil ist beziffert
  sichtbar.
- **SC-004**: Die Summe der Läufe einer Session weicht um weniger als 5 % vom Gesamtverbrauch
  ab, den die CLI für diese Session nennt — weder Doppelzählung noch Lücken.
- **SC-005**: Die Verbrauchszahl eines Laufs ist spätestens 5 Minuten nach seinem Abschluss
  endgültig und ändert sich danach nicht mehr.
- **SC-006**: Auch ohne Telemetrie erhalten 100 % der abgeschlossenen Läufe eine Verbrauchszahl
  — die Abdeckung fällt gegenüber heute nicht ab.
- **SC-007**: Der Start einer Session dauert durch die Erfassung nicht spürbar länger
  (zusätzlich unter einer Sekunde), und die sichtbare Terminalausgabe ist unverändert.
- **SC-008**: Kein in der Oberfläche ausgewiesener Geldbetrag stammt aus einer im Toolkit
  hinterlegten Preisannahme.
- **SC-009**: Der Nutzer kann ohne Rückfrage an einem Lauf ablesen, ob dessen Zahl von der CLI
  gemeldet oder vom Toolkit erschlossen wurde.

## Assumptions

- Die eingesetzte Claude-CLI unterstützt die Telemetrie-Meldung von Tokens und Kosten. Ältere
  Versionen ohne diese Unterstützung fallen ohne Fehlermeldung auf die bestehende
  Transkript-Messung zurück (FR-015).
- Die Erfassung läuft vollständig lokal: die CLI meldet an das Toolkit auf demselben Rechner,
  es wird kein externer Dienst angebunden.
- Inhaltsdaten bleiben abgeschaltet. Prompt-Texte, Antworttexte und Werkzeug-Inhalte werden
  ausdrücklich nicht erfasst, auch wenn die CLI das anbieten würde.
- Die vier Verbrauchsarten (Input, Output, Cache-Read, Cache-Creation) bleiben die
  Berichtseinheit; die bestehenden Ansichten behalten ihre Struktur.
- Ein Lauf entspricht weiterhin einer Ausführung im heutigen Sinn (Phase, Verifikation, Review,
  Konfliktlösung, Chat). Die Zuordnung von Verbrauch zu Läufen erfolgt über Start- und Endzeit
  des Laufs innerhalb seiner Session.
- Die Grenze von 5 Minuten für nachgereichte Meldungen (FR-012, SC-005) ist ein gewählter
  Vorgabewert, abgeleitet aus üblichen Meldeintervallen; sie ist nicht extern vorgegeben.
- Historische Läufe bleiben unverändert. Der Messanteil in der Übersicht verschiebt sich
  deshalb erst mit neuen Läufen zur neuen Quelle.
- Die Rückfallebene bleibt vollständig erhalten, inklusive des bestehenden Regressionstests zur
  Startmarke — sie wird nicht abgebaut, sondern nur nachrangig.
- Verteiltes Tracing (Spans je Werkzeugaufruf, Beta-Funktion der CLI) ist nicht Teil dieses
  Features. **Bestätigt (2026-07-27)**: bleibt ausserhalb des Umfangs. Für Tokens, Kosten und
  den Subagenten-Anteil liefern Spans nichts, was die ausgewerteten Ereignisse nicht schon
  tragen; sie hängen an einem Beta-Schalter und vervielfachen das Datenvolumen.
