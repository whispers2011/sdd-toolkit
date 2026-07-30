import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentRunSummary, ReviewComment } from '@sdd/shared';
import { evaluateAction } from '@sdd/shared';
import { api, type DiffSummary, type ExecutionInfo } from '../api.js';
import { featureActionContext, useStore } from '../store.js';
import { ActionButton, ActionGroup, blockedReason, useAction } from './FeatureAction.js';
import { Dialog } from './Sidebar.js';
import { VoiceButton } from './VoiceButton.js';
import { DiffViewer } from './review/DiffViewer.js';
import { CommentsPanel } from './review/CommentsPanel.js';
import { FileTreePane } from './review/FileTreePane.js';
import { FileEditor } from './review/FileEditor.js';
import { TestsPane } from './review/TestsPane.js';
import { AuditSidebar } from './review/AuditSidebar.js';
import { MergeTargetChooser, type MergeTarget } from './review/MergeTargetChooser.js';

type Tab = 'files' | 'tree' | 'commits' | 'tests' | 'resolution';

/**
 * Review-Portal: vollständige Entscheidungsgrundlage pro Feature — Diff mit
 * Zeilennummern + Kommentaren, Git-Historie, Projektdateien mit Editor,
 * Verify-Dashboard, Agent-Audits — und die Integrations-Entscheidung
 * (Ziel-Branch wählen, freigeben oder strukturiert zurückweisen).
 */
