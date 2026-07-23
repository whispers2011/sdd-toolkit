# Feature Specification: Grid-Ansicht zeigt aktive Sessions automatisch an

**Feature Branch**: `feature/grid-ansicht-soll-automatisch-aktive-sessions-anzeigen`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "aktuell muss in der grid ansicht ausgewählt werden, welche konsolen angezeigt werden sollen. Beim öffnen der ansicht sollen noch aktive sessions oder sessions die gerade auf eine antwort aufgrund von rückfragen oder unterbrechungen z.B. bei rückfragen ob code ausgeführt werden darf automatisch angezeigt werden. Die maximale anzahl an sessions darf nicht überschritten werden. Es sollen die zuletzt gestarteten sessions zuerst angezeigt werden"

## Kontext & Ausgangslage *(informativ)*

Die Grid-Ansicht zeigt mehrere Konsolen (Sessions) eines Projekts nebeneinander in einem Raster. **Heute ist die Belegung rein manuell**: Der Nutzer wählt über ein Auswahlfeld ("+ Konsole hinzufügen …") aus, welche Feature-Konsolen im Raster erscheinen. Die getroffene Auswahl wird pro Projekt gespeichert und beim nächsten Öffnen wiederhergestellt. Es gibt eine feste Obergrenze für gleichzeitig angezeigte Konsolen (aktuell 9, ein 3×3-Raster).

Eine Session kann sich unter anderem in folgenden Zuständen befinden:

- **arbeitend** ("working") — die Session verarbeitet gerade eine Aufgabe.
- **wartet auf Antwort** ("awaiting input") — die Session ist unterbrochen und braucht eine Nutzer­eingabe. Das umfasst insbesondere Rückfragen, ob Code/Tools ausgeführt werden dürfen (Freigabe­abfrage), inhaltliche Rückfragen und Plan-Freigaben.
- **untätig/bereit** ("idle") — gestartet und lebendig, aber gerade weder arbeitend noch wartend.
- **beendet/gestoppt/fehlerhaft** — die Session ist nicht mehr aktiv.

**Problem**: Wer die Ansicht öffnet, sieht zunächst die (womöglich veraltete) manuell gespeicherte Auswahl und muss selbst zusammensuchen, welche Sessions gerade laufen oder eine Eingabe erwarten. Gerade Sessions, die auf eine Freigabe warten, blockieren den Fortschritt und werden leicht übersehen.

**Ziel**: Beim Öffnen der Grid-Ansicht sollen automatisch genau die Sessions erscheinen, die Aufmerksamkeit brauchen — laufende Sessions und solche, die auf eine Antwort warten — sortiert nach zuletzt gestartet zuerst, ohne die Höchstzahl anzeigbarer Konsolen zu überschreiten.

## Clarifications

### Session 2026-07-23

- Q: Wie verhält sich die automatische Belegung zur bestehenden, manuell gespeicherten Konsolen-Auswahl? → A: **Ersetzen (override)** — beim Öffnen der Ansicht wird die gespeicherte manuelle Auswahl verworfen und durch die automatisch ermittelten arbeitenden/wartenden Sessions ersetzt. Die Belegung wird bei jedem Öffnen (und bei Projektwechsel) neu bestimmt.
- Q: Zählen "untätig/bereit" (gestartet, aber gerade weder arbeitend noch wartend) Sessions als automatisch anzuzeigen? → A: **Nur arbeitende + auf Antwort wartende** Sessions werden automatisch angezeigt. Untätige/bereite (lebende, aber gerade weder arbeitende noch wartende) Sessions werden nicht automatisch belegt; sie können weiterhin manuell hinzugefügt werden.
- Q: Was ist die Auswahl-Einheit der automatischen Belegung — Feature-Konsolen oder einzelne Sessions? → A: **Feature-Konsolen** — wie heute gibt es höchstens eine Kachel pro Feature, ausgewählt anhand der aufmerksamkeitsbedürftigen Session dieses Features. Sessions ohne Feature-Bezug (z. B. Projekt-Chat) werden nicht automatisch belegt. Die Höchstzahl zählt Kacheln (Features).
- Q: Nur beim Öffnen bestimmen oder live nachrücken, während die Ansicht offen bleibt? → A: **Nur beim Öffnen** (bzw. bei Projektwechsel) wird die Belegung bestimmt. Es rückt nichts automatisch nach, solange die Ansicht offen ist; bereits angezeigte Kacheln aktualisieren jedoch ihren Zustand live.
- Q: Was bedeutet "zuletzt gestartet" für die Sortierung, wenn Sessions über mehrere Phasen fortgesetzt werden? → A: **Letzter Aktivitätszeitpunkt** — sortiert wird nach dem Zeitpunkt, zu dem die Session zuletzt zu arbeiten begann oder eine Rückfrage stellte (nicht nach dem ursprünglichen Erstellungszeitpunkt). Der Wunsch "zuletzt gestartet zuerst" wird also als "zuletzt aktiv zuerst" operationalisiert.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Aufmerksamkeitsbedürftige Sessions beim Öffnen automatisch sehen (Priority: P1)

