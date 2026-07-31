# Feature Specification: Aktions-Buttons kontextabhängig — ein Standardweg in die Anwendung

**Feature Branch**: `feature/integrieren-button-entfernen`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "Wenn ein Feature in Entwicklung ist, steht der „Integrieren"-Button direkt zur Verfügung und kann gedrückt werden. Dieser macht in den meisten Schritten aber noch keinen Sinn. Prüfe die zur Verfügung stehenden Buttons und wann diese angezeigt werden. Zeige sie nur an, wenn dies auch logisch sinnvoll ist. Buttons die Aktionen auslösen, dürfen nicht gedrückt werden, wenn die Session bereits läuft. Integrationen dürfen erst möglich sein, wenn das Feature fertig ist. Auch sollten Integrationen und Review nicht in Konkurrenz stehen. Es soll nur einen Standard-Weg geben um Features in die Applikation zu bringen."

## Clarifications

### Session 2026-07-26

- Q: Was geschieht mit „✓ Als abgeschlossen markieren", das ein Feature heute unter Umgehung von Verifikation, Review und Merge direkt in den Endzustand „gemergt" setzt? → A: **Ersatzlos entfernen.** Einziger Abschluss ist die Integrations-Pipeline. Features, die außerhalb des Toolkits gebaut wurden, werden stattdessen gelöscht oder archiviert; „Archivieren" wird dafür auch außerhalb der Done-Spalte verfügbar.
- Q: Wann darf nach einer Zurückweisung im Review wieder integriert werden? → A: **Der letzte Schritt braucht eine neue Freigabe.** Die Zurückweisung setzt den letzten Schritt auf „wartet auf Freigabe" zurück; erst nach ausdrücklicher Freigabe der Korrektur gilt das Feature wieder als fertig. Das Vier-Augen-Prinzip bleibt damit auch bei Korrekturschleifen erhalten.
- Q: Welche Stufen der Integrations-Pipeline machen ein Feature „beschäftigt"? → A: **Nur aktiv verarbeitende Stufen** (Verifikation läuft, Agenten-Review-Gate läuft, Merge-Warteschlange, Merge läuft, automatische Konfliktauflösung läuft). „Wartet auf menschliches Review" und die Fehlerstufen (Verifikation fehlgeschlagen, Review-Gate fehlgeschlagen, Konflikt eskaliert) sind Entscheidungszustände: Sie sperren nicht, bieten aber ausschließlich die dort vorgesehene Aktion an.
- Q: Was geschieht mit der Integrationsstufe bei einer Zurückweisung im Review? → A: **Das Feature verlässt die Pipeline.** Die Integrationsstufe geht auf „nicht in Integration" zurück, die Karte wandert zurück in die Entwicklungs-Spalte, die Zurückweisung bleibt als Hinweis sichtbar. Nach erneuter Freigabe des letzten Schritts startet die Integration frisch von vorn (Verifikation → Gate → Review).
- Q: Wie wird ein fertiges Feature ohne Änderungen im Arbeitsverzeichnis behandelt? → A: **Vorprüfung sperrt.** Die Integrations-Aktion bleibt sichtbar, ist aber mit dem Grund „Keine Änderungen zu integrieren" gesperrt; ein Start über jeden Bedienweg wird abgelehnt, ohne dass die Pipeline anläuft. Zum Abräumen bleiben Archivieren und Löschen.
- Q: Wie wird der Sperrgrund dargestellt? → A: **Immer sichtbarer Kurztext.** Ein Satz steht dauerhaft bei der Aktionsgruppe und zusätzlich als zugängliche Beschriftung der gesperrten Schaltfläche — kein Hover nötig, auf Touch und mit Tastatur/Screenreader erreichbar.
- Q: Welche Zustände darf Drag & Drop auf dem Board noch ändern? → A: **Nur die Integrations-Spalte.** Der Zug dorthin bleibt erhalten und unterliegt exakt denselben Bedingungen wie die sichtbare Integrations-Aktion. Schritt-Spalten nehmen keine Karten mehr an; die heutige Sammel-Freigabe aller übersprungenen Schritte per Zug entfällt ersatzlos.

## User Scenarios & Testing *(mandatory)*

Ein Akteur trägt dieses Feature:

- **Der Bedienende** (Entwickler:in, die das Toolkit steuert) — startet Schritte, gibt sie frei, prüft im Review und bringt Features in die Anwendung. Er:sie soll an jeder Oberfläche nur die Aktionen sehen, die im aktuellen Zustand tatsächlich sinnvoll und erlaubt sind.

### Bestandsaufnahme: heutige Aktionen und ihre Sichtbarkeit

Die folgenden aktionsauslösenden Bedienelemente existieren heute. Die Spalte „Problem" benennt, warum die heutige Sichtbarkeit nicht zum Zustand passt.

| Oberfläche | Aktion | Heute sichtbar/auslösbar, wenn | Problem |
|------------|--------|--------------------------------|---------|
| Feature-Konsole, Schrittleiste | „⇥ Integrieren" | Feature ist noch nicht in der Integration — also ab dem allerersten Schritt | Kernproblem: auslösbar, obwohl das Feature noch nicht fertig ist; auch während ein Schritt läuft |
| Feature-Konsole, Schrittleiste | Schritt starten / freigeben | Kein Schritt läuft (Start zusätzlich: Session nicht beschäftigt) | Freigabe bleibt möglich, während die Session beschäftigt ist; ein laufendes Qualitäts-Gate sperrt nichts |
| Board-Karte | „▶ Start" | Schritt ist offen und Session nicht beschäftigt | Laufendes Qualitäts-Gate sperrt die Aktion nicht |
| Board-Karte | „✓ Approve" / „↺ Verwerfen" | Schritt wartet auf Freigabe | Weder laufende Session noch laufendes Gate sperren die Aktion |
| Board-Karte | „⇥ Integrieren" | Feature steht in der Integrations-Spalte (alle Schritte freigegeben) | Sichtbarkeit korrekt, aber nicht gegen laufende Arbeit gesperrt |
| Board, Drag & Drop | Karte auf „Integration" ziehen | Immer, aus jeder Spalte | Umgeht jede Bedingung — zweiter, ungeprüfter Weg in die Integration |
| Board, Drag & Drop | Karte auf eine Schritt-Spalte ziehen | Immer, aus jeder Spalte | Gibt alle übersprungenen wartenden Schritte auf einmal frei und startet die Zielphase — versteckter Freigabe-Weg am Vier-Augen-Prinzip vorbei; **entfällt** |
| Board-Karte, Zahnrad-Menü | „✓ Als abgeschlossen markieren" | Feature ist nicht gemergt — auch mitten im Review oder in der Merge-Warteschlange | Konkurrierender Weg in den Endzustand „abgeschlossen", ohne Verifikation, Review oder Merge — **entfällt** |
| Board-Karte | „🗄 Archivieren" | Nur in der Done-Spalte (Feature ist bereits gemergt) | Zu eng: nach Wegfall von „Als abgeschlossen markieren" der vorgesehene Weg, ein extern gebautes Feature abzuräumen |
| Board-Karte | „↻ Erneut" | Verifikation fehlgeschlagen oder Konflikt eskaliert | Fehlt beim Zustand „Review-Gate fehlgeschlagen" — dort bietet nur das Review-Portal die Aktion an |
| Review-Portal | „✓ Freigeben & Integrieren" / „✗ Zurückweisen" | Feature wartet auf menschliches Review | Korrekt |
| Review-Portal / Review-Übersicht | „↻ Integration erneut anstoßen" | Verifikation, Gate oder Konflikt fehlgeschlagen | Uneinheitlich zur Board-Karte |
| Review-Übersicht | Portal öffnen für „In Entwicklung" | Feature ist noch gar nicht in der Integration | Weckt den Eindruck eines zweiten Weges; das geöffnete Portal meldet dann nur „Keine Freigabe möglich" |
| Feature-Konsole, Kopfzeile | „Feature löschen" | Immer | Destruktiv, auch während ein Schritt läuft |

---

### User Story 1 - Integrieren erst, wenn das Feature fertig ist (Priority: P1)

Der Bedienende arbeitet ein Feature Schritt für Schritt ab. Solange noch ein Schritt offen ist, wird ihm gar nicht erst angeboten, das Feature zu integrieren. Erst wenn alle für das Projekt aktiven Schritte freigegeben sind, erscheint die Integrations-Aktion — an jeder Oberfläche gleichzeitig und mit derselben Bedeutung.

