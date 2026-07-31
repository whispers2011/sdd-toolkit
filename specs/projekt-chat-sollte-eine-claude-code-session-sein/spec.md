# Feature Specification: Projekt-Chat als vollwertige Claude-Code-Session

**Feature Branch**: `feature/projekt-chat-sollte-eine-claude-code-session-sein`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Der aktuelle projektchat sendet daten an claude und gibt diese wieder. Ich möchte aber eine vollwärtige claude code session haben die auch änderungen implementieren und probleme lösen kann."

## Kontext

Der heutige Projekt-Chat (Sprechblase unten rechts, Feature „Ask-a-Question-Bot") beantwortet
Fragen zum Projekt **strikt lesend**: Jeder Turn läuft als kurzlebiger Assistenz-Lauf im
Projekt-Root und darf ausschließlich lesen — er kann keine Dateien ändern, keine Kommandos
ausführen und keine Probleme praktisch lösen. Der Nutzer möchte den Chat zu einer
**vollwertigen Arbeits-Session** ausbauen, die dieselben Anfragen nicht nur beantwortet,
sondern die beschriebenen Änderungen auch **umsetzt** und Probleme **löst** — ohne dafür
zwingend den vollen Feature-Workflow (Spec → Plan → Tasks → Implement) durchlaufen zu müssen.

## Clarifications

### Session 2026-07-22

- Q: Wo landen die Änderungen der schreibenden Session — Haupt-Arbeitskopie oder isolierte Kopie/Branch? → A: Isolierte Arbeitskopie/Branch pro Arbeits-Session (wie Features); abgeschlossene Arbeit läuft über den bestehenden Verifikations-/Merge-Weg, Verwerfen = Worktree/Branch fallenlassen.
- Q: Ersetzt die Arbeits-Session den bisherigen Nur-Lese-Chat, oder bleiben beide erhalten? → A: Beide erhalten — der Nutzer wählt pro Unterhaltung explizit zwischen „Fragen (lesend, im Projekt-Root, keine Artefakte)" und „Arbeiten (eingreifend, in isolierter Arbeitskopie)".
- Q: Nach welcher Freigabe-/Autonomie-Regel handelt die Arbeits-Session? → A: Sie nutzt denselben Freigabe-/Inbox-Fluss und erbt den Automation-Dial (Level 2 ↔ 3) wie Feature-Sessions; kein separates Modell.

### Session 2026-07-22 (Überarbeitung)

Vereinfachung nach Rücksprache — der Chat ist **nur noch eine einzige, vollwertige Claude-Session**:

- Q: Zwei Modi (Fragen/Arbeiten)? → A: Nein. Der „Fragen"-Modus entfällt; es wird **immer** eine
  vollwertige Claude-Session gespawnt (kein Modus-Umschalter mehr).
- Q: Prompt-Eingabefeld? → A: Nein — man tippt **direkt in die Konsole**.
- Q: Steuerbuttons Unterbrechen/Übernehmen/Verwerfen? → A: Entfallen alle. Es ist einfach eine
  Session; ihre Änderungen liegen isoliert in der Worktree und werden nicht über Chat-Buttons
  gemergt/verworfen.
- Q: Fenstergröße? → A: Das Panel ist **frei vergrößer-/verkleinerbar**.
- Q: Feature-Anlage? → A: Erkennt die Session, dass sich ein oder mehrere Features
  herauskristallisieren, weist sie darauf hin und gibt einen Marker aus; das Toolkit zeigt eine
  **Bestätigungskarte**, über die der Nutzer die Anlage (Teilmenge wählbar) bestätigt. Angelegt
  wird über den normalen Feature-Weg.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Änderungen direkt aus dem Chat umsetzen lassen (Priority: P1)

Als Nutzer möchte ich im Projekt-Chat eine konkrete Änderung oder Aufgabe beschreiben
(„Benenne den Konfig-Schlüssel `foo` überall in `bar` um", „Ergänze eine Validierung für
leere Eingaben in der Anlege-Maske") und der Assistent setzt sie tatsächlich um — er ändert
die betroffenen Dateien und berichtet, was er getan hat — statt mir nur zu beschreiben, wie
ich es selbst machen müsste. Anschließend kann ich das Ergebnis einsehen und prüfen.

**Why this priority**: Das ist der Kern der Anforderung — der Wechsel von „redet über Arbeit"
zu „erledigt Arbeit". Ohne diese Story bleibt der Chat das, was er heute schon ist.

**Independent Test**: Im Chat eine kleine, klar umrissene Änderung anfordern und danach
prüfen, dass die Änderung real angewandt wurde (betroffene Dateien geändert, Ergebnis
nachvollziehbar) — nicht nur textlich beschrieben.

**Acceptance Scenarios**:

1. **Given** ein geöffneter Projekt-Chat, **When** der Nutzer eine konkrete Änderung
   beschreibt, **Then** führt der Assistent die Änderung an den betroffenen Dateien durch und
   fasst zusammen, was geändert wurde.
2. **Given** ein Chat, in dem eine Änderung angefordert wurde, **When** die Umsetzung
   abgeschlossen ist, **Then** ist das Ergebnis für den Nutzer einsehbar und eindeutig dieser
   Chat-Session zuzuordnen (nachvollziehbar, was und wo geändert wurde).
3. **Given** eine mehrschrittige Aufgabe, **When** der Assistent daran arbeitet, **Then** kann
   er mehrere Schritte hintereinander ausführen und den Nutzer bei Bedarf zwischendurch um
   Klärung oder Freigabe bitten, bis die Aufgabe erledigt ist oder er begründet, warum nicht.

---

### User Story 2 - Probleme diagnostizieren und lösen (Priority: P1)

Als Nutzer möchte ich dem Chat ein Problem schildern („Der Build schlägt fehl", „Test X ist
rot") und der Assistent soll es eigenständig untersuchen — Kommandos ausführen (z. B. Build/
Test starten), Ergebnisse auswerten, eine Ursache finden und eine Lösung umsetzen — und mir
das Ergebnis mit den durchgeführten Schritten zurückmelden.

**Why this priority**: „Probleme lösen" ist neben „Änderungen umsetzen" die zweite Hälfte der
Anforderung. Es unterscheidet die vollwertige Session vom reinen Frage-Antwort-Modus, weil es
das Ausführen von Kommandos und iteratives Vorgehen voraussetzt.

**Independent Test**: Im Projekt einen reproduzierbaren Fehler herbeiführen (z. B. einen roten
Test), den Chat bitten, ihn zu beheben, und prüfen, dass der Assistent das Problem untersucht,
die Ursache benennt und einen tatsächlichen Fix umsetzt (oder nachvollziehbar begründet, warum
keine Lösung möglich war).

**Acceptance Scenarios**:

1. **Given** ein Projekt mit einem reproduzierbaren Problem, **When** der Nutzer das Problem
   im Chat schildert, **Then** kann der Assistent die zur Diagnose nötigen Kommandos ausführen
   und deren Ergebnisse in seine Bearbeitung einbeziehen.
2. **Given** eine gefundene Ursache, **When** der Assistent einen Lösungsweg umsetzt, **Then**
   verifiziert er das Ergebnis soweit möglich (z. B. betroffenes Kommando erneut ausführen) und
   meldet Erfolg oder verbleibende Probleme klar zurück.
3. **Given** ein Problem, das der Assistent nicht lösen kann, **When** er die Bearbeitung
   beendet, **Then** hinterlässt er das Projekt in einem verständlichen, konsistenten Zustand
   und erklärt, was er versucht hat und woran es scheitert.

---

### User Story 3 - Kontrolle und Sicherheit über eingreifende Aktionen (Priority: P2)

Als Nutzer möchte ich die Kontrolle behalten: Aktionen, die Dateien ändern, Kommandos
ausführen oder anderweitig eingreifen, sollen entsprechend meiner Autonomie-Einstellung
freigegeben werden (nachfragen bzw. gemäß gewähltem Automatisierungsgrad automatisch), ich
möchte sehen, was die Session gerade tut, sie jederzeit unterbrechen können und ein Ergebnis
bei Bedarf wieder verwerfen.

**Why this priority**: Eine Session, die eigenständig eingreift, braucht eine Kontroll- und
Sicherheitsfläche, damit der Nutzer nicht von unbeaufsichtigten Änderungen überrascht wird.
Baut auf US1/US2 auf, ist aber für den vertrauensvollen Einsatz unverzichtbar.

**Independent Test**: Eine eingreifende Aktion anfordern und prüfen, dass sie gemäß der
gewählten Autonomie-Einstellung freigegeben wird (bei „nachfragen" erscheint eine Freigabe-
Aufforderung), dass der laufende Fortschritt sichtbar ist und dass sich die Session
unterbrechen lässt, ohne das Projekt in einem kaputten Zustand zu hinterlassen.

**Acceptance Scenarios**:

1. **Given** ein Automatisierungsgrad „nachfragen", **When** der Assistent eine eingreifende
   Aktion (Datei ändern, Kommando ausführen) durchführen will, **Then** wird die Aktion dem
   Nutzer zur Freigabe vorgelegt und erst nach Zustimmung ausgeführt.
2. **Given** eine laufende Bearbeitung, **When** der Nutzer den Fortschritt beobachtet,
   **Then** ist erkennbar, welche Aktionen der Assistent gerade ausführt.
3. **Given** eine laufende Bearbeitung, **When** der Nutzer sie unterbricht, **Then** stoppt
   die Session zeitnah und das Projekt bleibt in einem konsistenten, nachvollziehbaren Zustand.
4. **Given** ein abgeschlossenes, aber unerwünschtes Ergebnis, **When** der Nutzer es verwerfen
   möchte, **Then** existiert ein nachvollziehbarer Weg, die Änderungen rückgängig zu machen
   bzw. zu verwerfen.

---

### User Story 4 - Weiterhin nur fragen und bei großem Umfang übergeben (Priority: P3)

Als Nutzer möchte ich denselben Chat weiterhin für reine Fragen nutzen können, ohne dass
dabei etwas geändert wird. Beschreibt eine Anfrage hingegen eine Anforderung, deren Umfang den
strukturierten Feature-Workflow rechtfertigt, soll der Assistent — wie heute — vorschlagen,
dafür ein eigenes Feature anzulegen, statt alles ad hoc im Chat umzusetzen.

**Why this priority**: Erhält den bestehenden Wert des Chats (fragen ohne Nebeneffekte,
Feature-Übergabe) und grenzt „schnelle Änderung im Chat" sauber von „braucht ein eigenes
Feature" ab. Wertvoll, aber nachrangig gegenüber der neuen Kern-Fähigkeit.

**Independent Test**: (a) Eine reine Frage stellen und prüfen, dass keine Änderungen entstehen.
(b) Eine erkennbar feature-würdige Anforderung beschreiben und prüfen, dass der Assistent die
Feature-Anlage vorschlägt statt sie unstrukturiert im Chat umzusetzen.

**Acceptance Scenarios**:

1. **Given** ein geöffneter Chat, **When** der Nutzer eine reine Frage stellt, **Then**
   antwortet der Assistent, ohne das Projekt zu verändern.
2. **Given** eine Anforderung mit Feature-würdigem Umfang, **When** der Assistent dies erkennt,
   **Then** weist er darauf hin und schlägt vor, ein eigenes Feature anzulegen (bestehender
   Übergabe-Weg), statt die Umsetzung ad hoc im Chat zu erzwingen.

---

### Edge Cases

- **Unerwünschtes Ergebnis**: Der Assistent setzt eine Änderung um, die der Nutzer nicht will
  → es gibt einen nachvollziehbaren Weg, die Änderungen zu verwerfen/rückgängig zu machen.
- **Fehlgeschlagene oder abgelehnte Aktion**: Eine Freigabe wird verweigert oder ein Kommando
  scheitert mitten in der Aufgabe → der Assistent meldet dies verständlich und lässt das
  Projekt in einem konsistenten Zustand.
- **Langlaufendes/hängendes Kommando**: Ein ausgeführtes Kommando terminiert nicht → es greift
  ein Zeitlimit und/oder der Nutzer kann unterbrechen; die Session bleibt bedienbar.
- **Destruktive Aktion**: Eine potenziell zerstörerische Aktion (löschen, überschreiben,
  weitreichende Kommandos) wird angefordert → sie unterliegt der Freigabe gemäß Autonomie-
  Einstellung und wird nicht unbeaufsichtigt ausgeführt.
- **Parallele Arbeit am selben Projekt**: Gleichzeitig läuft eine Feature-Session, die dieselben
  Dateien berührt → durch die Worktree-Isolation (FR-004) arbeiten beide auf getrennten Kopien;
  Konflikte treten erst beim Merge auf und werden über den bestehenden Merge-Weg aufgelöst.
- **App-/Server-Neustart mitten in einer Änderung**: Der laufende Prozess endet unerwartet →
  beim nächsten Öffnen ist der Zustand nachvollziehbar und nicht korrupt; angefangene, nicht
  abgeschlossene Aktionen werden erkennbar gekennzeichnet.
- **Sehr großer Änderungsumfang**: Die Umsetzung berührt sehr viele Dateien → das Ergebnis
  bleibt prüfbar, oder der Assistent schlägt eine Übergabe an den Feature-Workflow vor.
- **Verlauf überlebt Neustart**: Wie heute bleibt der Gesprächsverlauf pro Projekt erhalten und
  wird nahtlos fortgesetzt.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Der Projekt-Chat MUSS auf Nutzeranfrage hin Änderungen am Projekt umsetzen können
  (Dateien anlegen, ändern, löschen) — nicht nur lesen und antworten.
- **FR-002**: Die Session MUSS Projekt-Kommandos ausführen können (z. B. Build, Tests, Skripte),
  um Probleme zu diagnostizieren und zu lösen, und ihr weiteres Vorgehen an den Ergebnissen
  ausrichten.
- **FR-003**: Die Session MUSS als vollwertige, agentische Assistenz mit dem Fähigkeitsumfang
  einer normalen Claude-Code-Session arbeiten (Lesen, Schreiben, Ausführen, iteratives
  Vorgehen), statt auf einen reinen Lese-Werkzeugsatz beschränkt zu sein.
- **FR-004**: Eine Arbeits-Session MUSS ihre Änderungen in einer **isolierten Arbeitskopie
  (Worktree) auf einem eigenen Branch** anwenden, getrennt von der Haupt-Arbeitskopie des
  geöffneten Projekts. Abgeschlossene Arbeit MUSS über den bestehenden Verifikations-/Merge-Weg
  des Toolkits nach `main` überführbar sein; ein Verwerfen MUSS ohne Rückstände in der Haupt-
  Arbeitskopie möglich sein (Worktree/Branch fallenlassen). Der Nur-Lese-Modus (US4) verändert
  nichts und braucht keine isolierte Kopie.
- **FR-005**: Bevor die Session Aktionen ausführt, die Dateien ändern, Kommandos ausführen oder
  anderweitig eingreifen, MUSS das System diese über **denselben Freigabe-/Inbox-Fluss wie
  Feature-Sessions** behandeln und den **Automation-Dial (Level 2 ↔ 3)** des Projekts erben
  (nachfragen bzw. automatisch je nach gewähltem Grad) — kein separates Freigabemodell —, sodass
  der Nutzer nicht von unbeaufsichtigten Änderungen überrascht wird.
- **FR-006**: Der Nutzer MUSS beobachten können, was die Session tut — die Interaktion erfolgt
  **direkt in der eingebetteten Konsole** (kein separates Eingabefeld). Das Chat-Fenster MUSS
  frei vergrößer- und verkleinerbar sein. *(Überarbeitung: kein „Unterbrechen"-Button — Abbruch
  erfolgt wie in jeder Claude-Konsole per ESC direkt in der Konsole.)*
- **FR-007**: Die Änderungen der Session bleiben in der isolierten Arbeitskopie (FR-004); es gibt
  **keine Chat-Steuerbuttons** zum Übernehmen/Verwerfen. Das durable Ergebnis der Unterhaltung
  sind die daraus **angelegten Features** (FR-013), die ihren eigenen Workflow durchlaufen.
- **FR-008**: Der Gesprächsverlauf und der Sitzungskontext MÜSSEN einen App-Neustart überleben
  und nahtlos fortgesetzt werden (wie beim heutigen Projekt-Chat).
- **FR-009**: Die Aktivität jeder Session (Turns, durchgeführte Änderungen/Kommandos, Kosten/
  Tokens) MUSS im bestehenden Kosten-/Ausführungs-Audit erfasst werden, konsistent mit anderen
  Läufen.
- **FR-010**: Beschreibt eine Anfrage eine Anforderung, deren Umfang den strukturierten
  Feature-Workflow rechtfertigt, MUSS der Assistent weiterhin vorschlagen können, dafür ein
  eigenes Feature anzulegen (bestehender Übergabe-Weg), statt sie zwingend ad hoc umzusetzen.
- **FR-011**: Der Chat ist **immer** eine einzige, vollwertige Claude-Session (kein Modus-
  Umschalter, kein separater „Fragen"-Modus). Fragen beantwortet dieselbe Session direkt in der
  Konsole.
- **FR-012**: Kann die Session eine angeforderte Änderung oder ein Kommando nicht abschließen
  (Fehler, verweigerte Freigabe, ungelöstes Problem), MUSS sie dies klar melden und das Projekt
  in einem konsistenten, verständlichen Zustand hinterlassen.
- **FR-013**: Kristallisiert sich in der Unterhaltung ein oder mehrere Features heraus, MUSS die
  Session darauf hinweisen und dem Nutzer eine **Bestätigungskarte** anbieten (Features
  einzeln auswählbar). Bestätigte Features werden über den bestehenden Feature-Anlage-Weg
  angelegt (eigener Worktree/Branch, optional direkt `/speckit-specify`); Ablehnen legt nichts an.

### Key Entities *(include if feature involves data)*

- **Chat-Session / Unterhaltung**: die pro Projekt fortlaufende, persistierte Unterhaltung;
  Träger von Verlauf und Sitzungskontext, jetzt zusätzlich Träger von durchgeführten Aktionen.
- **Nachricht / Turn**: einzelner Austausch; kann neben Text nun auch durchgeführte Aktionen
  (Datei-Änderungen, ausgeführte Kommandos) und deren Ergebnis umfassen.
- **Aktion / Änderung**: eine vom Assistenten durchgeführte eingreifende Operation (Datei
  geändert/angelegt/gelöscht, Kommando ausgeführt) mit Freigabe-Status und Ergebnis.
- **Freigabe-Anforderung**: eine dem Nutzer vorgelegte Zustimmung zu einer eingreifenden Aktion
  (abhängig vom Autonomiegrad).
- **Arbeitsort**: die isolierte Arbeitskopie (Worktree) + Branch einer Arbeits-Session, in der
  Änderungen wirksam werden; getrennt von der Haupt-Arbeitskopie (FR-004).
- **Feature-Vorschlag**: pro Unterhaltung höchstens ein offener Vorschlag mit einem oder mehreren
  vorgeschlagenen Features (Name + Beschreibung), aus dem Gespräch erkannt; über eine
  Bestätigungskarte anlegbar oder verwerfbar (FR-013).
- **Kosten-/Ausführungseintrag**: Erfassung von Turns/Läufen inkl. Kosten und Tokens im Audit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein Nutzer kann eine konkrete, kleine Änderung vollständig im Chat umsetzen lassen
  (beschreiben → anwenden → einsehen), ohne den Chat zu verlassen, in unter 5 Minuten.
- **SC-002**: 100 % der Datei-ändernden oder Kommando-ausführenden Aktionen sind entweder vom
  Nutzer freigegeben oder durch eine vom Nutzer bewusst gewählte Autonomie-Einstellung gedeckt —
  keine unbeaufsichtigten Überraschungsänderungen.
- **SC-003**: Der Nutzer kann für jede Session eindeutig nachvollziehen, was geändert wurde
  (welche Dateien/Wirkungen), und ein unerwünschtes Ergebnis vollständig verwerfen.
- **SC-004**: Eine laufende Session lässt sich innerhalb weniger Sekunden unterbrechen und
  hinterlässt das Projekt in einem konsistenten Zustand (kein korrupter/halbfertiger Zustand
  ohne Kennzeichnung).
- **SC-005**: Gesprächsverlauf und Kontext überstehen einen App-Neustart und werden nahtlos
  fortgesetzt (bestehende Garantie bleibt erhalten).
- **SC-006**: Ein messbarer Anteil der Anliegen vom Typ „kleine Änderung / Problem lösen", die
  bisher das Anlegen eines vollständigen Features erforderten, kann nun direkt im Chat erledigt
  werden — mit spürbar geringerem Aufwand als der volle Feature-Workflow.

## Assumptions

- **Sicherheits-/Freigabemodell**: Für eingreifende Aktionen wird der bereits vorhandene
  Freigabe-/Kontrollmechanismus des Toolkits wiederverwendet (Permission-/„Braucht dich"-Fluss
  und der Automation-Dial Level 2 ↔ Level 3), statt ein separates Modell einzuführen.
- **Interaktive, persistente Session**: Damit Freigaben, Beobachtung und iteratives Vorgehen
  funktionieren, ist die Session interaktiv und langlebig (nicht mehr ein isolierter Headless-
  Lauf pro Turn wie heute).
- **Projekt-Scope bleibt**: Der Chat bleibt an das aktuell geöffnete Projekt gebunden (Sprech-
  blase in der Projektansicht), konsistent zum heutigen Verhalten.
- **Kosten-Metering bleibt**: Läufe erscheinen weiterhin im Kosten-/Ausführungs-Audit.
- **Feature-Übergabe bleibt**: Der bestehende Weg „aus dem Chat ein Feature anlegen" bleibt für
  großen Umfang erhalten.
- **`~/.claude/` bleibt read-only**: Die bestehende Invariante des Toolkits wird nicht verletzt.
- Reine Fragen erzeugen weiterhin keine Nebeneffekte; das Eingreifen erfolgt nur auf eine
  Änderungs-/Problemlösungs-Anfrage hin (bzw. gemäß dem in FR-011 zu klärenden Modus-Modell).

## Dependencies

- Baut auf dem bestehenden Feature „Ask-a-Question-Bot" (Projekt-Chat) auf und erweitert es.
- Setzt die vorhandene Session-/Konsolen- und Freigabe-Infrastruktur des Toolkits voraus
  (persistente Sessions, Permission-/Inbox-Fluss, Automation-Dial).
- Setzt die lokal verfügbare Claude-Code-CLI voraus (wie das übrige Toolkit).
