# Gewünschter Funktionsumfang — Neues Tool (Arbeitstitel: „sdd-toolkit")

Lokale Web-App (Server + Browser-UI), die den spec-kit-SDD-Workflow über mehrere Projekte
orchestriert. Entwurfsgrundlage: `inventar-whisperm8.md`, `inventar-speckit-assistant.md`,
`level-3-anforderungen.md`.

## Leitidee: Automation-Dial statt zwei Tools

Das Tool unterstützt **Level 2 (Orchestrator)** und **Level 3 (Supervised Autonomy)**
vollumfänglich — nicht als getrennte Modi, sondern als **einzeln schaltbare
Automationsstufen** (global, pro Projekt, pro Feature überschreibbar):

| Automation | Level 2 (aus) | Level 3 (an) |
|---|---|---|
| Phasen-Progression | User zieht Karte / klickt „Run" | Phase fertig → nächste startet automatisch |
| Review-Gates | User liest jede Phase | Code-/Security-Review-Agents, Mensch nur bei FAIL |
| Verifikation | User führt Tests selbst aus | Test/Build/Lint-Pipeline läuft automatisch vor Review |
| Merge | User merged selbst | Merge-Queue mit Auto-Konfliktauflösung |
| Aufmerksamkeit | User beobachtet Konsolen | Exception-Inbox: nur was Handlung braucht |

