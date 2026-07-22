# Feature Specification: Features im Auto-Modus

**Feature Branch**: `feature/features-sollen-im-auto-mode-laufen`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Aktuell laufen features die neu erstellt werden nicht im auto mode. Dadurch entstehen teilweise rückfragen, ob ein bestimmter command ausgeführt werden darf. Der mode soll oben rechts über die einstellungen umstellbar sein. Auch sollen tauchen solche rückfragen zu den tools ob claude access haben darf nicht im 'braucht dich' tab auf."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Neue Features laufen ohne Kommando-Rückfragen (Priority: P1)

Wenn ein Nutzer ein neues Feature anlegt, arbeitet der Agent seine Phasen (specify → clarify → plan → tasks → implement) durch, **ohne** bei einzelnen Werkzeug- oder Kommando-Aufrufen anzuhalten und um Erlaubnis zu fragen. Das Feature startet standardmäßig im **Auto-Modus**: Berechtigungen für Tool-/Kommando-Nutzung werden automatisch erteilt.

**Why this priority**: Das ist der Kern der Beschwerde. Die ständigen „Darf ich dieses Kommando ausführen?"-Rückfragen unterbrechen den unbeaufsichtigten Ablauf und untergraben das Produktversprechen „Monitoring by exception" (Level 2/3 Autonomie). Ohne diese Änderung liefert das Tool seinen zentralen Nutzen nicht.

**Independent Test**: Ein neues Feature anlegen und einen vollständigen Durchlauf specify → implement starten. Erfolgreich, wenn der Agent keine einzige Kommando-/Tool-Berechtigungsrückfrage auslöst und die Phasen ohne menschlichen Eingriff für Berechtigungen durchlaufen.

**Acceptance Scenarios**:

1. **Given** der Auto-Modus ist (per Default) aktiv, **When** ein neues Feature angelegt und dessen Session gestartet wird, **Then** führt der Agent Kommandos und Werkzeuge aus, ohne für einzelne Aufrufe eine Berechtigung anzufordern.
2. **Given** ein Feature läuft im Auto-Modus, **When** der Agent ein Kommando ausführen möchte, das sonst eine Rückfrage ausgelöst hätte, **Then** wird das Kommando ausgeführt und die Session pausiert nicht.

---

### User Story 2 - Auto-Modus oben rechts umschalten (Priority: P2)

Ein Nutzer kann den Auto-Modus über die Einstellungen oben rechts (Automation-Bereich) ein- und ausschalten. Der aktuelle Zustand ist dort erkennbar. Die Einstellung wird gespeichert und gilt für neu gestartete Feature-Sessions.

**Why this priority**: Kontrolle und Vertrauen. Nicht jeder Nutzer will dauerhaft vollautomatisch arbeiten; wer den Modus abschalten will (z. B. für ein heikles Projekt), muss das an einer sichtbaren, zentralen Stelle tun können — konsistent mit dem bestehenden Automation-Dial.

**Independent Test**: Den Auto-Modus-Schalter oben rechts betätigen, App neu laden — der gewählte Zustand ist erhalten. Bei „aus" fragt ein neu gestartetes Feature wieder nach Berechtigungen (in seiner eigenen Konsole), bei „an" nicht.

**Acceptance Scenarios**:

1. **Given** die Einstellungen oben rechts sind geöffnet, **When** der Nutzer den Auto-Modus umschaltet, **Then** wird der neue Zustand sofort angezeigt und dauerhaft gespeichert.
2. **Given** der Auto-Modus wurde auf „aus" gestellt, **When** ein neues Feature gestartet wird, **Then** verhält es sich wie bisher (Berechtigungsrückfragen sind wieder möglich).
3. **Given** der Auto-Modus wurde auf „an" gestellt, **When** ein neues Feature gestartet wird, **Then** treten keine Kommando-/Tool-Berechtigungsrückfragen auf.

---

### User Story 3 - Berechtigungs-Rückfragen verstopfen die „Braucht dich"-Inbox nicht (Priority: P3)

