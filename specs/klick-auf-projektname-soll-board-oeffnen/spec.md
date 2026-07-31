# Feature Specification: Projekt-Klick öffnet Board-Ansicht

**Feature Branch**: `feature/klick-auf-projektname-soll-board-oeffnen`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Klickt der User in der linken sidebar auf ein Projekt, soll sich die Board ansicht des entsprechenden Projekts öffnen"

## Clarifications

### Session 2026-07-22

- Q: Soll ein Klick auf »Alle Projekte« ebenfalls zur Board-Ansicht wechseln, oder wie bisher nur den Projekt-Filter setzen? → A: Unverändert — nur Filter setzen, aktive Ansicht bleibt stehen.
- Q: Klick auf den Projektnamen, während bereits die Konsole/das Terminal genau dieses Projekts offen ist — zum Board wechseln oder Konsole behalten? → A: Immer zum Board wechseln (auch bei eigener aktiver Konsole).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ein-Klick zum Projekt-Board (Priority: P1)

Ein Nutzer klickt in der linken Sidebar auf einen Projektnamen und landet unmittelbar in der Board-Ansicht dieses Projekts. Das Board zeigt ausschließlich die Features des angeklickten Projekts, und das Projekt ist als aktiv hervorgehoben.

**Why this priority**: Dies ist der Kern des Features. Ohne diesen Schritt gibt es keinen Mehrwert. Er verkürzt den bisher zweistufigen Weg (Projekt auswählen → Board-Tab öffnen) auf einen einzigen Klick und macht das Projekt-Board zum erwartbaren Ziel eines Projekt-Klicks.

**Independent Test**: Kann vollständig getestet werden, indem man von einer beliebigen Ansicht aus auf einen Projektnamen klickt und prüft, dass daraufhin die Board-Ansicht erscheint, auf dieses Projekt beschränkt ist und das Projekt in der Sidebar als ausgewählt markiert ist.

**Acceptance Scenarios**:

