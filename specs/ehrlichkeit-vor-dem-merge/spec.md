# Feature Specification: Ehrlichkeit vor dem Merge

**Feature Branch**: `feature/ehrlichkeit-vor-dem-merge`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Drei Anzeigen fehlen an genau der Stelle, an der entschieden wird. Alle Daten liegen vor, es ist ein Durchreichen, keine neue Erhebung. (1) „Verifiziert" ohne Verifikation: verify_commands ist bei zwei von drei Projekten leer ([]). Am 30.07.2026 sind FÜNF Features nach main gelaufen, jedes mit 0 verify-Läufen und 0 review-Läufen — über die Meldung „verifiziert — bereit für dein Review & Merge" (mergeQueueService.ts:291). Mit autoMerge=true wird zusätzlich awaiting_human_review übersprungen (:287); dann gibt es zwischen Agent-Ausgabe und main keine einzige Prüfung. Aufgabe: Leere verifyCommands als Zustand behandeln, nicht als Erfolg. Stage und Meldung dürfen nicht „verifiziert" heissen. Beim ersten Integrationsversuch ein Attention-Item „Projekt hat keine Verifikation konfiguriert". Im Review-Portal die Lücke benennen statt eine leere Kachel zu zeigen. (2) Offene Tasks werden nicht genannt: Ein Feature ist mit 68 von 76 Tasks ins Review und nach merged gelaufen. Der Guard ist absichtlich nur eine Mindesthürde (mergeQueueService.ts:230, hasAnyTaskDone) — er fängt den Totalausfall, nicht die Unvollständigkeit. Das ist als Sperre richtig. Aufgabe: tasksDone/tasksTotal in die review_due-Meldung und ins Review-Portal aufnehmen („68/76 erledigt, 8 offen"). NICHT sperren, nur benennen. (3) Läufe-Ansicht ohne Bezugsgrösse: RunSummary (shared/runSummary.ts:44-62) führt total, byStep, byCategory, sourceMix — keine Task-Zahlen. Die Werte liegen am Feature (types.ts:133-134), buildRunSummaries arbeitet ohnehin je Feature. Aufgabe: tasksDone/tasksTotal in RunSummary aufnehmen, in der Läufe-Liste als Spalte und im Lauf-Dashboard zeigen. Zusätzlich „Kosten pro Task" als Bezugsgrösse — sie macht Features unterschiedlicher Grösse erst vergleichbar. Abnahme: Ein Projekt ohne verifyCommands kann kein Feature als „verifiziert" ausweisen. Die review_due-Meldung nennt den Task-Stand. Die Läufe-Ansicht zeigt Tasks und Kosten pro Task."

## Clarifications

### Session 2026-07-30

- Q: Wie soll „keine Verifikation konfiguriert" als Zustand geführt werden (FR-001)? → A: Als eigene, persistierte Integrationsstufe — nicht als zur Laufzeit abgeleitete Anzeige.
- Q: Wie ist FR-011 gegenüber FR-012 zu lesen? → A: FR-011 schützt nur die Verifikations-Aussagen; der Aufgabenstand kommt in jede review_due-Meldung, auch bei Projekten mit Verifikation.
- Q: Wo erscheint der Aufgabenstand, wenn autoMerge=true das Review überspringt? → A: In der bestehenden Meldung über den vollzogenen Merge — kein neuer Meldungstyp, keine Eskalation.
- Q: Was passiert, wenn ein Mensch den Eintrag abhakt, obwohl keine Verifikation konfiguriert ist? → A: Der Eintrag ist eine ERINNERUNG und damit abhakbar; die Ehrlichkeit ist es nicht. Abhaken löst genau den Inbox-Eintrag auf und sonst nichts: die Integrationsstufe bleibt „ungeprüft", jede Meldung und das Review-Portal führen den Zustand weiter, und es entsteht keine Verifikation. Der Eintrag kommt für dasselbe Projekt nicht wieder — er ist einmalig je Projekt, nicht je Feature; wer ihn wegklickt, verzichtet auf die Erinnerung, nicht auf die Kennzeichnung. Wird `verifyCommands` später gefüllt, gilt das Projekt wieder als konfiguriert, und beim nächsten Leeren entsteht der Eintrag erneut. Begründung: eine Meldung, die sich nicht wegklicken lässt, wird zur Dauerlast und trainiert das Übersehen aller Meldungen; eine Kennzeichnung, die sich wegklicken lässt, wäre wertlos. Deshalb ist genau das eine abhakbar und das andere nicht.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Eine Freigabe, die nicht behauptet, geprüft worden zu sein (Priority: P1)

Als Nutzer entscheide ich über den Merge eines Features in einem Projekt, für das keine
Verifikationskommandos hinterlegt sind. Weder die Stufenanzeige noch die Meldung, die mich zum
Review ruft, behauptet an irgendeiner Stelle, dass verifiziert wurde oder gerade verifiziert wird.
Stattdessen lese ich ausdrücklich, dass für dieses Projekt keine Verifikation konfiguriert ist —
in der Meldung, im Review-Portal und in der Review-Übersicht. Beim ersten Integrationsversuch
eines solchen Projekts erscheint zusätzlich ein Eintrag in der Aufmerksamkeits-Liste, der die
fehlende Konfiguration benennt und stehen bleibt, bis sie nachgeholt ist.

**Why this priority**: Das ist der Kern des Features und der einzige Punkt mit unmittelbarer
Schadenswirkung. Am 30.07.2026 sind fünf Features ohne einen einzigen Prüf-Lauf nach main
gelangt, angekündigt mit dem Wort „verifiziert". Eine falsche Zusicherung an der
Entscheidungsstelle ist schlimmer als gar keine: sie ersetzt die Prüfung, die der Mensch sonst
selbst vorgenommen hätte. Die Story liefert für sich allein Wert, auch ohne Story 2 und 3.

**Independent Test**: Vollständig testbar mit einem Projekt ohne Verifikationskommandos: ein
Feature durch die Integration schicken und prüfen, dass in Stufenanzeige, Meldung, Review-Portal
und Review-Übersicht nirgends eine stattgefundene oder laufende Verifikation behauptet wird, und
dass genau ein Aufmerksamkeits-Eintrag zur fehlenden Konfiguration entsteht.

**Acceptance Scenarios**:

1. **Given** ein Projekt ohne konfigurierte Verifikationskommandos und ein Feature mit
   integrierbarer Arbeit, **When** die Integration startet, **Then** zeigt keine Oberfläche für
   dieses Feature eine Stufenbezeichnung, die eine laufende oder abgeschlossene Verifikation
   behauptet.
2. **Given** dasselbe Projekt mit ausgeschaltetem automatischem Merge, **When** das Feature auf
   das menschliche Review wartet, **Then** enthält die Meldung nicht das Wort „verifiziert",
   sondern benennt, dass keine Verifikation lief.
3. **Given** dasselbe Projekt, **When** die Integration des ersten Features beginnt, **Then**
   entsteht genau ein Aufmerksamkeits-Eintrag „Projekt hat keine Verifikation konfiguriert".
4. **Given** dieser Eintrag ist offen, **When** ein zweites und drittes Feature desselben
   Projekts integriert wird, **Then** entsteht kein weiterer Eintrag derselben Art.
5. **Given** dieser Eintrag ist offen, **When** die Features des Projekts weitere
   Integrationsstufen durchlaufen und bis „gemergt" gelangen, **Then** bleibt der Eintrag offen —
   er hängt am Projekt, nicht am Stand eines Features.
6. **Given** dieser Eintrag ist offen, **When** für das Projekt mindestens ein
   Verifikationskommando hinterlegt wird, **Then** ist der Eintrag ohne weiteres Zutun aufgelöst.
7. **Given** ein Projekt ohne konfigurierte Verifikation und ein Feature im Review, **When** der
   Reviewer das Review-Portal öffnet, **Then** wird die fehlende Konfiguration ausdrücklich
   benannt und ist von „konfiguriert, aber noch kein Lauf vorhanden" unterscheidbar.
8. **Given** dieselbe Lage, **When** der Reviewer die Review-Übersicht betrachtet, **Then**
   unterscheidet die Verifikations-Anzeige des Eintrags „nicht konfiguriert" von „konfiguriert,
   aber nicht gelaufen".
9. **Given** ein Projekt ohne konfigurierte Verifikation und eingeschalteten automatischen Merge,
   **When** ein Feature integriert wird, **Then** läuft es unverändert durch bis zum Merge — die
   fehlende Konfiguration wird benannt, sperrt aber nichts.
10. **Given** ein Projekt MIT konfigurierter Verifikation, **When** ein Feature integriert wird,
    **Then** bleiben Stufenanzeigen, Meldungen und Aufmerksamkeits-Liste in ihren
    Verifikations-Aussagen unverändert gegenüber heute — keine neue Stufe, kein neuer Eintrag,
    kein geänderter Wortlaut zur Verifikation; der Aufgabenstand aus Story 2 wird auch hier
    ergänzt.

---

### User Story 2 - Der Aufgabenstand steht dort, wo entschieden wird (Priority: P2)

Als Nutzer erhalte ich die Meldung, dass ein Feature auf mein Review wartet, und lese darin
sofort, wie weit die Umsetzung ist: „68/76 erledigt, 8 offen". Denselben Stand sehe ich im
Review-Portal, ohne einen weiteren Reiter zu öffnen, und offene Aufgaben sind hervorgehoben. Ob
ich dennoch mergen will, entscheide ich selbst — nichts wird gesperrt. Läuft das Feature ohne
Review automatisch durch, lese ich denselben Stand in der Meldung über den vollzogenen Merge —
dort ist es die einzige Gelegenheit, ihn überhaupt zu erfahren.

**Why this priority**: Die Zahl liegt am Feature bereits vor und ist der einzige Hinweis auf eine
unvollständige Umsetzung, die jede Prüfung technisch besteht. Ein Feature ist mit 68 von 76
Aufgaben ins Review und weiter nach „gemergt" gelaufen, ohne dass diese acht offenen Aufgaben
irgendwo genannt wurden. Zweite Priorität, weil hier — anders als bei Story 1 — keine falsche
Zusicherung gemacht wird, sondern eine wahre Information fehlt.

**Independent Test**: Vollständig testbar mit einem Feature, dessen Aufgabenliste teilweise
abgehakt ist: Integration ohne automatischen Merge starten und prüfen, dass die Meldung zum
fälligen Review erledigte, gesamte und offene Aufgaben nennt und dass derselbe Stand beim Öffnen
des Review-Portals ohne weitere Interaktion sichtbar ist.

**Acceptance Scenarios**:

1. **Given** ein Feature mit 68 von 76 erledigten Aufgaben, **When** es auf das menschliche
   Review wartet, **Then** nennt die Meldung erledigte und gesamte Aufgaben sowie die Anzahl der
   offenen.
2. **Given** ein Feature mit 76 von 76 erledigten Aufgaben, **When** es auf das Review wartet,
   **Then** nennt die Meldung den vollständigen Stand und weist keine offenen Aufgaben aus.
3. **Given** ein Feature ohne Aufgabenliste (gesamt = 0), **When** es auf das Review wartet,
   **Then** benennt die Meldung, dass keine Aufgabenliste vorliegt, statt einen Stand von „0/0"
   zu zeigen.
4. **Given** ein Feature mit offenen Aufgaben im Review, **When** der Reviewer das Review-Portal
   öffnet, **Then** ist der Aufgabenstand ohne Reiterwechsel und ohne weiteren Klick sichtbar und
   die offenen Aufgaben sind als solche hervorgehoben.
5. **Given** ein Feature mit offenen Aufgaben, **When** der Reviewer den Merge freigibt, **Then**
   wird die Freigabe unverändert ausgeführt — die Anzeige informiert, sie sperrt nicht.
6. **Given** ein Feature mit vorhandener Aufgabenliste, aus der keine einzige Aufgabe erledigt
   ist, **When** die Integration gestartet wird, **Then** greift die bestehende Mindesthürde
   unverändert und die Integration beginnt nicht.
7. **Given** ein Feature mit 68 von 76 erledigten Aufgaben und eingeschaltetem automatischem
   Merge, **When** es ohne menschliches Review gemergt wird, **Then** nennt die Meldung über den
   vollzogenen Merge denselben Aufgabenstand — obwohl nie eine Meldung zum fälligen Review
   entstanden ist.

---

### User Story 3 - Läufe mit Bezugsgrösse vergleichen (Priority: P3)

Als Nutzer öffne ich die Läufe-Ansicht und sehe je Lauf, wie viele Aufgaben erledigt und wie
viele insgesamt vorgesehen sind, sowie die Kosten pro erledigter Aufgabe. Damit vergleiche ich
Läufe unterschiedlicher Grösse: ein teurer Lauf mit vielen Aufgaben ist etwas anderes als ein
gleich teurer Lauf mit drei. Wo die Bezugsgrösse nicht bestimmbar ist — keine erledigte Aufgabe —
steht ein Strich, keine Schätzung.

**Why this priority**: Reine Auswertung ohne Bezug zur unmittelbaren Merge-Entscheidung.
Wertvoll, aber nachgelagert: hier steht kein falscher Text an der Entscheidungsstelle, sondern
eine fehlende Vergleichsmöglichkeit im Rückblick.

**Independent Test**: Vollständig testbar über die Läufe-Ansicht mit zwei Features
unterschiedlicher Aufgabenzahl: beide Läufe zeigen in der Liste ihren Aufgabenstand als eigene
Spalte und ihre Kosten pro erledigter Aufgabe, und derselbe Wert erscheint im Dashboard des
einzelnen Laufs.

**Acceptance Scenarios**:

1. **Given** die Läufe-Ansicht mit mehreren Läufen, **When** sie geöffnet wird, **Then** zeigt
   jede Zeile den Aufgabenstand des Laufs (erledigt/gesamt) ohne Aufklappen.
2. **Given** ein Lauf mit erledigten Aufgaben und gemeldeten Beträgen, **When** die Läufe-Ansicht
   geöffnet wird, **Then** zeigt die Zeile die Kosten pro erledigter Aufgabe.
3. **Given** derselbe Lauf, **When** sein Dashboard aufgeklappt wird, **Then** erscheint dort
   derselbe Wert für Kosten pro erledigter Aufgabe.
4. **Given** ein Lauf ohne erledigte Aufgabe, **When** er angezeigt wird, **Then** steht bei den
   Kosten pro Aufgabe ein Strich — kein Wert, keine Schätzung, kein Fehler.
5. **Given** ein Lauf, dessen Ausführungen teilweise keinen Betrag gemeldet haben, **When** die
   Kosten pro Aufgabe angezeigt werden, **Then** ist der Wert als unvollständig gekennzeichnet.
6. **Given** ein Lauf ohne Aufgabenliste (gesamt = 0), **When** er angezeigt wird, **Then** ist
   das als „keine Aufgabenliste" erkennbar und nicht als „0 von 0 erledigt".

---

### Edge Cases

- Ein Projekt ohne konfigurierte Verifikation, dessen Integrationsversuch schon an einer
  Vorprüfung scheitert (kein Worktree, keine Änderungen, keine erledigte Aufgabe, Agent schreibt
  noch): es gab keinen Integrationsversuch, der bis zur Verifikationsstufe gelangt wäre — es
  entsteht kein Aufmerksamkeits-Eintrag und kein Zustand ändert sich.
- Ein Projekt, dessen Verifikationskommandos nachträglich wieder entfernt werden: der Eintrag
  entsteht beim nächsten Integrationsversuch erneut.
- Ein Projekt mit konfigurierter Verifikation, bei dem der Verifikationslauf übersprungen wurde,
  weil der Zustandsabgleich das Feature vorher als bereits gemergt erkannt hat: die Anzeige darf
  hier ebenfalls keine stattgefundene Verifikation behaupten.
- Integration über Pull Request statt lokalem Merge: die fehlende Verifikationskonfiguration wird
  genauso benannt; ob die Prüfung später in der Fremdinfrastruktur stattfindet, ist für diese
  Anzeige unerheblich.
- Ein Feature, dessen Aufgabenzahl sich zwischen Meldung und Öffnen des Review-Portals ändert
  (Agent hakt nachträglich ab): Portal und Meldung dürfen sich unterscheiden; die Meldung ist der
  Stand zum Zeitpunkt der Meldung, das Portal der aktuelle.
- Läufe archivierter Features: Aufgabenstand und Kosten pro Aufgabe werden dort genauso gezeigt.
- Ein Lauf, dessen Feature mehr erledigte als gesamte Aufgaben ausweist (widersprüchliche
  Zählung): die Rohwerte werden unverändert gezeigt, nichts wird stillschweigend zurechtgebogen.
- Ein Lauf mit erledigten Aufgaben, aber ohne einen einzigen gemeldeten Betrag: Kosten pro
  Aufgabe stehen als Strich, nicht als 0.

## Requirements *(mandatory)*

### Functional Requirements

**Verifikationslücke benennen (Story 1)**

- **FR-001**: Das System MUSS „für dieses Projekt ist keine Verifikation konfiguriert" als
  eigenen, unterscheidbaren Zustand führen — abgegrenzt von „Verifikation lief und war
  erfolgreich" und von „Verifikation ist konfiguriert, aber noch nicht gelaufen".
- **FR-001a**: Dieser Zustand MUSS eine eigene, festgeschriebene Integrationsstufe sein, die ein
  Feature eines Projekts ohne Verifikationskommandos anstelle der Stufe „Verifikation läuft"
  durchläuft. Er DARF nicht bloss beim Anzeigen aus der Projektkonfiguration abgeleitet werden:
  die Stufe MUSS auch im Rückblick — nach dem Merge, in der Historie — erkennbar bleiben, und die
  Aufzählung der Integrationsstufen MUSS so beschaffen sein, dass jede Oberfläche, die Stufen
  benennt, für die neue Stufe zwingend eine eigene Beschriftung führt.
- **FR-002**: Für ein Feature eines Projekts ohne konfigurierte Verifikation MUSS jede Anzeige
  seiner Integrationsstufe einen Text zeigen, der keine laufende und keine stattgefundene
  Verifikation behauptet.
- **FR-003**: Die Meldung, mit der ein Feature zum menschlichen Review gerufen wird, DARF für ein
  solches Projekt eine Verifikation nicht behaupten; sie MUSS ausdrücklich benennen, dass keine
  Verifikation lief.
- **FR-004**: Beim ersten Integrationsversuch, der für ein Projekt ohne konfigurierte
  Verifikation die Verifikationsstufe erreicht, MUSS das System einen Aufmerksamkeits-Eintrag
  „Projekt hat keine Verifikation konfiguriert" erzeugen.
- **FR-005**: Solange ein solcher Eintrag für ein Projekt offen ist, DÜRFEN weitere
  Integrationsversuche desselben Projekts keinen zweiten Eintrag derselben Art erzeugen.
- **FR-006**: Der Eintrag MUSS unabhängig vom Integrationsstand einzelner Features offen bleiben
  — insbesondere darf er nicht durch den Stufenwechsel eines Features aufgelöst werden.
- **FR-007**: Der Eintrag MUSS aufgelöst sein, sobald für das Projekt mindestens ein
  Verifikationskommando konfiguriert ist, ohne dass ein Mensch ihn abhaken muss.
- **FR-008**: Das Review-Portal MUSS an der Stelle, an der es heute Verifikationsläufe zeigt, die
  fehlende Konfiguration ausdrücklich benennen, statt eine leere Ansicht zu zeigen — und sie von
  „konfiguriert, aber kein Lauf vorhanden" unterscheiden.
- **FR-009**: Die Review-Übersicht MUSS in der Verifikations-Anzeige eines Eintrags „nicht
  konfiguriert" von „konfiguriert, aber nicht gelaufen" unterscheiden.
- **FR-010**: Eine fehlende Verifikationskonfiguration DARF keine Integration blockieren,
  verzögern oder eskalieren — sie wird ausschließlich benannt.
- **FR-011**: Für Projekte MIT konfigurierter Verifikation MÜSSEN Stufenanzeigen, Meldungen und
  Aufmerksamkeits-Einträge in ihren Verifikations-Aussagen unverändert bleiben: keine neue
  Integrationsstufe, kein neuer Aufmerksamkeits-Eintrag, kein geänderter Wortlaut zur
  Verifikation. Der Aufgabenstand aus FR-012 ist davon ausgenommen — er wird für alle Projekte
  ergänzt, mit und ohne konfigurierte Verifikation.

**Aufgabenstand an der Entscheidungsstelle (Story 2)**

- **FR-012**: Die Meldung zum fälligen Review MUSS den Aufgabenstand des Features nennen:
  erledigte Aufgaben, Gesamtzahl und Anzahl der offenen.
- **FR-012a**: Wird ein Feature ohne menschliches Review automatisch gemergt, MUSS die Meldung
  über den vollzogenen Merge denselben Aufgabenstand nennen wie FR-012 — dies ist auf diesem Pfad
  die einzige Stelle, an der ein Mensch ihn zu sehen bekommt. Es entsteht dafür kein neuer
  Meldungstyp und kein Aufmerksamkeits-Eintrag.
- **FR-013**: Liegt für ein Feature keine Aufgabenliste vor (Gesamtzahl 0), MÜSSEN die Meldungen
  aus FR-012 und FR-012a dies als solches benennen, statt einen Stand von „0/0" auszuweisen.
- **FR-014**: Das Review-Portal MUSS den Aufgabenstand des Features ohne Reiterwechsel und ohne
  zusätzliche Interaktion sichtbar machen.
- **FR-015**: Offene Aufgaben MÜSSEN im Review-Portal als solche hervorgehoben sein, wenn ihre
  Anzahl grösser als 0 ist.
- **FR-016**: Ein unvollständiger Aufgabenstand DARF keine Freigabe, keine Einreihung in die
  Merge-Queue und keinen Merge verhindern; die bestehende Mindesthürde (Aufgabenliste vorhanden
  und keine einzige Aufgabe erledigt) bleibt unverändert die einzige Sperre.

**Läufe mit Bezugsgrösse (Story 3)**

- **FR-017**: Die Zusammenfassung eines Laufs MUSS die erledigten und die gesamten Aufgaben des
  zugehörigen Features führen.
- **FR-018**: Die Läufe-Liste MUSS den Aufgabenstand je Lauf als eigene, ohne Aufklappen
  sichtbare Angabe zeigen.
- **FR-019**: Läufe-Liste und Lauf-Dashboard MÜSSEN die Kosten pro erledigter Aufgabe zeigen.
- **FR-020**: Ist die Zahl der erledigten Aufgaben 0, MUSS anstelle der Kosten pro Aufgabe ein
  Strich stehen — kein Wert, keine Schätzung, keine Fehlermeldung.
- **FR-021**: Enthält ein Lauf Ausführungen ohne gemeldeten Betrag, MUSS der Wert „Kosten pro
  Aufgabe" als unvollständig gekennzeichnet sein.
- **FR-022**: Alle neuen Anzeigen MÜSSEN aus bereits erhobenen Daten abgeleitet werden; es DARF
  keine neue Erhebung, kein zusätzlicher Messpfad und keine zusätzliche Zählung eingeführt
  werden.

### Key Entities

- **Projekt**: hält die Liste seiner Verifikationskommandos. Eine leere Liste ist der Zustand
  „keine Verifikation konfiguriert" — die Grundlage von Story 1.
- **Feature**: hält den Aufgabenstand (erledigt, gesamt) aus seiner Aufgabenliste sowie seine
  Integrationsstufe. Beide Werte existieren bereits und werden nur weitergegeben.
- **Aufmerksamkeits-Eintrag**: benennt einen Zustand, der einen Menschen braucht. Neu: ein
  projektbezogener Eintrag zur fehlenden Verifikationskonfiguration, dessen Lebensdauer an der
  Konfiguration hängt und nicht am Stand eines Features.
- **Review-Übersicht-Eintrag**: verdichtete Sicht eines integrationsnahen Features für die
  Entscheidung. Erhält den Aufgabenstand und einen unterscheidbaren Verifikationszustand.
- **Lauf-Zusammenfassung**: Verbrauch eines Laufs (ein Lauf = ein Worktree/Feature). Erhält
  Aufgabenstand und Kosten pro erledigter Aufgabe als Bezugsgrösse.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Für ein Projekt ohne konfigurierte Verifikation behauptet keine der Anzeigen zu
  einem seiner Features eine Verifikation — geprüft über alle Stellen, an denen die
  Integrationsstufe erscheint (Board, Übersichten, Meldungen, Review-Portal): 0 Treffer für die
  Aussage „verifiziert" bzw. „Verifikation läuft".
- **SC-002**: Der erste Integrationsversuch eines solchen Projekts erzeugt genau einen
  Aufmerksamkeits-Eintrag; fünf weitere Features desselben Projekts erzeugen keinen weiteren, und
  der Eintrag ist nach Hinterlegen eines Verifikationskommandos ohne manuellen Eingriff
  verschwunden.
- **SC-003**: 100 % der Meldungen zum fälligen Review und 100 % der Meldungen über einen ohne
  Review vollzogenen Merge nennen den Aufgabenstand — mit Zahlen, wenn eine Aufgabenliste
  vorliegt, sonst mit dem Hinweis, dass keine vorliegt.
- **SC-004**: Ein Reviewer erkennt beim Öffnen des Review-Portals ohne einen weiteren Klick, ob
  verifiziert wurde und wie viele Aufgaben offen sind.
- **SC-005**: Die Zahl der aus Sicht der Integration blockierten oder eskalierten Features bleibt
  unverändert: ein Feature mit teilweise erledigter Aufgabenliste und ein Feature eines Projekts
  ohne Verifikationskonfiguration laufen weiterhin vollständig durch.
- **SC-006**: In der Läufe-Liste sind für jeden Lauf Aufgabenstand und Kosten pro erledigter
  Aufgabe ohne Aufklappen ablesbar; für Läufe ohne erledigte Aufgabe erscheint ausschließlich ein
  Strich.
- **SC-007**: Zwei Läufe mit gleichem Gesamtbetrag und deutlich unterschiedlicher Aufgabenzahl
  sind in der Läufe-Ansicht anhand der Kosten pro Aufgabe voneinander unterscheidbar.
- **SC-008**: Kein neuer Datenerhebungspfad: die Zahl der Mess- und Zählstellen bleibt gegenüber
  dem Stand vor diesem Feature gleich.

## Assumptions

- Der Aufmerksamkeits-Eintrag zur fehlenden Verifikation gilt für das PROJEKT, nicht für das
  einzelne Feature. „Beim ersten Integrationsversuch" wird als „einmal, solange die Lücke
  besteht" gelesen — sonst entstünde bei jedem Feature ein weiterer Eintrag und die
  Aufmerksamkeits-Liste würde vom eigentlichen Signal ablenken.
- Der Eintrag entsteht erst, wenn ein Integrationsversuch die Verifikationsstufe tatsächlich
  erreicht — also nach den bestehenden Vorprüfungen. Ein an einer Vorprüfung abgewiesener Versuch
  lässt weiterhin jeden Zustand unverändert.
- „Kosten pro Task" wird als Betrag geteilt durch die Zahl der ERLEDIGTEN Aufgaben verstanden:
  gemessen wird, was tatsächlich entstanden ist, nicht was geplant war. Bei 0 erledigten Aufgaben
  gibt es keinen Wert (Strich), passend zur bestehenden Regel, nie zu schätzen.
- Der Betrag eines Laufs kann unvollständig sein (Ausführungen ohne gemeldeten Betrag). Diese
  bereits vorhandene Kennzeichnung wird auf die abgeleitete Grösse „Kosten pro Aufgabe"
  übertragen, statt sie dort zu verschweigen.
- Die Wortwahl der neuen Texte ist deutsch und folgt der bestehenden Oberfläche; „Verifikation"
  bleibt der Begriff für die konfigurierten Prüfkommandos.
- Story 1 ändert nur Benennung und Aufmerksamkeit, keine Automatik. Ob ein Projekt ohne
  Verifikation überhaupt automatisch mergen DARF, ist bewusst nicht Teil dieses Features — die
  Entscheidung bleibt beim Menschen, sie wird nur nicht länger durch eine falsche Zusicherung
  vorweggenommen.
- Die Aufgabenzahlen am Feature gelten als vorhanden und gepflegt; ihre Erhebung aus der
  Aufgabenliste wird nicht angetastet.
- Ausdrücklich NICHT Teil dieses Features: neue Sperren, ein Zwang zur Konfiguration von
  Verifikationskommandos, Änderungen an der bestehenden Mindesthürde, ein neuer Messpfad für
  Kosten oder Tokens.
