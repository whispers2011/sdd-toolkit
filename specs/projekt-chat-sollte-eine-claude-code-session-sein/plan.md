# Implementation Plan: Projekt-Chat als vollwertige Claude-Code-Session

**Branch**: `feature/projekt-chat-sollte-eine-claude-code-session-sein` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/projekt-chat-sollte-eine-claude-code-session-sein/spec.md`

## Summary

Der Projekt-Chat bekommt neben dem heutigen **Nur-Lese-Modus („Fragen")** einen zweiten,
pro Unterhaltung wählbaren **Arbeits-Modus („Arbeiten")**: eine vollwertige, interaktive
Claude-Code-Session, die Dateien ändern und Kommandos ausführen kann.

Zentrale Architektur-Entscheidung: Der Arbeits-Modus wird **nicht** aus dem heutigen
`ChatService` (headless, `--allowedTools Read,Grep,Glob`, im Projekt-Root) weitergebaut,
sondern spiegelt `Orchestrator.ensureSession` — eine **PTY-gestützte, interaktive Session in
einer isolierten Worktree/Branch**, mit Hook-Bridge, Transcript-Watcher, Permission-Inbox und
Permission-Mode aus dem Automation-Dial. Faktisch ist der Arbeits-Chat eine **projekt-gebundene,
phasenlose Feature-Konsole**, die aus der Sprechblase heraus gestartet wird. So werden
`WorktreeManager`, `PtySessionManager`, `SessionMachine`, `HookEventWatcher`,
`TranscriptWatcher`, `SnapshotStore`, `AttentionRepo`, `ExecutionRepo`, `MergeEngine` +
`verifyService` und das Web-`TerminalPane` unverändert wiederverwendet.

Der Nur-Lese-Modus bleibt exakt wie heute (Garantie „reines Chatten hinterlässt keine
Artefakte"). Die Wahl des Modus hängt an der Unterhaltung (`ChatConversation.mode`).

## Technical Context

**Language/Version**: TypeScript (strict, ESM), Node ≥ 22. Monorepo mit pnpm-Workspaces.

**Primary Dependencies**: Server — Fastify, `ws`, `node-pty`, `better-sqlite3` (WAL), `chokidar`;
Web — React 18, Vite, Tailwind, `@xterm/xterm` + FitAddon; Domain — dependency-frei (pure).
Extern: Claude-Code-CLI (`claude`) im PATH.

**Storage**: SQLite (WAL) unter `~/.sdd-toolkit/sdd-toolkit.sqlite`; Migrationen als indizierte
`MIGRATIONS[]` mit `PRAGMA user_version`. Isolierte Arbeitskopien als git-Worktrees unter
`~/.sdd-toolkit/worktrees/<projectId>/<name>`. Spec-/Repo-Wahrheit bleibt im Ziel-Repo.

**Testing**: Vitest (`pnpm test`) — pure State-Machines (shared) und Git-/DB-Integration
(server); `pnpm typecheck` über alle Pakete.

**Target Platform**: Lokale Single-User-Web-App (Server Port 4820, Web 4830), Bind nur
`127.0.0.1`; getestet unter macOS/Linux.

**Project Type**: Web application — Monorepo `packages/{shared,server,web}`.

**Performance Goals**: Interaktive Session — erstes sichtbares Ausgabe-Token wenige Sekunden nach
dem Prompt; Terminal-Feed fokusabhängig gedrosselt (~80 ms Batch). Keine harte SLA (Single-User).

**Constraints**: `~/.claude/` bleibt strikt read-only; **nie blind mergen** (Verify vor Merge);
Worktree-Isolation für alle schreibenden Aktionen; Nur-Lese-Modus bleibt garantiert nebenwirkungsfrei.

**Scale/Scope**: Ein Nutzer, wenige Projekte; **eine aktive Unterhaltung pro Projekt**; je
Unterhaltung höchstens eine laufende Antwort bzw. eine laufende Arbeits-Session.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Die Datei `.specify/memory/constitution.md` enthält nur unausgefüllte Template-Platzhalter — es
gibt **keine ratifizierten Prinzipien**. Der Check prüft daher gegen die im Repo erkennbaren,
de-facto-verbindlichen Engineering-Konventionen (README „Kernideen"):

| De-facto-Prinzip | Bewertung | Begründung |
|---|---|---|
| Pure State-Machines in `shared`, unit-getestet | ✅ PASS | Modus-Übergang & Session-Status bleiben in `shared` (reine Reducer/Parser), keine I/O-Logik ins Domain-Paket. |
| Hook-Bridge statt Output-Parsing | ✅ PASS | Arbeits-Modus nutzt `HookEventWatcher`/`TranscriptWatcher` unverändert, kein neues Parsing der Terminalausgabe. |
| Worktree-Isolation, `~/.claude` read-only, nie blind mergen | ✅ PASS | Änderungen ausschließlich in Worktree/Branch; Integration über bestehenden Verify→Merge-Weg; kein Zugriff auf `~/.claude`. |
| PTYs leben am Server, Reconnect via Snapshot/`--resume` | ✅ PASS | Wiederverwendung von `PtySessionManager` + `SnapshotStore`; Boot-Reaper deckt die neue Session-Art mit ab. |
| SQLite (WAL), additive Migrationen | ✅ PASS | Nur additive Migration (Spalten + optionale Tabelle/Spaltenerweiterung), keine Breaking-Changes. |
| Minimale Komplexität / YAGNI | ⚠️ WATCH | Risiko: Zweitpfad neben `ChatService`. Gegenmaßnahme: Arbeits-Modus spiegelt `ensureSession` statt eigener Session-Engine; Integration nutzt `MergeEngine`+`verifyService` direkt statt der feature-gebundenen `MergeQueueService`. Siehe Complexity Tracking. |

**Ergebnis:** PASS (mit einem bewusst begründeten Wiederverwendungs-Kompromiss).

## Project Structure

### Documentation (this feature)

```text
specs/projekt-chat-sollte-eine-claude-code-session-sein/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0 (/speckit-plan)
├── data-model.md        # Phase 1 (/speckit-plan)
├── quickstart.md        # Phase 1 (/speckit-plan)
├── contracts/           # Phase 1 (/speckit-plan)
│   ├── rest.md
│   └── events.md
├── checklists/
│   └── requirements.md  # bereits vorhanden
└── tasks.md             # /speckit-tasks (NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

