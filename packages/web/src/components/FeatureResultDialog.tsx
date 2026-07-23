import { useEffect, useState } from 'react';
import type { FeatureArtifact, FeaturePhase } from '@sdd/shared';
import { api, SaveConflictError } from '../api.js';
import { ConfirmDialog } from './Sidebar.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { TerminalPane } from './TerminalPane.js';
import { EditIcon, CloseIcon, ChatIcon } from './icons.js';

/**
 * Modal zum Einsehen/Bearbeiten eines Speckit-Zwischenresultats eines Features.
 * Anzeige und Editor sind WYSIWYG (kein Markdown-Quelltext); Speichern ist konflikt-
 * und sperr-geschützt. Optional als Split-Screen neben der Feature-Konsole.
 */
export function FeatureResultDialog({
  featureId,
  featureName,
  phase,
  phaseLabel,
  onClose,
}: {
  featureId: string;
  featureName: string;
  phase: FeaturePhase;
  phaseLabel: string;
  onClose: () => void;
}) {
  const [fileId, setFileId] = useState<string | undefined>(undefined);
  const [art, setArt] = useState<FeatureArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState<{ content: string; mtimeMs: number } | null>(null);
  const [discardIntent, setDiscardIntent] = useState<'close' | 'exit-edit' | 'switch-file' | null>(null);
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  const [split, setSplit] = useState(false);

  const dirty = editing && art?.content != null && draft !== art.content;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setEditing(false);
    setSaveError(null);
    setConflict(null);
    api
      .featureArtifact(featureId, phase, fileId)
      .then((a) => {
        if (cancelled) return;
        setArt(a);
        setDraft(a.content ?? '');
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [featureId, phase, fileId]);

  const requestClose = () => {
    if (dirty) setDiscardIntent('close');
    else onClose();
  };

  const cancelEdit = () => {
    if (dirty) setDiscardIntent('exit-edit');
    else setEditing(false);
  };

  const switchFile = (id: string) => {
    if (id === (art?.fileId ?? fileId)) return;
    if (dirty) {
      setPendingFile(id);
      setDiscardIntent('switch-file');
    } else {
      setFileId(id);
    }
  };

  const doSave = async (overwrite: boolean, baseMtimeMs: number) => {
    if (!art) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.saveFeatureArtifact(featureId, phase, art.fileId, {
        content: draft,
        baseMtimeMs,
        overwrite,
      });
      setArt((prev) => (prev ? { ...prev, content: draft, mtimeMs: res.mtimeMs } : prev));
      setConflict(null);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      if (e instanceof SaveConflictError) setConflict(e.current);
      else setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const canEdit = !!art?.exists && !art.locked;
  const files = art?.files ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className={`flex h-full w-full ${split ? 'max-w-7xl' : 'max-w-4xl'} gap-3`}>
        {/* Modal-Panel */}
        <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
          <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
            <h2 className="truncate text-sm font-semibold text-zinc-100">
              {featureName} · {phaseLabel}
            </h2>
            {files.length > 1 && (
              <select
                value={art?.fileId ?? ''}
                onChange={(e) => switchFile(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              >
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}
            {saved && <span className="text-xs text-emerald-400">Gespeichert ✓</span>}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setSplit((s) => !s)}
                title="Claude-Session als Split-Screen"
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                  split ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                <ChatIcon /> Split-Screen
              </button>
              {!editing && canEdit && (
                <button
                  onClick={() => {
                    setDraft(art?.content ?? '');
                    setEditing(true);
                  }}
                  className="flex items-center gap-1 rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-600"
                >
                  <EditIcon /> Bearbeiten
                </button>
              )}
              <button
                onClick={requestClose}
                title="Schließen"
                className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800"
              >
                <CloseIcon />
              </button>
            </div>
          </header>

          {art?.locked && (
            <div className="border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-xs text-amber-300">
              Bearbeiten gesperrt: {art.lockReason ?? 'Ein Agent entwickelt dieses Feature gerade.'} — Einsehen bleibt möglich.
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {loading && <p className="text-sm text-zinc-500">Lädt …</p>}
            {loadError && <p className="text-sm text-red-400">Fehler: {loadError}</p>}
            {!loading && !loadError && art && !art.exists && (
              <p className="text-sm text-zinc-500">Für diesen Schritt existiert noch kein Ergebnis in diesem Feature.</p>
            )}
            {!loading && !loadError && art?.exists && (
              <MarkdownEditor
                key={`${art.fileId}:${editing ? 'edit' : 'view'}`}
                value={editing ? draft : art.content ?? ''}
                readOnly={!editing}
                onChange={setDraft}
              />
            )}
          </div>

          {editing && (
            <footer className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
              {saveError && <span className="text-xs text-red-400">Fehler: {saveError}</span>}
              <div className="ml-auto flex gap-2">
                <button onClick={cancelEdit} className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">
                  Abbrechen
                </button>
                <button
                  onClick={() => void doSave(false, art?.mtimeMs ?? 0)}
                  disabled={saving || !dirty}
                  className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {saving ? 'Speichert …' : 'Speichern'}
                </button>
              </div>
            </footer>
          )}
        </div>

        {/* Split-Screen: bestehende Feature-Konsole */}
        {split && (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-[#09090b] shadow-2xl">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
              Claude-Session · {featureName}
              <button
                onClick={() => setSplit(false)}
                title="Split-Screen schließen"
                className="ml-auto rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="min-h-0 flex-1 p-2">
              <TerminalPane key={featureId} featureId={featureId} focused />
            </div>
          </div>
        )}
      </div>

      {conflict && (
        <ConfirmDialog
          title="Konflikt beim Speichern"
          message={
            'Die Datei wurde seit dem Öffnen extern geändert (z. B. durch einen Agenten).\n\n' +
            '„Überschreiben" ersetzt die externe Version mit deinen Änderungen.\n' +
            '„Neu laden" verwirft deine Änderungen und übernimmt die externe Version.'
          }
          confirmLabel="Überschreiben"
          onConfirm={() => void doSave(true, conflict.mtimeMs)}
          onClose={() => {
            setArt((prev) => (prev ? { ...prev, content: conflict.content, mtimeMs: conflict.mtimeMs } : prev));
            setDraft(conflict.content);
            setConflict(null);
          }}
        />
      )}

      {discardIntent && (
        <ConfirmDialog
          title="Ungespeicherte Änderungen"
          message="Es gibt ungespeicherte Änderungen. Wirklich verwerfen?"
          confirmLabel="Verwerfen"
          onConfirm={() => {
            const intent = discardIntent;
            setDiscardIntent(null);
            setEditing(false);
            setDraft(art?.content ?? '');
            if (intent === 'close') onClose();
            else if (intent === 'switch-file' && pendingFile) {
              setFileId(pendingFile);
              setPendingFile(null);
            }
          }}
          onClose={() => {
            setDiscardIntent(null);
            setPendingFile(null);
          }}
        />
      )}
    </div>
  );
}
