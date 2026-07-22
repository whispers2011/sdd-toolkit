# Implementation Plan: Token-Verbrauch im SDD-Flow minimieren

**Branch**: `feature/minimize-token-consumption` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/minimize-token-consumption/spec.md`

## Summary

Zwei Fähigkeiten in einem Feature: (1) **belastbare Messung** des Token-/Kostenverbrauchs pro Feature, aufgeschlüsselt nach SDD-Phase, und (2) **Reduktion** dieses Verbrauchs um ≥30 % ohne Qualitätsverlust.

Technischer Kern-Insight aus der Codebase-Analyse: Der heute erfasste Verbrauch pro Phase ist nur eine Schätzung aus dem Terminal-Scrollback (`meter()` in `costMeter.ts`, gefüttert aus `session.scrollback.slice(...)`). Der **reale** Verbrauch steht autoritativ im Claude-Transkript-JSONL (`~/.claude/projects/<cwd>/<sessionId>.jsonl`), das der Toolkit über `locateTranscript()` bereits lokalisiert — inklusive `cache_read_input_tokens`, das den mit jeder Phase wachsenden **akkumulierten Kontext** der persistenten `--resume`-Session sichtbar macht. Genau dieser akkumulierte Verlauf ist der größte Kostentreiber.

Umsetzungsansatz:

- **P1 – Messung**: Transkript-Usage pro Phasen-Execution auswerten (Offset-Fenster zwischen Phasenstart/-ende), autoritative Token-Komponenten + Quelle (`transcript`/`parsed`/`estimated`) in `executions` persistieren; Aggregations-Endpoint + Executions-View-Rollup nach Phase/Art.
- **P2 – Smarte Kontext-Übergabe**: Vor Start einer Downstream-Phase den akkumulierten Sitzungs-Kontext gezielt zurücksetzen (`compact`/`fresh`), da jede Phase ihre Artefakte ohnehin frisch von Disk liest. Konfigurierbar (global→Projekt→Feature), reversibel auf `full`.
- **P3 – Verdichtung**: Deterministischer Kompressor für toolkit-injizierte Inhalte (materialisiertes Wissen, Präambeln, extra-Prompts); optionale LLM-Verdichtung nur mit Netto-Ersparnis-Guard.

Nachweis (SC-001) per A/B am selben Referenz-Feature: Executions tragen die aktiven Optimierungs-Settings, sodass „an vs. aus" mit identischer (transkript-basierter) Messmethode verglichen werden kann.

## Technical Context

**Language/Version**: TypeScript (strict), Node.js ≥ 22, ESM. pnpm-Monorepo.

**Primary Dependencies**: Server — Fastify + `ws` (WebSockets), `better-sqlite3` (WAL), `node-pty`, `chokidar`. Web — React + Vite + Tailwind, `xterm.js`. Shared — reine Domänen-Logik/State-Machines, keine IO.

**Storage**: SQLite (`~/.sdd-toolkit/sdd-toolkit.sqlite`, WAL). Orchestrierungs-State in Tabellen (`executions`, `settings`, `projects`/`features` mit JSON-Spalten). Spec-Wahrheit bleibt als Dateien im Ziel-Repo. `~/.claude/` wird **strikt read-only** behandelt (nur Transkript-Lesen).

**Testing**: `vitest` (`pnpm test`), `pnpm typecheck`. Bestehendes Muster: pure Logik in `@sdd/shared` unit-getestet (`*.test.ts`), Server-Repos/Services mit In-Memory-DB (`openMemoryDatabase`).

**Target Platform**: Lokale Web-App (macOS/Linux), Server-Bind `127.0.0.1` (bewusst nur lokal).

**Project Type**: Web application (Backend + Frontend) im pnpm-Monorepo (`packages/shared`, `packages/server`, `packages/web`).

**Performance Goals**: Kosten-Aufschlüsselung sichtbar in < 30 s (SC-003) — durch DB-Aggregation trivial erfüllt. Transkript-Parsing inkrementell/offset-basiert (Muster aus `TranscriptWatcher`), kein spürbarer Zusatz-Latenz beim Phasenstart (Kontext-Reset = ein zusätzlicher PTY-Roundtrip).

**Constraints**:
- `~/.claude/` nur lesen, nie schreiben (bestehende Invariante).
- Optimierungen **reversibel** (FR-008) und **default-sicher** (bei Unsicherheit Rückfall auf vollständigen Kontext, FR-010).
- Reduktion darf Qualitäts-Gates (Spec-Checkliste, Clarify, Review-Gate, Verify-Pipeline) nicht umgehen/schwächen (FR-006).
- Reduktion nur für SDD-Phasen-Läufe; Messung für alle Lauf-Arten (FR-011).
- Additive, nullable DB-Migrationen (Muster der bestehenden `MIGRATIONS`).

**Scale/Scope**: Einige Dutzend Features, hunderte Executions pro DB; Transkripte bis wenige MB. Kein Multi-User, keine Skalierungsgrenzen relevant.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein **nicht ausgefülltes Template** (nur Platzhalter, keine ratifizierten Prinzipien) → keine formalen Gates definiert. **Gate-Status: PASS** (keine Verstöße möglich).

Ersatzweise die aus README/Architektur abgeleiteten Projekt-Leitplanken (informativ, werden eingehalten):

| Leitplanke | Einhaltung im Plan |
|-----------|--------------------|
| Reine State-Machines/Logik in `@sdd/shared`, IO-frei + unit-getestet | Transkript-Usage-Parser, Kompressor, Settings-Resolver und Aggregations-Reducer landen als pure Funktionen in `@sdd/shared` mit Tests; Server macht nur IO. |
| SQLite für Orchestrierungs-State, Files = Spec-Wahrheit | Nur additive Spalten in `executions` + `settings`-Keys; keine Spec-Artefakte in die DB. |
| `~/.claude/` read-only | Transkripte werden ausschließlich gelesen (wie `locateTranscript`/`TranscriptWatcher`). |
| Nie Blind-Merge / Qualität vor Automatik | Reduktion greift nur in die Kontext-Übergabe ein, nie in Gates; A/B belegt Qualitätsgleichheit. |

**Complexity Tracking**: keine Verstöße → Abschnitt entfällt.

## Project Structure

### Documentation (this feature)

```text
specs/minimize-token-consumption/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0 (/speckit-plan)
├── data-model.md        # Phase 1 (/speckit-plan)
├── quickstart.md        # Phase 1 (/speckit-plan)
├── contracts/           # Phase 1 (/speckit-plan)
│   ├── cost-breakdown-api.md
│   ├── optimization-settings.md
│   ├── token-usage-parser.md
│   └── context-optimizer.md
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

