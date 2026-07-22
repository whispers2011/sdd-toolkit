# UI Interaction Contract: Sidebar-Projektklick → Board

**Feature**: `feature/klick-auf-projektname-soll-board-oeffnen` | **Date**: 2026-07-22

Dieses Feature stellt keine Netzwerk-/API-Schnittstelle bereit. Der „Contract" ist das beobachtbare UI-Verhalten der linken Sidebar. Jede Zeile ist eine testbare Zusicherung, verankert an den funktionalen Anforderungen des Specs.

## Interaktionselemente & erwartetes Verhalten

| # | Auslöser (UI-Element) | Vorbedingung | Erwartetes Ergebnis | FR |
|---|---|---|---|---|
| C1 | Klick auf **Projektname/-zeile** | beliebige aktive Ansicht | Board-Ansicht öffnet, `selectedProjectId = Projekt-ID`, Zeile hervorgehoben | FR-001, FR-002, FR-003 |
| C2 | Klick auf **Projektname/-zeile** | aktuelle Ansicht ist Grid / Läufe / Braucht dich / Konsole / Terminal | Wechsel zum Board dieses Projekts | FR-004 |
| C3 | Klick auf **Projektname/-zeile** | Konsole/Terminal **desselben** Projekts offen | Wechsel zum Board (kein Konsole-Behalten) | FR-004, Clarify Q2 |
| C4 | Klick auf **»+«** (Feature anlegen) | Projektzeile gehovt | Nur „Neues Feature"-Dialog; **kein** Board-Wechsel | FR-005 |
| C5 | Klick auf **»>_«** (Projekt-Terminal) | Projektzeile gehovt | Nur Shell-Ansicht dieses Projekts; **kein** Board-Wechsel | FR-005 |
| C6 | Klick auf **»⚙«** (Einstellungen) | Projektzeile gehovt | Nur Einstellungs-Dialog; **kein** Board-Wechsel | FR-005 |
| C7 | Klick auf **Feature-Eintrag** (Unterpunkt) | — | Feature-Konsole öffnet (nicht Board); Projekt wird ausgewählt | FR-006 |
| C8 | Klick auf **»Alle Projekte«** | beliebige aktive Ansicht | `selectedProjectId = null`; aktive Ansicht bleibt (**kein** erzwungenes Board) | FR-008 |
| C9 | Klick auf **Projektname/-zeile** | Board dieses Projekts bereits offen & Projekt ausgewählt | State unverändert/idempotent; laufende Prozesse ungestört | FR-007, Edge Case |

## Invarianten

- **I1**: Kein Interaktionspfad dieses Features bricht eine laufende Feature-Session ab oder verwirft Daten (nur Ansichts-/Auswahl-State ändert sich). → FR-007
- **I2**: Zeileninterne Aktionsbuttons (C4–C6) stoppen die Event-Propagation und dürfen C1 nicht mitauslösen. → FR-005
- **I3**: Das Board zeigt nach C1/C2/C3 ausschließlich Features mit `projectId === selectedProjectId` (Leerzustand erlaubt, kein Fremdinhalt). → FR-002

## Nicht Teil des Contracts (Out of Scope)

- ⌘K-QuickSwitcher-Projektwahl (separater Mechanismus, unverändert).
- Internes Board-Verhalten (Spalten, Drag-to-Advance, Filter „Abgeschlossene ausblenden") — durch dieses Feature nicht verändert.
