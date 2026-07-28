# Feature Specification: Dokument-Upload bei manueller Feature-Erfassung

**Feature Branch**: `feature/dokument-upload-bei-manueller-feature-erfassung`

**Created**: 2026-07-27

**Status**: Draft

**Input**: User description: "Wird ein Feature manuell erfasst, soll es möglich sein auch files als context hochzuladen. diese sollen während der spezifikation und entwicklung des features zur Verfügung stehen und berücksichtigt werden."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dokumente beim Anlegen eines Features mitgeben (Priority: P1)

Als Nutzer möchte ich beim manuellen Anlegen eines Features neben Name und Beschreibung auch Dateien mitgeben — etwa ein Anforderungsdokument, einen Screenshot, ein Datenschema oder ein Protokoll —, damit der Agent seine Spezifikation auf diesem Material aufbaut statt nur auf dem kurzen Beschreibungstext.

**Why this priority**: Das ist der Kern des Features. Ohne die Möglichkeit, Dateien überhaupt mitzugeben, existiert nichts, was in späteren Schritten berücksichtigt werden könnte. Sobald ein Dokument beim Anlegen mitgegeben werden kann und der Spezifikationslauf es verwendet, liefert das Feature bereits vollen Wert.

**Independent Test**: Ein Feature manuell anlegen, dabei ein Dokument mitgeben, das eine eindeutige, im Beschreibungstext nicht genannte Anforderung enthält. Prüfen, dass das Dokument nach dem Anlegen unverändert beim Feature liegt und dass die erzeugte Spezifikation diese Anforderung aufgreift.

**Acceptance Scenarios**:

1. **Given** der Dialog zur manuellen Feature-Erfassung ist geöffnet, **When** der Nutzer eine oder mehrere Dateien auswählt oder in den Dialog zieht, **Then** erscheinen sie als Liste mit Dateiname und Größe, bevor das Feature angelegt wird.
2. **Given** Name, Beschreibung und mindestens ein Dokument sind erfasst, **When** der Nutzer das Feature anlegt, **Then** entsteht das Feature wie bisher (Branch, Worktree, Konsole) und die Dokumente liegen unverändert beim Feature.
3. **Given** ein Feature wurde mit Dokumenten angelegt, **When** der Spezifikationslauf startet, **Then** enthält sein Auftrag eine Auflistung der hinterlegten Dokumente samt Fundort mit dem Hinweis, dieses Material als Ausgangsbasis zu verwenden.
4. **Given** ein Feature wird ohne Beschreibung, aber mit mindestens einem Dokument angelegt, **When** der Nutzer das Feature anlegt, **Then** startet der Spezifikationslauf trotzdem und stützt sich auf die Dokumente.
5. **Given** der Dialog ist geöffnet und es wurde keine Datei ausgewählt, **When** der Nutzer das Feature anlegt, **Then** verhält sich der Ablauf exakt wie vor dieser Erweiterung.

---

### User Story 2 - Dokumente bleiben über alle Arbeitsschritte verfügbar (Priority: P2)

Als Nutzer möchte ich, dass die mitgegebenen Dokumente nicht nur bei der Spezifikation, sondern auch bei Planung, Aufgabenbildung und Umsetzung greifbar sind und berücksichtigt werden — damit Detailinformationen aus den Dokumenten nicht nur einmal am Anfang einfließen und dann verloren gehen.

**Why this priority**: Ohne diese Story wären Dokumente reines Anlage-Material; alles, was erst in der Umsetzung relevant wird (z. B. ein Datenschema oder eine Fehlermeldung aus einem Protokoll), ginge verloren. Die Story ist unabhängig testbar, setzt aber sinnvollerweise auf US1 auf.

**Independent Test**: Ein Feature mit einem Dokument anlegen, das ein Detail enthält, das erst in der Umsetzung gebraucht wird (z. B. eine exakte Feldbezeichnung). Die weiteren Schritte nacheinander starten und prüfen, dass jeder Schritt den Verweis auf die Dokumente erhält und das Detail korrekt übernommen wird.

**Acceptance Scenarios**:

1. **Given** ein Feature mit hinterlegten Dokumenten, **When** ein beliebiger weiterer Arbeitsschritt des Features startet, **Then** enthält dessen Auftrag den Verweis auf die hinterlegten Dokumente und deren Fundort.
2. **Given** der Gesprächskontext der Feature-Sitzung wurde zwischen zwei Schritten zurückgesetzt oder verdichtet, **When** der nächste Schritt startet, **Then** ist der Verweis auf die Dokumente weiterhin vorhanden.
3. **Given** ein Feature mit hinterlegten Dokumenten, dessen Arbeitsumgebung neu aufgesetzt wurde, **When** der nächste Schritt startet, **Then** sind die Dokumente weiterhin am selben Fundort vorhanden.
4. **Given** ein Feature mit hinterlegten Dokumenten, **When** die Arbeit am Feature abgeschlossen und in den Zielstand übernommen wird, **Then** bleibt nachvollziehbar, welches Material der Umsetzung zugrunde lag.

---

### User Story 3 - Auswahl prüfen, korrigieren und später einsehen (Priority: P3)

Als Nutzer möchte ich meine Dateiauswahl vor dem Anlegen noch korrigieren können und später am Feature sehen, welche Dokumente hinterlegt sind — damit ich eine versehentlich gewählte Datei entferne und mich später erinnere, worauf das Feature aufsetzt.

**Why this priority**: Komfort- und Kontrollschicht. Das Feature funktioniert auch ohne sie, sie senkt aber die Fehlerkosten (falsches oder vertrauliches Dokument) und macht die Herkunft der Spezifikation nachvollziehbar.

**Independent Test**: Im Dialog mehrere Dateien auswählen, eine davon wieder entfernen, eine zu große Datei hinzufügen, das Feature anlegen — und anschließend am Feature die Liste der tatsächlich hinterlegten Dokumente einsehen.

**Acceptance Scenarios**:

1. **Given** mehrere ausgewählte Dateien im Dialog, **When** der Nutzer eine davon entfernt, **Then** verschwindet nur diese aus der Liste, die übrigen bleiben erhalten.
2. **Given** der Nutzer wählt eine Datei, die die zulässige Größe überschreitet, **When** die Auswahl übernommen wird, **Then** erscheint eine verständliche Meldung mit Dateiname und Grenze, die übrige Auswahl bleibt unverändert bestehen und das Feature ist weiterhin anlegbar.
3. **Given** der Nutzer wählt zwei Dateien mit identischem Namen, **When** das Feature angelegt wird, **Then** liegen beide Dokumente unterscheidbar beim Feature vor, ohne dass eines das andere überschreibt.
4. **Given** ein angelegtes Feature mit Dokumenten, **When** der Nutzer das Feature betrachtet, **Then** sieht er, welche Dokumente hinterlegt sind, und kann sie öffnen.

---

### Edge Cases

