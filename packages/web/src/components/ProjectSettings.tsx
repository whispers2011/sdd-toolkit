import { useEffect, useState } from 'react';
import {
  FEATURE_PHASES,
  LEVEL2_DEFAULTS,
  LEVEL3_DEFAULTS,
  PORT_DEFAULTS,
  STACK_PROFILE_META,
  isStackConfigured,
  validateStackConfig,
  type AutomationSettings,
  type FeaturePhase,
  type OptimizationSettings,
  type Project,
  type StackConfig,
  type StackProfile,
  type StackService,
  type VerifyCommand,
} from '@sdd/shared';
import { api, type TelemetryStatus } from '../api.js';
import { useStore } from '../store.js';
import { ConfirmDialog, Dialog, DialogActions } from './Sidebar.js';

const COLORS = ['#71717a', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];

/** Projekt-Einstellungen (WP7): Phasen, Verify, Automation, Merge-Modus, Editor. */
/**
 * Zustand der Verbrauchsmessung (FR-019): Der Nutzer soll sehen können, welche
 * Quelle gerade misst und warum — und ob das Toolkit dabei eine eigene
 * OTel-Konfiguration übersteuert (research.md D5). Ohne diesen Hinweis wäre der
 * Umstieg nicht überprüfbar; genau das war die Vorgeschichte des 62-Mio.-Fehlers.
 */
