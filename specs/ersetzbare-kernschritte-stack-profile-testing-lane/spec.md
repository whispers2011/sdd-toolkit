# Feature Specification: Ersetzbare Kernschritte, Stack-Profile und Testing-Lane

**Feature Branch**: `feature/ersetzbare-kernschritte-stack-profile-testing-lane`

**Created**: 2026-07-31

**Status**: Draft

**Voraussetzungen**: F1a und F1b (beide umgesetzt und gemergt)

**Input**: Drei zusammenhängende Anliegen: konfigurierbare Stacks je Feature, eine kollisionsfreie
Portvergabe und eine Testing-Lane, in der ein Feature vor dem Merge von Hand ausprobiert wird.

## Kontext und Ausgangslage *(gemessen am 30.07.2026)*

Diese Spezifikation beschreibt keine Vorsorge gegen Hypothesen, sondern die Behebung beobachteter
Schäden:

- **Das Toolkit weiß nicht, wo ein Feature läuft.** Es existiert kein Begriff für Stack, Container
  oder Port. Wer ein Feature ausprobieren will, muss den Worktree selbst suchen und den Dev-Server
  selbst starten.
- **Zwei parallel laufende Features fuhren auf denselben Standardports** (`localhost:8080`,
  `localhost:4000`). Kein einziger Portschalter war gesetzt. Wer die URL öffnete, sah je nach
  Startreihenfolge das falsche Feature.
- **Ein Agent beendete Prozesse über ein Namensmuster** (`pkill -f "dx serve"` ohne Port) und traf
  damit jeden gleichartigen Server der Maschine — auch die der Nachbar-Features.
- **Nach dem Merge blieben Worktrees liegen** (in einem Fall 10 GB), weil ein laufender Dev-Server
  das Arbeitsverzeichnis hielt. Das Entfernen schlug fehl, der Worktree-Pfad wurde **trotzdem**
  auf leer gesetzt. Damit war das Verzeichnis für das Toolkit unauffindbar und wuchs unbemerkt
  weiter.
- **Die Platte lief auf 813 MB freien Speicher**, und der Server starb mit hoher Wahrscheinlichkeit
  daran. Die Worktree-Übersicht zeigt keine Größe und warnt nicht.

Warum es Stufen braucht statt „einfach den ganzen Stack pro Feature": ein Beispielprojekt hat sieben
Dienste. Drei parallele Features wären 21 Container auf einer Maschine, die bereits an Platte und
Swap anstand. Ein voller Stack pro Feature ist bei Business-Anwendungen nicht bezahlbar.

### Übernahme aus F1b *(entschieden am 30.07.2026)*

F1b liefert Lebenszyklus-Schritte mit sechs Kontextvariablen (`$SDD_WORKTREE`, `$SDD_PROJECT`,
`$SDD_FEATURE`, `$SDD_BRANCH`, `$SDD_PHASE`, `$SDD_STAGE`). Zwei Variablen fehlen **bewusst** und
sind Auftrag dieses Features:

- **`$SDD_PORT_BASE`** — aus F1b herausgenommen, weil zwei Quellen für die Portvergabe genau die
  Kollision erzeugt hätten, die dieses Feature beseitigt (F1b, FR-013).
- **`$SDD_PROFILE`** — herausgenommen, weil es zum Zeitpunkt von F1b keinen Profil-Begriff gab
  (F1b, FR-014).

F1b hat dafür **einen** Erweiterungspunkt gebaut: der Variablensatz entsteht an einer einzigen
Stelle. Dort — und nur dort — ergänzt dieses Feature die zwei Variablen. Kein zweiter Weg daneben.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zwei Features gleichzeitig laufen lassen, ohne dass sie sich in die Quere kommen (Priority: P1)

Als Entwickler arbeite ich an zwei Features desselben Projekts parallel. Beide brauchen einen
laufenden Webserver und eine Datenbank. Ich möchte, dass jedes Feature seinen eigenen Portbereich
bekommt, ohne dass ich Ports von Hand vergebe oder buchführe — und dass jeder eigene Schritt und
jeder Agent im Worktree denselben Bereich sieht.

**Why this priority**: Ohne kollisionsfreie Ports ist paralleles Arbeiten unmöglich, und alle
weiteren Stories (Testing-Lane, Stack-Status, klickbare URL) hängen daran. Dies ist der Kern des
beobachteten Schadens.