export function ReviewPortal({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>('files');
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [executions, setExecutions] = useState<ExecutionInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<string>('');
  const [treeFiles, setTreeFiles] = useState<string[] | null>(null);
  const [treeSelected, setTreeSelected] = useState<string | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [runs, setRuns] = useState<AgentRunSummary[] | null>(null);
  const [jumpTo, setJumpTo] = useState<{ line: number; side: 'old' | 'new'; ts: number } | null>(null);
  const [target, setTarget] = useState<MergeTarget | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useAction();
  const feature = state.app?.features.find((f) => f.id === featureId);
  const project = state.app?.projects.find((p) => p.id === feature?.projectId);
  const ctx = featureActionContext(state, featureId);
  const approveV = ctx ? evaluateAction('review_approve', ctx) : null;
  const rejectV = ctx ? evaluateAction('review_reject', ctx) : null;
  const retryV = ctx ? evaluateAction('integration_retry', ctx) : null;
  /**
   * Nur noch für den Datei-Editor: Reviewer-Korrekturen werden beim Freigeben
   * committet und ergeben außerhalb eines laufenden Reviews keinen Sinn. Für die
   * Aktionen des Portals ist ausschließlich die Policy zuständig.
   */
  const reviewable = feature?.integration === 'awaiting_human_review';
  /**
   * Die Verifikationslücke kommt aus dem bereits geladenen Projekt — keine
   * zusätzliche Anfrage (FR-022). Solange das Projekt noch nicht im Store ist,
   * wird nichts behauptet: `true` heißt „kein Hinweis", nicht „geprüft".
   */
  const verificationConfigured = (project?.verifyCommands.length ?? 1) > 0;

  const fail = useCallback(
    (e: Error) => dispatch({ type: 'error', message: e.message }),
    [dispatch],
  );

  useEffect(() => {
    api.diff(featureId).then(setSummary).catch(fail);
    api.executions(featureId).then(setExecutions).catch(fail);
  }, [featureId, fail]);

  // Kommentare: initial + bei WS-Invalidierung (review_comments_updated).
  const commentsVersion = state.reviewCommentsVersion[featureId] ?? 0;
  useEffect(() => {
    api.comments(featureId).then(setComments).catch(fail);
  }, [featureId, commentsVersion, fail]);

  // Audits: initial + nach jedem Gate-Abschluss (agent_gate).
  useEffect(() => {
    api.agentRuns(featureId).then(setRuns).catch(fail);
  }, [featureId, state.agentGateVersion, fail]);

  useEffect(() => {
    if (!selectedFile) return;
    setFileDiff('');
    api
      .fileDiff(featureId, selectedFile)
      .then((r) => setFileDiff(r.diff))
      .catch(fail);
  }, [featureId, selectedFile, fail]);

  useEffect(() => {
    if (tab !== 'tree' || treeFiles !== null) return;
    api
      .featureTree(featureId)
      .then((r) => setTreeFiles(r.files))
      .catch(() => setTreeFiles([]));
  }, [tab, treeFiles, featureId]);

  const resolutions = executions.filter((e) => e.kind === 'conflict_resolution');
  const lastVerify = executions.find((e) => e.kind === 'verify' && e.status !== 'running');
  const latestAudits = useMemo(() => {
    const latest = new Map<string, AgentRunSummary>();
    for (const run of runs ?? []) {
      const key = run.agentId ?? run.agentName;
      if (!latest.has(key)) latest.set(key, run);
    }
    return [...latest.values()];
  }, [runs]);
  const auditsPassed = latestAudits.filter((r) => r.verdict === 'PASS').length;
  const openComments = comments.filter((c) => c.status === 'open');
  // Rohwerte, nicht zurechtgebogen: bei widersprüchlicher Zählung nie negativ.
  const openTasks = Math.max(0, (feature?.tasksTotal ?? 0) - (feature?.tasksDone ?? 0));

  const refreshComments = () => api.comments(featureId).then(setComments).catch(fail);

  const jumpToComment = (c: ReviewComment) => {
    if (!c.filePath) return;
    setTab('files');
    setSelectedFile(c.filePath);
    if (c.line !== null) setJumpTo({ line: c.line, side: c.side ?? 'new', ts: Date.now() });
  };

  const approve = () => {
    if (!target?.valid) return;
    setBusy(true);
    run(`review_approve:${featureId}`, () =>
      api
        .approveMerge(featureId, { targetBranch: target.targetBranch, createBranch: target.createBranch })
        .then(() => onClose())
        .finally(() => setBusy(false)),
    );
  };

  const reject = () => {
    setBusy(true);
    run(`review_reject:${featureId}`, () =>
      api
        .rejectReview(featureId, rejectComment)
        .then(() => onClose())
        .finally(() => setBusy(false)),
    );
  };

  if (!feature) return null;

  // Eingabeprüfung des Ziel-Wählers — keine zweite Zustandsregel, sondern die
  // Vollständigkeit des Formulars. Sie wird wie jede Sperre begründet angezeigt.
  const approveVerdict =
    approveV && approveV.availability === 'available' && !target?.valid
      ? {
          availability: 'blocked' as const,
          reason: 'Bitte zuerst einen gültigen Ziel-Branch wählen.',
        }
      : approveV;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[110rem] flex-col rounded-lg border border-zinc-700 bg-zinc-925 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-4 border-b border-zinc-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-100">
            Review: {project?.name} / {feature.name}
          </h2>
          <span className="text-xs text-zinc-500">
            {feature.branch} → {feature.integrationTarget ?? project?.defaultBranch}
          </span>
          <div className="ml-auto flex items-center gap-4 text-xs">
            <HeaderStat label="Dateien" value={summary ? String(summary.files.length) : '…'} />
            <HeaderStat
              label="Zeilen"
              value={
                summary
                  ? `+${summary.files.reduce((s, f) => s + f.additions, 0)} −${summary.files.reduce((s, f) => s + f.deletions, 0)}`
                  : '…'
              }
            />
            {/* Ohne Reiterwechsel und ohne Klick sichtbar (FR-014); offene Aufgaben
                amber, weil dann etwas nicht fertig ist, was gemergt werden soll
                (FR-015). Informiert — sperrt nicht (FR-016). */}
            <HeaderStat
              label="Aufgaben"
              value={feature.tasksTotal === 0 ? 'keine Liste' : `${feature.tasksDone}/${feature.tasksTotal}`}
              tone={openTasks > 0 ? 'warn' : undefined}
            />
            <HeaderStat
              label="Audits"
              value={runs ? `${auditsPassed}/${latestAudits.length}` : '…'}
              tone={latestAudits.length === 0 ? undefined : auditsPassed === latestAudits.length ? 'ok' : 'bad'}
            />
            {/* Ohne Lauf UND ohne Konfiguration ist das kein „–", sondern eine
                benannte Lücke (FR-008). Ein stattgefundener Lauf schlägt die
                Konfiguration — er hat stattgefunden. */}
            <HeaderStat
              label="Verify"
              value={
                lastVerify
                  ? lastVerify.status === 'succeeded'
                    ? '✓'
                    : '✗'
                  : verificationConfigured
                    ? '–'
                    : 'nicht konfiguriert'
              }
              tone={
                lastVerify ? (lastVerify.status === 'succeeded' ? 'ok' : 'bad') : verificationConfigured ? undefined : 'warn'
              }
            />
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800">
            ✕
          </button>
        </header>

        <nav className="flex gap-1 border-b border-zinc-800 px-4 py-1.5">
          <PortalTab active={tab === 'files'} onClick={() => setTab('files')}>
            Dateien ({summary?.files.length ?? '…'})
          </PortalTab>
          <PortalTab active={tab === 'commits'} onClick={() => setTab('commits')}>
            Historie ({summary?.commits.length ?? '…'})
          </PortalTab>
          <PortalTab active={tab === 'tree'} onClick={() => setTab('tree')}>
            Projektdateien
          </PortalTab>
          <PortalTab active={tab === 'tests'} onClick={() => setTab('tests')}>
            Tests
          </PortalTab>
          {resolutions.length > 0 && (
            <PortalTab active={tab === 'resolution'} onClick={() => setTab('resolution')}>
              ⚡ Konfliktauflösung ({resolutions.length})
            </PortalTab>
          )}
        </nav>

        <div className="flex min-h-0 flex-1">
          {/* Mitte/links: Tab-Inhalt */}
          <div className="min-w-0 flex-1 overflow-hidden">
            {tab === 'files' && (
              <div className="flex h-full">
                <ul className="w-72 shrink-0 overflow-y-auto border-r border-zinc-800 p-2">
                  {summary?.files.map((f) => {
                    const fileCommentCount = comments.filter((c) => c.filePath === f.path && c.status === 'open').length;
                    return (
                      <li key={f.path}>
                        <button
                          onClick={() => setSelectedFile(f.path)}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                            selectedFile === f.path ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'
                          }`}
                        >
                          <span className="truncate">{f.path}</span>
                          {fileCommentCount > 0 && <span title={`${fileCommentCount} offene(r) Kommentar(e)`}>💬</span>}
                          <span className="ml-auto whitespace-nowrap">
                            <span className="text-emerald-500">+{f.additions}</span>{' '}
                            <span className="text-red-500">−{f.deletions}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {summary && summary.files.length === 0 && (
                    <li className="px-2 py-4 text-xs text-zinc-600">
                      Keine Änderungen gegen {project?.defaultBranch}.
                    </li>
                  )}
                </ul>
                <div className="min-w-0 flex-1 overflow-auto p-3">
                  {selectedFile ? (
                    <DiffViewer
                      diff={fileDiff}
                      filePath={selectedFile}
                      comments={comments}
                      jumpTo={jumpTo}
                      /* Kommentieren ist betrachtend (FR-007) und in jedem Zustand möglich —
                         auch in der Vorschau eines Features, das noch in Entwicklung ist. */
                      onAddComment={(anchor, text) =>
                        void api
                          .addComment(featureId, {
                            filePath: selectedFile,
                            line: anchor.line,
                            side: anchor.side,
                            text,
                          })
                          .then(refreshComments)
                          .catch(fail)
                      }
                    />
                  ) : (
                    <p className="p-4 text-sm text-zinc-600">Datei links auswählen.</p>
                  )}
                </div>
              </div>
            )}

            {tab === 'commits' && (
              <ul className="h-full space-y-1 overflow-y-auto p-4">
                {summary?.commits.map((c) => (
                  <li key={c.sha} className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <code className="text-xs text-zinc-500">{c.sha.slice(0, 8)}</code>
                    <span className="text-sm text-zinc-300">{c.subject}</span>
                    <span className="ml-auto text-xs text-zinc-600">{new Date(c.date).toLocaleString('de-CH')}</span>
                  </li>
                ))}
              </ul>
            )}

            {tab === 'tree' && (
              <div className="flex h-full">
                <div className="w-72 shrink-0 overflow-y-auto border-r border-zinc-800">
                  <FileTreePane files={treeFiles ?? []} selected={treeSelected} onSelect={setTreeSelected} />
                </div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  {treeSelected ? (
                    <FileEditor featureId={featureId} path={treeSelected} editable={!!reviewable} onError={fail} />
                  ) : (
                    <p className="p-4 text-sm text-zinc-600">
                      Datei links auswählen. Gespeicherte Änderungen werden beim Freigeben als
                      Reviewer-Korrektur committet und erzwingen eine Re-Verifikation.
                    </p>
                  )}
                </div>
              </div>
            )}

            {tab === 'tests' && (
              <TestsPane featureId={featureId} verificationConfigured={verificationConfigured} onError={fail} />
            )}
            {tab === 'resolution' && <ResolutionView resolutions={resolutions} />}
          </div>

          {/* Rechts: Audits + Kommentare */}
          <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-800">
            <div className="min-h-0 flex-1 overflow-y-auto border-b border-zinc-800">
              <AuditSidebar featureId={featureId} runs={runs} />
            </div>
            <div className="flex max-h-[45%] min-h-0 flex-col">
              <CommentsPanel
                featureId={featureId}
                comments={comments}
                onChanged={() => void refreshComments()}
                onJump={jumpToComment}
                onError={fail}
              />
            </div>
          </aside>
        </div>

        <footer className="border-t border-zinc-800 px-4 py-2.5">
          <ActionGroup
            reason={blockedReason(approveVerdict, rejectV, retryV)}
            actionsClassName="flex items-center gap-3"
          >
            {approveV?.availability !== 'hidden' && project && (
              <MergeTargetChooser
                projectId={project.id}
                featureName={feature.name}
                featureBranch={feature.branch}
                defaultBranch={project.defaultBranch}
                onChange={setTarget}
                onError={fail}
              />
            )}
            {/* Vorschau statt technischer Zustandsmeldung (FR-019). */}
            {approveV?.availability === 'hidden' && (
              <span className="text-xs text-zinc-500">
                {feature.integration === 'merged'
                  ? 'Bereits integriert.'
                  : feature.integration === 'none'
                    ? 'Vorschau — dieses Feature ist noch nicht in der Integration.'
                    : approveV.reason}
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              {retryV && (
                <ActionButton
                  verdict={retryV}
                  onClick={() =>
                    run(`retry:${featureId}`, () => api.retryIntegration(featureId).then(onClose))
                  }
                  className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  ↻ Integration erneut anstoßen
                </ActionButton>
              )}
              {rejectV && (
                <ActionButton
                  verdict={rejectV}
                  onClick={() => setShowReject(true)}
                  className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  ✗ Zurückweisen{openComments.length > 0 && ` (${openComments.length} Kommentare)`}
                </ActionButton>
              )}
              {approveVerdict && (
                <ActionButton
                  verdict={approveVerdict}
                  onClick={approve}
                  className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-emerald-600"
                >
                  ✓ Freigeben & Integrieren
                </ActionButton>
              )}
            </span>
          </ActionGroup>
        </footer>
      </div>

      {showReject && (
        <Dialog title="Zurückweisen mit Feedback" onClose={() => setShowReject(false)}>
          {openComments.length > 0 && (
            <div className="mb-2 max-h-40 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-2">
              <p className="mb-1 text-[10px] tracking-wide text-zinc-500 uppercase">
                Geht mit — {openComments.length} offene(r) Kommentar(e):
              </p>
              <ul className="space-y-0.5 text-xs text-zinc-400">
                {openComments.map((c) => (
                  <li key={c.id} className="truncate">
                    <span className="font-mono text-[10px] text-sky-500">
                      {c.filePath ? `${c.filePath}${c.line !== null ? `:${c.line}` : ''}` : 'Allgemein'}
                    </span>{' '}
                    {c.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="relative">
            <textarea
              autoFocus
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="Zusätzliche Anmerkung (optional) — Kommentare + Text gehen als strukturierter Auftrag in die Feature-Konsole."
              rows={4}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 pr-10 text-sm text-zinc-200 outline-none focus:border-zinc-500"
            />
            <div className="absolute top-1.5 right-1.5">
              <VoiceButton onText={(t) => setRejectComment((cur) => cur + t)} />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setShowReject(false)}
              className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
            >
              Abbrechen
            </button>
            <button
              disabled={busy}
              onClick={reject}
              className="rounded bg-red-800 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-red-700 disabled:opacity-40"
            >
              Zurückweisen
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** `warn` (amber) für Sachverhalte, die Aufmerksamkeit brauchen, ohne rot zu sein. */
const STAT_TONE = {
  ok: 'text-emerald-400',
  bad: 'text-red-400',
  warn: 'text-amber-400',
} as const;

function HeaderStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: keyof typeof STAT_TONE | undefined;
}) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-zinc-600">{label}</span>
      <span className={tone ? STAT_TONE[tone] : 'text-zinc-300'}>{value}</span>
    </span>
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

/** Zeilenbasierter Roh-Diff (Konfliktauflösung pre/post). */
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
