# Implementation Plan: Plausibilitätsprüfung gemessener Läufe

**Branch**: `feature/plausibilitaetspruefung` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/plausibilitaetspruefung/spec.md`

## Summary

Vier Plausibilitätsregeln über **bereits gespeicherte** Daten, gemeldet über die **bestehende**
Exception-Inbox. Neu entstehen: ein pures Modul `packages/shared/src/plausibility.ts` (Schwellen,
Prädikate, Melde-Entscheidung, Meldungstexte), ein `PlausibilityRepo` (Aggregat für Befund C +
Quittierungstabelle), ein `PlausibilityService` (die Verdrahtung) und **eine** kleine Tabelle
`plausibility_state`. Alles andere sind additive Erweiterungen: vier Werte in `AttentionKind`,
vier Einträge in `KIND_META`, vier `case`-Zweige im Attention-Reconciler, strukturierte
Ablehnungsdaten in `TelemetryUpdateOutcome`.

Zwei Entscheidungen tragen den Entwurf:

1. **Ein einziger Prüfpfad.** Laufabschluss (FR-001) und Bestandsprüfung (FR-002) rufen dieselbe
   Funktion `PlausibilityService.check(now)`. Damit ist „zehn Prüfungen ⇒ nicht mehr Meldungen als
   eine" (SC-004) eine strukturelle Eigenschaft und keine Regel, die zwei Pfade unabhängig
   voneinander einhalten müssten. Aufhängepunkt für FR-001 ist das **letzte Nachtrags-Timeout** in
   `Orchestrator.scheduleLateReconcile()` — dort steht der Lauf genau im Moment, in dem seine
   Messung endgültig wird.
2. **Quittierung als persistenter Wasserstand.** `AttentionRepo.raise()` dedupliziert nur gegen
   *offene* Meldungen; eine aufgelöste Meldung würde im Minutentakt neu entstehen. Die Tabelle
   `plausibility_state` hält je Befund und Bezugsobjekt die zuletzt gemeldete Anzahl. Solange eine
   Meldung offen ist, wird dieser Stand nachgezogen — wer auflöst, quittiert damit den Stand *im
   Moment der Auflösung* und die Meldung kehrt erst bei einem **neuen** betroffenen Lauf zurück
   (FR-014, SC-005).

Das Feature **liest** Läufe, Features und Projekte und schreibt ausschließlich in `attention` und
`plausibility_state` (SC-007). Es hält nichts auf: der Aufruf steht als letzte Anweisung im
Timer-Rumpf, in eigenem `try/catch` (FR-003, SC-006). Die vorhandenen `console.warn`-Ausgaben
bleiben wortgleich (FR-018).

**Am echten Bestand verifiziert** (Kopie der Produktivdatenbank, 30.07.2026): der erste Start
erzeugt **fünf** Meldungen — 2× Befund A (160 Läufe), 2× Befund B (19 Läufe), 1× Befund C
(22 Features). Dabei haben sich zwei Zahlen der Aufgabenstellung als ungefiltert erwiesen, siehe
[Bewusste Festlegungen](#bewusste-festlegungen-zur-kenntnis) und [research.md](./research.md) D8.

## Technical Context

**Language/Version**: TypeScript 5.8, Node ≥ 22 (ESM, `module: NodeNext`), pnpm-10-Workspace

**Primary Dependencies**: keine neuen. Genutzt werden `better-sqlite3` 12 (bereits da) und der
vorhandene Event-Bus. `@sdd/shared` bleibt frei von `node:`-Importen — das Endgültigkeitsfenster
`TELEMETRY_GRACE_MS` (Server-Konstante) wird als Parameter übergeben, nicht kopiert.

**Storage**: SQLite (`~/.sdd-toolkit/sdd-toolkit.sqlite`). **Eine** additive Migration:
`CREATE TABLE plausibility_state` (Schema in [data-model.md](./data-model.md) §2). Keine
Datenumformung, keine Änderung bestehender Spalten, keine Rückmigration nötig.

**Testing**: vitest 3 (`pnpm -r test`), Typprüfung `pnpm -r typecheck`. Neu:
`packages/shared/src/plausibility.test.ts` (pur — trägt die 14 Nicht-Melde-Regeln aus
FR-005/007/009/011), `packages/server/src/services/plausibilityService.test.ts` (In-Memory-DB über
`openMemoryDatabase()`), `packages/server/src/db/plausibilityRepo.test.ts`. Erweitert:
`attentionReconciler.test.ts` (FR-016/FR-017), `executionRepo.test.ts` (Ablehnungsdaten).
`packages/web` hat konventionsgemäß keine Tests — die Inbox-Kriterien werden über
[quickstart.md](./quickstart.md) Stufe 4 nachgewiesen.

**Target Platform**: lokaler Entwickler-Server (macOS/Linux), Web-UI im Browser

**Project Type**: pnpm-Monorepo — `packages/shared` (pure Typen/Logik), `packages/server`
(API + Services + DB), `packages/web` (React-SPA)

**Performance Goals**: Die Prüfung liest alle abgeschlossenen Läufe und filtert in TypeScript.
Bestand heute: **254 Zeilen** — Arithmetik im Millisekundenbereich, alle 60 s. Der Deckel ist
benannt: ab etwa 10⁵ Läufen lohnt ein SQL-Vorfilter, der eine Obermenge liefert, ohne die
Prädikate anzutasten ([research.md](./research.md) D5). Der Laufabschluss wird **nicht** verzögert
(FR-003): der Trigger sitzt in einem Timer, der 5 min nach dem Lauf feuert.

**Constraints**:
- **Nur beurteilen, nie eingreifen**: kein `UPDATE`/`INSERT` auf `executions`, `features`,
  `projects`; keine Reparatur, kein Neustart, kein Abbruch (SC-007, Assumption der Spec).
- **Kein zweiter Meldeweg**: ausschließlich `AttentionRepo.raise()`; kein neuer Endpunkt, kein
  neues WS-Ereignis.
- **Kein neues Zeitfenster**: Endgültigkeit ist das bestehende Nachtragsfenster
  (`TELEMETRY_GRACE_MS`); Bestandstakt ist der bestehende Minutentakt.
- **Bestehende Ablehnungsregel unverändert** (Out of Scope): `updateTelemetry` lehnt weiter genau
  dasselbe ab, nur ihre Sichtbarkeit ändert sich.
- **`checkWorkWithoutRun` wird nicht angetastet** (Out of Scope: bereits gebaut).
- **Deutsche Meldungstexte**, Zahlen `de-CH`. `AttentionInbox.tsx` nutzt Emoji-Icons entgegen der
  Projektkonvention „SVG statt Emoji" — Bestand der Datei, wird hier nicht umgestellt.

**Scale/Scope**: 4 Befunde, 3 neue Quelldateien (1× shared, 2× server) + 3 neue Testdateien, 1
Migration, additive Änderungen an 8 Bestandsdateien und 2 Bestandstests. Erwartete Wirkung beim ersten Start:
5 Meldungen über 160 unbepreiste Läufe, 19 Fehlstarts und 22 Features ohne Lauf.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist ein **unausgefülltes Template** — es existiert keine
ratifizierte Projekt-Constitution. Ersatzweise gelten die etablierten Repo-Konventionen als Gates;
alle erfüllt:

- ✅ **Pure Logik in `shared`, mit vitest getestet**: Schwellen, Prädikate, Melde-Entscheidung und
  Texte liegen ohne IO in `plausibility.ts` — dasselbe Muster wie `workflowModel.ts`,
  `lifecycleCatalog.ts`, `attentionReconciler.ts`.
- ✅ **`@sdd/shared` bleibt node-frei**: kein `node:`-Import, keine Server-Konstante importiert.
- ✅ **Keine neuen Dependencies**: bestätigt (0 Runtime-, 0 Dev-Deps).
- ✅ **Bestehende Muster wiederverwenden statt neu bauen**: Inbox statt zweitem Meldeweg,
  `raise()`-Dedup statt eigener Duplikatlogik, bestehendes Nachtragsfenster statt eigenem Timer,
  bestehender Minutentakt neben `workWithoutRunInterval`, `openMemoryDatabase()` in den Tests.
- ✅ **Migration additiv**: eine neue Tabelle, keine bestehende Spalte verändert; Altzeilen ohne
  Marke verhalten sich wie „nie gemeldet".
- ✅ **Verträge additiv**: `AttentionKind` und `TelemetryUpdateOutcome` werden nur erweitert; kein
  Feld entfernt, kein Endpunkt geändert.
- ✅ **Read-only-Prinzip**: das Feature verändert kein Verhalten des Toolkits — es beurteilt nur
  (SC-006, SC-007).
- ✅ **Typprüfung als Drift-Guard**: `KIND_META: Record<AttentionKind, …>` erzwingt Bezeichnung und
  Icon jeder neuen Art; eine künftige fünfte Art kann nicht unbeschriftet in der Inbox landen.
- ✅ **Prozess-/Port-Regel aus `CLAUDE.md`**: die Validierung startet Probe-Instanzen auf eigenen
  Ports (4899) und beendet sie über eigenen Port bzw. gemerkte PID; kein `pkill -f` mit
  unspezifischem Muster.

**Post-Design-Re-Check (nach Phase 1)**: unverändert bestanden. Das Design führt kein neues Paket,
kein Framework, keine Persistenzschicht und keine Netzwerklast ein. Complexity Tracking bleibt
leer.

## Project Structure

### Documentation (this feature)

```text
specs/plausibilitaetspruefung/
├── plan.md                              # Diese Datei
├── research.md                          # Phase 0: D1–D12, an der laufenden DB verifiziert
├── data-model.md                        # Phase 1: Befunde, Tabelle, Typerweiterungen, Texte
├── quickstart.md                        # Phase 1: Validierung in 5 Stufen
├── contracts/
│   ├── plausibility-module.md           # Pures Shared-Modul: Konstanten, Prädikate, Wahrheitstabelle
│   ├── plausibility-service.md          # Repo + Service + Verdrahtung + Migration
│   └── attention-kinds.md               # Meldungsarten: API-Nutzlast, Inbox, Gültigkeitsvertrag
├── checklists/
│   └── requirements.md                  # Spec-Qualitätscheck (Durchlauf 1 bestanden)
└── tasks.md                             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── plausibility.ts (NEU)            # FALSE_START_MAX_MS, PROJECT_WITHOUT_RUNS_GRACE_MS,
│                                    #   METERING_CONFLICT_MIN_FACTOR, TERMINATION_EXIT_CODES,
│                                    #   isMeasurementFinal/isUnpricedRun/isPhaseFalseStart/
│                                    #   isProjectWithoutRuns/meteringConflictFactor,
│                                    #   decideFinding(), Meldungstext-Builder
├── plausibility.test.ts (NEU)       # 4 Erkennungen + 14 Nicht-Melde-Regeln + Wahrheitstabelle
├── types.ts                         # + 4 Werte in AttentionKind
└── index.ts                         # + export * from './plausibility.js'

