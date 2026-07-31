import { useEffect, useMemo, useState } from 'react';
import { costPerTask } from '@sdd/shared';
import { api, type ExecutionInfo, type RunSummary } from '../api.js';
import { useStore } from '../store.js';
import { CHART_TONES, Donut, HBarChart, StackedBar, fmtTokens, fmtCost, type ChartTone, type Segment } from './charts.js';
import { ChevronDownIcon, FolderOpenIcon } from './icons.js';

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

const CATEGORY_TONES: Record<string, ChartTone> = {
  spec: CHART_TONES.spec,
  coding: CHART_TONES.coding,
  overhead: CHART_TONES.overhead,
  chat: CHART_TONES.chat,
};

const CATEGORY_LABELS: Record<string, string> = {
  spec: 'Spezifikation',
  coding: 'Coding',
  overhead: 'Overhead',
  chat: 'Chat',
};

const SOURCE_LABELS: Record<NonNullable<ExecutionInfo['tokensSource']>, string> = {
  telemetry: 'gemeldet',
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
        ? 'bg-emerald-950 text-emerald-300'
        : source === 'parsed'
          ? 'bg-sky-950 text-sky-300'
          : 'bg-zinc-800 text-zinc-400';
  return (
    <span
      className={`ml-1 rounded px-1 py-0.5 text-xs ${cls}`}
      title={
        source === 'telemetry'
          ? 'Von der Claude-CLI gemeldet — nicht vom Toolkit erschlossen'
          : undefined
      }
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

/** Spaltenbreiten der Lauf-Zeile — Kopfzeile und Zeilen teilen sie sich, sonst fluchtet nichts. */
const COL = {
  started: 'w-28',
  tasks: 'w-14',
  lanes: 'w-40',
  status: 'w-44',
  open: 'w-6',
} as const;

/**
 * Stand des Laufs als Prozessschritt. Die Beschriftung kommt aus dem geteilten Katalog
 * (`featureProgressLabel`, serverseitig als `progressLabel` mitgeliefert) — damit heisst
 * derselbe Zustand hier wie in der Worktree-Übersicht, und ein Lauf vor der Integration
 * nennt seinen Schritt („Umsetzen läuft") statt nur „offen".
 */
function IntegrationBadge({ run }: { run: RunSummary }) {
  if (run.archived) return <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">archiviert</span>;
  const s = run.integration;
  const cls = run.running
    ? 'bg-sky-950 text-sky-300 animate-pulse'
    : s === 'merged'
      ? 'bg-emerald-950 text-emerald-300'
      : s === 'conflict_escalated' || s === 'verify_failed' || s === 'gate_failed'
        ? 'bg-red-950 text-red-300'
        : s === 'none'
          ? 'bg-zinc-800 text-zinc-400'
          : 'bg-amber-950 text-amber-300';
  return <span className={`rounded px-1.5 py-0.5 ${cls}`}>{run.progressLabel}</span>;
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
  // Gemeinsamer Massstab aller Balken: ohne ihn ist jeder Balken gleich lang und zeigt nur
  // die Mischung, nicht die Grösse — zwei Läufe wären nicht vergleichbar.
  const maxOutput = Math.max(1, ...visible.map((r) => r.total.outputTokens));

  return (
    <div className="flex h-full">
      <div className={`${logFor ? 'w-1/2' : 'w-full'} overflow-auto p-4`}>
        {/* Eine Zeile Summen, eine Zeile Erklärung — die Zahlen des Kopfes brauchen sie,
            die Liste darunter nicht mehr (die Zeile zeigt nur noch Output je Lane). */}
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-zinc-400">
          <span className="font-semibold">Läufe</span>
          <span>{visible.length} · 1 Lauf = 1 Worktree/Feature</span>
          <LaneLegend />
          <span className="ml-auto">
            <span className="text-emerald-300">{fmtTokens(totalOutput)} Output</span> ·{' '}
            {fmtTokens(totalCacheRead)} Cache-Read · {(measured * 100).toFixed(0)} % gemessen
            {reported > 0 && <span className="text-teal-300"> ({(reported * 100).toFixed(0)} % gemeldet)</span>}
            {totalCost > 0 && (
              <>
                {' · '}
                <span className="text-teal-300">{fmtCost(totalCost)} gemeldet</span>
                {runsWithoutCost > 0 && (
                  <span className="text-zinc-400"> ({runsWithoutCost} ohne Betrag)</span>
                )}
              </>
            )}
          </span>
        </div>
        <p className="mb-3 text-xs text-zinc-400">
          Output = neu erzeugte Tokens, das Mass für geleistete Arbeit. Cache-Read = erneut gelesener
          Kontext; er wächst mit jedem Turn und macht den Grossteil jeder Summe aus.
        </p>

        {/* Beschriftete Spalten statt beschrifteter Zellen: die Zeile trägt damit nur Zahlen. */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-2 pb-1 text-xs text-zinc-400">
          <span className="min-w-0 flex-1 pl-7">Lauf</span>
          <span className={`${COL.started} shrink-0 text-right`}>gestartet</span>
          <span className={`${COL.tasks} shrink-0 text-right`}>Aufgaben</span>
          <span className={`${COL.lanes} shrink-0`}>Output je Lane</span>
          <span className={`${COL.status} shrink-0`}>Status</span>
          <span className={`${COL.open} shrink-0`} />
        </div>

        <div className="divide-y divide-zinc-900">
          {visible.map((run) => (
            <RunCard
              key={run.featureId}
              run={run}
              maxOutput={maxOutput}
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
            <div className="px-2 py-10 text-center text-xs text-zinc-400">Noch keine Läufe.</div>
          )}
        </div>
      </div>

      {logFor && (
        <div className="flex w-1/2 flex-col border-l border-zinc-800">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold text-zinc-400">Log {logFor}</span>
            <button onClick={() => setLogFor(null)} className="rounded px-2 text-zinc-400 hover:bg-zinc-800">
              ✕
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-xs whitespace-pre-wrap text-zinc-400">
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

/** Legende der Lanes — einmal über der Liste statt in jeder Zeile. */
function LaneLegend() {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {(['spec', 'coding', 'overhead', 'chat'] as const).map((c) => (
        <span key={c} className="flex items-center gap-1 whitespace-nowrap">
          <span className={`h-2 w-2 rounded-sm ${CATEGORY_TONES[c]!.bg}`} />
          {CATEGORY_LABELS[c]}
        </span>
      ))}
    </span>
  );
}

export function RunCard({
  run,
  expanded,
  onToggle,
  detail,
  onOpenLog,
  maxOutput,
}: {
  run: RunSummary;
  expanded: boolean;
  onToggle: () => void;
  detail: ExecutionInfo[] | null;
  onOpenLog: (id: string) => void;
  /** Gemeinsamer Massstab der Balken über alle sichtbaren Läufe; ohne ihn füllt der Lauf ihn allein. */
  maxOutput?: number;
}) {
  const catSegments: Segment[] = (['spec', 'coding', 'overhead', 'chat'] as const)
    .map((c) => ({ label: CATEGORY_LABELS[c]!, value: run.byCategory[c].outputTokens, tone: CATEGORY_TONES[c]! }))
    .filter((s) => s.value > 0);
  // Balkenlänge = Anteil am grössten Lauf. Mindestens ein Pixelstreifen, damit ein kleiner
  // Lauf nicht wie „gar nichts" aussieht; leer bleibt nur, wer wirklich 0 Output hat.
  const scale = run.total.outputTokens / Math.max(1, maxOutput ?? run.total.outputTokens);
  const laneTitle = (['spec', 'coding', 'overhead', 'chat'] as const)
    .filter((c) => run.byCategory[c].outputTokens > 0)
    .map((c) => `${CATEGORY_LABELS[c]}: ${fmtTokens(run.byCategory[c].outputTokens)}`)
    .join(' · ');

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
    <div className={expanded ? 'bg-zinc-900/40' : ''}>
      {/* Eine Zeile, sechs Spalten. Alles Weitere (Cache-Read, Betrag, Herkunft, Branch,
          Subagenten) steht aufgeklappt — es beantwortet keine Frage, die man beim
          Überfliegen einer Liste stellt. */}
      <div className="flex items-center gap-3 px-2 text-xs hover:bg-zinc-900">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? 'Lauf einklappen' : 'Lauf aufklappen'}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          <ChevronDownIcon
            className={`h-5 w-5 shrink-0 text-zinc-500 transition-transform ${expanded ? '' : '-rotate-90'}`}
          />
          <span className="truncate font-medium text-zinc-200">{run.featureName}</span>
        </button>
        <span
          className={`${COL.started} shrink-0 text-right text-zinc-400 tabular-nums`}
          title={run.startedAt ? new Date(run.startedAt).toLocaleString('de-CH') : undefined}
        >
          {formatStarted(run.startedAt)}
        </span>
        <span className={`${COL.tasks} shrink-0 text-right text-zinc-400 tabular-nums`} title={taskLabel(run)}>
          {run.tasksTotal === 0 ? '—' : `${run.tasksDone}/${run.tasksTotal}`}
        </span>
        <span className={`${COL.lanes} shrink-0 rounded-sm bg-zinc-800/60`} title={laneTitle || 'kein Output'}>
          <span className="block" style={{ width: `${scale > 0 ? Math.max(2, scale * 100) : 0}%` }}>
            <StackedBar segments={catSegments} height={8} />
          </span>
        </span>
        <span className={`${COL.status} shrink-0 truncate`} title={run.progressLabel}>
          <IntegrationBadge run={run} />
        </span>
        <span className={`${COL.open} flex shrink-0 justify-end`}>
          {/* Nur solange die Arbeitskopie existiert (nach dem Merge ist sie entfernt). */}
          {run.hasWorktree && (
            <button
              onClick={() => void api.openFeature(run.featureId, 'finder')}
              title="Worktree im Finder öffnen"
              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              <FolderOpenIcon className="h-4 w-4" />
            </button>
          )}
        </span>
      </div>

      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3">
          {/* Dieselbe Funktion wie in der Liste (FR-019, R5.2) — das Dashboard kann
              damit keinen anderen Wert zeigen als die Zeile darüber. Hier stehen auch die
              Zahlen, die aus der Zeile geflogen sind: Verbrauch, Betrag, Herkunft, Branch. */}
          <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <span className="text-zinc-400">
              Aufgaben <span className="text-zinc-300">{taskLabel(run, false)}</span>
            </span>
            <span className="text-zinc-400">
              Output <span className="text-emerald-300">{fmtTokens(run.total.outputTokens)}</span>
            </span>
            <span className="text-zinc-400">
              Cache-Read <span className="text-zinc-300">{fmtTokens(run.total.cacheReadTokens)}</span>
              <SourceBadge source={dominantSource} />
            </span>
            {/* Nur gemeldete Beträge — es gibt keine Preistabelle und damit keine Schätzung (FR-022/FR-023). */}
            {run.total.costMicros > 0 && (
              <span className="text-zinc-400">
                Betrag <span className="text-teal-300">{fmtCost(run.total.costMicros)}</span>
                {run.total.runsWithoutCost > 0 && <span> · {run.total.runsWithoutCost} ohne Betrag</span>}
              </span>
            )}
            <span className="text-zinc-400">
              Kosten <CostPerTask run={run} />
            </span>
            {/* Kein Subagenten-Anteil → gar keine Angabe, kein Null-Platzhalter (FR-010). */}
            {run.total.subagentTokens > 0 && (
              <span className="text-zinc-400">
                Subagenten <span className="text-violet-300">{fmtTokens(run.total.subagentTokens)}</span>
              </span>
            )}
            <span className="truncate text-zinc-400">{run.branch}</span>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                Output pro Step
              </h3>
              <HBarChart
                items={run.byStep.map((s) => ({
                  label: STEP_LABELS[s.key] ?? s.key,
                  value: s.rollup.outputTokens,
                  tone: CATEGORY_TONES[s.category]!,
                }))}
              />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                Spez vs. Coding vs. Overhead
              </h3>
              <Donut
                segments={(['spec', 'coding', 'overhead', 'chat'] as const).map((c) => ({
                  label: CATEGORY_LABELS[c]!,
                  value: run.byCategory[c].tokens,
                  tone: CATEGORY_TONES[c]!,
                }))}
              />
              <Composition run={run} />
            </div>
          </div>

          {detail && detail.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                Einzelne Ausführungen
              </h3>
              {/* Waagerecht scrollt die TABELLE, nicht die Seite: neun Spalten passen in
                  ueblicher Fensterbreite nicht nebeneinander, und gekuerzte Zahlen waeren
                  schlimmer als Scrollen (FR-022, D11). */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[60rem] text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-400">
                      <th className="px-2 py-1 whitespace-nowrap">Start</th>
                      <th className="px-2 py-1 whitespace-nowrap">Art</th>
                      <th className="px-2 py-1 whitespace-nowrap">Status</th>
                      <th className="px-2 py-1 text-right whitespace-nowrap">Dauer</th>
                      <th className="px-2 py-1 text-right whitespace-nowrap">Output</th>
                      <th className="px-2 py-1 text-right whitespace-nowrap">Cache-Read</th>
                      <th className="px-2 py-1 text-right whitespace-nowrap">Subagenten</th>
                      <th className="px-2 py-1 text-right whitespace-nowrap">Betrag</th>
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
                          <td className="px-2 py-1 whitespace-nowrap text-zinc-400">
                            {new Date(e.startedAt).toLocaleString('de-CH')}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap text-zinc-400">
                            {KIND_LABELS.lifecycle_step}
                            {e.label && <span className="text-zinc-300"> · {e.label}</span>}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            <StatusBadge status={e.status} />
                          </td>
                          <td className="px-2 py-1 text-right whitespace-nowrap text-zinc-400">
                            {e.finishedAt ? formatDuration(e.finishedAt - e.startedAt) : '…'}
                          </td>
                          <td colSpan={4} className="px-2 py-1 whitespace-nowrap text-zinc-400">
                            {e.exitCode !== null ? `exit ${e.exitCode}` : ''}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
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
                          <td className="px-2 py-1 whitespace-nowrap text-zinc-400">
                            {new Date(e.startedAt).toLocaleString('de-CH')}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap text-zinc-400">
                            {e.kind === 'phase' && e.phase ? (STEP_LABELS[e.phase] ?? e.phase) : KIND_LABELS[e.kind]}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            <StatusBadge status={e.status} />
                          </td>
                          <td className="px-2 py-1 text-right whitespace-nowrap text-zinc-400">
                            {e.finishedAt ? formatDuration(e.finishedAt - e.startedAt) : '…'}
                          </td>
                          <td className="px-2 py-1 text-right whitespace-nowrap text-emerald-300">
                            {e.outputTokens !== null ? fmtTokens(e.outputTokens) : '—'}
                          </td>
                          <td className="px-2 py-1 text-right whitespace-nowrap text-zinc-400">
                            {e.cacheReadTokens !== null ? fmtTokens(e.cacheReadTokens) : '—'}
                            <SourceBadge source={e.tokensSource} />
                          </td>
                          {/* null = keine Subagenten gelaufen → Strich, keine 0 (FR-010). */}
                          <td className="px-2 py-1 text-right whitespace-nowrap text-violet-300">
                            {e.subagentTokens !== null ? fmtTokens(e.subagentTokens) : '—'}
                          </td>
                          {/* null = kein Betrag gemeldet → Strich, nie eine Ersatzschätzung (FR-023). */}
                          <td
                            className="px-2 py-1 text-right whitespace-nowrap text-teal-300"
                            title={e.costMicros !== null ? 'Von der Claude-CLI gemeldet' : undefined}
                          >
                            {e.costMicros !== null ? fmtCost(e.costMicros) : '—'}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Token-Komposition des Laufs: frischer Input/Output vs. Cache (nur bei gemessener Usage). */
/**
 * Startzeitpunkt in Listenbreite: `30.07. 17:25`. Der vollständige Zeitstempel (mit Jahr
 * und Sekunden) hängt am `title` der Zelle — in der Zeile kostet er nur Platz.
 */
function formatStarted(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const date = d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

/**
 * Aufgabenstand eines Laufs — „keine Aufgabenliste" statt „0/0" (R5.1).
 * Ohne Einheit dort, wo schon eine Beschriftung „Aufgaben" davor steht.
 */
function taskLabel(run: RunSummary, withUnit = true): string {
  if (run.tasksTotal === 0) return 'keine Aufgabenliste';
  return `${run.tasksDone}/${run.tasksTotal}${withUnit ? ' Aufgaben' : ''}`;
}

/**
 * Kosten pro erledigter Aufgabe — die Bezugsgrösse, ohne die zwei Läufe nicht
 * vergleichbar sind. Liste und aufgeklapptes Dashboard rendern dieselbe Komponente,
 * damit sie nicht auseinanderlaufen (FR-019, INV-7).
 *
 * Ein Strich heißt „nicht bestimmbar" — nie eine Schätzung, nie eine 0 (FR-020).
 */
function CostPerTask({ run, className = '' }: { run: RunSummary; className?: string }) {
  const { micros, incomplete } = costPerTask(run);
  return (
    <span className={`${micros === null ? 'text-zinc-400' : 'text-teal-300'} ${className}`}>
      {micros === null ? '—' : fmtCost(micros)} <span className="text-zinc-400">/ Aufgabe</span>
      {incomplete && <span className="text-zinc-400"> · unvollständig</span>}
    </span>
  );
}

function Composition({ run }: { run: RunSummary }) {
  const t = run.total;
  const has = t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens > 0;
  if (!has) {
    return (
      <p className="mt-3 max-w-xs text-xs leading-relaxed text-zinc-400">
        Keine gemessene Usage — Werte geschätzt. Gemessene Komponenten (Input/Output/Cache) erscheinen, sobald
        Transkripte verfügbar sind.
      </p>
    );
  }
  const segments: Segment[] = [
    { label: 'Input', value: t.inputTokens, tone: CHART_TONES.input },
    { label: 'Output', value: t.outputTokens, tone: CHART_TONES.output },
    { label: 'Cache-Read', value: t.cacheReadTokens, tone: CHART_TONES.cacheRead },
    { label: 'Cache-Write', value: t.cacheCreationTokens, tone: CHART_TONES.cacheWrite },
  ];
  return (
    <div className="mt-4 max-w-sm">
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Komposition</h3>
      <StackedBar segments={segments} />
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-400">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.tone.bg}`} />
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
      ? 'bg-emerald-950 text-emerald-300'
      : status === 'failed'
        ? 'bg-red-950 text-red-300'
        : status === 'running'
          ? 'bg-sky-950 text-sky-300 animate-pulse'
          : 'bg-zinc-800 text-zinc-400';
  return <span className={`rounded px-1.5 py-0.5 ${cls}`}>{status}</span>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} m ${s % 60} s`;
}
