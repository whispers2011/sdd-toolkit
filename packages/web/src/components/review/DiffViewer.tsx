import { useEffect, useMemo, useRef, useState } from 'react';
import { parseUnifiedDiff, type DiffLine } from '@sdd/shared';
import type { ReviewComment } from '@sdd/shared';
import { VoiceButton } from '../VoiceButton.js';

export interface CommentAnchor {
  line: number;
  side: 'old' | 'new';
}

/**
 * Zeilennummerierter Diff-Renderer (alt/neu) mit Kommentar-Gutter: Klick auf
 * „+" öffnet ein Inline-Formular, bestehende Kommentare erscheinen unter ihrer
 * verankerten Zeile. `jumpTo` scrollt zum Anker (Kommentar-Panel-Sprung).
 */
export function DiffViewer({
  diff,
  filePath,
  comments,
  onAddComment,
  jumpTo,
}: {
  diff: string;
  filePath: string;
  comments: ReviewComment[];
  onAddComment?: ((anchor: CommentAnchor, text: string) => void) | undefined;
  jumpTo?: { line: number; side: 'old' | 'new'; ts: number } | null | undefined;
}) {
  const [draftAnchor, setDraftAnchor] = useState<CommentAnchor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);

  const fileComments = comments.filter((c) => c.filePath === filePath && c.line !== null);
  const commentsAt = (line: DiffLine): ReviewComment[] =>
    fileComments.filter((c) =>
      c.side === 'old' ? c.line === line.oldNo && line.oldNo !== null : c.line === line.newNo && line.newNo !== null,
    );

  useEffect(() => {
    if (!jumpTo || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-anchor="${jumpTo.side}:${jumpTo.line}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('ring-1', 'ring-sky-500');
    const t = setTimeout(() => el?.classList.remove('ring-1', 'ring-sky-500'), 2000);
    return () => clearTimeout(t);
  }, [jumpTo]);

  if (!diff) return <p className="p-4 text-sm text-zinc-400">Lade Diff …</p>;
  if (files.length === 0) return <p className="p-4 text-sm text-zinc-400">Kein Diff für diese Datei.</p>;

  return (
    <div ref={containerRef} className="overflow-x-auto rounded border border-zinc-800 bg-zinc-950 font-mono text-xs leading-5">
      {files.map((file) =>
        file.binary ? (
          <p key={file.newPath} className="p-4 text-zinc-400">
            Binärdatei — kein Text-Diff.
          </p>
        ) : (
          <table key={file.newPath} className="w-full border-collapse">
            <tbody>
              {file.hunks.map((hunk, hi) => (
                <HunkRows
                  key={hi}
                  hunk={hunk}
                  commentsAt={commentsAt}
                  canComment={!!onAddComment}
                  draftAnchor={draftAnchor}
                  onOpenDraft={setDraftAnchor}
                  onSubmit={(anchor, text) => {
                    onAddComment?.(anchor, text);
                    setDraftAnchor(null);
                  }}
                  onCancel={() => setDraftAnchor(null)}
                />
              ))}
            </tbody>
          </table>
        ),
      )}
    </div>
  );
}

function HunkRows({
  hunk,
  commentsAt,
  canComment,
  draftAnchor,
  onOpenDraft,
  onSubmit,
  onCancel,
}: {
  hunk: ReturnType<typeof parseUnifiedDiff>[number]['hunks'][number];
  commentsAt: (line: DiffLine) => ReviewComment[];
  canComment: boolean;
  draftAnchor: CommentAnchor | null;
  onOpenDraft: (a: CommentAnchor) => void;
  onSubmit: (a: CommentAnchor, text: string) => void;
  onCancel: () => void;
}) {
  const anchorOf = (line: DiffLine): CommentAnchor | null =>
    line.newNo !== null
      ? { line: line.newNo, side: 'new' }
      : line.oldNo !== null
        ? { line: line.oldNo, side: 'old' }
        : null;

  return (
    <>
      <tr>
        <td colSpan={4} className="bg-zinc-900/70 px-2 py-0.5 text-sky-400">
          {hunk.header}
        </td>
      </tr>
      {hunk.lines.map((line, li) => {
        const anchor = anchorOf(line);
        const lineComments = commentsAt(line);
        const rowCls =
          line.kind === 'add'
            ? 'bg-emerald-950/60 text-emerald-300'
            : line.kind === 'del'
              ? 'bg-red-950/50 text-red-300'
              : 'text-zinc-400';
        const isDraftHere =
          draftAnchor && anchor && draftAnchor.line === anchor.line && draftAnchor.side === anchor.side;
        return (
          <FragmentRows key={li}>
            <tr className="group" data-anchor={anchor ? `${anchor.side}:${anchor.line}` : undefined}>
              {/* Zeilennummern: Stufe 500 statt 600 — 600 messt 2.57:1 und verfehlt
                  damit selbst das 3:1-Soll fuer nicht-tragende Schrift (FR-013). */}
              <td className="w-10 select-none border-r border-zinc-800/60 px-1 text-right text-zinc-500">
                {line.oldNo ?? ''}
              </td>
              <td className="w-10 select-none border-r border-zinc-800/60 px-1 text-right text-zinc-500">
                {line.newNo ?? ''}
              </td>
              <td className="w-5 select-none text-center">
                {canComment && anchor && (
                  <button
                    onClick={() => onOpenDraft(anchor)}
                    className="hidden rounded bg-sky-800 px-1 text-[10px] text-sky-100 group-hover:inline-block"
                    title="Kommentar an dieser Zeile"
                  >
                    +
                  </button>
                )}
                {lineComments.length > 0 && <span title={`${lineComments.length} Kommentar(e)`}>💬</span>}
              </td>
              <td className={`whitespace-pre px-2 ${rowCls}`}>
                {(line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ') + line.text}
              </td>
            </tr>
            {lineComments.map((c) => (
              <tr key={c.id}>
                <td colSpan={3} />
                <td className="px-2 py-1">
                  <div
                    className={`rounded border px-2 py-1 font-sans text-xs ${
                      c.status === 'resolved'
                        ? 'border-zinc-800 text-zinc-400 line-through'
                        : 'border-sky-900 bg-sky-950/40 text-sky-200'
                    }`}
                  >
                    {c.text}
                  </div>
                </td>
              </tr>
            ))}
            {isDraftHere && anchor && (
              <tr>
                <td colSpan={3} />
                <td className="px-2 py-1">
                  <InlineCommentForm onSubmit={(text) => onSubmit(anchor, text)} onCancel={onCancel} />
                </td>
              </tr>
            )}
          </FragmentRows>
        );
      })}
    </>
  );
}

/** Tabellen-taugliches Fragment (mehrere <tr> pro Diff-Zeile). */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function InlineCommentForm({ onSubmit, onCancel }: { onSubmit: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <div className="rounded border border-sky-900 bg-zinc-925 p-2 font-sans">
      <div className="relative">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Kommentar zu dieser Zeile …"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 pr-9 text-xs text-zinc-200 outline-none focus:border-zinc-500"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) onSubmit(text.trim());
          }}
        />
        <div className="absolute top-1 right-1">
          <VoiceButton onText={(t) => setText((cur) => cur + t)} />
        </div>
      </div>
      <div className="mt-1 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800">
          Abbrechen
        </button>
        <button
          disabled={!text.trim()}
          onClick={() => onSubmit(text.trim())}
          className="rounded bg-sky-800 px-2 py-0.5 text-xs font-medium text-sky-100 hover:bg-sky-700 disabled:opacity-40"
        >
          Kommentieren
        </button>
      </div>
    </div>
  );
}
