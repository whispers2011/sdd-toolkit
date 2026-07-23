# Feature Specification: „Braucht dich"-Meldungen optimieren (nur echte, aktuelle Meldungen)

**Feature Branch**: `feature/braucht-dich-meldungen-optimieren`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Wenn eine Meldung im Menupunkt „braucht dich" aufgeführt wird und die session aus irgendwelchen gründen weitergeführt wird, ohne über das braucht dich menu zu gehen, verschwindet die meldung nicht automatisch. Es dürfen hier nur effektive meldungen angezeigt werden, welche wo auch etwas zutun ist. Hat sich das problem von selbst erledigt oder ist nicht mehr aktuell, darf die meldung nicht stehen bleiben. z.B. wenn man zur konsole geht und diese bereits weiterläuft, dann sollte die meldung ebenfalls verschwinden"

## User Scenarios & Testing *(mandatory)*

Der Menüpunkt **„Braucht dich"** ist die Ausnahme-Inbox der Applikation: Sie sammelt projektweit alles, was menschliche Aufmerksamkeit erfordert. Jede Meldung gehört zu einer der folgenden Arten:

- **Frage** — eine Agent-/Feature-Session wartet auf eine Antwort oder eine Plan-Freigabe.
- **Verifikation rot** — eine Verifikation ist fehlgeschlagen.
- **Review-Gate FAIL** — ein Review-Gate wurde nicht bestanden.
- **Merge-Konflikt** — ein Merge-Konflikt wurde zur manuellen Klärung eskaliert.
- **Review fällig** — ein Feature wartet auf ein menschliches Review.
- **Agent-Fehler** — eine Agent-Session ist unerwartet beendet worden.

