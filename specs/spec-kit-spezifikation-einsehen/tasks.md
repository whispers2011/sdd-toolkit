---
description: "Task list for feature: Spezifikation der SDD-Schritte per Lane-Info-Icon einsehen und bearbeiten"
---

# Tasks: Spezifikation der SDD-Schritte per Lane-Info-Icon einsehen und bearbeiten

**Input**: Design documents from `specs/spec-kit-spezifikation-einsehen/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/phase-definition-api.md, quickstart.md

**Tests**: Nur gezielte Unit-Tests für die reine Server-Logik (Resolver, Konflikt/Lock), wie in plan.md festgelegt. Kein Web-Test-Setup (MVP) → UI-Validierung über quickstart.md.

**Organization**: Aufgaben sind nach User Story gruppiert, damit jede Story unabhängig implementiert und getestet werden kann.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallel ausführbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: Zugehörige User Story (US1, US2, US3)
- Pfade sind relativ zum Repo-Root.

## Path Conventions (aus plan.md)

- Shared: `packages/shared/src/`
- Server: `packages/server/src/`
- Web: `packages/web/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Abhängigkeiten für das Markdown-Rendering bereitstellen.

- [X] T001 [P] `react-markdown` und `remark-gfm` zu `packages/web` hinzufügen (`pnpm --filter @sdd/web add react-markdown remark-gfm`) und React-19-Kompatibilität durch erfolgreichen `pnpm --filter @sdd/web build` verifizieren

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Geteilte Typen und Server-Basislogik, die von ALLEN User Stories genutzt werden.

**⚠️ CRITICAL**: Keine User-Story-Arbeit vor Abschluss dieser Phase.

- [X] T002 [P] Geteilte DTO-Typen `PhaseDefinition`, `SavePhaseDefinitionRequest`, `SavePhaseDefinitionResult` in `packages/shared/src/types.ts` definieren und exportieren (Felder gemäß data-model.md)
- [X] T003 [P] Resolver `phaseDefinitionPath(repoRoot, phase)` in `packages/server/src/services/artifacts.ts` implementieren: Skills-Layout `.claude/skills/speckit-<phase>/SKILL.md`, Command-Layout `.claude/commands/speckit-<phase>.md`/`speckit.<phase>.md`, sonst `null` (Muster von `speckitCommandPrefix` wiederverwenden)
- [X] T004 Unit-Tests für `phaseDefinitionPath` in `packages/server/src/services/artifacts.test.ts` (Skills-Layout → korrekter Pfad, Command-Layout → korrekter Pfad, fehlend → `null`) — nach T003
- [X] T005 [P] Lock-Helfer `isPhaseLocked(projectId, phase)` + `lockReason` in neuer Datei `packages/server/src/services/phaseDefinition.ts` implementieren: `true`, wenn ein Feature des Projekts `phases[phase].status === 'running'` hat (über `FeatureRepo`)

**Checkpoint**: Typen + Resolver + Lock-Logik vorhanden — User Stories können beginnen.

---

## Phase 3: User Story 1 - Verstehen, was ein SDD-Schritt macht (Priority: P1) 🎯 MVP

**Goal**: Info-Icon im Header jeder Phasen-Lane öffnet einen Dialog, der die spec-kit-Definition dieses Schritts formatiert (gerendertes Markdown) anzeigt.

**Independent Test**: Klick auf das Info-Icon der Specify-Lane zeigt die formatierte Definition in < 1 s; Lanes Integration/Done zeigen kein Icon; Schritt ohne Definition zeigt verständlichen Hinweis.

### Implementation for User Story 1