**Independent Test**: Zwei Features desselben Projekts anlegen, in beiden Worktrees die Env-Datei
lesen und die zugewiesenen Bereiche vergleichen; anschließend in beiden einen Schritt laufen
lassen, der `$SDD_PORT_BASE` ausgibt. Liefert Wert auch ohne Stack-Profile und ohne Testing-Lane.

**Acceptance Scenarios**:

1. **Given** ein Projekt ohne bestehende Worktrees, **When** ich zwei Features anlege, **Then**
   erhält jeder Worktree einen eigenen, sich nicht überschneidenden Portbereich, und beide Bereiche
   stehen in einer Env-Datei im jeweiligen Worktree.
2. **Given** ein Feature mit zugewiesenem Portbereich, **When** ein Lebenszyklus-Schritt läuft,
   **Then** ist `$SDD_PORT_BASE` gesetzt und trägt genau den Wert aus der Env-Datei des eigenen
   Worktrees.
3. **Given** ein Feature, das über mehrere Läufe und mehrere Tage bearbeitet wird, **When** ich den
   Portbereich nach jedem Lauf prüfe, **Then** ist er unverändert — er wird nicht pro Lauf neu
   vergeben.
4. **Given** ein Portbereich, der von einem projektfremden Prozess belegt ist, **When** ein neuer
   Worktree entsteht, **Then** wird dieser Bereich übersprungen und ein freier zugewiesen.
5. **Given** ein Feature, dessen Worktree entfernt wurde, **When** danach ein neues Feature
   entsteht, **Then** darf der freigewordene Bereich wiederverwendet werden.
6. **Given** eine bestehende Schritt-Konfiguration aus F1b, die die neuen Variablen nicht verwendet,
   **When** dieses Feature aktiv ist, **Then** läuft der Schritt unverändert weiter.

---

### User Story 2 - Nur den Stack bezahlen, den ich gerade brauche (Priority: P1)

Als Entwickler möchte ich, dass ab `implement` genau die Dienste laufen, die meine Testsuite
braucht — nicht mehr. Den vollen Stack möchte ich erst dann hochfahren, wenn ich das Feature von
Hand abnehmen will. Und ich möchte, dass am Ende alles wieder abgebaut wird, einschließlich der
Datenablagen.

**Why this priority**: Ohne Abstufung ist paralleles Arbeiten an einer Business-Anwendung
wirtschaftlich nicht möglich (7 Dienste × 3 Features). Zugleich ist der `test`-Stack die Bedingung
dafür, dass TDD ab `implement` überhaupt funktioniert.

**Independent Test**: Ein Projekt mit den drei Profilkommandos konfigurieren, ein Feature bis
`implement` führen und prüfen, dass ausschließlich die Dienste des `test`-Profils laufen; danach den
Abbau anstoßen und prüfen, dass nichts zurückbleibt. Unabhängig von der Testing-Lane testbar.

**Acceptance Scenarios**:

1. **Given** ein Projekt mit konfigurierten Stack-Profilen, **When** ein Feature die Phase
   `implement` beginnt, **Then** läuft das `test`-Profil und die Testsuite findet ihre Dienste vor.
2. **Given** ein Feature mit laufendem `test`-Profil, **When** mehrere Läufe hintereinander
   stattfinden, **Then** bleibt der Stack durchgehend stehen und wird nicht pro Lauf herunter- und
   wieder hochgefahren.
3. **Given** ein bereits laufendes `test`-Profil, **When** das Hochfahren erneut angestoßen wird,
   **Then** entsteht kein zweiter Satz Dienste und kein Fehler.
4. **Given** ein Projekt **ohne** konfigurierte Stack-Profile, **When** ein Feature den ganzen
   Lebenszyklus durchläuft, **Then** verhält sich der Ablauf wie vor diesem Feature, und die
   fehlende Konfiguration ist als solche sichtbar — sie blockiert nicht.
5. **Given** ein konfiguriertes `test`-Profil, dessen Kommando fehlschlägt, **When** `implement`
   beginnen soll, **Then** entsteht eine „Braucht dich"-Meldung mit dem Ausgabe-Ausschnitt, statt
   dass die Phase auf einem halben Stack weiterläuft.
6. **Given** zwei Features desselben Projekts mit je eigenem `test`-Profil, **When** beide laufen,
   **Then** hat jedes seine eigene Datenbank, und die Migrationen des einen wirken nicht auf das
   andere.
