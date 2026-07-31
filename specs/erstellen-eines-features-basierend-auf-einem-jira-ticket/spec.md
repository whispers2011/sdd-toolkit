# Feature Specification: Features aus Jira-Tickets erstellen

**Feature Branch**: `feature/erstellen-eines-features-basierend-auf-einem-jira-ticket`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "ich möchte für neue Features direkt jira tickets angeben können. Hierzu möchte ich in den benutzereinstellungen den jira mcp verbinden und authorisieren können. Damit sollen anschliessend die projekte und stories des ausgewählten jira spaces und projekts angezeigt werden können. ich möchte vom ausgewählten projekt die sprints auswählen und sehen können und ein (oder mehrere tickets) als neue features dem sdd toolkit hinzufügen können. Beim einlesen des tickets sollen kommentare, anhänge, etc. berücksichtigt und gezogen werden können."

## Clarifications

### Session 2026-07-23

- Q: Wie sollen die dauerhaft gespeicherten Jira-Zugangsdaten (Autorisierung/Token) geschützt werden? → A: Keine eigene Token-Speicherung im Toolkit — die Anbindung erfolgt über den offiziellen Atlassian MCP (Rovo MCP); dessen OAuth-Browser-Flow und Token-Verwaltung werden genutzt. Die Verbindung wird auf Nutzerebene konfiguriert und steht damit in jedem Toolkit-Projekt korrekt zur Verfügung.
- Q: Welche Ticketinhalte müssen über Titel, Beschreibung, Kommentare und Anhänge hinaus verbindlich übernommen werden? → A: Alle ausgefüllten Felder — sämtliche Standard- und Custom-Felder mit Inhalt; leere Felder werden ausgelassen.
- Q: Ab welcher Größe wird ein Anhang nicht mehr übernommen, sondern nur als Verweis vermerkt? → A: Keine Grenze — alle zugänglichen Anhänge werden unabhängig von der Größe übernommen; nur nicht abrufbare Anhänge werden als Verweis vermerkt.
- Q: Wie sollen Sprints angezeigt werden, wenn ein Jira-Projekt mehrere Boards hat? → A: Aktive und zukünftige Sprints aller Boards des Projekts erscheinen in einer zusammengeführten Liste (Duplikate zusammengefasst); kein zusätzlicher Board-Auswahlschritt.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Jira-Verbindung einrichten und autorisieren (Priority: P1)

Als Nutzer des SDD Toolkits möchte ich in den Benutzereinstellungen meine Jira-Instanz verbinden und autorisieren, damit das Toolkit in meinem Namen auf meine Jira-Projekte, Sprints und Tickets zugreifen kann. Ich sehe jederzeit, ob und als wer ich verbunden bin, und kann die Verbindung wieder trennen.

**Why this priority**: Ohne autorisierte Verbindung kann keine einzige Jira-Information angezeigt oder übernommen werden — alle weiteren Stories setzen darauf auf. Die Verbindung ist zudem eigenständig prüfbar und liefert bereits sichtbaren Wert (Verbindungsstatus, Kontoanzeige).

**Independent Test**: In den Benutzereinstellungen die Jira-Anbindung starten, die Freigabe beim Anbieter erteilen und prüfen, dass der Bereich anschließend „verbunden" mit Konto- und Instanzangabe zeigt. Toolkit neu starten und prüfen, dass die Verbindung ohne erneute Anmeldung bestehen bleibt. Verbindung trennen und prüfen, dass der unverbundene Zustand wiederhergestellt ist.

**Acceptance Scenarios**:

1. **Given** geöffnete Benutzereinstellungen ohne bestehende Jira-Verbindung, **When** der Nutzer die Jira-Anbindung startet, **Then** wird er durch den Freigabeprozess des Anbieters geführt und nach erfolgreicher Freigabe als verbunden angezeigt — inklusive verbundenem Konto und Jira-Instanz.
2. **Given** eine bestehende Jira-Verbindung, **When** der Nutzer das Toolkit neu startet und die Einstellungen öffnet, **Then** ist die Verbindung ohne erneute Anmeldung weiterhin aktiv.
3. **Given** eine bestehende Jira-Verbindung, **When** der Nutzer die Verbindung trennt, **Then** werden die gespeicherten Zugangsdaten entfernt und der Bereich zeigt wieder den unverbundenen Ausgangszustand.
4. **Given** eine abgelaufene oder ungültig gewordene Autorisierung, **When** der Nutzer Jira-Daten abruft, **Then** erhält er einen verständlichen Hinweis und kann die Autorisierung direkt aus den Einstellungen heraus erneuern.

