---

description: "Task list for feature implementation"
---

# Tasks: Projekt-Klick öffnet Board-Ansicht

**Input**: Design documents from `specs/klick-auf-projektname-soll-board-oeffnen/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-interaction.md, quickstart.md

**Tests**: Nicht angefordert und kein Web-Unit-Test-Harness vorhanden (`@sdd/web` `test`-Script ist ein No-op-Stub). Es werden **keine** Test-Tasks generiert; Verifikation erfolgt über `typecheck` + manuelle/E2E-Prüfung (quickstart.md).

**Organization**: Tasks nach User Story gruppiert. Kernstück ist eine einzige Änderung in `Sidebar.tsx`, die beide User Stories abdeckt — US2 erfordert keinen zusätzlichen Code, nur Validierung.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelisierbar (andere Datei, keine Abhängigkeit)
- **[Story]**: US1 / US2 (nur in User-Story-Phasen)
- Exakte Dateipfade in der Beschreibung

## Path Conventions

Web-Monorepo; betroffen ist ausschließlich `packages/web`. Alle Pfade relativ zum Repo-Root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bekannt-guter Ausgangspunkt vor der Änderung.

- [X] T001 Baseline sichern: `pnpm install` und `pnpm --filter @sdd/web typecheck` grün (bestätigt fehlerfreien Startzustand, bevor `packages/web/src/components/Sidebar.tsx` geändert wird)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Blockierende Vorarbeiten für alle User Stories.

**Keine Foundational-Tasks erforderlich.** Alle benötigten Bausteine existieren bereits und werden wiederverwendet:

- Store-Action `select_project` und `set_view { kind: 'board' }` in `packages/web/src/store.tsx` (View-Union enthält `{ kind: 'board' }`).
- Projekt-Filterung im Board über `state.selectedProjectId` in `packages/web/src/components/KanbanBoard.tsx`.
- Etabliertes Doppel-Dispatch-Muster beim Feature-Klick (`packages/web/src/components/Sidebar.tsx`, aktuell Zeilen 99–101).

**Checkpoint**: Fundament vorhanden — User-Story-Umsetzung kann beginnen.

---

## Phase 3: User Story 1 - Ein-Klick zum Projekt-Board (Priority: P1) 🎯 MVP

**Goal**: Ein Klick auf einen Projektnamen in der Sidebar öffnet unmittelbar die auf dieses Projekt beschränkte Board-Ansicht; das Projekt ist ausgewählt/hervorgehoben.

**Independent Test**: Aus einer Nicht-Board-Ansicht (z. B. »Läufe«) auf einen Projektnamen klicken → Board erscheint, zeigt nur Features dieses Projekts, Zeile hervorgehoben (quickstart.md Szenario C1).

### Implementation for User Story 1

- [X] T002 [US1] In `packages/web/src/components/Sidebar.tsx` den `onClick` der Projektzeilen-`<div>` (aktuell Zeile 47, `dispatch({ type: 'select_project', projectId: project.id })`) erweitern: zusätzlich `dispatch({ type: 'set_view', view: { kind: 'board' } })` auslösen — Reihenfolge wie beim Feature-Klick (erst `select_project`, dann `set_view`). NUR diese Projektzeile ändern; die »Alle Projekte«-Zeile (Zeile 32) und die zeileninternen Aktionsbuttons (`+` / `>_` / `⚙`, mit `e.stopPropagation()`) bleiben unverändert.
- [X] T003 [US1] Verifizieren: `pnpm --filter @sdd/web typecheck` grün; App starten (`pnpm dev`) und quickstart.md-Szenario **C1** manuell prüfen (Projektklick aus Nicht-Board-Ansicht → projektbeschränktes Board, Hervorhebung) sowie Leerzustand-Szenario (Projekt ohne sichtbare Features → leeres, projektbezogenes Board)

**Checkpoint**: US1 vollständig funktionsfähig und unabhängig testbar — das ist der MVP.

---

## Phase 4: User Story 2 - Projektwechsel per Klick von überall (Priority: P2)

**Goal**: Mit einem Klick zwischen den Boards verschiedener Projekte wechseln, aus beliebiger Ansicht — auch aus einer offenen Feature-Konsole/einem Terminal desselben Projekts.

**Independent Test**: Board von Projekt A öffnen → auf Projekt B klicken → Board zeigt B; danach aus einer offenen Feature-Konsole heraus auf den Projektnamen klicken → Wechsel zum Board (quickstart.md Szenarien C2, C3, C9).

**Hinweis**: Keine zusätzliche Implementierung — dieselbe Änderung aus T002 erfüllt US2 (unbedingtes `set_view { kind: 'board' }` beim Projektklick). Diese Phase ist reine Validierung.

- [X] T004 [US2] quickstart.md-Szenarien manuell prüfen: **C2** (Wechsel aus »Grid« zum Board eines anderen Projekts), **C3** (Klick auf Projektnamen bei offener Konsole/Terminal DESSELBEN Projekts → Wechsel zum Board, laufende Session bleibt im Hintergrund erhalten), **C9** (erneuter Klick auf bereits ausgewähltes Projekt → Board stabil/idempotent, keine abgebrochenen Prozesse)

**Checkpoint**: US1 und US2 funktionieren unabhängig.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Regressionsschutz und Gesamt-Validierung.

- [X] T005 Regressions-Check der Nicht-betroffenen Interaktionen anhand contracts/ui-interaction.md: **C4–C6** (Aktionsbuttons `+` / `>_` / `⚙` lösen KEINEN Board-Wechsel aus), **C7** (Feature-Klick öffnet weiterhin die Konsole, nicht das Board), **C8** (»Alle Projekte« setzt nur den Scope, aktive Ansicht bleibt — FR-008)
- [X] T006 [P] Vollständige `specs/klick-auf-projektname-soll-board-oeffnen/quickstart.md`-Validierung durchlaufen (alle Szenarien 1–8) und `pnpm --filter @sdd/web typecheck` abschließend grün bestätigen

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten.
- **Foundational (Phase 2)**: keine Tasks — kein Blocker.
- **User Story 1 (Phase 3)**: nach Setup. Enthält die einzige Code-Änderung (T002).
- **User Story 2 (Phase 4)**: hängt an T002 (keine eigene Implementierung, nur Validierung).
- **Polish (Phase 5)**: nach US1/US2.

### User Story Dependencies

- **US1 (P1)**: unabhängig testbar; liefert den MVP.
- **US2 (P2)**: fachlich unabhängig testbar, technisch durch dieselbe T002-Änderung erfüllt — daher T004 nach T002.

### Within Each User Story

- T002 (Code) vor T003 (Verifikation).
- T004 nach T002.

### Parallel Opportunities

- Minimal: Die einzige Code-Änderung liegt in **einer** Datei (`Sidebar.tsx`), daher keine parallele Implementierung.
- T006 ist mit `[P]` markiert (Validierungslauf, kann unabhängig von Detailprüfungen erfolgen), setzt jedoch die abgeschlossene Änderung voraus.

---

## Parallel Example

Für dieses Feature gibt es praktisch keine Parallelität auf Implementierungsebene (Single-File-Änderung). Die Verifikations-Tasks (T003, T004, T005) sollten sequenziell entlang der quickstart.md-Szenarien abgearbeitet werden.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001).
2. Phase 3: US1 — T002 (Code) + T003 (Verifikation C1 + Leerzustand).
3. **STOP & VALIDATE**: US1 unabhängig testen → bereits vollständiger Feature-Wert (Projektklick öffnet Board).

### Incremental Delivery

1. Setup → bekannt-guter Stand.
2. US1 (T002–T003) → MVP, testbar/demofähig.
3. US2 (T004) → Validierung des Von-überall-Wechsels (kein neuer Code).
4. Polish (T005–T006) → Regressionsschutz + Gesamt-Validierung.

---

## Notes

- [P] = andere Datei, keine Abhängigkeit; hier fast überall sequenziell (Single-File-Änderung).
- [Story]-Label nur in US-Phasen; Setup/Foundational/Polish ohne Label.
- Keine Test-Tasks (nicht angefordert, kein Web-Test-Harness) — Verifikation via `typecheck` + quickstart.md.
- Commit nach T002 (bzw. nach Abschluss von US1) empfohlen.
- Kernrisiko: versehentliche Änderung der »Alle Projekte«-Zeile oder der Aktionsbuttons — durch T005 explizit abgesichert.