packages/server/src/
├── db/database.ts                   # + Migration: CREATE TABLE plausibility_state
├── db/repos.ts                      # TelemetryUpdateOutcome + rejection/Zahlen/factor;
│                                    #   FeatureRepo.hardDelete() räumt Marken mit ab
├── db/plausibilityRepo.ts (NEU)     # listProjectStats() (Befund C) + getMark/setMark/clearMark
├── db/plausibilityRepo.test.ts (NEU)# Aggregat-Randfälle (archiviert, 0 Features, Lauf vorhanden)
├── db/executionRepo.test.ts         # + Ablehnungsdaten strukturiert (FR-010)
├── services/plausibilityService.ts (NEU)      # check(now), reportMeteringConflict()
├── services/plausibilityService.test.ts (NEU) # SC-001/004/005, FR-003, FR-013/014/015
├── services/attentionReconciler.ts  # + 4 case-Zweige: Datenbefunde bleiben gültig
├── services/attentionReconciler.test.ts       # + FR-016 (Agent arbeitet) / FR-017 (Neustart)
├── services/orchestrator.ts         # + deps.plausibility?; Aufruf am Ende des last-Zweigs von
│                                    #   scheduleLateReconcile(); reportMeteringConflict() an den
│                                    #   ZWEI Ablehnungsstellen (console.warn bleibt)
└── index.ts                         # PlausibilityRepo/Service vor dem Orchestrator bauen;
                                     #   check() NACH reapOnBoot(); setInterval 60 s; clearInterval

