# Implementation Plan: Geschätzte Kosten aus den Läufen entfernen

**Branch**: `feature/kosten-aus-laeufe-entfernen` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/kosten-aus-laeufe-entfernen/spec.md`

## Summary

Geschätzte Geldbeträge verschwinden vollständig aus dem Toolkit: aus allen Ansichten, die Läufe
darstellen (9 Anzeigestellen in 5 React-Komponenten), aus den ausgelieferten Lauf- und
Ausführungsdaten (`RunSummary`, `ExecutionRecord`, `CostRollup`, `AgentRunSummary`) und aus dem
Mechanismus, der sie erzeugt (Preistabelle, Cache-Faktoren, Kostenrechnung in `costMeter.ts` /
`transcriptUsage.ts`, `total_cost_usd`-Parsing).

Technischer Ansatz: `costUsd` ist ein Feld, das durch alle drei Pakete durchgereicht wird
(SQLite → Repo → Shared-Typ → API-Payload → UI). Weil der Typ in `@sdd/shared` liegt und `web`
gegen denselben Typ kompiliert, wird in der Reihenfolge **UI → Server-Schreibpfad → Shared-Typen**
gearbeitet: erst verschwinden die Lesestellen (jeder Schritt bleibt kompilierbar), zuletzt das
Feld selbst. Die bestehenden DB-Spalten `executions.cost_usd` und `chat_messages.cost_usd`
bleiben inert stehen — die Spec verzichtet ausdrücklich auf Migration bereits erfasster Werte,
und ein `DROP COLUMN` wäre auf der Live-Datenbank irreversibel.

Tokens, Herkunfts-Badges („gemessen"/„geparst"/„geschätzt"), Dauer, Status, Logs und die
Kategorisierung Spezifikation/Coding/Overhead/Chat bleiben unangetastet.

## Technical Context

**Language/Version**: TypeScript 5 (ESM, `"type": "module"`), Node ≥ 22

**Primary Dependencies**: Fastify (HTTP-API), better-sqlite3 ^12 (Persistenz), React 19 + Vite +
Tailwind (Web-UI), Vitest (Tests), pnpm 10 Workspaces

**Storage**: SQLite (`sdd-toolkit.sqlite`), Schema als append-only `MIGRATIONS`-Array in
`packages/server/src/db/database.ts`, versioniert über `PRAGMA user_version`

**Testing**: Vitest in `@sdd/shared` und `@sdd/server` (`pnpm test`); `@sdd/web` hat bewusst
keine Test-Suite (`test` = `echo 'keine Web-Tests (MVP)'`) → UI-Nachweis erfolgt manuell nach
[quickstart.md](./quickstart.md)

**Target Platform**: lokal betriebenes Entwickler-Werkzeug (Node-Server + Browser-SPA)

**Project Type**: pnpm-Monorepo mit drei Paketen (`shared` = reine Domänenlogik, `server` =
API/Orchestrierung, `web` = SPA)

**Performance Goals**: N/A — reine Entfernung, keine neuen Rechenpfade. Die Aggregation über alle
Executions (`buildRunSummaries`) wird durch die entfallenden Summanden marginal günstiger.

**Constraints**:

- Kein ausgelieferter API-Payload darf ein `costUsd`-Feld tragen (FR-009).
- Kein Nutzer-sichtbarer Bereich darf einen Geldbetrag zeigen (FR-008).
- Bestehende Datenbanken müssen ohne neue Migration weiter geöffnet und gelesen werden (FR-011).
- Token- und Herkunftsangaben bleiben bitgenau erhalten (FR-010) — die Token-Summen dürfen sich
  durch die Änderung nicht verschieben.
- `pnpm typecheck` und `pnpm test` müssen grün sein; `tsc` ist hier das eigentliche Sicherheitsnetz,
  weil das Entfernen eines Typfelds jede vergessene Lesestelle zum Compile-Fehler macht.

**Scale/Scope**: 98 Referenzen auf Kosten-Symbole in 28 Dateien (Stand Branch-Basis `3dfedfc`),
davon 9 Anzeigestellen in 5 Komponenten, 7 Schreibstellen im Server, 4 Shared-Module, 6 Testdateien.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist unverändert das ausgelieferte Template — alle Prinzipien
stehen als Platzhalter (`[PRINCIPLE_1_NAME]`, `[SECTION_2_CONTENT]`, …). Es existieren damit
**keine ratifizierten Gates**, die dieses Feature verletzen oder erfüllen könnte.

| Gate | Status | Begründung |
|------|--------|------------|
| Ratifizierte Prinzipien | ⚪ nicht vorhanden | Constitution ist Template; `/speckit-constitution` wurde für dieses Projekt nicht ausgeführt |
| Komplexitätsrechtfertigung | ✅ trivial erfüllt | Das Feature entfernt ausschließlich Code, Felder und Anzeigen; es führt keine Abstraktion, kein Modul und keine Abhängigkeit ein |

**Post-Design Re-Check (nach Phase 1)**: unverändert. Die Design-Artefakte fügen keine Struktur
hinzu — `data-model.md` beschreibt ausschließlich entfallende Felder, `contracts/` ausschließlich
schrumpfende Payloads. Keine Einträge in Complexity Tracking nötig.

## Project Structure

### Documentation (this feature)

```text
specs/kosten-aus-laeufe-entfernen/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0: Entscheidungen (Tiefe, DB, Preistabelle, Reihenfolge)
├── data-model.md        # Phase 1: Felder vorher/nachher je Entität
├── quickstart.md        # Phase 1: Verifikationsszenarien zu US1–US3
├── contracts/
│   └── api-changes.md   # Phase 1: betroffene HTTP-Endpoints und Payload-Diffs
├── checklists/
│   └── requirements.md  # bereits vorhanden (/speckit-specify)
├── spec.md              # bereits vorhanden
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/                  # reine Domänenlogik, keine IO
├── types.ts                          # ExecutionRecord.costUsd, ChatMessage.costUsd,
│                                     #   AgentRunSummary.costUsd  → entfernen
├── costMeter.ts                      # CostMetadata.costUsd, ParsedUsage.costUsd, MODEL_PRICES,
│                                     #   ModelPrice, DEFAULT_PRICE, priceFor, normalizeModel,
│                                     #   CACHE_*_FACTOR, Kosten-Regex → entfernen
├── transcriptUsage.ts                # usageToCost → usageTotalTokens (nur Tokens)
├── costBreakdown.ts                  # CostRollup.costUsd, add() → entfernen
├── runSummary.ts                     # emptyRollup/add: costUsd → entfernen
├── chatStream.ts                     # result-Event: costUsd → entfernen
└── *.test.ts                         # costMeter/transcriptUsage/costBreakdown/
                                      #   runSummary/chatStream: Assertions anpassen

