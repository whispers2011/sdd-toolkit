# SDD Toolkit

> **A local orchestrator for spec-driven development across multiple repositories.** It runs
> the [spec-kit](https://github.com/github/spec-kit) workflow (specify → clarify → plan →
> tasks → implement) as real Claude Code sessions, isolates every feature in its own git
> worktree, and merges finished work through a queue that resolves conflicts with a
> spec-aware headless agent. Documentation and code comments are in German.
>
> ⚠️ **Localhost only — there is no authentication.** See [SECURITY.md](SECURITY.md) before running it.

Eine lokale Web-App, die den **spec-kit-Workflow über mehrere Projekte gleichzeitig**
orchestriert. Jedes Feature bekommt einen eigenen git-Worktree und eine eigene, dauerhaft
laufende Claude-Code-Session. Fertige Arbeit läuft durch eine Merge-Queue, die Konflikte
mit einem Headless-Agenten auflöst — und bei jedem Zweifel an einen Menschen eskaliert
statt blind zu mergen.

Der **Automation-Dial** bestimmt, wie viel das Werkzeug selbst entscheidet: von „jede Phase
wird einzeln gestartet und freigegeben" bis „Phasen, Verifikation und Merge laufen durch,
Menschen greifen nur bei Ausnahmen ein".

![Board — Kanban über alle Phasen eines Projekts](docs/images/board.png)

> Alle Bilder in diesem Dokument zeigen ein **Demo-Projekt mit erfundenen Daten**.

## Inhalt

