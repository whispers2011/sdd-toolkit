import type { AttentionKind } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';

const KIND_META: Record<AttentionKind, { label: string; icon: string; tone: string }> = {
  awaiting_input: { label: 'Frage', icon: '❓', tone: 'text-amber-400' },
  permission_request: { label: 'Berechtigung', icon: '🔐', tone: 'text-amber-400' },
  verify_failed: { label: 'Verifikation rot', icon: '🔴', tone: 'text-red-400' },
  gate_failed: { label: 'Review-Gate FAIL', icon: '⛔', tone: 'text-red-400' },
  merge_conflict_escalated: { label: 'Merge-Konflikt', icon: '⚡', tone: 'text-red-400' },
  review_due: { label: 'Review fällig', icon: '👀', tone: 'text-sky-400' },
  agent_errored: { label: 'Agent-Fehler', icon: '💥', tone: 'text-red-400' },
  run_interrupted: { label: 'Lauf unterbrochen', icon: '⏸', tone: 'text-amber-400' },
};

/** Exception-Inbox: Monitoring by exception — der Level-3-Arbeitsmodus. */
export function AttentionInbox() {
  const { state, dispatch } = useStore();
  if (!state.app) return null;

  // Kontext-Trennung: Inbox respektiert den Projekt-Scope (genau 1 Projekt).
  // Berechtigungs-Rückfragen (auch Alt-Einträge) gehören nicht in „Braucht dich".
  const items = state.app.attention.filter(
    (a) => a.kind !== 'permission_request' && a.projectId === state.selectedProjectId,
  );
  const projectName = (id: string) => state.app!.projects.find((p) => p.id === id)?.name ?? '?';

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
        <span className="text-4xl">🧘</span>
        <p className="text-sm">Nichts braucht dich gerade — die Agents arbeiten.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-2 p-4">
      {items.map((item) => {
        const meta = KIND_META[item.kind];
        return (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
          >
            <span className="text-xl">{meta.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${meta.tone}`}>{meta.label}</span>
                <span className="text-xs text-zinc-600">{projectName(item.projectId)}</span>
                <span className="text-xs text-zinc-600">
                  {new Date(item.createdAt).toLocaleTimeString('de-CH')}
                </span>
              </div>
              <p className="truncate text-sm text-zinc-300">{item.message}</p>
            </div>
            {item.featureId && (
              <button
                onClick={() =>
                  dispatch({ type: 'set_view', view: { kind: 'console', featureId: item.featureId! } })
                }
                className="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
              >
                Zur Konsole →
              </button>
            )}
            {!item.featureId && item.conversationId && (
              <button
                onClick={() => dispatch({ type: 'open_chat', projectId: item.projectId })}
                className="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
              >
                Zum Chat →
              </button>
            )}
            <button
              onClick={() =>
                void api
                  .resolveAttention(item.id)
                  .then(() => dispatch({ type: 'attention_resolved', id: item.id }))
              }
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              title="Als erledigt markieren"
            >
              ✓
            </button>
          </div>
        );
      })}
    </div>
  );
}
