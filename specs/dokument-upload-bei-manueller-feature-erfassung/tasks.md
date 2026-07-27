# Tasks: Dokument-Upload bei manueller Feature-Erfassung

**Input**: Design documents from `/specs/dokument-upload-bei-manueller-feature-erfassung/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Tests sind Teil dieses Features — [quickstart.md](./quickstart.md) benennt die erwarteten Testdateien namentlich, und SC-006 („zeichengleicher Prompt ohne Dokumente") ist ohne Test nicht haltbar. Testtasks sind daher enthalten.

**Organization**: Aufgaben sind nach User Story gruppiert, damit jede Story unabhängig umgesetzt und geprüft werden kann.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallel ausführbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: zugehörige User Story (US1, US2, US3)
- Dateipfade sind repo-relativ und exakt

## Path Conventions

pnpm-Monorepo, keine neuen Pakete (siehe plan.md → Project Structure):

- `packages/shared/src/` — pure, testbare Logik (Typen, Grenzen, Prompt-Text)
- `packages/server/src/services/` — Dateisystem, Git, Orchestrierung
- `packages/server/src/api/server.ts` — alle HTTP-Routen
- `packages/web/src/` — React-Oberfläche (kein Test-Harness, MVP-Konvention)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ausgangszustand sichern; es gibt nichts zu initialisieren (bestehendes Monorepo, keine neue Abhängigkeit)

- [X] T001 Ausgangsbasis grün festhalten: `pnpm typecheck` und `pnpm -r test` im Repo-Root ausführen und das Ergebnis notieren, damit spätere Fehlschläge diesem Feature zuzuordnen sind
- [X] T002 [P] Bestätigen, dass `@fastify/multipart` in `packages/server/src/api/server.ts:117` bereits mit `limits.fileSize = 25 * 1024 * 1024` registriert ist — **keine** neue Abhängigkeit installieren (plan.md → Technical Context)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure Bausteine, die alle drei Stories brauchen — Typen, Grenzen, Prompt-Text und die gehärtete Dateinamen-Behandlung

**⚠️ CRITICAL**: Keine User-Story-Arbeit vor Abschluss dieser Phase

- [X] T003 [P] Neues Modul `packages/shared/src/featureDocuments.ts` anlegen mit den Typen `FeatureDocument` (`name`, `storedName`, `relPath`, `bytes`, `mimeType`, `uploadedAt`), `RejectedDocument` (`name`, `reason`), `FeatureDocumentsResult` (`feature`, `documents`, `rejected`) und `DocumentManifest` (`version`, `documents`) gemäß data-model.md
- [X] T004 Konstanten `MAX_DOCUMENT_BYTES = 25 * 1024 * 1024`, `MAX_DOCUMENTS_PER_FEATURE = 20`, `DOCUMENTS_DIR_NAME = 'docs'`, `DOCUMENTS_MANIFEST = 'documents.json'` sowie `formatBytes(bytes: number): string` (Ausgabe wie `1.2 MB`, `4.3 KB`) in `packages/shared/src/featureDocuments.ts` ergänzen (data-model.md → Konstanten)
- [X] T005 `buildDocumentsPreamble(phase: FeaturePhase, docs: FeatureDocument[]): string` in `packages/shared/src/featureDocuments.ts` implementieren — leerer String bei `docs.length === 0`, sonst führendes `\n\n`, Kopfzeile `[Dokumente] Zu diesem Feature wurden N Dokumente hinterlegt (Ablage: <dir>/):`, je Dokument `` - `name` → relPath (größe) ``, Schlusszeile phase-abhängig (specify vs. übrige) — exakt nach `contracts/document-preamble.md` (hängt von T003, T004 ab)
- [X] T006 `export * from './featureDocuments.js';` in `packages/shared/src/index.ts` ergänzen (hängt von T003 ab)
- [X] T007 [P] Tests `packages/shared/src/featureDocuments.test.ts`: leerer String ohne Dokumente (FR-017/SC-006), specify-Schlusszeile vs. Schlusszeile der übrigen Phasen (FR-006/FR-007), Name **und** Fundort je Eintrag, kein Dateiinhalt im Text (FR-009), `formatBytes` für Byte/KB/MB
- [X] T008 [P] Neues Modul `packages/server/src/services/safeFilename.ts` mit `sanitizeFilename(name: string, fallback?: string): string` (Pfadseparatoren → `_`, führende Punkte entwerten, Steuerzeichen/NUL entfernen, auf 200 Zeichen vor der Endung kürzen, leerer Rest → `fallback ?? 'dokument'`) und `uniqueFilename(name: string, used: Set<string>): string` (Suffix `-2`, `-3`, … vor der Endung) gemäß research.md R7
- [X] T009 `resolveInside(dir: string, name: string): string | null` in `packages/server/src/services/safeFilename.ts` ergänzen — gibt den absoluten Zielpfad zurück, wenn `resolve(dir, name)` unterhalb von `resolve(dir) + sep` liegt, sonst `null` (Muster aus `knowledgeService.safeRepoRelative`, `knowledgeService.ts:161`)
- [X] T010 [P] Tests `packages/server/src/services/safeFilename.test.ts`: `../../etc/passwd`, `.ssh`, Steuerzeichen, > 200 Zeichen, doppelter Name → `-2`, leerer Rest → Fallback, `resolveInside` weist Ausbrüche ab (FR-005)
- [X] T011 `packages/server/src/services/jiraImportService.ts` auf das gemeinsame Modul umstellen: lokale `sanitizeFilename`/`uniqueFilename` (Zeilen 310–323) löschen, aus `./safeFilename.js` importieren, Fallback-Name `'anhang'` als Argument übergeben; `packages/server/src/services/jiraImportService.test.ts` muss unverändert grün bleiben (hängt von T008, T009 ab)

**Checkpoint**: Prompt-Text, Grenzen und Dateinamen-Härtung stehen isoliert getestet bereit — die User Stories können beginnen

---

## Phase 3: User Story 1 - Dokumente beim Anlegen eines Features mitgeben (Priority: P1) 🎯 MVP

**Goal**: Im Dialog „Neues Feature" lassen sich Dateien mitgeben; sie landen unverändert in `specs/<slug>/docs/` im Worktree, werden committet, und der anschließend gestartete Specify-Lauf bekommt den Verweis darauf im Auftrag.

**Independent Test**: Feature anlegen mit einer Datei, die eine im Beschreibungstext nicht genannte Anforderung enthält (quickstart.md → Szenario 1). Prüfen: Datei liegt byte-identisch unter `specs/<slug>/docs/`, `git log --oneline -1` zeigt den Dokument-Commit, der gesendete Specify-Prompt enthält den `[Dokumente]`-Block, und die erzeugte `spec.md` greift die Anforderung auf.

### Tests for User Story 1 ⚠️

> **NOTE**: Diese Tests zuerst schreiben und fehlschlagen sehen, bevor T015–T019 umgesetzt werden

- [X] T012 [P] [US1] Tests `packages/server/src/services/featureDocuments.test.ts`: Datei byte-identisch geschrieben (FR-003), `documents.json` mit Anzeigename + abgelegtem Namen + Größe + Zeitpunkt (data-model.md), Namenskollision → `bericht.txt`/`bericht-2.txt` ohne Überschreiben (FR-005), Ablehnungsgründe für 0 Byte / > 25 MB / > 20 Dokumente / unsicherer Dateiname im Wortlaut aus `contracts/feature-documents-api.md`, Schreibfehler einer Datei landet in `rejected` statt zu werfen (FR-012/FR-011/FR-014)
- [X] T013 [P] [US1] Contract-Tests in `packages/server/src/api/server.test.ts` für `POST /api/projects/:id/features/with-documents`: 200 mit `feature`/`documents`/`rejected`, 400 bei fehlendem `name`, 400 bei Datei-Part vor `name`, 400 ohne Datei, 404 bei unbekanntem Projekt (contracts/feature-documents-api.md)
- [X] T014 [US1] Test in `packages/server/src/api/server.test.ts`: schlägt `createFeature` fehl (Name existiert bereits), wurde **keine** Datei geschrieben und kein `docs/`-Ordner angelegt (FR-015)

### Implementation for User Story 1

- [X] T015 [US1] Server-Service `packages/server/src/services/featureDocuments.ts` anlegen: `docsDir(project, feature)` (Worktree bevorzugt, Rückfall `project.path` — Muster `featureArtifacts.featureSpecsDir`, `featureArtifacts.ts:16`), `writeDocuments()` schreibt jeden Stream über `resolveInside`+`uniqueFilename` direkt nach `specs/<slug>/docs/`, sammelt Fehler in `rejected[]` statt zu werfen, schreibt `documents.json` und committet Ordner + Manifest per `git add`/`git commit` (research.md R1/R2/R6, hängt von T003–T010 ab)
- [X] T016 [US1] `listDocuments(featureId)` in `packages/server/src/services/featureDocuments.ts` ergänzen: Manifest lesen, `relPath` aus dem Speicherort ableiten, Einträge ohne vorhandene Datei auslassen, unlesbares/ungültiges Manifest ⇒ leere Liste ohne Fehler (data-model.md → DocumentManifest)
- [X] T017 [US1] Route `POST /api/projects/:id/features/with-documents` in `packages/server/src/api/server.ts` registrieren: `req.parts({ limits: { fileSize: MAX_DOCUMENT_BYTES }, throwFileSizeLimit: false })` iterieren, Reihenfolge-Guard (Datei vor `name` → 400), `orchestrator.createFeature(projectId, name)` **ohne** description, dann Dokumente schreiben, dann `orchestrator.startPhaseRun(featureId, 'specify', description)` — auch bei leerer description (FR-010, research.md R3/R4)
- [X] T018 [US1] `featureDocuments: FeatureDocumentsService` in `ApiDeps` (`packages/server/src/api/server.ts:73`) ergänzen und den Service in `packages/server/src/index.ts` (neben `jiraImport`, Zeile 137/196) instanziieren und durchreichen
- [X] T019 [US1] `Orchestrator.launchPhase()` in `packages/server/src/services/orchestrator.ts:419` erweitern: Dokumente frisch aus dem Manifest lesen (in `try/catch`, Fehler ⇒ leerer Block, nie ein blockierter Phasenstart) und `buildDocumentsPreamble(phase, docs)` in der Reihenfolge `base + docsBlock + [Wissens-Präambel] + templateHint(phase)` einsetzen — ohne Dedupe, bei jedem Phasenstart (research.md R5, contracts/document-preamble.md)
- [X] T020 [P] [US1] `createFeatureWithDocuments(projectId, name, description, files)` in `packages/web/src/api.ts` ergänzen: `FormData` in der Reihenfolge `name`, `description`, dann alle Dateien; direkter `fetch` wie `pasteImage` (`api.ts:242`), da `request()` kein multipart kann (contracts/feature-documents-api.md → Client-Methoden)
- [X] T021 [US1] `packages/web/src/components/NewFeatureDialog.tsx` erweitern: verstecktes `<input type="file" multiple>` mit Auswahl-Button, Drop-Zone mit `onDragOver`/`onDrop`, Liste der gewählten Dateien mit Name und `formatBytes(size)` (FR-001, FR-002)
- [X] T022 [US1] Absende-Verzweigung in `packages/web/src/components/NewFeatureDialog.tsx`: ohne gewählte Dateien unverändert `api.createFeature()` (JSON), mit Dateien `api.createFeatureWithDocuments()`; in beiden Fällen wie bisher zur Feature-Konsole navigieren (research.md R9, FR-017)

**Checkpoint**: US1 ist vollständig — Dokument mitgeben → Spezifikation baut darauf auf. MVP lieferbar.

---

## Phase 4: User Story 2 - Dokumente bleiben über alle Arbeitsschritte verfügbar (Priority: P2)

**Goal**: Der Verweis steckt in **jedem** Phasenauftrag — auch nach `/compact`/`/clear`, in der Auto-Progress-Kette und nach neu aufgesetztem Worktree; nach der Integration bleibt nachvollziehbar, welches Material zugrunde lag.

**Independent Test**: Feature mit einem Dokument anlegen, das ein erst in der Umsetzung nötiges Detail enthält; `plan`, `tasks`, `implement` nacheinander starten (Kontext-Optimierung auf `compact`/`fresh`) und in der Konsole prüfen, dass jeder gesendete Prompt den `[Dokumente]`-Block mit denselben Fundorten trägt (quickstart.md → Szenario 2).

> Die Injektion selbst fällt bereits mit T019 an (`launchPhase` deckt alle Startwege ab). Diese Phase sichert sie ab und schließt die Lücken nach Reset und Merge.

### Tests for User Story 2 ⚠️

- [X] T023 [P] [US2] Test in `packages/server/src/services/orchestrator.test.ts`: der `[Dokumente]`-Block steckt im Prompt aller drei Startwege — regulärer `startPhaseRun` (`orchestrator.ts:317`), Gate-Fortsetzung (`:349`) und `startAgentForApprovedChain` (`:558`) (FR-007, SC-003)
- [X] T024 [US2] Test in `packages/server/src/services/orchestrator.test.ts`: bei `contextStrategy` `compact` bzw. `fresh` enthält auch der Phasenstart **nach** dem Reset den vollständigen Block — kein Dedupe wie bei der Wissens-Präambel (FR-008, research.md R5)
- [X] T025 [US2] Test in `packages/server/src/services/orchestrator.test.ts`: ohne Dokumente ist der gesendete Prompt **zeichengleich** mit dem heutigen (`base + templateHint(phase)`) — kein leerer Abschnitt, keine zusätzlichen Tokens (FR-017, SC-006)
- [X] T026 [US2] Test in `packages/server/src/services/orchestrator.test.ts`: fehlendes, leeres oder syntaktisch defektes `documents.json` führt zu einem Phasenstart ohne Block statt zu einem Fehler (data-model.md → best-effort wie `knowledgePreambleFor`)
- [X] T027 [P] [US2] Test in `packages/server/src/services/featureDocuments.test.ts`: ist `feature.worktreePath` `null` (Worktree nach dem Merge entfernt), liest `listDocuments` weiterhin aus `<project.path>/specs/<slug>/docs/` (SC-007, US2-AS4)

### Implementation for User Story 2

- [X] T028 [US2] Prompt-Länge gegen Dateigröße absichern in `packages/shared/src/featureDocuments.test.ts`: ein 20-MB-Dokument erzeugt denselben Blocktext wie ein 2-KB-Dokument (nur die Größenangabe unterscheidet sich) — Gegenprobe zu FR-009
- [X] T029 [US2] Nachziehen, was die Tests T023–T027 aufdecken, in `packages/server/src/services/orchestrator.ts` bzw. `packages/server/src/services/featureDocuments.ts` — insbesondere Rückfall auf `project.path` und `try/catch` um das Manifest-Lesen

**Checkpoint**: US1 und US2 funktionieren unabhängig; das Material bleibt über Planung, Aufgabenbildung, Umsetzung und Integration präsent

---

## Phase 5: User Story 3 - Auswahl prüfen, korrigieren und später einsehen (Priority: P3)

**Goal**: Vor dem Anlegen lässt sich die Auswahl korrigieren, Grenzen sind sichtbar und Verstöße werden benannt; am angelegten Feature ist die Dokumentliste einsehbar und ein Dokument mit einem Klick zu öffnen.

**Independent Test**: Im Dialog mehrere Dateien wählen, eine entfernen, eine 0-Byte- und eine 30-MB-Datei hinzufügen, zwei gleichnamige Dateien mitgeben, Feature anlegen — dann am Feature die Liste öffnen und ein Dokument starten (quickstart.md → Szenario 3).

### Tests for User Story 3 ⚠️

- [X] T030 [P] [US3] Contract-Tests in `packages/server/src/api/server.test.ts` für `GET /api/features/:id/documents`: Liste aus dem Manifest, leeres Array ohne Dokumente (kein Fehler), 404 bei unbekanntem Feature/Projekt (contracts/feature-documents-api.md)
- [X] T031 [US3] Contract-Tests in `packages/server/src/api/server.test.ts` für `POST /api/features/:id/documents/open`: `{ ok: true }` bei Treffer, 404 bei nicht im Manifest gelistetem `storedName`, 404 bei fehlender Datei — und der Wert wird nie direkt als Pfad verwendet (FR-005, research.md R8)

### Implementation for User Story 3

- [X] T032 [US3] Route `GET /api/features/:id/documents` in `packages/server/src/api/server.ts` registrieren, Antwort direkt aus `featureDocuments.listDocuments()` (hängt von T016, T018 ab)
- [X] T033 [US3] Route `POST /api/features/:id/documents/open` in `packages/server/src/api/server.ts` registrieren: `storedName` gegen die Manifest-Einträge prüfen, Treffer per Systemöffner starten (`open <pfad>` wie im `target === 'finder'`-Zweig, `server.ts:862`), niemals `editorCmd` (FR-013, FR-016)
- [X] T034 [P] [US3] `featureDocuments(featureId)` und `openFeatureDocument(featureId, storedName)` in `packages/web/src/api.ts` ergänzen (Muster `api.featureArtifacts`, `api.ts:277`)
- [X] T035 [US3] `packages/web/src/components/NewFeatureDialog.tsx`: Entfernen-Knopf je Listeneintrag, der ausschließlich diesen Eintrag aus der Auswahl nimmt (FR-002, US3-AS1)
- [X] T036 [US3] `packages/web/src/components/NewFeatureDialog.tsx`: Grenzen aus `MAX_DOCUMENT_BYTES`/`MAX_DOCUMENTS_PER_FEATURE` sichtbar im Dialog anzeigen, bevor eine Datei gewählt wird (FR-018), und schon bei der Auswahl gegen sie prüfen — abgelehnte Dateien werden benannt, die übrige Auswahl bleibt bestehen (FR-011, FR-012, SC-001)
- [X] T037 [US3] `packages/web/src/components/NewFeatureDialog.tsx`: `rejected[]` aus der Antwort über den bestehenden Fehlerkanal des Stores melden (`dispatch({ type: 'error', message })`, `packages/web/src/store.tsx:83`) und trotzdem zur Feature-Konsole navigieren — das Feature ist angelegt (FR-014, SC-005, research.md R10)
- [X] T038 [P] [US3] Neue Komponente `packages/web/src/components/FeatureDocumentsDialog.tsx`: hinterlegte Dokumente mit Name, Größe und Fundort listen, Klick ruft `api.openFeatureDocument()` (FR-016)
- [X] T039 [US3] `packages/web/src/components/FeatureConsole.tsx`: `HeaderIcon` „Dokumente" neben den bestehenden Icons (Zeilen 74–94) einhängen, das den `FeatureDocumentsDialog` öffnet — nur sichtbar, wenn das Feature Dokumente hat (hängt von T034, T038 ab)
- [X] T040 [US3] `packages/web/src/components/FeatureDashboard.tsx`: Abschnitt „Dokumente" neben dem bestehenden Abschnitt „Artefakte" (Zeile 50) mit derselben Liste und demselben Öffnen-Verhalten (SC-007)

**Checkpoint**: Alle drei User Stories sind unabhängig funktionsfähig

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Abschluss über alle Stories hinweg

- [X] T041 [P] Icon für „Dokumente" in `packages/web/src/components/icons.tsx` ergänzen, falls dort noch keines passt (wird von T039/T040 genutzt)
- [X] T042 `pnpm typecheck` und `pnpm -r test` im Repo-Root grün — insbesondere `packages/server/src/services/jiraImportService.test.ts` nach der Umstellung aus T011
- [ ] T043 Pfad-Härtung ohne Browser prüfen: `curl`-Aufruf aus quickstart.md → Szenario 3 („Pfad-Härtung") gegen eine eigene Instanz auf einem freien Port ausführen; `/tmp/entkommen.txt` darf **nicht** entstehen (FR-005)
- [ ] T044 Manuelle Validierung quickstart.md Szenario 1, 2 und 4 auf einer eigenen Instanz — Instanz auf freien Ports starten, **nicht** 4820/4830, und gezielt per `lsof -ti:<port> | xargs -r kill` beenden (CLAUDE.md)
- [ ] T045 Manuelle Validierung quickstart.md Szenario 3 und 5 (Grenzen, Kollisionen, Ansicht, Fehlerfälle inkl. schreibgeschütztem `docs/`-Ordner); anschließend `rm -rf /tmp/doc-test` und die Testfeatures im Toolkit löschen
- [X] T046 [P] `specs/dokument-upload-bei-manueller-feature-erfassung/checklists/requirements.md` durchgehen und die abgedeckten Punkte abhaken

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten
- **Foundational (Phase 2)**: nach Setup — **blockiert alle User Stories**
- **US1 (Phase 3)**: nach Phase 2
- **US2 (Phase 4)**: nach Phase 2; nutzt praktisch T019 aus US1 (die Injektion ist dort bereits erledigt) — als eigenständiger Nachweis aber getrennt lauffähig
- **US3 (Phase 5)**: nach Phase 2; die Listen-Route setzt auf T016/T018 aus US1 auf
- **Polish (Phase 6)**: nach den gewünschten Stories

### User Story Dependencies

- **US1 (P1)**: unabhängig, direkt nach Phase 2 startbar — die MVP-Story
- **US2 (P2)**: baut inhaltlich auf US1 auf (ohne Dokumente gibt es keinen Verweis zu prüfen), ist aber eine eigene, für sich abnehmbare Nachweis-Schicht
- **US3 (P3)**: benötigt aus US1 nur `listDocuments`/`ApiDeps` (T016, T018); Dialog-Teile (T035–T037) hängen an T021/T022

### Within Each User Story

- Tests zuerst schreiben und fehlschlagen sehen
- Shared-Typen → Server-Service → Route → Web-Client → Komponente
- `packages/shared` vor `packages/server` vor `packages/web`

### Parallel Opportunities

- **Phase 2**: T003, T007, T008, T010 parallel — verschiedene Dateien. T004/T005/T006 folgen T003 (dieselbe Datei bzw. Abhängigkeit), T011 folgt T008/T009
- **US1**: T012 und T013 parallel (verschiedene Dateien); T014 danach in derselben Datei wie T013. T020 (Web-API) parallel zu allen Server-Tasks
- **US2**: T023–T026 liegen alle in `orchestrator.test.ts` — nacheinander in einem Durchgang; T027 parallel dazu in `featureDocuments.test.ts`
- **US3**: T030 und T031 nacheinander (beide `server.test.ts`); T034 und T038 parallel zu den Route-Tasks
- **Übergreifend**: Sobald Phase 2 steht, können US1 (Server) und die Web-Vorarbeiten aus US3 (T038) getrennt bearbeitet werden

---

## Parallel Example: User Story 1

```bash
# Tests für User Story 1 gemeinsam anlegen (verschiedene Dateien):
Task: "Tests packages/server/src/services/featureDocuments.test.ts (Schreiben, Manifest, Ablehnungsgründe)"
Task: "Contract-Tests für POST /features/with-documents in packages/server/src/api/server.test.ts"

