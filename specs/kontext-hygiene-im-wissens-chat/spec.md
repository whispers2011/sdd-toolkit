# Feature Specification: Kontext-Hygiene im Wissens-Chat

**Feature Branch**: `feature/kontext-hygiene-im-wissens-chat`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Ein fortgesetzter Wissens-Chat wird pro Turn teurer, und niemand sieht es. Gemessen an einem Verlauf vom 28.07.2026 (16,8 MB, 191 Anfragen, 32'608'759 Tokens): die letzten sechs Turns lesen je ~265'000 Tokens Kontext, um 100–400 Tokens zu erzeugen — ein Verhältnis von etwa 1000 : 1, und der Cache-Read steigt monoton (262'577 -> 265'673 in sechs Turns). Ein „danke, passt\"-Turn kostet dort so viel wie eine echte Aufgabe. Das Werkzeug existiert schon: restart() und die Karte [Chat fortsetzen] / [Neuen Chat starten], die beim Leerlauf-Reap gezeigt wird. Sie wird nur nie angeboten, weil der Auslöser „5 Minuten Leerlauf\" heisst und nicht „der Verlauf ist teuer geworden\". Aufgabe: (1) Denselben Auslöser zusätzlich an die Grösse hängen: übersteigt der Verlauf eine Schwelle oder der Cache-Read je Turn einen Wert, dieselbe Karte anbieten — „Verlauf ist X MB, jeder weitere Turn zahlt ihn mit. Neu starten?\" Verlustfrei, der Verlauf bleibt lesbar. (2) Die Zahl im Chat sichtbar machen: Kontextgrösse und Kosten des letzten Turns. (3) Als Kennzahl das Verhältnis Cache-Read : Output ausweisen — bei ~1000 : 1 ist ein Schnitt fällig. Abnahme: Ein Chat mit grossem Verlauf bietet den Neustart an, ohne dass eine Leerlaufzeit abläuft; die Kosten des letzten Turns sind im Chat sichtbar."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Der teure Verlauf meldet sich selbst (Priority: P1)

