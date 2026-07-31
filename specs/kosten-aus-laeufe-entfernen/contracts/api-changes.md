# Phase 1 — Interface-Kontrakte

**Feature**: Geschätzte Kosten aus den Läufen entfernen | **Datum**: 2026-07-26

Das Toolkit stellt eine HTTP-JSON-API (Fastify) bereit, die ausschließlich von der mitgelieferten
SPA konsumiert wird (`packages/web`). Beide Teile werden gemeinsam ausgeliefert — es gibt keine
externen Clients und damit keinen Bedarf für Versionierung oder Deprecation-Fenster.

**Art der Änderung**: Es wird **keine Route hinzugefügt, entfernt oder umbenannt.** Sechs Endpoints
liefern schrumpfende Payloads: das Feld `costUsd` fällt weg. Alle anderen Felder — insbesondere
`tokens`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `tokensSource`,
`sourceMix`, `totalTokens` — bleiben unverändert (FR-010).

Feldstrukturen im Detail: siehe [data-model.md](../data-model.md).

---

## Geänderte Endpoints

### 1. `GET /api/runs` — Läufe-Sicht (US1, FR-001 … FR-003)

`server.ts:1197` → `buildRunSummaries(features, executions)`

```diff
 {
   "runs": [
     {
       "featureId": "…", "featureName": "…", "projectId": "…", "branch": "…",
       "integration": "none", "archived": false, "running": false,
       "startedAt": 1769000000000, "lastActivityAt": 1769000900000,
       "total": {
         "runs": 12, "tokens": 482913,
         "inputTokens": 1200, "outputTokens": 8400,
         "cacheReadTokens": 461000, "cacheCreationTokens": 12313,
-        "costUsd": 1.87
       },
       "byStep":     [ { "key": "plan", "category": "spec", "rollup": { … /* ohne costUsd */ } } ],
       "byCategory": { "spec": { … }, "coding": { … }, "overhead": { … }, "chat": { … } },
       "sourceMix":  { "transcript": 0.75, "parsed": 0.0, "estimated": 0.25 }
     }
   ]
 }
```

`costUsd` entfällt in **jedem** `CostRollup`: `total`, `byStep[].rollup` und allen vier Einträgen
von `byCategory`.

### 2. `GET /api/executions?featureId=<id>` — Einzel-Ausführungen (US1, FR-004)

`server.ts:1192` → `ExecutionRecord[]`

```diff
 [
   {
     "id": "…", "projectId": "…", "featureId": "…",
     "kind": "phase", "phase": "implement",
     "status": "succeeded",
     "startedAt": 1769000000000, "finishedAt": 1769000420000, "exitCode": 0,
-    "costUsd": 0.412,
     "tokens": 138221,
     "inputTokens": 900, "outputTokens": 4100,
     "cacheReadTokens": 131000, "cacheCreationTokens": 2221,
     "tokensSource": "transcript",
     "logPath": "…"
   }
 ]
```

### 3. `GET /api/features/:featureId/cost-breakdown` — Feature-Aufschlüsselung (US3, FR-009)

`server.ts:1202` → `FeatureCostBreakdown`. Optional `?groupByOptimization=true`.

Route und Typname bleiben unverändert (siehe [research.md](../research.md), D5). `costUsd` entfällt
in `total`, `byPhase[].rollup`, `byKind[].rollup` und `byOptimization[].rollup`. `sourceMix` bleibt.

Dieser Endpoint wird von keiner Ansicht konsumiert (`api.costBreakdown()` in `web/api.ts:177` hat
keinen Aufrufer) — er fällt nur unter FR-009.

### 4. `GET /api/features/:id/agents` — Agent-Auswahl (US2, FR-007)

`server.ts:850` → `FeatureAgentView[]`, angereichert um den letzten Lauf

```diff
 [
   {
     "agent": { … },
     "decision": "auto",
     "effective": true,
     "lastRun": {
       "verdict": "PASS", "decisionLabel": null, "summary": "…",
       "reportPath": "specs/…/reviews/security.md",
       "createdAt": 1769000000000, "finishedAt": 1769000120000,
-      "costUsd": 0.07,
       "totalTokens": 24310
     }
   }
 ]
```

