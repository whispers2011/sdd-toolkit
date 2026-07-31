# Feature Specification: Review-Portal und Läufe-Ansicht — Lesbarkeits-Pass

**Feature Branch**: `feature/review-portal-und-laeufe-sicht-pass`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Vier Beobachtungen aus der Benutzung am 30.07.2026: (1) Rechte Sidebar im Review-Portal ist leer. ReviewPortal.tsx:303-316 rendert AuditSidebar in einer w-80-Spalte. Vermutlich Folge fehlender Verifikationsläufe — dann gehört dort eine Aussage hin, keine leere Spalte. (2) Die Mitte zeigt ohne Dateiauswahl nur „Datei links auswählen." (ReviewPortal.tsx:262). Gewünscht: standardmässig eine Zusammenfassung der Änderungen als Überblick über das Feature. Die Daten liegen im selben summary-Objekt, das den Commits-Tab speist (:270). (3) Der DiffViewer ist schlecht lesbar (Kontrast, Markierungen). (4) Läufe-Ansicht (ExecutionsView.tsx): SOURCE_LABELS:45-50 enthält telemetry: 'von der CLI gemeldet' — ein Halbsatz zwischen drei Einzelwörtern („gemessen", „geparst", „geschätzt"), darum wirkt er fremd. Kürzen, z. B. „gemeldet". WICHTIG: Die Unterscheidung gemeldet <-> vom Toolkit erschlossen ist bewusst gebaut (FR-017/SC-009) und muss erhalten bleiben — sie hat einen Messfehler um Faktor 10 sichtbar gemacht. Nur das Wort kürzen, nicht die Aussage einziehen. Grössen: die Datei benutzt durchgehend text-xs und für Balken w-1/w-1.5/h-1.5, während das Haus-Iconset (icons.tsx) auf h-6 ausgelegt ist. Icons und Zahlen wirken dadurch zu klein. Randbedingungen: Hell- UND Dunkelmodus prüfen. Der Hell-Modus invertiert nur die Skalen zinc/emerald/amber/red/sky — kein indigo verwenden. Prüfung im Browser gehört dazu (Chrome-MCP); sie steht noch aus, weil bei der Erhebung mehrere Agents denselben MCP benutzten. Abnahme: Review-Portal ohne Dateiauswahl zeigt eine Änderungsübersicht; die rechte Spalte sagt etwas, auch wenn es keine Verifikationsläufe gibt; Diff und Läufe-Ansicht sind in beiden Themes lesbar."

## Clarifications

### Session 2026-07-30

- Q: Sechs Bedeutungen stehen heute in teal, violet und purple — Skalen, die der Hellmodus nicht
  invertiert. Wie sollen sie theme-fähig werden? → A: Die Hellmodus-Mechanik wird um teal und
  violet erweitert (Inversion analog zu zinc/emerald/amber/red/sky), und alle fest kodierten
  Farbwerte werden auf die Theme-Variablen umgestellt. Damit bleibt jede heutige Unterscheidung
  farblich erhalten; verboten bleiben nur Skalen, die nicht invertiert werden (insbesondere
  indigo).
- Q: Wie weit reicht die Grössen-Untergrenze, wenn das Diagramm-Modul von mehreren Ansichten
  geteilt wird? → A: Die Untergrenze gilt für die Läufe-Ansicht und für das geteilte
  Diagramm-Modul; die dort mitbetroffenen weiteren Ansichten erben die grösseren Legenden bewusst,
  damit Diagramme überall gleich gross lesen. Die rechte Portal-Spalte behält ihre
  Schriftgrössen und erhält nur Theme- und Kontrastkorrekturen.
