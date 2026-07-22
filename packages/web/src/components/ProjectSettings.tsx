import { useState } from 'react';
import {
  FEATURE_PHASES,
  LEVEL2_DEFAULTS,
  LEVEL3_DEFAULTS,
  type AutomationSettings,
  type FeaturePhase,
  type Project,
  type VerifyCommand,
} from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Dialog, DialogActions } from './Sidebar.js';

const COLORS = ['#71717a', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];

/** Projekt-Einstellungen (WP7): Phasen, Verify, Automation, Merge-Modus, Editor. */
export function ProjectSettings({ project, onClose }: { project: Project; onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch);
  const [enabledPhases, setEnabledPhases] = useState<FeaturePhase[]>(project.enabledPhases);
  const [verifyCommands, setVerifyCommands] = useState<VerifyCommand[]>(project.verifyCommands);
  const [automation, setAutomation] = useState<Partial<AutomationSettings>>(project.automation);
  const [mergeMode, setMergeMode] = useState(project.mergeMode);
  const [editorCmd, setEditorCmd] = useState(project.editorCmd ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateProject(project.id, {
        name,
        color,
        defaultBranch,
        enabledPhases,
        verifyCommands: verifyCommands.filter((v) => v.name.trim() && v.command.trim()),
        automation,
        mergeMode,
        editorCmd: editorCmd.trim() || null,
      });
      const fresh = await api.state();
      dispatch({ type: 'bootstrap', state: fresh });
      onClose();
    } catch (e) {
      dispatch({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const togglePhase = (p: FeaturePhase) =>
    setEnabledPhases((cur) =>
      cur.includes(p) ? cur.filter((x) => x !== p) : FEATURE_PHASES.filter((x) => cur.includes(x) || x === p),
    );

  return (
    <Dialog title={`Einstellungen: ${project.name}`} onClose={onClose}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>

        <Field label="Farbe">
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded ${color === c ? 'ring-2 ring-zinc-300' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Field>

        <Field label="Default-Branch">
          <input value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} className={inputCls} />
        </Field>

        <Field label="Aktive Phasen">
          <div className="flex flex-wrap gap-2">
            {FEATURE_PHASES.map((p) => (
              <label key={p} className="flex items-center gap-1 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={enabledPhases.includes(p)}
                  disabled={p === 'specify' || p === 'implement'}
                  onChange={() => togglePhase(p)}
                  className="accent-emerald-600"
                />
                {p}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Verify-Kommandos (laufen im Worktree, Reihenfolge = Ausführung)">
          <div className="space-y-1.5">
            {verifyCommands.map((v, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  value={v.name}
                  onChange={(e) =>
                    setVerifyCommands((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                  placeholder="test"
                  className={`${inputCls} w-24`}
                />
                <input
                  value={v.command}
                  onChange={(e) =>
                    setVerifyCommands((cur) => cur.map((x, j) => (j === i ? { ...x, command: e.target.value } : x)))
                  }
                  placeholder="pnpm test"
                  className={inputCls}
                />
                <button
                  onClick={() => setVerifyCommands((cur) => cur.filter((_, j) => j !== i))}
                  className="rounded px-2 text-zinc-500 hover:bg-zinc-800"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => setVerifyCommands((cur) => [...cur, { name: '', command: '' }])}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              + Kommando
            </button>
          </div>
        </Field>

        <Field label="Automation (Override — leer = global erben)">
          <AutomationOverride value={automation} onChange={setAutomation} />
        </Field>

        <Field label="Merge-Modus">
          <select value={mergeMode} onChange={(e) => setMergeMode(e.target.value as 'ff' | 'squash')} className={inputCls}>
            <option value="ff">Fast-Forward (Historie des Features erhalten)</option>
            <option value="squash">Squash (ein Commit pro Feature)</option>
          </select>
        </Field>

        <Field label="Editor-Kommando ({file}/{line}-Platzhalter)">
          <input
            value={editorCmd}
            onChange={(e) => setEditorCmd(e.target.value)}
            placeholder="code -g {file}:{line}"
            className={inputCls}
          />
        </Field>

        <div className="border-t border-zinc-800 pt-3">
          <button
            onClick={() => {
              if (confirm(`Projekt „${project.name}" wirklich entfernen? (Repo bleibt unberührt)`)) {
                void api.removeProject(project.id).then(async () => {
                  const fresh = await api.state();
                  dispatch({ type: 'bootstrap', state: fresh });
                  onClose();
                });
              }
            }}
            className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-950"
          >
            Projekt entfernen …
          </button>
        </div>
      </div>
      <DialogActions busy={busy} onCancel={onClose} onSubmit={() => void save()} submitLabel="Speichern" />
    </Dialog>
  );
}

/** Tri-State-Override: erben (nicht gesetzt) / Level-2- / Level-3-Wert. */
function AutomationOverride({
  value,
  onChange,
}: {
  value: Partial<AutomationSettings>;
  onChange: (v: Partial<AutomationSettings>) => void;
}) {
  const preset = (p: Partial<AutomationSettings>) => onChange(p);
  const isL2 = JSON.stringify(value) === JSON.stringify(LEVEL2_DEFAULTS);
  const isL3 = JSON.stringify(value) === JSON.stringify(LEVEL3_DEFAULTS);
  const inherits = Object.keys(value).length === 0;
  return (
    <div className="flex gap-1.5">
      <PresetChip active={inherits} onClick={() => preset({})}>global erben</PresetChip>
      <PresetChip active={isL2} onClick={() => preset(LEVEL2_DEFAULTS)}>Level 2</PresetChip>
      <PresetChip active={isL3} onClick={() => preset(LEVEL3_DEFAULTS)}>Level 3</PresetChip>
    </div>
  );
}

export function PresetChip({
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
      className={`rounded px-2 py-1 text-xs ${active ? 'bg-emerald-800 text-emerald-100' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500';
