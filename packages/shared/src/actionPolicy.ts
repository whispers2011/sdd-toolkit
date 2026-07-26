/**
 * Aktions-Policy: die EINZIGE Festlegung, welche Feature-Aktion in welchem
 * Zustand angeboten, gesperrt oder gar nicht gezeigt wird (FR-022).
 *
 * Board, Feature-Konsole, Review-Übersicht und Review-Portal rendern
 * ausschließlich das Ergebnis von {@link evaluateAction}; jede aktionsauslösende
 * HTTP-Route prüft dasselbe Ergebnis serverseitig (FR-024). Eine eigene
 * Bedingung in einer Oberfläche ist damit ein Fehler, kein Gestaltungsspielraum.
 *
 * KEINE UI, KEIN IO — pure Logik, vollständig in Isolation testbar
 * (actionPolicy.test.ts deckt jede Zeile der Entscheidungsmatrix ab).
 */
import { orderedPhases, type PhaseMap } from './phaseMachine.js';
import type { FeaturePhase, IntegrationStage, SessionDisplayStatus } from './types.js';
import { INTEGRATION_STAGE_META } from './workflowModel.js';

// ---------- Aktion ----------

/** Alle zustandsverändernden Feature-Aktionen der Oberflächen. */
export type FeatureActionId =
  | 'phase_start' // ▶ Schritt starten
  | 'phase_approve' // ✓ Schritt freigeben
  | 'phase_discard' // ↺ Schritt verwerfen
  | 'integrate' // ⇥ Integrieren
  | 'integration_retry' // ↻ Integration erneut anstoßen
  | 'review_approve' // ✓ Freigeben & Integrieren (Portal)
  | 'review_reject' // ✗ Zurückweisen (Portal)
  | 'archive' // 🗄 Archivieren
  | 'delete'; // Feature löschen

/** Alle Aktionen als Laufzeit-Liste (Testabdeckung, Exhaustiveness). */
export const FEATURE_ACTIONS: readonly FeatureActionId[] = [
  'phase_start',
  'phase_approve',
  'phase_discard',
  'integrate',
  'integration_retry',
  'review_approve',
  'review_reject',
  'archive',
  'delete',
] as const;

// ---------- Befund ----------

export type ActionAvailability = 'available' | 'blocked' | 'hidden';

export interface ActionVerdict {
  availability: ActionAvailability;
  /** Ein Satz; null GENAU DANN, wenn availability === 'available'. */
  reason: string | null;
  /** Rückfrage muss auf den Abbruch laufender Arbeit hinweisen (FR-008). */
  confirmAbortsWork: boolean;
}

// ---------- Feature-Zustand ----------

/**
 * Der vollständige und einzige Eingabewert jeder Entscheidung. Bewusst ein
 * flaches Datenobjekt: Web (aus dem Store) und Server (aus Repos + PTY-Manager)
 * bauen ihn identisch auf. Er beschreibt GENAU EIN Feature — Zustände anderer
 * Features können per Konstruktion nicht einfließen (FR-011).
 */
export interface FeatureActionContext {
  /** Nur die im Projekt aktiven Schritte (feature.phases enthält bereits nur diese). */
  phases: PhaseMap;
  integration: IntegrationStage;
  /** Feature ist archiviert (feature.archivedAt !== null). */
  archived: boolean;
  /** Arbeitsverzeichnis vorhanden (feature.worktreePath !== null). */
  hasWorktree: boolean;
  /** Anzeigestatus der lebenden Session; null = keine lebende Session. */
  session: SessionDisplayStatus | null;
  /** Ein Agenten-Gate (before_phase/after_phase) läuft für dieses Feature. */
  gateRunning: boolean;
  /** Vorprüfung nach FR-027; 'unknown' = noch nicht ermittelt (sperrt nicht). */
  hasChanges: boolean | 'unknown';
}

// ---------- Stufen-Klassifikation (FR-025) ----------

export type StageClass = 'idle' | 'active' | 'decision' | 'terminal';

