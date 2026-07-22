---
description: "Task list for Projekt-Chat als vollwertige Claude-Code-Session"
---

# Tasks: Projekt-Chat als vollwertige Claude-Code-Session

**Input**: Design documents from `specs/projekt-chat-sollte-eine-claude-code-session-sein/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Es werden gezielte Unit-/Integrationstests für die reine Domain-Logik und die
DB-/Git-Nahtstellen erzeugt (Repo-Konvention: pure State-Machines & Repos sind getestet —
vgl. `chatStream.test.ts`, `chatRepo.test.ts`). Keine UI-Tests, kein voller TDD-Zwang.

**Organization**: Aufgaben nach User Story gruppiert (unabhängig implementier-/testbar).

## Format: `[ID] [P?] [Story] Beschreibung mit Dateipfad`

- **[P]**: parallelisierbar (andere Datei, keine Abhängigkeit zu offenem Task)
- **[Story]**: US1–US4 (nur in Story-Phasen)
- Pfade relativ zum Repo-Root; Monorepo `packages/{shared,server,web}` (siehe plan.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ausgangszustand absichern (Brownfield-Erweiterung, keine neue Projektstruktur).

- [X] T001 Baseline auf dem Feature-Branch verifizieren: `pnpm install && pnpm typecheck && pnpm test` müssen grün sein (Repo-Root).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Gemeinsame Domain-Vokabeln, Migration und Repo-/PTY-Nahtstellen, die ALLE Stories brauchen.

**⚠️ CRITICAL**: Keine User-Story-Arbeit startet vor Abschluss dieser Phase.

- [X] T002 [P] Reines Modul `packages/shared/src/chatMode.ts`: `ChatMode = 'ask' | 'work'`, Konstante `CHAT_MODES`, Guard `isChatMode(x)` und `canSwitchMode(current, next)` (Wechsel ⇒ neue Unterhaltung).
- [X] T003 [P] Unit-Test `packages/shared/src/chatMode.test.ts` für Guard/Übergänge (gültige/ungültige Werte, Wechsel-Semantik).
- [X] T004 `packages/shared/src/types.ts` erweitern: `ChatConversation.mode: ChatMode`; `SessionInfo.kind` um `'chat_work'`; `AttentionItem.conversationId: string | null`; `ExecutionRecord.kind` um `'chat_work'`. Danach `chatMode` in `packages/shared/src/index.ts` re-exportieren.
- [X] T005 Additive, idempotente Migration in `packages/server/src/db/database.ts` (neuer `MIGRATIONS[]`-Eintrag): `chat_conversations.mode TEXT NOT NULL DEFAULT 'ask' CHECK(mode IN ('ask','work'))`; `sessions.conversation_id TEXT REFERENCES chat_conversations(id) ON DELETE SET NULL`; `attention.conversation_id TEXT`.
- [X] T006 [P] Migrations-/Schema-Test `packages/server/src/db/migration.test.ts`: frische DB + Migration von Alt-Schema; prüft Defaults (`mode='ask'`), Nullable-Spalten und Idempotenz (`user_version`).
- [X] T007 `packages/server/src/db/repos.ts` — `ChatRepo`: `createConversation` akzeptiert `mode`; neue `setMode(conversationId, mode)`; `getActive`/Mapper geben `mode` zurück.
- [X] T008 `packages/server/src/db/repos.ts` — `SessionRepo`: `create(...)` akzeptiert `conversationId`; neue `latestForConversation(conversationId): SessionRow | null` (analog `latestForFeature`).
- [X] T009 `packages/server/src/db/repos.ts` — `AttentionRepo`: `raise(...)` akzeptiert/persistiert `conversationId`; Dedup-Schlüssel + `listOpen`-Mapping um `conversationId` erweitern.
- [X] T010 [P] `packages/server/src/pty/snapshotStore.ts`: Schlüssel von `featureId` auf generisches `key: string` (Aufrufer übergeben `featureId` bzw. `chat-<conversationId>`); Dateiname/`save`/`load`/`remove` angepasst.
- [X] T011 `packages/server/src/pty/sessionManager.ts`: `LiveSession.kind` um `'chat_work'` und Feld `conversationId?: string`; `spawn({... conversationId?})`; Snapshot-Save/Load nutzt den generischen Key (T010); `terminate`/`subscribe` unverändert nutzbar.

**Checkpoint**: Domain-Typen, Migration, Repos und PTY-Manager tragen den Arbeits-Chat — Stories können beginnen.

---

## Phase 3: User Story 1 - Änderungen direkt aus dem Chat umsetzen lassen (Priority: P1) 🎯 MVP

**Goal**: Eine im Arbeits-Modus beschriebene Änderung wird real in einer isolierten Worktree umgesetzt und ist einsehbar.

**Independent Test**: Arbeits-Modus wählen, kleine Änderung anfordern → Änderung liegt in `~/.sdd-toolkit/worktrees/<projectId>/chat-*`, Haupt-Arbeitskopie unverändert.

- [X] T012 [US1] `packages/server/src/services/chatWorkPrompt.ts`: Work-Mode-Systemprompt (`buildChatWorkSystemPrompt(project)`) — vollwertige, eingreifende Session, arbeitet in der Worktree, fasst Änderungen zusammen.
- [X] T013 [US1] `packages/server/src/services/chatWorkService.ts` (neu) — `ensure(projectId)`: aktive `work`-Unterhaltung sicherstellen → `WorktreeManager.create({name:'chat-<shortId>', branch:'chat/<shortId>', defaultBranch})` (idempotent) → Resume-Recovery via `SessionRepo.latestForConversation` + `locateTranscript` → `buildClaudeArgv({settingsPath, permissionMode})` → `ptys.spawn({kind:'chat_work', conversationId, cwd:worktree, withHooks:true})` → `sessions.create({conversationId, kind:'chat_work'})`. Gibt `{sessionId}` zurück.
- [X] T014 [US1] `packages/server/src/services/chatWorkService.ts` — `sendPrompt(projectId, text)`: delegiert an `ptys.sendPrompt(sessionId, text)` (bracketed paste + submit).
- [X] T015 [US1] `packages/server/src/index.ts`: `ChatWorkService` konstruieren (deps: projects, chat, sessions, attention, executions, ptys, worktrees, mergeEngine, verify, settings, dataDir, model) und an `buildServer` übergeben; in Shutdown `killAll`/`terminate` einbinden.
- [X] T016 [US1] `packages/server/src/api/server.ts`: `POST /api/projects/:id/chat/mode` (Guard: kein laufender Turn, Wechsel ⇒ neue Unterhaltung), `POST /api/projects/:id/chat/work/session`, `POST /api/projects/:id/chat/work/prompt`; `GET /api/projects/:id/chat` liefert `mode` + `workSession` (siehe contracts/rest.md).
- [X] T017 [P] [US1] `packages/web/src/api.ts`: `ChatState` um `mode` + `workSession` erweitern; `setChatMode(projectId, mode)`, `ensureChatWorkSession(projectId)`, `sendChatWorkPrompt(projectId, text)`.
- [X] T018 [US1] `packages/web/src/store.tsx`: Chat-State um `mode`; `session_status` mit `featureId:null` korrekt in `app.sessions` einordnen (Zuordnung über `sessionId`/`projectId`).
- [X] T019 [US1] `packages/web/src/components/ChatPanel.tsx`: Modus-Umschalter „Fragen | Arbeiten" (sichtbar/erkennbar); im Arbeits-Modus statt Nachrichtenliste `<TerminalPane getSession={() => api.ensureChatWorkSession(projectId)} focused/>` + Prompt-Leiste (`sendChatWorkPrompt`).
- [ ] T020 [US1] Validierung Szenario 1 (quickstart.md): Änderung anfordern, `git status` (Haupt-Kopie unverändert) + `git -C <chat-worktree> diff` (Änderung sichtbar).

**Checkpoint**: US1 eigenständig funktionsfähig — der Chat setzt Änderungen real (isoliert) um. **MVP erreicht.**

---

## Phase 4: User Story 2 - Probleme diagnostizieren und lösen (Priority: P1)

**Goal**: Der Arbeits-Chat führt Diagnose-Kommandos aus, findet Ursachen, setzt Fixes um und verifiziert — Kosten werden erfasst.

**Independent Test**: Reproduzierbaren Fehler (roter Test) erzeugen, Chat um Behebung bitten → Assistent führt Kommandos aus, behebt, verifiziert (oder begründet).

- [X] T021 [US2] `packages/server/src/services/chatWorkPrompt.ts`: Systemprompt um Diagnose→Fix→Verify-Verhalten ergänzen (Kommandos ausführen, Ergebnis auswerten, betroffenes Kommando erneut prüfen, Restprobleme klar melden).
- [X] T022 [US2] `packages/server/src/services/chatWorkService.ts`: Turn-Lifecycle metern — beim `turn_completed`-Effekt der `SessionMachine` `meter()` über das Scrollback-Delta rechnen und `executions.start/finish({kind:'chat_work'})` führen (analog `Orchestrator.handleTurnCompleted`).
- [ ] T023 [US2] Validierung Szenario 2 (quickstart.md): roter Test → Chat behebt & verifiziert; Lauf erscheint als `chat_work` im Executions-View mit Kosten/Tokens.

**Checkpoint**: US1 + US2 funktionieren unabhängig; die Session löst Probleme end-to-end und ist im Audit sichtbar.

---

## Phase 5: User Story 3 - Kontrolle und Sicherheit über eingreifende Aktionen (Priority: P2)

**Goal**: Freigabe gemäß Automation-Dial, Live-Beobachtung, Unterbrechen, Verwerfen und Übernehmen (Verify→Merge).

**Independent Test**: Level 2 → eingreifende Aktion verlangt Freigabe; Fortschritt sichtbar; Unterbrechen stoppt sauber; Verwerfen entfernt Worktree/Branch restlos.

- [X] T024 [US3] `packages/server/src/api/server.ts`: `POST /api/projects/:id/chat/work/interrupt`, `.../discard` (mit `confirm`), `.../integrate` (siehe contracts/rest.md).
- [X] T025 [US3] `packages/server/src/services/chatWorkService.ts` — `interrupt(projectId)`: `ptys.terminate(sessionId)` ohne Worktree-Verlust; Session neu startbar.
- [X] T026 [US3] `packages/server/src/services/chatWorkService.ts` — `discard(projectId)`: `terminate` → `worktrees.remove(projectPath, worktreePath, {force:true})` → `mergeEngine.deleteBranch` → `snapshots.remove('chat-<id>')` → `sessions` schließen → `chat.endConversation`. Keine Rückstände in der Haupt-Kopie (FR-007).
- [X] T027 [US3] `packages/server/src/services/chatWorkService.ts` — `integrate(projectId)`: Worktree committen → `verifyService.runVerification({commands: project.verifyCommands})` → bei Erfolg `mergeEngine.mergeFeature({branch, defaultBranch, mode})` → Cleanup wie `discard`. Bei Fehler: `attention.raise({kind:'verify_failed'|'merge_conflict_escalated', conversationId})`, Worktree bleibt (FR-012). `execution kind:'chat_work'`.
- [X] T028 [US3] `packages/server/src/events.ts`: Event `chat_work_integrated {projectId, conversationId, result, detail}` in `BusEvents` + `BUS_EVENT_NAMES`.
- [X] T029 [US3] `packages/server/src/services/chatWorkService.ts`: Session-Status-Handling — bei `input_requested` (`question`/`plan_approval`/`permission`) `attention.raise({..., conversationId})` + `session_status`-Event; bei Rückkehr in `working` `attention.resolveFor`. Permission-Mode aus `resolveAutomation(global, project)` (autoMode ⇒ `bypassPermissions`, sonst `acceptEdits`).
- [X] T030 [P] [US3] `packages/web/src/components/AttentionInbox.tsx`: Einträge mit `conversationId` → „Zur Konsole →" öffnet die Sprechblase/den Chat-Panel des Projekts (statt Feature-Konsole); `featureId`-Einträge unverändert.
- [X] T031 [US3] `packages/web/src/components/ChatPanel.tsx`: Steuerleiste im Arbeits-Modus — „Unterbrechen", „Verwerfen" (ConfirmDialog), „Übernehmen"; Status-Anzeige (working/awaiting_input); `chat_work_integrated` behandeln (Konsole schließen bzw. auf Inbox verweisen).
- [X] T032 [P] [US3] `packages/web/src/api.ts`: `interruptChatWork`, `discardChatWork`, `integrateChatWork`.
- [X] T033 [US3] `packages/web/src/store.tsx`: `chat_work_integrated`-Case im WS-`onmessage`-Switch + Reducer-Action (Unterhaltung beenden bei `merged`).
- [ ] T034 [US3] Validierung Szenarien 3 + 6 (quickstart.md): Freigabe/Beobachten/Unterbrechen/Verwerfen sowie Übernehmen (grüner Verify → Merge; roter Verify → kein Merge + Inbox).

**Checkpoint**: Vollständige Kontrolle über die eingreifende Session; „nie blind mergen" gewahrt.

---

## Phase 6: User Story 4 - Weiterhin nur fragen und bei großem Umfang übergeben (Priority: P3)

**Goal**: Nur-Lese-Modus bleibt garantiert nebenwirkungsfrei; feature-würdiger Umfang wird an den bestehenden Anlege-Weg übergeben.

**Independent Test**: „Fragen"-Modus → reine Frage erzeugt keine Artefakte; feature-würdige Anforderung → Vorschlagskarte + vorbefüllter `NewFeatureDialog`.

- [X] T035 [US4] `packages/server/src/api/server.ts` + `packages/server/src/services/chatService.ts`: sicherstellen, dass Default-Modus `'ask'` unverändert den bestehenden read-only Pfad nutzt (kein Worktree/keine Artefakte) und `mode`-Wechsel eine neue Unterhaltung startet (Guard aus T016 verifizieren/festziehen).
- [X] T036 [US4] `packages/server/src/services/chatWorkPrompt.ts` + `packages/web/src/components/ChatPanel.tsx`: bei feature-würdigem Umfang Hinweis + Übergabe über bestehenden `parseFeatureProposal`/`NewFeatureDialog`/`createFeature`-Weg (Vorschlagskarte auch im Arbeits-Modus nutzbar).
- [ ] T037 [US4] Validierung Szenario 4 (quickstart.md): reine Frage ohne Artefakte; feature-würdige Anforderung → Vorschlag + vorbefüllter Dialog.

**Checkpoint**: Beide Modi koexistieren; die Nebenwirkungsfreiheit-Garantie des Nur-Lese-Chats bleibt bestehen.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T038 [P] `packages/server/src/services/orchestrator.ts` (`reapOnBoot`) bzw. `index.ts`: Boot-Reaper um `chat_work` erweitern — offene `chat_work`-Session-Zeilen schließen, laufende `chat_work`-Executions als `orphaned` markieren (FR-008).
- [X] T039 [P] Server-Integrationstest `packages/server/src/services/chatWorkService.test.ts`: Worktree-Lebenszyklus (ensure → discard entfernt Worktree/Branch/Snapshot restlos; integrate committet+merged bei grünem Verify, kein Merge bei rotem).
- [X] T040 [P] `README.md` Abschnitt „Projekt-Chat": Modi „Fragen" (lesend) / „Arbeiten" (isolierte Session, Verwerfen/Übernehmen, Automation-Dial) dokumentieren.
- [X] T041 `pnpm typecheck` und `pnpm test` über alle Pakete grün.
- [ ] T042 quickstart.md Szenarien 1–6 manuell durchspielen (inkl. Neustart-Recovery, Szenario 5).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten.
- **Foundational (Phase 2)**: nach Setup; **blockiert alle Stories**. Innerhalb: T004 nach T002; T005 vor T006/T007/T008/T009; T010 vor T011.
- **User Stories (Phase 3–6)**: alle nach Foundational.
  - US1 (P1) = MVP. US2 (P1) baut minimal auf US1 (dieselbe Session; hauptsächlich Prompt + Metering).
  - US3 (P2) und US4 (P3) nach US1.
- **Polish (Phase 7)**: nach den gewünschten Stories.

### User Story Dependencies

- **US1 (P1)**: nur Foundational. Liefert die Arbeits-Session.
- **US2 (P1)**: benötigt US1 (Session existiert); fügt Verhalten + Kosten-Metering hinzu.
- **US3 (P2)**: benötigt US1; unabhängig von US2 testbar.
- **US4 (P3)**: weitgehend unabhängig (Nur-Lese existiert bereits); nur Modus-Wahl + Übergabe.

### Same-file-Sequenzen (nicht parallelisierbar)

- `packages/server/src/db/repos.ts`: T007 → T008 → T009 (sequenziell).
- `packages/server/src/services/chatWorkService.ts`: T013 → T014 → T022 → T025 → T026 → T027 → T029.
- `packages/server/src/api/server.ts`: T016 → T024 → T035.
- `packages/web/src/components/ChatPanel.tsx`: T019 → T031 → T036.
- `packages/server/src/services/chatWorkPrompt.ts`: T012 → T021 → T036-Teil.

### Parallel Opportunities

- Phase 2: T002/T003 und T010 parallel; T006 parallel zu Repo-Tasks anderer Dateien.
- US1: T017 (api.ts) parallel zu T016 (server.ts). 
- US3: T030 (AttentionInbox) und T032 (api.ts) parallel zueinander und zu Server-Tasks.
- Phase 7: T038/T039/T040 parallel.

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Reine Domain + PTY-Store parallel starten (verschiedene Dateien):
Task: "chatMode.ts Guard/Übergänge — packages/shared/src/chatMode.ts"        # T002
Task: "chatMode.test.ts — packages/shared/src/chatMode.test.ts"              # T003
Task: "SnapshotStore generischer Key — packages/server/src/pty/snapshotStore.ts"  # T010
```