- [Quickstart](#quickstart) · [Die sechs Ansichten](#die-sechs-ansichten) · [Worktree-Isolation](#worktree-isolation-pro-feature)
- [Merge-Queue](#merge-queue-mit-konfliktauflösung) · [Wissensdatenbank](#projektspezifisches-wissen) · [Projekt-Chat](#projekt-chat)
- [Jira-Import](#jira-import) · [Automation-Dial](#automation-dial) · [Token-Messung](#token-messung-und-optimierung)
- [Architektur](#architektur) · [Konfiguration](#konfiguration) · [Sicherheit](#sicherheit)

## Quickstart

```bash
pnpm install
pnpm dev          # Server (Port 4820) + Web-UI (Port 4830)
open http://localhost:4830
```

Voraussetzungen: Node ≥ 22, git ≥ 2.40, Claude Code CLI (`claude`) im PATH.

Ziel-Repos brauchen [spec-kit](https://github.com/github/spec-kit) für Claude Code
(`/speckit-*`-Kommandos) — Initialisierung über den Banner im Tool oder manuell:

```bash
uvx --from git+https://github.com/github/spec-kit.git specify init --here --integration claude
```

Danach committen, damit Feature-Worktrees die Skills erben. Ältere Installationen mit
`/speckit.*`-Punktnotation werden automatisch erkannt.

## Die sechs Ansichten

### Board — der Stand aller Features auf einen Blick

Eine Bahn pro Workflow-Schritt, plus eine Integrations-Bahn für alles, was schon Richtung
`main` unterwegs ist. Features lassen sich per Drag-and-drop weiterziehen; die Karte zeigt
Task-Fortschritt aus `tasks.md`, die erzeugten Artefakte als Icons und — falls die
Integration hakt — den Grund direkt auf der Karte.

![Board](docs/images/board.png)

Das **ℹ-Icon im Bahnkopf** öffnet die spec-kit-Definition des Schritts: Was macht
`/speckit-plan` eigentlich? Der Prompt lässt sich dort direkt bearbeiten, mit
Konfliktschutz und Sperre, solange ein Agent läuft.

### Grid — bis zu neun Konsolen nebeneinander

Jedes Feature hat eine **echte, dauerhafte Claude-Code-Session** in seinem Worktree. Die
Grid-Ansicht legt bis zu neun davon nebeneinander und wählt automatisch die aus, die gerade
arbeiten oder auf eine Antwort warten. Die fokussierte Konsole streamt live, die übrigen
werden gedrosselt.

![Grid mit vier laufenden Feature-Konsolen](docs/images/grid.png)

Man tippt direkt in die Konsole — es gibt kein separates Eingabefeld. Die PTYs leben am
Server: Ein geschlossener Browser-Tab beendet keine Session, und nach einem Server-Neustart
wird `claude --resume` genutzt statt neu gestartet.

### Workflow — die Pipeline als bearbeitbare Kette

Zeigt die tatsächlich geltende Konfiguration: welcher Schritt welches Kommando ausführt, wo
Projektwissen injiziert wird, wo eine menschliche Freigabe sitzt und welche Agenten-Gates
vor oder nach einer Phase laufen.

![Workflow-Übersicht](docs/images/workflow.png)

Gates sind frei belegbar — etwa ein DoR-Gate, das die Implementierung blockiert, solange in
`spec.md` noch offene Fragen stehen, oder ein Plan-Qualitätsreview nach der Plan-Phase.

### Läufe — was jeder Schritt gekostet hat

Ein Lauf entspricht einem Worktree beziehungsweise Feature. Aufgeklappt zeigt er die Tokens
pro Schritt, die Aufteilung in Spezifikation, Coding und Overhead sowie die Zusammensetzung
aus Input, Output und Cache-Read.

![Läufe mit Token- und Kosten-Aufschlüsselung](docs/images/laeufe.png)

Die Zahlen stammen aus dem Claude-Transkript, nicht aus einer Schätzung am Terminal. Was
nicht autoritativ gemessen werden konnte, wird als solches ausgewiesen — die Kopfzeile
nennt den gemessenen Anteil ehrlich.

### Review — Diff, Kommentare und die Entscheidung

Bevor etwas nach `main` geht, landet es hier: Dateibaum, Diff gegen den Ziel-Branch,
zeilengenaue Kommentare, Ergebnisse der Agent-Audits und die Wahl des Ziel-Branches.

![Review-Portal mit Diff und Kommentaren](docs/images/review.png)

„Freigeben & Integrieren" schiebt das Feature in die Merge-Queue. „Zurückweisen" gibt es
mit den Kommentaren an die Session zurück. Reviewer-Änderungen erzwingen eine erneute
Verifikation, damit nichts Ungeprüftes durchrutscht.

### Braucht dich — Monitoring by exception

Die Inbox sammelt projektweit alles, was Menschen braucht: Rückfragen von Agenten, rote
Verifikationen, nicht bestandene Gates, eskalierte Merge-Konflikte, fällige Reviews und
unterbrochene Läufe.

![Braucht dich — die Ausnahme-Inbox](docs/images/braucht-dich.png)

Entscheidend ist, was **nicht** drinsteht: Löst sich eine Situation von selbst auf — die
Session läuft weiter, die Verifikation wird grün, der Konflikt ist geklärt —, verschwindet
die Meldung automatisch. Jeder Eintrag wird bei jedem Lesen gegen den tatsächlichen Zustand
geprüft. Eine Inbox, in der Geister stehen, wird nicht mehr gelesen.

## Worktree-Isolation pro Feature

Jedes Feature bekommt einen eigenen Branch `feature/<name>` und einen eigenen git-Worktree
unter `~/.sdd-toolkit/worktrees/`. Damit arbeiten beliebig viele Agenten parallel, ohne
sich gegenseitig die Arbeitskopie umzuschreiben; der Haupt-Checkout des Projekts bleibt
unberührt.

Die Worktree-Verwaltung ist defensiv gebaut: Sie adoptiert keinen fremden Branch an einem
Zielpfad, bricht ab statt uncommittete Arbeit zu verwerfen, heilt Registry-Leichen und
übersteht parallele Anlagen desselben Branches. Diese Fälle sind gegen echte
git-Repositories getestet, nicht gegen Mocks.

## Merge-Queue mit Konfliktauflösung

Ist `implement` fertig, läuft die Integration in dieser Reihenfolge:

1. **Verifikation** — pro Projekt konfigurierbare Kommandos (Test, Build, Lint)
2. **Review-Gates** — Agenten mit `VERDICT: PASS/FAIL`, blockierend oder beratend
3. **Menschliches Review** — das Portal oben
4. **Merge-Queue** — Rebase auf den Ziel-Branch
5. **Konflikt?** — ein Headless-Claude löst ihn mit der Spec beider Seiten als Kontext auf
6. **Erneute Verifikation** — nach der Auflösung, nie ungeprüft
7. **Merge + Aufräumen** — Worktree und Branch werden entfernt

Scheitert ein Schritt, geht der Vorgang in die „Braucht dich"-Inbox. Es gibt keinen
Blind-Merge. Wahlweise mergt das Werkzeug lokal oder eröffnet einen GitHub-PR.

## Projektspezifisches Wissen

Pro Projekt lässt sich verschachteltes Wissen pflegen — Bundles mit Einträgen —, das die
Feature-Sessions **selektiv** konsumieren. Nicht jeder Kontext wird in jede Session geladen.

![Wissensdatenbank eines Projekts](docs/images/wissen.png)

- **Anwendbarkeit** je Eintrag als Freitext plus Tags; bestehende Repo-Dateien lassen sich
  importieren oder referenzieren.
- **Index**: eine kompakte Projektion aus Titeln und Anwendbarkeit, abgeleitet und damit
  nie veraltet.
- **Vor jeder Phase** wird nur das relevante Wissen nach `<worktree>/.sdd/knowledge/`
  materialisiert (git-excluded) und per kurzer Präambel referenziert. Die Relevanz wird
  vorgeschlagen und ist pro Feature übersteuerbar.

## Projekt-Chat

Die Sprechblase unten rechts öffnet eine vollwertige, interaktive Claude-Code-Session als
echte Konsole — in einer **isolierten Arbeitskopie** (Branch `chat/<id>`), sodass die
Haupt-Arbeitskopie unberührt bleibt. Die Session darf lesen, Dateien ändern und Kommandos
ausführen; Freigaben laufen über denselben Permission-Fluss wie Feature-Sessions.

Kristallisiert sich im Gespräch ein Feature heraus, schlägt die Session es per
Bestätigungskarte vor. Per Klick entstehen daraus richtige Features mit Branch, Worktree und
optional direktem `/speckit-specify`. Schliessen beendet die Session nicht — sie läuft am
Server weiter, ihre Turns erscheinen im Kosten-Audit.

## Jira-Import

Features lassen sich direkt aus Jira-Cloud-Tickets erstellen. Die Übernahme ist ein
**Schnappschuss**, keine Synchronisation, und mündet in den normalen Feature-Workflow.

- **Anbindung** über den offiziellen Atlassian MCP (`mcp.atlassian.com`) mit OAuth-Freigabe
  im Browser. Das Toolkit speichert weder Jira-Passwörter noch eigene API-Token; die
  Autorisierung gilt auf Nutzerebene und liegt unter `~/.sdd-toolkit/atlassian-mcp.json`.
- **Auswahl** nach Site, Projekt und Sprint (aktive und zukünftige Sprints aller Boards
  zusammengeführt; Projekte ohne Sprints zeigen die Backlog-Sicht). Mehrfachauswahl per
  Checkbox.
- **Je Ticket ein Feature** mit Titel, Beschreibung und dauerhaft sichtbarem, klickbarem
  Jira-Key. Bereits übernommene Tickets sind markiert; ein Re-Import verlangt eine
  ausdrückliche Bestätigung.
- **Vollständiger Ticketkontext** landet im Worktree unter `specs/<slug>/jira/`: ein
  Markdown-Dossier mit allen ausgefüllten Feldern und Kommentaren, dazu die Anhänge. Nicht
  abrufbare Anhänge werden mit Name und Quell-URL vermerkt.
- **Fehler einzelner Tickets** stoppen die übrigen nicht; das Ergebnis wird pro Ticket
  ausgewiesen.

## Automation-Dial

Der Dial ist global im Kopf einstellbar und pro Projekt oder Feature überschreibbar.

| Automation | Level 2 — Orchestrierung | Level 3 — überwachte Autonomie |
|---|---|---|
| Phasenfortschritt | jede Phase wird manuell gestartet | Phase fertig → nächste startet |
| Verifikation | manuell angestossen | Pipeline läuft nach `implement` |
| Merge | manuell freigegeben | Merge-Queue arbeitet selbstständig |

Auf Level 3 laufen Agenten mit `bypassPermissions` — sie führen Kommandos ohne Rückfrage
aus. Das ist eine bewusste Entscheidung pro Projekt, keine stille Voreinstellung.

## Token-Messung und Optimierung

Der Verbrauch wird autoritativ aus dem Claude-Transkript gelesen, inklusive `cache_read`
als Mass für den mitgeschleppten Kontext. Was nicht gemessen werden konnte, wird als
Schätzung gekennzeichnet statt beschönigt.

Ein **Optimierungs-Dial** (global → Projekt → Feature) erlaubt einen Kontext-Reset vor
nachgelagerten Phasen (`compact` oder `fresh`) und eine deterministische Verdichtung
signalarmer Inhalte. Der Default lässt das Verhalten unverändert; jede Stufe ist
umkehrbar.

## Weitere Funktionen

- **Brownfield-Import**: Vorhandene `specs/<feature>`-Ordner eines Repos werden beim
  Hinzufügen automatisch als Features erkannt.
- **Artefakt-Ansicht**: Ergebnis-Icons auf der Feature-Karte öffnen `spec.md`, `plan.md`,
  `tasks.md` und Checklisten lesbar gerendert — bearbeitbar, strukturerhaltend
  zurückgeschrieben, konflikt- und sperrgeschützt.
- **Projekt-Terminal**: eine persistente Login-Shell im Projektverzeichnis.
- **Change-Guard**: erkennt Änderungen am Haupt-Checkout, die Worktrees veralten lassen.
- **⌘K-Switcher**, klickbare Dateipfade in Konsolenausgaben, Bild-Paste in Prompts,
  Spracheingabe (Web Speech, Whisper oder Groq), helles und dunkles Farbschema.

## Architektur

```
packages/
├── shared/   Domäne: Typen + pure State-Machines (Phasen-Workflow, Session-Status)
├── server/   Fastify + WebSockets, node-pty, better-sqlite3 (WAL), git-Engine
└── web/      React + Vite + Tailwind, xterm.js-Konsolen, Kanban, Inbox
```

Kernideen:

- **Hook-Bridge statt Output-Parsing.** Claude startet mit `--settings <datei>`; Hooks
  hängen jedes Ereignis an ein JSONL, der Server beobachtet es. `PermissionRequest`,
  `AskUserQuestion` und `ExitPlanMode` bedeuten „wartet auf dich", `Stop` heisst „Turn
  fertig". Kein Raten anhand von Terminalausgabe.
- **Pure State-Machines** in `packages/shared`: Phasen-Reducer inklusive
  Downstream-Staleness und Session-Status-Reducer mit Effekt-Dedup, vollständig
  unit-getestet und ohne Mocks prüfbar.
- **PTYs leben am Server.** Browser-Tab zu heisst nicht Session weg; xterm.js verbindet
  sich mit Scrollback-Replay wieder.
- **Startup-Reaper**: verwaiste `running`-Zustände werden beim Start bereinigt.
- **SQLite (WAL)** hält ausschliesslich Orchestrierungs-Zustand. Die Spec-Wahrheit sind
  Dateien im Ziel-Repo unter `specs/`, versioniert mit dem Code. `~/.claude/` wird strikt
  read-only behandelt.

## Konfiguration

| Variable | Default | Zweck |
|---|---|---|
| `SDD_PORT` | `4820` | API- und WebSocket-Port |
| `SDD_WEB_PORT` | `4830` | Port der Web-UI im Entwicklungsmodus |
| `SDD_HOST` | `127.0.0.1` | Bind-Adresse — bewusst nur lokal |
| `SDD_DATA_DIR` | `~/.sdd-toolkit` | Datenbank, Logs, Hook-Ereignisse, Worktrees |
| `SDD_ALLOWED_ORIGINS` | — | zusätzliche Browser-Origins, kommagetrennt |

> ⚠️ **`SDD_HOST` nicht setzen.** Der Default `127.0.0.1` ist die einzige unterstützte
> Bindung. Die API ist **nicht authentifiziert** und kann Shell-Sessions starten,
> Editor-Kommandos ausführen und Projektdateien lesen und schreiben. Ein Reverse-Proxy
> ändert daran nichts. Für Zugriff von einem anderen Gerät einen SSH-Tunnel nutzen.
> Details: [SECURITY.md](SECURITY.md).

Verifikations-Kommandos pro Projekt lassen sich über die Projekteinstellungen oder per API
setzen: `PATCH /api/projects/:id` mit
`{"verifyCommands":[{"name":"test","command":"pnpm test"}]}`.

## Entwicklung

```bash
pnpm lint         # ESLint über alle Pakete, keine Warnungen erlaubt
pnpm typecheck    # TypeScript über alle Pakete
pnpm test         # Domänen-Machines, Migrationen und git-Integration
pnpm build        # Server-Bundle + Web-Bundle

pnpm --filter @sdd/server dev   # nur Server
pnpm --filter @sdd/web dev      # nur Web-UI
```

Was git anfasst, wird gegen echte Repositories in `mkdtemp` getestet — Worktrees, Rebases,
Konflikte und Abbrüche passieren wirklich. Die Datenbank-Migrationen werden zusätzlich auf
dem Aufstiegspfad geprüft: Eine bestehende Datenbank mit Daten wird von jedem
Zwischenstand auf den aktuellen Stand gehoben, und der Datenerhalt wird nachgewiesen.

Unter `docs/agents/` liegen wiederverwendbare Agent-Prompts, die sich als Slash-Command in
Claude Code einhängen lassen — etwa der Lösungsplan-Qualitätsreview.

Ein vollständiges Beispiel der erzeugten SDD-Artefakte (spec, plan, tasks, research,
data-model, contracts, checklists) liegt unter `specs/braucht-dich-meldungen-optimieren/`.
Das Werkzeug entwickelt sich selbst damit.

## Sicherheit

Das Toolkit ist ein **lokales Entwicklerwerkzeug ohne jede Authentifizierung**. Es kann
Shell-Sessions starten, Editor-Kommandos ausführen und beliebige Projektdateien lesen und
schreiben; im Auto-Modus laufen Agenten mit `bypassPermissions`. Wer den Port erreicht,
kann auf der Maschine tun, was der ausführende Benutzer tun kann.

Gegen Zugriffe aus fremden Webseiten ist der Server abgesichert: HTTP-API und beide
WebSocket-Routen akzeptieren nur erlaubte Origins, und der `Host`-Header muss auf eine
lokale Adresse zeigen (Schutz gegen DNS-Rebinding). Das ersetzt **keine**
Authentifizierung — es verhindert nur, dass eine beliebige offene Browser-Seite die lokale
API fernsteuert.

**Nur auf `127.0.0.1` betreiben — niemals an ein Netz binden und nicht hinter einen
Reverse-Proxy stellen.** Vollständiges Bedrohungsmodell, Betriebsregeln und Meldeweg für
Schwachstellen: [SECURITY.md](SECURITY.md).

## Lizenz

[MIT](LICENSE) © 2026 whispers2011

Dieses Repository enthält Dateien aus [github/spec-kit](https://github.com/github/spec-kit)
(MIT). Herkunft, Dateiliste und Lizenztext: [THIRD-PARTY.md](THIRD-PARTY.md).
