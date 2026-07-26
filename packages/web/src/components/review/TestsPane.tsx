import { useEffect, useMemo, useState } from 'react';
import { api, type ExecutionInfo } from '../../api.js';
import { fmtTokens } from '../charts.js';

/**
 * Verify-Dashboard (aufbereitete Verify-Executions, keine Report-Parser):
 * Status/Dauer/Exit-Code pro Lauf, aggregierte Tokens, Log-Viewer.
 */
export function TestsPane({ featureId, onError }: { featureId: string; onError: (e: Error) => void }) {
  const [executions, setExecutions] = useState<ExecutionInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  useEffect(() => {
    api
      .executions(featureId)
      .then((all) => setExecutions(all.filter((e) => e.kind === 'verify')))
      .catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);

  useEffect(() => {
    if (!selected) return;
    setLog(null);
    api
      .executionLog(selected)
      .then((r) => setLog(r.log))
      .catch(() => setLog('Kein Log vorhanden.'));
  }, [selected]);

  const totals = useMemo(() => {
    const list = executions ?? [];
    return {
      tokens: list.reduce((s, e) => s + (e.tokens ?? 0), 0),
      passed: list.filter((e) => e.status === 'succeeded').length,
    };
  }, [executions]);

  if (!executions) return <p className="p-4 text-sm text-zinc-600">Lade Verify-Läufe …</p>;
  if (executions.length === 0) {
    return (
      <p className="p-4 text-sm text-zinc-600">
        Keine Verifikations-Läufe — verifyCommands im Projekt konfigurieren, um Tests/Build vor dem Merge zu prüfen.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex gap-3">
        <StatCard label="Läufe" value={`${totals.passed}/${executions.length} grün`} />
        <StatCard label="Letzter Lauf" value={executions[0]!.status === 'succeeded' ? '✓ bestanden' : '✗ fehlgeschlagen'} tone={executions[0]!.status === 'succeeded' ? 'ok' : 'bad'} />
        <StatCard label="Tokens" value={fmtTokens(totals.tokens)} />
      </div>
      <ul className="space-y-1">
        {executions.map((e) => (
          <li key={e.id}>
            <button
              onClick={() => setSelected(selected === e.id ? null : e.id)}
              className={`flex w-full items-center gap-3 rounded border px-3 py-1.5 text-left text-xs ${
                selected === e.id ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 hover:bg-zinc-900/60'
              }`}
            >
              <span className={e.status === 'succeeded' ? 'text-emerald-400' : e.status === 'running' ? 'text-sky-400' : 'text-red-400'}>
                {e.status === 'succeeded' ? '●' : e.status === 'running' ? '◐' : '●'}
              </span>
              <span className="text-zinc-300">{new Date(e.startedAt).toLocaleString('de-CH')}</span>
              <span className="text-zinc-500">
                {e.finishedAt ? `${Math.round((e.finishedAt - e.startedAt) / 1000)}s` : 'läuft …'}
              </span>
              {e.exitCode !== null && <span className="text-zinc-600">exit {e.exitCode}</span>}
              <span className="ml-auto text-zinc-500">
                {e.tokens ? `${fmtTokens(e.tokens)} tok` : ''}
              </span>
            </button>
            {selected === e.id && (
              <pre className="mt-1 max-h-72 overflow-auto rounded border border-zinc-800 bg-[#0a0a0c] p-2 text-[11px] leading-4 whitespace-pre-wrap text-zinc-400">
                {log ?? 'Lade Log …'}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="text-[10px] tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className={`text-sm font-semibold ${tone === 'ok' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-zinc-200'}`}>
        {value}
      </div>
    </div>
  );
}
