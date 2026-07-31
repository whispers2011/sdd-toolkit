# Feature Specification: Eigene Schritte an den Lebenszyklus hängen

**Feature Branch**: `feature/eigene-schritte-an-den-lebenszyklus-haengen`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Das Toolkit soll erlauben, an definierten Punkten eigene Shell-Kommandos auszuführen — analog zu den bestehenden Agents mit before_phase/after_phase, aber mit Kommando statt Prompt. Vorbild in Bedienung und Fehlerverhalten: die Agent-Gates (blockierend/beratend). Trigger-Punkte: before_worktree_create, after_worktree_create, before_phase, after_phase, before_stage, after_stage. Schritt-Definition analog zu VerifyCommand { name, command }, erweitert um Auslöser, Fehlerverhalten (blockierend | beratend), Zeitlimit. Ebenen wie bei den Agents: global → Projekt → Feature. Ausführung im Worktree mit definiertem Kontext ($SDD_WORKTREE, $SDD_PROJECT, $SDD_FEATURE, $SDD_BRANCH, $SDD_PHASE, $SDD_STAGE, $SDD_PORT_BASE, $SDD_PROFILE). Jeder Schritt-Lauf erzeugt einen Eintrag in `executions` (eigene kind-Art). Ein blockierend fehlgeschlagener Schritt hält die Stufe an und erzeugt ein Attention-Item mit Kommando, Exit-Code und den letzten Ausgabezeilen."

## Clarifications

### Session 2026-07-30

