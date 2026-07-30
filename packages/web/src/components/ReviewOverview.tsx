import { useCallback, useEffect, useState } from 'react';
import type { IntegrationStage, ReviewOverviewItem } from '@sdd/shared';
import { evaluateAction, INTEGRATION_STAGE_META, INTEGRATION_TONE_CLASS } from '@sdd/shared';
import { api } from '../api.js';
import { featureActionContext, useStore } from '../store.js';
import { ReviewPortal } from './ReviewPortal.js';
import { VerdictPill } from './review/AuditSidebar.js';
import { ActionButton, ActionGroup, blockedReason, useAction } from './FeatureAction.js';

/**
 * Abweichende Beschriftungen dieser Ansicht. Über `Partial<Record<IntegrationStage, …>>`
 * getypt statt `Record<string, …>`: ein Tippfehler ist damit ein Compile-Fehler, und
 * alle übrigen Stufen kommen aus dem geteilten Katalog — kein Rohbezeichner mehr in
 * der Zeile (D9).
 */
const STAGE_LABEL: Partial<Record<IntegrationStage, string>> = {
  awaiting_human_review: 'Bereit zum Review',
  verify_failed: 'Verifikation fehlgeschlagen',
  gate_failed: 'Review-Gate FAIL',
  conflict_escalated: 'Konflikt eskaliert',
  none: 'Vorschau — in Entwicklung',
};

/**
 * Beschriftung der Verifikations-Anzeige. Vollständige Tabelle statt Ternär-Kette:
 * ein weiterer Zustand fällt damit nicht stumm in den Rest-Zweig, sondern bricht den
 * Typecheck. „nicht konfiguriert" und „kein Lauf" müssen unterscheidbar sein (FR-009).
 */
const VERIFY_META: Record<ReviewOverviewItem['verify']['status'], { text: string; className: string }> = {
  passed: { text: 'Verify ✓', className: 'text-emerald-400' },
  failed: { text: 'Verify ✗', className: 'text-red-400' },
  none: { text: 'Verify – (kein Lauf)', className: 'text-zinc-600' },
  unconfigured: { text: 'Verify nicht konfiguriert', className: 'text-amber-400' },
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
  const openTasks = Math.max(0, f.tasksTotal - f.tasksDone);
  // Die beiden Sonderfälle dieser Ansicht bleiben; alle übrigen Stufen holen ihren Ton
  // aus dem Katalog, statt pauschal rot zu sein. Für die Fehlerstufen ist das
  // unverändert rot — die neue Stufe „keine Verifikation konfiguriert" wird dagegen
  // amber, denn sie eskaliert nichts (FR-010).
  const stageTone =
    item.stage === 'awaiting_human_review'
      ? 'text-sky-400'
      : item.stage === 'none'
        ? 'text-zinc-400'
        : INTEGRATION_TONE_CLASS[INTEGRATION_STAGE_META[item.stage].tone];
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
          <span className={stageTone}>{STAGE_LABEL[item.stage] ?? INTEGRATION_STAGE_META[item.stage].label}</span>
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
          {/* Der Aufgabenstand steht dort, wo über den Merge entschieden wird
              (FR-012). Die Werte liegen in item.feature — keine zusätzliche Anfrage. */}
          <span
            className={openTasks > 0 ? 'text-amber-400' : undefined}
            title="Erledigte Aufgaben aus tasks.md"
          >
            {f.tasksTotal === 0 ? 'keine Aufgabenliste' : `${f.tasksDone}/${f.tasksTotal} Aufgaben`}
          </span>
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
        <span className={VERIFY_META[item.verify.status].className} title="Verifikationsstatus">
          {VERIFY_META[item.verify.status].text}
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
