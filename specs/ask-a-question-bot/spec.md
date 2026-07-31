# Feature Specification: Ask-a-Question-Bot (Projekt-Chat)

**Feature Branch**: `feature/ask-a-question-bot`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Das SDD Toolkit soll einen Sprechblase unten rechts haben um eine claude session über das projekt zu spawnen und generelle fragen zum projekt oder projektunabhängig zu beantworten. Der hintergrund ist, dass ich nicht immer direkt ein Feature bauen möchte. Manchmal möchte ich auch einfach etwas zum projekt fragen. Wenn sich dann aus der frage ein feature ergibt oder es sinnvoll wäre ein feature hierfür anzulegen, dann soll claude mich darauf hinweisen, dass der umfang der anforderung eigentlich ein eigenes feature wäre und mich fragen, ob er hierfür nicht ein neues feature für mich erstellen soll. So ist es möglich auch eine generelle chat-session zu haben ohne direkt features zu bauen und wenn die chat session in ein feature mündet, soll dies korrekt überführt werden."

## Clarifications

### Session 2026-07-22

- Q: Soll der Chat-Verlauf einen Neustart der App überleben? → A: Ja — eine fortlaufende Unterhaltung pro Projekt wird dauerhaft gespeichert und beim nächsten Öffnen nahtlos fortgesetzt.
- Q: Wo soll die Sprechblase unten rechts sichtbar sein? → A: Nur in der Projektansicht (bei geöffnetem Projekt); der Chat kennt immer dieses Projekt.
- Q: Was passiert nach Zustimmung zum Feature-Vorschlag? → A: Der bestehende Anlege-Dialog öffnet sich, vorbefüllt mit Namensvorschlag und der im Chat erarbeiteten Anforderung; der Nutzer prüft, passt ggf. an und bestätigt dort.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Allgemeine Frage zum Projekt stellen (Priority: P1)

