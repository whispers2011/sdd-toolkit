import { useState } from 'react';
import type { ReviewComment } from '@sdd/shared';
import { api } from '../../api.js';
import { VoiceButton } from '../VoiceButton.js';

/**
 * Flache Kommentar-Liste des Features (rechte Portal-Spalte): offen/erledigt,
 * Anker-Sprung in den Diff, Datei-generelle und allgemeine Kommentare anlegen.
 * Anker können nach neuen Commits veralten (v1 akzeptiert) — Hinweis im Kopf.
 */
export function CommentsPanel({
  featureId,
  comments,
  onChanged,
  onJump,
  onError,
}: {
  featureId: string;
  comments: ReviewComment[];
  onChanged: () => void;
  onJump: (c: ReviewComment) => void;
  onError: (e: Error) => void;
}) {
  const [draft, setDraft] = useState('');
  const open = comments.filter((c) => c.status === 'open');
  const resolved = comments.filter((c) => c.status === 'resolved');

  const add = () => {
    if (!draft.trim()) return;
    void api
      .addComment(featureId, { text: draft.trim() })
      .then(() => {
        setDraft('');
        onChanged();
      })
      .catch(onError);
  };
  const setStatus = (c: ReviewComment, status: 'open' | 'resolved') =>
    void api.updateComment(c.id, { status }).then(onChanged).catch(onError);
  const remove = (c: ReviewComment) => void api.deleteComment(c.id).then(onChanged).catch(onError);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
          Kommentare ({open.length})
        </h3>
        {comments.some((c) => c.line !== null) && (
          <span className="text-[10px] text-zinc-400" title="Neue Commits können Zeilen-Anker verschieben.">
            Anker evtl. veraltet
          </span>
        )}
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
        {[...open, ...resolved].map((c) => (
          <li
            key={c.id}
            className={`rounded border px-2 py-1.5 text-xs ${
              c.status === 'resolved' ? 'border-zinc-800/60 text-zinc-400' : 'border-zinc-800 text-zinc-300'
            }`}
          >
            <div className="flex items-center gap-1">
              {c.filePath ? (
                <button
                  onClick={() => onJump(c)}
                  className="truncate font-mono text-[10px] text-sky-300 hover:underline"
                  title="Zum Anker springen"
                >
                  {c.filePath}
                  {c.line !== null && `:${c.line}`}
                  {c.side === 'old' && ' (alt)'}
                </button>
              ) : (
                <span className="text-[10px] text-zinc-400">Allgemein</span>
              )}
              <span className="ml-auto flex shrink-0 gap-1">
                <button
                  onClick={() => setStatus(c, c.status === 'open' ? 'resolved' : 'open')}
                  className="rounded px-1 text-[10px] text-zinc-400 hover:bg-zinc-800"
                  title={c.status === 'open' ? 'Als erledigt markieren' : 'Wieder öffnen'}
                >
                  {c.status === 'open' ? '✓' : '↺'}
                </button>
                <button
                  onClick={() => remove(c)}
                  className="rounded px-1 text-[10px] text-zinc-400 hover:bg-zinc-800"
                  title="Löschen"
                >
                  🗑
                </button>
              </span>
            </div>
            <p className={c.status === 'resolved' ? 'line-through' : ''}>{c.text}</p>
          </li>
        ))}
        {comments.length === 0 && (
          <li className="py-2 text-xs text-zinc-400">
            Noch keine Kommentare. Im Diff auf „+" neben einer Zeile klicken.
          </li>
        )}
      </ul>
      <div className="border-t border-zinc-800 p-2">
        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Allgemeiner Kommentar …"
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 pr-9 text-xs text-zinc-200 outline-none focus:border-zinc-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add();
            }}
          />
          <div className="absolute top-1 right-1">
            <VoiceButton onText={(t) => setDraft((cur) => cur + t)} />
          </div>
        </div>
        <button
          disabled={!draft.trim()}
          onClick={add}
          className="mt-1 w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
        >
          Kommentar hinzufügen
        </button>
      </div>
    </div>
  );
}
