# Feature Specification: Speckit-Zwischenresultate pro Feature einsehen und bearbeiten

**Feature Branch**: `feature/show-speckit-results`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "implementiere eine möglichkeit um die einzelnen zwischenresultate des speckit workflows welche als md files gespeichert werden anschauen zu können. Implementiere hierfür icons pro speckit schritt auf der kachel, welche beim hover einen tooltip anzeigen, was sich mit dem icon angeschaut werden kann. Jeder speckit schritt hat ein icon auf der kachel. Beim klicken wird ein modal geöffnet in welchen der user das ergebnis des jeweiligen schritts nachlesen und editieren kann (sofern aktuell das feature nicht aktiv entwickelt wird). Die anzeige zum einsehen und editieren soll nicht als markdown angezeigt werden, sondern in einem lesbaren format. Der user hat im modal oben rechts ein bearbeiten button um direkt den text anzupassen (im editor ebenfalls kein markdown sondern das leserliche format anzeigen). Die änderungen vom user können direkt gespeichert werden. Der user sollte auch eine möglichkeit haben im modal eine claude session als split screen zum modal"

## Clarifications

### Session 2026-07-23

- Q: Für welche Speckit-Schritte erscheint ein Icon auf der Feature-Kachel und was öffnet es? → A: Pro Artefakt-Schritt: Specify → `spec.md`, Plan → `plan.md` (+ Begleitartefakte `research.md`/`data-model.md`/`quickstart.md`/`contracts/`, im Modal auswählbar), Tasks → `tasks.md`, Checklist → Checklisten. Clarify, Analyze und Implement erhalten kein eigenes Icon (kein separates einsehbares Ergebnis-File).
- Q: Welche Claude-Session nutzt der Split-Screen neben dem Modal? → A: Die bestehende persistente Feature-Konsole (dieselbe Session im Worktree des Features, die die Phasen ausführt) — kein neuer Session-Typ.
- Q: Wie wird bearbeitet, damit "kein Markdown" sichtbar ist, ohne Inhalt zu verlieren? → A: Voller WYSIWYG-Rich-Text-Editor ohne Syntaxzeichen; strukturerhaltender, verlustfreier Rückschrieb auch für Tabellen, Codeblöcke und Aufgaben-Checklisten (`- [ ]`).
- Q: Wann gilt ein Feature als "aktiv entwickelt", sodass Bearbeiten gesperrt ist? → A: Sobald für dieses Feature aktuell ein Agent/eine Phase läuft (aktive Ausführung), artefaktunabhängig — Bearbeiten aller Artefakte des Features ist dann gesperrt; Einsehen bleibt möglich.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ergebnis eines Speckit-Schritts lesbar einsehen (Priority: P1)

Als Nutzer sehe ich auf der Feature-Kachel des Boards pro Speckit-Schritt (Specify, Clarify, Plan, Tasks, …) ein Icon. Fahre ich mit dem Zeiger über ein Icon, verrät mir ein Tooltip, welches Zwischenresultat sich dahinter öffnen lässt. Klicke ich das Icon an, öffnet sich ein Modal, das das Ergebnis genau dieses Schritts — den Inhalt der zugehörigen Ergebnis-Datei — in einem lesbaren, formatierten Format darstellt (nicht als roher Markdown-Quelltext). So kann ich die konkreten Zwischenergebnisse meines Features nachlesen, ohne die Dateien im Repository manuell öffnen zu müssen.

**Why this priority**: Das reine Einsehen der Zwischenresultate ist der Kern des Wunsches ("die einzelnen zwischenresultate … anschauen zu können") und liefert eigenständigen Wert. Ohne diese Fähigkeit ist keine der weiteren Funktionen sinnvoll.

**Independent Test**: Kann vollständig getestet werden, indem man bei einem Feature mit vorhandenen Zwischenresultaten das Icon eines Schritts (z. B. Specify) auf der Kachel anklickt und prüft, dass sich ein Modal mit dem lesbar formatierten Inhalt des zugehörigen Ergebnisses öffnet, sowie indem man über die Icons fährt und den erklärenden Tooltip sieht.

**Acceptance Scenarios**:

1. **Given** ein Feature, für das ein Speckit-Schritt ein Ergebnis erzeugt hat, **When** der Nutzer das zugehörige Icon auf der Feature-Kachel anklickt, **Then** öffnet sich ein Modal, das den Inhalt des Ergebnisses dieses Schritts in einem lesbaren, formatierten Format (nicht als Markdown-Quelltext) anzeigt.
2. **Given** die Icons auf der Feature-Kachel, **When** der Nutzer mit dem Zeiger über ein Icon verweilt, **Then** erscheint ein Tooltip, der beschreibt, welches Zwischenresultat sich mit diesem Icon einsehen lässt.
3. **Given** ein Speckit-Schritt, der für dieses Feature noch kein Ergebnis erzeugt hat, **When** der Nutzer das Icon dieses Schritts betrachtet, **Then** ist erkennbar, dass hierfür noch kein Ergebnis vorliegt (z. B. deaktiviertes Icon mit erklärendem Tooltip) — ohne Fehler.
4. **Given** ein geöffnetes Ergebnis-Modal, **When** der Nutzer es schließt, **Then** kehrt er ohne Zustandsverlust zum Board zurück.
5. **Given** ein Feature mit mehreren vorhandenen Zwischenresultaten, **When** der Nutzer nacheinander verschiedene Icons anklickt, **Then** zeigt das Modal jeweils das Ergebnis des passenden Schritts an.

---

### User Story 2 - Ergebnis direkt bearbeiten und speichern (Priority: P2)

Als Nutzer kann ich im geöffneten Ergebnis-Modal über einen Bearbeiten-Button oben rechts in einen Bearbeitungsmodus wechseln, den Inhalt des Zwischenresultats in einem lesbaren Format (nicht als Markdown-Quelltext) anpassen und die Änderungen direkt speichern, sodass die zugrunde liegende Ergebnis-Datei aktualisiert wird — vorausgesetzt, das Feature wird gerade nicht aktiv entwickelt.

**Why this priority**: Der Nutzer verlangt ausdrücklich, das Ergebnis "nachlesen und editieren" zu können und die Änderungen "direkt" zu speichern. Aufbauend auf dem Einsehen (P1) erlaubt das Bearbeiten, Zwischenergebnisse zu korrigieren, ohne einen externen Editor zu bemühen.

**Independent Test**: Kann getestet werden, indem man ein Ergebnis öffnet, über den Button oben rechts in den Bearbeitungsmodus wechselt, den Text ändert, speichert, das Modal schließt und erneut öffnet und prüft, dass die Änderung erhalten geblieben ist.

**Acceptance Scenarios**:

1. **Given** ein geöffnetes Ergebnis-Modal bei einem nicht aktiv entwickelten Feature, **When** der Nutzer den Bearbeiten-Button oben rechts auslöst, **Then** wechselt die Anzeige in einen Bearbeitungsmodus, in dem der Inhalt in einem lesbaren Format editierbar ist (nicht als Markdown-Quelltext).
2. **Given** der Nutzer hat den Inhalt im Bearbeitungsmodus geändert, **When** er speichert, **Then** wird die Änderung dauerhaft in die zugehörige Ergebnis-Datei zurückgeschrieben und eine Erfolgsrückmeldung angezeigt.
3. **Given** der Nutzer hat ungespeicherte Änderungen, **When** er das Modal schließen oder den Modus wechseln will, **Then** wird er gewarnt, bevor die Änderungen verloren gehen.
4. **Given** das Speichern schlägt fehl (z. B. Datei nicht schreibbar), **When** der Nutzer speichert, **Then** erhält er eine verständliche Fehlermeldung und seine Eingaben bleiben erhalten.
5. **Given** die Ergebnis-Datei wurde seit dem Öffnen extern geändert, **When** der Nutzer speichert, **Then** wird er gewarnt und kann zwischen Überschreiben und Neu laden/Verwerfen wählen (kein stilles Überschreiben).
6. **Given** das Feature wird gerade aktiv entwickelt (ein Agent/eine Phase läuft für dieses Feature), **When** der Nutzer das Ergebnis öffnet, **Then** ist die Anzeige nur lesend; der Bearbeiten-Button ist gesperrt bzw. nicht auslösbar, bis die Entwicklung ruht. Das Einsehen bleibt möglich.

---

### User Story 3 - Claude-Session als Split-Screen zum Modal (Priority: P3)

Als Nutzer kann ich aus dem Ergebnis-Modal heraus die bestehende Feature-Konsole (Claude-Session im Worktree des Features) als geteilte Ansicht (Split-Screen) neben dem Modal öffnen, um das angezeigte Zwischenresultat gemeinsam mit Claude zu besprechen, erklären zu lassen oder Anpassungen zu erarbeiten — während das Ergebnis weiterhin sichtbar bleibt.

**Why this priority**: Der Nutzer wünscht ausdrücklich die Möglichkeit, "im modal eine claude session als split screen zum modal" zu nutzen. Der Wert baut auf dem Einsehen/Bearbeiten auf und ist wertvolle, aber nicht zwingende Ergänzung; die Anwendung verfügt bereits über die persistente Feature-Konsole, auf der dies aufsetzt.

