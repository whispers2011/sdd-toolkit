import { useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FeaturePhase, PhaseDefinition } from '@sdd/shared';
import { api, SaveConflictError } from '../api.js';
import { ConfirmDialog } from './Sidebar.js';

/** Styling der gerenderten Markdown-Elemente (kein Typography-Plugin vorhanden). */
const MD: Components = {
  h1: (p) => <h1 className="mt-4 mb-2 text-lg font-semibold text-zinc-100" {...p} />,
  h2: (p) => <h2 className="mt-4 mb-2 text-base font-semibold text-zinc-100" {...p} />,
  h3: (p) => <h3 className="mt-3 mb-1 text-sm font-semibold text-zinc-200" {...p} />,
  p: (p) => <p className="my-2 text-sm leading-relaxed text-zinc-300" {...p} />,
  ul: (p) => <ul className="my-2 ml-5 list-disc space-y-1 text-sm text-zinc-300" {...p} />,
  ol: (p) => <ol className="my-2 ml-5 list-decimal space-y-1 text-sm text-zinc-300" {...p} />,
  li: (p) => <li className="text-sm text-zinc-300" {...p} />,
  a: (p) => <a className="text-emerald-400 hover:underline" {...p} />,
  code: (p) => <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-zinc-200" {...p} />,
  pre: (p) => <pre className="my-2 overflow-x-auto rounded bg-zinc-800 p-3 text-xs text-zinc-200" {...p} />,
  blockquote: (p) => <blockquote className="my-2 border-l-2 border-zinc-700 pl-3 text-sm text-zinc-400" {...p} />,
  table: (p) => <table className="my-2 w-full border-collapse text-xs text-zinc-300" {...p} />,
  th: (p) => <th className="border border-zinc-700 px-2 py-1 text-left font-semibold" {...p} />,
  td: (p) => <td className="border border-zinc-700 px-2 py-1" {...p} />,
};

/**
 * Führendes YAML-Frontmatter (`---\n…\n---`) abtrennen. ReactMarkdown würde es
 * sonst als riesige Setext-H2 rendern (die vorletzte `---`-Zeile macht den Block
 * davor zur Überschrift) — schwer lesbarer Einstieg. Hier separat behandelt.
 */
function splitFrontmatter(md: string): { meta: string | null; body: string } {
  const m = md.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!m) return { meta: null, body: md };
  return { meta: m[1] ?? '', body: md.slice(m[0].length) };
}

