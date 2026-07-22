# Tasks: Ask-a-Question-Bot (Projekt-Chat)

**Input**: Design documents from `specs/ask-a-question-bot/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/chat-api.md](./contracts/chat-api.md), [quickstart.md](./quickstart.md)

**Tests**: Unit-Tests sind enthalten, wo Plan/Quickstart sie explizit fordern (reine Funktionen + ChatRepo, Vitest, kolokiert). Keine Web-Tests (bestehender MVP-Stand des Repos).

**Organization**: Tasks sind nach User Stories gruppiert; jede Story ist nach ihrem Checkpoint unabhängig testbar (Quickstart-Szenarien).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelisierbar (andere Dateien, keine Abhängigkeit von offenen Tasks)
- **[Story]**: US1 (Projektfragen), US2 (Feature-Übergabe), US3 (projektunabhängige Fragen)

## Path Conventions

pnpm-Monorepo: `packages/shared/src/`, `packages/server/src/`, `packages/web/src/` (siehe plan.md → Project Structure).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Gemeinsame Typen, auf denen Server und Web aufbauen

- [x] T001 Typen erweitern: `ChatConversation`, `ChatMessage`, `FeatureProposal` neu anlegen und `ExecutionKind`-Union um `'chat'` erweitern in `packages/shared/src/types.ts` (Formen exakt wie contracts/chat-api.md); Re-Exports in `packages/shared/src/index.ts`; `KIND_LABELS` um `chat: 'Chat'` ergänzen in `packages/web/src/components/ExecutionsView.tsx` (Record über `ExecutionInfo['kind']` bricht sonst den Typecheck)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Persistenz, Parser, CLI-Builder und Bus-Events — Voraussetzung für alle Stories

**⚠️ CRITICAL**: Keine User-Story-Arbeit vor Abschluss dieser Phase

- [x] T002 Migration `chat_conversations` + `chat_messages` (Spalten/Constraints aus data-model.md, partieller UNIQUE-Index „eine aktive Unterhaltung pro Projekt", Index `(conversation_id, created_at)`) als neuen Eintrag ans **Ende** des `MIGRATIONS`-Arrays in `packages/server/src/db/database.ts`
- [x] T003 `ChatRepo` nach bestehendem Repo-Muster (nanoid(10), Prepared Statements, `toX`-Mapper) in `packages/server/src/db/repos.ts`: `getActive(projectId)`, `createConversation`, `endConversation`, `setClaudeSessionId`, `listMessages`, `createMessage`, `appendDelta`, `finalizeMessage(status, error?, proposal?, costUsd?, tokens?)`, `setProposalStatus`, `interruptStreaming()` (Boot-Cleanup, abhängig von T002)
- [x] T004 [P] Unit-Tests `ChatRepo` mit `openMemoryDatabase()` (Invariante „eine aktive pro Projekt", Lazy-Erzeugung, Statusübergänge streaming→complete/error/interrupted, Proposal terminal) in `packages/server/src/db/chatRepo.test.ts`
- [x] T005 [P] Reiner stream-json-Zeilenparser `parseChatStreamLine()` (→ `session_id`-Init, Text-Delta, Result mit Kosten/Tokens, unbekannte Events ignorieren) in `packages/shared/src/chatStream.ts`, Re-Export in `packages/shared/src/index.ts`
- [x] T006 [P] Unit-Tests `chatStream` (Init-, Delta-, Result-, Garbage-Zeilen, unvollständiges JSON) in `packages/shared/src/chatStream.test.ts`
- [x] T007 [P] `buildChatArgv(prompt, {resume?, systemPrompt, model?})` neben `buildHeadlessArgv` in `packages/server/src/pty/commandBuilder.ts`: `--output-format stream-json --include-partial-messages`, `--resume`, `--append-system-prompt`, `--allowedTools "Read,Grep,Glob"`, **kein** `--permission-mode acceptEdits` (R1/R2)
- [x] T008 [P] Bus-Events `chat_stream` `{projectId, conversationId, messageId, delta, done}` und `chat_updated` `{projectId, conversationId}` in `BusEvents` + `BUS_EVENT_NAMES` in `packages/server/src/events.ts` (Payloads aus contracts/chat-api.md)

**Checkpoint**: Fundament steht — User Stories können beginnen

---

## Phase 3: User Story 1 - Allgemeine Frage zum Projekt stellen (Priority: P1) 🎯 MVP

**Goal**: Sprechblase unten rechts in der Projektansicht öffnet ein Chat-Panel; projektbezogene Q&A-Session (rein lesend, streamend), Verlauf überlebt Panel-Schließen und App-Neustart; keinerlei Feature-Artefakte durch reines Chatten.

**Independent Test**: Quickstart Szenario 1 + 4 — Frage stellen, Antwort mit Projektbezug streamt < 15 s; `git status --porcelain` leer, keine neuen Features/Worktrees; Verlauf nach Server-Neustart vollständig, Folgefrage behält Kontext.

### Implementation for User Story 1

- [x] T009 [US1] System-Prompt-Builder `buildChatSystemPrompt(project)` (Rolle Q&A-Assistent, Projektname/-pfad als Kontext, strikt lesend, Antwortsprache = Nutzersprache) in `packages/server/src/services/chatService.ts`-Nachbardatei `packages/server/src/services/chatPrompt.ts`
- [x] T010 [US1] `ChatService` in `packages/server/src/services/chatService.ts`: `sendMessage(projectId, content)` — Lazy-Conversation via ChatRepo, User- + Assistant-Nachricht (`streaming`) anlegen, Spawn via `buildChatArgv` mit `cwd = project.path` (`node:child_process.spawn`, Muster `conflictResolver.ts`), stdout zeilenweise durch `parseChatStreamLine` → `appendDelta` + `bus.emitEvent('chat_stream')`, `session_id` → `setClaudeSessionId`, Abschluss → `finalizeMessage('complete')` + `chat_updated`; Fehler/Timeout 20 min → `finalizeMessage('error', meldung)`; genau eine laufende Antwort pro Konversation (In-Memory-Map, sonst Conflict); Resume-Fallback: bei `--resume`-Fehlschlag einmalig ohne Resume neu starten, letzte 10 Nachrichten als Kontextblock voranstellen (R4); außerdem `getState(projectId)` und `reset(projectId)` (laufenden Prozess killen → `interrupted`, `endConversation`)
- [x] T011 [US1] Boot-Cleanup: `chat.interruptStreaming()` beim Serverstart aufrufen (Analog `reapOnBoot`) in `packages/server/src/index.ts`
- [x] T012 [US1] Routen in `buildServer()` in `packages/server/src/api/server.ts` + `ApiDeps` um `chat: ChatService` erweitern: `GET /api/projects/:id/chat` (200/404), `POST /api/projects/:id/chat/messages` (202/400/404/409), `POST /api/projects/:id/chat/reset` (200/404) — Statuscodes/Payloads exakt nach contracts/chat-api.md
- [x] T013 [US1] DI-Verdrahtung in `packages/server/src/index.ts`: `ChatRepo` + `ChatService` konstruieren, in `buildServer({...})` übergeben, Shutdown-Handler killt laufende Chat-Prozesse
- [x] T014 [P] [US1] Client-Methoden `getChat(projectId)`, `sendChatMessage(projectId, content)`, `resetChat(projectId)` in `packages/web/src/api.ts`
- [x] T015 [US1] WS-Handling im `ws.onmessage`-Switch von `packages/web/src/store.tsx`: `chat_stream` (Delta an lokalen Streaming-Puffer anhängen), `chat_updated` (Panel-Reload-Signal); UI-State für Panel offen/zu + laufender Stream im Store oder lokal im Panel (Entscheidung dokumentieren)
- [x] T016 [P] [US1] `ChatBubble.tsx` in `packages/web/src/components/ChatBubble.tsx`: schwebende Sprechblasen-Schaltfläche `fixed bottom-… right-… z-50` (Overlay-Muster wie `QuickSwitcher.tsx`), Toggle fürs Panel, dezenter Aktivitätsindikator bei laufendem Turn
- [x] T017 [US1] `ChatPanel.tsx` in `packages/web/src/components/ChatPanel.tsx`: Nachrichtenliste (User/Assistent-Bubbles, Auto-Scroll, ältere per Scroll erreichbar), Eingabefeld (Enter sendet, Senden deaktiviert solange Turn läuft → 409-Schutz), Lade-/Fehler-/`interrupted`-Darstellung (FR-010), Button „Neue Unterhaltung" (`resetChat`), Verlauf laden via `getChat` beim Öffnen und bei `chat_updated`
- [x] T018 [US1] `ChatBubble` in `packages/web/src/App.tsx` mounten, gerendert nur wenn `state.selectedProjectId !== null` (FR-001, Clarification 2)

**Checkpoint**: US1 unabhängig testbar (Quickstart Szenario 1 + 4) — MVP erreicht

---

## Phase 4: User Story 2 - Aus dem Chat ein Feature erstellen (Priority: P2)

**Goal**: Assistent erkennt feature-würdige Anforderungen, emittiert Vorschlag-Marker; UI zeigt Vorschlag-Karte; Annahme öffnet den bestehenden Anlege-Dialog vorbefüllt; Anlage läuft über den unveränderten `createFeature`-Pfad; Entscheidung wird am Vorschlag verbucht.

**Independent Test**: Quickstart Szenario 2 — feature-würdige Anforderung → Karte erscheint; „Feature anlegen" → vorbefüllter Dialog → Feature in Übersicht mit Worktree + Specify-Start; Ablehnen/Dialog-Abbruch ohne Seiteneffekte; einfache Frage → keine Karte.

### Implementation for User Story 2

- [x] T019 [P] [US2] Reiner Marker-Parser `parseFeatureProposal(text)` → `{cleanText, proposal: {name, description} | null}` für `<feature-vorschlag name="kebab-slug">…</feature-vorschlag>` in `packages/shared/src/chatProposal.ts`, Re-Export in `packages/shared/src/index.ts`
- [x] T020 [P] [US2] Unit-Tests `chatProposal` (kein Marker, ein Marker mitten im Text, mehrere Marker → nur erster zählt, fehlendes/kaputtes name-Attribut, leere Beschreibung → kein Vorschlag) in `packages/shared/src/chatProposal.test.ts`
- [x] T021 [US2] System-Prompt um Vorschlag-Protokoll erweitern in `packages/server/src/services/chatPrompt.ts`: Marker-Format exakt vorgeben; nur bei Umfang jenseits einer Frage vorschlagen, nie bei einfachen/Wissensfragen; nach Ablehnung nicht bei jeder Nachricht wiederholen, nur bei wesentlich erweitertem Umfang (Edge Case der Spec)
- [x] T022 [US2] `ChatService`: beim Turn-Abschluss `parseFeatureProposal` auf den Antworttext anwenden, bereinigten Text + `proposal` (Status `offen`) via `finalizeMessage` persistieren in `packages/server/src/services/chatService.ts`
- [x] T023 [US2] Route `PATCH /api/chat/messages/:messageId/proposal` (`{status: 'angenommen', featureId}` | `{status: 'abgelehnt'}`; 404 ohne Vorschlag, 409 wenn bereits entschieden) in `packages/server/src/api/server.ts` + Client-Methode `decideChatProposal(...)` in `packages/web/src/api.ts`
- [x] T024 [P] [US2] `NewFeatureDialog` aus `packages/web/src/components/Sidebar.tsx` in eigene exportierte Komponente `packages/web/src/components/NewFeatureDialog.tsx` extrahieren, optionale Props `initialName`/`initialDescription` + `onCreated(featureId)`; `Sidebar.tsx` auf Import umstellen (Verhalten unverändert)
- [x] T025 [US2] Vorschlag-Karte im ChatPanel (`proposal` auf Assistenten-Nachricht): Name + Beschreibung, Buttons „Feature anlegen" / „Ablehnen", Status-Badge offen/angenommen/abgelehnt in `packages/web/src/components/ChatPanel.tsx`
- [x] T026 [US2] Annahme-/Ablehnungs-Flow in `packages/web/src/components/ChatPanel.tsx`: „Feature anlegen" öffnet `NewFeatureDialog` vorbefüllt → nach `onCreated` `decideChatProposal(angenommen, featureId)` + Bestätigungszeile mit Link zur Feature-Konsole (`set_view {kind:'console', featureId}`, FR-011); Dialog-Abbruch lässt Vorschlag `offen`; „Ablehnen" → `decideChatProposal(abgelehnt)`, Unterhaltung läuft weiter (FR-008)

**Checkpoint**: US1 und US2 unabhängig testbar (Quickstart Szenario 2)

---

## Phase 5: User Story 3 - Projektunabhängige Fragen stellen (Priority: P3)

**Goal**: Projektfremde Fragen werden im selben Chat normal beantwortet — ohne erzwungenen Projektbezug und ohne Fehlalarm-Vorschläge.

**Independent Test**: Quickstart Szenario 3 — allgemeine Wissensfrage → hilfreiche Antwort ohne Projektbezug, keine Vorschlag-Karte.

### Implementation for User Story 3

- [x] T027 [US3] System-Prompt präzisieren in `packages/server/src/services/chatPrompt.ts`: projektunabhängige Fragen direkt beantworten (kein erzwungener Projektbezug, keine Projektrecherche nötig), bei reinen Wissensfragen niemals Feature-Vorschläge
- [x] T028 [US3] Verhaltens-Validierung nach `specs/ask-a-question-bot/quickstart.md` Szenario 3 + SC-005-Stichprobe (10 gemischte Eingaben: ≥ 8/10 feature-würdige erkannt, ≤ 1/10 Fehlalarm); Prompt in `packages/server/src/services/chatPrompt.ts` bei Abweichung nachschärfen

**Checkpoint**: Alle User Stories unabhängig funktionsfähig

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Kosten-Transparenz, Doku, Gesamtvalidierung

- [x] T029 [P] Kosten-Metering (R7): pro abgeschlossenem Turn `executions`-Zeile `kind: 'chat'` (`project_id` gesetzt, `feature_id` NULL) über `ExecutionRepo`; Kosten/Tokens primär aus stream-json-Result, Fallback `costMeter.meter()`; Werte zusätzlich auf der Assistenten-Nachricht (`cost_usd`, `tokens`) in `packages/server/src/services/chatService.ts`
- [x] T030 [P] Dezente Kosten-/Token-Anzeige an abgeschlossenen Assistenten-Nachrichten in `packages/web/src/components/ChatPanel.tsx`
- [x] T031 [P] Doku: Abschnitt „Projekt-Chat (Ask-a-Question)" mit Sprechblase, Read-only-Garantien und Feature-Übergabe in `README.md`
- [x] T032 Gesamtvalidierung: `pnpm -r typecheck` und `pnpm -r test` grün; alle Szenarien aus `specs/ask-a-question-bot/quickstart.md` (1–5) durchspielen und Abweichungen fixen

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine — sofort startbar
- **Foundational (Phase 2)**: braucht T001 — blockiert alle Stories
- **User Stories (Phase 3–5)**: brauchen Phase 2; US2 baut UI-seitig auf dem ChatPanel aus US1 auf (T025/T026 ändern `ChatPanel.tsx`), US3 nur auf `chatPrompt.ts` aus US1
- **Polish (Phase 6)**: nach den gewünschten Stories (T029/T030 setzen US1 voraus)

### Task-Ebene (wichtigste Kanten)

- T002 → T003 → T004; T003 → T010
- T005/T007/T008 → T010; T009 → T010 → T011/T012 → T013
- T014/T015 → T017; T016/T017 → T018
- T019 → T020/T022; T021/T022/T023/T024 → T025 → T026
- T010 → T029 → T030

### Parallel Opportunities

- Phase 2: T004, T005+T006, T007, T008 parallel (nach T002/T003 für T004)
- US1: T014 ∥ T016 (∥ Server-Tasks T009–T013); Web und Server unabhängig bearbeitbar
- US2: T019+T020 ∥ T021 ∥ T024
- Polish: T029 ∥ T030 ∥ T031

## Parallel Example: User Story 2

```bash
# Nach Phase 2 gleichzeitig starten:
Task: "Marker-Parser parseFeatureProposal in packages/shared/src/chatProposal.ts"
Task: "Unit-Tests in packages/shared/src/chatProposal.test.ts"
Task: "System-Prompt-Erweiterung in packages/server/src/services/chatPrompt.ts"
Task: "NewFeatureDialog-Extraktion in packages/web/src/components/NewFeatureDialog.tsx"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001) + Phase 2 (T002–T008)
2. Phase 3 (T009–T018) → **STOP & VALIDATE**: Quickstart Szenario 1 + 4
3. Demo-fähig: Chat mit Projektfragen, persistent, artefaktfrei

### Incremental Delivery

1. MVP (US1) validieren
2. US2 (T019–T026) → Quickstart Szenario 2 → die eigentliche SDD-Integration
3. US3 (T027–T028) → Quickstart Szenario 3
4. Polish (T029–T032) → Kosten sichtbar, Doku, Gesamtabnahme

## Notes

- Migrations-Array nur erweitern, nie editieren (Konvention `db/database.ts`)
- Neue Logik als reine Funktionen in `@sdd/shared` halten (Testkultur des Repos)
- Commit je Task oder logischer Gruppe (`feat(chat): …`)
- FR-004-Wächter: Chat-Turns laufen ausschließlich mit `buildChatArgv` (Whitelist Read/Grep/Glob), niemals `buildHeadlessArgv` (das `acceptEdits` setzt)
