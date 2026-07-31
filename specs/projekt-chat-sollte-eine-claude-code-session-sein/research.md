# Phase 0 — Research & Entscheidungen

Feature: Projekt-Chat als vollwertige Claude-Code-Session

Alle offenen Klärungen aus der Spec sind aufgelöst (siehe `spec.md` › Clarifications). Dieses
Dokument hält die tragenden technischen Entscheidungen fest, die aus der Analyse des Bestands
abgeleitet wurden (Referenzdateien in Klammern, relativ zum Repo-Root).

## D1 — Arbeits-Modus spiegelt die Feature-Session, nicht den Chat-Turn

- **Decision**: „Arbeiten" wird als interaktive, PTY-gestützte Claude-Session in einer isolierten
  Worktree/Branch umgesetzt — analog zu `Orchestrator.ensureSession`
  (`packages/server/src/services/orchestrator.ts`) mit `buildClaudeArgv`
  (`packages/server/src/pty/commandBuilder.ts`), Hook-Bridge (`pty/hookBridge.ts`),
  Transcript-Watcher (`pty/transcriptWatcher.ts`) und `SessionMachine`
  (`packages/shared/src/sessionMachine.ts`). NICHT als Weiterbau des headless `ChatService`.
- **Rationale**: Eine vollwertige, eingreifende, iterative Session braucht genau das
  Ausführungsmodell der Feature-Konsole (interaktives PTY, Permissions über Hooks, Resume,
  Snapshot-Replay). Der `ChatService` ist bewusst kurzlebig-headless und read-only.
- **Alternatives**: `buildChatArgv` um `--allowedTools`/`acceptEdits` erweitern und im Projekt-Root
  laufen lassen — verworfen: keine Isolation (FR-004), kein natives Permission-Handling, kein
  Reconnect/Scrollback wie bei einer echten Session.

## D2 — Isolierte Worktree/Branch pro Arbeits-Unterhaltung

- **Decision**: Beim Wechsel einer Unterhaltung in den Arbeits-Modus wird via `WorktreeManager.create`
  (`packages/server/src/git/worktrees.ts`) eine Worktree unter
  `~/.sdd-toolkit/worktrees/<projectId>/chat-<conversationShortId>` auf Branch
  `chat/<conversationShortId>` (abgeleitet vom `defaultBranch`) erzeugt. Idempotent; überlebt
  Neustart, weil sie auf der Platte bleibt.
- **Rationale**: FR-004; nutzt exakt denselben Isolationsmechanismus wie Features, inkl.
  `remove(force)` zum Verwerfen.
- **Alternatives**: temporäres Verzeichnis außerhalb git — verworfen (kein Diff/Review/Merge-Pfad).

## D3 — Bindung an die Unterhaltung statt an eine Feature

- **Decision**: Die PTY-Session-Zeile (`sessions`-Tabelle) und Inbox-Einträge werden über eine
  neue, nullable Spalte `conversation_id` an die Unterhaltung gebunden; `feature_id` bleibt
  `NULL`. `LiveSession.kind`/`SessionInfo.kind` bekommen den Wert `'chat_work'`. `SnapshotStore`
  (`pty/snapshotStore.ts`) wird auf einen generischen Schlüssel (`featureId | conversationId`)
  verallgemeinert.
- **Rationale**: Der Arbeits-Chat hat bewusst keine Feature (kein Spec→Plan→Tasks-Zwang). Additive
  Nullable-Spalten sind der kleinste Eingriff und lassen die feature-gebundenen Pfade intakt.
- **Alternatives**: Pseudo-Feature je Chat anlegen — verworfen (verschmutzt Kanban/Feature-Liste,
  zieht Phasen-Workflow nach sich, widerspricht der Spec).

## D4 — Modus hängt an der Unterhaltung (`ChatConversation.mode`)

- **Decision**: Neue Spalte `chat_conversations.mode TEXT NOT NULL DEFAULT 'ask'
  CHECK(mode IN ('ask','work'))`. Der Modus ist pro Unterhaltung festgelegt und wird beim Start
  einer neuen Unterhaltung gewählt; er ist im UI jederzeit sichtbar (FR-011). Ein reiner
  `ChatMode`-Typ + Guard lebt in `packages/shared/src/chatMode.ts` (unit-getestet).
- **Rationale**: Klarste, vorhersehbarste Semantik; die zwei Ausführungsmodelle lassen sich nicht
  sinnvoll mitten in einer Unterhaltung mischen (headless-im-Root vs. interaktiv-in-Worktree).
- **Alternatives**: Modus pro Nachricht / Auto-Eskalation — verworfen (Wechsel des
  Ausführungsmodells mitten im Thread ist technisch heikel und für den Nutzer intransparent).

## D5 — Freigabe/Autonomie erbt den Automation-Dial

- **Decision**: Der Arbeits-Modus liest die aufgelöste Automation
  (`resolveAutomation(global, project, feature=∅)`, `packages/shared/src/types.ts`) und wählt den
  Permission-Mode wie `ensureSession`: `autoMode ? 'bypassPermissions' : 'acceptEdits'`.
  Freigabe-Bedarf (`AskUserQuestion`/`ExitPlanMode`, sowie `permission_request`) läuft über die
  bestehende `AttentionRepo`/„Braucht dich"-Inbox und die Session-Status-Events.
