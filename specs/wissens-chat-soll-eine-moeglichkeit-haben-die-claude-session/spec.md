# Feature Specification: Wissens-Chat neu starten (frische Session)

**Feature Branch**: `feature/wissens-chat-soll-eine-moeglichkeit-haben-die-claude-session`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Im wissenchat soll es ein svg-icon geben um den chat neuzustarten. dadurch wird eine neue claude session im wissenschat erzeugt, sodass der user wieder clean einen neuen chat starten kann. Der chat wird automatisch gestartet"

## Kontext

Der Wissens-Chat (die Sprechblase unten rechts im geöffneten Projekt) ist heute eine **vollwertige,
persistente Claude-Session** pro Projekt: Beim Öffnen wird genau eine laufende Unterhaltung
fortgesetzt, deren gesamter Verlauf und Kontext erhalten bleibt. Es gibt derzeit **keine Möglichkeit,
diese Unterhaltung bewusst zu beenden und frisch neu anzufangen** — der Verlauf wächst immer weiter,
und wer „bei null" starten will, hat kein Mittel dafür.

Dieses Feature ergänzt im Wissens-Chat ein **SVG-Icon zum Neustart**. Ein Klick verwirft die aktuelle
Unterhaltung und erzeugt eine **neue, saubere Claude-Session** ohne bisherigen Kontext. Die neue
Session **startet automatisch** — der Nutzer muss nichts weiter tun und kann sofort clean weiter-tippen.

## Clarifications

### Session 2026-07-23

- Q: Wann soll vor dem Neustart eine Warnung/Bestätigung erscheinen? → A: Nur wenn die Session gerade arbeitet ODER unbestätigte Änderungen in ihrer Arbeitskopie liegen; eine ruhende Q&A-/leere Session startet ohne Rückfrage sofort neu.
- Q: Was passiert mit dem Verlauf (Nachrichten/Transkript) der verworfenen Unterhaltung? → A: Die alte Unterhaltung wird deaktiviert und im Datenbestand behalten (nicht mehr angezeigt, nicht gelöscht); nur ihre Arbeitskopie/Branch wird fallengelassen.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chat per Icon neu starten (Priority: P1)

Als Nutzer möchte ich im Wissens-Chat auf ein deutlich erkennbares Neustart-Icon klicken und damit
eine frische Unterhaltung beginnen. Der bisherige Verlauf verschwindet, eine neue, leere Claude-Session
wird erzeugt und automatisch gestartet, sodass ich sofort ohne Altkontext weiter-tippen kann.

**Why this priority**: Das ist der Kern des Features — der einzige Weg, den Chat bewusst „auf null"
zu setzen. Ohne diese Story existiert kein Mehrwert; alle weiteren Stories verfeinern nur das Verhalten
rund um den Neustart.

**Independent Test**: Wissens-Chat öffnen, ein paar Nachrichten austauschen, dann das Neustart-Icon
klicken. Prüfen, dass (a) der bisherige Verlauf nicht mehr sichtbar ist, (b) eine neue Session läuft
und ohne weiteren Klick bedienbar ist und (c) die neue Session nichts aus der vorherigen Unterhaltung
kennt.

**Acceptance Scenarios**:

1. **Given** ein geöffneter Wissens-Chat mit laufender Session, **When** der Nutzer das Neustart-Icon anklickt, **Then** wird die aktuelle Unterhaltung beendet und eine neue, leere Unterhaltung mit frischer Session begonnen.
2. **Given** ein soeben ausgelöster Neustart, **When** die neue Session bereitsteht, **Then** ist die Konsole leer (kein Verlauf der vorherigen Unterhaltung sichtbar) und sofort bedienbar, ohne dass der Nutzer die Session manuell starten muss.
3. **Given** eine neue Session nach Neustart, **When** der Nutzer eine Frage stellt, die sich auf die vorherige Unterhaltung bezieht („Was habe ich eben gefragt?"), **Then** hat die Session keinerlei Kenntnis des vorherigen Verlaufs (sauberer Neuanfang).
4. **Given** ein Neustart wurde durchgeführt, **When** der Nutzer das Panel schließt und erneut öffnet, **Then** wird die neue (leere/fortgesetzte) Unterhaltung angezeigt und **nicht** die verworfene.

---

### User Story 2 - Versehentlichen Verlust laufender Arbeit vermeiden (Priority: P2)

Weil die Wissens-Chat-Session eine vollwertige Arbeits-Session in einer isolierten Arbeitskopie ist,
kann sie unbestätigte Änderungen oder eine gerade laufende Aufgabe enthalten. Wenn ich den Neustart
auslöse, während so etwas aussteht, möchte ich vorher gewarnt werden, damit ich nicht versehentlich
laufende Arbeit wegwerfe. Ist nichts in Arbeit, soll der Neustart ohne Rückfrage sofort passieren.

**Why this priority**: Schützt vor unbeabsichtigtem Datenverlust, ohne den Normalfall (leere/ruhende
Session) mit Reibung zu belasten. Wichtig, aber nachrangig gegenüber der Grundfunktion (US1).

**Independent Test**: In der Session eine Änderung anstoßen bzw. während eines laufenden Turns das
Neustart-Icon klicken → prüfen, dass eine Bestätigung erscheint. In einer frischen, ruhenden Session
das Icon klicken → prüfen, dass der Neustart ohne Rückfrage sofort erfolgt.

**Acceptance Scenarios**:

1. **Given** eine Session, die gerade arbeitet oder unbestätigte Änderungen in ihrer Arbeitskopie hat, **When** der Nutzer das Neustart-Icon anklickt, **Then** erscheint eine Bestätigungsabfrage, die auf den drohenden Verlust hinweist, bevor irgendetwas verworfen wird.
2. **Given** die Bestätigungsabfrage, **When** der Nutzer bestätigt, **Then** wird die aktuelle Unterhaltung verworfen und der Neustart wie in US1 durchgeführt.
3. **Given** die Bestätigungsabfrage, **When** der Nutzer abbricht, **Then** bleibt die aktuelle Unterhaltung samt Verlauf und laufender Arbeit unverändert bestehen.
4. **Given** eine ruhende Session ohne laufende Arbeit und ohne unbestätigte Änderungen, **When** der Nutzer das Neustart-Icon anklickt, **Then** erfolgt der Neustart sofort ohne Bestätigungsabfrage.

---

### User Story 3 - Ressourcen der verworfenen Session aufräumen (Priority: P3)

Wenn ich den Chat wiederholt neu starte, sollen sich keine verwaisten Sessions oder Arbeitskopien
ansammeln. Die verworfene Session wird beendet und ihre isolierte Arbeitskopie samt Branch fallen
gelassen, sodass immer nur genau eine aktive Wissens-Chat-Session pro Projekt existiert.

**Why this priority**: Verhindert Ressourcenlecks und „Leichen" bei häufigem Neustart. Nutzer bemerkt
es nur indirekt (Stabilität/Ordnung), daher niedrigere Priorität als das sichtbare Verhalten.

**Independent Test**: Chat mehrfach hintereinander neu starten und prüfen, dass danach genau eine
aktive Session/Arbeitskopie für das Projekt existiert und keine verwaisten Arbeitskopien/Branches der
verworfenen Unterhaltungen zurückbleiben.

**Acceptance Scenarios**:

1. **Given** eine laufende Wissens-Chat-Session, **When** der Nutzer neu startet, **Then** wird die vorherige Session beendet und nicht weiter im Hintergrund fortgeführt.
2. **Given** mehrere aufeinanderfolgende Neustarts, **When** der Nutzer danach den Chat betrachtet, **Then** existiert genau eine aktive Session/Arbeitskopie für dieses Projekt.
3. **Given** ein Neustart der verworfenen Unterhaltung, **When** deren isolierte Arbeitskopie fallen gelassen wird, **Then** bleiben andere Projekte und laufende Feature-Sessions davon unberührt.

---

### Edge Cases

- **Neustart während eines laufenden Turns**: Die Session antwortet gerade → es greift die Warnung aus US2; nach Bestätigung wird der laufende Turn beendet und die neue Session sauber gestartet.
- **Offener Feature-Vorschlag beim Neustart**: Existiert eine noch nicht bestätigte Feature-Vorschlagskarte, wird sie mit der verworfenen Unterhaltung entfernt; bereits angelegte Features bleiben unberührt.
- **Neue Session kann nicht gestartet werden** (z. B. Arbeitskopie/Session-Provider lokal nicht verfügbar): Der Chat zeigt eine verständliche Fehlermeldung; der Nutzer verliert nicht kommentarlos den Zugang und kann den Neustart erneut versuchen.
- **Mehrfaches schnelles Klicken auf das Neustart-Icon**: Es entsteht nur **eine** neue Session; parallele/doppelte Neustarts werden zusammengeführt oder abgewiesen, keine Häufung von Sessions.
- **Panel wird direkt nach dem Neustart geschlossen**: Beim erneuten Öffnen wird die neue Unterhaltung angezeigt, der Neustart bleibt wirksam.
- **Neustart bei ohnehin schon leerer, frischer Session**: Der Neustart ist unschädlich — es entsteht wieder eine leere Session, kein Fehler.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Der Wissens-Chat MUSS ein deutlich erkennbares, als SVG hinterlegtes Neustart-Icon anzeigen, das jederzeit erreichbar ist, solange der Chat geöffnet ist.
- **FR-002**: Ein Klick auf das Neustart-Icon MUSS die aktuell aktive Unterhaltung **deaktivieren** (als inaktiv markieren und im Datenbestand behalten — **nicht** löschen) und eine neue, leere Unterhaltung als aktive Unterhaltung des Projekts setzen.
- **FR-003**: Der Neustart MUSS eine **frische Claude-Session ohne bisherigen Kontext** erzeugen — die neue Session darf den Verlauf der verworfenen Unterhaltung nicht kennen oder fortsetzen (kein Resume des alten Kontexts).
- **FR-004**: Die neue Session MUSS nach dem Neustart **automatisch gestartet** werden und ohne weiteren Nutzer-Schritt bedienbar sein.
- **FR-005**: Nach dem Neustart MUSS die Chat-Anzeige die neue, leere Unterhaltung darstellen und darf keinen Verlauf der verworfenen Unterhaltung mehr anzeigen.
- **FR-006**: Wenn die aktuelle Session arbeitet oder unbestätigte Änderungen in ihrer Arbeitskopie enthält, MUSS das System vor dem Verwerfen eine Bestätigung einholen; bei einer ruhenden Session ohne unbestätigte Änderungen MUSS der Neustart ohne Rückfrage sofort erfolgen.
- **FR-007**: Beim Neustart MUSS die verworfene Session beendet und ihre zugehörige isolierte Arbeitskopie samt Branch fallen gelassen werden, ohne andere Projekte oder laufende Feature-Sessions zu beeinträchtigen.
- **FR-008**: Das System MUSS sicherstellen, dass pro Projekt zu jedem Zeitpunkt höchstens eine aktive Wissens-Chat-Session existiert; wiederholte oder schnell aufeinanderfolgende Neustarts dürfen keine Ansammlung paralleler Sessions verursachen.
- **FR-009**: Ein offener, noch nicht bestätigter Feature-Vorschlag der verworfenen Unterhaltung MUSS mit dem Neustart entfernt werden; bereits angelegte Features bleiben unberührt.
- **FR-010**: Schlägt das Starten der neuen Session fehl, MUSS der Chat eine verständliche Fehlermeldung anzeigen und einen erneuten Neustart-Versuch ermöglichen.

### Key Entities

- **Wissens-Chat-Session**: Die aktive, vollwertige Claude-Session einer Unterhaltung, laufend in einer isolierten Arbeitskopie/Branch pro Projekt. Trägt den Gesprächskontext; beim Neustart wird sie beendet und ersetzt.
- **Unterhaltung (Conversation)**: Die pro Projekt aktive Gesprächseinheit, an die Verlauf und Session gebunden sind. Der Neustart deaktiviert die bisherige (bleibt inaktiv im Datenbestand erhalten, wird nicht mehr angezeigt und nicht gelöscht) und legt eine neue als aktiv an.
- **Feature-Vorschlag**: Eine ggf. offene Bestätigungskarte der aktuellen Unterhaltung; an die Unterhaltung gebunden und beim Neustart mit ihr verworfen.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Der Neustart ist mit **einem einzigen Klick** aus dem geöffneten Wissens-Chat erreichbar (ohne Menü/Umweg).
- **SC-002**: Nach Auslösen des Neustarts ist die neue Session in **unter 5 Sekunden** bedienbar, ohne dass der Nutzer sie manuell starten muss.
- **SC-003**: In **100 %** der Neustarts zeigt die neue Session **keinerlei** Inhalte oder Kontext der vorherigen Unterhaltung.
- **SC-004**: Nach beliebig vielen aufeinanderfolgenden Neustarts existiert **genau eine** aktive Wissens-Chat-Session pro Projekt; **0** verwaiste Arbeitskopien/Branches der verworfenen Unterhaltungen bleiben zurück.
- **SC-005**: **0** Fälle, in denen laufende Arbeit oder unbestätigte Änderungen ohne vorherige Warnung verworfen werden.

## Assumptions

- „Wissens-Chat" bezeichnet denselben Chat, der heute über die Sprechblase unten rechts im geöffneten Projekt erreichbar ist (bisher auch „Projekt-Chat" genannt) und als vollwertige, persistente Claude-Session pro Projekt läuft.
- Der Neustart bezieht sich auf die Session des **aktuell geöffneten Projekts**; andere Projekte und deren Chats sind nicht betroffen.
- „Clean" bedeutet: neue, leere Unterhaltung ohne Verlauf und ohne Fortsetzung (Resume) der vorherigen Session — nicht das Zurücksetzen von Projektdaten außerhalb der Chat-Unterhaltung.
- Verwerfen der alten Session bedeutet, ihre isolierte Arbeitskopie/Branch fallen zu lassen (analog zum bestehenden Verhalten „Verwerfen = Worktree/Branch fallenlassen"); dort noch nicht gesicherte Änderungen gehen dabei bewusst verloren — deshalb die Warnung aus US2.
- Das Neustart-Icon wird im Kopfbereich des Chat-Panels platziert, nahe den bestehenden Bedienelementen (z. B. Schließen), und nutzt das im Projekt vorhandene SVG-Icon-Set.
- Der Automatisierungsgrad (Freigabe-/Automation-Verhalten) der neuen Session entspricht dem der bisherigen Wissens-Chat-Session; der Neustart ändert diese Einstellung nicht.
