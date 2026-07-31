import {
  displayStatus,
  evaluateAction,
  isStackConfigured,
  type FeatureActionContext,
  type FeatureActionId,
  type FeaturePhase,
} from '@sdd/shared';
import type { FeatureRepo, ProjectRepo } from '../db/repos.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import type { Orchestrator } from './orchestrator.js';

/**
 * Ablehnung einer Aktion durch die Policy. `statusCode` wird von Fastify
 * übernommen ⇒ 409 mit dem Grundsatz aus `@sdd/shared/actionPolicy` — wortgleich
 * zu dem, was die Oberfläche anzeigt (FR-014).
 */
export class ActionNotAllowedError extends Error {
  readonly statusCode = 409;
  constructor(reason: string) {
    super(reason);
    this.name = 'ActionNotAllowedError';
  }
}

/** Feature existiert nicht — 404 statt 500 aus der Tiefe der Services. */
export class FeatureNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('Feature nicht gefunden');
    this.name = 'FeatureNotFoundError';
  }
}

export interface ActionGuardDeps {
  features: FeatureRepo;
  ptys: PtySessionManager;
  orchestrator: Orchestrator;
  /** Für die Stack-Konfiguration des Projekts (FR-032/FR-033). */
  projects?: ProjectRepo;
  /** Wird für dieses Feature ein Profil betrieben? (Absicht, nicht erhobener Status.) */
  stackRunning?: (featureId: string) => boolean;
  /** Offene Blocker-Befunde früherer Abnahme-Runden; sperren nur die Annahme. */
  openBlockers?: (featureId: string) => number;
}

/**
 * Serverseitige Durchsetzung der Aktions-Policy (FR-024): jede aktionsauslösende
 * Route prüft vor jeder Wirkung dieselbe Funktion, die auch die Oberfläche rendert.
 * Damit ist kein Bedienweg — Schaltfläche, Kartenzug, curl, Automation — an der
 * Bedingung vorbei möglich (FR-003).
 */
export class ActionGuard {
  constructor(private deps: ActionGuardDeps) {}

  /**
   * Der Kontext eines Features aus den autoritativen Server-Quellen.
   * `hasChanges` bleibt 'unknown' (sperrt nicht), außer die Route reicht den
   * ermittelten Wert herein — nur die Integrations-Route tut das (FR-027).
   */
  buildContext(featureId: string, opts: { hasChanges?: boolean | 'unknown' } = {}): FeatureActionContext {
    const feature = this.deps.features.get(featureId);
    if (!feature) throw new FeatureNotFoundError();
    const session = this.deps.ptys.forFeature(featureId);
    const stack = this.deps.projects?.get(feature.projectId)?.stack;
    return {
      phases: feature.phases,
      integration: feature.integration,
      archived: feature.archivedAt !== null,
      hasWorktree: feature.worktreePath !== null,
      session: session ? displayStatus(session.machine.state) : null,
      gateRunning: this.deps.orchestrator.isGateRunning(featureId),
      hasChanges: opts.hasChanges ?? 'unknown',
      stackConfigured: stack ? isStackConfigured(stack) : false,
      stackRunning: this.deps.stackRunning?.(featureId) ?? false,
      stackCanStop: (stack?.stopCommand ?? '').trim() !== '',
      openBlockers: this.deps.openBlockers?.(featureId) ?? 0,
    };
  }

  /** Wirft bei jedem Befund ≠ 'available' — der Grund ist der Ablehnungstext. */
  assertAllowed(
    action: FeatureActionId,
    featureId: string,
    opts: { phase?: FeaturePhase; hasChanges?: boolean | 'unknown' } = {},
  ): void {
    const ctx = this.buildContext(featureId, opts);
    const verdict = evaluateAction(action, ctx, opts.phase ? { phase: opts.phase } : undefined);
    if (verdict.availability !== 'available') {
      throw new ActionNotAllowedError(verdict.reason ?? 'Aktion ist derzeit nicht möglich.');
    }
  }
}