- Q: Wie viel zeigt die Änderungsübersicht, wenn ein Feature viele Dateien und Commits hat? → A:
  Die Übersicht ist ein ÜBERBLICK, kein Diff — sie MUSS beschränkt sein und darf nie unbegrenzt
  wachsen. Konkret: eine Kopfzeile mit den Gesamtzahlen (geänderte Dateien, Zeilen +/-, Commits);
  darunter die Dateien nach Änderungsumfang sortiert, nach Paket/Verzeichnis gruppiert, **höchstens
  10 Einträge** und eine Restzeile „+N weitere Dateien"; darunter die Commits als Anzahl plus die
  **drei jüngsten** Betreffzeilen. Die vollständigen Listen bleiben dort, wo sie heute schon sind
  (Dateibaum links, Commits-Reiter) — die Übersicht verweist darauf, statt sie zu duplizieren.
  Massstab aus der Praxis vom 30.07.2026: die Features dieses Tages berührten 14 bis 90 Dateien;
  bei 90 ist eine ungekürzte Liste als „Überblick" wertlos, bei 14 ist die Kürzung folgenlos.
  Sonderfall: berührt ein Feature 0 Dateien, sagt die Übersicht genau das als Satz — das ist ein
  eigener, benennenswerter Zustand und keine leere Fläche.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Beim Öffnen des Review-Portals sofort wissen, worum es geht (Priority: P1)

Als Reviewer öffne ich das Review-Portal eines Features. Ohne eine einzige Datei anzuklicken sehe
ich in der Mitte eine Übersicht der Änderungen: wie viele Dateien betroffen sind, wie viele Zeilen
dazugekommen und weggefallen sind, welche Dateien am stärksten verändert wurden und aus welchen
Commits das Feature besteht. Erst danach entscheide ich, welche Datei ich im Detail lese. Wähle ich
eine Datei, tritt der Diff an die Stelle der Übersicht; hebe ich die Auswahl auf, ist die Übersicht
wieder da.

**Why this priority**: Das ist der eigentliche Einstieg in eine Review-Entscheidung. Heute steht an
der grössten Fläche des Portals der Satz „Datei links auswählen." — der Reviewer muss sich den
Umfang des Features aus der Dateiliste selbst zusammenrechnen, bevor er überhaupt weiss, ob er es
mit drei oder dreissig geänderten Dateien zu tun hat. Die dafür nötigen Daten lädt das Portal heute
schon; sie werden nur nicht gezeigt. Eigenständig wertvoll, unabhängig von allen anderen Stories.

**Independent Test**: Vollständig testbar, indem das Review-Portal eines Features mit mehreren
geänderten Dateien und mehreren Commits geöffnet wird, ohne eine Datei anzuklicken — die Mitte
zeigt Dateizahl, Zeilenbilanz, die grössten Änderungen und die Commits.

**Acceptance Scenarios**:

1. **Given** ein Feature mit geänderten Dateien und mindestens einem Commit, **When** der Reviewer
   das Portal öffnet und keine Datei auswählt, **Then** erscheint in der Mitte eine
   Änderungsübersicht mit Anzahl geänderter Dateien, Summe hinzugefügter und entfernter Zeilen,
   den am stärksten veränderten Dateien und der Liste der Commits.
2. **Given** die angezeigte Änderungsübersicht, **When** der Reviewer eine Datei in der linken
   Liste anklickt, **Then** erscheint deren Diff an derselben Stelle.
3. **Given** eine ausgewählte Datei, **When** der Reviewer zur Übersicht zurückkehrt, **Then**
   erscheint die Änderungsübersicht erneut, ohne dass das Portal neu geladen werden muss.
4. **Given** ein Feature ohne Änderungen gegenüber dem Ziel-Branch, **When** der Reviewer das
   Portal öffnet, **Then** sagt die Mitte ausdrücklich, dass es keine Änderungen gibt, statt eine
   leere Übersicht mit Nullwerten zu zeigen.
5. **Given** ein Feature, dessen Änderungen ausschliesslich Binärdateien betreffen, **When** die
   Übersicht erscheint, **Then** sind diese Dateien als Binärdateien ausgewiesen und nicht als
   „0 Zeilen geändert" dargestellt.
6. **Given** ein Feature mit sehr vielen geänderten Dateien, **When** die Übersicht erscheint,
   **Then** bleibt sie kompakt lesbar (Kennzahlen und die grössten Änderungen zuerst, der Rest
   ohne Bruch des Layouts erreichbar).

---

### User Story 2 - Den Diff in beiden Modi tatsächlich lesen können (Priority: P2)

