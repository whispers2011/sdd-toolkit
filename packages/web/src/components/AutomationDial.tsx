import { useEffect, useState } from 'react';
import { FEATURE_PHASES, LEVEL2_DEFAULTS, LEVEL3_DEFAULTS, type AutomationSettings } from '@sdd/shared';
import { api } from '../api.js';
import { setSoundEnabled, soundEnabled, useStore } from '../store.js';
import { setVoiceLang, setVoiceProvider, voiceLang, voiceProvider } from './VoiceButton.js';

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
            <VoiceSettings />
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

/** Voice-Provider (WP15): Web Speech zero-config oder Whisper/Groq mit Server-Key. */
function VoiceSettings() {
  const { dispatch } = useStore();
  const [provider, setProvider] = useState<'webspeech' | 'api'>(voiceProvider());
  const [apiProvider, setApiProvider] = useState<'openai' | 'groq'>('openai');
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState('');
  const [lang, setLang] = useState(voiceLang());

  useEffect(() => {
    void api.getTranscription().then((r) => {
      if (r.provider) setApiProvider(r.provider);
      setHasKey(r.hasKey);
    }).catch(() => {});
  }, []);

  const saveKey = () =>
    void api
      .setTranscription(apiProvider, key.trim() || undefined, lang.split('-')[0] ?? 'de')
      .then(() => {
        setHasKey(true);
        setKey('');
      })
      .catch((e: Error) => dispatch({ type: 'error', message: e.message }));

  return (
    <div className="mt-2 space-y-1.5">
      <label className="block text-xs text-zinc-400">
        Voice-Eingabe (🎙 / ⌘⇧M)
        <select
          value={provider}
          onChange={(e) => {
            const p = e.target.value as 'webspeech' | 'api';
            setProvider(p);
            setVoiceProvider(p);
          }}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
        >
          <option value="webspeech">Web Speech API (ohne Konfiguration)</option>
          <option value="api">Whisper / Groq (bessere Qualität, API-Key)</option>
        </select>
      </label>
      <label className="block text-xs text-zinc-400">
        Sprache
        <input
          value={lang}
          onChange={(e) => {
            setLang(e.target.value);
            setVoiceLang(e.target.value);
          }}
          placeholder="de-CH"
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
        />
      </label>
      {provider === 'api' && (
        <div className="space-y-1.5">
          <select
            value={apiProvider}
            onChange={(e) => setApiProvider(e.target.value as 'openai' | 'groq')}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
          >
            <option value="openai">OpenAI Whisper</option>
            <option value="groq">Groq (whisper-large-v3)</option>
          </select>
          <div className="flex gap-1.5">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={hasKey ? '••••••••  (gespeichert)' : 'API-Key'}
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
            />
            <button
              onClick={saveKey}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              Speichern
            </button>
          </div>
          <p className="text-xs text-zinc-600">Key bleibt serverseitig — geht nie an den Browser.</p>
        </div>
      )}
    </div>
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
