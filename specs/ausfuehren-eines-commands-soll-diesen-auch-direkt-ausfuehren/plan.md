# Implementation Plan: Kommandos direkt ausführen statt nur vorausfüllen

**Branch**: `feature/ausfuehren-eines-commands-soll-diesen-auch-direkt-ausfuehren` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/ausfuehren-eines-commands-soll-diesen-auch-direkt-ausfuehren/spec.md`

## Summary

Beim Auslösen einer Kommando-Aktion („Run"/„Start"/Phasen-Aktion) wird der Befehl heute nur in die Claude-TUI eingefügt und nach fixen 80 ms mit einem CR quittiert. Bei frisch gespawnten Sessions (Feature-Start, Resume nach Neustart) ist die TUI zu diesem Zeitpunkt noch nicht eingabebereit — der Befehl bleibt unabgeschickt stehen, während die Kachel bereits „läuft …" zeigt (der Phasenstatus wird eager gesetzt, entkoppelt vom tatsächlichen Ausführungsbeginn).

**Technischer Ansatz**: Die zentrale Send-Pipeline (`PtySessionManager.sendPrompt`) wird von „blind nach 80 ms CR" auf **bereitschaftsgesteuertes, bestätigtes Absenden** umgestellt: Der Prompt wird eingereiht, sobald die Session eingabebereit ist (Session-State `ready`/`working`/`turn_done`/`awaiting_input`) gepastet und abgeschickt, und die Zustellung wird per Session-State-Maschine bestätigt (Übergang nach `working` bzw. `user_prompt_submit`-Hook) — sonst CR-Retry, und bei endgültigem Scheitern ein Aufmerksamkeits-Item. Die „läuft …"-Anzeige wird an den echten Ausführungszustand gekoppelt (nur wenn Phase `running` **und** Session tatsächlich arbeitet; sonst „wird gestartet …" bzw. „braucht dich"). Unterbrochene/verwaiste Läufe (Ruhezustand/Neustart) und Startfehler landen im bestehenden „braucht dich"-Mechanismus statt in einem falschen „läuft …". Da alle Kommando-Auslösepunkte bereits über `sendPrompt` laufen, wirkt die zentrale Korrektur „überall"; die bewusst quittierungsbasierten bzw. reinen Einfüge-Pfade (Init, Bild-Pfad) bleiben unangetastet.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js ≥ 20 für Server, React 19 für Web)

**Primary Dependencies**: Server — Fastify 5, `node-pty`, `better-sqlite3`, `ws`; Web — React 19, Vite, Tailwind v4, `@xterm/xterm`; Shared — reine Domänenlogik (`@sdd/shared`, kein I/O)

**Storage**: SQLite (`better-sqlite3`). **Keine Schema-Änderung nötig** — das Aufmerksamkeits-/„braucht dich"-Repo (`AttentionRepo`, `AttentionItem`) existiert bereits. Session-Sendezustand (Prompt-Queue, Submit-Bestätigung) ist rein in-memory/ephemer.

**Testing**: Vitest (`packages/shared`, `packages/server` via `vitest run`). Web hat im MVP keine Tests. Neue Logik wird primär in `@sdd/shared` (pur, gut testbar) und mit Server-Unit-Tests abgedeckt.

**Target Platform**: Lokaler Desktop-Orchestrator (Fastify-Server + Browser-UI), macOS/Linux.

**Project Type**: Web (pnpm-Monorepo: `packages/server` + `packages/web` + `packages/shared`).

**Performance Goals**: Abschicken erfolgt ohne wahrnehmbare Verzögerung nach Session-Bereitschaft (SC-004, „sofort" innerhalb weniger Sekunden nach Ready). Kein Durchsatz-/Latenz-kritischer Pfad.

**Constraints**:
- Keine Regression an frei abgeschickten Prompts (PromptBar → `sendPrompt`).
- Reine Einfüge-Pfade unverändert: Init (`server.ts` `init-speckit`, bewusst ohne CR) und Bild-Pfad-Einfügen (`paste-image`, Bracketed Paste ohne CR).
- Keine falsche „läuft …"-Anzeige — Statuswert muss der Realität entsprechen (SC-003).

**Scale/Scope**: Einzelnutzer-Orchestrator, wenige gleichzeitige Feature-Sessions; Änderungsfläche bewusst klein (eine zentrale Send-Pipeline + Status-Rendering + Reconciliation).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Die Projekt-Constitution (`.specify/memory/constitution.md`) ist ein **nicht ausgefülltes Template** (nur Platzhalter, keine ratifizierten Prinzipien). Es existieren daher **keine bindenden Governance-Gates**. Der Check gilt als **bestanden**; als Leitplanken werden die impliziten Projektkonventionen angewandt:

- **Minimale Komplexität**: Zentrale Korrektur in einer Send-Pipeline statt Umbau jedes Auslösepunkts — passt zur Repo-Architektur (`sendPrompt` ist bereits der gemeinsame Choke-Point).
- **Reine Domänenlogik in `@sdd/shared`**: Bereitschafts-/Submit-Entscheidungen möglichst als pure, testbare Helfer; I/O (PTY-Writes, Timer) bleibt im Server.
- **Keine unnötigen Schema-/Persistenz-Änderungen**: bestehendes Attention-Repo wiederverwenden.

**Ergebnis**: PASS (keine Verstöße, keine Rechtfertigung in Complexity Tracking nötig).

## Project Structure

### Documentation (this feature)

```text
specs/ausfuehren-eines-commands-soll-diesen-auch-direkt-ausfuehren/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 (Verhaltens-Contracts der Nahtstellen)
│   ├── send-pipeline.md
│   ├── phase-run-and-status.md
│   └── attention-and-ui-state.md
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/
├── shared/src/
│   ├── sessionMachine.ts     # Session-States (created→launching→ready→working…); Bereitschafts-/Submit-Helfer (neu, pur)
│   ├── phaseMachine.ts        # Phasen-States; ggf. Helfer für „unterbrochen/fortsetzbar"-Reconciliation
│   └── types.ts               # AttentionKind (ggf. neuer Kind 'run_interrupted'), SessionDisplayStatus
├── server/src/
│   ├── pty/
│   │   ├── sessionManager.ts   # KERN: sendPrompt → bereitschaftsgesteuert + Submit-Bestätigung + Retry + Fehler-Callback
│   │   └── commandBuilder.ts    # SUBMIT_DELAY_MS/SUBMIT_KEY/bracketedPaste (Konstanten/Retry-Parameter)
│   ├── services/
│   │   └── orchestrator.ts      # startPhaseRun: Rollback+Attention bei Fehler; Interrupt-Reconciliation; reapOnBoot → Attention
│   └── api/
│       └── server.ts            # Routen unverändert in der Signatur; init-speckit & paste-image bleiben reine Einfüge-Pfade
└── web/src/components/
    ├── KanbanBoard.tsx          # „läuft …"-Badge an echten Ausführungszustand koppeln (+ „wird gestartet …")
    └── FeatureConsole.tsx        # PhaseStrip-Pulse identisch koppeln; PromptBar (Senden) unverändert
```

**Structure Decision**: Bestehendes Web-Monorepo. Der Fix ist überwiegend server- und domänenseitig (`packages/server/src/pty/sessionManager.ts` als zentrale Nahtstelle, `packages/shared` für pure Bereitschafts-/Reconciliation-Logik) plus eine reine Rendering-Anpassung im Web (`KanbanBoard.tsx`, `FeatureConsole.tsx`). Keine neuen Packages, keine DB-Migration.

## Complexity Tracking

> Keine Constitution-Verstöße — Abschnitt entfällt.
