import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_STEP_TIMEOUT_MS, lifecycleTriggerChip } from '@sdd/shared';
import type { LifecycleStep } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { LifecycleStepEditDialog } from './LifecycleStepEditDialog.js';
import { DeleteIcon } from './icons.js';

/** Zeitlimit als Chip — nur wenn es vom Vorgabewert abweicht (sonst ist es Rauschen). */
export function timeoutBadge(step: LifecycleStep): string | null {
  if (step.timeoutMs === null || step.timeoutMs === DEFAULT_STEP_TIMEOUT_MS) return null;
  const minutes = step.timeoutMs / 60_000;
  return minutes >= 1 ? `${Number(minutes.toFixed(1))} min` : `${step.timeoutMs} ms`;
}

/**
 * Lebenszyklus-Schritte verwalten: globale und projektspezifische Schritte
 * (Union-Semantik — beide gelten). Anlegen, Bearbeiten, Umordnen, De-/Aktivieren,
 * Löschen. Zwilling von `AgentsPanel` — es entsteht kein zweites Bedienkonzept.
 */
export function LifecycleStepsPanel({ projectId }: { projectId: string }) {
  const { state, dispatch } = useStore();
  const [steps, setSteps] = useState<LifecycleStep[] | null>(null);
  const [editing, setEditing] = useState<LifecycleStep | 'new-global' | 'new-project' | null>(null);
  const project = state.app?.projects.find((p) => p.id === projectId);

  const fail = (e: Error) => dispatch({ type: 'error', message: e.message });
  const load = useCallback(() => {
    api.lifecycleSteps(projectId).then(setSteps).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(load, [load]);

  if (!steps) return <p className="p-6 text-sm text-zinc-600">Lade Schritte …</p>;

  const globals = steps.filter((s) => s.projectId === null);
  const own = steps.filter((s) => s.projectId === projectId);

  const toggle = (s: LifecycleStep) =>
    void api.saveLifecycleStep({ ...s, enabled: !s.enabled }).then(load).catch(fail);
  const remove = (s: LifecycleStep) => {
    if (!confirm(`Schritt „${s.name}" löschen? Bisherige Läufe bleiben lesbar.`)) return;
    void api.deleteLifecycleStep(s.id).then(load).catch(fail);
  };
  // Umordnen tauscht die Position INNERHALB des Abschnitts — global und Projekt sind
  // getrennte Gruppen, weil die Ausführungsreihenfolge sie ohnehin gruppiert.
  const move = (s: LifecycleStep, dir: -1 | 1) => {
    const scope = s.projectId === null ? globals : own;
    const idx = scope.findIndex((x) => x.id === s.id);
    const other = scope[idx + dir];
    if (!other) return;
    void Promise.all([
      api.saveLifecycleStep({ ...s, sortOrder: other.sortOrder }),
      api.saveLifecycleStep({ ...other, sortOrder: s.sortOrder }),
    ])
      .then(load)
      .catch(fail);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <p className="text-xs text-zinc-500">
        Schritte laufen automatisch an ihren Auslösern. Globale UND projektspezifische Schritte gelten
        gemeinsam; sie laufen nacheinander — zuerst die globalen, dann die des Projekts, je Gruppe in der
        eingestellten Position. Pro Feature einzeln an-/abwählbar (Feature-Konsole → Schritte).
      </p>

      <StepSection
        title="Global (alle Projekte)"
        steps={globals}
        onNew={() => setEditing('new-global')}
        onEdit={setEditing}
        onToggle={toggle}
        onRemove={remove}
        onMove={move}
      />
      <StepSection
        title={`Projekt: ${project?.name ?? projectId}`}
        steps={own}
        onNew={() => setEditing('new-project')}
        onEdit={setEditing}
        onToggle={toggle}
        onRemove={remove}
        onMove={move}
      />

      {editing && (
        <LifecycleStepEditDialog
          step={typeof editing === 'string' ? null : editing}
          projectId={
            editing === 'new-project' ? projectId : typeof editing === 'string' ? null : editing.projectId
          }
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

function StepSection({
  title,
  steps,
  onNew,
  onEdit,
  onToggle,
  onRemove,
  onMove,
}: {
  title: string;
  steps: LifecycleStep[];
  onNew: () => void;
  onEdit: (s: LifecycleStep) => void;
  onToggle: (s: LifecycleStep) => void;
  onRemove: (s: LifecycleStep) => void;
  onMove: (s: LifecycleStep, dir: -1 | 1) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        <span className="text-xs text-zinc-600">({steps.length})</span>
        <button
          onClick={onNew}
          className="ml-auto rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
        >
          + Schritt anlegen
        </button>
      </div>
      {steps.length === 0 ? (
        <p className="rounded border border-zinc-800 px-4 py-4 text-center text-xs text-zinc-600">
          Keine Schritte.
        </p>
      ) : (
        <ul className="space-y-1">
          {steps.map((s, i) => {
            const timeout = timeoutBadge(s);
            return (
              <li
                key={s.id}
                className={`flex items-center gap-2 rounded border px-3 py-2 ${
                  s.enabled ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-800/60 opacity-60'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-100">{s.name}</span>
                    <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-300">
                      {lifecycleTriggerChip(s.trigger)}
                    </span>
                    <span
                      className={`rounded px-1.5 text-[10px] ${
                        s.blocking ? 'bg-red-950 text-red-300' : 'bg-zinc-800 text-zinc-400'
                      }`}
                      title={
                        s.blocking
                          ? 'Fehlschlag hält die Stufe an'
                          : 'Beratend — Fehlschlag wird nur verbucht'
                      }
                    >
                      {s.blocking ? 'Blockierend' : 'Hinweis'}
                    </span>
                    {timeout && (
                      <span
                        className="rounded bg-zinc-800 px-1.5 text-[10px] text-sky-300"
                        title="Abweichendes Zeitlimit"
                      >
                        {timeout}
                      </span>
                    )}
                  </div>
                  <code className="mt-0.5 block truncate text-xs text-zinc-500" title={s.command}>
                    {s.command}
                  </code>
                </div>
                <div className="flex shrink-0 items-center gap-1 text-xs">
                  <button
                    onClick={() => onMove(s, -1)}
                    disabled={i === 0}
                    className="rounded px-1 text-zinc-500 hover:bg-zinc-800 disabled:opacity-30"
                    title="Nach oben"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => onMove(s, 1)}
                    disabled={i === steps.length - 1}
                    className="rounded px-1 text-zinc-500 hover:bg-zinc-800 disabled:opacity-30"
                    title="Nach unten"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => onToggle(s)}
                    className={`rounded px-2 py-0.5 ${
                      s.enabled ? 'bg-emerald-900/70 text-emerald-300' : 'bg-zinc-800 text-zinc-400'
                    }`}
                    title={s.enabled ? 'Deaktivieren' : 'Aktivieren'}
                  >
                    {s.enabled ? 'Aktiv' : 'Inaktiv'}
                  </button>
                  <button
                    onClick={() => onEdit(s)}
                    className="rounded px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
                  >
                    Bearbeiten
                  </button>
                  <button
                    onClick={() => onRemove(s)}
                    className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800"
                    title="Löschen"
                  >
                    <DeleteIcon />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
