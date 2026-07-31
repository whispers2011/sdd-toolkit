# Feature Specification: Emojis als SVG-Icons (Wissensdatenbank & Wissens-Chat)

**Feature Branch**: `feature/emojis-im-projekt-immer-als-svg-icon-hinterlegen`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Alle emojis für die projektspezifische wissensdatenbank oder den wissens-chat sollen als SVG-Icon passend zum design der applikation hinterlegt werden"

## User Scenarios & Testing *(mandatory)*

Betroffen sind die beiden Oberflächen des projektspezifischen Wissens:

- **Die Wissensdatenbank** — die Verwaltung des projektspezifischen Wissens (Bundles, Einträge, Index, Import) sowie deren Aufruf-Punkte (Sidebar je Projekt, Konsolen-Header je Feature) und die Feature-Wissensauswahl.
- **Der Wissens-Chat** — der schwebende Projekt-Chat (Sprechblase, Chat-Panel, Feature-Vorschläge, Statusanzeigen).

Der:die Nutzer:in erlebt heute an diesen Stellen Emoji-Zeichen (z. B. 📚 📦 📄 🗑 💬 💡), die je nach Betriebssystem/Browser unterschiedlich, farbig und stilfremd dargestellt werden und nicht zum reduzierten, dunklen Design der Applikation passen.

### User Story 1 - Wissensdatenbank mit designkonformen SVG-Icons (Priority: P1)

Alle Emoji-Zeichen in der Wissensdatenbank (Aufruf-Icon in Sidebar und Konsolen-Header, Bundle-/Eintrags-Marker, Aktionen wie Bearbeiten/Löschen/Neu-Laden/Hinzufügen, Index-Ansicht, Feature-Wissensauswahl) werden durch SVG-Icons ersetzt, die zum Design der Applikation passen. Bedeutung und Funktion jedes Icons bleiben unverändert.

**Why this priority**: Die Wissensdatenbank ist die inhaltsreichste der beiden Oberflächen und enthält die meisten Emoji-Zeichen sowie die zentralen Einstiegspunkte (Sidebar, Konsolen-Header). Sie liefert bereits allein sichtbaren Wert: ein einheitliches, professionelles Erscheinungsbild an der am häufigsten genutzten Stelle.

**Independent Test**: Die Wissensdatenbank eines Projekts öffnen (Sidebar → Wissens-Icon), Bundles/Einträge anlegen, bearbeiten, löschen, eine Datei importieren, zwischen Baum- und Index-Ansicht wechseln und die Feature-Wissensauswahl öffnen — an keiner dieser Stellen erscheint ein Emoji; alle Symbole werden als designkonforme SVG-Icons dargestellt und behalten ihre bisherige Bedeutung.

**Acceptance Scenarios**:

1. **Given** ein Projekt in der Sidebar, **When** der:die Nutzer:in das Wissen-Aufruf-Icon betrachtet, **Then** ist es ein SVG-Icon im Stil der Applikation (nicht das Emoji 📚) und öffnet weiterhin die Wissensdatenbank.
2. **Given** die geöffnete Wissensdatenbank mit Bundles und Einträgen, **When** die Baum-Ansicht angezeigt wird, **Then** werden Bundle- und Eintrags-Marker (bisher 📦/📄) als SVG-Icons dargestellt, die Bundle und Eintrag visuell klar unterscheidbar machen.
3. **Given** ein Bundle bzw. Eintrag im Hover-Zustand, **When** die Aktions-Buttons (Unter-Bundle hinzufügen, Eintrag hinzufügen, Bearbeiten, Löschen, aus Datei neu laden) erscheinen, **Then** tragen sie SVG-Icons statt Emoji-/Symbolzeichen und ihre Tooltips/Funktionen bleiben unverändert.
4. **Given** die Index-Ansicht und die Feature-Wissensauswahl, **When** sie angezeigt werden, **Then** verwenden auch dort die Bundle-/Eintrags-Marker dieselben SVG-Icons wie die Baum-Ansicht (konsistente Darstellung).
5. **Given** die Wissensdatenbank im dunklen Design der Applikation, **When** die SVG-Icons dargestellt werden, **Then** übernehmen sie die Text-/Akzentfarbe ihres Kontexts (z. B. gedämpft neben Text, Warnfarbe bei destruktiven Aktionen) statt einer festen Emoji-Farbe.

---

### User Story 2 - Wissens-Chat mit designkonformen SVG-Icons (Priority: P2)

Alle Emoji-/Symbolzeichen im Wissens-Chat (Sprechblase zum Öffnen/Schließen, Schließen im Panel, Feature-Vorschlags-Marker, Status „angenommen", Fehler- und Unterbrechungs-Hinweise, „Neue Unterhaltung") werden durch SVG-Icons ersetzt, die zum Design der Applikation passen. Bedeutung und Funktion bleiben unverändert.

