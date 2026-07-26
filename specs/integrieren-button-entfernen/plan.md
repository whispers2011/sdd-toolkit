# Implementation Plan: Aktions-Buttons kontextabhängig — ein Standardweg in die Anwendung

**Branch**: `feature/integrieren-button-entfernen` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/integrieren-button-entfernen/spec.md`

## Summary

Heute entscheidet jede Oberfläche selbst, welche Aktionen sie anbietet: die Feature-Konsole zeigt „⇥ Integrieren" ab dem allerersten Schritt, die Board-Karte prüft nur den Session-Status, Drag & Drop umgeht jede Bedingung, und „✓ Als abgeschlossen markieren" setzt ein Feature ohne Verifikation, Review oder Merge auf `merged`. Die Regeln existieren vierfach, an keiner Stelle vollständig, und der Server prüft sie gar nicht.

Der Plan führt deshalb **eine einzige, pure Festlegung** ein: `packages/shared/src/actionPolicy.ts` bildet `(Feature-Zustand → Aktion) → Befund {angeboten | gesperrt+Grund | nicht angezeigt}` ab. Board, Feature-Konsole, Review-Übersicht und Review-Portal rendern nur noch diesen Befund; jede aktionsauslösende Route prüft ihn serverseitig über einen gemeinsamen `actionGuard` (FR-022/FR-024). Dazu kommen drei fachliche Eingriffe: die Vorprüfung „Änderungen vorhanden?" vor jedem Integrationsstart (FR-027), das Zurücksetzen des letzten Schritts bei einer Review-Zurückweisung (FR-020/FR-026) und die ersatzlose Entfernung der beiden Abkürzungen `mark-done` und Drag-auf-Schritt-Spalte (FR-016/FR-029).

## Technical Context

**Language/Version**: TypeScript 5.8 (ESM, `"type": "module"`), Node ≥ 22

**Primary Dependencies**: Fastify 5 + `@fastify/websocket` (API/Events), React 19 + Vite 6 + Tailwind 4 (UI), better-sqlite3 12 (Persistenz), node-pty (Sessions)

**Storage**: SQLite über `better-sqlite3`; Schema-Änderungen als append-only Eintrag in `MIGRATIONS` (`packages/server/src/db/database.ts`, `user_version`-gesteuert)

**Testing**: Vitest 3 in `@sdd/shared` und `@sdd/server` (`src/**/*.test.ts`). **`@sdd/web` hat bewusst keinen Test-Runner** — daraus folgt die zentrale Architekturvorgabe: sämtliche Entscheidungslogik liegt in `@sdd/shared` und ist dort getestet; die Web-Komponenten rendern ausschließlich das Ergebnis.

**Target Platform**: lokale Entwicklungsmaschine (macOS/darwin), Browser-SPA gegen lokalen Fastify-Server

**Project Type**: Web application in einem pnpm-Workspace (`packages/shared` + `packages/server` + `packages/web`)

**Performance Goals**: Sichtbarkeit/Sperrung wird rein synchron aus dem bereits vorhandenen Store-Zustand berechnet (kein Netzwerk-Roundtrip pro Render, FR-023). Der einzige asynchrone Fakt — „hat das Arbeitsverzeichnis Änderungen?" — wird höchstens einmal je *fertigem* Feature abgefragt, nie für Features in Arbeit.

**Constraints**: Keine neuen Oberflächen (Annahme der Spec). Stufen und Reihenfolge der Integrations-Pipeline bleiben unverändert. Automation-Einstellungen bleiben unverändert und dürfen nicht zu einem zweiten Weg werden. Bestehende Features behalten ihren Integrationszustand.

**Scale/Scope**: 4 Oberflächen · 10 aktionsauslösende Bedienelemente · 11 Integrationsstufen · 7 Feature-Phasen · 5 Session-Zustände. 3 geänderte Pakete, ~14 berührte Dateien, 2 neue Module + 1 neue Web-Komponente.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist **unausgefüllt** (reine Platzhalter-Vorlage, `[PRINCIPLE_1_NAME]` usw.). Es existieren damit keine ratifizierten Prinzipien, gegen die geprüft werden könnte — **kein Gate greift, kein Gate schlägt fehl**. Es werden keine Verstöße konstruiert und keine Ausnahmen beantragt; `Complexity Tracking` bleibt leer.

Ersatzweise gelten die im Repository nachweisbaren Konventionen, die dieser Plan einhält:

| Konvention (im Code belegt) | Einhaltung in diesem Plan |
|---|---|
| Pure Entscheidungslogik liegt in `@sdd/shared` und ist per Vitest getestet (`phaseMachine.ts`, `sessionMachine.ts`, `workflowModel.ts`) | `actionPolicy.ts` folgt exakt diesem Muster — kein I/O, keine UI, volle Testabdeckung |
| Domänen-Unions als `Record<Union, …>` typisieren, damit eine neue Stufe/Phase den Typecheck bricht statt still zu veralten (`workflowModel.ts`) | Stufen-Klassifikation (`aktiv` / `Entscheidung` / `terminal`) als `Record<IntegrationStage, StageClass>` |
| Deutsche Fachsprache in UI-Texten, Kommentaren und Fehlermeldungen | Alle Sperrgründe und Ablehnungstexte auf Deutsch, identisch in UI und API |
| Minimale Komplexität, keine Rückwärtskompatibilitäts-Hüllen für entfernten Code | `mark-done` und `advance` werden inklusive Route, Client-Methode und Orchestrator-Methode ersatzlos gelöscht |

**Post-Design Re-Check (nach Phase 1)**: unverändert — die Design-Artefakte führen keine zusätzlichen Projekte, Schichten oder Abstraktionen ein. Die einzige neue Abstraktion (`actionPolicy`) ersetzt vier Duplikate durch eine Festlegung und ist durch FR-022 ausdrücklich gefordert.

## Project Structure

### Documentation (this feature)

```text
specs/integrieren-button-entfernen/
├── plan.md              # Diese Datei
├── research.md          # Phase 0: Entscheidungen + verworfene Alternativen
├── data-model.md        # Phase 1: Aktion, Feature-Zustand, Aktionsbefund
├── quickstart.md        # Phase 1: ausführbare Validierungsszenarien
├── contracts/
│   ├── action-policy.md #   Aktion × Zustand → Befund (die gemeinsame Festlegung)
│   └── http-api.md      #   Routen: entfernt / neu / bewacht
├── checklists/
│   └── requirements.md  # bereits vorhanden
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/
├── shared/src/
│   ├── actionPolicy.ts          # NEU — die einzige Festlegung (FR-022)
│   ├── actionPolicy.test.ts     # NEU — Aktion × Zustand vollständig
│   ├── phaseMachine.ts          # + reopenLastPhase() (FR-020)
│   ├── phaseMachine.test.ts     # + Tests dazu
│   ├── types.ts                 # + Feature.reviewRejectedAt (FR-026)
│   ├── workflowModel.ts         # Stufen-Labels für Sperrgründe wiederverwenden
│   └── index.ts                 # + export actionPolicy
├── server/src/
│   ├── services/
│   │   ├── actionGuard.ts       # NEU — baut Kontext, wirft 409 mit Grund (FR-024)
│   │   ├── actionGuard.test.ts  # NEU
│   │   ├── orchestrator.ts      # + isGateRunning(); − advanceTo() (FR-029)
│   │   └── mergeQueueService.ts # beginIntegration: Vorprüfung zuerst (FR-027/FR-004)
│   ├── api/
│   │   ├── server.ts            # Guards; − mark-done; − advance; reject-review setzt zurück;
│   │   │                        #   + GET /features/:id/integration-readiness
│   │   └── server.test.ts       # + Ablehnungs-Tests je Route
│   └── db/
│       ├── database.ts          # + Migration: features.review_rejected_at
│       └── repos.ts             # + Mapping/Setter dazu
└── web/src/
    ├── api.ts                   # − markDone; − advance; + integrationReadiness
    ├── store.tsx                # Bereitschafts-Cache je Feature + WS-Invalidierung
    └── components/
        ├── FeatureAction.tsx    # NEU — Aktionsgruppe, sichtbarer Sperrgrund, Doppelklick-Guard
        ├── KanbanBoard.tsx      # Karten-Aktionen + Drop-Ziele über die Policy
        ├── FeatureConsole.tsx   # Schrittleiste + Integrations-Aktion über die Policy
        ├── ReviewOverview.tsx   # „Vorschau"-Kennzeichnung (FR-019)
        └── ReviewPortal.tsx     # Freigeben/Zurückweisen über die Policy
```

**Structure Decision**: Der bestehende pnpm-Workspace bleibt unverändert. Neue Logik wandert konsequent nach `packages/shared` — das ist hier keine Stilfrage, sondern die einzige Möglichkeit, FR-022 („eine gemeinsam genutzte Festlegung") und FR-014 („alle Oberflächen zeigen dieselbe Menge") strukturell zu erzwingen, und zugleich die einzige Stelle im Repo, an der die Regeln überhaupt automatisiert testbar sind (kein Test-Runner in `@sdd/web`).

## Complexity Tracking

> Keine Constitution-Verstöße (Constitution ist unausgefüllt) — Abschnitt bleibt leer.
