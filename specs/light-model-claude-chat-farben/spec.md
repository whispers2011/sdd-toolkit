# Feature Specification: Light-/Dark-Mode-Umschalter & lesbare Claude-Chat-Farben

**Feature Branch**: `feature/light-model-claude-chat-farben`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Das SDD Toolkit soll einen switcher oben rechts für light/darkmode erhalten. SVG-Icon zum umschalten. Bei Rückfragen im claude chat werden die Fragen aktuell im darkmode in schwarz angezeigt auf schwarzen hintergrund (somit nicht lesbar). achte darauf, dass alles im gut lesbar ist"

## Kontext & Ausgangslage *(informativ)*

Das Web-UI des SDD-Toolkits ist heute **ausschließlich für den Dark-Mode gestaltet** — es gibt keinen Umschalter, und alle Oberflächen verwenden fest verdrahtete dunkle Farben. Der Nutzer möchte wählen können, ob er die Oberfläche hell oder dunkel bedient.

Zusätzlich gibt es einen konkreten Lesbarkeits-Defekt: Im **Projekt-Chat mit Claude** erscheinen **Rückfragen** (Klärungs-/Auswahlfragen, die Claude an den Nutzer stellt) aktuell **dunkel auf dunklem Hintergrund** und sind damit praktisch nicht lesbar. Dieser Defekt muss unabhängig vom Modus behoben werden, und die Lesbarkeit muss in **beiden** Modi sichergestellt sein.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zwischen Light- und Dark-Mode umschalten (Priority: P1)

Als Nutzer des SDD-Toolkits will ich über einen gut sichtbaren Umschalter **oben rechts** in der Oberfläche zwischen einem hellen und einem dunklen Erscheinungsbild wechseln können, damit ich die Oberfläche an meine Umgebung und meine Vorlieben anpasse. Der Umschalter zeigt ein **SVG-Icon**, das den aktuellen bzw. den erreichbaren Modus signalisiert, und wechselt bei Aktivierung.

**Why this priority**: Dies ist die ausdrücklich geforderte Kernfunktion ("switcher oben rechts für light/darkmode"). Sie liefert für sich allein Wert (Wahlfreiheit des Erscheinungsbilds) und ist die Grundlage, auf der die Lesbarkeit in beiden Modi sichergestellt wird.

**Independent Test**: Den Umschalter oben rechts aktivieren und beobachten, dass das **gesamte** UI (alle Ansichten, Panels, Dialoge, Kopf-/Seitenleisten) sofort und ohne Neuladen in den jeweils anderen Modus wechselt und in beiden Modi vollständig lesbar bleibt.

**Acceptance Scenarios**:

1. **Given** die Oberfläche ist im Dark-Mode, **When** der Nutzer den Umschalter oben rechts aktiviert, **Then** wechselt das gesamte UI unmittelbar in den Light-Mode, und der Umschalter zeigt per SVG-Icon den nun erreichbaren Modus an.
2. **Given** die Oberfläche ist im Light-Mode, **When** der Nutzer den Umschalter erneut aktiviert, **Then** wechselt das gesamte UI zurück in den Dark-Mode.
3. **Given** ein beliebiger Modus ist aktiv, **When** der Nutzer verschiedene Ansichten (Board, Grid, Läufe, Konsole, Wissen, Dialoge) öffnet, **Then** ist jede Ansicht durchgängig im aktiven Modus gestaltet und vollständig lesbar (kein Bereich bleibt im „falschen" Modus).
4. **Given** eine laufende Sitzung, ein offener Chat oder streamende Ausgabe, **When** der Nutzer den Modus umschaltet, **Then** laufen alle Arbeiten unverändert weiter (kein Neuladen, kein Datenverlust, kein Verlust des Eingabefokus).

---

### User Story 2 - Rückfragen im Claude-Chat sind in beiden Modi lesbar (Priority: P2)

Als Nutzer will ich, dass die **Rückfragen von Claude im Projekt-Chat** klar lesbar dargestellt werden — insbesondere darf die heutige Darstellung „dunkler Text auf dunklem Hintergrund" nicht mehr auftreten —, damit ich Klärungsfragen beantworten kann, ohne den Text markieren oder erraten zu müssen.

**Why this priority**: Dies ist der konkret benannte, akute Lesbarkeits-Defekt ("im darkmode in schwarz … auf schwarzen hintergrund, somit nicht lesbar"). Er ist im Umfang enger als der Umschalter (betrifft die Chat-/Konsolendarstellung), aber für die Nutzbarkeit des Projekt-Chats entscheidend. Er ist unabhängig testbar und liefert für sich Wert.

**Independent Test**: Im Projekt-Chat eine Situation herbeiführen, in der Claude eine Rückfrage stellt, und in **beiden** Modi prüfen, dass Frage-Text und Antwortoptionen deutlich vom Hintergrund abgehoben und lesbar sind.

**Acceptance Scenarios**:

1. **Given** der Dark-Mode ist aktiv und der Projekt-Chat läuft, **When** Claude eine Rückfrage stellt, **Then** sind Frage und Antwortoptionen klar lesbar (kein dunkler Text auf dunklem Hintergrund).
2. **Given** der Light-Mode ist aktiv und der Projekt-Chat läuft, **When** Claude eine Rückfrage stellt, **Then** sind Frage und Antwortoptionen klar lesbar (kein heller Text auf hellem Hintergrund).
3. **Given** eine Rückfrage steht an, **When** der Nutzer den Modus umschaltet, **Then** bleibt die Rückfrage lesbar und beantwortbar, ohne dass Eingabe oder Fokus verloren gehen.
4. **Given** eine Rückfrage nutzt farbliche Hervorhebungen (z. B. hervorgehobene/ausgewählte Option), **When** sie angezeigt wird, **Then** bleibt sowohl der hervorgehobene als auch der nicht hervorgehobene Zustand in beiden Modi lesbar.

---

### User Story 3 - Gewählter Modus bleibt erhalten (Priority: P3)

Als Nutzer will ich, dass meine Modus-Wahl gemerkt wird, damit ich sie nicht bei jedem Öffnen des Toolkits neu einstellen muss.

**Why this priority**: Komfortfunktion, die den Umschalter (P1) aufwertet, aber nicht Voraussetzung für dessen Nutzbarkeit ist. Daher niedrigere Priorität.

**Independent Test**: Einen Modus wählen, die Seite neu laden bzw. das Toolkit neu öffnen und prüfen, dass der zuvor gewählte Modus wieder aktiv ist.

**Acceptance Scenarios**:

1. **Given** der Nutzer hat einen Modus gewählt, **When** er die Seite neu lädt oder das Toolkit erneut öffnet, **Then** ist derselbe Modus wieder aktiv.
2. **Given** es liegt noch keine gespeicherte Wahl vor, **When** der Nutzer das Toolkit zum ersten Mal öffnet, **Then** wird ein sinnvoller Standardmodus angewendet (Farbschema-Präferenz des Systems/Browsers, ersatzweise Dark).
3. **Given** der Nutzer hat einen Modus explizit gewählt, **When** sich die Systempräferenz danach ändert, **Then** bleibt die explizite Wahl des Nutzers bestehen.

---

### Edge Cases

- **Erstnutzung ohne gespeicherte Wahl und ohne System-Angabe**: Es wird auf den Dark-Mode zurückgefallen (heutiges Erscheinungsbild).
- **Umschalten bei offenem Projekt-Chat / anstehender Rückfrage**: Chat bleibt offen, die Rückfrage bleibt lesbar und beantwortbar, Eingabe und Fokus gehen nicht verloren.
- **Umschalten während streamender Konsolen-/Terminal-Ausgabe**: Der bisherige Verlauf (Scrollback) und neue Ausgaben bleiben in beiden Modi lesbar; der Wechsel bricht den Stream nicht ab.
- **Bislang nur für Dark gestaltete Bereiche**: Elemente mit fest verdrahteten dunklen Farben dürfen im Light-Mode nicht unlesbar werden (z. B. dunkler Text auf jetzt hellem Grund oder umgekehrt).
- **Farbcodierte Inhalte (Statusfarben, Hervorhebungen, Badges, Fehlermeldungen)**: müssen in beiden Modi ausreichend Kontrast zum jeweiligen Hintergrund behalten.
- **Systempräferenz ändert sich zur Laufzeit**: Ohne explizite Nutzerwahl folgt das UI der Systempräferenz; mit expliziter Wahl gewinnt die Nutzerwahl.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das UI MUSS einen Umschalter **oben rechts** in der Hauptoberfläche bereitstellen, mit dem der Nutzer zwischen Light-Mode und Dark-Mode wechseln kann.
- **FR-002**: Der Umschalter MUSS ein **SVG-Icon** verwenden, das den aktuellen bzw. den bei Aktivierung erreichbaren Modus signalisiert, und bei Aktivierung den Modus wechseln.
- **FR-003**: Ein Moduswechsel MUSS **sofort und ohne Neuladen** auf das **gesamte** UI wirken (alle Ansichten, Panels, Dialoge, Kopf- und Seitenleisten, schwebende Elemente).
- **FR-004**: In **beiden** Modi MÜSSEN alle Text- und Bedienelemente ausreichend Kontrast zum Hintergrund haben und lesbar sein; **kein** Element darf gleichfarbig-auf-gleichfarbig (z. B. schwarz auf schwarz) dargestellt werden.
- **FR-005**: Die **Rückfragen von Claude im Projekt-Chat** MÜSSEN in beiden Modi lesbar dargestellt werden; die heutige Darstellung „dunkler Text auf dunklem Hintergrund" MUSS beseitigt werden.
- **FR-006**: Der aktive Modus MUSS am Umschalter erkennbar sein (der Nutzer erkennt ohne Ausprobieren, welcher Modus aktiv ist).
- **FR-007**: Der gewählte Modus MUSS über Seiten-Neuladen und erneutes Öffnen des Toolkits hinweg erhalten bleiben (gerätelokale Speicherung genügt).
- **FR-008**: Liegt keine gespeicherte Wahl vor, MUSS das System einen sinnvollen Standard anwenden: die Farbschema-Präferenz des Systems/Browsers, ersatzweise Dark.
- **FR-009**: Ein Moduswechsel DARF laufende Arbeiten **nicht** unterbrechen oder verlieren (laufende Sitzungen, offener Chat, Terminal-/Konsolen-Ausgabe, nicht abgesendete Eingaben, Eingabefokus).
- **FR-010**: Eine explizite Nutzerwahl MUSS Vorrang vor der Systempräferenz haben und bestehen bleiben, auch wenn sich die Systempräferenz danach ändert.

### Key Entities *(include if feature involves data)*

- **Theme-Präferenz**: Der vom Nutzer gewählte Darstellungsmodus (Light oder Dark) sowie die Unterscheidung „explizit gewählt" vs. „aus Systempräferenz abgeleitet". Wird gerätelokal gespeichert.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein Nutzer kann in **einer Interaktion** (unter 2 Sekunden) zwischen Light- und Dark-Mode wechseln, und das gesamte UI wechselt sichtbar mit.
- **SC-002**: In beiden Modi erreichen **100 %** der Text- und Bedienelemente ein anerkanntes Lesbarkeits-/Kontrastziel (Richtwert WCAG 2.1 AA: 4,5:1 für Fließtext, 3:1 für große Schrift und Bedienelemente); es existiert **kein** Element mit gleichfarbig-auf-gleichfarbig-Darstellung.
- **SC-003**: Rückfragen im Projekt-Chat sind in **beiden** Modi zu **100 %** lesbar; die schwarz-auf-schwarz-Darstellung tritt in **0 %** der Fälle auf.
- **SC-004**: Der gewählte Modus bleibt nach Neuladen/Neustart auf demselben Gerät in **100 %** der Fälle erhalten.
- **SC-005**: Der aktive Modus ist am Umschalter erkennbar — Nutzer identifizieren den aktiven Modus in unter **3 Sekunden**, ohne umzuschalten.
- **SC-006**: Beim Umschalten während laufender Arbeit werden **0** Sitzungen, Streams oder Chat-Verläufe unterbrochen und **keine** Eingaben verworfen.

## Assumptions

- Das Web-UI ist heute **Dark-only**; der Light-Mode und der Umschalter werden neu eingeführt. Der Umschalter wird in der bestehenden Kopfzeile **oben rechts** platziert (neben den vorhandenen globalen Steuerelementen).
- Die Modus-Wahl wird **gerätelokal** gespeichert (kein Server-Konto erforderlich), analog zur bereits vorhandenen lokalen UI-Persistenz des Toolkits.
- Standard bei Erstnutzung: **Farbschema-Präferenz des Systems/Browsers**, ersatzweise **Dark** (entspricht dem heutigen Erscheinungsbild).
- Lesbarkeit wird an **WCAG 2.1 AA**-Kontrast als Zielrichtwert gemessen; die konkrete Farbpalette und die Umsetzung (inkl. der Konsolen-/Terminal-Darstellung des Projekt-Chats) werden in der Planungsphase festgelegt — die Spezifikation bleibt technikneutral.
- „Alles gut lesbar" bezieht sich auf das **gesamte** Web-UI in beiden Modi, mit besonderem Augenmerk auf die bisher problematischen Rückfragen im Projekt-Chat.
- Der Umfang umfasst ausschließlich die Darstellung/Bedienung des Web-UI; funktionale Abläufe (SDD-Phasen, Sessions, Merge-Queue etc.) bleiben unverändert.
