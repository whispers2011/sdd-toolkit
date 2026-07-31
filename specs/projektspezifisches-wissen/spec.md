# Feature Specification: Projektspezifisches Wissen

**Feature Branch**: `feature/projektspezifisches-wissen`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Pro projekt kann es sein, dass es projektspezifisches wissen gibt, welches für die erstellung von features wichtig ist. Dieses wissen soll pro projekt gemanaged und eingesehen werden können. Das wissen kann auch verschachtelt sein z.B. wir nutzen grundsätzlich folgende 10 Bundles. Jedes bundle soll nur in bestimmten fällen angewandt werden. Es soll nicht immer jeder Context sofort eingelesen werden. Stattdessen hat ein projekt einen projektspezifischen index, welcher aktualisiert wird. Dieser soll automatisch aktualisiert werden wenn neues projektspezifisches wissen hinzufgefügt wird. projektspezifisches wissen kann je nach projekt komplett unterschiedlich sein und muss zu 100% im SDD Toolkit verwaltet werden können."

## Clarifications

### Session 2026-07-22

- Q: Wie wird bestimmt, welches Wissen für ein Feature relevant ist? → A: **Hybrid** — das System schlägt anhand Index/Anwendbarkeit automatisch vor, der Nutzer kann übersteuern.
- Q: Wie wird die Anwendbarkeit eines Bundles/Eintrags erfasst? → A: **Freitext-Beschreibung plus strukturierte Schlagworte/Tags** (beides).
- Q: Woher stammt das verwaltete Wissen? → A: **Im Toolkit neu erfassen UND bestehende Repo-Dateien importieren/referenzieren** können.
- Q: Mit welcher Größenordnung an Wissen pro Projekt ist zu rechnen? → A: **Dutzende** (~10–50 Bundles/Einträge); Baum-/Listenansicht genügt, Suche optional.

## User Scenarios & Testing *(mandatory)*

Zwei Akteure teilen sich dieses Feature:

- **Der Nutzer** (Entwickler:in, der:die das Toolkit bedient) — pflegt und sichtet das projektspezifische Wissen.
- **Die Feature-Session** (die Claude-Session, die die SDD-Phasen specify → plan → implement in einem Feature-Worktree ausführt) — konsumiert das relevante Wissen selektiv während der Feature-Erstellung.

### User Story 1 - Projektspezifisches Wissen verwalten (Priority: P1)

Der Nutzer kann für ein ausgewähltes Projekt projektspezifisches Wissen vollständig innerhalb des Toolkits anlegen, ansehen, bearbeiten und löschen. Das Wissen ist an das jeweilige Projekt gebunden und nur dort sichtbar.

**Why this priority**: Fundament des gesamten Features. Ohne die Möglichkeit, Wissen im Toolkit zu erfassen und einzusehen, kann keine der weiteren Fähigkeiten (Struktur, Index, selektive Nutzung) existieren. Liefert bereits allein Wert: Projektwissen liegt gebündelt an einem Ort statt verstreut.

**Independent Test**: Zu einem Projekt einen Wissenseintrag mit Titel und Inhalt anlegen, ihn in der Liste des Projekts sehen und öffnen, anschließend bearbeiten und löschen — alles ohne Dateien außerhalb des Toolkits anzufassen.

**Acceptance Scenarios**:

1. **Given** ein Projekt ohne Wissen, **When** der Nutzer einen Wissenseintrag mit Titel und Inhalt anlegt, **Then** erscheint dieser in der Wissensliste des Projekts und ist zum Ansehen öffenbar.
2. **Given** ein bestehender Wissenseintrag, **When** der Nutzer den Inhalt ändert und speichert, **Then** wird der aktualisierte Inhalt angezeigt und bleibt über Toolkit-Neustarts erhalten.
3. **Given** ein bestehender Wissenseintrag, **When** der Nutzer ihn löscht, **Then** erscheint er nicht mehr in der Liste.
4. **Given** zwei verschiedene Projekte A und B, **When** der Nutzer Wissen zu Projekt A hinzufügt, **Then** ist dieses Wissen unter Projekt B nicht sichtbar.

---

### User Story 2 - Verschachtelte Wissens-Bundles mit Anwendbarkeit (Priority: P2)

