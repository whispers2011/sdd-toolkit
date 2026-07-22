# Phase 1 – Data Model: Token-Verbrauch im SDD-Flow minimieren

Additive Änderungen an bestehenden Strukturen; keine Umbenennungen, keine Löschungen. Migrationen folgen dem Muster in `packages/server/src/db/database.ts` (nummerierte, transaktionale `MIGRATIONS`, nullable-Spalten).

---

## 1. Execution (erweitert)

Bestehend: `ExecutionRecord` (`packages/shared/src/types.ts:169-182`), Tabelle `executions` (`database.ts:47-59` + WP3 `tokens`, `:94`).

**Neue Felder** (alle nullable, additiv):

| Feld (TS) | Spalte (SQL) | Typ | Zweck |
|-----------|--------------|-----|-------|
| `inputTokens` | `input_tokens` | INTEGER? | Autoritativ aus Transkript |
| `outputTokens` | `output_tokens` | INTEGER? | Autoritativ aus Transkript |
| `cacheReadTokens` | `cache_read_tokens` | INTEGER? | Akkumulierter Kontext (Kern-Signal für P2) |
| `cacheCreationTokens` | `cache_creation_tokens` | INTEGER? | Kontext-Aufbau |
| `tokensSource` | `tokens_source` | TEXT? | `'transcript' \| 'parsed' \| 'estimated'` |
| `transcriptOffsetStart` | `transcript_offset_start` | INTEGER? | Byte-Offset bei Phasenstart (Attribution) |
| `optContextStrategy` | `opt_context_strategy` | TEXT? | Aktive Strategie beim Lauf (`full\|compact\|fresh`) |
| `optCompression` | `opt_compression` | TEXT? | Aktive Verdichtung beim Lauf (`off\|deterministic\|llm`) |

Bestehende Felder `tokens` (Gesamt) und `costUsd` bleiben; `tokens` = Summe der Komponenten, wenn `tokensSource='transcript'`.

**Validierungsregeln**:
- `tokensSource='transcript'` ⇒ mindestens `outputTokens` gesetzt.
- Token-Komponenten ≥ 0; `null` erlaubt (Lauf ohne Daten).
- `optContextStrategy`/`optCompression` nur für `kind='phase'` gesetzt (FR-011); sonst `null`.

**Lebenszyklus**: `start()` schreibt `running` + `transcript_offset_start`; `finishWithUsage()` schreibt Komponenten + Quelle + Kosten + Status (ersetzt/erweitert `finish()`, `repos.ts:324-328`).

---

## 2. FeatureCostBreakdown (neu, abgeleitet — nicht persistiert)

Pure Aggregation über `executions` eines Features (`packages/shared/src/costBreakdown.ts`).

```
FeatureCostBreakdown {
  featureId: string
  total: CostRollup
  byPhase: { phase: WorkflowPhase; rollup: CostRollup }[]   // specify…implement
  byKind:  { kind: ExecutionKind;  rollup: CostRollup }[]    // phase|verify|review|conflict_resolution|chat|chat_work
  sourceMix: { transcript: number; parsed: number; estimated: number }  // Anteil je Quelle
}

CostRollup {
  runs: number
  tokens: number
  inputTokens; outputTokens; cacheReadTokens; cacheCreationTokens: number
  costUsd: number
}
```

**Regeln**:
- Mehrere Läufe je Phase werden summiert (FR-001, Acceptance-Szenario 2).
- Nachgelagerte Läufe ohne `phase` (verify/review/conflict, `phase=null`) erscheinen unter `byKind`, gehen in `total` ein und nicht verloren (FR-001, Szenario 4).
- `total` = Summe aller Executions des Features; `byPhase`-Summe + phasenlose `byKind`-Läufe == `total`.

---

## 3. OptimizationSettings (neu)

`packages/shared/src/optimization.ts`, analog zu `AutomationSettings` (`types.ts:46-73`).

```
OptimizationSettings {
  contextStrategy: 'full' | 'compact' | 'fresh'
  compression:     'off'  | 'deterministic' | 'llm'
}

OPTIMIZATION_OFF_DEFAULTS   = { contextStrategy: 'full',    compression: 'off' }           // == heutiges Verhalten
OPTIMIZATION_DEFAULTS       = { contextStrategy: 'compact', compression: 'deterministic' } // erste Ausbaustufe

resolveOptimization(global, projectPartial, featurePartial): OptimizationSettings
  // Präzedenz global → Projekt → Feature (wie resolveAutomation, types.ts:273)
```

**Persistenz** (additiv):
- Global: `settings`-Key `optimization` (JSON), via `SettingsRepo` (Muster wie `getAutomation`).
- Projekt: neue JSON-Spalte `projects.optimization TEXT NOT NULL DEFAULT '{}'` (Partial).
- Feature: neue JSON-Spalte `features.optimization TEXT NOT NULL DEFAULT '{}'` (Partial).

**Validierung**: unbekannte Enum-Werte → auf Default zurückfallen (defensiv); leeres Partial `{}` = Erben.

**Reversibilität (FR-008)**: `OPTIMIZATION_OFF_DEFAULTS` global setzen ⇒ bit-identisches Alt-Verhalten.

---

## 4. TranscriptUsage (neu, transient)

`packages/shared/src/transcriptUsage.ts` — pure Extraktion.

```
TurnUsage {
  inputTokens; outputTokens; cacheReadTokens; cacheCreationTokens: number
  model?: string
}

parseUsageLine(jsonlLine: string): TurnUsage | null   // 'assistant'-Zeile mit message.usage; sonst null
sumUsage(lines: string[]): TurnUsage                    // robust ggü. kaputten/fremden Zeilen
usageToCost(u: TurnUsage): { totalTokens: number; costUsd: number }  // nutzt MODEL_PRICES/priceFor aus costMeter.ts
```

Feld-Mapping aus bestätigter Transkript-Stichprobe: `message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`.

---

## 5. CompressionReport (neu, transient)

`packages/shared/src/contextCompressor.ts` — pure Verdichtung + Audit (FR-009).

```
compress(text, opts): { text: string; report: CompressionReport }

CompressionReport {
  bytesBefore; bytesAfter: number
  tokensBefore; tokensAfter: number        // via estimateTokens (costMeter.ts)
  elided: { reason: 'dedup'|'blank'|'log-truncation'|'boilerplate'; count: number }[]
}
```

Determinismus: gleiche Eingabe → gleiche Ausgabe (idempotent bei erneuter Anwendung). Kein Modellaufruf im `deterministic`-Pfad.

---

## Entity-Beziehungen

```
Project 1─* Feature 1─* Execution
                         └─(aggregiert)→ FeatureCostBreakdown
OptimizationSettings: global(settings) ⊕ Project.optimization ⊕ Feature.optimization → resolveOptimization
Execution.optContextStrategy/optCompression = Snapshot der aufgelösten Settings zum Startzeitpunkt (A/B, SC-001)
TranscriptUsage → speist Execution.*Tokens (source='transcript')
CompressionReport → Audit-Log (FR-009), optional referenziert
```
