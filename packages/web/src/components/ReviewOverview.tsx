import { useCallback, useEffect, useState } from 'react';
import type { ReviewOverviewItem } from '@sdd/shared';
import { evaluateAction } from '@sdd/shared';
import { api } from '../api.js';
import { featureActionContext, useStore } from '../store.js';
import { ReviewPortal } from './ReviewPortal.js';
import { VerdictPill } from './review/AuditSidebar.js';
import { ActionButton, ActionGroup, blockedReason, useAction } from './FeatureAction.js';

const STAGE_LABEL: Record<string, string> = {
  awaiting_human_review: 'Bereit zum Review',
  verify_failed: 'Verifikation fehlgeschlagen',
  gate_failed: 'Review-Gate FAIL',
  conflict_escalated: 'Konflikt eskaliert',
  none: 'Vorschau — in Entwicklung',
};

/**
 * Top-Level-Review-Ansicht: alle integrationsnahen Features des aktiven
 * Projekts — „Bereit zum Review" (prüfbereit) und „Braucht Eingriff"
 * (Verifikation/Gate/Konflikt), mit Kennzahlen und Portal-Einstieg.
 */
export function ReviewOverview() {
  const { state, dispatch } = useStore();
  const [items, setItems] = useState<ReviewOverviewItem[] | null>(null);
  const [portalFeature, setPortalFeature] = useState<string | null>(null);
  const projectId = state.selectedProjectId;

  const featuresKey = state.app?.features
    .map((f) => `${f.id}:${f.integration}`)
    .join(',');

  const load = useCallback(() => {
    if (!projectId) return;
    api
      .reviewOverview(projectId)
      .then(setItems)
      .catch((e: Error) => dispatch({ type: 'error', message: e.message }));
  }, [projectId, dispatch]);

  // Refetch bei Feature-/Gate-Änderungen (WS-getrieben über den Store).
  useEffect(load, [load, featuresKey, state.agentGateVersion]);

  if (!projectId) return <p className="p-6 text-sm text-zinc-600">Kein Projekt ausgewählt.</p>;
  if (!items) return <p className="p-6 text-sm text-zinc-600">Lade Review-Übersicht …</p>;

  const ready = items.filter((i) => i.stage === 'awaiting_human_review');
  const inProgress = items.filter((i) => i.stage === 'none');
  const blocked = items.filter((i) => i.stage !== 'awaiting_human_review' && i.stage !== 'none');

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-zinc-100">Review &amp; Änderungen</h1>
        <button
          onClick={load}
          title="Aktualisieren (erfasst auch neue uncommittete Änderungen)"
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ↻ Aktualisieren
        </button>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">
          Bereit zum Review <span className="text-zinc-500">({ready.length})</span>
        </h2>
        {ready.length === 0 ? (
          <p className="rounded border border-zinc-800 px-4 py-6 text-center text-sm text-zinc-600">
            Nichts wartet auf dein Review.
          </p>
        ) : (
          <ul className="space-y-2">
            {ready.map((item) => (
              <OverviewRow key={item.feature.id} item={item} onOpen={() => setPortalFeature(item.feature.id)} />
            ))}
          </ul>
        )}
      </section>

      {inProgress.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-200">
            Vorschau: in Entwicklung (ungemergt) <span className="text-zinc-500">({inProgress.length})</span>
          </h2>
          <p className="mb-2 text-xs text-zinc-500">
            Diese Features sind noch nicht in der Integration — die Ansicht dient dem Hineinschauen, es gibt
            hier nichts zu entscheiden.
          </p>
          <ul className="space-y-2">
            {inProgress.map((item) => (
              <OverviewRow key={item.feature.id} item={item} onOpen={() => setPortalFeature(item.feature.id)} />
            ))}
          </ul>
        </section>
      )}

      {blocked.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-200">
            Braucht Eingriff <span className="text-zinc-500">({blocked.length})</span>
          </h2>
          <ul className="space-y-2">
            {blocked.map((item) => (
              <OverviewRow key={item.feature.id} item={item} onOpen={() => setPortalFeature(item.feature.id)} />
            ))}
          </ul>
        </section>
      )}

      {portalFeature && <ReviewPortal featureId={portalFeature} onClose={() => setPortalFeature(null)} />}
    </div>
  );
}

function OverviewRow({ item, onOpen }: { item: ReviewOverviewItem; onOpen: () => void }) {
  const { state } = useStore();
  const run = useAction();
  const f = item.feature;
  // Wiederaufnahme kommt aus derselben Festlegung wie überall sonst — damit
  // bietet die Übersicht sie bei allen drei Fehlerstufen an (FR-015).
  const ctx = featureActionContext(state, f.id);
  const retryV = ctx ? evaluateAction('integration_retry', ctx) : null;
  const isPreview = item.stage === 'none';
  const stageTone =
    item.stage === 'awaiting_human_review'
      ? 'text-sky-400'
      : item.stage === 'none'
        ? 'text-zinc-400'
        : 'text-red-400';
  return (
    <li className="flex items-center gap-4 rounded border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="min-w-0 flex-1">
        <button onClick={onOpen} className="truncate text-sm font-medium text-zinc-100 hover:underline">
          {f.name}
        </button>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
          {/* Vorschau ausdrücklich kennzeichnen (FR-019). */}
          {isPreview && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] tracking-wide text-zinc-400 uppercase">
              Vorschau
            </span>
          )}
          <span className={stageTone}>{STAGE_LABEL[item.stage] ?? item.stage}</span>
          {f.reviewRejectedAt !== null && <span className="text-amber-300">↩ im Review zurückgewiesen</span>}
          <span>
            {item.filesChanged} Dateien · <span className="text-emerald-500">+{item.additions}</span>{' '}
            <span className="text-red-500">−{item.deletions}</span>
          </span>
          {item.hasUncommitted && (
            <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] text-amber-300" title="Worktree hat uncommittete Änderungen">
              uncommittet
            </span>
          )}
          {item.openComments > 0 && <span>💬 {item.openComments}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        <span className="flex items-center gap-1 text-zinc-500" title="Agent-Audits (bestanden/gesamt)">
          {item.audits.total > 0 ? (
            <>
              <VerdictPill verdict={item.audits.failed === 0 ? 'PASS' : 'FAIL'} />
              {item.audits.passed}/{item.audits.total}
            </>
          ) : (
            'keine Audits'
          )}
        </span>
        <span
          className={
            item.verify.status === 'passed'
              ? 'text-emerald-400'
              : item.verify.status === 'failed'
                ? 'text-red-400'
                : 'text-zinc-600'
          }
          title="Verifikationsstatus"
        >
          {item.verify.status === 'passed' ? 'Verify ✓' : item.verify.status === 'failed' ? 'Verify ✗' : 'Verify –'}
        </span>
        <ActionGroup reason={blockedReason(retryV)} actionsClassName="flex items-center gap-3">
          {retryV && (
            <ActionButton
              verdict={retryV}
              onClick={() => run(`retry:${f.id}`, () => api.retryIntegration(f.id))}
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
            >
              ↻ Erneut
            </ActionButton>
          )}
          {/* Betrachtend (FR-007) — nie gesperrt. */}
          <button onClick={onOpen} className="rounded bg-zinc-800 px-2.5 py-1 text-zinc-200 hover:bg-zinc-700">
            {isPreview ? 'Vorschau öffnen' : '👀 Öffnen'}
          </button>
        </ActionGroup>
      </div>
    </li>
  );
}
