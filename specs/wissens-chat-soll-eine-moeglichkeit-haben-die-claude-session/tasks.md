---
description: "Task list for Wissens-Chat neu starten (frische Session)"
---

# Tasks: Wissens-Chat neu starten (frische Session)

**Input**: Design documents from `specs/wissens-chat-soll-eine-moeglichkeit-haben-die-claude-session/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/restart-endpoint.md, quickstart.md

**Tests**: Nicht in der Spec verlangt, aber der Server nutzt eine bestehende `vitest`-Suite und plan/quickstart
definieren konkrete Invarianten (INV-1…INV-5). Es werden daher gezielte Server-Tests je Story aufgenommen.
Web ohne Testsuite (MVP) → nur manuelle Validierung (quickstart.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Kann parallel laufen (andere Datei, keine offenen Abhängigkeiten)
- **[Story]**: Zugehörige User Story (US1/US2/US3)
- Pfade sind repo-relativ und konkret.

## Path Conventions

pnpm-Monorepo: `packages/server/src/`, `packages/web/src/`, `packages/shared/src/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ausgangslage sichern — keine neuen Pakete/Abhängigkeiten.

- [X] T001 Abhängigkeiten sicherstellen und Baseline prüfen: `pnpm install`, dann `pnpm --filter @sdd/server test` und `pnpm typecheck` grün als Ausgangspunkt (kein Dateiänderung; Repo-Root).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Gemeinsame Typen für Server + Web.

**⚠️ CRITICAL**: Muss vor den User-Story-Phasen stehen (Server und Web referenzieren den Typ).

- [X] T002 [P] Restart-Antworttypen in `packages/shared/src/types.ts` ergänzen: `ChatWorkRestartResult = { sessionId: string; conversationId: string }` und `ChatWorkRestartNeedsConfirm = { needsConfirm: true; reason: 'running' | 'dirty' }`; über den Paket-Index (`packages/shared/src/index.ts`) exportieren.

**Checkpoint**: Typen verfügbar — Story-Implementierung kann beginnen.

---

## Phase 3: User Story 1 - Chat per Icon neu starten (Priority: P1) 🎯 MVP

**Goal**: Klick auf ein SVG-Neustart-Icon beendet die aktive Unterhaltung und startet eine frische,
leere Claude-Session, die automatisch bereitsteht — ohne Altkontext.

**Independent Test**: Chat öffnen, Nachrichten austauschen, Icon klicken → Konsole leer, neue Session
sofort bedienbar, kennt den alten Verlauf nicht (quickstart US1, Schritte 1–4).

### Tests for User Story 1 ⚠️

- [X] T003 [P] [US1] Vitest für den Neustart-Happy-Path in `packages/server/src/services/chatWorkService.test.ts`: INV-1 (nach `restart` neue aktive Conversation, alte hat `ended_at` gesetzt), INV-2 (`listMessages(oldId)` liefert weiterhin die alten Nachrichten), INV-3 (neue aktive Conversation hat `claude_session_id === null`).

### Implementation for User Story 1

- [X] T004 [US1] `restart(projectId, { confirm })` (Happy-Path, ohne Guard/Git-Cleanup) in `packages/server/src/services/chatWorkService.ts`: aktive Conversation holen; laufende PTY-Session via `ptys.forConversation(oldConvId)` → `terminate(id)` + `remove(id)`; flüchtigen Feature-Vorschlag der alten `conversationId` löschen (`proposals`/`lastMarker`, FR-009); `chatRepo.endConversation(oldConvId)`; `chatRepo.createConversation(projectId, 'work')`; `await this.ensure(projectId)`; `bus.emitEvent('chat_updated', …)`; Rückgabe `{ sessionId, conversationId }`.
- [X] T005 [US1] Route `POST /api/projects/:id/chat/work/restart` in `packages/server/src/api/server.ts` neben den bestehenden `chat/work/*`-Routen registrieren; Body `{ confirm?: boolean }`; delegiert an `deps.chatWork.restart(req.params.id, { confirm })`.
- [X] T006 [P] [US1] Client-Methode `restartChatWorkSession(projectId, confirm)` in `packages/web/src/api.ts` (POST `/api/projects/${projectId}/chat/work/restart`, Body `{ confirm }`, Rückgabe `{ sessionId; conversationId }`).
- [X] T007 [US1] In `packages/web/src/components/ChatPanel.tsx` den `TerminalPane`-Remount-Key von `key={projectId}` auf `key={conversationId ?? 'boot'}` umstellen, damit ein Neustart die Konsole sauber neu aufbaut (FR-005) und automatisch mit der neuen Session verbindet (FR-004).
- [X] T008 [US1] In `packages/web/src/components/ChatPanel.tsx` den `RestartIcon`-Button in den Panel-Kopf (neben Schließen) einfügen: `title="Chat neu starten"`; onClick → `api.restartChatWorkSession(projectId, false)`, bei Erfolg `load()`/Neu-Ensure auslösen; Button während laufendem Request deaktivieren (Doppelklick-Schutz, FR-008). (409-Behandlung folgt in US2.)