7. **Given** ein als projektweit geteilt konfigurierter, zustandsloser Nebendienst, **When** ein
   zweites Feature startet, **Then** wird dieser Dienst nicht ein zweites Mal gestartet.
8. **Given** zwei Features, die einen geteilten Nebendienst nutzen, **When** eines von beiden
   abgebaut wird, **Then** bleibt der geteilte Dienst für das andere in Betrieb; erst mit dem
   letzten Feature wird er abgebaut.

---

### User Story 3 - Ein Feature vor dem Merge von Hand ausprobieren (Priority: P1)

Als Entscheider möchte ich vor dem Review die laufende Anwendung des Features öffnen, durchklicken
und eine Regressionsabnahme machen. Ich möchte in einer Ansicht sehen, wo das Feature liegt, auf
welchem Branch, unter welcher URL es erreichbar ist, welche Dienste mit welchen Ports laufen — und
den Stack von dort aus starten, stoppen, neu starten und abbauen können.

**Why this priority**: Das ist der eigentliche Zweck des Features aus Sicht des Menschen: die
Prüfung vor dem Merge. Ohne sie bleibt die Portvergabe ein unsichtbares Detail.

**Independent Test**: Ein Feature mit eingeschaltetem Gate durch Verifikation führen, die
Testing-Lane öffnen und die angezeigte URL anklicken; prüfen, dass die Anwendung genau dieses
Features erscheint. Testbar, sobald US1 steht.

**Acceptance Scenarios**:

1. **Given** ein Feature, dessen Verifikation durch ist, und ein eingeschaltetes manuelles
   Test-Gate, **When** die Integration weiterläuft, **Then** hält das Feature auf der neuen Stufe
   `awaiting_manual_test` an — **vor** dem menschlichen Review.
2. **Given** ein Feature auf `awaiting_manual_test`, **When** ich die Testing-Lane öffne, **Then**
   sehe ich Worktree-Pfad, Branch, klickbare Stack-URL, Anlagedatum und je Dienst Status samt Port.
3. **Given** zwei Features gleichzeitig in der Testing-Lane, **When** ich die URL des einen
   anklicke, **Then** öffnet sich die Anwendung genau dieses Features, nicht die des anderen.
4. **Given** ein Feature auf `awaiting_manual_test`, **When** ich den vollen Stack starte, **Then**
   laufen die Dienste des `full`-Profils und die Ansicht zeigt sie einzeln mit Port und Status.
5. **Given** ein laufender voller Stack, **When** ich Stoppen, Neustarten oder Abbauen wähle,
   **Then** wird genau der Stack dieses Features betroffen und kein anderer.
6. **Given** ein Feature auf `awaiting_manual_test`, **When** ich die manuelle Abnahme bestätige,
   **Then** geht das Feature auf `awaiting_human_review` weiter.
7. **Given** ein Feature auf `awaiting_manual_test`, **When** ich die Abnahme ablehne, **Then** geht
   das Feature in Nacharbeit zurück und der Grund ist festgehalten.
8. **Given** ein ausgeschaltetes manuelles Test-Gate, **When** die Verifikation durch ist, **Then**
   wird die neue Stufe nicht betreten und der Ablauf ist unverändert.
9. **Given** ein Projekt ohne konfigurierte Stack-Profile, **When** ich die Testing-Lane öffne,
   **Then** nennt die Ansicht die fehlende Konfiguration statt eine URL anzubieten, die nirgends
   hinführt.

---

### User Story 4 - Nach dem Merge bleibt nichts zurück (Priority: P2)

Als Entwickler möchte ich, dass nach dem Merge kein Verzeichnis, kein Container und kein Volume
übrig bleibt. Und wenn das Aufräumen nicht klappt, möchte ich es erfahren — statt dass ein 10-GB-
Verzeichnis unauffindbar weiterwächst.

**Why this priority**: Der beobachtete Schaden ist bereits eingetreten. Er ist nicht blockierend für
die Arbeit an einem Feature, frisst aber die Maschine auf, an der alles andere hängt.

**Independent Test**: Ein Feature mergen, während ein Prozess im Worktree läuft, und prüfen, dass
der Worktree-Pfad erhalten bleibt und eine Meldung entsteht; danach den Prozess beenden, erneut
anstoßen und prüfen, dass Verzeichnis, Container und Volumes verschwunden sind.

**Acceptance Scenarios**:

1. **Given** ein gemergtes Feature, **When** das Aufräumen läuft, **Then** wird das Ergebnis des
   Entfernens geprüft, nicht angenommen.
2. **Given** ein Entfernen, das fehlschlägt (etwa weil ein Prozess das Verzeichnis hält), **When**
   das Aufräumen läuft, **Then** bleibt der Worktree-Pfad gesetzt und es entsteht eine
   „Braucht dich"-Meldung mit dem Grund.
3. **Given** ein zuvor fehlgeschlagenes Aufräumen, **When** ich es nach Beheben der Ursache erneut
   anstoße, **Then** läuft es zu Ende und der Pfad wird erst danach geleert.
4. **Given** ein gemergtes Feature mit Stack, **When** aufgeräumt wird, **Then** sind auch die
   Datenablagen (Volumes) und die Build-Verzeichnisse fort.
5. **Given** ein Worktree, der keinem Feature mehr zugeordnet ist, **When** die Erhebung läuft,
   **Then** wird er aktiv als „Braucht dich"-Meldung gemeldet, nicht nur in einer Liste geführt.
6. **Given** eine endende Session mit laufenden Kindprozessen, **When** die Session beendet wird,
   **Then** werden die Prozesse über ihre Prozessgruppe beendet und kein gleichartiger Prozess
   eines Nachbar-Features stirbt mit.

---

### User Story 5 - Sehen, wie viel Platte ein Worktree kostet (Priority: P3)

Als Entwickler möchte ich in der Worktree-Übersicht die Größe je Worktree sehen und gewarnt werden,
bevor die Platte voll ist.

**Why this priority**: Diagnose- und Vorsorgewert. Behebt keinen Ablauffehler, aber ohne diese
Sichtbarkeit war die Ursache des Serverausfalls am 30.07. nur zu vermuten.

**Independent Test**: Die Worktree-Übersicht öffnen und die angezeigten Größen gegen eine
unabhängige Messung halten; die Warnschwelle künstlich unterschreiten und prüfen, dass die Warnung
erscheint.

**Acceptance Scenarios**:

1. **Given** mehrere bestehende Worktrees, **When** ich die Übersicht öffne, **Then** steht je
   Worktree eine Größe.
2. **Given** einen freien Plattenplatz unterhalb der Warnschwelle, **When** ich die Übersicht öffne,
   **Then** erscheint eine Warnung mit dem freien Platz und den größten Worktrees.
3. **Given** einen Worktree, dessen Größe nicht ermittelbar ist, **When** ich die Übersicht öffne,
   **Then** bleibt der Eintrag mit allen anderen Angaben sichtbar und die Größe ist als unbekannt
   gekennzeichnet.

---

### Edge Cases

- **Portbereiche erschöpft**: Alle vorgesehenen Bereiche sind belegt. Erwartung: klare Meldung beim
  Anlegen, kein Worktree ohne Bereich und keine stille Doppelvergabe.
- **Env-Datei fehlt oder wurde von Hand verändert**: Erwartung: die Zuweisung des Toolkits bleibt
  die Wahrheit; die Datei wird beim nächsten Anlass wieder in den erwarteten Stand gebracht.
- **Env-Datei im Commit**: Erwartung: die Datei ist keine versionierte Projektdatei und landet nicht
  im Merge.
- **Fremdprozess belegt einen Port erst nach der Zuweisung**: Erwartung: der Fehlschlag beim
  Hochfahren ist als solcher sichtbar und nennt den Port.
- **Abbau eines Profils schlägt fehl**: Erwartung: Meldung statt stillem Weitergehen; der Merge
  räumt nicht halb auf und meldet Erfolg.
- **Feature wird archiviert oder abgebrochen, ohne je gemergt zu werden**: Erwartung: Stack-Abbau
  und Portfreigabe finden trotzdem statt.
- **Gate wird eingeschaltet, während ein Feature schon auf `awaiting_human_review` steht**:
  Erwartung: das laufende Feature wird nicht rückwärts geschoben; die Regel greift ab dem nächsten
  Durchlauf.
- **Server startet neu, während Stacks laufen**: Erwartung: der tatsächliche Zustand der Dienste
  wird neu erhoben, statt einen gemerkten Stand zu behaupten.
- **Zwei Features desselben Projekts wollen denselben geteilten Nebendienst gleichzeitig starten**:
  Erwartung: er entsteht genau einmal.
- **Worktree-Verzeichnis von außen gelöscht, Portbereich noch vergeben**: Erwartung: der Bereich
  wird freigegeben, sobald der Zustand erkannt ist.
