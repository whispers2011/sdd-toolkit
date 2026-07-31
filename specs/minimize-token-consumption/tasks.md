---
description: "Task list for feature: Token-Verbrauch im SDD-Flow minimieren"
---

# Tasks: Token-Verbrauch im SDD-Flow minimieren

**Input**: Design documents from `specs/minimize-token-consumption/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Enthalten. Begründung: reine Logik-Module in `@sdd/shared` sind projektweit unit-getestet, und research.md §F definiert eine explizite Teststrategie. Tests sind auf die neuen pure Module + kritische Guards beschränkt.

**Organization**: Nach User Story gruppiert (P1 → P2 → P3), jede unabhängig testbar.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1/US2/US3
- Pfade sind Monorepo-relativ (`packages/…`), siehe plan.md „Structure Decision".

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ausgangszustand sichern; keine Neu-Initialisierung (Brownfield).

- [x] T001 Baseline verifizieren: `pnpm install && pnpm typecheck && pnpm test` grün, Arbeitsbaum sauber (Referenz für spätere Regressionsprüfung).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Additive DB-/Typ-Grundlagen, die US1 und US2/US3 gemeinsam brauchen.

**⚠️ CRITICAL**: Kein Story-Task startet vor Abschluss dieser Phase.

- [x] T002 Additive Migration in `packages/server/src/db/database.ts` (neuer `MIGRATIONS`-Eintrag): Spalten auf `executions` — `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `tokens_source`, `transcript_offset_start`, `opt_context_strategy`, `opt_compression` (alle nullable); plus `projects.optimization TEXT NOT NULL DEFAULT '{}'` und `features.optimization TEXT NOT NULL DEFAULT '{}'`. Migration muss idempotent über `user_version` laufen (bestehendes Muster).
- [x] T003 Typen in `packages/shared/src/types.ts` erweitern: `ExecutionRecord` um die neuen Token-/Opt-Felder (data-model.md §1), `Project`/`Feature` um `optimization: Partial<OptimizationSettings>`. Kein Umbenennen bestehender Felder.
- [x] T004 [P] Neues pure Modul `packages/shared/src/optimization.ts`: `OptimizationSettings`, `OPTIMIZATION_OFF_DEFAULTS`, `OPTIMIZATION_DEFAULTS`, `resolveOptimization(global, project, feature)` (Präzedenz global→Projekt→Feature, defensiv gg. unbekannte Enum-Werte). Export in `packages/shared/src/index.ts` ergänzen.

**Checkpoint**: Migration greift, `pnpm typecheck` grün → Stories können starten.

---

## Phase 3: User Story 1 - Token-Verbrauch pro Feature & Phase sichtbar machen (Priority: P1) 🎯 MVP

**Goal**: Belastbare, nach Phase/Art aufgeschlüsselte Verbrauchssicht eines Features aus autoritativer Transkript-Usage (Fallback: Schätzung), inkl. Quelle-Kennzeichnung.

**Independent Test**: Feature auswählen → `GET /api/features/:id/cost-breakdown` bzw. Executions-View liefert Gesamt + Aufschlüsselung je Phase und Art, jede Zeile mit Quelle-Badge; Summe Phasen + phasenlose Läufe == Gesamt. Ohne US2/US3 nutzbar.

### Tests for User Story 1

- [x] T005 [P] [US1] `packages/shared/src/transcriptUsage.test.ts`: Usage-Zeile geparst (4 Komponenten), gemischtes/kaputtes Fenster robust, leeres Fenster → Null-Usage, `usageToCost` gegen Referenzwert (contracts/token-usage-parser.md).
- [x] T006 [P] [US1] `packages/shared/src/costBreakdown.test.ts`: Rollup je Phase/Art, Mehrfachläufe summiert, phasenlose Läufe (verify/review) in `byKind`+`total`, Invariante `byPhase+phasenlos==total`, `sourceMix` summiert zu 1 (contracts/cost-breakdown-api.md).

### Implementation for User Story 1

