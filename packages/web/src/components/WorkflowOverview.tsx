import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  AGENT_TRIGGER_META,
  AUTOMATION_META,
  INTEGRATION_STEPS,
  INTEGRATION_STAGE_META,
  LIFECYCLE_TRIGGER_META,
  PHASE_META,
  compareStepOrder,
  isOptionalPhase,
  lifecycleStage,
  orderedEnabledPhases,
  resolveAutomation,
  shouldAutoProgress,
} from '@sdd/shared';
import type {
  AgentDefinition,
  AgentTrigger,
  AutomationSettings,
  Feature,
  FeatureAgentView,
  FeatureLifecycleStepView,
  FeaturePhase,
  IntegrationStep,
  KnowledgeIndexItem,
  LifecycleCatalogStageId,
  LifecycleStageId,
  LifecycleStep,
  LifecycleTrigger,
  LifecycleTriggerKind,
} from '@sdd/shared';
import { api, type FeatureKnowledgeResponse, type KnowledgeResponse } from '../api.js';
import { useStore } from '../store.js';
import { PhaseDefinitionDialog } from './PhaseDefinitionDialog.js';
import { AgentEditDialog } from './AgentEditDialog.js';
import { LifecycleStepEditDialog } from './LifecycleStepEditDialog.js';
import { Dialog } from './Sidebar.js';
import { InfoPopover } from './InfoPopover.js';
import {
  AgentChip,
  StepChip,
  TriggerHubButton,
  WorkflowTriggerHub,
  type NodeAgent,
  type NodeStep,
  type WorkflowNode,
} from './WorkflowTriggerHub.js';
import {
  ArrowRightIcon,
  BoltIcon,
  BundleIcon,
  CheckIcon,
  ChevronDownIcon,
  EditIcon,
  EntryIcon,
  FlaskIcon,
  GitMergeIcon,
  InfoIcon,
  KnowledgeIcon,
  PlusIcon,
  RefreshIcon,
  ReviewIcon,
  ScalesIcon,
  SettingsIcon,
  ShieldIcon,
  StepsIcon,
  UserIcon,
  VerifyIcon,
  WarningIcon,
  type IconProps,
} from './icons.js';

type Scope = { kind: 'project' } | { kind: 'feature'; featureId: string };

const CARD = 'rounded-lg border border-zinc-800 bg-zinc-900/60';
const SECONDARY_BTN =
  'inline-flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200';

/**
 * Workflow-Übersicht: grafische Abbildung des Feature-Workflows GEMÄSS AKTUELLER
 * KONFIGURATION. Rendert rein aus Live-Daten (Automation-Dial, Phasen, Agents,
 * Projektwissen) über das getypte Modell aus @sdd/shared — spiegelt jede
 * Konfig-Änderung sofort und veraltet bei App-Erweiterungen nicht still (Drift-Guard).
 */
