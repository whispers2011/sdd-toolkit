# HTTP-API-Contract: Review-Portal & Agent-Verwaltung

Neue Routen-Datei `packages/server/src/api/reviewRoutes.ts` (Review-Block) + Umbauten in
`server.ts` (Agents-Block ersetzt Personas-Block, approve-merge/reject-review erweitert).
Alle Antworten JSON; Fehler als `{ error: string }` mit passendem Status.

## Review-Portal (reviewRoutes.ts)

### `GET /api/review/overview?projectId=<id>`

→ `200 ReviewOverviewItem[]` — Features des Projekts in Stages
`awaiting_human_review | verify_failed | gate_failed | conflict_escalated`, mit
Diff-Kennzahlen (numstat), Audit-Zählern (aus agent_runs), offenen Kommentaren, Verify-Status.

### `GET /api/projects/:id/branches`

→ `200 BranchInfo[]` — via `git for-each-ref refs/heads`; markiert defaultBranch und
Feature-Branches.

### `GET /api/features/:id/tree`

→ `200 { files: string[] }` — `git ls-files -co --exclude-standard` im Feature-Worktree.
`409` wenn kein Worktree existiert.

### `GET /api/features/:id/file?path=<relpath>`

→ `200 { path, content, mtimeMs, size }` | `413` > 2 MB | `415` binär |
`400` Pfad-Traversal (Auflösung muss im Worktree bleiben) | `404` fehlt.

### `PUT /api/features/:id/file`

Body `{ path, content, baseMtimeMs }` →
`200 { mtimeMs }` | `409 { error, currentMtimeMs }` bei Fremdänderung (mtime-Protokoll wie
featureArtifacts) | `409` wenn Feature nicht `awaiting_human_review` | Guards wie GET.

### Kommentare

- `GET /api/features/:id/comments` → `200 ReviewComment[]`
- `POST /api/features/:id/comments` Body `{ filePath?, line?, side?, text }` → `201 ReviewComment`
- `PATCH /api/comments/:id` Body `{ text? , status? }` → `200 ReviewComment`
- `DELETE /api/comments/:id` → `204`
- Jede Mutation broadcastet WS `review_comments_updated`.

### Audits

- `GET /api/features/:id/agent-runs` → `200 AgentRunSummary[]` (runs-first aus agent_runs
  + costUsd/totalTokens via executions-Join; Markdown-Fallback für Vor-Migrations-Reviews:
  specs/<feature>/reviews/*.md + parseVerdict, gekennzeichnet `source:'markdown'`).
- `GET /api/features/:id/agent-runs/:runId/report` → `200 { content }` — Berichts-Markdown.

## Integrations-Entscheidung (server.ts, Umbau)

### `POST /api/features/:id/approve-merge`

Body `ApproveMergeRequest = { targetBranch?: string; createBranch?: boolean }` (leer =
defaultBranch, heutiges Verhalten).
Validierung: Feature in `awaiting_human_review` (sonst 409); `isValidBranchName` (sonst 400);
createBranch ⇒ Branch darf nicht existieren; sonst ⇒ muss existieren und ≠ feature.branch.
Wirkung: setIntegrationTarget (NULL wenn == defaultBranch); uncommittete Reviewer-Edits →
Commit `review(<name>): reviewer-korrekturen` ⇒ enqueue mit forceVerify=1; attention resolve.
→ `200 { queued: true }`.

### `POST /api/features/:id/reject-review`

Body `{ comment?: string }` — kompiliert offene review_comments + Freitext via
`compileReviewPrompt` zu deutschem Arbeitsauftrag an die Feature-Konsole; setzt
integration_target := NULL. → `200`.

## Agents (server.ts, ersetzt `/api/personas`-Block)

- `GET /api/agents?projectId=<id|global>` → `200 AgentDefinition[]`
- `PUT /api/agents` Body `AgentDefinition` (upsert; Validierung trigger_phase ⇔ trigger_kind)
  → `200 AgentDefinition`
- `DELETE /api/agents/:id` → `204`
- `GET /api/features/:id/agents` → `200 { agent: AgentDefinition, decision:
  'auto'|'include'|'exclude', effective: boolean, lastRun?: AgentRunSummary }[]`
  (Union global∪Projekt + Selektion)
- `PUT /api/features/:id/agents/selection` Body `{ agentId, decision: 'include'|'exclude'|'auto' }`
  → `200` ('auto' löscht die Zeile)
- `POST /api/features/:id/agents/:agentId/run` → `202 { runId }` (manueller Lauf, async) |
  `409` ohne Worktree
- Phasenstart-Antwort erweitert: `POST .../phases/:phase/...` kann `{ gateRunning: true }`
  liefern, wenn ein before_phase-Gate den Start deferrt.

## Bestehende Endpunkte (unverändert)

`GET /features/:id/diff`, `GET /features/:id/diff/file`, `GET /executions/:id/resolution-diff`,
`POST /features/:id/integrate|retry-integration|mark-done`, `GET /api/runs` — werden vom
Portal weiterverwendet.
