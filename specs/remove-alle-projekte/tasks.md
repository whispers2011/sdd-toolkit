---
description: "Task list for feature: Nur ein Projektkontext — „Alle Projekte" entfernen"
---

# Tasks: Nur ein Projektkontext — „Alle Projekte" entfernen

**Input**: Design documents from `/specs/remove-alle-projekte/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-state-contract.md, quickstart.md

**Tests**: Keine automatisierten Test-Tasks — `packages/web` hat im MVP kein Test-Setup (`test` = no-op) und die Spec fordert keine Tests. Verifikation erfolgt über `pnpm --filter @sdd/web typecheck` und das manuelle Quickstart.

**Organization**: Nach User Story (Spec-Prioritäten P1–P3). Reine Frontend-Änderung in `packages/web/src`; Server und `@sdd/shared` bleiben unangetastet.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallel ausführbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: Zugehörige User Story (US1, US2, US3)

## Path Conventions

Web-App im pnpm-Monorepo. Alle Pfade relativ zum Repo-Root: `packages/web/src/…`.

> **Wichtiger Hinweis zur Datei-Teilung**: `packages/web/src/store.tsx` ist der Kern und wird von US1, US2 **und** US3 verändert. Tasks an dieser Datei sind daher **nicht** [P] und laufen sequenziell in Phasen-Reihenfolge. Die View-Komponenten liegen in getrennten Dateien und sind untereinander [P].

---

## Phase 1: Setup

**Purpose**: Sauberen Ausgangszustand sicherstellen.

- [X] T001 Baseline prüfen: `pnpm --filter @sdd/web typecheck` läuft vor jeder Änderung fehlerfrei durch (Referenzpunkt für spätere Checkpoints)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Blockierende Vorarbeiten für alle Stories.

**Keine eigenständigen Foundational-Tasks.** Es gibt keine gemeinsame Infrastruktur, die vor den Stories separat entstehen müsste: Der geteilte Kern (`store.tsx`) wird inkrementell innerhalb der Stories umgebaut, beginnend mit der Basisschicht in US1 (T002). Server-, Datenmodell- und Shared-Ebene sind unverändert.

**Checkpoint**: Direkt weiter mit US1.

---

## Phase 3: User Story 1 - Strikter Ein-Projekt-Kontext in allen Ansichten (Priority: P1) 🎯 MVP

**Goal**: „Alle Projekte" ist als Auswahl entfernt; jede Ansicht zeigt ausschließlich Inhalte des aktuell gewählten Projekts. Es gibt keinen Bedienweg mehr für eine projektübergreifende Sicht.

**Independent Test**: App mit ≥ 2 Projekten öffnen, ein Projekt in der Sidebar wählen und Board/Grid/Läufe/Braucht dich prüfen — nur Inhalte des gewählten Projekts erscheinen, und es existiert kein „Alle Projekte"-Element (Quickstart V1, V2). *(Ohne US2 ist beim Start noch kein Projekt vorgewählt — für den Test zuerst ein Projekt anklicken.)*

- [X] T002 [US1] In `packages/web/src/store.tsx` den Action-Typ `select_project` auf `{ type: 'select_project'; projectId: string }` verengen (kein `| null`); im `select_project`-Reducer-Case den Guard `action.projectId !== null && state.app` zu `state.app` vereinfachen (Kontext-Trennungslogik bleibt erhalten); in `visibleFeatures()` den Zweig `state.selectedProjectId === null || …` auf `f.projectId === state.selectedProjectId` reduzieren. `null` bleibt als interner „kein Projekt vorhanden"-Wert erhalten (Kommentar an `selectedProjectId` entsprechend anpassen).
- [X] T003 [P] [US1] In `packages/web/src/components/Sidebar.tsx` den „Alle Projekte"-Button (Block um Zeile 31–38, `dispatch({ type: 'select_project', projectId: null })`) ersatzlos entfernen.
- [X] T004 [P] [US1] In `packages/web/src/components/KanbanBoard.tsx` beide `selectedProjectId === null`-Zweige entfernen: im `features`-Filter (Zeile ~44) und in der `enabledUnion`-Schleife (`if (state.selectedProjectId !== null && p.id !== state.selectedProjectId) continue;` → `if (p.id !== state.selectedProjectId) continue;`, Zeile ~49).
- [X] T005 [P] [US1] In `packages/web/src/components/GridView.tsx` im `features`-Filter (Zeile ~45) den `scope === null ||`-Zweig entfernen, sodass nur Features mit `f.projectId === scope` sichtbar sind; Kommentar „bzw. alle bei Alle Projekte" streichen.
- [X] T006 [P] [US1] In `packages/web/src/components/AttentionInbox.tsx` im `items`-Filter (Zeile ~22) den `state.selectedProjectId === null ||`-Zweig entfernen.
- [X] T007 [P] [US1] In `packages/web/src/components/ExecutionsView.tsx` im `rows`-Memo (Zeile ~38) den `projectFilter === null ||`-Zweig entfernen.
- [X] T008 [P] [US1] In `packages/web/src/App.tsx` im `SpecKitBanner` die `missing`-Berechnung (Zeile ~107) von `(state.selectedProjectId === null || p.id === state.selectedProjectId)` auf `p.id === state.selectedProjectId` reduzieren.
- [X] T009 [P] [US1] In `packages/web/src/components/QuickSwitcher.tsx` das `Entry`-Interface `projectId?: string | null` auf `projectId?: string` verengen (Kompatibilität mit dem verengten `select_project`; `activate()` bleibt unverändert, da nur bei `!== undefined` dispatcht wird).
- [X] T010 [US1] Checkpoint: `pnpm --filter @sdd/web typecheck` fehlerfrei; App starten und Quickstart V1 + V2 manuell prüfen.

**Checkpoint**: „Alle Projekte" ist weg; strikte Kontextfilterung greift in allen Ansichten (nach manueller Projektwahl).

---

## Phase 4: User Story 2 - Automatische Projektwahl beim Start (Priority: P2)

**Goal**: Beim Laden ist ohne Interaktion genau ein Projekt aktiv (zuletzt gewähltes, sonst erstes); die Auswahl überlebt Neustarts.

**Independent Test**: Projekt B wählen, neu laden → B ist aktiv; `localStorage['sdd-selected-project']` löschen, neu laden → erstes Projekt ist aktiv; nie „kein Projekt" bei vorhandenen Projekten (Quickstart V3, V4).

**Hinweis**: Alle Tasks betreffen `store.tsx` (gemeinsame Datei) → sequenziell, nicht [P]. Bauen auf T002 auf.

- [X] T011 [US2] In `packages/web/src/store.tsx` eine Konstante `SELECTED_PROJECT_KEY = 'sdd-selected-project'` sowie kleine Helfer zum Lesen/Schreiben der gemerkten Projekt-ID aus `localStorage` ergänzen (analog zu `soundEnabled`/`setSoundEnabled`).
- [X] T012 [US2] Im `bootstrap`-Reducer-Case in `packages/web/src/store.tsx` `selectedProjectId` nach der Auflösungsregel setzen (Contract C4): (1) aktuelle Auswahl noch in `action.state.projects` → beibehalten; (2) sonst gemerkte ID aus `localStorage`, falls vorhanden → wählen; (3) sonst `action.state.projects[0]?.id`; (4) sonst `null`. Ergebnis zusammen mit `app: action.state` zurückgeben.
- [X] T013 [US2] Im `select_project`-Reducer-Case in `packages/web/src/store.tsx` die gewählte `projectId` in `localStorage` unter `SELECTED_PROJECT_KEY` persistieren (Contract C5).
- [X] T014 [US2] Checkpoint: `pnpm --filter @sdd/web typecheck` fehlerfrei; Quickstart V3 + V4 manuell prüfen (Startwahl + Persistenz über Reload).

**Checkpoint**: Startzustand ist definiert und persistent; US1 + US2 funktionieren gemeinsam.

---

## Phase 5: User Story 3 - Robuster Kontextwechsel bei Sonderfällen (Priority: P3)

**Goal**: Auch bei Entfernen des aktiven Projekts, Fremd-Navigation (Benachrichtigung/⌘K/Feature-Klick) und leerem Zustand bleibt die Invariante „genau ein Kontext bzw. klarer Leerzustand" erhalten.

**Independent Test**: Aktives Projekt entfernen → Kontext springt auf anderes Projekt; Benachrichtigung/⌘K eines Fremd-Features öffnen → Kontext folgt; ohne Projekte → Leerzustand ohne Fehler, erstes Hinzufügen aktiviert das Projekt (Quickstart V5, V6, V7).

- [X] T015 [US3] Im WS-`notification`-Handler in `packages/web/src/store.tsx` (Notification-`onclick`, Sprung zur Feature-Konsole) vor dem `set_view` das Projekt des Features wählen: zugehöriges Feature über `n.featureId` in `state.app.features` finden und `dispatch({ type: 'select_project', projectId: feature.projectId })` auslösen, dann `set_view` (Contract C6, FR-007).
- [X] T016 [P] [US3] In `packages/web/src/components/GridView.tsx` in `storageKey()` den Fallback `projectId ?? 'all'` auf `projectId ?? 'none'` ändern (Contract D5/C7 — kein „all"-Scope mehr; alte `sdd-grid-panes:all`-Einträge verwaisen folgenlos).
- [X] T017 [US3] Projekt-Entfernung verifizieren: In `packages/web/src/components/ProjectSettings.tsx` bestätigen, dass `removeProject` → `api.state()` → `dispatch({ type: 'bootstrap', … })` läuft (bereits vorhanden), sodass die Bootstrap-Auflösung aus T012 den Kontext automatisch neu setzt. Nur falls diese Kette fehlt, ergänzen. Quickstart V5 prüfen.
- [X] T018 [US3] Leerzustand verifizieren: bei `state.app.projects.length === 0` rendern Sidebar („Noch keine Projekte") und projektbezogene Ansichten ohne Laufzeitfehler bei `selectedProjectId === null`; Hinzufügen des ersten Projekts aktiviert es via Bootstrap. Quickstart V7 prüfen.

**Checkpoint**: Alle Sonderfälle halten die Ein-Kontext-Invariante ein.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Endabnahme über alle Stories.

- [ ] T019 Vollständiges Quickstart V1–V7 (`specs/remove-alle-projekte/quickstart.md`) mit ≥ 2 Projekten durchspielen; Abweichungen beheben. **(OFFEN: manueller Browser-Durchlauf durch Menschen — statische Äquivalente [typecheck, build, Restvorkommen-Grep] sind grün; Logikpfade je Szenario per Code-Review geprüft.)**
- [X] T020 Abschluss: `pnpm --filter @sdd/web typecheck` und `pnpm --filter @sdd/web build` fehlerfrei; sicherstellen, dass keine Restvorkommen von „Alle Projekte" oder `selectedProjectId === null`-Anzeigelogik verblieben sind (`grep -rn "Alle Projekte" packages/web/src`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten.
- **Foundational (Phase 2)**: entfällt (keine Tasks).
- **US1 (Phase 3)**: nach Setup. Liefert die Basisänderung in `store.tsx` (T002), auf der US2/US3 aufbauen.
- **US2 (Phase 4)**: nach US1 (baut auf T002 im selben `store.tsx` auf).
- **US3 (Phase 5)**: nach US2 (T017-Auto-Switch nutzt Bootstrap-Auflösung aus T012; T015 baut auf `store.tsx`-Änderungen auf).
- **Polish (Phase 6)**: nach allen gewünschten Stories.

### User Story Dependencies

- **US1 (P1)**: unabhängig testbar (manuelle Projektwahl). MVP.
- **US2 (P2)**: funktional abhängig von US1 (gemeinsamer `store.tsx`-Kern), eigener testbarer Mehrwert (Startwahl/Persistenz).
- **US3 (P3)**: funktional abhängig von US2 (Bootstrap-Auflösung für Auto-Switch), eigener testbarer Mehrwert (Sonderfälle).

> Die Stories sind aufgrund des gemeinsamen `store.tsx` **nicht** parallel über Entwickler verteilbar; sie laufen inkrementell in Prioritätsreihenfolge.

### Within Each Story

- US1: T002 (Store-Basis) zuerst; T003–T009 sind [P] (getrennte Dateien) und dürfen parallel laufen; T010 Checkpoint zuletzt.
- US2: T011 → T012 → T013 sequenziell (gleiche Datei); T014 Checkpoint.
- US3: T015 (store) und T016 ([P], GridView) parallelisierbar; T017/T018 Verifikation danach.

### Parallel Opportunities

- **US1**: T003, T004, T005, T006, T007, T008, T009 gemeinsam parallel (alle in getrennten Komponenten-Dateien), nachdem T002 die Store-Signatur verengt hat.
- **US3**: T016 (GridView) parallel zu T015 (store).

---

## Parallel Example: User Story 1

```bash
# Nach T002 (Store-Signatur verengt) alle View-Anpassungen parallel:
Task: "Sidebar.tsx — 'Alle Projekte'-Button entfernen"           # T003
Task: "KanbanBoard.tsx — null-Zweige in Filter + enabledUnion"    # T004
Task: "GridView.tsx — scope===null-Zweig entfernen"               # T005
Task: "AttentionInbox.tsx — null-Zweig entfernen"                 # T006
Task: "ExecutionsView.tsx — null-Zweig entfernen"                 # T007
Task: "App.tsx — SpecKitBanner null-Zweig entfernen"              # T008
Task: "QuickSwitcher.tsx — Entry.projectId auf string verengen"   # T009
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup (T001).
2. Phase 3 US1 (T002 → T003–T009 parallel → T010).
3. **STOP & VALIDATE**: Quickstart V1 + V2 — „Alle Projekte" weg, strikte Filterung.
4. Demofähig.

### Incremental Delivery

1. US1 → strikter Kontext, manuelle Wahl (MVP).
2. + US2 → automatische Startwahl + Persistenz.
3. + US3 → robuste Sonderfälle (Entfernen, Fremd-Navigation, Leerzustand).
4. Polish → Quickstart-Komplettabnahme + Build.

---

## Notes

- [P] = andere Datei, keine offene Abhängigkeit. `store.tsx`-Tasks sind bewusst nie [P].
- Verifikation ist typgetrieben: das Verengen von `select_project` (T002) macht übersehene `null`-Pfade zu Compile-Fehlern.
- Nach jedem Task oder logischer Gruppe committen; an Checkpoints Story unabhängig validieren.
- Kein Server-/Shared-Code und keine Datenmigration.
