import { useCallback, useEffect, useState } from 'react';
import type { AgentDefinition, AgentTrigger } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { AgentEditDialog } from './AgentEditDialog.js';

export function triggerBadge(t: AgentTrigger): string {
  switch (t.kind) {
    case 'review_gate':
      return 'Review-Gate';
    case 'after_phase':
      return `nach ${t.phase ?? '?'}`;
    case 'before_phase':
      return `vor ${t.phase ?? '?'}`;
    case 'manual':
      return 'manuell';
  }
}

/**
 * Agents-Verwaltung: globale und projektspezifische Agents (Union-Semantik —
 * beide gelten). Anlegen, Bearbeiten, Umordnen, De-/Aktivieren, Löschen.
 */
export function AgentsPanel({ projectId }: { projectId: string }) {
  const { state, dispatch } = useStore();
  const [agents, setAgents] = useState<AgentDefinition[] | null>(null);
  const [editing, setEditing] = useState<AgentDefinition | 'new-global' | 'new-project' | null>(null);
  const project = state.app?.projects.find((p) => p.id === projectId);

  const fail = (e: Error) => dispatch({ type: 'error', message: e.message });
  const load = useCallback(() => {
    api.agents(projectId).then(setAgents).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(load, [load]);

  if (!agents) return <p className="p-6 text-sm text-zinc-600">Lade Agents …</p>;

  const globals = agents.filter((a) => a.projectId === null);
  const own = agents.filter((a) => a.projectId === projectId);

  const toggle = (a: AgentDefinition) => void api.saveAgent({ ...a, enabled: !a.enabled }).then(load).catch(fail);
  const remove = (a: AgentDefinition) => {
    if (!confirm(`Agent „${a.name}" löschen? Bisherige Läufe bleiben lesbar.`)) return;
    void api.deleteAgent(a.id).then(load).catch(fail);
  };
  const move = (a: AgentDefinition, dir: -1 | 1) => {
    const scope = a.projectId === null ? globals : own;
    const idx = scope.findIndex((x) => x.id === a.id);
    const other = scope[idx + dir];
    if (!other) return;
    void Promise.all([
      api.saveAgent({ ...a, sortOrder: other.sortOrder }),
      api.saveAgent({ ...other, sortOrder: a.sortOrder }),
    ])
      .then(load)
      .catch(fail);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <p className="text-xs text-zinc-500">
        Agents laufen automatisch an ihren Auslösern (Review-Gate der Integration, vor/nach einer Phase)
        oder manuell. Globale UND projektspezifische Agents gelten gemeinsam; pro Feature einzeln
        an-/abwählbar (Feature-Konsole → Agents).
      </p>

      <AgentSection
        title="Global (alle Projekte)"
        agents={globals}
        onNew={() => setEditing('new-global')}
        onEdit={setEditing}
        onToggle={toggle}
        onRemove={remove}
        onMove={move}
      />
      <AgentSection
        title={`Projekt: ${project?.name ?? projectId}`}
        agents={own}
        onNew={() => setEditing('new-project')}
        onEdit={setEditing}
        onToggle={toggle}
        onRemove={remove}
        onMove={move}
      />

      {editing && (
        <AgentEditDialog
          agent={typeof editing === 'string' ? null : editing}
          projectId={editing === 'new-project' ? projectId : typeof editing === 'string' ? null : editing.projectId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AgentSection({
  title,
  agents,
  onNew,
  onEdit,
  onToggle,
  onRemove,
  onMove,
}: {
  title: string;
  agents: AgentDefinition[];
  onNew: () => void;
  onEdit: (a: AgentDefinition) => void;
  onToggle: (a: AgentDefinition) => void;
  onRemove: (a: AgentDefinition) => void;
  onMove: (a: AgentDefinition, dir: -1 | 1) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        <span className="text-xs text-zinc-600">({agents.length})</span>
        <button
          onClick={onNew}
          className="ml-auto rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
        >
          + Agent anlegen
        </button>
      </div>
      {agents.length === 0 ? (
        <p className="rounded border border-zinc-800 px-4 py-4 text-center text-xs text-zinc-600">Keine Agents.</p>
      ) : (
        <ul className="space-y-1">
          {agents.map((a, i) => (
            <li
              key={a.id}
              className={`flex items-center gap-2 rounded border px-3 py-2 ${
                a.enabled ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-800/60 opacity-60'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-100">{a.name}</span>
                  <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-300">{triggerBadge(a.trigger)}</span>
                  <span
                    className={`rounded px-1.5 text-[10px] ${
                      a.blocking ? 'bg-red-950 text-red-300' : 'bg-zinc-800 text-zinc-400'
                    }`}
                    title={a.blocking ? 'FAIL stoppt Gate/Fortschritt' : 'Beratend — FAIL wird nur verbucht'}
                  >
                    {a.blocking ? 'Gate' : 'Hinweis'}
                  </span>
                  {a.model && <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-sky-300">{a.model}</span>}
                </div>
                {a.description && <p className="mt-0.5 truncate text-xs text-zinc-500">{a.description}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1 text-xs">
                <button
                  onClick={() => onMove(a, -1)}
                  disabled={i === 0}
                  className="rounded px-1 text-zinc-500 hover:bg-zinc-800 disabled:opacity-30"
                  title="Nach oben"
                >
                  ↑
                </button>
                <button
                  onClick={() => onMove(a, 1)}
                  disabled={i === agents.length - 1}
                  className="rounded px-1 text-zinc-500 hover:bg-zinc-800 disabled:opacity-30"
                  title="Nach unten"
                >
                  ↓
                </button>
                <button
                  onClick={() => onToggle(a)}
                  className={`rounded px-2 py-0.5 ${
                    a.enabled ? 'bg-emerald-900/70 text-emerald-300' : 'bg-zinc-800 text-zinc-400'
                  }`}
                  title={a.enabled ? 'Deaktivieren' : 'Aktivieren'}
                >
                  {a.enabled ? 'Aktiv' : 'Inaktiv'}
                </button>
                <button onClick={() => onEdit(a)} className="rounded px-2 py-0.5 text-zinc-300 hover:bg-zinc-800">
                  Bearbeiten
                </button>
                <button onClick={() => onRemove(a)} className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800" title="Löschen">
                  🗑
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
