import { useEffect, useMemo, useState } from 'react';
import { api, type DiffSummary, type ExecutionInfo } from '../api.js';
import { useStore } from '../store.js';
import { Dialog } from './Sidebar.js';

type Tab = 'files' | 'commits' | 'resolution';

/** Human-Review-Portal (WP5): Diffs reviewen statt Konsolen beobachten. */
export function ReviewPortal({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>('files');
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [executions, setExecutions] = useState<ExecutionInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<string>('');
  const [rejectComment, setRejectComment] = useState('');
  const [showReject, setShowReject] = useState(false);

  const feature = state.app?.features.find((f) => f.id === featureId);
  const project = state.app?.projects.find((p) => p.id === feature?.projectId);

  const fail = (e: Error) => dispatch({ type: 'error', message: e.message });

  useEffect(() => {
    api.diff(featureId).then(setSummary).catch(fail);
    api.executions(featureId).then(setExecutions).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);

  useEffect(() => {
    if (!selectedFile) return;
    setFileDiff('');
    api
      .fileDiff(featureId, selectedFile)
      .then((r) => setFileDiff(r.diff))
      .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId, selectedFile]);

  const totalCost = useMemo(
    () => executions.reduce((sum, e) => sum + (e.costUsd ?? 0), 0),
    [executions],
  );
  const resolutions = executions.filter((e) => e.kind === 'conflict_resolution');
  const reviews = executions.filter((e) => e.kind === 'review');

  if (!feature) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-6xl flex-col rounded-lg border border-zinc-700 bg-zinc-925 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">
            Review: {project?.name} / {feature.name}
          </h2>
          <span className="text-xs text-zinc-500">{feature.branch} → {project?.defaultBranch}</span>
          <span className="ml-auto text-xs text-zinc-500">
            Kosten gesamt: ${totalCost.toFixed(2)}
            {reviews.length > 0 && ` · ${reviews.length} Agent-Reviews`}
          </span>
          <button onClick={onClose} className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800">✕</button>
        </header>

        <nav className="flex gap-1 border-b border-zinc-800 px-4 py-1.5">
          <PortalTab active={tab === 'files'} onClick={() => setTab('files')}>
            Dateien ({summary?.files.length ?? '…'})
          </PortalTab>
          <PortalTab active={tab === 'commits'} onClick={() => setTab('commits')}>
            Commits ({summary?.commits.length ?? '…'})
          </PortalTab>
          {resolutions.length > 0 && (
            <PortalTab active={tab === 'resolution'} onClick={() => setTab('resolution')}>
              ⚡ Konfliktauflösung ({resolutions.length})
            </PortalTab>
          )}
        </nav>

        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === 'files' && (
            <div className="flex h-full">
              <ul className="w-72 shrink-0 overflow-y-auto border-r border-zinc-800 p-2">
                {summary?.files.map((f) => (
                  <li key={f.path}>
                    <button
                      onClick={() => setSelectedFile(f.path)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                        selectedFile === f.path ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'
                      }`}
                    >
                      <span className="truncate">{f.path}</span>
                      <span className="ml-auto whitespace-nowrap">
                        <span className="text-emerald-500">+{f.additions}</span>{' '}
                        <span className="text-red-500">−{f.deletions}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {summary && summary.files.length === 0 && (
                  <li className="px-2 py-4 text-xs text-zinc-600">Keine Änderungen gegen {project?.defaultBranch}.</li>
                )}
              </ul>
              <div className="min-w-0 flex-1 overflow-auto p-3">
                {selectedFile ? <DiffView diff={fileDiff} /> : (
                  <p className="p-4 text-sm text-zinc-600">Datei links auswählen.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'commits' && (
            <ul className="space-y-1 overflow-y-auto p-4">
              {summary?.commits.map((c) => (
                <li key={c.sha} className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
                  <code className="text-xs text-zinc-500">{c.sha.slice(0, 8)}</code>
                  <span className="text-sm text-zinc-300">{c.subject}</span>
                  <span className="ml-auto text-xs text-zinc-600">
                    {new Date(c.date).toLocaleString('de-CH')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {tab === 'resolution' && <ResolutionView resolutions={resolutions} />}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={() => setShowReject(true)}
            className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            ✗ Zurückweisen
          </button>
          <button
            onClick={() =>
              void api
                .approveMerge(featureId)
                .then(() => onClose())
                .catch(fail)
            }
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600"
          >
            ✓ Approve & Merge
          </button>
        </footer>
      </div>

      {showReject && (
        <Dialog title="Zurückweisen mit Feedback" onClose={() => setShowReject(false)}>
          <textarea
            autoFocus
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="Was soll der Agent anders machen? Geht als Prompt in die Feature-Konsole."
            rows={4}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setShowReject(false)} className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">
              Abbrechen
            </button>
            <button
              onClick={() =>
                void api
                  .rejectReview(featureId, rejectComment)
                  .then(() => onClose())
                  .catch(fail)
              }
              className="rounded bg-red-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Zurückweisen
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function PortalTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-xs font-medium ${
        active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'
      }`}
    >
      {children}
    </button>
  );
}

/** Zeilenbasierter Diff-Viewer mit Add/Del/Hunk-Färbung. */
export function DiffView({ diff }: { diff: string }) {
  if (!diff) return <p className="p-4 text-sm text-zinc-600">Lade Diff …</p>;
  return (
    <pre className="overflow-x-auto rounded border border-zinc-800 bg-[#0a0a0c] p-3 font-mono text-xs leading-5">
      {diff.split('\n').map((line, i) => {
        let cls = 'text-zinc-400';
        if (line.startsWith('+++') || line.startsWith('---')) cls = 'text-zinc-500 font-semibold';
        else if (line.startsWith('@@')) cls = 'text-sky-400';
        else if (line.startsWith('+')) cls = 'bg-emerald-950/60 text-emerald-300';
        else if (line.startsWith('-')) cls = 'bg-red-950/50 text-red-300';
        else if (line.startsWith('diff ')) cls = 'text-zinc-300 font-semibold';
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

/** Transparenz der Auto-Konfliktauflösung: Konfliktzustand → Auflösung. */
function ResolutionView({ resolutions }: { resolutions: ExecutionInfo[] }) {
  const [selected, setSelected] = useState<string | null>(resolutions[0]?.id ?? null);
  const [diffs, setDiffs] = useState<{ pre: string | null; post: string | null } | null>(null);
  const [side, setSide] = useState<'pre' | 'post'>('post');

  useEffect(() => {
    if (!selected) return;
    setDiffs(null);
    api.resolutionDiff(selected).then(setDiffs).catch(() => setDiffs({ pre: null, post: null }));
  }, [selected]);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        {resolutions.map((r, i) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={`rounded px-2 py-1 text-xs ${selected === r.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'}`}
          >
            Lauf {i + 1} ({r.status})
          </button>
        ))}
        <span className="mx-2 text-zinc-700">|</span>
        <button
          onClick={() => setSide('pre')}
          className={`rounded px-2 py-1 text-xs ${side === 'pre' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`}
        >
          Konfliktzustand
        </button>
        <button
          onClick={() => setSide('post')}
          className={`rounded px-2 py-1 text-xs ${side === 'post' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`}
        >
          Auflösung
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {diffs ? (
          <DiffView diff={(side === 'pre' ? diffs.pre : diffs.post) ?? 'Kein Diff aufgezeichnet.'} />
        ) : (
          <p className="text-sm text-zinc-600">Lade …</p>
        )}
      </div>
    </div>
  );
}
