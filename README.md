# SDD Toolkit

> Local orchestrator for spec-driven development across multiple repositories. Runs the
> [spec-kit](https://github.com/github/spec-kit) workflow as real Claude Code sessions, one
> git worktree per feature, merge queue with agent-based conflict resolution.
> Docs and code comments are in German.
>
> ⚠️ **Localhost only — no authentication.** See [SECURITY.md](SECURITY.md).

Orchestriert den spec-kit-Workflow (specify → clarify → plan → tasks → implement) über
mehrere Projekte. Jedes Feature: eigener Worktree, eigene dauerhafte Claude-Session.
Fertige Arbeit läuft durch eine Merge-Queue, die Konflikte auflöst und im Zweifel
eskaliert statt zu mergen.

![Board](docs/images/board.png)

*Alle Bilder zeigen ein Demo-Projekt mit erfundenen Daten.*

## Quickstart

```bash
pnpm install
pnpm dev                    # Server 4820, Web-UI 4830
open http://localhost:4830
```

Braucht Node ≥ 22, git ≥ 2.40, `claude` im PATH. Ziel-Repos brauchen spec-kit:

```bash
uvx --from git+https://github.com/github/spec-kit.git specify init --here --integration claude
```

Danach committen, damit Worktrees die Skills erben.

## Ansichten

**Board** — eine Bahn pro Schritt, plus Integration. Drag-and-drop zum Weiterziehen.
Karten zeigen Task-Fortschritt, Artefakte und Integrationsfehler. Das ℹ-Icon öffnet die
spec-kit-Definition des Schritts, direkt bearbeitbar.

**Grid** — bis zu 9 Konsolen nebeneinander, automatisch die aktiven. Fokussierte Pane
streamt live, Rest gedrosselt. Eingabe direkt in die Konsole.

![Grid](docs/images/grid.png)

**Workflow** — die geltende Pipeline: Kommandos, Wissens-Injektion, Freigaben,
Agenten-Gates vor und nach jeder Phase.

![Workflow](docs/images/workflow.png)

**Läufe** — Tokens und Kosten pro Schritt, aufgeschlüsselt nach Spezifikation, Coding und
Overhead. Gemessen aus dem Claude-Transkript; Ungemessenes wird als solches ausgewiesen.

![Läufe](docs/images/laeufe.png)

**Review** — Diff gegen den Ziel-Branch, zeilengenaue Kommentare, Agent-Audits,
Ziel-Branch-Wahl. Reviewer-Änderungen erzwingen erneute Verifikation.

![Review](docs/images/review.png)

**Braucht dich** — Rückfragen, rote Verifikationen, gescheiterte Gates, eskalierte
Konflikte, fällige Reviews. Meldungen verschwinden automatisch, sobald ihr Zustand nicht
mehr besteht — geprüft bei jedem Lesen.

![Braucht dich](docs/images/braucht-dich.png)

## Funktionen

**Worktree-Isolation** — Branch `feature/<name>` plus eigener Worktree unter
`~/.sdd-toolkit/worktrees/`. Beliebig viele Agenten parallel, Haupt-Checkout unberührt.
Die Verwaltung adoptiert keine fremden Branches, verwirft keine uncommittete Arbeit und
heilt Registry-Leichen — getestet gegen echte Repos, nicht gegen Mocks.

**Merge-Queue** — Verifikation → Review-Gates → menschliches Review → Rebase → bei
Konflikt ein Headless-Claude mit der Spec beider Seiten → erneute Verifikation → Merge →
Aufräumen. Scheitert etwas, geht es in die Inbox. Kein Blind-Merge. Wahlweise lokaler
Merge oder GitHub-PR.

**Projektwissen** — verschachtelte Bundles mit Anwendbarkeit (Text + Tags). Vor jeder
Phase wird nur das Relevante nach `<worktree>/.sdd/knowledge/` materialisiert und per
Präambel referenziert. Vorschlag automatisch, pro Feature übersteuerbar.

![Wissen](docs/images/wissen.png)

**Projekt-Chat** — vollwertige Claude-Session in isolierter Arbeitskopie (Branch
`chat/<id>`). Schlägt Features vor; per Klick entstehen daraus richtige Features mit
Branch und Worktree. Läuft nach dem Schliessen am Server weiter.

**Jira-Import** — via Atlassian MCP mit OAuth, keine eigenen Token. Auswahl nach Site,
Projekt und Sprint; je Ticket ein Feature mit klickbarem Key. Vollständiger Ticketkontext
(Felder, Kommentare, Anhänge) landet unter `specs/<slug>/jira/`. Schnappschuss, keine
Synchronisation.

**Weiteres** — Brownfield-Import vorhandener `specs/`-Ordner, Artefakt-Ansicht (spec, plan,
tasks, Checklisten lesbar und bearbeitbar), Projekt-Terminal, Change-Guard, ⌘K-Switcher,
klickbare Dateipfade, Bild-Paste, Spracheingabe, Dark Mode.

## Automation-Dial

Global einstellbar, pro Projekt und Feature überschreibbar.

| | Level 2 | Level 3 |
|---|---|---|
| Phasen | manuell gestartet | laufen durch |
| Verifikation | manuell | automatisch nach `implement` |
| Merge | manuell freigegeben | Queue arbeitet selbstständig |

Level 3 startet Agenten mit `bypassPermissions` — bewusste Entscheidung pro Projekt.

## Architektur

```
packages/
├── shared/   Typen + pure State-Machines (Phasen, Session-Status)
├── server/   Fastify + WS, node-pty, better-sqlite3 (WAL), git-Engine
└── web/      React + Vite + Tailwind, xterm.js, Kanban, Inbox
```

- **Hook-Bridge statt Output-Parsing**: Claude läuft mit `--settings`; Hooks schreiben
  Events in ein JSONL, der Server beobachtet es. Kein Raten anhand von Terminalausgabe.
- **Pure State-Machines** in `shared` — ohne Mocks testbar.
- **PTYs leben am Server**: Tab zu ≠ Session weg, Reconnect mit Scrollback-Replay,
  nach Neustart `claude --resume`.
- **SQLite (WAL)** nur für Orchestrierung. Spec-Wahrheit sind Dateien in `specs/`.
  `~/.claude/` ist read-only.

## Konfiguration

| Variable | Default | Zweck |
|---|---|---|
| `SDD_PORT` | `4820` | API/WS |
| `SDD_WEB_PORT` | `4830` | Web-UI (dev) |
| `SDD_HOST` | `127.0.0.1` | Bind-Adresse |
| `SDD_DATA_DIR` | `~/.sdd-toolkit` | DB, Logs, Worktrees |
| `SDD_ALLOWED_ORIGINS` | — | zusätzliche Origins, kommagetrennt |

> ⚠️ `SDD_HOST` nicht setzen. Die API ist nicht authentifiziert und kann Shells starten,
> Kommandos ausführen und Dateien schreiben. Ein Reverse-Proxy hilft nicht; für
> Fernzugriff einen SSH-Tunnel nutzen.

## Entwicklung

```bash
pnpm lint         # ESLint, keine Warnungen erlaubt
pnpm typecheck
pnpm test         # 471 Tests
pnpm build
```

Alles, was git anfasst, wird gegen echte Repos in `mkdtemp` getestet. Migrationen werden
zusätzlich auf dem Aufstiegspfad geprüft: bestehende DB mit Daten, von jedem Zwischenstand
auf aktuell, mit Nachweis des Datenerhalts.

Beispiel-Artefakte unter `specs/braucht-dich-meldungen-optimieren/` — das Werkzeug
entwickelt sich selbst damit. Agent-Prompts unter `docs/agents/`.

## Sicherheit

Lokales Werkzeug ohne Authentifizierung. Es kann Shells starten, Kommandos ausführen und
Dateien schreiben; im Auto-Modus mit `bypassPermissions`.

HTTP-API und WebSockets akzeptieren nur erlaubte Origins, der `Host`-Header muss lokal
sein (DNS-Rebinding). Das ersetzt keine Authentifizierung — es verhindert nur, dass eine
fremde Browser-Seite die lokale API fernsteuert.

Nur auf `127.0.0.1` betreiben. Bedrohungsmodell und Meldeweg: [SECURITY.md](SECURITY.md).

## Lizenz

[MIT](LICENSE) © 2026 whispers2011 · enthält Dateien aus
[github/spec-kit](https://github.com/github/spec-kit) (MIT), siehe
[THIRD-PARTY.md](THIRD-PARTY.md).
