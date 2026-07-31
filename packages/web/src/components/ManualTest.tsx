import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  MANUAL_TEST_SEVERITIES,
  evaluateAction,
  type ManualTestFinding,
  type ManualTestSeverity,
  type NewManualTestFinding,
  type TestingLaneEntry,
} from '@sdd/shared';
import { api } from '../api.js';
import { featureActionContext, useStore } from '../store.js';
import { ActionButton, ActionGroup, blockedReason, useAction } from './FeatureAction.js';
import { Dialog } from './Sidebar.js';
import { ServiceList, StackPanel } from './StackPanel.js';
import { DeleteIcon, PlusIcon, RefreshIcon } from './icons.js';

/**
 * Die manuelle Abnahme — sie findet in der Spalte „Abnahme" statt, nicht in
 * einer Zweitansicht. Bis 31.07.2026 war das ein eigener Reiter („Testing-Lane")
 * neben dem Board; damit standen dieselben Features an zwei Orten und die
 * Entscheidung lag nicht dort, wo die Karte liegt.
 *
 * Aufteilung:
 * - {@link ManualTestBlock} auf der Karte — Adresse, Dienstpunkte, Entscheidung.
 *   Der häufige Weg (App öffnen, durchklicken, abnehmen) braucht keinen Dialog.
 * - {@link ManualTestDialog} — die fünf Pflichtangaben in EINER Ansicht (SC-009),
 *   Stack-Steuerung, offene Befunde früherer Runden und der Ablehnungs-Teil.
 */

/** Anzeige je Gewicht. Nur `blocker` sperrt die Annahme. */
export const SEVERITY_META: Record<ManualTestSeverity, { label: string; chip: string }> = {
  blocker: { label: 'Blocker', chip: 'bg-red-950/60 text-red-300' },
  rework: { label: 'Nacharbeit', chip: 'bg-amber-950/60 text-amber-300' },
  note: { label: 'Hinweis', chip: 'bg-zinc-800 text-zinc-400' },
};

// ---------- Erhebung für die Spalte ----------

interface LaneState {
  entries: Record<string, TestingLaneEntry>;
  loading: boolean;
  reload: (refresh?: boolean) => void;
}

const LaneContext = createContext<LaneState>({ entries: {}, loading: false, reload: () => {} });

/**
 * Erhebt die Abnahme-Daten für die Features AUF der Stufe — und nur für die.
 * Jeder Eintrag kostet serverseitig eine Probe je Dienst; steht nichts zur
 * Abnahme an, wird gar nicht gefragt.
 */
