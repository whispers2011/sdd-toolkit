import { createContext, useContext, useEffect, useState, type DragEvent } from 'react';
import type { Feature, FeatureArtifactStep, FeaturePhase } from '@sdd/shared';
import { FEATURE_PHASES, evaluateAction } from '@sdd/shared';
import { api } from '../api.js';
import { featureActionContext, isShowCompleted, useStore } from '../store.js';
import { ActionButton, ActionGroup, blockedReason, useAction } from './FeatureAction.js';
import { ReviewPortal } from './ReviewPortal.js';
import { PhaseDefinitionDialog } from './PhaseDefinitionDialog.js';
import { FeatureResultDialog } from './FeatureResultDialog.js';
import { ConfirmDialog } from './Sidebar.js';
import { PresetChip } from './ProjectSettings.js';
import { LEVEL2_DEFAULTS, LEVEL3_DEFAULTS, INTEGRATION_STAGE_META, INTEGRATION_TONE_CLASS } from '@sdd/shared';
import { FeatureAgentSelect } from './FeatureAgentSelect.js';
import {
  SpecifyResultIcon,
  PlanResultIcon,
  TasksResultIcon,
  ChecklistResultIcon,
  SettingsIcon,
  ShieldIcon,
  ArchiveIcon,
  ScalesIcon,
  ArrowRightIcon,
  RestartIcon,
  ReviewIcon,
  type IconProps,
} from './icons.js';

/** Icon je artefakt-erzeugendem Schritt (Kachel-Ergebnis-Icons). */
const RESULT_ICONS: Partial<Record<FeaturePhase, (p: IconProps) => React.ReactElement>> = {
  specify: SpecifyResultIcon,
  plan: PlanResultIcon,
  tasks: TasksResultIcon,
  checklist: ChecklistResultIcon,
};

const OpenReviewContext = createContext<(featureId: string) => void>(() => {});

type Column = FeaturePhase | 'integration' | 'done';

const PHASE_LABELS: Record<FeaturePhase, string> = {
  specify: 'Specify',
  clarify: 'Clarify',
  plan: 'Plan',
  checklist: 'Checklist',
  analyze: 'Analyze',
  tasks: 'Tasks',
  implement: 'Implement',
};

/** Spalte, in der ein Feature aktuell steht. */
function columnOf(feature: Feature): Column {
  if (feature.integration === 'merged') return 'done';
  if (feature.integration !== 'none') return 'integration';
  for (const p of FEATURE_PHASES) {
    const state = feature.phases[p];
    if (state && state.status !== 'approved') return p;
  }
  return 'integration'; // alles approved → bereit zur Integration
}

