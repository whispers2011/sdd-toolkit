import { useEffect, useState } from 'react';
import {
  FEATURE_PHASES,
  LEVEL2_DEFAULTS,
  LEVEL3_DEFAULTS,
  type AutomationSettings,
  type OptimizationSettings,
} from '@sdd/shared';
import { api } from '../api.js';
import { setSoundEnabled, soundEnabled, useStore } from '../store.js';
import { setVoiceLang, setVoiceProvider, voiceLang, voiceProvider } from './VoiceButton.js';
import { InfoIcon } from './icons.js';

/** Erklärung einer Einstellung: wie sie arbeitet und was sie konkret bewirkt. */
interface Explanation {
  how: string;
  effect: string;
}

/**
 * Wortlaut der Info-Texte an einer Stelle — beschreibt das tatsächliche Verhalten
 * (Phasen-Maschine, Merge-Queue, Session-Start, Kontext-Optimierer), nicht die Absicht.
 */
const INFO: Record<string, Explanation> = {
  presets: {
    how: 'Zwei Voreinstellungen für alle Schalter darunter. „Du steuerst" hält den Ablauf nach jeder Phase an. „Läuft durch" lässt ein Feature von der Spezifikation bis zum Merge selbstständig laufen.',
    effect:
      'Setzt alle Schalter auf einmal. Danach kannst du jeden einzeln nachjustieren — die Anzeige oben wechselt dann auf „Gemischt".',
  },
  autoProgressUntil: {
    how: 'Ist eine Phase abgeschlossen, gibt das Toolkit sie frei und startet die nächste selbst — bis einschließlich der hier gewählten Phase. Danach hält der Ablauf an und wartet auf deine Freigabe.',
    effect:
      'Reihenfolge: specify → clarify → plan → checklist → analyze → tasks → implement. Steht hier „plan", laufen specify, clarify und plan am Stück; vor tasks stoppt es. Bei „aus" startest du jede Phase selbst.',
  },
  autoVerify: {
    how: 'Nach der letzten Phase laufen die Verify-Kommandos des Projekts (Test/Build/Lint) automatisch in der Arbeitskopie des Features.',
    effect:
      'Grün → das Feature geht weiter zum Review bzw. in die Merge-Queue. Rot → es stoppt und meldet sich unter „Braucht dich"; nichts wird gemergt. Hat das Projekt keine Verify-Kommandos hinterlegt, passiert nichts.',
  },
  autoReviewAgents: {
    how: 'Vor dem Merge laufen die Review-Agents (z. B. Code-Review, Security-Review) headless über den Diff des Feature-Branches und schreiben ihren Bericht ins Feature.',
    effect:
      'Ein blockierender Agent mit FAIL stoppt den Merge und meldet sich; beratende Agents werden nur protokolliert. Kostet zusätzliche Tokens pro Feature. Welche Agents laufen, legst du je Projekt unter „Agents" fest.',
  },
  autoMerge: {
    how: 'Verifizierte Features wandern selbstständig in die Merge-Queue: Rebase auf den Ziel-Branch, dann Merge in den Haupt-Checkout.',
    effect:
      'Konflikte versucht das Toolkit selbst aufzulösen; gelingt das nicht, eskaliert es unter „Braucht dich". Ausgeschaltet bleibt das Feature auf „Review fällig" stehen und wartet auf deinen Merge-Klick.',
  },
  autoMode: {
    how: 'Bestimmt, wie die Claude-Session startet: eingeschaltet ohne Rückfragen (bypassPermissions), ausgeschaltet nur mit erlaubten Dateiänderungen (acceptEdits).',
    effect:
      'Aus bedeutet: Der Agent fragt vor jedem Kommando nach — du antwortest in der Feature-Konsole, solange bleibt der Lauf stehen. Die Änderung greift erst beim nächsten Session-Start, nicht in einer laufenden Session.',
  },
  contextStrategy: {
    how: 'Steuert, wie viel Gesprächsverlauf eine Phase von der vorherigen erbt. Vor jeder Downstream-Phase setzt das Toolkit den Kontext entsprechend zurück.',
    effect:
      '„voll" behält alles (teuerste Variante). „compact" fasst den Verlauf via /compact zusammen. „fresh" leert ihn via /clear — die Phase liest ihren Kontext aus den Artefakten auf der Platte neu und spart am meisten. Die erste Phase wird nie zurückgesetzt; fehlt spec.md, fällt das Toolkit auf „voll" zurück.',
  },
  compression: {
    how: 'Kürzt die Wissens-Präambel, die das Toolkit selbst in jeden Phasen-Prompt schreibt — nicht deinen Code und nicht die Artefakte.',
    effect:
      '„deterministisch" kürzt lokal und kostenlos; das Ergebnis wird nur übernommen, wenn es wirklich kleiner ist. „LLM" lässt zusätzlich ein Modell zusammenfassen, aber erst ab ~1500 Tokens Präambel — darunter würde der Aufruf mehr kosten als er spart und es bleibt deterministisch.',
  },
  sound: {
    how: 'Spielt lokal einen kurzen Ton, sobald ein Agent seinen Turn beendet hat.',
    effect: 'Rein im Browser, keine Server-Einstellung. Betrifft nur dieses Gerät.',
  },
  voice: {
    how: 'Diktierfunktion für Eingabefelder (Mikrofon-Knopf oder ⌘⇧M).',
    effect:
      '„Web Speech" nutzt die Erkennung des Browsers — sofort einsatzbereit, wechselnde Qualität. „Whisper/Groq" schickt die Aufnahme an den gewählten Dienst und braucht einen API-Key; der bleibt auf dem Server und geht nie an den Browser.',
  },
};

