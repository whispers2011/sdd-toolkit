# Implementation Plan: Features im Auto-Modus

**Branch**: `feature/features-sollen-im-auto-mode-laufen` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/features-sollen-im-auto-mode-laufen/spec.md`

## Summary

Neu angelegte Features laufen künftig standardmäßig im **Auto-Modus**: die Feature-Session wird mit einer Berechtigungs-Betriebsart gestartet, die Tool-/Kommando-Aufrufe automatisch erteilt, statt bei jedem Aufruf zu pausieren. Der Modus ist ein zusätzlicher, an-/ausschaltbarer Schalter im bestehenden **Automation-Dial** (oben rechts) und folgt derselben Auflösungs-Hierarchie global → Projekt → Feature wie die übrigen Automatisierungen. Zusätzlich werden **Berechtigungs-Rückfragen nicht mehr als „Braucht dich"-Einträge geführt** — echte Eskalationen (Fragen, rote Verifikation, Konflikte, Fehler) bleiben unverändert.

**Technischer Ansatz**: `AutomationSettings` erhält ein Feld `autoMode: boolean` (Default `true` in beiden Presets). Beim Session-Start (`orchestrator.ensureSession`) wird die aufgelöste `autoMode`-Einstellung auf die `--permission-mode`-Betriebsart abgebildet (`true → bypassPermissions`, `false → acceptEdits` wie bisher). Im `bypassPermissions`-Modus feuert Claude Code keinen `PermissionRequest`-Hook mehr, wodurch die Kette Hook → SessionMachine → Attention strukturell keine Berechtigungs-Rückfrage erzeugt. Unabhängig davon hört der Orchestrator auf, `permission_request`-Attention-Items zu erzeugen (samt zugehöriger Notification); die Inbox filtert etwaige Alt-Einträge dieses Typs heraus. Der Session-Status `awaiting_input` bleibt erhalten (sichtbar in der Konsole), sodass der Aus-Modus über die Konsole bedienbar bleibt.

## Technical Context

**Language/Version**: TypeScript (ESM), Node ≥ 22

**Primary Dependencies**: pnpm-Workspace-Monorepo — `packages/shared` (reine Typen + State-Machines), `packages/server` (Fastify-API, `node-pty`-Sessions, `better-sqlite3`), `packages/web` (React + Vite + Tailwind, WebSocket-Event-Bus). Integration mit der Claude Code CLI über `--permission-mode`.

**Storage**: SQLite (`better-sqlite3`) — Tabellen `settings` (globale Automation als JSON-Partial), `projects`, `features` (Automation-Overrides als JSON-Partial), `attention`.

**Testing**: Vitest (bestehende Unit-Tests: `packages/shared/src/phaseMachine.test.ts`, `sessionMachine.test.ts`).

**Target Platform**: Lokale Web-App (Server Port 4820, Web-UI Port 4830), macOS/Linux-Entwickler-Workstations.

**Project Type**: Web application (Monorepo mit getrenntem Frontend/Backend + Shared-Layer). Kein neues Package.

**Performance Goals**: Nicht performance-kritisch — reine Zustands-/Konfigurationsänderung. Schalter-Änderung wirkt beim nächsten Session-Start.

**Constraints**: Minimaler Eingriff, keine neue Persistenz-Migration nötig (JSON-Partial-Merge über Presets); bestehende Muster (Automation-Dial, `resolveAutomation`, Attention-Repo) wiederverwenden.

**Scale/Scope**: Einzelnutzer-Tool; ~5 berührte Dateien in 3 Packages; keine externen Integrationen außer der lokalen Claude-CLI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Die Projekt-Konstitution (`.specify/memory/constitution.md`) besteht ausschließlich aus unausgefüllten Template-Platzhaltern und ist nicht ratifiziert — es existieren keine bindenden Prinzipien oder Gates. Der Gate gilt damit als **trivial bestanden**.

Leitplanken aus allgemeiner Praxis, an denen sich der Plan orientiert (informativ, nicht bindend):

- **Minimale Komplexität**: keine neuen Packages, keine neue Abstraktion — ein Bool-Feld + Mapping.
- **Wiederverwendung**: nutzt die bestehende `AutomationSettings`-Hierarchie und den Automation-Dial statt einer separaten Einstellungsfläche.
- **Keine Backwards-Compat-Shims**: JSON-Partial-Merge macht eine DB-Migration überflüssig.

**Ergebnis**: PASS (Initial). Nach Phase 1 erneut geprüft → weiterhin PASS (siehe unten).

## Project Structure

### Documentation (this feature)

```text
specs/features-sollen-im-auto-mode-laufen/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0 (/speckit-plan)
├── data-model.md        # Phase 1 (/speckit-plan)
├── quickstart.md        # Phase 1 (/speckit-plan)
├── contracts/           # Phase 1 (/speckit-plan)
│   └── auto-mode.md
├── checklists/
│   └── requirements.md  # aus /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan)
```

### Source Code (repository root)

```text
packages/
├── shared/src/
│   └── types.ts                         # AutomationSettings.autoMode + Preset-Defaults
├── server/src/
│   ├── pty/commandBuilder.ts            # (unverändert nötig — PermissionMode kennt bypassPermissions bereits)
│   └── services/orchestrator.ts         # ensureSession: autoMode → permissionMode-Mapping;
│                                        # handleStatusChange: permission_request nicht mehr als Attention
└── web/src/
    ├── components/AutomationDial.tsx     # Auto-Modus-Toggle im Dial (oben rechts)
    └── components/AttentionInbox.tsx     # Alt-Einträge vom Typ permission_request ausblenden
```

**Structure Decision**: Bestehendes 3-Package-Monorepo (`shared`/`server`/`web`). Die Änderung ist ein vertikaler Durchstich über alle drei Layer ohne neue Verzeichnisse: Typ/Default in `shared`, Verhalten in `server`, Bedienung/Anzeige in `web`. Per-Projekt-/Feature-Override entsteht automatisch, weil `AutomationOverride` (in `ProjectSettings.tsx`) und die Feature-Overrides ganze Preset-Objekte setzen und `resolveAutomation` das neue Feld mitmergt — kein zusätzliches Override-UI erforderlich.

## Complexity Tracking

> Keine Constitution-Verletzungen — Abschnitt entfällt.
