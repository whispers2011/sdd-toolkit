# Data Model: Review-Portal & Agent-Verwaltung

**Phase 1 Output** — Tabellen (SQLite, `packages/server/src/db/database.ts`), Shared-Typen
(`packages/shared/src/types.ts`) und Zustandsübergänge. Migrations-Reihenfolge: **erst
Migration B (Agents), dann Migration A (Review)** — B benennt `personas` um, A hängt nur an.

## Migration B: Agents

### Tabelle `agents` (aus `personas` via RENAME, verlustfrei)

```sql
ALTER TABLE personas RENAME TO agents;
ALTER TABLE agents ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN model TEXT;                -- NULL = CLI-Default
ALTER TABLE agents ADD COLUMN trigger_kind TEXT NOT NULL DEFAULT 'review_gate'
  CHECK (trigger_kind IN ('manual','review_gate','after_phase','before_phase'));
ALTER TABLE agents ADD COLUMN trigger_phase TEXT;        -- nur bei after_/before_phase
ALTER TABLE agents ADD COLUMN blocking INTEGER NOT NULL DEFAULT 1;  -- 0 = advisory
```

Bestandsspalten bleiben: `id` (PK, Slug), `project_id` (NULL = global, FK projects CASCADE),
`name`, `prompt`, `sort_order`, `enabled`. Alt-Personas werden durch die Defaults exakt zu
heutigem Verhalten: blockierende review_gate-Agents. Zusätzlich: `UPDATE` der zwei
Alt-Seeds (`default-code-review`, `default-security-review`) mit `description`.

**Validierungsregeln** (Repo/API-Ebene): `trigger_phase` PFLICHT wenn trigger_kind IN
(after_phase, before_phase), sonst NULL; trigger_phase ∈ FeaturePhase; model Freitext
(an CLI durchgereicht); name nicht leer.

### Tabelle `agent_feature_selection` (Muster: `knowledge_feature_selection`)

```sql
CREATE TABLE IF NOT EXISTS agent_feature_selection (
  feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  decision   TEXT NOT NULL CHECK (decision IN ('include','exclude')),
  PRIMARY KEY (feature_id, agent_id)
);
```

Kein Eintrag = „auto" (enabled-Flag des Agents entscheidet).

### Tabelle `agent_runs`

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agent_name     TEXT NOT NULL,              -- Snapshot (Agent löschbar)
  project_id     TEXT NOT NULL,
  feature_id     TEXT NOT NULL,
  execution_id   TEXT,                       -- 1:1-Link, Kosten/Token bleiben dort
  trigger_kind   TEXT NOT NULL,
  trigger_phase  TEXT,
  blocking       INTEGER NOT NULL,
  verdict        TEXT,                       -- 'PASS' | 'FAIL' | NULL = unklar
  decision_label TEXT,                       -- z. B. 'FREIGEGEBEN MIT ÄNDERUNGEN'
  summary        TEXT,
  report_path    TEXT,                       -- specs/<feature>/reviews/<agent-id>.md
  created_at     TEXT NOT NULL,
  finished_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_feature ON agent_runs(feature_id, created_at);
