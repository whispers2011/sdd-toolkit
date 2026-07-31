# Feature Specification: Nur ein Projektkontext — „Alle Projekte" entfernen

**Feature Branch**: `feature/remove-alle-projekte`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Es darf immer nur 1 projekt kontext gleichzeitig gewählt sein. Die funktion um über alle projekte den kontext abzurufen soll entfernt werden"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Strikter Ein-Projekt-Kontext in allen Ansichten (Priority: P1)

Als Nutzer arbeite ich immer im Kontext genau eines Projekts. Die Auswahlmöglichkeit „Alle Projekte" existiert nicht mehr; jede Ansicht (Board, Raster, Posteingang, Ausführungen) zeigt ausschließlich Inhalte des aktuell gewählten Projekts. Es gibt keinen Weg mehr, Inhalte mehrerer Projekte gleichzeitig abzurufen.

**Why this priority**: Das ist der Kern des Features — die projektübergreifende Sicht ist die Funktion, die entfernt werden soll. Ohne diese Änderung liefert nichts anderes Wert.

**Independent Test**: Kann vollständig getestet werden, indem man mit mindestens zwei Projekten (mit jeweils eigenen Features) die Anwendung öffnet und prüft: (a) keine „Alle Projekte"-Option in der Projektauswahl, (b) jede Ansicht zeigt nur Inhalte des gewählten Projekts.

**Acceptance Scenarios**:

1. **Given** zwei Projekte mit jeweils eigenen Features, **When** der Nutzer die Projektauswahl betrachtet, **Then** gibt es keine Option „Alle Projekte" — nur die einzelnen Projekte sind wählbar.
2. **Given** Projekt A ist gewählt, **When** der Nutzer Board-, Raster-, Posteingang- oder Ausführungs-Ansicht öffnet, **Then** erscheinen ausschließlich Inhalte von Projekt A; Inhalte von Projekt B sind nirgends sichtbar.
3. **Given** Projekt A ist gewählt, **When** der Nutzer in der Seitenleiste Projekt B anklickt, **Then** wechselt der gesamte Kontext auf Projekt B und alle Ansichten zeigen nur noch Inhalte von Projekt B.

---

### User Story 2 - Automatische Projektwahl beim Start (Priority: P2)

Als Nutzer sehe ich beim Öffnen der Anwendung sofort den Kontext genau eines Projekts, ohne selbst wählen zu müssen. Es gibt keinen Zustand „kein Projekt gewählt", solange mindestens ein Projekt existiert.

**Why this priority**: Der bisherige Startzustand war „Alle Projekte". Fällt diese Option weg, braucht der Start einen definierten Ersatz — sonst entsteht ein undefinierter Zustand.

**Independent Test**: Anwendung mit vorhandenen Projekten neu laden und prüfen, dass ohne Nutzerinteraktion genau ein Projekt als aktiver Kontext markiert ist.

**Acceptance Scenarios**:

1. **Given** mehrere Projekte existieren und der Nutzer hatte zuletzt Projekt B gewählt, **When** die Anwendung neu geladen wird, **Then** ist Projekt B automatisch als aktiver Kontext gewählt.
2. **Given** mehrere Projekte existieren und es gibt keine gemerkte letzte Auswahl, **When** die Anwendung geladen wird, **Then** ist das erste Projekt der Liste automatisch gewählt.

---

### User Story 3 - Robuster Kontextwechsel bei Sonderfällen (Priority: P3)

Als Nutzer lande ich auch in Sonderfällen (aktives Projekt wird entfernt, Inhalt eines anderen Projekts wird geöffnet, kein Projekt vorhanden) immer in einem eindeutigen Ein-Projekt-Kontext oder einem klaren Leerzustand.

**Why this priority**: Sichert die Invariante „genau ein Kontext" gegen Randfälle ab; betrifft seltenere Abläufe als P1/P2.

**Independent Test**: Einzeln testbar durch: Entfernen des aktiven Projekts, Öffnen eines fremden Features über eine Benachrichtigung oder den Schnellwechsler, Start ohne Projekte.

**Acceptance Scenarios**:

1. **Given** Projekt A ist aktiver Kontext, **When** Projekt A entfernt wird, **Then** wechselt der Kontext automatisch auf ein anderes vorhandenes Projekt.
2. **Given** Projekt A ist gewählt, **When** der Nutzer über eine Benachrichtigung oder den Schnellwechsler ein Feature aus Projekt B öffnet, **Then** wechselt der aktive Kontext automatisch auf Projekt B.
3. **Given** es existiert kein Projekt, **When** die Anwendung geladen wird, **Then** erscheint ein Leerzustand mit der Aufforderung, ein Projekt hinzuzufügen; projektbezogene Ansichten zeigen keine Inhalte.

---

### Edge Cases

