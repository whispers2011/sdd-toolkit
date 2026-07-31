# Phase 1 — Datenmodell

**Feature**: Geschätzte Kosten aus den Läufen entfernen | **Datum**: 2026-07-26

Dieses Feature führt keine Entität ein. Es entfernt aus bestehenden Entitäten genau ein Konzept:
den abgeleiteten Geldbetrag. Alles unten Aufgeführte ist eine Feld-**Streichung**; jedes nicht
aufgeführte Feld bleibt bitgenau unverändert (FR-010).

Legende: ~~durchgestrichen~~ = entfällt.

---

## 1. Ausführung — `ExecutionRecord`

`packages/shared/src/types.ts:258` · gespiegelt als `ExecutionInfo` in `packages/web/src/api.ts:448`

Spec-Entität *Ausführung*: eine einzelne Agent-Ausführung innerhalb eines Laufs.

| Feld | Typ | Änderung |
|------|-----|----------|
| `id`, `projectId`, `featureId` | `string` / `string \| null` | — |
| `kind` | `'phase' \| 'verify' \| 'review' \| 'conflict_resolution' \| 'chat' \| 'chat_work'` | — |
| `phase` | `WorkflowPhase \| null` | — |
| `status` | `'running' \| 'succeeded' \| 'failed' \| 'orphaned'` | — |
| `startedAt`, `finishedAt`, `exitCode` | `number` / `number \| null` | — |
| ~~`costUsd`~~ | ~~`number \| null`~~ | **entfällt** (FR-009) |
| `tokens` | `number \| null` | — |
| `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens` | `number \| null` | — |
| `tokensSource` | `'transcript' \| 'parsed' \| 'estimated' \| null` | — (FR-010) |
| `transcriptOffsetStart`, `transcriptOffsetEnd`, `transcriptPath` | — | — |
| `optContextStrategy`, `optCompression` | — | — |
| `logPath` | `string \| null` | — |

**Validierungsregel (neu)**: Das serialisierte Objekt darf den Schlüssel `costUsd` nicht besitzen —
nicht als `null`, nicht als `0`. Prüfbar über `'costUsd' in record === false`.

**Zustandsübergänge**: unverändert. `running → succeeded | failed | orphaned` über
`ExecutionRepo.finish()` / `finishWithUsage()`; lediglich das mitgeschriebene Kostenfeld entfällt
(siehe §6).

---

## 2. Lauf — `RunSummary`

`packages/shared/src/runSummary.ts:44`

Spec-Entität *Lauf*: ein Worktree/Feature, aggregiert über seine Ausführungen.

| Feld | Änderung |
|------|----------|
| `featureId`, `featureName`, `projectId`, `branch` | — |
| `integration`, `archived`, `running` | — |
| `startedAt`, `lastActivityAt` | — |
| `total: CostRollup` | Struktur schrumpft (siehe §3) |
| `byStep: RunStep[]` | `RunStep.rollup` schrumpft (siehe §3) |
| `byCategory: Record<RunCategory, CostRollup>` | Struktur schrumpft (siehe §3) |
| `sourceMix: Record<TokensSource, number>` | — (FR-010) |

`RunCategory` (`spec | coding | overhead | chat`), `RUN_CATEGORY_LABELS`, `categorizeExecution()`
und die Step-Reihenfolge `STEP_ORDER` bleiben unverändert.

---

## 3. Verbrauchs-Aggregat — `CostRollup`

`packages/shared/src/costBreakdown.ts:10` — genutzt von `runSummary.ts` (Läufe) und
`costBreakdown.ts` (Feature-Aufschlüsselung)

| Feld | Typ | Änderung |
|------|-----|----------|
| `runs` | `number` | — |
| `tokens` | `number` | — |
| `inputTokens`, `outputTokens` | `number` | — |
| `cacheReadTokens`, `cacheCreationTokens` | `number` | — |
| ~~`costUsd`~~ | ~~`number`~~ | **entfällt** (FR-009) |

Betroffene Funktionen:

- `emptyRollup()` (in `costBreakdown.ts:31` **und** `runSummary.ts:64`): Initialisierung
  `costUsd: 0` entfällt in beiden Kopien.
- `add(r, e)` (in `costBreakdown.ts:43` **und** `runSummary.ts:76`): `r.costUsd += e.costUsd ?? 0`
  entfällt in beiden Kopien.

