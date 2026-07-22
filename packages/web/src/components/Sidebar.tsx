import { useEffect, useState } from 'react';
import type { Feature } from '@sdd/shared';
import { api, type LiveSessionInfo } from '../api.js';
import { useStore } from '../store.js';
import { ProjectSettings } from './ProjectSettings.js';
import { VoiceButton } from './VoiceButton.js';

export function Sidebar() {
  const { state, dispatch } = useStore();
  const [showNewProject, setShowNewProject] = useState(false);
  const [newFeatureFor, setNewFeatureFor] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  if (!state.app) return null;

  const sessionFor = (featureId: string): LiveSessionInfo | undefined =>
    state.app!.sessions.find((s) => s.featureId === featureId && !s.exited);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-925">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-bold tracking-wide text-zinc-100">SDD TOOLKIT</h1>
        <button
          onClick={() => setShowNewProject(true)}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          title="Projekt hinzufügen"
        >
          + Projekt
        </button>
      </div>

      <button
        onClick={() => dispatch({ type: 'select_project', projectId: null })}
        className={`mx-2 rounded px-2 py-1 text-left text-xs ${
          state.selectedProjectId === null ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'
        }`}
      >
        Alle Projekte
      </button>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {state.app.projects.map((project) => (
          <div key={project.id} className="mb-3">
            <div
              className={`group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 ${
                state.selectedProjectId === project.id ? 'bg-zinc-800' : 'hover:bg-zinc-900'
              }`}
              onClick={() => dispatch({ type: 'select_project', projectId: project.id })}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: project.color ?? '#71717a' }}
              />
              <span className="truncate text-sm font-medium text-zinc-200">{project.name}</span>
              <span className="ml-auto truncate text-xs text-zinc-500">{project.currentBranch}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setNewFeatureFor(project.id);
                }}
                className="hidden rounded bg-zinc-700 px-1.5 text-xs text-zinc-300 group-hover:block"
                title="Feature anlegen"
              >
                +
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'set_view', view: { kind: 'shell', projectId: project.id } });
                }}
                className="hidden rounded bg-zinc-700 px-1.5 text-xs text-zinc-300 group-hover:block"
                title="Projekt-Terminal"
              >
                &gt;_
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSettingsFor(project.id);
                }}
                className="hidden rounded bg-zinc-700 px-1.5 text-xs text-zinc-300 group-hover:block"
                title="Projekt-Einstellungen"
              >
                ⚙
              </button>
            </div>
            <ul className="mt-0.5 space-y-0.5 pl-3">
              {state.app!.features
                .filter((f) => f.projectId === project.id)
                .map((feature) => {
                  const session = sessionFor(feature.id);
                  const status = session?.status ?? 'stopped';
                  return (
                    <li key={feature.id}>
                      <button
                        onClick={() =>
                          dispatch({ type: 'set_view', view: { kind: 'console', featureId: feature.id } })
                        }
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                      >
                        <span className={`status-dot status-${status}`} />
                        <span className="truncate">{feature.name}</span>
                        <FeatureBadge feature={feature} />
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
        {state.app.projects.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-zinc-600">
            Noch keine Projekte.
            <br />
            Füge ein Git-Repo hinzu.
          </p>
        )}
      </div>

      {showNewProject && <NewProjectDialog onClose={() => setShowNewProject(false)} />}
      {newFeatureFor && <NewFeatureDialog projectId={newFeatureFor} onClose={() => setNewFeatureFor(null)} />}
      {settingsFor && (() => {
        const project = state.app!.projects.find((p) => p.id === settingsFor);
        return project ? <ProjectSettings project={project} onClose={() => setSettingsFor(null)} /> : null;
      })()}
    </aside>
  );
}

function FeatureBadge({ feature }: { feature: Feature }) {
  if (feature.integration === 'merged') {
    return <span className="ml-auto text-xs text-emerald-500">✓</span>;
  }
  if (feature.integration !== 'none') {
    return <span className="ml-auto truncate text-xs text-sky-500">{feature.integration}</span>;
  }
  if (feature.tasksTotal > 0) {
    return (
      <span className="ml-auto text-xs text-zinc-600">
        {feature.tasksDone}/{feature.tasksTotal}
      </span>
    );
  }
  return null;
}

/** Projekt hinzufügen (WP14): nativer Ordner-Dialog, Vorschläge, FS-Browser. */
function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [browser, setBrowser] = useState<{
    base: string;
    parent: string | null;
    dirs: { path: string; name: string; isGitRepo: boolean }[];
  } | null>(null);

  useEffect(() => {
    void api.suggestions().then((r) => setSuggestions(r.suggestions)).catch(() => {});
  }, []);

  const submit = async (p?: string) => {
    const target = (p ?? path).trim();
    if (!target) return;
    setBusy(true);
    try {
      await api.addProject(target);
      const fresh = await api.state();
      dispatch({ type: 'bootstrap', state: fresh });
      onClose();
    } catch (e) {
      dispatch({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const pickNative = async () => {
    const r = await api.pickFolder().catch(() => ({ cancelled: true }) as const);
    if (!r.cancelled && r.path) setPath(r.path);
  };

  const openBrowser = (p?: string) =>
    void api
      .listDirs(p)
      .then(setBrowser)
      .catch((e: Error) => dispatch({ type: 'error', message: e.message }));

  return (
    <Dialog title="Projekt hinzufügen" onClose={onClose}>
      <p className="mb-2 text-xs text-zinc-500">
        Git-Repo wählen — vorhandene <code>specs/</code>-Features werden importiert.
      </p>

      <div className="mb-2 flex gap-2">
        <button
          onClick={() => void pickNative()}
          className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
        >
          📁 Ordner wählen …
        </button>
        <button
          onClick={() => (browser ? setBrowser(null) : openBrowser())}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
        >
          {browser ? 'Browser schließen' : 'Durchsuchen'}
        </button>
      </div>

      {path && (
        <div className="mb-2 truncate rounded border border-emerald-900 bg-emerald-950/40 px-3 py-1.5 text-sm text-emerald-300">
          {path}
        </div>
      )}

      {suggestions.length > 0 && !browser && (
        <div className="mb-2">
          <p className="mb-1 text-xs text-zinc-600">Vorschläge (Repos neben deinen Projekten):</p>
          <ul className="max-h-32 space-y-0.5 overflow-y-auto">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  onClick={() => setPath(s)}
                  className="w-full truncate rounded px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {browser && (
        <div className="mb-2 rounded border border-zinc-800">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-1">
            {browser.parent && (
              <button onClick={() => openBrowser(browser.parent!)} className="rounded px-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
                ↑
              </button>
            )}
            <span className="truncate text-xs text-zinc-500">{browser.base}</span>
          </div>
          <ul className="max-h-40 overflow-y-auto p-1">
            {browser.dirs.map((d) => (
              <li key={d.path} className="flex items-center">
                <button
                  onClick={() => openBrowser(d.path)}
                  className="flex-1 truncate rounded px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800"
                >
                  {d.isGitRepo ? '● ' : '○ '}
                  {d.name}
                </button>
                {d.isGitRepo && (
                  <button
                    onClick={() => setPath(d.path)}
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-emerald-400 hover:bg-zinc-700"
                  >
                    wählen
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DialogActions busy={busy} onCancel={onClose} onSubmit={() => void submit()} submitLabel="Hinzufügen" />
    </Dialog>
  );
}

function NewFeatureDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const feature = await api.createFeature(projectId, name.trim(), description.trim() || undefined);
      dispatch({ type: 'feature_updated', feature });
      dispatch({ type: 'set_view', view: { kind: 'console', featureId: feature.id } });
      onClose();
    } catch (e) {
      dispatch({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Neues Feature" onClose={onClose}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="feature-name"
        className="mb-2 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
      />
      <div className="relative">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Beschreibung (optional) — startet direkt /speckit.specify mit diesem Text"
          rows={4}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 pr-10 text-sm text-zinc-200 outline-none focus:border-zinc-500"
        />
        <div className="absolute top-1.5 right-1.5">
          <VoiceButton onText={(t) => setDescription((cur) => cur + t)} />
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        Legt Worktree + Branch an und öffnet die Feature-Konsole.
      </p>
      <DialogActions busy={busy} onCancel={onClose} onSubmit={() => void submit()} submitLabel="Anlegen" />
    </Dialog>
  );
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[28rem] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function DialogActions({
  busy,
  onCancel,
  onSubmit,
  submitLabel,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button onClick={onCancel} className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">
        Abbrechen
      </button>
      <button
        onClick={onSubmit}
        disabled={busy}
        className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
      >
        {busy ? '…' : submitLabel}
      </button>
    </div>
  );
}