packages/web/src/components/
└── AttentionInbox.tsx               # + 4 KIND_META-Einträge (Bezeichnung, Icon, Farbe)
```

**Structure Decision**: Das bestehende 3-Paket-Monorepo bleibt unverändert. Die Aufteilung folgt
der im Repo etablierten Trennung: Regel und Entscheidung pur in `shared` (testbar ohne Aufbau),
SQL in einem eigenen Repo neben `agentRepo.ts`/`knowledgeRepo.ts` (statt `repos.ts` mit seinen
1143 Zeilen weiter aufzublähen), Verdrahtung in einem Service neben `attentionReconciler.ts`. Der
`PlausibilityService` hängt **nicht** am Orchestrator, sondern wird vor ihm gebaut und ihm als
optionale Abhängigkeit übergeben — dadurch bleiben alle bestehenden Orchestrator-Tests ohne
Änderung kompilierbar. Begründung im Detail: [research.md](./research.md) D12.

## Umsetzungsreihenfolge (empfohlen, Story-Prioritäten folgend)

1. **Pures Fundament (US1/US2/US3 gemeinsam)**: `plausibility.ts` mit Konstanten, den fünf
   Prädikaten, `decideFinding()` und den Textbuildern gemäß
   [contracts/plausibility-module.md](./contracts/plausibility-module.md); Re-Export in
   `index.ts`. Direkt danach `plausibility.test.ts` — hier entsteht der ganze SC-002-Nachweis.
2. **Meldungsarten (US4/FR-012)**: vier Werte in `AttentionKind`, vier `KIND_META`-Einträge, vier
   `case`-Zweige im Reconciler samt Tests für FR-016/FR-017. `pnpm -r typecheck` grün.
3. **Persistenz (US4/FR-014/FR-017)**: Migration `plausibility_state`, `PlausibilityRepo` mit
   Marken-Zugriff und `listProjectStats()`, `hardDelete()`-Ergänzung, `plausibilityRepo.test.ts`.
4. **Befund A und B am Bestand (US1 + US2)**: `PlausibilityService.check()` für A und B —
   Gruppierung nach Projekt bzw. Feature, Beispielauswahl, Wasserstand, `raise()` + Bus-Ereignis.
   Tests: genau eine Meldung je Bezugsobjekt, zehn Durchläufe, Auflösen/Wiederkehr.
5. **Befund C (US2)**: Aggregat auswerten und melden; die fünf Nicht-Melde-Fälle aus FR-009 als
   Tests am Repo *und* am Service.
6. **Laufabschluss-Kopplung (US1/FR-001)**: `deps.plausibility?` im Orchestrator, Aufruf als
   letzte Anweisung des `last`-Zweigs von `scheduleLateReconcile()` in eigenem `try/catch`; Test
   mit `vi.useFakeTimers()`, dass ein werfender Service den Lauf unberührt lässt (FR-003, SC-006).
7. **Befund D (US3)**: `TelemetryUpdateOutcome` erweitern, `executionRepo.test.ts` ergänzen,
   `reportMeteringConflict()` an beiden Ablehnungsstellen aufrufen — `console.warn` unverändert
   stehen lassen (FR-018).
8. **Start und Takt (US2/FR-002)**: `index.ts` — Service bauen, `check()` nach `reapOnBoot()`,
   `setInterval(…, 60_000)`, `clearInterval` im Shutdown.
9. **Verifikation**: `pnpm -r typecheck && pnpm -r test` grün, dann [quickstart.md](./quickstart.md)
   Stufe 3–5 gegen eine Kopie der Produktivdatenbank auf Port 4899.

Nach Schritt 4 ist das Feature schon nützlich (die beiden wachsenden Bestände sind sichtbar);
Schritt 6 schließt die Quelle, Schritt 5 und 7 ergänzen die beiden nachgelagerten Befunde.

## Bewusste Festlegungen zur Kenntnis

Drei Entscheidungen weichen von einer wörtlichen Lesart der Spezifikation ab oder korrigieren sie.
Alle drei sind in [research.md](./research.md) begründet und in einer Zeile umkehrbar:

| Festlegung | Wirkung | Grund | Umkehr |
|---|---|---|---|
| **Befund A überspringt `orphaned`** (D8) | 160 statt 171 Läufe | Ein verwaister Lauf hat seinen Abschlusspfad nie erreicht, seine Messung war nie endgültig (FR-001); verwaiste Läufe sind ausdrücklich Out of Scope | Bedingung `status !== 'orphaned'` entfernen |
| **Befund B überspringt archivierte Features** (D6) | 2 Meldungen über 19 Läufe statt 5 über 33; FR-006 ist damit **verengt** | FR-009 nimmt archivierte Features bei Befund C ausdrücklich aus; ein Fehlstart eines abgeschlossenen Features ist nicht mehr handhabbar (US4) | `features.listAll()` → `listByProject(id, true)` |
| **Fehlstart nur bei `status='failed'` und Exitcode ∉ {130,137,143}** (D9) | Abbrüche und verwaiste Läufe melden nie | Es gibt keine persistierte Abbruch-Markierung; eine neue Spalte würde für den Bestand nichts bringen und wäre der einzige Schreibzugriff auf `executions` (gegen SC-007) | — (FR-007 verlangt es) |

Ergänzend: **SC-003 nennt Zahlen (171 / 43 / 22), die aus ungefilterten Abfragen stammen.** Die 43
sind *alle* Phasenfehlschläge mit Exitcode 1 — mit Laufzeiten von 2,1 s bis 2,5 Stunden; nur 33
tragen die Fehlstart-Signatur, die übrigen 10 sind echte Fehlschläge und dürfen laut FR-007 nicht
melden. Die inhaltliche Zusage von SC-003 („sichtbar, ohne dass jemand eine Datenbankabfrage
formuliert") wird erfüllt; die Zahlen im Text werden es nicht sein. Die Herleitung samt
Gegenprobe-Abfragen steht in [research.md](./research.md) D8 und
[quickstart.md](./quickstart.md) Stufe 3.

## Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Die Inbox wächst zu, weil dieselben Befunde nachwachsen — das Feature wäre schädlicher als sein Fehlen (US4) | Persistenter Wasserstand + Nachziehen bei offener Meldung; die vollständige Wahrheitstabelle von `decideFinding()` ist Testfall für Testfall abgedeckt; quickstart Stufe 4.2 zählt über 10 Intervalle |
| Regel steht doppelt (SQL **und** Prädikat) und läuft auseinander — Tests wären grün gegen die Fassung, die nicht läuft | Befund A und B filtern **nur** in TypeScript über `ExecutionRepo.listAll()`; SQL gibt es allein für das Aggregat von Befund C, dessen Randfälle direkt am Repo getestet werden (research.md D5) |
| Ein zweites Endgültigkeitsfenster driftet gegen das Nachtragsfenster | `TELEMETRY_GRACE_MS` wird importiert und als Parameter durchgereicht, nirgends kopiert; `telemetry_final_at` bleibt als zusätzliche Sperre wirksam (research.md D2) |
| Befund-Meldungen werden wie Prozess-Meldungen behandelt und verschwinden, sobald ein Agent arbeitet oder das Toolkit neu startet | Vier eigene Arten statt `agent_errored` zu leihen; vier explizite `case`-Zweige mit Begründung im Reconciler; je ein Test für FR-016 und FR-017 |
| Die Beurteilung bringt einen Laufabschluss zum Scheitern (FR-003, SC-006) | Aufruf als **letzte** Anweisung im Timer-Rumpf, eigenes `try/catch`, Service wirft grundsätzlich nicht; Test mit werfendem Service prüft Status, `finished_at`, Exitcode und Tokenzahl |
| Fehlstart-Schwelle trifft echte Fehlschläge mit | An allen 45 Phasenfehlschlägen geprüft: 33 unter 4,1 s, **keiner** zwischen 6 und 20 s, 10 über 20 s (Exitcode 1) plus 2 Abbrüche (Exitcode 143, beide > 60 s) — die Schwelle liegt in einer leeren Zone (research.md D8) |
| Befund A meldet Läufe, deren Betrag nur noch nicht eingetroffen ist | Beurteilung erst nach dem Nachtragsfenster; belegt an den Daten: von 40 Läufen mit gesetztem `telemetry_final_at` bekamen 37 den Betrag nachgetragen, 3 nicht |
| Faktor für Befund D wird aus dem Meldungstext zurückgeparst oder ein zweites Mal berechnet (mit inzwischen abweichendem Zwischenstand) | `TelemetryUpdateOutcome` trägt `existingTokens`, `rejectedTokens` und `factor` strukturiert; `reason` und beide `console.warn` bleiben wortgleich (FR-018) |
| Prüfung schreibt versehentlich in `executions` | Der Service kennt nur lesende Methoden von `ExecutionRepo`; quickstart Stufe 5.3 vergleicht Prüfsummen über die Lauftabelle vor/nach mehreren Durchläufen |
| Marken bleiben nach dem Löschen eines Features oder Projekts liegen | `project_id` mit `ON DELETE CASCADE`; `FeatureRepo.hardDelete()` löscht Marken in derselben Transaktion wie `attention`/`executions` |
| Meldungstexte sind nicht testbar, weil sie locale-abhängig formatieren | `Intl.NumberFormat('de-CH')` (Node 22 hat vollständiges ICU); Tests prüfen Anzahl, Beispielbestandteile und Schlüsselwörter, nicht die vollständige Zeichenkette |
| Die Prüfung läuft beim Start vor dem Reaper und sieht `running`-Leichen | Reihenfolge in `index.ts` festgeschrieben und in [contracts/plausibility-service.md](./contracts/plausibility-service.md) als verbindlich vermerkt: `reapOnBoot()` vor dem ersten `check()` |
| Neue Meldungsart landet unbeschriftet in der Inbox | `KIND_META` ist `Record<AttentionKind, …>` — `pnpm typecheck` schlägt fehl, solange ein Eintrag fehlt |

## Complexity Tracking

> Keine Constitution-Verstöße — Tabelle bleibt leer.
