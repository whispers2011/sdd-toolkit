import { useState } from 'react';
import { FEATURE_PHASES, type FeaturePhase } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { ReviewPortal } from './ReviewPortal.js';
import { TerminalPane } from './TerminalPane.js';

/** Konsole pro Feature: Header + Phasen-Leiste + Terminal. */
export function FeatureConsole({ featureId }: { featureId: string }) {
  const { state } = useStore();
  const [connected, setConnected] = useState(false);
  const [showReview, setShowReview] = useState(false);

  const feature = state.app?.features.find((f) => f.id === featureId);
  const project = state.app?.projects.find((p) => p.id === feature?.projectId);
  const session = state.app?.sessions.find((s) => s.featureId === featureId && !s.exited);

  if (!feature) return <div className="p-8 text-zinc-500">Feature nicht gefunden.</div>;

  const runningPhase = FEATURE_PHASES.find((p) => feature.phases[p]?.status === 'running');

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <span className={`status-dot status-${session?.status ?? 'stopped'}`} />
        <span className="text-sm font-medium text-zinc-200">
          {project?.name} / {feature.name}
        </span>
        <span className="text-xs text-zinc-500">{feature.branch}</span>
        {feature.worktreePath && (
          <span className="truncate text-xs text-zinc-600" title={feature.worktreePath}>
            {feature.worktreePath}
          </span>
        )}
        <button
          onClick={() => setShowReview(true)}
          className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Diff / Review
        </button>
        <span className="text-xs text-zinc-500">{connected ? 'verbunden' : 'getrennt …'}</span>
      </div>
      {showReview && <ReviewPortal featureId={featureId} onClose={() => setShowReview(false)} />}

      <PhaseStrip featureId={featureId} runningPhase={runningPhase ?? null} />

      <div className="min-h-0 flex-1 bg-[#09090b] p-2">
        <TerminalPane featureId={featureId} focused onConnectionChange={setConnected} />
      </div>
    </div>
  );
}

/** Phasen-Leiste über der Konsole: Status + Aktion pro Phase. */
function PhaseStrip({ featureId, runningPhase }: { featureId: string; runningPhase: FeaturePhase | null }) {
  const { state, dispatch } = useStore();
  const feature = state.app?.features.find((f) => f.id === featureId);
  if (!feature) return null;

  const call = (fn: () => Promise<unknown>) =>
    fn().catch((e: Error) => dispatch({ type: 'error', message: e.message }));

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800 px-4 py-1.5">
      {FEATURE_PHASES.filter((p) => feature.phases[p]).map((phase) => {
        const ps = feature.phases[phase];
        const cls =
          ps.status === 'approved'
            ? 'text-emerald-500 border-emerald-900'
            : ps.status === 'running'
              ? 'text-emerald-300 border-emerald-700 animate-pulse'
              : ps.status === 'awaiting_review'
                ? 'text-amber-400 border-amber-800'
                : 'text-zinc-500 border-zinc-800';
        return (
          <button
            key={phase}
            disabled={runningPhase !== null}
            title={
              ps.status === 'idle'
                ? `/speckit.${phase} starten`
                : ps.status === 'awaiting_review'
                  ? 'Klick = approven'
                  : ps.status
            }
            onClick={() => {
              if (ps.status === 'idle') void call(() => api.startPhase(featureId, phase));
              else if (ps.status === 'awaiting_review') void call(() => api.approvePhase(featureId, phase));
            }}
            className={`rounded border px-2 py-0.5 text-xs whitespace-nowrap disabled:opacity-60 ${cls} ${ps.stale ? 'line-through' : ''}`}
          >
            {ps.status === 'approved' ? '✓ ' : ''}
            {phase}
          </button>
        );
      })}
      <span className="mx-2 text-zinc-700">|</span>
      {feature.integration === 'none' ? (
        <button
          onClick={() => void call(() => api.integrate(featureId))}
          className="rounded border border-sky-900 px-2 py-0.5 text-xs whitespace-nowrap text-sky-400 hover:border-sky-700"
        >
          ⇥ Integrieren
        </button>
      ) : (
        <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-sky-400">{feature.integration}</span>
      )}
    </div>
  );
}
