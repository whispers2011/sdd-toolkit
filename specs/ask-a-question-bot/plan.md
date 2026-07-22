# Implementation Plan: Ask-a-Question-Bot (Projekt-Chat)

**Branch**: `feature/ask-a-question-bot` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/ask-a-question-bot/spec.md`

## Summary

Eine Sprechblase unten rechts in der Projektansicht öffnet ein Chat-Panel, hinter dem eine projekt­bezogene, rein lesende Claude-Q&A-Session läuft. Technischer Ansatz: pro Chat-Turn ein Headless-Lauf (`claude -p` mit `--output-format stream-json` und `--resume`), Antwort-Streaming über den bestehenden `/ws/events`-Broadcast, Verlauf dauerhaft in zwei neuen SQLite-Tabellen (`chat_conversations`, `chat_messages`). Ein per System-Prompt vereinbartes Marker-Protokoll lässt den Assistenten feature-würdige Anforderungen als strukturierten Vorschlag emittieren; bei Annahme öffnet sich der bestehende (aus `Sidebar.tsx` extrahierte) Anlege-Dialog vorbefüllt mit Namensvorschlag und Beschreibung und nutzt den unveränderten `createFeature`-Pfad.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥ 22 (Server), React 19 (Web)

**Primary Dependencies**: Fastify + `@fastify/websocket`, better-sqlite3 (WAL), Vite + Tailwind 4, `nanoid`; Claude Code CLI (Headless-Print-Modus mit `stream-json`, `--resume`, `--append-system-prompt`, Tool-Whitelist)

**Storage**: SQLite (`<dataDir>/sdd-toolkit.sqlite`); neue Migration mit Tabellen `chat_conversations` und `chat_messages`; Kosten pro Turn als `executions`-Zeile (`kind: 'chat'`, `feature_id` NULL)

**Testing**: Vitest, kolokierte `*.test.ts`, Pure-Function-Stil (neue Logik als reine Funktionen in `@sdd/shared` bzw. extrahierte Helfer im Server); keine Web-Tests (bestehender MVP-Stand)

**Target Platform**: Lokale Einzelplatz-App (macOS primär): Node-22-Server + Browser-UI

**Project Type**: Web-App im pnpm-Monorepo (`packages/server`, `packages/web`, `packages/shared`)

**Performance Goals**: Erste sichtbare Antwort-Tokens typischerweise < 15 s nach Absenden (SC-003, via Streaming); Chat aus der Projektansicht mit 1 Klick erreichbar (SC-001)

**Constraints**: Chat ist strikt lesend gegenüber dem Projekt (Tool-Whitelist nur Read/Grep/Glob, cwd = Projekt-Root, kein Worktree, kein `acceptEdits`) — FR-004; keine Feature-Artefakte ohne ausdrückliche Zustimmung (FR-005); Verlauf überlebt App-Neustarts (FR-009); genau eine aktive Unterhaltung pro Projekt; eine laufende Antwort pro Unterhaltung (sequenzielle Turns)

**Scale/Scope**: Single-User lokal; 1 aktive Unterhaltung pro Projekt; Verläufe bis einige hundert Nachrichten; keine Historienliste alter Unterhaltungen

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein unausgefülltes Template ohne projektspezifische Prinzipien — es existieren keine verbindlichen Gates. Angewandte Projekt-Konventionen (aus Codebasis abgeleitet, informell geprüft):

- ✅ Bestehende Muster wiederverwenden statt neuer Infrastruktur (Bus-Events, Repos-Pattern, Migrations-Array, Dialog-Komponenten, Headless-Spawn-Pfad)
- ✅ Neue Logik als reine, testbare Funktionen (Proposal-Parser, stream-json-Parser)
- ✅ Keine neuen Packages/Abhängigkeiten nötig
- ✅ Additive Migration (Migrations-Array nur erweitern, nie editieren)

**Ergebnis Initial-Check: PASS** · **Ergebnis Post-Design-Check (nach Phase 1): PASS** — keine Verstöße, Complexity Tracking leer.

## Project Structure

### Documentation (this feature)

```text
specs/ask-a-question-bot/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase-0-Output (/speckit-plan)
├── data-model.md        # Phase-1-Output (/speckit-plan)
├── quickstart.md        # Phase-1-Output (/speckit-plan)
├── contracts/
│   └── chat-api.md      # Phase-1-Output (/speckit-plan)
└── tasks.md             # Phase-2-Output (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── types.ts                    # ERWEITERT: ChatConversation, ChatMessage, FeatureProposal; ExecutionKind + 'chat'
├── chatProposal.ts             # NEU: Marker-Parser für Feature-Vorschläge (pure, Vitest-getestet)
├── chatStream.ts               # NEU: Parser für stream-json-Zeilen → Text-Deltas/Result (pure, Vitest-getestet)
└── index.ts                    # ERWEITERT: Re-Exports

packages/server/src/
├── db/database.ts              # ERWEITERT: Migration [3] chat_conversations + chat_messages
├── db/repos.ts                 # ERWEITERT: ChatRepo (Conversations + Messages)
├── pty/commandBuilder.ts       # ERWEITERT: buildChatArgv() — stream-json, --resume, --append-system-prompt, Tool-Whitelist
├── services/chatService.ts     # NEU: Turn-Lebenszyklus (spawn, Streaming, Proposal-Erkennung, Kosten, Recovery)
├── services/chatPrompt.ts      # NEU: System-Prompt-Builder (Projektkontext + Vorschlag-Protokoll)
├── events.ts                   # ERWEITERT: Bus-Events chat_stream, chat_updated
├── api/server.ts               # ERWEITERT: Chat-Routen unter /api/projects/:id/chat*
└── index.ts                    # ERWEITERT: DI-Verdrahtung ChatRepo/ChatService, Boot-Cleanup unterbrochener Turns

packages/web/src/
├── api.ts                      # ERWEITERT: Chat-Client-Methoden
├── store.tsx                   # ERWEITERT: WS-Handling für chat_stream/chat_updated
├── App.tsx                     # ERWEITERT: mountet ChatBubble bei selectedProjectId !== null
└── components/
    ├── ChatBubble.tsx          # NEU: schwebende Sprechblase (fixed, unten rechts)
    ├── ChatPanel.tsx           # NEU: Nachrichtenliste, Eingabe, Vorschlag-Karte, „Neue Unterhaltung"
    ├── NewFeatureDialog.tsx    # NEU (extrahiert aus Sidebar.tsx): + initialName/initialDescription-Props
    └── Sidebar.tsx             # ERWEITERT: nutzt extrahierten NewFeatureDialog
```

**Structure Decision**: Bestehendes Drei-Paket-Monorepo wird unverändert weitergenutzt; keine neuen Packages. Server-seitig folgt der Chat dem etablierten Muster Repo (db) → Service (services) → Route (api/server.ts) → Bus-Event (events.ts); web-seitig dem Muster Overlay-Komponente (wie `QuickSwitcher`) + zentraler WS-Dispatch in `store.tsx`.

## Complexity Tracking

Keine Constitution-Verstöße — Tabelle entfällt.