Ich arbeite über längere Zeit im Wissens-Chat eines Projekts. Der Verlauf ist gewachsen; jeder
weitere Turn liest ihn vollständig mit. Sobald der Verlauf so gross geworden ist, dass jeder
weitere Turn erkennbar mitzahlt, bietet mir der Chat von selbst die Entscheidung an, mit der ich
schon vom Leerlauf her vertraut bin: weitermachen oder frisch beginnen. Der Hinweis nennt die
Zahl, um die es geht („Verlauf ist 16,8 MB, jeder weitere Turn zahlt ihn mit"). Ich muss keine
Pause machen und nichts von Leerlauf wissen — und ich verliere nichts: entscheide ich mich für
einen frischen Chat, bleibt der bisherige Verlauf erhalten.

**Why this priority**: Das ist der Kern des Features und der eigentliche Sparbeitrag. Das
Werkzeug (Neustart und Entscheidungskarte) existiert bereits vollständig; es fehlt allein der
zweite Auslöser. Schon diese Story allein senkt die Kosten fortgesetzter Chats und ist ohne die
beiden Anzeige-Stories nutzbar.

**Independent Test**: Vollständig testbar, indem ein Wissens-Chat mit einem Verlauf über der
Schwelle (bzw. mit gelesenem Kontext je Turn über dem Wert) einen Turn beendet: die
Entscheidungskarte wird angeboten, obwohl keine Leerlaufzeit abgelaufen ist und die Session
weiterläuft. Der über die Karte ausgelöste Neustart beginnt eine frische Unterhaltung, der
vorherige Verlauf bleibt erhalten.

**Acceptance Scenarios**:

1. **Given** einen Wissens-Chat, dessen Verlauf die Grössenschwelle übersteigt, **When** ein Turn
   endet, **Then** bietet der Chat dieselbe Entscheidung wie beim Leerlauf an — weiterarbeiten
   oder neu starten — und nennt im Hinweistext die tatsächliche Grösse des Verlaufs.
2. **Given** einen Wissens-Chat, dessen letzter Turn mehr gelesenen Kontext verbraucht hat als der
   festgelegte Wert je Turn, **When** dieser Turn endet, **Then** wird dieselbe Entscheidung
   angeboten, auch wenn der Verlauf die Grössenschwelle noch nicht erreicht hat.
3. **Given** ein offenes Angebot zum Neustart, **When** ich „Neuen Chat starten" wähle, **Then**
   beginnt eine frische Unterhaltung mit leerem Kontext, und der bisherige Verlauf ist nicht
   gelöscht.
4. **Given** ein offenes Angebot zum Neustart, **When** ich es ablehne und weiterschreibe,
   **Then** arbeitet die laufende Session unverändert weiter und das Angebot verschwindet, ohne
   meine Eingabe zu blockieren.
5. **Given** einen Wissens-Chat mitten in einem laufenden Turn, dessen Verlauf die Schwelle
   übersteigt, **When** der Turn noch arbeitet, **Then** wird nichts angeboten — das Angebot
   erscheint erst, wenn der Turn beendet ist.
6. **Given** einen frisch gestarteten Wissens-Chat (kurzer Verlauf, geringer Verbrauch), **When**
   mehrere Turns beendet werden, **Then** wird kein Neustart angeboten.
7. **Given** einen Chat, der sowohl wegen Leerlaufs pausiert ist als auch die Grössenschwelle
   übersteigt, **When** ich das Panel öffne, **Then** sehe ich genau eine Entscheidungskarte, und
   ihr Text nennt den zutreffenden Grund (bzw. beide Gründe), nicht zwei konkurrierende Karten.

---

### User Story 2 - Die Kosten des letzten Turns stehen im Chat (Priority: P2)

Während ich im Wissens-Chat arbeite, sehe ich ohne Umweg über eine andere Ansicht, was der
zuletzt beendete Turn gekostet hat: wie viel Kontext dafür gelesen wurde und welcher Betrag dafür
angefallen ist. Damit erkenne ich selbst, dass ein „danke, passt" inzwischen so viel kostet wie
eine echte Aufgabe — und kann von mir aus schneiden, bevor irgendein Auslöser greift.

**Why this priority**: „Niemand sieht es" ist die Ursache des Problems; die Sichtbarkeit ist
ausdrücklicher Teil der Abnahme. Sie wirkt allerdings nur unterstützend — der automatische
Auslöser aus Story 1 spart auch dann, wenn niemand hinsieht. Deshalb nachgelagert.

**Independent Test**: Testbar, indem in einem Wissens-Chat ein Turn beendet wird: unmittelbar
danach stehen Kontextgrösse und Kosten dieses Turns im Chat-Panel, ohne dass eine andere Ansicht
geöffnet werden muss.

**Acceptance Scenarios**:

1. **Given** einen Wissens-Chat, **When** ein Turn beendet wird, **Then** zeigt das Chat-Panel die
   für diesen Turn gelesene Kontextgrösse und die Kosten dieses Turns an.
2. **Given** einen Chat mit mehreren beendeten Turns, **When** ein weiterer Turn endet, **Then**
   beziehen sich die angezeigten Zahlen auf den jeweils zuletzt beendeten Turn.
3. **Given** einen Turn, für den keine Verbrauchsdaten ermittelbar sind, **When** er endet,
   **Then** weist die Anzeige die Zahl als unbekannt aus und behauptet weder null Kosten noch
   null Tokens.
4. **Given** einen frisch gestarteten Chat ohne beendeten Turn, **When** das Panel geöffnet wird,
   **Then** ist die Anzeige leer bzw. als „noch keine Messung" erkennbar und stört die Konsole
   nicht.

---

### User Story 3 - Das Verhältnis gelesener Kontext zu Ausgabe als Kennzahl (Priority: P3)

Neben den absoluten Zahlen sehe ich das Verhältnis von gelesenem Kontext zu erzeugter Ausgabe des
letzten Turns. Bewegt es sich in der Gegend von 1000 : 1, ist die Kennzahl sichtbar als kritisch
markiert: der Chat leistet fast nichts mehr für das, was er zahlt, und ein Schnitt ist fällig.

**Why this priority**: Die Kennzahl macht aus zwei Zahlen ein Urteil und ist die eigentliche
Entscheidungsgrundlage. Sie setzt aber die Messung aus Story 2 voraus und liefert ohne sie keinen
eigenen Wert.

**Independent Test**: Testbar, indem ein Turn mit viel gelesenem Kontext und wenig Ausgabe
beendet wird: das Verhältnis wird ausgewiesen und ab der kritischen Grenze als kritisch markiert;
ein Turn mit ausgewogenem Verhältnis wird nicht markiert.

**Acceptance Scenarios**:

1. **Given** einen beendeten Turn, **When** die Kennzahlen angezeigt werden, **Then** ist das
   Verhältnis gelesener Kontext : erzeugte Ausgabe als eigene Kennzahl lesbar.
2. **Given** einen Turn mit ~265'000 gelesenen Kontext-Tokens und ~300 Ausgabe-Tokens, **When**
   das Verhältnis angezeigt wird, **Then** ist es als kritisch markiert.
3. **Given** einen Turn mit ausgewogenem Verhältnis, **When** das Verhältnis angezeigt wird,
   **Then** ist es sichtbar, aber nicht als kritisch markiert.
4. **Given** einen Turn ohne erzeugte Ausgabe, **When** das Verhältnis gebildet werden soll,
   **Then** zeigt die Anzeige einen definierten Wert statt eines Rechenfehlers oder „unendlich".

---

### Edge Cases

- **Turn läuft noch**: Die Schwelle wird während eines arbeitenden Turns überschritten — es wird
  nichts angeboten, bis der Turn beendet ist. Ein Angebot darf einen laufenden Turn nie abbrechen.
- **Abgelehntes Angebot**: Nach einer Ablehnung wird nicht bei jedem folgenden Turn erneut
  gefragt; erst wenn die auslösende Grösse deutlich weiter gewachsen ist, wird wieder angeboten.
- **Keine Verbrauchsdaten**: Fehlen die Verbrauchsmeldungen (kein gelesener Kontext je Turn
  ermittelbar), bleibt der grössenbasierte Auslöser wirksam; die Verhältnis-Kennzahl wird als
  unbekannt ausgewiesen.
- **Verlaufsgrösse nicht ermittelbar**: Ist die Grösse des Verlaufs nicht feststellbar, greift nur
  der verbrauchsbasierte Auslöser; im Chat erscheint keine Fehlermeldung.
- **Kleiner Chat mit knapper Antwort**: Ein kurzer Chat, in dem ich nur „ok" schreibe, hat
  rechnerisch ein hohes Verhältnis, kostet aber fast nichts — hier darf kein Neustart angeboten
  werden.
- **Direkt nach einem Neustart**: Die frische Unterhaltung startet mit leerer Bewertung und darf
  nicht sofort wieder warnen (auch wenn der vorherige Verlauf gross war).
- **Neustart trifft auf laufende Arbeit oder unbestätigte Änderungen**: Die bestehenden Rückfragen
  bleiben unverändert wirksam; ein über die Kosten ausgelöstes Angebot darf keine unbestätigten
  Änderungen ohne Rückfrage verwerfen.
- **Mehrere Projekte gleichzeitig**: Auslöser und Anzeige gelten je Unterhaltung getrennt; ein
  teurer Chat in Projekt A löst in Projekt B nichts aus.
- **Panel geschlossen**: Wird die Schwelle überschritten, während niemand zusieht, erscheint das
  Angebot beim nächsten Öffnen des Panels und nicht rückwirkend mehrfach.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS nach jedem beendeten Turn eines Wissens-Chats die Grösse des
  Verlaufs sowie den Verbrauch dieses Turns (gelesener Kontext, erzeugte Ausgabe, Kosten) für die
  betroffene Unterhaltung bestimmen.
- **FR-002**: Das System MUSS die bestehende Entscheidung „Chat fortsetzen / Neuen Chat starten"
  zusätzlich dann anbieten, wenn die Grösse des Verlaufs die festgelegte Schwelle übersteigt —
  unabhängig davon, ob eine Leerlaufzeit abgelaufen ist.
- **FR-003**: Das System MUSS dieselbe Entscheidung ebenfalls anbieten, wenn der gelesene Kontext
  eines Turns den festgelegten Wert je Turn übersteigt.
- **FR-004**: Das System MUSS dieselbe Entscheidung ebenfalls anbieten, wenn das Verhältnis
  gelesener Kontext : erzeugte Ausgabe über mehrere aufeinanderfolgende Turns den festgelegten
  Wert übersteigt.
- **FR-005**: Der verhältnisbasierte Auslöser (FR-004) MUSS erst oberhalb eines absoluten
  Mindestverbrauchs je Turn greifen, damit ein günstiger, kurzer Chat mit knapper Antwort keinen
  Neustart angeboten bekommt.
- **FR-006**: Der Hinweistext des Angebots MUSS den konkreten Anlass mit Zahl benennen (etwa
  „Verlauf ist 16,8 MB, jeder weitere Turn zahlt ihn mit").
- **FR-007**: Das System DARF ein Angebot NICHT während eines arbeitenden Turns einblenden;
  Angebote entstehen ausschliesslich an einer Turn-Grenze.
- **FR-008**: Nutzer MÜSSEN das Angebot ablehnen und ohne Unterbrechung weiterarbeiten können; die
  laufende Session bleibt bedienbar, Eingaben in die Konsole gehen nicht verloren.
- **FR-009**: Nach einer Ablehnung MUSS das System dasselbe Angebot unterdrücken, bis die
  auslösende Grösse erneut deutlich gewachsen ist; im selben Turn wird nie erneut angeboten.
- **FR-010**: Der über das Angebot ausgelöste Neustart MUSS verlustfrei sein: der bisherige
  Verlauf wird nicht gelöscht und bleibt lesbar.
- **FR-011**: Der über das Angebot ausgelöste Neustart MUSS die bestehenden Schutzabfragen bei
  laufender Arbeit und bei unbestätigten Änderungen der Arbeitskopie unverändert einhalten.
- **FR-012**: Nach einem Neustart MUSS die Bewertung der frischen Unterhaltung bei null beginnen.
- **FR-013**: Liegt für dieselbe Unterhaltung gleichzeitig ein Leerlauf-Grund und ein Kosten-Grund
  vor, MUSS genau eine Entscheidungskarte erscheinen, deren Text den bzw. die zutreffenden Gründe
  nennt.
- **FR-014**: Das Chat-Panel MUSS die gelesene Kontextgrösse und die Kosten des zuletzt beendeten
  Turns anzeigen, ohne dass eine andere Ansicht geöffnet werden muss.
- **FR-015**: Das Chat-Panel MUSS das Verhältnis gelesener Kontext : erzeugte Ausgabe des zuletzt
  beendeten Turns als eigene Kennzahl ausweisen und ab der kritischen Grenze sichtbar als kritisch
  markieren.
- **FR-016**: Sind Verbrauchs- oder Kostenwerte für einen Turn nicht ermittelbar, MUSS die Anzeige
  sie als unbekannt kennzeichnen und darf keine Null-Werte als Messung darstellen.
- **FR-017**: Auslöser und Anzeige MÜSSEN je Unterhaltung getrennt geführt werden; mehrere
  Projekt-Chats beeinflussen sich nicht.
- **FR-018**: Die Schwellenwerte (Verlaufsgrösse, gelesener Kontext je Turn, kritisches
  Verhältnis, Mindestverbrauch) MÜSSEN an einer Stelle zusammen mit der bestehenden Leerlaufzeit
  festgelegt und dort nachlesbar sein.

### Key Entities

- **Kostenprofil einer Unterhaltung**: Bewertung eines Wissens-Chats zum Zeitpunkt der letzten
  Turn-Grenze — Grösse des Verlaufs, Verbrauch des letzten Turns, Verhältnis-Kennzahl und welche
  Schwelle (wenn überhaupt) überschritten ist. Gehört zu genau einer Unterhaltung.
- **Turn-Verbrauch**: Gelesener Kontext, erzeugte Ausgabe und Kosten eines einzelnen beendeten
  Turns samt Angabe, ob die Werte gemessen oder unbekannt sind.
- **Schwellenwerte**: Die festgelegten Grenzen, ab denen ein Neustart angeboten bzw. die Kennzahl
  als kritisch markiert wird — an einer Stelle definiert, gemeinsam mit der bestehenden
  Leerlaufzeit.
- **Angebots-Zustand**: Ob für eine Unterhaltung aktuell ein Neustart-Angebot offen ist, aus
  welchem Grund, und ab welchem weiteren Wachstum nach einer Ablehnung erneut angeboten wird.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein Wissens-Chat mit einem Verlauf über der Schwelle bietet den Neustart an, ohne
  dass eine Leerlaufzeit abläuft — spätestens an der ersten Turn-Grenze nach Überschreiten der
  Schwelle.
- **SC-002**: Nach jedem beendeten Turn sind Kontextgrösse und Kosten dieses Turns im Chat-Panel
  ohne weiteren Klick und ohne Wechsel der Ansicht ablesbar.
- **SC-003**: Das Verhältnis gelesener Kontext : erzeugte Ausgabe ist für den letzten Turn
  ablesbar und wird ab der kritischen Grenze (Bereich 1000 : 1) als kritisch markiert.
- **SC-004**: Für den gemessenen Referenzfall vom 28.07.2026 (16,8 MB Verlauf, ~265'000 gelesene
  Kontext-Tokens je Turn, 100–400 Ausgabe-Tokens) erscheint das Angebot; für einen frischen Chat
  mit weniger als zehn Turns und kleinem Verlauf erscheint es in keinem Turn.
- **SC-005**: In 100 % der über das Angebot ausgelösten Neustarts bleibt der bisherige Verlauf
  erhalten und lesbar; kein Neustart verwirft unbestätigte Änderungen ohne Rückfrage.
- **SC-006**: Ein abgelehntes Angebot unterbricht die Arbeit nicht: die laufende Session bleibt
  ohne Neustart bedienbar, und im selben Turn erscheint kein zweites Angebot.
- **SC-007**: Ein „danke, passt"-Turn in einem grossen Chat ist als solcher erkennbar — die
  angezeigten Zahlen weisen ihn als so teuer aus wie einen Turn mit echter Arbeit.

## Assumptions

- **Schwellenwerte (Vorschlag, an einer Stelle festgelegt)**: Verlaufsgrösse ab 8 MB; gelesener
  Kontext ab 150'000 Tokens je Turn; Verhältnis ab 300 : 1 über drei aufeinanderfolgende Turns,
  jedoch erst ab 50'000 gelesenen Kontext-Tokens je Turn; kritische Markierung der Kennzahl ab
  1000 : 1. Die Werte orientieren sich am gemessenen Fall vom 28.07.2026 (16,8 MB, ~265'000
  Tokens je Turn, ~1000 : 1) und sollen deutlich vor dessen Eskalation greifen.
- **Darstellung des Angebots**: Bei laufender Session wird die Entscheidung als nicht blockierender
  Hinweis über der Konsole angeboten — gleiche Aktionen und gleicher Wortlaut wie die
  Leerlauf-Karte. Die Konsole bleibt bedienbar, weil hier, anders als beim Leerlauf-Reap, eine
  lebende Session vorliegt und eine blockierende Karte laufende Eingaben zerstören würde.
- **Erneutes Anbieten nach Ablehnung**: Ein abgelehntes Angebot kehrt erst zurück, wenn die
  auslösende Grösse um eine weitere Schwellenstufe gewachsen ist.
- **Messgrundlage**: Der Verbrauch je Chat-Turn wird heute schon an der Turn-Grenze erfasst
  (Verbrauchsmeldungen der CLI, ersatzweise Transkript, ersatzweise Schätzung) — diese Messung
  wird wiederverwendet und nicht ersetzt. Die Grösse des Verlaufs wird an der bereits vorhandenen
  Grösse der Transkript-Ablage der Unterhaltung bemessen.
- **„Verlauf bleibt lesbar"** bedeutet: die vorherige Unterhaltung wird nicht gelöscht und bleibt
  auffindbar — so wie es der bestehende Neustart heute schon handhabt. Eine neue Oberfläche zum
  Durchblättern alter Unterhaltungen ist nicht Teil dieses Features.
- **Keine Einstellungen in der Oberfläche**: Die Schwellenwerte sind feste Werte im Projekt
  (analog zur bestehenden Leerlaufzeit), nicht pro Projekt konfigurierbar.
- **Ausdrücklich nicht in diesem Feature**: automatischer Neustart ohne Zustimmung; Zusammenfassen,
  Kürzen oder Komprimieren eines bestehenden Verlaufs; Änderung der bestehenden Leerlaufzeit oder
  ihres Verhaltens; Kostenanzeigen in anderen Ansichten (dort bereits vorhanden); Anzeige der
  kumulierten Kosten einer ganzen Unterhaltung.
