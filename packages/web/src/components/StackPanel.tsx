import { useCallback, useEffect, useState } from 'react';
import { evaluateAction, restartDropsData, type FeatureStackView, type StackServiceStatus } from '@sdd/shared';
import { api } from '../api.js';
import { featureActionContext, useStore } from '../store.js';
import { ActionButton, ActionGroup, blockedReason, useAction } from './FeatureAction.js';
import { RefreshIcon } from './icons.js';

/**
 * Dienstliste und die vier Stack-Aktionen eines Features — EINE Darstellung für
 * Testing-Lane und Feature-Konsole. Eine zweite Darstellung desselben Zustands
 * würde zwangsläufig auseinanderlaufen.
 *
 * Die Komponente rechnet KEINE Ports und bildet KEINE Adresse: beides kommt
 * serverseitig aus Portblock und Haupteingang (FR-031, SC-002). Jede
 * Schaltfläche rendert ausschließlich den Befund aus `evaluateAction` —
 * gesperrt heißt sichtbar mit Grund, nie verschwunden (FR-033).
 */

/** Anzeige je Dienststatus — die eine Zuordnung, kein Rohbezeichner in der Zeile. */
const STATUS_META: Record<StackServiceStatus, { dot: string; label: string; tone: string }> = {
  up: { dot: '●', label: 'läuft', tone: 'text-emerald-400' },
  down: { dot: '○', label: 'aus', tone: 'text-zinc-500' },
  unknown: { dot: '◌', label: 'unbekannt', tone: 'text-amber-400' },
};

export function StackPanel({ featureId, compact = false }: { featureId: string; compact?: boolean }) {
  const { state, dispatch } = useStore();
  const run = useAction();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; exitCode?: number; tail?: string } | null>(null);

  const stack = state.featureStacks[featureId] ?? null;
  const ctx = featureActionContext(state, featureId);
  const project = state.app?.projects.find(
    (p) => p.id === state.app?.features.find((f) => f.id === featureId)?.projectId,
  );

  const probe = useCallback(
    async (refresh = false) => {
      const view = await api.featureStack(featureId, refresh);
      dispatch({ type: 'stack_probed', payload: { featureId, stack: view } });
    },
    [dispatch, featureId],
  );

  useEffect(() => {
    void probe().catch(() => {});
  }, [probe]);

  if (!ctx) return null;

  const up = evaluateAction('stack_up', ctx);
  const stop = evaluateAction('stack_stop', ctx);
  const restart = evaluateAction('stack_restart', ctx);
  const down = evaluateAction('stack_down', ctx);
  const reason = blockedReason(up, stop, restart, down);

  const act = (action: 'up' | 'stop' | 'restart' | 'down', confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setFailure(null);
    setBusy(true);
    run(`stack:${featureId}:${action}`, async () => {
      try {
        const view = await api.stackAction(featureId, action);
        dispatch({ type: 'stack_probed', payload: { featureId, stack: view } });
      } catch (err) {
        // Der Ausgabe-Ausschnitt erscheint direkt an der Karte — und zusätzlich
        // in der Inbox (FR-019).
        setFailure({ message: (err as Error).message });
        throw err;
      } finally {
        setBusy(false);
      }
    });
  };

  const dropsData = project ? restartDropsData(project.stack) : false;

  return (
    <div className={compact ? 'space-y-2 text-xs' : 'space-y-3 text-sm'}>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span>{profileLabel(stack)}</span>
        {stack && (
          <>
            <span aria-hidden>·</span>
            <span>Stand {relativeAge(stack.collectedAt)}</span>
          </>
        )}
        <button
          type="button"
          className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={() => void probe(true)}
          title="Zustand neu erheben"
        >
          <RefreshIcon />
        </button>
      </div>

      <ServiceList stack={stack} />

      <ActionGroup reason={busy ? 'Es wird gerade gearbeitet …' : reason}>
        <ActionButton verdict={up} onClick={() => act('up')} className={BTN}>
          Starten
        </ActionButton>
        <ActionButton verdict={stop} onClick={() => act('stop')} className={BTN}>
          Stoppen
        </ActionButton>
        <ActionButton
          verdict={restart}
          onClick={() =>
            act(
              'restart',
              dropsData ? 'Neustart entfernt die Datenablagen. Fortfahren?' : undefined,
            )
          }
          className={BTN}
        >
          Neustarten
        </ActionButton>
        <ActionButton
          verdict={down}
          onClick={() => act('down', 'Dienste und Datenablagen dieses Features entfernen?')}
          className={BTN}
        >
          Abbauen
        </ActionButton>
      </ActionGroup>

      {failure && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-red-950/40 p-2 text-xs text-red-300">
          {failure.message}
        </pre>
      )}
    </div>
  );
}

/** Dienstliste mit Port und erhobenem Status; ohne Konfiguration der Satz dazu. */
export function ServiceList({ stack }: { stack: FeatureStackView | null }) {
  if (stack === null) return <p className="text-xs text-zinc-500">Zustand wird erhoben …</p>;
  if (!stack.configured) {
    return (
      <p className="text-xs text-amber-400">
        <strong className="font-medium">Kein Stack konfiguriert</strong> — Profile in den
        Projekt-Einstellungen hinterlegen.
      </p>
    );
  }
  if (stack.services.length === 0) {
    return <p className="text-xs text-zinc-500">Keine Dienste hinterlegt.</p>;
  }
  return (
    <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {stack.services.map((s) => {
        const meta = STATUS_META[s.status];
        return (
          <li key={s.name} className="flex items-center gap-2 text-xs">
            <span className={meta.tone} aria-hidden>
              {meta.dot}
            </span>
            <span className="font-medium text-zinc-200">{s.name}</span>
            <span className="tabular-nums text-zinc-500">{s.port ?? '—'}</span>
            <span className={meta.tone}>{meta.label}</span>
            {s.scope === 'shared' && <span className="text-zinc-600">geteilt</span>}
            {s.stateful && <span className="text-zinc-600">Daten</span>}
          </li>
        );
      })}
    </ul>
  );
}

const BTN = 'rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700';

function profileLabel(stack: FeatureStackView | null): string {
  if (stack === null) return '…';
  if (!stack.configured) return 'kein Stack konfiguriert';
  return stack.profile === null ? 'kein Stack betrieben' : `Profil: ${stack.profile}`;
}

/** „3 s" / „2 min" — der Stand der Erhebung, damit niemand einen alten Wert für frisch hält. */
function relativeAge(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return sec < 60 ? `${sec} s` : `${Math.round(sec / 60)} min`;
}