Als Nutzer des SDD-Toolkits will ich beim Öffnen der Grid-Ansicht ohne manuelles Zusammensuchen sofort die Sessions sehen, die gerade laufen oder auf meine Antwort warten (z. B. eine Freigabe, ob Code ausgeführt werden darf), damit ich blockierte oder aktive Arbeit unmittelbar erkenne und darauf reagieren kann.

**Why this priority**: Dies ist der Kern des Wunsches ("sollen … automatisch angezeigt werden"). Bereits allein liefert es den Hauptnutzen: kein manuelles Kuratieren mehr, blockierte Sessions werden nicht mehr übersehen. Ohne diese Automatik hat das Feature keinen Wert.

**Independent Test**: In einem Projekt einige Sessions in unterschiedliche Zustände bringen (mindestens eine arbeitend, mindestens eine wartet auf eine Freigabe, mindestens eine beendet), die Grid-Ansicht öffnen und prüfen, dass die arbeitenden und wartenden Sessions automatisch als Konsolen erscheinen und die beendeten nicht.

**Acceptance Scenarios**:

1. **Given** ein Projekt mit einer arbeitenden und einer auf eine Freigabe wartenden Session, **When** der Nutzer die Grid-Ansicht öffnet, **Then** werden beide Sessions automatisch als Konsolen im Raster angezeigt, ohne dass der Nutzer sie manuell hinzufügen muss.
2. **Given** eine Session, die auf eine Rückfrage wartet, ob Code/ein Tool ausgeführt werden darf, **When** die Grid-Ansicht geöffnet wird, **Then** wird diese Session automatisch angezeigt.
3. **Given** ausschließlich beendete/gestoppte Sessions in einem Projekt, **When** die Grid-Ansicht geöffnet wird, **Then** wird keine dieser Sessions automatisch angezeigt (das Raster bleibt leer bzw. zeigt nur ggf. manuell Erhaltenes).
4. **Given** eine geöffnete Grid-Ansicht mit automatisch belegten Konsolen, **When** der Nutzer eine Session-Freigabe direkt aus der angezeigten Konsole beantwortet, **Then** kann er ohne Ansichtwechsel weiterarbeiten.

---

### User Story 2 - Neueste zuerst und Höchstzahl einhalten (Priority: P2)

Als Nutzer will ich, dass bei mehr aufmerksamkeitsbedürftigen Sessions als anzeigbaren Plätzen die zuletzt gestarteten Sessions bevorzugt und zuerst angezeigt werden und die Höchstzahl anzeigbarer Konsolen nie überschritten wird, damit die Ansicht übersichtlich bleibt und ich die aktuellsten Vorgänge zuerst sehe.

**Why this priority**: Verfeinert die Automatik aus Story 1 für den realistischen Fall vieler paralleler Sessions. Wertvoll, aber erst relevant, wenn die Grundautomatik steht.

