import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { TerminalPane } from './TerminalPane.js';

const STORAGE_KEY = 'sdd-grid-panes';
const MAX_PANES = 9;

function gridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1 grid-rows-1';
  if (count === 2) return 'grid-cols-2 grid-rows-1';
  if (count <= 4) return 'grid-cols-2 grid-rows-2';
  if (count <= 6) return 'grid-cols-3 grid-rows-2';
  return 'grid-cols-3 grid-rows-3';
}

/** Grid-View (WP8): mehrere Feature-Konsolen nebeneinander — der Level-2-Modus. */
export function GridView() {
  const { state } = useStore();
  const [panes, setPanes] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const [focusedPane, setFocusedPane] = useState<number>(0);
  const [maximized, setMaximized] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panes));
  }, [panes]);

  if (!state.app) return null;
  const features = state.app.features;
  // Panes bereinigen, deren Features nicht mehr existieren (UI-State, kein Domain-State).
  const validPanes = panes.filter((id) => features.some((f) => f.id === id));

  const addPane = (featureId: string) => {
    if (validPanes.length >= MAX_PANES || validPanes.includes(featureId)) return;
    setPanes([...validPanes, featureId]);
  };
  const removePane = (index: number) => {
    setPanes(validPanes.filter((_, i) => i !== index));
    setMaximized(null);
  };

  const available = features.filter((f) => !validPanes.includes(f.id) && f.integration !== 'merged');

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-1.5">
        <select
          value=""
          onChange={(e) => e.target.value && addPane(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
        >
          <option value="">+ Konsole hinzufügen …</option>
          {available.map((f) => (
            <option key={f.id} value={f.id}>
              {state.app!.projects.find((p) => p.id === f.projectId)?.name} / {f.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-zinc-600">
          {validPanes.length}/{MAX_PANES} Panes · fokussierte Pane streamt live, übrige gedrosselt
        </span>
      </div>

      {validPanes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
          Füge Feature-Konsolen hinzu, um parallel zu orchestrieren.
        </div>
      ) : (
        <div className={`grid min-h-0 flex-1 gap-1 p-1 ${maximized !== null ? '' : gridClass(validPanes.length)}`}>
          {validPanes.map((featureId, i) => {
            if (maximized !== null && maximized !== i) return null;
            const feature = features.find((f) => f.id === featureId)!;
            const project = state.app!.projects.find((p) => p.id === feature.projectId);
            const session = state.app!.sessions.find((s) => s.featureId === featureId && !s.exited);
            const isFocused = focusedPane === i || maximized === i;
            return (
              <div
                key={featureId}
                onMouseDown={() => setFocusedPane(i)}
                className={`flex min-h-0 flex-col overflow-hidden rounded border ${
                  isFocused ? 'border-emerald-800' : 'border-zinc-800'
                } bg-[#09090b]`}
              >
                <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-925 px-2 py-1">
                  <span className={`status-dot status-${session?.status ?? 'stopped'}`} />
                  <span className="truncate text-xs text-zinc-300">
                    {project?.name} / {feature.name}
                  </span>
                  <button
                    onClick={() => setMaximized(maximized === i ? null : i)}
                    className="ml-auto rounded px-1 text-xs text-zinc-500 hover:bg-zinc-800"
                    title={maximized === i ? 'Wiederherstellen' : 'Maximieren'}
                  >
                    {maximized === i ? '🗗' : '🗖'}
                  </button>
                  <button
                    onClick={() => removePane(i)}
                    className="rounded px-1 text-xs text-zinc-500 hover:bg-zinc-800"
                  >
                    ✕
                  </button>
                </div>
                <div className="min-h-0 flex-1 p-1">
                  <TerminalPane featureId={featureId} focused={isFocused} fontSize={validPanes.length > 4 ? 11 : 12} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
