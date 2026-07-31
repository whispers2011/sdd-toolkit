# Specification Quality Checklist: Ersetzbare Kernschritte, Stack-Profile und Testing-Lane

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-31
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

### Zu „No implementation details" — geprüft, nicht weggewinkt

Die Spezifikation nennt vier Bezeichner wörtlich: `$SDD_PORT_BASE`, `$SDD_PROFILE`,
`awaiting_manual_test` und `manualTestGate`. Das ist bewusst so und **kein** Leck:

- Alle vier sind im Auftrag ausdrücklich vorgegeben und bilden die Schnittstelle zu F1b bzw. zum
  bestehenden Automation-Dial. Sie sind damit Fachvokabular dieses Systems, nicht eine hier
  getroffene Technikwahl.
- Die zwei Variablen sind die vertragliche Zusage an *fremde* Schritte und Agents: ohne ihren
  wörtlichen Namen ist die Anforderung nicht prüfbar.
- Umgekehrt bleibt die Spezifikation frei von der Technik, die man hier erwarten würde: FR-012 legt
  ausdrücklich fest, dass **keine** Container- oder Orchestrierungstechnik vorausgesetzt wird. Die
  Wörter Docker und Compose kommen nicht vor; „Datenablage (Volume)" und „Build-Verzeichnis"
  bezeichnen die zu räumenden Dinge, nicht das Werkzeug.

### Zu „Written for non-technical stakeholders"

Das Produkt ist ein Entwicklerwerkzeug; die Stakeholder sind Entwickler und der Entscheider vor dem
Merge. Der Text beschreibt Anliegen und Ergebnisse in ihrer Sprache (Ports, Stack, Worktree), ohne
Code, Dateipfade oder Signaturen aus der Umsetzung.

### Bewusst gesetzte Vorgaben statt offener Fragen

Es bleiben keine [NEEDS CLARIFICATION]-Marker. Vier Punkte, an denen der Auftrag mehrere Lesarten
offenließ, sind als Annahme entschieden und im Abschnitt *Assumptions* begründet — sie sind dort
billig zu widerrufen:

1. **Portbereich als Block** statt als bloßer Zählindex. Abgeleitet, nicht geraten: FR-030/FR-031
   verlangen Ports je Dienst und eine klickbare URL — beides kann das Toolkit nur bilden, wenn es
   den Block kennt und einen Dienst als Haupteingang geführt bekommt.
2. **Voller Stack startet auf Anforderung**, nicht automatisch beim Eintritt in die Lane
   (Begründung: Kostenlage).
3. **Geteilte Dienste: letzter räumt ab.**
4. **Ablehnung der manuellen Abnahme** führt in die Nacharbeit der Implementierung zurück.

### Prüfvermerk

- Der von F1b gebaute Erweiterungspunkt ist im Code verifiziert und einzig:
  `packages/shared/src/lifecycleSteps.ts:94` (`buildLifecycleEnv`) — der dortige Kommentar reserviert
  beide Variablen bereits namentlich. FR-007 verweist auf genau diese Stelle.
- Das im Auftrag beschriebene stille Nullen ist im Code verifiziert:
  `packages/server/src/services/mergeQueueService.ts:823-827` entfernt mit unterdrücktem Fehler und
  setzt den Pfad danach bedingungslos auf `null`. FR-034 bis FR-037 adressieren genau das.
- Alle Items wurden gegen die Artefakte geprüft und erst danach abgehakt — nicht, weil sie
  „ohnehin erledigt" wirkten (Regel aus der F1b-Nachbetrachtung).
