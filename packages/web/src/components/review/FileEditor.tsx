import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, SaveConflictError } from '../../api.js';

/**
 * Portal-Editor für Trivial-Korrekturen: Monospace-Textarea, Markdown-Vorschau,
 * mtime-Konfliktschutz (409 ⇒ Meldung + Neuladen-Option). Speichern nur solange
 * das Feature auf menschliche Prüfung wartet; die Korrektur wird beim Freigeben
 * committet und erzwingt eine Re-Verifikation.
 */
export function FileEditor({
  featureId,
  path,
  editable,
  onError,
}: {
  featureId: string;
  path: string;
  editable: boolean;
  onError: (e: Error) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [baseMtimeMs, setBaseMtimeMs] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const isMarkdown = path.endsWith('.md');

  const load = () => {
    setContent(null);
    setLoadError(null);
    setConflict(false);
    setDirty(false);
    api
      .featureFile(featureId, path)
      .then((f) => {
        setContent(f.content);
        setBaseMtimeMs(f.mtimeMs);
      })
      .catch((e: Error) => setLoadError(e.message));
  };
  useEffect(load, [featureId, path]);

  const save = () => {
    if (content === null) return;
    api
      .saveFeatureFile(featureId, { path, content, baseMtimeMs })
      .then((r) => {
        setBaseMtimeMs(r.mtimeMs);
        setDirty(false);
        setConflict(false);
      })
      .catch((e: Error) => {
        if (e instanceof SaveConflictError) setConflict(true);
        else onError(e);
      });
  };

  if (loadError) {
    return <p className="p-4 text-sm text-amber-400">{loadError}</p>;
  }
  if (content === null) {
    return <p className="p-4 text-sm text-zinc-600">Lade {path} …</p>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <code className="truncate text-xs text-zinc-400">{path}</code>
        {isMarkdown && (
          <button
            onClick={() => setPreview((p) => !p)}
            className={`rounded px-2 py-0.5 text-xs ${preview ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'}`}
          >
            {preview ? 'Text' : 'Vorschau'}
          </button>
        )}
        <span className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-[10px] text-amber-400">ungespeichert</span>}
          <button
            disabled={!editable || !dirty}
            onClick={save}
            className="rounded bg-emerald-800 px-2.5 py-0.5 text-xs font-medium text-emerald-100 hover:bg-emerald-700 disabled:opacity-40"
            title={editable ? 'Speichern (wird beim Freigeben als Reviewer-Korrektur committet)' : 'Nur lesbar — Feature wartet nicht auf Prüfung'}
          >
            Speichern
          </button>
        </span>
      </div>
      {conflict && (
        <div className="flex items-center gap-2 border-b border-amber-900 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
          Datei wurde zwischenzeitlich von anderer Seite geändert — nichts überschrieben.
          <button onClick={load} className="rounded border border-amber-800 px-2 py-0.5 hover:bg-amber-900">
            Neu laden (verwirft meine Änderung)
          </button>
        </div>
      )}
      {preview && isMarkdown ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          value={content}
          readOnly={!editable}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-[#0a0a0c] p-3 font-mono text-xs leading-5 text-zinc-300 outline-none"
        />
      )}
    </div>
  );
}
