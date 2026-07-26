# Feature Specification: Worktree-Übersicht in den Einstellungen

**Feature Branch**: `feature/worktree-uebersicht`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "Implementiere eine Funktion, damit der User eine Übersicht der aktuellen worktrees erhält. Ich möchte sowohl worktrees wie auch files im worktree sehen können. Da es bereits mehrmals zu problemen gekommen ist, da worktrees mit teilweise fertiggestellten features erstellt wurden bzw. dublizierten content, welcher nach dem merge bereits überholt oder von einem anderen feature fertiggestellt wurde. Das neue Feature der Worktree übersicht sollte unter den einstellungen unten links zu finden sein. Es sollte zeigen, welche worktrees aktuell offen sind mit welchen features und welche files durch den worktree angepasst wurden. Auch sollte dort der main-branch bzw. das gesamt repo zu sehen sein. Ziel ist es schnell zu sehen, durch welches feature welcher worktree erstellt wurde. Die ansicht dort sollte sich dynamisch mit den effektiv erstellten worktrees aktualisieren und immer den aktuellen zustand abbolden"

## Clarifications

### Session 2026-07-26

- Q: Nur Anzeige oder auch Aufräum-Aktionen? → A: Anzeigen **und** einzelne Worktrees direkt aus der Übersicht entfernen (mit Bestätigung, Schutz bei uncommitteten Änderungen). Branch-Löschen und Reparatur-Funktionen bleiben außen vor.
- Q: Sollen Überschneidungen/veraltete Inhalte aktiv erkannt und gemeldet werden? → A: Ja, aktiv warnen — dieselbe Datei in mehreren offenen Worktrees, Datei seit Abzweig auf dem Zielbranch geändert, und bereits integrierter Branch mit noch bestehendem Worktree.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Überblick: welcher Worktree gehört zu welchem Feature (Priority: P1)

Als Nutzer öffne ich über die Einstellungen unten links die Worktree-Übersicht und sehe auf einen Blick alle aktuell bestehenden Worktrees — je Projekt gruppiert, mit dem Feature, das den Worktree ausgelöst hat, dem zugehörigen Branch, dem Pfad und dem Bearbeitungsstand des Features. Zusätzlich sehe ich für jedes Projekt den Haupt-Checkout (Gesamt-Repo) mit seinem aktuellen Branch, sodass ich Worktrees und Hauptstand nebeneinander einordnen kann.

**Why this priority**: Das ist der ausdrückliche Kernwunsch ("Ziel ist es schnell zu sehen, durch welches feature welcher worktree erstellt wurde"). Schon diese Liste allein beendet das Rätselraten, welche Arbeitskopien gerade offen sind, und liefert eigenständigen Wert — alle weiteren Stories bauen darauf auf.

**Independent Test**: Vollständig testbar, indem bei mindestens zwei angelegten Features die Übersicht geöffnet und geprüft wird, dass jeder tatsächlich existierende Worktree mit korrekter Feature-Zuordnung sowie der Haupt-Checkout jedes Projekts erscheint.

**Acceptance Scenarios**:

1. **Given** ein Projekt mit zwei Features, die je einen Worktree besitzen, **When** der Nutzer die Worktree-Übersicht über die Einstellungen unten links öffnet, **Then** werden beide Worktrees mit Feature-Name, Branch und Pfad angezeigt, gruppiert unter ihrem Projekt.
2. **Given** die geöffnete Übersicht, **When** der Nutzer ein Projekt betrachtet, **Then** ist der Haupt-Checkout (Gesamt-Repo) als eigener Eintrag mit aktuellem Branch erkennbar und optisch von den Feature-Worktrees unterschieden.
3. **Given** ein Worktree-Verzeichnis, dem kein bekanntes Feature (mehr) zugeordnet werden kann, **When** die Übersicht geöffnet wird, **Then** erscheint der Eintrag trotzdem und ist als „verwaist / ohne Feature-Zuordnung" gekennzeichnet.
4. **Given** ein Feature, dessen Worktree-Verzeichnis nicht mehr existiert, **When** die Übersicht geöffnet wird, **Then** wird dies als fehlender Worktree erkennbar gemacht statt einen bestehenden Worktree vorzutäuschen.
5. **Given** ein Eintrag in der Übersicht, **When** der Nutzer ihn auswählt, **Then** kann er direkt zum zugehörigen Feature (Konsole/Board) springen, sofern eine Zuordnung besteht.
6. **Given** ein Projekt ohne offene Worktrees, **When** die Übersicht geöffnet wird, **Then** wird ein verständlicher Leerzustand angezeigt statt einer leeren Fläche.