- [X] T006 [US1] `readPhaseDefinition(projectId, phase)` in `packages/server/src/services/phaseDefinition.ts` implementieren: Pfad via `phaseDefinitionPath(project.path, phase)` (T003) auflösen, Inhalt + `mtimeMs` (via `statSync`) lesen, `exists`/`locked`/`lockReason` (T005) füllen → `PhaseDefinition` (T002)
- [X] T007 [US1] Route `GET /api/projects/:id/phases/:phase/definition` in `packages/server/src/api/server.ts` ergänzen: `phase ∈ FEATURE_PHASES` prüfen (sonst 400), Projekt sonst 404, `readPhaseDefinition` aufrufen (T006)
- [X] T008 [P] [US1] Client-Methode `phaseDefinition(projectId, phase)` in `packages/web/src/api.ts` ergänzen (Rückgabetyp `PhaseDefinition`, T002)
- [X] T009 [US1] `packages/web/src/components/PhaseDefinitionDialog.tsx` neu erstellen (Muster wie `ReviewPortal`/`Dialog`): beim Öffnen laden, Markdown mit `react-markdown`+`remark-gfm` rendern (T001), Lade-/Leer-/Fehlerzustand ("keine Definition"), Schließen ohne Board-Zustandsverlust; Projektauflösung nach research.md R2 (`selectedProjectId`; bei „Alle" + mehreren Projekten Projektauswahl mit Default = erstes Projekt mit aktivierter Phase) (T008)
- [X] T010 [US1] Info-Icon im Lane-Header von `packages/web/src/components/KanbanBoard.tsx` ergänzen (nur wenn `column !== 'integration' && column !== 'done'`), Klick öffnet `PhaseDefinitionDialog` mit (aufgelöste projectId, phase), Tooltip „Was macht dieser Schritt?" (T009)

**Checkpoint**: User Story 1 eigenständig funktionsfähig und testbar (MVP).

---

## Phase 4: User Story 2 - Schritt-Definition direkt in der App bearbeiten (Priority: P2)

**Goal**: Aus dem Dialog heraus bearbeiten und speichern, mit Konfliktschutz (externe Änderung), Verwerfen-Warnung, Fehlerbehandlung und Sperre bei laufendem Agenten.

**Independent Test**: Text ändern → speichern → Dialog neu öffnen → Änderung vorhanden; externe Änderung erzeugt Konfliktwahl; bei laufendem Agenten nur-lesend.

### Implementation for User Story 2

- [X] T011 [US2] `writePhaseDefinition(projectId, phase, { content, baseMtimeMs, overwrite })` in `packages/server/src/services/phaseDefinition.ts` implementieren: 404 wenn keine Datei; `locked` (T005) → Fehler `locked`; aktuelle `mtimeMs` vs. `baseMtimeMs` → bei Abweichung ohne `overwrite` Fehler `conflict` (mit aktuellem `content`+`mtimeMs`); sonst schreiben und neue `mtimeMs` zurückgeben (T006)
- [X] T012 [US2] Unit-Tests für Konflikt-/Lock-Logik in `packages/server/src/services/phaseDefinition.test.ts` (Basis == aktuell → schreibt; Abweichung ohne overwrite → `conflict`; mit overwrite → schreibt; gesperrt → `locked`; fehlende Datei → 404) — nach T011
- [X] T013 [P] [US2] Route `PUT /api/projects/:id/phases/:phase/definition` in `packages/server/src/api/server.ts` ergänzen: Body-Validierung (400 bei fehlendem `content`/`baseMtimeMs`), Service-Fehler auf 404/409(`conflict`|`locked`)/500 mappen (Kontrakt in contracts/phase-definition-api.md) (T011)
- [X] T014 [P] [US2] Client-Methode `savePhaseDefinition(projectId, phase, body)` in `packages/web/src/api.ts` ergänzen; 409-Antwort als strukturierten Fehler mit `error`-Kind und `current`-Payload durchreichen (T002)
- [X] T015 [US2] `PhaseDefinitionDialog.tsx` erweitern: Bearbeiten-Umschalter (Textarea, Rohtext), Speichern mit Erfolgsbestätigung (FR-006), Fehler behalten Eingaben (FR-007), Verwerfen-Warnung bei ungespeicherten Änderungen (FR-008), Konflikt-UI „Überschreiben"/„Neu laden" (FR-009), bei `locked` nur-lesend + Hinweisbanner mit deaktiviertem Bearbeiten (FR-010) (T013, T014, T009)

**Checkpoint**: User Stories 1 und 2 funktionieren unabhängig.

---

## Phase 5: User Story 3 - Definition im externen Editor öffnen (Priority: P3)

**Goal**: Aus dem Dialog die Definitionsdatei mit einem Klick im konfigurierten externen Editor öffnen.

**Independent Test**: „Im Editor öffnen" öffnet genau die Definitionsdatei im `project.editorCmd`-Editor.

### Implementation for User Story 3

- [X] T016 [US3] Route `POST /api/projects/:id/phases/:phase/definition/open-in-editor` in `packages/server/src/api/server.ts` ergänzen: Pfad via `phaseDefinitionPath(project.path, phase)` (T003) auflösen (404 wenn fehlend), `project.editorCmd` (Default `code -g {file}:{line}`) via `loginShellEnv`+`shellQuotePath`+`exec` mit `cwd = project.path` ausführen (Muster von `/api/open-in-editor`)
- [X] T017 [P] [US3] Client-Methode `openPhaseDefinitionInEditor(projectId, phase)` in `packages/web/src/api.ts` ergänzen
- [X] T018 [US3] Button „Im Editor öffnen" in `PhaseDefinitionDialog.tsx` ergänzen, verdrahtet mit T017 (T017, T015)

**Checkpoint**: Alle User Stories unabhängig funktionsfähig.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verifikation und Feinschliff über alle Stories.

- [X] T019 [P] `pnpm --filter @sdd/server test` und `pnpm typecheck` ausführen; auftretende Fehler beheben
- [X] T020 [P] `pnpm --filter @sdd/web build` ausführen und bestätigen, dass das Web-Paket mit der neuen Abhängigkeit kompiliert
- [ ] T021 Manuelle Validierung aller Szenarien 1–8 aus `specs/spec-kit-spezifikation-einsehen/quickstart.md` und Abgleich SC-001…SC-006
- [X] T022 [P] Kurze Feature-Notiz (Lane-Definition einsehen/bearbeiten) in `docs/` bzw. `README.md` ergänzen

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten.
- **Foundational (Phase 2)**: nach Setup; BLOCKIERT alle User Stories.
- **User Stories (Phase 3–5)**: alle nach Phase 2. Reihenfolge P1 → P2 → P3 (empfohlen). US2 und US3 bauen auf dem in US1 erstellten Dialog auf.
- **Polish (Phase 6)**: nach den gewünschten Stories.

### User Story Dependencies

- **US1 (P1)**: nur Phase 2. Eigenständig lauffähig (MVP).
- **US2 (P2)**: Phase 2 + `PhaseDefinitionDialog.tsx` aus US1 (T009) sowie `readPhaseDefinition` (T006). Erweitert denselben Dialog/dieselbe Route-Datei.
- **US3 (P3)**: Phase 2 + Dialog aus US1/US2 (T015). Nutzt den Resolver (T003).

### Wichtige Datei-Kopplungen (kein [P] über Stories hinweg)

- `packages/server/src/api/server.ts`: T007 (US1) → T013 (US2) → T016 (US3) sequenziell (dieselbe Datei).
- `packages/web/src/api.ts`: T008 (US1) → T014 (US2) → T017 (US3) sequenziell (dieselbe Datei).
- `packages/server/src/services/phaseDefinition.ts`: T005 → T006 → T011 sequenziell.
- `packages/web/src/components/PhaseDefinitionDialog.tsx`: T009 → T015 → T018 sequenziell.

### Within Each User Story

- Service vor Route; Route/Client vor UI-Verdrahtung.
- Story vollständig, bevor die nächste Priorität beginnt (bei Einzelbearbeitung).

## Parallel Opportunities

- **Phase 1**: T001 allein.
- **Phase 2**: T002, T003 und T005 sind [P] (verschiedene Dateien); T004 folgt T003.
- **US1**: T008 (`api.ts`) parallel zur Server-Arbeit T006/T007; T009 nach T008, T010 nach T009.
- **US2**: T013 (Server-Route) und T014 (`api.ts`) [P] zueinander; T012 folgt T011; T015 nach T013+T014.
- **US3**: T017 (`api.ts`) parallel zu T016 (Server-Route); T018 nach beidem.
- **Phase 6**: T019, T020, T022 sind [P]; T021 nach T019/T020.

## Parallel Example: Foundational (Phase 2)

```bash
# Gemeinsam startbar (verschiedene Dateien):
Task: "T002 DTO-Typen in packages/shared/src/types.ts"
Task: "T003 phaseDefinitionPath in packages/server/src/services/artifacts.ts"
Task: "T005 isPhaseLocked in packages/server/src/services/phaseDefinition.ts"
```

## Implementation Strategy

### MVP First (nur User Story 1)

1. Phase 1: Setup (T001)
2. Phase 2: Foundational (T002–T005) — blockiert alles
3. Phase 3: User Story 1 (T006–T010)
4. **STOP & VALIDATE**: US1 eigenständig testen (quickstart Szenarien 1–2)
5. Demo/Deploy als MVP

### Incremental Delivery

1. Setup + Foundational → Basis steht
2. + US1 → Einsehen/Verstehen (MVP)
3. + US2 → In-App-Bearbeitung mit Konflikt-/Lock-Schutz
4. + US3 → Im externen Editor öffnen
5. Polish (Phase 6)

## Notes

- [P] = andere Datei, keine offene Abhängigkeit.
- Definitionen sind projekt-skopiert (research.md R2) — Endpunkte immer mit `(projectId, phase)`.
- Kein Neuanlegen von Definitionsdateien (PUT auf fehlende Datei → 404).
- Nach jeder Aufgabe/Gruppe committen; an Checkpoints Story-Unabhängigkeit prüfen.
