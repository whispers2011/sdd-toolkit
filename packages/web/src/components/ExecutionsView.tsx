import { useEffect, useMemo, useState } from 'react';
import { api, type ExecutionInfo, type RunSummary } from '../api.js';
import { useStore } from '../store.js';
import { Donut, HBarChart, StackedBar, fmtTokens, fmtCost, type Segment } from './charts.js';

const KIND_LABELS: Record<ExecutionInfo['kind'], string> = {
  phase: 'Phase',
  verify: 'Verifikation',
  review: 'Review-Agent',
  conflict_resolution: 'Konfliktauflösung',
  chat: 'Chat',
  chat_work: 'Arbeits-Chat',
  lifecycle_step: 'Schritt',
};

const STEP_LABELS: Record<string, string> = {
  constitution: 'Constitution',
  specify: 'Specify',
  clarify: 'Clarify',
  plan: 'Plan',
  checklist: 'Checklist',
  analyze: 'Analyze',
  tasks: 'Tasks',
  implement: 'Implement',
  verify: 'Verifikation',
  review: 'Review',
  conflict_resolution: 'Konflikte',
  chat: 'Chat',
  chat_work: 'Arbeits-Chat',
  lifecycle_step: 'Schritte',
};

const CATEGORY_COLORS: Record<string, string> = {
  spec: '#38bdf8', // Spezifikation
  coding: '#34d399',
  overhead: '#fbbf24',
  chat: '#c084fc',
};

const CATEGORY_LABELS: Record<string, string> = {
  spec: 'Spezifikation',
  coding: 'Coding',
  overhead: 'Overhead',
  chat: 'Chat',
};

const SOURCE_LABELS: Record<NonNullable<ExecutionInfo['tokensSource']>, string> = {
  telemetry: 'von der CLI gemeldet',
  transcript: 'gemessen',
  parsed: 'geparst',
  estimated: 'geschätzt',
};

function SourceBadge({ source }: { source: ExecutionInfo['tokensSource'] }) {
  if (!source) return null;
  // „von der CLI gemeldet" bekommt eine eigene, kräftigere Farbe als „gemessen":
  // Die beiden dürfen nicht gleich aussehen, sonst ist am Lauf nicht ablesbar, ob
  // seine Zahl gemeldet oder vom Toolkit erschlossen wurde (FR-017, SC-009).
  const cls =
    source === 'telemetry'
      ? 'bg-teal-900 font-medium text-teal-200 ring-1 ring-teal-700'
      : source === 'transcript'
        ? 'bg-emerald-950 text-emerald-400'
        : source === 'parsed'
          ? 'bg-sky-950 text-sky-400'
          : 'bg-zinc-800 text-zinc-500';
  return <span className={`ml-1 rounded px-1 py-0.5 text-[10px] ${cls}`}>{SOURCE_LABELS[source]}</span>;
}

function IntegrationBadge({ run }: { run: RunSummary }) {
  if (run.running)
    return <span className="animate-pulse rounded bg-sky-950 px-1.5 py-0.5 text-sky-400">läuft</span>;
  if (run.archived) return <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-500">archiviert</span>;
  const s = run.integration;
  const cls =
    s === 'merged'
      ? 'bg-emerald-950 text-emerald-400'
      : s === 'conflict_escalated' || s === 'verify_failed' || s === 'gate_failed'
        ? 'bg-red-950 text-red-400'
        : s === 'none'
          ? 'bg-zinc-800 text-zinc-500'
          : 'bg-amber-950 text-amber-400';
  return <span className={`rounded px-1.5 py-0.5 ${cls}`}>{s === 'none' ? 'offen' : s}</span>;
}

