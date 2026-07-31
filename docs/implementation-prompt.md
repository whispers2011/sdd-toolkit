# Implementierungs-Prompt: SDD Toolkit — Vollausbau P1

> Diesen Prompt komplett an Claude Code übergeben (Arbeitsverzeichnis:
> `~/iwf-projects/sdd-toolkit`). Er setzt die Arbeitspakete WP1–WP16 aus
> `docs/funktionsuebernahme.md` um. Für P2 danach den Abschnitt „P2-Folgeprompt" nutzen.

---

Du erweiterst das SDD Toolkit (dieses Repo) um die P1-Funktionen aus
`docs/funktionsuebernahme.md`. Das MVP läuft bereits: Fastify-Server (`packages/server`),
React/Vite-Web-UI (`packages/web`), pure Domain-Kerne (`packages/shared`).

## Zuerst lesen (Pflicht, in dieser Reihenfolge)

1. `README.md` — Architektur & Konzepte
2. `docs/funktionsuebernahme.md` — WAS gebaut wird (WP1–WP13) und WARUM
3. `docs/inventar-whisperm8.md` + `docs/inventar-speckit-assistant.md` — die Vorbilder
4. Bei jedem WP mit W-/S-Quelle: die dort genannten Dateien unter `reference/WhisperM8/`
   bzw. `reference/speckit-assistant/` als Vorlage lesen. Die Swift-Tests in
   `reference/WhisperM8/Tests/WhisperM8Tests/` sind die Verhaltens-Spezifikation für Ports.

## Grundregeln

- **Architektur beibehalten**: pure, unit-getestete Logik nach `packages/shared` bzw. als
  pure Funktionen im Server; I/O in Adapter (`db/repos.ts`, `git/`, `pty/`); UI-Updates
  ausschließlich über den Event-Bus (`server/src/events.ts`) → WS → Store-Reducer.
- **Persistenz**: Orchestrierungs-State in SQLite (neue Migration = neuer Eintrag im
  `MIGRATIONS`-Array, niemals bestehende Migrationen editieren). UI-Zustand (Pins, Layout)
  gehört NICHT in die Domain-DB. `~/.claude/` bleibt strikt read-only.
- **Tests**: Jede pure Logik bekommt Vitest-Tests. Nach JEDEM Arbeitspaket müssen
  `pnpm typecheck` und `pnpm test` grün sein — erst dann weiter.
- **Commits**: ein Commit pro abgeschlossenem Arbeitspaket, Message
  `feat(wpN): <kurzbeschreibung>`.
- **UI-Texte deutsch**, Code/Identifier englisch, Kommentare deutsch und sparsam
  (nur Nicht-Offensichtliches). Bestehenden Stil übernehmen (Tailwind, zinc-Palette).
- Keine neuen Dependencies ohne Notwendigkeit; wenn nötig: etabliert & schlank
  (erlaubt u. a.: `pidusage`, `shiki` oder `highlight.js`, `@xterm/addon-web-links`).
- Der `claude`-CLI-Aufruf darf nie mit hart kodiertem `bypassPermissions` laufen;
  Permission-Mode kommt aus der Konfiguration (Default `acceptEdits`).

## Arbeitspakete (Reihenfolge einhalten — Abhängigkeiten!)

### WP1 — Transkript-Fallback-Statuserkennung (W1)
Port von `AgentSessionTranscript.swift` (+ zugehörige Tests) nach TypeScript.
- Neu `server/src/pty/transcriptWatcher.ts`:
  - JSONL-Locator: `~/.claude/projects/<encoded-cwd>/<claudeSessionId>.jsonl`
    (cwd-Encoding: `/` → `-`; gegen echte Claude-Installation verifizieren).
  - chokidar-Watch + stat-first (mtime+size unverändert → kein Read), inkrementelles
    Zeilen-Lesen (Muster: `HookEventWatcher`).
  - Pure Decider `shared/src/transcript.ts`: letzte statusrelevante Zeile →
    `{type:'transcript', event: 'working'|'turn_finished'|'turn_aborted'}`.
    Regeln: assistant-Message mit `stop_reason` ∈ {`tool_use`,`pause_turn`} = working;
    `end_turn`/`stop_sequence`/`max_tokens`/`refusal` = turn_finished;
    `[Request interrupted by user]` = turn_aborted. `meta`-Zeilen überspringen.
  - Stall-Timeout: >120 s working ohne File-Write → Signal `stall_timeout`.