- Q: Die Checkliste hat ein offenes Item („No [NEEDS CLARIFICATION] markers remain"), das
  nachweislich veraltet ist. Wie soll ich weitermachen? → A: Bedingung prüfen, dann abhaken und
  weiterarbeiten — die Checkliste hält einen **Zustand** fest, keine Historie. Nachgeprüft am
  30.07.2026: `spec.md`, `plan.md`, `tasks.md`, `data-model.md` und `quickstart.md` enthalten
  null Marker; die einzige Fundstelle in `research.md` ist der Satz, der ebendas feststellt, und
  kein offener Punkt. Das Item ist damit erfüllt und wurde abgehakt.
  Hintergrund, damit die Lücke im Ablauf nachvollziehbar bleibt: FR-013 (Portbereich) und FR-014
  (Profil) wurden nicht über einen `clarify`-Lauf geschlossen, sondern durch eine
  Umfangsentscheidung direkt in der Spezifikation — beide entfallen aus diesem Feature, F1c
  liefert sie nach. Die Checkliste stammt vom Stand davor. **Regel für solche Fälle:** ein Item,
  dessen Bedingung gegen die Artefakte geprüft und erfüllt ist, wird abgehakt; ein Item, dessen
  Bedingung offen ist, bleibt offen, auch wenn es unbequem ist. Nicht abhaken, weil „das ist doch
  längst erledigt" — abhaken, weil es nachgeprüft wurde.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Kommando nach der Worktree-Anlage automatisch ausführen (Priority: P1)

Eine Person, die ein Projekt im Toolkit betreut, hinterlegt einmal am Projekt: „Nach dem Anlegen
eines Worktrees Abhängigkeiten installieren." Ab dann läuft dieses Kommando bei jedem neuen Feature
dieses Projekts automatisch, bevor die erste Phase startet. Der Lauf erscheint in der
Läufe-Ansicht mit Dauer und Ergebnis — niemand muss den Worktree von Hand vorbereiten und niemand
muss raten, ob und wie lange etwas gelaufen ist.

**Why this priority**: Das ist die Abnahmebedingung des Features und zugleich der häufigste
Anwendungsfall. Ohne sie ist jeder frisch angelegte Worktree unbrauchbar, bis jemand ihn manuell
vorbereitet — die eigentliche Reibung, die dieses Feature beseitigt.

**Independent Test**: An einem Projekt einen Schritt mit Auslöser „nach Worktree-Anlage" und einem
Kommando hinterlegen, ein Feature anlegen und prüfen, dass (a) das Kommando im neuen Worktree
gelaufen ist, (b) ein Lauf mit Dauer und Ergebnis in der Läufe-Ansicht steht.

**Acceptance Scenarios**:

1. **Given** ein Projekt mit einem Schritt „Abhängigkeiten installieren" am Auslöser „nach
   Worktree-Anlage", **When** für dieses Projekt ein Feature angelegt und sein Worktree erstellt
   wird, **Then** läuft das Kommando im neuen Worktree, bevor die erste Phase startet.
2. **Given** ein soeben gelaufener Schritt, **When** die Läufe-Ansicht geöffnet wird, **Then**
   erscheint der Lauf beim betroffenen Feature mit Name des Schritts, Startzeit, Dauer, Ergebnis
   und Exit-Code.
3. **Given** ein Projekt ohne hinterlegte Schritte, **When** ein Worktree angelegt wird, **Then**
   verhält sich das Toolkit unverändert wie bisher — kein zusätzlicher Lauf, keine Verzögerung.
4. **Given** zwei Schritte am selben Auslöser, **When** der Auslöser feuert, **Then** laufen sie
   nacheinander in der konfigurierten Reihenfolge, nicht gleichzeitig.

---

### User Story 2 - Fehlerverhalten: blockierend hält an, beratend läuft weiter (Priority: P1)

Beim Einrichten eines Schritts wird festgelegt, ob ein Fehlschlag den Ablauf anhält oder nur
vermerkt wird — genau wie bei den bestehenden Agent-Gates. Schlägt ein blockierender Schritt fehl,
hält das Toolkit die betroffene Stufe an und meldet sich in der „Braucht dich"-Inbox mit dem
Kommando, dem Exit-Code und den letzten Ausgabezeilen, sodass die Ursache ohne Log-Suche erkennbar
ist. Ein beratender Schritt hält nichts an, sein Fehlschlag bleibt aber im Lauf sichtbar.

**Why this priority**: Ein Schritt ohne verlässliches Fehlerverhalten ist schlimmer als kein
Schritt: Er lässt den Ablauf auf einem halb vorbereiteten Worktree weiterlaufen und der Folgefehler
taucht drei Phasen später an einer Stelle auf, die nichts damit zu tun hat.

**Independent Test**: Zwei Schritte mit einem garantiert fehlschlagenden Kommando hinterlegen —
einmal blockierend, einmal beratend — und prüfen, dass der blockierende die Stufe anhält und ein
Inbox-Item mit Kommando/Exit-Code/Ausgabe erzeugt, der beratende dagegen nur einen fehlgeschlagenen
Lauf hinterlässt.

**Acceptance Scenarios**:

1. **Given** ein blockierender Schritt, dessen Kommando mit einem Exit-Code ungleich 0 endet,
   **When** der Auslöser feuert, **Then** wird die Stufe nicht fortgesetzt und es entsteht ein
   Inbox-Item, das Schrittname, Kommando, Exit-Code und die letzten Ausgabezeilen enthält.
2. **Given** derselbe blockierende Fehlschlag, **When** mehrere Schritte am selben Auslöser
   konfiguriert sind, **Then** werden die noch ausstehenden Schritte dieses Auslösers nicht mehr
   ausgeführt.
3. **Given** ein beratender Schritt mit fehlschlagendem Kommando, **When** der Auslöser feuert,
   **Then** läuft der Ablauf ohne Eingriff weiter, der Lauf ist aber als fehlgeschlagen verbucht
   und es entsteht kein Inbox-Item.
4. **Given** ein Schritt, dessen Kommando länger läuft als sein Zeitlimit, **When** das Zeitlimit
   erreicht ist, **Then** wird das Kommando beendet, der Lauf als fehlgeschlagen verbucht und das
   Fehlerverhalten des Schritts greift wie bei jedem anderen Fehlschlag.
5. **Given** ein behobenes Problem, **When** die Person die angehaltene Stufe erneut anstößt,
   **Then** läuft der Schritt erneut und das zugehörige Inbox-Item verschwindet bei Erfolg.

---

### User Story 3 - Kontext, damit Kommandos nicht an absoluten Pfaden hängen (Priority: P2)

Ein hinterlegtes Kommando erfährt beim Lauf, in welchem Worktree, Projekt, Feature und Branch es
sich befindet und an welchem Punkt des Lebenszyklus es steht. Dadurch lässt sich ein und dieselbe
Konfiguration für alle Features eines Projekts verwenden, statt absolute Pfade zu hinterlegen.

**Why this priority**: Ohne diesen Kontext müsste jede Konfiguration absolute Pfade enthalten. Damit
wäre sie pro Feature unterschiedlich, also faktisch nicht am Projekt hinterlegbar — das Feature
würde seinen Zweck verfehlen.

**Independent Test**: Einen Schritt hinterlegen, dessen Kommando die bereitgestellten
Kontextangaben ausgibt, und prüfen, dass alle Angaben gesetzt und für das jeweilige Feature korrekt
sind.

**Acceptance Scenarios**:

1. **Given** ein Schritt an einem beliebigen Auslöser, **When** das Kommando läuft, **Then** sind
   Worktree-Pfad, Projekt, Feature und Branch als Umgebungsangaben gesetzt, und das
   Arbeitsverzeichnis des Kommandos ist der Worktree.
2. **Given** ein Schritt an einem Phasen-Auslöser, **When** das Kommando läuft, **Then** ist
   zusätzlich die betroffene Phase gesetzt; an einem Stufen-Auslöser entsprechend die betroffene
   Stufe.
3. **Given** ein Auslöser, an dem eine Angabe fachlich nicht existiert (z. B. keine Phase bei
   „nach Worktree-Anlage"), **When** das Kommando läuft, **Then** ist die Angabe leer statt mit
   einem Platzhalter- oder Fremdwert belegt.
4. **Given** der Variablensatz wird an einer einzigen Stelle aufgebaut, **When** F1c später
   Portbereich und Profil ergänzt, **Then** genügt eine Änderung an dieser Stelle und kein
   bestehender Schritt bricht.
5. **Given** ein Auslöser vor der Worktree-Anlage, **When** das Kommando läuft, **Then** ist der
   künftige Worktree-Pfad bekannt, das Kommando läuft aber im Haupt-Checkout des Projekts, weil
   der Worktree noch nicht existiert.

---

### User Story 4 - Drei Ebenen: global, Projekt, Feature (Priority: P2)

Schritte lassen sich auf drei Ebenen führen — genau wie die bestehenden Agents: global für alle
Projekte, pro Projekt, und pro Feature abweichend. So kann eine Hausregel einmal global stehen,
ein einzelnes Projekt sie ergänzen, und ein einzelnes Feature einen Schritt für sich ausnehmen
oder zusätzlich hinzunehmen.

**Why this priority**: Ohne Ebenen müsste jede Regel in jedem Projekt einzeln gepflegt werden und
das eine Feature, bei dem ein Schritt stört, hätte keinen Ausweg außer dem Abschalten für alle.
Die Bedienung folgt bewusst der bekannten Agent-Verwaltung, damit nichts Neues gelernt werden muss.

**Independent Test**: Denselben Auslöser auf allen drei Ebenen unterschiedlich belegen und prüfen,
welche Schritte für ein konkretes Feature tatsächlich laufen.

**Acceptance Scenarios**:

1. **Given** ein global hinterlegter Schritt, **When** in irgendeinem Projekt der Auslöser feuert,
   **Then** läuft der Schritt dort mit.
2. **Given** ein global und ein projektspezifisch hinterlegter Schritt am selben Auslöser, **When**
   der Auslöser für ein Feature dieses Projekts feuert, **Then** laufen beide in einer
   nachvollziehbaren, stabilen Reihenfolge.
3. **Given** ein Feature, für das ein geltender Schritt ausgenommen wurde, **When** der Auslöser
   feuert, **Then** läuft dieser Schritt für dieses Feature nicht, für die übrigen Features des
   Projekts unverändert schon.
4. **Given** ein abgeschalteter Schritt, der für ein einzelnes Feature ausdrücklich hinzugenommen
   wurde, **When** der Auslöser feuert, **Then** läuft er für dieses Feature.
5. **Given** ein Schritt, der später gelöscht wird, **When** die Läufe-Ansicht geöffnet wird,
   **Then** bleiben seine bisherigen Läufe mit ihrem Namen lesbar.

---

### User Story 5 - Weitere Auslöser: Phasen und Integrationsstufen (Priority: P3)

Über die Worktree-Anlage hinaus lassen sich Schritte vor und nach jeder Phase sowie vor und nach
jeder Stufe der Integrations-Pipeline hängen. Die Auslöser-Liste ist in der Workflow-Übersicht
sichtbar, sodass erkennbar bleibt, an welchen Punkten überhaupt eingehakt werden kann.

**Why this priority**: Die Worktree-Auslöser decken den Abnahmefall ab; die übrigen Punkte
erweitern den Nutzen, sind aber nicht Voraussetzung dafür, dass das Feature Wert liefert.

**Independent Test**: Je einen Schritt an einem Phasen- und einem Stufen-Auslöser hinterlegen und
prüfen, dass er zum richtigen Zeitpunkt läuft und in der Workflow-Übersicht an der passenden
Stelle erscheint.

**Acceptance Scenarios**:

1. **Given** ein Schritt vor einer bestimmten Phase, **When** diese Phase startet, **Then** läuft
   der Schritt vor dem Phasenstart; bei blockierendem Fehlschlag startet die Phase nicht.
2. **Given** ein Schritt nach einer bestimmten Phase, **When** die Phase abgeschlossen ist,
   **Then** läuft der Schritt vor einem etwaigen automatischen Weiterlauf zur Folgephase.
3. **Given** ein Schritt vor einer Integrationsstufe, **When** diese Stufe erreicht wird, **Then**
   läuft der Schritt vor der Stufe; bei blockierendem Fehlschlag wird die Stufe nicht begonnen.
4. **Given** eine neue Auslöser-Art wird künftig ergänzt, **When** die Workflow-Übersicht nicht
   mitgezogen wird, **Then** fällt das beim Bauen/Prüfen auf, statt still eine veraltete Übersicht
   zu hinterlassen.

---

### Edge Cases

- **Kommando existiert nicht** (Tippfehler, fehlendes Werkzeug): Der Lauf endet als Fehlschlag mit
  erkennbarem Exit-Code; das Fehlerverhalten des Schritts greift. Es entsteht kein stiller
  Erfolgsvermerk.
- **Kommando erzeugt sehr viel Ausgabe**: Die vollständige Ausgabe ist über den Lauf zugänglich; im
  Inbox-Item stehen nur die letzten Zeilen, damit die Meldung lesbar bleibt.
- **Toolkit wird beendet, während ein Schritt läuft**: Der Lauf bleibt nicht dauerhaft auf
  „läuft" stehen, sondern wird beim Neustart als abgebrochen erkennbar — analog zu den übrigen
  Läufen.
- **Zeitlimit greift**: Das Kommando wird beendet und als Fehlschlag verbucht. Kein Lauf hängt
  unbegrenzt und blockiert die Stufe stumm.
- **Auslöser feuert ohne existierenden Worktree** (vor der Anlage, oder Worktree wurde entfernt):
  Vor der Anlage läuft der Schritt im Haupt-Checkout; fehlt der Worktree unerwartet, ist das ein
  behebbarer Infrastrukturfehler und kein fachlicher Fehlschlag des Kommandos.
- **Schritt wird geändert oder gelöscht, während er läuft**: Der laufende Vorgang wird zu Ende
  geführt und mit dem Namen verbucht, der beim Start galt.
- **Blockierender Fehlschlag an einem „nach"-Auslöser der letzten Stufe**: Der Abschluss wird nicht
  vermerkt; das Feature bleibt vor dem Abschluss stehen und meldet sich in der Inbox.
- **Kommando läuft ohne Fehler, produziert aber keine Wirkung**: Das Toolkit beurteilt
  ausschließlich Exit-Code und Zeitlimit; ein Erfolgsvermerk ist keine inhaltliche Aussage.
- **Mehrere Features desselben Projekts lösen gleichzeitig Schritte aus**: Die Läufe stören sich
  nicht gegenseitig und die Zuordnung zum jeweiligen Feature bleibt eindeutig.

## Requirements *(mandatory)*

### Functional Requirements

**Definition und Verwaltung**

- **FR-001**: Das System MUSS Lebenszyklus-Schritte als benannte Shell-Kommandos führen, mit
  mindestens: Name, Kommando, Auslöser, Fehlerverhalten (blockierend | beratend), Zeitlimit,
  Aktiv-Schalter und Reihenfolge.
- **FR-002**: Das System MUSS Schritte auf drei Ebenen führen: global (gilt in allen Projekten),
  pro Projekt und pro Feature. Die Bedienung MUSS der bestehenden Agent-Verwaltung entsprechen.
- **FR-003**: Auf Feature-Ebene MÜSSEN Personen einen geltenden Schritt ausnehmen und einen nicht
  geltenden Schritt hinzunehmen können; ohne Festlegung gilt die Ebene darüber.
- **FR-004**: Bei mehreren geltenden Schritten am selben Auslöser MUSS die Ausführungsreihenfolge
  deterministisch und für die Person sichtbar sein.
- **FR-005**: Das System MUSS die Auflösung „welche Schritte laufen für dieses Feature an diesem
  Auslöser?" nach denselben Regeln vornehmen wie bei Agents: Ausnehmen schlägt alles, Hinzunehmen
  erzwingt den Lauf, sonst entscheidet der Aktiv-Schalter.

**Auslöser**

- **FR-006**: Das System MUSS die Auslöser „vor Worktree-Anlage", „nach Worktree-Anlage", „vor
  Phase", „nach Phase", „vor Stufe" und „nach Stufe" anbieten.
- **FR-007**: Phasen-Auslöser MÜSSEN auf eine konkrete Phase bezogen werden können; Stufen-Auslöser
  auf eine konkrete Stufe der Integrations-Pipeline.
- **FR-008**: Die Auslöser-Liste MUSS so geführt werden, dass eine künftige Ergänzung nicht still
  an der Workflow-Übersicht vorbeigehen kann — eine neue Auslöser-Art MUSS eine Ergänzung der
  Übersicht erzwingen und andernfalls beim Bauen/Prüfen auffallen.
- **FR-009**: Ein „vor"-Auslöser MUSS vollständig abgeschlossen sein, bevor der zugehörige Vorgang
  beginnt; ein „nach"-Auslöser MUSS abgeschlossen sein, bevor ein automatischer Weiterlauf zum
  nächsten Vorgang einsetzt.

**Ausführung und Kontext**

- **FR-010**: Schritte MÜSSEN im Worktree des Features ausgeführt werden. Beim Auslöser „vor
  Worktree-Anlage" MUSS die Ausführung im Haupt-Checkout des Projekts erfolgen, weil der Worktree
  dort noch nicht existiert.
- **FR-011**: Das System MUSS jedem Kommando einen definierten Kontext bereitstellen: Worktree-Pfad
  (zugleich Arbeitsverzeichnis), Projekt, Feature, Branch, Phase und Stufe. Portbereich und Profil
  gehören NICHT zum Umfang dieses Features (siehe FR-013 und FR-014).
- **FR-012**: Kontextangaben, die am jeweiligen Auslöser fachlich nicht existieren (z. B. die Phase
  bei einem Worktree-Auslöser), MÜSSEN leer sein und dürfen keinen Wert aus einem anderen Vorgang
  tragen.
- **FR-013**: Der Portbereich (`$SDD_PORT_BASE`) ist **nicht Teil dieses Features** — entschieden am
  30.07.2026. Begründung: die einzige Quelle für die Portvergabe bringt F1c mit (Ersetzbare
  Kernschritte + Stack-Profile + Testing-Lane, Punkt 1). Dieses Feature wartet nicht darauf und
  liefert auch keinen eigenen Ersatz, weil zwei Quellen genau die Kollision erzeugen würden, die
  F1c beseitigen soll. Der Kontext MUSS jedoch so gebaut sein, dass F1c die Variable ohne Bruch der
  Schnittstelle ergänzen kann: **eine** Stelle, die den Variablensatz aufbaut, nicht mehrere
  verstreute Zuweisungen.
- **FR-014**: Das Profil (`$SDD_PROFILE`) ist **nicht Teil dieses Features** — entschieden am
  30.07.2026. Im Toolkit existiert heute kein Profil-Begriff; die Stack-Profile (`test`, `full`,
  `down`) führt F1c ein und ergänzt die Variable dann über denselben Erweiterungspunkt wie FR-013.
- **FR-015**: Das System MUSS jeden Schritt nach Ablauf seines Zeitlimits beenden und den Lauf als
  fehlgeschlagen verbuchen.
- **FR-016**: Das System MUSS für jeden Schritt ein Zeitlimit erzwingen; fehlt eine Angabe, gilt ein
  dokumentierter Vorgabewert.

**Sichtbarkeit und Messung**

- **FR-017**: Jeder Schritt-Lauf MUSS einen eigenen Lauf-Eintrag erzeugen, der in der Läufe-Ansicht
  beim zugehörigen Feature erscheint — es darf keine Arbeit außerhalb der Lauferfassung
  stattfinden.
- **FR-018**: Der Lauf-Eintrag MUSS als eigene Lauf-Art erkennbar sein und sich damit von Phasen-,
  Verifikations-, Review- und Chat-Läufen unterscheiden lassen.
- **FR-019**: Der Lauf-Eintrag MUSS Start, Ende, Dauer, Ergebnis und Exit-Code führen; die
  vollständige Ausgabe MUSS über den Lauf zugänglich sein.
- **FR-020**: Schritt-Läufe verbrauchen keine Modell-Leistung; das System MUSS sie deshalb ohne
  Verbrauchswert führen und DARF KEINEN Ersatzwert (z. B. 0 oder eine Schätzung) als gemessenen
  Verbrauch ausweisen.
- **FR-021**: Ein Lauf, der durch Beenden oder Absturz des Toolkits unterbrochen wird, DARF NICHT
  dauerhaft als „läuft" stehen bleiben, sondern MUSS als unterbrochen erkennbar werden.

**Fehlerverhalten**

- **FR-022**: Ein blockierend fehlgeschlagener Schritt MUSS die betroffene Stufe anhalten: der
  zugehörige Vorgang startet bzw. setzt nicht fort, und weitere Schritte desselben Auslösers laufen
  nicht mehr.
- **FR-023**: Ein blockierend fehlgeschlagener Schritt MUSS ein Item in der „Braucht dich"-Inbox
  erzeugen, das Schrittname, ausgeführtes Kommando, Exit-Code und die letzten Ausgabezeilen enthält.
- **FR-024**: Ein beratend fehlgeschlagener Schritt DARF KEINEN Ablauf anhalten und KEIN Inbox-Item
  erzeugen; der Fehlschlag MUSS aber am Lauf sichtbar bleiben.
- **FR-025**: Ein durch einen blockierenden Schritt erzeugtes Inbox-Item MUSS aufgelöst werden,
  sobald der Schritt bei einem erneuten Anlauf erfolgreich durchläuft.
- **FR-026**: Ein fehlender Worktree MUSS als behebbarer Infrastrukturfehler behandelt werden und
  DARF NICHT als fachlicher Fehlschlag des Kommandos gewertet werden.

**Rückwärtsverhalten**

- **FR-027**: Ohne konfigurierte Schritte MUSS sich das Toolkit exakt wie bisher verhalten — keine
  zusätzlichen Läufe, keine zusätzlichen Wartezeiten an den Auslösepunkten.
- **FR-028**: Läufe eines später gelöschten Schritts MÜSSEN mit ihrem Namen lesbar bleiben.

### Key Entities

- **Lebenszyklus-Schritt**: Eine benannte, wiederverwendbare Kommando-Definition mit Auslöser,
  Fehlerverhalten, Zeitlimit, Aktiv-Schalter und Reihenfolge. Gehört entweder zu keinem Projekt
  (global) oder zu genau einem Projekt.
- **Auslöser**: Der Punkt im Lebenszyklus, an dem ein Schritt feuert — Art plus, je nach Art, die
  betroffene Phase oder Stufe.
- **Feature-Entscheidung**: Abweichung eines einzelnen Features von der geerbten Geltung eines
  Schritts (ausnehmen / hinzunehmen). Ohne Eintrag gilt die Ebene darüber.
- **Schritt-Lauf**: Ein einzelner Ausführungsvorgang eines Schritts — Zeitraum, Ergebnis,
  Exit-Code, Ausgabe, Zuordnung zu Projekt und Feature. Reiht sich in dieselbe Lauf-Erfassung ein
  wie Phasen-, Verifikations- und Review-Läufe.
- **Lauf-Kontext**: Die Angaben, die ein Kommando über seine Umgebung erhält (Worktree, Projekt,
  Feature, Branch, Phase, Stufe). An einer Stelle aufgebaut, damit F1c Portbereich und Profil
  ergänzen kann, ohne die Schnittstelle zu brechen.
- **Aufmerksamkeits-Item**: Der Eintrag in der „Braucht dich"-Inbox, der aus einem blockierenden
  Fehlschlag entsteht und Kommando, Exit-Code und die letzten Ausgabezeilen trägt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Eine Projektverantwortliche richtet einen Schritt „nach Worktree-Anlage" in unter
  2 Minuten ein, ohne eine Datei im Repository zu bearbeiten.
- **SC-002**: 100 % der ausgelösten Schritt-Läufe erscheinen in der Läufe-Ansicht mit Dauer und
  Ergebnis; kein Schritt läuft außerhalb der Lauferfassung.
- **SC-003**: Ein blockierender Fehlschlag hält die Stufe an und erzeugt innerhalb von 5 Sekunden
  nach Schrittende ein Inbox-Item, aus dem Kommando, Exit-Code und die letzten Ausgabezeilen ohne
  weiteres Nachsehen ablesbar sind.
- **SC-004**: Nach einem beratenden Fehlschlag läuft der Ablauf ohne menschlichen Eingriff weiter,
  und der Fehlschlag ist am Lauf trotzdem erkennbar.
- **SC-005**: Ein Kommando, das ausschließlich den bereitgestellten Kontext verwendet, läuft
  unverändert in mindestens 3 gleichzeitig aktiven Features desselben Projekts, ohne dass sich die
  Läufe gegenseitig Pfade streitig machen. Portkollisionen sind ausdrücklich NICHT Gegenstand
  dieses Kriteriums — dafür ist F1c zuständig (siehe FR-013).
- **SC-006**: Kein Schritt-Lauf bleibt länger als sein Zeitlimit aktiv; nach Ablauf ist er innerhalb
  von 10 Sekunden als fehlgeschlagen verbucht.
- **SC-007**: Bei widersprüchlicher Konfiguration auf mehreren Ebenen entscheidet in 100 % der
  geprüften Fälle die spezifischste Ebene — nachgewiesen durch automatisierte Tests über alle drei
  Ebenen.
- **SC-008**: Ein Projekt ohne konfigurierte Schritte zeigt gegenüber heute keine zusätzlichen
  Läufe und keine messbar längere Zeit bis zum Start der ersten Phase.
- **SC-009**: Beide Fehlerverhalten (blockierend, beratend) sind durch automatisierte Tests
  abgedeckt, die den angehaltenen bzw. fortgesetzten Ablauf nachweisen.

## Assumptions

- **Bedienung nach Vorbild der Agents**: Verwaltung, Ebenen-Logik und Fehlerverhalten übernehmen
  die eingeführten Muster der Agent-Gates (blockierend = Gate, beratend = nur verbucht). Neue
  Bedienkonzepte werden nicht eingeführt.
- **Bewertung nur über Exit-Code und Zeitlimit**: Das Toolkit interpretiert die Ausgabe eines
  Kommandos nicht. Ein Berichtsformat mit Urteil wie bei den Agents ist nicht vorgesehen.
- **Kein Verbrauchswert**: Schritt-Läufe verbrauchen keine Modell-Leistung. Sie werden zeitlich und
  im Ergebnis gemessen, nicht in Tokens oder Kosten.
- **Vorgabe-Zeitlimit**: Fehlt am Schritt eine Angabe, gilt dasselbe Zeitlimit wie bei den
  Verifikations-Kommandos (15 Minuten).
- **„Stufe" meint die Integrations-Pipeline**: Stufen-Auslöser beziehen sich auf die Schritte der
  Pipeline nach `implement` (Verifikation, Review-Gate, menschliches Review, Merge-Queue,
  Abschluss), nicht auf jeden internen Zwischenzustand.
- **Ausführung sequentiell**: Mehrere Schritte am selben Auslöser laufen nacheinander, nicht
  parallel — sie können voneinander abhängen (z. B. Abhängigkeiten installieren, dann vorbereiten).
- **Keine gesonderte Rechteprüfung**: Schritte sind vom Menschen konfigurierte Kommandos und laufen
  mit denselben Rechten wie die bestehenden Verifikations-Kommandos. Eine Freigabe pro Lauf ist
  nicht vorgesehen.
- **Ausgabeumfang im Inbox-Item**: „Letzte Ausgabezeilen" meint einen kurzen, lesbaren Ausschnitt
  am Ende der Ausgabe; die vollständige Ausgabe bleibt über den Lauf erreichbar.

## Dependencies

- **F1a — sichtbarer Schrittkatalog** (Voraussetzung): Die Auslöserpunkte müssen in der
  Workflow-Übersicht als Katalog sichtbar sein, sonst ist nicht erkennbar, wo eingehakt werden
  kann. Dieses Feature erweitert diesen Katalog um die eigenen Schritte.
- **F1c — Portvergabe**: Liefert die eine Quelle für den Portbereich, den dieses Feature den
  Kommandos bereitstellt. Solange F1c fehlt, ist FR-013 nicht abschließend erfüllbar (siehe offene
  Frage dort).
- **Bestehende Agent-Verwaltung**: Ebenen-Modell, Auflösungsregeln und Gate-Verhalten werden von
  dort übernommen; Änderungen an diesen Mustern wirken auf beide Seiten.
- **Bestehende Lauferfassung und „Braucht dich"-Inbox**: Schritt-Läufe und Fehlschläge reihen sich
  in die vorhandenen Ansichten ein, statt eine eigene Oberfläche zu bekommen.

## Out of Scope

- Ausführung von Kommandos auf entfernten Maschinen oder in Containern — Schritte laufen lokal im
  Worktree.
- Bedingte Auslösung (z. B. „nur wenn sich bestimmte Dateien geändert haben") — jeder geltende
  Schritt läuft an seinem Auslöser.
- Auswertung der Kommando-Ausgabe für ein inhaltliches Urteil (das leisten die Agents mit ihren
  Berichten).
- Parallele Ausführung mehrerer Schritte desselben Auslösers.
- Nachträgliches Wiederholen eines einzelnen fehlgeschlagenen Schritts unabhängig von seiner Stufe
  — die Stufe wird als Ganzes erneut angestoßen.
