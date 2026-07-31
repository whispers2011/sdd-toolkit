---

description: "Task list – Läufe haben kein Log (Session-Durchläufe protokollieren)"
---

# Tasks: Läufe haben kein Log – Session-Durchläufe protokollieren

**Input**: Design documents from `specs/laeufe-haben-kein-log-kein-log-vorhanden/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/executions-log.md, quickstart.md

**Tests**: Enthalten. Der Plan (research R6) und `quickstart.md` fordern Unit-Tests für den
reinen Renderer sowie Endpoint-Tests; Repo-Konvention = pure Funktionen in `@sdd/shared`
sind unit-getestet.

**Organization**: Nach User Story gruppiert (US1 = P1, US2 = P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelisierbar (andere Datei, keine offenen Abhängigkeiten)
- **[Story]**: US1 / US2 (nur in Story-Phasen)
- Pfade sind repo-relativ (Monorepo `packages/{shared,server,web}`)

---

## Phase 1: Setup

**Purpose**: Ausgangszustand absichern (Bugfix in bestehendem Monorepo — keine Init nötig)

- [X] T001 Baseline verifizieren: `pnpm install`, `pnpm typecheck`, `pnpm test` grün laufen lassen (Repo-Root), damit spätere Regressionen eindeutig dem Feature zuzuordnen sind

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Gemeinsame Bausteine, die BEIDE User Stories brauchen (Schema, Persistenz,
Transkript-Range-Reader, bereinigter Renderer)

**⚠️ CRITICAL**: Kein Story-Task startet, bevor diese Phase steht.

- [X] T002 [P] Additive DB-Migration ans Ende der Migrationsliste in `packages/server/src/db/database.ts`: `ALTER TABLE executions ADD COLUMN transcript_path TEXT;` und `ALTER TABLE executions ADD COLUMN transcript_offset_end INTEGER;`
- [X] T003 [P] Reinen Renderer `renderTranscriptLog(lines: string[]): string` in NEUER Datei `packages/shared/src/transcriptLog.ts` erstellen (Prompt/Assistant-Text/`tool_use`/`tool_result`/Abbruch-Marker → bereinigter, ANSI-freier Klartext; `meta`/kaputte Zeilen überspringen; nutzt `parseClaudeTranscriptLine`/`assistantTextFromTranscriptLine`/`INTERRUPT_MARKER_PREFIX` aus `./transcript.js`) und in `packages/shared/src/index.ts` per `export * from './transcriptLog.js';` exportieren
- [X] T004 [P] `readTranscriptRange(path: string, start: number, end: number): string[]` in `packages/server/src/pty/transcriptWatcher.ts` ergänzen (liest Bytes `[start, min(end, size))`, splittet in nicht-leere Zeilen; robust gegen fehlende/gekürzte Datei → `[]`; `readTranscriptDelta` bleibt bestehen)
- [X] T005 ExecutionRepo in `packages/server/src/db/repos.ts` erweitern (nach T002): Felder `transcriptPath: string | null` und `transcriptOffsetEnd: number | null` in `ExecutionRecord`; Methode `get(id: string): ExecutionRecord | undefined`; Methode `recordTranscriptEnd(id: string, path: string | null, offsetEnd: number): void` (UPDATE der beiden neuen Spalten); `list()`- und `get()`-Mapping um `transcript_path`/`transcript_offset_end` ergänzen (Metriken/Status unverändert — FR-008)

### Tests (Foundational)

- [X] T006 [P] Unit-Tests für `renderTranscriptLog` in NEUER Datei `packages/shared/src/transcriptLog.test.ts` (Fälle: User-Prompt, Assistant-Text, `tool_use`, `tool_result`, Abbruch-Marker, leere Eingabe, nicht-parsebare Zeile; Output enthält keine ANSI-/Steuerzeichen) — hängt an T003
- [X] T007 [P] Unit-Test für `readTranscriptRange` in NEUER Datei `packages/server/src/pty/transcriptWatcher.range.test.ts` (Ausschnitt `[start,end)`, `end` jenseits EOF wird gekappt, fehlende Datei → `[]`) — hängt an T004

**Checkpoint**: Schema, Repo-Zugriff, Range-Reader und Renderer stehen und sind getestet.

---

## Phase 3: User Story 1 - Log eines Session-Durchlaufs einsehen (Priority: P1) 🎯 MVP

**Goal**: Ein **abgeschlossener** Phasen-/Session-Lauf zeigt in der „Läufe"-Ansicht beim
„Log"-Klick seinen gerenderten Transkript-Inhalt statt „Kein Log vorhanden".

**Independent Test**: Eine Phase (z. B. specify) für ein Feature laufen lassen, in „Läufe"
die Zeile öffnen, „Log" klicken → gerenderter Lauf-Inhalt erscheint; zwei aufeinanderfolgende
Läufe zeigen je nur den eigenen Inhalt.

### Implementation for User Story 1

- [X] T008 [US1] In `packages/server/src/services/orchestrator.ts` (`handleTurnCompleted`) nach dem Metering die Transkript-Endkoordinaten persistieren: aufgelösten Transkriptpfad (`locateTranscript(session.cwd, session.claudeSessionId)`) und `transcriptSize(path)` via `this.deps.executions.recordTranscriptEnd(running.executionId, path, endOffset)` speichern (Pfad-Auflösung aus `meterTurn` wiederverwenden; Metering-Verhalten unverändert) — hängt an T005
- [X] T009 [US1] In `packages/server/src/services/orchestrator.ts` (`handleExit`, Zweig mit laufender Phase) dieselben Endkoordinaten best effort persistieren, damit auch fehlgeschlagene/abgebrochene Läufe (Status `failed`) ihr Log behalten (FR: US1-Szenario 3) — selbe Datei, nach T008
- [X] T010 [US1] In `packages/server/src/api/server.ts` den Endpoint `GET /api/executions/:id/log` erweitern: (1) ID-Regex unverändert (Fall E → 400); (2) wenn `<dataDir>/logs/<id>.log` existiert → Dateiinhalt zurückgeben (Fall A, datei-basierte Arten unverändert — FR-007); (3) sonst `deps.executions.get(id)`; bei `kind==='phase'` mit gesetztem `transcript_path` + `transcript_offset_end` → `renderTranscriptLog(readTranscriptRange(path, transcript_offset_start, transcript_offset_end))` zurückgeben (Fall B); (4) sonst 404 „Kein Log vorhanden" (Fall D) — hängt an T003, T004, T005

### Tests for User Story 1

- [X] T011 [P] [US1] Endpoint-Tests in NEUER Datei `packages/server/src/api/executionsLog.test.ts`: Fall A (physische Datei wird unverändert bedient), Fall B (abgeschlossener Phasen-Lauf rendert den begrenzten Transkript-Ausschnitt, kein Vermischen mit Folge-Bytes — FR-003), Fall D (fehlende Koordinaten → 404), Fall E (ungültige ID → 400) — hängt an T010

**Checkpoint**: Abgeschlossene Session-Durchläufe liefern ihr Log (SC-001, SC-002, SC-003 für abgeschlossene Läufe). MVP erreicht.

---

## Phase 4: User Story 2 - Konsistente Log-Verfügbarkeit über alle Lauf-Arten (Priority: P2)

**Goal**: Der „Log"-Button liefert für **jede** Art ein konsistentes Ergebnis; laufende
Phasen-Läufe zeigen den bisher verfügbaren Inhalt und aktualisieren beim erneuten Öffnen.

**Independent Test**: Für jede Art (Phase/Verify/Review/Konflikt/Chat) das Log öffnen →
Inhalt oder eindeutige Begründung; einen **laufenden** Phasen-Lauf öffnen → bisheriger
Inhalt, nach kurzer Zeit mehr.

### Implementation for User Story 2

- [X] T012 [US2] In `packages/server/src/api/server.ts` den Endpoint um Fall C (laufender Phasen-Lauf) erweitern: wenn `kind==='phase'` und `transcript_path` noch `NULL` (Lauf läuft), Pfad aus der Live-Session auflösen (`deps.ptys.forFeature(execution.featureId)` → `locateTranscript(cwd, claudeSessionId)`) und `renderTranscriptLog(readTranscriptRange(path, transcript_offset_start, transcriptSize(path)))` zurückgeben; leerer Ausschnitt → 200 mit leerem Text statt Fehler (FR-005) — selbe Datei, nach T010
- [X] T013 [US2] In `packages/web/src/components/ExecutionsView.tsx` das offene Log aktualisieren, solange der zugehörige Lauf `status==='running'` ist (periodisches Nachladen im bestehenden 5-s-`reload`-Takt bzw. Re-Fetch der offenen Log-Zeile) und die Meldungen präzisieren (laufend-aber-leer vs. „Kein Log vorhanden") — hängt an T012 (Verhalten)

### Tests for User Story 2

- [X] T014 [US2] Endpoint-Test Fall C in `packages/server/src/api/executionsLog.test.ts` ergänzen (laufender Phasen-Lauf ohne `transcript_path` rendert Ausschnitt bis zur aktuellen Größe) und explizit prüfen, dass eine datei-basierte Art (z. B. `verify`) weiterhin ihren Dateiinhalt liefert (FR-007, SC-005) — selbe Testdatei, nach T012

**Checkpoint**: Alle Arten konsistent (SC-005); laufende Läufe abrufbar (FR-005).

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T015 [P] `pnpm typecheck` und `pnpm test` (Repo-Root) grün — alle Pakete, inkl. neuer Tests
- [ ] T016 Manuelle End-to-End-Validierung nach `specs/laeufe-haben-kein-log-kein-log-vorhanden/quickstart.md` (Schritte 3–8: gerendertes Log, kein Vermischen, laufender Lauf, andere Arten unverändert, Neustart-Persistenz, großes Log ungekürzt)
- [ ] T017 [P] Kurzer Hinweis in `README.md` (Abschnitt Executions-View/Läufe): Phasen-Läufe zeigen ihr Log aus dem Transkript (nur falls Doku-Aktualität es erfordert; sonst überspringen)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: keine Abhängigkeit.
- **Foundational (T002–T007)**: nach Setup; blockiert beide User Stories.
- **US1 (T008–T011)**: nach Foundational; keine Abhängigkeit von US2.
- **US2 (T012–T014)**: nach Foundational; erweitert den in US1 geänderten Endpoint → nach T010.
- **Polish (T015–T017)**: nach den gewünschten Stories.

### Kritische Abhängigkeiten

- T005 hängt an T002 (Spalten müssen existieren).
- T008 hängt an T005 (`recordTranscriptEnd`), T009 nach T008 (selbe Datei `orchestrator.ts`).
- T010 hängt an T003 + T004 + T005; T012 nach T010 (selbe Datei `server.ts`).
- T011 nach T010; T014 nach T012 (selbe Testdatei `executionsLog.test.ts`).
- T013 nach T012 (Endpoint muss laufende Läufe unterstützen).

### Parallel Opportunities

- **Foundational**: T002, T003, T004 parallel [P] (verschiedene Dateien); danach T005; Tests T006 (nach T003) und T007 (nach T004) parallel [P].
- **US1-Tests**: T011 [P] nach T010.
- **Polish**: T015 und T017 [P].
- US1 und US2 teilen `server.ts` → dort **nicht** parallel; ansonsten könnten die Stories bei anderer Dateiaufteilung nebenläufig laufen.

---

## Parallel Example: Foundational

```bash
# Nach T001 gemeinsam starten (verschiedene Dateien):
Task T002: "Migration in packages/server/src/db/database.ts"
Task T003: "renderTranscriptLog in packages/shared/src/transcriptLog.ts (+ index.ts)"
Task T004: "readTranscriptRange in packages/server/src/pty/transcriptWatcher.ts"
# danach T005 (repos.ts), dann parallel:
Task T006: "transcriptLog.test.ts"
Task T007: "transcriptWatcher.range.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1).
2. **STOP & VALIDATE**: Abgeschlossene Phasen-Läufe zeigen ihr Log (Quickstart Schritte 3–4).
3. Auslieferbar als Fix des akuten Fehlers.

### Incremental Delivery

1. Foundational fertig → Fundament steht.
2. US1 → unabhängig testen → Fix demonstrierbar (MVP).
3. US2 → laufende Läufe + Konsistenz über alle Arten → testen → ausliefern.

---

## Notes

- [P] = andere Datei, keine offene Abhängigkeit.
- `~/.claude/**` bleibt read-only — Transkript wird nur gelesen.
- Metering/Kosten/Status/Dauer bleiben unverändert (FR-008); nur Log-Erfassung kommt hinzu.
- Keine Log-Größenbegrenzung (FR-009); Web-`<pre>` scrollt bereits.
- Commit nach jeder Task oder logischer Gruppe.