**Invariante, die erhalten bleiben MUSS**: `Summe(byPhase) + phasenlose Läufe == total` für Tokens
und alle Token-Komponenten. Das Entfernen eines Summanden darf die übrigen Summen nicht berühren —
`runSummary.test.ts` und `costBreakdown.test.ts` sichern das ab.

**Typname**: bleibt `CostRollup` (siehe [research.md](./research.md), D5).

---

## 4. Feature-Aufschlüsselung — `FeatureCostBreakdown`

`packages/shared/src/costBreakdown.ts:20`

| Feld | Änderung |
|------|----------|
| `featureId` | — |
| `total`, `byPhase[].rollup`, `byKind[].rollup`, `byOptimization[].rollup` | Struktur schrumpft (§3) |
| `sourceMix` | — |

Keine eigenen Kostenfelder. Wird in keiner Ansicht gerendert (`api.costBreakdown()` hat keinen
Aufrufer) — fällt daher nur unter FR-009, nicht unter FR-008.

---

## 5. Agent-Lauf — `AgentRunSummary`

`packages/shared/src/types.ts` (`AgentRunSummary`, Kostenfeld auf Z. 495)

| Feld | Typ | Änderung |
|------|-----|----------|
| `verdict`, `decisionLabel`, `summary`, `reportPath` | — | — |
| `createdAt`, `finishedAt` | — | — |
| ~~`costUsd?`~~ | ~~`number \| null`~~ | **entfällt** (FR-007, FR-009) |
| `totalTokens?` | `number \| null` | — (bleibt Join-Feld aus der Execution) |
| `source?` | `'db' \| 'markdown'` | — |

Anreicherungsstellen, die entsprechend schrumpfen:

- `attachCosts()` in `server/src/api/reviewRoutes.ts:274` → gibt nur noch `totalTokens` dazu.
  Der Funktionsname wird zu `attachTokens()`, weil sein gesamter Zweck sich ändert.
- `lastRun`-Anreicherung in `server/src/api/server.ts:866` → nur noch `totalTokens`.

---

## 6. Verbrauchsmessung — `CostMetadata`, `ParsedUsage`, `TurnUsage`

### `CostMetadata` — `packages/shared/src/costMeter.ts:7`

| Feld | Änderung |
|------|----------|
| `inputTokens`, `outputTokens`, `totalTokens` | — |
| ~~`costUsd`~~ | **entfällt** |
| `model` | — (bleibt: identifiziert das Modell, nicht seinen Preis) |
| `source: 'parsed' \| 'estimated'` | — (Semantik: siehe unten) |

`meter()` behält Parsing + Token-Schätzung und verliert die Preis-Multiplikation. Die
`source`-Bestimmung stützt sich künftig ausschließlich auf Token-Treffer (`inputTokens`,
`outputTokens`, `totalTokens`) statt zusätzlich auf einen Kostentreffer — bewusst akzeptierte
Folge, siehe [research.md](./research.md), D4.

### `ParsedUsage` — `costMeter.ts:41`

| Feld | Änderung |
|------|----------|
| ~~`costUsd?`~~ | **entfällt**, samt Regex `total_cost_usd\|total cost\|cost` (Z. 54–55) |
| `inputTokens?`, `outputTokens?`, `totalTokens?`, `model?` | — |

### Gelöschte Preis-Bausteine (`costMeter.ts:72–102`)

`ModelPrice`, `MODEL_PRICES`, `DEFAULT_PRICE`, `CACHE_READ_FACTOR`, `CACHE_WRITE_FACTOR`,
`priceFor()`, `normalizeModel()` — alle konsumentenlos nach dieser Änderung.
`DEFAULT_MODEL` bleibt (setzt den Modellnamen, wenn keiner gemeldet wird).
Erhalten bleiben `stripAnsi()`, `estimateTokens()`, `parseUsage()`, `meter()`.

### `TurnUsage` — `packages/shared/src/transcriptUsage.ts:10`

Unverändert (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `model?`,
`dedupeKey?`). Ebenso `parseUsageLine()`, `sumUsage()` (inkl. Dedupe) und `hasUsage()`.

**Signaturänderung**: `usageToCost(u): { totalTokens, costUsd }` → `usageTotalTokens(u): number`.
Der verbleibende Rumpf ist die unveränderte Token-Summe
`input + output + cacheRead + cacheCreation`; der Import von `priceFor`/`CACHE_*_FACTOR` entfällt,
womit `transcriptUsage.ts` keine Abhängigkeit mehr zu `costMeter.ts` hat.

---

## 7. Chat-Nachricht — `ChatMessage`

`packages/shared/src/types.ts:430`

