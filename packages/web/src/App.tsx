import { useEffect } from 'react';
import { useStore } from './store.js';
import { Sidebar } from './components/Sidebar.js';
import { KanbanBoard } from './components/KanbanBoard.js';
import { FeatureConsole } from './components/FeatureConsole.js';
import { AttentionInbox } from './components/AttentionInbox.js';
import { AutomationDial } from './components/AutomationDial.js';
import { ExecutionsView } from './components/ExecutionsView.js';
import { GridView } from './components/GridView.js';
import { ShellConsole } from './components/ShellConsole.js';
import { api } from './api.js';

export function App() {
  const { state, dispatch } = useStore();

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const ask = () => void Notification.requestPermission();
      window.addEventListener('click', ask, { once: true });
      return () => window.removeEventListener('click', ask);
    }
  }, []);

  const openAttention = state.app?.attention.length ?? 0;

  // Titel-Badge (WP9): offene Attention-Items im Browser-Tab sichtbar.
  useEffect(() => {
    document.title = openAttention > 0 ? `(${openAttention}) SDD Toolkit` : 'SDD Toolkit';
  }, [openAttention]);

  if (!state.app) {
    return (
      <div className="flex h-screen items-center justify-center text-zinc-500">
        {state.error ? `Server nicht erreichbar: ${state.error}` : 'Lade …'}
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-zinc-800 px-4 py-2">
          <nav className="flex gap-1">
            <TabButton
              active={state.view.kind === 'board'}
              onClick={() => dispatch({ type: 'set_view', view: { kind: 'board' } })}
            >
              Board
            </TabButton>
            <TabButton
              active={state.view.kind === 'grid'}
              onClick={() => dispatch({ type: 'set_view', view: { kind: 'grid' } })}
            >
              Grid
            </TabButton>
            <TabButton
              active={state.view.kind === 'executions'}
              onClick={() => dispatch({ type: 'set_view', view: { kind: 'executions' } })}
            >
              Läufe
            </TabButton>
            <TabButton
              active={state.view.kind === 'inbox'}
              onClick={() => dispatch({ type: 'set_view', view: { kind: 'inbox' } })}
            >
              Braucht dich
              {openAttention > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-zinc-950">
                  {openAttention}
                </span>
              )}
            </TabButton>
          </nav>
          <div className="ml-auto">
            <AutomationDial />
          </div>
        </header>
        {state.error && (
          <div className="flex items-center justify-between bg-red-950 px-4 py-1.5 text-sm text-red-300">
            {state.error}
            <button className="text-red-400 hover:text-red-200" onClick={() => dispatch({ type: 'error', message: null })}>
              ✕
            </button>
          </div>
        )}
        <SpecKitBanner />
        <main className="min-h-0 flex-1 overflow-auto">
          {state.view.kind === 'board' && <KanbanBoard />}
          {state.view.kind === 'inbox' && <AttentionInbox />}
          {state.view.kind === 'executions' && <ExecutionsView />}
          {state.view.kind === 'grid' && <GridView />}
          {state.view.kind === 'console' && <FeatureConsole featureId={state.view.featureId} />}
          {state.view.kind === 'shell' && <ShellConsole projectId={state.view.projectId} />}
        </main>
      </div>
    </div>
  );
}

/** Banner (WP11): Projekt ohne spec-kit → geführte Initialisierung. */
function SpecKitBanner() {
  const { state, dispatch } = useStore();
  if (!state.app) return null;
  const missing = state.app.projects.filter(
    (p) => !p.specKit && (state.selectedProjectId === null || p.id === state.selectedProjectId),
  );
  if (missing.length === 0 || state.view.kind === 'shell') return null;
  return (
    <div className="flex flex-col gap-1 border-b border-amber-900 bg-amber-950/40 px-4 py-1.5">
      {missing.map((p) => (
        <div key={p.id} className="flex items-center gap-2 text-xs text-amber-300">
          <span>
            ⚠ <strong>{p.name}</strong> hat noch kein spec-kit — Phasen-Kommandos (/speckit.*) fehlen.
          </span>
          <button
            onClick={() =>
              void api.initSpeckit(p.id).then(() => {
                dispatch({ type: 'set_view', view: { kind: 'shell', projectId: p.id } });
              })
            }
            className="rounded bg-amber-800 px-2 py-0.5 font-medium text-amber-100 hover:bg-amber-700"
          >
            spec-kit initialisieren …
          </button>
          <button
            onClick={() => void api.state().then((s) => dispatch({ type: 'bootstrap', state: s }))}
            className="rounded border border-amber-800 px-2 py-0.5 text-amber-300 hover:bg-amber-900"
          >
            Neu prüfen
          </button>
        </div>
      ))}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}