**Independent Test**: Kann getestet werden, indem man ein Ergebnis-Modal öffnet, den Split-Screen auslöst und prüft, dass die bestehende Feature-Konsole neben dem sichtbar bleibenden Modal als interaktive Session erscheint und im Kontext des betreffenden Features arbeitet.

**Acceptance Scenarios**:

1. **Given** ein geöffnetes Ergebnis-Modal, **When** der Nutzer den Split-Screen auslöst, **Then** erscheint neben dem weiterhin sichtbaren Modal die bestehende Feature-Konsole als interaktive Claude-Session.
2. **Given** die Claude-Session ist als Split-Screen geöffnet, **When** der Nutzer sie schließt, **Then** bleibt das Modal geöffnet und der Zustand des Ergebnisses (Ansicht bzw. Bearbeitung) erhalten.
3. **Given** die geteilte Ansicht ist aktiv, **When** der Nutzer im Modal weiterliest oder -bearbeitet, **Then** bleiben beide Bereiche gleichzeitig bedienbar.

---

### Edge Cases

- **Schritt ohne Ergebnis**: Ein Speckit-Schritt, der für dieses Feature noch nicht ausgeführt wurde bzw. keine Ergebnis-Datei erzeugt hat, wird erkennbar als "kein Ergebnis vorhanden" dargestellt (z. B. deaktiviertes Icon) — ohne Fehler und ohne leeres Modal.
- **Ergebnis-Datei fehlt/unlesbar**: Die zu einem Schritt erwartete Datei lässt sich nicht finden oder lesen; das Modal zeigt eine verständliche Meldung statt eines leeren oder fehlerhaften Dialogs.
- **Feature wird aktiv entwickelt**: Läuft für das Feature gerade eine Phase/ein Agent, ist das Ergebnis nur lesend; Bearbeiten ist gesperrt. Beginnt eine Entwicklung, während der Nutzer bereits im Bearbeitungsmodus ist, wird er darauf hingewiesen und vor Datenverlust geschützt.
- **Datei extern geändert**: Die Ergebnis-Datei wurde seit dem Öffnen außerhalb des Modals geändert (z. B. durch einen Agenten oder manuell); beim Speichern wird gewarnt (Überschreiben vs. Neu laden/Verwerfen).
- **Strukturierter/gemischter Inhalt**: Ein Ergebnis enthält Codeblöcke, Tabellen, Aufgaben-Checklisten (`- [ ]`) oder Frontmatter; der WYSIWYG-Editor stellt diese formatiert dar und schreibt sie beim Speichern strukturerhaltend und verlustfrei zurück (kein Inhalts- oder Formatverlust).
- **Sehr großes Ergebnis**: Umfangreiche Ergebnis-Dateien müssen lesbar und bedienbar bleiben (Scrollen, keine spürbare Verzögerung).
- **Mehrere Ergebnis-Dateien pro Schritt**: Ein Schritt kann mehr als eine Datei erzeugen (z. B. Plan mit Begleitartefakten, mehrere Checklisten); es ist erkennbar bzw. auswählbar, welches Ergebnis angezeigt wird.
- **Split-Screen auf kleinem Fenster**: Bei geringer Fensterbreite bleibt die geteilte Ansicht bedienbar (z. B. anpassbare Aufteilung), ohne dass Modal oder Session unbrauchbar werden.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS auf der Feature-Kachel des Boards für jeden Speckit-Schritt, der ein einsehbares Ergebnis-Artefakt erzeugt, ein erkennbares Icon anzeigen: Specify (`spec.md`), Plan (`plan.md` inkl. Begleitartefakten), Tasks (`tasks.md`) und Checklist (Checklisten). Clarify, Analyze und Implement erhalten kein eigenes Icon, da sie kein separates einsehbares Ergebnis-File erzeugen.
- **FR-002**: Das System MUSS beim Verweilen des Zeigers über einem Schritt-Icon einen Tooltip anzeigen, der beschreibt, welches Zwischenresultat sich damit einsehen lässt.
- **FR-003**: Das System MUSS beim Aktivieren eines Schritt-Icons ein Modal öffnen, das das Ergebnis des zugehörigen Schritts anzeigt.
- **FR-004**: Das System MUSS den angezeigten Inhalt aus der dem Schritt zugeordneten Ergebnis-Datei des jeweiligen Features beziehen.
- **FR-005**: Das System MUSS den Ergebnis-Inhalt in einem lesbaren, formatierten Format darstellen (Überschriften, Listen, Hervorhebungen, Tabellen, Codeblöcke und Aufgaben-Checklisten visuell aufbereitet) und NICHT als rohen Markdown-Quelltext.
- **FR-006**: Das System MUSS Schritte, die für dieses Feature noch kein Ergebnis erzeugt haben, erkennbar behandeln (z. B. deaktiviertes Icon mit erklärendem Tooltip), ohne Fehler und ohne leeres Modal.
- **FR-007**: Das System MUSS im Modal oben rechts einen Bearbeiten-Button bereitstellen, über den der Nutzer in einen Bearbeitungsmodus für das angezeigte Ergebnis wechseln kann.
- **FR-008**: Das System MUSS den Inhalt im Bearbeitungsmodus in einem vollwertigen WYSIWYG-Rich-Text-Editor editierbar machen, der den Inhalt formatiert und ohne Syntaxzeichen zeigt (NICHT als rohen Markdown-Quelltext).
- **FR-009**: Das System MUSS bearbeitete Inhalte auf Wunsch des Nutzers direkt und dauerhaft in die zugehörige Ergebnis-Datei zurückschreiben und den Erfolg des Speicherns bestätigen.
- **FR-010**: Das System MUSS sicherstellen, dass beim Speichern die ursprüngliche Datei-Struktur/-Formatierung strukturerhaltend und verlustfrei zurückgeschrieben wird — einschließlich Tabellen, Codeblöcke und Aufgaben-Checklisten (`- [ ]`) —, sodass die im WYSIWYG-Editor bearbeitete Fassung die zugrunde liegende (Markdown-)Datei nicht beschädigt.
- **FR-011**: Das System MUSS das Bearbeiten aller Artefakte eines Features sperren (nur-lesend), sobald für dieses Feature aktuell ein Agent/eine Phase läuft (aktive Ausführung), unabhängig davon, welches Artefakt betroffen ist; das Einsehen MUSS währenddessen möglich bleiben.
- **FR-012**: Das System MUSS beim Fehlschlagen eines Speichervorgangs eine verständliche Fehlermeldung anzeigen und die Eingaben des Nutzers erhalten.
- **FR-013**: Das System MUSS den Nutzer warnen, bevor ungespeicherte Änderungen durch Schließen oder Moduswechsel verloren gehen.
- **FR-014**: Das System MUSS beim Speichern erkennen, wenn die Ergebnis-Datei seit dem Öffnen extern geändert wurde, und den Nutzer warnen sowie zwischen Überschreiben und Neu laden/Verwerfen wählen lassen (kein stilles Überschreiben).
- **FR-015**: Das System MUSS aus dem Modal heraus die Möglichkeit bieten, die bestehende persistente Feature-Konsole (die Session im Worktree des Features) als geteilte Ansicht (Split-Screen) neben dem Modal zu öffnen, während das Modal sichtbar bleibt; es wird keine neue, davon unabhängige Session-Infrastruktur eingeführt.
- **FR-016**: Das System MUSS gewährleisten, dass Modal und Claude-Session in der geteilten Ansicht gleichzeitig bedienbar sind und das Schließen der Session das Modal samt seinem Zustand (Ansicht bzw. Bearbeitung) unberührt lässt.
- **FR-017**: Das System MUSS das Modal ohne Zustandsverlust für das übrige Board schließen können.
- **FR-018**: Das System MUSS für einen Schritt, der mehrere Ergebnis-Dateien erzeugt (insbesondere Plan mit `research.md`, `data-model.md`, `quickstart.md` und `contracts/`), innerhalb des Modals erkennbar und auswählbar machen, welches der zugehörigen Artefakte angezeigt wird.

