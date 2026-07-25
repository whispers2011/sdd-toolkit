import { useEffect, useMemo, useState } from 'react';
import type { FeatureArtifact, FeatureArtifactStep, FeaturePhase } from '@sdd/shared';
import { api, SaveConflictError } from '../api.js';
import { useStore } from '../store.js';
import { ConfirmDialog } from './Sidebar.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { MarkdownView } from './MarkdownView.js';
import { TerminalPane } from './TerminalPane.js';
import { EditIcon, CloseIcon, ChatIcon, EntryIcon, RESULT_ICONS } from './icons.js';

/** Ein navigierbares Dokument: ein Schritt kann mehrere Dateien haben (z. B. plan + contracts). */
interface DocRef {
  phase: FeaturePhase;
  fileId: string;
  stepLabel: string;
  fileLabel: string;
}

/**
 * Modal zum Einsehen/Bearbeiten der Speckit-Artefakte eines Features. Alle Artefakte des
 * Features sind über eine Seitenleiste direkt erreichbar — Lesen, wechseln, weiterlesen,
 * ohne den Dialog zwischendurch zu schließen (auch per ⌥↑/⌥↓). Anzeige rendert Markdown
 * lesbar (Frontmatter separat), der Editor bleibt WYSIWYG; Speichern ist konflikt- und
 * sperr-geschützt. Optional als Split-Screen neben der Feature-Konsole.
 */
