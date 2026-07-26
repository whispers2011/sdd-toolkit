# Feature Specification: Geschätzte Kosten aus den Läufen entfernen

**Feature Branch**: `feature/kosten-aus-laeufe-entfernen`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "Die geschätzten Kosten sollen aus den läufen entfernt werden. Keine pro lauf und auch keine total."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Läufe-Ansicht ohne Kostenangaben (Priority: P1)

Als Nutzer der „Läufe"-Ansicht möchte ich zu jedem Lauf nur Angaben sehen, die tatsächlich
belastbar sind — Tokens, Dauer, Status, Verlauf — und keine geschätzten Geldbeträge, weder
pro Lauf noch als Gesamtsumme über alle Läufe.

**Why this priority**: Dies ist der Kern der Anforderung. Die angezeigten Dollarbeträge sind
Schätzungen, die aus Token-Zahlen und hinterlegten Preisannahmen abgeleitet werden. Sie sehen
wie eine Abrechnung aus, sind aber keine, und werden deshalb falsch verstanden — als
tatsächlich entstandene Kosten. Solange sie sichtbar sind, treffen Nutzer Entscheidungen auf
Basis einer Zahl, die niemand verifizieren kann. Der Weg dahin ist, sie zu entfernen, nicht
sie zu kennzeichnen.

**Independent Test**: Ein Projekt mit mehreren abgeschlossenen Läufen in der „Läufe"-Ansicht
öffnen, einen Lauf aufklappen und alle Ebenen (Kopfzeile, Lauf-Zeile, Steps, Einzel-Läufe)
prüfen. Nirgends erscheint ein Geldbetrag; Tokens, Dauer und Status sind unverändert
vorhanden.

**Acceptance Scenarios**:

1. **Given** ein Projekt mit mehreren Läufen, **When** der Nutzer die „Läufe"-Ansicht öffnet,
   **Then** zeigt die Zusammenfassung über alle Läufe die Anzahl Läufe, die Tokens und den
   Messanteil, aber keinen Gesamt-Geldbetrag.
2. **Given** die Liste der Läufe, **When** der Nutzer eine Lauf-Zeile betrachtet, **Then**
   enthält sie Name, Status, Verbrauchsverteilung und Tokens, aber keinen Geldbetrag für
   diesen Lauf.
3. **Given** ein aufgeklappter Lauf mit Verbrauch pro Step, **When** der Nutzer die
   Step-Auswertung betrachtet, **Then** ist zu jedem Step der Token-Verbrauch ausgewiesen,
   ohne begleitenden Geldbetrag.
4. **Given** ein aufgeklappter Lauf mit einzelnen Ausführungen, **When** der Nutzer die
   Tabelle der Einzel-Ausführungen betrachtet, **Then** enthält sie Start, Art, Status,
   Dauer und Tokens, aber keine Kosten-Spalte.
