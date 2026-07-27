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
   Konsole oder direkt in der Konsole. Über das **ℹ-Icon im Lane-Header** lässt sich die
   spec-kit-Definition jedes Schritts einsehen und direkt bearbeiten („Was macht dieser
   Schritt?") — inkl. Konfliktschutz und Sperre bei laufendem Agenten. Auf der
   **Feature-Kachel** zeigen kompakte **Ergebnis-Icons** (Specify/Plan/Tasks/Checklist)
   die pro Feature erzeugten Artefakte: Klick öffnet ein Modal, das `spec.md`, `plan.md`
   (+ Begleitartefakte), `tasks.md` bzw. Checklisten **lesbar (WYSIWYG, kein Markdown-
   Quelltext)** darstellt und direkt bearbeiten lässt — strukturerhaltend zurückgeschrieben,
   konflikt- und sperrgeschützt; optional als Split-Screen neben der Feature-Konsole.
4. **Integration**: implement fertig → Verifikations-Pipeline (Test/Build/Lint, pro
   Projekt konfigurierbar) → Merge-Queue: rebase auf main → **Konflikte löst ein
   Headless-Claude mit Spec-Kontext beider Seiten** → erneute Verifikation → Merge →
   Worktree-Cleanup. Scheitert etwas → Eskalation in die Exception-Inbox, nie Blind-Merge.
5. **„Braucht dich"-Inbox**: Agent-Fragen, Permission-Requests, rote Tests, eskalierte
   Konflikte — Monitoring by exception. Klick springt in die richtige Konsole.

## Projektspezifisches Wissen

Pro Projekt verwaltbares, verschachteltes Wissen (**Bundles → Einträge**), das die
Feature-Sessions **selektiv** konsumieren — nicht jeder Kontext wird sofort eingelesen.
Aufruf über das 📚-Icon je Projekt (Sidebar) bzw. je Feature (Konsolen-Header).

- **Verwalten**: Bundles/Einträge anlegen, verschachteln, mit **Anwendbarkeit**
  (Freitext + Tags) versehen; bestehende Repo-Dateien importieren/referenzieren.
- **Index**: kompakte, immer aktuelle Projektion (Titel + Anwendbarkeit, ohne Inhalte) —
  als abgeleitete Sicht, daher nie veraltet.
- **Selektiv bei der Feature-Erstellung**: Vor jeder Phase wird nur das relevante Wissen
  nach `<worktree>/.sdd/knowledge/` materialisiert (git-excluded) und per kompakter
  Präambel referenziert; Relevanz automatisch aus Anwendbarkeit vorgeschlagen, pro
  Feature manuell übersteuerbar.

Speicherung projekt-gescopt in SQLite (`knowledge_*`-Tabellen), Transport on-demand via
REST + `knowledge_updated`-WS-Event.

## Projekt-Chat (vollwertige Claude-Session)

Die **Sprechblase unten rechts** (sichtbar bei geöffnetem Projekt) öffnet eine **vollwertige,
interaktive Claude-Code-Session** als echte Konsole (xterm) — man **tippt direkt in die
Konsole**, kein separates Eingabefeld. Die Session läuft in einer **isolierten Arbeitskopie**
(git-Worktree auf Branch `chat/<id>`, eine pro Projekt), sodass die Haupt-Arbeitskopie unberührt
bleibt; sie kann lesen, Dateien ändern und Kommandos ausführen. Freigaben laufen über denselben
Permission-/„Braucht dich"-Fluss und erben den **Automation-Dial** wie Feature-Sessions. Das
Panel ist **frei größenverstellbar** (Griff oben links). Schließen beendet die Session nicht —
sie läuft am Server weiter (`--resume` + Snapshot-Replay), Turns erscheinen als `chat_work`-Läufe
im Verbrauchs-Audit.

**Feature-Anlage aus dem Gespräch:** Kristallisiert sich in der Unterhaltung ein (oder mehrere)
Feature(s) heraus, weist die Session darauf hin und gibt einen `<sdd:features>`-Marker aus. Das
Toolkit zeigt daraufhin eine **Bestätigungskarte** mit den vorgeschlagenen Features (auswählbar) —
per Klick werden die gewählten über den normalen Weg angelegt (eigener Worktree/Branch, optional
direkt `/speckit-specify`) und erscheinen im Board.

Beschreibt eine Nachricht eine **feature-würdige Anforderung**, weist der Assistent
darauf hin und schlägt per Karte ein Feature vor. „Feature anlegen …" öffnet den
bekannten Anlege-Dialog, vorbefüllt mit Namensvorschlag und der im Chat erarbeiteten
Beschreibung — die Anlage läuft über denselben Weg wie manuell angelegte Features
(Worktree, Branch, optional direkt `/speckit.specify`). Ablehnen oder Dialog-Abbruch
haben keine Seiteneffekte.

## Jira-Import

Features lassen sich direkt aus Jira-Cloud-Tickets erstellen — die Übernahme ist ein
**Schnappschuss** (keine Synchronisation) und mündet in den normalen Feature-Workflow
(Worktree, Branch, `/speckit-specify` mit dem Ticketinhalt als Ausgangsmaterial).

**Voraussetzungen:** Jira-Cloud-Konto mit Zugriff auf mindestens ein Projekt. Die Anbindung
läuft über den **offiziellen Atlassian MCP** (Rovo MCP, `mcp.atlassian.com`) mit
OAuth-Freigabe im Browser — das Toolkit speichert weder Jira-Passwörter noch eigene
API-Token.

**Verbindung einrichten:** Sidebar → **Benutzereinstellungen → Jira-Verbindung** →
„Mit Jira verbinden". Die Freigabe wird im Browser erteilt; danach zeigt der Bereich
Konto + Jira-Instanz. Die Autorisierung gilt **auf Nutzerebene** (alle Toolkit-Projekte),
überlebt Neustarts und liegt unter `~/.sdd-toolkit/atlassian-mcp.json` — „Verbindung
trennen" entfernt genau diese Datei. Läuft die Autorisierung ab, bieten die Einstellungen
direkt „Erneut autorisieren" an.

**Tickets übernehmen:** In der Sidebar am Projekt **„Aus Jira importieren" (⬇J)** →
Site, Projekt und Sprint wählen (aktive + zukünftige Sprints aller Boards zusammengeführt;
Projekte ohne Sprints zeigen die Backlog-/Projektsicht). Ein oder mehrere Tickets per
Checkbox auswählen → „Übernehmen (n)". Je Ticket entsteht **genau ein Feature** mit
Ticket-Titel, -Beschreibung und dauerhaft sichtbarem Jira-Key (klickbarer Link auf Karte
und Konsole). Bereits übernommene Tickets sind markiert; ein Re-Import verlangt eine
ausdrückliche Bestätigung und erzeugt ein weiteres, unabhängiges Feature. Fehler einzelner
Tickets stoppen die übrigen nicht — das Ergebnis wird pro Ticket ausgewiesen.

**Ticketkontext:** Die Übernahme liest den vollständigen Kontext ein: alle ausgefüllten
Standard-/Custom-Felder, sämtliche Kommentare (Autor + Zeitpunkt) und alle zugänglichen
Anhänge. Im Feature-Worktree liegt das Material unter `specs/<slug>/jira/` (`ticket.md`
als Markdown-Dossier, `attachments/` mit den Dateien); nicht abrufbare Anhänge werden im
Dossier mit Name + Quell-URL vermerkt.

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

## Verbrauchsmessung

Tokens und Kosten meldet die Claude-CLI selbst — das Toolkit rechnet sie nicht mehr aus einer
Protokolldatei zurück.

**Wie es läuft.** Jeder Claude-Prozess, den das Toolkit startet, bekommt die
OpenTelemetry-Variablen und eine eigene Marke (`sdd.session.id` bzw. `sdd.run.id`) mit. Die CLI
schickt daraufhin alle 5 s ihre Ereignisse an `POST /v1/logs` auf demselben Server. Ausgewertet
wird ausschliesslich `claude_code.api_request`; es trägt Input-, Output-, Cache-Read- und
Cache-Creation-Tokens, den Betrag, das Modell und die Herkunft (Hauptagent, Subagent,
Hilfsanfrage). Zugeordnet wird über das Zeitfenster des Laufs — damit gehört zu einem Lauf
genau das, was zwischen seinem Start und seinem Ende gemeldet wurde.

Nichts davon muss konfiguriert werden, und die eigene OTel-Konfiguration des Nutzers bleibt
unangetastet: Die Variablen landen nur in den Kindprozessen des Toolkits.

**Woran man erkennt, ob es greift.** In den Projekt-Einstellungen unter „Verbrauchsmessung"
stehen Zustand, Zählerstand und Empfangsadresse. In der Läufe-Ansicht trägt jeder Lauf seine
Herkunft: **von der CLI gemeldet** > gemessen > geparst > geschätzt. Kommt keine Telemetrie an
(ältere CLI, Empfang gestört), misst das Toolkit wie bisher aus dem Transkript und
kennzeichnet den Lauf entsprechend — kein Lauf bleibt ohne Zahl.

**Was erfasst wird.** Ausschliesslich Zähl- und Zuordnungsangaben. Prompt-Texte, Antworttexte
und Werkzeug-Inhalte sind abgeschaltet und werden auch nicht ausgewertet; personenbezogene
Attribute der CLI (E-Mail, Konto-, Organisations-ID) werden nicht gelesen. Alles bleibt auf
dem Rechner — der Empfang ist an `127.0.0.1` gebunden, es geht nichts nach aussen.

**Beträge.** Angezeigt wird nur, was die CLI gemeldet hat, gekennzeichnet als gemeldet. Es gibt
keine Preistabelle im Toolkit; Läufe ohne gemeldeten Betrag zeigen keinen, und Summen weisen
aus, wie viele Läufe darin keinen Betrag beitragen.

## Roadmap

- **P1 (umgesetzt, 2026-07-22)**: Transkript-Fallback (ESC-Abbruch-Erkennung), Snapshots +
  Resume-Recovery, Cost-/Token-Metering, Review-Gate (Code/Security mit VERDICT),
  Human-Review-Portal inkl. Konfliktauflösungs-Transparenz, Executions-View, Projekt-
  Einstellungen-UI, Grid-View (9 Panes, Feed-Drosselung), Notification-Feinschliff,
  klickbare Links, Projekt-Terminal + spec-kit-Init, Change-Guard, PR-Modus,
  native Ordnerauswahl, Voice-Eingabe (Web Speech / Whisper / Groq), ⌘K-Switcher,
  Bild-Paste, Confirm-Dialoge
- **Token-Reduktion (2026-07)**: autoritative Token-Messung pro Phase aus dem Claude-
  Transkript (statt Terminal-Schätzung; inkl. `cache_read` = akkumulierter Kontext),
  Token-Aufschlüsselung je Phase/Art mit Quelle-Badge (`GET /api/features/:id/cost-breakdown`,
  Executions-View), plus ein **Optimierungs-Dial** (global → Projekt → Feature): Kontext-Reset
  vor Downstream-Phasen (`compact`/`fresh`) und deterministische Verdichtung signalarmer
  Inhalte. Default `full`/`off` = unverändertes Verhalten (reversibel).
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
