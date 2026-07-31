# Feature Specification: Spezifikation der SDD-Schritte per Lane-Info-Icon einsehen und bearbeiten

**Feature Branch**: `feature/spec-kit-spezifikation-einsehen`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Ich möchte als User die Spezifikationen der einzelnen sdd schritte einsehen können. hierzu soll auf den Board-Lanes ein Info-Icon sichtbar sein, welches mir die spezifikation der md-files der einzelnen tasks anzeigt und auch eine möglichkeit gibt diese direkt zu editieren."

## Clarifications

### Session 2026-07-22

- Q: Was genau soll das Lane-Info-Icon anzeigen? → A: Die spec-kit-Definition des jeweiligen Schritts selbst (z. B. das Icon bei "Specify" erklärt, was Specify tut). Ziel: Nutzer verstehen, was hinter jedem Status/Schritt steckt — **nicht** die pro Feature erzeugten Artefakte (spec.md/plan.md/tasks.md).
- Q: Wo soll das Info-Icon erscheinen? → A: Pro Lane-Header (je Phasen-Spalte des Boards), nicht pro Feature-Karte.
- Q: Wie sollen die Definitionen bearbeitet werden? → A: Beides — in-App bearbeiten & speichern plus zusätzlicher Button "im externen Editor öffnen".
- Q: Was passiert beim Speichern, wenn die Datei seit dem Öffnen extern geändert wurde? → A: Warnen und den Nutzer entscheiden lassen (Überschreiben oder Neu laden/Verwerfen); kein stiller Datenverlust.
- Q: Darf während eines laufenden Agenten für diesen Schritt bearbeitet werden? → A: Nein — Bearbeiten ist dann gesperrt (nur Lesen); Einsehen bleibt möglich.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verstehen, was ein SDD-Schritt macht (Priority: P1)

Als Nutzer sehe ich im Kopf jeder Phasen-Lane des Boards (Specify, Clarify, Plan, Checklist, Analyze, Tasks, Implement) ein Info-Icon. Klicke ich darauf, öffnet sich eine Ansicht, die die spec-kit-Definition dieses Schritts formatiert darstellt und mir erklärt, was der Schritt genau tut. So verstehe ich, was hinter jedem Status und Arbeitsschritt steckt, ohne die Toolkit-Dateien manuell durchsuchen zu müssen.

**Why this priority**: Das reine Einsehen und Verstehen ist der Kern des Wunsches ("verstehen, was genau hinter jedem Status und Schritt steckt") und liefert eigenständigen Wert. Ohne diese Fähigkeit ist keine weitere Funktion sinnvoll.

**Independent Test**: Kann vollständig getestet werden, indem man das Info-Icon einer Phasen-Lane (z. B. "Specify") anklickt und prüft, dass die Erklärung dieses Schritts formatiert und vollständig angezeigt wird. Liefert den Wert "Schritt verstehen, ohne Dateien zu suchen".

**Acceptance Scenarios**:

1. **Given** eine Phasen-Lane besitzt eine spec-kit-Definition, **When** der Nutzer das Info-Icon im Lane-Header anklickt, **Then** öffnet sich eine Ansicht mit dem formatiert dargestellten Definitionsinhalt dieses Schritts.
2. **Given** die Definitionsansicht ist geöffnet, **When** der Nutzer sie schließt, **Then** kehrt er ohne Zustandsverlust zum Board zurück.
3. **Given** das Info-Icon einer Lane, **When** der Nutzer mit dem Zeiger darüber verweilt, **Then** erkennt er über eine Kurzinfo, dass sich dahinter die Erklärung des Schritts öffnen lässt.
4. **Given** eine Board-Spalte ohne eigene spec-kit-Definition (z. B. Integration oder Done), **When** der Nutzer die Lane betrachtet, **Then** wird entweder kein Info-Icon angezeigt oder erkennbar gemacht, dass hierfür keine Definition existiert — ohne Fehler.

---

### User Story 2 - Schritt-Definition direkt in der App bearbeiten (Priority: P2)

Als Nutzer kann ich in der geöffneten Definitionsansicht in einen Bearbeitungsmodus wechseln, den Text der Schritt-Definition ändern und speichern, sodass die zugrunde liegende Definitionsdatei aktualisiert wird — ohne die Anwendung zu verlassen. So kann ich den Ablauf eines Schritts anpassen.

**Why this priority**: Der Nutzer verlangt ausdrücklich die Möglichkeit, "diese direkt zu editieren". Aufbauend auf dem Einsehen (P1) erlaubt das Bearbeiten, den Workflow anzupassen, ohne einen externen Editor bemühen zu müssen.

**Independent Test**: Kann getestet werden, indem man eine Definition öffnet, den Bearbeitungsmodus aktiviert, den Text ändert, speichert, die Ansicht schließt und erneut öffnet und prüft, dass die Änderung erhalten geblieben ist.

**Acceptance Scenarios**:

