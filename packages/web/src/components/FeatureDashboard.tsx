import { useEffect, useState } from 'react';
import { formatBytes, type Feature, type FeatureArtifactStep, type FeatureDocument, type FeaturePhase } from '@sdd/shared';
import { api, type ExecutionInfo, type RunSummary } from '../api.js';
import { useStore } from '../store.js';
import { RunCard } from './ExecutionsView.js';
import { FeatureResultDialog } from './FeatureResultDialog.js';

/**
 * Dashboard eines abgeschlossenen Features: generierte Artefakte, Token-Statistiken und
 * -Grafiken pro Step (wiederverwendetes RunCard) sowie die Lauf-Logs. Ersetzt die
 * Terminal-Konsole, sobald das Feature gemergt/archiviert ist — dort gäbe es ohnehin
 * keine neue Session mehr.
 */
export function FeatureDashboard({ feature }: { feature: Feature }) {
  const { dispatch } = useStore();
  const [run, setRun] = useState<RunSummary | null>(null);
  const [detail, setDetail] = useState<ExecutionInfo[]>([]);
  const [steps, setSteps] = useState<FeatureArtifactStep[]>([]);
  const [documents, setDocuments] = useState<FeatureDocument[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [resultPhase, setResultPhase] = useState<FeaturePhase | null>(null);
  const [logFor, setLogFor] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  useEffect(() => {
    void api
      .runs()
      .then((r) => setRun(r.runs.find((x) => x.featureId === feature.id) ?? null))
      .catch(() => {});
    void api.executions(feature.id).then(setDetail).catch(() => {});
    void api.featureArtifacts(feature.id).then(setSteps).catch(() => {});
    void api.featureDocuments(feature.id).then(setDocuments).catch(() => {});
  }, [feature.id]);

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

  const available = steps.filter((s) => s.available);

  return (
    <div className="flex min-h-0 flex-1">
      <div className={`${logFor ? 'w-1/2' : 'w-full'} min-h-0 space-y-6 overflow-auto p-4`}>
        <section>
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Artefakte</h2>
          {available.length === 0 ? (
            <p className="text-xs text-zinc-600">Keine Artefakte erzeugt.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((s) => (
                <button
                  key={s.phase}
                  onClick={() => setResultPhase(s.phase)}
                  title={s.tooltip}
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  📄 {s.label}
                  <span className="ml-2 text-xs text-zinc-500">
                    {s.files.length} Datei{s.files.length === 1 ? '' : 'en'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Ausgangsmaterial des Features — auch nach dem Merge nachvollziehbar (SC-007). */}
        {documents.length > 0 && (
          <section>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Dokumente</h2>
            <div className="flex flex-wrap gap-2">
              {documents.map((doc) => (
                <button
                  key={doc.storedName}
                  onClick={() =>
                    void api
                      .openFeatureDocument(feature.id, doc.storedName)
                      .catch((e: Error) => dispatch({ type: 'error', message: e.message }))
                  }
                  title={`${doc.relPath} — mit der Systemanwendung öffnen`}
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  📎 {doc.name}
                  <span className="ml-2 text-xs text-zinc-500">{formatBytes(doc.bytes)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
            Token-Verbrauch &amp; Statistik
          </h2>
          {run ? (
            <RunCard
              run={run}
              expanded={expanded}
              onToggle={() => setExpanded((v) => !v)}
              detail={detail}
              onOpenLog={(id) => setLogFor(logFor === id ? null : id)}
            />
          ) : (
            <p className="text-xs text-zinc-600">Keine Lauf-Daten vorhanden.</p>
          )}
        </section>
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
            {log === null ? 'Lade …' : log === '' ? '(leer)' : log}
          </pre>
        </div>
      )}

      {resultPhase && (
        <FeatureResultDialog
          featureId={feature.id}
          featureName={feature.name}
          phase={resultPhase}
          phaseLabel={available.find((s) => s.phase === resultPhase)?.label ?? resultPhase}
          onClose={() => setResultPhase(null)}
        />
      )}
    </div>
  );
}
