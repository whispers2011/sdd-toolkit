# Feature Specification: Lebenszyklus-Schritte sichtbar machen

**Feature Branch**: `feature/lebenszyklus-schritte-sichtbar-machen`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Das Toolkit führt an mehreren Stellen fest verdrahtete Schritte aus, die in der Oberfläche nirgends einsehbar sind. Es ist nicht erkennbar, wann ein Worktree angelegt wird und was dabei passiert, wann ein Kontext-Reset erfolgt oder in welcher Reihenfolge die Integration abläuft. Ziel dieses Features: Sichtbarkeit — noch keine Editierbarkeit. Aufgabe: (1) Einen deklarativen Katalog der Kernschritte anlegen (Name, kurze Beschreibung, Zeitpunkt, Ort im Code), in shared/, getypt über die bestehenden Domänen-Unions, damit `pnpm typecheck` bricht, wenn eine Stufe unbeschrieben bleibt — dasselbe Drift-Guard-Muster, das workflowModel.ts schon benutzt. (2) Diese Schritte in der bestehenden Workflow-Übersicht ausklappbar anzeigen: je Stufe die Liste der Schritte mit Beschreibung. Zu erfassende Stufen: Worktree-Anlage, Phasenstart, Phasenende, Integration, Merge. Wichtig: Die Reihenfolge commitWorktree VOR reconcile ist kein Zufall, sondern ein Fix. Ausdrücklich NICHT in diesem Feature: Kommandos editierbar machen, neue Trigger, Stack-Verwaltung. Nur beschreiben und anzeigen."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nachlesen, was das Toolkit an einer Stelle tatsächlich tut (Priority: P1)

Als Nutzer öffne ich die Workflow-Übersicht und klappe an einer Stelle des Ablaufs die Liste der
dort ausgeführten Schritte auf. Ich lese in eigenen Worten, was das Toolkit dort selbst erledigt
— etwa dass beim Anlegen eines Features ein Worktree serialisiert je Repo und Branch entsteht,
dass vor einem Phasenstart der Kontext zurückgesetzt und die Wissens-Präambel angehängt wird,
oder in welcher Reihenfolge die Integration ihre Schritte abarbeitet. Zu jedem Schritt sehe ich
zusätzlich, wann er ausgelöst wird und an welcher Stelle im Code er implementiert ist.

**Why this priority**: Das ist der Kernwunsch. Diese fünf Stellen sind heute nur durch Lesen des
Quellcodes zu verstehen; genau daraus entstanden bereits Fehlannahmen über das Verhalten des
Toolkits. Schon die reine Lesbarkeit liefert eigenständigen Wert, unabhängig von allen weiteren
Stories.

**Independent Test**: Vollständig testbar, indem die Workflow-Übersicht geöffnet und für jede der
fünf Stufen (Worktree-Anlage, Phasenstart, Phasenende, Integration, Merge) die Schrittliste
aufgeklappt wird — jede Stufe zeigt mindestens einen Schritt mit Name und Beschreibung.

**Acceptance Scenarios**:

1. **Given** die geöffnete Workflow-Übersicht, **When** der Nutzer die Stufe „Worktree-Anlage"
   aufklappt, **Then** erscheinen die dort ausgeführten Schritte mit Name und Beschreibung,
   darunter das serialisierte, idempotente Anlegen des Worktrees und das Spiegeln der
   Agent-Konfiguration.
2. **Given** die geöffnete Workflow-Übersicht, **When** der Nutzer die Stufe „Phasenstart"
   aufklappt, **Then** sind Kontext-Reset, Wissens-Präambel, Dokument-Verweise und das Bauen des
   Slash-Kommandos als eigene Schritte lesbar.
3. **Given** die geöffnete Workflow-Übersicht, **When** der Nutzer die Stufe „Phasenende"
   aufklappt, **Then** sind Verbrauchsmessung, Festhalten der Transkript-Grenzen und das erneute
   Zählen der Aufgaben aus `tasks.md` als eigene Schritte lesbar.
