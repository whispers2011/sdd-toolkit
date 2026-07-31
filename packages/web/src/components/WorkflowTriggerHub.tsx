import { AGENT_TRIGGER_META, LIFECYCLE_TRIGGER_META } from '@sdd/shared';
import type {
  AgentDefinition,
  AgentTrigger,
  FeaturePhase,
  IntegrationStep,
  LifecycleStep,
  LifecycleTrigger,
} from '@sdd/shared';
import { Dialog } from './Sidebar.js';
import { PlusIcon, ShieldIcon, StepsIcon } from './icons.js';

/**
 * Der gebündelte Einstieg zu den Auslöserpunkten eines Knotens.
 *
 * Vorher trug jeder Auslöserpunkt eine eigene Zone samt „+" und einer Zeile
 * „— keiner", auch wenn dort nichts konfiguriert war: 32 Leermeldungen in einer
 * Ansicht, die einen Ablauf zeigen soll. Jetzt trägt jeder Knoten EIN „+", und
 * dahinter liegen ALLE seine Punkte — auch die leeren (FR-002, FR-003).
 *
 * Hier liegen zusätzlich die Sichttypen und Chips der Einträge: die Ansicht und
 * dieser Dialog zeigen dieselben Einträge mit denselben Kennzeichen, und die
 * Abhängigkeit läuft nur in eine Richtung (Ansicht → Hub, kein Zyklus).
 */

/** Effektive Agent-Sicht eines Knotens (Projekt- vs. Feature-Scope vereinheitlicht). */
export interface NodeAgent {
  agent: AgentDefinition;
  effective: boolean;
  decision: 'include' | 'exclude' | 'auto' | null;
}

/** Effektive Schritt-Sicht eines Knotens — dieselbe Vereinheitlichung wie NodeAgent. */
export interface NodeStep {
  step: LifecycleStep;
  effective: boolean;
  decision: 'include' | 'exclude' | 'auto' | null;
}

/** Ein Knoten des Flusses — die drei Arten, an denen Auslöserpunkte hängen. */
export type WorkflowNode =
  | { kind: 'worktree' }
  | { kind: 'phase'; phase: FeaturePhase }
  | { kind: 'stage'; step: IntegrationStep };

/** Ein Auslöserpunkt samt den dort hängenden Einträgen — reine Sichtstruktur. */
export type TriggerPoint =
  | { kind: 'step'; title: string; trigger: LifecycleTrigger; entries: NodeStep[] }
  | { kind: 'agent'; title: string; trigger: AgentTrigger; entries: NodeAgent[] };

/**
 * Die Auslöserpunkte eines Knotens — ERZEUGT, nicht aufgezählt: eine neue
 * Auslöser-Art erscheint automatisch, sobald sie im Katalog steht (FR-026).
 * Reihenfolge je Knoten ist die Ausführungsreihenfolge: Schritt „vor" →
 * Agent „vor" → Schritt „nach" → Agent „nach".
 */
export function triggerPointsOf(
  node: WorkflowNode,
  stepsFor: (t: LifecycleTrigger) => NodeStep[],
  agentsFor: (kind: AgentTrigger['kind'], phase?: FeaturePhase) => NodeAgent[],
): TriggerPoint[] {
  const stepPoint = (trigger: LifecycleTrigger): TriggerPoint => ({
    kind: 'step',
    title: LIFECYCLE_TRIGGER_META[trigger.kind].title,
    trigger,
    entries: stepsFor(trigger),
  });
  const agentPoint = (trigger: AgentTrigger): TriggerPoint => ({
    kind: 'agent',
    title: AGENT_TRIGGER_META[trigger.kind].label,
    trigger,
    entries: agentsFor(trigger.kind, trigger.phase),
  });

  if (node.kind === 'worktree') {
    return [stepPoint({ kind: 'before_worktree_create' }), stepPoint({ kind: 'after_worktree_create' })];
  }
  if (node.kind === 'phase') {
    const phase = node.phase;
    return [
      stepPoint({ kind: 'before_phase', phase }),
      agentPoint({ kind: 'before_phase', phase }),
      stepPoint({ kind: 'after_phase', phase }),
      agentPoint({ kind: 'after_phase', phase }),
    ];
  }
  const stage = node.step.id;
  return [
    stepPoint({ kind: 'before_stage', stage }),
    // Der Agent-Punkt ist aus dem Modell ABGELEITET, nicht an 'review_gate'
    // festgeschrieben: verschiebt sich das Gate, wandert der Punkt mit.
    ...(node.step.showsReviewGateAgents ? [agentPoint({ kind: 'review_gate' })] : []),
    stepPoint({ kind: 'after_stage', stage }),
  ];
}

/** Das unbeschriftete „+" am Knoten — genau eines je Knoten (FR-002). */
export function TriggerHubButton({ onOpen, nodeLabel }: { onOpen: () => void; nodeLabel: string }) {
  const label = `Schritte und Agents für „${nodeLabel}"`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={label}
      aria-label={label}
      className="ml-auto shrink-0 rounded border border-zinc-700 p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
    >
      <PlusIcon />
    </button>
  );
}

