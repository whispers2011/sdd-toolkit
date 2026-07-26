# Implementation Plan: Worktree-Übersicht in den Einstellungen

**Branch**: `feature/worktree-uebersicht` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/worktree-uebersicht/spec.md`

## Summary

Eine neue, tool-weite Top-Level-Ansicht **„Worktree-Übersicht"**, erreichbar über den
bestehenden Einstellungs-Eintrag unten links in der Sidebar. Sie zeigt **pro Projekt** den
Haupt-Checkout und alle offenen git-Worktrees mit Feature-Zuordnung, Branch, Pfad,
Bearbeitungsstand und der Liste der gegenüber dem Zielbranch geänderten Dateien
(Änderungsart + committet/uncommittet). Drei Warnlagen werden aktiv erkannt: dieselbe Datei
in mehreren offenen Worktrees (*Überschneidung*), im Worktree geänderte Datei wurde seit dem
Abzweigpunkt auch auf dem Zielbranch verändert (*überholt*), Branch bereits integriert
(*bereinigungsfähig*). Einzelne Worktrees lassen sich direkt aus der Ansicht entfernen —
mit Bestätigung, zusätzlicher expliziter Zweitbestätigung bei uncommitteten Änderungen und
harter Sperre bei laufender Session.

Technischer Kern: ein **serverseitiger Aggregations-Service** (`worktreeOverviewService.ts`),
der `git worktree list --porcelain` je Projekt mit der Feature-Tabelle abgleicht (Zuordnung
über **realpath**, Fallback Branch), pro Worktree die Dateiänderungen gegen
`merge-base(target, HEAD)` erhebt und die Warnungen berechnet. Die reinen Parser
(`--name-status -z`, `status --porcelain -z`) und die Überschneidungs-Erkennung liegen als
**pure, getestete Module in `packages/shared`**. Zwei neue Endpunkte
(`GET /api/worktrees`, `POST /api/worktrees/remove`) in einer eigenen Routendatei; die Web-Seite
ist eine neue View `{ kind: 'worktrees' }` mit 5-Sekunden-Polling plus Refetch auf
Feature-WS-Events. **Keine neuen Dependencies, keine DB-Migration, kein neues WS-Event.**

## Technical Context

**Language/Version**: TypeScript 5.8, Node ≥ 22 (ESM), pnpm-10-Workspace

**Primary Dependencies**: Fastify 5 (API), React 19 + Tailwind 4 (Web), better-sqlite3 12
(nur lesend genutzt), `git`-CLI über den bestehenden `git()`-Wrapper. Bewusst **keine neuen
Runtime-Dependencies**.

**Storage**: Keine neuen Tabellen, keine Migration. Die Übersicht ist eine **abgeleitete Sicht**
aus Git-Realität (`git worktree list`, Diffs) + bestehender `features`-Tabelle. Einziger
Schreibzugriff auf die DB: `FeatureRepo.setWorktree(id, null)` nach erfolgreichem Entfernen.

**Testing**: vitest 3 (`pnpm -r test`), Typprüfung `pnpm -r typecheck`. Server-Tests gegen
echte temporäre Git-Repos nach dem Muster von `git/worktreesCreate.test.ts` /
`services/mergeQueueService.test.ts`.

**Target Platform**: lokaler Entwickler-Server (macOS/Linux), Web-UI im Browser

**Project Type**: pnpm-Monorepo — `packages/shared` (pure Typen/Funktionen),
`packages/server` (API + Services + git), `packages/web` (React-SPA)

**Performance Goals**: Übersicht nach dem Öffnen < 2 s vollständig nutzbar bei 10 Projekten /
30 Worktrees (SC-003) → Erhebung parallelisiert mit Nebenläufigkeitslimit 6, ~7 git-Aufrufe
je Worktree, Server-seitiger TTL-Cache (2 s) + In-Flight-Dedupe gegen Polling-Stampede.
Neuer/entfernter Worktree sichtbar ≤ 5 s (SC-004) → Polling-Intervall 5 s.

**Constraints**:
- **Kein Schreiben in Arbeitskopien** außer der einen Aktion `git worktree remove`.
  Kein `branch -D`, kein `worktree prune` als Nutzeraktion, kein `worktree repair`.
- **Entfernen nur für vom Server selbst gelesene, existierende Worktree-Pfade** des
  angegebenen Projekts (kein vom Client frei wählbarer Pfad → kein Löschen beliebiger Ordner).
- Haupt-Checkout wird nie angefasst (kein Branch-Wechsel, keine Entfernen-Aktion).
- Nie `execSync` (Event-Loop) — ausschließlich der asynchrone `git()`-Wrapper.
- Deutsche UI, dunkles Layout; **Symbole als SVG-Icons** aus `components/icons.tsx`
  (Konvention aus `specs/emojis-im-projekt-immer-als-svg-icon-hinterlegen`).
- Ein defektes/unerreichbares Projekt darf die übrigen Projektblöcke nicht verhindern.

**Scale/Scope**: Einzelnutzer/Kleinteam; wenige Projekte mit je einer überschaubaren Zahl
gleichzeitig offener Worktrees. Keine Paginierung; Dateilisten im Transport auf 300 Einträge
je Worktree gekürzt (Gesamtzahl wird trotzdem ausgewiesen).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein **unausgefülltes Template** — es existiert keine
ratifizierte Projekt-Constitution. Ersatzweise gelten die etablierten Repo-Konventionen als
Gates; alle erfüllt:

- ✅ **Pure Logik in `shared`, mit vitest getestet**: Porcelain-/Name-Status-Parser,
  Zusammenführung committet/uncommittet, Überschneidungs-Erkennung und der
  Fortschritts-Label-Helfer sind pure Funktionen mit Tests — keine Git-Aufrufe darin.
- ✅ **Keine neuen Runtime-Dependencies**: bestätigt (0 neue Deps).
- ✅ **Bestehende Muster wiederverwenden**: Routendatei nach `reviewRoutes.ts`-Muster,
  View/Refetch nach `ReviewOverview.tsx` + `ExecutionsView.tsx`, Bestätigung über den
  vorhandenen `ConfirmDialog`, Worktree-Entfernen über den bestehenden `WorktreeManager`.
- ✅ **Read-only-Prinzip gewahrt**: genau eine verändernde Aktion, mit doppeltem Schutz
  (Session-Sperre, Zweitbestätigung bei uncommitteten Änderungen).
- ✅ **Keine Migration, kein Umbau bestehender Verträge**: `worktrees.ts`, `orchestrator.ts`,
  `mergeQueueService.ts` und `phaseMachine.ts` bleiben inhaltlich unangetastet
  (einzige Ausnahme: `WorktreeManager.list()` delegiert an den neuen, reicheren Parser —
  Rückgabetyp unverändert).
- ✅ **Deutsche UI + SVG-Icons statt Emojis**: eingehalten.

**Post-Design-Re-Check (nach Phase 1)**: unverändert bestanden. Das Design führt keine neuen
Projekte, Frameworks oder Persistenzschichten ein. Complexity Tracking bleibt leer.

## Project Structure

### Documentation (this feature)

```text
specs/worktree-uebersicht/
├── plan.md              # Diese Datei
├── research.md          # Phase 0: Leitentscheidungen mit Begründung
├── data-model.md        # Phase 1: Entitäten, Typen, Ableitungsregeln, Zustände
├── quickstart.md        # Phase 1: End-to-End-Validierungsszenarien
├── contracts/
│   ├── http-api.md      # GET /api/worktrees, POST /api/worktrees/remove
│   └── ui-contract.md   # Einstiegspunkt, View-Vertrag, Zustände, Aktionen
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── types.ts                       # + WorktreeOverview, WorktreeProjectGroup, WorktreeEntry,
│                                  #   MainCheckoutInfo, WorktreeFileChange, WorktreeWarning,
│                                  #   WorktreeEntryKind/DirState, FileChangeKind/State
├── worktreeStatus.ts (NEU)        # pure Parser + Zusammenführung + Überschneidungs-Erkennung
├── worktreeStatus.test.ts (NEU)
├── workflowModel.ts               # + featureProgressLabel(feature) (FR-007)
├── workflowModel.test.ts          # + Tests dafür
└── index.ts                       # Re-Export des neuen Moduls