/** Frontmatter als kompakte, lesbare Metadaten-Liste (statt roher Textblock). */
function Frontmatter({ text }: { text: string }) {
  const rows = text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const indent = line.length - line.trimStart().length;
      const m = line.trim().match(/^([^:]+):\s*(.*)$/);
      const key = (m?.[1] ?? line.trim()).trim();
      const value = (m?.[2] ?? '').trim().replace(/^["']|["']$/g, '');
      return { indent, key, value };
    });
  return (
    <div className="mb-4 rounded border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Metadaten</div>
      <dl className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap gap-x-2 text-xs" style={{ paddingLeft: r.indent * 10 }}>
            <dt className="shrink-0 text-zinc-500">{r.key}</dt>
            {r.value && <dd className="min-w-0 text-zinc-300">{r.value}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

export function PhaseDefinitionDialog({
  phase,
  phaseLabel,
  projects,
  initialProjectId,
  onClose,
  variant = 'modal',
}: {
  phase: FeaturePhase;
  phaseLabel: string;
  projects: { id: string; name: string }[];
  initialProjectId: string;
  onClose: () => void;
  /** 'modal' = überlagerndes Dialogfenster (Default); 'panel' = eingebettet (Split-Screen). */
  variant?: 'modal' | 'panel';
}) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const [def, setDef] = useState<PhaseDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState<{ content: string; mtimeMs: number } | null>(null);
  const [discardIntent, setDiscardIntent] = useState<'close' | 'exit-edit' | null>(null);

  const dirty = editing && def?.content != null && draft !== def.content;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setEditing(false);
    setSaveError(null);
    setConflict(null);
    api
      .phaseDefinition(projectId, phase)
      .then((d) => {
        if (cancelled) return;
        setDef(d);
        setDraft(d.content ?? '');
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, phase]);

  const requestClose = () => {
    if (dirty) setDiscardIntent('close');
    else onClose();
  };

  const cancelEdit = () => {
    if (dirty) setDiscardIntent('exit-edit');
    else setEditing(false);
  };

  const doSave = async (overwrite: boolean, baseMtimeMs: number) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.savePhaseDefinition(projectId, phase, { content: draft, baseMtimeMs, overwrite });
      setDef((prev) => (prev ? { ...prev, content: draft, mtimeMs: res.mtimeMs } : prev));
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

  const canEdit = !!def?.exists && !def.locked;

  return (
    <div
      className={
        variant === 'panel'
          ? 'flex h-full flex-col'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6'
      }
      onClick={
        variant === 'panel'
          ? undefined
          : (e) => {
              if (e.target === e.currentTarget) requestClose();
            }
      }
    >
      <div
        className={
          variant === 'panel'
            ? 'flex h-full w-full flex-col border-l border-zinc-800 bg-zinc-900'
            : 'flex h-full w-full max-w-4xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl'
        }
      >
        <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Schritt: {phaseLabel}</h2>
          {projects.length > 1 && (
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {saved && <span className="text-xs text-emerald-400">Gespeichert ✓</span>}
          <div className="ml-auto flex items-center gap-2">
            {def?.exists && (
              <button
                onClick={() => void api.openPhaseDefinitionInEditor(projectId, phase).catch(() => {})}
                className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                title="Definitionsdatei im externen Editor öffnen"
              >
                Im Editor öffnen
              </button>
            )}
            {!editing && canEdit && (
              <button
                onClick={() => {
                  setDraft(def?.content ?? '');
                  setEditing(true);
                }}
                className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-600"
              >
                Bearbeiten
              </button>
            )}
            <button onClick={requestClose} className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800">
              ✕
            </button>
          </div>
        </header>

        {def?.locked && (
          <div className="border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-xs text-amber-300">
            Bearbeiten gesperrt: {def.lockReason ?? 'Ein Agent führt diesen Schritt gerade aus.'}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && <p className="text-sm text-zinc-500">Lädt …</p>}
          {loadError && <p className="text-sm text-red-400">Fehler: {loadError}</p>}
          {!loading && !loadError && def && !def.exists && (
            <p className="text-sm text-zinc-500">
              Für diesen Schritt existiert keine spec-kit-Definition in diesem Projekt.
            </p>
          )}
          {!loading && !loadError && def?.exists && !editing && (() => {
            const { meta, body } = splitFrontmatter(def.content ?? '');
            return (
              <div className="max-w-none">
                {meta && <Frontmatter text={meta} />}
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
                  {body}
                </ReactMarkdown>
              </div>
            );
          })()}
          {editing && (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="h-full min-h-[24rem] w-full resize-none rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          )}
        </div>

        {editing && (
          <footer className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
            {saveError && <span className="text-xs text-red-400">Fehler: {saveError}</span>}
            <div className="ml-auto flex gap-2">
              <button
                onClick={cancelEdit}
                className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
              >
                Abbrechen
              </button>
              <button
                onClick={() => void doSave(false, def?.mtimeMs ?? 0)}
                disabled={saving || !dirty}
                className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-emerald-600 disabled:opacity-50"
              >
                {saving ? 'Speichert …' : 'Speichern'}
              </button>
            </div>
          </footer>
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
            // „Abbrechen" im Konfliktdialog = Neu laden/Verwerfen
            setDef((prev) => (prev ? { ...prev, content: conflict.content, mtimeMs: conflict.mtimeMs } : prev));
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
            setDraft(def?.content ?? '');
            if (intent === 'close') onClose();
          }}
          onClose={() => setDiscardIntent(null)}
        />
      )}
    </div>
  );
}