| Feld | Änderung |
|------|----------|
| `id`, `conversationId`, `role`, `content`, `status`, `error`, `proposal` | — |
| ~~`costUsd`~~ | **entfällt** (kein Lieferant mehr, siehe [research.md](./research.md), D7) |
| `tokens`, `createdAt` | — |

`ChatStreamEvent` (`chatStream.ts:8`), Variante `result`: ~~`costUsd: number \| null`~~ entfällt;
`text`, `isError`, `tokens`, `sessionId` bleiben.

---

## 8. Persistenz (SQLite)

`packages/server/src/db/database.ts` · `MIGRATIONS`-Array, versioniert über `PRAGMA user_version`

| Tabelle · Spalte | Änderung |
|------------------|----------|
| `executions.cost_usd REAL` (`database.ts:57`) | **Spalte bleibt im Schema.** Keine neue Migration. Wird nicht mehr geschrieben (neue Zeilen: `NULL`) und nicht mehr gelesen. |
| `chat_messages.cost_usd REAL` (`database.ts:183`) | dito |

Begründung siehe [research.md](./research.md), D2 — die Spec verzichtet ausdrücklich auf Migration
bereits erfasster Werte, und ein `DROP COLUMN` wäre auf der Nutzer-Datenbank irreversibel.

**Zugriffsstellen in `packages/server/src/db/repos.ts`, die schrumpfen:**

| Zeile | Stelle | Änderung |
|-------|--------|----------|
| 399 | `FinishUsage.costUsd?` | Feld entfällt |
| 435–436 | `finish(id, exitCode, costUsd, tokens)` | Parameter `costUsd` entfällt → `finish(id, exitCode, tokens?)` |
| 443–451 | `UPDATE executions SET … cost_usd=? …` | Spaltenzuweisung + Bind-Parameter entfallen |
| 517 | Row-Mapper `costUsd: r.cost_usd` | entfällt |
| 737 | `ChatMessageRow.cost_usd` | Feld entfällt |
| 763 | Row-Mapper `costUsd: r.cost_usd` | entfällt |
| 854 | Insert-Default `costUsd: null` | entfällt |
| 883–897 | `finishMessage(outcome.costUsd)` + `UPDATE chat_messages SET … cost_usd=?` | entfallen |

**Wichtig für FR-011**: Weil `SELECT`s nicht `SELECT *`-abhängig auf `cost_usd` bauen, sondern das
Feld im Mapper zugewiesen wird, ist das Weglassen im Mapper ausreichend. Alt-Zeilen mit gefüllter
`cost_usd`-Spalte bleiben vollständig lesbar; ihr Kostenwert erreicht nur keinen Payload mehr.

---

## 9. Schreibpfad-Signaturen (Server)

| Datei · Zeile | Vorher | Nachher |
|---------------|--------|---------|
| `services/conflictResolver.ts:24` | `Promise<{exitCode, logPath, costUsd, tokens}>` | `Promise<{exitCode, logPath, tokens}>` |
| `services/conflictResolver.ts:78–79` | `meter(...)` → `costUsd: cost.costUsd` | nur `tokens: cost.totalTokens` |
| `services/mergeQueueService.ts:425` | `finish(execId, res.exitCode, res.costUsd, res.tokens)` | `finish(execId, res.exitCode, res.tokens)` |
| `services/orchestrator.ts:704–706` | `usageToCost(usage)` → `{costUsd, tokens}` | `usageTotalTokens(usage)` → `tokens` |
| `services/orchestrator.ts:718–720` | `meter(...)` → `costUsd` | nur `tokens` |
| `services/chatService.ts:268–283` | `turnResult.costUsd ?? fallback.costUsd`; `finish(execId, 0, costUsd, tokens)`; `finish({… costUsd …})` | Kostenzeile entfällt; `finish(execId, 0, tokens)`; Message-Outcome ohne `costUsd` |
| `services/chatWorkService.ts:366` | `finish(execId, 0, cost.costUsd, cost.totalTokens)` | `finish(execId, 0, cost.totalTokens)` |
| `services/agentGateService.ts:173` | `finish(execId, verdict === 'PASS' ? 0 : 1, cost.costUsd, cost.totalTokens)` | ohne `cost.costUsd` |

Aufrufe ohne Kostenargument (`mergeQueueService.ts:228/461`, `chatService.ts:260/293/307`,
`orchestrator.ts:765`) sind von der Signaturkürzung nicht betroffen, weil `costUsd` dort schon
heute nicht übergeben wird.
