import { useState } from 'react';
import { evaluateAction, type AttentionKind, type FeatureActionContext } from '@sdd/shared';
import { api } from '../api.js';
import { featureActionContext, useStore } from '../store.js';
import { ActionButton, ActionGroup, blockedReason, useAction } from './FeatureAction.js';
import { ReviewPortal } from './ReviewPortal.js';

const KIND_META: Record<AttentionKind, { label: string; icon: string; tone: string }> = {
  awaiting_input: { label: 'Frage', icon: '❓', tone: 'text-amber-400' },
  permission_request: { label: 'Berechtigung', icon: '🔐', tone: 'text-amber-400' },
  verify_failed: { label: 'Verifikation rot', icon: '🔴', tone: 'text-red-400' },
  gate_failed: { label: 'Review-Gate FAIL', icon: '⛔', tone: 'text-red-400' },
  merge_conflict_escalated: { label: 'Merge-Konflikt', icon: '⚡', tone: 'text-red-400' },
  review_due: { label: 'Review fällig', icon: '👀', tone: 'text-sky-400' },
  agent_errored: { label: 'Agent-Fehler', icon: '💥', tone: 'text-red-400' },
  run_interrupted: { label: 'Lauf unterbrochen', icon: '⏸', tone: 'text-amber-400' },
  phase_gate_failed: { label: 'Phasen-Gate FAIL', icon: '🚧', tone: 'text-red-400' },
  approval_required: { label: 'Freigabe erforderlich', icon: '✋', tone: 'text-amber-400' },
  lifecycle_step_failed: { label: 'Schritt fehlgeschlagen', icon: '⛔', tone: 'text-red-400' },
  // Datenbefunde: bernsteinfarben, denn es ist nichts kaputt, es ist etwas unklar.
  // Rot bleibt für „rot geworden" reserviert (verify_failed, gate_failed) — ausser
  // bei metering_conflict, wo nachweislich eine von zwei Zahlen falsch ist.
  run_unpriced: { label: 'Verbrauch ohne Preis', icon: '💸', tone: 'text-amber-400' },
  phase_false_start: { label: 'Fehlstart', icon: '🧨', tone: 'text-amber-400' },
  project_without_runs: { label: 'Projekt ohne Lauf', icon: '🕸', tone: 'text-zinc-400' },
  metering_conflict: { label: 'Messung widersprüchlich', icon: '⚖️', tone: 'text-red-400' },
  server_outage: { label: 'Server-Ausfall', icon: '🕳', tone: 'text-red-400' },
};

const BTN = 'rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700';

/**
 * Die nächste Aktion eines Feature-Items — abgeleitet aus derselben Policy wie
 * Board und Konsole (FR-014/FR-022), nicht aus der Meldungsart. Vorher stand hier
 * unabhängig vom Zustand „Zur Konsole", auch wenn das Feature längst auf ein
 * menschliches Review wartete.
 *
 * Reihenfolge entspricht der Stufen-Klassifikation (FR-025): wartet das Feature
 * auf das Review, ist das Review die Aktion; in den übrigen Entscheidungsstufen
 * ist es die Wiederaufnahme. Sonst bleibt die Konsole der richtige Weg — etwa bei
 * einer offenen Rückfrage der Session.
 */
function NextAction({
  featureId,
  ctx,
  onReview,
  onConsole,
  run,
}: {
  featureId: string;
  ctx: FeatureActionContext | null;
  onReview: (featureId: string) => void;
  onConsole: (featureId: string) => void;
  run: (key: string, fn: () => Promise<unknown>) => void;
}) {
  if (ctx?.integration === 'awaiting_human_review') {
    return (
      <button onClick={() => onReview(featureId)} className={BTN}>
        👀 Review
      </button>
    );
  }

  const retry = ctx ? evaluateAction('integration_retry', ctx) : null;
  if (retry && retry.availability !== 'hidden') {
    return (
      <ActionGroup reason={blockedReason(retry)} actionsClassName="">
        <ActionButton
          verdict={retry}
          onClick={() => run(`retry:${featureId}`, () => api.retryIntegration(featureId))}
          className={BTN}
        >
          ↻ Erneut
        </ActionButton>
      </ActionGroup>
    );
  }

  return (
    <button onClick={() => onConsole(featureId)} className={BTN}>
      Zur Konsole →
    </button>
  );
}