packages/server/src/
├── db/database.ts                    # cost_usd-Spalten bleiben (keine neue Migration)
├── db/repos.ts                       # finish()/finishWithUsage()/UPDATE-Statements,
│                                     #   Row-Mapper, ChatRepo-Outcome → costUsd entfernen
├── db/chatRepo.test.ts               # costUsd-Assertions anpassen
├── api/server.ts                     # Agent-lastRun-Anreicherung (Z. 866)
├── api/reviewRoutes.ts               # attachCosts() → nur noch totalTokens
└── services/
    ├── orchestrator.ts               # meterTurn(): costUsd aus beiden Zweigen entfernen
    ├── chatService.ts                # Result-/Fallback-Kosten entfernen
    ├── chatWorkService.ts            # finish()-Aufruf
    ├── agentGateService.ts           # finish()-Aufruf
    ├── conflictResolver.ts           # Rückgabetyp ohne costUsd
    └── mergeQueueService.ts          # finish()-Aufruf

packages/web/src/
├── api.ts                            # ExecutionInfo.costUsd → entfernen
└── components/
    ├── ExecutionsView.tsx            # 4 Stellen: Summenzeile, Lauf-Zeile, HBar-`sub`,
    │                                 #   Tabellenspalte „Kosten" (Header + Zelle)
    ├── charts.tsx                     # HBarChart: `sub`-Prop + leerer w-16-Span entfallen
    ├── ReviewPortal.tsx              # totalCost-Memo + HeaderStat „Kosten"
    ├── FeatureAgentSelect.tsx        # lastRun-Kostensuffix
    └── review/
        ├── AuditSidebar.tsx          # Kostensuffix pro Audit-Lauf
        └── TestsPane.tsx             # StatCard „Kosten" + Kostensuffix pro Lauf

README.md                             # Beschreibung „Kosten-Aufschlüsselung" / „Kosten-Audit"
```

**Structure Decision**: Bestehendes Monorepo, keine neuen Dateien und keine Umbenennungen von
Modulen oder Routen (siehe [research.md](./research.md), D5). Die Änderung folgt der bestehenden
Schichtung `shared` → `server` → `web`; `shared` bleibt IO-frei, sodass die entfallende
Kostenrechnung dort mit Unit-Tests abgesichert bleibt.

## Umsetzungs-Ansatz (Schnitt & Reihenfolge)

Der Slice-Schnitt der Spec (US1 Läufe-Ansicht, US2 übrige Ansichten, US3 Daten) ist die
Prüf-Reihenfolge, nicht zwingend die Commit-Reihenfolge — `costUsd` liegt in einem gemeinsamen
Typ, daher zerbricht das Entfernen des Felds alle Lesestellen gleichzeitig. Reihenfolge, die
jeden Zwischenstand kompilierbar hält:

1. **US1 + US2 (Anzeige)**: Alle 9 Anzeigestellen in `web` entfernen, inklusive der Elemente,
   die dadurch leer würden (Tabellenspalte „Kosten", StatCards, `HBarChart.sub`) — FR-012.
   Danach liest kein UI-Code mehr `costUsd`; `pnpm --filter @sdd/web typecheck` ist grün.
2. **US3a (Schreibpfad)**: Server hört auf, Kosten zu berechnen und zu persistieren —
   `finish()`/`finishWithUsage()`, `meterTurn()`, `conflictResolver`, Chat-Pfade.
3. **US3b (Typen & Mechanismus)**: `costUsd` aus `types.ts`, `costBreakdown.ts`, `runSummary.ts`,
   `chatStream.ts` entfernen; Preistabelle, Cache-Faktoren und Kosten-Regex aus `costMeter.ts`
   löschen; `usageToCost` → `usageTotalTokens`. Ab hier erzwingt `tsc` projektweit, dass keine
   vergessene Lesestelle existiert.
4. **Tests & Doku**: 6 Testdateien anpassen, Regressionstests für „Payload ohne `costUsd`"
   ergänzen (US3 Independent Test), README-Formulierungen bereinigen.

`docs/*.md` sind historische Inventar-/Planungsdokumente (Stand vor der Umsetzung) und werden
nicht rückdatiert; nur `README.md` beschreibt das laufende System.

## Complexity Tracking

> Keine Constitution-Verletzungen — Tabelle entfällt.