**Why this priority**: Der Wissens-Chat ist die zweite betroffene Oberfläche und dauerhaft als schwebende Sprechblase präsent. Sein Erscheinungsbild wirkt unmittelbar auf den Gesamteindruck der App, hängt aber funktional nicht von US1 ab und ist unabhängig umsetz- und testbar.

**Independent Test**: Bei geöffnetem Projekt den Chat über die Sprechblase öffnen und schließen, eine Nachricht senden, einen Feature-Vorschlag samt Status betrachten, einen Fehler-/Unterbrechungs-Hinweis auslösen bzw. ansehen und „Neue Unterhaltung" nutzen — an keiner dieser Stellen erscheint ein Emoji; alle Symbole sind designkonforme SVG-Icons mit unveränderter Bedeutung.

**Acceptance Scenarios**:

1. **Given** ein geöffnetes Projekt, **When** die schwebende Chat-Sprechblase angezeigt wird, **Then** trägt sie ein SVG-Icon (nicht das Emoji 💬) und wechselt beim Öffnen/Schließen zum passenden SVG-Icon (statt ✕).
2. **Given** das geöffnete Chat-Panel, **When** der:die Nutzer:in den Kopf betrachtet, **Then** sind „Neue Unterhaltung" und „Schließen" als SVG-Icons dargestellt und lösen weiterhin dieselben Aktionen aus.
3. **Given** eine Assistenten-Antwort mit Feature-Vorschlag, **When** die Vorschlagskarte angezeigt wird, **Then** werden der Vorschlags-Marker (bisher 💡) und der Status „angenommen" (bisher ✓) als SVG-Icon dargestellt.
4. **Given** eine fehlgeschlagene oder unterbrochene Antwort, **When** der entsprechende Hinweis erscheint, **Then** wird das vorangestellte Zeichen (bisher ⚠ bzw. ⏸) als SVG-Icon in der passenden Statusfarbe dargestellt.

---

### User Story 3 - Einheitliches, zugängliches Icon-System (Priority: P3)

Die eingesetzten SVG-Icons bilden über Wissensdatenbank und Wissens-Chat hinweg ein kohärentes Set (einheitlicher Stil, einheitliche Größenlogik, Farbübernahme aus dem Kontext) und bleiben für Hilfstechnologien zugänglich (verständliche Beschriftung/Tooltip, wo heute vorhanden).

**Why this priority**: Konsistenz und Zugänglichkeit heben das Ergebnis von „Emojis ersetzt" zu „passend zum Design". Baut auf US1 und US2 auf und stellt sicher, dass das Resultat als ein Guss wirkt, statt als lose Sammlung ersetzter Zeichen.

**Independent Test**: Wissensdatenbank und Wissens-Chat nebeneinander betrachten und prüfen, dass gleichartige Bedeutungen dasselbe Icon verwenden, alle Icons einen einheitlichen Stil und eine zur Textzeile passende Größe haben und interaktive Icons weiterhin eine erkennbare Beschriftung/Tooltip besitzen.

**Acceptance Scenarios**:

1. **Given** dieselbe Bedeutung an mehreren Stellen (z. B. „Schließen", „Eintrag/Dokument", „Bundle"), **When** die Oberflächen betrachtet werden, **Then** wird jeweils dasselbe Icon verwendet (keine widersprüchlichen Symbole für dieselbe Bedeutung).
2. **Given** die SVG-Icons im Layout, **When** sie neben Text stehen, **Then** ist ihre Größe an die umgebende Textzeile angepasst und die vertikale Ausrichtung stimmt (keine Sprünge im Layout gegenüber vorher).
3. **Given** ein interaktives Icon, das zuvor einen Tooltip/Titel hatte, **When** der:die Nutzer:in es fokussiert oder mit dem Zeiger darüberfährt, **Then** ist eine verständliche Beschriftung weiterhin verfügbar (für Zeiger- und Hilfstechnologie-Nutzung).
4. **Given** rein dekorative Icons (reine Marker neben Text), **When** die Oberfläche mit Hilfstechnologie gelesen wird, **Then** erzeugen sie kein störendes oder verwirrendes Vorlesen (z. B. kein vorgelesenes Emoji-Wort mehr).

### Edge Cases

- **Zusammengesetzte Zeichen**: Aktionen, die heute Symbol und Emoji kombinieren (z. B. „+📦" für Unter-Bundle, „+📄" für Eintrag), werden zu einer einzigen, klaren SVG-Darstellung zusammengeführt, ohne die Bedeutung „hinzufügen von …" zu verlieren.
- **Statusfarben**: Icons in farbcodierten Kontexten (Erfolg/grün, Info/blau, Warnung/gelb, Fehler/rot) übernehmen die jeweilige Kontextfarbe, statt eine eigene mitzubringen.
- **Animierte/typografische Zeichen**: Der animierte Schreib-Cursor (▍) während einer streamenden Antwort und ein reiner Text-Pfeil (→) am Ende eines Button-Labels sind typografische Elemente, keine Icons; ihr Verhalten bleibt erhalten (siehe Assumptions zur Scope-Abgrenzung).
- **Fehlendes/nicht ladbares Icon**: Kann ein Icon nicht dargestellt werden, bleibt die zugehörige Funktion (Button/Marker) trotzdem bedienbar und erkennbar (kein leerer, unklickbarer Bereich).
- **Neue Emoji in denselben Oberflächen**: Wird künftig an diesen Oberflächen ein neues Zeichen benötigt, existiert ein klarer, wiederverwendbarer Ort/Weg, um es als SVG-Icon zu ergänzen (statt erneut ein Emoji einzustreuen).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS in der Wissensdatenbank (Sidebar-Aufruf, Konsolen-Header-Aufruf, Baum-Ansicht, Index-Ansicht, Editoren-Hinweise und Feature-Wissensauswahl) alle Emoji-Zeichen durch SVG-Icons ersetzen.
- **FR-002**: Das System MUSS im Wissens-Chat (schwebende Sprechblase, Chat-Panel-Kopf, Feature-Vorschlagskarte, Status- und Fehler-/Unterbrechungs-Hinweise) alle Emoji-/als-Icon-verwendeten Symbolzeichen durch SVG-Icons ersetzen.
- **FR-003**: Die SVG-Icons MÜSSEN zum bestehenden Design der Applikation passen (reduziert, monochrom, für dunkle Oberfläche geeignet) und die Farbe aus ihrem jeweiligen Kontext übernehmen, statt eine feste Eigenfarbe mitzubringen.
- **FR-004**: Jedes ersetzte Icon MUSS die bisherige Bedeutung und Funktion exakt beibehalten (z. B. Bundle-Marker, Eintrags-Marker, Bearbeiten, Löschen, Neu-Laden, Hinzufügen, Chat öffnen/schließen, Feature-Vorschlag, angenommen, Warnung, Unterbrechung, neue Unterhaltung).
- **FR-005**: Das System MUSS gleiche Bedeutungen einheitlich abbilden — dieselbe Bedeutung verwendet über beide Oberflächen hinweg dasselbe Icon (ein zentrales, wiederverwendbares Icon-Set/-Katalog).
- **FR-006**: Interaktive Icons (Buttons/Aktionen), die heute eine Beschriftung oder einen Tooltip/Titel tragen, MÜSSEN diese Beschriftung beibehalten, sodass ihre Bedeutung für Zeiger- und Hilfstechnologie-Nutzung erhalten bleibt.
- **FR-007**: Rein dekorative Icons (Marker neben Text ohne eigene Aktion) MÜSSEN so ausgezeichnet sein, dass Hilfstechnologien sie überspringen bzw. nicht verwirrend vorlesen.
- **FR-008**: Die SVG-Icons MÜSSEN in Größe und Ausrichtung zur jeweils umgebenden Textzeile passen, sodass keine Layout-Sprünge gegenüber dem bisherigen Zustand entstehen.
- **FR-009**: Zusammengesetzte Emoji-Symbol-Kombinationen (z. B. „+📦", „+📄") MÜSSEN zu einer einzigen, verständlichen SVG-Darstellung zusammengeführt werden, ohne die Bedeutung zu verlieren.
- **FR-010**: Das System MUSS sicherstellen, dass in Wissensdatenbank und Wissens-Chat nach der Umstellung keine Emoji-Zeichen mehr für Icon-Zwecke verbleiben (vollständige Ersetzung im definierten Scope).
- **FR-011**: Das System SOLL einen klaren, wiederverwendbaren Weg bereitstellen, weitere Icons im selben Stil zu ergänzen, damit künftige Bedürfnisse ohne neue Emoji gedeckt werden können.

### Key Entities *(include if feature involves data)*

- **Icon**: Ein einzelnes, designkonformes SVG-Symbol mit einer definierten Bedeutung (z. B. „Bundle", „Eintrag/Dokument", „Löschen"), das seine Farbe aus dem Kontext übernimmt und in variabler, zur Textzeile passender Größe dargestellt werden kann.
- **Icon-Katalog**: Die zusammenhängende Sammlung aller in Wissensdatenbank und Wissens-Chat verwendeten Icons; zentraler, wiederverwendbarer Ort, der einheitlichen Stil und die Zuordnung Bedeutung → Icon sicherstellt.
- **Icon-Zuordnung (Emoji → Icon)**: Die Abbildung jedes bisher genutzten Emoji-/Symbolzeichens auf sein designkonformes Icon inklusive dessen Bedeutung und Verwendungsort (dient als Nachweis der vollständigen Ersetzung).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In Wissensdatenbank und Wissens-Chat verbleiben 0 Emoji-Zeichen zu Icon-Zwecken — jedes zuvor sichtbare Emoji-/Icon-Symbol ist durch ein SVG-Icon ersetzt.
- **SC-002**: 100 % der bisherigen Funktionen bleiben erhalten: Jede Aktion und jeder Marker, der zuvor durch ein Emoji dargestellt wurde, ist weiterhin vorhanden, bedienbar und trägt dieselbe Bedeutung.
- **SC-003**: Gleiche Bedeutungen verwenden zu 100 % dasselbe Icon (keine zwei unterschiedlichen Symbole für dieselbe Bedeutung über beide Oberflächen hinweg).
- **SC-004**: Alle ersetzten Icons erscheinen einheitlich im Design der Applikation — unabhängig von Betriebssystem/Browser identisch (keine plattformabhängige, farbige Emoji-Darstellung mehr).
- **SC-005**: Alle zuvor mit Tooltip/Beschriftung versehenen interaktiven Icons besitzen weiterhin eine verständliche Beschriftung (100 % erhalten).
- **SC-006**: Das Layout bleibt stabil: Beim Vergleich vorher/nachher entstehen an den betroffenen Stellen keine sichtbaren Ausrichtungs- oder Größensprünge.
- **SC-007**: Eine mit den Oberflächen vertraute Person erkennt jede Icon-Bedeutung ohne zusätzliche Erklärung genauso zuverlässig wie zuvor.

## Assumptions

- **Scope-Abgrenzung „Emoji"**: „Alle emojis" umfasst alle als Icon eingesetzten Emoji- und Symbol-Glyphen in den beiden genannten Oberflächen — konkret die piktografischen Emoji (📚 📦 📄 🗑 💬 💡) **und** die als Icon/Statusmarker genutzten Symbol-Glyphen (✎ Bearbeiten, ✕ Schließen, ⟳ Neu-Laden, ✓ angenommen, ⚠ Warnung, ↺ neue Unterhaltung, ⏸ unterbrochen sowie die Kombinationen +📦/+📄). Ziel ist ein durchgängig einheitliches Erscheinungsbild; einzelne Glyphen zu ersetzen und andere zu belassen würde „passend zum Design" verfehlen.
- **Rein typografische Elemente ausgenommen**: Der animierte Schreib-Cursor (▍) während streamender Antworten und ein Text-Pfeil (→) am Ende eines Button-Labels gelten als Typografie, nicht als Icon, und sind nicht Gegenstand der Ersetzung (können in einem Folge-Feinschliff angepasst werden, wenn gewünscht).
- **Betroffene Oberflächen**: Ausschließlich die projektspezifische Wissensdatenbank und der Wissens-Chat. Emoji in anderen Bereichen der Applikation (z. B. Kanban, Attention-Inbox, Automation-Dial, Review-Portal, Projekt-Einstellungen) sind **nicht** Teil dieses Features.
- **Designstil der Icons**: Reduzierte, monochrome Linien-/Flächen-Icons, die die Textfarbe des Kontexts übernehmen (kompatibel mit dem dunklen Zinc-Farbschema und den bestehenden Akzentfarben Grün/Blau/Gelb/Rot). Es wird kein neues Farbschema und keine neue visuelle Sprache eingeführt.
- **Keine funktionalen Änderungen**: Das Feature ist rein visuell/darstellungsbezogen. Es ändert kein Verhalten, keine Datenmodelle und keine Abläufe von Wissensdatenbank oder Chat — nur die Darstellung der bisherigen Emoji/Symbole.
- **Icon-Quelle**: Die konkrete Herkunft der SVG-Icons (etabliertes Open-Source-Icon-Set vs. eigene) ist eine Implementierungsentscheidung der Planungsphase, solange der einheitliche, designkonforme Stil (monochrom, currentColor, konsistente Strichstärke/Größe) gewahrt bleibt.
- **Lokale Ein-Nutzer-App**: Konsistent mit dem übrigen Toolkit; keine Mehrbenutzer-/Theming-Anforderungen über das bestehende dunkle Design hinaus.

### Dependencies

- Setzt die bestehenden Oberflächen „Projektspezifisches Wissen" (Wissensdatenbank) und den Projekt-/Wissens-Chat voraus; dieses Feature verändert nur deren Darstellung.
- Nutzt das bestehende Design-/Farbsystem der Applikation (dunkles Zinc-Schema mit Akzentfarben) als Referenz für „passend zum Design".