---

### User Story 2 - Sehen, welche Dateien ein Worktree verändert hat (Priority: P2)

Als Nutzer klappe ich einen Worktree-Eintrag auf und sehe die Liste der Dateien, die dieser Worktree gegenüber seinem Zielbranch verändert hat — mit Art der Änderung (neu, geändert, gelöscht, umbenannt) und der Unterscheidung, ob die Änderung bereits committet oder noch uncommittet ist. So erkenne ich, welchen inhaltlichen Umfang eine offene Arbeitskopie tatsächlich hat.

**Why this priority**: Der Nutzer verlangt ausdrücklich, „files im worktree" sehen zu können. Ohne die Dateiebene bleibt der Verdacht auf Doppelarbeit unüberprüfbar; erst sie macht den Umfang eines Worktrees greifbar.

**Independent Test**: Testbar, indem in einem Worktree eine Datei geändert und eine neue Datei angelegt wird und geprüft wird, dass beide in der aufgeklappten Dateiliste mit korrekter Änderungsart und korrektem Commit-Zustand erscheinen.

**Acceptance Scenarios**:

1. **Given** ein Worktree mit committeten und uncommitteten Änderungen, **When** der Nutzer dessen Dateiliste aufklappt, **Then** werden alle betroffenen Dateipfade mit Änderungsart angezeigt und committete von uncommitteten Änderungen unterscheidbar dargestellt.
2. **Given** ein Worktree ohne jede Änderung gegenüber seinem Zielbranch, **When** der Nutzer die Dateiliste aufklappt, **Then** wird ausdrücklich „keine Änderungen" ausgewiesen — ein starker Hinweis auf einen überflüssigen Worktree.
3. **Given** ein Worktree-Eintrag im eingeklappten Zustand, **When** der Nutzer ihn betrachtet, **Then** ist die Anzahl der geänderten Dateien bereits ohne Aufklappen sichtbar.
4. **Given** ein Worktree mit sehr vielen geänderten Dateien, **When** die Liste angezeigt wird, **Then** bleibt die Ansicht bedienbar (scrollbar bzw. begrenzt mit Hinweis auf die Gesamtzahl) und blockiert die übrige Übersicht nicht.

---

### User Story 3 - Vor Doppelarbeit und veralteten Worktrees gewarnt werden (Priority: P3)

Als Nutzer sehe ich in der Übersicht deutliche Hinweise, wenn ein Worktree Gefahr läuft, überholte oder doppelte Arbeit zu enthalten: wenn dieselbe Datei gleichzeitig in mehreren offenen Worktrees verändert wird, wenn eine im Worktree geänderte Datei seit dem Abzweig auch auf dem Zielbranch verändert wurde, oder wenn der Branch bereits integriert ist, der Worktree aber noch besteht. Die Hinweise nennen die betroffenen Dateien und die anderen beteiligten Features.

**Why this priority**: Genau das ist die geschilderte Schmerzursache — „dublizierten content, welcher nach dem merge bereits überholt oder von einem anderen feature fertiggestellt wurde". Die Warnungen verwandeln die Übersicht von einer Auflistung in ein Frühwarninstrument. Sie setzen jedoch die Dateiebene aus P2 voraus.

**Independent Test**: Testbar, indem zwei Worktrees dieselbe Datei ändern und geprüft wird, dass beide Einträge einen Überschneidungshinweis mit Nennung der Datei und des jeweils anderen Features zeigen.

**Acceptance Scenarios**:

1. **Given** zwei offene Worktrees, die dieselbe Datei geändert haben, **When** der Nutzer die Übersicht betrachtet, **Then** ist bei beiden Einträgen eine Überschneidung markiert, die die betroffene(n) Datei(en) und das jeweils andere Feature benennt.
2. **Given** ein Worktree, dessen geänderte Datei seit dem Abzweigpunkt auch auf dem Zielbranch verändert wurde, **When** der Nutzer die Übersicht betrachtet, **Then** wird der Worktree als „gegenüber dem Zielbranch veraltet" markiert, mit Angabe der betroffenen Dateien.
3. **Given** ein Branch, der bereits in den Zielbranch integriert wurde, dessen Worktree aber noch existiert, **When** der Nutzer die Übersicht betrachtet, **Then** wird der Eintrag als „bereits integriert — Worktree kann entfernt werden" gekennzeichnet.
4. **Given** ein Worktree ohne Überschneidungen, ohne Rückstand und ohne Integration, **When** der Nutzer ihn betrachtet, **Then** wird keine Warnung angezeigt (keine Fehlalarme).
5. **Given** ein Worktree mit mehreren zutreffenden Warnungen, **When** der Nutzer ihn betrachtet, **Then** sind alle zutreffenden Hinweise erkennbar und voneinander unterscheidbar.