# Danach getrennt lauffähig:
Task: "Server-Service packages/server/src/services/featureDocuments.ts"
Task: "createFeatureWithDocuments in packages/web/src/api.ts"
```

## Parallel Example: Phase 2 (Foundational)

```bash
Task: "Typen in packages/shared/src/featureDocuments.ts"
Task: "packages/server/src/services/safeFilename.ts"
Task: "Tests packages/server/src/services/safeFilename.test.ts"
Task: "Tests packages/shared/src/featureDocuments.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T011) — **blockiert alles Weitere**
3. Phase 3: US1 (T012–T022)
4. **STOP und VALIDIEREN**: quickstart.md Szenario 1 und Szenario 4 durchspielen
5. Damit ist der Kernnutzen da: Dokument mitgeben → Spezifikation baut darauf auf

### Incremental Delivery

1. Setup + Foundational → Fundament steht
2. US1 → Szenario 1 + 4 prüfen → MVP
3. US2 → Szenario 2 prüfen → Material bleibt über alle Schritte präsent
4. US3 → Szenario 3 + 5 prüfen → Korrigieren, Grenzen, Einsehen
5. Polish (T041–T046)

### Parallel Team Strategy

Nach Phase 2:

1. Entwickler A: US1 Server (T012–T019)
2. Entwickler B: US1 Web (T020–T022) und vorgezogen `FeatureDocumentsDialog` (T038)
3. Entwickler C: US2-Nachweise (T023–T029), sobald T019 steht

---

## Notes

- **Keine neue Abhängigkeit, keine DB-Migration** — `@fastify/multipart` ist registriert, der Zustand liegt vollständig auf Disk (research.md R2)
- **Reihenfolge ist die Sicherung**: Feature anlegen → Dokumente schreiben → Specify starten. Scheitert Schritt 1, wurde noch nichts geschrieben (FR-015)
- **`launchPhase` ist der einzige Injektionspunkt** — dort laufen alle drei Startwege zusammen; ein zweiter Ort wäre Redundanz und Driftrisiko
- **Der zeichengleiche Prompt ohne Dokumente (T025) ist kein Komfort-Test**, sondern die einzige Absicherung von SC-006 gegen spätere Änderungen
- **Prozesse niemals über generische Muster beenden** (`pkill -f "vite"` o. ä.) — eigene Testinstanzen nur über den eigenen Port abräumen (CLAUDE.md)
- Commit nach jeder Aufgabe oder logischen Gruppe; an jedem Checkpoint lässt sich die Story eigenständig abnehmen
