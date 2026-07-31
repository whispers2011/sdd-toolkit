# Feature Specification: Läufe haben kein Log – Session-Durchläufe protokollieren

**Feature Branch**: `feature/laeufe-haben-kein-log-kein-log-vorhanden`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Das log im menupunkt läufe der einzelnen session durchläufe wird nicht korrekt geschrieben"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log eines Session-Durchlaufs einsehen (Priority: P1)

Als Nutzer der „Läufe"-Ansicht möchte ich zu jedem einzelnen Session-Durchlauf (den
Phasen-Läufen wie specify, clarify, plan, tasks, implement) das zugehörige Log öffnen
können, um im Nachhinein nachzuvollziehen, was der Agent in genau diesem Lauf getan und
ausgegeben hat.

**Why this priority**: Dies ist der Kern des gemeldeten Fehlers. Heute liefert der
„Log"-Button für Session-Durchläufe „Kein Log vorhanden", während er für andere Lauf-Arten
(Verifikation, Review, Konfliktauflösung, Chat) funktioniert. Ohne dieses Log ist der
Audit-Trail der eigentlichen Kernarbeit — der Phasen-Durchläufe — nicht einsehbar, was
den Zweck der „Läufe"-Ansicht (nachvollziehbarer Verlauf pro Lauf) untergräbt.

**Independent Test**: Einen Phasen-Lauf für ein Feature ausführen (z. B. specify), dann in
der „Läufe"-Ansicht die entsprechende Zeile öffnen und „Log" klicken. Das Log zeigt die
Ausgabe genau dieses Laufs statt „Kein Log vorhanden".

**Acceptance Scenarios**:

1. **Given** ein Feature hat einen abgeschlossenen Session-Durchlauf einer Phase, **When**
   der Nutzer in der „Läufe"-Ansicht bei dieser Zeile „Log" klickt, **Then** wird der
   Log-Inhalt dieses Laufs angezeigt (die während des Laufs erzeugte Ausgabe), nicht die
   Meldung „Kein Log vorhanden".
2. **Given** mehrere aufeinanderfolgende Phasen-Läufe desselben Features, **When** der
   Nutzer die Logs zweier verschiedener Läufe öffnet, **Then** zeigt jedes Log nur die
   Ausgabe seines eigenen Laufs und vermischt nicht die Ausgaben mehrerer Läufe.
3. **Given** ein fehlgeschlagener oder abgebrochener Session-Durchlauf, **When** der Nutzer
   dessen „Log" öffnet, **Then** wird die bis zum Abbruch angefallene Ausgabe angezeigt,
   sodass die Fehlerursache nachvollziehbar ist.

---

### User Story 2 - Konsistente Log-Verfügbarkeit über alle Lauf-Arten (Priority: P2)

Als Nutzer erwarte ich, dass der „Log"-Button in der „Läufe"-Ansicht für jede angezeigte
Lauf-Art ein Log liefert und nicht bei einzelnen Arten ohne Erklärung leer bleibt.

**Why this priority**: Verstärkt und generalisiert US1. Ein „Log"-Button, der je nach
Lauf-Art funktioniert oder nicht, wirkt wie ein Defekt und untergräbt das Vertrauen in die
Ansicht. Sekundär gegenüber US1, weil der akute Schmerz konkret bei den Session-Durchläufen
liegt.

**Independent Test**: In der „Läufe"-Ansicht nacheinander für jede vorkommende Lauf-Art
(Phase, Verifikation, Review, Konfliktauflösung, Chat) das Log öffnen und prüfen, dass
jeweils Inhalt erscheint oder eine eindeutige, korrekte Begründung, falls kein Log
existieren kann.

**Acceptance Scenarios**:

1. **Given** Läufe unterschiedlicher Arten in der Ansicht, **When** der Nutzer für jede Art
   das Log öffnet, **Then** liefert jede Art entweder ihren Log-Inhalt oder eine eindeutige
   Begründung, warum (ausnahmsweise) kein Log vorliegt.
