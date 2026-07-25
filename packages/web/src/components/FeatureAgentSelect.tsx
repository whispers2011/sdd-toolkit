import { useCallback, useEffect, useState } from 'react';
import type { FeatureAgentView } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Dialog } from './Sidebar.js';
import { triggerBadge } from './AgentsPanel.js';
import { VerdictPill } from './review/AuditSidebar.js';
import { fmtTokens } from './charts.js';

/**
 * Pro-Feature: welche Agents gelten (Union global∪Projekt), Übersteuerung
 * Auto/Ein/Aus (Exclude schlägt alles, Include erzwingt auch deaktivierte)
 * und manueller Lauf mit Sicht auf das letzte Ergebnis.
 */
export function FeatureAgentSelect({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [data, setData] = useState<FeatureAgentView[] | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());

  const fail = (e: Error) => dispatch({ type: 'error', message: e.message });
  const load = useCallback(() => {
    api.featureAgents(featureId).then(setData).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);
  useEffect(load, [load, state.agentGateVersion]);

  const setDecision = (agentId: string, decision: 'include' | 'exclude' | 'auto') =>
    void api.setAgentSelection(featureId, agentId, decision).then(load).catch(fail);

  const run = (agentId: string) => {
    setRunning((cur) => new Set(cur).add(agentId));
    void api
      .runAgent(featureId, agentId)
      .catch(fail)
      .finally(() =>
        setRunning((cur) => {
          const next = new Set(cur);
          next.delete(agentId);
          return next;
        }),
      );
  };

  return (
    <Dialog title="Agents für dieses Feature" onClose={onClose} wide>
      {!data ? (
        <p className="text-sm text-zinc-500">Lade …</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-zinc-500">Keine Agents definiert (Sidebar → ⚖ Agenten).</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500">
            „Aus" schließt den Agent für dieses Feature aus (auch globale Gates); „Ein" erzwingt ihn
            auch, wenn er deaktiviert ist. Ergebnisse laufen strukturiert ins Review-Portal.
          </p>
          <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
            {data.map(({ agent, decision, effective, lastRun }) => (
              <li key={agent.id} className="rounded border border-zinc-800 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${effective ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
                  <span className="truncate text-sm text-zinc-200">{agent.name}</span>
                  <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{triggerBadge(agent.trigger)}</span>
                  {!agent.blocking && <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-500">Hinweis</span>}
                  <div className="ml-auto flex gap-0.5">
                    {(['auto', 'include', 'exclude'] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDecision(agent.id, d)}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          decision === d ? 'bg-sky-800 text-sky-100' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        }`}
                      >
                        {d === 'auto' ? 'Auto' : d === 'include' ? 'Ein' : 'Aus'}
                      </button>
                    ))}
                    <button
                      onClick={() => run(agent.id)}
                      disabled={running.has(agent.id)}
                      className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
                      title="Agent jetzt für dieses Feature ausführen (braucht einen Worktree)"
                    >
                      {running.has(agent.id) ? '⏳ läuft …' : '▶ Jetzt ausführen'}
                    </button>
                  </div>
                </div>
                {lastRun && (
                  <div className="mt-1 flex items-center gap-2 pl-4 text-[11px] text-zinc-500">
                    <VerdictPill verdict={lastRun.verdict} />
                    <span className="truncate">{lastRun.summary ?? lastRun.decisionLabel ?? ''}</span>
                    <span className="ml-auto shrink-0">
                      {new Date(lastRun.createdAt).toLocaleString('de-CH')}
                      {lastRun.totalTokens ? ` · ${fmtTokens(lastRun.totalTokens)} tok` : ''}
                      {lastRun.costUsd ? ` · $${lastRun.costUsd.toFixed(2)}` : ''}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