- **Anwendung im Worktree läuft, ist aber unter der erwarteten URL nicht erreichbar**: Erwartung:
  die Lane zeigt „nicht erreichbar" statt eines Links, der ins Leere führt.

## Requirements *(mandatory)*

### Functional Requirements

**Portvergabe — eine einzige Quelle**

- **FR-001**: Das System MUSS jedem Worktree beim Anlegen genau einen Portbereich zuweisen, und
  diese Zuweisung MUSS an einer einzigen Stelle geschehen.
- **FR-002**: Ein zugewiesener Portbereich MUSS unter allen gleichzeitig bestehenden Worktrees
  eindeutig sein — projektübergreifend, nicht nur innerhalb eines Projekts.
- **FR-003**: Das System MUSS vor der Zuweisung prüfen, ob die Ports des Bereichs frei sind, und
  belegte Bereiche überspringen.
- **FR-004**: Der Portbereich eines Features MUSS über alle Läufe und Sitzungen hinweg stabil
  bleiben, solange der Worktree besteht.
- **FR-005**: Das System MUSS den Portbereich freigeben, wenn der Worktree entfernt wurde, und darf
  ihn danach wiederverwenden.
- **FR-006**: Das System MUSS den Portbereich in eine Env-Datei im Worktree schreiben, die eigene
  Schritte und Agents ohne Toolkit-Zugriff lesen können.
- **FR-007**: Das System MUSS `$SDD_PORT_BASE` und `$SDD_PROFILE` über **dieselbe** Stelle
  bereitstellen, an der F1b den Variablensatz aufbaut. Ein zweiter Weg zur Portvergabe oder zum
  Variablensatz DARF NICHT entstehen.
- **FR-008**: Bestehende Schritt-Konfigurationen, die die zwei neuen Variablen nicht verwenden,
  MÜSSEN unverändert weiterlaufen.
- **FR-009**: Die Env-Datei DARF NICHT als versionierte Projektdatei in Commits oder Merges
  gelangen.
- **FR-010**: Sind keine Portbereiche mehr frei, MUSS das System das Anlegen mit einer klaren
  Meldung beenden, statt einen Bereich doppelt zu vergeben.

**Stack-Profile als ersetzbare Kernschritte**

- **FR-011**: Das System MUSS drei benannte Profile kennen — `test`, `full`, `down` — deren Kommando
  je Projekt konfigurierbar ist.
- **FR-012**: Die Profile MÜSSEN als ersetzbare Kernschritte ausgeführt werden: ein Projekt kann das
  Kommando eines Profils vollständig durch sein eigenes ersetzen. Das System DARF KEINE bestimmte
  Container- oder Orchestrierungstechnik voraussetzen.
- **FR-013**: Ein Projekt ohne konfigurierte Profile MUSS sich wie vor diesem Feature verhalten; die
  fehlende Konfiguration MUSS sichtbar sein und DARF NICHT blockieren.
- **FR-014**: Das System MUSS das `test`-Profil ab Beginn der Phase `implement` betreiben und es über
  alle folgenden Läufe des Features stehen lassen — nicht pro Lauf hoch- und herunterfahren.
- **FR-015**: Das erneute Anstoßen eines bereits laufenden Profils MUSS ohne zweiten Satz Dienste
  und ohne Fehler bleiben.
- **FR-016**: Das System MUSS das `full`-Profil ausschließlich auf Anforderung aus der Testing-Lane
  betreiben.
- **FR-017**: Das System MUSS das `down`-Profil bei Session-Ende, beim Merge und beim Entfernen eines
  Worktrees ausführen, einschließlich der Datenablagen (Volumes).
- **FR-018**: Das System MUSS dem laufenden Profilkommando über `$SDD_PROFILE` mitteilen, welches
  Profil gemeint ist.
- **FR-019**: Schlägt das Hoch- oder Herunterfahren eines Profils fehl, MUSS eine „Braucht dich"-
  Meldung mit Ausgabe-Ausschnitt entstehen; der Ablauf DARF NICHT stillschweigend auf einem halben
  Stack weiterlaufen.
- **FR-020**: Das System MUSS je Dienst konfigurierbar machen, ob er feature-eigen oder projektweit
  geteilt betrieben wird.