export function ManualTestLaneProvider({
  projectId,
  waitingIds,
  children,
}: {
  projectId: string | null;
  waitingIds: string[];
  children: ReactNode;
}) {
  const { dispatch } = useStore();
  const [entries, setEntries] = useState<Record<string, TestingLaneEntry>>({});
  const [loading, setLoading] = useState(false);
  // Neu erheben, sobald ein Feature die Stufe betritt oder verlässt.
  const key = [...waitingIds].sort().join(',');

  const load = useCallback(
    async (refresh = false) => {
      if (!projectId || key === '') {
        setEntries({});
        dispatch({ type: 'manual_test_blockers', payload: {} });
        return;
      }
      setLoading(true);
      try {
        const view = await api.testingLane(projectId, refresh);
        const next: Record<string, TestingLaneEntry> = {};
        const blockers: Record<string, number> = {};
        for (const e of view.awaitingManualTest) {
          next[e.featureId] = e;
          blockers[e.featureId] = e.openFindings.filter((f) => f.severity === 'blocker').length;
          // Derselbe erhobene Zustand füttert die Aktions-Policy wie im
          // StackPanel — kein zweiter Abruf für dieselbe Frage.
          dispatch({ type: 'stack_probed', payload: { featureId: e.featureId, stack: e.stack } });
        }
        setEntries(next);
        dispatch({ type: 'manual_test_blockers', payload: blockers });
      } catch (err) {
        dispatch({ type: 'error', message: (err as Error).message });
      } finally {
        setLoading(false);
      }
    },
    [dispatch, projectId, key],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<LaneState>(
    () => ({ entries, loading, reload: (refresh?: boolean) => void load(refresh) }),
    [entries, loading, load],
  );
  return <LaneContext.Provider value={value}>{children}</LaneContext.Provider>;
}

export function useManualTestLane(): LaneState {
  return useContext(LaneContext);
}

// ---------- Der Block auf der Karte ----------

export function ManualTestBlock({ featureId }: { featureId: string }) {
  const { entries, reload } = useManualTestLane();
  const { state } = useStore();
  const run = useAction();
  const [dialog, setDialog] = useState<'details' | 'reject' | null>(null);

  const entry = entries[featureId] ?? null;
  const ctx = featureActionContext(state, featureId);
  const confirm = ctx ? evaluateAction('manual_test_confirm', ctx) : null;
  const reject = ctx ? evaluateAction('manual_test_reject', ctx) : null;
  const openFindings = entry?.openFindings ?? [];

  const doConfirm = () => {
    const feature = state.app?.features.find((f) => f.id === featureId);
    const auto = feature?.automation.autoMerge === true;
    const text = auto
      ? 'Danach geht das Feature in die Merge-Queue. Abnahme bestätigen?'
      : 'Danach geht das Feature in das menschliche Review. Abnahme bestätigen?';
    if (!window.confirm(text)) return;
    run(`manual-test:confirm:${featureId}`, async () => {
      await api.confirmManualTest(featureId);
      reload(true);
    });
  };

  return (
    <div className="mt-2 space-y-1.5 rounded border border-amber-900/40 bg-amber-950/10 p-2">
      <StackAddress entry={entry} />
      <ServiceDots entry={entry} />

      {entry !== null && (entry.round > 1 || openFindings.length > 0) && (
        <button
          type="button"
          onClick={() => setDialog('details')}
          className="block text-left text-[11px] text-amber-300 hover:underline"
        >
          Runde {entry.round}
          {openFindings.length > 0 && ` · ${openFindings.length} offen`}
          {openFindings.some((f) => f.severity === 'blocker') &&
            ` (${openFindings.filter((f) => f.severity === 'blocker').length} Blocker)`}
        </button>
      )}

      <ActionGroup reason={blockedReason(confirm, reject)}>
        {confirm && (
          <ActionButton verdict={confirm} onClick={doConfirm} className={PRIMARY}>
            ✓ Abnehmen
          </ActionButton>
        )}
        {reject && (
          <ActionButton verdict={reject} onClick={() => setDialog('reject')} className={BTN}>
            Ablehnen …
          </ActionButton>
        )}
        <button type="button" className={BTN} onClick={() => setDialog('details')}>
          Details …
        </button>
      </ActionGroup>

      {dialog !== null && (
        <ManualTestDialog
          featureId={featureId}
          startRejecting={dialog === 'reject'}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/**
 * Die Adresse — drei Zustände, nie ein Link ins Leere (FR-033):
 * erreichbar ⇒ Link, nicht erreichbar ⇒ Satz, nicht konfiguriert ⇒ Satz.
 */
function StackAddress({ entry }: { entry: TestingLaneEntry | null }) {
  if (entry === null) return <p className="text-[11px] text-zinc-500">Zustand wird erhoben …</p>;
  if (!entry.stack.configured) {
    return (
      <p className="text-[11px] text-amber-400">
        Kein Stack konfiguriert — Profile in den Projekt-Einstellungen hinterlegen.
      </p>
    );
  }
  if (entry.stack.url === null) {
    return <p className="text-[11px] text-amber-400">nicht erreichbar — Stack starten?</p>;
  }
  return (
    <a
      className="block truncate rounded bg-zinc-900 px-1.5 py-1 text-xs text-sky-400 underline underline-offset-2 hover:text-sky-300"
      href={entry.stack.url}
      target="_blank"
      rel="noreferrer"
      title="Die laufende Anwendung dieses Features öffnen"
    >
      {entry.stack.url} ↗
    </a>
  );
}

/** Dienststatus als Punktreihe — die volle Liste steht im Dialog. */
function ServiceDots({ entry }: { entry: TestingLaneEntry | null }) {
  if (entry === null || entry.stack.services.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      {entry.stack.services.map((s) => (
        <span key={s.name} className="flex items-center gap-1">
          <span
            className={
              s.status === 'up' ? 'text-emerald-400' : s.status === 'down' ? 'text-zinc-600' : 'text-amber-400'
            }
            aria-hidden
          >
            ●
          </span>
          <span className="text-zinc-400">{s.name}</span>
        </span>
      ))}
    </div>
  );
}

// ---------- Der Dialog ----------

/**
 * Die fünf Pflichtangaben in EINER Ansicht (SC-009): Ordner, Branch, Adresse,
 * Anlagedatum und je Dienst Status samt Port. Dazu die Stack-Steuerung und die
 * Befunde — offene aus früheren Runden zum Abhaken, neue zum Erfassen.
 */
export function ManualTestDialog({
  featureId,
  startRejecting,
  onClose,
}: {
  featureId: string;
  startRejecting: boolean;
  onClose: () => void;
}) {
  const { entries, reload } = useManualTestLane();
  const { state, dispatch } = useStore();
  const run = useAction();
  const [rejecting, setRejecting] = useState(startRejecting);
  const [comment, setComment] = useState('');
  const [drafts, setDrafts] = useState<NewManualTestFinding[]>([]);

  const entry = entries[featureId] ?? null;
  const ctx = featureActionContext(state, featureId);
  const reject = ctx ? evaluateAction('manual_test_reject', ctx) : null;

  const toggleResolved = (f: ManualTestFinding) => {
    void api
      .setFindingStatus(f.id, f.status === 'open' ? 'resolved' : 'open')
      .then(() => reload())
      .catch((err: Error) => dispatch({ type: 'error', message: err.message }));
  };

  const doReject = () => {
    const findings = drafts.filter((d) => d.text.trim() !== '');
    run(`manual-test:reject:${featureId}`, async () => {
      await api.rejectManualTest(featureId, { comment, findings });
      onClose();
    });
  };

  const canSubmit = drafts.some((d) => d.text.trim() !== '') || comment.trim() !== '';

  return (
    <Dialog title={`Abnahme: ${entry?.featureName ?? '…'}`} onClose={onClose} wide>
      {entry === null ? (
        <p className="text-sm text-zinc-500">wird erhoben …</p>
      ) : (
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex items-center gap-3">
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
              Runde {entry.round}
            </span>
            <button
              type="button"
              className={`${BTN} ml-auto flex items-center gap-1.5`}
              onClick={() => reload(true)}
            >
              <RefreshIcon />
              Aktualisieren
            </button>
          </div>

          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
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

          <ServiceList stack={entry.stack} />
          <StackPanel featureId={featureId} compact />

          {entry.openFindings.length > 0 && (
            <section className="space-y-2 border-t border-zinc-800 pt-3">
              <h3 className="text-xs font-medium text-zinc-300">
                Offene Befunde aus früheren Runden
              </h3>
              {/* Abhaken heißt: nachgeprüft und in Ordnung. Was offen bleibt,
                  geht in die nächste Ablehnung mit — ohne dieses Häkchen weiß
                  nach zwei Runden niemand mehr, was schon geprüft war. */}
              <ul className="space-y-1.5">
                {entry.openFindings.map((f) => (
                  <li key={f.id} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={f.status === 'resolved'}
                      onChange={() => toggleResolved(f)}
                      title="behoben und nachgeprüft"
                    />
                    <span className={`shrink-0 rounded px-1.5 py-0.5 ${SEVERITY_META[f.severity].chip}`}>
                      {SEVERITY_META[f.severity].label}
                    </span>
                    <span className="min-w-0">
                      {f.where && <span className="text-zinc-500">[{f.where}] </span>}
                      <span className="text-zinc-200">{f.text}</span>
                      <span className="text-zinc-600"> · Runde {f.round}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {entry.lastDecision?.decision === 'rejected' && (
            <p className="text-xs text-amber-400">
              zuletzt abgelehnt am {formatDate(entry.lastDecision.decidedAt)}
              {entry.lastDecision.reason ? ` — ${entry.lastDecision.reason}` : ''}
            </p>
          )}

          {!rejecting ? (
            <div className="border-t border-zinc-800 pt-3">
              {reject && (
                <ActionGroup reason={blockedReason(reject)}>
                  <ActionButton verdict={reject} onClick={() => setRejecting(true)} className={BTN}>
                    Ablehnen …
                  </ActionButton>
                </ActionGroup>
              )}
            </div>
          ) : (
            <section className="space-y-3 border-t border-zinc-800 pt-3">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-medium text-zinc-300">Befunde dieser Runde</h3>
                <button
                  type="button"
                  className={`${BTN} ml-auto flex items-center gap-1`}
                  onClick={() =>
                    setDrafts((d) => [...d, { where: null, text: '', severity: 'blocker' }])
                  }
                >
                  <PlusIcon /> Befund
                </button>
              </div>

              {drafts.map((d, i) => (
                <div key={i} className="space-y-1.5 rounded border border-zinc-800 p-2">
                  <div className="flex gap-2">
                    <select
                      className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-200"
                      value={d.severity}
                      onChange={(e) =>
                        setDrafts((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, severity: e.target.value as ManualTestSeverity } : x,
                          ),
                        )
                      }
                    >
                      {MANUAL_TEST_SEVERITIES.map((s) => (
                        <option key={s} value={s}>
                          {SEVERITY_META[s].label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
                      placeholder="Wo in der Anwendung? z. B. Board → Karte öffnen"
                      value={d.where ?? ''}
                      onChange={(e) =>
                        setDrafts((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, where: e.target.value } : x)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                      title="Befund entfernen"
                      onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <DeleteIcon />
                    </button>
                  </div>
                  <textarea
                    className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200"
                    rows={2}
                    placeholder="Was stimmt nicht?"
                    value={d.text}
                    onChange={(e) =>
                      setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                    }
                  />
                </div>
              ))}

              <div>
                <label className="mb-1 block text-xs text-zinc-400" htmlFor={`comment-${featureId}`}>
                  Anmerkung (frei)
                </label>
                <textarea
                  id={`comment-${featureId}`}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>

              {/*
                Wohin es zurückgeht, ist festgelegt und nicht wählbar: auf
                `specify`. Ein Feature erreicht die Abnahme nur, wenn Verifikation
                und Review-Gate durch sind — was danach beim Durchklicken auffällt,
                ist eine Aussage über die Absicht, nicht über den Code.
              */}
              <p className="rounded bg-zinc-950 p-2 text-[11px] text-zinc-400">
                Die Ablehnung setzt das Feature auf <strong className="text-zinc-300">Specify</strong>{' '}
                zurück und startet den Lauf mit diesen Befunden. Die bestehenden Artefakte werden
                überarbeitet, nicht neu erstellt; alles Nachgelagerte wird als veraltet markiert.
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${BTN} disabled:cursor-not-allowed disabled:opacity-40`}
                  disabled={!canSubmit}
                  title={canSubmit ? undefined : 'Mindestens ein Befund oder eine Anmerkung'}
                  onClick={doReject}
                >
                  Ablehnen und Nacharbeit starten
                </button>
                <button type="button" className={BTN} onClick={() => setRejecting(false)}>
                  Abbrechen
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </Dialog>
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
