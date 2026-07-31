# Contract: Transkript-Usage-Parser (pure, `@sdd/shared`)

Autoritative Token-Messung aus dem Claude-Transkript-JSONL (P1, FR-002).

## API

```
parseUsageLine(jsonlLine: string): TurnUsage | null
sumUsage(lines: string[]): TurnUsage
usageToCost(u: TurnUsage): { totalTokens: number; costUsd: number }
```

`TurnUsage { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, model? }` (data-model.md §4).

## Eingabeformat (bestätigt per Stichprobe)

`assistant`-Zeile enthält `message.usage`:
```json
{"type":"assistant","timestamp":"…","message":{"model":"claude-…","usage":{
  "input_tokens":2,"cache_creation_input_tokens":10496,
  "cache_read_input_tokens":20874,"output_tokens":204}}}
```

## Verträge

- **Nicht-Usage-Zeilen** (`user`, `tool_result`, Statuszeilen, Leerzeilen, kaputte JSON) → `parseUsageLine` gibt `null`; `sumUsage` überspringt sie robust (kein Wurf).
- **Summierung**: `sumUsage` addiert alle Komponenten über alle Usage-Zeilen des Fensters (mehrere Turns/Tool-Iterationen einer Phase).
- **totalTokens** = `input + output + cacheRead + cacheCreation`.
- **Kosten**: `usageToCost` nutzt `priceFor(model)`/`MODEL_PRICES` aus `costMeter.ts:77-98`. Cache-Read wird wie Input-Tokens bepreist (grobe, dokumentierte Näherung — konsistent mit bestehender Preis-Heuristik).
- **Model-Ableitung**: aus `message.model` je Zeile; bei Konflikt letzter gewinnt; fehlt → `DEFAULT_MODEL`.

## Integration (Server, nicht Teil des pure-Vertrags)

- `startPhaseRun`/`startAgentForApprovedChain` halten `transcript_offset_start` fest (Dateigröße des via `locateTranscript` gefundenen JSONL).
- `handleTurnCompleted` liest Delta ab Offset (Muster `TranscriptWatcher.drain`, `transcriptWatcher.ts:82-91`), `sumUsage`, `usageToCost` → `ExecutionRepo.finishWithUsage(..., source='transcript')`.
- Kein Transkript/keine Usage → Fallback `meter()` (`costMeter.ts:101`), `source='estimated'` bzw. `'parsed'`.

## Contract-Tests
- Einzelne Usage-Zeile korrekt geparst (alle 4 Komponenten).
- Gemischtes Fenster (user/assistant/tool_result/Müll) → nur Usage summiert.
- Leeres Fenster → Null-`TurnUsage`, kein Wurf.
- `usageToCost` = Referenzwert für bekanntes Modell.