- **FR-021**: Zustandsbehaftete Dienste, insbesondere die Datenbank, MÜSSEN feature-eigen laufen;
  zwei Features MÜSSEN unabhängige Datenbestände und Migrationen haben.
- **FR-022**: Ein als geteilt konfigurierter Dienst MUSS projektweit genau einmal laufen und DARF
  beim Abbau eines Features nur dann abgebaut werden, wenn kein weiteres Feature ihn nutzt.
- **FR-023**: Das System MUSS den Zustand der Dienste eines Features erheben können, statt einen
  gemerkten Stand zu behaupten — auch nach einem Neustart des Servers.

**Manuelles Test-Gate und Testing-Lane**

- **FR-024**: Das System MUSS eine Integrationsstufe `awaiting_manual_test` führen, die **vor**
  `awaiting_human_review` liegt.
- **FR-025**: Das System MUSS einen Schalter `manualTestGate` bereitstellen, der wie die übrigen
  Automation-Schalter über die Ebenen global → Projekt → Feature auflösbar ist.
- **FR-026**: Der Schalter MUSS in den Vorgaben für Stufe 2 eingeschaltet und in den Vorgaben für
  Stufe 3 ausgeschaltet sein.
- **FR-027**: Bei ausgeschaltetem Gate DARF die neue Stufe nicht betreten werden; der Ablauf MUSS
  unverändert bleiben.
- **FR-028**: Das Verlassen von `awaiting_manual_test` in Richtung Review MUSS eine ausdrückliche
  menschliche Bestätigung erfordern und DARF NICHT automatisch geschehen.
- **FR-029**: Das System MUSS eine Ablehnung der manuellen Abnahme erlauben, das Feature in
  Nacharbeit zurückführen und den Grund festhalten.
- **FR-030**: Die Testing-Lane MUSS je Feature Worktree-Pfad, Branch, Stack-URL, Anlagedatum und je
  Dienst Status samt Port zeigen.
- **FR-031**: Die Stack-URL MUSS anklickbar sein und die Anwendung genau dieses Features öffnen.
- **FR-032**: Die Testing-Lane MUSS je Feature Starten, Stoppen, Neustarten und Abbauen anbieten,
  jeweils wirksam nur auf den Stack dieses Features.
- **FR-033**: Ist kein Stack konfiguriert oder die Anwendung nicht erreichbar, MUSS die Lane das
  benennen, statt einen Link ins Leere anzubieten.

**Aufräumen und Prozessende**

- **FR-034**: Der Merge-Abschluss MUSS prüfen, ob das Entfernen des Worktrees tatsächlich
  geklappt hat.
- **FR-035**: Scheitert das Entfernen, MUSS der Worktree-Pfad des Features gesetzt bleiben und eine
  „Braucht dich"-Meldung mit dem Grund entstehen. Der Pfad DARF NICHT stillschweigend geleert
  werden.
- **FR-036**: Das System MUSS den Worktree-Pfad erst nach nachgewiesen erfolgreichem Entfernen
  leeren.
- **FR-037**: Ein zuvor fehlgeschlagenes Aufräumen MUSS wiederholbar sein und nach Beheben der
  Ursache zu Ende laufen.
- **FR-038**: Das Entfernen MUSS die Build-Verzeichnisse des Worktrees und die Datenablagen des
  Stacks einbeziehen.
- **FR-039**: Das System MUSS Worktrees, die keinem Feature mehr zugeordnet sind, aktiv als
  „Braucht dich"-Meldung melden.
- **FR-040**: Das System MUSS Prozesse beim Session-Ende über ihre Prozessgruppe beenden. Ein
  Beenden über Namensmuster DARF NICHT stattfinden.
- **FR-041**: Das Beenden DARF ausschließlich Prozesse treffen, die das System selbst gestartet hat;
  gleichartige Prozesse anderer Features oder Sitzungen MÜSSEN unberührt bleiben.

**Plattenplatz**

- **FR-042**: Die Worktree-Übersicht MUSS je Worktree eine Größe zeigen.
- **FR-043**: Das System MUSS bei freiem Plattenplatz unterhalb einer dokumentierten Schwelle warnen
  und dabei den freien Platz sowie die größten Worktrees nennen.
- **FR-044**: Die Größenerhebung DARF die Übersicht nicht blockieren; ist eine Größe nicht
  ermittelbar, MUSS der Eintrag mit allen übrigen Angaben sichtbar bleiben.

### Key Entities

