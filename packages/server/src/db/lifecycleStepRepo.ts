import { nanoid } from 'nanoid';
import type {
  FeaturePhase,
  LifecycleStageId,
  LifecycleStep,
  LifecycleStepFeatureDecision,
  LifecycleTrigger,
  LifecycleTriggerKind,
} from '@sdd/shared';
import type { DB } from './database.js';

// ---------- Lebenszyklus-Schritte (Muster: agentRepo.ts) ----------

interface StepRow {
  id: string;
  project_id: string | null;
  name: string;
  command: string;
  trigger_kind: string;
  trigger_phase: string | null;
  trigger_stage: string | null;
  blocking: number;
  timeout_ms: number | null;
  sort_order: number;
  enabled: number;
}

function toTrigger(
  kindRaw: string,
  phaseRaw: string | null,
  stageRaw: string | null,
): LifecycleTrigger {
  const kind = kindRaw as LifecycleTriggerKind;
  if ((kind === 'before_phase' || kind === 'after_phase') && phaseRaw) {
    return { kind, phase: phaseRaw as FeaturePhase };
  }
  if ((kind === 'before_stage' || kind === 'after_stage') && stageRaw) {
    return { kind, stage: stageRaw as LifecycleStageId };
  }
  return { kind };
}

function toStep(r: StepRow): LifecycleStep {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    command: r.command,
    trigger: toTrigger(r.trigger_kind, r.trigger_phase, r.trigger_stage),
    blocking: r.blocking === 1,
    timeoutMs: r.timeout_ms,
    enabled: r.enabled === 1,
    sortOrder: r.sort_order,
  };
}

/**
 * Nicht zutreffende Trigger-Felder auf NULL normalisieren — dieselbe Mechanik wie
 * `AgentRepo.upsert()` mit `trigger_phase`. Damit kann kein Datensatz eine Phase
 * tragen, die an seiner Auslöser-Art fachlich nicht existiert.
 */
function normalizeTrigger(t: LifecycleTrigger): { phase: string | null; stage: string | null } {
  const phase = t.kind === 'before_phase' || t.kind === 'after_phase' ? (t.phase ?? null) : null;
  const stage = t.kind === 'before_stage' || t.kind === 'after_stage' ? (t.stage ?? null) : null;
  return { phase, stage };
}

export class LifecycleStepRepo {
  constructor(private db: DB) {}

  /**
   * Schritte eines Projekts: globale UND projektspezifische zusammen (Union) —
   * dieselbe Semantik wie bei den Agents (eine Hausregel darf nicht dadurch
   * verschwinden, dass ein Projekt einen eigenen Schritt anlegt).
   *
   * Die Sortierung `project_id IS NOT NULL, sort_order, name` ist dieselbe
   * Ordnung wie `compareStepOrder()` in shared: global vor Projekt, je Gruppe
   * nach Position, bei Gleichstand nach Name.
   */
  forProject(projectId: string): LifecycleStep[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM lifecycle_steps WHERE project_id IS NULL OR project_id=?
           ORDER BY project_id IS NOT NULL, sort_order, name`,
        )
        .all(projectId) as StepRow[]
    ).map(toStep);
  }

  list(): LifecycleStep[] {
    return (
      this.db
        .prepare('SELECT * FROM lifecycle_steps ORDER BY project_id NULLS FIRST, sort_order, name')
        .all() as StepRow[]
    ).map(toStep);
  }

  get(id: string): LifecycleStep | null {
    const r = this.db.prepare('SELECT * FROM lifecycle_steps WHERE id=?').get(id) as
      | StepRow
      | undefined;
    return r ? toStep(r) : null;
  }

  upsert(s: Omit<LifecycleStep, 'id'> & { id?: string }): LifecycleStep {
    const id = s.id ?? nanoid(10);
    const { phase, stage } = normalizeTrigger(s.trigger);
    this.db
      .prepare(
        `INSERT INTO lifecycle_steps (id, project_id, name, command, trigger_kind, trigger_phase,
           trigger_stage, blocking, timeout_ms, sort_order, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, command=excluded.command, trigger_kind=excluded.trigger_kind,
           trigger_phase=excluded.trigger_phase, trigger_stage=excluded.trigger_stage,
           blocking=excluded.blocking, timeout_ms=excluded.timeout_ms,
           sort_order=excluded.sort_order, enabled=excluded.enabled`,
      )
      .run(
        id,
        s.projectId,
        s.name,
        s.command,
        s.trigger.kind,
        phase,
        stage,
        s.blocking ? 1 : 0,
        s.timeoutMs,
        s.sortOrder,
        s.enabled ? 1 : 0,
      );
    return this.get(id)!;
  }

  /** Idempotent — ein unbekanntes `id` ist kein Fehler (Vorbild `/api/agents/:id`). */
  remove(id: string): void {
    this.db.prepare('DELETE FROM lifecycle_steps WHERE id=?').run(id);
  }

  // ----- Per-Feature-Auswahl (Muster: agent_feature_selection) -----

  selectionFor(featureId: string): Map<string, LifecycleStepFeatureDecision> {
    const rows = this.db
      .prepare('SELECT step_id, decision FROM lifecycle_step_feature_selection WHERE feature_id=?')
      .all(featureId) as { step_id: string; decision: LifecycleStepFeatureDecision }[];
    return new Map(rows.map((r) => [r.step_id, r.decision]));
  }

  /** `'auto'` löscht die Zeile — die Ebene darüber gilt dann wieder. */
  setDecision(
    featureId: string,
    stepId: string,
    decision: LifecycleStepFeatureDecision | 'auto',
  ): void {
    if (decision === 'auto') {
      this.db
        .prepare('DELETE FROM lifecycle_step_feature_selection WHERE feature_id=? AND step_id=?')
        .run(featureId, stepId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO lifecycle_step_feature_selection (feature_id, step_id, decision) VALUES (?, ?, ?)
         ON CONFLICT(feature_id, step_id) DO UPDATE SET decision=excluded.decision`,
      )
      .run(featureId, stepId, decision);
  }
}