- In `sessionManager.ts` einhängen: sobald `claudeSessionId` bekannt ist, Watcher starten;
  Signale in `dispatch()` geben (die Prioritätsregel „Hooks schlagen Transcript, außer
  turn_aborted" implementiert `sessionMachine.ts` bereits).
- Tests: Decider-Fixtures (tool_use, end_turn, abort, meta-skip); Akzeptanz: ESC-Abbruch
  in einer Feature-Session lässt den Status auf `idle` zurückfallen (heute: hängt auf working).

### WP2 — Terminal-Snapshots + Resume-Recovery (W2)
- `server/src/pty/snapshotStore.ts`: bei `terminate()` und Server-Shutdown den
  Scrollback (`session.scrollback`) nach `<dataDir>/snapshots/<sessionId>.txt` schreiben;
  beim `subscribe()` einer neuen Session desselben Features zuerst den letzten Snapshot
  (gedimmt, mit Trennzeile `— frühere Session —`) replayen.
- Resume-Recovery in `orchestrator.ensureSession()`: vor `--resume <id>` prüfen, ob die
  Transkript-JSONL existiert (WP1-Locator). Fehlt sie → ohne resume frisch starten und
  `claude_session_id` der alten Session-Zeile nullen.
- Test: Recovery-Logik pur (Locator gemockt).

### WP3 — Cost-/Token-Metering (S3)
Port von `reference/speckit-assistant/src/domain/services/CostMeter.ts` + `pricing.ts`.
- `shared/src/costMeter.ts` (pur): parst Kosten/Tokens aus CLI-Output (ANSI-Strip),
  Fallback Token-Schätzung × Preistabelle, Ergebnis `{costUsd, tokens, source}`.
- Anwenden auf: Phasen-Läufe (Scrollback-Delta des Turns), Headless-Läufe (verify/
  review/conflict — stdout wird bereits geloggt). `executions.finish()` um `cost_usd`
  ergänzen (Spalte existiert), zusätzlich `tokens`-Spalte per Migration.
- Test: Parser-Fixtures aus echten Claude-CLI-Ausgaben (im reference-Repo dokumentiert).

### WP4 — Review-Gate mit Personas (S1)
Vorbild: `WorkflowService.runImplementationGate` + `personas.ts` im speckit-assistant.
- Migration: Tabelle `personas` (id, project_id, name, prompt, order) mit Seed-Defaults
  „Code-Review" und „Security-Review" (Prompts: adversarial reviewen, Ergebnis als
  `specs/<feature>/reviews/<persona-id>.md` mit abschließender Zeile `VERDICT: PASS`
  oder `VERDICT: FAIL` schreiben).
- `server/src/services/reviewGateService.ts`: Personas sequentiell als Headless-Läufe
  (`buildHeadlessArgv`) im Worktree; Verdict-Regex `VERDICT:\s*(PASS|FAIL)` aus der
  Review-Datei, Exit-Code-Fallback; erster FAIL stoppt → `integration: 'gate_failed'`
  + Attention `gate_failed`; alle PASS → weiter.
- Einbau in `mergeQueueService.beginIntegration()`: nach erfolgreicher Verifikation,
  wenn `automation.autoReviewAgents` — Reihenfolge: verify → gate → merge/review.
  Neue IntegrationStage `review_gate` wird bereits im Typ geführt.
- Executions-Einträge `kind: 'review'` pro Persona. Tests: Verdict-Parsing, Gate-Abbruch.

### WP5 — Human-Review-Portal (S2 + E4)
Vorbild-UI: `HumanReviewModal.tsx` (3 Tabs), aber mit ECHTEM Merge.
- Server: `GET /api/features/:id/diff` erweitern → strukturiert
  `{files: [{path, additions, deletions}], commits: [{sha, subject, date}]}` +
  `GET /api/features/:id/diff/file?path=` (Einzeldiff). Konfliktauflösungs-Transparenz:
  vor dem Resolver-Lauf `git diff > <logDir>/<execId>.pre.diff`, danach Auflösungs-Diff
  bereitstellen (`GET /api/executions/:id/resolution-diff`).
- Web: `ReviewPortal.tsx` als Modal/Route vom Kanban („Review"-Button bei
  `awaiting_human_review`): Dateiliste + Diff-Viewer (Syntax-Highlighting; leichtgewichtig,
  z. B. `highlight.js` auf Diff-Hunks), Commit-Liste, Tab „Konfliktauflösung" (falls
  vorhanden), Kosten-Summe des Features (WP3-Daten). Buttons: „Approve & Merge"
  (`approve-merge`) / „Zurückweisen" (Kommentar → als Prompt in die Feature-Konsole).

### WP6 — Executions-View (S4)
- Web: neuer Header-Tab „Läufe": Tabelle aller Executions (Filter Projekt/Feature/Art),
  Spalten Status/Phase/Dauer/Kosten/Exit-Code; Klick → Log-Viewer
  (`GET /api/executions/:id/log`, neuer Endpoint, streamt die Log-Datei; bei fehlender
  Datei Hinweis). Läufe mit `status: running` live markieren.

