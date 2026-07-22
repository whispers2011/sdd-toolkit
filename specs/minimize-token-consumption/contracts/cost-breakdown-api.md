# Contract: Cost-Breakdown REST-API

Erweitert die bestehende Fastify-API (`packages/server/src/api/server.ts`; heute nur `GET /api/executions?featureId=`, `:890`).

## GET /api/features/:featureId/cost-breakdown

Liefert die aggregierte, nach Phase und Lauf-Art aufgeschlüsselte Verbrauchs-Sicht eines Features (P1, FR-001, SC-003).

**Path params**: `featureId` (string).

**Query params** (optional):
- `groupByOptimization=true` → zusätzlich Rollups getrennt nach `optContextStrategy` (für A/B-Nachweis, SC-001).

**200 Response** (`FeatureCostBreakdown`, siehe data-model.md §2):

```json
{
  "featureId": "0w533Ngt2u",
  "total": {
    "runs": 6, "tokens": 97447,
    "inputTokens": 0, "outputTokens": 0,
    "cacheReadTokens": 0, "cacheCreationTokens": 0,
    "costUsd": 1.46
  },
  "byPhase": [
    { "phase": "implement", "rollup": { "runs": 1, "tokens": 41279, "costUsd": 0.619, "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheCreationTokens": 0 } },
    { "phase": "plan",      "rollup": { "runs": 1, "tokens": 32473, "costUsd": 0.487, "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheCreationTokens": 0 } }
  ],
  "byKind": [
    { "kind": "phase",  "rollup": { "runs": 5, "tokens": 97447, "costUsd": 1.46, "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheCreationTokens": 0 } },
    { "kind": "review", "rollup": { "runs": 1, "tokens": 0, "costUsd": 0, "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheCreationTokens": 0 } }
  ],
  "sourceMix": { "transcript": 0.0, "parsed": 0.0, "estimated": 1.0 },
  "byOptimization": [
    { "contextStrategy": "full",    "rollup": { "runs": 5, "tokens": 97447, "costUsd": 1.46, "inputTokens":0,"outputTokens":0,"cacheReadTokens":0,"cacheCreationTokens":0 } }
  ]
}
```

`byOptimization` nur bei `groupByOptimization=true`.

**Errors**: `404` unbekanntes Feature. Leere Execution-Liste → `200` mit Null-Rollups (nicht `404`).

**Contract-Tests**:
- Summe `byPhase` + phasenlose `byKind`-Läufe == `total` (Invariante).
- Mehrere Executions derselben Phase werden summiert (`runs>1`).
- verify/review/conflict (phase=null) erscheinen in `byKind` + `total`, nicht in `byPhase`.
- `sourceMix`-Anteile summieren zu 1 (bei ≥1 Lauf).
- `groupByOptimization=true` liefert je aktiver Strategie einen Rollup.

## GET /api/executions?featureId= (unverändert)

Bleibt bestehen (Rohliste). Wird durch die Aggregation ergänzt, nicht ersetzt.