export function FeatureResultDialog({
  featureId,
  featureName,
  phase: initialPhase,
  phaseLabel,
  onClose,
}: {
  featureId: string;
  featureName: string;
  /** Artefakt, mit dem der Dialog öffnet — danach frei navigierbar. */
  phase: FeaturePhase;
  phaseLabel: string;
  onClose: () => void;
}) {
  const { state } = useStore();
  // Abgeschlossen (gemergt/archiviert) → keine lebende Session mehr, Split-Screen wäre leer/tot.
  const feature = state.app?.features.find((f) => f.id === featureId);
  const completed = !!feature && (feature.integration === 'merged' || !!feature.archivedAt);

  const [steps, setSteps] = useState<FeatureArtifactStep[]>([]);
  const [phase, setPhase] = useState<FeaturePhase>(initialPhase);
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
  const [discardIntent, setDiscardIntent] = useState<'close' | 'exit-edit' | 'switch' | null>(null);
  const [pending, setPending] = useState<{ phase: FeaturePhase; fileId?: string } | null>(null);
  const [split, setSplit] = useState(false);

  const dirty = editing && art?.content != null && draft !== art.content;

  // Alle Artefakte des Features — Grundlage der Seitenleiste und der Tastatur-Navigation.
  useEffect(() => {
    let cancelled = false;
    api
      .featureArtifacts(featureId)
      .then((s) => !cancelled && setSteps(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [featureId]);

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

  /** Flache Reihenfolge aller vorhandenen Dokumente — „das nächste Artefakt" ist eindeutig. */
  const docs = useMemo<DocRef[]>(
    () =>
      steps
        .filter((s) => s.available)
        .flatMap((s) =>
          s.files.map((f) => ({ phase: s.phase, fileId: f.id, stepLabel: s.label, fileLabel: f.label })),
        ),
    [steps],
  );

  const currentFileId = art?.fileId ?? fileId;
  const currentIndex = docs.findIndex((d) => d.phase === phase && d.fileId === currentFileId);

  const switchTo = (nextPhase: FeaturePhase, nextFileId?: string) => {
    if (nextPhase === phase && (nextFileId ?? undefined) === (currentFileId ?? undefined)) return;
    if (dirty) {
      setPending({ phase: nextPhase, ...(nextFileId ? { fileId: nextFileId } : {}) });
      setDiscardIntent('switch');
      return;
    }
    setPhase(nextPhase);
    setFileId(nextFileId);
  };

  const step = (delta: number) => {
    if (docs.length === 0) return;
    // Vor dem ersten Laden ist der Index -1 → von vorn bzw. von hinten einsteigen.
    const base = currentIndex === -1 ? (delta > 0 ? -1 : 0) : currentIndex;
    const next = docs[(base + delta + docs.length) % docs.length];
    if (next) switchTo(next.phase, next.fileId);
  };

  const requestClose = () => {
    if (dirty) setDiscardIntent('close');
    else onClose();
  };

  // Tastatur: ⌥↑/⌥↓ blättert durch die Artefakte, Escape schließt. Alt-Kombination, damit
  // blanke Pfeiltasten weiterhin im Text navigieren.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !discardIntent && !conflict) {
        e.preventDefault();
        requestClose();
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
  const stepLabel = steps.find((s) => s.phase === phase)?.label ?? phaseLabel;
  const fileLabel = art?.files.find((f) => f.id === currentFileId)?.label ?? null;
  const multiFile = (art?.files.length ?? 0) > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className={`flex h-full w-full ${split && !completed ? 'max-w-[100rem]' : 'max-w-6xl'} gap-3`}>
        {/* Modal-Panel */}
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
          {/* Artefakt-Navigation: alle Ergebnisse des Features auf einen Blick */}
          <nav className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/40">
            <div className="border-b border-zinc-800 px-3 py-2">
              <div className="truncate text-xs font-semibold text-zinc-300" title={featureName}>
                {featureName}
              </div>
              <div className="text-[10px] text-zinc-600">
                {docs.length} Artefakt{docs.length === 1 ? '' : 'e'} · ⌥↑ / ⌥↓
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {steps.map((s) => {
                const Icon = RESULT_ICONS[s.phase] ?? EntryIcon;
                const active = s.phase === phase;
                return (
                  <div key={s.phase}>
                    <button
                      disabled={!s.available}
                      onClick={() => switchTo(s.phase)}
                      title={s.available ? s.tooltip : `${s.label}: noch kein Ergebnis`}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                        !s.available
                          ? 'cursor-default text-zinc-700'
                          : active
                            ? 'bg-zinc-800 font-medium text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                      }`}
                    >
                      <Icon className="shrink-0 text-[15px]" />
                      <span className="truncate">{s.label}</span>
                      {s.available && s.files.length > 1 && (
                        <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{s.files.length}</span>
                      )}
                    </button>
                    {/* Geschwister-Dateien des aktiven Schritts direkt anspringbar */}
                    {active && s.available && s.files.length > 1 && (
                      <div className="mb-1 ml-[1.4rem] border-l border-zinc-800">
                        {s.files.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => switchTo(s.phase, f.id)}
                            title={f.relPath}
                            className={`block w-full truncate py-1 pr-2 pl-2.5 text-left text-[11px] ${
                              f.id === currentFileId
                                ? 'text-emerald-400'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
              <h2 className="truncate text-sm font-semibold text-zinc-100">
                {stepLabel}
                {multiFile && fileLabel && <span className="text-zinc-500"> · {fileLabel}</span>}
              </h2>
              {currentIndex >= 0 && docs.length > 1 && (
                <span className="shrink-0 text-xs text-zinc-600">
                  {currentIndex + 1}/{docs.length}
                </span>
              )}
              {saved && <span className="text-xs text-emerald-400">Gespeichert ✓</span>}
              <div className="ml-auto flex items-center gap-1">
                {docs.length > 1 && (
                  <>
                    <button
                      onClick={() => step(-1)}
                      title="Vorheriges Artefakt (⌥↑)"
                      className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => step(1)}
                      title="Nächstes Artefakt (⌥↓)"
                      className="mr-1 rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      ↓
                    </button>
                  </>
                )}
                {!completed && (
                  <button
                    onClick={() => setSplit((s) => !s)}
                    title="Claude-Session als Split-Screen"
                    className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                      split ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    <ChatIcon /> Split-Screen
                  </button>
                )}
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
                  title="Schließen (Esc)"
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

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {loading && <p className="text-sm text-zinc-500">Lädt …</p>}
              {loadError && <p className="text-sm text-red-400">Fehler: {loadError}</p>}
              {!loading && !loadError && art && !art.exists && (
                <p className="text-sm text-zinc-500">Für diesen Schritt existiert noch kein Ergebnis in diesem Feature.</p>
              )}
              {!loading && !loadError && art?.exists && !editing && (
                <MarkdownView markdown={art.content ?? ''} />
              )}
              {!loading && !loadError && art?.exists && editing && (
                <MarkdownEditor key={art.fileId} value={draft} readOnly={false} onChange={setDraft} />
              )}
            </div>

            {editing && (
              <footer className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
                {saveError && <span className="text-xs text-red-400">Fehler: {saveError}</span>}
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => (dirty ? setDiscardIntent('exit-edit') : setEditing(false))}
                    className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
                  >
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
        </div>

        {/* Split-Screen: bestehende Feature-Konsole (nur bei laufendem, nicht abgeschlossenem Feature) */}
        {split && !completed && (
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
            const target = pending;
            setDiscardIntent(null);
            setPending(null);
            setEditing(false);
            setDraft(art?.content ?? '');
            if (intent === 'close') onClose();
            else if (intent === 'switch' && target) {
              setPhase(target.phase);
              setFileId(target.fileId);
            }
          }}
          onClose={() => {
            setDiscardIntent(null);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}