2. **Given** ein noch laufender Session-Durchlauf (Status „running"), **When** der Nutzer
   dessen Log öffnet, **Then** wird die bisher angefallene Ausgabe angezeigt (statt einer
   pauschalen Fehlermeldung).

---

### Edge Cases

- **Altbestände**: Session-Durchläufe, die vor dieser Korrektur ausgeführt wurden und für
  die nie ein Log geschrieben wurde, können nicht rückwirkend rekonstruiert werden. Für
  diese muss eine klare, korrekte Meldung erscheinen („kein Log vorhanden"), statt einen
  Fehler vorzutäuschen.
- **Laufender Lauf**: Wird das Log geöffnet, während der Durchlauf noch aktiv ist, muss der
  bis dahin verfügbare Inhalt erscheinen und sich beim erneuten Öffnen aktualisieren.
- **Sehr großes Log**: Ein umfangreicher Durchlauf (z. B. langer implement-Lauf) wird
  vollständig und ungekürzt erfasst und angezeigt (keine Größenbegrenzung); die Ansicht
  muss dabei benutzbar bleiben.
- **Fehlende/entfernte Log-Datei**: Wenn der Speicherort eines eigentlich erwarteten Logs
  nicht auffindbar ist, muss dies als eindeutige Meldung erscheinen, nicht als stiller
  Fehler.
- **Zeichen/Encoding**: Das Log wird aus dem Transkript abgeleitet und von
  Terminal-Steuerzeichen (ANSI/TUI-Redraws) bereinigt, sodass es lesbar bleibt.

## Clarifications

### Session 2026-07-23

- Q: Woraus soll das Log eines Session-Durchlaufs bestehen? → A: Bereinigtes Transkript —
  Prompt, Assistententext und Tool-Aktionen aus dem Claude-Transkript genau dieses Laufs,
  ohne Terminal-Steuerzeichen; dauerhaft und über einen Server-Neustart hinweg abrufbar
  (nicht der rohe Konsolen-Scrollback).
- Q: Wie soll die „Läufe"-Ansicht mit sehr umfangreichen Lauf-Logs umgehen? → A: Vollständig
  und ohne Größenlimit erfassen und anzeigen — konsistent mit den übrigen Lauf-Arten.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Jeder Session-Durchlauf (Phasen-Lauf) MUSS seine während des Laufs erzeugte
  Ausgabe dauerhaft als eigenes Log erfassen — abgeleitet aus dem Claude-Transkript genau
  dieses Laufs —, sodass sie nach Abschluss des Laufs abrufbar ist und einen Server-Neustart
  übersteht.
- **FR-002**: In der „Läufe"-Ansicht MUSS der „Log"-Button eines Session-Durchlaufs den
  Log-Inhalt genau dieses Laufs anzeigen und nicht fälschlich „Kein Log vorhanden" melden,
  wenn ein Log existiert.
- **FR-003**: Das Log eines Laufs MUSS eindeutig einem einzelnen Lauf zugeordnet sein;
  Ausgaben verschiedener Läufe desselben Features DÜRFEN NICHT im selben Log vermischt
  werden.
- **FR-004**: Das System MUSS zwischen „Log existiert und wird angezeigt", „Lauf hat
  (noch) keinen Inhalt" und „kein Log vorhanden (Altbestand/nicht auffindbar)" eindeutig
  unterscheiden und dem Nutzer eine korrekte Meldung anzeigen.
- **FR-005**: Für einen laufenden Session-Durchlauf MUSS der bis dahin verfügbare
  Log-Inhalt abrufbar sein; erneutes Öffnen MUSS den zwischenzeitlich hinzugekommenen
  Inhalt zeigen.
- **FR-006**: Der angezeigte Log-Inhalt MUSS die lesbare Ausgabe des Laufs widerspiegeln
  (Prompt, Assistententext und Tool-Aktionen aus dem Transkript) und MUSS von
  Terminal-Steuerzeichen (ANSI/TUI-Artefakte) bereinigt sein.
- **FR-007**: Die Korrektur MUSS die bereits funktionierende Log-Erfassung anderer
  Lauf-Arten (Verifikation, Review, Konfliktauflösung, Chat) unverändert erhalten.
- **FR-008**: Vorhandene Metriken eines Laufs (Kosten, Tokens, Dauer, Status) MÜSSEN
  unverändert korrekt bleiben; die Log-Erfassung DARF diese nicht verfälschen.
- **FR-009**: Das Log MUSS vollständig und ungekürzt erfasst und angezeigt werden; es DARF
  keine Größenbegrenzung geben, die Ausgabe verwirft (konsistent mit den übrigen
  Lauf-Arten).

### Key Entities *(include if data involved)*

- **Lauf (Execution)**: Ein einzelner Durchlauf, der in der „Läufe"-Ansicht als Zeile
  erscheint. Attribute u. a.: Art (Phase/Verifikation/Review/Konfliktauflösung/Chat),
  zugehörige Phase, Status, Start/Ende, Kosten/Tokens sowie ein zugeordnetes **Log**.
- **Lauf-Log**: Die textuelle Ausgabe eines einzelnen Laufs, die dem Lauf eindeutig
  zugeordnet ist und über die „Läufe"-Ansicht abrufbar ist.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % der neu ausgeführten Session-Durchläufe liefern beim Öffnen ihres
  „Log"-Buttons den Ausgabe-Inhalt dieses Laufs statt „Kein Log vorhanden".
- **SC-002**: Für einen Nutzer ist der Inhalt eines abgeschlossenen Session-Durchlaufs in
  höchstens zwei Klicks aus der „Läufe"-Ansicht einsehbar (Zeile → „Log").
- **SC-003**: In einer Serie aufeinanderfolgender Phasen-Läufe enthält jedes geöffnete Log
  ausschließlich die Ausgabe des eigenen Laufs (0 % Vermischung zwischen Läufen).
- **SC-004**: Für Läufe, deren Log korrekt nicht existiert (Altbestand/nicht auffindbar),
  erscheint in 100 % der Fälle eine korrekte Meldung statt einer irreführenden
  Fehleranzeige.
- **SC-005**: Für alle in der Ansicht angezeigten Lauf-Arten liefert der „Log"-Button ein
  konsistentes Ergebnis (Inhalt oder eindeutige Begründung) — keine Art bleibt ohne
  Erklärung leer.

## Assumptions

- Der gemeldete „Menüpunkt Läufe" bezeichnet die „Läufe"/Executions-Ansicht (Audit-Trail
  aller Agent-/Verify-Läufe); „einzelne Session-Durchläufe" bezeichnet die Phasen-Läufe
  (specify/clarify/plan/tasks/implement), die in der persistenten Feature-Session ausgeführt
  werden.
- Der Log-Inhalt eines Session-Durchlaufs wird aus dem Claude-Transkript genau dieses Laufs
  abgeleitet (Ausschnitt zwischen Start und Abschluss des Laufs), bereinigt von
  Terminal-Steuerzeichen — nicht der rohe Konsolen-Scrollback und nicht der gesamte
  Session-Verlauf.
- Bereits vor dieser Korrektur ausgeführte Session-Durchläufe ohne erfasstes Log werden
  nicht rückwirkend rekonstruiert; für sie ist die Meldung „kein Log vorhanden" korrekt.
- Bestehende Aufbewahrung/Ablage der Logs (analog zu den bereits funktionierenden
  Lauf-Arten) wird beibehalten; es werden keine neuen Aufbewahrungsrichtlinien eingeführt.
- Der Umfang beschränkt sich auf die Erfassung und Anzeige der Logs; Format, Kosten-/
  Token-Messung und übrige Funktionen der „Läufe"-Ansicht bleiben unverändert.