1. **Given** der Nutzer befindet sich in einer anderen Ansicht (z. B. „Läufe", „Grid" oder „Braucht dich"), **When** er in der Sidebar auf einen Projektnamen klickt, **Then** öffnet sich die Board-Ansicht dieses Projekts und zeigt nur dessen Features.
2. **Given** mehrere Projekte sind in der Sidebar vorhanden, **When** der Nutzer auf ein Projekt klickt, **Then** ist genau dieses Projekt als aktiv hervorgehoben und der Board-Inhalt ist auf dieses Projekt beschränkt.
3. **Given** das angeklickte Projekt hat keine (sichtbaren) Features, **When** die Board-Ansicht öffnet, **Then** wird ein leeres, auf das Projekt bezogenes Board angezeigt (kein Fehler, kein Inhalt fremder Projekte).

---

### User Story 2 - Projektwechsel per Klick von überall (Priority: P2)

Ein Nutzer wechselt mit einem einzigen Klick zwischen den Boards verschiedener Projekte, unabhängig davon, wo er sich gerade befindet — auch aus einer geöffneten Feature-Konsole oder einem Projekt-Terminal heraus.

**Why this priority**: Erhöht den Nutzen des P1-Verhaltens im Alltag mit mehreren Projekten. Nicht zwingend für den ersten Wert, aber deutlich komfortabler beim Kontextwechsel.

**Independent Test**: Kann getestet werden, indem man das Board von Projekt A öffnet, danach in der Sidebar auf Projekt B klickt und prüft, dass das Board unmittelbar auf Projekt B umschaltet; anschließend dasselbe aus einer geöffneten Feature-Konsole heraus.

**Acceptance Scenarios**:

1. **Given** die Board-Ansicht von Projekt A ist geöffnet, **When** der Nutzer auf Projekt B klickt, **Then** zeigt das Board sofort die Features von Projekt B.
2. **Given** der Nutzer betrachtet die Feature-Konsole oder das Terminal eines Projekts, **When** er auf einen Projektnamen in der Sidebar klickt, **Then** wechselt die Ansicht zum Board des angeklickten Projekts.
3. **Given** die Board-Ansicht von Projekt A ist bereits geöffnet und Projekt A ist ausgewählt, **When** der Nutzer erneut auf Projekt A klickt, **Then** bleibt das Board von Projekt A sichtbar (die Aktion ist wiederholbar ohne Nebeneffekte).

---

### Edge Cases

- **Aktionselemente in der Projektzeile**: Klicks auf die zeileninternen Aktionen (Feature anlegen „+", Projekt-Terminal „>_", Einstellungen „⚙") führen ihre jeweilige Aktion aus und dürfen **nicht** zusätzlich das Board öffnen.
- **Feature-Klick**: Ein Klick auf einen Feature-Eintrag (Unterpunkt eines Projekts) öffnet weiterhin die zugehörige Feature-Konsole, nicht das Board.
- **Projekt ohne sichtbare Features**: Bei aktivem Filter „Abgeschlossene ausblenden" und ausschließlich abgeschlossenen Features zeigt das Board einen leeren/gefilterten Zustand, ohne Features anderer Projekte einzublenden.
- **Bereits ausgewähltes Projekt / bereits auf Board**: Erneuter Klick auf dasselbe Projekt hält das Board stabil (idempotent), ohne laufende Prozesse zu stören.
- **Wechsel aus aktiver Konsole**: Der Ansichtswechsel zum Board unterbricht keine laufende Session; die Konsole bleibt im Hintergrund erhalten und ist erneut erreichbar.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS beim Klick auf einen Projekteintrag (Projektname bzw. Projektzeile) in der Sidebar die Board-Ansicht des angeklickten Projekts öffnen.
- **FR-002**: Die geöffnete Board-Ansicht MUSS auf das angeklickte Projekt beschränkt sein und ausschließlich dessen Features anzeigen.
- **FR-003**: Der Klick MUSS das angeklickte Projekt als aktives/ausgewähltes Projekt setzen und es in der Sidebar entsprechend hervorheben.
- **FR-004**: Das Board-Öffnen MUSS unabhängig von der zuvor aktiven Ansicht funktionieren (u. a. Board, Grid, Läufe, Braucht dich, Feature-Konsole, Projekt-Terminal) und stets zum Board wechseln — auch dann, wenn die aktuell offene Konsole bzw. das Terminal bereits zum angeklickten Projekt gehört.
- **FR-005**: Klicks auf die projektbezogenen Aktionselemente innerhalb der Projektzeile (Feature anlegen, Projekt-Terminal, Projekt-Einstellungen) MÜSSEN weiterhin ausschließlich ihre bisherige Aktion ausführen und DÜRFEN NICHT das Board öffnen.
- **FR-006**: Ein Klick auf einen Feature-Eintrag (Unterpunkt eines Projekts) MUSS weiterhin die zugehörige Feature-Konsole öffnen und NICHT das Board.
- **FR-007**: Der durch den Klick ausgelöste Ansichtswechsel MUSS rein visuell/navigatorisch sein und laufende Sessions oder Prozesse unberührt lassen (kein Abbruch, kein Datenverlust).
- **FR-008**: Der Eintrag »Alle Projekte« MUSS sein bisheriges Verhalten behalten (setzt den Scope auf alle Projekte) und DARF KEINEN erzwungenen Wechsel zur Board-Ansicht auslösen; die aktuell aktive Ansicht bleibt erhalten.

### Key Entities *(include if data involved)*

- **Projekt**: Ein in der Sidebar gelistetes Repository mit Name, Farbe und aktuellem Branch; besitzt zugeordnete Features.
- **Feature**: Eine Arbeitseinheit innerhalb eines Projekts; auf dem Board als Karte dargestellt.
- **Ansichts-/Auswahlzustand**: Beschreibt, welche Ansicht aktiv ist (u. a. Board) und welches Projekt aktuell ausgewählt/fokussiert ist.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100 % der Fälle zeigt ein Klick auf einen Projektnamen unmittelbar die auf dieses Projekt beschränkte Board-Ansicht.
- **SC-002**: Der Nutzer erreicht das Board eines Projekts mit genau einem Klick (statt der bisherigen zwei Schritte: Projekt auswählen + Board-Tab öffnen).
- **SC-003**: Der Ansichtswechsel erfolgt für den Nutzer ohne wahrnehmbare Verzögerung (unter 1 Sekunde) und ohne manuellen Zwischenschritt.
- **SC-004**: Klicks auf zeileninterne Aktionselemente lösen in 0 % der Fälle einen ungewollten Board-Wechsel aus.
- **SC-005**: Der Board-Wechsel unterbricht in 0 % der Fälle eine laufende Feature-Session (keine abgebrochenen Prozesse durch den Klick).

## Assumptions

- Es existiert bereits eine Board-Ansicht (Kanban), die sich auf ein einzelnes Projekt beschränken lässt; dieses Feature verändert nur, wann/wodurch sie geöffnet wird, nicht ihr internes Verhalten.
- Der Klickbereich „Projekt" bezieht sich auf den Projektnamen bzw. die Projektzeile, nicht auf die darin enthaltenen Aktionselemente oder die untergeordneten Feature-Einträge.
- Das Verhalten des Eintrags „Alle Projekte" bleibt bewusst unverändert (siehe FR-008): projektübergreifender Scope ohne erzwungenen Board-Wechsel.
- Klickt der Nutzer auf den Projektnamen, während er bereits die Feature-Konsole desselben Projekts betrachtet, ist der bewusste Wechsel zum Board gewünscht (siehe FR-004) — vorhersehbare, konsistente Navigation.
- Der Filter „Abgeschlossene ausblenden" bleibt beim Board-Wechsel wirksam und wird durch dieses Feature nicht verändert.
