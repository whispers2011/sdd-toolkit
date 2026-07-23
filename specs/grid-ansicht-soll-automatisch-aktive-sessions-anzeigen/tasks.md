---
description: "Task list for feature: Grid-Ansicht zeigt aktive Sessions automatisch an"
---

# Tasks: Grid-Ansicht zeigt aktive Sessions automatisch an

**Input**: Design documents from `/specs/grid-ansicht-soll-automatisch-aktive-sessions-anzeigen/`

**Prerequisites**: spec.md (user stories, requirements). `plan.md` is an unfilled template — tech context below was derived from the codebase.

**Tests**: Only ONE automated test task is included (the pure selection module in `@sdd/shared`), matching the repo's hard convention that every shared pure module ships a co-located `.test.ts`. Per-story acceptance is otherwise verified via the manual "Independent Test" flows from spec.md. No TDD across the UI/server layers was requested.

## Tech Context (derived from codebase)

- **Monorepo**: pnpm workspaces, TypeScript, Node ≥ 22. Packages: `@sdd/shared` (pure logic + vitest), `@sdd/server` (Fastify + node-pty), `@sdd/web` (React + Tailwind).
- **Grid view**: `packages/web/src/components/GridView.tsx` — currently loads/persists pane selection (feature IDs) in `localStorage` per project scope; `MAX_PANES = 9`.
- **Session model**: `SessionDisplayStatus = 'idle' | 'working' | 'awaiting_input' | 'stopped' | 'errored'` (`packages/shared/src/types.ts`). Attention-needing ⇔ `working` or `awaiting_input`. Live sessions reach the client as `LiveSessionInfo` (`packages/web/src/api.ts`) via `/api/state` bootstrap and `session_status` WS events.
- **No per-session timestamp exists today** — `LiveSession`/`LiveSessionInfo` carry no `createdAt`/`lastActiveAt`. Ordering (US2) requires introducing one.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (maps to spec.md user stories)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm baseline; no new dependencies are required for this feature.

- [X] T001 Verify the workspace builds/typechecks green before changes: run `pnpm install` then `pnpm typecheck` from repo root, note any pre-existing failures so they aren't attributed to this feature.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure selection algorithm used by BOTH user stories. It encodes the full selection rule (filter → per-feature dedupe → newest-first sort → cap) and degrades gracefully when no timestamp is available (stable order), so US1 can ship before US2 introduces real timestamps.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Create pure selection module `packages/shared/src/gridAutoSelect.ts`. Export `interface GridSessionCandidate { featureId: string | null; projectId: string; kind: string; status: SessionDisplayStatus; exited: boolean; lastActiveAt?: number }` and `export function selectAutoPanes(sessions: GridSessionCandidate[], opts: { projectId: string | null; visibleFeatureIds: ReadonlySet<string>; max: number }): string[]`. Rules: keep sessions where `projectId === opts.projectId`, `featureId != null`, `opts.visibleFeatureIds.has(featureId)`, `status === 'working' || status === 'awaiting_input'`, `!exited` (FR-002/FR-003/FR-008/FR-011/FR-013). Group by `featureId`, per feature keep the session with the greatest `lastActiveAt` (FR-012). Return the feature IDs sorted by chosen `lastActiveAt` descending, tie-broken by `featureId` ascending for a stable order (FR-004/FR-009), then sliced to `opts.max` (FR-005/FR-006). Treat missing `lastActiveAt` as `0` so ordering falls back to the stable `featureId` tiebreak.
- [X] T003 [P] Add co-located unit tests `packages/shared/src/gridAutoSelect.test.ts` (vitest) covering: attention-needing sessions of the current project are selected; `idle`/`stopped`/`errored`/`exited` and `featureId === null` (chat/shell) sessions are excluded; sessions of other projects excluded; features not in `visibleFeatureIds` excluded; per-feature dedupe keeps the most-recently-active session; more candidates than `max` returns exactly `max` newest-first; equal/absent `lastActiveAt` yields a stable, reproducible order (SC-001..SC-005).
- [X] T004 Export the new module from `packages/shared/src/index.ts` (add `export * from './gridAutoSelect.js';`). Depends on T002.

**Checkpoint**: `pnpm --filter @sdd/shared test` and `pnpm --filter @sdd/shared typecheck` are green; the selection function is importable from `@sdd/shared`.

---

## Phase 3: User Story 1 - Aufmerksamkeitsbedürftige Sessions beim Öffnen automatisch sehen (Priority: P1) 🎯 MVP

**Goal**: On opening the grid view (and on project switch), automatically fill the grid with the current project's attention-needing sessions (working + awaiting input), one tile per feature, excluding ended/idle/no-feature sessions — replacing (override) any previously stored manual selection.