**Independent Test**: Mehr aufmerksamkeitsbedürftige Sessions erzeugen, als Plätze verfügbar sind, mit unterschiedlichen Startzeitpunkten; Ansicht öffnen und prüfen, dass genau die Höchstzahl angezeigt wird, dass es die zuletzt gestarteten sind und dass sie in absteigender Startreihenfolge (neueste zuerst) erscheinen.

**Acceptance Scenarios**:

1. **Given** mehr aufmerksamkeitsbedürftige Sessions als anzeigbare Plätze, **When** die Grid-Ansicht geöffnet wird, **Then** werden höchstens so viele Konsolen angezeigt, wie die Höchstzahl erlaubt, und es werden die zuletzt gestarteten Sessions ausgewählt.
2. **Given** mehrere automatisch angezeigte Sessions, **When** das Raster befüllt wird, **Then** erscheinen die Sessions in der Reihenfolge zuletzt gestartet zuerst.
3. **Given** genau so viele oder weniger Kandidaten als Plätze, **When** die Ansicht geöffnet wird, **Then** werden alle Kandidaten angezeigt und keine unnötig weggelassen.

---

### User Story 3 - Automatische Auswahl manuell nachjustieren (Priority: P3)

Als Nutzer will ich die automatisch belegte Grid-Ansicht weiterhin manuell anpassen können (Konsolen hinzufügen oder entfernen), damit ich bei Bedarf auch eine nicht automatisch gewählte Session einsehen oder eine nicht relevante ausblenden kann.

**Why this priority**: Erhält die bestehende Flexibilität und verhindert, dass die Automatik den Nutzer einschränkt. Nachgelagert, da der Kernnutzen bereits durch die Automatik entsteht.

**Independent Test**: Nach automatischer Belegung eine zusätzliche (nicht automatisch gewählte) Konsole manuell hinzufügen und eine automatisch gewählte entfernen; prüfen, dass beide Aktionen möglich sind und die Höchstzahl weiterhin nicht überschritten werden kann.

**Acceptance Scenarios**:

1. **Given** eine automatisch belegte Grid-Ansicht mit freien Plätzen, **When** der Nutzer manuell eine weitere Konsole hinzufügt, **Then** wird diese zusätzlich angezeigt, solange die Höchstzahl nicht überschritten wird.
2. **Given** eine automatisch belegte Grid-Ansicht, **When** der Nutzer eine angezeigte Konsole entfernt, **Then** verschwindet sie aus dem Raster.
3. **Given** eine bereits bis zur Höchstzahl gefüllte Grid-Ansicht, **When** der Nutzer versucht, eine weitere Konsole hinzuzufügen, **Then** wird das verhindert bzw. erst nach Entfernen einer anderen ermöglicht.

---

### Edge Cases