---

### User Story 4 - Veraltete Worktrees direkt aus der Übersicht entfernen (Priority: P4)

Als Nutzer entferne ich einen als überholt erkannten Worktree unmittelbar dort, wo ich ihn sehe — mit einer Bestätigung, die mir zeigt, was dabei verloren geht. Enthält der Worktree uncommittete Änderungen oder arbeitet dort gerade eine Session, wird das Entfernen nicht stillschweigend ausgeführt.

**Why this priority**: Erkennen allein beseitigt die Altlasten nicht. Der Weg vom Befund zur Bereinigung ohne Terminalwechsel schließt den Kreis — setzt aber die Erkennung (P1–P3) voraus.

**Independent Test**: Testbar, indem ein sauberer, bereits integrierter Worktree über die Übersicht entfernt wird und geprüft wird, dass er anschließend weder auf der Festplatte noch in der Übersicht erscheint.

**Acceptance Scenarios**:

1. **Given** ein Worktree ohne uncommittete Änderungen und ohne laufende Session, **When** der Nutzer „Entfernen" auslöst und bestätigt, **Then** wird der Worktree entfernt und verschwindet aus der Übersicht.
2. **Given** ein beliebiger Worktree, **When** der Nutzer „Entfernen" auslöst, **Then** erscheint zuerst eine Bestätigung, die Feature, Branch, Pfad und die Anzahl betroffener Änderungen nennt.
3. **Given** ein Worktree mit uncommitteten Änderungen, **When** der Nutzer „Entfernen" auslöst, **Then** wird er ausdrücklich gewarnt und das Entfernen erfolgt nur nach einer zusätzlichen, expliziten Bestätigung — niemals stillschweigend.
4. **Given** ein Worktree, in dem gerade eine Session bzw. ein Agent arbeitet, **When** der Nutzer „Entfernen" auslöst, **Then** wird die Aktion mit einer verständlichen Begründung verweigert.
5. **Given** das Entfernen schlägt fehl, **When** der Nutzer die Aktion ausführt, **Then** erhält er eine verständliche Fehlermeldung und die Übersicht bleibt in einem konsistenten Zustand.
6. **Given** der Haupt-Checkout (Gesamt-Repo) eines Projekts, **When** der Nutzer den Eintrag betrachtet, **Then** wird dort keine Entfernen-Aktion angeboten.

---

### User Story 5 - Die Ansicht bildet immer den tatsächlichen Zustand ab (Priority: P5)

Als Nutzer verlasse ich mich darauf, dass die Übersicht dem entspricht, was tatsächlich existiert: Wird während der geöffneten Ansicht ein Worktree angelegt, entfernt oder ein Feature gemergt, aktualisiert sich die Darstellung von selbst — ohne dass ich die Ansicht schließen und neu öffnen muss. Zusätzlich kann ich jederzeit manuell aktualisieren.