Als Nutzer des SDD Toolkits möchte ich über eine dauerhaft sichtbare Sprechblase unten rechts einen Chat öffnen und dem Assistenten eine Frage zum aktuell geöffneten Projekt stellen (z. B. „Wie funktioniert die Merge-Queue?"), ohne dafür ein Feature anlegen zu müssen. Ich bekomme eine Antwort mit Projektbezug und kann beliebig nachfragen — es entsteht dabei nichts außer der Unterhaltung selbst.

**Why this priority**: Das ist der Kern des Features: ein Frage-Modus neben dem Feature-Bau-Modus. Ohne diese Story existiert kein nutzbarer Mehrwert; alle weiteren Stories bauen darauf auf.

**Independent Test**: Chat über die Sprechblase öffnen, eine Projektfrage stellen, Antwort erhalten. Anschließend prüfen, dass keinerlei Feature-Artefakte entstanden sind (kein neuer Eintrag in der Feature-Übersicht, keine Spezifikation, keine Arbeitskopie).

**Acceptance Scenarios**:

1. **Given** ein im Toolkit geöffnetes Projekt, **When** der Nutzer die Sprechblase unten rechts anklickt, **Then** öffnet sich ein Chat-Panel und eine Assistenz-Unterhaltung mit Kenntnis des Projekts steht bereit.
2. **Given** ein offener Chat, **When** der Nutzer eine Frage zum Projekt stellt, **Then** erscheint im Verlauf eine Antwort, die inhaltlich auf das Projekt Bezug nimmt.
3. **Given** eine laufende Chat-Unterhaltung, **When** der Nutzer ausschließlich Fragen stellt, **Then** entstehen keine Features, Spezifikationen oder Arbeitskopien und der Projektstand bleibt unverändert.
4. **Given** ein offener Chat mit laufender Unterhaltung, **When** der Nutzer das Panel schließt und erneut öffnet, **Then** ist der bisherige Gesprächsverlauf weiterhin sichtbar.

---

### User Story 2 - Aus dem Chat ein Feature erstellen (Priority: P2)

Wenn ich im Chat eine Anforderung beschreibe, deren Umfang über eine einfache Frage hinausgeht, weist mich der Assistent von sich aus darauf hin, dass das eigentlich ein eigenes Feature wäre, und fragt, ob er es für mich anlegen soll. Stimme ich zu, öffnet sich der bestehende Anlege-Dialog, vorbefüllt mit einem Namensvorschlag und der im Chat erarbeiteten Anforderung als Beschreibung — ich prüfe, passe bei Bedarf an und bestätige dort, ohne etwas erneut eintippen zu müssen. Lehne ich ab, läuft die Unterhaltung einfach weiter.

**Why this priority**: Das ist der Übergabemechanismus, der den Chat mit dem SDD-Workflow verbindet und verhindert, dass im Gespräch erarbeitete Anforderungen verloren gehen oder manuell abgetippt werden müssen. Er setzt die funktionierende Chat-Basis (US1) voraus.

**Independent Test**: Im Chat eine erkennbar feature-würdige Anforderung beschreiben (z. B. „Ich hätte gern einen Export aller Features als PDF-Report"). Prüfen, dass der Assistent den Hinweis gibt und nachfragt; nach Zustimmung prüfen, dass ein neues Feature mit der übernommenen Anforderungsbeschreibung in der Feature-Übersicht existiert.

**Acceptance Scenarios**:

1. **Given** eine laufende Chat-Unterhaltung, **When** der Nutzer eine Anforderung beschreibt, deren Umfang ein eigenes Feature rechtfertigt, **Then** weist der Assistent aktiv darauf hin und fragt, ob er dafür ein neues Feature anlegen soll.
2. **Given** ein Feature-Vorschlag des Assistenten, **When** der Nutzer zustimmt, **Then** öffnet sich der bestehende Anlege-Dialog, vorbefüllt mit einem Namensvorschlag und der im Chat erarbeiteten Anforderung als Beschreibung.
3. **Given** der vorbefüllte Anlege-Dialog, **When** der Nutzer (ggf. nach Anpassungen) bestätigt, **Then** wird das Feature im aktuellen Projekt angelegt, ohne dass der Nutzer die Anforderung erneut eingeben musste.
4. **Given** ein Feature-Vorschlag des Assistenten, **When** der Nutzer ablehnt, **Then** läuft die Unterhaltung ohne Seiteneffekte weiter und es wird nichts angelegt.
5. **Given** ein aus dem Chat erstelltes Feature, **When** der Nutzer es in der Feature-Übersicht öffnet, **Then** verhält es sich wie ein manuell angelegtes Feature und durchläuft denselben Workflow.
6. **Given** ein erfolgreich angelegtes Feature, **When** die Erstellung abgeschlossen ist, **Then** bestätigt der Assistent dies im Chat und verweist auf das neue Feature.

---

### User Story 3 - Projektunabhängige Fragen stellen (Priority: P3)

Ich kann im selben Chat auch Fragen stellen, die nichts mit dem Projekt zu tun haben (allgemeine Technik- oder Wissensfragen), und bekomme ebenfalls hilfreiche Antworten — der Assistent zwingt mir keinen Projektbezug auf.

**Why this priority**: Rundet den „genereller Chat"-Anspruch ab. Wertvoll, aber weniger kritisch als Projektfragen und Feature-Übergabe.

**Independent Test**: Eine projektfremde Frage stellen (z. B. eine allgemeine Konzeptfrage) und prüfen, dass eine sinnvolle Antwort ohne erzwungenen Projektbezug kommt.

**Acceptance Scenarios**:

1. **Given** ein offener Chat, **When** der Nutzer eine projektunabhängige Frage stellt, **Then** beantwortet der Assistent die Frage, ohne einen Projektbezug zu erzwingen und ohne ein Feature vorzuschlagen.

---

### Edge Cases

- Die Assistenz-Unterhaltung kann nicht gestartet werden (z. B. Assistenz-Provider lokal nicht verfügbar): Der Chat zeigt eine verständliche Fehlermeldung; die Sprechblase bleibt nutzbar, sodass ein erneuter Versuch möglich ist.
- Der Nutzer lehnt einen Feature-Vorschlag ab und beschreibt die Anforderung anschließend weiter: Der Assistent darf erneut vorschlagen, wenn sich der Umfang wesentlich erweitert, soll aber nicht nach jeder Nachricht erneut nachfragen.
- Die Feature-Erstellung schlägt fehl (z. B. Namenskonflikt mit bestehendem Feature): Der Chat meldet den Fehler verständlich; die Unterhaltung und die erarbeitete Anforderung bleiben erhalten, sodass ein erneuter Versuch möglich ist.
- Der Nutzer schließt das Chat-Panel, während der Assistent noch antwortet: Die Antwort geht nicht verloren und ist beim erneuten Öffnen im Verlauf sichtbar.
- Sehr lange Unterhaltungen: Ältere Nachrichten bleiben per Bildlauf erreichbar; der Chat bleibt bedienbar.
- Parallel laufende Feature-Sessions im selben Projekt: Der Chat läuft unabhängig davon und blockiert weder Feature-Arbeit noch wird er von ihr blockiert.
- Der Nutzer stellt im Chat eine Anforderung, während gerade ein Feature aus einem früheren Vorschlag angelegt wird: Vorschläge werden nacheinander abgewickelt; es entsteht kein doppeltes Feature aus einem einzelnen Vorschlag.
- Der Nutzer bricht den vorbefüllten Anlege-Dialog ab: Es wird nichts angelegt; die Unterhaltung läuft weiter und der Vorschlag samt vorbefüllter Anforderung bleibt erneut aufrufbar.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das Toolkit MUSS in der Projektansicht dauerhaft eine Sprechblasen-Schaltfläche unten rechts anzeigen.
- **FR-002**: Ein Klick auf die Sprechblase MUSS ein Chat-Panel öffnen und — falls noch keine Unterhaltung läuft — eine Assistenz-Unterhaltung starten, die den Kontext des aktuell geöffneten Projekts kennt.
- **FR-003**: Der Nutzer MUSS im Chat frei formulierte Fragen stellen können — sowohl zum Projekt als auch projektunabhängig — und die Antworten im Gesprächsverlauf sehen.
- **FR-004**: Reines Chatten DARF KEINE Feature-Artefakte erzeugen (keine Spezifikationen, keine Arbeitskopien, keine Einträge in der Feature-Übersicht) und DARF KEINE Änderungen am Projektinhalt vornehmen.
- **FR-005**: Der Assistent MUSS erkennen, wenn der Umfang einer im Chat geäußerten Anforderung über eine Frage hinausgeht und ein eigenes Feature rechtfertigt; er MUSS den Nutzer aktiv darauf hinweisen und fragen, ob er ein neues Feature anlegen soll. Ein Feature DARF NIEMALS ohne ausdrückliche Zustimmung des Nutzers angelegt werden.
- **FR-006**: Bei Zustimmung des Nutzers MUSS sich der bestehende Anlege-Dialog des Toolkits öffnen, vorbefüllt mit einem Namensvorschlag und der im Chat erarbeiteten Anforderung als Feature-Beschreibung; der Nutzer KANN dort Anpassungen vornehmen und bestätigt die Anlage. Das Feature wird im aktuell geöffneten Projekt angelegt; ein erneutes manuelles Eingeben der Anforderung DARF NICHT nötig sein.
- **FR-007**: Ein aus dem Chat erstelltes Feature MUSS denselben Lebenszyklus durchlaufen wie ein manuell angelegtes Feature (gleiche Übersicht, gleicher Workflow, gleiche Weiterverarbeitung).
- **FR-008**: Bei Ablehnung eines Feature-Vorschlags MUSS die Unterhaltung ohne Seiteneffekte weiterlaufen.
- **FR-009**: Der Gesprächsverlauf der Unterhaltung MUSS dauerhaft gespeichert werden und sowohl das Schließen/Wiederöffnen des Chat-Panels als auch einen Neustart der App überstehen; beim nächsten Öffnen wird die Unterhaltung nahtlos fortgesetzt. Der Nutzer MUSS außerdem jederzeit eine neue Unterhaltung beginnen können.
- **FR-010**: Fehler beim Start der Unterhaltung oder bei der Feature-Erstellung MÜSSEN im Chat verständlich angezeigt werden; die bereits erarbeitete Anforderung DARF dabei NICHT verloren gehen.
- **FR-011**: Nach erfolgreicher Feature-Erstellung MUSS der Chat dies bestätigen und dem Nutzer den Weg zum neuen Feature weisen.

### Key Entities

- **Chat-Unterhaltung**: Laufende Frage-Antwort-Sitzung zwischen Nutzer und Assistent; gehört zum aktuell geöffneten Projekt; besteht aus einer geordneten Folge von Nachrichten; wird dauerhaft gespeichert und über App-Neustarts hinweg fortgesetzt; erzeugt selbst keine Feature-Artefakte.
- **Chat-Nachricht**: Einzelner Beitrag innerhalb einer Unterhaltung mit Absender (Nutzer oder Assistent), Inhalt und zeitlicher Reihenfolge.
- **Feature-Vorschlag**: Vom Assistenten aus der Unterhaltung abgeleitete Anforderungszusammenfassung (Namensvorschlag + Beschreibung) samt Entscheidung des Nutzers (angenommen/abgelehnt); bei Annahme Vorbefüllung des Anlege-Dialogs für das neue Feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nutzer erreichen den Chat aus der Projektansicht mit genau einem Klick und können ihre erste Frage ohne weitere Zwischenschritte stellen.
- **SC-002**: 100 % der reinen Frage-Unterhaltungen hinterlassen keine Feature-Artefakte und keine Änderungen am Projekt.
- **SC-003**: Nach dem Absenden einer Frage beginnt die Antwort in typischen Fällen innerhalb von 15 Sekunden sichtbar zu werden.
- **SC-004**: Bei der Übernahme einer Chat-Anforderung in ein Feature ist keine erneute manuelle Eingabe des Anforderungstexts nötig (0 abgetippte Anforderungen).
- **SC-005**: In einem Testdurchlauf mit gemischten Eingaben schlägt der Assistent bei mindestens 8 von 10 feature-würdigen Anforderungen ein Feature vor und bei höchstens 1 von 10 einfachen Fragen fälschlicherweise.

## Assumptions

- Die Sprechblase erscheint ausschließlich in der Projektansicht (nur bei geöffnetem Projekt); ein aus dem Chat angelegtes Feature bezieht sich immer auf das aktuell geöffnete Projekt. Projektunabhängige Fragen sind trotzdem in derselben Unterhaltung möglich.
- Pro Projekt läuft höchstens eine aktive Chat-Unterhaltung gleichzeitig; sie wird dauerhaft gespeichert und über App-Neustarts hinweg fortgesetzt. Eine Historienliste mehrerer alter Unterhaltungen ist nicht gefordert; „Neue Unterhaltung beginnen" ersetzt die bisherige.
- Die Feature-Erstellung aus dem Chat nutzt den bestehenden Anlege-Dialog des Toolkits (vorbefüllt statt leer) und führt zum selben Ergebnis wie ein manuell angelegtes Feature.
- Der Assistent beurteilt inhaltlich (nicht über starre Schlüsselwortlisten), wann eine Anforderung feature-würdig ist; der Hinweis erfolgt immer als Frage, nie als automatische Erstellung.
- Für den Chat gelten dieselben lokalen Voraussetzungen wie für Feature-Sessions (verfügbarer Assistenz-Provider auf dem Rechner des Nutzers).
- Der Chat verhält sich gegenüber dem Projekt rein lesend; die einzige zustandsverändernde Aktion ist das Anlegen eines Features nach ausdrücklicher Zustimmung.