- **Keine passenden Sessions**: Gibt es beim Öffnen keine arbeitenden oder wartenden Sessions, wird nichts automatisch belegt; die Ansicht bleibt leer (bzw. zeigt nur ggf. erhaltene manuelle Auswahl) und der Nutzer kann wie bisher manuell hinzufügen.
- **Gleicher Startzeitpunkt**: Haben mehrere Sessions denselben (oder keinen ermittelbaren) Startzeitpunkt, muss eine stabile, nachvollziehbare Reihenfolge gelten, damit die Anzeige nicht bei jedem Öffnen springt.
- **Projektwechsel**: Die automatische Belegung bezieht sich nur auf Sessions des aktuell ausgewählten Projekts; beim Wechsel des Projekts wird für das neue Projekt neu bewertet.
- **Zustandswechsel während geöffneter Ansicht**: Wechselt eine bereits angezeigte Session ihren Zustand (z. B. Freigabe beantwortet → arbeitet weiter, oder beendet), bleibt die Anzeige konsistent; die automatische Erstbefüllung erfolgt beim Öffnen (siehe Assumptions zur Live-Aktualisierung).
- **Höchstzahl exakt getroffen**: Sind genau so viele Kandidaten wie Plätze vorhanden, werden alle angezeigt, ohne dass ein manuelles Element verdrängt wird oder ein Platz leer bleibt.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Beim Öffnen der Grid-Ansicht MUSS das System automatisch die Sessions des aktuell ausgewählten Projekts ermitteln, die Aufmerksamkeit brauchen, und sie als Konsolen im Raster anzeigen — ohne manuelles Hinzufügen durch den Nutzer.
- **FR-002**: Als "aufmerksamkeitsbedürftig" MUSS das System Sessions einstufen, die (a) gerade arbeiten oder (b) auf eine Nutzer­antwort warten. Fall (b) MUSS insbesondere Freigabe­abfragen (ob Code/ein Tool ausgeführt werden darf), inhaltliche Rückfragen und Plan-Freigaben umfassen.
- **FR-003**: Beendete, gestoppte, fehlerhafte sowie untätige/bereite (lebende, aber gerade weder arbeitende noch wartende) Sessions MÜSSEN von der automatischen Anzeige ausgeschlossen werden (untätige bleiben manuell hinzufügbar).
- **FR-004**: Das System MUSS die automatisch angezeigten Sessions nach Startzeitpunkt absteigend sortieren (zuletzt gestartete zuerst).
- **FR-005**: Das System DARF die festgelegte Höchstzahl gleichzeitig angezeigter Konsolen NICHT überschreiten — weder durch die automatische Belegung noch in Kombination mit manuellen Ergänzungen.
- **FR-006**: Übersteigt die Zahl aufmerksamkeitsbedürftiger Sessions die verfügbaren Plätze, MUSS das System die zuletzt gestarteten Sessions bis zur Höchstzahl auswählen und die übrigen weglassen.
- **FR-007**: Der Nutzer MUSS die automatisch belegte Ansicht weiterhin manuell anpassen können (Konsolen hinzufügen und entfernen), wobei die Höchstzahl aus FR-005 gewahrt bleibt.
- **FR-008**: Die automatische Belegung MUSS sich ausschließlich auf Sessions des aktuell ausgewählten Projekts beziehen.
- **FR-009**: Bei gleichem oder nicht ermittelbarem Startzeitpunkt MUSS das System eine stabile, reproduzierbare Anzeigereihenfolge sicherstellen, damit die Belegung nicht bei jedem Öffnen wechselt.
- **FR-010**: Beim Öffnen der Grid-Ansicht (und bei Projektwechsel) MUSS das System die Belegung vollständig neu aus den aktuell aufmerksamkeitsbedürftigen Sessions bestimmen und dabei eine zuvor gespeicherte manuelle Auswahl ersetzen (override).
- **FR-011**: Die automatische Anzeige MUSS ausschließlich arbeitende und auf Antwort wartende Sessions umfassen; untätige/bereite Sessions werden nicht automatisch belegt (bleiben jedoch manuell hinzufügbar).
- **FR-012**: Die Auswahl-Einheit MUSS die Feature-Konsole sein: Pro Feature wird höchstens eine Kachel automatisch belegt, ausgewählt anhand der aufmerksamkeitsbedürftigen Session dieses Features. Hat ein Feature (theoretisch) mehrere solcher Sessions, wird die zuletzt gestartete für die Auswahl und Sortierung herangezogen.
- **FR-013**: Sessions ohne Feature-Bezug (z. B. eine projektweite Chat-Session) MÜSSEN von der automatischen Belegung ausgeschlossen bleiben. Die Höchstzahl aus FR-005 zählt Kacheln (Features).
- **FR-014**: Die automatische Belegung MUSS beim Öffnen der Ansicht sowie bei Projektwechsel bestimmt werden. Solange die Ansicht geöffnet bleibt, MUSS die Kachel-Auswahl NICHT automatisch nachrücken (keine neuen Sessions automatisch ergänzt, keine automatisch verdrängt); der Zustand bereits angezeigter Kacheln MUSS jedoch weiterhin live aktualisiert werden.

