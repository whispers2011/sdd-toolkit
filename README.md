# SDD Toolkit

Lokale Web-App, die den **spec-kit-SDD-Workflow über mehrere Projekte** orchestriert —
mit **Worktree-Isolation pro Feature**, einer **echten Konsole pro Feature** und einer
**Merge-Queue mit automatischer Konfliktauflösung**. Ziel: Level 2 (Orchestrator) und
Level 3 (Supervised Autonomy) der AI-Adoption vollumfänglich unterstützen — umschaltbar
über den Automation-Dial.

## Quickstart

```bash
pnpm install
pnpm dev          # Server (Port 4820) + Web-UI (Port 4830)
open http://localhost:4830
```

Voraussetzungen: Node ≥ 22, git ≥ 2.40, Claude Code CLI (`claude`) im PATH.
Ziel-Repos brauchen [spec-kit](https://github.com/github/spec-kit) für Claude Code
(`/speckit-*`-Kommandos) — Initialisierung über den Banner im Tool oder manuell:
`uvx --from git+https://github.com/github/spec-kit.git specify init --here --integration claude`
(danach committen, damit Feature-Worktrees die Skills erben). Ältere Installationen
mit `/speckit.*`-Punktnotation werden automatisch erkannt.

## Arbeitsweise

1. **Projekt hinzufügen** (Sidebar → „+ Projekt", Pfad zum Git-Repo). Vorhandene
   `specs/<feature>`-Ordner werden automatisch als Features importiert (Brownfield).
2. **Feature anlegen** → das Tool erstellt `feature/<name>`-Branch + git-Worktree
   (unter `~/.sdd-toolkit/worktrees/`) und öffnet eine persistente Claude-Session
   im Worktree — die **Konsole pro Feature**. Optional startet die Beschreibung
   direkt `/speckit.specify`.
3. **Phasen** laufen als Slash-Commands in dieser Session: specify → clarify → plan →
   tasks → implement. Steuerung per Kanban (Drag-to-Advance), Phasen-Leiste über der
   Konsole oder direkt in der Konsole.
4. **Integration**: implement fertig → Verifikations-Pipeline (Test/Build/Lint, pro
   Projekt konfigurierbar) → Merge-Queue: rebase auf main → **Konflikte löst ein
   Headless-Claude mit Spec-Kontext beider Seiten** → erneute Verifikation → Merge →
   Worktree-Cleanup. Scheitert etwas → Eskalation in die Exception-Inbox, nie Blind-Merge.
5. **„Braucht dich"-Inbox**: Agent-Fragen, Permission-Requests, rote Tests, eskalierte
   Konflikte — Monitoring by exception. Klick springt in die richtige Konsole.

## Automation-Dial (Level 2 ↔ Level 3)

| Automation | Level 2 (aus) | Level 3 (an) |
|---|---|---|
| `autoProgressUntil` | jede Phase manuell | Phase fertig → nächste startet |
| `autoVerify` | manuell testen | Pipeline nach implement |
| `autoMerge` | manuell mergen | Merge-Queue automatisch |

Global im Header einstellbar, pro Projekt/Feature überschreibbar (`automation`-Feld).

## Architektur

```
packages/
├── shared/   Domain: Typen + pure State-Machines (Phasen-Workflow, Session-Status)
├── server/   Fastify + WebSockets, node-pty, better-sqlite3 (WAL), Git-Engine
└── web/      React + Vite + Tailwind, xterm.js-Konsolen, Kanban, Inbox
```

Kernideen (aus der Analyse von WhisperM8 & speckit-assistant destilliert):

- **Hook-Bridge statt Output-Parsing**: Claude startet mit `--settings <datei>`;
  Hooks appenden jedes Event in ein JSONL, der Server watcht es. `PermissionRequest`/
  `AskUserQuestion`/`ExitPlanMode` → „wartet auf dich", `Stop` → „Turn fertig".
- **Pure State-Machines** (`packages/shared`): Phasen-Reducer inkl. Downstream-Staleness
  und Session-Status-Reducer mit Effekt-Dedup — vollständig unit-getestet.
- **PTYs leben am Server**: Browser-Tab zu ≠ Session weg; xterm.js reconnected mit
  Scrollback-Replay. Nach Server-Neustart: `claude --resume` statt Prozess-Leichen.
- **Startup-Reaper**: verwaiste `running`-Zustände werden beim Boot bereinigt
  (behebt die Persistenz-Schwäche des speckit-assistant).
- **SQLite (WAL)** für Orchestrierungs-State; die Spec-Wahrheit bleibt als Dateien
  im Ziel-Repo (`specs/`), `~/.claude/` wird strikt read-only behandelt.

## Konfiguration

| Env | Default | Zweck |
|---|---|---|
| `SDD_PORT` | 4820 | API/WS-Port |
| `SDD_HOST` | 127.0.0.1 | Bind-Adresse (bewusst nur lokal) |
| `SDD_DATA_DIR` | `~/.sdd-toolkit` | DB, Logs, Hook-Events, Worktrees |

Verifikations-Kommandos pro Projekt: `PATCH /api/projects/:id` mit
`{"verifyCommands":[{"name":"test","command":"pnpm test"}]}` (UI folgt, P1).

## Roadmap

- **P1 (umgesetzt, 2026-07-22)**: Transkript-Fallback (ESC-Abbruch-Erkennung), Snapshots +
  Resume-Recovery, Cost-/Token-Metering, Review-Gate (Code/Security mit VERDICT),
  Human-Review-Portal inkl. Konfliktauflösungs-Transparenz, Executions-View, Projekt-
  Einstellungen-UI, Grid-View (9 Panes, Feed-Drosselung), Notification-Feinschliff,
  klickbare Links, Projekt-Terminal + spec-kit-Init, Change-Guard, PR-Modus,
  native Ordnerauswahl, Voice-Eingabe (Web Speech / Whisper / Groq), ⌘K-Switcher,
  Bild-Paste, Confirm-Dialoge
- **P2**: Multi-Provider (Codex/Gemini), CLI-Fernsteuerung (`sdd`), Tab-Management,
  DAG-Ansicht, MCP-Management, Routinen, Kosten-Dashboard — siehe
  `docs/funktionsuebernahme.md` §3 und `docs/implementation-prompt.md` (P2-Folgeprompt)

## Entwicklung

```bash
pnpm test         # alle Tests (Domain-Machines + Git-Integration)
pnpm typecheck    # alle Pakete
pnpm --filter @sdd/server dev   # nur Server
pnpm --filter @sdd/web dev      # nur Web-UI
```

Referenz-Analysen und Anforderungen: `docs/` (Inventare beider Referenz-Repos,
Level-3-Anforderungen, Funktionsumfang mit Prioritäten).