- [x] T007 [P] [US1] `packages/shared/src/transcriptUsage.ts`: `parseUsageLine`, `sumUsage`, `usageToCost` (nutzt `priceFor`/`MODEL_PRICES` aus `costMeter.ts`). Export in `index.ts`.
- [x] T008 [P] [US1] `packages/shared/src/costBreakdown.ts`: `aggregateBreakdown(executions): FeatureCostBreakdown` (data-model.md §2). Export in `index.ts`.
- [x] T009 [US1] `packages/server/src/db/repos.ts` — `ExecutionRepo`: `start()` schreibt `transcript_offset_start`; neue `finishWithUsage(id, exitCode, {components, source, costUsd})`; `list()` mappt alle neuen Spalten.
- [x] T010 [US1] `packages/server/src/pty/transcriptWatcher.ts`: Helper `readTranscriptDelta(path, startOffset): string[]` (stat+read ab Offset, wie `drain`, `:82-91`) für die Usage-Auswertung.
- [x] T011 [US1] `packages/server/src/services/orchestrator.ts`: in `RunningPhase` Transkript-Offset ablegen (Start via `locateTranscript`); in `handleTurnCompleted` Delta lesen → `sumUsage`/`usageToCost` → `finishWithUsage(source:'transcript')`; bei fehlendem Transkript/Usage Fallback `meter()` (`source:'estimated'|'parsed'`).
- [x] T012 [US1] `packages/server/src/api/server.ts`: `GET /api/features/:featureId/cost-breakdown` → `aggregateBreakdown(executions.list(featureId))` (contracts/cost-breakdown-api.md); 404 unbekannt, 200+Null-Rollups bei leer.
- [x] T013 [P] [US1] `packages/web/src/api.ts`: Client-Funktion `getCostBreakdown(featureId)` + Typ-Import.
- [x] T014 [US1] `packages/web/src/components/ExecutionsView.tsx`: Rollup je Phase + Art anzeigen, Quelle-Badge (transcript/parsed/estimated), `sourceMix`; fehlendes `chat_work`-Label in KIND_LABELS ergänzen.

**Checkpoint**: US1 eigenständig funktionsfähig — Messung/Transparenz ist der MVP.

---

## Phase 4: User Story 2 - Token-Verbrauch durch smarte Kontext-Übergabe senken (Priority: P2)

**Goal**: Vor Downstream-Phasen den akkumulierten Sitzungskontext gezielt zurücksetzen (`compact`/`fresh`), konfigurierbar (global→Projekt→Feature), reversibel, mit Guard-Rückfall auf `full`.

**Independent Test**: Referenz-Feature A/B (full vs compact/fresh) bauen → `cost-breakdown?groupByOptimization=true` zeigt ≥30 % weniger Tokens (v. a. `cacheReadTokens` in plan/implement) bei identischem Gate-Ergebnis.

### Tests for User Story 2

- [x] T015 [P] [US2] `packages/shared/src/optimization.test.ts`: `resolveOptimization` Präzedenz (global<project<feature), leeres Partial erbt, unbekannter Enum-Wert → Default.
- [x] T016 [P] [US2] `packages/server/src/services/contextOptimizer.test.ts`: `full`→kein Reset; `specify`→kein Reset; `compact`/`fresh` downstream→korrektes Kommando; fehlendes Vorartefakt → `fellBackToFull=true`, kein Reset (contracts/context-optimizer.md).

### Implementation for User Story 2

- [x] T017 [P] [US2] `packages/server/src/pty/commandBuilder.ts`: `resetCommand(strategy: 'compact'|'fresh'): string` (`/compact` bzw. `/clear`).
- [x] T018 [US2] `packages/server/src/services/contextOptimizer.ts` (neu): `prepareForPhase(feature, phase, resolvedOpt)` → Reset-Entscheidung + `artifactExists`-Guard + `fellBackToFull` (Kompression noch aus; wird in US3 ergänzt).
- [x] T019 [US2] `packages/server/src/db/repos.ts`: `SettingsRepo.getOptimization()/setOptimization()`; `ExecutionRepo.start()/finishWithUsage()` persistieren `opt_context_strategy`/`opt_compression` (Snapshot).
- [x] T020 [US2] `packages/server/src/services/orchestrator.ts`: `resolveOptimization` (settings→project→feature) beim Phasenstart, Snapshot auf Execution; für Downstream-Phasen `resetCommand` via `ptys.sendPrompt` **vor** dem Phasen-Slash-Command senden; Guard-Rückfall + `console.warn`-Log.
- [x] T021 [US2] `packages/server/src/api/server.ts`: `GET`/`PATCH /api/settings/optimization`; `'optimization'` in die PATCH-`/api/projects/:id`-Whitelist (`:167`) aufnehmen; `optimization` in PATCH `/api/features/:id` (`:400`) behandeln (contracts/optimization-settings.md).
- [x] T022 [US2] `packages/web`: Optimierungs-Toggles global in `components/AutomationDial.tsx`, Projekt in `components/ProjectSettings.tsx`, Feature-Override im Feature-Header; Client-Aufrufe in `api.ts`.
- [x] T023 [US2] `groupByOptimization=true` in `packages/server/src/api/server.ts` + `byOptimization`-Rollup in `packages/shared/src/costBreakdown.ts` (+ Test-Ergänzung in `costBreakdown.test.ts`) für den A/B-Nachweis.