/**
 * Klasse je Integrationsstufe. Über `Record<IntegrationStage, …>` getypt ⇒ eine
 * zwölfte Stufe bricht `pnpm typecheck` hier, statt still in die falsche Klasse
 * zu fallen (Muster aus workflowModel.ts).
 *
 * - `active` macht das Feature beschäftigt (FR-005).
 * - `decision` ist NICHT beschäftigt: nur die dort vorgesehene Aktion wird angeboten.
 * - `terminal` lässt keine zustandsverändernde Schritt-Aktion mehr zu.
 */
export const STAGE_CLASS: Record<IntegrationStage, StageClass> = {
  none: 'idle',
  verifying: 'active',
  verify_failed: 'decision',
  review_gate: 'active',
  gate_failed: 'decision',
  awaiting_human_review: 'decision',
  queued: 'active',
  merging: 'active',
  conflict_resolving: 'active',
  conflict_escalated: 'decision',
  merged: 'terminal',
};

/** Stufen, aus denen eine Wiederaufnahme möglich ist (FR-015). */
export const RETRYABLE_STAGES: readonly IntegrationStage[] = [
  'verify_failed',
  'gate_failed',
  'conflict_escalated',
] as const;

// ---------- Textkatalog ----------

/**
 * Alle Sperr-/Ausblendgründe an EINER Stelle — sie erscheinen wortgleich in der
 * Oberfläche und in der HTTP-Ablehnung (FR-014). Stufennamen kommen ausschließlich
 * aus INTEGRATION_STAGE_META, damit es keine zweite Textquelle dafür gibt.
 */
export const ACTION_REASON = {
  archived: 'Das Feature ist archiviert.',
  alreadyArchived: 'Das Feature ist bereits archiviert.',
  completed: 'Das Feature ist abgeschlossen.',
  phaseNotEnabled: 'Dieser Schritt ist im Projekt nicht aktiv.',
  phaseNotIdle: 'Der Schritt ist nicht offen.',
  phaseNotAwaitingReview: 'Der Schritt wartet nicht auf eine Freigabe.',
  noWorktree: 'Kein Arbeitsverzeichnis vorhanden.',
  notComplete: 'Erst integrierbar, wenn alle aktiven Schritte freigegeben sind.',
  noChanges: 'Keine Änderungen zu integrieren.',
  noFailedIntegration: 'Es gibt keine fehlgeschlagene Integration zum Wiederholen.',
  notAwaitingReview: 'Das Feature wartet nicht auf ein Review.',
} as const;

/** „Beschäftigt"-Sätze (busyReason, erster Treffer gewinnt). */
export const BUSY_REASON = {
  sessionWorking: 'Es wird gerade gearbeitet — die Session läuft.',
  sessionAwaitingInput: 'Die Session wartet auf eine Eingabe.',
  gateRunning: 'Ein Qualitäts-Gate läuft.',
} as const;

export function phaseRunningReason(phase: FeaturePhase): string {
  return `Es wird gerade gearbeitet — Schritt „${phase}" läuft.`;
}

export function integrationRunningReason(stage: IntegrationStage): string {
  return `Die Integration läuft — ${INTEGRATION_STAGE_META[stage].label}.`;
}

export function alreadyIntegratingReason(stage: IntegrationStage): string {
  return `Das Feature ist bereits in der Integration — ${INTEGRATION_STAGE_META[stage].label}.`;
}

export function previousPhaseOpenReason(phase: FeaturePhase): string {
  return `Der vorherige Schritt „${phase}" ist noch nicht freigegeben.`;
}

/** Sätze der Entscheidungszustände: hier ist der Mensch am Zug, nicht die Maschine. */
export const DECISION_REASON: Record<
  'awaiting_human_review' | 'verify_failed' | 'gate_failed' | 'conflict_escalated',
  string
> = {
  awaiting_human_review: 'Das Feature wartet auf dein Review — dort entscheiden.',
  verify_failed: 'Die Verifikation ist fehlgeschlagen — Integration erneut anstoßen.',
  gate_failed: 'Das Review-Gate ist fehlgeschlagen — Integration erneut anstoßen.',
  conflict_escalated: 'Der Merge-Konflikt ist eskaliert — Integration erneut anstoßen.',
};