Wissen kann hierarchisch in Bundles/Gruppen organisiert werden (Bundles können Einträge und weitere Unter-Bundles enthalten). Jedes Bundle bzw. jeder Eintrag trägt eine Beschreibung seiner **Anwendbarkeit** — also in welchen Fällen es angewandt werden soll.

**Why this priority**: Das beschriebene Wissen ist von Natur aus verschachtelt ("wir nutzen grundsätzlich folgende 10 Bundles") und bedingt ("jedes Bundle soll nur in bestimmten Fällen angewandt werden"). Struktur plus Anwendbarkeit sind die Voraussetzung dafür, dass Wissen später überhaupt selektiv genutzt werden kann.

**Independent Test**: Ein Bundle mit mehreren verschachtelten Einträgen anlegen, ihm eine Anwendbarkeits-Beschreibung geben und prüfen, dass Hierarchie und Anwendbarkeit korrekt dargestellt und dauerhaft gespeichert werden.

**Acceptance Scenarios**:

1. **Given** ein Projekt, **When** der Nutzer ein Bundle anlegt und mehrere Wissenseinträge darunter einordnet, **Then** erscheinen die Einträge verschachtelt unter dem Bundle.
2. **Given** ein Bundle, **When** der Nutzer dessen Anwendbarkeit beschreibt (wann es genutzt werden soll), **Then** wird die Anwendbarkeit gespeichert und beim Bundle angezeigt.
3. **Given** ein Bundle innerhalb eines Bundles (mehrstufige Verschachtelung), **When** die Wissensstruktur angezeigt wird, **Then** ist die vollständige Hierarchie erkennbar.
4. **Given** ein bestehendes Bundle, **When** der Nutzer einen Eintrag in ein anderes Bundle verschiebt, **Then** spiegelt die Struktur die neue Zuordnung wider.

---

### User Story 3 - Automatisch gepflegter Projekt-Index (Priority: P3)

Jedes Projekt führt einen Index/eine Übersicht des verfügbaren Wissens (Titel + Anwendbarkeit je Element, ohne die vollständigen Inhalte). Der Index wird **automatisch** aktualisiert, sobald Wissen hinzugefügt, geändert oder entfernt wird — ohne manuellen Schritt.

**Why this priority**: Der Index ist der im Auftrag beschriebene Mechanismus, über den das Toolkit weiß, welches Wissen existiert und wann es anzuwenden ist, ohne alles einlesen zu müssen. Die automatische Aktualisierung sorgt dafür, dass der Index verlässlich mit dem tatsächlichen Wissen übereinstimmt.

