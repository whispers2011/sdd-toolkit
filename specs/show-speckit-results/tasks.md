---
description: "Task list for Speckit-Zwischenresultate pro Feature einsehen und bearbeiten"
---

# Tasks: Speckit-Zwischenresultate pro Feature einsehen und bearbeiten

**Input**: Design documents from `/specs/show-speckit-results/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/feature-artifacts-api.md, quickstart.md

**Tests**: Unit-Tests für pure Logik (`packages/shared`) und den Server-Service (`packages/server`) sind Teil der Plan-Teststrategie und enthalten. Web-UI hat bewusst keine Tests (MVP-Konvention).

**Organization**: Nach User Story gruppiert. Reihenfolge = Ausführungsreihenfolge. Basisverzeichnis der Artefakte: `feature.worktreePath ?? project.path`, Pfad `join(base, 'specs', feature.name, …)`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1 / US2 / US3 (nur in Story-Phasen)

## Path Conventions

Monorepo: `packages/shared/src/`, `packages/server/src/`, `packages/web/src/` (siehe plan.md „Source Code").

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: WYSIWYG-Editor-Abhängigkeit einführen und vor dem Bauen absichern (research §1).

- [X] T001 `@mdxeditor/editor` als Dependency in `packages/web/package.json` eintragen und `pnpm install` ausführen
- [X] T002 Spike (research §1) in einem Wegwerf-View: MDXEditor unter React 19 + Vite 6 mounten und **verlustfreien Round-Trip** an echten Dateien prüfen — `specs/spec-kit-spezifikation-einsehen/spec.md` (Tabellen/Fettdruck), `.../tasks.md` (`- [ ]`), `.../plan.md` (Codeblöcke/Frontmatter): laden → unverändert speichern → `git diff` strukturell leer. `remark-stringify`-Optionen (Bullet `-`, fenced code, ATX) festhalten. Bei Scheitern: Milkdown-Fallback aktivieren (research §1). Blockiert T011.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Gemeinsame Typen und pure Logik, auf denen alle Stories aufsetzen.

**⚠️ CRITICAL**: Keine Story-Arbeit vor Abschluss dieser Phase.

- [X] T003 DTOs in `packages/shared/src/types.ts` ergänzen: `FeatureArtifactFile`, `FeatureArtifactStep`, `FeatureArtifact`, `SaveFeatureArtifactRequest`, `SaveFeatureArtifactResult` (Felder gemäß data-model.md) und über `packages/shared/src/index.ts` re-exportieren
- [X] T004 `packages/shared/src/featureArtifacts.ts` anlegen: Konstante `ARTIFACT_STEP_SPECS` (Mapping `phase → { label, tooltip, primaryRelPath, companionRelPaths[], globDirs[] }` für `specify | plan | tasks | checklist`, siehe data-model.md-Tabelle) und pure Funktion `featureLock(feature)` (`FEATURE_PHASES.some(p => feature.phases[p]?.status === 'running')`); über `index.ts` re-exportieren (depends T003)
- [X] T005 Unit-Tests `packages/shared/src/featureArtifacts.test.ts`: `featureLock` (running vs. idle/approved), `ARTIFACT_STEP_SPECS` enthält genau specify/plan/tasks/checklist und **nicht** clarify/analyze/implement (depends T004)

**Checkpoint**: Typen + pure Logik stehen und sind getestet — Story-Implementierung kann beginnen.

---

## Phase 3: User Story 1 - Ergebnis eines Speckit-Schritts lesbar einsehen (Priority: P1) 🎯 MVP

**Goal**: Icons je Artefakt-Schritt auf der Feature-Kachel mit Tooltip; Klick öffnet ein Modal, das das Ergebnis lesbar (WYSIWYG, kein Markdown-Quelltext) anzeigt; Mehrfach-Dateien wählbar; fehlende Ergebnisse deaktiviert; Schließen ohne Zustandsverlust.

**Independent Test**: Bei einem Feature mit vorhandenen Artefakten ein Icon anklicken → Modal zeigt den Inhalt formatiert in < 1 s; Hover zeigt Tooltip; Icon ohne Ergebnis ist deaktiviert; Plan-Umschalter wechselt zwischen `plan.md`/Begleitartefakten. (FR-001…006, FR-017, FR-018; SC-001/002/003/006)

### Implementation for User Story 1

- [X] T006 [US1] `packages/server/src/services/featureArtifacts.ts` anlegen — Lesepfad: `listFeatureArtifactSteps(project, feature)` (fs-Existenzprüfung inkl. Begleitartefakte, `contracts/*` und `checklists/*` per readdir; base = `feature.worktreePath ?? project.path`) und `readFeatureArtifact(project, feature, phase, fileId?)` → `FeatureArtifact` (content, mtimeMs, exists, `locked` via `featureLock`, `files[]`); nutzt `ARTIFACT_STEP_SPECS` und ggf. `artifactPath()` aus `artifacts.js` (depends T004)
- [X] T007 [P] [US1] Server-Tests `packages/server/src/services/featureArtifacts.test.ts` (Temp-Dir): Enumeration mit/ohne Begleitartefakte + `contracts/`/`checklists/`-Globs; `readFeatureArtifact` für exists/missing; `locked`-Feld bei laufender Phase (depends T006)
- [X] T008 [US1] GET-Endpunkte in `packages/server/src/api/server.ts`: `GET /api/features/:id/artifacts` und `GET /api/features/:id/artifacts/:phase` (Query `file`), mit `deps.features.get`/`deps.projects.get`, `validatePhase`, 404-Handling (Muster: Definition-Endpunkte Z. 224–284) (depends T006)
- [X] T009 [P] [US1] Client-Lesemethoden in `packages/web/src/api.ts`: `featureArtifacts(featureId)` und `featureArtifact(featureId, phase, fileId?)` + Import der neuen Typen (depends T003)
- [X] T010 [P] [US1] Vier Outline-SVG-Icons (Specify/Plan/Tasks/Checklist) im Hausstil (24er-Grid, `currentColor`, `1em`) in `packages/web/src/components/icons.tsx` ergänzen
- [X] T011 [US1] WYSIWYG-Wrapper `packages/web/src/components/MarkdownEditor.tsx` (MDXEditor): Props `value`, `readOnly`, `onChange`; Plugins für GFM-Tabellen, Aufgaben-Listen, Codeblöcke, Frontmatter; Serialisierung mit den in T002 fixierten Optionen (depends T002)
- [X] T012 [US1] Modal `packages/web/src/components/FeatureResultDialog.tsx` anlegen: lädt via `api.featureArtifact`, rendert `MarkdownEditor readOnly`, Datei-Umschalter bei > 1 Datei, „kein Ergebnis"-Zustand, Lade-/Fehlerzustände, Schließen ohne Zustandsverlust (depends T009, T011)
- [X] T013 [US1] Icon-Leiste in `FeatureCard` in `packages/web/src/components/KanbanBoard.tsx`: Verfügbarkeit via `api.featureArtifacts`, ein Icon je Schritt mit `title`-Tooltip, deaktiviert wenn kein Ergebnis, Klick öffnet `FeatureResultDialog` (Dialog-State analog `defPhase`) (depends T010, T012)

**Checkpoint**: US1 eigenständig funktionsfähig und testbar — MVP steht.

---

## Phase 4: User Story 2 - Ergebnis direkt bearbeiten und speichern (Priority: P2)

**Goal**: Bearbeiten-Button oben rechts wechselt in den WYSIWYG-Editor; Speichern schreibt strukturerhaltend zurück; Konflikt-, Discard-, Fehler- und Sperr-Behandlung.

**Independent Test**: Bei nicht aktivem Feature Ergebnis öffnen → „Bearbeiten" → ändern → „Speichern" → nach Neu-Öffnen erhalten; externe Änderung → Konfliktdialog; laufende Phase → nur lesend; `tasks.md` unverändert speichern → `git diff` strukturell leer. (FR-007…014; SC-003/004/005)

### Implementation for User Story 2

- [X] T014 [US2] Schreibpfad in `packages/server/src/services/featureArtifacts.ts`: `writeFeatureArtifact(project, feature, phase, fileId, { content, baseMtimeMs, overwrite })` mit `featureLock`-Sperre (FR-011) und mtime-Konfliktprüfung (FR-014); Fehlerklasse `ArtifactError` mit Codes `not_found | locked | conflict` (Muster: `DefinitionError`) (depends T006)
- [X] T015 [P] [US2] Server-Tests in `packages/server/src/services/featureArtifacts.test.ts` ergänzen: Speichern-Erfolg (neue mtime), `conflict` bei mtime-Abweichung ohne `overwrite`, `locked` bei laufender Phase, `not_found` (depends T014)
- [X] T016 [US2] `PUT /api/features/:id/artifacts/:phase` (Query `file`) in `packages/server/src/api/server.ts`: 400-Validierung (`content`/`baseMtimeMs`), 409-Shape `{ error: 'conflict'|'locked', … }` inkl. `current` (identisch zur Definition-API) (depends T014, T008)
- [X] T017 [US2] `saveFeatureArtifact(featureId, phase, fileId, body)` in `packages/web/src/api.ts` unter Wiederverwendung von `SaveConflictError` (409/conflict) (depends T009)
- [X] T018 [US2] `FeatureResultDialog.tsx` erweitern: „Bearbeiten"-Button oben rechts (verborgen/deaktiviert bei `locked` + Sperr-Banner), Umschalten `MarkdownEditor` auf editierbar, Speichern via `api.saveFeatureArtifact` + Erfolgsmeldung, `dirty`-Tracking, Verwerfen-Warnung + Konflikt-Dialog (Überschreiben/Neu laden) + Speicherfehler-Meldung (Muster: `PhaseDefinitionDialog`, `ConfirmDialog`) (depends T017, T012, T011)

**Checkpoint**: US1 und US2 funktionieren unabhängig.

---

## Phase 5: User Story 3 - Claude-Session als Split-Screen zum Modal (Priority: P3)

**Goal**: Aus dem Modal die bestehende Feature-Konsole als geteilte Ansicht daneben öffnen; beide Bereiche gleichzeitig bedienbar; Schließen der Konsole lässt den Modal-Zustand unberührt.

**Independent Test**: Modal öffnen → „Split-Screen" → rechts erscheint die interaktive Feature-Konsole, Modal bleibt links sichtbar; gleichzeitig scrollen/bearbeiten und tippen; Split-Screen schließen → Modal-Zustand unverändert. (FR-015/016; SC-008)

### Implementation for User Story 3

- [X] T019 [US3] Split-Screen-Umschalter in `packages/web/src/components/FeatureResultDialog.tsx`: bei Aktivierung `TerminalPane featureId={feature.id} focused` in der rechten Hälfte des Overlays rendern (Flex-Split, Modal links); Session wird durch `TerminalPane` selbst via `api.ensureSession` sichergestellt; Schließen des Split-Screen erhält Ansicht/Editiermodus (depends T012). Kein Server-/API-Änderungsbedarf.

**Checkpoint**: Alle drei Stories eigenständig funktionsfähig.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T020 [P] `quickstart.md`-Szenarien US1–US3 manuell durchspielen (inkl. Konflikt, Sperre, Round-Trip, Mehrfach-Datei, Split-Screen)
- [X] T021 [P] `pnpm typecheck` und `pnpm test` über alle Pakete grün stellen; Typlücken/Imports beheben
- [X] T022 Kurzen Hinweis auf die Kachel-Ergebnis-Icons in `README.md` (Abschnitt „Arbeitsweise") ergänzen

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten; T001 → T002.
- **Foundational (Phase 2)**: nach Setup; T003 → T004 → T005. **Blockiert alle Stories.**
- **User Stories (Phase 3–5)**: nach Foundational. US1 = MVP. US2 nach US1 (erweitert denselben Service `featureArtifacts.ts` und dasselbe Modal). US3 nach US1 (baut auf dem Modal auf).
- **Polish (Phase 6)**: nach den gewünschten Stories.

### User Story Dependencies

- **US1 (P1)**: nur Foundational. Eigenständig testbar.
- **US2 (P2)**: Foundational + US1 (Server-Service, Endpunkt-Datei und Modal werden erweitert). Eigenständig testbar (Bearbeiten/Speichern).
- **US3 (P3)**: Foundational + US1 (Split-Screen erweitert das US1-Modal). Eigenständig testbar (Konsole neben Modal).

### Within Each User Story

- Server-Service vor Endpunkt; Client-Methode vor Dialog-Verdrahtung; `MarkdownEditor` vor `FeatureResultDialog`.
- Gleiche Datei = sequentiell: `featureArtifacts.ts` (T006→T014), `server.ts` (T008→T016), `api.ts` (T009→T017), `FeatureResultDialog.tsx` (T012→T018→T019).

### Parallel Opportunities

- **Foundational**: weitgehend sequentiell (gemeinsame `index.ts`/Typabhängigkeit).
- **US1**: T007 (Server-Tests), T009 (Client-API), T010 (Icons) parallel zueinander — verschiedene Dateien; T011 parallel zu Server-Arbeit (T006/T008).
- **US2**: T015 (Server-Tests) parallel zu T017 (Client-API).
- **Polish**: T020, T021 parallel.

---

## Parallel Example: User Story 1

```bash
# Nach T006 (Service-Lesepfad) parallel starten:
Task: "T007 Server-Tests in packages/server/src/services/featureArtifacts.test.ts"
Task: "T009 Client-Lesemethoden in packages/web/src/api.ts"
Task: "T010 Schritt-Icons in packages/web/src/components/icons.tsx"
# T011 (MarkdownEditor) parallel dazu, sobald T002-Spike steht.
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup, inkl. Editor-Spike T002) → Phase 2 (Foundational) → Phase 3 (US1).
2. **STOP & VALIDATE**: US1 gemäß Independent Test prüfen (Icons, Tooltip, WYSIWYG-Ansicht, Datei-Umschalter, „kein Ergebnis").
3. Demo-fähig als MVP.

### Incremental Delivery

1. Setup + Foundational → Basis.
2. US1 → testen → MVP.
3. US2 (Bearbeiten/Speichern) → testen → Demo.
4. US3 (Split-Screen) → testen → Demo.

### Notes

- [P] = andere Datei, keine offene Abhängigkeit.
- Zwei De-Risking-Spikes aus research.md: Editor-Round-Trip (T002, blockierend) und simultane Terminal-WS-Clients (in T019 verifizieren, Fallback: Reconnect-Handoff).
- Nach jedem Task oder logischer Gruppe committen.