4. **Given** die geöffnete Workflow-Übersicht, **When** der Nutzer die Stufe „Integration"
   aufklappt, **Then** erscheint die Schrittfolge in ihrer tatsächlichen Reihenfolge: Worktree
   festschreiben, Zustand mit Git abgleichen, Verify-Kommandos, Review-Gate-Agents, Commit der
   Review-Berichte, Einreihen in die Queue bzw. Warten auf menschliches Review.
5. **Given** die geöffnete Workflow-Übersicht, **When** der Nutzer die Stufe „Merge" aufklappt,
   **Then** erscheinen Rebase auf das Ziel, headless Konfliktauflösung, erneute Verifikation,
   Merge nach eingestellter Strategie und der Abschluss (Session beenden, Worktree entfernen,
   Worktree-Pfad am Feature leeren).
6. **Given** eine aufgeklappte Stufe, **When** der Nutzer sie erneut anklickt, **Then** ist sie
   wieder zugeklappt und die Übersicht so kompakt wie vorher.
7. **Given** ein Projekt ohne ausgewähltes Feature, **When** die Workflow-Übersicht geöffnet wird,
   **Then** sind alle Schrittlisten vollständig einsehbar — die Beschreibungen hängen nicht an
   Laufzeitdaten eines Features.

---

### User Story 2 - Der Katalog veraltet nicht still (Priority: P2)

Als Entwickler erweitere ich das Toolkit um eine neue Phase oder eine neue Integrations-Stufe.
Solange ich für die Erweiterung keinen Katalogeintrag hinterlege, scheitern die statische Prüfung
des Projekts und der Vollständigkeitstest mit einem Hinweis genau auf die fehlende Beschreibung.

**Why this priority**: Ohne diesen Schutz ist die Übersicht nach der ersten Erweiterung wieder
falsch — schlimmer als keine Übersicht, weil sie Vertrauen beansprucht. Der Wert der Story 1
verfällt ohne sie. Sie ist dennoch nachgelagert, weil die Sichtbarkeit auch ohne sie schon nützt.

**Independent Test**: Testbar, indem der Domäne testweise ein Wert hinzugefügt wird (eine Phase
bzw. eine Integrations-Stufe) und geprüft wird, dass sowohl die statische Prüfung als auch der
Vollständigkeitstest fehlschlagen, bis ein Katalogeintrag existiert.

**Acceptance Scenarios**:

1. **Given** eine neue Feature-Phase in der Domäne, **When** die statische Prüfung des Projekts
   läuft, **Then** schlägt sie mit einem Fehler an der Stelle des Katalogs fehl, solange die Phase
   keinen Eintrag hat.
2. **Given** eine neue Integrations-Stufe in der Domäne, **When** die statische Prüfung läuft,
   **Then** schlägt sie am Katalog fehl, solange die Stufe keinen Eintrag hat.
3. **Given** einen Katalogeintrag mit leerem Namen oder leerer Beschreibung, **When** die Tests
   laufen, **Then** schlägt der Vollständigkeitstest fehl.
4. **Given** einen Katalogeintrag, dessen angegebener Ort im Code nicht mehr existiert, **When**
   die Tests laufen, **Then** schlägt der Test mit Nennung des betroffenen Schritts fehl.

---

### User Story 3 - Fragile Reihenfolgen und Nicht-Zuständigkeiten sind festgehalten (Priority: P3)

Als Entwickler lese ich in der Beschreibung eines Schritts nicht nur, *was* passiert, sondern bei
den heiklen Stellen auch *warum genau so* — insbesondere, dass das Festschreiben des Worktrees
zwingend vor dem Abgleich mit Git läuft, weil sonst jede Integration eskaliert. Ebenso lese ich,
was das Toolkit an einer Stelle bewusst *nicht* tut, etwa dass Abhängigkeiten nicht vom Toolkit
installiert werden.

