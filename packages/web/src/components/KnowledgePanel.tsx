import { useEffect, useState } from 'react';
import type { KnowledgeBundle, KnowledgeEntry, KnowledgeTreeNode } from '@sdd/shared';
import { api, type KnowledgeResponse } from '../api.js';
import { useStore } from '../store.js';
import { ConfirmDialog, Dialog, DialogActions } from './Sidebar.js';

type Editor =
  | { kind: 'bundle'; parentId: string | null; existing?: KnowledgeBundle }
  | { kind: 'entry'; bundleId: string | null; existing?: KnowledgeEntry }
  | { kind: 'import'; bundleId: string | null }
  | null;

/** Verwaltung des projektspezifischen Wissens (CRUD, Verschachtelung, Index). */
export function KnowledgePanel({ projectId }: { projectId: string }) {
  const { state, dispatch } = useStore();
  const [data, setData] = useState<KnowledgeResponse | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [confirm, setConfirm] = useState<{ label: string; message: string; run: () => Promise<unknown> } | null>(null);
  const [showIndex, setShowIndex] = useState(false);
  const version = state.knowledgeVersion[projectId] ?? 0;
  const project = state.app?.projects.find((p) => p.id === projectId);

  const reload = () =>
    api.getKnowledge(projectId).then(setData).catch((e: Error) => dispatch({ type: 'error', message: e.message }));

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, version]);

  const call = (fn: () => Promise<unknown>) =>
    fn().catch((e: Error) => dispatch({ type: 'error', message: e.message }));

  if (!data) return <div className="p-8 text-zinc-500">Lade Wissen …</div>;

  const empty = data.tree.roots.length === 0 && data.tree.looseEntries.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <span className="text-sm font-medium text-zinc-200">Wissen · {project?.name}</span>
        <span className="text-xs text-zinc-600">{data.index.items.length} Elemente</span>
        <div className="ml-auto flex gap-1.5">
          <ToolbarButton onClick={() => setShowIndex((v) => !v)}>{showIndex ? 'Baum' : 'Index'}</ToolbarButton>
          <ToolbarButton onClick={() => setEditor({ kind: 'bundle', parentId: null })}>+ Bundle</ToolbarButton>
          <ToolbarButton onClick={() => setEditor({ kind: 'entry', bundleId: null })}>+ Eintrag</ToolbarButton>
          <ToolbarButton onClick={() => setEditor({ kind: 'import', bundleId: null })}>Datei importieren</ToolbarButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {empty && <p className="py-12 text-center text-sm text-zinc-600">Noch kein Wissen. Lege ein Bundle oder einen Eintrag an.</p>}

        {showIndex ? (
          <IndexView items={data.index.items} />
        ) : (
          <div className="space-y-1">
            {data.tree.roots.map((node) => (
              <BundleNode key={node.bundle.id} node={node} depth={0} onEdit={setEditor} onDelete={setConfirm} />
            ))}
            {data.tree.looseEntries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} depth={0} onEdit={setEditor} onDelete={setConfirm} />
            ))}
          </div>
        )}
      </div>

      {editor?.kind === 'bundle' && (
        <BundleEditor
          projectId={projectId}
          parentId={editor.parentId}
          existing={editor.existing}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.kind === 'entry' && (
        <EntryEditor
          projectId={projectId}
          bundleId={editor.bundleId}
          existing={editor.existing}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.kind === 'import' && (
        <ImportEditor projectId={projectId} bundleId={editor.bundleId} onClose={() => setEditor(null)} />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.label}
          message={confirm.message}
          confirmLabel="Löschen"
          onConfirm={() => void call(confirm.run)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function BundleNode({
  node,
  depth,
  onEdit,
  onDelete,
}: {
  node: KnowledgeTreeNode;
  depth: number;
  onEdit: (e: Editor) => void;
  onDelete: (c: { label: string; message: string; run: () => Promise<unknown> }) => void;
}) {
  const b = node.bundle;
  return (
    <div>
      <div
        className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-900"
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        <span className="text-zinc-500">📦</span>
        <span className="text-sm font-medium text-zinc-200">{b.name}</span>
        <Applicability text={b.applicability.text} tags={b.applicability.tags} />
        <div className="ml-auto hidden gap-1 group-hover:flex">
          <IconBtn title="Unter-Bundle" onClick={() => onEdit({ kind: 'bundle', parentId: b.id })}>+📦</IconBtn>
          <IconBtn title="Eintrag" onClick={() => onEdit({ kind: 'entry', bundleId: b.id })}>+📄</IconBtn>
          <IconBtn title="Bearbeiten" onClick={() => onEdit({ kind: 'bundle', parentId: b.parentId, existing: b })}>✎</IconBtn>
          <IconBtn
            title="Löschen"
            onClick={() =>
              onDelete({
                label: `Bundle „${b.name}" löschen`,
                message: 'Das Bundle samt aller Unter-Bundles und Einträge wird gelöscht.',
                run: () => api.deleteBundle(b.id),
              })
            }
          >
            🗑
          </IconBtn>
        </div>
      </div>
      {node.entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} />
      ))}
      {node.children.map((child) => (
        <BundleNode key={child.bundle.id} node={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}

function EntryRow({
  entry,
  depth,
  onEdit,
  onDelete,
}: {
  entry: KnowledgeEntry;
  depth: number;
  onEdit: (e: Editor) => void;
  onDelete: (c: { label: string; message: string; run: () => Promise<unknown> }) => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-900" style={{ paddingLeft: depth * 16 + 8 }}>
      <span className="text-zinc-600">📄</span>
      <span className="truncate text-sm text-zinc-300">{entry.title}</span>
      {entry.source === 'file' && (
        <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400" title={entry.sourcePath ?? ''}>
          Datei
        </span>
      )}
      <Applicability text={entry.applicability.text} tags={entry.applicability.tags} />
      <div className="ml-auto hidden gap-1 group-hover:flex">
        {entry.source === 'file' && (
          <IconBtn title="Aus Datei neu laden" onClick={() => void api.refreshEntry(entry.id)}>⟳</IconBtn>
        )}
        <IconBtn title="Bearbeiten" onClick={() => onEdit({ kind: 'entry', bundleId: entry.bundleId, existing: entry })}>✎</IconBtn>
        <IconBtn
          title="Löschen"
          onClick={() =>
            onDelete({
              label: `Eintrag „${entry.title}" löschen`,
              message: 'Der Eintrag wird gelöscht.',
              run: () => api.deleteEntry(entry.id),
            })
          }
        >
          🗑
        </IconBtn>
      </div>
    </div>
  );
}

/** Kompakte Index-Projektion: Label + Anwendbarkeit, ohne Inhalte (FR-005). */
function IndexView({ items }: { items: { id: string; kind: 'bundle' | 'entry'; label: string; applicability: { text: string; tags: string[] } }[] }) {
  return (
    <ul className="space-y-0.5 text-sm">
      {items.map((i) => (
        <li key={i.id} className="flex items-center gap-2 rounded px-2 py-1 text-zinc-300">
          <span className="text-zinc-600">{i.kind === 'bundle' ? '📦' : '📄'}</span>
          <span>{i.label}</span>
          <Applicability text={i.applicability.text} tags={i.applicability.tags} />
        </li>
      ))}
    </ul>
  );
}

function Applicability({ text, tags }: { text: string; tags: string[] }) {
  if (!text && tags.length === 0) return <span className="text-xs text-amber-600/70">Anwendbarkeit fehlt</span>;
  return (
    <span className="flex items-center gap-1 truncate text-xs text-zinc-500">
      {text && <span className="truncate">{text}</span>}
      {tags.map((t) => (
        <span key={t} className="rounded bg-zinc-800 px-1 text-[10px] text-sky-400">
          {t}
        </span>
      ))}
    </span>
  );
}

// ---------- Editoren ----------

function BundleEditor({
  projectId,
  parentId,
  existing,
  onClose,
}: {
  projectId: string;
  parentId: string | null;
  existing?: KnowledgeBundle | undefined;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const [name, setName] = useState(existing?.name ?? '');
  const [text, setText] = useState(existing?.applicability.text ?? '');
  const [tags, setTags] = useState((existing?.applicability.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const applicability = { text: text.trim(), tags: parseTags(tags) };
    try {
      if (existing) await api.updateBundle(existing.id, { name: name.trim(), applicability });
      else await api.createBundle(projectId, { parentId, name: name.trim(), applicability });
      onClose();
    } catch (e) {
      dispatch({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={existing ? 'Bundle bearbeiten' : 'Neues Bundle'} onClose={onClose}>
      <TextField label="Name" value={name} onChange={setName} autoFocus />
      <ApplicabilityFields text={text} tags={tags} onText={setText} onTags={setTags} />
      <DialogActions busy={busy} onCancel={onClose} onSubmit={() => void submit()} submitLabel="Speichern" />
    </Dialog>
  );
}

function EntryEditor({
  projectId,
  bundleId,
  existing,
  onClose,
}: {
  projectId: string;
  bundleId: string | null;
  existing?: KnowledgeEntry | undefined;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [text, setText] = useState(existing?.applicability.text ?? '');
  const [tags, setTags] = useState((existing?.applicability.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const isFile = existing?.source === 'file';

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const applicability = { text: text.trim(), tags: parseTags(tags) };
    try {
      if (existing) {
        await api.updateEntry(existing.id, { title: title.trim(), body: isFile ? existing.body : body, applicability });
      } else {
        await api.createEntry(projectId, { bundleId, title: title.trim(), body, applicability });
      }
      onClose();
    } catch (e) {
      dispatch({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={existing ? 'Eintrag bearbeiten' : 'Neuer Eintrag'} onClose={onClose}>
      <TextField label="Titel" value={title} onChange={setTitle} autoFocus />
      <div className="mb-3">
        <label className="mb-1 block text-xs text-zinc-500">Inhalt (Markdown){isFile ? ' — aus Datei, via ⟳ aktualisieren' : ''}</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          disabled={isFile}
          className={`${inputCls} font-mono disabled:opacity-60`}
        />
      </div>
      <ApplicabilityFields text={text} tags={tags} onText={setText} onTags={setTags} />
      <DialogActions busy={busy} onCancel={onClose} onSubmit={() => void submit()} submitLabel="Speichern" />
    </Dialog>
  );
}

function ImportEditor({ projectId, bundleId, onClose }: { projectId: string; bundleId: string | null; onClose: () => void }) {
  const { dispatch } = useStore();
  const [sourcePath, setSourcePath] = useState('');
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!sourcePath.trim()) return;
    setBusy(true);
    try {
      await api.importEntry(projectId, {
        bundleId,
        sourcePath: sourcePath.trim(),
        applicability: { text: text.trim(), tags: parseTags(tags) },
      });
      onClose();
    } catch (e) {
      dispatch({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Datei als Wissen importieren" onClose={onClose}>
      <p className="mb-2 text-xs text-zinc-500">Repo-relativer Pfad, z. B. <code>docs/architektur.md</code>.</p>
      <TextField label="Pfad im Projekt" value={sourcePath} onChange={setSourcePath} autoFocus />
      <ApplicabilityFields text={text} tags={tags} onText={setText} onTags={setTags} />
      <DialogActions busy={busy} onCancel={onClose} onSubmit={() => void submit()} submitLabel="Importieren" />
    </Dialog>
  );
}

// ---------- kleine UI-Bausteine ----------

function ApplicabilityFields({
  text,
  tags,
  onText,
  onTags,
}: {
  text: string;
  tags: string;
  onText: (v: string) => void;
  onTags: (v: string) => void;
}) {
  return (
    <>
      <TextField label="Anwendbarkeit (wann anwenden?)" value={text} onChange={onText} placeholder="z. B. bei Auth-/Login-Themen" />
      <TextField label="Tags (kommasepariert)" value={tags} onChange={onTags} placeholder="auth, jwt" />
    </>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs text-zinc-500">{label}</label>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls}
      />
    </div>
  );
}

function ToolbarButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700">
      {children}
    </button>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800">
      {children}
    </button>
  );
}

function parseTags(raw: string): string[] {
  return [...new Set(raw.split(',').map((t) => t.trim()).filter(Boolean))];
}

const inputCls =
  'w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500';
