# Phase 1 — Datenmodell

**Feature**: Eigene Schritte an den Lebenszyklus hängen · **Datum**: 2026-07-30

Abbildung der Key Entities der Spezifikation auf Typen (`packages/shared/src/types.ts`), Schema
(`packages/server/src/db/database.ts`) und Ableitungsregeln. Vorbild ist durchgehend das
Agent-Modell (`AgentDefinition` / `agents` / `agent_feature_selection`).

---

## 1. Auslöser (`LifecycleTrigger`)

```ts
/** Punkte im Lebenszyklus, an denen eigene Schritte feuern können. */
export const LIFECYCLE_TRIGGER_KINDS = [
  'before_worktree_create',
  'after_worktree_create',
  'before_phase',
  'after_phase',
  'before_stage',
  'after_stage',
] as const;
export type LifecycleTriggerKind = (typeof LIFECYCLE_TRIGGER_KINDS)[number];

/** Stufen der Integrations-Pipeline (Identität = IntegrationStep.id, siehe research.md E2). */
export const INTEGRATION_STAGE_IDS = [
  'verify',
  'review_gate',
  'human_review',
  'merge_queue',
  'merged',
] as const;
export type LifecycleStageId = (typeof INTEGRATION_STAGE_IDS)[number];

/**
 * Auslöser eines Schritts. `phase` NUR bei before_phase/after_phase,
 * `stage` NUR bei before_stage/after_stage — beides nie gleichzeitig.
 */
export interface LifecycleTrigger {
  kind: LifecycleTriggerKind;
  phase?: FeaturePhase;
  stage?: LifecycleStageId;
}
```

**Validierungsregeln** (Server-Route **und** Repo-Normalisierung, Muster `validateAgent`):

| Art | `phase` | `stage` |
|---|---|---|
| `before_worktree_create`, `after_worktree_create` | muss fehlen | muss fehlen |
| `before_phase`, `after_phase` | Pflicht, ∈ `FEATURE_PHASES` | muss fehlen |
| `before_stage`, `after_stage` | muss fehlen | Pflicht, ∈ `INTEGRATION_STAGE_IDS` |

Nicht zutreffende Felder werden beim Schreiben auf `NULL` normalisiert — dieselbe Mechanik wie
`AgentRepo.upsert()` mit `trigger_phase`.

**Arbeitsverzeichnis je Auslöser** (pure Funktion, research.md E3):

```ts
export function lifecycleCwdKind(t: LifecycleTrigger): 'worktree' | 'main' {
  if (t.kind === 'before_worktree_create') return 'main';
  if (t.kind === 'after_stage' && t.stage === 'merged') return 'main';
  return 'worktree';
}
```

---

## 2. Lebenszyklus-Schritt (`LifecycleStep`)

```ts
export interface LifecycleStep {
  id: string;
  /** null = global (gilt via Union in allen Projekten). */
  projectId: string | null;
  name: string;
  /** Shell-Kommando; läuft in einer Login-Shell im Zielverzeichnis. */
  command: string;
  trigger: LifecycleTrigger;
  /** true = blockierend (Fehlschlag hält an), false = beratend (nur verbucht). */
  blocking: boolean;
  /** Zeitlimit in ms; null = DEFAULT_STEP_TIMEOUT_MS (15 min). */
  timeoutMs: number | null;
  enabled: boolean;
  sortOrder: number;
}
```

**Felder ↔ FR**: `name`/`command`/`trigger`/`blocking`/`timeoutMs`/`enabled`/`sortOrder` decken
FR-001 vollständig ab. `projectId: null | string` deckt zwei der drei Ebenen aus FR-002 ab; die
dritte (Feature) ist die Entscheidungstabelle unten.

**Invarianten**
- `name` und `command` nach `trim()` nicht leer.
- `timeoutMs === null || timeoutMs > 0`; Obergrenze 24 h (Schutz gegen Tippfehler wie `9e12`).
- `sortOrder` ist ganzzahlig; Vorbelegung bei Neuanlage `99` (wie `AgentEditDialog`).

---

## 3. Feature-Entscheidung (`LifecycleStepFeatureDecision`)

```ts
/** Per-Feature-Override der Geltung; kein Eintrag = 'auto'. */
export type LifecycleStepFeatureDecision = 'include' | 'exclude';
```