1. **Given** eine geöffnete Definitionsansicht, **When** der Nutzer den Bearbeitungsmodus aktiviert, **Then** wird der Text in einem editierbaren Feld angezeigt.
2. **Given** der Nutzer hat Text geändert, **When** er speichert, **Then** wird die Änderung dauerhaft in die zugehörige Definitionsdatei geschrieben und eine Erfolgsrückmeldung angezeigt.
3. **Given** der Nutzer hat ungespeicherte Änderungen, **When** er die Ansicht schließen will, **Then** wird er vor dem Verwerfen der Änderungen gewarnt.
4. **Given** das Speichern schlägt fehl (z. B. Datei nicht schreibbar), **When** der Nutzer speichert, **Then** erhält er eine verständliche Fehlermeldung und seine Eingaben bleiben erhalten.
5. **Given** die Definitionsdatei wurde seit dem Öffnen extern geändert, **When** der Nutzer speichert, **Then** wird er gewarnt und kann zwischen Überschreiben und Neu laden/Verwerfen wählen (kein stilles Überschreiben).
6. **Given** für diesen Schritt läuft aktuell ein Agent, **When** der Nutzer die Definition öffnet, **Then** ist die Ansicht nur lesend; das Bearbeiten ist gesperrt, bis der Lauf beendet ist.

---

### User Story 3 - Definition im externen Editor öffnen (Priority: P3)

Als Nutzer kann ich aus der Definitionsansicht heraus die zugehörige Datei mit einem Klick in meinem konfigurierten externen Editor öffnen, um umfangreichere Änderungen mit meinem gewohnten Werkzeug vorzunehmen.

**Why this priority**: Ergänzt die In-App-Bearbeitung (P2) für Nutzer, die ihren gewohnten Editor bevorzugen. Nützlich, aber nicht zwingend für den Kernwert; die App verfügt bereits über eine Öffnen-im-Editor-Fähigkeit, auf der dies aufsetzt.

**Independent Test**: Kann getestet werden, indem man in der geöffneten Ansicht "im externen Editor öffnen" auslöst und prüft, dass die korrekte Definitionsdatei im konfigurierten Editor erscheint.

**Acceptance Scenarios**:

1. **Given** eine geöffnete Definitionsansicht, **When** der Nutzer "im externen Editor öffnen" auslöst, **Then** wird genau die dem Schritt zugeordnete Definitionsdatei im konfigurierten externen Editor geöffnet.

---

### Edge Cases

- **Spalte ohne Definition**: Board-Spalten, die keinen spec-kit-Schritt darstellen (z. B. Integration, Done), besitzen keine Definition — das Icon entfällt oder weist klar darauf hin.
- **Definitionsdatei fehlt/unlesbar**: Zu einem Schritt lässt sich keine Definition finden oder lesen; die Ansicht zeigt eine verständliche Meldung statt eines leeren oder fehlerhaften Dialogs.
- **Datei extern geändert**: Die Definitionsdatei wurde seit dem Öffnen außerhalb der Ansicht geändert; beim Speichern wird gewarnt (Überschreiben vs. Neu laden).
- **Agent führt Schritt aus**: Während ein Agent den Schritt ausführt, ist die Definition nur lesend; Bearbeiten ist gesperrt.
- **Geteilte Wirkung der Bearbeitung**: Eine Definition gilt schritt- und damit projekt-/feature-übergreifend; eine Änderung wirkt auf alle künftigen Ausführungen dieses Schritts. Dies muss für den Nutzer erkennbar sein.
- **Sehr große Definition**: Umfangreiche Definitionen müssen lesbar und bedienbar bleiben (Scrollen, keine spürbare Verzögerung).
- **Deaktivierte/optionale Schritte**: Ein Schritt, dessen Lane im Board (z. B. je nach Projektkonfiguration) nicht sichtbar ist, benötigt kein Icon; sichtbare Lanes zeigen ihre Definition unabhängig vom Feature-Bestand der Lane.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS im Kopf jeder Phasen-Lane des Boards, die einen spec-kit-Schritt darstellt, ein erkennbares Info-Icon anzeigen.
- **FR-002**: Das System MUSS beim Aktivieren des Info-Icons die spec-kit-Definition des zugehörigen Schritts — also die Beschreibung, was der Schritt tut — in einer lesbaren, formatierten Ansicht darstellen.
- **FR-003**: Das System MUSS den angezeigten Inhalt aus der dem Schritt zugeordneten Definitionsdatei beziehen.
- **FR-004**: Das System MUSS Board-Spalten ohne eigene spec-kit-Definition (z. B. Integration, Done) erkennbar behandeln, indem es dort kein Info-Icon anzeigt oder klar kennzeichnet, dass keine Definition vorliegt — ohne Fehler.
- **FR-005**: Nutzer MÜSSEN aus der Ansicht heraus in einen Bearbeitungsmodus wechseln können, in dem der Definitionstext editierbar ist.
- **FR-006**: Das System MUSS bearbeitete Inhalte dauerhaft in die zugehörige Definitionsdatei zurückschreiben und den Erfolg des Speicherns bestätigen.
- **FR-007**: Das System MUSS beim Fehlschlagen eines Speichervorgangs eine verständliche Fehlermeldung anzeigen und die Eingaben des Nutzers erhalten.
- **FR-008**: Das System MUSS den Nutzer warnen, bevor ungespeicherte Änderungen durch Schließen oder Wechseln verloren gehen.
- **FR-009**: Das System MUSS beim Speichern erkennen, wenn die Definitionsdatei seit dem Öffnen extern geändert wurde, und den Nutzer warnen sowie zwischen Überschreiben und Neu laden/Verwerfen wählen lassen (kein stilles Überschreiben).
- **FR-010**: Das System MUSS das Bearbeiten sperren (nur-lesend), solange ein Agent den betreffenden Schritt ausführt; das Einsehen MUSS währenddessen möglich bleiben.
- **FR-011**: Das System MUSS aus der Ansicht heraus die Möglichkeit bieten, die zugehörige Definitionsdatei im konfigurierten externen Editor zu öffnen.
- **FR-012**: Das System MUSS erkennbar machen, dass eine bearbeitete Definition schrittweit gilt und die Änderung alle künftigen Ausführungen dieses Schritts betrifft.
- **FR-013**: Das System MUSS die Ansicht ohne Zustandsverlust für das übrige Board schließen können.