**Checkpoint**: US1 + US2 unabhängig funktionsfähig; A/B-Reduktion messbar.

---

## Phase 5: User Story 3 - Signalarme Inhalte verdichten (Priority: P3)

**Goal**: Deterministische Verdichtung toolkit-injizierter Inhalte (Wissen/Präambel), optional LLM mit Netto-Ersparnis-Guard, mit Audit-Report.

**Independent Test**: Projektwissen mit signalarmem Body → Phase mit `compression:'deterministic'` → materialisierter Kontext kleiner, relevante Fakten erhalten, `CompressionReport` listet Ausgelassenes; `llm` nur bei Netto-Ersparnis übernommen.

### Tests for User Story 3

- [x] T024 [P] [US3] `packages/shared/src/contextCompressor.test.ts`: Idempotenz (`compress(compress(x))==compress(x)`), Dedup/Leerzeilen-Kollaps/Log-Kürzung mit Marker, `report`-Konsistenz (`bytesAfter ≤ bytesBefore`).

### Implementation for User Story 3

- [x] T025 [P] [US3] `packages/shared/src/contextCompressor.ts` (neu): `compress(text, opts) → {text, report: CompressionReport}` (deterministisch, kein Modellaufruf). Export in `index.ts`.
- [x] T026 [US3] `packages/server/src/services/contextOptimizer.ts` erweitern: bei `compression:'deterministic'` Präambel/materialisiertes Wissen durch `compress()`; bei `'llm'` zusätzlich headless-Zusammenfassung (`buildHeadlessArgv`), nur übernehmen wenn `tokensBefore-tokensAfter > LLM-Kosten` (sonst deterministischer Fallback); `CompressionReport` zurückgeben.
- [x] T027 [US3] `packages/server/src/services/orchestrator.ts` (+ `services/knowledgeService.ts` Anbindung): verdichtete Präambel vor `sendPrompt` verwenden; `CompressionReport` protokollieren (Audit, FR-009).

**Checkpoint**: Alle drei Stories unabhängig funktionsfähig.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T028 [P] `packages/web/src/components/ExecutionsView.tsx`: Totals/`sourceMix`-Feinschliff + einfache A/B-Vergleichssicht (full vs. optimiert).
- [x] T029 [P] Doku: `README.md` (Roadmap-Eintrag + Hinweis Optimierungs-Settings) und ggf. Knowledge-Abschnitt aktualisieren.
- [ ] T030 Quickstart-Validierung (`specs/minimize-token-consumption/quickstart.md` Szenario 1–4): A/B am Referenz-Feature ausführen, ≥30 % Reduktion + identisches Gate-Ergebnis bestätigen (SC-001, SC-002).
- [x] T031 `pnpm typecheck && pnpm test` vollständig grün (inkl. neuer Tests), Regression gegen T001-Baseline.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**: sofort.
- **Foundational (P2)**: nach Setup; **blockt** alle Stories (Migration + Typen).
- **US1 (P3)**: nach Foundational — unabhängig, MVP.
- **US2 (P4)**: nach Foundational — nutzt den Execution-Schreibpfad aus US1 (T009/T011), aber eigenständig testbar über contextOptimizer + Snapshot.
- **US3 (P5)**: nach Foundational — **weiche Abhängigkeit** von US2 (T018 `contextOptimizer.ts` muss existieren; T026 erweitert ihn). Der pure Compressor (T025) ist unabhängig.
- **Polish (P6)**: nach den gewünschten Stories.

### Within Each Story

- Tests vor Implementierung schreiben und fehlschlagen lassen.
- Shared pure Module (transcriptUsage/costBreakdown/optimization/contextCompressor) vor ihren Konsumenten (repos/orchestrator/api/web).
- repos vor orchestrator; orchestrator/api vor web.

### Parallel Opportunities