Auflösung (FR-003/FR-005) — Zeile für Zeile identisch mit `resolveAgentsForTrigger`:

| Eintrag für (Feature, Schritt) | `enabled` | läuft? |
|---|---|---|
| `exclude` | beliebig | **nein** |
| `include` | beliebig | **ja** |
| — (auto) | `true` | ja |
| — (auto) | `false` | nein |

---

## 4. Schritt-Lauf (`ExecutionRecord`, erweitert)

Kein neuer Entitätstyp — der Lauf reiht sich in die bestehende Lauferfassung ein (FR-017).

```ts
export interface ExecutionRecord {
  // …
  kind: 'phase' | 'verify' | 'review' | 'conflict_resolution' | 'chat' | 'chat_work'
      | 'lifecycle_step';                       // NEU (FR-018)
  /** Bezeichnung des Laufs; bei kind='lifecycle_step' der Schrittname beim Start (FR-028). */
  label: string | null;                          // NEU
  // …
}
```

**Belegung eines Schritt-Laufs**

| Feld | Wert | FR |
|---|---|---|
| `kind` | `'lifecycle_step'` | FR-018 |
| `label` | Schrittname **zum Startzeitpunkt** | FR-028 |
| `projectId` / `featureId` | immer gesetzt | FR-017 |
| `phase` | `trigger.phase ?? null` | — |
| `status` | `running` → `succeeded` \| `failed` \| `orphaned` | FR-019/FR-021 |
| `startedAt` / `finishedAt` | Zeitraum ⇒ Dauer | FR-019 |
| `exitCode` | Exit-Code des Kommandos; `137` bei Zeitlimit-SIGKILL | FR-015/FR-019 |
| `logPath` | `<dataDir>/logs/<execId>.log` | FR-019 |
| `tokens`, `tokensSource`, `costMicros`, `subagent*`, `model` | **immer `NULL`** | FR-020 |
| `transcript*`, `opt*` | `NULL` (kein Claude-Lauf) | — |

Die **Stufe** (`trigger.stage`) wird bewusst nicht als eigene Spalte geführt: sie ist im
`label`-Kontext und im Log-Kopf sichtbar, und eine weitere Spalte auf `executions` nur für die
Anzeige wäre Aufwand ohne Auswertung.

---

## 5. Lauf-Kontext (`LifecycleContext`) — die eine Stelle (FR-011/FR-013/FR-014)

```ts
export interface LifecycleContext {
  /** Worktree-Pfad; bei before_worktree_create der KÜNFTIGE Pfad (US3 §5). */
  worktreePath: string;
  projectName: string;
  featureName: string;
  branch: string;
  /** null, wenn am Auslöser fachlich keine Phase existiert. */
  phase: FeaturePhase | null;
  /** null, wenn am Auslöser fachlich keine Stufe existiert. */
  stage: LifecycleStageId | null;
  // F1c ergänzt hier: portBase, profile
}

export function buildLifecycleEnv(ctx: LifecycleContext): Record<string, string> {
  return {
    SDD_WORKTREE: ctx.worktreePath,
    SDD_PROJECT: ctx.projectName,
    SDD_FEATURE: ctx.featureName,
    SDD_BRANCH: ctx.branch,
    SDD_PHASE: ctx.phase ?? '',   // FR-012: leer, nie Platzhalter/Fremdwert
    SDD_STAGE: ctx.stage ?? '',
    // F1c ergänzt hier: SDD_PORT_BASE, SDD_PROFILE (FR-013/FR-014)
  };
}
```

