import { nanoid } from 'nanoid';
import type {
  AgentDefinition,
  AgentFeatureDecision,
  AgentRunSummary,
  AgentTrigger,
  AgentTriggerKind,
  FeaturePhase,
} from '@sdd/shared';
import type { DB } from './database.js';

// ---------- Agents (Generalisierung der Review-Personas) ----------

interface AgentRow {
  id: string;
  project_id: string | null;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  trigger_kind: string;
  trigger_phase: string | null;
  blocking: number;
  sort_order: number;
  enabled: number;
}

function toTrigger(kindRaw: string, phaseRaw: string | null): AgentTrigger {
  const kind = kindRaw as AgentTriggerKind;
  if ((kind === 'after_phase' || kind === 'before_phase') && phaseRaw) {
    return { kind, phase: phaseRaw as FeaturePhase };
  }
  return { kind };
}

function toAgent(r: AgentRow): AgentDefinition {
  const trigger = toTrigger(r.trigger_kind, r.trigger_phase);
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    prompt: r.prompt,
    model: r.model,
    trigger,
    blocking: r.blocking === 1,
    enabled: r.enabled === 1,
    sortOrder: r.sort_order,
  };
}

export class AgentRepo {
  constructor(private db: DB) {}

  /**
   * Agents eines Projekts: globale UND projektspezifische zusammen (Union).
   * Bewusste Semantikänderung ggü. dem Persona-Fallback: mit Gates würde EIN
   * Projekt-Agent sonst still alle globalen Gates abschalten. Escape-Hatch
   * ist der Per-Feature-Exclude.
   */
  forProject(projectId: string): AgentDefinition[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM agents WHERE project_id IS NULL OR project_id=? ORDER BY sort_order, name',
        )
        .all(projectId) as AgentRow[]
    ).map(toAgent);
  }

  list(): AgentDefinition[] {
    return (
      this.db
        .prepare('SELECT * FROM agents ORDER BY project_id NULLS FIRST, sort_order, name')
        .all() as AgentRow[]
    ).map(toAgent);
  }

  get(id: string): AgentDefinition | null {
    const r = this.db.prepare('SELECT * FROM agents WHERE id=?').get(id) as AgentRow | undefined;
    return r ? toAgent(r) : null;
  }

  upsert(a: Omit<AgentDefinition, 'id'> & { id?: string }): AgentDefinition {
    const id = a.id ?? nanoid(10);
    const phase =
      a.trigger.kind === 'after_phase' || a.trigger.kind === 'before_phase'
        ? (a.trigger.phase ?? null)
        : null;
    this.db
      .prepare(
        `INSERT INTO agents (id, project_id, name, description, prompt, model, trigger_kind, trigger_phase, blocking, sort_order, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, description=excluded.description, prompt=excluded.prompt,
           model=excluded.model, trigger_kind=excluded.trigger_kind, trigger_phase=excluded.trigger_phase,
           blocking=excluded.blocking, sort_order=excluded.sort_order, enabled=excluded.enabled`,
      )
      .run(
        id,
        a.projectId,
        a.name,
        a.description,
        a.prompt,
        a.model,
        a.trigger.kind,
        phase,
        a.blocking ? 1 : 0,
        a.sortOrder,
        a.enabled ? 1 : 0,
      );
    return this.get(id)!;
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM agents WHERE id=?').run(id);
  }

  // ----- Per-Feature-Selektion (Muster: knowledge_feature_selection) -----

  listSelection(featureId: string): Map<string, AgentFeatureDecision> {
    const rows = this.db
      .prepare('SELECT agent_id, decision FROM agent_feature_selection WHERE feature_id=?')
      .all(featureId) as { agent_id: string; decision: AgentFeatureDecision }[];
    return new Map(rows.map((r) => [r.agent_id, r.decision]));
  }

  setSelection(featureId: string, agentId: string, decision: AgentFeatureDecision): void {
    this.db
      .prepare(
        `INSERT INTO agent_feature_selection (feature_id, agent_id, decision) VALUES (?, ?, ?)
         ON CONFLICT(feature_id, agent_id) DO UPDATE SET decision=excluded.decision`,
      )
      .run(featureId, agentId, decision);
  }

  /** Zurück auf 'auto' (Zeile löschen). */
  clearSelection(featureId: string, agentId: string): void {
    this.db
      .prepare('DELETE FROM agent_feature_selection WHERE feature_id=? AND agent_id=?')
      .run(featureId, agentId);
  }
}

// ---------- Agent-Läufe (strukturierte Ergebnisse) ----------

interface AgentRunRow {
  id: string;
  agent_id: string | null;
  agent_name: string;
  project_id: string;
  feature_id: string;
  execution_id: string | null;
  trigger_kind: string;
  trigger_phase: string | null;
  blocking: number;
  verdict: string | null;
  decision_label: string | null;
  summary: string | null;
  report_path: string | null;
  created_at: number;
  finished_at: number | null;
}

function toRun(r: AgentRunRow): AgentRunSummary {
  return {
    id: r.id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    featureId: r.feature_id,
    executionId: r.execution_id,
    trigger: toTrigger(r.trigger_kind, r.trigger_phase),
    blocking: r.blocking === 1,
    verdict: r.verdict === 'PASS' || r.verdict === 'FAIL' ? r.verdict : null,
    decisionLabel: r.decision_label,
    summary: r.summary,
    reportPath: r.report_path,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    source: 'db',
  };
}

export class AgentRunRepo {
  constructor(private db: DB) {}

  start(run: {
    agent: AgentDefinition;
    projectId: string;
    featureId: string;
    executionId: string | null;
    trigger: AgentTrigger;
  }): string {
    const id = nanoid(10);
    this.db
      .prepare(
        `INSERT INTO agent_runs (id, agent_id, agent_name, project_id, feature_id, execution_id,
           trigger_kind, trigger_phase, blocking, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        run.agent.id,
        run.agent.name,
        run.projectId,
        run.featureId,
        run.executionId,
        run.trigger.kind,
        run.trigger.phase ?? null,
        run.agent.blocking ? 1 : 0,
        Date.now(),
      );
    return id;
  }

  finish(
    id: string,
    result: {
      verdict: 'PASS' | 'FAIL' | null;
      decisionLabel?: string | null;
      summary?: string | null;
      reportPath?: string | null;
    },
  ): void {
    this.db
      .prepare(
        'UPDATE agent_runs SET verdict=?, decision_label=?, summary=?, report_path=?, finished_at=? WHERE id=?',
      )
      .run(
        result.verdict,
        result.decisionLabel ?? null,
        result.summary ?? null,
        result.reportPath ?? null,
        Date.now(),
        id,
      );
  }

  listForFeature(featureId: string): AgentRunSummary[] {
    return (
      this.db
        .prepare('SELECT * FROM agent_runs WHERE feature_id=? ORDER BY created_at DESC')
        .all(featureId) as AgentRunRow[]
    ).map(toRun);
  }

  /** Jüngster abgeschlossener Lauf pro Agent (für Verdict-Chips in der Verwaltung). */
  latestPerAgent(featureId: string): Map<string, AgentRunSummary> {
    const runs = this.listForFeature(featureId);
    const latest = new Map<string, AgentRunSummary>();
    for (const run of runs) {
      if (run.agentId && !latest.has(run.agentId)) latest.set(run.agentId, run);
    }
    return latest;
  }
}
