# Feature Specification: Individuelle Einstellungen (Signaltöne, Themes, Vorauswahl Ticket-Quelle)

**Feature Branch**: `feature/persoenliche-einstellungen`

**Created**: 2026-07-31

**Status**: Draft

**Input**: User description: Ein neuer Einstellungsbereich „Individuelle Einstellungen" mit drei Themen — frei definierbare Signaltöne je Auslöser, mehrere Farbdesigns, Vorauswahl der Ticket-Quelle. Die am 30.07.2026 getroffenen Entscheidungen zum Thema Themes sind unter „Entscheidungen und Randbedingungen" festgehalten.

## Ausgangslage

Drei Verhaltensweisen des Toolkits sind heute fest verdrahtet und nicht einstellbar:

1. **Signaltöne**: Ein einziger Zwei-Ton-Beep, ausgelöst von genau zwei Ereignissen („Agent-Zug fertig", „Feature gemergt"). Eine einzelne An/Aus-Einstellung liegt gerätelokal im Browser — sie gilt damit pro Browser, nicht pro Person. Alle übrigen Ereignisse, die menschliche Aufmerksamkeit brauchen (Rückfragen, fällige Reviews, fehlgeschlagene Gates, eskalierte Merge-Konflikte, abgebrochene Läufe …), bleiben stumm. Rückfragen sind dabei **bewusst** stumm gestellt worden (im Code als „WhisperM8-Regel" begründet).
2. **Farbdesign**: Genau zwei Modi, hell und dunkel. Ein weiteres Design ist nicht wählbar.
3. **Ticket-Quelle**: „Neues Feature" öffnet bei bestehender Jira-Verbindung immer den Jira-Import; die manuelle Erfassung ist nur über einen Umschalter im Dialog erreichbar. Wer überwiegend manuell erfasst, aber Jira verbunden hat, muss jedes Mal umschalten.

Alle drei Punkte werden in einem gemeinsamen, nutzerweiten Einstellungsbereich „Individuelle Einstellungen" zusammengeführt.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Signaltöne je Auslöser wählen und vorhören (Priority: P1)

Eine Person, die mehrere Features parallel laufen lässt, will am Klang erkennen, *was* passiert ist, ohne auf den Bildschirm zu sehen: „Review fällig" soll anders klingen als „Merge-Konflikt eskaliert", und ein abgebrochener Lauf soll deutlicher auffallen als ein fertiger Zug. Sie öffnet „Individuelle Einstellungen → Signaltöne", sieht eine Liste aller Auslöser, wählt je Auslöser einen Ton (oder Stille), hört jeden Ton vor der Übernahme probeweise ab und kann für einzelne Auslöser statt eines Tons eine gesprochene Ansage mit selbst getipptem Text hinterlegen. Beim nächsten Browser oder Rechner gilt dieselbe Zuordnung, ohne sie erneut einzustellen.

**Why this priority**: Der grösste Nutzen und der grösste Teil des Umfangs. Diese Story ist der Grund, aus dem der Einstellungsbereich überhaupt entsteht, und sie behebt das eigentliche Problem: Aufmerksamkeitsereignisse existieren im System, erreichen die Person aber nicht.

**Independent Test**: Vollständig testbar, indem für zwei verschiedene Auslöser zwei verschiedene Töne gesetzt, beide vorgehört und anschliessend beide Ereignisse ausgelöst werden — hörbar unterschiedlich. Liefert eigenständigen Wert, auch ohne Themes und ohne Vorauswahl der Ticket-Quelle.

**Acceptance Scenarios**:

1. **Given** eine frische Installation ohne gespeicherte Ton-Einstellungen, **When** die Person den Bereich „Signaltöne" öffnet, **Then** sind genau die zwei heute hörbaren Ereignisse („Agent-Zug fertig", „Feature gemergt") mit dem bisherigen Ton belegt und alle übrigen Auslöser stehen auf „Stille".
2. **Given** der Bereich „Signaltöne" ist offen, **When** die Person beim Auslöser „Review fällig" den Ton „X" wählt und den Vorhör-Knopf drückt, **Then** ist Ton „X" unmittelbar hörbar, ohne dass die Einstellung dafür gespeichert sein muss.
3. **Given** für „Merge-Konflikt eskaliert" ist Ton „X" und für „Lauf abgebrochen" Ton „Y" gespeichert, **When** beide Ereignisse eintreten, **Then** erklingt zu jedem Ereignis der zugeordnete, hörbar unterschiedliche Ton.
4. **Given** die Person hat für „Freigabe nötig" eine gesprochene Ansage mit dem Text „Freigabe für Zahlungsmodul" hinterlegt, **When** das Ereignis eintritt, **Then** wird dieser Text gesprochen.
5. **Given** die Ton-Zuordnung wurde in Browser A gespeichert, **When** dieselbe Person die Anwendung in Browser B öffnet, **Then** ist dieselbe Zuordnung wirksam und im Einstellungsbereich sichtbar.
6. **Given** eine frische Installation, **When** eine Rückfrage eines Agenten eintritt, **Then** bleibt sie stumm — der Auslöser ist wählbar, aber standardmässig auf „Stille" gestellt.
7. **Given** ein Auslöser steht auf „Stille", **When** das Ereignis eintritt, **Then** ist nichts hörbar, während die sichtbare Benachrichtigung unverändert erscheint.
8. **Given** die Person hat den Hauptschalter für Signaltöne ausgeschaltet, **When** ein beliebiges Ereignis mit zugeordnetem Ton eintritt, **Then** bleibt es stumm und die einzelnen Zuordnungen bleiben unverändert gespeichert.

---

### User Story 2 - Zusätzliches Farbdesign wählen (Priority: P2)

Eine Person arbeitet in wechselndem Umgebungslicht oder braucht mehr Kontrast, als das bestehende Dunkel-Design bietet. Sie öffnet „Individuelle Einstellungen → Darstellung", wählt neben Hell und Dunkel das zusätzliche Design „Dunkel, hoher Kontrast" und sieht die gesamte Oberfläche sofort umgefärbt — einschliesslich der Agenten-Konsole, die bisher am eigenen Farbschema hing.

**Why this priority**: Eigenständiger, sofort sichtbarer Nutzen und Voraussetzung dafür, dass weitere Designs später billig hinzukommen. Nachrangig zu US1, weil das bestehende Verhalten (zwei Modi) nutzbar ist, während die stummen Aufmerksamkeitsereignisse ein echter Mangel sind.

**Independent Test**: Vollständig testbar, indem das neue Design gewählt und geprüft wird, dass keine Fläche und keine Statusfarbe im alten Schema zurückbleibt, die Konsole eingeschlossen. Liefert Wert unabhängig von US1 und US3.

**Acceptance Scenarios**:

1. **Given** die Anwendung läuft im Dunkel-Design, **When** die Person „Dunkel, hoher Kontrast" wählt, **Then** wechselt die gesamte Oberfläche ohne Neuladen der Seite in das neue Design.
2. **Given** eine Agenten-Konsole ist geöffnet, **When** das Design gewechselt wird, **Then** wechselt auch die Konsole ihre Farben mit — es bleibt keine Fläche im vorherigen Schema.
3. **Given** ein Design ist gewählt, **When** die Person die Anwendung neu lädt, **Then** ist dasselbe Design von der ersten Darstellung an aktiv, ohne sichtbares Umfärben nach dem Laden.
4. **Given** ein Farbschlüssel fehlt in einem Design, **When** die automatisierte Vollständigkeitsprüfung läuft, **Then** schlägt sie fehl und benennt das Design und den fehlenden Schlüssel.
5. **Given** ein gespeicherter Design-Name ist unbekannt (etwa nach einem Rückschritt auf eine ältere Version), **When** die Anwendung startet, **Then** wird ein gültiges Design verwendet und die Oberfläche bleibt bedienbar.

---

### User Story 3 - Vorauswahl der Ticket-Quelle (Priority: P3)

Eine Person hat Jira verbunden, erfasst Features aber überwiegend manuell. Sie stellt in „Individuelle Einstellungen" ein, dass „Neues Feature" mit der manuellen Erfassung öffnet. Ab dann startet der Dialog dort — der Umschalter zu Jira bleibt vorhanden und einen Klick entfernt.

**Why this priority**: Kleinster Umfang, klarer Alltagsnutzen, aber die geringste Auswirkung, wenn er fehlt: der Weg ist heute erreichbar, nur einen Klick zu weit.

**Independent Test**: Vollständig testbar, indem die Einstellung auf „manuell" gesetzt und „Neues Feature" bei verbundenem Jira geöffnet wird. Braucht weder US1 noch US2.

**Acceptance Scenarios**:

1. **Given** Jira ist verbunden und die Vorauswahl steht auf „manuell", **When** die Person „Neues Feature" öffnet, **Then** erscheint die manuelle Erfassung, und der Umschalter zur Jira-Auswahl ist vorhanden.
2. **Given** Jira ist verbunden und die Vorauswahl steht auf „Jira", **When** die Person „Neues Feature" öffnet, **Then** erscheint die Jira-Auswahl, und der Umschalter zur manuellen Erfassung ist vorhanden.
3. **Given** Jira ist **nicht** verbunden und die Vorauswahl steht auf „Jira", **When** die Person „Neues Feature" öffnet, **Then** erscheint die manuelle Erfassung, und die gespeicherte Vorauswahl bleibt unverändert erhalten.
4. **Given** die Person hat im Import-Dialog zuletzt ein bestimmtes Jira-Projekt gewählt, **When** die Vorauswahl der Ticket-Quelle geändert wird, **Then** bleibt die zuletzt gewählte Jira-Auswahl im Import-Dialog unverändert — die beiden Einstellungen beeinflussen sich nicht.
5. **Given** eine Installation ohne gespeicherte Vorauswahl, **When** „Neues Feature" bei verbundenem Jira geöffnet wird, **Then** erscheint die Jira-Auswahl — das heutige Verhalten bleibt der Ausgangszustand.

---

### Edge Cases

- **Audio-Sperre des Browsers**: Vor der ersten Interaktion mit der Seite verweigern Browser die Tonausgabe. Das Ereignis darf dadurch nicht verloren gehen und keinen Fehler zeigen — die sichtbare Benachrichtigung erscheint, der Ton entfällt still.
- **Sprachausgabe nicht verfügbar**: Fehlt die Sprachausgabe oder existiert keine passende Stimme, muss die Person das im Einstellungsbereich erkennen können (Vorhören schlägt sichtbar fehl), statt dass ein Ereignis später unbemerkt stumm bleibt.
- **Leerer Ansagetext**: Wird für eine gesprochene Ansage kein Text hinterlegt, ist entweder ein Standardtext zu sprechen oder der Auslöser wie „Stille" zu behandeln — nichts Undefiniertes.
- **Viele Ereignisse gleichzeitig**: Treten mehrere Auslöser dicht beieinander auf, dürfen die Töne nicht zu einem unverständlichen Gemisch übereinanderfallen.
- **Überlappende Auslöser**: Erreicht ein Feature eine Phase, treffen „Phasenwechsel" und „bestimmte Phase erreicht" zusammen. Es darf nur ein Ton erklingen, und es muss festgelegt sein, welcher.
- **Mehrere offene Tabs**: Die Anwendung in mehreren Tabs offen zu haben führt heute dazu, dass jeder Tab denselben Ton spielt. Dieses Verhalten bleibt unverändert (siehe „Nicht im Umfang").
- **Einstellungen nicht erreichbar**: Ist die serverseitige Einstellung beim Start nicht lesbar, gelten die Standardwerte, und die Oberfläche bleibt bedienbar — es wird nichts stillschweigend überschrieben.
- **Bereits stumm geschaltete Person**: Wer den bisherigen An/Aus-Schalter auf „aus" gestellt hat, darf durch die Umstellung nicht unerwartet wieder Töne bekommen.
- **Design-Wechsel bei offener Konsole**: Siehe US2/Szenario 2 — die Konsole braucht echte Farbwerte und wird sonst nicht mitgenommen.
- **Unbekannter Auslöser-Name in gespeicherten Einstellungen**: Kommen später Auslöser hinzu oder fallen weg, müssen bestehende Einstellungen weiter gelten; unbekannte Einträge werden ignoriert, neue Auslöser starten auf „Stille".

## Requirements *(mandatory)*

### Functional Requirements

**Einstellungsbereich**

- **FR-001**: Das System MUSS einen nutzerweiten, projektübergreifenden Einstellungsbereich „Individuelle Einstellungen" mit den drei Themen „Signaltöne", „Darstellung" und „Vorauswahl Ticket-Quelle" bereitstellen.
- **FR-002**: Die Einstellungen zu Signaltönen und zur Vorauswahl der Ticket-Quelle MÜSSEN so gespeichert werden, dass sie für dieselbe Person in jedem Browser und auf jedem Gerät gelten, ohne erneut eingestellt zu werden.
- **FR-003**: Das System MUSS bei nicht lesbaren oder fehlenden gespeicherten Einstellungen die Standardwerte verwenden und bedienbar bleiben.

**Signaltöne**

- **FR-004**: Das System MUSS mindestens 20 einzeln konfigurierbare Auslöser anbieten, bestehend aus: den zehn Aufmerksamkeitsereignissen (Eingabe erwartet, Berechtigung erfragt, Verifikation fehlgeschlagen, Gate fehlgeschlagen, Merge-Konflikt eskaliert, Review fällig, Agent-Fehler, Lauf abgebrochen, Phasen-Gate fehlgeschlagen, Freigabe nötig), den zwei Ablauf-Ereignissen („Agent-Zug fertig", „Feature gemergt"), dem generischen Phasenwechsel sowie je einem Auslöser für jede der sieben erreichbaren Workflow-Phasen.
- **FR-005**: Das System MUSS je Auslöser genau eine Reaktion zulassen: einen Ton aus dem Katalog, eine gesprochene Ansage, oder Stille.
- **FR-006**: Das System MUSS einen Katalog von mindestens 20 Tönen anbieten, die ohne mitgelieferte Audiodateien erzeugt werden. Unterscheidbarkeit ist prüfbar zu machen: keine zwei Töne des Katalogs DÜRFEN dieselbe Kombination aus Tonhöhenfolge, Klangfarbe und Rhythmus haben.
- **FR-007**: Jeder Ton des Katalogs MUSS einen benannten, wiedererkennbaren Bezeichner haben, damit die Zuordnung in der Oberfläche lesbar bleibt.
- **FR-008**: Das System MUSS je Ton und je gesprochener Ansage ein Vorhören anbieten, das ohne Speichern der Einstellung sofort hörbar ist.
- **FR-009**: Das System MUSS für gesprochene Ansagen einen frei eintippbaren Text je Auslöser zulassen.
- **FR-010**: Das System MUSS einen Hauptschalter bereitstellen, der alle Signaltöne gemeinsam stummschaltet, ohne die einzelnen Zuordnungen zu verlieren.
- **FR-011**: Es MUSS genau eine Stelle geben, die Signaltöne an- und abschaltet — der bisherige, gerätelokale An/Aus-Schalter darf nicht als zweiter, widersprüchlicher Schalter weiterbestehen.
- **FR-012**: Die Standardbelegung MUSS genau die zwei heute hörbaren Ereignisse („Agent-Zug fertig", „Feature gemergt") mit dem bisherigen Ton belegen; alle übrigen Auslöser MÜSSEN standardmässig auf „Stille" stehen.
- **FR-013**: Die Standardbelegung MUSS dieselbe Menge hörbarer Ereignisse (genau zwei) und denselben Lautstärkepegel wie der heutige Zustand ergeben; die einstellbare Grundlautstärke MUSS diesen Pegel als Standardwert haben.
- **FR-014**: Auslöser für Rückfragen und Berechtigungsanfragen MÜSSEN konfigurierbar sein, aber standardmässig auf „Stille" stehen; die Begründung für die bisherige Stille MUSS in der Oberfläche oder in der Dokumentation nachvollziehbar bleiben.
- **FR-015**: Hat eine Person den bisherigen gerätelokalen Schalter auf „aus" gestellt und es existiert noch keine serverseitige Einstellung, MUSS der Hauptschalter für sie ausgeschaltet starten.
- **FR-016**: Treffen „Phasenwechsel" und „bestimmte Phase erreicht" auf dasselbe Ereignis zu, MUSS genau ein Ton erklingen; die spezifischere Zuordnung gewinnt.
- **FR-017**: Bei mehreren dicht aufeinanderfolgenden Ereignissen MUSS das System die Ausgaben nacheinander abspielen statt überlagert; kein Ton DARF beginnen, während ein anderer noch klingt (Nachweis: SC-006).
- **FR-018**: Verweigert der Browser die Tonausgabe oder fehlt die Sprachausgabe, MUSS das System ohne Fehlermeldung fortfahren; die sichtbaren Benachrichtigungen bleiben unverändert.
- **FR-019**: Beim Vorhören MUSS eine nicht verfügbare Tonausgabe oder Sprachausgabe sichtbar zurückgemeldet werden.
- **FR-020**: Gespeicherte Einstellungen zu Auslösern, die es nicht mehr gibt, MÜSSEN ignoriert werden; neu hinzukommende Auslöser MÜSSEN auf „Stille" starten.

**Darstellung (Themes)**

- **FR-021**: Das System MUSS neben „Hell" und „Dunkel" ein zusätzliches, vollständiges Farbdesign „Dunkel, hoher Kontrast" zur Wahl anbieten.
- **FR-022**: Ein Designwechsel MUSS ohne Neuladen der Seite in der gesamten Oberfläche wirksam werden, die Agenten-Konsole eingeschlossen.
- **FR-023**: Jedes Farbdesign MUSS denselben vollständigen Satz an Farbschlüsseln festlegen wie das Referenz-Design; ein fehlender Schlüssel darf nicht stillschweigend einen Wert eines anderen Designs erben.
- **FR-024**: Eine automatisierte Prüfung MUSS fehlschlagen, wenn ein Farbdesign nicht denselben Schlüsselsatz festlegt wie das Referenz-Design, und MUSS Design und fehlenden Schlüssel benennen.
- **FR-025**: Jedes Farbdesign MUSS auch für die Agenten-Konsole ein vollständiges Farbschema festlegen; eine automatisierte Prüfung MUSS ein Design ohne Konsolen-Schema erkennen.
- **FR-026**: Das gewählte Design MUSS von der ersten Darstellung nach dem Laden an aktiv sein, ohne sichtbares Umfärben.
- **FR-027**: Bei einem unbekannten oder ungültigen gespeicherten Design MUSS das System auf ein gültiges Design zurückfallen.
- **FR-028**: In der Agenten-Konsole DARF in keinem Design eine Vordergrund- oder Akzentfarbe mit der Hintergrundfarbe zusammenfallen (nichts darf unlesbar werden).

**Vorauswahl der Ticket-Quelle**

- **FR-029**: Das System MUSS einstellbar machen, ob „Neues Feature" bei verbundener Jira-Anbindung mit der Jira-Auswahl oder mit der manuellen Erfassung öffnet.
- **FR-030**: Ohne aktive Jira-Verbindung MUSS „Neues Feature" weiterhin zwingend mit der manuellen Erfassung öffnen, unabhängig von der Einstellung, und die gespeicherte Einstellung MUSS unverändert erhalten bleiben.
- **FR-031**: Der Umschalter zwischen den beiden Quellen MUSS im Dialog erhalten bleiben — die Einstellung bestimmt ausschliesslich die Vorauswahl, nicht die Verfügbarkeit.
- **FR-032**: Die Vorauswahl MUSS getrennt von der zuletzt getroffenen Auswahl **innerhalb** des Jira-Import-Dialogs gespeichert werden; die beiden dürfen sich nicht gegenseitig verändern.
- **FR-033**: Ohne gespeicherte Vorauswahl MUSS das heutige Verhalten gelten: bei verbundener Jira-Anbindung öffnet die Jira-Auswahl.

### Key Entities

- **Auslöser**: Ein benanntes Ereignis, das eine hörbare Reaktion auslösen kann. Umfasst Aufmerksamkeitsereignisse, Ablauf-Ereignisse und Phasenereignisse. Das Vokabular ist bereits im System vorhanden und wird nicht neu erfunden.
- **Ton**: Ein benanntes, ohne Audiodateien erzeugtes Klangmuster mit wiedererkennbarem Charakter. Der Katalog ist fest; die Person wählt aus ihm aus.
- **Gesprochene Ansage**: Eine Reaktion, die einen von der Person eingetippten Text vorliest, als Alternative zu einem Ton.
- **Ton-Zuordnung**: Die Zuordnung „Auslöser → Ton | Ansage | Stille" samt Hauptschalter. Nutzerweit gespeichert, gilt geräteübergreifend.
- **Farbdesign**: Ein benanntes, vollständiges Farbschema für Oberfläche und Agenten-Konsole. Wählbar; die Wahl gilt gerätebezogen.
- **Vorauswahl Ticket-Quelle**: Die Einstellung, mit welcher Quelle „Neues Feature" bei verbundener Jira-Anbindung öffnet. Nutzerweit gespeichert, getrennt von der letzten Auswahl im Import-Dialog.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Mindestens 20 Auslöser sind einzeln belegbar, und für jeden stehen mindestens 20 hörbar unterscheidbare Töne, eine gesprochene Ansage sowie „Stille" zur Wahl.
- **SC-002**: Jeder Ton und jede Ansage ist vor dem Speichern per Vorhören innerhalb einer Sekunde nach dem Auslösen hörbar.
- **SC-003**: In einer frischen Installation sind genau die zwei Ereignisse hörbar, die heute hörbar sind; alle übrigen Auslöser sind stumm.
- **SC-004**: Rückfragen sind in einer frischen Installation stumm und lassen sich in weniger als einer Minute Bedienzeit hörbar schalten.
- **SC-005**: Eine in einem Browser gespeicherte Ton-Zuordnung ist in einem zweiten Browser derselben Person unverändert wirksam, ohne dort etwas einzustellen.
- **SC-006**: Zehn dicht aufeinanderfolgende Ereignisse führen zu zehn einzeln unterscheidbaren Ausgaben statt zu einem überlagerten Gemisch.
- **SC-007**: Das zusätzliche Farbdesign deckt 100 % der Farbschlüssel des Referenz-Designs ab, nachgewiesen durch eine automatisierte Prüfung, die bei einem fehlenden Schlüssel fehlschlägt.
- **SC-008**: Ein Designwechsel ist in der gesamten Oberfläche einschliesslich offener Agenten-Konsole in unter einer Sekunde und ohne Neuladen sichtbar; keine Fläche bleibt im vorherigen Schema.
- **SC-009**: Nach einem Neuladen erscheint das gewählte Design von der ersten Darstellung an, ohne sichtbares Umfärben.
- **SC-010**: Bei verbundener Jira-Anbindung öffnet „Neues Feature" in 100 % der Fälle mit der eingestellten Quelle; ohne Verbindung in 100 % der Fälle mit der manuellen Erfassung.
- **SC-011**: Nach dem Ändern der Vorauswahl ist die zuletzt getroffene Auswahl im Jira-Import-Dialog unverändert.
- **SC-012**: Beide Ticket-Quellen bleiben im Dialog erreichbar — die Zahl der erreichbaren Erfassungswege sinkt gegenüber heute nicht.

## Entscheidungen und Randbedingungen

Die folgenden Punkte sind am 30.07.2026 bewusst entschieden worden und **nicht** erneut zu öffnen:

- **E1 — Farbwerte bleiben beim bestehenden Mechanismus.** Ein zusätzliches Design entsteht als weiterer Design-Block, der die bestehenden Farbskalen überschreibt; keine Komponente wird angefasst. Eine Umstellung auf semantisch benannte Gestaltungs-Token (etwa Fläche / Akzent / Gefahr) fasst jede Komponente an, ist ein eigenes Vorhaben mit eigenem Risiko und liefert am Ende nicht mehr Designs. Sie ist **nicht** Teil dieses Features und wird als späterer, eigener Schritt vorgemerkt.
- **E2 — Genau ein zusätzliches Design: „Dunkel, hoher Kontrast".** Kein warmes/Sepia-Design, kein Solarized, keine weiteren. Ein warmes Design müsste nicht-grüne Werte in die Skala „emerald" und nicht-rote in „red" schreiben — genau die Unehrlichkeit, die die Token-Umstellung später beheben soll; sie jetzt einzubauen, während man die Umstellung verschiebt, macht die spätere Migration teurer. Eine Kontrast-Variante bleibt innerhalb der bestehenden Farblogik (gleiche Farbtöne, andere Helligkeits- und Sättigungsstufen), beweist den Mechanismus vollständig und bringt mit besserer Lesbarkeit einen Zusatznutzen statt reiner Geschmackssache. Weitere Designs folgen nach der Token-Umstellung.
- **E3 — Die nicht-semantischen Skalennamen bleiben bewusst offen.** Das ist die bekannte Folge von E1 und kein Versäumnis. Sie ist hier festgehalten, damit sie beim späteren Schritt nicht neu entdeckt werden muss.
- **E4 — Die Vollständigkeitsprüfung vergleicht Schlüsselsätze, nicht Zahlen.** Das Referenz-Design legt heute 56 Farbvariablen über fünf Skalen fest (neutral 12, vier Akzentskalen je 11) plus die Farbschema-Angabe. Die Prüfung vergleicht die Schlüsselsätze der Designs miteinander, statt eine Zahl festzuschreiben — sonst veraltet sie bei der ersten Erweiterung. (Die ursprüngliche Anforderung nannte 57 Variablen bei 13 neutralen Stufen; nachgezählt sind es 56 Farbvariablen bei 12 neutralen Stufen, plus eine Nicht-Farb-Angabe. Für die Prüfung ist das ohne Belang.)
- **E5 — Die Agenten-Konsole braucht echte Farbwerte.** Sie kann die Farbvariablen nicht mitlesen und hängt an einem eigenen Eintrag je Design. Ohne diesen Eintrag bleibt die Konsole im alten Schema — deshalb FR-025.
- **E6 — Die Vorauswahl der Ticket-Quelle ist eine eigene Einstellung.** Sie darf nicht in derselben Ablage landen wie die letzte Auswahl **innerhalb** des Jira-Import-Dialogs; das ist ein anderer Zweck (FR-032).
- **E7 — Die Stille bei Rückfragen war eine Entscheidung, keine Lücke.** Sie wird umkehrbar gemacht, aber nicht umgekehrt: konfigurierbar, standardmässig aus (FR-014).

## Assumptions

- **Speicherort der Einstellungen**: Ton-Zuordnung und Vorauswahl der Ticket-Quelle liegen serverseitig, damit sie nicht pro Browser gelten. Das Toolkit hat dafür bereits eine nutzerweite Einstellungsablage; es wird keine neue Nutzerverwaltung eingeführt.
- **Nutzerkreis**: Das Toolkit wird von einer Person bzw. einem kleinen Team ohne getrennte Konten betrieben. „Nutzerweit" heisst deshalb „für diese Toolkit-Installation", nicht „pro angemeldetem Konto".
- **Designwahl bleibt gerätebezogen**: Anders als die Ton-Einstellungen bleibt die Designwahl absichtlich gerätelokal — sie muss vor der ersten Darstellung verfügbar sein, damit kein sichtbares Umfärben entsteht (FR-026), und Helligkeitsvorlieben sind gerätegebunden (Laptop vs. Büromonitor).
- **Auslöser-Vokabular**: Die Auslöser werden aus dem bereits vorhandenen Vokabular der Aufmerksamkeitsereignisse und Workflow-Phasen abgeleitet; es wird kein neues Ereignis erfunden und keine neue Ereignisquelle gebaut. Die benötigten Ereignisse erreichen die Oberfläche heute schon.
- **Töne ohne Dateien**: Die Töne werden zur Laufzeit erzeugt (Frequenzfolgen, Wellenformen, Rhythmen); der bestehende Zwei-Ton-Beep belegt, dass das genügt. Es werden keine Audiodateien mitgeliefert und keine heruntergeladen.
- **Sprachausgabe**: Für gesprochene Ansagen wird die im Browser vorhandene Sprachausgabe genutzt — dieselbe Familie von Browser-Sprachfunktionen, die für die Spracheingabe schon im Einsatz ist. Stimmenauswahl, Sprache, Geschwindigkeit und Tonhöhe sind nicht Teil dieses Features; es wird die Standardstimme des Systems verwendet.
- **Lautstärke**: Es gibt eine gemeinsame Grundlautstärke, deren Standardwert dem heutigen Pegel entspricht; sie steigt durch dieses Feature nicht.
- **„Bestimmte Phase erreicht"** bezieht sich auf die sieben Feature-Phasen des Workflows; die einmalige Projekt-Phase ist nicht als Auslöser vorgesehen.
- **Bestehende sichtbare Benachrichtigungen** (Systembenachrichtigungen, Aufmerksamkeits-Eingang) bleiben unverändert; dieses Feature betrifft ausschliesslich die hörbare Ebene.

## Nicht im Umfang

- Umstellung auf semantisch benannte Gestaltungs-Token (E1/E3) — eigenes, späteres Vorhaben.
- Weitere Farbdesigns über „Dunkel, hoher Kontrast" hinaus (E2).
- Eigene Töne aus mitgebrachten Audiodateien; Import oder Upload von Klängen.
- Auswahl von Stimme, Sprache, Sprechgeschwindigkeit oder Tonhöhe für gesprochene Ansagen.
- Deduplizierung der Tonausgabe über mehrere offene Tabs — bleibt wie heute (jeder Tab spielt).
- Zeitfenster / Ruhezeiten („nicht stören zwischen 22 und 7 Uhr"), Regeln pro Projekt oder pro Feature.
- Änderungen an den sichtbaren Benachrichtigungen oder am Aufmerksamkeits-Eingang.
- Verlagerung der Designwahl auf den Server.

## Dependencies

- Die nutzerweite serverseitige Einstellungsablage des Toolkits (bereits vorhanden, wird um zwei Einträge erweitert).
- Der bestehende Ereignisstrom vom Server zur Oberfläche, über den Aufmerksamkeitsereignisse, Ablauf-Ereignisse und Feature-Änderungen bereits ankommen.
- Die vorhandene Ton- und Sprachfähigkeit des Browsers (kein neuer externer Dienst, keine Netzverbindung nötig).
- Der bestehende Design-Mechanismus als einzige Quelle der Wahrheit für den aktiven Darstellungsmodus samt Benachrichtigung der Nicht-CSS-Abnehmer (Agenten-Konsole).