**Belegung je Auslöser** (FR-012 — `''` heißt „fachlich nicht vorhanden"):

| Auslöser | `SDD_WORKTREE` | `SDD_PHASE` | `SDD_STAGE` | Arbeitsverzeichnis |
|---|---|---|---|---|
| `before_worktree_create` | künftiger Pfad | `''` | `''` | Haupt-Checkout |
| `after_worktree_create` | Worktree | `''` | `''` | Worktree |
| `before_phase` / `after_phase` | Worktree | Phase | `''` | Worktree |
| `before_stage` / `after_stage` (≠ `merged`) | Worktree | `''` | Stufen-ID | Worktree |
| `after_stage:merged` | letzter Worktree-Pfad | `''` | `merged` | Haupt-Checkout |

`SDD_PROJECT`, `SDD_FEATURE` und `SDD_BRANCH` sind an **allen** Auslösern gesetzt.

---

## 6. Aufmerksamkeits-Item

```ts
export type AttentionKind =
  | 'awaiting_input' | 'permission_request' | 'verify_failed' | 'gate_failed'
  | 'merge_conflict_escalated' | 'review_due' | 'agent_errored' | 'run_interrupted'
  | 'phase_gate_failed' | 'approval_required'
  | 'lifecycle_step_failed';                     // NEU
```

**Nachricht** (FR-023) — ein Muster, damit sie ohne Log-Suche lesbar ist:

```
<feature>: Schritt „<name>" fehlgeschlagen (exit <code>) an <Auslöser-Titel>
Kommando: <command>
Letzte Ausgabe:
<tail>
```

`tail` = letzte 20 Zeilen, hart auf 2000 Zeichen gekappt (`tailLines(text, 20, 2000)` in
`shared`). Bei Zeitlimit lautet der Kopf `… nach Zeitlimit beendet (<n> min)`.

**Gültigkeit** (`attentionReconciler.ts`, research.md E10):
- kein Eintrag in `STAGE_FOR_KIND` (kein Stage-Bezug);
- eigener Zweig in `isAttentionValid`: **immer gültig** — weder eine laufende Session noch ein
  Stufenwechsel darf die Meldung entfernen;
- `findStaleOnBoot`: nicht stale ⇒ überlebt den Neustart;
- Auflösung an genau einer Stelle: erfolgreicher Trigger-Durchlauf desselben Features (FR-025);
  manuelles Auflösen über die Inbox bleibt wie bei allen Arten möglich.

Ein **beratender** Fehlschlag erzeugt **kein** Item (FR-024) — sichtbar bleibt er ausschließlich
am `failed`-Lauf.

Ein **fehlender Worktree**, wo einer erwartet wird, erzeugt `agent_errored` (behebbarer
Infrastrukturfehler) und **keinen** Schritt-Lauf mit FAIL (FR-026).

---

## 7. Effektive Feature-Sicht (DTO)

```ts
export interface FeatureLifecycleStepView {
  step: LifecycleStep;
  decision: LifecycleStepFeatureDecision | 'auto';
  /** Läuft der Schritt für dieses Feature beim nächsten passenden Auslöser? */
  effective: boolean;
  /** Jüngster Lauf dieses Schritts für dieses Feature; null = noch keiner. */
  lastRun: {
    executionId: string;
    startedAt: number;
    finishedAt: number | null;
    status: ExecutionRecord['status'];
    exitCode: number | null;
  } | null;
}
```

`lastRun` wird über `executions` ermittelt (jüngste Execution mit `kind='lifecycle_step'`,
`feature_id`, `label = step.name`) — kein eigener Lauf-Tabellen-Join nötig. Bei umbenanntem
Schritt bleibt der alte Lauf lesbar (FR-028), zählt aber nicht mehr als `lastRun`; das ist
gewollt (der Lauf gehört zum alten Namen).

---

## 8. Schema (Migration, additiv)

Neuer Eintrag am **Ende** von `MIGRATIONS` in `db/database.ts`:

```sql
-- Feature "eigene-schritte-an-den-lebenszyklus-haengen": eigene Shell-Kommandos an
-- definierten Punkten des Lebenszyklus. Muster: agents / agent_feature_selection.
CREATE TABLE lifecycle_steps (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,   -- NULL = global
  name          TEXT NOT NULL,
  command       TEXT NOT NULL,
  trigger_kind  TEXT NOT NULL CHECK (trigger_kind IN (
                  'before_worktree_create','after_worktree_create',
                  'before_phase','after_phase','before_stage','after_stage')),
  trigger_phase TEXT,
  trigger_stage TEXT,
  blocking      INTEGER NOT NULL DEFAULT 1,
  timeout_ms    INTEGER,                                          -- NULL = Vorgabewert
  sort_order    INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE lifecycle_step_feature_selection (
  feature_id TEXT NOT NULL REFERENCES features(id)        ON DELETE CASCADE,
  step_id    TEXT NOT NULL REFERENCES lifecycle_steps(id) ON DELETE CASCADE,
  decision   TEXT NOT NULL CHECK (decision IN ('include','exclude')),
  PRIMARY KEY (feature_id, step_id)
);

CREATE INDEX idx_lifecycle_steps_project ON lifecycle_steps(project_id);
CREATE INDEX idx_lifecycle_steps_trigger ON lifecycle_steps(trigger_kind);

-- Bezeichnung eines Laufs; bei kind='lifecycle_step' der Schrittname beim Start.
-- Hält Läufe eines später gelöschten Schritts lesbar (FR-028).
ALTER TABLE executions ADD COLUMN label TEXT;
```

**Eigenschaften**: keine Seeds (ein frisches Projekt hat keine Schritte ⇒ FR-027 gilt
automatisch), kein Backfill, keine Änderung bestehender Spalten, `ON DELETE CASCADE` räumt
Auswahlzeilen beim Löschen von Feature oder Schritt mit ab. `executions` hat bewusst **keinen**
Fremdschlüssel auf `lifecycle_steps` — die Tabelle führt schon heute keine Fremdschlüssel, und
FR-028 verlangt Lesbarkeit **nach** dem Löschen.

**Sortierung im Repo** (FR-004, research.md E12):

```sql
SELECT * FROM lifecycle_steps
WHERE project_id IS NULL OR project_id = ?
ORDER BY project_id IS NOT NULL, sort_order, name
```

---

## 9. Zustände & Übergänge

### Schritt-Lauf

```
                    ┌──────────── exit 0 ───────────► succeeded
running ────────────┤
 (execution start)  ├── exit ≠ 0 ────────────────────► failed
                    ├── Zeitlimit → SIGKILL ─────────► failed (exit 137)
                    └── Serverende/Absturz ──► (Boot) orphaned      (FR-021)
```

### Trigger-Durchlauf (`runTrigger`)

```
Schritte auflösen
   │ leer ──────────────────────────────────► { ok: true, ran: [] }        (Fast-Path, FR-027)
   │
   ▼ (sequentiell, Reihenfolge nach E12)
Schritt läuft ── succeeded ──► nächster Schritt
   │
   ├── failed & beratend ────► nächster Schritt (kein Item, FR-024)
   └── failed & blockierend ─► Kette abbrechen, Item, { ok: false }        (FR-022/FR-023)

alle Schritte fertig und kein blockierender Fehlschlag
   └──► offene lifecycle_step_failed-Items des Features auflösen           (FR-025)
```

### Wirkung von `{ ok: false }` je Einhängepunkt

| Auslöser | Halt |
|---|---|
| `before_worktree_create` | kein `git worktree add`, keine Session, keine erste Phase; Feature bleibt ohne Worktree |
| `after_worktree_create` | keine Session, keine erste Phase; Worktree bleibt bestehen |
| `before_phase` | Phase startet nicht (bleibt `idle`) |
| `after_phase` | kein Agent-Gate, kein Auto-Progress; Phase bleibt `awaiting_review` |
| `before_stage` / `after_stage` | Pipeline hält an der Stufe an, Queue-Worker stoppt (siehe research.md E9) |

Ein Halt ist **kein** Verbot: der Mensch kann eine Phase weiterhin manuell freigeben oder
starten — dieselbe Linie wie bei `phase_gate_failed` („Human-Override bleibt möglich").

---

## 10. Berührte Bestandstypen (Zusammenfassung)

| Datei | Änderung | Rückwärtskompatibel |
|---|---|---|
| `shared/types.ts` | `ExecutionRecord.kind` += `'lifecycle_step'`; `ExecutionRecord.label`; `AttentionKind` += `'lifecycle_step_failed'`; neue Typen aus §1–§7 | ja (Union-Erweiterung, neues nullable Feld) |
| `shared/workflowModel.ts` | `INTEGRATION_STAGE_IDS`; `IntegrationStep.id: LifecycleStageId`; `LIFECYCLE_TRIGGER_META` | ja (Verengung eines `string` auf die bereits verwendeten Werte) |
| `shared/runSummary.ts` | `categorizeExecution` → `'overhead'`; `STEP_ORDER` += `'lifecycle_step'`; `sourceMix`-Nenner ohne Schritt-Läufe | ja |
| `server/db/repos.ts` | `ExecutionStartInput.label?`; `map()` liest `label` | ja (optionales Feld) |
| `server/services/attentionReconciler.ts` | expliziter Zweig für die neue Art | ja |
| `web/components/ExecutionsView.tsx` | `KIND_LABELS`/`STEP_LABELS` (Compile-Pflicht durch `Record`) | — |