Als Reviewer lese ich den Diff einer Datei — im Dunkel- wie im Hellmodus. Code, Zeilennummern und
Abschnittsköpfe sind klar vom Hintergrund abgesetzt, hinzugefügte und entfernte Zeilen sind auf
den ersten Blick unterscheidbar, und die Markierung einer Zeile drängt den Code nicht in den
Hintergrund. Wechsle ich das Farbschema, bleibt der Diff lesbar — er behält keinen dunklen
Hintergrund im Hellmodus.

**Why this priority**: Der Diff ist der Gegenstand des Reviews; ist er schwer lesbar, ist das
Portal für seinen Hauptzweck untauglich. Die Fläche des Diffs ist heute an das Farbschema nicht
angebunden, sie ist fest dunkel gesetzt — im Hellmodus steht damit eine schwarze Fläche mitten in
einer hellen Oberfläche. Unabhängig von den übrigen Stories prüfbar und auslieferbar.

**Independent Test**: Vollständig testbar, indem im Portal eine Datei mit hinzugefügten und
entfernten Zeilen geöffnet und in beiden Farbschemata betrachtet wird — Kontrastwerte messbar,
Markierungen sichtbar unterscheidbar.

**Acceptance Scenarios**:

1. **Given** ein geöffneter Datei-Diff im Dunkelmodus, **When** der Reviewer ihn liest, **Then**
   erreicht der Kontrast des Codes gegen seinen Hintergrund mindestens den Wert für lesbaren
   Fliesstext (WCAG AA, 4.5:1), Zeilennummern und Abschnittsköpfe mindestens 3:1.
2. **Given** derselbe Diff im Hellmodus, **When** der Reviewer ihn liest, **Then** gelten dieselben
   Kontrastwerte, und die Diff-Fläche folgt dem hellen Farbschema statt dunkel zu bleiben.
3. **Given** ein Diff mit hinzugefügten und entfernten Zeilen, **When** der Reviewer ihn
   überfliegt, **Then** sind beide Arten in beiden Modi voneinander und von unveränderten Zeilen
   unterscheidbar — und zwar auch ohne Farbwahrnehmung, weil das Vorzeichen der Zeile erhalten
   bleibt.
4. **Given** eine Zeile mit Kommentar oder aktivem Sprung-Ziel, **When** die Zeile hervorgehoben
   wird, **Then** bleibt ihr Text in beiden Modi lesbar, und die Hervorhebung ist als solche
   erkennbar.
5. **Given** der Roh-Diff der Konfliktauflösung und die Log-Ansicht, **When** sie im Hellmodus
   geöffnet werden, **Then** folgen auch sie dem hellen Farbschema — die Behandlung ist im ganzen
   Portal einheitlich.
6. **Given** ein geöffneter Diff, **When** der Nutzer das Farbschema umschaltet, **Then** stellt
   sich der Diff sofort auf das neue Schema um, ohne Neuladen und ohne Verlust der Scroll-Position.

---

### User Story 3 - Die rechte Spalte sagt etwas, auch wenn nichts geprüft wurde (Priority: P3)

Als Reviewer schaue ich in die rechte Spalte des Portals, um zu sehen, was automatisch geprüft
wurde. Gibt es keine Verifikations- oder Audit-Läufe, sagt die Spalte mir genau das — und was es
für meine Entscheidung bedeutet: dass niemand vor mir geprüft hat und mein Urteil das einzige Gate
ist. Ich kann diesen Zustand ausserdem von „wird noch geladen" und von „konnte nicht geladen
werden" unterscheiden.

**Why this priority**: Eine Spalte ohne Aussage ist die schlechteste Variante — der Reviewer weiss
nicht, ob nichts geprüft wurde, ob die Prüfergebnisse noch kommen oder ob die Anzeige defekt ist.
Der Wert liegt in der Unterscheidbarkeit dieser drei Fälle. Der Rest des Portals funktioniert auch
ohne diese Story, sie ist deshalb nachgelagert, aber eigenständig prüfbar.

**Independent Test**: Vollständig testbar, indem das Portal eines Features ohne Agent-Läufe
geöffnet wird — die rechte Spalte trägt eine Aussage samt ihrer Bedeutung für die Entscheidung,
und derselbe Bereich zeigt im Lade- und im Fehlerfall jeweils eine andere Aussage.

**Acceptance Scenarios**:

1. **Given** ein Feature ohne jeden Agent- oder Verifikationslauf, **When** der Reviewer das Portal
   öffnet, **Then** benennt die rechte Spalte diesen Zustand ausdrücklich und sagt, was er für die
   Freigabe-Entscheidung bedeutet.
2. **Given** die Audit-Daten sind noch unterwegs, **When** der Reviewer hinsieht, **Then** ist
   erkennbar, dass geladen wird — und diese Aussage unterscheidet sich von „keine Läufe
   vorhanden".
3. **Given** die Audit-Daten können nicht geladen werden, **When** der Reviewer hinsieht, **Then**
   sagt die Spalte, dass sie nicht geladen werden konnten, und bleibt nicht dauerhaft im
   Lade-Zustand stehen.
4. **Given** ein Feature ohne Kommentare, **When** der Reviewer in den Kommentarbereich der Spalte
   sieht, **Then** ist auch dort erkennbar, dass noch keine Kommentare existieren, statt einer
   leeren Fläche unter einer Überschrift.
5. **Given** ein Feature mit Läufen, deren Urteil nicht auswertbar ist, **When** die Spalte sie
   zeigt, **Then** bleibt erkennbar, dass diese Läufe nicht als bestanden zählen.
6. **Given** die rechte Spalte in beiden Farbschemata, **When** der Reviewer sie betrachtet,
   **Then** sind Aussage und Zustandsanzeigen in beiden Modi lesbar.

---

### User Story 4 - Läufe-Ansicht: knappe Beschriftung, lesbare Grössen, beide Modi (Priority: P4)

Als Nutzer öffne ich die Läufe-Ansicht und lese die Kennzahlen der Läufe, ohne mich vorzubeugen.
Zahlen und Marker sind gross genug, die Herkunftsangaben stehen sprachlich auf einer Ebene
(„gemeldet", „gemessen", „geparst", „geschätzt" statt eines Halbsatzes zwischen drei Wörtern) — und
trotz der kürzeren Beschriftung erkenne ich weiterhin sofort, ob eine Zahl von der CLI gemeldet
oder vom Toolkit erschlossen wurde. Im Hellmodus verschwindet keine Zahl und keine Farbfläche.

**Why this priority**: Beobachtungen an einer bereits funktionierenden Ansicht — Verständlichkeit
und Lesbarkeit, keine fehlende Fähigkeit. Deshalb zuletzt. Die Herkunfts-Unterscheidung selbst ist
dagegen nicht verhandelbar: sie hat einen Messfehler um Faktor 10 sichtbar gemacht und ist als
FR-017/SC-009 der Telemetrie-Spezifikation gesetzt.

**Independent Test**: Vollständig testbar, indem die Läufe-Ansicht mit mindestens zwei Läufen
unterschiedlicher Herkunft in beiden Farbschemata geöffnet wird — Schriftgrössen messbar,
Herkunftsangaben kurz und weiterhin unterscheidbar.

**Acceptance Scenarios**:

1. **Given** ein Lauf, dessen Zahlen von der CLI gemeldet wurden, **When** seine Herkunft
   ausgewiesen wird, **Then** steht dort ein einzelnes Wort („gemeldet"), sprachlich auf derselben
   Ebene wie „gemessen", „geparst" und „geschätzt".
2. **Given** ein gemeldeter und ein vom Toolkit erschlossener Lauf nebeneinander, **When** der
   Nutzer sie vergleicht, **Then** ist ohne Rückfrage erkennbar, welcher welcher ist — die
   Unterscheidung bleibt in beiden Farbschemata bestehen.
3. **Given** die Läufe-Ansicht, **When** der Nutzer sie liest, **Then** liegt kein Text unter der
   kleinen Standardschriftgrösse der Anwendung, und die Kennzahlen eines Laufs stehen darüber.
4. **Given** die grafischen Marker der Ansicht (Balken, Legendenpunkte, Herkunfts- und
   Status-Abzeichen), **When** der Nutzer sie betrachtet, **Then** sind sie gross genug, um Farbe
   und Anteil zu erkennen, und stehen in einem stimmigen Verhältnis zu den Icons der Anwendung.
5. **Given** die Läufe-Ansicht im Hellmodus, **When** der Nutzer sie liest, **Then** sind alle
   Zahlen, Abzeichen, Balken, Diagramme und Legenden lesbar — keine Farbfläche bleibt dunkel und
   keine Schrift verschwindet im hellen Hintergrund.
6. **Given** die aufgeklappte Tabelle der einzelnen Ausführungen mit den grösseren Schriftgrössen,
   **When** der Nutzer sie in der üblichen Fensterbreite liest, **Then** bleiben alle Spalten
   erreichbar und die Werte werden nicht abgeschnitten.
7. **Given** ein Lauf ohne Subagenten oder ohne gemeldeten Betrag, **When** die Ansicht ihn zeigt,
   **Then** bleibt es beim heutigen Verhalten (Strich bzw. gar keine Zeile, keine Ersatzzahl).

---

### Edge Cases

- Was passiert, wenn ein Feature gar keine Änderungen gegenüber dem Ziel-Branch hat? Die Mitte
  muss das aussprechen, nicht eine Übersicht mit Nullwerten anzeigen.
- Was passiert bei einem Feature ohne Commits (z. B. nur ungetrackte Arbeit)? Die Übersicht muss
  den Teil zeigen, der vorliegt, und den fehlenden benennen.
- Wie verhält sich die Übersicht bei Hunderten geänderter Dateien? Kennzahlen und grösste
  Änderungen zuerst; das Layout darf nicht brechen und die Seite nicht seitlich scrollen.
- Wie unterscheidet der Nutzer „keine Verifikationsläufe" von „Läufe werden geladen" und
  „Läufe konnten nicht geladen werden"? Alle drei Fälle brauchen eine eigene Aussage.
- Was passiert, wenn das Farbschema bei geöffnetem Portal umgeschaltet wird? Diff, rechte Spalte
  und Läufe-Ansicht müssen sofort folgen, ohne Neuladen.
- Was passiert mit Farbflächen, die heute an der Hellmodus-Mechanik vorbeigehen? Fest kodierte
  Farbwerte werden auf Theme-Variablen umgestellt; die beiden benutzten, aber nicht invertierten
  Skalen teal und violet werden in die Mechanik aufgenommen. Eine Skala ohne Inversion darf nicht
  verbleiben — insbesondere kein indigo.
- Was passiert, wenn eine Farbfläche nach der Inversion den geforderten Kontrast verfehlt? Dann
  wird ihre Stufe innerhalb derselben Skala angepasst, nicht die Skala gewechselt.
- Wie bleibt die neunspaltige Ausführungstabelle nutzbar, wenn die Schrift grösser wird?
  Spaltenzugriff muss erhalten bleiben (Umbruch oder gezieltes Scrollen), Werte dürfen nicht
  verdeckt werden.

## Requirements *(mandatory)*

### Functional Requirements

**Änderungsübersicht im Review-Portal**

- **FR-001**: Das Review-Portal MUSS ohne ausgewählte Datei eine Übersicht der Änderungen des
  Features anzeigen — an der Stelle, an der heute „Datei links auswählen." steht.
- **FR-002**: Die Änderungsübersicht MUSS mindestens enthalten: Anzahl geänderter Dateien, Summe
  hinzugefügter und entfernter Zeilen, die am stärksten veränderten Dateien mit ihrer jeweiligen
  Zeilenbilanz sowie die Commits des Features mit Kurzbeschreibung und Zeitpunkt.
- **FR-003**: Die Änderungsübersicht MUSS Binärdateien als solche ausweisen und sie nicht als
  Änderung mit null Zeilen darstellen.
- **FR-004**: Das Portal MUSS beim Auswählen einer Datei deren Diff an der Stelle der Übersicht
  anzeigen und dem Nutzer erlauben, ohne Neuladen zur Übersicht zurückzukehren.
- **FR-005**: Das Portal MUSS ein Feature ohne Änderungen gegenüber dem Ziel-Branch ausdrücklich
  als solches benennen.
- **FR-006**: Die Änderungsübersicht MUSS aus den Daten entstehen, die das Portal für Dateiliste
  und Historie ohnehin lädt, und DARF die Anzeige des Portals nicht zusätzlich verzögern.

**Rechte Spalte: Prüfstand mit Aussage**

- **FR-007**: Die rechte Spalte des Portals MUSS in jedem Zustand eine Aussage tragen; sie DARF
  nicht als leere Fläche erscheinen.
- **FR-008**: Liegen keine Agent- oder Verifikationsläufe vor, MUSS die Spalte diesen Zustand
  benennen und seine Bedeutung für die Freigabe-Entscheidung mitteilen.
- **FR-009**: Die Spalte MUSS die Zustände „wird geladen", „keine Läufe vorhanden" und „konnte
  nicht geladen werden" voneinander unterscheidbar darstellen und DARF nicht dauerhaft im
  Lade-Zustand verharren.
- **FR-010**: Der Kommentarbereich der Spalte MUSS erkennbar machen, wenn noch keine Kommentare
  vorliegen.
- **FR-011**: Läufe ohne auswertbares Urteil MÜSSEN weiterhin erkennbar nicht als bestanden
  zählen.

**Lesbarkeit des Diffs**

- **FR-012**: Der Diff MUSS in beiden Farbschemata dem jeweiligen Schema folgen; er DARF keine
  fest gesetzte, schemaunabhängige Hintergrundfarbe behalten.
- **FR-013**: Der Diff MUSS für Code den Kontrast für lesbaren Fliesstext (WCAG AA, 4.5:1) und für
  Zeilennummern sowie Abschnittsköpfe mindestens 3:1 einhalten — in beiden Schemata.
- **FR-014**: Hinzugefügte, entfernte und unveränderte Zeilen MÜSSEN in beiden Schemata
  voneinander unterscheidbar bleiben, und diese Unterscheidung DARF nicht allein auf Farbe
  beruhen.
- **FR-015**: Zeilenmarkierungen (Kommentar-Anker, Sprung-Ziel, Hervorhebung) MÜSSEN erkennbar
  sein, ohne den markierten Text unlesbar zu machen.
- **FR-016**: Der Roh-Diff der Konfliktauflösung und die Log-Ansicht MÜSSEN dieselbe
  Schema-Behandlung erhalten wie der Datei-Diff.

**Läufe-Ansicht: Beschriftung, Grössen, beide Modi**

- **FR-017**: Die Herkunftsangabe für von der CLI gemeldete Zahlen MUSS als einzelnes Wort
  beschriftet sein, sprachlich auf derselben Ebene wie „gemessen", „geparst" und „geschätzt".
- **FR-018**: Das System MUSS die Unterscheidung zwischen gemeldeter und vom Toolkit erschlossener
  Zahl vollständig erhalten (FR-017/SC-009 der Telemetrie-Spezifikation); die Kürzung der
  Beschriftung DARF diese Aussage nicht abschwächen.
- **FR-019**: Die Unterscheidung nach FR-018 MUSS in beiden Farbschemata bestehen bleiben. Sie
  DARF ihr heutiges Farbmittel behalten, sofern dieses in die Hellmodus-Mechanik aufgenommen wird
  (FR-025); eine Skala, die nicht invertiert wird, DARF sie nicht tragen.
- **FR-020**: In der Läufe-Ansicht DARF kein Text unter der kleinen Standardschriftgrösse der
  Anwendung liegen; die Kennzahlen eines Laufs MÜSSEN darüber liegen.
- **FR-021**: Grafische Marker der Läufe-Ansicht (Balken, Legendenpunkte, Herkunfts- und
  Status-Abzeichen) MÜSSEN in ihrer kleineren Ausdehnung mindestens 10 px messen, damit Farbe und
  Anteil erkennbar sind — heute liegen Legendenpunkte und Balken darunter und wirken neben den
  Icons der Anwendung verloren.
- **FR-021a**: FR-020 und FR-021 MÜSSEN auch für die geteilten Diagramm-Bausteine gelten, die die
  Läufe-Ansicht verwendet. Weitere Ansichten, die dieselben Bausteine einsetzen, ÜBERNEHMEN die
  grösseren Schriften und Marker; Diagramme MÜSSEN in allen Ansichten dieselben Grössen zeigen.
- **FR-022**: Die Läufe-Ansicht MUSS bei grösserer Schrift alle Spalten der Ausführungstabelle
  erreichbar halten und DARF Werte nicht abschneiden.
- **FR-023**: Alle Farbflächen und Schriften der Läufe-Ansicht MÜSSEN dem Hellmodus folgen; keine
  Fläche DARF dunkel bleiben und keine Schrift im hellen Hintergrund verschwinden.
- **FR-024**: Die Ansicht MUSS ihr heutiges Verhalten bei fehlenden Werten beibehalten (Strich
  statt Null, keine Zeile ohne Anteil, keine Ersatzschätzung für Beträge).

**Gemeinsame Randbedingungen**

- **FR-025**: Alle Änderungen MÜSSEN die Hellmodus-Mechanik nutzen (Inversion von Farbskalen) und
  DÜRFEN keine Farbmittel verwenden, die dieser Mechanik nicht folgen — insbesondere kein indigo.
  Die Mechanik MUSS dazu um die beiden heute benutzten, aber noch nicht invertierten Skalen teal
  und violet erweitert werden, sodass die Skalen zinc, emerald, amber, red, sky, teal und violet
  zur Verfügung stehen.
- **FR-025a**: Farbflächen und Schriften MÜSSEN ihre Farbe über die Theme-Variablen der Skalen
  beziehen; fest kodierte Farbwerte DÜRFEN nicht verbleiben — auch nicht in Diagrammen,
  Legendenpunkten und den Flächen von Diff-, Editor- und Log-Ansichten.
- **FR-026**: Ein Wechsel des Farbschemas MUSS bei geöffnetem Portal und geöffneter Läufe-Ansicht
  sofort greifen, ohne Neuladen.
- **FR-027**: Beide Ansichten MÜSSEN vor der Abnahme im Browser in Hell- und Dunkelmodus geprüft
  und die Prüfung belegt sein.

### Key Entities

- **Änderungsübersicht**: abgeleitete Sicht auf die bereits geladenen Änderungsdaten eines
  Features — geänderte Dateien mit Zeilenbilanz und Binär-Kennzeichnung, Commits mit
  Kurzbeschreibung und Zeitpunkt. Kein neuer Datenbestand, keine eigene Persistenz.
- **Prüfstand der rechten Spalte**: Zustand der automatischen Prüfung eines Features aus Sicht des
  Reviewers — entweder Läufe mit Urteil, oder „keine Läufe", „wird geladen", „nicht ladbar". Die
  drei letzteren sind Anzeigezustände, keine gespeicherten Daten.
- **Herkunft einer Verbrauchszahl**: bestehende Unterscheidung gemeldet / gemessen / geparst /
  geschätzt. Inhaltlich unverändert; nur ihre Beschriftung und ihre Darstellung in beiden
  Farbschemata sind Gegenstand dieses Features.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Der Reviewer erkennt beim Öffnen des Review-Portals ohne einen einzigen Klick den
  Umfang des Features: Anzahl geänderter Dateien, Zeilenbilanz und Anzahl Commits.
- **SC-002**: Keine der drei Flächen des Portals (Mitte, rechte Spalte, Kommentarbereich) ist in
  irgendeinem Zustand ohne Aussage — geprüft an einem Feature ohne Dateiauswahl, ohne
  Verifikationsläufe und ohne Kommentare.
- **SC-003**: Der Reviewer unterscheidet „keine Verifikationsläufe" von „wird geladen" und „nicht
  ladbar" ohne Rückfrage; die drei Fälle sind je einmal ausgelöst und belegt.
- **SC-004**: Gemessene Kontraste im Diff: Code mindestens 4.5:1, Zeilennummern und
  Abschnittsköpfe mindestens 3:1 — in Hell- und Dunkelmodus, je an einer Datei mit hinzugefügten,
  entfernten und unveränderten Zeilen.
- **SC-005**: Hinzugefügte und entfernte Zeilen sind in beiden Modi auch ohne Farbwahrnehmung
  unterscheidbar (Nachweis: Graustufen-Ansicht der Screenshots).
- **SC-006**: Keine Fläche und keine Schrift des Review-Portals oder der Läufe-Ansicht bleibt im
  Hellmodus dunkel bzw. unlesbar; alle Texte erreichen dort mindestens 4.5:1, alle Farbflächen
  mindestens 3:1 gegen ihren Hintergrund.
- **SC-007**: In der Läufe-Ansicht liegt kein Text unter der kleinen Standardschriftgrösse der
  Anwendung; die Kennzahlen eines Laufs liegen darüber (Nachweis: gemessene Schriftgrössen im
  Browser).
- **SC-008**: Der Nutzer liest an einem Lauf mit einem einzelnen Wort ab, woher dessen Zahl kommt,
  und unterscheidet einen gemeldeten von einem erschlossenen Lauf in beiden Modi ohne Rückfrage
  (Nachweis: zwei Läufe unterschiedlicher Herkunft nebeneinander, je ein Screenshot pro Modus).
- **SC-009**: Die Änderungsübersicht ist sichtbar, sobald Dateiliste und Historie geladen sind —
  ohne einen zusätzlichen Ladevorgang und ohne einen eigenen Lade-Zwischenzustand.
- **SC-010**: Beide Ansichten sind im Browser in Hell- und Dunkelmodus geprüft; die Belege liegen
  dem Review bei.

## Assumptions

- Die Änderungsübersicht speist sich vollständig aus den Daten, die das Portal heute schon lädt
  (geänderte Dateien mit Zeilenbilanz, Commits). Es wird keine neue Datenquelle und keine neue
  Schnittstelle gebraucht.
- „Zusammenfassung der Änderungen" bedeutet eine strukturelle Übersicht (Kennzahlen, grösste
  Änderungen, Commits) — nicht eine erzeugte Prosa-Beschreibung des Inhalts der Änderungen. Diese
  Auslegung folgt dem Hinweis, dass die Daten im selben Objekt liegen, das die Historie speist.