Damit ist der Weg 2→3 im Tool selbst abgebildet: Man dreht die Automation hoch, sobald man
dem Loop vertraut („Trust in the loop" ist laut Adoption-Modell der Engpass).

---

## Modul 1: Multi-Projekt-Verwaltung

- [P0] **Projekt-Registry**: mehrere Git-Repos gleichzeitig registriert (Name, Pfad, Farbe, Icon, Default-Branch), SQLite-persistiert
- [P0] **Brownfield-Onboarding**: bestehendes Repo hinzufügen → Erkennung ob spec-kit (`.specify/`, `specs/`) vorhanden; falls nein: geführte Initialisierung (`specify init --here`); bestehende `specs/<feature>`-Ordner werden automatisch als Features importiert
- [P0] **Projekt-Sidebar** mit Gruppierung (wie WhisperM8): Features je Projekt, Live-Statuspunkte, Pinning, Farben
- [P1] Projekt-Inspector: Branch, Git-Status, Öffnen in Finder/IDE
- [P2] Automatische Projekt-Discovery aus extern gestarteten Claude-Sessions

## Modul 2: SDD-Workflow-Engine (spec-kit-kompatibel)

- [P0] **Phasen-Modell** wie speckit-assistant (`constitution → specify → clarify → plan → checklist → analyze → tasks → implement`; taskstoissues optional), Status `idle → running → awaiting_review → approved` + `stale`
- [P0] **Slash-Command-Mapping** auf `/speckit.*` — die Specs bleiben im Ziel-Repo (`specs/<feature>/`), das Tool hält nur Orchestrierungs-Metadaten. Single Source of Truth = Dateisystem des Repos
- [P0] Downstream-Staleness bei Discard; Task-Checkbox-Parsing für Implementierungs-Fortschritt
- [P0] **Auto-Progression (schaltbar)**: Phase erfolgreich beendet → nächste Phase startet automatisch („Claude kickt Claude an"); konfigurierbar bis zu welcher Phase (z. B. auto bis `tasks`, Stopp vor `implement`)
- [P1] Reconciliation beim Laden (Datei existiert → awaiting_review) + **Startup-Reaper** für verwaiste `running`-States (Fix des speckit-assistant-Bugs)
- [P2] Spec-Agents/Personas als konfigurierbare Hook-Agents (Product Owner, Architektur …)

## Modul 3: Feature-Lifecycle mit Git-Worktrees

- [P0] **Worktree pro Feature**: Feature anlegen → `git worktree add .worktrees/<feature> -b feature/<name>`; alle Phasen-Agents und die Feature-Konsole laufen im Worktree-cwd → parallele Features kollidieren nie
- [P0] Worktree-Lifecycle: Sauberkeitsprüfung vor Entfernen (wie WhisperM8 `AgentWorktreeManager`), Cleanup nach Merge
- [P1] Worktree-Status im Dashboard (ahead/behind main, dirty, Konfliktpotenzial-Anzeige gegen andere offene Features)
- [P2] Optional: Feature ohne Worktree (direkt auf Branch) für Solo-Arbeit

## Modul 4: Konsole pro Feature ⭐

- [P0] **Ein persistentes PTY pro Feature** (node-pty am Server, xterm.js im Browser, WebSocket bidirektional). PTYs leben am Server weiter, wenn der Browser-Tab zugeht — Reconnect jederzeit (struktureller Vorteil gegenüber WhisperM8)
- [P0] Login-Shell-Spawn (`$SHELL -l -c`) + PATH-Fix (WhisperM8 `LoginShellEnvironment`-Muster)
- [P0] Argv-Builder: neu vs. `claude --resume <id>`, Modell/Effort, `--settings <hook-file>`
- [P0] Send-Pipeline: Bracketed Paste + verzögertes CR (WhisperM8-Muster)
- [P1] **Grid-/Split-View**: mehrere Feature-Konsolen nebeneinander (bis 9 Panes), Feed-Drosselung für Hintergrund-Panes (~12 Hz, WhisperM8 `TerminalFeedBatcher`-Muster)
- [P1] Terminal-Snapshots für Scrollback-Restore nach Server-Neustart; Resume-Recovery (JSONL-Existenz prüfen vor `--resume`)
- [P1] Klickbare Links/Dateipfade (xterm WebLinksAddon + `path:line`-Auflösung, Öffnen in IDE)
- [P2] Zusätzliche freie Terminals pro Projekt (Login-Shell im Repo-cwd)
- [P2] Transkript-Timeline (gerenderte Runden parallel zum Terminal) + Browsing geschlossener Sessions

## Modul 5: Session-Status-Erkennung (WhisperM8-Port) ⭐

- [P0] **Claude-Hook-Bridge**: Settings-JSON mit Hooks (`SessionStart/Stop/UserPromptSubmit/PreToolUse/PostToolUse/PermissionRequest/SessionEnd`) via `claude --settings`; Hook-Command = simples Datei-Append; chokidar-Watch auf Event-JSONL. `PermissionRequest`/`AskUserQuestion`/`ExitPlanMode` → **awaitingInput**
- [P0] **Status-State-Machine** (TS-Port des WhisperM8-Reducers): created/launching/ready/working/awaitingInput/turnDone/stopped/errored; Effekte nur bei echten Übergängen (Notification-Dedup); „Hooks schlagen Transcript"
- [P1] **Transkript-Fallback**: JSONL-Parser (`stop_reason`-Semantik: tool_use/pause_turn ≠ fertig; ESC-Abbruch nur aus Transcript erkennbar), stat-first, Stall-Timeout 120 s
- [P2] Auto-Naming + Summaries via Headless-Call

## Modul 6: Verifikation & Review-Gates (Level-3-Kern)

- [P0] **Verifikations-Pipeline pro Projekt konfigurierbar** (Test-/Build-/Lint-Kommandos); läuft nach `implement` automatisch im Worktree; Ergebnis als Gate-Status am Feature
- [P1] **Review-Agents (schaltbar)**: Code-Review + Security-Review als Headless-Läufe (`claude -p`) mit VERDICT-Parsing (speckit-assistant-Muster); sequentielles Gate, Stopp bei FAIL
- [P1] **Human Review Portal**: Diff-Ansicht des Feature-Branches gegen main (Datei-Liste, Syntax-Highlighting, Commit-History), Approve/Reject; bei Level 3 der primäre Arbeitsmodus
- [P2] Markdown-Editor für Spec-Dateien direkt im Portal

## Modul 7: Merge-Queue mit Auto-Konfliktauflösung ⭐ (Alleinstellungsmerkmal)

- [P0] **Merge-Queue pro Projekt**: approvte Features werden sequentiell integriert: fetch → rebase auf main → Verifikation → merge (ff oder squash, konfigurierbar) → Worktree-Cleanup → nächstes Feature
- [P0] **Auto-Konfliktauflösung**: Rebase-Konflikt → Headless-Agent (`claude -p`) bekommt Konfliktdateien + beide Spec-Kontexte (`specs/<feature>/` beider Seiten) und löst auf; danach zwingend erneute Verifikations-Pipeline; bei Scheitern oder rotem Test → Eskalation an Exception-Inbox statt Blind-Merge
- [P1] Konflikt-Transparenz: Was wurde wie aufgelöst (Diff der Auflösung) im Review-Portal einsehbar
- [P1] Optionaler PR-Modus: statt lokalem Merge einen GitHub-PR erstellen (`gh pr create`), Auto-Resolution als Push auf den PR-Branch
- [P2] Präventive Konfliktwarnung: offene Features, die dieselben Dateien anfassen, früh markieren

## Modul 8: Dashboard & Visualisierung

- [P0] **Kanban-Board** über alle Projekte (filterbar pro Projekt): Spalten = SDD-Phasen + „Verify/Review/Merge-Queue/Done"; Drag-to-Advance (speckit-assistant-Muster)
- [P0] **Exception-Inbox („Braucht dich")**: eine priorisierte Liste — Agent wartet auf Input, Permission-Request, Gate FAIL, Merge-Konflikt eskaliert, Review fällig. Klick → springt in die richtige Feature-Konsole/das Portal. Monitoring by exception = Level-3-Arbeitsmodus
- [P1] DAG-/Graph-Ansicht: Feature-Abhängigkeiten + Merge-Queue-Reihenfolge
- [P1] Executions-View: jeder Agent-Lauf mit Dauer, Kosten, Tokens, Exit-Code, Logs
- [P2] Kosten-Dashboard über Projekte/Zeit (CostMeter-Port)

## Modul 9: Notifications

- [P0] Web Notifications + Sound: Agent fertig / wartet auf Input / Gate FAIL / Konflikt eskaliert; Throttle je Session+Art (WhisperM8-Muster); Klick fokussiert Feature
- [P2] Optional Push auf Mobile (z. B. ntfy.sh-Adapter)

## Modul 10: Persistenz & Robustheit (Fix der speckit-assistant-Schwächen)

- [P0] **SQLite** (better-sqlite3, WAL) statt JSON-Dateien: Projekte, Features, Phasen-Status, Sessions, Executions, Queue-Status — atomar, transaktional
- [P0] **Prozess-Registry mit Reaper**: PTY-PIDs persistiert; nach Server-Neustart laufende Prozesse adoptieren oder sauber als gestorben markieren + `running`-Leichen bereinigen; Sessions via `claude --resume` wiederaufnehmbar
- [P0] Strikte Trennung Orchestrierungs-State (DB) ↔ UI-State (pro Browser, localStorage) ↔ Spec-Wahrheit (Dateisystem im Repo)
- [P0] `~/.claude/` read-only behandeln; Repo-Specs gehören dem Repo
- [P1] Append-only Execution-Log (JSONL pro Lauf) + Rotation

## Modul 11: Agent-Konfiguration

- [P0] Claude Code als Erst-Provider: Modell, Effort, Permission-Mode **konfigurierbar** (kein hart kodiertes bypassPermissions; Default: `acceptEdits` im Worktree, eskalierbar)
- [P1] Agent-Profile (YAML/DB) pro Projekt; MCP-Server pro Projekt in native Configs übersetzen (speckit-assistant-Muster, mit Backups)
- [P2] Weitere Provider (Codex CLI, Gemini) über AgentRunnerPort-Abstraktion

## Modul 12: Fernsteuerung & Automation

- [P1] REST/WS-API für alles (das UI ist nur ein Client) — Basis für CLI und „Claude steuert das Tool"
- [P2] CLI (`sdd chats`-Äquivalent zu WhisperM8 „Jarvis"): Features anlegen, Status abfragen, Prompts senden — damit kann ein Meta-Agent das Tool bedienen (Level 3→4-Pfad)
- [P2] Routinen: wiederkehrende Aufgaben (z. B. Dependency-Updates) als geplante Feature-Runs

---

## Priorisierung

- **P0 = MVP**: Multi-Projekt + spec-kit-Engine + Worktree pro Feature + Konsole pro Feature + Hook-Status + Merge-Queue mit Auto-Resolution + Kanban + Exception-Inbox + SQLite-Persistenz. Damit sind alle 6 Ursprungs-Anforderungen und der Level-2-Betrieb abgedeckt; Level 3 in Grundform (Auto-Progression, Verifikations-Gate, Auto-Merge)
- **P1 = Level 3 komplett**: Review-Agents, Review-Portal, Grid-View, Transkript-Fallback, PR-Modus, Executions-View, DAG
- **P2 = Komfort & Skalierung**: Multi-Provider, CLI-Fernsteuerung, Routinen, Timeline, Kosten-Dashboard

## Fixierte Entscheidungen (2026-07-22)

1. **Merge-Modus**: Lokal mergen im MVP (rebase → verify → merge); PR-Modus via `gh` als P1, pro Projekt konfigurierbar
2. **Provider**: Claude Code zuerst; AgentRunnerPort hält Codex/Gemini offen (P2)
3. **Tech-Stack**: Fastify + WebSockets + Vite/React (kein Next.js) — bestätigt

## Tech-Stack (Vorschlag)

- **Server**: Node.js + TypeScript, Fastify + `ws` (WebSockets) — bewusst KEIN Next.js-API-Layer: langlebige PTYs + bidirektionale Streams passen nicht zu Serverless-Style-Routen (speckit-assistant musste deshalb SSE+POST-Krücken bauen)
- **Frontend**: React + Vite, xterm.js (+ WebLinksAddon), ReactFlow (DAG), Tailwind
- **Persistenz**: better-sqlite3 (WAL); Spec-Wahrheit bleibt im Ziel-Repo-Dateisystem
- **PTY**: node-pty mit Loader-Fallback (speckit-assistant `ptyLoader`-Muster)
- **Git**: eigene Wrapper über `git`-CLI (async), `.git/HEAD`-Direktlese für Branch-Anzeige
- **Tests**: Vitest; State-Machine + Transkript-Parser + Merge-Queue als pure, getestete Kerne (WhisperM8-Tests als Spezifikation)