/** Der Dialog dahinter: alle Auslöserpunkte des Knotens, auch die leeren (FR-003). */
export function WorkflowTriggerHub({
  node,
  nodeLabel,
  stepsFor,
  agentsFor,
  onAddStep,
  onAddAgent,
  onEditStep,
  onEditAgent,
  onClose,
}: {
  node: WorkflowNode;
  nodeLabel: string;
  stepsFor: (t: LifecycleTrigger) => NodeStep[];
  agentsFor: (kind: AgentTrigger['kind'], phase?: FeaturePhase) => NodeAgent[];
  onAddStep: (t: LifecycleTrigger) => void;
  onAddAgent: (t: AgentTrigger) => void;
  onEditStep: (s: LifecycleStep) => void;
  onEditAgent: (a: AgentDefinition) => void;
  onClose: () => void;
}) {
  const points = triggerPointsOf(node, stepsFor, agentsFor);
  return (
    <Dialog title={`Schritte und Agents — ${nodeLabel}`} onClose={onClose} wide>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto">
        {points.map((p) => (
          <div key={`${p.kind}:${p.trigger.kind}`} className="rounded border border-zinc-800 p-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{p.title}</span>
              <button
                type="button"
                onClick={() => (p.kind === 'step' ? onAddStep(p.trigger) : onAddAgent(p.trigger))}
                className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                title={p.kind === 'step' ? 'Schritt für diesen Auslöser anlegen' : 'Agent für diesen Auslöser anlegen'}
              >
                <PlusIcon /> {p.kind === 'step' ? 'Schritt' : 'Agent'}
              </button>
            </div>
            {p.entries.length === 0 ? (
              <p className="mt-1 text-[10px] text-zinc-600">Nichts konfiguriert.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {p.kind === 'step'
                  ? p.entries.map((ns) => <StepChip key={ns.step.id} ns={ns} onEdit={onEditStep} />)
                  : p.entries.map((na) => <AgentChip key={na.agent.id} na={na} onEdit={onEditAgent} />)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

// ---------- Einträge ----------

const CHIP_BTN = 'flex w-full items-center gap-1.5 rounded border px-1.5 py-1 text-left hover:bg-zinc-800';

function chipTone(effective: boolean, blocking: boolean): string {
  if (!effective) return 'border-zinc-800/60 opacity-50';
  return blocking ? 'border-amber-900/50 bg-zinc-900/60' : 'border-zinc-800 bg-zinc-900/60';
}

function DecisionBadge({ decision }: { decision: NodeAgent['decision'] }) {
  if (!decision || decision === 'auto') return null;
  return (
    <span
      className={`shrink-0 rounded px-1 text-[9px] ${
        decision === 'include' ? 'bg-emerald-950/60 text-emerald-300' : 'bg-zinc-800 text-zinc-500'
      }`}
    >
      {decision === 'include' ? 'erzwungen' : 'aus'}
    </span>
  );
}

export function AgentChip({ na, onEdit }: { na: NodeAgent; onEdit: (a: AgentDefinition) => void }) {
  const { agent, effective, decision } = na;
  const iconTone = !effective ? 'text-zinc-600' : agent.blocking ? 'text-amber-400' : 'text-zinc-500';
  return (
    <li>
      <button
        onClick={() => onEdit(agent)}
        className={`${CHIP_BTN} ${chipTone(effective, agent.blocking)}`}
        title={
          effective
            ? 'Läuft für diese Geltung. Klick zum Bearbeiten.'
            : 'Läuft NICHT (inaktiv/ausgeschlossen). Klick zum Bearbeiten.'
        }
      >
        <ShieldIcon className={`shrink-0 ${iconTone}`} />
        <span className="truncate text-[11px] font-medium text-zinc-200">{agent.name}</span>
        <span
          className={`ml-auto shrink-0 rounded px-1 text-[9px] ${
            agent.blocking ? 'bg-red-950/60 text-red-300' : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {agent.blocking ? 'Gate' : 'Hinweis'}
        </span>
        {agent.projectId === null && (
          <span className="shrink-0 rounded bg-zinc-800 px-1 text-[9px] text-zinc-400" title="Globaler Agent">
            global
          </span>
        )}
        <DecisionBadge decision={decision} />
      </button>
    </li>
  );
}

export function StepChip({ ns, onEdit }: { ns: NodeStep; onEdit: (s: LifecycleStep) => void }) {
  const { step, effective, decision } = ns;
  const iconTone = !effective ? 'text-zinc-600' : step.blocking ? 'text-amber-400' : 'text-zinc-500';
  return (
    <li>
      <button
        onClick={() => onEdit(step)}
        className={`${CHIP_BTN} ${chipTone(effective, step.blocking)}`}
        title={
          effective
            ? `Läuft für diese Geltung: ${step.command}`
            : `Läuft NICHT (inaktiv/ausgeschlossen): ${step.command}`
        }
      >
        <StepsIcon className={`shrink-0 ${iconTone}`} />
        <span className="truncate text-[11px] font-medium text-zinc-200">{step.name}</span>
        <span
          className={`ml-auto shrink-0 rounded px-1 text-[9px] ${
            step.blocking ? 'bg-red-950/60 text-red-300' : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {step.blocking ? 'Blockierend' : 'Hinweis'}
        </span>
        {step.projectId === null && (
          <span className="shrink-0 rounded bg-zinc-800 px-1 text-[9px] text-zinc-400" title="Globaler Schritt">
            global
          </span>
        )}
        <DecisionBadge decision={decision} />
      </button>
    </li>
  );
}
