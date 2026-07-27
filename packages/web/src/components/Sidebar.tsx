import { useEffect, useState } from 'react';
import type { Feature } from '@sdd/shared';
import { api, type LiveSessionInfo } from '../api.js';
import { isShowCompleted, useStore } from '../store.js';
import { ProjectSettings } from './ProjectSettings.js';
import { NewFeatureDialog } from './NewFeatureDialog.js';
import { JiraSettings } from './JiraSettings.js';
import { JiraImportDialog } from './JiraImportDialog.js';
import { ChevronDownIcon, KnowledgeIcon, LogoMark, SettingsIcon } from './icons.js';

// ---- Projekt-Reihenfolge (gerätelokal, per Drag&Drop) ----
const PROJECT_ORDER_KEY = 'sdd-project-order';

function loadProjectOrder(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PROJECT_ORDER_KEY) ?? 'null') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveProjectOrder(ids: string[]): void {
  try {
    localStorage.setItem(PROJECT_ORDER_KEY, JSON.stringify(ids));
  } catch {
    /* best effort */
  }
}

/** Projekte nach gespeicherter Reihenfolge sortieren; unbekannte (neue) hinten, Serverreihenfolge stabil. */
function orderProjects<T extends { id: string }>(projects: T[], order: string[]): T[] {
  const idx = new Map(order.map((id, i) => [id, i] as const));
  return [...projects].sort(
    (a, b) => (idx.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Kurzes Datum (TT.MM.JJ) für die Datumsspalte abgeschlossener Features. */
function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function Sidebar() {
  const { state, dispatch } = useStore();
  const [showNewProject, setShowNewProject] = useState(false);
  const [newFeatureFor, setNewFeatureFor] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [showJiraSettings, setShowJiraSettings] = useState(false);
  const [showToolSettings, setShowToolSettings] = useState(false);
  const [order, setOrder] = useState<string[]>(() => loadProjectOrder());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  if (!state.app) return null;

  const orderedProjects = orderProjects(state.app.projects, order);

  const reorder = (targetId: string) => {
    setOverId(null);
    if (!dragId || dragId === targetId || !state.app) {
      setDragId(null);
      return;
    }
    const ids = orderProjects(state.app.projects, order).map((p) => p.id);
    const from = ids.indexOf(dragId);
    if (from === -1) {
      setDragId(null);
      return;
    }
    ids.splice(from, 1);
    ids.splice(ids.indexOf(targetId), 0, dragId); // vor das Ziel einfügen
    saveProjectOrder(ids);
    setOrder(ids);
    setDragId(null);
  };

  const sessionFor = (featureId: string): LiveSessionInfo | undefined =>
    state.app!.sessions.find((s) => s.featureId === featureId && !s.exited);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-925">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Logo = Heimweg: zurück auf das Board des aktuell gewählten Projekts. */}
        <button
          onClick={() => dispatch({ type: 'set_view', view: { kind: 'board' } })}
          title="Zur Board-Übersicht"
          className="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 hover:bg-zinc-900"
        >
          <LogoMark className="text-xl" />
          <h1 className="text-sm font-bold tracking-wide text-zinc-100">SDD TOOLKIT</h1>
        </button>
        <button
          onClick={() => setShowNewProject(true)}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          title="Projekt hinzufügen"
        >
          + Projekt
        </button>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {orderedProjects.map((project) => {
          // Nur das aktuell ausgewählte Projekt ist aufgeklappt — alle anderen eingeklappt.
          const expanded = state.selectedProjectId === project.id;
          return (
          <div key={project.id} className="mb-3">
            <div
              draggable
              onDragStart={(e) => {
                setDragId(project.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', project.id);
              }}
              onDragOver={(e) => {
                if (dragId && dragId !== project.id) {
                  e.preventDefault();
                  setOverId(project.id);
                }
              }}
              onDragLeave={() => setOverId((cur) => (cur === project.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                reorder(project.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              title="Ziehen zum Umsortieren"
              className={`group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 ${
                state.selectedProjectId === project.id ? 'bg-zinc-800' : 'hover:bg-zinc-900'
              } ${overId === project.id && dragId !== project.id ? 'border-t-2 border-emerald-600' : ''} ${
                dragId === project.id ? 'opacity-50' : ''
              }`}
              onClick={() => {
                // Klick auf den Projektnamen öffnet das Board dieses Projekts (FR-001/FR-004).
                dispatch({ type: 'select_project', projectId: project.id });
                dispatch({ type: 'set_view', view: { kind: 'board' } });
              }}
            >
              <ChevronDownIcon
                className={`shrink-0 text-zinc-600 transition-transform ${expanded ? '' : '-rotate-90'}`}
              />
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
                  dispatch({ type: 'select_project', projectId: project.id });
                  dispatch({ type: 'set_view', view: { kind: 'knowledge', projectId: project.id } });
                }}
                className="hidden rounded bg-zinc-700 px-1.5 text-xs text-zinc-300 group-hover:block"
                title="Projektspezifisches Wissen"
              >
                <KnowledgeIcon />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'select_project', projectId: project.id });
                  dispatch({ type: 'set_view', view: { kind: 'agents', projectId: project.id } });
                }}
                className="hidden rounded bg-zinc-700 px-1.5 text-xs text-zinc-300 group-hover:block"
                title="Agenten (Review- & Qualitäts-Gates)"
              >
                ⚖
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
            {expanded && (
            <ul className="mt-0.5 space-y-0.5 pl-3">
              {state.app!.features
                .filter(
                  (f) =>
                    f.projectId === project.id &&
                    (isShowCompleted(state, project.id) || f.integration !== 'merged'),
                )
                .sort((a, b) => b.createdAt - a.createdAt) // neueste Session zuerst
                .map((feature) => {
                  const session = sessionFor(feature.id);
                  const status = session?.status ?? 'stopped';
                  return (
                    <li key={feature.id}>
                      <button
                        onClick={() => {
                          // Kontext-Trennung: Feature-Klick wählt auch das Projekt.
                          dispatch({ type: 'select_project', projectId: project.id });
                          dispatch({ type: 'set_view', view: { kind: 'console', featureId: feature.id } });
                        }}
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
            )}
          </div>
          );
        })}
        {state.app.projects.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-zinc-600">
            Noch keine Projekte.
            <br />
            Füge ein Git-Repo hinzu.
          </p>
        )}
      </div>

      <CompletedToggle />

      {/* Tool-weite Einstellungen (nutzerweit, nicht projektgebunden) — Heimat z. B. der Jira-Anbindung. Ganz unten. */}
      <div className="border-t border-zinc-800 px-2 py-2">
        <button
          onClick={() => setShowToolSettings(true)}
          title="Einstellungen"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <SettingsIcon className="text-base" />
          <span>Einstellungen</span>
        </button>
      </div>

      {showNewProject && <NewProjectDialog onClose={() => setShowNewProject(false)} />}
      {newFeatureFor && (
        <NewFeatureFlow
          projectId={newFeatureFor}
          onClose={() => setNewFeatureFor(null)}
          onOpenSettings={() => {
            setNewFeatureFor(null);
            setShowJiraSettings(true);
          }}
        />
      )}
      {settingsFor && (() => {
        const project = state.app!.projects.find((p) => p.id === settingsFor);
        return project ? <ProjectSettings project={project} onClose={() => setSettingsFor(null)} /> : null;
      })()}
      {showToolSettings && (
        <ToolSettings
          onClose={() => setShowToolSettings(false)}
          onOpenJira={() => {
            setShowToolSettings(false);
            setShowJiraSettings(true);
          }}
        />
      )}
      {showJiraSettings && <JiraSettings onClose={() => setShowJiraSettings(false)} />}
    </aside>
  );
}

/**
 * Einheitlicher Einstieg „Neues Feature": prüft den Jira-Verbindungsstatus und öffnet
 * standardmäßig den Jira-Import (wenn verbunden) bzw. die manuelle Erfassung (sonst).
 * Im verbundenen Fall lässt sich im Dialog zwischen beiden Quellen umschalten.
 */
function NewFeatureFlow({
  projectId,
  onClose,
  onOpenSettings,
}: {
  projectId: string;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'jira' | 'manual'>('manual');

  useEffect(() => {
    let alive = true;
    api
      .jiraStatus()
      .then((s) => {
        if (!alive) return;
        const c = s.state === 'connected';
        setConnected(c);
        setMode(c ? 'jira' : 'manual');
      })
      .catch(() => {
        if (alive) {
          setConnected(false);
          setMode('manual');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  if (connected === null) {
    return (
      <Dialog title="Neues Feature" onClose={onClose}>
        <p className="py-4 text-sm text-zinc-500">Prüfe Jira-Verbindung …</p>
      </Dialog>
    );
  }
  if (mode === 'jira') {
    return (
      <JiraImportDialog
        projectId={projectId}
        onClose={onClose}
        onOpenSettings={onOpenSettings}
        onSwitchToManual={() => setMode('manual')}
      />
    );
  }
  return (
    <NewFeatureDialog
      projectId={projectId}
      onClose={onClose}
      {...(connected ? { onSwitchToJira: () => setMode('jira') } : {})}
    />
  );
}

/**
 * Tool-weite Einstellungen (Zentrale): nutzerweite, projektübergreifende Konfiguration.
 * Die Übersichten liegen nicht hier, sondern unter dem Menüpunkt „Übersichten".
 */
function ToolSettings({ onClose, onOpenJira }: { onClose: () => void; onOpenJira: () => void }) {
  return (
    <Dialog title="Einstellungen" onClose={onClose}>
      <p className="mb-3 text-xs text-zinc-500">Tool-weite Einstellungen (nutzerweit, projektübergreifend).</p>
      <div className="space-y-1">
        <button
          onClick={onOpenJira}
          className="flex w-full items-center gap-3 rounded border border-zinc-700 px-3 py-2 text-left hover:bg-zinc-800"
        >
          <span className="flex-1">
            <span className="block text-sm font-medium text-zinc-200">Jira-Verbindung</span>
            <span className="block text-xs text-zinc-500">Atlassian-Konto verbinden, Sites &amp; Projekte wählen</span>
          </span>
          <span className="text-zinc-500">→</span>
        </button>
      </div>
    </Dialog>
  );
}

/** Abgeschlossene standardmäßig ausblenden — hier wieder einblendbar (nur aktuelles Projekt). */
function CompletedToggle() {
  const { state, dispatch } = useStore();
  if (!state.app) return null;
  const pid = state.selectedProjectId;
  if (!pid) return null;
  const show = isShowCompleted(state, pid);
  const completed = state.app.features.filter(
    (f) => f.projectId === pid && f.integration === 'merged',
  ).length;
  if (completed === 0 && !show) return null;
  return (
    <button
      onClick={() => dispatch({ type: 'toggle_completed' })}
      title="Gilt nur für das aktuelle Projekt"
      className="mx-2 mb-2 rounded border border-zinc-800 px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
    >
      {show ? '▾' : '▸'} Abgeschlossene ({completed}) {show ? 'ausblenden' : 'anzeigen'}
    </button>
  );
}

function FeatureBadge({ feature }: { feature: Feature }) {
  if (feature.integration === 'merged') {
    return (
      <span
        className="ml-auto shrink-0 text-[10px] tabular-nums text-zinc-500"
        title={`Session erstellt am ${new Date(feature.createdAt).toLocaleString('de-CH')}`}
      >
        {shortDate(feature.createdAt)}
      </span>
    );
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

/** Einheitlicher Bestätigungs-Dialog (WP16/Q6) — zeigt, was verloren geht. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="text-sm whitespace-pre-line text-zinc-300">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">
          Abbrechen
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className="rounded bg-red-800 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-red-700"
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Breites Layout (z. B. Berichte, Editor-Dialoge). */
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className={`${wide ? 'w-[52rem] max-w-[92vw]' : 'w-[28rem]'} rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl`}
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
        className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-emerald-600 disabled:opacity-50"
      >
        {busy ? '…' : submitLabel}
      </button>
    </div>
  );
}

/**
 * Segmentierter Umschalter zwischen Jira-Import und manueller Feature-Erfassung.
 * Wird oben in beiden „Neues Feature"-Dialogen gezeigt, wenn ein Wechsel möglich
 * ist (Jira verbunden).
 */
export function FeatureSourceToggle({
  mode,
  onJira,
  onManual,
}: {
  mode: 'jira' | 'manual';
  onJira: () => void;
  onManual: () => void;
}) {
  const seg = (active: boolean) =>
    `flex-1 rounded px-2 py-1 ${active ? 'bg-zinc-700 font-medium text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`;
  return (
    <div className="mb-3 flex gap-1 rounded-md bg-zinc-800 p-0.5 text-xs">
      <button onClick={onJira} className={seg(mode === 'jira')}>
        Aus Jira importieren
      </button>
      <button onClick={onManual} className={seg(mode === 'manual')}>
        Manuell erfassen
      </button>
    </div>
  );
}