- **Datei überschreitet die Größengrenze**: Meldung mit Dateiname und Grenze; die übrige Auswahl bleibt bestehen, das Anlegen wird nicht blockiert.
- **Mehr Dateien als zulässig**: Die Obergrenze wird vor dem Anlegen gemeldet; der Nutzer kann die Auswahl reduzieren.
- **Leere Datei (0 Byte)**: Wird abgelehnt und gemeldet, statt als leerer Kontext hinterlegt zu werden.
- **Gleichnamige Dateien**: Beide werden hinterlegt und bleiben unterscheidbar; keine stille Überschreibung.
- **Dateiname mit Sonderzeichen oder Pfadanteilen**: Der Name wird so übernommen, dass er ausschließlich im Ablageort des Features landet und keinen Schreibzugriff außerhalb bewirken kann.
- **Übernahme einzelner Dokumente scheitert** (z. B. Schreibfehler): Das Feature entsteht dennoch nutzbar; der Nutzer erfährt konkret, welche Dokumente nicht übernommen wurden.
- **Anlegen des Features scheitert nach dem Hochladen** (z. B. Name existiert bereits): Es bleiben keine verwaisten Dokumente ohne zugehöriges Feature zurück.
- **Dateiformat, das der Agent nicht direkt lesen kann** (z. B. proprietäre Binärformate): Das Dokument wird trotzdem hinterlegt und aufgelistet; das Toolkit sagt nicht zu, dass jedes Format inhaltlich ausgewertet werden kann.
- **Feature ohne Dokumente**: Aufträge an den Agenten enthalten keinen Dokument-Verweis — kein leerer Abschnitt, keine zusätzlichen Tokens.
- **Sehr großes Dokument innerhalb der Grenze**: Der Verweis nennt Name und Fundort; der gesamte Inhalt wird nicht in den Auftrag kopiert.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Der Dialog zur manuellen Feature-Erfassung MUSS es erlauben, eine oder mehrere Dateien von der eigenen Maschine mitzugeben — über eine Dateiauswahl und per Ziehen in den Dialog.
- **FR-002**: Ausgewählte Dateien MÜSSEN vor dem Anlegen als Liste mit Dateiname und Größe sichtbar sein und einzeln wieder entfernbar sein.
- **FR-003**: Beim Anlegen des Features MÜSSEN die ausgewählten Dateien inhaltlich unverändert beim Feature abgelegt werden; das Toolkit konvertiert, kürzt oder interpretiert sie nicht.
- **FR-004**: Die Dokumente MÜSSEN an einem festen, pro Feature eindeutigen Ort in der Arbeitsumgebung des Features abgelegt werden, der zusammen mit den übrigen Feature-Artefakten (Spezifikation, Plan, Aufgaben) auffindbar und nachvollziehbar ist.
- **FR-005**: Dateinamen MÜSSEN beim Ablegen so behandelt werden, dass sie eindeutig bleiben (Namenskollision → unterscheidbarer Name) und ausschließlich innerhalb des Ablageorts des Features wirken (kein Verzeichniswechsel, kein Schreibzugriff außerhalb).
- **FR-006**: Der Auftrag an den Spezifikationsschritt MUSS die hinterlegten Dokumente mit Namen und Fundort auflisten und anweisen, dieses Material als Ausgangsbasis der Spezifikation zu verwenden.
- **FR-007**: Auch die Aufträge aller nachfolgenden Arbeitsschritte des Features (u. a. Planung, Aufgabenbildung, Umsetzung) MÜSSEN diesen Verweis enthalten, solange Dokumente hinterlegt sind.
- **FR-008**: Der Verweis MUSS auch dann wieder mitgegeben werden, wenn der Gesprächskontext der Feature-Sitzung zwischenzeitlich zurückgesetzt oder verdichtet wurde.
- **FR-009**: Der Verweis MUSS auf Name und Fundort beschränkt bleiben; Dokumentinhalte werden NICHT in den Auftragstext kopiert.
- **FR-010**: Wird ein Feature ohne Beschreibung, aber mit mindestens einem Dokument angelegt, MUSS der Spezifikationsschritt dennoch starten und sich auf die Dokumente stützen.
- **FR-011**: Das System MUSS je Datei eine Größengrenze und je Feature eine Höchstzahl an Dokumenten durchsetzen und Überschreitungen vor dem Anlegen mit Dateiname und Grenze melden, ohne die übrige Auswahl zu verwerfen.
- **FR-012**: Leere Dateien (0 Byte) MÜSSEN abgelehnt und gemeldet werden.
- **FR-013**: Das System MUSS beliebige Dateiarten annehmen (Text, Bild, Tabellen, PDF, sonstige Binärdateien) und sie unabhängig von der Lesbarkeit durch den Agenten hinterlegen und auflisten.
- **FR-014**: Scheitert die Übernahme einzelner Dokumente, MUSS das Feature dennoch nutzbar angelegt werden und der Nutzer MUSS erfahren, welche Dokumente nicht übernommen wurden — kein stiller Verlust.
- **FR-015**: Scheitert das Anlegen des Features selbst, MÜSSEN bereits übertragene Dokumente verworfen werden; es dürfen keine verwaisten Dokumente ohne zugehöriges Feature zurückbleiben.
- **FR-016**: Am angelegten Feature MUSS einsehbar sein, welche Dokumente hinterlegt sind, mit der Möglichkeit, ein Dokument zu öffnen.
- **FR-017**: Wurden keine Dokumente mitgegeben, MUSS sich der bisherige Ablauf unverändert verhalten — insbesondere darf kein zusätzlicher Auftragstext an den Agenten gehen.
- **FR-018**: Die Grenzen aus FR-011 MÜSSEN dem Nutzer im Dialog erkennbar sein, bevor er eine Datei auswählt.

### Key Entities