## Parallel Example: User Story 3

```bash
# Client + Inbox parallel zu den Server-Routen:
Task: "AttentionInbox conversationId-Routing — packages/web/src/components/AttentionInbox.tsx"  # T030
Task: "api.ts interrupt/discard/integrate — packages/web/src/api.ts"                            # T032
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup) → Phase 2 (Foundational, kritisch).
2. Phase 3 (US1) vollständig → **STOP & VALIDATE** (Szenario 1): Der Chat setzt Änderungen isoliert um.
3. US2 ist ein dünner Aufsatz (Prompt + Metering) — direkt danach lieferbar (beide P1).

### Incremental Delivery

1. Foundation fertig.
2. US1 → isolierte Änderung (MVP) → demo.
3. US2 → Problemlösung + Audit → demo.
4. US3 → Kontrolle (Unterbrechen/Verwerfen/Übernehmen) → demo.
5. US4 → Modus-Koexistenz + Übergabe → demo.
6. Polish (Reaper, Doku, Tests).

---

## Notes

- [P] = andere Datei, keine offene Abhängigkeit.
- Maximale Wiederverwendung: `chatWorkService` spiegelt `Orchestrator.ensureSession`; Integration nutzt `MergeEngine`+`verifyService` **direkt** (nicht die feature-gebundene `MergeQueueService`).
- Nur-Lese-Modus (`ChatService`, `buildChatArgv`, Projekt-Root) bleibt unangetastet.
- Nach jedem Task bzw. logischer Gruppe committen; an Checkpoints Story unabhängig validieren.
- Vermeiden: vage Tasks, Same-file-Konflikte, Cross-Story-Abhängigkeiten, die Unabhängigkeit brechen.