Bestehende Monorepo-Struktur; neue/berührte Dateien markiert.

```text
packages/
├── shared/src/
│   ├── costMeter.ts            # BERÜHRT: bleibt Fallback; Preis-/Modell-Logik wiederverwendet
│   ├── transcriptUsage.ts      # NEU: pure Usage-Extraktion aus Transkript-JSONL-Zeilen
│   ├── contextCompressor.ts    # NEU: deterministische Verdichtung (pure)
│   ├── costBreakdown.ts        # NEU: pure Aggregation Executions → Phasen-/Art-Rollup
│   ├── optimization.ts         # NEU: OptimizationSettings + resolveOptimization (global→proj→feat)
│   ├── transcript.ts           # BERÜHRT: ggf. Usage-Event-Typ ergänzen
│   ├── types.ts                # BERÜHRT: ExecutionRecord-Felder, Settings-Typen
│   └── *.test.ts               # NEU: Tests für obige pure Module
├── server/src/
│   ├── db/database.ts          # BERÜHRT: additive Migration (executions-Spalten)
│   ├── db/repos.ts             # BERÜHRT: ExecutionRepo.finishWithUsage + aggregateByFeature
│   ├── services/orchestrator.ts# BERÜHRT: Kontext-Reset vor Phase, Transkript-Usage beim Turn-Ende, opt-Settings am Execution
│   ├── services/contextOptimizer.ts # NEU: orchestriert Reset-Strategie + Kompressor (+ optional LLM)
│   ├── pty/transcriptWatcher.ts# BERÜHRT/wiederverwendet: Offset-Lesen für Usage
│   ├── pty/commandBuilder.ts   # BERÜHRT: Reset-Kommandos (/clear, /compact) als Sendbefehle
│   └── api/server.ts           # BERÜHRT: GET /api/features/:id/cost-breakdown; Settings-Routen
└── web/src/components/
    ├── ExecutionsView.tsx      # BERÜHRT: Phasen-Rollup, Quelle-Badge, chat_work-Label-Fix
    └── (Settings-UI)           # BERÜHRT: Optimierungs-Toggles (global/Projekt/Feature)
```

**Structure Decision**: Web-App im bestehenden pnpm-Monorepo. Alle wiederverwendbare, testbare Logik (Usage-Parsing, Verdichtung, Aggregation, Settings-Auflösung) kommt als **pure Funktionen** nach `packages/shared` (Projekt-Muster); `packages/server` liefert IO/Orchestrierung, `packages/web` die Sicht. Keine neuen Top-Level-Verzeichnisse.

## Phase 0 & 1

Siehe `research.md` (Entscheidungen), `data-model.md` (Entitäten/Migration), `contracts/` (API + interne Verträge) und `quickstart.md` (End-to-End-Validierung inkl. A/B-Nachweis).