- **Portbereich**: Der einem Worktree zugewiesene, exklusive Bereich von Ports. Merkmale: Anfang,
  Breite, zugeordneter Worktree, Zeitpunkt der Zuweisung, Freigabestand. Einzige Quelle der
  Portvergabe.
- **Stack-Profil**: Eine der drei benannten Stufen (`test`, `full`, `down`) mit dem je Projekt
  konfigurierten Kommando und dem Punkt im Lebenszyklus, an dem sie greift.
- **Dienst**: Ein einzelner Bestandteil eines Stacks. Merkmale: Name, Port innerhalb des Bereichs,
  Betriebsart (feature-eigen oder projektweit geteilt), Zustandsbehaftung, aktueller Status.
- **Stack-Zustand eines Features**: Welches Profil betrieben wird, welche Dienste laufen, unter
  welchen Ports sie erreichbar sind und wann zuletzt erhoben wurde.
- **Testing-Lane-Eintrag**: Die Zusammenstellung, die ein Mensch zur manuellen Abnahme braucht —
  Feature, Worktree-Pfad, Branch, Anlagedatum, Stack-URL und Dienstliste.
- **Manuelle Abnahme**: Die menschliche Entscheidung an der Stufe `awaiting_manual_test` —
  bestätigt oder abgelehnt, mit Zeitpunkt und Grund.
- **Worktree-Größe**: Der Platzverbrauch eines Worktrees als Teil der Worktree-Übersicht, mit dem
  Zustand „unbekannt" als gültigem Wert.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zwei Features desselben Projekts laufen gleichzeitig mit vollständig laufenden Stacks,
  ohne dass ein einziger Port doppelt belegt ist — nachgewiesen durch einen Durchlauf mit zwei
  parallelen Features.
- **SC-002**: Ein Klick auf die Stack-URL in der Testing-Lane öffnet in 100 % der geprüften Fälle
  die Anwendung des angeklickten Features.
- **SC-003**: Nach dem Merge eines Features mit Stack bleibt kein Verzeichnis, kein Dienst und keine
  Datenablage zurück — nachgewiesen durch eine unabhängige Nachmessung von Verzeichnisbaum, laufenden
  Diensten und Datenablagen.
- **SC-004**: Scheitert das Entfernen, entsteht in 100 % der Fälle eine „Braucht dich"-Meldung, und
  in 0 % der Fälle wird der Worktree-Pfad geleert.
- **SC-005**: Bei drei parallel bearbeiteten Features laufen nur deren `test`-Stufen; ein voller
  Stack läuft höchstens für das Feature, das gerade in der Testing-Lane geprüft wird.
- **SC-006**: Der `test`-Stack steht ab Beginn von `implement` in 100 % der Läufe und wird über
  aufeinanderfolgende Läufe desselben Features nicht neu gestartet.
- **SC-007**: Bestehende Schritt-Konfigurationen aus F1b, die die neuen Variablen nicht verwenden,
  zeigen keine Verhaltensänderung — nachgewiesen durch automatisierte Tests.
- **SC-008**: Beim Session-Ende überlebt jeder Prozess, der nicht zur beendeten Session gehört —
  nachgewiesen mit zwei gleichnamigen Prozessen aus zwei Sessions.
- **SC-009**: Ein Mensch findet in der Testing-Lane ohne Rückfrage und ohne Terminal heraus, wo ein
  Feature liegt und unter welcher Adresse es läuft — alle fünf geforderten Angaben sind in einer
  Ansicht sichtbar.
- **SC-010**: Ein Projekt ohne Stack-Konfiguration zeigt gegenüber heute keine zusätzlichen
  Fehlschläge und keine messbar längere Zeit bis zum Start der ersten Phase.
- **SC-011**: Jeder verwaiste Worktree erscheint innerhalb einer Erhebung als „Braucht dich"-Meldung.
- **SC-012**: Die Worktree-Übersicht nennt für jeden Worktree eine Größe oder „unbekannt"; bei
  Unterschreiten der Schwelle erscheint die Warnung.

## Assumptions

- **Portbereich als Block**: `$SDD_PORT_BASE` benennt den Anfang eines zusammenhängenden Blocks
  fester Breite, der dem Worktree exklusiv gehört. Die konkreten Dienstports leiten sich als Abstand
  zu diesem Anfang ab; ein Dienst ist als Haupteingang der Anwendung gekennzeichnet, damit das
  Toolkit die klickbare URL bilden kann. Das Beispiel `8080+n/4000+n` aus dem Auftrag ist damit
  abgedeckt, ohne dass das Toolkit zwei getrennte Zahlenreihen führen muss.