**Independent Test**: Einen neuen Wissenseintrag hinzufügen und prüfen, dass der Projekt-Index ihn automatisch abbildet (kein manuelles „Index neu aufbauen"). Den Eintrag entfernen und prüfen, dass der Index die Änderung übernimmt.

**Acceptance Scenarios**:

1. **Given** ein Projekt-Index, **When** der Nutzer einen neuen Wissenseintrag oder ein neues Bundle hinzufügt, **Then** enthält der Index automatisch einen Verweis darauf (Titel + Anwendbarkeit), ohne dass eine manuelle Aktion nötig ist.
2. **Given** ein Projekt-Index, **When** ein Wissenseintrag bearbeitet (Titel/Anwendbarkeit) oder gelöscht wird, **Then** spiegelt der Index die Änderung automatisch wider.
3. **Given** ein Projekt-Index, **When** der Nutzer ihn ansieht, **Then** zeigt er eine kompakte Übersicht allen verfügbaren Wissens samt Anwendbarkeit, ohne die vollständigen Inhalte einzubetten.

---

### User Story 4 - Selektive Nutzung des Wissens bei der Feature-Erstellung (Priority: P4)

Während der Feature-Phasen (specify/plan/implement) wird nur das für das aktuelle Feature relevante Wissen bereitgestellt bzw. eingelesen — auf Basis des Index und der Anwendbarkeit — statt sämtlichen Kontext auf einmal zu laden.

**Why this priority**: Das ist der eigentliche Nutzen, der Wissen und Index rechtfertigt. Er verhindert Kontext-Überladung und stellt sicher, dass Features mit dem passenden Projektwissen erstellt werden. Baut auf Struktur (P2) und Index (P3) auf.

**Independent Test**: Bei einem Projekt mit mehreren Bundles (einige für ein Feature relevant, andere nicht) eine Feature-Session starten und prüfen, dass nur das/die relevanten Bundle(s) herangezogen bzw. vorgeschlagen werden und die unbeteiligten Bundles nicht vollständig geladen werden.

**Acceptance Scenarios**:

1. **Given** ein Projekt mit mehreren Wissens-Bundles samt Anwendbarkeit, **When** an einem Feature gearbeitet wird, dessen Thema zur Anwendbarkeit eines Bundles passt, **Then** wird der Inhalt dieses Bundles der Session bereitgestellt, während nicht passende Bundles nicht vollständig geladen werden.
2. **Given** der Index, **When** die Relevanz bestimmt wird, **Then** stützt sich die Entscheidung zuerst auf Index/Anwendbarkeit, und vollständige Inhalte werden nur für passende Bundles nachgeladen.
3. **Given** der Nutzer ist mit der automatischen Relevanz-Auswahl nicht einverstanden, **When** er für das aktuelle Feature ein Bundle manuell hinzunimmt oder ausschließt, **Then** wird seine Auswahl berücksichtigt.
4. **Given** eine abgeschlossene Feature-Phase, **When** der Nutzer nachsehen will, welches Wissen einbezogen wurde, **Then** ist ersichtlich, welche Bundles/Einträge geladen bzw. angewandt wurden.

### Edge Cases

- **Index inkonsistent zum Wissen** (z. B. Aktualisierung unterbrochen): Das System erkennt die Abweichung und bietet eine Re-Synchronisation / einen Neuaufbau des Index an.
- **Bundle ohne Anwendbarkeit**: Ein Eintrag/Bundle ohne Anwendbarkeits-Beschreibung wird nicht automatisch geladen, bleibt aber für die manuelle Aufnahme verfügbar und wird sichtbar als „Anwendbarkeit fehlt" markiert.
- **Tiefe Verschachtelung**: Sehr tief verschachtelte Bundles bleiben darstellbar; es wird keine künstliche Tiefengrenze erzwungen, solange die Darstellung nutzbar bleibt.
- **Umfangreiche Wissensbasis**: Auch bei vielen Bundles/Einträgen bleibt der Index kompakt und die Übersicht handhabbar.
- **Gleiche Titel**: Zwei Einträge mit identischem Titel im selben Projekt sind zulässig, werden aber eindeutig unterscheidbar dargestellt.
- **Gleichzeitige Änderungen**: Wird dasselbe Projektwissen aus zwei Feature-Worktrees/Sessions parallel geändert, bleibt der Wissensbestand konsistent und keine Änderung geht unbemerkt verloren.
- **Kein relevantes Wissen**: Passt zu einem Feature kein Bundle, wird korrekt „kein relevantes Projektwissen" bereitgestellt, statt fälschlich alles zu laden.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS es dem Nutzer ermöglichen, projektspezifisches Wissen vollständig innerhalb des Toolkits anzulegen, anzusehen, zu bearbeiten und zu löschen (kein Bearbeiten von Dateien außerhalb des Toolkits erforderlich).
- **FR-002**: Das System MUSS Wissen einem konkreten Projekt zuordnen (scopen), sodass Wissen eines Projekts nicht bei einem anderen Projekt erscheint.
- **FR-003**: Das System MUSS erlauben, Wissen hierarchisch zu organisieren (verschachtelte Bundles/Gruppen, die Einträge und/oder Unter-Bundles enthalten).
- **FR-004**: Das System MUSS es ermöglichen, für jedes Bundle bzw. jeden Eintrag eine Anwendbarkeit zu hinterlegen — bestehend aus einer Freitext-Beschreibung ("in welchen Fällen anwenden") **und** optionalen strukturierten Schlagworten/Tags. Beide Bestandteile dienen als Grundlage der Relevanz-Entscheidung.
- **FR-005**: Das System MUSS pro Projekt einen Index führen, der das verfügbare Wissen auflistet — mindestens mit Titel/Kennung und Anwendbarkeit je Element — ohne die vollständigen Inhalte einzubetten.
- **FR-006**: Das System MUSS den Projekt-Index automatisch aktualisieren, sobald Wissen hinzugefügt, bearbeitet oder entfernt wird — ohne dass der Nutzer einen manuellen Neuaufbau anstoßen muss.
- **FR-007**: Das System MUSS Index und Wissen im Toolkit einsehbar und durchsuchbar/navigierbar machen.
- **FR-008**: Das System MUSS selektives Laden unterstützen, sodass nicht der gesamte Wissensinhalt auf einmal eingelesen wird; vollständige Inhalte werden nur für als relevant eingestufte Elemente geladen.
- **FR-009**: Während der Feature-Phasen MUSS das System anhand von Index und Anwendbarkeit bestimmen, welches Wissen relevant ist, und (nur) dieses Wissen der arbeitenden Session bereitstellen.
- **FR-010**: Das System MUSS dem Nutzer erlauben, die Relevanz-Auswahl zu übersteuern (einzelnes Wissen für das aktuelle Feature manuell aufzunehmen oder auszuschließen).
- **FR-011**: Das System MUSS Wissen und Index dauerhaft speichern, sodass sie über Toolkit-Neustarts hinweg und über alle Feature-Worktrees/Sessions eines Projekts hinweg verfügbar sind.
- **FR-012**: Das System MUSS beliebig unterschiedliches Wissen je Projekt zulassen (kein festes/globales Inhalts-Schema wird dem Wissen aufgezwungen).
- **FR-013**: Das System MUSS den Index konsistent zum tatsächlichen Wissen halten; wird eine Inkonsistenz erkannt, MUSS das System eine Re-Synchronisation ermöglichen.
- **FR-014**: Das System MUSS für das aktuelle Feature/die Session erkennbar machen, welches Wissen geladen bzw. angewandt wurde (Transparenz darüber, welcher Kontext die Arbeit beeinflusst hat).
- **FR-015**: Das System MUSS neben dem Neu-Erfassen im Toolkit auch das Importieren bzw. Referenzieren bestehender Dateien aus dem Projekt-Repository als Wissen ermöglichen. Importiertes/referenziertes Wissen MUSS anschließend wie im Toolkit erfasstes Wissen verwaltet und im Index berücksichtigt werden.

### Key Entities *(include if feature involves data)*

- **Projekt**: Isolationseinheit im Toolkit; besitzt sein eigenes Wissen und seinen eigenen Index. Bereits vorhandenes Konzept, das dieses Feature erweitert.
- **Wissenseintrag**: Eine einzelne Einheit projektspezifischen Wissens (Titel, Inhalt, Anwendbarkeit). Der Inhalt ist entweder im Toolkit erfasst oder ein Import/Verweis auf eine bestehende Repo-Datei. Gehört zu genau einem Projekt und optional zu einem Bundle.
- **Wissens-Bundle**: Benannte Gruppe, die Wissenseinträge und/oder weitere Bundles enthalten kann; trägt eine Anwendbarkeit. Ermöglicht Verschachtelung.
- **Anwendbarkeit**: Angabe, wann ein Bundle/Eintrag angewandt werden soll — bestehend aus einer Freitext-Beschreibung und optionalen strukturierten Schlagworten/Tags. Grundlage für die selektive Relevanz-Entscheidung.
- **Projekt-Index**: Automatisch gepflegte, kompakte Übersicht pro Projekt, die auf das verfügbare Wissen verweist (Titel + Anwendbarkeit) und die selektive Relevanz-Entscheidung trägt; enthält nicht die vollständigen Inhalte.
- **Feature-Wissensauswahl**: Die Menge des für ein konkretes Feature als relevant bestimmten bzw. vom Nutzer gewählten Wissens, inklusive manueller Übersteuerungen.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Fügt der Nutzer ein neues Stück projektspezifisches Wissen hinzu, ist es unmittelbar (ohne manuellen Index-Neuaufbau) im Projekt-Index sichtbar — spürbar innerhalb weniger Sekunden.
- **SC-002**: 100 % des projektspezifischen Wissens lassen sich anlegen, ansehen, bearbeiten und löschen, ohne Dateien außerhalb des Toolkits zu bearbeiten.
- **SC-003**: Beim Start einer Feature-Arbeit wird nur das relevante Wissen vollständig geladen: Bei einem Projekt mit N Bundles, von denen k anwendbar sind, werden höchstens die k passenden Bundles inhaltlich geladen; nicht passende Bundles bleiben ungeladen.
- **SC-004**: Wissen eines Projekts erscheint niemals bei einem anderen Projekt (0 projektübergreifende Vermischung).
- **SC-005**: Nach jeder Hinzufügen-/Bearbeiten-/Löschen-Operation stimmt der Index in 100 % der Fälle mit dem tatsächlichen Wissensbestand überein.
- **SC-006**: Der Nutzer kann jeden gespeicherten Wissenseintrag eines Projekts in wenigen Klicks (unter ~30 Sekunden) auffinden und ansehen.
- **SC-007**: Nach jeder Feature-Phase kann der Nutzer nachvollziehen, welche Bundles/Einträge einbezogen wurden — für 100 % der Sessions ist die angewandte Wissensauswahl einsehbar.
- **SC-008**: Eine Person, die das Feature erstmals nutzt, kann ohne zusätzliche Dokumentation ein Bundle mit verschachtelten Einträgen und Anwendbarkeit anlegen (typischerweise in unter 5 Minuten).

## Assumptions

- Der primäre Konsument des „relevanten Wissens" während der Feature-Erstellung ist die Claude-/Agent-Session, die die SDD-Phasen im Feature-Worktree ausführt; der menschliche Nutzer kann das Wissen ebenfalls einsehen.
- Die Relevanz wird **hybrid** bestimmt: automatisch vorgeschlagen (auf Basis von Index/Anwendbarkeit) und vom Nutzer übersteuerbar (siehe Clarifications 2026-07-22). Dies passt zum Automation-Dial des Toolkits (Level 2 ↔ 3).
- Wissenseinträge sind primär frei formulierte Text-/Markdown-Dokumente mit Metadaten (Titel, Anwendbarkeit); das Toolkit erzwingt kein festes Inhalts-Schema für den Inhalt (unterstützt „je Projekt komplett unterschiedlich"). Die Anwendbarkeit besteht aus Freitext plus optionalen Tags (siehe Clarifications 2026-07-22).
- „Automatische Index-Aktualisierung" wird durch jede Anlegen-/Bearbeiten-/Löschen-/Verschieben-/Import-Aktion von Wissen ausgelöst, die innerhalb des Toolkits erfolgt. Das kontinuierliche Überwachen extern (außerhalb des Toolkits) geänderter referenzierter Dateien ist für v1 außerhalb des Scopes; abgedriftete Referenzen werden über die Re-Synchronisation (FR-013) abgefangen.
- Erwartete Größenordnung: Dutzende Bundles/Einträge pro Projekt (~10–50, siehe Clarifications 2026-07-22). Baum-/Listenansicht genügt; Volltext-Suche/Filter sind wünschenswert, aber für diese Größenordnung optional.
- Wissen und Index werden auf Projektebene gespeichert und über alle Feature-Worktrees desselben Projekts geteilt (nicht pro Worktree isoliert).
- Bundles ohne Anwendbarkeits-Beschreibung werden nicht automatisch für das Laden ausgewählt, bleiben aber für die manuelle Aufnahme verfügbar (Standard, um Über-Laden zu vermeiden).
- Zugriffskontrolle / Mehrbenutzer-Berechtigungen sind außerhalb des Scopes (lokale Ein-Nutzer-App, konsistent mit dem lokalen Charakter des Toolkits).
- Versionierung/Historie von Wissensänderungen ist für v1 außerhalb des Scopes.
- Es wird keine künstliche Grenze der Verschachtelungstiefe erzwungen, solange die Darstellung nutzbar bleibt.

### Dependencies

- Setzt das bestehende Projekt-Modell voraus (Projekte werden bereits über die Sidebar des Toolkits verwaltet).
- Setzt den bestehenden SDD-Phasen-Workflow (specify/plan/implement in Feature-Worktrees mit Claude-Session) voraus, in den die selektive Wissensbereitstellung eingehängt wird.
