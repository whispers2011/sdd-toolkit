import { useEffect, useState } from 'react';
import type { KnowledgeIndexItem } from '@sdd/shared';
import { api, type FeatureKnowledgeResponse } from '../api.js';
import { useStore } from '../store.js';
import { Dialog } from './Sidebar.js';
import { BundleIcon, EntryIcon } from './icons.js';

/**
 * Pro-Feature: welche Bundles/Einträge sind relevant (auto), Übersteuerung
 * (include/exclude) und Materialisierung. Zeigt die geladene Auswahl (FR-014).
 */
export function FeatureKnowledgeSelect({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const { dispatch } = useStore();
  const [data, setData] = useState<FeatureKnowledgeResponse | null>(null);
  const [materialized, setMaterialized] = useState<string[] | null>(null);

  useEffect(() => {
    api.featureKnowledge(featureId).then(setData).catch((e: Error) => dispatch({ type: 'error', message: e.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);

  const setDecision = (item: KnowledgeIndexItem, decision: 'include' | 'exclude' | 'auto') =>
    void api
      .setKnowledgeSelection(featureId, { targetId: item.id, targetKind: item.kind, decision })
      .then(setData)
      .catch((e: Error) => dispatch({ type: 'error', message: e.message }));

  const materialize = () =>
    void api
      .materializeKnowledge(featureId)
      .then((r) => setMaterialized(r.materialized.map((m) => m.path)))
      .catch((e: Error) => dispatch({ type: 'error', message: e.message }));

  return (
    <Dialog title="Projektwissen für dieses Feature" onClose={onClose}>
      {!data ? (
        <p className="text-sm text-zinc-500">Lade …</p>
      ) : data.index.items.length === 0 ? (
        <p className="text-sm text-zinc-500">Dieses Projekt hat noch kein Wissen.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500">
            Vorschlag automatisch aus Anwendbarkeit; hier übersteuerbar. Nur „aktiv" markierte Elemente werden geladen.
          </p>
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
            {data.index.items.map((item) => {
              const effective = data.resolved.effective.includes(item.id);
              const auto = data.resolved.autoIncluded.includes(item.id);
              const decision = data.resolved.userIncluded.includes(item.id)
                ? 'include'
                : data.resolved.userExcluded.includes(item.id)
                  ? 'exclude'
                  : 'auto';
              return (
                <li key={item.id} className="flex items-center gap-2 rounded border border-zinc-800 px-2 py-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${effective ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
                  <span className="text-zinc-600">{item.kind === 'bundle' ? <BundleIcon /> : <EntryIcon />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-200">{item.label}</div>
                    <div className="truncate text-xs text-zinc-500">
                      {item.applicability.text}
                      {item.applicability.tags.length > 0 && ` · ${item.applicability.tags.join(', ')}`}
                      {auto && <span className="ml-1 text-emerald-600">auto</span>}
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    {(['auto', 'include', 'exclude'] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDecision(item, d)}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          decision === d ? 'bg-sky-800 text-sky-100' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        }`}
                      >
                        {d === 'auto' ? 'Auto' : d === 'include' ? 'Ein' : 'Aus'}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-zinc-500">{data.resolved.effective.length} aktiv</span>
            <button
              onClick={materialize}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-emerald-600"
            >
              In Worktree materialisieren
            </button>
          </div>
          {materialized && (
            <div className="mt-2 rounded border border-emerald-900 bg-emerald-950/30 px-2 py-1.5 text-xs text-emerald-300">
              Geladen: {materialized.length === 0 ? 'nur Index (kein relevanter Inhalt)' : materialized.join(', ')}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