- **Voller Stack startet auf Anforderung**: Das `full`-Profil fährt nicht automatisch beim Eintritt
  in die Testing-Lane hoch, sondern per Aktion. Grund: ein automatischer voller Stack für jedes
  Feature in der Lane stellt genau die Kostenlage wieder her, die dieses Feature beseitigen soll.
- **Geteilte Dienste: letzter räumt ab**: Ein projektweit geteilter Dienst wird beim Abbau des
  letzten ihn nutzenden Features abgebaut. Solange ein anderes Feature ihn nutzt, bleibt er stehen.
- **Keine mitgelieferten Profilkommandos**: Das Toolkit bringt keine vorgefertigten Stack-Kommandos
  mit. Ein Projekt ohne Konfiguration hat keinen Stack — sichtbar, aber nicht blockierend, analog
  zur bestehenden Behandlung fehlender Verifikationskommandos.
- **Warnschwelle Plattenplatz**: Die Schwelle ist konfigurierbar mit einem dokumentierten
  Vorgabewert. Sie richtet sich nach freiem Platz, nicht nach der Anzahl Worktrees.
- **Größenerhebung ist eine Schätzung**: Die Größe wird mit einem Zeitlimit erhoben und darf gerundet
  oder aus einem kurz zwischengehaltenen Stand kommen; Genauigkeit auf das Byte ist nicht gefordert.
- **Ablehnung führt nach `implement` zurück**: Eine abgelehnte manuelle Abnahme setzt das Feature in
  die Nacharbeit der Implementierung zurück, nicht an den Anfang des Lebenszyklus.
- **Env-Datei ist ein Erzeugnis**: Sie wird vom Toolkit geschrieben und ist keine vom Menschen
  gepflegte Projektdatei. Bei Abweichung gewinnt die Zuweisung des Toolkits.
- **Stufe 2 / Stufe 3** meinen die bestehenden Automatisierungsvorgaben des Dials; das Feature führt
  keine neue Automatisierungsstufe ein.

## Dependencies

- **F1a** und **F1b** sind Voraussetzung. Insbesondere nutzt dieses Feature den von F1b gebauten
  einzigen Erweiterungspunkt für den Variablensatz. F1b, FR-013 und FR-014 beschreiben die
  Abgrenzung und formulieren die Erweiterung ausdrücklich als Erwartung an dieses Feature.
- **Bestehender Automation-Dial**: Ebenen-Modell und Auflösung werden übernommen; der neue Schalter
  reiht sich ein, statt ein eigenes Bedienkonzept zu bekommen.
- **Bestehende Integrations-Pipeline**: Die neue Stufe reiht sich in die bestehende Abfolge ein; alle
  Stellen, die Stufen vollständig aufzählen, müssen die neue Stufe beantworten.
- **Bestehende „Braucht dich"-Inbox**: Alle Meldungen dieses Features nutzen die vorhandene Inbox,
  statt eine eigene Oberfläche zu bekommen.
- **Bestehende Worktree-Übersicht**: Größe und Plattenwarnung erweitern die vorhandene Ansicht.
- **Bestehende Sitzungsverwaltung**: Das Beenden über Prozessgruppen betrifft die Prozesse, die das
  Toolkit für Sessions und Schritte startet.

## Out of Scope

- **Sprechende Hostnamen** (`<feature>.test`): Dieses Feature liefert die URL in der ersten Stufe als
  `http://localhost:<port>`. Ein sprechender Hostname ist ein späterer Schritt und setzt
  Wildcard-DNS und einen Reverse-Proxy voraus.
- **Automatisierte Regressionstests in der Testing-Lane**: Die Lane dient der manuellen Abnahme durch
  einen Menschen; das Ausführen von Testsuiten bleibt bei der Verifikation.
- **Betrieb von Stacks auf anderen Maschinen oder in der Cloud**: Alles läuft auf der Maschine, auf
  der das Toolkit läuft.
- **Vorgefertigte Stack-Definitionen je Technologie**: Das Toolkit gibt Profile und Portbereich vor,
  nicht die Dienste eines Projekts.
- **Nachträgliche Umverteilung bestehender Portbereiche**: Bereiche werden bei der Anlage vergeben;
  ein Umsortieren laufender Worktrees ist nicht Teil dieses Features.