packages/server/src/
├── git/worktreeInventory.ts (NEU) # `git worktree list --porcelain` vollständig parsen
│                                  #   (path, branch, HEAD, detached, bare, locked, prunable)
├── git/worktreeInventory.test.ts (NEU)
├── git/worktrees.ts               # list() delegiert an worktreeInventory (Typ unverändert)
├── services/worktreeChanges.ts (NEU)      # git-Aufrufe je Worktree → WorktreeFileChange[]
├── services/worktreeChanges.test.ts (NEU) # gegen echtes Temp-Repo
├── services/worktreeOverviewService.ts (NEU)      # Aggregation, Klassifikation, Warnungen,
│                                                  #   TTL-Cache, removeWorktree() + Guards
├── services/worktreeOverviewService.test.ts (NEU)
├── api/worktreeRoutes.ts (NEU)    # GET /api/worktrees, POST /api/worktrees/remove
├── api/server.ts                  # registerWorktreeRoutes(app, …) einhängen (+ ApiDeps-Feld)
└── index.ts                       # WorktreeOverviewService instanziieren und verdrahten

packages/web/src/
├── api.ts                         # + worktrees(), removeWorktree() (+ typisierte 409-Fälle)
├── store.tsx                      # + View { kind: 'worktrees' }
├── App.tsx                        # Rendering der neuen View
├── components/Sidebar.tsx         # ToolSettings: Eintrag „Worktree-Übersicht"
├── components/icons.tsx           # + WorktreeIcon (SVG, Design-konform)
└── components/WorktreeOverview.tsx (NEU)  # Projektblöcke, Einträge, Dateilisten, Warnungen,
                                           #   Entfernen-Fluss, Lade-/Leer-/Fehlerzustände