---

### User Story 2 - Projekte, Sprints und Tickets durchsuchen (Priority: P2)

Als Nutzer möchte ich nach erfolgter Verbindung meinen Jira-Bereich und darin ein Projekt auswählen, dessen Sprints sehen und auswählen können und die Stories/Tickets des gewählten Sprints angezeigt bekommen — um mir einen Überblick zu verschaffen und Kandidaten für neue Features zu finden.

**Why this priority**: Die Ticket-Übersicht ist die Voraussetzung für jede Auswahl. Sie liefert bereits eigenständigen Wert (Jira-Sicht im Toolkit), auch bevor die Übernahme existiert.

**Independent Test**: Mit verbundener Jira-Instanz Bereich und Projekt wählen, die Sprintliste des Projekts anzeigen, einen Sprint wählen und prüfen, dass die zugehörigen Tickets mit Schlüssel, Titel, Typ und Status erscheinen.

**Acceptance Scenarios**:

1. **Given** eine verbundene Jira-Instanz mit mehreren zugänglichen Projekten, **When** der Nutzer die Jira-Auswahl öffnet, **Then** sieht er die für ihn sichtbaren Projekte des gewählten Bereichs und kann eines auswählen.
2. **Given** ein gewähltes Projekt mit Sprints, **When** der Nutzer die Sprintauswahl öffnet, **Then** werden die Sprints des Projekts angezeigt (mindestens aktive und zukünftige) und einer kann gewählt werden.
3. **Given** ein gewählter Sprint, **When** die Ticketliste geladen ist, **Then** erscheinen dessen Stories/Tickets mit Schlüssel, Titel, Typ und Status.
4. **Given** ein Projekt ohne Sprints, **When** der Nutzer es auswählt, **Then** kann er die Tickets des Projekts dennoch einsehen (z. B. über eine Projekt-/Backlog-Sicht).
5. **Given** eine frühere Auswahl von Bereich, Projekt und Sprint, **When** der Nutzer die Jira-Ansicht erneut öffnet, **Then** ist die letzte Auswahl vorbelegt.
6. **Given** ein gewählter Sprint ohne Tickets, **When** die Liste geladen ist, **Then** wird ein verständlicher Leer-Hinweis statt eines Fehlers angezeigt.

---

### User Story 3 - Tickets als neue Features übernehmen (Priority: P3)

Als Nutzer möchte ich aus der angezeigten Ticketliste ein oder mehrere Tickets auswählen und sie als neue Features dem SDD Toolkit hinzufügen. Pro Ticket entsteht ein Feature mit Titel und Beschreibung aus dem Ticket sowie einer sichtbaren Referenz auf das Ursprungsticket.

**Why this priority**: Das ist der eigentliche Zweck des Features — der Weg vom Jira-Ticket zum Toolkit-Feature. Er benötigt jedoch Verbindung (P1) und Übersicht (P2) als Grundlage.

**Independent Test**: Aus einer angezeigten Ticketliste zwei Tickets auswählen und übernehmen; anschließend existieren zwei neue Features im Projekt, jeweils mit Ticket-Titel, Ticket-Beschreibung und sichtbarer Ticket-Referenz.

**Acceptance Scenarios**:

1. **Given** eine angezeigte Ticketliste, **When** der Nutzer ein Ticket auswählt und übernimmt, **Then** entsteht ein neues Feature mit Titel und Beschreibung des Tickets und dem Ticketschlüssel samt Link als sichtbarer Referenz.
2. **Given** eine Mehrfachauswahl mehrerer Tickets, **When** der Nutzer sie in einem Vorgang übernimmt, **Then** entsteht pro Ticket genau ein Feature.
3. **Given** ein bereits früher übernommenes Ticket, **When** es in der Liste erscheint, **Then** ist es als bereits übernommen gekennzeichnet, und eine erneute Übernahme erfordert eine ausdrückliche Bestätigung.
4. **Given** eine Mehrfachübernahme, bei der die Übernahme eines Tickets fehlschlägt, **When** der Vorgang abgeschlossen ist, **Then** sind die übrigen Features angelegt und das Ergebnis wird pro Ticket verständlich ausgewiesen.
5. **Given** ein aus Jira übernommenes Feature, **When** es angelegt ist, **Then** verhält es sich wie ein manuell angelegtes Feature und durchläuft denselben Arbeitsablauf, wobei der Ticketinhalt als Ausgangsbeschreibung dient.