**Why this priority**: Diese beiden Sätze verhindern konkrete, schon eingetretene Rückschritte
(eine „aufgeräumte" Reihenfolge, die jede Integration eskalieren ließ) und eine wiederkehrende
Fehlannahme (das Toolkit richte den Worktree fertig ein). Sie sind Textinhalt und damit
nachgelagert zur bloßen Existenz der Liste.

**Independent Test**: Testbar, indem die Beschreibung des Schritts „Worktree festschreiben" auf
die Begründung der Reihenfolge geprüft wird und die Stufe „Worktree-Anlage" einen ausdrücklichen
Hinweis auf die nicht durch das Toolkit erledigte Installation von Abhängigkeiten enthält.

**Acceptance Scenarios**:

1. **Given** die aufgeklappte Stufe „Integration", **When** der Nutzer den Schritt zum
   Festschreiben des Worktrees liest, **Then** nennt die Beschreibung ausdrücklich, dass dieser
   Schritt vor dem Git-Abgleich stehen MUSS und was andernfalls passiert.
2. **Given** die aufgeklappte Stufe „Worktree-Anlage", **When** der Nutzer sie liest, **Then** ist
   erkennbar, dass das Installieren von Abhängigkeiten Sache des Agents und nicht des Toolkits
   ist.
3. **Given** einen Schritt mit dokumentierter Reihenfolge-Abhängigkeit, **When** die Tests laufen,
   **Then** stellt ein Test sicher, dass dieser Hinweis vorhanden und nicht leer ist.

---

### Edge Cases

- **Im Projekt abgeschaltete Phase**: Die Übersicht zeigt nur aktive Phasen. Die Schritte von
  Phasenstart/Phasenende gelten für jede Phase gleich und erscheinen daher an jeder angezeigten
  Phase; abgeschaltete Phasen erzeugen keine leeren Einträge.
- **Stufe, deren Schritte konfigurationsabhängig entfallen** (z. B. Review-Gate bei
  abgeschalteten Review-Agents, Verify ohne konfigurierte Kommandos): Der Schritt bleibt
  beschrieben und sichtbar; die Beschreibung nennt die Bedingung, unter der er läuft. Die
  Übersicht beschreibt den Ablauf, nicht nur den aktuell konfigurierten Ausschnitt.
- **Veraltender Ort im Code**: Zeilennummern verschieben sich bei jeder Änderung. Der Ort wird
  deshalb als Datei plus benannte Stelle (Funktion/Symbol) angegeben, nicht als Zeilenbereich, und
  ein Test prüft, dass die genannte Datei existiert.
- **Katalog ohne Eintrag für eine Stufe**: Eine Stufe ohne Schritte ist ein Fehler, kein
  Leerzustand — der Vollständigkeitstest schlägt fehl, statt in der Oberfläche „keine Schritte" zu
  zeigen.
- **Sehr lange Beschreibungen**: Beschreibungen sind auf wenige Sätze begrenzt; die Übersicht
  bleibt auch mit allen Stufen aufgeklappt lesbar und ohne horizontales Scrollen bedienbar.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS einen deklarativen Katalog der Kernschritte des Feature-Lebenszyklus
  bereitstellen, der die einzige Quelle der Wahrheit für die Beschreibung dieser Schritte ist.
- **FR-002**: Jeder Katalogeintrag MUSS einen Namen, eine kurze Beschreibung, den Zeitpunkt der
  Ausführung (wodurch der Schritt ausgelöst wird) und den Ort im Code enthalten.
- **FR-003**: Der Katalog MUSS die fünf Lebenszyklus-Stufen Worktree-Anlage, Phasenstart,
  Phasenende, Integration und Merge vollständig abdecken.
- **FR-004**: Die Stufe **Worktree-Anlage** MUSS mindestens beschreiben: das je Repo und Branch
  serialisierte, idempotente Anlegen des Worktrees inklusive Aufräumen verwaister
  Registry-Einträge und Wiederholversuch bei Wettlauf; das Spiegeln der Agent-Konfiguration in
  den Worktree auf jedem Erfolgspfad; sowie ausdrücklich, dass das Installieren von Abhängigkeiten
  nicht vom Toolkit erledigt wird.
- **FR-005**: Die Stufe **Phasenstart** MUSS mindestens beschreiben: den Kontext-Reset gemäß
  eingestellter Strategie, das Anhängen der Wissens-Präambel, die Dokument-Verweise und das Bauen
  des Slash-Kommandos für die Phase.
- **FR-006**: Die Stufe **Phasenende** MUSS mindestens beschreiben: das Messen des Verbrauchs, das
  Festhalten der Transkript-Grenzen und das erneute Zählen der Aufgaben aus `tasks.md`.
- **FR-007**: Die Stufe **Integration** MUSS die Schritte in ihrer tatsächlichen Reihenfolge
  abbilden: Worktree festschreiben, Zustand mit Git abgleichen, Verify-Kommandos ausführen,
  Review-Gate-Agents laufen lassen, Review-Berichte committen, in die Merge-Queue einreihen bzw.
  auf menschliches Review warten.
- **FR-008**: Die Stufe **Merge** MUSS mindestens beschreiben: Rebase auf das Ziel, headless
  Konfliktauflösung mit begrenzten Versuchen, erneute Verifikation nach Konfliktauflösung, den
  Merge nach eingestellter Strategie (fast-forward oder squash) und den Abschluss (Session
  beenden, Worktree entfernen, Worktree-Pfad am Feature leeren).
- **FR-009**: Die Beschreibung des Schritts „Worktree festschreiben" MUSS festhalten, dass er
  zwingend VOR dem Git-Abgleich läuft, und die Folge der umgekehrten Reihenfolge nennen (der
  Branch gilt ohne eigenen Commit als bereits gemergt, wodurch jede Integration eskaliert).
- **FR-010**: Der Katalog MUSS so an das bestehende Domänenmodell gebunden sein, dass eine neue
  Feature-Phase oder eine neue Integrations-Stufe ohne zugehörigen Katalogeintrag die statische
  Prüfung des Projekts (`pnpm typecheck`) an der Stelle des Katalogs zum Scheitern bringt.
- **FR-011**: Das System MUSS Tests bereitstellen, die die Vollständigkeit des Katalogs zur
  Laufzeit prüfen: jede Stufe hat mindestens einen Schritt, jeder Schritt hat nicht-leeren Namen,
  nicht-leere Beschreibung, nicht-leeren Zeitpunkt und nicht-leeren Ort im Code.
- **FR-012**: Der angegebene Ort im Code MUSS als Datei plus benannte Stelle geführt werden, ohne
  Zeilennummern, und ein Test MUSS prüfen, dass die genannte Datei im Repository existiert.
- **FR-013**: Die bestehende Workflow-Übersicht MUSS die Schritte je Stufe an der Stelle anzeigen,
  an der die Stufe im dargestellten Ablauf sitzt (Feature-Anlage, Phasen, Integration, Merge) —
  keine separate, vom Ablauf getrennte Ansicht.
- **FR-014**: Die Schrittlisten MÜSSEN standardmäßig zugeklappt sein und sich je Stufe unabhängig
  auf- und zuklappen lassen, damit die Übersicht ihre bisherige Kompaktheit behält.
- **FR-015**: Die Anzeige MUSS ohne ausgewähltes Feature und ohne zusätzliche Serveranfrage
  vollständig sein — die Beschreibungen sind für alle Projekte identisch.
- **FR-016**: Das Feature DARF das Verhalten des Toolkits nicht verändern: es beschreibt und zeigt
  nur an. Insbesondere werden keine Kommandos editierbar, keine neuen Auslöser eingeführt und
  keine Stack-Verwaltung ergänzt.

### Key Entities

- **Lebenszyklus-Stufe**: Eine der fünf Stellen im Ablauf, an denen das Toolkit fest verdrahtete
  Arbeit erledigt (Worktree-Anlage, Phasenstart, Phasenende, Integration, Merge). Trägt einen
  Titel und einen Einordnungssatz („wann in der Reihenfolge") und bündelt ihre Schritte.
- **Lebenszyklus-Schritt**: Eine einzelne Handlung innerhalb einer Stufe. Attribute: Name, kurze
  Beschreibung, Zeitpunkt/Auslöser, Ort im Code (Datei + benannte Stelle), optional ein Hinweis
  auf eine zwingende Reihenfolge oder eine Bedingung, unter der er entfällt.
- **Katalog**: Die vollständige, geordnete Menge aller Stufen mit ihren Schritten. An das
  bestehende Domänenmodell gebunden, damit Erweiterungen der Domäne nicht unbeschrieben bleiben
  können.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Für alle fünf Stufen ist in der Workflow-Übersicht ohne Öffnen des Quellcodes
  lesbar, was dort passiert — je Stufe mindestens ein Schritt mit Name, Beschreibung, Zeitpunkt
  und Ort im Code.
- **SC-002**: Ein Nutzer erreicht die Schritte einer beliebigen Stufe in höchstens zwei
  Interaktionen (Übersicht öffnen, Stufe aufklappen).
- **SC-003**: 100 % der Werte der abgedeckten Domänen-Aufzählungen (Feature-Phasen,
  Integrations-Stufen) haben einen Katalogeintrag; ein testweise hinzugefügter Wert lässt sowohl
  die statische Prüfung als auch den Vollständigkeitstest fehlschlagen.
- **SC-004**: 100 % der im Katalog genannten Code-Orte verweisen auf existierende Dateien,
  automatisiert geprüft.
- **SC-005**: Die dokumentierte Reihenfolge-Begründung (Festschreiben vor Git-Abgleich) ist in der
  Oberfläche lesbar und durch einen Test gegen Verlust gesichert.
- **SC-006**: Kein bestehendes Verhalten ändert sich: alle vorhandenen Tests bleiben grün, und die
  Workflow-Übersicht lädt ohne zusätzliche Serveranfragen gegenüber heute.
- **SC-007**: Mit allen Stufen zugeklappt bleibt die Workflow-Übersicht so kompakt wie heute
  (keine zusätzliche Höhe außer der Aufklapp-Bedienelemente).

## Assumptions

- **Ort und Typisierung sind vorgegeben**: Der Katalog liegt im gemeinsamen Paket (`shared/`) und
  folgt dem Drift-Guard-Muster des bestehenden Workflow-Modells (`workflowModel.ts`) — beides ist
  Vorgabe der Anforderung, keine offene Entscheidung.
- **Neue Stufen-Aufzählung**: Die fünf Stufen sind selbst keine bestehende Domänen-Aufzählung; sie
  werden mit diesem Feature eingeführt. Der Drift-Guard greift dort, wo bestehende Aufzählungen
  betroffen sind (Feature-Phasen für Phasenstart/-ende, Integrations-Stufen für
  Integration/Merge).
- **Darstellung im Ablauf, nicht als eigene Ansicht**: Die Formulierung „in der bestehenden
  Workflow-Übersicht … je Stufe" wird als Anzeige direkt an den vorhandenen Knoten des
  dargestellten Ablaufs gelesen. Eine separate Übersichtsseite wäre die Alternative, würde aber
  den Bezug „wann passiert das" verlieren.
- **Phasenschritte gelten für alle Phasen gleich**: Phasenstart und Phasenende laufen für jede
  Phase identisch ab; ihre Schritte werden einmal beschrieben und an jeder angezeigten Phase
  dargestellt.
- **Sprache und Stil**: Beschreibungen auf Deutsch, in der Tonalität der bestehenden Übersicht;
  je Schritt ein bis drei Sätze.
- **Aufklappzustand ist flüchtig**: Er wird nicht projekt- oder nutzerbezogen persistiert und
  startet in jeder Sitzung zugeklappt.
- **Keine Laufzeit-Verknüpfung**: Die Schritte werden nicht mit dem aktuellen Fortschritt eines
  Features verknüpft (kein „dieser Schritt läuft gerade") — das ist Beschreibung, nicht
  Statusanzeige, und bleibt außerhalb dieses Features.
- **Bestehende Kurzbeschreibungen der Integrations-Schritte** in der Übersicht bleiben erhalten;
  der Katalog ergänzt die detaillierte Schrittliste und ersetzt sie nicht.