### WP7 — Projekt-Einstellungen-UI (S7 + E2)
- Web: Zahnrad am Projekt in der Sidebar → Einstellungs-Panel:
  Name, Farbe, Default-Branch, aktive Phasen (Checkboxen inkl. checklist/analyze),
  Verify-Kommandos (Liste name+command, sortierbar), Automation-Overrides
  (leer = global erben), Merge-Modus ff/squash (neues Projekt-Feld per Migration,
  `mergeQueueService` respektiert es), Editor-Kommando für WP10 (z. B. `code -g {file}:{line}`).
  Alles über bestehendes `PATCH /api/projects/:id`.
- Feature-Kontextmenü (Karte): Automation-Override, Archivieren.

### WP8 — Grid-View mit Feed-Drosselung (W3)
Vorbild: `AgentGridWorkspace.swift`, `TerminalFeedBatcher.swift`.
- Web: Header-Tab „Grid": 1–9 Panes (Auto-Layout 1/2/4/6/9), Pane = Feature-Konsole
  (Komponente wiederverwenden, kompakter Header), Feature-Picker pro Pane,
  Pane-Maximize; Layout in `localStorage` (UI-State, nicht DB).
- Drosselung server-seitig in `sessionManager`: pro Subscriber `focused`-Flag
  (WS-Message `{type:'focus', focused:boolean}`); unfokussiert → Output puffern und
  alle ~80 ms gebündelt senden (Timer phasenversetzt je Session). xterm-Instanzen
  unfokussierter Panes zusätzlich mit reduziertem `fontSize` rendern ist NICHT nötig —
  nur Batching.

### WP9 — Notification-Feinschliff (W4)
Vorbild: `AgentSessionNotifier.swift`.
- `server`: Throttle je (sessionId, Art) 2 s — Wechsel der Art kommt durch; Payload um
  `kind: 'turn_completed'|'input_requested'|…` erweitern.
- Web: Klick auf Notification → Fenster fokussieren + `set_view console`; Completion-
  Sound via WebAudio (Einstellung an/aus, in `localStorage`); Rückfragen bewusst lautlos;
  Badge im Dokumenttitel: `(N) SDD Toolkit` bei offenen Attention-Items.

### WP10 — Klickbare Links (W5)
Vorbild: `TerminalLinkResolver.swift` (pure Logik portieren).
- Web: `@xterm/addon-web-links` für URLs; eigener Link-Provider für Pfade
  (`/abs/pfad`, `rel/pfad.ts:42`, `datei.ts:12:5`) — Auflösung relativ zum Worktree.
- Server: `POST /api/open-in-editor {projectId, file, line}` — führt das
  Editor-Kommando des Projekts aus (WP7-Feld, `{file}`/`{line}`-Platzhalter,
  Default `code -g {file}:{line}`). Pure Resolver-Logik testen.

### WP11 — Onboarding-Init + Projekt-Terminal (S11 + S12)
- Projekt-Terminal: Sidebar-Eintrag „Terminal" pro Projekt → `kind:'shell'`-Session
  (Login-Shell, cwd = Projektpfad) über die bestehende PTY-Infrastruktur; gleicher
  Konsolen-View ohne Phasen-Leiste.
- Onboarding: erkennt `addProject` kein spec-kit (`specKitDetected: false`), zeigt die
  UI einen Hinweis-Banner am Projekt mit Button „spec-kit initialisieren" → öffnet das
  Projekt-Terminal und sendet (nicht submitted!) den Befehl
  `uvx --from git+https://github.com/github/spec-kit.git specify init --here --ai claude` —
  der User bestätigt mit Enter. Nach Erkennung (Change-Guard WP12 oder Re-Scan-Button)
  verschwindet der Banner.

### WP12 — Change-Guard (S13)
- `server/src/services/changeGuard.ts`: chokidar auf `<repo>/specs/**` und
  `<worktree>/specs/**` aller aktiven Projekte/Features (debounced 500 ms) →
  `orchestrator.reconcileFeature()` + Task-Fortschritt neu parsen + `feature_updated`.
  Watcher-Lifecycle an Projekt-/Feature-Lifecycle koppeln (Memory-Leaks vermeiden).

### WP13 — PR-Modus (E1)
- Projekt-Feld `integrationMode: 'local' | 'pr'` (Migration, Default `local`, WP7-UI).
- `mergeQueueService`: bei `pr` statt Schritt 3 (lokaler Merge):
  `git push -u origin <branch>` + `gh pr create --fill --base <defaultBranch>`
  (Fehler → Attention). Nach Konfliktauflösung: force-push mit `--force-with-lease`.
  Stage `merged` heißt in dem Modus „PR erstellt" (UI-Label anpassen);
  Worktree bleibt bis PR-Merge bestehen (Cleanup-Button am Feature).