### Key Entities *(include if feature involves data)*

- **Session (Konsole)**: Eine laufende oder pausierte Arbeitseinheit eines Features innerhalb eines Projekts. Relevante Attribute: aktueller Zustand (arbeitend / auf Antwort wartend inkl. Art der Rückfrage / untätig / beendet), Zugehörigkeit zu Projekt und Feature, Startzeitpunkt.
- **Konsole (Kachel)**: Eine Rasterposition, die genau einem Feature des Projekts entspricht und dessen aktuelle Session darstellt. Höchstens eine Kachel pro Feature.
- **Grid-Ansicht (Raster)**: Die Zusammenstellung gleichzeitig angezeigter Konsolen (Feature-Kacheln) eines Projekts, begrenzt durch eine Höchstzahl an Plätzen, mit einer definierten Anzeige­reihenfolge.
- **Projekt**: Kontext, dem Sessions zugeordnet sind; die automatische Belegung ist projektbezogen.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Beim Öffnen der Grid-Ansicht sind ohne jede manuelle Aktion 100 % der aufmerksamkeitsbedürftigen Sessions des Projekts sichtbar (bis zur Höchstzahl); keine beendete Session wird automatisch angezeigt.
- **SC-002**: In keiner Situation werden mehr Konsolen angezeigt als die festgelegte Höchstzahl.
- **SC-003**: Bei mehr Kandidaten als Plätzen sind ausschließlich die N zuletzt gestarteten Sessions sichtbar (N = Höchstzahl), und sie erscheinen in absteigender Startreihenfolge.
- **SC-004**: Die Zeit vom Öffnen der Ansicht bis zum Erkennen einer auf Freigabe wartenden Session sinkt gegenüber dem manuellen Auswählen spürbar — der Nutzer muss keine Konsole mehr manuell hinzufügen, um sie zu sehen.
- **SC-005**: Wiederholtes Öffnen derselben Ansicht bei unverändertem Session-Zustand führt zu einer identischen, nicht springenden Belegung und Reihenfolge.

## Assumptions

- **Höchstzahl bleibt unverändert**: Die bestehende Obergrenze gleichzeitig angezeigter Konsolen (aktuell 9) wird beibehalten; das Feature ändert nur, *welche* Konsolen initial belegt werden, nicht die Höchstzahl.
- **Startzeitpunkt als Sortierkriterium**: "Zuletzt gestartet" bezieht sich auf den Erstellungs-/Startzeitpunkt der Session. Dieser Wert wird als vorhanden und für die Sortierung nutzbar angenommen (ggf. muss er für die Anzeige verfügbar gemacht werden).
- **Erstbefüllung beim Öffnen**: Die automatische Auswahl wird beim Öffnen der Ansicht (bzw. bei Projektwechsel) bestimmt. Eine kontinuierliche Live-Neubelegung, während die Ansicht offen bleibt (automatisches Nachrücken neu gestarteter Sessions), ist nicht Teil des Kernumfangs; bereits angezeigte Konsolen aktualisieren ihren Zustand jedoch wie bisher live.
- **Manuelle Anpassungen sind sitzungslokal**: Da die Belegung bei jedem Öffnen neu bestimmt wird (override, FR-010), gelten manuelle Ergänzungen/Entfernungen (US3) nur für die aktuell geöffnete Ansicht und werden beim nächsten Öffnen bzw. Projektwechsel durch die automatische Auswahl ersetzt.
- **Projektbezug**: Die Ansicht ist wie heute projektbezogen; nur Sessions des aktuell gewählten Projekts sind Kandidaten.
- **Bestehende Zustands- und Rückfrage-Konzepte werden wiederverwendet**: Die Unterscheidung "arbeitend / auf Antwort wartend (Freigabe, Rückfrage, Plan-Freigabe) / beendet" existiert bereits und wird nicht neu definiert.