### Key Entities *(include if data involved)*

- **Speckit-Schritt (Phase)**: Ein Arbeitsschritt des Ablaufs mit einsehbarem Ergebnis-Artefakt — Specify (`spec.md`), Plan (`plan.md` + Begleitartefakte), Tasks (`tasks.md`), Checklist (Checklisten). Clarify, Analyze und Implement zählen nicht dazu (kein separates einsehbares Ergebnis-File). Attribute: Zugehörigkeit zum Feature, erwartete Ergebnis-Datei(en), Vorhandensein eines Ergebnisses.
- **Zwischenresultat (Ergebnis-Datei)**: Die von einem Schritt für ein konkretes Feature erzeugte Datei (z. B. `spec.md`, `plan.md`, `tasks.md` sowie Begleitartefakte und Checklisten). Attribute: Zugehörigkeit zu Schritt und Feature, Inhalt, lesbare (formatierte) Darstellung, Speicherort, Änderungsstand (zur Konflikterkennung), Bearbeitbarkeit (gesperrt bei aktiver Entwicklung).
- **Feature-Kachel**: Die Karte eines Features auf dem Board, die pro Speckit-Schritt ein Icon zum Öffnen des jeweiligen Zwischenresultats trägt.
- **Claude-Session (Split-Screen)**: Die bestehende persistente Feature-Konsole (Session im Worktree des Features), die neben dem Modal als geteilte Ansicht geöffnet werden kann.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein Nutzer kann in höchstens zwei Interaktionen (Icon auf der Kachel anklicken → Inhalt sichtbar) das Ergebnis eines Speckit-Schritts nachlesen.
- **SC-002**: Nach dem Öffnen wird das Ergebnis eines Schritts in unter 1 Sekunde lesbar formatiert angezeigt.
- **SC-003**: In 100 % der geöffneten Ergebnisse wird der Inhalt in einem lesbaren Format (nicht als Markdown-Quelltext) dargestellt — sowohl beim Einsehen als auch im Bearbeitungsmodus.
- **SC-004**: Eine im Bearbeitungsmodus gespeicherte Änderung ist nach erneutem Öffnen des Modals zu 100 % unverändert vorhanden und die zugrunde liegende Datei bleibt strukturell verlustfrei.
- **SC-005**: In 100 % der Fälle ohne verfügbares Ergebnis, mit Speicherkonflikt oder bei aktiver Entwicklung des Features erhält der Nutzer eine eindeutige Rückmeldung statt eines Fehlers oder stillen Datenverlusts.
- **SC-006**: Für jeden Speckit-Schritt eines Features, der ein Ergebnis erzeugt hat, ist dieses über das Icon auf der Kachel abrufbar.
- **SC-007**: Der Nutzer kann eine typische kleine Korrektur an einem Zwischenresultat vollständig innerhalb der Anwendung vornehmen und speichern, ohne das Dateisystem manuell zu durchsuchen.
- **SC-008**: Der Nutzer kann aus dem Modal heraus eine Claude-Session als Split-Screen öffnen und dabei das Ergebnis weiterhin sehen; beide Bereiche bleiben gleichzeitig bedienbar.

