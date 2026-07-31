# Feature-Inventar: speckit-assistant (Referenz-Repo)

Analysiert: `reference/speckit-assistant` (v0.4.0). Stack: Next.js 15, React 19, TypeScript,
node-pty, ReactFlow, d3-force, chokidar, xterm.js. Lizenz: MIT.

**Kernaussage:** Lokaler, Single-Workspace-Orchestrator für den spec-kit-Workflow. Spawnt
Agent-CLIs unter echtem PTY, streamt Output live per SSE — aber Prozesszustand ist rein
In-Memory (Verlust bei Server-Neustart). Git strikt read-only, keine Worktrees, keine
Konfliktauflösung.

## 1. Funktionsumfang (User-Features)

### Workflow-Sektion (3 Ansichten)
- **Kanban-Board** (`src/components/KanbanBoard.tsx`): Spalten je SDD-Phase; Karten mit Status-Badge (idle/running/awaiting_review/approved + stale), Task-Fortschritt, Persona-Gate-Chips. **Drag-to-Advance**: vorwärts = Zwischenphasen auto-approven + Zielphasen-Agent starten; rückwärts = Phase verwerfen + Downstream stale
- **DAG Map** (`src/components/DagMap.tsx`): ReactFlow-Graph der Feature-/Phasen-Abhängigkeiten
- **Agent Executions View**: jeder Lauf mit Status, Dauer, Kosten, Tokens, Exit-Code; gespeicherte Logs; force-directed Execution-Graph (d3); DevOps-On-Demand-Toolbar

### Weitere Features
- **Human Review Portal** (`HumanReviewModal.tsx`): 3 Tabs — Git-Diff pro Datei, Commit-History, Projektbaum mit Syntax-Highlighting; Kosten/Token-Charts; „Approve & Merge"-Button (**macht KEIN echtes git merge** — setzt nur Phasenstatus!)
- WYSIWYG-Markdown-Editor mit Toolbar, direktes Speichern
- Multi-File-Checklisten (`checklists/`-Verzeichnis mit Sub-Tabs)
- Agent-Profile in `.specify/agents.yaml` (claude/gemini/copilot/openai/custom), ein aktiver Agent
- MCP-Server zentral in `.specify/mcp.yaml`, Übersetzung in native CLI-Configs (`.mcp.json`, `~/.gemini/settings.json`, `~/.codex/config.toml`) mit `.bak`-Backups
- Extension-Manager (Bundled + GitHub-ZIP), specify-CLI-Installer (uv/venv)
- Spec-Agents (Product Owner, Architecture, …) als `after_specify`-Hooks
- **Review-Personas / Implementation Gate**: QA → Code Review → Security → Tech Lead, sequentiell, Verdict via Regex `VERDICT: (PASS|FAIL)` aus `specs/<feature>/reviews/<id>.md`
- Kosten-/Token-Erfassung pro Lauf (Parsing + Schätzungs-Fallback, `CostMeter.ts`)

## 2. SDD-Workflow-Abbildung

**9 Phasen** (`src/domain/models/types.ts`):
`constitution → specification → clarification → planning → checklist → analyze → tasks → taskstoissues → implementation`

**Phasen-State-Machine:** `idle → running → awaiting_review → approved` (+ `stale`-Flag)
- Reconciliation beim Laden: Datei existiert + idle → awaiting_review; running/approved sind „User-States"
- Downstream-Staleness bei discard; Auto-Approval-Kette bei Vorwärts-Drag
- Implementation-Auto-Review: alle Task-Checkboxen abgehakt → awaiting_review

**Slash-Command-Mapping** (`ProcessAgentRunner.ts:16`): Phase → `/speckit.<command>` mit `specs/<feature>` als Argument. Claude-Aufruf: `claude --permission-mode bypassPermissions "<prompt>"` (Hinweis: bypassPermissions ist hier hart kodiert — im Neubau konfigurierbar machen).

## 3. Architektur