---

### User Story 4 - Ticketkontext vollständig einlesen (Priority: P4)

Als Nutzer möchte ich, dass beim Einlesen eines Tickets nicht nur Titel und Beschreibung, sondern auch Kommentare, Anhänge und sämtliche ausgefüllten Felder (Standard- wie Custom-Felder, z. B. Akzeptanzkriterien, Labels, verknüpfte Tickets) übernommen werden — damit die spätere Spezifikation auf dem vollständigen Ticketkontext aufsetzt und kein Wissen aus Diskussionen verloren geht.

**Why this priority**: Erhöht die Qualität der Übernahme deutlich, ist aber erst nach der Grundübernahme (P3) sinnvoll. Ein Feature mit nur Titel und Beschreibung ist bereits nutzbar.

**Independent Test**: Ein Ticket mit mehreren Kommentaren und Anhängen übernehmen; das entstandene Feature enthält alle Kommentare in lesbarer Form (mit Autor und Zeitpunkt) sowie alle zugänglichen Anhänge bzw. Verweise darauf.

**Acceptance Scenarios**:

1. **Given** ein Ticket mit Kommentaren, **When** es übernommen wird, **Then** sind sämtliche Kommentare mit Autor und Zeitpunkt in lesbarer Form Teil des Ausgangsmaterials des Features.
2. **Given** ein Ticket mit Anhängen, **When** es übernommen wird, **Then** werden zugängliche Anhänge dem Arbeitsmaterial des Features hinzugefügt; nicht abrufbare Anhänge werden mit Name und Verweis vermerkt.
3. **Given** Ticketinhalte mit Jira-spezifischer Formatierung und Erwähnungen, **When** sie übernommen werden, **Then** liegen sie in gut lesbarer Form vor, ohne rohe Markup-Reste, die den Inhalt unverständlich machen.

---

### Edge Cases

- Die Autorisierung läuft mitten in einer Sitzung ab: Die nächste Jira-Aktion zeigt einen verständlichen Hinweis mit direkter Möglichkeit zur Re-Autorisierung; die aktuelle Ansicht geht dabei nicht verloren.
- Jira ist nicht erreichbar (Netzwerk- oder Dienststörung): Es erscheint eine verständliche Fehlermeldung mit Wiederholungsmöglichkeit; der Rest des Toolkits bleibt uneingeschränkt nutzbar.
- Der Nutzer hat auf einzelne Projekte oder Tickets keine Berechtigung: Nicht sichtbare Inhalte erscheinen schlicht nicht; Berechtigungsfehler bei direktem Zugriff werden klar ausgewiesen.
- Nicht abrufbare Anhänge: Statt der Übernahme wird ein Verweis mit Name und Herkunft vermerkt; die Dateigröße allein ist kein Ausschlusskriterium.
- Das Ticket wird nach der Übernahme in Jira weiterbearbeitet: Die Übernahme ist ein Schnappschuss; über die Ticket-Referenz ist ein manueller Abgleich jederzeit möglich.
- Namenskollision: Zwei Tickets mit gleichem Titel oder ein bestehendes Feature mit gleichem Namen — Feature-Namen werden automatisch eindeutig gemacht (z. B. durch den Ticketschlüssel).
- Die Verbindung wird getrennt, während die Jira-Ansicht geöffnet ist: Die Ansicht fällt in den unverbundenen Zustand zurück; bereits übernommene Features bleiben vollständig erhalten.
- Wechsel von Projekt oder Sprint, während bereits Tickets ausgewählt sind: Die getroffene Auswahl wird beim Kontextwechsel verständlich zurückgesetzt oder bleibt nachvollziehbar erhalten — es entstehen keine versehentlichen Übernahmen aus dem falschen Kontext.

## Requirements *(mandatory)*

### Functional Requirements

**Verbindung & Autorisierung**

