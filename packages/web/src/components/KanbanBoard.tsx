import { createContext, useContext, useEffect, useState, type DragEvent } from 'react';
import type { Feature, FeatureArtifactStep, FeaturePhase } from '@sdd/shared';
import { FEATURE_PHASES } from '@sdd/shared';
import { api } from '../api.js';
import { isShowCompleted, useStore } from '../store.js';
import { ReviewPortal } from './ReviewPortal.js';
import { PhaseDefinitionDialog } from './PhaseDefinitionDialog.js';
import { FeatureResultDialog } from './FeatureResultDialog.js';
import { ConfirmDialog } from './Sidebar.js';
import { PresetChip } from './ProjectSettings.js';
import { LEVEL2_DEFAULTS, LEVEL3_DEFAULTS } from '@sdd/shared';
import {
  SpecifyResultIcon,
  PlanResultIcon,
  TasksResultIcon,
  ChecklistResultIcon,
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
  const [reviewFeatureId, setReviewFeatureId] = useState<string | null>(null);
  const [defPhase, setDefPhase] = useState<FeaturePhase | null>(null);
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

  const call = (fn: () => Promise<unknown>) =>
    fn().catch((e: Error) => {
      // Doppel-Start („läuft bereits") ist harmlos — nicht als Fehler anzeigen.
      if (/läuft bereits/i.test(e.message)) return;
      dispatch({ type: 'error', message: e.message });
    });

  const onDrop = (column: Column) => (e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const featureId = e.dataTransfer.getData('text/feature-id');
    if (!featureId) return;
    if (column === 'done') return;
    if (column === 'integration') {
      void call(() => api.integrate(featureId));
    } else {
      void call(() => api.advance(featureId, column));
    }
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
        return (
          <div
            key={column}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(column);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={onDrop(column)}
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
                <FeatureCard key={feature.id} feature={feature} column={column} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
    </OpenReviewContext.Provider>
  );
}

function FeatureCard({ feature, column }: { feature: Feature; column: Column }) {
  const { state, dispatch } = useStore();
  const [showAutomation, setShowAutomation] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [steps, setSteps] = useState<FeatureArtifactStep[]>([]);
  const [resultPhase, setResultPhase] = useState<FeaturePhase | null>(null);
  const project = state.app?.projects.find((p) => p.id === feature.projectId);
  const session = state.app?.sessions.find((s) => s.featureId === feature.id && !s.exited);
  // „Lebt gerade" = Session arbeitet oder wartet auf Eingabe. Dann ist der Start
  // eines Phasenlaufs unsinnig (die Session ist beschäftigt) — der Grund, warum eine
  // laufende Session sonst trotzdem „▶ Start" anbot.
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

  const call = (fn: () => Promise<unknown>) =>
    fn().catch((e: Error) => {
      // Doppel-Start („läuft bereits") ist harmlos — nicht als Fehler anzeigen.
      if (/läuft bereits/i.test(e.message)) return;
      dispatch({ type: 'error', message: e.message });
    });

  const phaseState = column !== 'integration' && column !== 'done' ? feature.phases[column] : undefined;

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/feature-id', feature.id)}
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
          <span className="ml-auto animate-pulse text-xs text-violet-300" title="Qualitäts-Gate (Agent) läuft">
            ⚖
          </span>
        )}
        {session && <span className={`status-dot status-${session.status} ${state.gateRunning[feature.id] ? '' : 'ml-auto'}`} />}
        <button
          onClick={() => setShowAutomation(!showAutomation)}
          className={`${session || state.gateRunning[feature.id] ? '' : 'ml-auto '}rounded px-1 text-xs text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300`}
          title="Automation-Override für dieses Feature"
        >
          ⚙
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

      {showAutomation && (
        <div className="mt-2 space-y-1">
          <div className="flex gap-1">
            <PresetChip
              active={Object.keys(feature.automation).length === 0}
              onClick={() => void call(() => api.updateFeature(feature.id, { automation: {} }))}
            >
              erben
            </PresetChip>
            <PresetChip
              active={JSON.stringify(feature.automation) === JSON.stringify(LEVEL2_DEFAULTS)}
              onClick={() => void call(() => api.updateFeature(feature.id, { automation: LEVEL2_DEFAULTS }))}
            >
              L2
            </PresetChip>
            <PresetChip
              active={JSON.stringify(feature.automation) === JSON.stringify(LEVEL3_DEFAULTS)}
              onClick={() => void call(() => api.updateFeature(feature.id, { automation: LEVEL3_DEFAULTS }))}
            >
              L3
            </PresetChip>
          </div>
          {feature.integration !== 'merged' && (
            <button
              onClick={() => void call(() => api.markDone(feature.id))}
              className="w-full rounded bg-zinc-800 px-1.5 py-0.5 text-left text-xs text-emerald-400 hover:bg-zinc-700"
              title="Ohne Merge als erledigt markieren — für Features, die außerhalb des Tools gebaut wurden"
            >
              ✓ Als abgeschlossen markieren
            </button>
          )}
        </div>
      )}

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

      <div className="mt-2 flex flex-wrap gap-1">
        {phaseState?.status === 'idle' && !live && column !== 'integration' && column !== 'done' && (
          <CardAction onClick={() => void call(() => api.startPhase(feature.id, column))}>▶ Start</CardAction>
        )}
        {phaseState?.status === 'awaiting_review' && column !== 'integration' && column !== 'done' && (
          <>
            <CardAction onClick={() => void call(() => api.approvePhase(feature.id, column))}>✓ Approve</CardAction>
            <CardAction onClick={() => void call(() => api.discardPhase(feature.id, column))}>↺ Verwerfen</CardAction>
          </>
        )}
        {column === 'integration' && feature.integration === 'none' && (
          <CardAction onClick={() => void call(() => api.integrate(feature.id))}>⇥ Integrieren</CardAction>
        )}
        {feature.integration === 'awaiting_human_review' && (
          <OpenReviewButton featureId={feature.id} />
        )}
        {(feature.integration === 'verify_failed' || feature.integration === 'conflict_escalated') && (
          <CardAction onClick={() => void call(() => api.retryIntegration(feature.id))}>↻ Erneut</CardAction>
        )}
        {feature.integration !== 'none' && feature.integration !== 'merged' && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-sky-400">{feature.integration}</span>
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
        {column === 'done' && (
          <CardAction onClick={() => setConfirmArchive(true)}>🗄 Archivieren</CardAction>
        )}
        {confirmArchive && (
          <ConfirmDialog
            title="Feature archivieren"
            message={`„${feature.name}" archivieren?\n\nDie Session wird beendet; Specs und Git-Historie bleiben im Repo erhalten.`}
            confirmLabel="Archivieren"
            onConfirm={() => void call(() => api.archiveFeature(feature.id))}
            onClose={() => setConfirmArchive(false)}
          />
        )}
      </div>
    </div>
  );
}

function OpenReviewButton({ featureId }: { featureId: string }) {
  const openReview = useContext(OpenReviewContext);
  return <CardAction onClick={() => openReview(featureId)}>👀 Review</CardAction>;
}

function CardAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
    >
      {children}
    </button>
  );
}