- **Rationale**: FR-005; kein zweites Freigabemodell. Konsistent mit Feature-Sessions.
- **Alternatives**: eigener „immer nachfragen"-Schalter nur für den Chat — verworfen (Redundanz
  zum Dial, Inkonsistenz).
- **Offen für /tasks**: Ohne Feature gibt es keine per-Feature-Ebene im Dial; die Arbeits-Session
  erbt global→projekt. (Kein Blocker; per-Unterhaltung-Override ist bewusst YAGNI.)

## D6 — Inbox-Routing zum Chat statt zur Feature-Konsole

- **Decision**: `AttentionItem` bekommt eine nullable `conversationId`. Für Arbeits-Chat-Einträge
  springt „Zur Konsole →" in die Sprechblase/den Chat-Panel des Projekts statt in eine
  Feature-Konsole. Bestehende Feature-Einträge bleiben unverändert (`featureId`-Routing).
- **Rationale**: FR-006; die Inbox ist der zentrale „Braucht dich"-Kanal und muss auch
  Chat-Sessions erreichbar machen.
- **Alternatives**: nur über `sessionId` routen — verworfen, weil das UI-Ziel (Feature-Konsole vs.
  Chat-Panel) nicht ableitbar wäre.

## D7 — Beobachten/Unterbrechen über das bestehende Terminal-Transport

- **Decision**: Das Web nutzt `TerminalPane` (`packages/web/src/components/TerminalPane.tsx`)
  unverändert; im Arbeits-Modus rendert `ChatPanel` einen `TerminalPane` mit
  `getSession = () => api.ensureChatWorkSession(conversationId)` und Prompt-Leiste. Unterbrechen =
  `PtySessionManager.terminate` (2× Ctrl-C → SIGKILL) über eine Route. Live-Beobachtung ist der
  Terminal-Stream (`/ws/terminal/:sessionId`) mit Scrollback-Replay.
- **Rationale**: FR-006; maximale Wiederverwendung, ehrliche Darstellung („das ist wirklich eine
  Claude-Code-Session").
- **Alternatives**: eigene Aktions-/Fortschrittsliste bauen — verworfen (Doppelaufwand; das
  Terminal ist bereits die Wahrheit).

## D8 — Verwerfen & Übernehmen (Review/Merge)

- **Decision**:
  - **Verwerfen** (FR-007): `terminate` der Session → `WorktreeManager.remove(force)` →
    `MergeEngine.deleteBranch` → `SnapshotStore.remove(conversationId)` → Session-Zeile schließen.
    Keine Rückstände in der Haupt-Arbeitskopie.
  - **Übernehmen** (FR-004): Worktree committen → `verifyService.runVerification` (falls
    `project.verifyCommands`) → bei Erfolg `MergeEngine.mergeFeature` nach `defaultBranch` → Cleanup
    wie beim Verwerfen. Diese Bausteine sind bereits pfadbasiert und werden direkt genutzt (nicht
    die feature-gebundene `MergeQueueService`).
  - **Review**: Der bestehende Diff/Review-Blick (`ReviewPortal`) ist wiederverwendbar, sobald eine
    Diff-Quelle (Worktree vs. base) bereitsteht.
- **Rationale**: „nie blind mergen“ bleibt gewahrt (Verify vor Merge); Verwerfen ist restlos.
- **Alternatives**: Auto-Merge jeder Chat-Änderung — verworfen (widerspricht Kontroll-Story US3).

## D9 — Kosten-/Ausführungs-Audit

- **Decision**: Neuer `ExecutionRecord.kind = 'chat_work'` (`packages/shared/src/types.ts`).
  Kosten werden wie bei Feature-Turns aus dem Scrollback-Delta / Transcript gemetert (`meter()`,
  `packages/shared/src/costMeter.ts`), analog `Orchestrator.handleTurnCompleted`. Der bestehende
  `'chat'`-Kind bleibt für den Nur-Lese-Modus.
- **Rationale**: FR-009; Konsistenz mit vorhandenem Audit/Executions-View.

## D10 — Neustart-Wiederherstellung

- **Decision**: Der Boot-Reaper (`Orchestrator.reapOnBoot` / `ExecutionRepo.reapOrphans`) wird um
  die `'chat_work'`-Sessions erweitert: offene Session-Zeilen schließen, laufende
  `chat_work`-Executions als `orphaned` markieren. Beim erneuten Öffnen der Unterhaltung im
  Arbeits-Modus wird via `claude --resume` (aus `sessions.latestForConversation`) + Snapshot-Replay
  fortgesetzt; die Worktree liegt noch auf der Platte.
- **Rationale**: FR-008; entspricht der bestehenden „PTYs leben am Server, Reconnect via
  Resume/Snapshot"-Strategie.

## Offene, bewusst nach /tasks bzw. spätere Iteration verschobene Punkte

- Diff-Quelle für `ReviewPortal` im Chat-Kontext (Worktree-Diff gegen base) — Konkretisierung in
  `data-model.md`/Tasks.
- „Sehr großer Umfang → Feature-Übergabe vorschlagen": nutzt den bestehenden Proposal-Mechanismus
  (`parseFeatureProposal`), jetzt zusätzlich als Hinweis im Arbeits-Modus. Kein neuer Mechanismus.