**Why this priority**: Ausdrücklich gefordert („dynamisch … aktualisieren und immer den aktuellen zustand abbilden"). Für den Kernnutzen genügt zunächst, dass die Ansicht beim Öffnen frisch vom tatsächlichen Zustand liest (Teil von P1); die laufende Selbstaktualisierung ist der wertvolle Ausbau, der eine falsche Entscheidung auf veralteter Anzeige verhindert.

**Independent Test**: Testbar, indem bei geöffneter Übersicht ein neues Feature mit Worktree angelegt wird und geprüft wird, dass der neue Eintrag ohne Zutun des Nutzers erscheint.

**Acceptance Scenarios**:

1. **Given** die geöffnete Übersicht, **When** an anderer Stelle ein Worktree angelegt wird, **Then** erscheint der neue Eintrag ohne manuelles Neuladen.
2. **Given** die geöffnete Übersicht, **When** ein Feature gemergt oder sein Worktree entfernt wird, **Then** spiegelt die Ansicht diesen Zustand nach, ohne dass der Nutzer sie neu öffnen muss.
3. **Given** die geöffnete Übersicht, **When** der Nutzer manuell aktualisiert, **Then** werden die Daten neu vom tatsächlichen Zustand gelesen und der Ladefortschritt ist erkennbar.
4. **Given** die Daten werden gerade geladen, **When** der Nutzer die Übersicht betrachtet, **Then** ist der Ladezustand erkennbar und zuvor gezeigte Daten werden nicht als aktuell ausgegeben.

---

### Edge Cases

- **Verwaister Worktree**: Ein Worktree-Verzeichnis besteht, das zugehörige Feature wurde gelöscht oder archiviert — der Eintrag erscheint als „ohne Feature-Zuordnung" statt zu verschwinden (genau dieser Fall ist Teil des Problems).
- **Fehlendes Verzeichnis**: Ein Feature verweist auf einen Worktree, dessen Verzeichnis extern gelöscht wurde — die Übersicht kennzeichnet ihn als fehlend, statt einen intakten Worktree zu suggerieren.
- **Registry-Leiche**: Die Git-Verwaltung führt einen Worktree, dessen Verzeichnis nicht mehr existiert — die Übersicht meldet den Widerspruch und behauptet keine Existenz.
- **Bereits integrierter Branch mit bestehendem Worktree**: Wird ausdrücklich als bereinigungsfähig gekennzeichnet.
- **Worktree mit uncommitteten Änderungen**: Entfernen nur nach ausdrücklicher zusätzlicher Bestätigung; kein stiller Verlust.
- **Laufende Session im Worktree**: Entfernen ist gesperrt, Anzeige bleibt möglich.
- **Projekt nicht erreichbar**: Projektpfad existiert nicht mehr oder ist kein Git-Repo — der Projektblock zeigt eine verständliche Fehlermeldung, die übrigen Projekte bleiben nutzbar.
- **Sehr viele Worktrees oder Dateien**: Darstellung bleibt lesbar und reaktionsschnell; große Dateilisten werden begrenzt oder scrollbar mit Angabe der Gesamtzahl.
- **Gleichnamige Features in verschiedenen Projekten**: Einträge bleiben eindeutig unterscheidbar (Projektgruppierung, Pfad).
- **Umbenannte oder verschobene Dateien**: Werden als solche gekennzeichnet und lösen keine falschen Überschneidungswarnungen aus.
- **Worktree mit abweichendem Integrationsziel**: Vergleichsbasis ist der für das Feature gewählte Zielbranch, nicht zwingend der Projekt-Default-Branch.
- **Entfernen schlägt teilweise fehl**: Übersicht bleibt konsistent und zeigt den tatsächlich verbliebenen Zustand.

## Requirements *(mandatory)*

### Functional Requirements

**Zugang und Struktur**

- **FR-001**: Das System MUSS die Worktree-Übersicht über die Einstellungen unten links erreichbar machen.
- **FR-002**: Das System MUSS alle Worktrees aller konfigurierten Projekte anzeigen, nach Projekt gruppiert.
- **FR-003**: Das System MUSS je Projekt den Haupt-Checkout (Gesamt-Repo) als eigenen, von Feature-Worktrees unterscheidbaren Eintrag mit dessen aktuellem Branch anzeigen.
- **FR-004**: Das System MUSS je Projekt die Anzahl der offenen Worktrees ausweisen.

**Worktree-Informationen**

- **FR-005**: Das System MUSS je Worktree das auslösende Feature benennen, sofern eine Zuordnung besteht.
- **FR-006**: Das System MUSS je Worktree Branch und Ablagepfad anzeigen.
- **FR-007**: Das System MUSS je Worktree den Bearbeitungsstand des zugehörigen Features (aktuelle Phase bzw. Integrationsstand) anzeigen, damit teilweise fertiggestellte Features erkennbar sind.
- **FR-008**: Das System MUSS Worktrees ohne zuordenbares Feature als verwaist kennzeichnen und trotzdem auflisten.
- **FR-009**: Das System MUSS Features kennzeichnen, deren Worktree-Verzeichnis nicht (mehr) existiert, statt einen bestehenden Worktree auszuweisen.
- **FR-010**: Nutzer MÜSSEN von einem Worktree-Eintrag zum zugehörigen Feature navigieren können, sofern eine Zuordnung besteht.

**Dateiebene**

- **FR-011**: Das System MUSS je Worktree die gegenüber dessen Zielbranch geänderten Dateien mit ihrem Pfad auflisten.
- **FR-012**: Das System MUSS je geänderter Datei die Art der Änderung (neu, geändert, gelöscht, umbenannt) ausweisen.
- **FR-013**: Das System MUSS bereits committete von noch uncommitteten Änderungen unterscheidbar darstellen.
- **FR-014**: Das System MUSS die Anzahl geänderter Dateien bereits ohne Aufklappen der Dateiliste anzeigen.
- **FR-015**: Das System MUSS Worktrees ohne jede Änderung ausdrücklich als änderungsfrei ausweisen.
- **FR-016**: Das System MUSS auch bei sehr großen Dateilisten bedienbar bleiben, indem es die Darstellung begrenzt oder scrollbar macht und die Gesamtzahl nennt.

**Warnungen**

- **FR-017**: Das System MUSS kennzeichnen, wenn dieselbe Datei in mehr als einem offenen Worktree geändert wurde, und dabei die betroffene(n) Datei(en) sowie die anderen beteiligten Worktrees/Features nennen.
- **FR-018**: Das System MUSS kennzeichnen, wenn eine im Worktree geänderte Datei seit dem Abzweigpunkt auch auf dem Zielbranch geändert wurde (Inhalt möglicherweise überholt), und die betroffenen Dateien nennen.
- **FR-019**: Das System MUSS kennzeichnen, wenn der Branch eines Worktrees bereits in seinen Zielbranch integriert ist, der Worktree aber weiterhin besteht.
- **FR-020**: Das System MUSS bei Worktrees ohne zutreffenden Warnhinweis keine Warnung anzeigen.
- **FR-021**: Das System MUSS mehrere gleichzeitig zutreffende Warnhinweise gemeinsam und voneinander unterscheidbar darstellen.

**Entfernen**

- **FR-022**: Nutzer MÜSSEN einen einzelnen Worktree unmittelbar aus der Übersicht entfernen können.
- **FR-023**: Das System MUSS vor dem Entfernen eine Bestätigung einholen, die Feature, Branch, Pfad und den Umfang betroffener Änderungen benennt.
- **FR-024**: Das System MUSS beim Entfernen eines Worktrees mit uncommitteten Änderungen ausdrücklich warnen und die Ausführung nur nach einer zusätzlichen, expliziten Bestätigung zulassen.
- **FR-025**: Das System MUSS das Entfernen verweigern, solange im Worktree eine Session bzw. ein Agent arbeitet, und die Verweigerung verständlich begründen.
- **FR-026**: Das System MUSS für den Haupt-Checkout (Gesamt-Repo) keine Entfernen-Aktion anbieten.
- **FR-027**: Das System MUSS nach erfolgreichem Entfernen die Übersicht aktualisieren und bei Fehlschlag eine verständliche Fehlermeldung anzeigen, ohne einen inkonsistenten Zustand darzustellen.

**Aktualität**

- **FR-028**: Das System MUSS die Übersicht beim Öffnen aus dem tatsächlich vorliegenden Zustand aufbauen und nicht aus einem veralteten Zwischenstand.
- **FR-029**: Das System MUSS die Übersicht bei geöffneter Ansicht selbsttätig aktualisieren, wenn Worktrees angelegt oder entfernt werden oder Features integriert werden — ohne dass der Nutzer die Ansicht neu öffnen muss.
- **FR-030**: Nutzer MÜSSEN die Übersicht jederzeit manuell aktualisieren können.
- **FR-031**: Das System MUSS Lade-, Leer- und Fehlerzustände unterscheidbar darstellen und darf während des Ladens keine veralteten Daten als aktuell ausgeben.
- **FR-032**: Das System MUSS ein nicht erreichbares Projekt (Pfad fehlt oder kein Git-Repo) verständlich ausweisen, ohne die Anzeige der übrigen Projekte zu verhindern.

### Key Entities *(include if data involved)*

- **Worktree-Eintrag**: Eine bestehende Arbeitskopie eines Projekts. Attribute: Ablagepfad, Branch, Zuordnung zu einem Feature (oder „verwaist"), Zustand des Verzeichnisses (vorhanden/fehlend), Anlagezeitpunkt, Anzahl geänderter Dateien, aktive Session ja/nein, zutreffende Warnhinweise.
- **Haupt-Checkout (Gesamt-Repo)**: Die Projektwurzel selbst. Attribute: Projektname, Pfad, aktueller Branch, Default- bzw. Zielbranch, Anzahl uncommitteter Änderungen. Nicht entfernbar.
- **Geänderte Datei**: Eine im Worktree gegenüber dem Zielbranch veränderte Datei. Attribute: Pfad, Änderungsart (neu/geändert/gelöscht/umbenannt), Commit-Zustand (committet/uncommittet), Beteiligung an einer Überschneidung.
- **Warnhinweis**: Eine erkannte Risikolage eines Worktrees. Arten: Überschneidung mit anderem Worktree, gegenüber Zielbranch überholt, bereits integriert. Attribute: Art, betroffene Dateien, beteiligte andere Worktrees/Features.
- **Feature-Zuordnung**: Die Verbindung zwischen Worktree und dem Feature, für das er angelegt wurde, inklusive dessen Bearbeitungsstand (Phase/Integration).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein Nutzer erkennt in höchstens zwei Interaktionen (Einstellungen öffnen → Worktree-Übersicht wählen), welcher Worktree durch welches Feature entstanden ist.
- **SC-002**: 100 % der tatsächlich bestehenden Worktrees aller Projekte erscheinen in der Übersicht; kein bereits entfernter Worktree wird als bestehend ausgewiesen.
- **SC-003**: Die Übersicht ist nach dem Öffnen in unter 2 Sekunden vollständig nutzbar (bei bis zu 10 Projekten und 30 Worktrees).
- **SC-004**: Ein neu angelegter oder entfernter Worktree erscheint bzw. verschwindet bei geöffneter Ansicht innerhalb von 5 Sekunden ohne Zutun des Nutzers.
- **SC-005**: Für jeden Worktree lässt sich ohne Terminal feststellen, welche Dateien er verändert hat und wie viele es sind.
- **SC-006**: Jede Datei, die gleichzeitig in zwei oder mehr offenen Worktrees geändert wird, ist in 100 % der Fälle als Überschneidung markiert und nennt die beteiligten Features.
- **SC-007**: Jeder Worktree, dessen Branch bereits integriert wurde, ist in 100 % der Fälle als bereinigungsfähig gekennzeichnet.
- **SC-008**: Ein überholter Worktree kann vollständig innerhalb der Anwendung entfernt werden, ohne das Dateisystem oder ein Terminal zu bemühen.
- **SC-009**: In 0 Fällen geht uncommittete Arbeit durch das Entfernen verloren, ohne dass der Nutzer zuvor ausdrücklich gewarnt wurde und zusätzlich bestätigt hat.
- **SC-010**: In 100 % der Ausnahmefälle (verwaister Worktree, fehlendes Verzeichnis, nicht erreichbares Projekt, laufende Session) erhält der Nutzer eine eindeutige Kennzeichnung oder Begründung statt eines Fehlers oder einer stillen Auslassung.

## Assumptions

- **Einstiegspunkt**: Der bestehende Einstellungs-Eintrag unten links ist tool-weit und projektübergreifend. Die Worktree-Übersicht wird dort als weiterer Eintrag angeboten und umfasst daher **alle** konfigurierten Projekte, nach Projekt gruppiert — nicht nur das gerade ausgewählte.
- **„Files im worktree"** meint die durch den Worktree **veränderten** Dateien, nicht den vollständigen Dateibaum der Arbeitskopie. Ein Datei-Browser des Worktrees ist nicht Teil dieses Features.
- **Vergleichsbasis** für „geändert" ist der Abzweigpunkt gegenüber dem Integrations-Zielbranch des Features; ist keiner gesetzt, gilt der Default-Branch des Projekts.
- **Keine Inhaltsansicht**: Die Übersicht zeigt Dateipfade und Änderungsarten, keine Diffs. Die inhaltliche Prüfung bleibt beim bestehenden Review-Portal; von dort wird nicht dupliziert.
- **Read-only gegenüber Dateiinhalten**: Die einzige verändernde Aktion ist das Entfernen eines Worktrees. Branch-Löschen, Reparieren, Neuanlegen und das Prunen verwaister Registry-Einträge sind ausdrücklich außerhalb des Umfangs.
- **Bestehende Grundlagen werden genutzt**: Worktree-Anlage, Feature-Zuordnung und die vorhandene Ereignis-/Aktualisierungsmechanik der Anwendung bleiben unverändert; dieses Feature liest daraus und ergänzt lediglich das Entfernen.
- **Darstellung** folgt Sprache und Erscheinungsbild der übrigen Anwendung (deutschsprachig, dunkles Layout).
- **Realistische Größenordnung**: Es wird von wenigen Projekten mit je einer überschaubaren Zahl gleichzeitig offener Worktrees ausgegangen; eine Paginierung über hunderte Einträge ist nicht vorgesehen.
- **Archivierte Features** gelten nicht als offene Worktrees; besteht ihr Verzeichnis dennoch, erscheinen sie als verwaist.