(Berechtigungs-Rückfragen erscheinen bewusst **nicht** in „Braucht dich" — das bleibt unverändert.)

**Das heutige Problem**: Meldungen werden angelegt, wenn ein Zustand eintritt, aber nur dann wieder entfernt, wenn genau der erwartete Weg beschritten wird (z. B. eine bestimmte Schaltfläche im Merge-Fluss, oder die Session wechselt exakt beobachtet zurück auf „arbeitet"). Löst sich die Situation auf einem anderen Weg auf — die Session läuft von selbst weiter, die Antwort wurde direkt in der Konsole gegeben, die Verifikation wurde erneut grün, der Konflikt ist bereits geklärt, oder die Applikation wurde neu gestartet — bleibt die Meldung als „Geist" stehen. Der:die Nutzer:in sieht dann Einträge, hinter denen faktisch nichts (mehr) zu tun ist.

Ziel dieses Features: In „Braucht dich" erscheinen **ausschliesslich Meldungen, deren zugrunde liegender Zustand aktuell noch aktiv ist**. Sobald sich eine Situation — egal auf welchem Weg — erledigt oder überholt hat, verschwindet die Meldung automatisch.

### User Story 1 - Erledigte oder überholte Meldungen verschwinden automatisch (Priority: P1)

Wenn der Zustand hinter einer „Braucht dich"-Meldung nicht mehr besteht, verschwindet die Meldung von selbst aus der Inbox — ohne dass der:die Nutzer:in sie anklicken oder über das „Braucht dich"-Menü gehen muss. Dadurch zeigt die Inbox immer nur das, was tatsächlich noch Handlung erfordert.

**Why this priority**: Das ist der Kern des gemeldeten Problems und liefert allein bereits den vollen Wert: eine vertrauenswürdige Inbox, in der jeder Eintrag echt ist. Ohne diese Story bleibt die Inbox unzuverlässig, mit ihr ist das eigentliche Ärgernis behoben.

**Independent Test**: Für jede Meldungsart einen Auslöser herstellen, die zugrunde liegende Situation anschliessend auf einem anderen Weg als über die Inbox auflösen und prüfen, dass die Meldung ohne Zutun verschwindet.

**Acceptance Scenarios**:

1. **Given** eine „Frage"-Meldung zu einer Feature-Session, **When** die Session aus beliebigem Grund weiterläuft (Antwort direkt in der Konsole gegeben, Auto-Modus fährt fort, o. Ä.), **Then** verschwindet die Meldung automatisch aus „Braucht dich".
2. **Given** eine „Frage"-Meldung, **When** der:die Nutzer:in die Feature-Konsole direkt öffnet (nicht über die Inbox) und die Session bereits weiterläuft, **Then** ist die zugehörige Meldung nicht mehr vorhanden.
3. **Given** eine „Review fällig"-Meldung, **When** das Review abgeschlossen wurde (auf beliebigem Weg), **Then** verschwindet die Meldung.
4. **Given** eine „Merge-Konflikt"-Meldung, **When** der Konflikt geklärt bzw. das Feature integriert ist, **Then** verschwindet die Meldung.
5. **Given** eine „Verifikation rot"- oder „Review-Gate FAIL"-Meldung, **When** ein späterer Durchlauf für dasselbe Feature erfolgreich (grün) ist, **Then** verschwindet die Meldung.
6. **Given** eine „Agent-Fehler"-Meldung, **When** dieselbe Session/dasselbe Feature wieder arbeitet bzw. der Fehler nicht mehr aktuell ist, **Then** verschwindet die Meldung.
7. **Given** mehrere Meldungen zu demselben Feature, von denen sich nur eine erledigt, **When** deren Zustand aufgelöst wird, **Then** verschwindet ausschliesslich diese eine Meldung; die übrigen bleiben stehen.

---

### User Story 2 - Inbox spiegelt den aktuellen Stand auch nach verpassten Ereignissen und Neustart (Priority: P2)

Auch wenn ein Auflösungs-Ereignis verpasst wurde oder die Applikation/der Server neu gestartet wurde, zeigt „Braucht dich" den realen aktuellen Stand. Meldungen, deren zugrunde liegender Zustand nicht (mehr) als aktiv bestätigt werden kann, werden nicht angezeigt.

**Why this priority**: Ohne diese Story können sich Geister-Meldungen über Neustarts hinweg dauerhaft festsetzen — genau der Fall „aus irgendwelchen Gründen weitergeführt". Sie härtet die Zuverlässigkeit von US1 gegen Lücken in der Ereignisverarbeitung ab, baut aber auf US1 auf und ist etwas seltener spürbar.

**Independent Test**: Offene Meldungen erzeugen, deren Zustand im Hintergrund auflösen bzw. die Applikation neu starten und prüfen, dass die Inbox nach dem Wiederaufruf nur noch aktive Situationen zeigt.

**Acceptance Scenarios**:

1. **Given** offene Meldungen und ein anschliessender Neustart von Applikation/Server, **When** „Braucht dich" erneut angezeigt wird, **Then** werden nur Meldungen gezeigt, deren Zustand aktuell noch aktiv ist; nicht mehr bestätigbare Meldungen erscheinen nicht.
2. **Given** die Inbox ist geöffnet, **When** sich ein Zustand im Hintergrund auflöst, **Then** verschwindet die Meldung zeitnah (innerhalb weniger Sekunden) ohne manuelles Neuladen.
3. **Given** eine Meldung, deren zugehörige Session gar nicht mehr existiert und deren Situation nicht mehr feststellbar aktiv ist, **When** die Inbox neu bewertet wird, **Then** wird die Meldung nicht angezeigt.

---

### User Story 3 - Zähler und Liste stimmen überein (Priority: P2)

Der Zähler/Badge am Menüpunkt „Braucht dich" und die tatsächlich angezeigte Liste stimmen überein. Es entsteht nicht der Eindruck offener Meldungen, während in der sichtbaren Inbox nichts steht.

**Why this priority**: Ein Badge, der „(3)" zeigt, während die Inbox „Nichts braucht dich gerade" meldet, ist für den:die Nutzer:in ebenso eine hängengebliebene, unerklärliche Meldung. Konsistenz zwischen Zähler und Liste ist Teil des Problems „Meldung verschwindet nicht". Unabhängig von US1/US2 test- und umsetzbar.

**Independent Test**: Eine Situation herstellen, in der Zähler und sichtbare Liste auseinanderlaufen könnten (z. B. Meldungen in unterschiedlichem Kontext-Scope), und prüfen, dass der Zähler exakt die Zahl der für den:die Nutzer:in sichtbaren, echten Meldungen widerspiegelt.

**Acceptance Scenarios**:

1. **Given** die Inbox zeigt genau N echte, aktive Meldungen, **When** der:die Nutzer:in den Zähler am Menüpunkt betrachtet, **Then** zeigt der Zähler ebenfalls N.
2. **Given** in der sichtbaren Inbox steht „Nichts braucht dich gerade", **When** der:die Nutzer:in den Menüpunkt betrachtet, **Then** zeigt der Zähler keine offenen Meldungen an.

---

### User Story 4 - Manuelles Erledigen bleibt möglich (Priority: P3)

Der:die Nutzer:in kann eine Meldung weiterhin manuell als erledigt markieren. Eine so entfernte Meldung bleibt entfernt.

**Why this priority**: Ergänzt die Automatik als bewusstes Sicherheitsnetz für Fälle, die der:die Nutzer:in ausserhalb des Systems bereits abgehandelt hat. Reiner Erhalt bestehenden Verhaltens, daher niedrigste Priorität.

**Independent Test**: Eine noch aktive Meldung manuell als erledigt markieren und prüfen, dass sie verschwindet und nicht sofort erneut auftaucht.

**Acceptance Scenarios**:

1. **Given** eine aktive Meldung, **When** der:die Nutzer:in sie als erledigt markiert, **Then** verschwindet sie und erscheint nicht unmittelbar wieder für denselben Zustand.

---

### Edge Cases

- **Zustand flattert** (löst sich auf und tritt danach erneut auf): Die alte Meldung verschwindet; für das erneute Auftreten wird eine neue Meldung erzeugt.
- **Zustand nicht eindeutig feststellbar** (z. B. Session existiert nicht mehr, Live-Status verloren): Die Meldung wird konservativ als nicht mehr aktiv behandelt und nicht angezeigt, sofern ihr Weiterbestehen nicht positiv bestätigt werden kann.
- **Mehrere gleichartige Meldungen** zu derselben Situation: Es bleibt bei höchstens einer offenen Meldung pro Situation (bestehende Zusammenfassungs-Logik bleibt erhalten).
- **Kontext-/Projekt-Scope**: Die Inbox bleibt auf das ausgewählte Projekt begrenzt; die automatische Bereinigung und der Zähler müssen konsistent zum selben Scope arbeiten.
- **Teilweise Auflösung**: Erledigt sich nur eine von mehreren Meldungen eines Features, bleiben die übrigen unberührt.

## Clarifications

### Session 2026-07-23

- Q: Soll „Braucht dich" (Liste und Zähler) pro ausgewähltem Projekt oder global über alle Projekte gelten? → A: Pro aktuell ausgewähltem Projekt; der Zähler wird an den Projekt-Scope der Liste angeglichen.
- Q: Sollen erledigte Fehler-/Fehlschlag-Meldungen (Agent-Fehler, Verifikation rot, Review-Gate FAIL) als Historie erhalten bleiben? → A: Nein — sie verschwinden still; es wird keine gesonderte Historie eingeführt (Fehler bleiben ohnehin in Konsole/Verlauf sichtbar).
- Q: Wie ist mit Meldungen umzugehen, deren Aktivität nach einem Neustart nicht bestätigbar ist (z. B. Session existiert nicht mehr)? → A: Konservativ entfernen — nur positiv als aktiv bestätigte Meldungen bleiben stehen.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Die „Braucht dich"-Inbox MUSS ausschliesslich Meldungen anzeigen, deren zugrunde liegender Zustand aktuell aktiv ist (es ist tatsächlich etwas zu tun).
- **FR-002**: Löst sich der Zustand hinter einer Meldung auf einem beliebigen Weg auf — nicht nur über die Inbox oder eine bestimmte Schaltfläche —, MUSS das System die Meldung automatisch und ohne Nutzerinteraktion entfernen.
- **FR-003**: „Frage"-Meldungen (Frage bzw. Plan-Freigabe) MÜSSEN verschwinden, sobald die zugehörige Session nicht mehr auf eine Eingabe wartet (z. B. weil sie wieder arbeitet oder beendet ist).
- **FR-004**: Öffnet der:die Nutzer:in die Konsole eines Features direkt und die Session läuft bereits weiter, MUSS die zugehörige Meldung nicht mehr angezeigt werden.
- **FR-005**: „Verifikation rot"- und „Review-Gate FAIL"-Meldungen MÜSSEN verschwinden, sobald ein späterer Verifikations-/Gate-Durchlauf desselben Features erfolgreich ist.
- **FR-006**: „Merge-Konflikt"-Meldungen MÜSSEN verschwinden, sobald der Konflikt geklärt bzw. das Feature integriert oder aus der Queue entfernt ist.
- **FR-007**: „Review fällig"-Meldungen MÜSSEN verschwinden, sobald das Review abgeschlossen ist.
- **FR-008**: „Agent-Fehler"-Meldungen MÜSSEN verschwinden, sobald der Fehler nicht mehr aktuell ist (z. B. dieselbe Session/dasselbe Feature arbeitet wieder oder wurde neu gestartet).
- **FR-009**: Während die Inbox geöffnet ist, MUSS sie den aktuellen Stand zeitnah widerspiegeln (automatische Aktualisierung, kein manuelles Neuladen nötig).
- **FR-010**: Nach einem Neustart von Applikation/Server MUSS das System offene Meldungen gegen den tatsächlichen aktuellen Zustand prüfen und dürfen Meldungen, deren Aktivität nicht mehr bestätigt werden kann, nicht anzeigen.
- **FR-011**: Der Zähler/Badge am Menüpunkt „Braucht dich" MUSS exakt die Anzahl der für den:die Nutzer:in sichtbaren, echten Meldungen des aktuell ausgewählten Projekts widerspiegeln (identischer Projekt-Scope wie die Liste).
- **FR-012**: Die automatische Entfernung einer erledigten Meldung DARF NICHT Meldungen entfernen, deren Zustand noch aktiv ist (Auflösung erfolgt je Meldung/Situation).
- **FR-013**: Tritt derselbe Zustand nach seiner Auflösung erneut auf, DARF eine neue Meldung erzeugt werden (Wiederauftreten ist ein neues Ereignis).
- **FR-014**: Das System MUSS weiterhin das explizite manuelle Erledigen einer Meldung unterstützen; eine so entfernte Meldung bleibt entfernt.
- **FR-015**: Kann der Zustand einer Meldung nicht eindeutig als weiterhin aktiv bestätigt werden, MUSS die Meldung konservativ als nicht mehr aktiv behandelt (nicht angezeigt) werden.

### Key Entities *(include if data involved)*

- **„Braucht dich"-Meldung**: Ein Eintrag in der Ausnahme-Inbox. Attribute: Art (Frage, Verifikation rot, Review-Gate FAIL, Merge-Konflikt, Review fällig, Agent-Fehler), zugehöriges Projekt, Bezug zu Feature/Session/Unterhaltung, Meldungstext, Erstellzeitpunkt, Erledigt-Status.
- **Zugrunde liegender Zustand (Wahrheitsquelle)**: Der reale, aktuelle Zustand, aus dem sich die Gültigkeit einer Meldung ableitet — z. B. ob eine Session auf Eingabe wartet, arbeitet oder beendet ist; ob eine Verifikation/ein Gate grün ist; ob ein Review erledigt ist; ob ein Merge-Konflikt geklärt ist. Eine Meldung ist nur gültig, solange dieser Zustand die Meldung weiterhin rechtfertigt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In den definierten Testszenarien verschwinden 100 % der Meldungen, deren zugrunde liegender Zustand sich auf einem beliebigen Weg aufgelöst hat — ohne Nutzerinteraktion.
- **SC-002**: Löst sich ein Zustand bei geöffneter Inbox im Hintergrund auf, verschwindet die zugehörige Meldung innerhalb von 5 Sekunden, ohne dass neu geladen werden muss.
- **SC-003**: Nach einem Neustart von Applikation/Server zeigt die Inbox 0 Meldungen an, deren Zustand nicht mehr aktiv ist.
- **SC-004**: Zähler/Badge und sichtbare Liste stimmen in 100 % der Fälle überein (keine Situation, in der der Zähler offene Meldungen anzeigt, während die Liste leer ist, oder umgekehrt).
- **SC-005**: Öffnet der:die Nutzer:in eine in „Braucht dich" gelistete Meldung, ist in 100 % der Fälle tatsächlich noch eine Handlung offen (kein Eintrag führt zu einem bereits erledigten/weiterlaufenden Zustand).

## Assumptions

- Gegenstand ist die bestehende „Braucht dich"-/Ausnahme-Inbox; der Umfang betrifft den Lebenszyklus/die Gültigkeit der Meldungen, nicht eine Neugestaltung der Inbox-Oberfläche.
- Berechtigungs-Rückfragen bleiben aus „Braucht dich" ausgeschlossen (bestehendes Verhalten).
- Die Inbox bleibt auf das aktuell ausgewählte Projekt begrenzt; der Zähler wird an denselben Scope angeglichen.
- Für jede Meldungsart lässt sich aus vorhandenem Live-/persistiertem Zustand ableiten, ob der zugrunde liegende Zustand noch aktiv ist.
- Die zeitnahe Aktualisierung nutzt den bereits vorhandenen Ereignis-/Aktualisierungsmechanismus der Applikation.
- „Agent-Fehler"-Meldungen sollen — im Sinne der Nutzeraussage „Hat sich das Problem von selbst erledigt … darf die Meldung nicht stehen bleiben" — automatisch verschwinden, sobald der Fehler nicht mehr aktuell ist, und erfordern keine gesonderte Quittierung.
- Erledigte Fehler-/Fehlschlag-Meldungen verschwinden still; es wird keine neue, gesonderte Fehler-Historie eingeführt (bestehende Konsolen-/Verlaufsansicht genügt).