function TelemetryStatusPanel() {
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void api
        .telemetryStatus()
        .then((s) => !cancelled && (setStatus(s), setFailed(false)))
        .catch(() => !cancelled && setFailed(true));
    load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (failed) {
    return (
      <p className="text-[11px] text-amber-400">
        Telemetrie-Erfassung nicht erreichbar — Läufe werden über das Transkript gemessen.
      </p>
    );
  }
  if (!status) return <p className="text-[11px] text-zinc-600">Lade …</p>;

  const running = status.active && status.reason === null;
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 ${running ? 'bg-teal-900 text-teal-200' : 'bg-zinc-800 text-zinc-400'}`}>
          {running ? 'CLI meldet Verbrauch' : 'noch keine Meldungen'}
        </span>
        <span className="text-zinc-600">
          {status.eventsReceived} Meldungen · Empfang {status.endpoint}
        </span>
      </div>
      {status.reason === 'no_events_yet' && (
        <p className="text-zinc-500">
          Noch nichts eingetroffen. Normal kurz nach dem Start; bleibt es dabei, unterstützt die
          installierte Claude-CLI die Telemetrie nicht — Läufe werden dann über das Transkript
          gemessen und entsprechend gekennzeichnet.
        </p>
      )}
      {status.reason === 'route_unavailable' && (
        <p className="text-amber-400">
          Empfangsroute nicht verfügbar — Läufe werden über das Transkript gemessen.
        </p>
      )}
      {status.overridesUserConfig && (
        <p className="text-amber-400">
          Es besteht eine eigene OpenTelemetry-Konfiguration. Für Sessions, die das Toolkit
          startet, wird sie übersteuert; selbst gestartete Sessions bleiben unberührt.
        </p>
      )}
      <p className="text-zinc-600">
        Erfasst werden nur Zähl- und Zuordnungsangaben, keine Prompt- oder Antworttexte. Die
        Daten bleiben auf diesem Rechner.
      </p>
    </div>
  );
}

/**
 * Stack-Profile eines Projekts (FR-011/FR-012). Das Toolkit bringt bewusst KEINE
 * Kommandos mit: ein Projekt ohne Konfiguration hat keinen Stack — sichtbar,
 * aber nicht blockierend (FR-013).
 *
 * Die Validierungssätze kommen aus derselben puren Funktion, die der Server
 * verwendet; hier und dort steht wortgleich dasselbe (contracts/http-api.md).
 */
function StackSection({ stack, onChange }: { stack: StackConfig; onChange: (s: StackConfig) => void }) {
  const errors = validateStackConfig(stack, PORT_DEFAULTS.blockSize);
  const setProfile = (name: 'test' | 'full' | 'down', patch: Partial<StackProfile>) =>
    onChange({
      ...stack,
      [name]: { command: '', sharedCommand: null, timeoutMs: null, ...(stack[name] ?? {}), ...patch },
    });
  const setService = (i: number, patch: Partial<StackService>) =>
    onChange({ ...stack, services: stack.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <Field label="Stack-Profile">
      {!isStackConfigured(stack) && (
        <p className="mb-2 text-xs text-zinc-500">
          Kein Stack konfiguriert. Das Toolkit bringt bewusst keine Kommandos mit — hinterlege die
          drei Profile deines Projekts.
        </p>
      )}

      <div className="space-y-3">
        {(['test', 'full', 'down'] as const).map((name) => (
          <div key={name} className="rounded border border-zinc-800 p-2">
            <p className="mb-1 text-xs font-medium text-zinc-300">
              {STACK_PROFILE_META[name].label}
              <span className="ml-2 font-normal text-zinc-500">{STACK_PROFILE_META[name].help}</span>
            </p>
            <textarea
              value={stack[name]?.command ?? ''}
              onChange={(e) => setProfile(name, { command: e.target.value })}
              rows={2}
              placeholder="Kommando (läuft im Worktree, Login-Shell)"
              className={`${inputCls} w-full font-mono`}
            />
            <input
              value={stack[name]?.sharedCommand ?? ''}
              onChange={(e) => setProfile(name, { sharedCommand: e.target.value || null })}
              placeholder="Kommando für geteilte Dienste — läuft projektweit genau einmal (optional)"
              className={`${inputCls} mt-1 w-full font-mono`}
            />
            <input
              type="number"
              min={1}
              value={stack[name]?.timeoutMs ? String((stack[name]!.timeoutMs ?? 0) / 60_000) : ''}
              onChange={(e) =>
                setProfile(name, { timeoutMs: e.target.value ? Number(e.target.value) * 60_000 : null })
              }
              placeholder="Zeitlimit in Minuten (leer = 15)"
              className={`${inputCls} mt-1 w-56`}
            />
          </div>
        ))}

        <input
          value={stack.stopCommand ?? ''}
          onChange={(e) => onChange({ ...stack, stopCommand: e.target.value || null })}
          placeholder="Kommando zum Anhalten — behält die Datenablagen (optional)"
          className={`${inputCls} w-full font-mono`}
        />
        <p className="text-xs text-zinc-500">
          Ohne dieses Kommando entfernt ein Neustart die Daten.
        </p>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-zinc-300">Dienste</p>
          {stack.services.map((svc, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <input
                value={svc.name}
                onChange={(e) => setService(i, { name: e.target.value })}
                placeholder="web"
                className={`${inputCls} w-28`}
              />
              <input
                type="number"
                value={svc.portOffset}
                onChange={(e) => setService(i, { portOffset: Number(e.target.value) })}
                className={`${inputCls} w-20`}
                title="Abstand zum Blockanfang"
              />
              {/* Die Ableitung sichtbar machen: Port = Blockanfang + Abstand. */}
              <span className="text-xs text-zinc-500">
                z. B. {PORT_DEFAULTS.start} + {svc.portOffset} = {PORT_DEFAULTS.start + svc.portOffset}
              </span>
              <select
                value={svc.scope}
                onChange={(e) => setService(i, { scope: e.target.value === 'shared' ? 'shared' : 'feature' })}
                className={`${inputCls} w-32`}
              >
                <option value="feature">feature-eigen</option>
                <option value="shared">geteilt</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={svc.stateful}
                  onChange={(e) => setService(i, { stateful: e.target.checked })}
                />
                zustandsbehaftet
              </label>
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={svc.primary}
                  onChange={(e) => setService(i, { primary: e.target.checked })}
                />
                Haupteingang
              </label>
              <button
                onClick={() => onChange({ ...stack, services: stack.services.filter((_, j) => j !== i) })}
                className="rounded px-2 text-zinc-500 hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              onChange({
                ...stack,
                services: [
                  ...stack.services,
                  { name: '', portOffset: stack.services.length, scope: 'feature', stateful: false, primary: false },
                ],
              })
            }
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            + Dienst
          </button>
        </div>

        {errors.length > 0 && (
          <ul className="space-y-0.5 text-xs text-red-400">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

export function ProjectSettings({ project, onClose }: { project: Project; onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch);
  const [enabledPhases, setEnabledPhases] = useState<FeaturePhase[]>(project.enabledPhases);
  const [verifyCommands, setVerifyCommands] = useState<VerifyCommand[]>(project.verifyCommands);
  const [automation, setAutomation] = useState<Partial<AutomationSettings>>(project.automation);
  const [optimization, setOptimization] = useState<Partial<OptimizationSettings>>(project.optimization);
  const [mergeMode, setMergeMode] = useState(project.mergeMode);
  const [integrationMode, setIntegrationMode] = useState(project.integrationMode);
  const [editorCmd, setEditorCmd] = useState(project.editorCmd ?? '');
  const [stack, setStack] = useState<StackConfig>(project.stack);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

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
        optimization,
        mergeMode,
        integrationMode,
        editorCmd: editorCmd.trim() || null,
        stack,
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

        <StackSection stack={stack} onChange={setStack} />

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

        <Field label="Token-Reduktion (Override — leer = global erben)">
          <div className="flex gap-2">
            <select
              value={optimization.contextStrategy ?? ''}
              onChange={(e) => {
                const next = { ...optimization };
                if (e.target.value) next.contextStrategy = e.target.value as OptimizationSettings['contextStrategy'];
                else delete next.contextStrategy;
                setOptimization(next);
              }}
              className={inputCls}
            >
              <option value="">Kontext: global erben</option>
              <option value="full">Kontext: voll</option>
              <option value="compact">Kontext: compact</option>
              <option value="fresh">Kontext: fresh</option>
            </select>
            <select
              value={optimization.compression ?? ''}
              onChange={(e) => {
                const next = { ...optimization };
                if (e.target.value) next.compression = e.target.value as OptimizationSettings['compression'];
                else delete next.compression;
                setOptimization(next);
              }}
              className={inputCls}
            >
              <option value="">Verdichtung: global erben</option>
              <option value="off">Verdichtung: aus</option>
              <option value="deterministic">Verdichtung: deterministisch</option>
              <option value="llm">Verdichtung: LLM</option>
            </select>
          </div>
        </Field>

        <Field label="Verbrauchsmessung">
          <TelemetryStatusPanel />
        </Field>

        <Field label="Integration">
          <select
            value={integrationMode}
            onChange={(e) => setIntegrationMode(e.target.value as 'local' | 'pr')}
            className={inputCls}
          >
            <option value="local">Lokal auf {defaultBranch} mergen</option>
            <option value="pr">GitHub-PR erstellen (gh CLI)</option>
          </select>
        </Field>

        {integrationMode === 'local' && (
          <Field label="Merge-Modus">
            <select value={mergeMode} onChange={(e) => setMergeMode(e.target.value as 'ff' | 'squash')} className={inputCls}>
              <option value="ff">Fast-Forward (Historie des Features erhalten)</option>
              <option value="squash">Squash (ein Commit pro Feature)</option>
            </select>
          </Field>
        )}

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
            onClick={() => setConfirmRemove(true)}
            className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-950"
          >
            Projekt entfernen …
          </button>
        </div>
      </div>
      <DialogActions busy={busy} onCancel={onClose} onSubmit={() => void save()} submitLabel="Speichern" />
      {confirmRemove && (
        <ConfirmDialog
          title="Projekt entfernen"
          message={`„${project.name}" aus dem Toolkit entfernen?\n\nDas Git-Repo bleibt unberührt. Features, Phasen-Status und Läufe dieses Projekts werden aus der Toolkit-Datenbank gelöscht.`}
          confirmLabel="Entfernen"
          onConfirm={() =>
            void api.removeProject(project.id).then(async () => {
              const fresh = await api.state();
              dispatch({ type: 'bootstrap', state: fresh });
              onClose();
            })
          }
          onClose={() => setConfirmRemove(false)}
        />
      )}
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