- **FR-001**: Die Benutzereinstellungen MÜSSEN einen Bereich zur Jira-Anbindung bieten, in dem der Nutzer die Verbindung herstellen, autorisieren, den Verbindungsstatus einsehen und die Verbindung trennen kann.
- **FR-002**: Die Autorisierung MUSS über den offiziellen Atlassian MCP (Rovo MCP) und dessen Browser-Freigabeprozess (OAuth) erfolgen; das Toolkit speichert weder Jira-Passwörter noch eigene Zugangs-Token — Speicherung und Erneuerung der Token liegen bei der MCP-Verbindung.
- **FR-003**: Eine erteilte Autorisierung MUSS Neustarts des Toolkits überdauern; die MCP-Verbindung wird auf Nutzerebene eingerichtet und steht damit in jedem Toolkit-Projekt zur Verfügung. Der Einstellungsbereich zeigt das verbundene Konto und die verbundene Jira-Instanz an.
- **FR-004**: Eine ungültige oder abgelaufene Autorisierung MUSS erkannt, verständlich gemeldet und direkt aus den Einstellungen heraus erneuerbar sein.
- **FR-005**: Das Trennen der Verbindung MUSS die gespeicherten Zugangsdaten entfernen; bereits übernommene Features bleiben davon unberührt.

**Anzeige von Projekten, Sprints und Tickets**

- **FR-006**: Nach erfolgter Verbindung MUSS der Nutzer den Jira-Bereich (bei mehreren verfügbaren) und anschließend ein Projekt aus den für ihn sichtbaren Projekten auswählen können.
- **FR-007**: Für das gewählte Projekt MÜSSEN die Sprints angezeigt und auswählbar sein — mindestens aktive und zukünftige Sprints; hat das Projekt mehrere Boards, werden die Sprints aller Boards zusammengeführt angezeigt (Duplikate zusammengefasst), ohne zusätzlichen Board-Auswahlschritt.
- **FR-008**: Für den gewählten Sprint MÜSSEN die zugehörigen Stories/Tickets mit Schlüssel, Titel, Typ und Status angezeigt werden; bei Projekten ohne Sprints MUSS eine Ticketliste auf Projektebene verfügbar sein.
- **FR-009**: Die zuletzt getroffene Auswahl von Bereich, Projekt und Sprint MUSS gemerkt und beim nächsten Öffnen der Jira-Ansicht vorbelegt werden.
- **FR-010**: Bereits übernommene Tickets MÜSSEN in der Ticketliste als solche gekennzeichnet sein.

**Übernahme als Feature**

- **FR-011**: Der Nutzer MUSS ein oder mehrere Tickets auswählen und in einem Vorgang als neue Features hinzufügen können; pro Ticket entsteht genau ein Feature.
- **FR-012**: Ein übernommenes Feature MUSS Titel und Beschreibung aus dem Ticket erhalten und eine dauerhafte, sichtbare Referenz auf das Ursprungsticket (Ticketschlüssel und Link) tragen.
- **FR-013**: Feature-Namen MÜSSEN eindeutig sein; bei Kollisionen wird der Name automatisch eindeutig gemacht (z. B. durch Ergänzung des Ticketschlüssels).
- **FR-014**: Die erneute Übernahme eines bereits importierten Tickets DARF NUR nach ausdrücklicher Bestätigung des Nutzers erfolgen und erzeugt dann ein weiteres, unabhängiges Feature.
- **FR-015**: Bei der Mehrfachübernahme DÜRFEN Fehler einzelner Tickets die Übernahme der übrigen NICHT abbrechen; das Ergebnis MUSS pro Ticket verständlich ausgewiesen werden.
- **FR-016**: Aus Jira übernommene Features MÜSSEN sich nach der Anlage wie manuell angelegte Features verhalten und denselben Arbeitsablauf durchlaufen.

**Einlesen des Ticketinhalts**

- **FR-017**: Beim Einlesen eines Tickets MÜSSEN neben Titel und Beschreibung auch die Kommentare (mit Autor und Zeitpunkt) sowie sämtliche ausgefüllten Felder des Tickets (Standard- wie Custom-Felder, u. a. Akzeptanzkriterien, Labels, verknüpfte Tickets, Priorität, Typ, Status) übernommen und dem Feature als Ausgangsmaterial bereitgestellt werden; leere Felder werden ausgelassen.
- **FR-018**: Zugängliche Anhänge MÜSSEN unabhängig von ihrer Größe dem Arbeitsmaterial des Features hinzugefügt werden; nicht abrufbare Anhänge MÜSSEN mit Name und Verweis auf die Quelle vermerkt werden.
- **FR-019**: Jira-spezifische Formatierung MUSS in eine gut lesbare Form überführt werden, sodass der Inhalt ohne Kenntnis von Jira verständlich bleibt.

