# Feature-Inventar: WhisperM8 (Referenz-Repo)

Analysiert: `reference/WhisperM8` (v2.15.0, Swift 5.9/SwiftUI, macOS 14+).
Fokus: Agent-Chats/Session-Manager (Diktat-Teil nur am Rande relevant).

## 1. Funktionsumfang Session-Manager

### Terminal / Sessions
- **PTY-Terminal-Tabs** — echte eingebettete Terminals (SwiftTerm `LocalProcessTerminalView`), Chrome-artige Tab-Leiste pro Fenster (`Views/AgentTerminalView.swift`, `Views/AgentSessionDetailView.swift`)
- **Fünf Session-Arten** (`AgentSessionKind`): `chat`, `agentView` (claude agents Dashboard), `backgroundChat` (`claude --bg` + attach), `subagentJob` (headless Codex-Job), `terminal` (Login-Shell im Projekt-cwd)
- **Provider-übergreifend**: Claude Code UND Codex CLI im selben Manager

### Tab-Management (browserähnlich)
- Multi-Select (Cmd/Shift-Klick) + Bulk-Aktionen (Schließen/Archivieren/Pinnen/Farbe)
- Drag & Drop Reorder, Sessions zwischen Projekten und Fenstern verschieben
- Tear-off-Windows (Tab herausziehen → neues Fenster), Multi-Window persistiert
- Ctrl-Tab-Switcher (Karten-Grid-Overlay), Overflow-Menü, Mausrad/Swipe
- Reopen zuletzt geschlossener Tabs (LIFO, Cap 20)

### Sidebar / Organisation
- **Projektgruppierung** (`ProjectChatGroup`) oder flach nach Recency; Scope Aktiv/Zuletzt/Alle
- Pinning, Farbmarkierungen (Projekt + Session), automatische Projekt-Icons
- **Live-Session-Status pro Row** (working / awaiting-input / idle / stopped / errored)
- Archiv-Modus mit Volltextsuche im Transkript
- Ressourcenmonitor (CPU/RAM aller Sessions, pro Projekt/Session)

### Detailfläche
- **Grid-/Split-View**: bis 9 PTY-Panes gleichzeitig, Split-Verhältnisse persistiert, Pane-Maximize, Fokusnavigation per Tastatur
- Klickbare Links (Cmd-Klick: Web→Browser, Code→IDE, `path:line`-Auflösung)
- Finder-Datei-Drop ins Terminal (shell-escaped)
- **Transkript-Timeline** parallel zum Terminal (gerenderte Runden: Prompts, Tools, Markdown)
- Transkript-Browsing geschlossener Sessions (Terminal-Snapshot oder geparste JSONL)
- Auto-Naming + Summaries via kurzem Headless-CLI-Call

### Background-Agents & Subagents
- Claude Background-Agents (`claude --bg`) — überleben App-Neustart (Claude-Daemon parented), attach in Tab
- Codex-Subagent-Jobs (headless, supervised, Report-Routing in Parent-Chat)
- **CLI-Fernsteuerung „Jarvis"** (`whisperm8 chats`): Unix-Socket-Control-Server mit NDJSON-Protokoll — send/interrupt/open/close/new/rename/archive/pin/move (`Services/AgentChats/AgentControlServer.swift`)

## 2. PTY/Prozess-Management (Kernerkenntnisse)

- **SwiftTerm** kapselt forkpty + Terminal-Emulation → Web-Äquivalent: **node-pty + xterm.js**
- Argv-Konstruktion zentral in `AgentCommandBuilder.swift` (neu vs. `--resume`/`--fork-session`, Modell, Effort) — direkt portierbar
- **Login-Shell-PATH-Problem**: GUI/launchd-Prozesse erben minimalen PATH → einmal `zsh -l -c 'echo $PATH'` cachen (`LoginShellEnvironment.swift`). Gilt für node-pty identisch!
- Env-Injektion `WHISPERM8_SESSION_ID`/`_TOKEN` zur Selbst-Identifikation von CLIs im PTY
- **Vordergrund-PTYs sterben mit der App** — Restore via `claude --resume`, nicht Prozess-Wiederbelebung. Snapshot beim Quit (2× Ctrl+C graceful, dann Buffer-Snapshot, `TerminalSnapshotStore.swift`)
- **Feed-Drosselung** (`TerminalFeedBatcher.swift`): fokussierte Pane sofort, Hintergrund gebündelt ~12,5 Hz — Pflicht für Grid mit vielen Sessions
- Send-Pipeline: Bracketed Paste (`ESC[200~…ESC[201~`) gegen Newline-Auto-Submit, CR nach 80 ms

## 3. Session-Status-Erkennung ⭐ (wichtigster Baustein)

Single-Writer: `AgentSessionStatusCoordinator.swift`. Zwei Quellen:

### Primär (Claude): Hook-Bridge — event-getrieben, kein Polling
- Temporäre Settings-JSON via `claude --settings <path>` mit Hooks: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`
- Hook-Command: `(cat; echo) >> "<eventfile>"` (kein jq nötig), App watcht das JSONL per vnode
- Ableitung: Tool-Events = **working**; `PermissionRequest` / `PreToolUse[AskUserQuestion|ExitPlanMode]` = **awaitingInput**; `Stop` = turn done → Notification
- Bewusst NICHT der `Notification`-Hook (feuert auch bei 60s-Idle → false positives)
- Dateien: `ClaudeHookBridge.swift`, `ClaudeHookSettingsBuilder.swift`

### State-Machine (pur, unit-getestet)
- `AgentSessionStateMachine.swift`: Reducer `(Zustand, Signal) → (Zustand, Effekte)`, kein I/O
- Zustände: created/launching/ready/working/awaitingInput(kind)/turnDone/stopped/errored
- Effekte nur bei echten Übergängen = Dedup-Garantie gegen Doppel-Notifications
- Priorität: „Hooks schlagen Transcript"

### Fallback: Transkript-Parsing (Codex + hookless)
- vnode-Watch auf Transkript-JSONL (`~/.claude/projects/<encoded-cwd>/<id>.jsonl`, `~/.codex/sessions/...`)
- stat-first-Optimierung (mtime+size unverändert → nur 1 Syscall)
- `stop_reason` ∈ {tool_use, pause_turn} = working (kein Turn-Ende!); `end_turn` etc. = idle; `[Request interrupted by user]` = Abbruch (Stop-Hook feuert bei ESC nicht!)
- Stall-Timeout 120 s als Sicherheitsnetz
- Externe Session-Discovery via FSEvents auf `~/.claude/projects`

## 4. Persistenz

Root: `~/Library/Application Support/WhisperM8/`

| Datei | Inhalt |
|---|---|
| `AgentSessions.json` | Workspace: Projekte + Sessions (KEINE UI) |
| `agent-ui-state.json` | UI-Sidecar: Fenster, Tabs, Pinning, Grid-Workspaces |
| `agent-session-index-cache.json` | Discovery-Cache (mtime+size) |
| `agent-jobs/<id>/` | Subagent-Job-State/Events/Logs |
| `claude-hooks/`, `claude-session-events/` | Hook-Settings + Event-Streams (0600) |

**Design-Prinzipien (übernehmen!):**
- Strikte Trennung Session-Daten ↔ UI-State (UI-Churn invalidiert nie Session-Daten)
- Mutationen serialisiert, diff-gated + debounced (0,5 s) + atomar persistiert
- `~/.claude/` / `~/.codex/` strikt read-only behandeln
- Schema-Migration mit lenientem Decoding (unbekannte enum-Werte → nil statt Decode-Fehler)
- Resume-Recovery: vor `claude --resume` prüfen ob JSONL existiert; sonst Rebind/Fresh-Start

## 5. Multi-Projekt

- `AgentProject`: id, name, path, color, lastBranch, sortIndex, Icon, contextProfileID
- Automatische Projekterstellung aus cwd externer Sessions
- Tabs projektübergreifend; „Neuer Chat" mit durchsuchbarem Projekt-Popover
- Projekt-Inspector: Branch, Git-Status, Öffnen in Finder/IDE

## 6. UX-Details

- Shortcuts: ⌘W/⌘N/⌘1–9, ⌘⌥←→ Tab-Wechsel, Ctrl+Tab-Switcher, Ctrl+⌘+Pfeil Pane-Fokus
- **Notifications**: turnCompleted („Agent fertig"), inputRequested („wartet auf Berechtigung/Frage/Plan-Freigabe"), mit 2s-Throttle je Session+Art; Klick fokussiert richtiges Fenster+Tab
- Completion-Sound getrennt konfigurierbar; Rückfragen bewusst lautlos
- Ungelesen-Marker für fertige Subagent-Ergebnisse; „Stop all" global
- Missing-Transcript-Erkennung (tote Sessions ausgegraut statt resumebar)

## 7. Git/Worktrees

- `GitBranchReader.swift`: Branch direkt aus `.git/HEAD` lesen (kein Subprozess, 20–150 ms gespart); behandelt Worktree/Submodule (`gitdir:`-Datei)
- `AgentWorktreeManager.swift`: Opt-in `git worktree add <dest> -b subagent/<id>`, Sauberkeitsprüfung vor Entfernen
- Kein Merge-/Konflikt-Management, kein Git-Flow-Dashboard — Worktrees nur zur Job-Isolation

## 8. Portierungs-Empfehlung (Web-App)

**Zuerst portieren (pur, getestet, plattformneutral):**
1. `AgentSessionStateMachine.swift` → TS-Reducer
2. `AgentSessionTranscript.swift` → Transkript-Parser + Status-Decider + JSONL-Locator
3. `ClaudeHookSettingsBuilder.swift` + `ClaudeHookBridge.swift` → Hook-basierte Status-Erkennung
   (Tests dazu = fertige Spezifikation: `Tests/WhisperM8Tests/AgentSessionStateMachineTests.swift` u.a.)

**Web-Vorteil gegenüber WhisperM8:** node-pty-PTYs leben am Server weiter, wenn der
Browser-Tab zugeht — xterm.js kann jederzeit reconnecten. Snapshot-Konzept trotzdem
behalten (Server-Neustart).

**macOS-spezifisch, anders lösen:** SwiftTerm→xterm.js/node-pty, NSEvent-Shortcuts→Browser-KeyEvents, Link-Handler→WebLinksAddon, Multi-Window→Browser-Fenster + Server-State, FSEvents→chokidar, Notifications→Web Notifications API.