5. **Given** ein Lauf, dessen Tokens nur geschätzt sind, **When** der Nutzer ihn betrachtet,
   **Then** bleibt die Herkunfts-Kennzeichnung der Tokens („gemessen" / „geparst" /
   „geschätzt") erhalten, ohne dass ein Geldbetrag hinzukommt.

---

### User Story 2 - Keine Kostenangaben in den übrigen Lauf-Ansichten (Priority: P2)

Als Nutzer möchte ich, dass auch dort keine geschätzten Kosten erscheinen, wo Läufe außerhalb
der „Läufe"-Ansicht dargestellt werden — im Review-Portal, in der Test-/Verifikations-Übersicht,
in der Audit-Seitenleiste und bei der Agent-Auswahl.

**Why this priority**: Ohne diesen Schritt bleibt genau dieselbe Schätzzahl an anderer Stelle
stehen, und die Entfernung wirkt wie ein Anzeigefehler statt wie eine Entscheidung.
Widersprüchliche Oberflächen — hier keine Kosten, zwei Klicks weiter doch — untergraben das
Ziel von US1. Eigenständig, weil jede dieser Ansichten für sich prüfbar ist.

**Independent Test**: Für ein Feature mit Läufen das Review-Portal öffnen und Kopfzeile,
Test-Übersicht und Audit-Seitenleiste prüfen, danach den Dialog zur Agent-Auswahl öffnen.
Keine dieser Ansichten zeigt einen Geldbetrag.

**Acceptance Scenarios**:

1. **Given** ein Feature mit mehreren Ausführungen, **When** der Nutzer das Review-Portal
   öffnet, **Then** zeigt die Kopfzeile die übrigen Kennzahlen (Dateien, Audits, Verify),
   aber keine Kosten-Kennzahl.
2. **Given** eine Test-/Verifikations-Übersicht mit mehreren Läufen, **When** der Nutzer sie
   öffnet, **Then** sind Anzahl, Status, Dauer und Tokens ausgewiesen, aber weder eine
   Kosten-Kennzahl über alle Läufe noch ein Betrag pro Lauf.
3. **Given** Audit-Läufe eines Review-Agenten, **When** der Nutzer die Audit-Seitenleiste
   betrachtet, **Then** erscheinen Zeitpunkt, Verdict und Tokens zu jedem Lauf, aber kein
   Geldbetrag.
4. **Given** ein Agent mit einem vorherigen Lauf, **When** der Nutzer den Dialog zur
   Agent-Auswahl öffnet, **Then** wird der letzte Lauf mit Zeitpunkt und Tokens beschrieben,
   ohne Geldbetrag.

---

### User Story 3 - Keine geschätzten Kosten in den Lauf-Daten (Priority: P3)

Als Nutzer möchte ich, dass geschätzte Geldbeträge nicht nur ausgeblendet, sondern gar nicht
mehr Bestandteil der Lauf-Auswertung sind, damit sie nicht an anderer Stelle wieder auftauchen.

**Why this priority**: Ein rein visuelles Ausblenden lässt die Schätzung im System und macht
ihr Wiederauftauchen zur Frage der Zeit. Diese Story macht die Entfernung dauerhaft. Sie ist
nachrangig, weil der Nutzen für den Nutzer erst mit US1/US2 eintritt, und eigenständig
prüfbar, weil die ausgelieferten Lauf-Daten direkt inspiziert werden können.

**Independent Test**: Die Lauf- und Ausführungsdaten abrufen, die die Ansichten speisen, und
prüfen, dass sie keine geschätzten Geldbeträge mehr enthalten, während Token- und
Herkunftsangaben vollständig vorhanden sind.

**Acceptance Scenarios**:

1. **Given** ein Projekt mit Läufen, **When** die Lauf-Zusammenfassungen abgerufen werden,
   **Then** enthalten sie Token- und Herkunftsangaben, aber keinen geschätzten Geldbetrag —
   weder pro Lauf, pro Step, pro Kategorie noch als Summe.
2. **Given** ein Feature mit Ausführungen, **When** die Einzel-Ausführungen abgerufen werden,
   **Then** enthält keine davon einen geschätzten Geldbetrag.
3. **Given** bestehende, in der Vergangenheit erfasste Läufe, **When** der Nutzer sie nach
   der Änderung öffnet, **Then** sind sie weiterhin vollständig einsehbar (Tokens, Dauer,
   Status, Logs) und es entstehen keine Fehler oder Leerstellen durch die entfernten
   Kostenangaben.

---

### Edge Cases

- Ein Lauf ohne jede gemessene Nutzung: Die Ansicht bleibt vollständig lesbar; an der Stelle
  des früheren Betrags entsteht keine Leerstelle und kein Platzhalter wie „—".
- Ein noch laufender Lauf: Der Live-Status und die laufend aktualisierten Tokens erscheinen
  unverändert; es wird kein Zwischenbetrag angezeigt.
- Läufe, die vor der Änderung mit erfassten Kostenwerten abgeschlossen wurden: Diese Werte
  werden nicht mehr angezeigt, machen die betroffenen Läufe aber nicht unlesbar.
- Eine Ansicht, in der die Kosten-Angabe die einzige Information einer Spalte oder Kennzahl
  war: Die Spalte bzw. Kennzahl verschwindet ganz, statt leer stehen zu bleiben, und das
  Layout der übrigen Angaben bleibt intakt.
- Nutzer, die die bisherige Kostenangabe kannten: Sie finden an ihrer Stelle keine
  irreführende Ersatzzahl; die Token-Angabe bleibt die Bezugsgröße für den Verbrauch.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Die „Läufe"-Ansicht MUSS ohne Gesamt-Kostenangabe über alle Läufe auskommen;
  Anzahl Läufe, Tokens und Messanteil bleiben erhalten.
- **FR-002**: Die „Läufe"-Ansicht MUSS ohne Kostenangabe pro Lauf auskommen; Name, Status,
  Verbrauchsverteilung und Tokens bleiben erhalten.
- **FR-003**: Die Step-Auswertung eines aufgeklappten Laufs MUSS den Token-Verbrauch pro Step
  ohne begleitende Kostenangabe ausweisen.
- **FR-004**: Die Tabelle der Einzel-Ausführungen eines Laufs MUSS ohne Kosten-Spalte
  auskommen; Start, Art, Status, Dauer und Tokens bleiben erhalten.
- **FR-005**: Das Review-Portal MUSS ohne Kosten-Kennzahl in der Kopfzeile auskommen; die
  übrigen Kennzahlen bleiben unverändert.
- **FR-006**: Die Test-/Verifikations-Übersicht MUSS ohne aggregierte Kosten-Kennzahl und
  ohne Kostenangabe pro Lauf auskommen.
- **FR-007**: Die Audit-Seitenleiste und die Agent-Auswahl MÜSSEN Läufe ohne Kostenangabe
  beschreiben; Zeitpunkt, Verdict/Zusammenfassung und Tokens bleiben erhalten.
- **FR-008**: Kein Nutzer-sichtbarer Bereich, der Läufe oder Ausführungen darstellt, DARF
  einen geschätzten Geldbetrag anzeigen.
- **FR-009**: Die Lauf- und Ausführungsdaten, die diese Ansichten speisen, DÜRFEN KEINEN
  geschätzten Geldbetrag mehr enthalten — weder pro Ausführung, pro Step, pro Kategorie noch
  als Summe.
- **FR-010**: Alle Token- und Herkunftsangaben („gemessen" / „geparst" / „geschätzt") MÜSSEN
  unverändert erhalten bleiben; die Entfernung betrifft ausschließlich Geldbeträge.
- **FR-011**: Bereits erfasste Läufe MÜSSEN nach der Änderung weiterhin vollständig einsehbar
  sein (Tokens, Dauer, Status, Logs), ohne Fehler durch die entfernten Kostenangaben.
- **FR-012**: Wo eine Kostenangabe die einzige Information einer Spalte, Kennzahl oder Zeile
  war, MUSS dieses Element entfernt werden, statt leer oder als Platzhalter zu verbleiben.

### Key Entities *(include if feature involves data)*

- **Lauf**: Ein Worktree bzw. Feature, aggregiert über seine Ausführungen. Trägt künftig
  Verbrauch ausschließlich als Tokens (mit Herkunft) und keine abgeleiteten Geldbeträge.
- **Ausführung**: Eine einzelne Agent-Ausführung innerhalb eines Laufs, mit Start, Art,
  Status, Dauer, Tokens und Log — ohne geschätzten Geldbetrag.
- **Verbrauchs-Aggregat**: Die Rollup-Größe, mit der Läufe pro Step, pro Kategorie und
  insgesamt zusammengefasst werden. Führt Token- und Herkunftsanteile, keine Geldbeträge.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In der „Läufe"-Ansicht ist auf allen Ebenen (Zusammenfassung, Lauf-Zeile, Steps,
  Einzel-Ausführungen) kein Geldbetrag auffindbar — 0 Vorkommen bei vollständiger Durchsicht
  eines Projekts mit mindestens einem aufgeklappten Lauf.
- **SC-002**: In den übrigen Ansichten, die Läufe darstellen (Review-Portal-Kopfzeile,
  Test-Übersicht, Audit-Seitenleiste, Agent-Auswahl), ist ebenfalls kein Geldbetrag
  auffindbar — 0 Vorkommen.
- **SC-003**: Die ausgelieferten Lauf- und Ausführungsdaten enthalten 0 geschätzte
  Geldbeträge, während Token- und Herkunftsangaben zu 100 % erhalten bleiben.
- **SC-004**: Alle vor der Änderung erfassten Läufe eines Projekts lassen sich nach der
  Änderung unverändert öffnen und aufklappen — 100 % ohne Fehler, leere Spalten oder fehlende
  Token-/Log-Angaben.
- **SC-005**: Ein Nutzer, der den Verbrauch eines Laufs beurteilen will, findet die
  Token-Angabe weiterhin ohne zusätzliche Schritte an derselben Stelle wie bisher.

## Assumptions

- „Läufe" meint primär die „Läufe"-Ansicht (ein Lauf = ein Worktree/Feature); weil dieselbe
  Schätzzahl auch in Review-Portal, Test-Übersicht, Audit-Seitenleiste und Agent-Auswahl
  erscheint, umfasst die Entfernung auch diese Stellen (US2). Eine Beschränkung auf die
  „Läufe"-Ansicht allein würde widersprüchliche Oberflächen hinterlassen.
- Entfernt werden ausschließlich Geldbeträge. Tokens, Herkunfts-Kennzeichnungen, Dauer,
  Status, Logs und die Kategorisierung in Spezifikation/Coding/Overhead/Chat bleiben
  vollständig erhalten und sind die verbleibende Bezugsgröße für Verbrauch.
- Es wird kein Ersatz für die Kostenangabe eingeführt — kein Platzhalter, keine
  Größenordnungs-Anzeige, keine Kennzeichnung „Schätzung entfernt". Die Angabe verschwindet.
- Es wird keine Möglichkeit vorgesehen, die Kostenanzeige per Einstellung wieder
  einzuschalten; das Feature entfernt sie, es macht sie nicht optional.
- Historisch erfasste Kostenwerte müssen nicht rückwirkend bereinigt oder migriert werden;
  entscheidend ist, dass sie Nutzern nicht mehr angezeigt werden und nicht mehr Teil der
  ausgelieferten Lauf-Auswertung sind. Wie mit bereits gespeicherten Werten technisch
  umgegangen wird, ist eine Planungsentscheidung.
- Ob die Preis-/Kostenberechnung als interner Mechanismus bestehen bleibt, ist ebenfalls eine
  Planungsentscheidung — solange kein Ergebnis daraus eine Nutzer-sichtbare Ansicht oder die
  Lauf-Auswertung erreicht (FR-008, FR-009).
- Die bestehende Kosten-Aufschlüsselung pro Feature (Phase/Art) wird derzeit in keiner
  Nutzer-Ansicht dargestellt; sie ist damit von US1/US2 nicht betroffen und fällt nur unter
  FR-008, falls sie künftig angezeigt würde.