Rückfragen dazu, ob der Agent Zugriff auf ein Werkzeug bzw. ein Kommando erhalten darf, erscheinen **nicht mehr** als Einträge in der „Braucht dich"-Inbox. Die Inbox bleibt dem vorbehalten, was echte menschliche Aufmerksamkeit braucht (offene Agent-Fragen, fehlgeschlagene Verifikation, eskalierte Merge-Konflikte, Fehler).

**Why this priority**: Signal-Qualität der Exception-Inbox. Selbst wenn eine Berechtigungsrückfrage entsteht (etwa bei ausgeschaltetem Auto-Modus), soll sie die Inbox nicht als Rauschen füllen — die Inbox ist das Frühwarnsystem und verliert Wert, wenn sie mit trivialen Tool-Zugriffs-Prompts überläuft.

**Independent Test**: Eine Situation erzeugen, in der ein Agent nach einer Tool-/Kommando-Berechtigung fragt. Erfolgreich, wenn dafür **kein** Eintrag in der „Braucht dich"-Inbox erscheint, während echte Agent-Fragen und Eskalationen weiterhin auftauchen.

**Acceptance Scenarios**:

1. **Given** ein Agent fragt nach einer Tool-/Kommando-Berechtigung, **When** die „Braucht dich"-Inbox betrachtet wird, **Then** enthält sie dafür keinen Eintrag.
2. **Given** ein Agent stellt eine inhaltliche Frage oder eine Verifikation schlägt fehl, **When** die „Braucht dich"-Inbox betrachtet wird, **Then** erscheinen diese Einträge weiterhin wie bisher.

---

### Edge Cases

- **Auto-Modus aus + Berechtigung nötig**: Der Agent pausiert in seiner **eigenen Feature-Konsole** und wartet dort auf die Antwort; der Session-Status zeigt „wartet auf Eingabe", aber es entsteht kein Inbox-Eintrag. (Der Nutzer findet die Rückfrage über die Konsole, nicht über die Inbox.)
- **Umschalten während eine Session läuft**: Bereits laufende Feature-Sessions behalten den Modus, mit dem sie gestartet wurden; die geänderte Einstellung greift für neu gestartete Sessions. Der Effekt der Änderung muss für den Nutzer nachvollziehbar sein (kein stiller Widerspruch zwischen Anzeige und Verhalten einer laufenden Session).
- **Projekt-/Feature-Override**: Ist der Auto-Modus global „an", aber für ein einzelnes Projekt/Feature „aus" (oder umgekehrt), gilt die spezifischere Einstellung — konsistent mit der bestehenden Automation-Auflösung (global → Projekt → Feature).
- **Headless-Läufe** (Review-Agents, Konfliktauflösung im Worktree) sind von dieser Änderung unberührt; sie arbeiten weiterhin isoliert im Worktree.
- **Brownfield-Import**: Bestehende, importierte Features erben den globalen Auto-Modus-Zustand beim nächsten Session-Start.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Neu angelegte Features MÜSSEN standardmäßig im Auto-Modus starten, sodass der Agent Werkzeug- und Kommando-Aufrufe ohne einzelne Berechtigungsrückfrage ausführt.
- **FR-002**: Das System MUSS einen Auto-Modus-Schalter in den Einstellungen oben rechts (im bestehenden Automation-Bereich) bereitstellen, der den aktuellen Zustand sichtbar macht.
- **FR-003**: Der Auto-Modus-Zustand MUSS dauerhaft gespeichert werden und über Neuladen/Neustart der App erhalten bleiben.
- **FR-004**: Bei aktivem Auto-Modus MUSS eine Feature-Session so laufen, dass Tool-/Kommando-Berechtigungen automatisch erteilt werden und die Session dafür nicht pausiert.
- **FR-005**: Berechtigungsrückfragen zu Tool-/Kommando-Zugriff DÜRFEN NICHT als Einträge in der „Braucht dich"-Inbox erscheinen.
- **FR-006**: Andere Aufmerksamkeits-Einträge (inhaltliche Agent-Fragen, Plan-Freigabe, fehlgeschlagene Verifikation, eskalierte Merge-Konflikte, Agent-Fehler) MÜSSEN weiterhin unverändert in der „Braucht dich"-Inbox erscheinen.
- **FR-007**: Bei deaktiviertem Auto-Modus MUSS sich das System wie bisher verhalten, mit der Ausnahme, dass Berechtigungsrückfragen in der jeweiligen Feature-Konsole beantwortet werden und nicht als Inbox-Eintrag auftauchen.
- **FR-008**: Der Auto-Modus MUSS derselben Einstellungs-Hierarchie folgen wie die übrigen Automatisierungen (global → Projekt → Feature), sodass er global umgeschaltet und pro Projekt/Feature überschrieben werden kann.
- **FR-009**: Eine Änderung des Auto-Modus MUSS für neu gestartete Feature-Sessions wirksam werden; das Verhalten bereits laufender Sessions gegenüber dem angezeigten Zustand darf nicht widersprüchlich wirken.

