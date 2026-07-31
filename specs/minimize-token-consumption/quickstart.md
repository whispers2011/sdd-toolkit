# Quickstart & Validierung: Token-Verbrauch minimieren

End-to-End-Nachweis der drei User Stories. Referenzen: [spec.md](./spec.md), [data-model.md](./data-model.md), [contracts/](./contracts/).

## Voraussetzungen

```bash
pnpm install
pnpm typecheck && pnpm test    # Baseline grün
```
- Ein Ziel-Projekt mit spec-kit (`/speckit-*`) im SDD-Toolkit registriert.
- Ein **reproduzierbares Referenz-Feature** für den A/B-Nachweis (stabiler Ablauf, z. B. ein kleines, deterministisches Feature).

## Szenario 1 — Verbrauch pro Feature & Phase (US1 / P1)

1. Ein bereits gebautes Feature auswählen.
2. `GET /api/features/:featureId/cost-breakdown` aufrufen (bzw. Executions-View öffnen).
3. **Erwartet**:
   - Gesamt-Tokens/-Kosten + Aufschlüsselung je Phase (specify…implement) und je Art (verify/review/…).
   - Summe der Phasen + phasenlose Läufe == Gesamt (Invariante).
   - Jede Zeile trägt ein Quelle-Badge (`transcript`/`parsed`/`estimated`); `sourceMix` sichtbar.
   - Sichtbar in < 30 s ohne manuelles Rechnen (SC-003).

**Prüft**: FR-001, FR-002, FR-003, SC-003, SC-004.

## Szenario 2 — A/B: smarte Kontext-Übergabe (US2 / P2)

1. Referenz-Feature **Lauf A** mit `optimization = { contextStrategy:'full', compression:'off' }` komplett bauen (specify→implement).
2. Denselben Ablauf **Lauf B** mit `{ contextStrategy:'compact' /* oder 'fresh' */, compression:'deterministic' }` bauen.
3. `GET …/cost-breakdown?groupByOptimization=true` vergleichen.
4. **Erwartet**:
   - Gesamt-Tokens(B) ≤ 0,7 × Gesamt-Tokens(A) → **≥ 30 % Reduktion** (SC-001).
   - Rückgang v. a. in `cacheReadTokens` der schweren Phasen (`plan`, `implement`) (SC-006).
   - Lauf B besteht dieselben Gates: Spec-Checkliste, Review-Gate `VERDICT: PASS`, Verify-Pipeline — identisch zu A (SC-002).

**Prüft**: FR-004, FR-007, FR-011, SC-001, SC-002, SC-006.

## Szenario 3 — Verdichtung signalarmer Inhalte (US3 / P3)

1. Projektwissen mit großem, signalarmem Body anlegen (Boilerplate/Logs/Wiederholungen).
2. Phase mit `compression:'deterministic'` starten.
3. **Erwartet**: materialisierter Kontext kleiner, relevante Fakten erhalten; `CompressionReport` listet Ausgelassenes (auditierbar).
4. Mit `compression:'llm'` prüfen: Ergebnis wird nur übernommen, wenn Netto-Ersparnis > LLM-Kosten; sonst deterministischer Fallback.

**Prüft**: FR-005, FR-009, Edge Case „LLM ohne Netto-Ersparnis".

## Szenario 4 — Sicherheit & Reversibilität (Guards)

1. `optimization` global auf `{ full, off }` zurücksetzen → Verhalten bit-identisch zu heute (SC-005, FR-008).
2. Downstream-Phase mit fehlendem Vorartefakt starten → Optimizer fällt auf `full` zurück (`fellBackToFull=true`, protokolliert), Phase läuft normal (FR-010).
3. verify/review/conflict-Lauf → wird gemessen, aber **nicht** reduziert (FR-011); verfälscht den A/B-Delta nicht.

**Prüft**: FR-006, FR-008, FR-010, FR-011, SC-005.

## Automatisierte Checks

```bash
pnpm test        # neue Unit-Tests: transcriptUsage, contextCompressor, costBreakdown, resolveOptimization
                 # + Server: Migration additiv, aggregateByFeature, Orchestrator-Reset/Guard
pnpm typecheck
```

## Definition of Done (Validierung)

- [ ] Szenario 1–4 wie beschrieben reproduzierbar.
- [ ] A/B zeigt ≥ 30 % Tokenreduktion bei identischem Gate-Ergebnis.
- [ ] Quelle-Badge für jeden Wert; Anteil `transcript` > 0 (autoritative Messung greift).
- [ ] `{ full, off }` stellt Alt-Verhalten wieder her.