- Was passiert, wenn das letzte verbleibende Projekt entfernt wird? → Übergang in den Leerzustand („Noch keine Projekte"), kein Rest-Kontext.
- Was passiert, wenn die gemerkte letzte Projektauswahl auf ein inzwischen entferntes Projekt zeigt? → Rückfall auf das erste vorhandene Projekt.
- Wie verhält sich das erste Hinzufügen eines Projekts aus dem Leerzustand? → Das neue Projekt wird automatisch aktiver Kontext.
- Was passiert mit offenen Detailansichten (z. B. Konsole/Terminal) eines Projekts beim Wechsel auf ein anderes Projekt? → Sie werden geschlossen bzw. durch die Standardansicht des neuen Projekts ersetzt; es bleiben keine fremden Inhalte stehen (bestehendes Verhalten bleibt erhalten).
- Erreichen Benachrichtigungen den Nutzer weiterhin für alle Projekte? → Ja; Benachrichtigungen sind kein „Kontextabruf". Ein Klick darauf wechselt den Kontext auf das betroffene Projekt.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Solange mindestens ein Projekt existiert, MUSS zu jedem Zeitpunkt genau ein Projekt als aktiver Kontext gewählt sein — nie keines und nie mehrere.
- **FR-002**: Die Auswahlmöglichkeit „Alle Projekte" (projektübergreifender Kontext) MUSS aus der Projektauswahl entfernt werden; es DARF keinen Bedienweg mehr geben, Inhalte mehrerer Projekte gleichzeitig abzurufen.
- **FR-003**: Alle projektbezogenen Ansichten und Listen (Board, Raster, Posteingang, Ausführungen, Feature-Listen) MÜSSEN ausschließlich Inhalte des aktiven Projekts anzeigen.
- **FR-004**: Beim Start der Anwendung MUSS automatisch ein Projekt als Kontext gewählt werden: das zuletzt gewählte Projekt, andernfalls das erste Projekt der Liste.
- **FR-005**: Die Projektauswahl MUSS über Neustarts der Anwendung hinweg gemerkt werden.
- **FR-006**: Wird das aktive Projekt entfernt, MUSS der Kontext automatisch auf ein anderes vorhandenes Projekt wechseln.
- **FR-007**: Öffnet der Nutzer einen Inhalt eines anderen Projekts (z. B. über Benachrichtigung, Schnellwechsler oder Feature-Klick), MUSS der aktive Kontext automatisch auf dieses Projekt wechseln.
- **FR-008**: Existiert kein Projekt, MUSS die Anwendung einen Leerzustand mit Aufforderung zum Hinzufügen eines Projekts anzeigen; wird das erste Projekt hinzugefügt, MUSS es automatisch aktiver Kontext werden.

### Key Entities

- **Projekt**: Ein verwaltetes Arbeitsvorhaben (Repository) mit eigenen Features, Sitzungen und Ausführungen; die Einheit, auf die der Kontext beschränkt wird.
- **Aktiver Projektkontext**: Die genau eine, jederzeit definierte Projektauswahl; steuert, welche Inhalte alle Ansichten zeigen; wird über Neustarts gemerkt.
- **Feature**: Ein Arbeitsstand innerhalb eines Projekts; ist immer genau einem Projekt zugeordnet und nur in dessen Kontext sichtbar.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In keiner Ansicht der Anwendung sind zu irgendeinem Zeitpunkt Inhalte aus mehr als einem Projekt gleichzeitig sichtbar (0 Vorkommen bei Prüfung aller Ansichten mit mindestens zwei Projekten).
- **SC-002**: Nach dem Laden der Anwendung ist ohne jede Nutzerinteraktion genau ein Projekt als Kontext gewählt, sofern Projekte existieren (100 % der Startvorgänge).
- **SC-003**: Die Option „Alle Projekte" ist in der gesamten Oberfläche nicht mehr auffindbar.
- **SC-004**: 100 % der Navigationswege zu einem Inhalt (Seitenleiste, Benachrichtigung, Schnellwechsler) enden in einem Zustand, in dem der aktive Projektkontext mit dem angezeigten Inhalt übereinstimmt.
- **SC-005**: Nutzer finden nach einem Neustart ihre letzte Projektauswahl unverändert vor (100 % der Fälle, solange das Projekt noch existiert).

## Assumptions

- Die zuletzt gewählte Projektauswahl wird lokal gemerkt; als Rückfallebene dient das erste Projekt in der bestehenden Listenreihenfolge.
- Desktop-Benachrichtigungen bleiben projektübergreifend aktiv — entfernt wird nur der projektübergreifende **Abruf/Anzeige**-Kontext, nicht die Zustellung von Hinweisen.
- Das bestehende Verhalten der Kontext-Trennung beim Projektwechsel (fremde Konsolen-/Terminal-Ansichten werden geschlossen) bleibt unverändert bestehen und wird auf die neuen Wechselwege (automatischer Wechsel, Startwahl) ausgeweitet.
- Es sind keine Daten zu migrieren; die Änderung betrifft ausschließlich Auswahl- und Anzeigeverhalten.
- Mit „Funktion zum Abrufen des Kontexts über alle Projekte" ist die Nutzersicht „Alle Projekte" gemeint (projektübergreifende Anzeige), nicht ein externer Programmierschnittstellen-Endpunkt.