export function WorkflowOverview() {
  const { state, dispatch } = useStore();
  const projectId = state.selectedProjectId;
  const project = state.app?.projects.find((p) => p.id === projectId) ?? null;

  const [scope, setScope] = useState<Scope>({ kind: 'project' });
  const [agents, setAgents] = useState<AgentDefinition[] | null>(null);
  const [steps, setSteps] = useState<LifecycleStep[] | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeResponse | null>(null);
  const [featureAgents, setFeatureAgents] = useState<FeatureAgentView[] | null>(null);
  const [featureSteps, setFeatureSteps] = useState<FeatureLifecycleStepView[] | null>(null);
  const [featureKnowledge, setFeatureKnowledge] = useState<FeatureKnowledgeResponse | null>(null);
  const [tick, setTick] = useState(0);

  const [editingPhase, setEditingPhase] = useState<FeaturePhase | null>(null);
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [newAgentTrigger, setNewAgentTrigger] = useState<AgentTrigger | null>(null);
  const [slotPicker, setSlotPicker] = useState<AgentTrigger | null>(null);
  const [editingStep, setEditingStep] = useState<LifecycleStep | null>(null);
  const [newStepTrigger, setNewStepTrigger] = useState<LifecycleTrigger | null>(null);
  const [hubNode, setHubNode] = useState<WorkflowNode | null>(null);

  const fail = (e: Error) => dispatch({ type: 'error', message: e.message });

  const knowledgeVersion = projectId ? (state.knowledgeVersion[projectId] ?? 0) : 0;
  const agentGateVersion = state.agentGateVersion;
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api.agents(projectId).then((a) => alive && setAgents(a)).catch(fail);
    api.lifecycleSteps(projectId).then((s) => alive && setSteps(s)).catch(fail);
    api.getKnowledge(projectId).then((k) => alive && setKnowledge(k)).catch(fail);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, knowledgeVersion, agentGateVersion, tick]);

  useEffect(() => {
    if (scope.kind !== 'feature') {
      setFeatureAgents(null);
      setFeatureSteps(null);
      setFeatureKnowledge(null);
      return;
    }
    let alive = true;
    api.featureAgents(scope.featureId).then((v) => alive && setFeatureAgents(v)).catch(fail);
    api.featureLifecycleSteps(scope.featureId).then((v) => alive && setFeatureSteps(v)).catch(fail);
    api.featureKnowledge(scope.featureId).then((k) => alive && setFeatureKnowledge(k)).catch(fail);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, knowledgeVersion, agentGateVersion, tick]);

  const activeFeatures = useMemo(
    () =>
      (state.app?.features ?? []).filter(
        (f) => f.projectId === projectId && f.integration !== 'merged' && !f.archivedAt,
      ),
    [state.app?.features, projectId],
  );

  const scopedFeature: Feature | null =
    scope.kind === 'feature' ? (activeFeatures.find((f) => f.id === scope.featureId) ?? null) : null;

  const automation: AutomationSettings | null = useMemo(() => {
    if (!state.app || !project) return null;
    if (scope.kind === 'project') return { ...state.app.automation, ...project.automation };
    return resolveAutomation(state.app.automation, project.automation, scopedFeature?.automation ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.app?.automation, project, scope, scopedFeature]);

  if (!state.app || !project) {
    return <p className="p-6 text-sm text-zinc-600">Kein Projekt ausgewählt.</p>;
  }
  if (!automation) return null;

  const phases = orderedEnabledPhases(project.enabledPhases);

  const nodeAgents = (kind: AgentTrigger['kind'], phase?: FeaturePhase): NodeAgent[] => {
    const matches = (t: AgentTrigger) => t.kind === kind && (phase ? t.phase === phase : true);
    if (scope.kind === 'feature') {
      return (featureAgents ?? [])
        .filter((v) => matches(v.agent.trigger))
        .map((v) => ({ agent: v.agent, effective: v.effective, decision: v.decision }))
        .sort((a, b) => a.agent.sortOrder - b.agent.sortOrder);
    }
    return (agents ?? [])
      .filter((a) => matches(a.trigger))
      .map((a) => ({ agent: a, effective: a.enabled, decision: null }))
      .sort((a, b) => a.agent.sortOrder - b.agent.sortOrder);
  };

  const openNewAgent = (trigger: AgentTrigger) => {
    setEditingAgent(null);
    setNewAgentTrigger(trigger);
  };

  /**
   * Schritte eines Auslöserpunkts — Reihenfolge exakt wie bei der Ausführung
   * (global vor Projekt, dann Position, dann Name) über `compareStepOrder`.
   */
  const nodeSteps = (trigger: LifecycleTrigger): NodeStep[] => {
    const matches = (t: LifecycleTrigger) =>
      t.kind === trigger.kind && t.phase === trigger.phase && t.stage === trigger.stage;
    if (scope.kind === 'feature') {
      return (featureSteps ?? [])
        .filter((v) => matches(v.step.trigger))
        .map((v) => ({ step: v.step, effective: v.effective, decision: v.decision }))
        .sort((a, b) => compareStepOrder(a.step, b.step));
    }
    return (steps ?? [])
      .filter((s) => matches(s.trigger))
      .map((s) => ({ step: s, effective: s.enabled, decision: null }))
      .sort((a, b) => compareStepOrder(a.step, b.step));
  };

  const openNewStep = (trigger: LifecycleTrigger) => {
    setEditingStep(null);
    setNewStepTrigger(trigger);
  };

  return (
    <div className="flex h-full flex-col">
      <ConfigHeader
        project={project}
        automation={automation}
        optimization={{ ...state.app.optimization, ...project.optimization, ...(scopedFeature?.optimization ?? {}) }}
        scope={scope}
        onScope={setScope}
        features={activeFeatures}
        onRefresh={() => void api.state().then((s) => dispatch({ type: 'bootstrap', state: s })).then(reload)}
      />

      <div className="flex min-h-0 flex-1">
        {/* ---- Vertikaler Fluss (links) ---- */}
        <div className={`min-h-0 overflow-auto ${editingPhase ? 'w-[26rem] shrink-0 border-r border-zinc-800' : 'flex-1'}`}>
          <div className="mx-auto w-full max-w-2xl p-6">
            {!project.specKit && (
              <div className="mb-4 flex items-center gap-2 rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                <WarningIcon className="shrink-0" />
                In diesem Projekt wurde kein spec-kit erkannt — die Phasen-Kommandos fehlen evtl. Die Struktur
                zeigt den vorgesehenen Ablauf.
              </div>
            )}

            <div className="flex flex-col">
              <PromptCard
                firstPhase={phases[0] ?? null}
                beforeSteps={nodeSteps({ kind: 'before_worktree_create' })}
                afterSteps={nodeSteps({ kind: 'after_worktree_create' })}
                onEditStep={setEditingStep}
                onOpenHub={() => setHubNode({ kind: 'worktree' })}
              />
              <Connector tone="start" label="startet" />
              {phases.map((phase, i) => {
                const next = phases[i + 1] ?? null;
                const conn = next
                  ? phaseConnector(next, automation)
                  : lastToIntegrationConnector(automation);
                return (
                  <div key={phase} className="flex flex-col">
                    <PhaseCard
                      phase={phase}
                      feature={scopedFeature}
                      active={editingPhase === phase}
                      beforeAgents={nodeAgents('before_phase', phase)}
                      afterAgents={nodeAgents('after_phase', phase)}
                      beforeSteps={nodeSteps({ kind: 'before_phase', phase })}
                      afterSteps={nodeSteps({ kind: 'after_phase', phase })}
                      onEditPrompt={() => setEditingPhase((cur) => (cur === phase ? null : phase))}
                      onEditAgent={setEditingAgent}
                      onEditStep={setEditingStep}
                      onOpenHub={() => setHubNode({ kind: 'phase', phase })}
                    />
                    <Connector {...conn} />
                  </div>
                );
              })}
              <IntegrationBlock
                automation={automation}
                project={project}
                feature={scopedFeature}
                reviewAgents={nodeAgents('review_gate')}
                onEditAgent={setEditingAgent}
                stepsFor={nodeSteps}
                onEditStep={setEditingStep}
                onOpenHub={(step) => setHubNode({ kind: 'stage', step })}
              />
            </div>

            <KnowledgeSection
              scope={scope}
              knowledge={knowledge}
              featureKnowledge={featureKnowledge}
              onManage={() => dispatch({ type: 'set_view', view: { kind: 'knowledge', projectId: project.id } })}
            />

            <Legend />
          </div>
        </div>

        {/* ---- Split-Screen: Prompt / Definition (rechts) ---- */}
        {editingPhase && (
          <div className="min-w-0 flex-1">
            <PhaseDefinitionDialog
              variant="panel"
              phase={editingPhase}
              phaseLabel={PHASE_META[editingPhase].label}
              projects={state.app.projects.map((p) => ({ id: p.id, name: p.name }))}
              initialProjectId={project.id}
              onClose={() => setEditingPhase(null)}
            />
          </div>
        )}
      </div>

      {hubNode && (
        <WorkflowTriggerHub
          node={hubNode}
          nodeLabel={nodeLabel(hubNode)}
          stepsFor={nodeSteps}
          agentsFor={nodeAgents}
          onAddStep={(t) => {
            setHubNode(null);
            openNewStep(t);
          }}
          onAddAgent={(t) => {
            setHubNode(null);
            setSlotPicker(t);
          }}
          onEditStep={(s) => {
            setHubNode(null);
            setEditingStep(s);
          }}
          onEditAgent={(a) => {
            setHubNode(null);
            setEditingAgent(a);
          }}
          onClose={() => setHubNode(null)}
        />
      )}
      {slotPicker && (
        <AgentSlotPicker
          trigger={slotPicker}
          agents={agents ?? []}
          onCreate={() => {
            const t = slotPicker;
            setSlotPicker(null);
            openNewAgent(t);
          }}
          onAttach={(a) => {
            void api
              .saveAgent({ ...a, trigger: slotPicker, enabled: true })
              .then(() => {
                setSlotPicker(null);
                reload();
              })
              .catch(fail);
          }}
          onClose={() => setSlotPicker(null)}
        />
      )}
      {(editingAgent || newAgentTrigger) && (
        <AgentEditDialog
          agent={editingAgent}
          projectId={editingAgent ? editingAgent.projectId : project.id}
          {...(newAgentTrigger ? { initialTrigger: newAgentTrigger } : {})}
          onClose={() => {
            setEditingAgent(null);
            setNewAgentTrigger(null);
          }}
          onSaved={() => {
            setEditingAgent(null);
            setNewAgentTrigger(null);
            reload();
          }}
        />
      )}
      {(editingStep || newStepTrigger) && (
        <LifecycleStepEditDialog
          step={editingStep}
          projectId={editingStep ? editingStep.projectId : project.id}
          {...(newStepTrigger ? { initialTrigger: newStepTrigger } : {})}
          onClose={() => {
            setEditingStep(null);
            setNewStepTrigger(null);
          }}
          onSaved={() => {
            setEditingStep(null);
            setNewStepTrigger(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ================= Header =================

function ConfigHeader({
  project,
  automation,
  optimization,
  scope,
  onScope,
  features,
  onRefresh,
}: {
  project: { id: string; name: string; integrationMode: string; mergeMode: string; verifyCommands: unknown[] };
  automation: AutomationSettings;
  optimization: { contextStrategy: string; compression: string };
  scope: Scope;
  onScope: (s: Scope) => void;
  features: Feature[];
  onRefresh: () => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  return (
    <div className="border-b border-zinc-800 px-6 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-sm font-semibold text-zinc-100">Workflow</h1>
        <span className="text-xs text-zinc-500">Aktuelle Konfiguration · {project.name}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowSettings((s) => !s)}
            aria-expanded={showSettings}
            title="Aktive Workflow-Einstellungen ein-/ausblenden"
            className={SECONDARY_BTN}
          >
            <SettingsIcon /> Einstellungen
            <ChevronDownIcon className={showSettings ? 'rotate-180' : ''} />
          </button>
          <span className="text-xs text-zinc-500">Geltung</span>
          <select
            value={scope.kind === 'project' ? '' : scope.featureId}
            onChange={(e) =>
              onScope(e.target.value ? { kind: 'feature', featureId: e.target.value } : { kind: 'project' })
            }
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
          >
            <option value="">Projekt-Standard (global + Projekt)</option>
            {features.map((f) => (
              <option key={f.id} value={f.id}>
                Feature: {f.name}
              </option>
            ))}
          </select>
          <button onClick={onRefresh} title="Konfiguration neu laden" className={SECONDARY_BTN}>
            <RefreshIcon />
          </button>
        </div>
      </div>

      {showSettings && <SettingsPanel automation={automation} project={project} optimization={optimization} />}
    </div>
  );
}

/** Aufklappbarer Einstellungs-Bereich: gruppiert, jede Einstellung mit Tooltip. */
function SettingsPanel({
  automation,
  project,
  optimization,
}: {
  automation: AutomationSettings;
  project: { integrationMode: string; mergeMode: string; verifyCommands: unknown[] };
  optimization: { contextStrategy: string; compression: string };
}) {
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-3">
      <SettingsGroup title="Automation-Dial">
        {(Object.keys(AUTOMATION_META) as (keyof AutomationSettings)[]).map((key) => {
          const meta = AUTOMATION_META[key];
          const { on, value } = automationState(key, automation[key]);
          const tone = on ? 'text-emerald-400' : 'text-amber-400';
          return (
            <SettingRow
              key={key}
              icon={on ? BoltIcon : UserIcon}
              iconTone={tone}
              label={meta.label}
              value={value}
              valueTone={tone}
              help={meta.help}
            />
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="Integration & Merge">
        <SettingRow
          icon={GitMergeIcon}
          label="Integration"
          value={project.integrationMode === 'pr' ? 'GitHub-PR' : 'lokaler Merge'}
          help="Wie integriert wird: lokaler Merge in den Ziel-Branch, oder ein GitHub-Pull-Request via gh."
        />
        <SettingRow
          label="Merge-Strategie"
          value={project.mergeMode === 'squash' ? 'squash' : 'fast-forward'}
          help="Merge-Strategie: fast-forward (lineare Historie beibehalten) oder squash (alle Commits zu einem zusammenfassen)."
        />
        <SettingRow
          icon={VerifyIcon}
          label="Verify-Kommandos"
          value={project.verifyCommands.length > 0 ? `${project.verifyCommands.length} Kommando(s)` : 'keine'}
          help="Test/Build/Lint-Kommandos, die bei der Integration im Worktree laufen (pro Projekt in den Projekt-Einstellungen konfigurierbar)."
        />
      </SettingsGroup>

      <SettingsGroup title="Token-Optimierung">
        <SettingRow
          label="Kontext-Strategie"
          value={optimization.contextStrategy}
          help="Kontext-Reset vor Downstream-Phasen zur Token-Reduktion: full (kein Reset), compact (/compact fasst zusammen), fresh (/clear leert den Verlauf)."
        />
        <SettingRow
          label="Verdichtung"
          value={optimization.compression}
          help="Verdichtung toolkit-injizierter Inhalte (z. B. Wissens-Präambel): off (unverändert), deterministic (regelbasiert), llm (per Modell)."
        />
      </SettingsGroup>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={`${CARD} p-3`}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function SettingRow({
  icon: Icon,
  iconTone = 'text-zinc-500',
  label,
  value,
  valueTone = 'text-zinc-300',
  help,
}: {
  icon?: ComponentType<IconProps>;
  iconTone?: string;
  label: string;
  value: string;
  valueTone?: string;
  help: string;
}) {
  return (
    <div className="flex items-center gap-2" title={help}>
      {Icon && <Icon className={`shrink-0 ${iconTone}`} />}
      <span className="text-xs text-zinc-400">{label}</span>
      <span className={`ml-auto truncate text-right text-xs ${valueTone}`}>{value}</span>
      <InfoIcon className="shrink-0 cursor-help text-zinc-600" title={`${label}: ${help}`} />
    </div>
  );
}

function automationState(flag: keyof AutomationSettings, value: unknown): { on: boolean; value: string } {
  const meta = AUTOMATION_META[flag];
  if (flag === 'autoProgressUntil') {
    const on = value !== 'off';
    return { on, value: on ? `bis ${String(value)}` : 'aus' };
  }
  const on = value === true;
  return { on, value: on ? meta.onLabel : meta.offLabel };
}

// ================= Flow-Knoten =================

function PromptCard({
  firstPhase,
  beforeSteps,
  afterSteps,
  onEditStep,
  onOpenHub,
}: {
  firstPhase: FeaturePhase | null;
  beforeSteps: NodeStep[];
  afterSteps: NodeStep[];
  onEditStep: (s: LifecycleStep) => void;
  onOpenHub: () => void;
}) {
  return (
    <div className={`${CARD} w-full p-3`}>
      <div className="flex items-center gap-2">
        <UserIcon className="text-zinc-400" />
        <span className="text-sm font-semibold text-zinc-100">{PROMPT_NODE_TITLE}</span>
        <InfoPopover label="Feature-Anlage">
          Name + Beschreibung (manuell, aus dem Projekt-Chat oder aus einem Jira-Ticket). Die Beschreibung
          wird an den ersten Schritt angehängt und startet ihn.
        </InfoPopover>
        <TriggerHubButton onOpen={onOpenHub} nodeLabel={PROMPT_NODE_TITLE} />
      </div>

      {/* Die ENTSTEHENDEN ARTEFAKTE bleiben sichtbar — sie sind Ergebnis, nicht
          Erklärung; nur der erklärende Satz wandert hinter das ⓘ (FR-022). */}
      <p className="mt-1.5 text-[11px] text-zinc-400">
        <code className="rounded bg-zinc-800 px-1 text-[11px] text-zinc-300">feature/&lt;slug&gt;</code> · git-Worktree
        · Claude-Session
      </p>

      {firstPhase && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <code className="truncate rounded bg-zinc-950 px-2 py-1 font-mono text-[11px] text-sky-400">
            /speckit-{firstPhase}
          </code>
          <InfoPopover label="Erster Schritt">
            Die Beschreibung wird an den ersten Schritt (<code className="text-zinc-300">/speckit-{firstPhase}</code>)
            angehängt und startet ihn.
          </InfoPopover>
        </div>
      )}
      <LifecycleSteps stage="worktree_create" />

      <StepZone
        kind="before_worktree_create"
        hint="Läuft im Haupt-Checkout, bevor der Worktree entsteht; kennt bereits den künftigen Pfad."
        steps={beforeSteps}
        onEdit={onEditStep}
      />
      <StepZone
        kind="after_worktree_create"
        hint="Läuft im neuen Worktree, bevor die erste Phase startet; blockierender Fehlschlag hält an."
        steps={afterSteps}
        onEdit={onEditStep}
      />
    </div>
  );
}

function PhaseCard({
  phase,
  feature,
  active,
  beforeAgents,
  afterAgents,
  beforeSteps,
  afterSteps,
  onEditPrompt,
  onEditAgent,
  onEditStep,
  onOpenHub,
}: {
  phase: FeaturePhase;
  feature: Feature | null;
  active: boolean;
  beforeAgents: NodeAgent[];
  afterAgents: NodeAgent[];
  beforeSteps: NodeStep[];
  afterSteps: NodeStep[];
  onEditPrompt: () => void;
  onEditAgent: (a: AgentDefinition) => void;
  onEditStep: (s: LifecycleStep) => void;
  onOpenHub: () => void;
}) {
  const meta = PHASE_META[phase];
  const status = feature?.phases[phase]?.status;
  return (
    <div className={`${CARD} flex w-full flex-col p-3 ${active ? 'border-sky-700 ring-1 ring-sky-800' : ''}`}>
      <div className="flex items-center gap-2">
        {status && <PhaseStatusDot status={status} />}
        <span className="text-sm font-semibold text-zinc-100">{meta.label}</span>
        {isOptionalPhase(phase) && (
          <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400" title="Pro Projekt abschaltbar">
            optional
          </span>
        )}
        <InfoPopover label={`Zweck — ${meta.label}`}>{meta.purpose}</InfoPopover>
        <TriggerHubButton onOpen={onOpenHub} nodeLabel={meta.label} />
      </div>
      <code
        className="mt-1.5 block truncate rounded bg-zinc-950 px-2 py-1 font-mono text-[11px] text-sky-400"
        title="Prefix je nach Repo: /speckit- (Skills) oder /speckit. (Commands)"
      >
        /speckit-{phase} specs/&lt;feature&gt;
      </code>

      <button
        onClick={onEditPrompt}
        className={`mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded border px-2 py-1 text-xs ${
          active
            ? 'border-sky-700 bg-sky-950/40 text-sky-300'
            : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
        }`}
      >
        <EditIcon /> {active ? 'Prompt geöffnet →' : 'Prompt ansehen / bearbeiten'}
      </button>

      <div
        className="mt-2 flex items-center gap-1.5 text-[11px] text-sky-400"
        title="Vor der Phase wird das relevante Projektwissen materialisiert und per Präambel an den Prompt gehängt."
      >
        <KnowledgeIcon className="shrink-0" /> Projektwissen injiziert
      </div>

      <LifecycleSteps stage="phase_start" />
      <LifecycleSteps stage="phase_end" attached />

      {/* Schritte stehen ÜBER den Agents — die Anordnung spiegelt die
          Ausführungsreihenfolge: Schritte bereiten vor, Agents beurteilen. */}
      <StepZone
        kind="before_phase"
        hint="Läuft VOR dem Agenten-Gate und vor dem Phasenstart; blockierender Fehlschlag hält die Phase auf idle."
        steps={beforeSteps}
        onEdit={onEditStep}
      />
      <AgentZone
        title={AGENT_TRIGGER_META.before_phase.label}
        hint="Läuft VOR dem Start; blockierender FAIL verhindert den Phasenstart."
        agents={beforeAgents}
        onEdit={onEditAgent}
      />
      <StepZone
        kind="after_phase"
        hint="Läuft NACH Abschluss, vor dem Agenten-Gate und vor jedem Auto-Progress."
        steps={afterSteps}
        onEdit={onEditStep}
      />
      <AgentZone
        title={AGENT_TRIGGER_META.after_phase.label}
        hint="Läuft NACH Abschluss vor dem Auto-Progress; blockierender FAIL hält die Phase auf awaiting_review."
        agents={afterAgents}
        onEdit={onEditAgent}
      />
    </div>
  );
}

/**
 * Aufklappbare Schrittliste einer Lebenszyklus-Stufe: „Was das Toolkit hier tut".
 *
 * Beschreibt die FEST VERDRAHTETE Arbeit des Toolkits an diesem Knoten, im
 * Unterschied zum übrigen Knoten-Inhalt, der die aktuelle Konfiguration zeigt.
 * Quelle ist der statisch importierte Katalog aus @sdd/shared — keine
 * Serveranfrage, kein Ladezustand, kein Leerzustand (eine Stufe ohne Schritte
 * ist ein Testfehler, kein UI-Fall). Zustand ist bewusst flüchtig und lokal:
 * jede Instanz schaltet unabhängig, Startzustand zugeklappt (FR-014).
 */
function LifecycleSteps({
  stage,
  attached = false,
}: {
  stage: LifecycleCatalogStageId;
  /** Hängt direkt am vorigen Abschnitt — ohne eigene Trennlinie, die nichts trennt. */
  attached?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { title, when, steps, notDoneHere } = lifecycleStage(stage);

  return (
    <div className={attached ? 'mt-1' : 'mt-2 border-t border-zinc-800 pt-2'}>
      <div className="flex items-center gap-1.5">
        {/* Der Titel kommt aus dem Katalog. Vorher stand an JEDER Stufe
            „Was das Toolkit hier tut" — an einer Phasenkarte zweimal wortgleich
            untereinander, ohne dass die Beschriftung sagte, welche welche ist. */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={`${title}: die fest verdrahteten Schritte des Toolkits an dieser Stelle`}
          className="flex items-center gap-1.5 text-left text-[11px] text-zinc-400 hover:text-zinc-200"
        >
          <ChevronDownIcon className={`shrink-0 ${open ? 'rotate-180' : ''}`} />
          <span>
            {title} ({steps.length})
          </span>
        </button>
        <InfoPopover label={title}>
          <p>{when}</p>
          {notDoneHere && (
            <p className="mt-2 border-t border-zinc-800 pt-1.5">
              <span className="text-zinc-400">Nicht Aufgabe des Toolkits:</span> {notDoneHere}
            </p>
          )}
        </InfoPopover>
      </div>

      {open && (
        <ol className="mt-1.5 space-y-1">
          {steps.map((step, i) => (
            /* EINE Zeile je Eintrag: Nummer + Name, rechts das ⓘ mit allen
               übrigen Feldern. Vorher belegte jeder Eintrag 4–6 Zeilen. */
            <li key={step.id} className="flex items-center gap-2">
              <span className="shrink-0 text-[11px] tabular-nums text-zinc-600">{i + 1}.</span>
              <span className="truncate text-[11px] font-medium text-zinc-200">{step.name}</span>
              <InfoPopover label={step.name} className="ml-auto">
                <p>{step.description}</p>
                <p className="mt-1.5">
                  <span className="text-zinc-500">Wann:</span> {step.trigger}
                </p>
                <p className="mt-1.5 break-words font-mono text-[10px] text-zinc-500">
                  {step.location.file} · {step.location.symbol}
                </p>
                {step.condition && (
                  <p className="mt-1.5">
                    <span className="text-zinc-500">Nur wenn:</span> {step.condition}
                  </p>
                )}
                {step.orderNote && (
                  <p className="mt-1.5 rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1 text-[10px] leading-snug text-amber-300">
                    <span className="font-medium">Reihenfolge:</span> {step.orderNote}
                  </p>
                )}
              </InfoPopover>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NodeHeader({ icon: Icon, title }: { icon: ComponentType<IconProps>; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="text-zinc-400" />
      <span className="text-sm font-semibold text-zinc-100">{title}</span>
    </div>
  );
}

function PhaseStatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved: 'bg-emerald-400',
    awaiting_review: 'bg-amber-400',
    running: 'bg-sky-400 animate-pulse',
    idle: 'bg-zinc-600',
  };
  return <span className={`h-2 w-2 rounded-full ${map[status] ?? 'bg-zinc-600'}`} title={`Status: ${status}`} />;
}

/**
 * Zone der Agents eines Auslöserpunkts. Rendert NICHTS, wenn nichts konfiguriert
 * ist: der leere Punkt bleibt über den Hub des Knotens erreichbar (FR-001, FR-002).
 */
function AgentZone({
  title,
  hint,
  agents,
  onEdit,
}: {
  title: string;
  hint: string;
  agents: NodeAgent[];
  onEdit: (a: AgentDefinition) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <div className="mt-2 border-t border-zinc-800 pt-2">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500" title={hint}>
          {title}
        </span>
      </div>
      <ul className="mt-1 space-y-1">
        {agents.map((na) => (
          <AgentChip key={na.agent.id} na={na} onEdit={onEdit} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Zone der Lebenszyklus-Schritte eines Auslöserpunkts — optisch der Zwilling von
 * {@link AgentZone}. Der Titel kommt IMMER aus `LIFECYCLE_TRIGGER_META`, nie aus
 * einem lokalen Literal: eine neue Auslöser-Art erzwingt dort einen Eintrag und
 * erscheint damit automatisch (FR-008). Ohne Einträge rendert die Zone nichts —
 * der Punkt bleibt über den Hub erreichbar (FR-001).
 */
function StepZone({
  kind,
  hint,
  steps,
  onEdit,
}: {
  kind: LifecycleTriggerKind;
  hint: string;
  steps: NodeStep[];
  onEdit: (s: LifecycleStep) => void;
}) {
  if (steps.length === 0) return null;
  return (
    <div className="mt-2 border-t border-zinc-800 pt-2">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500" title={hint}>
          {LIFECYCLE_TRIGGER_META[kind].title}
        </span>
      </div>
      <ul className="mt-1 space-y-1">
        {steps.map((ns) => (
          <StepChip key={ns.step.id} ns={ns} onEdit={onEdit} />
        ))}
      </ul>
    </div>
  );
}

/** Titel des Prompt-/Worktree-Knotens — einmal definiert, in Kopf und Hub benutzt. */
const PROMPT_NODE_TITLE = 'User-Prompt';

/**
 * Beschriftung eines Knotens für Hub-Titel und `aria-label`. Kommt aus denselben
 * Quellen wie die Kopfzeile des Knotens, nie aus einem zweiten Literal (FR-026).
 */
function nodeLabel(node: WorkflowNode): string {
  if (node.kind === 'worktree') return PROMPT_NODE_TITLE;
  if (node.kind === 'phase') return PHASE_META[node.phase].label;
  return node.step.label;
}

function triggerLabel(t: AgentTrigger): string {
  const meta = AGENT_TRIGGER_META[t.kind];
  if ((t.kind === 'before_phase' || t.kind === 'after_phase') && t.phase) {
    return `${meta.short} ${PHASE_META[t.phase].label}`;
  }
  return meta.label;
}

/**
 * Auswahl beim „+" eines Slots: neuen Agent erstellen ODER einen bestehenden Agent
 * (aus einem anderen Slot / manuell) hier einhängen — das setzt dessen Auslöser auf
 * diesen Slot (transparent: aktuelle Position ist je Zeile angezeigt).
 */
function AgentSlotPicker({
  trigger,
  agents,
  onCreate,
  onAttach,
  onClose,
}: {
  trigger: AgentTrigger;
  agents: AgentDefinition[];
  onCreate: () => void;
  onAttach: (a: AgentDefinition) => void;
  onClose: () => void;
}) {
  const inSlot = (t: AgentTrigger) => t.kind === trigger.kind && t.phase === trigger.phase;
  const candidates = [...agents].filter((a) => !inSlot(a.trigger)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Dialog title={`Agent hinzufügen — ${triggerLabel(trigger)}`} onClose={onClose} wide>
      <button
        onClick={onCreate}
        className="mb-4 flex w-full items-center justify-center gap-1.5 rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-950/60"
      >
        <PlusIcon /> Neuen Agent erstellen
      </button>
      <div className="mb-2 text-xs text-zinc-500">… oder einen bestehenden Agent hier einhängen:</div>
      {candidates.length === 0 ? (
        <p className="rounded border border-zinc-800 px-3 py-4 text-center text-xs text-zinc-600">
          Keine weiteren Agents vorhanden.
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {candidates.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => onAttach(a)}
                className="flex w-full items-center gap-2 rounded border border-zinc-800 px-3 py-2 text-left hover:bg-zinc-800"
                title="Hier einhängen — setzt den Auslöser dieses Agents auf diesen Slot (aktiviert ihn)"
              >
                <ShieldIcon className={`shrink-0 ${a.blocking ? 'text-amber-400' : 'text-zinc-500'}`} />
                <span className="truncate text-sm text-zinc-200">{a.name}</span>
                <span
                  className={`shrink-0 rounded px-1 text-[9px] ${a.blocking ? 'bg-red-950/60 text-red-300' : 'bg-zinc-800 text-zinc-400'}`}
                >
                  {a.blocking ? 'Gate' : 'Hinweis'}
                </span>
                {a.projectId === null && (
                  <span
                    className="shrink-0 rounded bg-zinc-800 px-1 text-[9px] text-zinc-400"
                    title="Globaler Agent — die Änderung gilt in allen Projekten"
                  >
                    global
                  </span>
                )}
                {!a.enabled && (
                  <span className="shrink-0 rounded bg-zinc-800 px-1 text-[9px] text-zinc-500">inaktiv</span>
                )}
                <span className="ml-auto shrink-0 text-[10px] text-zinc-500">aktuell: {triggerLabel(a.trigger)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

// ----- Verbindungen -----

interface ConnProps {
  tone: 'auto' | 'human' | 'start';
  label: string;
}

function phaseConnector(next: FeaturePhase, automation: AutomationSettings): ConnProps {
  return shouldAutoProgress(next, automation)
    ? { tone: 'auto', label: 'automatisch' }
    : { tone: 'human', label: 'Freigabe' };
}

function lastToIntegrationConnector(automation: AutomationSettings): ConnProps {
  return automation.autoVerify ? { tone: 'auto', label: 'automatisch' } : { tone: 'human', label: 'manuell' };
}

function Connector({ tone, label }: ConnProps) {
  const color = tone === 'auto' ? 'text-emerald-400' : tone === 'human' ? 'text-amber-400' : 'text-zinc-500';
  const Icon = tone === 'auto' ? BoltIcon : tone === 'human' ? UserIcon : null;
  return (
    <div className="flex items-center justify-center gap-1.5 py-1.5">
      {Icon && <Icon className={color} />}
      <ArrowRightIcon className={`rotate-90 ${color}`} />
      <span className={`text-[11px] ${color}`}>{label}</span>
    </div>
  );
}

// ================= Integration =================

function IntegrationBlock({
  automation,
  project,
  feature,
  reviewAgents,
  onEditAgent,
  stepsFor,
  onEditStep,
  onOpenHub,
}: {
  automation: AutomationSettings;
  project: { integrationMode: string; mergeMode: string; verifyCommands: unknown[] };
  feature: Feature | null;
  reviewAgents: NodeAgent[];
  onEditAgent: (a: AgentDefinition) => void;
  stepsFor: (t: LifecycleTrigger) => NodeStep[];
  onEditStep: (s: LifecycleStep) => void;
  onOpenHub: (step: IntegrationStep) => void;
}) {
  return (
    <div className={`${CARD} w-full p-3`}>
      <div className="flex items-center gap-2">
        <GitMergeIcon className="text-zinc-400" />
        <span className="text-sm font-semibold text-zinc-100">Integration</span>
        <span className="text-[11px] text-zinc-500">nach der letzten Phase</span>
        <InfoPopover label="Eskalation">
          Scheitert Verify/Gate/Merge, wird <span className="text-red-400">eskaliert</span> in die
          „Braucht dich"-Inbox — nie blind gemergt. Der Merge läuft in einem separaten Worktree; der
          Haupt-Checkout wird nie umgeschaltet.
        </InfoPopover>
        {feature && feature.integration !== 'none' && <StageBadge stage={feature.integration} />}
      </div>

      <LifecycleSteps stage="integration" />

      <div className="mt-3 flex flex-col">
        {INTEGRATION_STEPS.map((step, i) => (
          <div key={step.id} className="flex flex-col">
            <IntegrationStepPill
              step={step}
              automation={automation}
              project={project}
              reviewAgents={step.showsReviewGateAgents ? reviewAgents : null}
              onEditAgent={onEditAgent}
              beforeSteps={stepsFor({ kind: 'before_stage', stage: step.id })}
              afterSteps={stepsFor({ kind: 'after_stage', stage: step.id })}
              onEditStep={onEditStep}
              onOpenHub={() => onOpenHub(step)}
            />
            {i < INTEGRATION_STEPS.length - 1 && (
              <div className="flex justify-center py-0.5 text-zinc-600">
                <ArrowRightIcon className="rotate-90" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Icon je Integrationsstufe. Über `Record<LifecycleStageId, …>` VOLLSTÄNDIG getypt
 * und ohne Fallback: eine neue Stufe bricht hier den Typcheck, statt still das
 * Icon der Verifikation zu erben (FR-017, SC-010). Genau das war der Fehler —
 * „Manuelle Abnahme" hatte keinen Eintrag und trug deshalb das Verify-Icon.
 */
const STEP_ICON: Record<LifecycleStageId, ComponentType<IconProps>> = {
  verify: VerifyIcon,
  review_gate: ScalesIcon,
  manual_test: FlaskIcon,
  human_review: ReviewIcon,
  merge_queue: GitMergeIcon,
  merged: CheckIcon,
};

function IntegrationStepPill({
  step,
  automation,
  project,
  reviewAgents,
  onEditAgent,
  beforeSteps,
  afterSteps,
  onEditStep,
  onOpenHub,
}: {
  step: IntegrationStep;
  automation: AutomationSettings;
  project: { integrationMode: string; mergeMode: string; verifyCommands: unknown[] };
  reviewAgents: NodeAgent[] | null;
  onEditAgent: (a: AgentDefinition) => void;
  beforeSteps: NodeStep[];
  afterSteps: NodeStep[];
  onEditStep: (s: LifecycleStep) => void;
  onOpenHub: () => void;
}) {
  const skipped = step.requires ? automation[step.requires] !== true : false;
  const humanHalt = step.humanUnless ? automation[step.humanUnless] !== true : false;
  const humanSkipped = step.humanUnless ? automation[step.humanUnless] === true : false;
  const auto = step.autoBy ? automation[step.autoBy] === true : false;

  let badge: { text: string; tone: 'auto' | 'human' | 'skip' | 'done' } | null = null;
  if (step.terminal) badge = { text: 'Ziel', tone: 'done' };
  else if (skipped) badge = { text: 'übersprungen', tone: 'skip' };
  else if (humanHalt) badge = { text: 'Human-Review', tone: 'human' };
  else if (humanSkipped) badge = { text: 'entfällt (Auto-Merge)', tone: 'skip' };
  else if (step.autoBy) badge = auto ? { text: 'automatisch', tone: 'auto' } : { text: 'manuell', tone: 'human' };

  const Icon = STEP_ICON[step.id];
  const iconTone =
    badge?.tone === 'auto' || badge?.tone === 'done'
      ? 'text-emerald-400'
      : badge?.tone === 'human'
        ? 'text-amber-400'
        : 'text-zinc-500';

  return (
    <div className={`flex w-full flex-col rounded border border-zinc-800 bg-zinc-900/40 p-2 ${badge?.tone === 'skip' ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-1.5">
        <Icon className={`shrink-0 ${iconTone}`} />
        <span className="text-xs font-medium text-zinc-100">{step.label}</span>
        <InfoPopover label={step.label}>{step.detail}</InfoPopover>
        {badge && (
          <span className="ml-auto">
            <BadgePill {...badge} />
          </span>
        )}
        <TriggerHubButton onOpen={onOpenHub} nodeLabel={step.label} />
      </div>

      {/* Die Merge-Arbeit passiert hier (rebase, Konfliktauflösung, Re-Verify, Merge) —
          nicht am terminalen Schritt 'merged', der nur das Ergebnis ist. */}
      {step.id === 'merge_queue' && <LifecycleSteps stage="merge" />}

      {step.id === 'verify' && (
        <p className="mt-1 text-[10px] text-zinc-600">
          {project.verifyCommands.length > 0
            ? `${project.verifyCommands.length} Verify-Kommando(s)`
            : 'keine Verify-Kommandos konfiguriert'}
        </p>
      )}
      {step.id === 'merged' && (
        <p className="mt-1 text-[10px] text-zinc-600">
          {project.integrationMode === 'pr' ? 'GitHub-PR' : `lokaler Merge (${project.mergeMode})`}
        </p>
      )}

      {step.escalatesTo && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-red-400/80" title="Bei Fehlschlag">
          <WarningIcon className="shrink-0" /> {INTEGRATION_STAGE_META[step.escalatesTo].label}
        </p>
      )}

      {/* Schritte vor der Stufenarbeit — und, nach dem Erfolg der Stufe, danach.
          Beide Zonen entstehen aus INTEGRATION_STEPS × LIFECYCLE_TRIGGER_META, nie
          aus lokalen Literalen: eine neue Stufe bringt ihre Zonen automatisch mit. */}
      <StepZone
        kind="before_stage"
        hint={`Läuft vor der Stufe „${step.label}"; blockierender Fehlschlag hält die Pipeline hier an.`}
        steps={beforeSteps}
        onEdit={onEditStep}
      />
      {reviewAgents && reviewAgents.length > 0 && (
        <div className="mt-1.5 border-t border-zinc-800 pt-1.5">
          <span className="text-[9px] uppercase tracking-wide text-zinc-500">
            {AGENT_TRIGGER_META.review_gate.label}
          </span>
          <ul className="mt-1 space-y-1">
            {reviewAgents.map((na) => (
              <AgentChip key={na.agent.id} na={na} onEdit={onEditAgent} />
            ))}
          </ul>
        </div>
      )}

      {/* Nach der Stufenarbeit — bei „Review-Gate" also nach den Agents: die
          Anordnung spiegelt durchgehend die Ausführungsreihenfolge. */}
      <StepZone
        kind="after_stage"
        hint={`Läuft nach erfolgreicher Stufe „${step.label}"; blockierender Fehlschlag hält die Pipeline hier an.`}
        steps={afterSteps}
        onEdit={onEditStep}
      />
    </div>
  );
}

function BadgePill({ text, tone }: { text: string; tone: 'auto' | 'human' | 'skip' | 'done' }) {
  const cls =
    tone === 'auto' || tone === 'done'
      ? 'bg-emerald-950/60 text-emerald-300'
      : tone === 'human'
        ? 'bg-amber-950/60 text-amber-300'
        : 'bg-zinc-800 text-zinc-500';
  return <span className={`w-fit rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{text}</span>;
}

function StageBadge({ stage }: { stage: Feature['integration'] }) {
  const meta = INTEGRATION_STAGE_META[stage];
  const cls =
    meta.tone === 'escalation'
      ? 'bg-red-950/60 text-red-300'
      : meta.tone === 'human'
        ? 'bg-amber-950/60 text-amber-300'
        : meta.tone === 'done'
          ? 'bg-emerald-950/60 text-emerald-300'
          : 'bg-sky-950/60 text-sky-300';
  return <span className={`ml-auto rounded px-2 py-0.5 text-[10px] ${cls}`}>aktuell: {meta.label}</span>;
}

// ================= Wissen =================

function KnowledgeSection({
  scope,
  knowledge,
  featureKnowledge,
  onManage,
}: {
  scope: Scope;
  knowledge: KnowledgeResponse | null;
  featureKnowledge: FeatureKnowledgeResponse | null;
  onManage: () => void;
}) {
  const items: KnowledgeIndexItem[] =
    scope.kind === 'feature' ? (featureKnowledge?.index.items ?? []) : (knowledge?.index.items ?? []);
  const effective = new Set(scope.kind === 'feature' ? (featureKnowledge?.resolved.effective ?? []) : []);

  return (
    <div className={`${CARD} mt-6 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <KnowledgeIcon className="text-sky-400" />
        <span className="text-sm font-semibold text-zinc-100">Projektspezifisches Wissen</span>
        <span className="text-xs text-zinc-500">wird vor jeder Phase injiziert</span>
        {/* Wissens-Prosa UND Präambel-Text in EINEM Popover — beides erklärt
            dasselbe und wurde vorher als 9 Zeilen Dauertext gezeigt (FR-020). */}
        <InfoPopover label="Wie das Wissen injiziert wird">
          <p>
            Vor jedem Phasenstart wird das <strong className="text-zinc-200">relevante</strong> Wissen nach{' '}
            <code className="rounded bg-zinc-800 px-1 text-[11px] text-zinc-300">.sdd/knowledge/</code>{' '}
            materialisiert (git-excluded) und per kompakter Präambel an den Phasen-Prompt gehängt. Relevanz wird
            automatisch aus der Anwendbarkeit vorgeschlagen
            {scope.kind === 'feature' ? ' und ist pro Feature übersteuerbar' : ' (pro Feature übersteuerbar)'}.
          </p>
          <div className="mt-2 rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">An den Prompt angehängt</span>
            <p className="mt-1 text-zinc-300">
              Konsultiere zuerst die Wissens-Übersicht (
              <code className="rounded bg-zinc-800 px-1 text-[11px]">.sdd/knowledge/index.md</code>) und lies nur
              die dort als <span className="rounded bg-sky-950/60 px-1 text-[11px] text-sky-300">relevant</span>{' '}
              markierten Bundles und Einträge — nicht den gesamten Kontext einlesen.
            </p>
          </div>
        </InfoPopover>
        <button onClick={onManage} className={`${SECONDARY_BTN} ml-auto`}>
          Wissen verwalten
          <ArrowRightIcon />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-600">
          Noch kein Projektwissen hinterlegt — über „Wissen verwalten" Bundles/Einträge anlegen.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-1 md:grid-cols-2">
          {items.map((it) => {
            const rel = scope.kind === 'feature' ? effective.has(it.id) : null;
            const Icon = it.kind === 'bundle' ? BundleIcon : EntryIcon;
            return (
              <li
                key={it.id}
                className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                  rel === false ? 'border-zinc-800/60 text-zinc-500 opacity-70' : 'border-zinc-800 text-zinc-300'
                }`}
                style={{ marginLeft: it.parentId ? 16 : 0 }}
              >
                <Icon className="shrink-0 text-zinc-500" />
                <span className="truncate">{it.label}</span>
                {rel === true && (
                  <span className="ml-auto shrink-0 rounded bg-sky-950/60 px-1 text-[9px] text-sky-300">
                    relevant
                  </span>
                )}
                {it.applicability.text && (
                  <span
                    className={`shrink-0 truncate text-[10px] text-zinc-600 ${rel === true ? '' : 'ml-auto'}`}
                    title={it.applicability.text}
                  >
                    {it.applicability.tags.length > 0 ? it.applicability.tags.join(', ') : it.applicability.text}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ================= Legende =================

/**
 * Die achtteilige Legende, hinter EIN ⓘ am Fuß gelegt (FR-021). Der Inhalt ist
 * unverändert — er wird nur einmal nachgeschlagen, statt dauerhaft acht Zeilen
 * am Ende jeder Ansicht zu belegen.
 */
function Legend() {
  return (
    <div className="mt-6 flex items-center gap-1.5 border-t border-zinc-800 pt-3 text-[11px] text-zinc-500">
      <span>Legende</span>
      <InfoPopover label="Legende">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            <BoltIcon className="text-emerald-400" /> automatisch
          </span>
          <span className="flex items-center gap-1.5">
            <UserIcon className="text-amber-400" /> Human-in-the-Loop
          </span>
          <span className="flex items-center gap-1.5">
            <WarningIcon className="text-red-400" /> Eskalation → Braucht dich
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldIcon className="text-amber-400" /> Agent-Gate (blockierend)
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldIcon className="text-zinc-500" /> Agent-Hinweis (beratend)
          </span>
          <span className="flex items-center gap-1.5">
            <StepsIcon className="text-amber-400" /> Schritt (blockierend)
          </span>
          <span className="flex items-center gap-1.5">
            <StepsIcon className="text-zinc-500" /> Schritt (beratend)
          </span>
          <span className="flex items-center gap-1.5">
            <KnowledgeIcon className="text-sky-400" /> Projektwissen-Injektion
          </span>
        </div>
      </InfoPopover>
    </div>
  );
}