/** Automation-Dial: Voreinstellung wählen oder jeden Schalter einzeln setzen. */
export function AutomationDial() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  if (!state.app) return null;

  const a = state.app.automation;
  const isLevel3 = a.autoProgressUntil !== 'off' && a.autoVerify && a.autoMerge;
  const isLevel2 = !isLevel3 && a.autoProgressUntil === 'off' && !a.autoVerify && !a.autoMerge;
  const levelLabel = isLevel3 ? 'Level 3' : isLevel2 ? 'Level 2' : 'Gemischt';

  const toggleInfo = (id: string) => setInfo((cur) => (cur === id ? null : id));

  const apply = (patch: Partial<AutomationSettings>) =>
    api
      .setAutomation(patch)
      .then((automation) => dispatch({ type: 'bootstrap', state: { ...state.app!, automation } }))
      .catch((e: Error) => dispatch({ type: 'error', message: e.message }));

  const opt = state.app.optimization;
  const applyOpt = (patch: Partial<OptimizationSettings>) =>
    api
      .setOptimization(patch)
      .then((r) => dispatch({ type: 'bootstrap', state: { ...state.app!, optimization: r.optimization } }))
      .catch((e: Error) => dispatch({ type: 'error', message: e.message }));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
      >
        <span className={`status-dot ${isLevel3 ? 'status-working' : 'status-idle'}`} />
        Automation: {levelLabel}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 max-h-[calc(100vh-5rem)] w-[26rem] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <Section title="Voreinstellung" id="presets" openInfo={info} onInfo={toggleInfo}>
            <div className="flex gap-2">
              <PresetButton onClick={() => void apply(LEVEL2_DEFAULTS)} active={isLevel2}>
                Level 2
                <span className="block text-[10px] font-normal opacity-80">Du gibst jede Phase frei</span>
              </PresetButton>
              <PresetButton onClick={() => void apply(LEVEL3_DEFAULTS)} active={isLevel3}>
                Level 3
                <span className="block text-[10px] font-normal opacity-80">Läuft bis zum Merge durch</span>
              </PresetButton>
            </div>
          </Section>

          <Section title="Ablauf">
            <SelectSetting
              id="autoProgressUntil"
              label="Phasen automatisch weiterlaufen"
              value={a.autoProgressUntil}
              onChange={(v) => void apply({ autoProgressUntil: v as AutomationSettings['autoProgressUntil'] })}
              openInfo={info}
              onInfo={toggleInfo}
              options={[
                { value: 'off', label: 'aus — jede Phase startest du' },
                ...FEATURE_PHASES.map((p) => ({ value: p, label: `bis ${p}` })),
              ]}
            />
          </Section>

          <Section title="Abschluss & Merge">
            <ToggleSetting
              id="autoVerify"
              label="Verifikation automatisch"
              checked={a.autoVerify}
              onChange={(v) => void apply({ autoVerify: v })}
              openInfo={info}
              onInfo={toggleInfo}
            />
            <ToggleSetting
              id="autoReviewAgents"
              label="Review-Agents vor dem Merge"
              checked={a.autoReviewAgents}
              onChange={(v) => void apply({ autoReviewAgents: v })}
              openInfo={info}
              onInfo={toggleInfo}
            />
            <ToggleSetting
              id="autoMerge"
              label="Automatisch mergen"
              checked={a.autoMerge}
              onChange={(v) => void apply({ autoMerge: v })}
              openInfo={info}
              onInfo={toggleInfo}
            />
            <ToggleSetting
              id="autoMode"
              label="Ohne Rückfragen arbeiten"
              checked={a.autoMode}
              onChange={(v) => void apply({ autoMode: v })}
              openInfo={info}
              onInfo={toggleInfo}
            />
          </Section>

          <Section title="Token-Verbrauch">
            <SelectSetting
              id="contextStrategy"
              label="Kontext je Phase"
              value={opt.contextStrategy}
              onChange={(v) => void applyOpt({ contextStrategy: v as OptimizationSettings['contextStrategy'] })}
              openInfo={info}
              onInfo={toggleInfo}
              options={[
                { value: 'full', label: 'voll — nichts zurücksetzen' },
                { value: 'compact', label: 'compact — Verlauf zusammenfassen' },
                { value: 'fresh', label: 'fresh — Verlauf leeren (spart am meisten)' },
              ]}
            />
            <SelectSetting
              id="compression"
              label="Wissens-Präambel kürzen"
              value={opt.compression}
              onChange={(v) => void applyOpt({ compression: v as OptimizationSettings['compression'] })}
              openInfo={info}
              onInfo={toggleInfo}
              options={[
                { value: 'off', label: 'aus' },
                { value: 'deterministic', label: 'deterministisch — lokal, kostenlos' },
                { value: 'llm', label: 'LLM — nur bei Netto-Ersparnis' },
              ]}
            />
          </Section>

          <Section title="Meldungen & Eingabe">
            <SoundToggle openInfo={info} onInfo={toggleInfo} />
            <VoiceSettings openInfo={info} onInfo={toggleInfo} />
          </Section>

          <p className="mt-3 border-t border-zinc-800 pt-2 text-xs text-zinc-600">
            Gilt global. Einzelne Projekte und Features können davon abweichen — über ⚙ am Projekt bzw. an der
            Feature-Karte.
          </p>
        </div>
      )}
    </div>
  );
}