### Key Entities *(include if data involved)*

- **Auto-Modus-Einstellung**: Ein an-/ausschaltbarer Zustand als Teil der Automatisierungs-Einstellungen; auflösbar auf Ebene global, Projekt und Feature; Default „an".
- **Feature-Session**: Die persistente Agent-Konsole pro Feature; startet je nach aufgelöstem Auto-Modus mit oder ohne automatische Berechtigungserteilung.
- **„Braucht dich"-Eintrag (Attention-Item)**: Ein Element der Exception-Inbox; Einträge vom Typ „Tool-/Kommando-Berechtigung" werden dort nicht mehr geführt, andere Typen bleiben erhalten.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ein vollständiger Durchlauf eines neuen Features (specify → implement) mit aktivem Auto-Modus erzeugt **0** Kommando-/Tool-Berechtigungsrückfragen, die den Ablauf unterbrechen.
- **SC-002**: Ein Nutzer kann den Auto-Modus in höchstens 2 Klicks von der Hauptansicht aus (oben rechts) ein- oder ausschalten.
- **SC-003**: Über einen vollständigen Feature-Durchlauf enthält die „Braucht dich"-Inbox **0** Einträge des Typs Tool-/Kommando-Berechtigung.
- **SC-004**: Echte Aufmerksamkeits-Einträge (Fragen, fehlgeschlagene Verifikation, Eskalationen) erscheinen in 100 % der Fälle weiterhin in der Inbox (keine Regression bei den erwünschten Signalen).
- **SC-005**: Der oben rechts angezeigte Auto-Modus-Zustand stimmt zu 100 % mit dem tatsächlichen Verhalten neu gestarteter Feature-Sessions überein.

## Assumptions

- **Auto-Modus ist standardmäßig „an"**, da die Beschwerde ausdrücklich lautet, dass neue Features *nicht* automatisch laufen. Der Schalter erlaubt jederzeit das Deaktivieren.
- Feature-Arbeit läuft in **isolierten git-Worktrees**; automatisches Erteilen von Kommando-/Tool-Berechtigungen ist innerhalb dieses Isolationsmodells vertretbar und deckt sich mit dem Produktziel (Level 2/3 Autonomie).
- „Oben rechts über die Einstellungen" bezeichnet den bestehenden **Automation-Bereich** in der Kopfzeile; der Auto-Modus wird dort als zusätzlicher Schalter integriert, statt eine neue, separate Einstellungsfläche zu schaffen.
- Die Änderung des Modus wirkt auf **neu gestartete** Sessions; bereits laufende Sessions behalten ihren Startmodus (Neustart der Session übernimmt den neuen Zustand).
- Das Entfernen aus der „Braucht dich"-Inbox betrifft **ausschließlich** Tool-/Kommando-Zugriffsrückfragen; frei formulierte inhaltliche Fragen des Agents bleiben Inbox-Einträge.
- **Headless-Läufe** (Review-Agents, Konfliktauflösung) sind nicht betroffen und behalten ihr bisheriges Verhalten.