**Checkpoint**: US1 eigenständig funktionsfähig — sichtbarer, sauberer Neustart mit Auto-Start.

---

## Phase 4: User Story 2 - Versehentlichen Verlust vermeiden (Priority: P2)

**Goal**: Vor dem Verwerfen warnen, wenn die Session arbeitet ODER unbestätigte Änderungen in der
Arbeitskopie liegen; ruhende, saubere Session startet ohne Rückfrage sofort neu.

**Independent Test**: Bei laufender/dirty Session Icon klicken → Bestätigungsdialog; bestätigen → Neustart;
abbrechen → alles bleibt. Bei ruhender, sauberer Session → sofortiger Neustart ohne Dialog (quickstart US2).

**Depends on**: US1 (erweitert `restart` und den Icon-Klick-Flow; keine Parallelität mit US1 auf denselben Dateien).

### Tests for User Story 2 ⚠️

- [X] T009 [P] [US2] Vitest für den Guard in `packages/server/src/services/chatWorkService.test.ts`: dirty Worktree bzw. laufende Session ohne `confirm` → 409 mit passendem `reason`, nichts verworfen; mit `confirm: true` → Neustart wird durchgeführt.

### Implementation for User Story 2

- [X] T010 [US2] `restart` in `packages/server/src/services/chatWorkService.ts` um den Guard erweitern: Worktree-Pfad der alten Conversation bestimmen (über `worktrees.list(projectPath)` Match auf Branch `chat/<oldConvId>`); `hasWork = liveStatus ∈ {working, awaiting_input} || !isCleanWorkingTree(worktreePath)`; wenn `hasWork && !confirm` → `throw new ChatError(409, …)` mit `reason` (`'running'`|`'dirty'`), bevor etwas verworfen wird (`isCleanWorkingTree` aus `../git/git.js` importieren).
- [X] T011 [US2] Route in `packages/server/src/api/server.ts` so anpassen, dass der 409-Fall als `{ needsConfirm: true, reason }` serialisiert wird (ChatError-409 → Body mappen), 200 unverändert `{ sessionId, conversationId }`.
- [X] T012 [US2] Confirm-Flow in `packages/web/src/components/ChatPanel.tsx`: bei 409 `needsConfirm` Bestätigung anzeigen (mit Hinweis auf `reason`); bei Zustimmung → `api.restartChatWorkSession(projectId, true)`; bei Abbruch → keine Änderung.

**Checkpoint**: US1 + US2 funktionieren — Warnung nur bei tatsächlicher Arbeit, sonst reibungslos.

---

## Phase 5: User Story 3 - Ressourcen aufräumen (Priority: P3)

**Goal**: Verworfene Session beenden und ihre isolierte Arbeitskopie samt Branch fallenlassen; genau
eine aktive Wissens-Chat-Session pro Projekt, keine Leichen.

**Independent Test**: Chat mehrfach neu starten → genau eine aktive Session/Worktree; `git worktree list`
und `git branch --list 'chat/*'` zeigen keine verwaisten `chat-<id>` der alten Unterhaltungen (quickstart US3).

**Depends on**: US1 (erweitert dieselbe `restart`-Methode).

### Tests for User Story 3 ⚠️

- [X] T013 [P] [US3] Vitest in `packages/server/src/services/chatWorkService.test.ts`: INV-4 (nach mehreren `restart` genau eine aktive Session) und INV-5 (kein Worktree/Branch `chat/<oldConvId>` bleibt zurück).

### Implementation for User Story 3

