import { useState } from 'react';
import { FEATURE_PHASES, LEVEL2_DEFAULTS, LEVEL3_DEFAULTS, type AutomationSettings } from '@sdd/shared';
import { api } from '../api.js';
import { setSoundEnabled, soundEnabled, useStore } from '../store.js';

/** Automation-Dial: Level 2 ↔ Level 3, jede Automation einzeln schaltbar. */
export function AutomationDial() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  if (!state.app) return null;

  const a = state.app.automation;
  const isLevel3 = a.autoProgressUntil !== 'off' && a.autoVerify && a.autoMerge;

  const apply = (patch: Partial<AutomationSettings>) =>
    api
      .setAutomation(patch)
      .then((automation) => dispatch({ type: 'bootstrap', state: { ...state.app!, automation } }))
      .catch((e: Error) => dispatch({ type: 'error', message: e.message }));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
      >
        <span className={`status-dot ${isLevel3 ? 'status-working' : 'status-idle'}`} />
        Automation: {isLevel3 ? 'Level 3' : a.autoProgressUntil !== 'off' ? 'Teilauto' : 'Level 2'}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <div className="mb-3 flex gap-2">
            <PresetButton onClick={() => void apply(LEVEL2_DEFAULTS)} active={!isLevel3 && a.autoProgressUntil === 'off'}>
              Level 2 — Orchestrator
            </PresetButton>
            <PresetButton onClick={() => void apply(LEVEL3_DEFAULTS)} active={isLevel3}>
              Level 3 — Autonomie
            </PresetButton>
          </div>

          <label className="mb-2 block text-xs text-zinc-400">
            Auto-Progression bis Phase
            <select
              value={a.autoProgressUntil}
              onChange={(e) =>
                void apply({ autoProgressUntil: e.target.value as AutomationSettings['autoProgressUntil'] })
              }
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
            >
              <option value="off">aus — jede Phase manuell (Level 2)</option>
              {FEATURE_PHASES.map((p) => (
                <option key={p} value={p}>
                  bis {p}
                </option>
              ))}
            </select>
          </label>

          <Toggle
            label="Auto-Verify (Tests/Build/Lint nach implement)"
            checked={a.autoVerify}
            onChange={(v) => void apply({ autoVerify: v })}
          />
          <Toggle
            label="Review-Agents (Code/Security, P1)"
            checked={a.autoReviewAgents}
            onChange={(v) => void apply({ autoReviewAgents: v })}
          />
          <Toggle
            label="Auto-Merge (Queue mit Konfliktauflösung)"
            checked={a.autoMerge}
            onChange={(v) => void apply({ autoMerge: v })}
          />
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <SoundToggle />
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            Gilt global; pro Projekt/Feature überschreibbar (⚙ am Projekt / an der Karte).
          </p>
        </div>
      )}
    </div>
  );
}

function PresetButton({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${
        active ? 'bg-emerald-800 text-emerald-100' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
      }`}
    >
      {children}
    </button>
  );
}

function SoundToggle() {
  const [on, setOn] = useState(soundEnabled());
  return (
    <Toggle
      label="Sound wenn ein Agent fertig ist"
      checked={on}
      onChange={(v) => {
        setSoundEnabled(v);
        setOn(v);
      }}
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-emerald-600"
      />
      {label}
    </label>
  );
}