/**
 * Meldungstext eines Server-Ausfalls. Anders als die übrigen Arten steckt hier alles
 * Wissenswerte im Text selbst — Beginn, Ende, Dauer und die betroffenen Features (D18).
 * Zugeklappt bleibt die Zeile so schmal wie jede andere; aufgeklappt ist sie vollständig
 * lesbar, ohne dass es dafür einen eigenen Detail-Endpunkt braucht (C4.8).
 */
function OutageMessage({
  message,
  open,
  onToggle,
}: {
  message: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      title={open ? 'Zuklappen' : 'Ganzen Meldungstext zeigen'}
      className="flex w-full items-start gap-1.5 text-left text-sm text-zinc-300 hover:text-zinc-100"
    >
      <span className="shrink-0 text-xs text-zinc-500">{open ? '▾' : '▸'}</span>
      <span className={open ? 'break-words' : 'min-w-0 truncate'}>{message}</span>
    </button>
  );
}

/** Berichtspfad aus einer approval_required-Meldung (`… [Bericht: specs/…md]`). */
function reportPathOf(message: string): string | null {
  return message.match(/\[Bericht:\s*([^\]]+)\]/)?.[1]?.trim() ?? null;
}

/** Exception-Inbox: Monitoring by exception — der Level-3-Arbeitsmodus. */
export function AttentionInbox() {
  const { state, dispatch } = useStore();
  const runAction = useAction();
  const [portalFeature, setPortalFeature] = useState<string | null>(null);
  // Aufgeklappte Ausfallmeldungen: der Text trägt Fenster, Dauer und betroffene Features
  // (D18) — abgeschnitten wäre er nutzlos, dauerhaft mehrzeilig sprengte die Liste.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  if (!state.app) return null;

  // Kontext-Trennung: Inbox respektiert den Projekt-Scope (genau 1 Projekt).
  // Berechtigungs-Rückfragen (auch Alt-Einträge) gehören nicht in „Braucht dich".
  const items = state.app.attention.filter(
    (a) => a.kind !== 'permission_request' && a.projectId === state.selectedProjectId,
  );
  const projectName = (id: string) => state.app!.projects.find((p) => p.id === id)?.name ?? '?';

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
        <span className="text-4xl">🧘</span>
        <p className="text-sm">Nichts braucht dich gerade — die Agents arbeiten.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-2 p-4">
      {portalFeature && (
        <ReviewPortal featureId={portalFeature} onClose={() => setPortalFeature(null)} />
      )}
      {items.map((item) => {
        const meta = KIND_META[item.kind];
        return (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
          >
            <span className="text-xl">{meta.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${meta.tone}`}>{meta.label}</span>
                <span className="text-xs text-zinc-600">{projectName(item.projectId)}</span>
                <span className="text-xs text-zinc-600">
                  {new Date(item.createdAt).toLocaleTimeString('de-CH')}
                </span>
              </div>
              {item.kind === 'server_outage' ? (
                <OutageMessage
                  message={item.message}
                  open={expanded.has(item.id)}
                  onToggle={() => toggleExpanded(item.id)}
                />
              ) : (
                <p className="truncate text-sm text-zinc-300">{item.message}</p>
              )}
            </div>
            {item.kind === 'approval_required' && item.featureId && reportPathOf(item.message) && (
              <button
                onClick={() => void api.openInEditor(item.featureId!, reportPathOf(item.message)!, null)}
                className="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
                title="Agent-Bericht im Editor öffnen"
              >
                Bericht öffnen
              </button>
            )}
            {item.featureId && (
              <NextAction
                featureId={item.featureId}
                ctx={featureActionContext(state, item.featureId)}
                onReview={setPortalFeature}
                onConsole={(id) => dispatch({ type: 'set_view', view: { kind: 'console', featureId: id } })}
                run={runAction}
              />
            )}
            {!item.featureId && item.conversationId && (
              <button
                onClick={() => dispatch({ type: 'open_chat', projectId: item.projectId })}
                className="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
              >
                Zum Chat →
              </button>
            )}
            <button
              onClick={() =>
                void api
                  .resolveAttention(item.id)
                  .then(() => dispatch({ type: 'attention_resolved', id: item.id }))
              }
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              title="Als erledigt markieren"
            >
              ✓
            </button>
          </div>
        );
      })}
    </div>
  );
}