export function KanbanBoard() {
  const { state, dispatch } = useStore();
  const [dragOver, setDragOver] = useState<Column | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [reviewFeatureId, setReviewFeatureId] = useState<string | null>(null);
  const [defPhase, setDefPhase] = useState<FeaturePhase | null>(null);
  const run = useAction();
  if (!state.app) return null;

  const showCompleted = isShowCompleted(state, state.selectedProjectId);
  const features = state.app.features.filter(
    (f) => f.projectId === state.selectedProjectId && (showCompleted || f.integration !== 'merged'),
  );
  const enabledUnion = new Set<FeaturePhase>();
  for (const p of state.app.projects) {
    if (p.id !== state.selectedProjectId) continue;
    for (const phase of p.enabledPhases) enabledUnion.add(phase);
  }
  const phaseColumns = FEATURE_PHASES.filter((p) => enabledUnion.has(p));
  // Done-Spalte nur zeigen, wenn Abgeschlossene eingeblendet sind.
  const columns: Column[] = [...phaseColumns, 'integration', ...(showCompleted ? (['done'] as Column[]) : [])];

  /** Der Integrations-Befund des gerade gezogenen Features (null = kein Zug aktiv). */
  const integrateVerdict = (featureId: string | null) => {
    const ctx = featureId ? featureActionContext(state, featureId) : null;
    return ctx ? evaluateAction('integrate', ctx) : null;
  };

  // FR-018: Der Kartenzug in die Integrations-Spalte ist ein Bedienweg wie jeder
  // andere und unterliegt derselben Festlegung. Schritt-Spalten sind gar kein
  // Drop-Ziel mehr (FR-029) — es gibt keine Sammel-Freigabe.
  const onDropIntegration = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const featureId = e.dataTransfer.getData('text/feature-id');
    if (!featureId) return;
    const verdict = integrateVerdict(featureId);
    if (!verdict || verdict.availability !== 'available') {
      // Der Zug ist eine ausdrückliche Absicht — der Grund gehört genannt,
      // auch wenn die Schaltfläche im aktuellen Zustand gar nicht erschiene.
      if (verdict?.reason) dispatch({ type: 'error', message: verdict.reason });
      return;
    }
    run(`integrate:${featureId}`, () => api.integrate(featureId));
  };

  return (
    <OpenReviewContext.Provider value={setReviewFeatureId}>
    {reviewFeatureId && <ReviewPortal featureId={reviewFeatureId} onClose={() => setReviewFeatureId(null)} />}
    {defPhase &&
      (() => {
        const all = state.app!.projects;
        const scoped = state.selectedProjectId
          ? all.filter((p) => p.id === state.selectedProjectId)
          : all;
        const withPhase = scoped.filter((p) => p.enabledPhases.includes(defPhase));
        const candidates = (withPhase.length ? withPhase : scoped).map((p) => ({ id: p.id, name: p.name }));
        const first = candidates[0];
        if (!first) return null;
        return (
          <PhaseDefinitionDialog
            phase={defPhase}
            phaseLabel={PHASE_LABELS[defPhase]}
            projects={candidates}
            initialProjectId={first.id}
            onClose={() => setDefPhase(null)}
          />
        );
      })()}
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {columns.map((column) => {
        const items = features.filter((f) => columnOf(f) === column);
        // Nur die Integrations-Spalte nimmt Karten an; die Markierung erscheint
        // ausschließlich, wenn der Zug auch etwas bewirken würde.
        const isDropTarget = column === 'integration';
        const wouldAccept = isDropTarget && integrateVerdict(draggingId)?.availability === 'available';
        return (
          <div
            key={column}
            {...(isDropTarget
              ? {
                  onDragOver: (e: DragEvent) => {
                    e.preventDefault();
                    setDragOver(wouldAccept ? column : null);
                  },
                  onDragLeave: () => setDragOver(null),
                  onDrop: onDropIntegration,
                }
              : {})}
            className={`flex w-64 shrink-0 flex-col rounded-lg border ${
              dragOver === column ? 'border-emerald-600 bg-zinc-900' : 'border-zinc-800 bg-zinc-925'
            }`}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                  {column === 'integration' ? 'Integration' : column === 'done' ? 'Done' : PHASE_LABELS[column]}
                </h3>
                {column !== 'integration' && column !== 'done' && (
                  <button
                    onClick={() => setDefPhase(column)}
                    title="Was macht dieser Schritt? (Spezifikation ansehen/bearbeiten)"
                    className="flex h-4 w-4 items-center justify-center rounded-full border border-zinc-600 text-[10px] leading-none font-serif text-zinc-400 hover:border-zinc-400 hover:text-zinc-200"
                  >
                    i
                  </button>
                )}
              </div>
              <span className="text-xs text-zinc-600">{items.length}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {items.map((feature) => (
                <FeatureCard
                  key={feature.id}
                  feature={feature}
                  column={column}
                  onDragState={setDraggingId}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
    </OpenReviewContext.Provider>
  );
}

function FeatureCard({
  feature,
  column,
  onDragState,
}: {
  feature: Feature;
  column: Column;
  onDragState: (featureId: string | null) => void;
}) {
  const { state, dispatch } = useStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [steps, setSteps] = useState<FeatureArtifactStep[]>([]);
  const [resultPhase, setResultPhase] = useState<FeaturePhase | null>(null);
  const run = useAction();
  const project = state.app?.projects.find((p) => p.id === feature.projectId);
  const session = state.app?.sessions.find((s) => s.featureId === feature.id && !s.exited);
  const live = !!session && (session.status === 'working' || session.status === 'awaiting_input');

  // Ergebnis-Artefakte laden; neu laden, wenn sich ein Phasen-Status ändert (z. B. spec.md entsteht).
  const phaseSig = FEATURE_PHASES.map((p) => feature.phases[p]?.status ?? '-').join(',');
  useEffect(() => {
    let cancelled = false;
    api
      .featureArtifacts(feature.id)
      .then((s) => !cancelled && setSteps(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature.id, phaseSig]);

  const phase = column !== 'integration' && column !== 'done' ? column : null;
  const phaseState = phase ? feature.phases[phase] : undefined;

  // Sämtliche Aktions-Sichtbarkeit und -Sperrung kommt aus der gemeinsamen
  // Festlegung — die Karte trifft keine eigene Entscheidung mehr (FR-022/SC-004).
  const ctx = featureActionContext(state, feature.id);
  const verdict = (action: Parameters<typeof evaluateAction>[0]) =>
    ctx ? evaluateAction(action, ctx, phase ? { phase } : undefined) : null;
  const startV = phase ? verdict('phase_start') : null;
  const approveV = phase ? verdict('phase_approve') : null;
  const discardV = phase ? verdict('phase_discard') : null;
  const integrateV = verdict('integrate');
  const retryV = verdict('integration_retry');
  const archiveV = verdict('archive');
  const reason = blockedReason(startV, approveV, discardV, integrateV, retryV, archiveV);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/feature-id', feature.id);
        onDragState(feature.id);
      }}
      onDragEnd={() => onDragState(null)}
      className="cursor-grab rounded-md border border-zinc-800 bg-zinc-900 p-2.5 shadow-sm hover:border-zinc-700 active:cursor-grabbing"
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: project?.color ?? '#71717a' }} />
        <button
          className="truncate text-sm font-medium text-zinc-200 hover:underline"
          onClick={() => dispatch({ type: 'set_view', view: { kind: 'console', featureId: feature.id } })}
        >
          {feature.name}
        </button>
        {state.gateRunning[feature.id] && (
          <span className="ml-auto animate-pulse text-violet-300" title="Qualitäts-Gate (Agent) läuft">
            <ScalesIcon />
          </span>
        )}
        {session && <span className={`status-dot status-${session.status} ${state.gateRunning[feature.id] ? '' : 'ml-auto'}`} />}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`${session || state.gateRunning[feature.id] ? '' : 'ml-auto '}rounded px-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300`}
          title="Einstellungen für dieses Feature"
          aria-expanded={showSettings}
        >
          <SettingsIcon />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
        <span>{project?.name}</span>
        {feature.jiraRef && (
          <a
            href={feature.jiraRef.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded bg-sky-950 px-1.5 py-0.5 font-mono text-[10px] text-sky-400 hover:bg-sky-900 hover:text-sky-300"
            title={`Jira-Ticket ${feature.jiraRef.key} öffnen`}
          >
            {feature.jiraRef.key}
          </a>
        )}
      </div>

      {steps.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1">
          {steps.map((s) => {
            const Icon = RESULT_ICONS[s.phase];
            if (!Icon) return null;
            return (
              <button
                key={s.phase}
                disabled={!s.available}
                title={s.available ? s.tooltip : `${s.label}: noch kein Ergebnis`}
                onClick={() => setResultPhase(s.phase)}
                className={`flex h-5 w-5 items-center justify-center rounded text-[13px] ${
                  s.available
                    ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                    : 'cursor-default text-zinc-700'
                }`}
              >
                <Icon />
              </button>
            );
          })}
        </div>
      )}
      {resultPhase && (
        <FeatureResultDialog
          featureId={feature.id}
          featureName={feature.name}
          phase={resultPhase}
          phaseLabel={PHASE_LABELS[resultPhase]}
          onClose={() => setResultPhase(null)}
        />
      )}

      {/*
        Feature-Einstellungen: Automation, Agenten und Aufräumen unter EINEM Einstieg.
        Vorher war die Automation der einzige Inhalt des Zahnrads, die Agenten hingen
        an einem eigenen Icon in der Konsolen-Kopfleiste (nur bei geöffneter Konsole
        erreichbar) und Aufräumen war ein Dauerbutton auf der Karte.
      */}
      {showSettings && (
        <div className="mt-2 space-y-2 rounded border border-zinc-800 bg-zinc-900/60 p-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Automation</div>
          <div className="flex gap-1">
            <PresetChip
              active={Object.keys(feature.automation).length === 0}
              onClick={() => run(`automation:${feature.id}`, () => api.updateFeature(feature.id, { automation: {} }))}
            >
              erben
            </PresetChip>
            <PresetChip
              active={JSON.stringify(feature.automation) === JSON.stringify(LEVEL2_DEFAULTS)}
              onClick={() =>
                run(`automation:${feature.id}`, () => api.updateFeature(feature.id, { automation: LEVEL2_DEFAULTS }))
              }
            >
              L2
            </PresetChip>
            <PresetChip
              active={JSON.stringify(feature.automation) === JSON.stringify(LEVEL3_DEFAULTS)}
              onClick={() =>
                run(`automation:${feature.id}`, () => api.updateFeature(feature.id, { automation: LEVEL3_DEFAULTS }))
              }
            >
              L3
            </PresetChip>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-t border-zinc-800 pt-2">
            <button
              onClick={() => setShowAgents(true)}
              className={`${CARD_ACTION_CLASS} flex items-center gap-1`}
              title="Agents für dieses Feature aktivieren oder deaktivieren"
            >
              <ShieldIcon /> Agents
            </button>
            {/*
              Aufräumen ist destruktiv und trifft uncommittete Arbeit — die Policy
              sperrt es, solange gearbeitet wird, und nennt den Grund. Bis 27.07.2026
              war es in jedem Zustand auslösbar, abgesichert nur durch einen Warnsatz.
            */}
            {archiveV && (
              <ActionButton
                verdict={archiveV}
                onClick={() => setConfirmArchive(true)}
                className={`${CARD_ACTION_CLASS} flex items-center gap-1`}
              >
                <ArchiveIcon /> Aufräumen
              </ActionButton>
            )}
          </div>
        </div>
      )}
      {showAgents && <FeatureAgentSelect featureId={feature.id} onClose={() => setShowAgents(false)} />}

      {live ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="status-dot status-working" /> läuft …
        </div>
      ) : phaseState?.status === 'running' ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-400">
          <span className="status-dot status-idle" /> wird gestartet …
        </div>
      ) : null}
      {phaseState?.stale && <div className="mt-1 text-xs text-amber-500">⚠ stale — Upstream geändert</div>}
      {/* Die Zurückweisung bleibt sichtbar, bis der letzte Schritt neu freigegeben ist (FR-026). */}
      {feature.reviewRejectedAt !== null && (
        <div className="mt-1 text-xs text-amber-300">↩ im Review zurückgewiesen</div>
      )}
      {feature.tasksTotal > 0 && (
        <div className="mt-2">
          <div className="h-1 overflow-hidden rounded bg-zinc-800">
            <div
              className="h-full bg-emerald-600"
              style={{ width: `${Math.round((feature.tasksDone / feature.tasksTotal) * 100)}%` }}
            />
          </div>
          <div className="mt-0.5 text-right text-xs text-zinc-600">
            {feature.tasksDone}/{feature.tasksTotal} Tasks
          </div>
        </div>
      )}

      <ActionGroup reason={reason} className="mt-2">
        {phase && startV && (
          <ActionButton
            verdict={startV}
            onClick={() => run(`start:${feature.id}:${phase}`, () => api.startPhase(feature.id, phase))}
            className={CARD_ACTION_CLASS}
          >
            ▶ Start
          </ActionButton>
        )}
        {phase && approveV && (
          <ActionButton
            verdict={approveV}
            onClick={() => run(`approve:${feature.id}:${phase}`, () => api.approvePhase(feature.id, phase))}
            className={CARD_ACTION_CLASS}
          >
            ✓ Approve
          </ActionButton>
        )}
        {phase && discardV && (
          <ActionButton
            verdict={discardV}
            onClick={() => run(`discard:${feature.id}:${phase}`, () => api.discardPhase(feature.id, phase))}
            className={CARD_ACTION_CLASS}
          >
            ↺ Verwerfen
          </ActionButton>
        )}
        {integrateV && (
          <ActionButton
            verdict={integrateV}
            onClick={() => run(`integrate:${feature.id}`, () => api.integrate(feature.id))}
            className={`${CARD_ACTION_CLASS} inline-flex items-center gap-1`}
          >
            <ArrowRightIcon /> Integrieren
          </ActionButton>
        )}
        {/* Betrachtend (FR-007): das Portal öffnet nur eine Ansicht und wird nie gesperrt. */}
        {feature.integration === 'awaiting_human_review' && <OpenReviewButton featureId={feature.id} />}
        {retryV && (
          <ActionButton
            verdict={retryV}
            onClick={() => run(`retry:${feature.id}`, () => api.retryIntegration(feature.id))}
            className={`${CARD_ACTION_CLASS} inline-flex items-center gap-1`}
          >
            <RestartIcon /> Erneut
          </ActionButton>
        )}
        {feature.integration !== 'none' && feature.integration !== 'merged' && (
          <span
            className={`rounded bg-zinc-800 px-1.5 py-0.5 text-xs ${
              INTEGRATION_TONE_CLASS[INTEGRATION_STAGE_META[feature.integration].tone]
            }`}
          >
            {INTEGRATION_STAGE_META[feature.integration].label}
          </span>
        )}
        {feature.integration === 'merged' && project?.integrationMode === 'pr' && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-emerald-400">PR erstellt</span>
        )}
        {feature.integration === 'merged' &&
          feature.integrationTarget &&
          feature.integrationTarget !== project?.defaultBranch && (
            <span
              className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-emerald-400"
              title={`In '${feature.integrationTarget}' integriert (nicht in ${project?.defaultBranch})`}
            >
              → {feature.integrationTarget}
            </span>
          )}
        {/* Aufräumen sitzt im Zahnrad-Menü, nicht mehr als Dauerbutton auf der Karte. */}
        {confirmArchive && (
          <ConfirmDialog
            title="Feature archivieren"
            message={
              `„${feature.name}" archivieren?\n\nArchivieren räumt auf — es schließt das Feature nicht ab. ` +
              `Die Session wird beendet; Specs und Git-Historie bleiben im Repo erhalten.`
            }
            confirmLabel="Archivieren"
            onConfirm={() => run(`archive:${feature.id}`, () => api.archiveFeature(feature.id))}
            onClose={() => setConfirmArchive(false)}
          />
        )}
      </ActionGroup>
    </div>
  );
}

const CARD_ACTION_CLASS =
  'rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100';

function OpenReviewButton({ featureId }: { featureId: string }) {
  const openReview = useContext(OpenReviewContext);
  return (
    <button onClick={() => openReview(featureId)} className={`${CARD_ACTION_CLASS} inline-flex items-center gap-1`}>
      <ReviewIcon /> Review
    </button>
  );
}