Hexagonal (ADR in `docs/adr-001-hexagonal-architecture.md`):
- `domain/models` + `domain/services` (WorkflowService = Kern-State-Machine) + `domain/ports` (in/out)
- `adapters/secondary`: FS-Repositories, ProcessAgentRunner (PTY), ptyLoader (mit child_process-Fallback)
- DI: manuelle Modul-Singletons (`adapters/di.ts`)
- **PTY-Spawn**: node-pty über Login-Shell (`$SHELL -l -c`), echtes TTY für interaktive CLIs; `activeProcesses: Map<string, IPty>`
- SSE-Streaming (`event: log|done|error`), Input via separatem POST → PTY

## 4. Persistenz & Schwachstellen ⚠️

| Ort | Inhalt |
|---|---|
| `.specify/.runtime/workflow-state.json` | Phasenstatus, stale, cost, Persona-Status (nur Metadaten) |
| `.specify/.runtime/executions.jsonl` | Append-only: Start-Snapshot + Finish-Patch, reduce-by-id |
| `.specify/.runtime/logs/<id>.log` | Roh-Output pro Lauf |
| `.specify/*.yaml` | agents, mcp, personas, spec-agents, devops-agents |
| `~/.speckit-assistant-config.json` | lastWorkspacePath |

**Bestätigte Schwachstellen (Ursache der beobachteten Persistenz-Probleme):**
1. **Laufende Prozesse rein In-Memory** — bei Server-Neustart verwaisen Agents; `workflow-state.json` behält `running` für immer (kein Startup-Reaper) → Phasen hängen dauerhaft
2. Kein Locking / keine atomaren Writes (`writeFileSync` ohne temp-rename) → Races bei parallelen Läufen
3. `executions.jsonl` wächst unbegrenzt (keine Rotation)
4. Single-Server-Prozess, kein Multi-Instanz-Support

## 5. Konsolen

- **Eine geteilte Agent-Run-Console** (xterm.js) + globales `running`-Flag in der UI — Backend könnte parallel, UI kann es nicht. **Keine Konsole pro Feature** (bestätigt die Beobachtung)
- Bidirektional: Keystrokes via POST → writeStdin → PTY (interaktive Picker bedienbar)
- Ein persistentes Workspace-Terminal (Login-Shell, überlebt Tab-Wechsel)
- Execution-Logs nur nach Abschluss (statisches `<pre>`)

## 6. Multi-Workspace

**Nein.** Globaler `WORKSPACE_PATH` (env bzw. Config-Datei), kein UI-Wechsel, Wechsel nur per Neustart mit `-w`. Alle 25+ API-Routen nutzen den globalen Wert.

## 7. Git

Read-only: `git diff --numstat`, Commit-Log, Branch via `execSync` (blockiert Event-Loop). **Keine** Worktrees, kein checkout/commit/merge/rebase. „Konfliktauflösung" = passiver chokidar-Watcher, der externe Datei-Änderungen meldet.

## 8. Übernehmbare Konzepte für den Neubau

1. **Domänenmodell** `types.ts`: WorkflowPhase, PhaseStatus, PhaseState, FeatureWorkflow, CostMetadata — sauber & kompakt
2. **WorkflowService**: recordRun-Wrapper (Logging+Cost+Status in einem), Downstream-Staleness, Task-Checkbox-Parsing, sequentielles Review-Gate mit VERDICT-Regex-Fallback
3. **Hexagonale Ports** (AgentRunnerPort etc.) — späterer Austausch spawn↔API-LLM möglich
4. **Append-only Execution-History** (JSONL, Start-Snapshot + Finish-Patch, seq-Tiebreaker)
5. **CLI-agnostisches Cost-Metering** (Parsing + Token-Schätzung × Preistabelle, ANSI-Strip)
6. **MCP-Multi-CLI-Translation** (pure translate-Funktionen + FS-Adapter, .bak-Backups)
7. **PTY-Loader** mit Fallback + exec-Bit-Reparatur
8. **UI-Konzepte**: Kanban Drag-to-Advance, Human Review Portal (Diff/Tree/Analytics), „console mounted-but-hidden"-Trick für xterm-Scrollback-Erhalt
9. **Extension-Hook-Mechanik**: priority-geordnetes idempotentes YAML-Merging

**Anders machen:** persistente Prozess-Registry + Reaper, atomare Writes/Locking, Multi-Workspace, Worktrees pro Feature, Konsole pro Feature, echte Git-Schreiboperationen hinter „Approve & Merge", WebSocket statt SSE+POST, Permission-Mode konfigurierbar.