```

### Seeds (global, deutsch, in Migration B)

| id | Name | trigger | blocking | sort_order |
|---|---|---|---|---|
| `default-dor-gate` | DoR-Gate (Definition of Ready) | before_phase:implement | 1 | 0 |
| `default-plan-quality` | Plan-Qualitätsreview | after_phase:plan | 1 | 0 |
| `default-doku-policy` | Kommentar- & Doku-Policy | review_gate | 0 (advisory) | 2 |

Prompts: DoR prüft spec/plan/tasks auf offene Fragen/`[NEEDS CLARIFICATION]`/unentschiedene
Annahmen/prüfbare Akzeptanzkriterien (FAIL ⇒ nummerierte Fragenliste). Plan-Quality =
eingedampfte Fassung von `docs/solution-plan-quality-review.md` (~80–100 Zeilen, in Migration
eingebettet; Ausgabe GESAMTENTSCHEIDUNG + ZUSAMMENFASSUNG + FREIGABE ERFORDERLICH-Zeilen +
VERDICT-Mapping). Doku-Policy prüft Diff auf Meta-Kommentare/redundante DocBlocks/
Ticketnummern-Historie im Code (Rationale gehört in Commit-Messages; git-Historie LESEN statt
in Dateien schreiben).

## Migration A: Review

```sql
CREATE TABLE IF NOT EXISTS review_comments (
  id          TEXT PRIMARY KEY,
  feature_id  TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  file_path   TEXT,                          -- NULL = Feature-genereller Kommentar
  line        INTEGER,                       -- NULL = Datei-genereller Kommentar
  side        TEXT CHECK (side IN ('old','new')),
  text        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_comments_feature
  ON review_comments(feature_id, status);

ALTER TABLE features    ADD COLUMN integration_target TEXT;      -- NULL = defaultBranch
ALTER TABLE merge_queue ADD COLUMN force_verify INTEGER NOT NULL DEFAULT 0;
```

**Invarianten**: `line` nur mit `file_path`; `side` nur mit `line`. `integration_target` wird
bei reject-review auf NULL zurückgesetzt; NULL wenn gewähltes Ziel == defaultBranch
(Normalisierung in approveForMerge).

## Shared-Typen (packages/shared/src/types.ts)

```ts
export type AgentTriggerKind = 'manual' | 'review_gate' | 'after_phase' | 'before_phase';
export interface AgentTrigger { kind: AgentTriggerKind; phase?: FeaturePhase }
export interface AgentDefinition {
  id: string; projectId: string | null; name: string; description: string;
  prompt: string; model: string | null; trigger: AgentTrigger;
  blocking: boolean; enabled: boolean; sortOrder: number;
}
export type AgentFeatureDecision = 'include' | 'exclude';
export interface AgentRunSummary {
  id: string; agentId: string | null; agentName: string; featureId: string;
  executionId: string | null; trigger: AgentTrigger; blocking: boolean;
  verdict: 'PASS' | 'FAIL' | null; decisionLabel: string | null;
  summary: string | null; reportPath: string | null;
  createdAt: string; finishedAt: string | null;
  costUsd?: number | null; totalTokens?: number | null;   // Join aus executions
}
export interface ReviewComment {
  id: string; featureId: string; filePath: string | null; line: number | null;
  side: 'old' | 'new' | null; text: string; status: 'open' | 'resolved';
  createdAt: string; resolvedAt: string | null;
}
export interface ReviewOverviewItem {
  feature: FeatureSummary;                    // bestehender Typ
  stage: IntegrationStage;                    // eine der 4 Review-Stages
  filesChanged: number; additions: number; deletions: number;
  audits: { passed: number; failed: number; total: number };
  openComments: number;
  verify: { status: 'passed' | 'failed' | 'none'; executionId?: string };
}
export interface BranchInfo { name: string; isDefault: boolean; isFeatureBranch: boolean }
export interface ApproveMergeRequest { targetBranch?: string; createBranch?: boolean }
// AttentionKind erweitert:
export type AttentionKind = /* bestehende */ | 'phase_gate_failed' | 'approval_required';
```

## Zustandsübergänge

### Integration mit Zielwahl (Erweiterung, keine neuen Stages)

```
awaiting_human_review
  │ approveForMerge({targetBranch?, createBranch?})
  │   ├─ validate(name) ─✗→ 400, Stage unverändert
  │   ├─ setIntegrationTarget(NULL wenn target == defaultBranch)
  │   ├─ Reviewer-Edits? → commit `review(...): reviewer-korrekturen` → forceVerify=1
  │   └─ enqueue → queued
  ▼
queued → merging: rebaseOnto(target existiert ? target : defaultBranch)
  ├─ forceVerify || attempts>0 → Re-Verify (FAIL → verify_failed)
  ├─ ensureBranch(target, base=defaultBranch)   # idempotent
  └─ mergeIntoTarget(...)                       # Haupt-Checkout oder Tmp-Worktree
      → merged (Done-Badge „→ <ziel>" wenn ziel ≠ defaultBranch)

reject-review: → none + integration_target := NULL
              + compileReviewPrompt(offene Kommentare, Freitext) → Feature-Konsole
Self-Heal (reconcile/finalizeMerged/cleanupMerged): prüft gegen integration_target;
  Ziel extern gelöscht → safeOnly überspringt mit Warnung.
```

### Phasen-Gates (Orchestrator, phaseMachine unverändert)

```
after_phase:  Phase X abgeschlossen (handleTurnCompleted, nach savePhases)
  └─ Gates? → runTrigger(after_phase:X)
       PASS  → normaler Auto-Progress
       FAIL(blocking) → Phase bleibt awaiting_review, KEIN Auto-Progress,
                        Attention phase_gate_failed (Human-Override: manuelles Approve)
       FAIL(advisory) → nur verbucht, Fortschritt normal

before_phase: startPhaseRun(Y) angefordert
  └─ Gates && !skipGates → Phase bleibt idle, runningGates[feature+Y] = true,
       Bus agent_gate{status:'running'} … Gate-Ergebnis:
       PASS → startPhaseRun(Y, {skipGates:true})
       FAIL(blocking) → kein Start, Attention phase_gate_failed
     HTTP-Antwort sofort {gateRunning:true}
  Crash während Gate → Phase schlicht ungestartet (nichts zu heilen)

approval_required: Bericht enthält FREIGABE ERFORDERLICH-Zeilen oder
  GESAMTENTSCHEIDUNG: FREIGEGEBEN MIT ÄNDERUNGEN → Attention-Item (auch bei PASS)
Attention-Auflösung: Approve/Discard/Neustart der Phase → resolveFor(feature, kind)
```

### agent_runs-Lebenszyklus

```
start:  INSERT (id, agent-Snapshot, trigger, created_at, execution_id)
finish: UPDATE (verdict, decision_label, summary, report_path, finished_at)
Agent gelöscht → agent_id := NULL, agent_name-Snapshot bleibt lesbar
```

## Auflösungslogik `resolveAgentsForTrigger` (pure, shared)

```
Input:  agents (Union global ∪ Projekt, sort_order-sortiert),
        selection (Map agentId → include|exclude), trigger (kind, phase)
Regeln: 1. Trigger-Match: kind gleich UND (phase gleich, falls kind es verlangt)
        2. exclude schlägt ALLES (auch enabled)
        3. include erzwingt Lauf (auch disabled)
        4. sonst: enabled entscheidet
Output: geordnete Liste laufender Agents
```

## Bestehende Tabellen (unverändert genutzt)

`executions` (kind='review' für alle Agent-Läufe; Token-/Kosten-Spalten via execution_id-Join),
`attention` (+2 neue kinds), `features`/`merge_queue` (je +1 Spalte), `knowledge_*`, `chat_*`,
`sessions`, `projects` unverändert.