- Rückkehr zur Übersicht heisst: Aufheben der Dateiauswahl über ein sichtbares Bedienelement in
  der linken Dateiliste. Die Tab-Struktur des Portals bleibt unverändert.
- Die Hellmodus-Mechanik selbst (Inversion von Farbskalen) bleibt in ihrer Bauart unangetastet;
  sie wird lediglich um teal und violet erweitert, damit die beiden heute schon benutzten Skalen
  dem Hellmodus folgen. Fest kodierte Farbwerte werden auf die Theme-Variablen umgestellt.
- Die Unterscheidung „gemeldet" gegen „gemessen/geparst/geschätzt" behält ihr heutiges Farbmittel
  (teal), weil dieses nun invertiert wird. Es braucht kein Ersatzmittel wie Rahmen oder
  Schriftgewicht, und die Aussage wird an keiner Stelle abgeschwächt.
- Erweitert wird nur um Skalen, die im UI bereits in Gebrauch sind (teal, violet). Skalen ohne
  heutigen Verwendungszweck werden nicht aufgenommen — indigo bleibt ausgeschlossen.
- Kontrastziel ist WCAG 2.1 AA für Text; für rein grafische Flächen gilt 3:1.
- „Kleine Standardschriftgrösse der Anwendung" ist die im übrigen UI verwendete kleine Grösse;
  darunterliegende Sondergrössen entfallen in der Läufe-Ansicht.
- Die Grössen-Untergrenzen (FR-020, FR-021) gelten für die Läufe-Ansicht und die von ihr genutzten
  geteilten Diagramm-Bausteine. Dass weitere Ansichten diese Bausteine mitbenutzen und deshalb
  ebenfalls grössere Legenden zeigen, ist beabsichtigt und keine Ausweitung des Features.
- Die Schriftgrössen der rechten Portal-Spalte bleiben unverändert; dort sind nur Aussage
  (Story 3), Theme-Treue und Kontrast Gegenstand dieses Features. Ihr enges Spaltenlayout wird
  nicht neu verteilt.
- Für die Browser-Prüfung steht ein Feature mit Diff, Commits und ohne Verifikationsläufe zur
  Verfügung; die Prüfung erfolgt über die Browser-Anbindung und ist gegenüber der Erhebung vom
  30.07.2026 nachzuholen, weil dort mehrere Agents dieselbe Anbindung belegten.
- Ausdrücklich nicht Gegenstand dieses Features: neue Prüf- oder Verifikationsläufe, Änderungen an
  der Freigabe- oder Zurückweisungslogik, Umbau der Tab-Struktur, inhaltliche Änderungen an der
  Verbrauchsmessung selbst.