/** Läufe-View: ein Lauf = ein Worktree/Feature; pro Lauf Token-Dashboard pro Step. */
export function ExecutionsView() {
  const { state } = useStore();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null); // featureId
  const [detail, setDetail] = useState<ExecutionInfo[]>([]);
  const [logFor, setLogFor] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  const reload = () => void api.runs().then((r) => setRuns(r.runs)).catch(() => {});
  useEffect(() => {
    reload();
    const t = setInterval(reload, 5000); // laufende Läufe live halten
    return () => clearInterval(t);
    // executionsVersion: ein Telemetrie-Nachtrag hat einen Lauf korrigiert — sofort
    // neu laden statt bis zum nächsten Intervall zu warten (FR-011, US1 Szenario 4).
  }, [state.executionsVersion]);

  // Detail-Executions des aufgeklappten Laufs (+ Refresh solange er läuft).
  const expandedRun = runs.find((r) => r.featureId === expanded);
  useEffect(() => {
    if (!expanded) {
      setDetail([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      void api
        .executions(expanded)
        .then((e) => !cancelled && setDetail(e))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [expanded]);

  // Log-Panel (unverändertes Verhalten: initial + Live-Nachladen bei running).
  const openStatus = logFor ? detail.find((e) => e.id === logFor)?.status : undefined;
  useEffect(() => {
    if (!logFor) return;
    setLog(null);
    let cancelled = false;
    api
      .executionLog(logFor)
      .then((r) => !cancelled && setLog(r.log))
      .catch((e: Error) => !cancelled && setLog(`(kein Log: ${e.message})`));
    return () => {
      cancelled = true;
    };
  }, [logFor]);
  useEffect(() => {
    if (!logFor) return;
    let cancelled = false;
    const fetchLog = () =>
      void api
        .executionLog(logFor)
        .then((r) => !cancelled && setLog(r.log))
        .catch(() => {});
    if (openStatus === 'running') {
      const t = setInterval(fetchLog, 3000);
      return () => {
        cancelled = true;
        clearInterval(t);
      };
    }
    fetchLog();
    return () => {
      cancelled = true;
    };
  }, [logFor, openStatus]);

  const visible = useMemo(
    () => runs.filter((r) => r.projectId === state.selectedProjectId),
    [runs, state.selectedProjectId],
  );

  // Bewusst KEINE Gesamtsumme über alle Token-Arten: sie besteht zu 94–98 % aus
  // Cache-Reads (erneut gelesener Kontext) und lässt jeden Lauf gewaltig aussehen,
  // obwohl kaum etwas neu verarbeitet wurde. Getrennt ausgewiesen ist beides lesbar.
  const totalOutput = visible.reduce((s, r) => s + r.total.outputTokens, 0);
  const totalCacheRead = visible.reduce((s, r) => s + r.total.cacheReadTokens, 0);
  // Gemessen = telemetry + transcript. Nur `transcript` zu zählen liesse die Anzeige
  // beim Umstieg auf die CLI-Meldungen scheinbar auf 0 fallen, obwohl die Messung
  // besser geworden ist (FR-018).
  const measured = visible.length
    ? visible.reduce((s, r) => s + r.sourceMix.telemetry + r.sourceMix.transcript, 0) / visible.length
    : 0;
  const reported = visible.length
    ? visible.reduce((s, r) => s + r.sourceMix.telemetry, 0) / visible.length
    : 0;
  const totalCost = visible.reduce((s, r) => s + r.total.costMicros, 0);
  const runsWithoutCost = visible.reduce((s, r) => s + r.total.runsWithoutCost, 0);

  return (
    <div className="flex h-full">
      <div className={`${logFor ? 'w-1/2' : 'w-full'} overflow-auto p-4`}>
        <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
          <span className="font-semibold text-zinc-400">Läufe (1 Lauf = 1 Worktree/Feature)</span>
          <span className="ml-auto">
            {visible.length} Läufe · <span className="text-emerald-400">{fmtTokens(totalOutput)} Output</span> ·{' '}
            {fmtTokens(totalCacheRead)} Cache-Read · {(measured * 100).toFixed(0)} % gemessen
            {reported > 0 && <span className="text-teal-300"> ({(reported * 100).toFixed(0)} % gemeldet)</span>}
            {totalCost > 0 && (
              <>
                {' · '}
                <span className="text-teal-300">{fmtCost(totalCost)} gemeldet</span>
                {runsWithoutCost > 0 && (
                  <span className="text-zinc-600"> ({runsWithoutCost} ohne Betrag)</span>
                )}
              </>
            )}
          </span>
        </div>
        <p className="mb-3 text-[10px] text-zinc-600">
          Output = neu erzeugte Tokens, das Mass für geleistete Arbeit. Cache-Read = erneut
          gelesener Kontext; er wächst mit jedem Turn und macht den Grossteil jeder Summe aus.
        </p>

        <div className="flex flex-col gap-2">
          {visible.map((run) => (
            <RunCard
              key={run.featureId}
              run={run}
              expanded={expanded === run.featureId}
              onToggle={() => {
                setLogFor(null);
                setExpanded(expanded === run.featureId ? null : run.featureId);
              }}
              detail={expanded === run.featureId ? detail : null}
              onOpenLog={(id) => setLogFor(logFor === id ? null : id)}
            />
          ))}
          {visible.length === 0 && (
            <div className="px-2 py-10 text-center text-xs text-zinc-600">Noch keine Läufe.</div>
          )}
        </div>
      </div>

      {logFor && (
        <div className="flex w-1/2 flex-col border-l border-zinc-800">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold text-zinc-400">Log {logFor}</span>
            <button onClick={() => setLogFor(null)} className="rounded px-2 text-zinc-500 hover:bg-zinc-800">
              ✕
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto bg-[#0a0a0c] p-3 font-mono text-xs whitespace-pre-wrap text-zinc-400">
            {log === null
              ? 'Lade …'
              : log === ''
                ? openStatus === 'running'
                  ? '(läuft – noch keine Ausgabe)'
                  : '(leer)'
                : log}
          </pre>
        </div>
      )}
    </div>
  );
}

export function RunCard({
  run,
  expanded,
  onToggle,
  detail,
  onOpenLog,
}: {
  run: RunSummary;
  expanded: boolean;
  onToggle: () => void;
  detail: ExecutionInfo[] | null;
  onOpenLog: (id: string) => void;
}) {
  const catSegments: Segment[] = (['spec', 'coding', 'overhead', 'chat'] as const)
    .map((c) => ({ label: CATEGORY_LABELS[c]!, value: run.byCategory[c].tokens, color: CATEGORY_COLORS[c]! }))
    .filter((s) => s.value > 0);

  // Vorrangig die höchste erreichte Stufe zeigen: 'von der CLI gemeldet' schlägt
  // 'gemessen' (FR-017). Ohne die telemetry-Zeile fiele ein voll gemeldeter Lauf
  // durch und würde als 'geschätzt' etikettiert.
  const dominantSource =
    run.sourceMix.telemetry >= 0.5
      ? 'telemetry'
      : run.sourceMix.transcript >= 0.5
        ? 'transcript'
        : run.sourceMix.telemetry > 0
          ? 'telemetry'
          : run.sourceMix.estimated > 0
            ? 'estimated'
            : null;

  return (
    <div className="rounded border border-zinc-800 bg-zinc-925">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-zinc-900">
        <span className={`text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-zinc-200">{run.featureName}</span>
            <IntegrationBadge run={run} />
          </div>
          <div className="mt-0.5 truncate text-[10px] text-zinc-600">
            {run.branch} · gestartet {run.startedAt ? new Date(run.startedAt).toLocaleString('de-CH') : '—'}
          </div>
        </div>
        <div className="w-44 shrink-0">
          <StackedBar segments={catSegments} height={8} />
        </div>
        <span className="w-28 shrink-0 text-right">
          <span className="block text-emerald-400">
            {fmtTokens(run.total.outputTokens)} <span className="text-zinc-600">Output</span>
          </span>
          <span className="block text-[10px] text-zinc-600">
            {fmtTokens(run.total.cacheReadTokens)} Cache-Read
            <SourceBadge source={dominantSource} />
          </span>
          {/* Nur gemeldete Beträge — es gibt keine Preistabelle und damit keine Schätzung (FR-022/FR-023). */}
          {run.total.costMicros > 0 && (
            <span className="block text-[10px] text-teal-300">
              {fmtCost(run.total.costMicros)}
              {run.total.runsWithoutCost > 0 && (
                <span className="text-zinc-600"> · {run.total.runsWithoutCost} ohne Betrag</span>
              )}
            </span>
          )}
          {/* Kein Subagenten-Anteil → gar keine Zeile, kein Null-Platzhalter (FR-010). */}
          {run.total.subagentTokens > 0 && (
            <span className="block text-[10px] text-violet-300">
              {fmtTokens(run.total.subagentTokens)} Subagenten
            </span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                Output pro Step
              </h3>
              <HBarChart
                items={run.byStep.map((s) => ({
                  label: STEP_LABELS[s.key] ?? s.key,
                  value: s.rollup.outputTokens,
                  color: CATEGORY_COLORS[s.category]!,
                }))}
              />
            </div>
            <div>
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                Spez vs. Coding vs. Overhead
              </h3>
              <Donut
                segments={(['spec', 'coding', 'overhead', 'chat'] as const).map((c) => ({
                  label: CATEGORY_LABELS[c]!,
                  value: run.byCategory[c].tokens,
                  color: CATEGORY_COLORS[c]!,
                }))}
              />
              <Composition run={run} />
            </div>
          </div>

          {detail && detail.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                Einzelne Ausführungen
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500">
                    <th className="px-2 py-1">Start</th>
                    <th className="px-2 py-1">Art</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1 text-right">Dauer</th>
                    <th className="px-2 py-1 text-right">Output</th>
                    <th className="px-2 py-1 text-right">Cache-Read</th>
                    <th className="px-2 py-1 text-right">Subagenten</th>
                    <th className="px-2 py-1 text-right">Betrag</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {detail.map((e) =>
                    // Ein Lebenszyklus-Schritt ist ein Shell-Kommando: keine Tokens, kein
                    // Betrag. Statt vier Strichen (oder gar einer 0, die eine Falschaussage
                    // wäre — FR-020) steht in dieser Zeile der Exit-Code.
                    e.kind === 'lifecycle_step' ? (
                    <tr key={e.id} className="border-b border-zinc-900 hover:bg-zinc-900">
                      <td className="whitespace-nowrap px-2 py-1 text-zinc-500">
                        {new Date(e.startedAt).toLocaleString('de-CH')}
                      </td>
                      <td className="px-2 py-1 text-zinc-400">
                        {KIND_LABELS.lifecycle_step}
                        {e.label && <span className="text-zinc-300"> · {e.label}</span>}
                      </td>
                      <td className="px-2 py-1">
                        <StatusBadge status={e.status} />
                      </td>
                      <td className="px-2 py-1 text-right text-zinc-500">
                        {e.finishedAt ? formatDuration(e.finishedAt - e.startedAt) : '…'}
                      </td>
                      <td colSpan={4} className="px-2 py-1 text-zinc-500">
                        {e.exitCode !== null ? `exit ${e.exitCode}` : ''}
                      </td>
                      <td className="px-2 py-1">
                        <button
                          onClick={() => onOpenLog(e.id)}
                          className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-700"
                        >
                          Log
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={e.id} className="border-b border-zinc-900 hover:bg-zinc-900">
                      <td className="whitespace-nowrap px-2 py-1 text-zinc-500">
                        {new Date(e.startedAt).toLocaleString('de-CH')}
                      </td>
                      <td className="px-2 py-1 text-zinc-400">
                        {e.kind === 'phase' && e.phase ? (STEP_LABELS[e.phase] ?? e.phase) : KIND_LABELS[e.kind]}
                      </td>
                      <td className="px-2 py-1">
                        <StatusBadge status={e.status} />
                      </td>
                      <td className="px-2 py-1 text-right text-zinc-500">
                        {e.finishedAt ? formatDuration(e.finishedAt - e.startedAt) : '…'}
                      </td>
                      <td className="px-2 py-1 text-right text-emerald-400">
                        {e.outputTokens !== null ? fmtTokens(e.outputTokens) : '—'}
                      </td>
                      <td className="px-2 py-1 text-right text-zinc-500">
                        {e.cacheReadTokens !== null ? fmtTokens(e.cacheReadTokens) : '—'}
                        <SourceBadge source={e.tokensSource} />
                      </td>
                      {/* null = keine Subagenten gelaufen → Strich, keine 0 (FR-010). */}
                      <td className="px-2 py-1 text-right text-violet-300">
                        {e.subagentTokens !== null ? fmtTokens(e.subagentTokens) : '—'}
                      </td>
                      {/* null = kein Betrag gemeldet → Strich, nie eine Ersatzschätzung (FR-023). */}
                      <td
                        className="px-2 py-1 text-right text-teal-300"
                        title={e.costMicros !== null ? 'Von der Claude-CLI gemeldet' : undefined}
                      >
                        {e.costMicros !== null ? fmtCost(e.costMicros) : '—'}
                      </td>
                      <td className="px-2 py-1">
                        <button
                          onClick={() => onOpenLog(e.id)}
                          className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-700"
                        >
                          Log
                        </button>
                      </td>
                    </tr>
                  ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Token-Komposition des Laufs: frischer Input/Output vs. Cache (nur bei gemessener Usage). */
function Composition({ run }: { run: RunSummary }) {
  const t = run.total;
  const has = t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens > 0;
  if (!has) {
    return (
      <p className="mt-3 max-w-xs text-[10px] leading-relaxed text-zinc-600">
        Keine gemessene Usage — Werte geschätzt. Gemessene Komponenten (Input/Output/Cache) erscheinen, sobald
        Transkripte verfügbar sind.
      </p>
    );
  }
  const segments: Segment[] = [
    { label: 'Input', value: t.inputTokens, color: '#38bdf8' },
    { label: 'Output', value: t.outputTokens, color: '#34d399' },
    { label: 'Cache-Read', value: t.cacheReadTokens, color: '#52525b' },
    { label: 'Cache-Write', value: t.cacheCreationTokens, color: '#f59e0b' },
  ];
  return (
    <div className="mt-4 max-w-sm">
      <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Komposition</h3>
      <StackedBar segments={segments} />
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label} {fmtTokens(s.value)}
          </span>
        ))}
      </div>
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