- T005/T006 (US1-Tests) parallel; T007/T008 (neue shared-Module) parallel; T013 parallel zu Server-Tasks.
- T015/T016 (US2-Tests) parallel; T017 parallel zu T018-Vorbereitung.
- T024/T025 (US3) parallel.
- T028/T029 (Polish) parallel.
- **Caveat**: `packages/shared/src/index.ts` ist gemeinsamer Merge-Punkt mehrerer `[P]`-Tasks (Export-Barrel) — Export-Zeilen serialisiert einpflegen, um Konflikte zu vermeiden.

---

## Parallel Example: User Story 1

```bash
# Tests zuerst (parallel):
Task: "T005 transcriptUsage.test.ts"
Task: "T006 costBreakdown.test.ts"
# Dann neue pure Module (parallel):
Task: "T007 transcriptUsage.ts"
Task: "T008 costBreakdown.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → 4. **STOP & VALIDATE**: Breakdown-Endpoint/View liefert korrekte, quellen-gekennzeichnete Aufschlüsselung. Bereits eigenständiger Mehrwert (Kostentransparenz).

### Incremental Delivery

1. Foundation → 2. US1 (Messung, MVP) → 3. US2 (Reduktion + A/B-Nachweis ≥30 %) → 4. US3 (Verdichtung) → 5. Polish + Quickstart-Validierung.

### Reversibilität

Jederzeit `optimization = { contextStrategy:'full', compression:'off' }` (global) → bit-identisches Alt-Verhalten (FR-008), ohne Datenverlust.

---

## Notes

- [P] = andere Datei, keine offene Abhängigkeit; Ausnahme `index.ts`-Barrel (siehe Caveat).
- Alle DB-Änderungen additiv/nullable; `~/.claude/` bleibt read-only (nur Transkript lesen).
- Reduktion greift ausschließlich in Reset + toolkit-injizierte Präambel — nie in Slash-Commands, Skills oder Qualitäts-Gates (FR-006).
- Commit nach jedem Task oder logischer Gruppe; an Checkpoints Story unabhängig validieren.

---

## Implementierungs-Notizen (Stand 2026-07-22)

Umgesetzt und grün: `pnpm typecheck` (shared/server/web) + `pnpm test` (shared 92, server 54). Migration zusätzlich gegen eine Kopie der realen DB verifiziert (additiv, Bestandsdaten unversehrt).

Bewusste Abweichungen / offene Punkte (ehrlich dokumentiert):

- **T022 (teilweise)**: Optimierungs-UI global (`AutomationDial.tsx`) und pro Projekt (`ProjectSettings.tsx`) umgesetzt. Ein **Feature-Header-Override-UI** wurde nicht ergänzt — die API (`PATCH /api/features/:id { optimization }`) und `resolveOptimization` unterstützen die Feature-Ebene bereits vollständig; es fehlt nur das UI-Element.
- **T026 (teilweise)**: Deterministische Verdichtung ist verdrahtet und aktiv. Die **LLM-Verdichtung** existiert als geprüfte, injizierbare Funktion (`applyLlmCompression` + `llmResultIsWorthKeeping`, Netto-Ersparnis-Guard, getestet), wird aber **nicht inline per headless-`claude`-Spawn** ausgeführt — der Aufrufer (Summarizer) ist als Dependency vorgesehen. Grund: Inline-Spawn pro Phase ist latenz-/risikobehaftet; Default ist ohnehin deterministisch.
- **T028 (teilweise)**: Executions-View zeigt Quelle-Badges + Phasen-Rollup. Eine **dedizierte A/B-Vergleichssicht** (full vs. optimiert nebeneinander) wurde nicht gebaut; die Daten liefert `GET …/cost-breakdown?groupByOptimization=true` bereits.
- **T030 (offen)**: Der Live-A/B-Nachweis (≥30 % Reduktion) erfordert das Ausführen echter SDD-Phasen gegen die Claude-CLI und lässt sich hier headless nicht durchführen. Endpoint, Messung (autoritativ) und Opt-Snapshot stehen bereit; die Ausführung bleibt manuelle Validierung.

**Bekanntes Live-Verhalten zu verifizieren (bei T030)**: Der Kontext-Reset (`/compact`/`/clear`) wird als PTY-Prompt vor dem Phasen-Command gesendet. `/compact` löst selbst einen Modell-Turn aus; die Interaktion mit der Turn-Completion-Erkennung des Orchestrators ist gegen die echte CLI zu prüfen. Absicherung: Feature ist **default-OFF** (`SettingsRepo.getOptimization` liefert ohne gesetzten Key `full`/`off`) — ohne ausdrückliches Opt-in ändert sich das Verhalten nicht.
