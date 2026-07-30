import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentRunSummary, AgentTrigger } from '@sdd/shared';
import { api } from '../../api.js';
import { Dialog } from '../Sidebar.js';
import { fmtTokens } from '../charts.js';

function triggerLabel(t: AgentTrigger): string {
  switch (t.kind) {
    case 'review_gate':
      return 'Review-Gate';
    case 'after_phase':
      return `Nach Phase ${t.phase ?? '?'}`;
    case 'before_phase':
      return `Vor Phase ${t.phase ?? '?'}`;
    case 'manual':
      return 'Manuell';
  }
}

/**
 * Audit-Leiste (rechte Portal-Spalte): alle Agent-Läufe des Features gruppiert
 * nach Auslöser — Verdict-Pills, Entscheidungs-Label, Zusammenfassung,
 * SVG-Fortschrittsring, Bericht-Dialog. Alt-Berichte (source markdown) werden
 * bestmöglich angezeigt.
 */
export function AuditSidebar({
  featureId,
  runs,
  error,
}: {
  featureId: string;
  runs: AgentRunSummary[] | null;
  error: string | null;
}) {
  const [report, setReport] = useState<{ title: string; content: string } | null>(null);

  // Prüfreihenfolge: der Fehler zuerst. Sonst bliebe die Spalte nach einem
  // gescheiterten Abruf für immer im Ladezustand, weil `runs` null bleibt —
  // und „lädt" liest sich wie „gleich da", nicht wie „nicht geladen" (FR-009).
  if (error) {
    return (
      <div className="px-3 py-2">
        <p className="text-xs font-semibold text-amber-300">Audits konnten nicht geladen werden.</p>
        <p className="mt-1 text-xs text-zinc-400">{error}</p>
      </div>
    );
  }

  if (!runs) return <p className="px-3 py-2 text-xs text-zinc-400">Lade Audits …</p>;

  // Pro Agent zählt der jüngste Lauf (runs kommen absteigend sortiert).
  const latest = new Map<string, AgentRunSummary>();
  for (const run of runs) {
    const key = run.agentId ?? run.agentName;
    if (!latest.has(key)) latest.set(key, run);
  }
  const current = [...latest.values()];
  const passed = current.filter((r) => r.verdict === 'PASS').length;

  const groups = new Map<string, AgentRunSummary[]>();
  for (const run of current) {
    const key = triggerLabel(run.trigger);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  // „Keine Läufe" ist keine Nebensache: es heisst, dass kein Agent geprüft hat und
  // das eigene Urteil das einzige Gate vor der Integration ist. Ohne diesen Satz
  // liest man die leere Spalte als „nichts zu beanstanden" (FR-008).
  if (current.length === 0) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex items-center gap-3">
          <ProgressRing passed={0} total={0} />
          <div>
            <div className="text-xs font-semibold text-zinc-300">Agent-Audits</div>
            <div className="text-[11px] text-zinc-400">Keine Läufe</div>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Kein Agent hat dieses Feature geprüft. Damit ist dein eigenes Urteil das einzige Gate
          vor der Integration — es gibt keine bestandene Prüfung, auf die du dich stützen kannst.
        </p>
      </div>
    );
  }

  const openReport = (run: AgentRunSummary) =>
    void api
      .agentRunReport(featureId, run.id)
      .then((r) => setReport({ title: run.agentName, content: r.content }))
      .catch((e: Error) => setReport({ title: run.agentName, content: `_Bericht nicht verfügbar:_ ${e.message}` }));

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-3">
        <ProgressRing passed={passed} total={current.length} />
        <div>
          <div className="text-xs font-semibold text-zinc-300">Agent-Audits</div>
          <div className="text-[11px] text-zinc-400">{`${passed}/${current.length} bestanden`}</div>
        </div>
      </div>

      {[...groups.entries()].map(([label, groupRuns]) => (
        <div key={label}>
          <div className="mb-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">{label}</div>
          <ul className="space-y-1">
            {groupRuns.map((run) => (
              <li key={run.id} className="rounded border border-zinc-800 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <VerdictPill verdict={run.verdict} />
                  <span className="truncate text-xs text-zinc-200" title={run.agentName}>
                    {run.agentName}
                  </span>
                  {!run.blocking && (
                    <span className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-400" title="Beratend — FAIL stoppt nichts">
                      Hinweis
                    </span>
                  )}
                  {run.source === 'markdown' && (
                    <span className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-400" title="Alt-Bericht (vor der strukturierten Ablage)">
                      Alt
                    </span>
                  )}
                  {run.reportPath && (
                    <button
                      onClick={() => openReport(run)}
                      className="ml-auto shrink-0 rounded px-1 text-[10px] text-sky-300 hover:bg-zinc-800"
                    >
                      Bericht
                    </button>
                  )}
                </div>
                {run.decisionLabel && <div className="mt-0.5 text-[10px] text-amber-300">{run.decisionLabel}</div>}
                {run.summary && <p className="mt-0.5 line-clamp-3 text-[11px] text-zinc-400">{run.summary}</p>}
                <div className="mt-0.5 text-[10px] text-zinc-400">
                  {new Date(run.createdAt).toLocaleString('de-CH')}
                  {run.totalTokens ? ` · ${fmtTokens(run.totalTokens)} tok` : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {report && (
        <Dialog title={`Bericht: ${report.title}`} onClose={() => setReport(null)} wide>
          <div className="max-h-[65vh] overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content}</ReactMarkdown>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function VerdictPill({ verdict }: { verdict: 'PASS' | 'FAIL' | null }) {
  if (verdict === 'PASS') {
    return <span className="rounded bg-emerald-900/80 px-1.5 text-[10px] font-semibold text-emerald-300">PASS</span>;
  }
  if (verdict === 'FAIL') {
    return <span className="rounded bg-red-900/80 px-1.5 text-[10px] font-semibold text-red-300">FAIL</span>;
  }
  return (
    <span className="rounded bg-zinc-800 px-1.5 text-[10px] font-semibold text-zinc-400" title="Kein auswertbares Urteil — zählt nie als bestanden">
      unklar
    </span>
  );
}

/** Handgerollter SVG-Fortschrittsring (bestanden/gesamt), keine Chart-Lib. */
function ProgressRing({ passed, total }: { passed: number; total: number }) {
  const size = 44;
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? passed / total : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-zinc-800" strokeWidth={5} />
      {total > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={passed === total ? 'stroke-emerald-400' : 'stroke-amber-300'}
          strokeWidth={5}
          strokeDasharray={`${frac * c} ${c - frac * c}`}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
