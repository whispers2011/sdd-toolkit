import { useEffect, useMemo, useState } from 'react';
import { api, type ExecutionInfo } from '../api.js';
import { useStore } from '../store.js';

const KIND_LABELS: Record<ExecutionInfo['kind'], string> = {
  phase: 'Phase',
  verify: 'Verifikation',
  review: 'Review-Agent',
  conflict_resolution: 'Konfliktauflösung',
};

/** Executions-View (WP6): Audit-Trail aller Agent-/Verify-Läufe. */
export function ExecutionsView() {
  const { state } = useStore();
  const [executions, setExecutions] = useState<ExecutionInfo[]>([]);
  const [kindFilter, setKindFilter] = useState<'all' | ExecutionInfo['kind']>('all');
  const [logFor, setLogFor] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  const reload = () => void api.executions().then(setExecutions).catch(() => {});
  useEffect(() => {
    reload();
    const t = setInterval(reload, 5000); // Läufe mit status running live halten
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!logFor) return;
    setLog(null);
    api
      .executionLog(logFor)
      .then((r) => setLog(r.log))
      .catch((e: Error) => setLog(`(kein Log: ${e.message})`));
  }, [logFor]);

  const rows = useMemo(() => {
    const projectFilter = state.selectedProjectId;
    return executions.filter(
      (e) =>
        (projectFilter === null || e.projectId === projectFilter) &&
        (kindFilter === 'all' || e.kind === kindFilter),
    );
  }, [executions, state.selectedProjectId, kindFilter]);

  const featureName = (id: string | null) =>
    id ? (state.app?.features.find((f) => f.id === id)?.name ?? '—') : '—';
  const projectName = (id: string) => state.app?.projects.find((p) => p.id === id)?.name ?? '—';
  const totalCost = rows.reduce((s, e) => s + (e.costUsd ?? 0), 0);

  return (
    <div className="flex h-full">
      <div className={`${logFor ? 'w-1/2' : 'w-full'} overflow-auto p-4`}>
        <div className="mb-3 flex items-center gap-2">
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
          >
            <option value="all">Alle Arten</option>
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <span className="ml-auto text-xs text-zinc-500">
            {rows.length} Läufe · Kosten gesamt ${totalCost.toFixed(2)}
          </span>
        </div>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="px-2 py-1.5">Start</th>
              <th className="px-2 py-1.5">Projekt / Feature</th>
              <th className="px-2 py-1.5">Art</th>
              <th className="px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5 text-right">Dauer</th>
              <th className="px-2 py-1.5 text-right">Kosten</th>
              <th className="px-2 py-1.5 text-right">Tokens</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-zinc-900 hover:bg-zinc-925">
                <td className="whitespace-nowrap px-2 py-1.5 text-zinc-500">
                  {new Date(e.startedAt).toLocaleString('de-CH')}
                </td>
                <td className="px-2 py-1.5 text-zinc-300">
                  {projectName(e.projectId)} / {featureName(e.featureId)}
                </td>
                <td className="px-2 py-1.5 text-zinc-400">
                  {KIND_LABELS[e.kind]}
                  {e.phase ? ` (${e.phase})` : ''}
                </td>
                <td className="px-2 py-1.5">
                  <StatusBadge status={e.status} />
                </td>
                <td className="px-2 py-1.5 text-right text-zinc-500">
                  {e.finishedAt ? formatDuration(e.finishedAt - e.startedAt) : '…'}
                </td>
                <td className="px-2 py-1.5 text-right text-zinc-400">
                  {e.costUsd !== null ? `$${e.costUsd.toFixed(3)}` : '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-zinc-500">
                  {e.tokens !== null ? e.tokens.toLocaleString('de-CH') : '—'}
                </td>
                <td className="px-2 py-1.5">
                  <button
                    onClick={() => setLogFor(logFor === e.id ? null : e.id)}
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-700"
                  >
                    Log
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-8 text-center text-zinc-600">
                  Noch keine Läufe.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {logFor && (
        <div className="flex w-1/2 flex-col border-l border-zinc-800">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold text-zinc-400">Log {logFor}</span>
            <button onClick={() => setLogFor(null)} className="rounded px-2 text-zinc-500 hover:bg-zinc-800">✕</button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto bg-[#0a0a0c] p-3 font-mono text-xs whitespace-pre-wrap text-zinc-400">
            {log ?? 'Lade …'}
          </pre>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ExecutionInfo['status'] }) {
  const cls =
    status === 'succeeded'
      ? 'bg-emerald-950 text-emerald-400'
      : status === 'failed'
        ? 'bg-red-950 text-red-400'
        : status === 'running'
          ? 'bg-sky-950 text-sky-400 animate-pulse'
          : 'bg-zinc-800 text-zinc-500';
  return <span className={`rounded px-1.5 py-0.5 ${cls}`}>{status}</span>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} m ${s % 60} s`;
}