Bestehende Struktur; betroffene Dateien (Erweiterung, keine neue Top-Level-Struktur):

```text
packages/
├── shared/src/
│   ├── types.ts            # + ChatConversation.mode; SessionInfo.kind 'chat_work';
│   │                       #   AttentionItem.conversationId?; ExecutionRecord.kind 'chat_work'
│   ├── chatMode.ts         # NEU: ChatMode-Typ + reiner Guard/Übergang (unit-getestet)
│   └── index.ts            # + Export chatMode
├── server/src/
│   ├── services/
│   │   ├── chatWorkService.ts   # NEU: Arbeits-Session (spiegelt ensureSession, konversationsgebunden)
│   │   ├── chatService.ts       # unverändert (Nur-Lese-„Fragen")
│   │   └── orchestrator.ts      # ggf. kleine Extraktion wiederverwendbarer ensureSession-Teile
│   ├── pty/
│   │   ├── sessionManager.ts    # LiveSession.kind + 'chat_work'; conversationId-Bindung
│   │   └── snapshotStore.ts     # generischer Key (featureId | conversationId)
│   ├── db/
│   │   ├── database.ts          # NEU Migration: chat_conversations.mode; sessions.conversation_id;
│   │   │                        #   attention.conversation_id
│   │   └── repos.ts             # ChatRepo.setMode; SessionRepo.latestForConversation; AttentionRepo
│   ├── api/server.ts            # + Chat-Work-Routen; /ws/terminal wird wiederverwendet
│   ├── events.ts                # ggf. + chat_session_status (oder Wiederverwendung session_status)
│   └── index.ts                 # DI-Verdrahtung des ChatWorkService
└── web/src/
    ├── components/
    │   ├── ChatPanel.tsx        # Modus-Umschalter; Arbeits-Modus rendert TerminalPane + Discard/Review
    │   ├── ChatBubble.tsx       # unverändert bis minimal
    │   └── TerminalPane.tsx     # unverändert wiederverwendet (getSession → chat-work ensure)
    ├── store.tsx                # Modus im Chat-State; ggf. neue Events
    └── api.ts                   # + ensureChatWorkSession/setChatMode/discard/integrate
```

**Structure Decision**: Bestehende Web-Monorepo-Struktur (`shared`/`server`/`web`) wird
beibehalten und nur erweitert. Kein neues Paket, keine neue Laufzeit. Der Arbeits-Modus ist ein
zusätzlicher Server-Service (`chatWorkService`) plus UI-Umschaltung in `ChatPanel`, der die
Session-/Worktree-/Merge-Infrastruktur der Feature-Konsole wiederverwendet.

## Complexity Tracking

> Nur ausgefüllt, weil der Constitution-Check einen bewusst begründeten Kompromiss enthält.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Zweiter Session-Pfad `chatWorkService` neben `chatService` | „Fragen" (headless, read-only, im Root) und „Arbeiten" (interaktiv, PTY, Worktree) haben grundlegend verschiedene Ausführungsmodelle; ein gemeinsamer Pfad würde beide verbiegen. | (a) Nur-Lese durch Arbeits-Session ersetzen → verletzt FR-011 (Nebenwirkungsfreiheit-Garantie geht verloren). (b) Arbeits-Modus über `buildChatArgv`+`acceptEdits` im Root → verletzt FR-004 (keine Isolation, kein Review-Gate). |
| Bindung Session/Attention an `conversationId` (neue Spalten) | Merge-/Inbox-/Session-Infra ist heute `featureId`-zentriert; der Arbeits-Chat hat keine Feature. | Synthetisches „Pseudo-Feature" pro Chat anlegen → verschmutzt Feature-Liste/Kanban und zieht den vollen Phasen-Workflow nach sich (widerspricht „ohne vollen Feature-Workflow"). Additive Nullable-Spalten sind der kleinere Eingriff. |
| Integration über `MergeEngine`+`verifyService` direkt statt `MergeQueueService` | Diese Bausteine arbeiten bereits pfadbasiert (projectPath/worktreePath/branch), nicht featureId-gebunden. | Volle `MergeQueueService` erzwingt Queue-/Stage-Bookkeeping pro `featureId` — Overhead ohne Nutzen für eine einzelne Ad-hoc-Änderung. |