### Key Entities

- **Jira-Verbindung**: Die gespeicherte Autorisierung des Toolkit-Nutzers gegenüber Jira; umfasst verbundenes Konto, verbundene Jira-Instanz/Bereich und den Gültigkeitszustand. Genau eine Verbindung je Toolkit-Nutzer, verwaltet in den Benutzereinstellungen.
- **Jira-Projekt**: Ein für den Nutzer sichtbares Projekt innerhalb des gewählten Jira-Bereichs; Auswahlkontext für Sprints und Tickets.
- **Sprint**: Ein Arbeitszeitraum eines Jira-Projekts mit Name, Zeitraum und Zustand (aktiv, zukünftig, abgeschlossen); gruppiert Tickets.
- **Ticket (Story)**: Ein Jira-Vorgang mit Schlüssel, Titel, Typ, Status, Beschreibung, Kommentaren, Anhängen und weiteren Angaben; die Quelle einer Übernahme.
- **Ticket-Übernahme**: Die Verknüpfung zwischen einem Toolkit-Feature und seinem Ursprungsticket; hält Ticketschlüssel, Link und Übernahmezeitpunkt fest und hat Schnappschuss-Charakter.
- **Feature**: Die bestehende Arbeitseinheit des SDD Toolkits; wird um eine optionale Ticket-Referenz und um das eingelesene Ticketmaterial als Ausgangsbeschreibung erweitert.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein Nutzer ohne bestehende Verbindung richtet die Jira-Anbindung inklusive Freigabe in unter 3 Minuten vollständig ein.
- **SC-002**: Vom Öffnen der Ticketliste bis zum angelegten Feature vergeht bei einem einzelnen Ticket weniger als 1 Minute.
- **SC-003**: 100 % der übernommenen Features enthalten Titel, Beschreibung, sämtliche Kommentare, alle ausgefüllten Felder sowie alle zugänglichen Anhänge bzw. Verweise des Quelltickets.
- **SC-004**: Mindestens 10 Tickets lassen sich in einem einzigen Vorgang übernehmen; der Fehlschlag einzelner Tickets verhindert die Übernahme der übrigen nicht.
- **SC-005**: Nach einem Neustart des Toolkits ist innerhalb der Gültigkeit der Autorisierung keine erneute Anmeldung erforderlich.
- **SC-006**: Bereits übernommene Tickets sind in der Ticketliste zu 100 % als solche erkennbar; es entstehen keine unbeabsichtigten Duplikate.

## Assumptions

- Zielsystem ist Jira Cloud von Atlassian. Die Anbindung erfolgt über den offiziellen Atlassian MCP (Rovo MCP, mcp.atlassian.com) mit OAuth-Freigabe im Browser; Token-Speicherung und -Erneuerung übernimmt die MCP-Verbindung, das Toolkit hält keine eigenen Jira-Zugangsdaten.
- „Space" in der Beschreibung meint den Jira-Arbeitsbereich (die Jira-Instanz/Site des Atlassian-Kontos), nicht einen Confluence-Space.
- Die Jira-Verbindung gilt je Toolkit-Nutzer global (Benutzereinstellungen), nicht je Toolkit-Projekt.
- Die Übernahme erfolgt im Kontext des aktuell geöffneten Toolkit-Projekts; die entstehenden Features werden diesem Projekt zugeordnet.
- Pro Ticket entsteht genau ein Feature; das Zusammenfassen mehrerer Tickets zu einem gemeinsamen Feature ist nicht Teil dieses Features.
- Die Übernahme ist eine einmalige Momentaufnahme (Schnappschuss); eine laufende Synchronisation mit Jira sowie Rückmeldungen nach Jira (Statuswechsel, Kommentare) sind nicht Teil dieses Features.
- Projekte ohne Sprints (z. B. reine Kanban-Projekte) werden über eine Ticketliste auf Projektebene unterstützt.
- Abgeschlossene Sprints müssen nicht standardmäßig angezeigt werden; aktive und zukünftige Sprints genügen für den Anwendungsfall.
