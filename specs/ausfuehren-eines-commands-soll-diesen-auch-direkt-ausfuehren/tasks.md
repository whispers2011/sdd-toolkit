---
description: "Task list for Kommandos direkt ausführen statt nur vorausfüllen"
---

# Tasks: Kommandos direkt ausführen statt nur vorausfüllen

**Input**: Design documents from `specs/ausfuehren-eines-commands-soll-diesen-auch-direkt-ausfuehren/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Enthalten — die Logik liegt überwiegend in `@sdd/shared` (pur) und im Server; das Repo nutzt Vitest. Web hat im MVP keine Test-Infra → Web-Validierung erfolgt manuell via quickstart.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1 / US2 / US3
- Dateipfade sind repo-relativ zum Worktree-Root.

## Path Conventions

Web-Monorepo (pnpm): `packages/shared/src/`, `packages/server/src/`, `packages/web/src/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline sicherstellen — bestehende Codebasis, keine neuen Dependencies.

- [x] T001 Baseline verifizieren: `pnpm --filter @sdd/shared test && pnpm --filter @sdd/server test` läuft grün, bevor Änderungen beginnen.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Kleine geteilte Bausteine, die von mehreren Stories gebraucht werden.

**⚠️ CRITICAL**: Muss vor den User-Story-Phasen fertig sein.

- [x] T002 [P] Submit-Timing-Konstanten `SUBMIT_CONFIRM_MS` (~500), `MAX_SUBMIT_RETRIES` (3), `READY_TIMEOUT_MS` (~30000) neben `SUBMIT_DELAY_MS`/`SUBMIT_KEY` ergänzen in `packages/server/src/pty/commandBuilder.ts`.
- [x] T003 [P] Pure Bereitschafts-Helfer in `packages/shared/src/sessionMachine.ts` ergänzen: `isReadyForInput(state)` (true für `ready|working|turn_done|awaiting_input`), `isTerminal(state)` (`stopped|errored`); aus `packages/shared/src/index.ts` exportieren.
- [x] T004 [P] `SessionCallbacks`-Interface um optionales `onSubmitFailed(session: LiveSession, text: string): void` erweitern in `packages/server/src/pty/sessionManager.ts` (nur Typ/Signatur; Verdrahtung folgt in US1/US2).

**Checkpoint**: Konstanten, Bereitschaftsprädikat und Fehler-Callback-Typ stehen bereit.

---

## Phase 3: User Story 1 - Kommando auf der Kachel startet sofort (Priority: P1) 🎯 MVP

**Goal**: Beim Auslösen einer Kommando-Aktion wird der Befehl zuverlässig abgeschickt — auch bei frisch gespawnter Session (Kaltstart/Resume) — ohne manuelles Enter.