**Independent Test**: In a project, bring sessions into different states (≥1 working, ≥1 awaiting a permission/question, ≥1 stopped), open the grid view, and confirm the working + awaiting sessions appear automatically as consoles and the stopped one does not. (No ordering/cap guarantees yet — that's US2.)

### Implementation for User Story 1

- [X] T005 [US1] In `packages/web/src/components/GridView.tsx`, replace the `localStorage`-backed pane initialization with automatic selection. Compute `const scope = state.selectedProjectId`; derive visible features exactly as today (project scope + `showCompleted`/`integration !== 'merged'`) into a `Set` of IDs; call `selectAutoPanes(state.app.sessions, { projectId: scope, visibleFeatureIds, max: MAX_PANES })` and `setPanes(...)` with the result. This runs on mount and whenever `scope` changes (FR-001/FR-008/FR-010).
- [X] T006 [US1] In `packages/web/src/components/GridView.tsx`, handle the async bootstrap: `state.app` may be `null` on first mount and populate later. Compute the auto-selection once per "open" as soon as session data for `scope` is available, then FREEZE it — do not recompute while the view stays open (FR-014: no auto nachrücken). Use a ref keyed by scope (e.g. `initializedScopeRef`) so a `scope` change re-initializes but subsequent `state.app.sessions` updates (live status changes) do NOT re-run the selection.
- [X] T007 [US1] In `packages/web/src/components/GridView.tsx`, keep already-shown tiles updating their status live: the per-tile `session = state.app.sessions.find(s => s.featureId === featureId && !s.exited)` lookup and `status-${session?.status}` dot must remain driven by live store state (FR-014, Acceptance Scenario 4 — answering a permission from the tile keeps working without a view switch). Preserve the empty-state message when the selection is empty (Edge Case: no candidates).
- [X] T008 [US1] In `packages/web/src/components/GridView.tsx`, remove the now-dead per-project persistence: delete the `storageKey()` helper and both `localStorage` read/write `useEffect`s, and update the header hint comment that describes manual selection. Manual selection is now session-local (FR-010; Assumption "Manuelle Anpassungen sind sitzungslokal").

**Checkpoint**: Opening the grid auto-shows attention-needing feature consoles for the current project; ended/idle/no-feature sessions never appear; nothing auto-appears/disappears while the view stays open; tile status updates live. MVP deliverable.

---

## Phase 4: User Story 2 - Neueste zuerst und Höchstzahl einhalten (Priority: P2)

**Goal**: When there are more attention-needing sessions than slots, show at most `MAX_PANES` tiles, choosing the most-recently-active features and ordering them newest-first. Requires a real per-session activity timestamp threaded end-to-end.

**Independent Test**: Create more attention-needing sessions than slots with different activity times, open the grid, and confirm exactly `MAX_PANES` tiles appear, they are the most recently active, and they are ordered newest-first.

### Implementation for User Story 2

- [X] T009 [US2] Add an activity timestamp to the server session. In `packages/server/src/pty/sessionManager.ts`: add `lastActiveAt: number` to the `LiveSession` interface; initialize it in the `spawn()` session object (line ~130) to `Date.now()`; in `dispatch()` (line ~227), after `session.machine = machine`, set `session.lastActiveAt = Date.now()` when the new state kind is `'working'` or `'awaiting_input'` (operationalizes "letzter Aktivitätszeitpunkt", FR-004 clarification).
- [X] T010 [US2] Extend the `session_status` broadcast payload with `lastActiveAt: number` in `packages/server/src/events.ts` (`BusEvents.session_status`), and include `lastActiveAt: session.lastActiveAt` at both emit sites: `packages/server/src/services/orchestrator.ts` (`handleStatusChange`, ~line 344) and `packages/server/src/services/chatWorkService.ts` (~line 210). Depends on T009.
- [X] T011 [P] [US2] Include `lastActiveAt: s.lastActiveAt` in the `/api/state` live-session mapping in `packages/server/src/api/server.ts` (~line 70). Depends on T009.
- [X] T012 [US2] Thread `lastActiveAt` to the web client: add `lastActiveAt: number` to `LiveSessionInfo` in `packages/web/src/api.ts`; in `packages/web/src/store.tsx` add `lastActiveAt` to the `session_status` action payload type and set it in the reducer when rebuilding the session (fall back to `prev?.lastActiveAt ?? Date.now()` so a status update never drops the timestamp). Depends on T010.
- [X] T013 [US2] Extend `packages/shared/src/gridAutoSelect.test.ts` with explicit ordering/cap cases now that timestamps are real: `max` is never exceeded (SC-002), the `N` most-recently-active features are chosen (SC-003), and results are strictly descending by `lastActiveAt` (SC-003). No change to `selectAutoPanes` itself should be required — verify it consumes the real `lastActiveAt`.

**Checkpoint**: With more candidates than slots, exactly `MAX_PANES` tiles show, newest-first, and repeated opens on unchanged state are identical (SC-005). US1 still works.

---

## Phase 5: User Story 3 - Automatische Auswahl manuell nachjustieren (Priority: P3)

**Goal**: The auto-populated grid remains manually adjustable — add a non-auto console or remove an auto one — without ever exceeding `MAX_PANES`; changes are session-local.

**Independent Test**: After auto-population, manually add a console that wasn't auto-selected and remove one that was; confirm both work and that adding is blocked once `MAX_PANES` is reached.

### Implementation for User Story 3

- [X] T014 [US3] In `packages/web/src/components/GridView.tsx`, verify/keep the "+ Konsole hinzufügen …" `<select>` and `addPane()` operating on the in-memory `panes` state produced by the auto-selection, still guarded by `validPanes.length >= MAX_PANES` (FR-005/FR-007). The `available` list must offer features not currently shown (including idle/manual-only features), matching FR-011's "untätige bleiben manuell hinzufügbar".
- [X] T015 [US3] In `packages/web/src/components/GridView.tsx`, verify `removePane()` still removes a tile from the auto-populated grid (Acceptance Scenario 2) and that after removal a manual add is possible up to the cap (Acceptance Scenario 3). Confirm these edits are session-local and replaced on the next open/project switch (no persistence — consistent with T008).

**Checkpoint**: All three stories work independently; the cap is never exceeded through any combination of auto + manual.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T016 [P] Run `pnpm typecheck` from repo root and fix any type errors introduced across `@sdd/shared`, `@sdd/server`, `@sdd/web`.
- [X] T017 [P] Run `pnpm --filter @sdd/shared test` and ensure the grid selection tests pass.
- [ ] T018 Manual validation of the quickstart / acceptance scenarios end-to-end (`pnpm dev`): US1 scenarios 1–4, US2 scenarios 1–3, US3 scenarios 1–3, and the edge cases (no candidates, equal timestamps, project switch, state change while open, cap exactly hit) → map each to SC-001..SC-005.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational (uses `selectAutoPanes`). No dependency on US2/US3.
- **User Story 2 (Phase 4)**: Depends on Foundational. Independent of US1 in code (touches server/DTO/store + tests), but is validated most easily after US1 wires the UI. The selection function already sorts; US2 only supplies real timestamps.
- **User Story 3 (Phase 5)**: Depends on Foundational + US1 (manual add/remove act on the auto-populated `panes`). Independent of US2.
- **Polish (Phase 6)**: After the desired stories are complete.

### Within Stories

- US1: T005 → T006 (freeze logic builds on the selection wiring) → T007/T008 (independent files/edits, can follow).
- US2: T009 → {T010, T011} → T012; T013 after T012.
- US3: T014, T015 both edit `GridView.tsx` (same file — do sequentially).

### Parallel Opportunities

- T002 and T003 are closely coupled (impl + its tests) — write T002 first, then T003.
- T011 is `[P]` with T010's non-`events.ts` work (different file: `server.ts`), but both depend on T009.
- Polish T016 and T017 are `[P]` (different commands/outputs).
- Because US2 mostly touches server/shared/store while US1 touches `GridView.tsx`, US1 and US2 can be developed by different people in parallel once Phase 2 is done.

---

## Parallel Example: Foundational

```bash
# T002 then T003 (impl before its tests), while planning US1 UI work:
Task: "Create packages/shared/src/gridAutoSelect.ts (selectAutoPanes)"
Task: "Add packages/shared/src/gridAutoSelect.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup.
2. Phase 2: Foundational (`selectAutoPanes` + tests + export).
3. Phase 3: US1 — auto-populate the grid on open (override manual selection), exclude ended/idle/no-feature.
4. **STOP and VALIDATE** US1's independent test. This alone delivers the core value ("blockierte Sessions werden nicht mehr übersehen").

### Incremental Delivery

1. Foundational → selection logic ready and unit-tested.
2. US1 → auto-population on open (MVP). Ships without timestamps (stable order).
3. US2 → introduce `lastActiveAt` end-to-end → newest-first + strict cap.
4. US3 → confirm manual add/remove on top of auto-population, cap enforced.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- The spec's Clarifications operationalize "zuletzt gestartet" as "zuletzt aktiv" (last began working or asked). US2's `lastActiveAt` implements this; where the Assumptions text says "Erstellungszeitpunkt", the dated Clarification takes precedence.
- No new runtime dependencies. Selection is pure and lives in `@sdd/shared` for testability, matching existing modules (`sessionMachine`, `phaseMachine`, …).
- Manual adjustments (US3) are intentionally session-local — no `localStorage`, per FR-010's override rule.