### Key Entities *(include if data involved)*

- **SDD-Schritt (Phase)**: Ein Arbeitsschritt des Ablaufs (Specify, Clarify, Plan, Checklist, Analyze, Tasks, Implement), der als Phasen-Lane auf dem Board erscheint. Zustands-Spalten wie Integration und Done stellen keinen spec-kit-Schritt dar.
- **Schritt-Definition**: Die dem Schritt zugeordnete Markdown-Definition, die beschreibt/spezifiziert, was der Schritt tut (spec-kit-Definition). Attribute: Zugehörigkeit zum Schritt, Inhalt, Speicherort, Änderungsstand (zur Konflikterkennung), Bearbeitbarkeit (gesperrt bei laufendem Agenten).
- **Board-Lane**: Eine Spalte des Boards. Für Phasen-Lanes existiert genau eine Schritt-Definition; für reine Zustands-Spalten keine.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein Nutzer kann in höchstens zwei Interaktionen (Icon anklicken → Inhalt sichtbar) nachlesen, was ein SDD-Schritt tut.
- **SC-002**: Nach dem Öffnen wird die Definition eines Schritts in unter 1 Sekunde angezeigt.
- **SC-003**: Eine im Bearbeitungsmodus gespeicherte Änderung ist nach erneutem Öffnen der Ansicht zu 100 % unverändert vorhanden.
- **SC-004**: In 100 % der Fälle ohne verfügbare Definition, mit Speicherkonflikt oder bei laufendem Agenten erhält der Nutzer eine eindeutige Rückmeldung statt eines Fehlers oder stillen Datenverlusts.
- **SC-005**: Für jede sichtbare Phasen-Lane des Boards ist die zugehörige Schritt-Definition über das Info-Icon abrufbar.
- **SC-006**: Nutzer können eine typische kleine Anpassung an einer Schritt-Definition vollständig innerhalb der Anwendung vornehmen, ohne das Dateisystem manuell zu durchsuchen.

## Assumptions

- Die "SDD-Schritte" der Anfrage sind die spec-kit-Phasen, die als Board-Lanes dargestellt werden; die "Spezifikation der md-files" ist die je Schritt vorhandene Definitionsdatei (die beschreibt, was der Schritt tut) — nicht die pro Feature erzeugten Artefakte wie `spec.md`, `plan.md` oder `tasks.md`.
- Die anzuzeigende Definition stammt aus der dem jeweiligen Schritt zugeordneten spec-kit-Definitionsdatei, die im Projekt vorhanden ist.
- Schritt-Definitionen sind projekt- und feature-übergreifend geteilt; eine Bearbeitung wirkt global auf alle künftigen Ausführungen dieses Schritts.
- Das Info-Icon wird pro Lane-Header dargestellt und ist unabhängig davon, welche oder wie viele Feature-Karten aktuell in der Lane stehen.
- Board-Spalten, die keinen spec-kit-Schritt darstellen (Integration, Done), besitzen keine Definition.
- "Direkt editieren" bedeutet Bearbeiten innerhalb der Anwendung mit Zurückschreiben in die Datei; zusätzlich steht das Öffnen im bestehenden externen Editor zur Verfügung.
- Die Anwendung wird von einer einzelnen Person lokal genutzt; es ist keine Mehrbenutzer-Zugriffskontrolle erforderlich, wohl aber Schutz vor Konflikten mit gleichzeitig laufenden Agenten und externen Änderungen.
- Mobile-/Touch-Bedienung ist für die erste Version nicht im Fokus.
