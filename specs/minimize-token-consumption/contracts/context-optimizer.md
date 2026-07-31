# Contract: Context-Optimizer (Server-Service) + Compressor (pure)

Setzt P2 (smarte Kontext-Übergabe) und P3 (Verdichtung) im Orchestrator um.

## Compressor (pure, `@sdd/shared/contextCompressor.ts`)

```
compress(text: string, opts?: { maxLogLines?: number }): { text: string; report: CompressionReport }
```
- Deterministisch & idempotent (`compress(compress(x)) == compress(x)` bzgl. Text).
- Operationen: ANSI-Strip (`stripAnsi`), Kollaps mehrfacher Leerzeilen, Zeilen-Dedup, Kürzen überlanger Code-/Log-Blöcke mit `… (n Zeilen ausgelassen)`, Boilerplate-Drop.
- `report` = `CompressionReport` (data-model.md §5), erfüllt Audit (FR-009).
- Kein Modellaufruf.

## ContextOptimizer (Server, `packages/server/src/services/contextOptimizer.ts`)

```
prepareForPhase(feature, phase, resolvedOpt): {
  resetCommand: '/clear' | '/compact' | null    // null bei 'full' oder erster Phase (specify)
  compressedPreamble: string                      // Wissens-Präambel/Bodies ggf. verdichtet
  fellBackToFull: boolean                          // Guard ausgelöst?
  report?: CompressionReport
}
```

### Verträge (Orchestrator-Integration)

- **P2 Reset** (FR-004): Bei `contextStrategy='compact'|'fresh'` und Downstream-Phase (nicht `specify`) wird `resetCommand` **vor** dem Phasen-Slash-Command über `ptys.sendPrompt` gesendet (`orchestrator.ts:194`). `full` oder `specify` → `null`.
- **Guard** (FR-010): Fehlt ein für die Phase benötigtes Vorartefakt (`artifactExists`, `services/artifacts.ts`) oder scheitert der Reset → `resetCommand=null`, `fellBackToFull=true`, protokolliert; Lauf normal fortsetzen (`full`-Verhalten).
- **P3 Verdichtung** (FR-005): Bei `compression='deterministic'` wird der materialisierte Wissens-Text/Präambel (`knowledgeService.materializeForFeature`, `knowledgeService.ts:104`) durch `compress()` geschickt. Bei `compression='llm'`: zusätzlich headless-LLM-Zusammenfassung (`buildHeadlessArgv`, `commandBuilder.ts:30`), aber nur übernehmen, wenn `report.tokensBefore - report.tokensAfter > geschätzte_LLM_Kosten_tokens`; sonst deterministisches Ergebnis (Edge Case „LLM ohne Netto-Ersparnis").
- **Scope** (FR-011): nur `kind='phase'`.
- **Gate-Neutralität** (FR-006): Der Optimizer verändert ausschließlich Reset + toolkit-injizierte Präambel — niemals die Phasen-Slash-Commands, Skills, Review-Gate- oder Verify-Logik.

### Reset-Kommandos (commandBuilder.ts, erweitert)

```
resetCommand(strategy: 'compact' | 'fresh'): string   // '/compact' bzw. '/clear'
```
Als PTY-Eingabe gesendet (bracketed paste, `commandBuilder.ts:74`), Prozess/`sessionId` unverändert → `TranscriptWatcher` bleibt gültig.

## Contract-Tests
- `compress` idempotent; entfernt Duplikate/Leerzeilen; kürzt Logs mit Marker; `report`-Zahlen konsistent (`bytesAfter ≤ bytesBefore`).
- `prepareForPhase`: `full`→`null`; `specify`→`null`; `compact`/`fresh` downstream→korrektes Kommando.
- Fehlendes Artefakt ⇒ `fellBackToFull=true`, `resetCommand=null`.
- `llm`-Verdichtung ohne Netto-Ersparnis ⇒ deterministisches Ergebnis übernommen.
