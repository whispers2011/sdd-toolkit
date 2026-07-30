import { useCallback, useEffect, useState } from 'react';
import { lifecycleTriggerChip } from '@sdd/shared';
import type { FeatureLifecycleStepView } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Dialog } from './Sidebar.js';

type LastRun = NonNullable<FeatureLifecycleStepView['lastRun']>;

/**
 * Pro Feature: welche Schritte gelten (Union global∪Projekt) und Übersteuerung
 * Auto/Ein/Aus (Aus schlägt alles, Ein erzwingt auch deaktivierte). Bewusst OHNE
 * „Jetzt ausführen" — anders als bei Agents läuft ein Schritt nur an seinem
 * Auslöser; wiederholt wird die Stufe als Ganzes.
 */
export function FeatureLifecycleStepSelect({
  featureId,
  onClose,
}: {
  featureId: string;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const [data, setData] = useState<FeatureLifecycleStepView[] | null>(null);

  const fail = (e: Error) => dispatch({ type: 'error', message: e.message });
  const load = useCallback(() => {
    api.featureLifecycleSteps(featureId).then(setData).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);
  useEffect(load, [load]);

  const setDecision = (stepId: string, decision: 'include' | 'exclude' | 'auto') =>
    void api.setLifecycleStepSelection(featureId, stepId, decision).then(load).catch(fail);

  return (
    <Dialog title="Lebenszyklus-Schritte für dieses Feature" onClose={onClose} wide>
      {!data ? (
        <p className="text-sm text-zinc-500">Lade …</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-zinc-500">Keine Schritte definiert (Sidebar → Lebenszyklus-Schritte).</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500">
            „Aus" schließt den Schritt für dieses Feature aus (auch globale). „Ein" erzwingt ihn auch,
            wenn er deaktiviert ist. Ohne Festlegung gilt die Ebene darüber.
          </p>
          <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
            {data.map(({ step, decision, effective, lastRun }) => (
              <li key={step.id} className="rounded border border-zinc-800 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${effective ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                    title={effective ? 'Läuft für dieses Feature' : 'Läuft nicht'}
                  />
                  <span className="truncate text-sm text-zinc-200">{step.name}</span>
                  <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">
                    {lifecycleTriggerChip(step.trigger)}
                  </span>
                  {!step.blocking && (
                    <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-500">Hinweis</span>
                  )}
                  <div className="ml-auto flex gap-0.5">
                    {(['auto', 'include', 'exclude'] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDecision(step.id, d)}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          decision === d
                            ? 'bg-sky-800 text-sky-100'
                            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        }`}
                      >
                        {d === 'auto' ? 'Auto' : d === 'include' ? 'Ein' : 'Aus'}
                      </button>
                    ))}
                  </div>
                </div>
                {lastRun && <LastRunLine run={lastRun} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

/** Jüngster Lauf des Schritts für dieses Feature: Zeitpunkt, Dauer, Ergebnis. */
function LastRunLine({ run }: { run: LastRun }) {
  const { text, tone } = outcome(run);
  return (
    <div className="mt-1 flex items-center gap-2 pl-4 text-[11px] text-zinc-500">
      <span className={`rounded px-1.5 py-0.5 ${tone}`}>{text}</span>
      <span className="ml-auto shrink-0">
        {new Date(run.startedAt).toLocaleString('de-CH')}
        {run.finishedAt !== null && ` · ${formatDuration(run.finishedAt - run.startedAt)}`}
      </span>
    </div>
  );
}

function outcome(run: LastRun): { text: string; tone: string } {
  switch (run.status) {
    case 'succeeded':
      return { text: 'erfolgreich', tone: 'bg-emerald-950/60 text-emerald-300' };
    case 'failed':
      return {
        text: run.exitCode !== null ? `fehlgeschlagen (exit ${run.exitCode})` : 'fehlgeschlagen',
        tone: 'bg-red-950/60 text-red-300',
      };
    case 'orphaned':
      return { text: 'unterbrochen', tone: 'bg-amber-950/60 text-amber-300' };
    case 'running':
      return { text: 'läuft …', tone: 'bg-sky-950/60 text-sky-300' };
  }
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