**Why this priority**: Das ist die ausdrücklich gemeldete Fehlbedienung. Ein Integrationsstart mitten in der Entwicklung schreibt unfertige Arbeit im Arbeitsverzeichnis als Commit fest und startet eine Verifikations-/Merge-Kette auf halbfertigem Stand — der teuerste Fehler, den die Oberfläche heute zulässt.

**Independent Test**: Ein neues Feature anlegen und in jedem Zwischenzustand (kein Schritt gestartet, erster Schritt wartet auf Freigabe, mittlerer Schritt freigegeben, letzter Schritt offen) prüfen, dass keine Oberfläche eine Integrations-Aktion anbietet. Anschließend alle Schritte freigeben und prüfen, dass die Aktion erscheint und funktioniert.

**Acceptance Scenarios**:

1. **Given** ein Feature, bei dem mindestens ein aktiver Schritt noch nicht freigegeben ist, **When** der Bedienende die Feature-Konsole öffnet, **Then** wird keine Integrations-Aktion angeboten.
2. **Given** dasselbe Feature, **When** der Bedienende die Board-Karte ansieht, **Then** wird auch dort keine Integrations-Aktion angeboten.
3. **Given** ein Feature, bei dem alle aktiven Schritte freigegeben sind, **When** der Bedienende Konsole oder Board öffnet, **Then** wird die Integrations-Aktion angeboten und startet bei Auslösung die Integration.
4. **Given** ein Projekt, in dem optionale Schritte abgeschaltet sind, **When** alle verbleibenden aktiven Schritte freigegeben sind, **Then** gilt das Feature als fertig und die Integrations-Aktion erscheint.
5. **Given** ein noch nicht fertiges Feature, **When** ein Integrationsstart auf anderem Weg als über die sichtbare Aktion angefordert wird (z. B. Karte auf die Integrations-Spalte gezogen), **Then** wird der Start abgelehnt und der Grund verständlich gemeldet — die Arbeit im Arbeitsverzeichnis bleibt unangetastet.

---

### User Story 2 - Keine Aktionen, während gearbeitet wird (Priority: P1)

Während für ein Feature gerade gearbeitet wird — ein Schritt läuft, die Session arbeitet oder wartet auf Eingabe, ein Qualitäts-Gate läuft oder die Integrations-Pipeline ist unterwegs — sind alle Bedienelemente gesperrt, die eine neue Aktion auslösen würden. Sie verschwinden nicht, sondern sind sichtbar gesperrt und nennen den Grund. Rein betrachtende Bedienelemente und der Prompt an die laufende Session bleiben verfügbar.

**Why this priority**: Gleichrangig mit US1. Ein zweiter Start in eine beschäftigte Session reiht Befehle unkontrolliert ein, eine Freigabe während eines laufenden Schritts kann einen Folgeschritt in eine belegte Session starten, und ein Integrationsstart während eines laufenden Schritts schreibt halbfertige Arbeit fest.

**Independent Test**: Für ein Feature einen Schritt starten und während der Laufzeit jede aktionsauslösende Schaltfläche in Konsole, Board, Review-Übersicht und Review-Portal ansteuern; keine darf auslösen, jede muss den Grund nennen. Nach Ende des Laufs müssen die im Zustand sinnvollen Aktionen wieder verfügbar sein.

**Acceptance Scenarios**:

1. **Given** ein Feature mit laufendem Schritt, **When** der Bedienende eine Start-, Freigabe-, Verwerfen- oder Integrations-Aktion auslösen will, **Then** ist diese gesperrt und der Grund („Es wird gerade gearbeitet") ist erkennbar.
2. **Given** ein Feature, dessen Session arbeitet oder auf Eingabe wartet (ohne dass ein Schritt als „läuft" markiert ist), **When** der Bedienende eine aktionsauslösende Schaltfläche ansteuert, **Then** ist sie ebenfalls gesperrt.
3. **Given** ein Feature, für das ein Qualitäts-Gate läuft, **When** der Bedienende Start, Freigabe oder Integration auslösen will, **Then** sind diese gesperrt.
4. **Given** ein Feature, dessen Integrations-Pipeline läuft (Verifikation, Review-Gate, Warteschlange, Merge, Konfliktauflösung), **When** der Bedienende eine erneute Integration oder eine Schritt-Aktion auslösen will, **Then** sind diese gesperrt.
5. **Given** ein Feature mit laufender Arbeit, **When** der Bedienende betrachtende Bedienelemente nutzt (Ergebnisse ansehen, Diff lesen, Pfad kopieren, im Editor öffnen) oder einen Prompt an die laufende Session sendet, **Then** funktionieren diese unverändert.
6. **Given** ein Feature mit laufender Arbeit, **When** der Bedienende eine destruktive Aktion auslöst (Löschen, Archivieren), **Then** weist die Rückfrage ausdrücklich darauf hin, dass die laufende Arbeit dabei abgebrochen wird.
7. **Given** eine gerade ausgelöste Aktion, **When** der Bedienende sie unmittelbar erneut auslöst, **Then** wird der zweite Auslöser wirkungslos verworfen und erzeugt keine Fehlermeldung.

---

### User Story 3 - Genau ein Standardweg in die Anwendung (Priority: P1)

Es gibt genau einen Weg, mit dem die Arbeit eines Features in der Anwendung landet: die Integrations-Pipeline. Sie führt vom fertigen Feature über Verifikation und optionales Agenten-Review-Gate zum menschlichen Review und von dort in die Merge-Warteschlange bis zum Merge. Das Review ist eine Stufe innerhalb dieses Weges, kein Nebenweg. Abkürzungen, die diesen Weg umgehen, existieren nicht mehr.

**Why this priority**: Ohne diese Bereinigung bleiben die Zustände widersprüchlich: heute kann ein Feature auf ein Review warten und parallel per Menüeintrag als abgeschlossen markiert werden, oder per Drag & Drop an allen Bedingungen vorbei in die Integration wandern. Beides erzeugt Features im Endzustand „abgeschlossen", deren Arbeit nie integriert wurde.

**Independent Test**: Für ein Feature alle Oberflächen durchgehen und zählen, wie viele auslösbare Wege in den Endzustand „abgeschlossen" führen — es darf genau einer sein. Ein Feature im Review-Wartezustand darf nicht auf anderem Weg abgeschlossen werden können.

**Acceptance Scenarios**:

1. **Given** ein fertiges Feature, **When** der Bedienende alle Oberflächen prüft, **Then** existiert genau eine auslösbare Aktion, die die Integration startet.
2. **Given** ein Feature, das auf menschliches Review wartet, **When** der Bedienende Board, Konsole und Review-Übersicht ansieht, **Then** wird überall dieselbe einzige nächste Aktion angeboten: das Review öffnen und dort entscheiden.
3. **Given** ein Feature in einem beliebigen Integrationszustand, **When** der Bedienende die Oberflächen prüft, **Then** gibt es keine Aktion, die das Feature unter Umgehung von Verifikation, Review und Merge in den Endzustand „abgeschlossen" versetzt.
4. **Given** ein Feature, das außerhalb des Toolkits gebaut wurde und nicht integriert werden soll, **When** der Bedienende es abräumen will, **Then** stehen ihm Archivieren und Löschen zur Verfügung — beide erkennbar als Aufräumen und nicht als Abschluss des Standardwegs.
5. **Given** ein Feature mit fehlgeschlagener Verifikation, fehlgeschlagenem Review-Gate oder eskaliertem Konflikt, **When** der Bedienende Board, Review-Übersicht und Review-Portal ansieht, **Then** wird an allen drei Stellen dieselbe Wiederaufnahme-Aktion angeboten.
6. **Given** ein Feature, das noch nicht in der Integration ist, **When** der Bedienende es aus der Review-Übersicht öffnet, **Then** ist erkennbar, dass es sich um eine reine Vorschau handelt, und es wird dort keine Integrations- oder Freigabe-Aktion angeboten.
7. **Given** ein im Review zurückgewiesenes Feature, **When** der Bedienende Board oder Konsole ansieht, **Then** steht der letzte Schritt wieder auf „wartet auf Freigabe" und es wird keine Integrations-Aktion angeboten.
8. **Given** ein zurückgewiesenes Feature mit beendeter Korrekturarbeit, **When** der Bedienende den letzten Schritt erneut freigibt, **Then** gilt das Feature wieder als fertig, die Integrations-Aktion erscheint erneut und startet die Integration von vorn.
9. **Given** ein Feature mit mehreren noch nicht freigegebenen Schritten, **When** der Bedienende die Karte auf eine spätere Schritt-Spalte zieht, **Then** wird der Zug nicht angenommen und es wird keine Freigabe erteilt und kein Schritt gestartet.

---

### User Story 4 - Erkennen, warum etwas nicht geht (Priority: P2)

Wenn eine Aktion im aktuellen Zustand nicht erlaubt ist, erkennt der Bedienende ohne Nachfragen, warum. Aktionen, die im aktuellen Zustand grundsätzlich sinnlos sind, werden gar nicht angezeigt. Aktionen, die grundsätzlich richtig, aber gerade blockiert sind, bleiben sichtbar und gesperrt und nennen den Grund.

**Why this priority**: Ergänzt US1–US3. Ohne diese Unterscheidung wirkt das Ausblenden willkürlich und der Bedienende sucht nach verschwundenen Schaltflächen.

**Independent Test**: Ein Feature durch alle Zustände führen und an jeder Stelle prüfen, dass jede gesperrte Schaltfläche einen Grund nennt und keine Schaltfläche ohne erkennbaren Grund fehlt.

**Acceptance Scenarios**:

1. **Given** ein Feature in einem Zustand, in dem eine Aktion grundsätzlich sinnlos ist, **When** der Bedienende die Oberfläche ansieht, **Then** wird die Aktion nicht angezeigt.
2. **Given** ein Feature, bei dem eine grundsätzlich sinnvolle Aktion gerade blockiert ist, **When** der Bedienende sie ansteuert, **Then** ist sie sichtbar gesperrt und nennt den Grund in einem Satz.
3. **Given** ein Feature, dessen Zustand sich ändert (Lauf endet, Freigabe erfolgt, Integrationsstufe wechselt), **When** der Bedienende die geöffnete Oberfläche betrachtet, **Then** aktualisieren sich Sichtbarkeit und Sperrung ohne Neuladen.
4. **Given** dasselbe Feature gleichzeitig in Board, Konsole und Review-Übersicht geöffnet, **When** der Bedienende die Ansichten vergleicht, **Then** zeigen alle dieselbe Menge erlaubter Aktionen.

---

### Edge Cases

- **Zurückgewiesenes Review**: Der letzte Schritt steht wieder auf „wartet auf Freigabe", das Feature ist nicht mehr in der Integration, und die Session arbeitet an der Korrektur. Weder Integration noch Freigabe dürfen in diesem Moment auslösbar sein.
- **Zurückweisung ohne Kommentar**: Wird ohne Kommentar und ohne Freitext zurückgewiesen, startet keine Korrektursession. Der letzte Schritt steht trotzdem auf „wartet auf Freigabe" und ist sofort erneut freigebbar.
- **Fertiges Feature ohne Änderungen**: Alle Schritte freigegeben, aber das Arbeitsverzeichnis enthält keine Änderungen gegenüber dem Zielstand. Die Integrations-Aktion bleibt sichtbar und ist mit dem Grund „Keine Änderungen zu integrieren" gesperrt; es startet keine leere Merge-Kette. Zum Abräumen stehen Archivieren und Löschen bereit.
- **Veraltete Freigabe (stale)**: Ein Schritt ist als veraltet markiert, weil ein vorgelagerter Schritt nach der Freigabe geändert wurde. Er gilt weiterhin als freigegeben, das Feature damit als fertig; die Veralterung erscheint als Hinweis im Review (siehe Annahmen).
- **Kein Arbeitsverzeichnis**: Das Arbeitsverzeichnis wurde entfernt oder ist defekt. Aktionen, die es voraussetzen, dürfen nicht angeboten werden.
- **Abgeschlossenes oder archiviertes Feature**: Es darf keine Aktion mehr angeboten werden, die den Zustand erneut verändert.
- **Automatischer Integrationsstart**: Läuft die Integration automatisch an, sobald der letzte Schritt freigegeben ist, darf die manuelle Integrations-Aktion in diesem Moment nicht zusätzlich auslösbar sein.
- **Zustandswechsel während geöffneter Oberfläche**: Ein Feature wechselt in einen Zustand, in dem die gerade sichtbare Aktion nicht mehr gültig ist. Ein Klick auf die veraltete Schaltfläche darf keine Wirkung entfalten.
- **Mehrere Features gleichzeitig**: Sperrungen gelten je Feature; ein laufender Schritt in Feature A darf Aktionen in Feature B nicht blockieren.

## Requirements *(mandatory)*

### Functional Requirements

#### Fertigstellung als Bedingung für Integration

- **FR-001**: Das System MUSS ein Feature genau dann als „fertig" behandeln, wenn alle im Projekt aktiven Schritte dieses Features freigegeben sind.
- **FR-002**: Das System MUSS Integrations-Aktionen ausschließlich bei fertigen Features anbieten; bei nicht fertigen Features werden sie nicht angezeigt.
- **FR-003**: Das System MUSS einen Integrationsstart für ein nicht fertiges Feature ablehnen, unabhängig davon, über welchen Bedienweg er ausgelöst wurde, und den Grund verständlich melden.
- **FR-004**: Das System MUSS bei einem abgelehnten Integrationsstart den Zustand des Features und dessen Arbeitsverzeichnis unverändert lassen — insbesondere darf keine Arbeit festgeschrieben werden.
- **FR-027**: Das System MUSS vor jedem Integrationsstart prüfen, ob das Arbeitsverzeichnis Änderungen gegenüber dem Zielstand enthält. Enthält es keine, bleibt die Integrations-Aktion sichtbar, ist mit dem Grund „Keine Änderungen zu integrieren" gesperrt, und ein Start über jeden Bedienweg wird abgelehnt, ohne dass die Integrations-Pipeline anläuft.

#### Sperren während laufender Arbeit

- **FR-005**: Das System MUSS ein Feature als „beschäftigt" behandeln, solange mindestens eines zutrifft: ein Schritt läuft, die Session arbeitet oder wartet auf Eingabe, ein Qualitäts-Gate läuft, oder die Integrations-Pipeline befindet sich in einer aktiv verarbeitenden Stufe (Verifikation läuft, Agenten-Review-Gate läuft, Merge-Warteschlange, Merge läuft, automatische Konfliktauflösung läuft).
- **FR-025**: Das System MUSS die Integrationsstufen „wartet auf menschliches Review", „Verifikation fehlgeschlagen", „Review-Gate fehlgeschlagen" und „Konflikt eskaliert" als Entscheidungszustände behandeln: Sie machen das Feature nicht „beschäftigt", bieten aber ausschließlich die dort vorgesehene Aktion an (im Review entscheiden bzw. Wiederaufnahme); alle übrigen aktionsauslösenden Bedienelemente bleiben gesperrt.
- **FR-006**: Das System MUSS bei einem beschäftigten Feature alle aktionsauslösenden Bedienelemente sperren: Schritt starten, Schritt freigeben, Schritt verwerfen, Integration starten, Integration erneut anstoßen, im Review freigeben, im Review zurückweisen.
- **FR-007**: Das System MUSS betrachtende Bedienelemente (Ergebnisse und Artefakte ansehen, Diff und Historie lesen, Dateien öffnen, Pfad kopieren, Kommentare erfassen) sowie den Prompt an die laufende Session auch bei beschäftigtem Feature verfügbar halten.
- **FR-008**: Das System MUSS destruktive Aktionen (Löschen, Archivieren) bei beschäftigtem Feature nur nach einer Rückfrage ausführen, die ausdrücklich auf den Abbruch der laufenden Arbeit hinweist.
- **FR-009**: Das System MUSS gesperrte Aktionen sichtbar lassen und den Sperrgrund nennen, statt sie auszublenden.
- **FR-028**: Das System MUSS den Sperrgrund ohne Hover oder zusätzliche Bedienung anzeigen: als dauerhaft sichtbaren Satz bei der betroffenen Aktionsgruppe und zusätzlich als zugängliche Beschriftung der gesperrten Schaltfläche, sodass er auch per Tastatur, Screenreader und auf Touch-Geräten erkennbar ist.
- **FR-010**: Das System MUSS mehrfaches Auslösen derselben Aktion wirkungslos verwerfen, ohne dem Bedienenden einen Fehler zu melden.
- **FR-011**: Das System MUSS Sperrungen je Feature auswerten; laufende Arbeit an einem Feature darf Aktionen an anderen Features nicht beeinflussen.

#### Ein Standardweg

- **FR-012**: Das System MUSS genau einen Weg anbieten, mit dem die Arbeit eines Features in die Anwendung gelangt: fertiges Feature → Verifikation → optionales Agenten-Review-Gate → menschliches Review → Merge-Warteschlange → gemergt.
- **FR-013**: Das System MUSS das menschliche Review als Stufe dieses Weges führen; es darf keine Bedienung geben, die Review und Integration als zwei alternative Wege darstellt oder gleichzeitig anbietet.
- **FR-014**: Das System MUSS für ein Feature in jedem Zustand an allen Oberflächen dieselbe Menge erlaubter Aktionen anbieten — insbesondere dieselbe einzige nächste Aktion.
- **FR-015**: Das System MUSS für die Zustände „Verifikation fehlgeschlagen", „Review-Gate fehlgeschlagen" und „Konflikt eskaliert" an allen Oberflächen dieselbe Wiederaufnahme-Aktion anbieten.
- **FR-016**: Das System MUSS die Aktion „Als abgeschlossen markieren" entfernen; der Endzustand „abgeschlossen" ist ausschließlich über den Standardweg erreichbar.
- **FR-017**: Das System MUSS „Archivieren" für jedes nicht mehr benötigte Feature anbieten — auch für solche, die nie integriert wurden — und dabei erkennbar machen, dass Archivieren ein Aufräumen und kein Abschluss des Standardwegs ist.
- **FR-018**: Das System MUSS beim Ziehen einer Feature-Karte auf die Integrations-Spalte dieselben Bedingungen anwenden wie bei der sichtbaren Integrations-Aktion und einen unzulässigen Zug ablehnen.
- **FR-029**: Das System DARF Schritt-Spalten des Boards nicht mehr als Ziel eines Kartenzugs annehmen; die heutige Sammel-Freigabe aller übersprungenen Schritte samt Start der Zielphase entfällt. Freigaben erfolgen ausschließlich einzeln über die sichtbaren Aktionen.
- **FR-019**: Das System MUSS in der Review-Übersicht bei Features, die noch nicht in der Integration sind, erkennbar machen, dass es sich um eine reine Vorschau ohne Entscheidungsmöglichkeit handelt.
- **FR-020**: Das System MUSS bei einer Zurückweisung im Review den letzten Schritt des Features auf „wartet auf Freigabe" zurücksetzen, sodass das Feature erst nach ausdrücklicher erneuter Freigabe wieder als fertig gilt.
- **FR-026**: Das System MUSS bei einer Zurückweisung im Review die Integrationsstufe des Features auf „nicht in Integration" zurücksetzen — die Karte kehrt in die Entwicklungs-Spalte zurück, die Zurückweisung bleibt als Hinweis sichtbar, und eine erneute Freigabe startet die Integration vollständig neu (Verifikation → optionales Agenten-Review-Gate → menschliches Review).
- **FR-021**: Das System MUSS sicherstellen, dass ein zurückgesetzter letzter Schritt keine automatische Folgeaktion auslöst — insbesondere keinen automatischen Integrationsstart, bevor der Bedienende freigegeben hat.

#### Konsistenz und Nachvollziehbarkeit

- **FR-022**: Das System MUSS die Regeln für Sichtbarkeit und Sperrung aus einer einzigen, gemeinsam genutzten Festlegung ableiten, sodass alle Oberflächen zwangsläufig dasselbe Ergebnis zeigen.
- **FR-023**: Das System MUSS Sichtbarkeit und Sperrung bei Zustandsänderungen ohne Neuladen der Oberfläche aktualisieren.
- **FR-024**: Das System MUSS jede aktionsauslösende Anfrage auch serverseitig gegen dieselben Bedingungen prüfen und unzulässige Anfragen mit verständlicher Begründung ablehnen.

### Key Entities

- **Feature-Zustand**: Die Gesamtheit aus Schritt-Zuständen (offen, läuft, wartet auf Freigabe, freigegeben, veraltet), Integrationsstufe (nicht in Integration bis gemergt), Session-Zustand (beendet, untätig, arbeitet, wartet auf Eingabe) und laufenden Qualitäts-Gates. Einzige Grundlage für jede Entscheidung über Sichtbarkeit und Sperrung.
- **Aktion**: Ein auslösbarer Vorgang an einem Feature (Schritt starten, freigeben, verwerfen, integrieren, Integration wiederholen, im Review freigeben, zurückweisen, löschen, archivieren) mit den Eigenschaften „im Zustand sinnvoll" und „im Zustand erlaubt".
- **Aktionsbefund**: Das Ergebnis der Prüfung einer Aktion gegen einen Feature-Zustand: angeboten, gesperrt (mit Grund) oder nicht angezeigt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In allen Zwischenzuständen eines Features vor dessen Fertigstellung ist an keiner Oberfläche eine Integrations-Aktion auslösbar — 0 Angebote über alle Schritte hinweg.
- **SC-002**: 100 % der aktionsauslösenden Bedienelemente sind gesperrt, solange für das Feature gearbeitet wird.
- **SC-003**: Genau 1 Bedienweg führt ein Feature in den Endzustand „abgeschlossen"; 0 Bedienelemente setzen diesen Zustand unter Umgehung von Verifikation, Review und Merge.
- **SC-004**: Für dasselbe Feature zeigen Board, Feature-Konsole und Review-Übersicht in 100 % der geprüften Zustände dieselbe Menge erlaubter Aktionen.
- **SC-005**: 0 Fälle, in denen ein Integrationsstart die Arbeit eines noch laufenden Schritts festschreibt.
- **SC-006**: Zu 100 % der gesperrten Aktionen nennt die Oberfläche einen Grund, der ohne Hover, ohne Klick und ohne weitere Navigation sichtbar ist.
- **SC-007**: Ein neuer Bedienender findet die jeweils nächste sinnvolle Aktion für ein Feature in unter 10 Sekunden, ohne zwischen Oberflächen wechseln zu müssen.
- **SC-008**: Nach einer Zurückweisung im Review ist in 100 % der Fälle eine erneute Freigabe des letzten Schritts nötig, bevor wieder integriert werden kann.

## Assumptions

- **„Fertig" heißt: alle aktiven Schritte freigegeben.** Optionale, im Projekt abgeschaltete Schritte zählen nicht mit. Das entspricht der Regel, nach der ein Feature heute in die Integrations-Spalte des Boards rückt.
- **Die bestehende Integrations-Pipeline bleibt der Standardweg.** Ihre Stufen und Reihenfolge werden nicht verändert; dieses Feature regelt nur, wann sie betreten werden darf und welche Bedienelemente das anbieten.
- **Der Automatikgrad bleibt eine Einstellung, kein zweiter Weg.** Läuft die Integration automatisch an oder wird das menschliche Review per Einstellung übersprungen, ist das derselbe Standardweg mit automatisierten Stufen — nicht eine konkurrierende Route. Die Einstellungen selbst bleiben unverändert.
- **Gesperrt statt ausgeblendet bei vorübergehenden Hindernissen.** Aktionen, die im Zustand grundsätzlich richtig, aber gerade blockiert sind, bleiben sichtbar; nur grundsätzlich sinnlose Aktionen verschwinden. So bleibt die Oberfläche stabil und erklärt sich selbst.
- **Ein als veraltet markierter Schritt gilt weiterhin als freigegeben.** Er verhindert die Integration nicht, wird aber im Review als Hinweis sichtbar. Andernfalls würde jede nachträgliche Spec-Korrektur die Integration dauerhaft blockieren.
- **Prompt-Eingabe an die laufende Session bleibt erlaubt.** Sie ist der vorgesehene Weg, mit einer beschäftigten Session zu sprechen, und startet keine neue Aktion.
- **Bestehende Features bleiben gültig.** Features, die sich beim Einführen der Regeln bereits in einem Integrationszustand befinden, behalten diesen; die neuen Bedingungen greifen ab dem nächsten Zustandswechsel. Features, die früher per „Als abgeschlossen markieren" auf „gemergt" gesetzt wurden, bleiben unverändert abgeschlossen.
- **Archivieren ersetzt „Als abgeschlossen markieren" nicht inhaltlich.** Ein archiviertes Feature gilt als aufgeräumt, nicht als integriert; die Unterscheidung bleibt in der Anzeige erkennbar.
- **Keine neuen Oberflächen.** Board, Feature-Konsole, Review-Übersicht und Review-Portal bleiben die bestehenden Einstiegspunkte; verändert werden nur Sichtbarkeit, Sperrung und Begründung ihrer Aktionen.