**Independent Test**: quickstart S1 (Kaltstart „Run") und S3 (freier Prompt) — Command wird ohne weitere Nutzeraktion ausgeführt; keine unbestätigte Eingabezeile.

### Tests for User Story 1

- [x] T005 [P] [US1] Unit-Tests für `isReadyForInput`/`isTerminal` (alle State-Kinds) in `packages/shared/src/sessionMachine.test.ts`.

### Implementation for User Story 1

- [x] T006 [US1] `LiveSession` um ephemeren Sendezustand erweitern: `pendingPrompts: string[]` und `submitPending: { text; attempts; timer } | null` in `packages/server/src/pty/sessionManager.ts` (initialisieren in `spawn`).
- [x] T007 [US1] `sendPrompt` umbauen (in `packages/server/src/pty/sessionManager.ts`): bei `isReadyForInput` → Bracketed Paste + CR nach `SUBMIT_DELAY_MS` und Bestätigung starten; sonst Prompt in `pendingPrompts` einreihen. Abhängig von T002, T003, T006.
- [x] T008 [US1] Queue-Flush: beim Übergang der Session-Maschine nach `ready` `pendingPrompts` FIFO über den Sendepfad abspülen — in `dispatch()` von `packages/server/src/pty/sessionManager.ts`. Abhängig von T006, T007.
- [x] T009 [US1] Submit-Bestätigung + Retry: nach CR auf Übergang nach `working` bzw. `user_prompt_submit`-Hook warten; bleibt er im `SUBMIT_CONFIRM_MS`-Fenster aus → CR bis `MAX_SUBMIT_RETRIES` wiederholen; bei Erschöpfung / `READY_TIMEOUT_MS`-Überschreitung / terminalem State → `callbacks.onSubmitFailed` aufrufen. In `packages/server/src/pty/sessionManager.ts`. Abhängig von T007, T008, T004.
- [x] T010 [US1] Server-Unit-Tests für `sendPrompt` in `packages/server/src/pty/sessionManager.test.ts`: (a) Kaltstart `created` → einreihen, nach `ready` genau ein Submit; (b) bereite Session → sofortiges Submit, Bestätigung via `working`; (c) ausbleibende Bestätigung → `MAX_SUBMIT_RETRIES` CRs; (d) Erschöpfung → genau ein `onSubmitFailed`; (e) zwei aufeinanderfolgende `sendPrompt` behalten Reihenfolge. Abhängig von T006–T009.

**Checkpoint**: „Run"/„Start" schickt Kommandos zuverlässig ab (Kaltstart & Resume teilen denselben Pfad — spec US1 AC4). MVP funktionsfähig.

---

## Phase 4: User Story 2 - „Läuft …" spiegelt den echten Zustand (Priority: P2)

**Goal**: „läuft …" erscheint nur bei tatsächlicher Ausführung; Startfehler und unterbrochene Läufe erscheinen im „braucht dich"-Zustand statt als falsches „läuft …".

**Independent Test**: quickstart S2 (Statuswahrheit), S6 (Startfehler → braucht dich), S4 (Neustart → braucht dich, fortsetzbar).

### Tests for User Story 2

- [x] T014 [US2] Server-Unit-Tests in `packages/server/src/services/orchestrator.test.ts`: (a) `startPhaseRun` mit fehlschlagendem `ensureSession` → Phase zurück auf `idle` + genau ein `agent_errored`-AttentionItem; (b) `reapOnBoot` mit verwaister `running`-Phase → Phase `idle` + `run_interrupted`-AttentionItem. Abhängig von T012, T013.

### Implementation for User Story 2

- [x] T011 [P] [US2] Additiven `AttentionKind 'run_interrupted'` in `packages/shared/src/types.ts` ergänzen (rein additiv zur bestehenden Union).
- [x] T012 [US2] `startPhaseRun` absichern in `packages/server/src/services/orchestrator.ts`: `ensureSession`/`launchPhase` in try/catch; bei Fehler Phase `running → idle` zurückrollen (persistieren + `feature_updated`) und `attention.raise({ kind: 'agent_errored', … })` + `attention_raised`; zusätzlich `onSubmitFailed`-Callback beim Session-Spawn registrieren, der denselben Rollback+Attention-Pfad auslöst. Abhängig von T004, T009.
- [x] T013 [US2] `reapOnBoot` erweitern in `packages/server/src/services/orchestrator.ts`: für jede verwaiste `running`-Phase (weiterhin auf `idle` gesetzt) ein `attention.raise({ kind: 'run_interrupted', message: '<feature>: Lauf unterbrochen — per Run fortsetzbar' })` erzeugen. Abhängig von T011.
- [x] T015 [P] [US2] `KanbanBoard.tsx` (`packages/web/src/components/KanbanBoard.tsx`): „läuft …"-Badge nur wenn `phaseState.status==='running' && session?.status ∈ {working,awaiting_input}`; transitorisch „wird gestartet …" wenn `running` + lebende Session `idle`; kein Badge wenn keine lebende / `stopped`/`errored`-Session (erscheint via „braucht dich").
- [x] T016 [P] [US2] `FeatureConsole.tsx` PhaseStrip (`packages/web/src/components/FeatureConsole.tsx`): `animate-pulse` nur im echten „läuft …"-Fall (gleiche Ableitung wie T015), sonst dezente „wird gestartet …"-Kennzeichnung.

**Checkpoint**: Kein falsches „läuft …"; Startfehler und Neustart-Unterbrechungen sind als „braucht dich" sichtbar (SC-003, FR-003/FR-004/FR-009).

---

## Phase 5: User Story 3 - Einheitliches Verhalten an allen Auslösepunkten (Priority: P3)

**Goal**: Alle Kommando-Auslösepunkte führen direkt aus; freie Prompts unverändert; bewusste Einfüge-/Bestätigungs-Pfade bleiben ausgenommen; keine Doppel-Ausführung.

**Independent Test**: quickstart S3 (freier Prompt), S7 (Init/Bild-Pfad bleiben nur eingefügt), S8 (Doppelklick → ein Lauf).

### Tests for User Story 3

- [x] T018 [P] [US3] Server-Test in `packages/server/src/api/server.test.ts`: `init-speckit`-Route und `paste-image`-Route rufen `ptys.write` (kein CR), **nicht** `sendPrompt` — Regressionsschutz für FR-007/FR-010.

### Implementation for User Story 3

- [x] T017 [US3] „läuft bereits"/Doppel-Start nutzerfreundlich behandeln: den spezifischen Fehler aus schnellem Doppelklick nicht als rohen Fehler-Toast anzeigen (in der `call()`-Fehlerbehandlung von `packages/web/src/components/KanbanBoard.tsx` und `packages/web/src/components/FeatureConsole.tsx`); bestehende Guards (Start nur bei `idle`; PhaseStrip disabled bei `runningPhase`) bestätigen.
- [x] T019 [P] [US3] Verifizieren & festschreiben, dass alle echten Kommando-Auslösepunkte über `sendPrompt` laufen (Phasen-Start via Orchestrator, `POST /api/features/:id/prompt`/PromptBar „Senden", Review-Feedback) und die PromptBar unverändert automatisch absendet — kurzer Regressionstest/Assertion in `packages/server/src/api/server.test.ts` bzw. Prüfnotiz.

**Checkpoint**: „Überall"-Verhalten einheitlich; Ausnahmen (Init/Bild-Pfad) bewahrt; keine Doppel-Ausführung; keine Prompt-Regression (FR-005/FR-006/FR-007/FR-008/FR-010).

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T020 [P] Submit-Timing-Konstanten gegen reale Kaltstart-Latenz feinjustieren und Werte kommentieren in `packages/server/src/pty/commandBuilder.ts`.
- [ ] T021 quickstart.md-Szenarien S1–S8 manuell in der laufenden App durchführen und Ergebnisse festhalten. (Automatisiert bereits abgedeckt: S1/S3 via `sessionManager.test.ts`, S4/S6 via `orchestrator.test.ts`, S7 via `server.test.ts`. Offen bleibt die Live-GUI/TUI-Begehung inkl. echtem Kaltstart-Timing, Ruhezustand/Neustart — vom Nutzer in der laufenden App auszuführen.)
- [x] T022 [P] Entwickler-Kommentare an der Send-Pipeline aktualisieren (Bereitschafts-Gate/Bestätigung) in `packages/server/src/pty/sessionManager.ts` — keine Nutzer-Doku nötig.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten.
- **Foundational (Phase 2)**: nach Setup; blockiert alle Stories.
- **User Stories (Phase 3–5)**: alle nach Foundational.
  - US1 ist die Grundlage (zuverlässiges Absenden). US2 verdrahtet den `onSubmitFailed`-Callback aus US1 (T012 hängt an T009). US3 ist überwiegend Regression/Verifikation und kann nach Foundational weitgehend unabhängig laufen.
- **Polish (Phase 6)**: nach den gewünschten Stories.

### User Story Dependencies

- **US1 (P1)**: nur Foundational. Eigenständig testbar (S1/S3).
- **US2 (P2)**: Foundational + T009 (für die `onSubmitFailed`-Verdrahtung in T012). UI-Tasks (T015/T016) sind unabhängig davon testbar.
- **US3 (P3)**: nur Foundational; berührt teils dieselben Dateien wie US2 (Web), daher Reihenfolge beachten.

### Within Each Story

- Tests der puren Logik (T005) unabhängig; Server-`sendPrompt`-Tests (T010) nach Impl.
- `sessionManager.ts`-Tasks (T006→T007→T008→T009) sind sequentiell (gleiche Datei).
- `orchestrator.ts`-Tasks (T012→T013) sequentiell (gleiche Datei).

### Parallel Opportunities

- Foundational: T002, T003, T004 parallel (verschiedene Dateien).
- US1: T005 parallel zur Impl (andere Datei).
- US2: T011, T015, T016 parallel; T012/T013 sequentiell.
- US3: T018, T019 parallel zu T017.

---

## Parallel Example: Foundational

```bash
# Gemeinsam startbar (verschiedene Dateien, keine gegenseitige Abhängigkeit):
Task: "T002 Submit-Timing-Konstanten in packages/server/src/pty/commandBuilder.ts"
Task: "T003 Bereitschafts-Helfer in packages/shared/src/sessionMachine.ts"
Task: "T004 onSubmitFailed in SessionCallbacks (packages/server/src/pty/sessionManager.ts)"
```

## Parallel Example: User Story 2 UI

```bash
Task: "T011 AttentionKind 'run_interrupted' in packages/shared/src/types.ts"
Task: "T015 läuft-Ableitung in packages/web/src/components/KanbanBoard.tsx"
Task: "T016 PhaseStrip-Puls in packages/web/src/components/FeatureConsole.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1).
2. **STOP & VALIDATE**: quickstart S1 + S3 — „Run" führt Kommandos tatsächlich aus.
3. Das allein löst die Kern-Beschwerde (Befehl wird nicht mehr nur vorausgefüllt).

### Incremental Delivery

1. Setup + Foundational → Fundament steht.
2. + US1 → zuverlässiges Absenden (MVP, S1/S3).
3. + US2 → wahrhaftige Statusanzeige + „braucht dich" für Fehler/Unterbrechung (S2/S4/S6).
4. + US3 → Einheitlichkeit, Scope-Ausnahmen, Doppelklick-Härtung (S7/S8), keine Regression (S3).
5. Polish → Feinjustierung + vollständiger quickstart-Durchlauf.