## Assumptions

- Dieses Feature betrifft die **pro Feature erzeugten Zwischenresultate** (die Artefakt-Dateien wie `spec.md`, `plan.md`, `tasks.md` samt Begleitartefakten/Checklisten unter dem Feature-Ordner) — im Unterschied zum verwandten Feature "spec-kit-spezifikation-einsehen", das die **generische Schritt-Definition** ("Was macht dieser Schritt?") pro Lane-Header betrifft. Die Icons dieses Features sitzen daher auf der **Feature-Kachel**, nicht im Lane-Header.
- "Lesbares Format statt Markdown" bedeutet: Der Inhalt wird **formatiert/aufbereitet** dargestellt (Überschriften, Listen, Hervorhebungen, Tabellen, Codeblöcke, Aufgaben-Checklisten visuell gerendert) statt als roher Markdown-Quelltext mit Syntaxzeichen; im Editor wird derselbe Inhalt in einem vollwertigen WYSIWYG-Rich-Text-Editor bearbeitet und beim Speichern strukturerhaltend und verlustfrei in die zugrunde liegende (Markdown-)Datei zurückgeführt.
- "Jeder Speckit-Schritt hat ein Icon" bezieht sich auf die artefakt-erzeugenden Schritte Specify, Plan, Tasks und Checklist; Clarify, Analyze und Implement erhalten kein eigenes Icon. Schritte ohne (bereits vorhandenes) Ergebnis zeigen ein erkennbar inaktives Icon.
- "Feature wird aktiv entwickelt" bedeutet, dass für dieses Feature aktuell eine Phase bzw. ein Agent/eine Session läuft; in diesem Zustand ist das Bearbeiten aller Artefakte des Features gesperrt (artefaktunabhängig), Einsehen bleibt möglich.
- Der Split-Screen nutzt die bereits vorhandene persistente Feature-Konsole (Claude-Session im Worktree des Features); es wird keine neue, davon unabhängige Session-Infrastruktur eingeführt.
- Die Anwendung wird von einer einzelnen Person lokal genutzt; es ist keine Mehrbenutzer-Zugriffskontrolle erforderlich, wohl aber Schutz vor Konflikten mit gleichzeitig laufenden Agenten und externen Änderungen.
- Die Zwischenresultate bleiben als Dateien im Ziel-Repository (`specs/<feature>/`) die Quelle der Wahrheit; das Speichern schreibt in diese Dateien zurück.
- Mobile-/Touch-Bedienung ist für die erste Version nicht im Fokus.
