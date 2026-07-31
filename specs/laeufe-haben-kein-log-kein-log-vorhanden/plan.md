# Implementation Plan: Läufe haben kein Log – Session-Durchläufe protokollieren

**Branch**: `feature/laeufe-haben-kein-log-kein-log-vorhanden` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/laeufe-haben-kein-log-kein-log-vorhanden/spec.md`

## Summary

In der „Läufe"-Ansicht (`ExecutionsView`) liefert der „Log"-Button für Phasen-/Session-Läufe
`Kein Log vorhanden`, während er für Verify-, Review-, Konflikt- und Chat-Läufe funktioniert.
Ursache: Alle anderen Lauf-Arten schreiben ihre Ausgabe nach `<dataDir>/logs/<id>.log`
(genau der Pfad, den der Endpoint bedient), Phasen-Läufe hingegen starten mit `logPath: null`
und behalten Ausgabe nur im flüchtigen In-Memory-Scrollback (nur fürs Token-Metering).

**Technischer Ansatz** (aus Clarifications): Das Log eines Phasen-Laufs wird **on-demand aus
dem Claude-Transkript** dieses Laufs gerendert (bereinigt, ohne ANSI/TUI-Artefakte), nicht
aus dem Scrollback. Die Attribution erfolgt über den bereits erfassten
`transcript_offset_start` plus einen beim Abschluss persistierten `transcript_offset_end` und
`transcript_path`. Der Log-Endpoint bedient weiterhin physische `<id>.log`-Dateien (übrige
Arten unverändert) und rendert für Phasen-Läufe aus dem Transkript-Ausschnitt. Ein reiner,
unit-getesteter Renderer in `packages/shared` erzeugt den lesbaren Text — passend zur
bestehenden Architektur (pure Funktionen in `shared`, `~/.claude` read-only, Transkript ist
bereits die autoritative Quelle fürs Metering).

## Technical Context

**Language/Version**: TypeScript (ESM, NodeNext), Node ≥ 22

**Primary Dependencies**: Fastify + `@fastify/websocket` (Server), better-sqlite3 (WAL),
node-pty, chokidar (Transkript-Watcher); React 18 + Vite + Tailwind, xterm.js (Web); Vitest
(Tests)

**Storage**: SQLite (`<dataDir>/sdd.db`, WAL) für Orchestrierungs-State; Lauf-Logs der
Nicht-Phasen-Arten als Dateien unter `<dataDir>/logs/<id>.log`; Claude-Transkripte
(read-only) unter `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`

**Testing**: Vitest (`pnpm test`) — Domain-/Pure-Funktionen in `@sdd/shared`,
Integration/Endpoint-Tests in `@sdd/server`

**Target Platform**: Lokale Web-App (Server Port 4820, Web-UI Port 4830), macOS/Linux

**Project Type**: Web-Monorepo (pnpm workspaces): `packages/{shared,server,web}`

**Performance Goals**: Log-Abruf interaktiv (< 1 s für typische Läufe); kein neuer
Dauer-Overhead im heißen Pfad (Rendering nur bei „Log"-Klick, nicht bei jedem Turn)

**Constraints**: `~/.claude/` strikt read-only (nur Lesen des Transkripts); Metriken
(Kosten/Tokens/Status/Dauer) dürfen unverändert bleiben (FR-008); additive DB-Migration
(keine destruktiven Schemaänderungen); keine Log-Größenbegrenzung (FR-009)

**Scale/Scope**: Einzelnutzer-Tool; `executions`-Liste bis 500 Zeilen; einzelne Transkript-
Ausschnitte typ. wenige KB–MB; Bugfix mit begrenztem Blast-Radius (1 Endpoint, 1 Repo,
1 Orchestrator-Pfad, 1 neuer Shared-Renderer, kleine UI-Anpassung)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Die Datei `.specify/memory/constitution.md` ist eine **nicht ausgefüllte Vorlage**
(Platzhalter-Prinzipien) — es existieren keine ratifizierten, bindenden Gates. Ich prüfe
daher gegen die **de-facto-Konventionen** des Repos (README/Architektur):

| Konvention | Bewertung |
|---|---|
| Pure State-/Logik-Funktionen in `packages/shared`, vollständig unit-getestet | ✅ Renderer `renderTranscriptLog` wird pure Funktion in `shared` mit Unit-Tests |
| `~/.claude/` strikt read-only | ✅ Transkript wird ausschließlich gelesen |
| SQLite (WAL) für State, additive Migrationen | ✅ zwei additive Spalten via `ALTER TABLE` in der Migrationsliste |
| Minimum an Komplexität (keine Over-Engineering) | ✅ Wiederverwendung vorhandener Bausteine (`locateTranscript`, `readTranscriptDelta`, `transcript_offset_start`); kein neues Subsystem |
| Bestehendes Verhalten reversibel/unberührt lassen | ✅ Datei-basierte Logs & Metering unverändert; nur Phasen-Log ergänzt |

**Gate: PASS** (vor Phase 0 und nach Phase 1 — Design führt keine Verletzungen ein;
`Complexity Tracking` bleibt leer).

## Project Structure

### Documentation (this feature)

```text
specs/laeufe-haben-kein-log-kein-log-vorhanden/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0 (/speckit-plan)
├── data-model.md        # Phase 1 (/speckit-plan)
├── quickstart.md        # Phase 1 (/speckit-plan)
├── contracts/           # Phase 1 (/speckit-plan)
│   └── executions-log.md
├── checklists/
│   └── requirements.md  # aus /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks – NICHT hier erzeugt)
```

### Source Code (repository root)

```text
packages/
├── shared/
│   └── src/
│       ├── transcriptLog.ts        # NEU: renderTranscriptLog() – pure, ANSI-frei
│       ├── transcriptLog.test.ts   # NEU: Unit-Tests des Renderers
│       ├── transcript.ts           # vorhanden: parseClaudeTranscriptLine u. a. (wiederverwendet)
│       └── index.ts                # + export './transcriptLog.js'
├── server/
│   └── src/
│       ├── db/
│       │   ├── database.ts         # + ALTER TABLE executions ADD transcript_path / transcript_offset_end
│       │   └── repos.ts            # ExecutionRepo: get(id), End-Range persistieren, Record-Felder
│       ├── pty/
│       │   └── transcriptWatcher.ts# + readTranscriptRange(path,start,end) (oder readTranscriptDelta erweitern)
│       ├── services/
│       │   └── orchestrator.ts     # handleTurnCompleted/handleExit: transcript_path + offset_end persistieren
│       └── api/
│           └── server.ts           # GET /api/executions/:id/log: Datei-first, sonst Transkript-Render (phase)
│       └── api/server.test.ts (o. neue Testdatei) # Endpoint-Verhalten je Art/Zustand
└── web/
    └── src/
        └── components/
            └── ExecutionsView.tsx  # laufende Läufe: offenes Log periodisch nachladen; Meldungen präzisieren
```

**Structure Decision**: Bestehendes pnpm-Monorepo mit drei Paketen. Der reine Renderer lebt
in `@sdd/shared` (unit-getestet), die Persistenz-/Endpoint-Änderungen in `@sdd/server`, die
Anzeige-Feinheiten in `@sdd/web`. Keine neuen Pakete/Verzeichnisse nötig.

## Complexity Tracking

> Keine Constitution-Verletzungen — Abschnitt bleibt leer.