- [X] T014 [US3] `restart` in `packages/server/src/services/chatWorkService.ts` um Git-Cleanup erweitern: alten Worktree `worktrees.remove(projectPath, oldWorktreePath, { force: true })` und Branch `chat/<oldConvId>` löschen (best-effort `.catch(() => {})`); falls `deleteBranch` nicht verfügbar ist, `MergeEngine`/`deleteBranch`-Helfer in `ChatWorkDeps` (Konstruktor + `packages/server/src/api/server.ts`-Verdrahtung) ergänzen.
- [X] T015 [US3] Idempotenz-/Einzigkeits-Absicherung in `packages/server/src/services/chatWorkService.ts`: sicherstellen, dass bei schnell aufeinanderfolgenden `restart`-Aufrufen keine zweite parallele Session entsteht (z. B. In-Flight-Guard je Projekt) und `ensure` genau eine aktive Session zurückliefert (FR-008).

**Checkpoint**: Alle drei Stories eigenständig funktionsfähig; keine verwaisten Ressourcen.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Abschluss und Verifikation.

- [X] T016 [P] `pnpm typecheck` und `pnpm --filter @sdd/server test` ausführen und alle Befunde beheben (Repo-Root).
- [X] T017 [P] Doc-Kommentar von `restart` in `packages/server/src/services/chatWorkService.ts` und den Header-Kommentar in `packages/web/src/components/ChatPanel.tsx` um das Neustart-Verhalten ergänzen.
- [ ] T018 Manuelle Validierung gemäß `specs/wissens-chat-soll-eine-moeglichkeit-haben-die-claude-session/quickstart.md` (US1–US3 + Edge-Case-Checks) durchführen.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten.
- **Foundational (Phase 2)**: nach Setup; blockiert die Stories (gemeinsamer Typ).
- **US1 (Phase 3)**: nach Foundational — liefert MVP.
- **US2 (Phase 4)**: nach US1 (erweitert `restart` + Icon-Flow).
- **US3 (Phase 5)**: nach US1 (erweitert `restart`); unabhängig von US2, aber gleiche Datei → nicht mit US2 parallel auf `chatWorkService.ts`.
- **Polish (Phase 6)**: nach den gewünschten Stories.

### User Story Dependencies

- **US1 (P1)**: nur Foundational. MVP, eigenständig testbar.
- **US2 (P2)**: baut auf US1s Endpoint/Flow auf; eigenständig testbar (Guard-Verhalten).
- **US3 (P3)**: baut auf US1s `restart` auf; eigenständig testbar (Cleanup-Invarianten).

### Within Each User Story

- Test zuerst schreiben (soll fehlschlagen), dann implementieren.
- Server-Service vor Route vor Frontend-Verdrahtung.

### Parallel Opportunities

- T002 (Foundational) steht allein.
- In US1: T003 (Test) und T006 (`api.ts`) sind [P] gegenüber der Server-Service-Arbeit (andere Dateien).
- Achtung: T004/T010/T014/T015 bearbeiten **alle** `chatWorkService.ts` → **nicht** untereinander parallel.
- T007/T008/T012 bearbeiten **alle** `ChatPanel.tsx` → **nicht** untereinander parallel.

---

## Parallel Example: User Story 1

```bash
# Nach T004/T005 (Server) parallel möglich (andere Dateien):
Task T003: "Vitest Happy-Path in packages/server/src/services/chatWorkService.test.ts"
Task T006: "Client-Methode restartChatWorkSession in packages/web/src/api.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1.
4. **STOP & VALIDATE**: US1 eigenständig testen (Icon → clean Session, Auto-Start).
5. Demo-fähiger MVP.

### Incremental Delivery

1. Setup + Foundational → Fundament steht.
2. US1 → testen → MVP.
3. US2 (Warnung) → testen.
4. US3 (Cleanup) → testen.
Jede Story ergänzt Wert, ohne die vorherige zu brechen.

---

## Notes

- [P] = andere Datei, keine offene Abhängigkeit.
- US2 und US3 erweitern beide die in US1 erstellte `restart`-Methode — sequenziell auf `chatWorkService.ts`.
- Keine neuen Tabellen/Migrationen/Abhängigkeiten; alle Bausteine (endConversation, ensure, worktrees.remove, deleteBranch, isCleanWorkingTree, ptys.terminate) existieren bereits.
- Nach jedem Task oder logischer Gruppe committen.