/** Abschnitt mit Überschrift; optional mit eigenem Info-Text. */
function Section({
  title,
  children,
  id,
  openInfo,
  onInfo,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
  openInfo?: string | null;
  onInfo?: (id: string) => void;
}) {
  return (
    <div className="mt-3 border-t border-zinc-800 pt-2.5 first:mt-0 first:border-0 first:pt-0">
      <div className="mb-1.5 flex items-center gap-1.5">
        <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">{title}</p>
        {id && onInfo && <InfoButton active={openInfo === id} onClick={() => onInfo(id)} label={title} />}
      </div>
      {id && openInfo === id && <Explain {...INFO[id]!} />}
      {children}
    </div>
  );
}

/** „Was macht das?"-Knopf — öffnet die Erklärung direkt unter der Einstellung. */
function InfoButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={active ? 'Erklärung ausblenden' : `Was bewirkt „${label}"?`}
      aria-expanded={active}
      className={`shrink-0 rounded p-0.5 text-[13px] ${
        active ? 'text-emerald-400' : 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300'
      }`}
    >
      <InfoIcon />
    </button>
  );
}

function Explain({ how, effect }: Explanation) {
  return (
    <div className="my-1.5 rounded border border-zinc-800 bg-zinc-950/60 p-2.5 text-xs leading-relaxed text-zinc-400">
      <p>{how}</p>
      <p className="mt-1.5">
        <span className="font-medium text-zinc-500">Wirkung: </span>
        {effect}
      </p>
    </div>
  );
}

