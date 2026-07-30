import { useCallback, useEffect, useState } from 'react';
import {
  INTEGRATION_STAGE_META,
  INTEGRATION_TONE_CLASS,
  evaluateAction,
  type TestingLaneEntry,
  type TestingLaneView,
} from '@sdd/shared';
import { api } from '../api.js';
import { featureActionContext, useStore } from '../store.js';
import { ActionButton, ActionGroup, blockedReason, useAction } from './FeatureAction.js';
import { ServiceList, StackPanel } from './StackPanel.js';
import { FlaskIcon, RefreshIcon } from './icons.js';

/**
 * Testing-Lane: die Ansicht, für die dieses Feature gebaut wurde — ein Mensch
 * öffnet die laufende Anwendung, klickt sie durch und nimmt sie ab, bevor
 * gemergt wird.
 *
 * Die fünf Pflichtangaben stehen in EINER Ansicht (SC-009): Worktree-Pfad,
 * Branch, Adresse, Anlagedatum und je Dienst Status samt Port. Die Adresse kommt
 * ausschließlich aus `FeatureStackView.url` — die Oberfläche rechnet keine Ports
 * (FR-031, SC-002).
 */
export function TestingLane() {
  const { state, dispatch } = useStore();
  const projectId = state.selectedProjectId;
  const [lane, setLane] = useState<TestingLaneView | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (!projectId) return;
      setLoading(true);
      try {
        const view = await api.testingLane(projectId, refresh);
        setLane(view);
        // Der erhobene Zustand füttert die Aktions-Policy — dieselbe Quelle wie
        // im StackPanel, kein zweiter Abruf.
        for (const e of [...view.awaitingManualTest, ...view.running]) {
          dispatch({ type: 'stack_probed', payload: { featureId: e.featureId, stack: e.stack } });
        }
      } catch (err) {
        dispatch({ type: 'error', message: (err as Error).message });
      } finally {
        setLoading(false);
      }
    },
    [dispatch, projectId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!projectId) {
    return <p className="p-6 text-sm text-zinc-400">Kein Projekt ausgewählt.</p>;
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center gap-3">
        <FlaskIcon className="text-amber-400" />
        <h1 className="text-lg font-medium text-zinc-100">Testing-Lane</h1>
        <button
          type="button"
          className="ml-auto flex items-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
          onClick={() => void load(true)}
        >
          <RefreshIcon />
          {loading ? 'wird erhoben …' : 'Aktualisieren'}
        </button>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-300">Wartet auf Abnahme</h2>
        {lane === null ? (
          <p className="text-sm text-zinc-500">wird geladen …</p>
        ) : lane.awaitingManualTest.length === 0 ? (
          <p className="text-sm text-zinc-500">Nichts wartet auf eine Abnahme.</p>
        ) : (
          lane.awaitingManualTest.map((e) => (
            <LaneCard key={e.featureId} entry={e} onChanged={() => void load(true)} decidable />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-300">Läuft gerade</h2>
        {lane === null ? null : lane.running.length === 0 ? (
          <p className="text-sm text-zinc-500">Kein Stack läuft.</p>
        ) : (
          lane.running.map((e) => (
            <LaneCard key={e.featureId} entry={e} onChanged={() => void load(true)} decidable={false} />
          ))
        )}
      </section>
    </div>
  );
}

function LaneCard({
  entry,
  decidable,
  onChanged,
}: {
  entry: TestingLaneEntry;
  decidable: boolean;
  onChanged: () => void;
}) {
  const { state } = useStore();
  const run = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const ctx = featureActionContext(state, entry.featureId);
  const confirm = ctx ? evaluateAction('manual_test_confirm', ctx) : null;
  const reject = ctx ? evaluateAction('manual_test_reject', ctx) : null;
  const stageMeta = INTEGRATION_STAGE_META[entry.stage];

  const doConfirm = () => {
    const next = state.app?.features.find((f) => f.id === entry.featureId);
    const auto = next?.automation.autoMerge === true;
    const text = auto
      ? 'Danach geht das Feature in die Merge-Queue. Abnahme bestätigen?'
      : 'Danach geht das Feature in das menschliche Review. Abnahme bestätigen?';
    if (!window.confirm(text)) return;
    run(`manual-test:confirm:${entry.featureId}`, async () => {
      await api.confirmManualTest(entry.featureId);
      onChanged();
    });
  };

  const doReject = () => {
    run(`manual-test:reject:${entry.featureId}`, async () => {
      await api.rejectManualTest(entry.featureId, reason);
      setRejecting(false);
      setReason('');
      onChanged();
    });
  };

  return (
    <article className="rounded border border-zinc-800 bg-zinc-900/50 p-4">
      <header className="mb-3 flex items-baseline gap-3">
        <h3 className="font-medium text-zinc-100">{entry.featureName}</h3>
        <span className={`ml-auto text-xs ${INTEGRATION_TONE_CLASS[stageMeta.tone]}`}>
          {stageMeta.label}
        </span>
      </header>

      <dl className="mb-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
        <dt className="text-zinc-500">Branch</dt>
        <dd className="font-mono text-zinc-300">{entry.branch}</dd>

        <dt className="text-zinc-500">Ordner</dt>
        <dd className="flex items-center gap-2">
          <span className="truncate font-mono text-zinc-300">{entry.worktreePath ?? '—'}</span>
          {entry.worktreePath && (
            <button
              type="button"
              className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-700"
              onClick={() => void navigator.clipboard?.writeText(entry.worktreePath ?? '')}
            >
              kopieren
            </button>
          )}
        </dd>

        <dt className="text-zinc-500">Angelegt</dt>
        <dd className="text-zinc-300">{formatDate(entry.createdAt)}</dd>

        <dt className="text-zinc-500">Adresse</dt>
        <dd>
          <StackAddress entry={entry} />
        </dd>
      </dl>

      <div className="mb-3">
        <ServiceList stack={entry.stack} />
      </div>

      <StackPanel featureId={entry.featureId} compact />

      {entry.lastDecision?.decision === 'rejected' && (
        <p className="mt-3 text-xs text-amber-400">
          zuletzt abgelehnt am {formatDate(entry.lastDecision.decidedAt)} — {entry.lastDecision.reason}
        </p>
      )}

      {decidable && confirm && reject && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <ActionGroup reason={blockedReason(confirm, reject)}>
            <ActionButton verdict={confirm} onClick={doConfirm} className={PRIMARY}>
              Abnahme bestätigen
            </ActionButton>
            <ActionButton verdict={reject} onClick={() => setRejecting(true)} className={BTN}>
              Ablehnen …
            </ActionButton>
          </ActionGroup>

          {rejecting && (
            <div className="mt-3 space-y-2">
              <label className="block text-xs text-zinc-400" htmlFor={`reason-${entry.featureId}`}>
                Was ist nicht in Ordnung?
              </label>
              <textarea
                id={`reason-${entry.featureId}`}
                className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                {/* Ohne Text bleibt die Schaltfläche gesperrt (FR-029). */}
                <button
                  type="button"
                  className={`${BTN} disabled:cursor-not-allowed disabled:opacity-40`}
                  disabled={reason.trim() === ''}
                  onClick={doReject}
                >
                  Ablehnung absenden
                </button>
                <button type="button" className={BTN} onClick={() => setRejecting(false)}>
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Die Adresse — drei Zustände, nie ein Link ins Leere (FR-033):
 * erreichbar ⇒ Link, nicht erreichbar ⇒ Satz, nicht konfiguriert ⇒ Satz.
 */
function StackAddress({ entry }: { entry: TestingLaneEntry }) {
  if (!entry.stack.configured) {
    return (
      <span className="text-amber-400">
        <strong className="font-medium">Kein Stack konfiguriert</strong> — Profile in den
        Projekt-Einstellungen hinterlegen.
      </span>
    );
  }
  if (entry.stack.url === null) {
    return (
      <span className="text-amber-400">
        <strong className="font-medium">nicht erreichbar</strong> — Stack starten?
      </span>
    );
  }
  return (
    <a
      className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
      href={entry.stack.url}
      target="_blank"
      rel="noreferrer"
    >
      {entry.stack.url} ↗
    </a>
  );
}

const BTN = 'rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700';
const PRIMARY = 'rounded bg-emerald-700 px-2.5 py-1 text-xs text-emerald-50 hover:bg-emerald-600';

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
