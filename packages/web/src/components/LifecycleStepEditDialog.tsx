import { useState } from 'react';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  FEATURE_PHASES,
  INTEGRATION_STAGE_IDS,
  LIFECYCLE_TRIGGER_KINDS,
  LIFECYCLE_TRIGGER_META,
  PHASE_META,
  stageTitle,
} from '@sdd/shared';
import type {
  FeaturePhase,
  LifecycleStageId,
  LifecycleStep,
  LifecycleTrigger,
  LifecycleTriggerKind,
} from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Dialog } from './Sidebar.js';

const DEFAULT_TIMEOUT_MINUTES = DEFAULT_STEP_TIMEOUT_MS / 60_000;

/**
 * Anlegen/Bearbeiten eines Lebenszyklus-Schritts (Geltungsbereich nur bei Neuanlage
 * wählbar). Auslöser, Phase und Stufe kommen ausschließlich aus den getypten
 * Katalogen in @sdd/shared — eine neue Auslöser-Art erscheint hier automatisch.
 */
export function LifecycleStepEditDialog({
  step,
  projectId,
  initialTrigger,
  onClose,
  onSaved,
}: {
  step: LifecycleStep | null;
  /** Geltungsbereich der Neuanlage (null = global); bei Bearbeitung fix. */
  projectId: string | null;
  /** Auslöser für die Neuanlage vorbelegen (z. B. „+" an einem Punkt der Übersicht). */
  initialTrigger?: LifecycleTrigger;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { dispatch } = useStore();
  const [name, setName] = useState(step?.name ?? '');
  const [command, setCommand] = useState(step?.command ?? '');
  const [kind, setKind] = useState<LifecycleTriggerKind>(
    step?.trigger.kind ?? initialTrigger?.kind ?? 'after_worktree_create',
  );
  const [phase, setPhase] = useState<FeaturePhase>(
    step?.trigger.phase ?? initialTrigger?.phase ?? 'plan',
  );
  const [stage, setStage] = useState<LifecycleStageId>(
    step?.trigger.stage ?? initialTrigger?.stage ?? 'verify',
  );
  // Leer = Vorgabewert; der Platzhalter nennt ihn, damit niemand raten muss.
  const [minutes, setMinutes] = useState(
    step?.timeoutMs != null ? String(step.timeoutMs / 60_000) : '',
  );
  const [blocking, setBlocking] = useState(step?.blocking ?? true);
  const [enabled, setEnabled] = useState(step?.enabled ?? true);
  const [busy, setBusy] = useState(false);

  const needsPhase = kind === 'before_phase' || kind === 'after_phase';
  const needsStage = kind === 'before_stage' || kind === 'after_stage';
  const timeoutValid = minutes.trim() === '' || (Number(minutes) > 0 && Number(minutes) <= 1440);
  const valid = name.trim().length > 0 && command.trim().length > 0 && timeoutValid;

  const save = () => {
    if (!valid) return;
    setBusy(true);
    const trigger: LifecycleTrigger = needsPhase
      ? { kind, phase }
      : needsStage
        ? { kind, stage }
        : { kind };
    void api
      .saveLifecycleStep({
        ...(step ? { id: step.id } : {}),
        projectId: step ? step.projectId : projectId,
        name: name.trim(),
        command,
        trigger,
        blocking,
        timeoutMs: minutes.trim() === '' ? null : Math.round(Number(minutes) * 60_000),
        enabled,
        sortOrder: step?.sortOrder ?? 99,
      })
      .then(onSaved)
      .catch((e: Error) => dispatch({ type: 'error', message: e.message }))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog title={step ? `Schritt bearbeiten: ${step.name}` : 'Schritt anlegen'} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 text-xs text-zinc-400">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
          />
        </label>
        <label className="col-span-2 text-xs text-zinc-400">
          Kommando
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            rows={4}
            spellCheck={false}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs leading-5 text-zinc-200 outline-none focus:border-zinc-500"
          />
          <span className="mt-1 block leading-relaxed text-zinc-600">
            Läuft in einer Login-Shell im Worktree. Verfügbar: <code>$SDD_WORKTREE</code>,{' '}
            <code>$SDD_PROJECT</code>, <code>$SDD_FEATURE</code>, <code>$SDD_BRANCH</code>,{' '}
            <code>$SDD_PHASE</code>, <code>$SDD_STAGE</code> — nicht zutreffende Angaben sind leer.
            Bewertet werden nur Exit-Code und Zeitlimit; die Ausgabe wird nicht ausgewertet.
          </span>
        </label>
        <label className="col-span-1 text-xs text-zinc-400">
          Auslöser
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as LifecycleTriggerKind)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
          >
            {LIFECYCLE_TRIGGER_KINDS.map((k) => (
              <option key={k} value={k}>
                {LIFECYCLE_TRIGGER_META[k].title}
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
                  {PHASE_META[p].label}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsStage && (
          <label className="col-span-1 text-xs text-zinc-400">
            Stufe
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as LifecycleStageId)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
            >
              {INTEGRATION_STAGE_IDS.map((s) => (
                <option key={s} value={s}>
                  {stageTitle(s)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="col-span-1 text-xs text-zinc-400">
          Zeitlimit (Minuten) <span className="text-zinc-600">(leer = {DEFAULT_TIMEOUT_MINUTES})</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder={String(DEFAULT_TIMEOUT_MINUTES)}
            className={`mt-1 w-full rounded border bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500 ${
              timeoutValid ? 'border-zinc-700' : 'border-red-800'
            }`}
          />
        </label>
        <div className="col-span-2 flex items-center gap-6 text-xs text-zinc-400">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
            Blockierend <span className="text-zinc-600">(Fehlschlag hält die Stufe an; sonst nur Hinweis)</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Aktiv
          </label>
          {!step && (
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
