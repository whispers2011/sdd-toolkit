# Funktionsübernahme aus WhisperM8 & speckit-assistant

Kuratierte Liste: Was aus den Referenz-Repos übernommen wird, was schon da ist, was
bewusst wegbleibt. Quellen-Kürzel: **W** = WhisperM8, **S** = speckit-assistant,
**E** = Eigenentwicklung ohne Vorbild. Details zu den Quellen: `inventar-whisperm8.md`,
`inventar-speckit-assistant.md`.

## 1. Bereits im MVP umgesetzt (Stand 2026-07-22)

| Funktion | Quelle | Umsetzung |
|---|---|---|
| Hook-Bridge (Status via `--settings` + Event-JSONL) | W | `server/src/pty/hookBridge.ts` |
| Session-Status-State-Machine (Reducer, Effekt-Dedup) | W | `shared/src/sessionMachine.ts` |
| Login-Shell-PATH-Fix | W | `server/src/pty/loginShellEnv.ts` |
| Send-Pipeline (Bracketed Paste + verzögertes CR) | W | `server/src/pty/commandBuilder.ts` |
| Graceful Terminate (2× Ctrl+C) | W | `server/src/pty/sessionManager.ts` |
| Branch-Reader (`.git/HEAD` direkt, Worktree-fähig) | W | `server/src/git/branchReader.ts` |
| Worktree-Manager (Sauberkeitsprüfung, idempotent) | W | `server/src/git/worktrees.ts` |
| Phasen-Modell + State-Machine (Staleness, Reconcile) | S | `shared/src/phaseMachine.ts` |
| Kanban mit Drag-to-Advance | S | `web/src/components/KanbanBoard.tsx` |
| Task-Checkbox-Fortschritt | S | `server/src/services/artifacts.ts` |
| Startup-Reaper (Fix des S-Persistenz-Bugs) | E | `orchestrator.reapOnBoot()` |
| Merge-Queue + Auto-Konfliktauflösung | E | `server/src/services/mergeQueueService.ts` |
| Exception-Inbox („Braucht dich") | E | `web/src/components/AttentionInbox.tsx` |
| Automation-Dial (Level 2 ↔ 3) | E | `web/src/components/AutomationDial.tsx` |

## 2. Zu übernehmen — Priorität 1 (macht Level 2 komplett & Level 3 vertrauenswürdig)

| # | Funktion | Quelle / Vorbild | Warum |
|---|---|---|---|
| W1 | **Transkript-Fallback-Statuserkennung**: JSONL-Watcher auf `~/.claude/projects/<encoded-cwd>/<id>.jsonl`, `stop_reason`-Semantik (`tool_use`/`pause_turn` ≠ fertig), `[Request interrupted by user]`-Erkennung, stat-first, Stall-Timeout 120 s | W: `AgentSessionTranscript.swift` (+ Tests als Spec) | ESC-Abbruch feuert KEINEN Stop-Hook — ohne Transkript-Parsing zeigt das Tool nach Abbruch dauerhaft „working". Zudem Grundlage für Codex (P2) |
| W2 | **Terminal-Snapshots + Resume-Recovery**: Scrollback-Snapshot bei Server-Shutdown/Session-Ende; vor `claude --resume` prüfen, ob Transkript-JSONL existiert, sonst Rebind/Fresh-Start | W: `TerminalSnapshotStore.swift`, `repairResumeStateBeforeLaunch` | Kein Kontextverlust nach Server-Neustart; nie blindes Resume auf tote IDs |
| W3 | **Grid-/Split-View** (bis 9 Konsolen-Panes) mit **Feed-Drosselung** (fokussierte Pane sofort, Hintergrund ~12 Hz gebündelt) | W: `AgentGridWorkspace.swift`, `TerminalFeedBatcher.swift` | Level 2 = 5–10 Sessions gleichzeitig beobachten; ohne Drosselung bricht der Browser ein |
| W4 | **Notifications-Feinschliff**: Throttle je Session+Art (2 s), Completion-Sound (konfigurierbar), Rückfragen lautlos, Klick fokussiert Feature-Konsole | W: `AgentSessionNotifier.swift` | Viele parallele Agents ohne Notification-Spam |
| W5 | **Klickbare Links** in der Konsole (WebLinksAddon + `pfad:zeile`-Erkennung → Öffnen im Editor via Server, Editor konfigurierbar) | W: `TerminalLinkResolver.swift` | Schnellster Weg vom Agent-Output in den Code |
| S1 | **Review-Agents / Implementation-Gate**: konfigurierbare Personas (Default: Code-Review → Security), sequentiell als Headless-Läufe im Worktree, Verdict via `VERDICT: PASS/FAIL` aus `specs/<f>/reviews/<id>.md`, Exit-Code-Fallback; Gate stoppt beim ersten FAIL → Inbox | S: `WorkflowService.runImplementationGate`, `personas.ts` | Kern von `autoReviewAgents` — Level-3-Anforderung „automatisches Code-/Security-Review by default" |
| S2 | **Human-Review-Portal**: Diff pro Datei (numstat + Einzeldiff, Syntax-Highlighting), Commit-Historie, **Diff der Auto-Konfliktauflösung**, Approve & Merge (echtes Merge via Queue — nicht nur Status wie bei S!) | S: `HumanReviewModal.tsx`; E4 | Level 3 = Diffs reviewen statt Konsolen beobachten; Vertrauen in Auto-Resolution braucht Transparenz |
| S3 | **Cost-/Token-Metering**: CLI-Output-Parsing mit Schätzungs-Fallback (Token × Preistabelle), ANSI-Strip, `source: parsed/estimated`, pro Execution in DB | S: `CostMeter.ts`, `pricing.ts` | Level-3-Engpass „Token-Effizienz beobachten" |
| S4 | **Executions-View**: alle Läufe (Phase/Verify/Review/Konfliktauflösung) mit Status, Dauer, Kosten, Exit-Code + Log-Viewer | S: `ExecutionsView.tsx` | Audit-Trail; DB + Logs existieren bereits, fehlt nur UI |
| S7 | **Agent-Profile & Projekt-Einstellungen-UI**: Modell, Effort, Permission-Mode pro Projekt/Feature; Verify-Kommandos, enabledPhases, Automation-Overrides, Farben editierbar | S: `agents.yaml`-Konzept; E2 | Ohne UI ist Konfiguration nur per API möglich |
| S11 | **spec-kit-Init im Onboarding**: Repo ohne spec-kit → geführte Initialisierung (`uvx specify-cli init --here` in Projekt-Terminal), Erkennung + Hinweis statt stillem Weiter | S: `ProcessSpecifyRunner.ts` | „Bestehende Projekte einfach integrieren" zu Ende gedacht |
| S12 | **Projekt-Terminal**: persistente Login-Shell pro Projekt (eigener Tab) | S: `terminalManager.ts` | Für Init, Git-Handgriffe, Debugging; Infrastruktur (`kind: 'shell'`) existiert |
| S13 | **Change-Guard**: chokidar auf `specs/**` → Phasen-Reconcile + UI-Refresh bei externen Änderungen | S: `/api/state/watch` | Specs können außerhalb des Tools editiert werden |
| E1 | **PR-Modus** (pro Projekt): statt lokalem Merge `gh pr create`; Auto-Resolution pusht auf den PR-Branch | E (Entscheidung 2026-07-22) | Team-Workflows / Audit-Trail |

## 2b. Quality-of-Life (Priorität 1 — „Kleinigkeiten, die das Arbeiten erleichtern")

| # | Funktion | Quelle | Umsetzung |
|---|---|---|---|
| Q1 | **Ordnerauswahl statt Pfadeingabe** beim Projekt-Hinzufügen | E | Browser können keine absoluten Pfade liefern → Server öffnet nativen Finder-Dialog (`osascript` `choose folder`); Fallback: serverseitiger Verzeichnis-Browser (`GET /api/fs/dirs`) mit Navigations-UI + Vorschläge (Geschwister-Ordner bestehender Projekte) |
| Q2 | **Voice-Eingabe** für Prompts/Konsole (Mikro-Button + Hotkey) | W (Diktat-Kern, schlank) | Web Speech API als Default (keine Konfiguration); optional Whisper-/Groq-API (MediaRecorder → Server → Transkription, Key serverseitig wie bei WhisperM8 in Keychain-Äquivalent); Ergebnis landet im Eingabefeld, Senden bleibt explizit |
| Q3 | **Öffnen-Buttons** am Feature-Header: Worktree in Finder / im Editor / Pfad kopieren | W (Projekt-Inspector) | Server-Endpoint `open` (Finder/Editor-Kommando), UI-Buttons |
| Q4 | **Bild/Screenshot in Konsole einfügen**: Paste speichert nach `<worktree>/.sdd-tmp/` und fügt den Pfad ein (Claude liest Bilder per Pfad) | E | Paste-Handler auf xterm-Container; `.sdd-tmp` in Worktree-`.git/info/exclude` |
| Q5 | **Quick-Switcher** (⌘K): Feature/Projekt suchen und springen | W (Ctrl-Tab-Idee) | Fuzzy-Suche über Projekte/Features/Views |
| Q6 | **Bestätigungs-Dialoge** für Destruktives (Projekt entfernen, Feature archivieren, Force-Cleanup) | E | Einheitliche Confirm-Komponente |

## 3. Zu übernehmen — Priorität 2 (Komfort & Skalierung)

| # | Funktion | Quelle | Notiz |
|---|---|---|---|
| W6 | Sidebar-Komfort: Pinning, Farben je Feature, Archiv-Ansicht mit Volltextsuche, Scope-Filter (Aktiv/Zuletzt/Alle) | W | UI-State getrennt vom Domain-State halten (W-Prinzip) |
| W7 | Tab-/Fenster-Management: Multi-Select + Bulk-Aktionen, Reorder, Tear-off (`window.open` + Server-State), Ctrl+Tab-Switcher, ⌘1–9, Reopen-LIFO | W | Im Web einfacher als in SwiftUI (Server hält State) |
| W8 | Transkript-Timeline (gerenderte Runden neben dem Terminal) + Browsing geschlossener Sessions | W | Baut auf W1-Parser auf |
| W9 | Auto-Naming + Summaries via Headless-Call | W | Nice-to-have bei vielen Features |
| W10 | Ressourcenmonitor (CPU/RAM je Session, `pidusage`) | W | Polling pausieren bei inaktivem Fenster |
| W11 | Externe Session-Discovery (`~/.claude/projects` watchen, fremde Sessions adoptieren) | W | Erst sinnvoll mit W8 |
| W12 | **CLI-Fernsteuerung `sdd`** (Jarvis-Port über REST statt Unix-Socket): status/new/send/interrupt/approve/queue | W: `agent-chats-cli.md` | Damit kann Claude das Tool selbst bedienen — Pfad zu Level 4 |
| W13 | Background-Agents (`claude --bg` spawnen + attachen) | W | Überleben sogar den Server |
| W14 | Kleinkram: „Stop all", Ungelesen-Marker, tote Sessions ausgrauen (Missing-Transcript) | W | |
| S5 | Markdown-Editor für Spec-Dateien + Checklisten mit Sub-Tabs | S | Read-only-Viewer zuerst, WYSIWYG später |
| S6 | DAG-Ansicht (ReactFlow): Phasen-DAG + Merge-Queue-Reihenfolge + Feature-Abhängigkeiten | S | |
| S8 | MCP-Management: zentral definieren → native CLI-Configs übersetzen (mit `.bak`) | S: `mcpTranslate.ts` | Pure-Translate-Funktionen 1:1 portierbar |
| S9 | Spec-Agents (after_specify-Hooks: Product Owner, Architektur …) | S | |
| E3 | Präventive Konfliktwarnung: offene Features mit überlappenden Dateien markieren (`git diff --name-only` je Branch, Schnittmenge) | E | Früher wissen = billiger lösen |
| E5 | Multi-Provider: Codex CLI via AgentRunnerPort + W1-Transkript-Fallback | E/W | Erst nach W1 |
| E6 | Routinen: wiederkehrende Headless-Runs (Dependency-Updates, Cleanup) | E | Level-3-„Loops und Routinen" |

## 4. Bewusst NICHT übernommen

| Funktion | Quelle | Grund |
|---|---|---|
| System-weites Hotkey-Diktat ins aktive Fenster, Screenshot-Kontext, CLI-Transkription | W | Nur der Diktat-Kern wird übernommen (Q2, in-App); der Rest ist OS-Integration eines anderen Produkts |
| Metal-GPU-Renderer, NSPanel/MenuBar/TCC/Keychain | W | macOS-nativ; xterm.js/Browser übernehmen das |
| PhpStorm-Hardcoding | W | Stattdessen konfigurierbarer Editor-Opener (W5) |
| Force-directed Execution-Graph (d3) | S | Gimmick; Executions-Liste (S4) reicht |
| Extension-Marketplace (GitHub-ZIP-Installer) | S | Wartungslast; eigene Hooks decken S9 ab |
| Gemini/Copilot-Adapter ab Start | S | Erst Claude solide, dann E5 (Codex) |
| `taskstoissues`-Phase | S | Bei Bedarf als optionale Phase nachrüstbar |
| `bypassPermissions` als Default | S | Sicherheitsentscheidung: `acceptEdits` + konfigurierbar |

## 5. Reihenfolge-Empfehlung (Abhängigkeiten)

```
WP1  W1  Transkript-Fallback        (Basis für W2, W8, E5 — und fixt ESC-Abbruch-Bug)
WP2  W2  Snapshots + Resume-Recovery
WP3  S3  Cost-Metering              (klein, reine Ergänzung an bestehenden Läufen)
WP4  S1  Review-Gate                (autoReviewAgents wird real)
WP5  S2  Review-Portal              (+E4 Konflikt-Transparenz; nutzt S3-Daten)
WP6  S4  Executions-View
WP7  S7  Einstellungen-UI           (+E2 Verify-Kommandos)
WP8  W3  Grid-View + Drosselung
WP9  W4  Notification-Feinschliff
WP10 W5  Klickbare Links
WP11 S11+S12 Onboarding-Init + Projekt-Terminal
WP12 S13 Change-Guard
WP13 E1  PR-Modus
WP14 Q1  Ordnerauswahl (nativer Dialog + FS-Browser)
WP15 Q2  Voice-Eingabe
WP16 Q3–Q6 QoL-Sammelpaket (Öffnen-Buttons, Bild-Paste, ⌘K, Confirms)
—— P2 danach: W6/W7/W12/S5/S6/S8/E3/E5/E6 ——
```