function ToggleSetting({
  id,
  label,
  checked,
  onChange,
  openInfo,
  onInfo,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  openInfo: string | null;
  onInfo: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 py-0.5">
        <input
          id={`auto-${id}`}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-emerald-600"
        />
        <label htmlFor={`auto-${id}`} className="flex-1 cursor-pointer text-sm text-zinc-300">
          {label}
        </label>
        <InfoButton active={openInfo === id} onClick={() => onInfo(id)} label={label} />
      </div>
      {openInfo === id && <Explain {...INFO[id]!} />}
    </div>
  );
}

function SelectSetting({
  id,
  label,
  value,
  onChange,
  options,
  openInfo,
  onInfo,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  openInfo: string | null;
  onInfo: (id: string) => void;
}) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={`auto-${id}`} className="flex-1 text-sm text-zinc-300">
          {label}
        </label>
        <InfoButton active={openInfo === id} onClick={() => onInfo(id)} label={label} />
      </div>
      <select
        id={`auto-${id}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {openInfo === id && <Explain {...INFO[id]!} />}
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
function VoiceSettings({ openInfo, onInfo }: { openInfo: string | null; onInfo: (id: string) => void }) {
  const { dispatch } = useStore();
  const [provider, setProvider] = useState<'webspeech' | 'api'>(voiceProvider());
  const [apiProvider, setApiProvider] = useState<'openai' | 'groq'>('openai');
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState('');
  const [lang, setLang] = useState(voiceLang());

  useEffect(() => {
    void api
      .getTranscription()
      .then((r) => {
        if (r.provider) setApiProvider(r.provider);
        setHasKey(r.hasKey);
      })
      .catch(() => {});
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
    <div className="mt-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor="auto-voice" className="flex-1 text-sm text-zinc-300">
          Spracheingabe
        </label>
        <InfoButton active={openInfo === 'voice'} onClick={() => onInfo('voice')} label="Spracheingabe" />
      </div>
      {openInfo === 'voice' && <Explain {...INFO.voice!} />}
      <select
        id="auto-voice"
        value={provider}
        onChange={(e) => {
          const p = e.target.value as 'webspeech' | 'api';
          setProvider(p);
          setVoiceProvider(p);
        }}
        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
      >
        <option value="webspeech">Web Speech — ohne Konfiguration</option>
        <option value="api">Whisper / Groq — bessere Qualität, API-Key</option>
      </select>
      <input
        value={lang}
        onChange={(e) => {
          setLang(e.target.value);
          setVoiceLang(e.target.value);
        }}
        placeholder="Sprache, z. B. de-CH"
        className="mt-1.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
      />
      {provider === 'api' && (
        <div className="mt-1.5 space-y-1.5">
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
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
            />
            <button
              onClick={saveKey}
              className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              Speichern
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SoundToggle({ openInfo, onInfo }: { openInfo: string | null; onInfo: (id: string) => void }) {
  const [on, setOn] = useState(soundEnabled());
  return (
    <ToggleSetting
      id="sound"
      label="Ton, wenn ein Agent fertig ist"
      checked={on}
      onChange={(v) => {
        setSoundEnabled(v);
        setOn(v);
      }}
      openInfo={openInfo}
      onInfo={onInfo}
    />
  );
}
