# Implementation Plan: Wissens-Chat neu starten (frische Session)

**Branch**: `feature/wissens-chat-soll-eine-moeglichkeit-haben-die-claude-session` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/wissens-chat-soll-eine-moeglichkeit-haben-die-claude-session/spec.md`

## Summary

Ein SVG-Neustart-Icon im Kopf des Wissens-Chat-Panels beendet die aktuell aktive Unterhaltung und
startet eine **frische Claude-Session ohne Altkontext**, die automatisch bereitsteht. Technisch wird
die alte Unterhaltung **deaktiviert** (`chat_conversations.ended_at` gesetzt, Nachrichten bleiben
erhalten), ihre laufende PTY-Session terminiert und ihre isolierte Worktree/Branch verworfen; danach
wird eine neue aktive Unterhaltung angelegt und über den bestehenden `ChatWorkService.ensure`-Pfad eine
neue Session gespawnt. Weil die neue Unterhaltung eine neue `conversationId` (und damit neue
Worktree `chat-<id>` / Branch `chat/<id>`) hat und keine vorherige Session-ID zum Resumen existiert,
ist der Neuanfang garantiert „clean". Eine Bestätigungsabfrage wird nur eingeholt, wenn die Session
gerade arbeitet **oder** ihre Arbeitskopie unbestätigte Änderungen enthält (server-autoritativer
Guard via `isCleanWorkingTree`).

## Technical Context

**Language/Version**: TypeScript (ESM), Node ≥ 22

**Primary Dependencies**: Server — Fastify + `ws` (WebSocket), `better-sqlite3` (WAL), `node-pty`, `nanoid`; Web — React 18 + Vite, `xterm.js`

**Storage**: SQLite via `better-sqlite3` — betroffen: `chat_conversations`, `chat_messages`, `sessions`

**Testing**: `vitest run` (Server, `packages/server`); Web ohne Testsuite (MVP)

**Target Platform**: Lokale Desktop-Web-App (localhost), Betrieb auf macOS/Linux-Entwicklermaschine

**Project Type**: Web-App im pnpm-Monorepo (`packages/server`, `packages/web`, `packages/shared`)

**Performance Goals**: Neustart → neue Session bedienbar in < 5 s (SC-002); Icon in 1 Klick erreichbar (SC-001)

**Constraints**: Keine Ansammlung paralleler Sessions/Worktrees (genau 1 aktive Session/Projekt); kein Datenverlust ohne Warnung (SC-004/SC-005); Neustart darf andere Projekte/Feature-Sessions nicht beeinträchtigen

**Scale/Scope**: Einzelnutzer, wenige Projekte gleichzeitig; ein aktiver Wissens-Chat pro Projekt

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist noch die unausgefüllte Vorlage (keine ratifizierten Prinzipien).
Es existieren daher **keine** durchsetzbaren Gates. **Ergebnis: PASS** (nichts zu verletzen).

Selbst auferlegte Leitplanken aus dem Projektstil (aus vorhandenem Code abgeleitet, nicht bindend):
minimale Komplexität, Wiederverwendung bestehender Pfade (`ensure`, `endConversation`, `worktrees`,
`mergeEngine.deleteBranch`), keine neuen externen Abhängigkeiten. Alle erfüllt.

**Re-Check nach Phase 1**: Unverändert PASS — das Design fügt nur eine Service-Methode, einen
REST-Endpoint und einen UI-Button hinzu, ohne neue Tabellen, Pakete oder Abhängigkeiten.

## Project Structure

### Documentation (this feature)

```text
specs/wissens-chat-soll-eine-moeglichkeit-haben-die-claude-session/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0 (/speckit-plan)
├── data-model.md        # Phase 1 (/speckit-plan)
├── quickstart.md        # Phase 1 (/speckit-plan)
├── contracts/           # Phase 1 (/speckit-plan)
│   └── restart-endpoint.md
├── checklists/
│   └── requirements.md  # aus /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT hier erzeugt)
```

### Source Code (repository root)

```text
packages/
├── shared/
│   └── src/
│       └── types.ts                       # ggf. Restart-Response-Typ ergänzen
├── server/
│   └── src/
│       ├── services/
│       │   └── chatWorkService.ts         # NEU: restart(projectId, {confirm}) — Kern des Features
│       ├── api/
│       │   └── server.ts                  # NEU: POST /api/projects/:id/chat/work/restart
│       ├── git/
│       │   ├── worktrees.ts               # bestehend: remove(..., {force}) wiederverwenden
│       │   ├── mergeEngine.ts             # bestehend: deleteBranch(...) wiederverwenden
│       │   └── git.ts                     # bestehend: isCleanWorkingTree(...) wiederverwenden
│       ├── db/
│       │   └── repos.ts                   # bestehend: endConversation/createConversation/getActive
│       └── pty/
│           └── sessionManager.ts          # bestehend: forConversation/terminate/remove
└── web/
    └── src/
        ├── components/
        │   ├── ChatPanel.tsx              # NEU: Restart-Icon im Header + Confirm-Flow + Remount
        │   ├── TerminalPane.tsx           # ANPASSUNG: Remount-Key auf conversationId umstellen
        │   └── icons.tsx                  # bestehend: RestartIcon bereits vorhanden
        └── api.ts                         # NEU: restartChatWorkSession(projectId, confirm)
```

**Structure Decision**: Bestehendes pnpm-Monorepo. Das Feature ist additiv: eine neue
Service-Methode + ein neuer REST-Endpoint (Server) und ein Icon-Button + Confirm-Flow (Web). Es
werden **keine** neuen Pakete, Tabellen oder Abhängigkeiten eingeführt; alle Kernbausteine
(Deaktivieren, Worktree/Branch verwerfen, Session terminieren, neue Session spawnen) existieren
bereits und werden wiederverwendet.

## Complexity Tracking

> Keine Constitution-Verletzungen — Abschnitt entfällt.