### WP14 — Ordnerauswahl statt Pfadeingabe (Q1)
Browser liefern keine absoluten Pfade — der lokale Server übernimmt das.
- Server: `POST /api/fs/pick-folder` — auf macOS nativen Dialog öffnen:
  `osascript -e 'POSIX path of (choose folder with prompt "Projekt wählen")'`
  (User-Abbruch = Exit ≠ 0 → `{cancelled: true}`, kein Fehler). Zusätzlich
  `GET /api/fs/dirs?path=<abs>` — listet Unterverzeichnisse (versteckte gefiltert,
  nur Verzeichnisse, `isGitRepo`-Flag je Eintrag) als Fallback/Browser.
- Web: „+ Projekt"-Dialog ersetzt das Textfeld durch: Button „Ordner wählen …"
  (nativer Dialog) + darunter Vorschlagsliste (Geschwister-Ordner bereits registrierter
  Projekte, die Git-Repos und noch nicht registriert sind) + aufklappbarer
  Verzeichnis-Browser. Gewählter Pfad wird vor dem Anlegen angezeigt.

### WP15 — Voice-Eingabe (Q2)
Schlanker Port des WhisperM8-Diktat-Kerns für die Web-App.
- Web: Mikro-Button an jedem Prompt-Eingabefeld (Review-Portal-Kommentar,
  Feature-Beschreibung) und in der Konsolen-Kopfzeile (Ergebnis → `sendPrompt`-Feld,
  Senden bleibt explizit). Hotkey ⌘⇧M startet/stoppt Aufnahme.
  - Provider 1 (Default, zero-config): Web Speech API (`SpeechRecognition`),
    Sprache `de-CH`/`de-DE` konfigurierbar, Live-Zwischenergebnisse im Feld.
  - Provider 2 (optional): MediaRecorder → `POST /api/transcribe` (Audio-Blob) →
    Server ruft OpenAI Whisper oder Groq (`whisper-large-v3`) — Vorbild WhisperM8.
- Server: `POST /api/transcribe` (multipart), Provider+API-Key in neuer
  `settings`-Zeile (Key wird nie ans Frontend gegeben; maskiert anzeigen).
  Ohne Key: 409 mit Hinweis → UI fällt auf Web Speech zurück.

### WP16 — QoL-Sammelpaket (Q3–Q6)
- Q3: Feature-Header-Buttons „Im Finder öffnen" / „Im Editor öffnen" / „Pfad kopieren"
  (nutzt WP10-Endpoint bzw. `open <pfad>`).
- Q4: Bild-Paste in die Konsole → `POST /api/features/:id/paste-image` speichert nach
  `<worktree>/.sdd-tmp/<ts>.png` (Ordner in `.git/info/exclude` eintragen) und fügt
  den Pfad per Bracketed Paste ins PTY ein.
- Q5: Quick-Switcher ⌘K: Fuzzy-Suche über Projekte/Features/Views, Enter springt.
- Q6: Einheitlicher Bestätigungs-Dialog für Projekt entfernen, Feature archivieren,
  Worktree-Force-Cleanup (zeigt an, WAS verloren geht — z. B. uncommittete Dateien).

## Abschluss

- `README.md` (Roadmap-Abschnitt) und `docs/funktionsuebernahme.md` (Status-Spalte)
  aktualisieren.
- Vollständiger Regressionslauf: `pnpm typecheck && pnpm test && pnpm build`.
- Kurzer Abschlussbericht: pro WP eine Zeile (umgesetzt/abweichend + warum).

---

## P2-Folgeprompt (nach Abnahme von P1 separat starten)

> Setze die P2-Funktionen aus `docs/funktionsuebernahme.md` §3 um, in dieser Reihenfolge:
> W6 (Sidebar-Komfort), W7 (Tab-/Fenster-Management), S5 (Spec-Viewer/-Editor),
> S6 (DAG-Ansicht), E3 (präventive Konfliktwarnung), W12 (CLI `sdd` — REST-Client auf
> die bestehende API, Kommandos: status/new/send/interrupt/approve/queue/attention),
> S8 (MCP-Management, Port von `mcpTranslate.ts`), E5 (Codex-Provider über
> AgentRunnerPort + Transkript-Fallback), W9/W10/W14 (Naming, Ressourcen, Kleinkram),
> E6 (Routinen). Gleiche Grundregeln wie oben; ein Commit pro Paket; Tests zuerst
> für alle pure-Logik-Ports.
