import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { FEATURE_PHASES, type FeaturePhase } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';

/** Konsole pro Feature: xterm.js ⇄ WebSocket ⇄ Server-PTY (mit Reconnect). */
export function FeatureConsole({ featureId }: { featureId: string }) {
  const { state, dispatch } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);

  const feature = state.app?.features.find((f) => f.id === featureId);
  const project = state.app?.projects.find((p) => p.id === feature?.projectId);
  const session = state.app?.sessions.find((s) => s.featureId === featureId && !s.exited);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#09090b', foreground: '#d4d4d8', cursor: '#a1a1aa' },
      scrollback: 20_000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    let ws: WebSocket | null = null;
    let disposed = false;

    const connect = async () => {
      try {
        const { sessionId } = await api.ensureSession(featureId);
        if (disposed) return;
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${location.host}/ws/terminal/${sessionId}`);
        ws.onopen = () => {
          setConnected(true);
          ws?.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        };
        ws.onmessage = (ev) => term.write(ev.data as string);
        ws.onclose = () => {
          setConnected(false);
          if (!disposed) setTimeout(() => void connect(), 1500);
        };
      } catch (e) {
        dispatch({ type: 'error', message: (e as Error).message });
      }
    };
    void connect();

    const dataDisposable = term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });

    const observer = new ResizeObserver(() => {
      fit.fit();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    observer.observe(containerRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      dataDisposable.dispose();
      ws?.close();
      term.dispose();
    };
  }, [featureId, dispatch]);

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
        <span className="ml-auto text-xs text-zinc-500">{connected ? 'verbunden' : 'getrennt …'}</span>
      </div>

      <PhaseStrip featureId={featureId} runningPhase={runningPhase ?? null} />

      <div className="min-h-0 flex-1 bg-[#09090b] p-2">
        <div ref={containerRef} className="h-full w-full" />
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
