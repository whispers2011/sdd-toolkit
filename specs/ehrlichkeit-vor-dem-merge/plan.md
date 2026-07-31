# Implementation Plan: Ehrlichkeit vor dem Merge

**Branch**: `feature/ehrlichkeit-vor-dem-merge` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/ehrlichkeit-vor-dem-merge/spec.md`

## Summary

Drei Anzeigen fehlen an der Entscheidungsstelle; alle Werte liegen bereits vor. Der Plan reicht sie
durch und macht die Lücken benennbar:

1. **Verifikationslücke als Zustand** (Story 1): eine neue, persistierte Integrationsstufe
   `verification_unconfigured`, die ein Feature eines Projekts ohne `verifyCommands` anstelle von
   `verifying` durchläuft, plus eine projektbezogene Aufmerksamkeits-Art gleichen Namens. Beide
   Namen liegen in bereits `Record<…>`-getypten Katalogen (`INTEGRATION_STAGE_META`,
   `STAGE_CLASS`, `INTEGRATION_STAGE_ORIGIN`, `KIND_META`) — der Typecheck erzwingt in jeder
   Oberfläche eine eigene Beschriftung (FR-001a).
2. **Aufgabenstand in den Meldungen und im Portal** (Story 2): ein neues pures Shared-Modul
   `integrationMessages.ts` baut die `review_due`-Meldung und den Text der Merge-Meldung; das
   Review-Portal zeigt den Stand als Kopfzeilen-Kennzahl.
3. **Bezugsgrösse in der Läufe-Ansicht** (Story 3): `RunSummary` erhält `tasksDone`/`tasksTotal`
   (Durchreichung vom Feature), `costPerTask()` leitet die Kosten pro erledigter Aufgabe rein
   daraus ab — ein Strich, wo sie nicht bestimmbar ist.

Kein neuer Messpfad, keine neue Sperre, keine DB-Migration. Der einzige neue persistierte Zustand
ist die Integrationsstufe (von FR-001a ausdrücklich verlangt) plus die Aufmerksamkeits-Zeile.

## Technical Context

**Language/Version**: TypeScript 5.8, ESM, Node ≥ 22

**Primary Dependencies**: Fastify 5 (HTTP/WS), better-sqlite3 12 (SQLite), React 19 + Vite 6 +
Tailwind 4 (Web), vitest 3 (Tests). pnpm-Workspace mit `@sdd/shared`, `@sdd/server`, `@sdd/web`,
`@sdd/desktop`.

**Storage**: SQLite (`packages/server/src/db/database.ts`). **Keine Migration nötig**:
`features.integration` und `attention.kind` sind `TEXT`-Spalten ohne `CHECK`-Constraint, neue
Werte sind sofort speicherbar (geprüft am Schema-Kopf und an allen Migrationsschritten).

**Testing**: `pnpm test` (vitest run pro Paket), `pnpm typecheck` (`tsc --noEmit`). Neue Logik
liegt in puren Modulen (`packages/shared/src/*.ts`) bzw. hinter Repos, die in Tests über
`openMemoryDatabase()` real laufen — bestehendes Muster aus `mergeQueueService.attention.test.ts`.

**Target Platform**: lokales Entwicklungswerkzeug (macOS/Linux); Server-Prozess + Browser-Oberfläche
(zusätzlich als Electron-Hülle).

**Project Type**: Monorepo aus geteilter Domäne (`shared`), Backend (`server`) und
Single-Page-Oberfläche (`web`).

**Performance Goals**: unverändert. `buildRunSummaries` bleibt eine Aggregation in O(Executions);
die beiden neuen Felder sind Kopien vom Feature, `costPerTask()` ist eine Division. Keine
zusätzlichen Git-Aufrufe, kein zusätzlicher Dateizugriff, keine neue HTTP-Route.

**Constraints**:
- FR-022 / SC-008: keine neue Erhebung, kein zusätzlicher Mess- oder Zählpfad — jede neue Anzeige
  ist Durchreichung oder Division bereits erhobener Werte.
- FR-010 / FR-016 / SC-005: nichts wird gesperrt, verzögert oder eskaliert. Die bestehende
  Mindesthürde (`hasAnyTaskDone`) bleibt Wort für Wort die einzige Sperre.
- FR-011: für Projekte MIT `verifyCommands` bleiben Stufe, Meldungswortlaut und
  Aufmerksamkeits-Einträge in ihren Verifikations-Aussagen unverändert; einzige Ergänzung ist der
  Aufgabenstand.
- Keine rohen Bezeichner in der Oberfläche: Stufennamen kommen ausschließlich aus
  `INTEGRATION_STAGE_META` (heute leckt `ExecutionsView.IntegrationBadge` den Rohwert).

**Scale/Scope**: 3 User Stories; ~9 Quelldateien (3 shared, 3 server, 3–4 web) und ~6 Testdateien.
Kein neues Paket, kein neues Datenbankschema, eine neue Datei in `shared`, eine in `server`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist die unveränderte Vorlage: alle Prinzipien stehen als
Platzhalter (`[PRINCIPLE_1_NAME]` …), es gibt keine ratifizierte Fassung und damit keine
ableitbaren Gates. Ersatzweise wurden die im Repository belegten Konventionen geprüft — sie sind
in den betroffenen Dateien dokumentiert und für dieses Feature einschlägig:

| Konvention (Quelle) | Prüfung | Befund |
|---|---|---|
| Domänen-getypte Kataloge als Drift-Guard (`workflowModel.ts` Kopfkommentar) | Neue Stufe/Art nur über `Record<Union, …>`-Kataloge einführen; keine losen `Record<string, …>`-Beschriftungen mehr für Stufen | PASS — `STAGE_LABEL` in `ReviewOverview.tsx` und der Rohwert-Fallback in `ExecutionsView.tsx` werden auf den geteilten Katalog gezogen |
| Pure Module ohne IO in `shared` (`runSummary.ts`, `actionPolicy.ts`) | Textbau und Kosten-pro-Aufgabe als pure Funktionen, in Isolation testbar | PASS — `integrationMessages.ts`, `costPerTask()` |
| Nie schätzen, Strich statt Ersatzwert (`costBreakdown.ts` FR-024-Kommentar) | Kosten pro Aufgabe bei 0 erledigten Aufgaben bzw. ohne gemeldeten Betrag | PASS — `null` ⇒ Strich, Unvollständigkeit gekennzeichnet |
| Deutsche Oberflächentexte, „Verifikation" bleibt der Begriff | Alle neuen Texte | PASS |
| Eine Festlegung je Entscheidung (`actionPolicy.ts` Kopfkommentar) | Keine zweite Bedingung in einer Oberfläche; Stufenklasse zentral | PASS — `STAGE_CLASS` erhält den Eintrag, die Oberflächen fragen nur ab |
| Prozessregel `CLAUDE.md` (keine generischen `pkill`) | Verifikation/Testlauf dieses Features | PASS — nur `pnpm test`/`pnpm typecheck`, kein Prozess-Abschuss nötig |

**Post-Design Re-Check (nach Phase 1)**: PASS — das Design fügt keinen zweiten Wahrheitsort hinzu:
die Stufe lebt in `IntegrationStage`, die Aufmerksamkeits-Lebensdauer allein in der
`attention`-Tabelle (kein Parallel-Flag), die Texte in genau einem Shared-Modul.

## Project Structure

### Documentation (this feature)

```text
specs/ehrlichkeit-vor-dem-merge/
├── plan.md              # Diese Datei
├── research.md          # Phase 0: Entscheidungen + Alternativen
├── data-model.md        # Phase 1: Entitäten, Zustände, Lebensdauern
├── quickstart.md        # Phase 1: nachvollziehbare Abnahme-Szenarien
├── contracts/
│   ├── domain.md        # Shared-Typen + pure Funktionen (Vertrag der Domäne)
│   └── http.md          # Betroffene HTTP-Antworten und WS-Ereignisse
├── checklists/          # bereits vorhanden
├── spec.md              # Eingabe
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT hier erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── types.ts                     # IntegrationStage + AttentionKind erweitern (Story 1)
├── workflowModel.ts             # INTEGRATION_STAGE_META: Label/Ton der neuen Stufe (Story 1)
├── actionPolicy.ts              # STAGE_CLASS: neue Stufe = 'active' (Story 1)
├── lifecycleCatalog.ts          # INTEGRATION_STAGE_ORIGIN + Schritt-Prosa (Story 1)
├── integrationMessages.ts       # NEU: Aufgabenstand-Text, review_due- und Merge-Meldung (Story 2)
├── runSummary.ts                # tasksDone/tasksTotal + costPerTask() (Story 3)
└── index.ts                     # Export des neuen Moduls

packages/server/src/
├── services/mergeQueueService.ts   # Stufenwahl, Meldungstexte, Merge-Meldung (Story 1+2)
├── services/verificationGap.ts     # NEU: Erzeugen/Auflösen des Projekt-Eintrags (Story 1)
├── services/attentionReconciler.ts # neue Art explizit behandeln (nicht stage-gekoppelt)
├── services/orchestrator.ts        # Auflösen im bestehenden Reconcile-Durchlauf (FR-007)
└── api/reviewRoutes.ts             # verify.status 'unconfigured' (FR-009)

packages/web/src/components/
├── ReviewOverview.tsx           # Verifikations-Anzeige + Aufgabenstand je Zeile (FR-009/FR-012)
├── ReviewPortal.tsx             # Kopf-Kennzahl Aufgaben, Verify-Zustand (FR-014/FR-015)
├── review/TestsPane.tsx         # Lücke benennen statt leerer Ansicht (FR-008)
├── ExecutionsView.tsx           # Läufe-Liste + Lauf-Dashboard: Aufgaben, Kosten/Aufgabe (Story 3)
└── AttentionInbox.tsx           # Beschriftung der neuen Aufmerksamkeits-Art

Tests (neben der jeweiligen Quelle, bestehendes Muster):
packages/shared/src/integrationMessages.test.ts   # NEU
packages/shared/src/runSummary.test.ts            # erweitert
packages/shared/src/workflowModel.test.ts         # erweitert (Exhaustiveness)
packages/server/src/services/verificationGap.test.ts        # NEU
packages/server/src/services/mergeQueueService.attention.test.ts  # erweitert
packages/server/src/services/attentionReconciler.test.ts    # erweitert
```

**Structure Decision**: Bestehendes Monorepo, keine neue Struktur. Die Domäne (Stufen, Arten,
Texte, Kennzahlen) wächst in `packages/shared/src` — dort liegen sie schon heute und werden von
Server und Web gemeinsam gelesen; damit gibt es je Text und je Beschriftung genau eine Quelle.
Server-seitig kommt ein Dienst dazu (`verificationGap.ts`), weil die Lebensdauer des
Projekt-Eintrags Repo-Zugriff braucht und `mergeQueueService.ts` mit ~820 Zeilen bereits an der
Grenze ist. Web-seitig wird nur in vorhandene Komponenten ergänzt.

## Complexity Tracking

> Keine Verstöße gegen ableitbare Prinzipien (siehe Constitution Check). Zwei bewusst
> hinzugefügte Zustände sind spezifikationsgetrieben und hier begründet, damit sie im Review
> nicht als beiläufige Komplexität gelesen werden.

| Entscheidung | Warum nötig | Einfachere Alternative verworfen, weil |
|---|---|---|
| Neue persistierte Integrationsstufe `verification_unconfigured` | FR-001a und Clarification vom 30.07.: der Zustand muss im Rückblick (nach dem Merge, in der Historie) erkennbar bleiben | Ableitung beim Anzeigen aus `project.verifyCommands` wäre kürzer, verliert aber die Historie: wird die Konfiguration später nachgeholt, sähen alte, ungeprüfte Features rückwirkend wie geprüfte aus |
| Projektbezogene Aufmerksamkeits-Art mit eigener Lebensdauer (nicht stage-gekoppelt) | FR-005/FR-006/FR-007: einmal je Projekt, unabhängig vom Stand einzelner Features, automatisch aufgelöst bei Konfiguration | Ein feature-gebundener Eintrag (heutiges Muster über `STAGE_FOR_KIND`) würde bei jedem Feature erneut entstehen und mit jedem Stufenwechsel verschwinden — genau die Dauerlast, die die Clarification ausschließt |