/** Grund eines Entscheidungszustands; null für alle übrigen Stufen. */
function decisionReason(stage: IntegrationStage): string | null {
  return stage in DECISION_REASON
    ? DECISION_REASON[stage as keyof typeof DECISION_REASON]
    : null;
}

// ---------- Abgeleitete Prädikate ----------

/**
 * FR-001: fertig = jeder aktive Schritt ist freigegeben. Ein als `stale`
 * markierter Schritt bleibt freigegeben (Annahme der Spec). Ohne aktive
 * Schritte gilt ein Feature nicht als fertig.
 */
export function isFeatureComplete(phases: PhaseMap): boolean {
  const active = orderedPhases(phases);
  if (active.length === 0) return false;
  return active.every((p) => phases[p].status === 'approved');
}

/**
 * FR-005: genau EIN Satz, warum gerade gearbeitet wird — oder null. Der erste
 * Treffer gewinnt; der Bedienende soll den nächstliegenden Grund lesen, nicht alle.
 */
export function busyReason(ctx: FeatureActionContext): string | null {
  const running = orderedPhases(ctx.phases).find((p) => ctx.phases[p].status === 'running');
  if (running !== undefined) return phaseRunningReason(running);
  if (ctx.session === 'working') return BUSY_REASON.sessionWorking;
  if (ctx.session === 'awaiting_input') return BUSY_REASON.sessionAwaitingInput;
  if (ctx.gateRunning) return BUSY_REASON.gateRunning;
  if (STAGE_CLASS[ctx.integration] === 'active') return integrationRunningReason(ctx.integration);
  return null;
}

// ---------- Entscheidungsmatrix ----------

const AVAILABLE: ActionVerdict = { availability: 'available', reason: null, confirmAbortsWork: false };

function blocked(reason: string): ActionVerdict {
  return { availability: 'blocked', reason, confirmAbortsWork: false };
}

function hidden(reason: string): ActionVerdict {
  return { availability: 'hidden', reason, confirmAbortsWork: false };
}

/**
 * Der Befund für eine Aktion in einem Zustand. Die Bedingungen jeder Aktion
 * werden von oben nach unten geprüft; der erste Treffer gewinnt.
 *
 * Invariante: `reason === null` GENAU DANN, wenn `availability === 'available'`.
 * Auch `hidden` trägt einen Grund — die Oberfläche zeigt ihn nur bei `blocked`
 * (FR-028), der Server nutzt ihn in beiden Fällen als Ablehnungstext (FR-003).
 */
export function evaluateAction(
  action: FeatureActionId,
  ctx: FeatureActionContext,
  opts?: { phase?: FeaturePhase },
): ActionVerdict {
  switch (action) {
    case 'phase_start':
      return evaluatePhaseStart(ctx, opts?.phase);
    case 'phase_approve':
    case 'phase_discard':
      return evaluatePhaseDecision(ctx, opts?.phase);
    case 'integrate':
      return evaluateIntegrate(ctx);
    case 'integration_retry':
      return evaluateRetry(ctx);
    case 'review_approve':
    case 'review_reject':
      return evaluateReviewDecision(ctx);
    case 'archive':
    case 'delete':
      return evaluateCleanup(action, ctx);
  }
}