```

**Structure Decision**: Das bestehende 3-Paket-Monorepo bleibt unverändert. Neue Logik folgt der
etablierten Schichtung (pure `shared`-Module → `server`-Services/Git-Leser → Web-Komponente).
Eigene Routendatei `worktreeRoutes.ts`, weil `server.ts` bereits ~1350 Zeilen hat — analog zu
`reviewRoutes.ts`.

## Umsetzungsreihenfolge (empfohlen, Story-Prioritäten folgend)

1. **Shared-Fundament** (Basis für alles): Typen in `types.ts`; `worktreeStatus.ts` mit
   `parseNameStatusZ`, `parsePorcelainStatusZ`, `mergeFileChanges`, `detectOverlaps`;
   `featureProgressLabel` in `workflowModel.ts`; vitest-Tests für alle Fälle inkl. Rename,
   Delete, Untracked, Pfade mit Leerzeichen/Umlauten.
2. **Git-Leser**: `worktreeInventory.ts` (Porcelain-Parser inkl. `prunable`/`detached`/`locked`),
   `WorktreeManager.list()` darauf umstellen (Rückgabetyp identisch, bestehende Tests grün).
3. **Änderungserhebung**: `worktreeChanges.ts` — `collectWorktreeChanges(cwd, target)` und
   `changedOnTargetSince(projectPath, base, target)`; Tests gegen ein echtes Temp-Repo.
4. **Aggregation (US1 + US2)**: `worktreeOverviewService.buildOverview()` — Projektblöcke,
   Haupt-Checkout, Zuordnung Worktree↔Feature über realpath (Fallback Branch), Klassifikation
   `feature`/`chat`/`orphan`, `dirState`, Session-Erkennung, TTL-Cache + In-Flight-Dedupe.
5. **Warnungen (US3)**: `already_merged` (isBranchMergedInto), `behind_target`
   (Schnittmenge geänderter Dateien mit `base..target`), `overlap` (pure `detectOverlaps`
   über alle Einträge eines Projekts) — inkl. der Fehlalarm-Regeln aus research.md.
6. **API**: `worktreeRoutes.ts` mit `GET /api/worktrees` (+`?refresh=1`) und
   `POST /api/worktrees/remove` inkl. aller Guards; Einhängen in `server.ts`, Wiring in
   `index.ts`; Tests für die Guard-Pfade (Haupt-Checkout, unbekannter Pfad, Session,
   uncommittet ohne/mit `force`).
7. **Web (US1/US2/US3)**: `api.ts`, `store.tsx`, `App.tsx`, `Sidebar.tsx`-Einstieg,
   `WorktreeIcon`, `WorktreeOverview.tsx` mit Projektgruppen, aufklappbaren Dateilisten,
   Warn-Badges, Lade-/Leer-/Fehlerzuständen, „↻ Aktualisieren" und Sprung zum Feature.
8. **Entfernen (US4)**: Zweistufiger Bestätigungsfluss über den vorhandenen `ConfirmDialog`,
   Fehlerdarstellung bei 409/500, Refetch nach Erfolg.
9. **Selbstaktualisierung (US5)**: 5-s-Polling (nur bei sichtbarer View), Refetch auf
   Feature-WS-Signal (`features`-Signaturschlüssel wie in `ReviewOverview`), „Stand HH:MM:SS".
10. **Verifikation**: `pnpm -r typecheck && pnpm -r test` grün; manuelle Flows gemäß
    [quickstart.md](./quickstart.md).

## Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Pfad-Mismatch Feature↔Worktree (macOS `/var`→`/private/var`, Symlinks) | Zuordnung über `realpathSync` beider Seiten, Fallback über Branch-Gleichheit; Testfall mit `mkdtemp` (liegt real unter `/private/var`) |
| Polling erzeugt git-Last (≈7 Aufrufe × Worktrees alle 5 s) | TTL-Cache 2 s + In-Flight-Dedupe; Nebenläufigkeitslimit 6; Polling nur bei sichtbarer View |
| Große Dateilisten sprengen Payload/UI | Transport auf 300 Dateien je Worktree gekürzt (`filesTruncated`, Gesamtzahl separat); UI-Liste scrollbar (`max-h`) |
| Fehlalarm „Überschneidung" durch Umbenennungen | Rename-Erkennung mit `-M`; Schlüssel ist der **neue** Pfad, `oldPath` nur informativ; reine Löschungen zählen mit, werden aber als `deleted` ausgewiesen |
| Fehlalarm „veraltet" bei Squash-Merges | `already_merged` prüft zusätzlich `isBranchMergedInto`; ein bereits integrierter Worktree bekommt keinen zusätzlichen `behind_target`-Alarm (Regel in research.md) |
| Versehentliches Löschen fremder Ordner über die API | Pfad muss aus der **serverseitig frisch gelesenen** Worktree-Liste des Projekts stammen; Haupt-Checkout hart ausgeschlossen |
| Datenverlust beim Entfernen | Zweistufig: 409 `uncommitted` mit Anzahl → erst mit `force: true` wird `--force` genutzt; Session-Sperre davor |
| Chat-Worktrees (`chat-<id>`) wirken „verwaist" | Eigene Kategorie `chat` mit Label „Wissens-Chat" statt Fehlalarm |
| Unerreichbares Projekt kippt die ganze Ansicht | Erhebung je Projekt gekapselt (`try`), Block trägt `error`, übrige Projekte bleiben nutzbar |
| Anzeige suggeriert Aktualität während des Ladens | `collectedAt` + eigener Ladezustand; beim Nachladen bleibt die alte Liste sichtbar, wird aber als „wird aktualisiert" gekennzeichnet |

## Complexity Tracking

> Keine Constitution-Verstöße — Tabelle leer.
