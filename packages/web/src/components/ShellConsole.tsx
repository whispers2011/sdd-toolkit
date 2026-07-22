import { api } from '../api.js';
import { useStore } from '../store.js';
import { TerminalPane } from './TerminalPane.js';

/** Projekt-Terminal (WP11): persistente Login-Shell im Projekt-cwd. */
export function ShellConsole({ projectId }: { projectId: string }) {
  const { state } = useStore();
  const project = state.app?.projects.find((p) => p.id === projectId);
  if (!project) return <div className="p-8 text-zinc-500">Projekt nicht gefunden.</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: project.color ?? '#71717a' }} />
        <span className="text-sm font-medium text-zinc-200">{project.name} — Terminal</span>
        <span className="truncate text-xs text-zinc-600">{project.path}</span>
        {!project.specKit && (
          <span className="ml-auto rounded bg-amber-950 px-2 py-0.5 text-xs text-amber-400">
            spec-kit fehlt — Init-Befehl mit Enter bestätigen
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-[#09090b] p-2">
        <TerminalPane key={projectId} getSession={() => api.projectTerminal(projectId)} />
      </div>
    </div>
  );
}