function evaluatePhaseStart(ctx: FeatureActionContext, phase: FeaturePhase | undefined): ActionVerdict {
  if (ctx.archived) return hidden(ACTION_REASON.archived);
  if (STAGE_CLASS[ctx.integration] === 'terminal') return hidden(ACTION_REASON.completed);
  if (phase === undefined || !(phase in ctx.phases)) return hidden(ACTION_REASON.phaseNotEnabled);
  if (ctx.phases[phase].status !== 'idle') return hidden(ACTION_REASON.phaseNotIdle);
  if (!ctx.hasWorktree) return hidden(ACTION_REASON.noWorktree);
  const busy = busyReason(ctx);
  if (busy !== null) return blocked(busy);
  const decision = STAGE_CLASS[ctx.integration] === 'decision' ? decisionReason(ctx.integration) : null;
  if (decision !== null) return blocked(decision);
  // Vier-Augen-Prinzip: der früheste noch offene Vorschritt ist der, der als
  // Nächstes dran ist — genau ihn nennt der Grund.
  const order = orderedPhases(ctx.phases);
  const open = order.slice(0, order.indexOf(phase)).find((p) => ctx.phases[p].status !== 'approved');
  if (open !== undefined) return blocked(previousPhaseOpenReason(open));
  return AVAILABLE;
}

function evaluatePhaseDecision(ctx: FeatureActionContext, phase: FeaturePhase | undefined): ActionVerdict {
  if (ctx.archived) return hidden(ACTION_REASON.archived);
  if (STAGE_CLASS[ctx.integration] === 'terminal') return hidden(ACTION_REASON.completed);
  if (phase === undefined || !(phase in ctx.phases)) return hidden(ACTION_REASON.phaseNotEnabled);
  if (ctx.phases[phase].status !== 'awaiting_review') return hidden(ACTION_REASON.phaseNotAwaitingReview);
  const busy = busyReason(ctx);
  if (busy !== null) return blocked(busy);
  const decision = STAGE_CLASS[ctx.integration] === 'decision' ? decisionReason(ctx.integration) : null;
  if (decision !== null) return blocked(decision);
  return AVAILABLE;
}

function evaluateIntegrate(ctx: FeatureActionContext): ActionVerdict {
  if (ctx.archived) return hidden(ACTION_REASON.archived);
  if (ctx.integration !== 'none') return hidden(alreadyIntegratingReason(ctx.integration));
  // FR-002/US1: vor der Fertigstellung wird die Aktion gar nicht erst angeboten.
  if (!isFeatureComplete(ctx.phases)) return hidden(ACTION_REASON.notComplete);
  if (!ctx.hasWorktree) return hidden(ACTION_REASON.noWorktree);
  const busy = busyReason(ctx);
  if (busy !== null) return blocked(busy);
  // 'unknown' sperrt bewusst nicht — die Oberfläche behauptet nie fälschlich
  // „gesperrt"; ein trotzdem abgeschickter Start wird serverseitig abgelehnt.
  if (ctx.hasChanges === false) return blocked(ACTION_REASON.noChanges);
  return AVAILABLE;
}

function evaluateRetry(ctx: FeatureActionContext): ActionVerdict {
  if (ctx.archived) return hidden(ACTION_REASON.archived);
  if (!RETRYABLE_STAGES.includes(ctx.integration)) return hidden(ACTION_REASON.noFailedIntegration);
  const busy = busyReason(ctx);
  if (busy !== null) return blocked(busy);
  return AVAILABLE;
}

function evaluateReviewDecision(ctx: FeatureActionContext): ActionVerdict {
  if (ctx.archived) return hidden(ACTION_REASON.archived);
  // FR-019: ein als Vorschau geöffnetes Feature in Entwicklung bietet keine Entscheidung an.
  if (ctx.integration !== 'awaiting_human_review') return hidden(ACTION_REASON.notAwaitingReview);
  const busy = busyReason(ctx);
  if (busy !== null) return blocked(busy);
  return AVAILABLE;
}

/**
 * Aufräum-Aktionen (FR-017): in JEDEM Zustand verfügbar, auch für nie
 * integrierte Features. Sie werden nie gesperrt — stattdessen weist die
 * Rückfrage auf den Abbruch laufender Arbeit hin (FR-008).
 */
function evaluateCleanup(action: 'archive' | 'delete', ctx: FeatureActionContext): ActionVerdict {
  if (action === 'archive' && ctx.archived) return hidden(ACTION_REASON.alreadyArchived);
  return { availability: 'available', reason: null, confirmAbortsWork: busyReason(ctx) !== null };
}
