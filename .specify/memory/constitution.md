# SDD Toolkit Constitution

## Core Principles

### I. Minimale Komplexität

Die einfachste Lösung, die die Anforderung und ihre Risiken abdeckt, gewinnt. Keine
Abstraktion ohne belegten, wiederkehrenden Bedarf: keine Interfaces mit genau einer
Implementierung, keine Konfigurierbarkeit für hypothetische Fälle, keine Pattern-Einführung
ohne nachgewiesenen Problemdruck. Wächst eine Datei über ihre erkennbare Verantwortung
hinaus, wird sie geteilt — nicht generalisiert.

### II. Reine Domäne, getrennt von IO

`packages/shared` enthält Typen und **pure Funktionen und State-Machines** (Phasen-Workflow,
Session-Status) — ohne Dateisystem, Netzwerk, Datenbank oder Zeit. `packages/server` besitzt
alles Seiteneffektbehaftete (PTYs, git, SQLite, HTTP/WS), `packages/web` nur Darstellung und
Interaktion. Fachliche Entscheidungen gehören in die reine Schicht, damit sie ohne Mocks
prüfbar bleiben.

### III. Tests am realen Verhalten (NICHT VERHANDELBAR)

Testframework ist Vitest. Reine Logik wird als Unit-Test gegen ihr Verhalten geprüft,
nicht gegen ihre Implementierung. **Alles, was git anfasst, wird gegen echte Repositories
in `mkdtemp` getestet** — git wird nicht weggemockt; Worktrees, Rebases, Konflikte und
Abbrüche müssen echt passieren. Jeder Bugfix beginnt mit einem reproduzierenden
Regressionstest. Tests setzen ihre Voraussetzungen (etwa `user.name`/`user.email`) selbst
und laufen ohne Maschinenkonfiguration.

### IV. Kein Blind-Merge, keine stillen Verluste

Automatisierung darf eskalieren, aber nie raten. Schlägt Verifikation oder Konfliktauflösung
fehl, geht der Vorgang in die „Braucht dich"-Inbox statt durchzulaufen. Operationen, die
fremde Arbeit zerstören könnten, brechen ab und melden — uncommittete Änderungen, fremde
Branches an einem Zielpfad und dreckige Haupt-Checkouts sind Abbruchgründe, keine
Aufräumaufgaben. Datenverlust ist immer ein Fehler, nie ein Trade-off.

### V. Zustand dort, wo er hingehört

Die **Spec-Wahrheit sind Dateien im Ziel-Repo** (`specs/`), versioniert mit dem Code.
SQLite (WAL) hält ausschließlich Orchestrierungs-Zustand. PTYs leben am Server, nicht im
Browser-Tab: ein geschlossener Tab beendet keine Session, und nach einem Neustart wird
resumed statt neu gestartet. Fremdes Verzeichnis wird nicht bewirtschaftet — `~/.claude/`
ist strikt read-only.

## Sicherheitsposition

Das Toolkit ist ein **lokales Werkzeug ohne Authentifizierung**, das Shell-Sessions starten,
Kommandos ausführen und Projektdateien schreiben kann. Daraus folgt verbindlich:

- Die Bindung bleibt per Default `127.0.0.1`. Features, die eine Netzwerk-Exposition
  voraussetzen oder nahelegen, werden nicht gebaut.
- Wer Berechtigungen umgeht (`bypassPermissions` im Auto-Modus), macht das sichtbar und
  ausschließlich auf ausdrückliche Nutzerentscheidung hin.
- Zugangsdaten Dritter (Atlassian-OAuth, Sprach-API-Keys) liegen im Datenverzeichnis, nie
  im Repository, nie in Logs und nie in Fehlermeldungen.
- Änderungen an Bindung, Berechtigungsmodus oder Token-Handling ziehen eine Aktualisierung
  von `SECURITY.md` nach sich.

## Arbeitsweise und Sprache

- **Sprache**: Code-Kommentare, Commit-Messages, Spec-Artefakte und Dokumentation sind
  deutsch. Bezeichner im Code sind englisch, Fachbegriffe der Domäne (Feature, Phase,
  Worktree, Merge-Queue) bleiben unübersetzt. Das README führt zusätzlich eine englische
  Kurzbeschreibung.
- **Keine Rückwärtskompatibilitäts-Shims**: Entferntes wird entfernt. Es gibt keine
  Deprecation-Wrapper, keine toten Codepfade „für den Fall der Fälle" und keine
  Alt-Formate ohne aktiven Nutzer.
- **Kommentare begründen, sie beschreiben nicht**: Ein Kommentar erklärt, *warum* etwas so
  ist — insbesondere Race-Bedingungen, Reihenfolgen und bewusste Trade-offs. Was der Code
  bereits sagt, wird nicht wiederholt.
- **Der Workflow gilt für sich selbst**: Features dieses Repos entstehen über denselben
  spec-kit-Ablauf (specify → clarify → plan → tasks → implement), den das Toolkit
  orchestriert.

## Governance

Diese Constitution geht anderen Konventionen vor. Jeder Plan und jedes Review prüft
gegen sie; ein Verstoß muss im Plan begründet und als bewusster Trade-off dokumentiert
werden — stillschweigende Abweichung ist kein zulässiger Weg.

Änderungen erfolgen als eigener Commit, der benennt, welches Prinzip sich wie ändert und
warum. Die Version folgt semantischer Versionierung: MAJOR bei Entfernen oder
Umdefinieren eines Prinzips, MINOR bei einem neuen Prinzip oder Abschnitt, PATCH bei
Klarstellungen ohne Bedeutungsänderung. Verifikation vor Integration
(`pnpm typecheck && pnpm test && pnpm build`) ist nicht abwählbar.

**Version**: 1.0.0 | **Ratified**: 2026-07-25 | **Last Amended**: 2026-07-25