Anreicherung in `server.ts:866`: die Zeile `costUsd: deps.executions.get(…)?.costUsd ?? null`
entfällt, `totalTokens` bleibt.

### 5. `GET /api/features/:id/agent-runs` — Audit-Läufe (US2, FR-007)

`reviewRoutes.ts:252` → `AgentRunSummary[]`, angereichert über `attachCosts()`

Gleiche Feldstreichung wie unter 4. `attachCosts()` (`reviewRoutes.ts:275`) wird zu
`attachTokens()` und gibt nur noch `{ ...run, totalTokens: exec.tokens }` zurück. Der
Markdown-Fallback für Alt-Reviews (`source: 'markdown'`) ist unberührt — er hat ohnehin keine
verknüpfte Execution und trug daher schon bisher keinen Kostenwert (FR-011).

`GET /api/features/:id/agent-runs/:runId/report` ist unverändert (liefert nur Markdown-Inhalt).

### 6. `GET /api/projects/:id/chat` und `POST /api/projects/:id/chat/messages` — Chat (D7)

`server.ts:395` / `server.ts:437` → enthalten `ChatMessage[]`

```diff
 {
   "id": "…", "conversationId": "…", "role": "assistant",
   "content": "…", "status": "complete", "error": null, "proposal": null,
-  "costUsd": 0.013,
   "tokens": 8412,
   "createdAt": 1769000000000
 }
```

Nicht nutzersichtbar (keine Chat-Ansicht rendert den Wert), aber ohne Lieferant nach Entfall der
Kostenberechnung.

---

## Ausdrücklich unveränderte Kontrakte

| Endpoint / Kanal | Warum unverändert |
|------------------|-------------------|
| `GET /api/executions/:id/log` | liefert reinen Log-Text (`{ log }`) — Kostenwerte, die *im Log-Text* der CLI stehen, sind Fremdinhalt und werden nicht gefiltert |
| `GET /api/executions/:id/resolution-diff` | Diff-Inhalt |
| `GET /api/review/overview?projectId=` | `ReviewOverviewItem` trägt keine Kostenfelder |
| SSE-Event-Stream (`events.ts`) | keine Kostenfelder im Payload |
| alle übrigen Endpoints | kein Bezug zu Kosten |

**Hinweis zum Log-Endpoint**: FR-008 bezieht sich auf Kennzahlen, die das Toolkit *ausweist*. Ein
Lauf-Log kann eine von der CLI selbst ausgegebene Kostenzeile enthalten; sie zu entfernen würde
bedeuten, das Log zu verfälschen. Das ist bewusst nicht Teil des Scopes.

---

## Kontrakt-Zusicherungen (prüfbar)

| ID | Zusicherung | Nachweis |
|----|-------------|----------|
| C1 | Keine Antwort der sechs Endpoints enthält einen Schlüssel `costUsd` — auf keiner Verschachtelungsebene | `JSON.stringify(payload).includes('costUsd') === false`; siehe [quickstart.md](../quickstart.md), S3 |
| C2 | Kein Antwort-Payload enthält ein neu eingeführtes Ersatzfeld (kein `costEur`, `estimatedCost`, `priceHint`, …) | Code-Review + Referenzsuche |
| C3 | Token-Felder und `sourceMix`/`tokensSource` sind wertgleich zum Verhalten vor der Änderung | `runSummary.test.ts`, `costBreakdown.test.ts`, `transcriptUsage.test.ts` |
| C4 | Alle sechs Endpoints antworten für Alt-Daten (Läufe mit gefüllter `cost_usd`-Spalte) mit HTTP 200 und vollständigen Token-/Log-Angaben | [quickstart.md](../quickstart.md), S4 |
| C5 | Kein Endpoint wurde umbenannt oder entfernt; die Route-Liste ist identisch | `grep` auf `app.get(`/`app.post(` vor/nach der Änderung |