- **Feature-Dokument**: Eine vom Nutzer beim Anlegen mitgegebene Datei. Merkmale: Anzeigename (ursprünglicher Dateiname), abgelegter Name, Größe, Art der Datei, Ablageort relativ zur Arbeitsumgebung des Features, Zeitpunkt der Übernahme. Gehört zu genau einem Feature.
- **Feature**: Bestehende Einheit; wird um die Zuordnung einer Menge von Feature-Dokumenten (0..n) erweitert.
- **Arbeitsschritt-Auftrag**: Bestehender Auftragstext, mit dem ein Schritt des Features gestartet wird; wird um den Dokument-Verweis (Liste + Fundort) ergänzt, sofern Dokumente vorhanden sind.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein Nutzer kann beim Anlegen eines Features bis zu 10 Dokumente mitgeben, ohne den Dialog zu verlassen oder Dateien vorher an einen anderen Ort kopieren zu müssen; der gesamte Anlegevorgang inklusive Dokumentauswahl dauert unter 60 Sekunden.
- **SC-002**: 100 % der als übernommen gemeldeten Dokumente sind anschließend beim Feature auffindbar und inhaltlich identisch zur Ausgangsdatei.
- **SC-003**: In 100 % der gestarteten Arbeitsschritte eines Features mit Dokumenten ist der Verweis auf die Dokumente im Auftrag enthalten — geprüft über alle für das Projekt aktivierten Schritte, auch nach einem Kontext-Reset.
- **SC-004**: In einem Kontrolllauf mit einem Dokument, das eine eindeutige, im Beschreibungstext nicht genannte Anforderung enthält, taucht diese Anforderung in der erzeugten Spezifikation auf.
- **SC-005**: Kein Anlegevorgang schlägt wegen Dokumenten still fehl: In 100 % der Fehlerfälle (zu groß, leer, Übernahme gescheitert) sieht der Nutzer eine Meldung, die Dateiname und Ursache nennt.
- **SC-006**: Das Anlegen eines Features ohne Dokumente ist gegenüber dem heutigen Verhalten unverändert — gleiche Schritte, gleicher Auftragstext an den Agenten, keine zusätzlichen Tokens.
- **SC-007**: Nach Abschluss des Features ist aus den Feature-Artefakten heraus nachvollziehbar, welches Ausgangsmaterial der Spezifikation zugrunde lag.

## Assumptions

- **Umfang „manuelle Erfassung"**: Gemeint ist der Dialog „Neues Feature" — sowohl aus der Seitenleiste heraus als auch mit Werten aus einem Feature-Vorschlag des Projekt-Chats vorbefüllt. Der Jira-Import bringt Ticket-Anhänge bereits eigenständig mit und ist nicht Teil dieses Features.
- **Ablage bei den Feature-Artefakten**: Die Dokumente werden analog zum bestehenden Jira-Dossier bei den versionierten Artefakten des Features abgelegt und wandern damit über Review und Integration mit. Vertrauliches Material sollte entsprechend bewusst mitgegeben werden.
- **Grenzen**: Je Datei gilt die im Projekt bereits etablierte Obergrenze von 25 MB; je Feature sind höchstens 20 Dokumente vorgesehen. Beide Werte sind bewusst großzügig und in der Planung anpassbar.
- **Keine Inhaltsauswertung durch das Toolkit**: Das Toolkit extrahiert keinen Text, erzeugt keine Zusammenfassungen und wandelt keine Formate um. Ob ein Format inhaltlich verwertbar ist, entscheidet der Agent beim Lesen.
- **Kein Nachreichen nach dem Anlegen**: Dokumente nachträglich zu einem bestehenden Feature hinzuzufügen oder zu entfernen, ist nicht Teil dieses Features. Für spontanes Zusatzmaterial existiert weiterhin der bestehende Weg über die Feature-Konsole.
- **Keine Schadcode-Prüfung**: Die Dateien stammen von der Maschine des Nutzers und laufen in dessen eigener Arbeitsumgebung; eine Virenprüfung findet nicht statt.
- **Aufbewahrung**: Dokumente werden zusammen mit den übrigen Feature-Artefakten aufbewahrt und nicht automatisch gelöscht, wenn ein Feature archiviert wird.
- **Bestehende Infrastruktur**: Das Toolkit nimmt bereits heute Datei-Uploads entgegen (Bild-Einfügen in die Konsole) und legt Material in der Arbeitsumgebung des Features ab (Jira-Dossier) — beide Wege dienen als Vorbild und müssen nicht neu erfunden werden.
