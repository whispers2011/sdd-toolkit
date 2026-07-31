---
description: "Task list for feature implementation"
---

# Tasks: Geschätzte Kosten aus den Läufen entfernen

**Input**: Design documents from `/specs/kosten-aus-laeufe-entfernen/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/api-changes.md](./contracts/api-changes.md), [quickstart.md](./quickstart.md)

**Tests**: Test-Tasks sind enthalten, weil der Plan sie ausdrücklich fordert (Schritt 4:
„6 Testdateien anpassen, Regressionstests für ‚Payload ohne `costUsd`' ergänzen") und
[quickstart.md](./quickstart.md) S3 den US3-Nachweis über `pnpm test` führt. `@sdd/web` hat
bewusst keine Test-Suite — US1/US2 werden manuell nach quickstart.md S1/S2 nachgewiesen.

**Organization**: Tasks sind nach User Story gruppiert. **Abweichung von der Standard-Unabhängigkeit**:
US1 und US2 sind zueinander unabhängig; US3 muss zwingend *nach* US1 und US2 laufen, weil `costUsd`
in `@sdd/shared` liegt und sein Entfernen jede verbliebene Lesestelle in `web` zum Compile-Fehler
macht (siehe [research.md](./research.md), D6). Diese Reihenfolge ist die Bedingung dafür, dass
US1/US2 überhaupt eigenständig prüfbar sind.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelisierbar (andere Datei, keine Abhängigkeit zu offenen Tasks)
- **[Story]**: Zugehörige User Story (US1, US2, US3)
- Dateipfade sind relativ zum Repository-Root

## Path Conventions

pnpm-Monorepo mit drei Paketen:

- `packages/shared/src/` — reine Domänenlogik + Vitest-Tests (`*.test.ts` neben der Quelle)
- `packages/server/src/` — Fastify-API, SQLite, Orchestrierung + Vitest-Tests
- `packages/web/src/` — React-SPA, keine Test-Suite

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ausgangszustand feststellen und die Vergleichsbasis für den Vollständigkeitsnachweis sichern

- [X] T001 Abhängigkeiten installieren und grünen Ausgangszustand bestätigen: `pnpm install`, `pnpm typecheck`, `pnpm test` — alle drei müssen vor der ersten Änderung fehlerfrei durchlaufen (Vergleichsbasis für T042)
- [X] T002 [P] Referenz-Baseline festhalten: `grep -rniE 'costusd|cost_usd|MODEL_PRICES|priceFor|usageToCost|CACHE_READ_FACTOR|CACHE_WRITE_FACTOR|DEFAULT_PRICE|ModelPrice|total_cost' packages --include='*.ts' --include='*.tsx' | wc -l` ausführen und die Trefferzahl notieren (erwartet: 98 Treffer in 28 Dateien laut [research.md](./research.md)); Ziel nach T040 sind die 2 inerten Schema-Zeilen in `packages/server/src/db/database.ts`
- [X] T003 [P] Bestehende SQLite-Datenbank für den FR-011-Nachweis sichern: `DB="${SDD_DATA_DIR:-$HOME/.sdd-toolkit}/sdd-toolkit.sqlite"; cp "$DB" "$DB.bak"; sqlite3 "$DB" 'PRAGMA user_version;'` — Versionsnummer notieren (muss nach T043 identisch sein)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Blockierende Vorarbeit für alle User Stories

**Keine Tasks.** Dieses Feature entfernt ausschließlich bestehenden Code; es führt kein Schema,
kein Modul und keine Abhängigkeit ein. Die SQLite-Spalten `executions.cost_usd` und
`chat_messages.cost_usd` bleiben bewusst unverändert stehen — es wird **keine neue Migration**
angelegt (siehe [research.md](./research.md), D2). Damit existiert keine Arbeit, die vor US1
liegen müsste.

**Checkpoint**: Setup abgeschlossen → US1 und US2 können sofort (und parallel) beginnen

---

## Phase 3: User Story 1 - Läufe-Ansicht ohne Kostenangaben (Priority: P1) 🎯 MVP

**Goal**: In der „Läufe"-Ansicht erscheint auf keiner Ebene mehr ein Geldbetrag — nicht in der
Zusammenfassung über alle Läufe, nicht pro Lauf-Zeile, nicht in der Step-Auswertung und nicht in
der Tabelle der Einzel-Ausführungen. Tokens, Herkunfts-Badges, Dauer und Status bleiben unberührt.

**Independent Test**: Projekt mit mehreren abgeschlossenen Läufen im Tab **Läufe** öffnen, einen
Lauf aufklappen und alle vier Ebenen prüfen (quickstart.md S1). `⌘F` auf `$` findet 0 Treffer in
toolkit-gerenderten Kennzahlen; Token-Angaben stehen unverändert an ihrem Platz. Die Daten tragen
`costUsd` in dieser Phase noch — geprüft wird ausschließlich die Anzeige.

### Implementation for User Story 1

- [X] T004 [US1] Gesamt-Kostenangabe der Zusammenfassungszeile entfernen in `packages/web/src/components/ExecutionsView.tsx`: `totalCost`-Reduce (Z. 156) löschen und das Segment `${totalCost.toFixed(2)} ·` aus der Summenzeile (Z. 167) streichen, sodass `N Läufe · X Tokens · Y % gemessen` ohne doppelte oder hängende `·`-Trenner rendert (FR-001)
- [X] T005 [US1] Kostenangabe pro Lauf entfernen in `packages/web/src/components/ExecutionsView.tsx`: den `<span className="w-14 shrink-0 text-right …">${run.total.costUsd.toFixed(2)}</span>` (Z. 255) **vollständig** löschen — kein leerer Platzhalter-Span, damit rechts vom Token-Wert keine Leerspalte zurückbleibt (FR-002, FR-012)
- [X] T006 [US1] Kostenangabe pro Step entfernen in `packages/web/src/components/ExecutionsView.tsx`: das Feld `sub: \`$${s.rollup.costUsd.toFixed(2)}\`` aus den an `HBarChart` übergebenen Items (Z. 270) löschen; `label`, `value` und `color` bleiben unverändert (FR-003)
- [X] T007 [US1] Tabellenspalte „Kosten" entfernen in `packages/web/src/components/ExecutionsView.tsx`: `<th …>Kosten</th>` (Z. 301) **und** die zugehörige `<td>` mit `e.costUsd !== null ? … : '—'` (Z. 321–323) löschen; die Tabelle hat danach 6 statt 7 Spalten, Header und Zellen bleiben ausgerichtet (FR-004, FR-012)
- [X] T008 [US1] Konsumentenlos gewordene `sub`-Option entfernen in `packages/web/src/components/charts.tsx`: `sub?: string` aus der `HBarChart`-Item-Signatur (Z. 23) und den nun immer leeren `<span className="w-16 shrink-0 text-zinc-500">{i.sub ?? ''}</span>` (Z. 38) löschen — `HBarChart` hat nach T006 nur noch `ExecutionsView` als Aufrufer (hängt von T006 ab)
- [X] T009 [US1] `pnpm --filter @sdd/web typecheck` ausführen und quickstart.md S1 vollständig durchgehen (Schritte 1–8, inklusive Lauf mit Herkunft „geschätzt" und Log-Panel) — Nachweis SC-001

**Checkpoint**: Die „Läufe"-Ansicht ist frei von Geldbeträgen und unabhängig von US2/US3 prüfbar. Die API liefert `costUsd` noch, niemand zeigt es an.

---

## Phase 4: User Story 2 - Keine Kostenangaben in den übrigen Lauf-Ansichten (Priority: P2)

**Goal**: Auch Review-Portal-Kopfzeile, Test-/Verifikations-Übersicht, Audit-Seitenleiste und
Agent-Auswahl beschreiben Läufe ohne Geldbetrag, sodass keine widersprüchlichen Oberflächen
zurückbleiben.

**Independent Test**: Für ein Feature mit Läufen das Review-Portal öffnen (Kopfzeile, Tab
Tests/Verifikation, Audit-Seitenleiste) und anschließend den Dialog zur Agent-Auswahl —
quickstart.md S2. 0 Geldbeträge in allen vier Ansichten; Verdict, Zusammenfassung, Zeitpunkt und
`… tok` bleiben vorhanden. Berührt keine der Dateien aus US1, kann daher parallel zu US1 laufen.

### Implementation for User Story 2

- [X] T010 [P] [US2] Kosten-Kennzahl der Review-Portal-Kopfzeile entfernen in `packages/web/src/components/ReviewPortal.tsx`: `totalCost`-`useMemo` (Z. 82) und `<HeaderStat label="Kosten" … />` (Z. 159) löschen; die Kennzahlen `Dateien`, `Audits` und `Verify` bleiben unverändert (FR-005, FR-012)
- [X] T011 [P] [US2] Kostenangaben der Test-/Verifikations-Übersicht entfernen in `packages/web/src/components/review/TestsPane.tsx`: `cost`-Reduce in `totals` (Z. 34), `<StatCard label="Kosten" … />` (Z. 55) und das Suffix ` · $${e.costUsd…}` pro Lauf-Zeile (Z. 76) löschen; die verbleibenden StatCards stehen ohne Lücke, das vorangehende `… tok`-Suffix bleibt. Modul-Doc Z. 7 („aggregierte Token/Kosten") auf Tokens korrigieren (FR-006, FR-012)
- [X] T012 [P] [US2] Kostensuffix pro Audit-Lauf entfernen in `packages/web/src/components/review/AuditSidebar.tsx`: den Ausdruck `{run.costUsd ? \` · $${run.costUsd.toFixed(2)}\` : ''}` (Z. 101) löschen; Verdict-Pill, Entscheidungs-Label, Zusammenfassung, Zeitpunkt und Token-Suffix bleiben. Modul-Doc Z. 24 („…, Zusammenfassung, Kosten, …") entsprechend kürzen (FR-007)
- [X] T013 [P] [US2] Kostensuffix am letzten Lauf entfernen in `packages/web/src/components/FeatureAgentSelect.tsx`: den Ausdruck `{lastRun.costUsd ? \` · $${lastRun.costUsd.toFixed(2)}\` : ''}` (Z. 93) löschen; Zeitpunkt und Token-Angabe des letzten Laufs bleiben (FR-007)
- [X] T014 [US2] `pnpm --filter @sdd/web typecheck` ausführen und quickstart.md S2 vollständig durchgehen (Schritte 1–5, inklusive Alt-Review mit `source: 'markdown'`) — Nachweis SC-002

**Checkpoint**: US1 **und** US2 sind erfüllt — kein Nutzer-sichtbarer Bereich zeigt noch einen Geldbetrag (FR-008). `packages/web/src` liest `costUsd` nur noch als Typfeld in `api.ts`, das in T032 fällt.

---

## Phase 5: User Story 3 - Keine geschätzten Kosten in den Lauf-Daten (Priority: P3)

**Goal**: Geldbeträge sind kein Bestandteil der ausgelieferten Lauf-Auswertung mehr und werden gar
nicht erst berechnet — Schreibpfad, Shared-Typen und Preismechanismus entfallen. `tsc` wird damit
zum Beweis, dass keine Lesestelle übersehen wurde.

**Independent Test**: Die Endpoints aus quickstart.md S3 gegen den laufenden Server abfragen —
`curl … | grep -c 'costUsd'` liefert für alle fünf URLs `0`, während Token-Felder und `sourceMix`
vollständig vorhanden sind. Zusätzlich `pnpm test`: Rollups, `meter()`, `usageTotalTokens()`,
`parseChatStreamLine()` und der Execution-Row-Mapper tragen kein Kostenfeld.

**⚠️ Story-Abhängigkeit**: Startet erst, wenn T004–T008 und T010–T013 abgeschlossen sind — `costUsd`
liegt in `@sdd/shared`, gegen das `web` kompiliert (siehe [research.md](./research.md), D6).

### Server-Schreibpfad (US3a)

- [X] T015 [P] [US3] Kostenrückgabe der Konfliktauflösung entfernen in `packages/server/src/services/conflictResolver.ts`: Rückgabetyp `Promise<{ exitCode; logPath; costUsd; tokens }>` (Z. 24) auf `Promise<{ exitCode; logPath; tokens }>` kürzen und im `return` (Z. 79) `costUsd: cost.costUsd` streichen; `tokens: cost.totalTokens` bleibt
- [X] T016 [P] [US3] `finish()`-Aufruf ohne Kostenargument in `packages/server/src/services/chatWorkService.ts` (Z. 366): `finish(execId, 0, cost.costUsd, cost.totalTokens)` → `finish(execId, 0, cost.totalTokens)`
- [X] T017 [P] [US3] `finish()`-Aufruf ohne Kostenargument in `packages/server/src/services/agentGateService.ts` (Z. 173): `finish(execId, verdict === 'PASS' ? 0 : 1, cost.costUsd, cost.totalTokens)` → ohne `cost.costUsd`
- [X] T018 [P] [US3] Kostenermittlung im Chat-Turn entfernen in `packages/server/src/services/chatService.ts`: Zeile `const costUsd = turnResult.costUsd ?? fallback.costUsd;` (Z. 273) löschen, `costUsd` aus dem Message-Outcome (Z. 280) streichen und `executions.finish(execId, 0, costUsd, tokens)` (Z. 283) zu `finish(execId, 0, tokens)` kürzen; `turnResult.tokens ?? fallback.totalTokens` bleibt unverändert
- [X] T019 [P] [US3] Token-statt-Kosten-Metering im Orchestrator in `packages/server/src/services/orchestrator.ts`: Import `usageToCost` (Z. 18) auf `usageTotalTokens` umstellen, `const { totalTokens, costUsd } = usageToCost(usage)` (Z. 704) zu `const totalTokens = usageTotalTokens(usage)` und `costUsd` aus beiden `finishWithUsage`-Zweigen (Z. 706 und Z. 720) entfernen (setzt T031 voraus)
- [X] T020 [US3] `finish()`-Aufruf der Merge-Queue anpassen in `packages/server/src/services/mergeQueueService.ts` (Z. 425): `finish(execId, res.exitCode, res.costUsd, res.tokens)` → `finish(execId, res.exitCode, res.tokens)` (hängt von T015 ab, da `res` aus `conflictResolver` stammt)
- [X] T021 [US3] Kosten aus `ExecutionRepo` entfernen in `packages/server/src/db/repos.ts`: `FinishUsage.costUsd` (Z. 399) streichen, Signatur `finish(id, exitCode, costUsd, tokens)` (Z. 435–436) zu `finish(id, exitCode, tokens = null)` kürzen, `cost_usd=?` samt Bind-Parameter aus dem `UPDATE executions` (Z. 443–451) entfernen und die Row-Mapper-Zeile `costUsd: r.cost_usd` (Z. 517) löschen — die Spalte `cost_usd` bleibt im Schema unangetastet (D2, FR-011)
- [X] T022 [US3] Kosten aus `ChatRepo` entfernen in `packages/server/src/db/repos.ts`: `ChatMessageRow.cost_usd` (Z. 737), Row-Mapper `costUsd: r.cost_usd` (Z. 763), Insert-Default `costUsd: null` (Z. 854), `costUsd?` im `finishMessage`-Outcome (Z. 883) sowie `cost_usd=?` samt Bind-Parameter im `UPDATE chat_messages` (Z. 889–897) löschen (D7)
- [X] T023 [P] [US3] `attachCosts()` zu `attachTokens()` machen in `packages/server/src/api/reviewRoutes.ts`: Funktion (Z. 274–279) umbenennen, Rückgabe auf `{ ...run, totalTokens: exec.tokens }` reduzieren, Doc-Kommentar anpassen und die Aufrufstelle (Z. 256, `withCosts` → `withTokens`) nachziehen; der Markdown-Fallback für Alt-Reviews bleibt unberührt (Contract 5, FR-007)
- [X] T024 [P] [US3] Kosten aus der `lastRun`-Anreicherung entfernen in `packages/server/src/api/server.ts` (Z. 866): Zeile `costUsd: deps.executions.get(lastRun.executionId)?.costUsd ?? null` löschen; `totalTokens` bleibt (Contract 4, FR-007)

### Shared-Typen & Kostenmechanismus (US3b)

- [X] T025 [US3] Kostenfelder aus den Domänentypen entfernen in `packages/shared/src/types.ts`: `ExecutionRecord.costUsd` (Z. 268), `ChatMessage.costUsd` (Z. 439) und `AgentRunSummary.costUsd?` (Z. 495) löschen; alle Token- und `tokensSource`-Felder bleiben bitgenau erhalten (FR-009, FR-010)
- [X] T026 [P] [US3] `CostRollup` verschlanken in `packages/shared/src/costBreakdown.ts`: Feld `costUsd: number` (Z. 17), Initialisierung `costUsd: 0` in `emptyRollup()` (Z. 39) und `r.costUsd += e.costUsd ?? 0` in `add()` (Z. 50) löschen; Typname `CostRollup` bleibt (D5)
- [X] T027 [P] [US3] Zweite Rollup-Kopie verschlanken in `packages/shared/src/runSummary.ts`: `costUsd: 0` in `emptyRollup()` (Z. 72) und `r.costUsd += e.costUsd ?? 0` in `add()` (Z. 83) löschen; die Invariante `Summe(byStep/byCategory) == total` für alle Token-Komponenten darf sich nicht verschieben
- [X] T028 [P] [US3] Kostenfeld aus dem Chat-Stream entfernen in `packages/shared/src/chatStream.ts`: `costUsd: number | null` aus der `result`-Variante von `ChatStreamEvent` (Z. 14) und die Zuweisung aus `obj.total_cost_usd` in `parseChatStreamLine()` (Z. 58) löschen; `text`, `isError`, `tokens` und `sessionId` bleiben (D4)
- [X] T029 [US3] Preismechanismus löschen in `packages/shared/src/costMeter.ts`: `CostMetadata.costUsd` (Z. 11), `ParsedUsage.costUsd` (Z. 42), den Kosten-Regex samt Zuweisung in `parseUsage()` (Z. 54–55), `ModelPrice` (Z. 72–75), `CACHE_READ_FACTOR`/`CACHE_WRITE_FACTOR` (Z. 78–79), `MODEL_PRICES` (Z. 81–85), `DEFAULT_PRICE` (Z. 87), `normalizeModel()` (Z. 90–97) und `priceFor()` (Z. 99–102) entfernen; in `meter()` (Z. 118–124) die Preis-Multiplikation streichen und `hasParsed` (Z. 107–111) ohne den `parsed.costUsd`-Term bilden. `DEFAULT_MODEL`, `stripAnsi()`, `estimateTokens()`, `parseUsage()`, `meter()`, `CostMetadata.model` und `source` bleiben; Modul-Doc (Z. 1–5) auf reines Token-Metering umschreiben (D3, D4)
- [X] T030 [P] [US3] Doppelte Rollup-Definition verifizieren: nach T026/T027 prüfen, dass `emptyRollup`/`add` in `packages/shared/src/costBreakdown.ts` und `packages/shared/src/runSummary.ts` strukturgleich sind und beide dieselbe `CostRollup`-Form erzeugen (kein Feld nur in einer Kopie entfernt)
- [X] T031 [US3] `usageToCost` zu `usageTotalTokens` umbauen in `packages/shared/src/transcriptUsage.ts`: Signatur `usageToCost(u): { totalTokens; costUsd }` (Z. 100–111) zu `usageTotalTokens(u): number` ändern, Rumpf auf die unveränderte Summe `input + output + cacheRead + cacheCreation` reduzieren, Import von `CACHE_READ_FACTOR`/`CACHE_WRITE_FACTOR`/`priceFor` (Z. 8) entfernen — `transcriptUsage.ts` hat danach keine Abhängigkeit mehr zu `costMeter.ts` — und den Doc-Kommentar (Z. 95–99) auf die Token-Summe umschreiben (D5)
- [X] T032 [US3] Kostenfeld aus dem Web-Client-Typ entfernen in `packages/web/src/api.ts` (Z. 458): `costUsd: number | null` aus `ExecutionInfo` löschen (Spiegel von `ExecutionRecord`, siehe [data-model.md](./data-model.md) §1)

### Tests für User Story 3

- [X] T033 [P] [US3] Kosten-Assertions anpassen in `packages/shared/src/costMeter.test.ts`: Import `priceFor` (Z. 2) entfernen, Test „parseUsage: Kosten und total_cost_usd" (Z. 19–22) durch eine Assertion ersetzen, die belegt dass `parseUsage('"total_cost_usd": 0.0421')` **kein** Kostenfeld liefert; `m.costUsd`-Erwartungen (Z. 32, 41) durch Token-Erwartungen ersetzen; Test „priceFor normalisiert Modellnamen" (Z. 44–48) ersatzlos löschen; Token- und `source`-Assertions bleiben
- [X] T034 [P] [US3] Kosten-Assertions anpassen in `packages/shared/src/transcriptUsage.test.ts`: Import (Z. 2) und Test (Z. 55–66) auf `usageTotalTokens` umstellen — `totalTokens` als Summe aller vier Komponenten bleibt geprüft, die Cache-Faktor-Assertion (Z. 65) entfällt
- [X] T035 [P] [US3] Kosten-Assertions anpassen in `packages/shared/src/costBreakdown.test.ts`: `costUsd: 0` aus dem Rollup-Erwartungsobjekt (Z. 16) und `costUsd`-Werte aus den `exec()`-Fixtures (Z. 36–38) entfernen; Token-Summen und `sourceMix`-Erwartungen bleiben unverändert (Contract C3)
- [X] T036 [P] [US3] Kosten-Assertions anpassen in `packages/shared/src/chatStream.test.ts`: `total_cost_usd` aus dem `result`-Fixture (Z. 33) und die Erwartungen `costUsd: 0.0421` (Z. 41) sowie `expect(ev.costUsd).toBeNull()` (Z. 53) entfernen; stattdessen prüfen, dass das geparste `result`-Event den Schlüssel `costUsd` nicht besitzt
- [X] T037 [P] [US3] Kosten-Fixture anpassen in `packages/shared/src/runSummary.test.ts`: `costUsd: 0.1` aus dem Execution-Fixture (Z. 19) entfernen; die Rollup-Invariante über Tokens muss unverändert grün bleiben
- [X] T038 [P] [US3] Kosten-Assertions anpassen in `packages/server/src/db/chatRepo.test.ts`: `costUsd: 0.01` aus dem `finishMessage`-Outcome (Z. 70) und `expect(stored.costUsd).toBe(0.01)` (Z. 80) entfernen; die `tokens`-Assertion bleibt
- [X] T039 [US3] Regressionstest für Alt-Zeilen anlegen in `packages/server/src/db/executionRepo.test.ts` (neue Datei): In-Memory-DB öffnen, eine `executions`-Zeile mit gefülltem `cost_usd = 0.42` direkt per SQL einfügen, über `ExecutionRepo` lesen und `expect('costUsd' in record).toBe(false)` erwarten; zusätzlich prüfen, dass `finish()` für eine neue Zeile `cost_usd IS NULL` hinterlässt und `tokens`/`tokens_source` korrekt schreibt (FR-011, quickstart.md S3, Contract C4)
- [X] T040 [P] [US3] Payload-Regressionstest ergänzen in `packages/shared/src/runSummary.test.ts`: für ein `buildRunSummaries()`-Ergebnis `expect(JSON.stringify(runs).includes('costUsd')).toBe(false)` erwarten und gleichzeitig belegen, dass `tokens`, die Token-Komponenten und `sourceMix` im Payload enthalten sind (Contract C1/C2/C3, SC-003)

**Checkpoint**: `pnpm typecheck` ist der maschinelle Beweis, dass keine Lesestelle übersehen wurde — alle drei User Stories sind erfüllt.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Doku, Vollständigkeitsnachweis und die Verifikation gegen Bestandsdaten

- [X] T041 [P] Kosten-Formulierungen in `README.md` bereinigen: „Turns erscheinen als `chat_work`-Läufe im Kosten-Audit" (Z. 77) und „Kosten-Aufschlüsselung je Phase/Art mit Quelle-Badge" (Z. 180) auf Token-/Verbrauchs-Formulierungen umstellen. Die Erwähnung „Kosten-Dashboard" in der P2-Roadmap (Z. 185) bleibt unverändert — sie beschreibt Nicht-Gebautes. `docs/*.md` sind historische Planungsdokumente und werden **nicht** rückdatiert
- [X] T042 Vollständigkeitsnachweis: `grep -rniE 'costusd|cost_usd|MODEL_PRICES|priceFor|usageToCost|CACHE_READ_FACTOR|CACHE_WRITE_FACTOR|DEFAULT_PRICE|ModelPrice|total_cost' packages --include='*.ts' --include='*.tsx'` — erwartet sind exakt 2 Treffer, beide `cost_usd REAL` in `packages/server/src/db/database.ts` (Z. 57, 183); jeder weitere Treffer ist eine offene Reststelle (Baseline aus T002: 98)
- [X] T043 `pnpm typecheck` und `pnpm test` ausführen — beide müssen grün sein; `pnpm --filter @sdd/server test` und `pnpm --filter @sdd/shared test` decken die angepassten Suiten ab
- [X] T044 quickstart.md S4 gegen die in T003 gesicherte Bestandsdatenbank durchführen: `PRAGMA user_version` vor/nach dem Start identisch, `SELECT COUNT(*) FROM executions WHERE cost_usd IS NOT NULL` weiterhin `> 0`, jeden Lauf des Projekts aufklappen (keine Fehler, keine leere Spalte, kein `—`), Browser-Konsole ohne `undefined.toFixed`, und für einen **neuen** Lauf `SELECT cost_usd, tokens, tokens_source FROM executions ORDER BY started_at DESC LIMIT 1` prüfen (`cost_usd` = `NULL`) — Nachweis SC-004
- [X] T045 quickstart.md S3 (manueller Teil) gegen den laufenden Server ausführen: `curl -s "$BASE$URL" | grep -c 'costUsd'` für `/api/runs`, `/api/executions?featureId=…`, `/api/features/…/cost-breakdown`, `/api/features/…/agents` und `/api/features/…/agent-runs` — jede Zeile muss `0` ergeben, Token-Felder bleiben vorhanden (Contract C1) — Nachweis SC-003
- [X] T046 quickstart.md S5 und die Edge-Case-Tabelle durchgehen: Token-Angabe steht unverändert an derselben Position in der Lauf-Zeile, Lauf-Zeilen-Wert == Summe der Token-Werte der Einzel-Ausführungen; zusätzlich einen Lauf ohne gemessene Nutzung und einen laufenden Lauf prüfen (kein Zwischenbetrag, keine Leerstelle) — Nachweis SC-005
- [X] T047 Route-Identität bestätigen (Contract C5): `grep -n 'app\.get(\|app\.post(' packages/server/src/api/*.ts` mit dem Stand vor der Änderung (`git stash` bzw. `git show 3dfedfc:…`) vergleichen — die Route-Liste muss identisch sein, insbesondere `GET /api/features/:featureId/cost-breakdown` besteht unverändert fort

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten — startet sofort
- **Foundational (Phase 2)**: leer, blockiert nichts
- **User Story 1 (Phase 3)**: nach Setup — unabhängig von US2
- **User Story 2 (Phase 4)**: nach Setup — unabhängig von US1, **parallel zu US1 möglich** (disjunkte Dateien)
- **User Story 3 (Phase 5)**: **nach US1 und US2** — zwingend, siehe unten
- **Polish (Phase 6)**: nach US3

### User Story Dependencies

- **US1 (P1)**: keine Abhängigkeit zu anderen Stories. Berührt nur `ExecutionsView.tsx` und `charts.tsx`.
- **US2 (P2)**: keine Abhängigkeit zu anderen Stories. Berührt nur `ReviewPortal.tsx`, `TestsPane.tsx`, `AuditSidebar.tsx`, `FeatureAgentSelect.tsx`.
- **US3 (P3)**: **hängt von US1 und US2 ab.** `costUsd` liegt im gemeinsamen Typ in `@sdd/shared`; wird es entfernt, solange eine UI-Stelle es noch liest, bricht `pnpm --filter @sdd/web typecheck`. Diese Abhängigkeit ist keine Design-Schwäche, sondern der Grund für die Reihenfolge in [research.md](./research.md), D6 — sie hält jeden Zwischenstand kompilierbar und macht US1/US2 überhaupt erst eigenständig prüfbar.

### Within User Story 3

1. **Schreibpfad zuerst** (T015–T024): der Server hört auf, Kosten zu berechnen und zu persistieren — alle Aufrufer geben `costUsd` auf, bevor die Signaturen es verlieren
2. **Typen und Mechanismus danach** (T025–T032): erst hier bricht `tsc` bei jeder vergessenen Stelle
3. **Tests zuletzt** (T033–T040): die Suiten kompilieren erst gegen die neuen Signaturen

Abhängigkeiten innerhalb der Story:

- T020 → nach T015 (`res.costUsd` stammt aus `conflictResolver`)
- T019 → nach T031 (`usageTotalTokens` muss existieren) — alternativ beide im selben Schritt
- T021, T022 → beide in `repos.ts`, daher **nicht** parallel zueinander
- T030 → nach T026 und T027
- T033–T040 → nach T025–T032

### Parallel Opportunities

- **T002, T003** parallel im Setup
- **US1 und US2 als Ganzes parallel** — zwei Entwickler, keine gemeinsame Datei
- Innerhalb US2: **T010, T011, T012, T013** vollständig parallel (vier verschiedene Komponenten)
- Innerhalb US1: T004–T007 liegen alle in `ExecutionsView.tsx` → sequenziell; T008 (`charts.tsx`) folgt T006
- Innerhalb US3a: **T015, T016, T017, T018, T023, T024** parallel; T019 parallel nach T031; T020 nach T015; T021/T022 sequenziell
- Innerhalb US3b: **T026, T027, T028** parallel (drei verschiedene Module); T029 und T031 sind gekoppelt (Import-Beziehung), T032 unabhängig
- Innerhalb der Tests: **T033–T038 und T040** vollständig parallel (verschiedene Dateien); T039 legt eine neue Datei an und ist ebenfalls unabhängig

---

## Parallel Example: User Story 2

```bash
# Alle vier Anzeigestellen von US2 gleichzeitig — disjunkte Dateien:
Task: "Kosten-Kennzahl der Review-Portal-Kopfzeile entfernen in packages/web/src/components/ReviewPortal.tsx"
Task: "Kostenangaben der Test-/Verifikations-Übersicht entfernen in packages/web/src/components/review/TestsPane.tsx"
Task: "Kostensuffix pro Audit-Lauf entfernen in packages/web/src/components/review/AuditSidebar.tsx"
Task: "Kostensuffix am letzten Lauf entfernen in packages/web/src/components/FeatureAgentSelect.tsx"
```

## Parallel Example: User Story 3 — Schreibpfad

```bash
# Sechs unabhängige Server-Schreibstellen:
Task: "Kostenrückgabe der Konfliktauflösung entfernen in packages/server/src/services/conflictResolver.ts"
Task: "finish()-Aufruf ohne Kostenargument in packages/server/src/services/chatWorkService.ts"
Task: "finish()-Aufruf ohne Kostenargument in packages/server/src/services/agentGateService.ts"
Task: "Kostenermittlung im Chat-Turn entfernen in packages/server/src/services/chatService.ts"
Task: "attachCosts() zu attachTokens() machen in packages/server/src/api/reviewRoutes.ts"
Task: "Kosten aus der lastRun-Anreicherung entfernen in packages/server/src/api/server.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001–T003)
2. Phase 3: User Story 1 (T004–T009)
3. **STOP und VALIDIEREN**: quickstart.md S1 — die „Läufe"-Ansicht ist frei von Geldbeträgen
4. Auslieferbar: der Kern der Anforderung („keine pro Lauf und auch keine total") ist an der Stelle erfüllt, an der Nutzer Läufe tatsächlich betrachten

Die Daten tragen `costUsd` in diesem Zustand noch — FR-009 ist offen, FR-001…FR-004 sind erfüllt.

### Incremental Delivery

1. Setup → Ausgangszustand grün, Baseline notiert
2. **US1** → S1 prüfen → ausliefern (MVP, SC-001)
3. **US2** → S2 prüfen → ausliefern (SC-002; FR-008 ist damit vollständig erfüllt)
4. **US3** → `pnpm typecheck`/`pnpm test` + S3 prüfen → ausliefern (SC-003)
5. Polish → S4/S5 gegen Bestandsdaten (SC-004, SC-005)

Jeder Zwischenstand kompiliert und ist lauffähig.

### Parallel Team Strategy

Bei zwei Entwicklern:

1. Setup gemeinsam
2. Entwickler A: US1 (`ExecutionsView.tsx`, `charts.tsx`) · Entwickler B: US2 (vier Review-/Auswahl-Komponenten) — keine gemeinsame Datei, kein Merge-Konflikt
3. Nach dem Zusammenführen von US1 und US2: US3 gemeinsam, aufgeteilt nach Schreibpfad (T015–T024) und Shared-Typen (T025–T032); die Testanpassungen (T033–T040) verteilen sich frei

---

## Notes

- **Keine neue SQLite-Migration.** `executions.cost_usd` und `chat_messages.cost_usd` bleiben als inerte Spalten stehen (D2). Wer sie doch entfernen will, tut das als separate Aufräumarbeit — hier nicht.
- **Keine Umbenennung** von `costMeter.ts`, `costBreakdown.ts`, `CostRollup`, `FeatureCostBreakdown`, `CostMetadata` oder der Route `GET /api/features/:featureId/cost-breakdown` (D5). Einzige Ausnahme: `usageToCost` → `usageTotalTokens` und `attachCosts` → `attachTokens`, weil beide ihre Funktion verlieren.
- **Kein Ersatz für die entfernte Angabe** — kein Platzhalter, kein `—`, keine Größenordnung, kein Hinweis „Schätzung entfernt" (Spec-Assumptions).
- **Token- und Herkunftsangaben sind tabu** (FR-010): jede Änderung, die eine Token-Summe oder ein `tokensSource`-Badge verschiebt, ist ein Fehler — `runSummary.test.ts` und `costBreakdown.test.ts` sichern das ab.
- **Der Log-Endpoint wird nicht gefiltert**: Kostenzeilen, die die CLI selbst in ein Lauf-Log schreibt, sind Fremdinhalt und bleiben stehen (contracts/api-changes.md, Hinweis zum Log-Endpoint).
- `pnpm typecheck` nach jeder Phase ausführen — bei diesem Feature ist der Compiler das eigentliche Sicherheitsnetz.
- Commit nach jedem Task oder jeder logischen Gruppe; an jedem Checkpoint kann die jeweilige Story eigenständig validiert werden.

---

## Verifikationsstand (Umsetzung 2026-07-26)

**Maschinell nachgewiesen:**

- `pnpm typecheck` grün in allen drei Paketen — der Vollständigkeitsbeweis nach D6/T043.
- `pnpm test` grün: `@sdd/shared` 198/198, `@sdd/server` 239/239 (+3 aus der neuen
  `executionRepo.test.ts`). Ausgangsbasis vor der Änderung: server 236/236.
- **T042**: Die Referenzsuche liefert im Produktivcode exakt die 2 erwarteten inerten
  Schema-Zeilen (`packages/server/src/db/database.ts:57,183`). Die übrigen 23 Treffer liegen
  ausschließlich in Testdateien und sind **Abwesenheits-Assertions**
  (`'costUsd' in x === false`, `payload.includes('costUsd') === false`) bzw. `total_cost_usd`-
  Eingaben, die belegen, dass der Wert nicht mehr geparst wird. Die in T042 notierte Erwartung
  „exakt 2 Treffer" stammt aus der Zeit vor T033/T036/T039/T040 und meint den Produktivcode.
- **T045 (SC-003)**: Server gegen eine **Kopie** der Bestandsdatenbank gestartet (Port 4899,
  `SDD_DATA_DIR` auf ein temporäres Verzeichnis) — alle fünf Endpoints liefern `costUsd`-Zähler
  `0`; `tokens`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens` und
  `sourceMix` sind unverändert vorhanden.
- **T044 (SC-004, FR-011)**: `PRAGMA user_version` vor und nach dem Serverstart identisch (14) —
  es lief keine neue Migration. 137 Alt-Zeilen mit gefülltem `cost_usd` blieben unangetastet und
  wurden fehlerfrei über die API gelesen (HTTP 200, 13 Ausführungen, kein `costUsd` im Payload,
  Tokens vorhanden). Zusätzlich direkt gegen echte Alt-Zeilen geprüft: `ChatRepo.getMessage()`
  einer Nachricht mit `cost_usd = 0.613513` und `ExecutionRepo.get()` einer Execution mit
  `cost_usd = 0.515` liefern beide **kein** `costUsd`-Feld, Tokens und `tokensSource` intakt.
- **T046 (SC-005)**: Rollup-Invariante über alle 20 Läufe der Bestandsdatenbank geprüft —
  `total.tokens == Summe(Einzel-Ausführungen) == Summe(byStep) == Summe(byCategory)` in 20/20
  Fällen. Die Token-Angabe steht unverändert an derselben Stelle der Lauf-Zeile (in `RunCard`
  wurde ausschließlich der nachfolgende `w-14`-Kosten-Span entfernt).
- **T047 (Contract C5)**: Route-Liste vor (`3dfedfc`) und nach der Änderung identisch —
  66 Routen, `GET /api/features/:featureId/cost-breakdown` unverändert vorhanden.
- Quellcode-Gegenprobe zur Anzeige: keine Geldbetrags-Formatierung mehr in `packages/web/src`
  (`$${…}`, `toFixed(2)`, `toFixed(3)` → 0 Treffer); Tabelle in `ExecutionsView` hat 6 `<th>`
  und 6 `<td>` (ausgerichtet), Kopfzeile `Start | Art | Status | Dauer | Tokens | (Log)`;
  Summenzeile rendert `N Läufe · X Tokens · Y % gemessen` ohne hängende Trenner;
  `TestsPane` hat 3 StatCards, `ReviewPortal` die HeaderStats `Dateien`, `Zeilen`, `Audits`, `Verify`.

**Nicht ausgeführt (erfordert einen Menschen am Browser):**

Der visuelle Durchgang durch quickstart.md S1, S2, S4 (Schritte 3–4) und S5 (Schritte 1–2) —
Läufe im Browser aufklappen, `⌘F` auf `$`, Browser-Konsole auf `undefined.toFixed` prüfen — wurde
**nicht** durchgeführt: in dieser Sitzung war keine Browser-Automatisierung verfügbar. Die oben
genannten Quellcode- und API-Prüfungen decken dieselben Aussagen maschinell ab, ersetzen aber
nicht den Blick auf die gerenderte Oberfläche. Ebenfalls offen: der in T044 Schritt 5 verlangte
**neue** Lauf gegen die Bestandsdatenbank (`cost_usd IS NULL` für die neueste Zeile) — er setzt
einen echten Agent-Lauf mit dem neuen Code voraus.
