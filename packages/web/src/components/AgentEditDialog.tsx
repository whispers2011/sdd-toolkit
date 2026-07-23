import { useState } from 'react';
import { FEATURE_PHASES } from '@sdd/shared';
import type { AgentDefinition, AgentTriggerKind, FeaturePhase } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Dialog } from './Sidebar.js';

const TRIGGER_LABEL: Record<AgentTriggerKind, string> = {
  review_gate: 'Review-Gate (Integration)',
  after_phase: 'Nach Phase …',
  before_phase: 'Vor Phase …',
  manual: 'Nur manuell',
};

/** Anlegen/Bearbeiten eines Agents (Scope nur bei Neuanlage wählbar). */
export function AgentEditDialog({
  agent,
  projectId,
  onClose,
  onSaved,
}: {
  agent: AgentDefinition | null;
  /** Scope der Neuanlage (null = global); bei Bearbeitung fix. */
  projectId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { dispatch } = useStore();
  const [name, setName] = useState(agent?.name ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [prompt, setPrompt] = useState(agent?.prompt ?? '');
  const [model, setModel] = useState(agent?.model ?? '');
  const [kind, setKind] = useState<AgentTriggerKind>(agent?.trigger.kind ?? 'review_gate');
  const [phase, setPhase] = useState<FeaturePhase>(agent?.trigger.phase ?? 'plan');
  const [blocking, setBlocking] = useState(agent?.blocking ?? true);
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const [busy, setBusy] = useState(false);

  const needsPhase = kind === 'after_phase' || kind === 'before_phase';
  const valid = name.trim().length > 0 && prompt.trim().length > 0;

  const save = () => {
    if (!valid) return;
    setBusy(true);
    void api
      .saveAgent({
        ...(agent ? { id: agent.id } : {}),
        projectId: agent ? agent.projectId : projectId,
        name: name.trim(),
        description: description.trim(),
        prompt,
        model: model.trim() || null,
        trigger: needsPhase ? { kind, phase } : { kind },
        blocking,
        enabled,
        sortOrder: agent?.sortOrder ?? 99,
      })
      .then(onSaved)
      .catch((e: Error) => dispatch({ type: 'error', message: e.message }))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog title={agent ? `Agent bearbeiten: ${agent.name}` : 'Agent anlegen'} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-1 text-xs text-zinc-400">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
          />
        </label>
        <label className="col-span-1 text-xs text-zinc-400">
          Modell <span className="text-zinc-600">(leer = Standard)</span>
          <input
            list="agent-models"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Standard"
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
          />
          <datalist id="agent-models">
            <option value="haiku" />
            <option value="sonnet" />
            <option value="opus" />
          </datalist>
        </label>
        <label className="col-span-2 text-xs text-zinc-400">
          Beschreibung
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
          />
        </label>
        <label className="col-span-2 text-xs text-zinc-400">
          Prompt{' '}
          <span className="text-zinc-600">
            — {'{reviewFile}'} wird durch den Berichtspfad ersetzt; die letzte Berichtszeile MUSS
            „VERDICT: PASS" oder „VERDICT: FAIL" sein.
          </span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={10}
            spellCheck={false}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs leading-5 text-zinc-200 outline-none focus:border-zinc-500"
          />
        </label>
        <label className="col-span-1 text-xs text-zinc-400">
          Auslöser
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AgentTriggerKind)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
          >
            {(Object.keys(TRIGGER_LABEL) as AgentTriggerKind[]).map((k) => (
              <option key={k} value={k}>
                {TRIGGER_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {needsPhase && (
          <label className="col-span-1 text-xs text-zinc-400">
            Phase
            <select
              value={phase}
              onChange={(e) => setPhase(e.target.value as FeaturePhase)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
            >
              {FEATURE_PHASES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="col-span-2 flex items-center gap-6 text-xs text-zinc-400">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
            Blockierend <span className="text-zinc-600">(FAIL stoppt Gate/Fortschritt; sonst nur Hinweis)</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Aktiv
          </label>
          {!agent && (
            <span className="ml-auto text-zinc-600">
              Geltungsbereich: {projectId ? 'dieses Projekt' : 'global'}
            </span>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">
          Abbrechen
        </button>
        <button
          disabled={!valid || busy}
          onClick={save}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-emerald-600 disabled:opacity-40"
        >
          Speichern
        </button>
      </div>
    </Dialog>
  );
}
