import type { AttentionItem, AttentionKind, IntegrationStage, SessionDisplayStatus } from '@sdd/shared';

/** Laufzeit-Zustand einer Live-Session, soweit für die Gültigkeitsprüfung relevant. */
export interface LiveSessionState {
  sessionId: string;
  status: SessionDisplayStatus;
  featureId: string | null;
  conversationId: string | null;
}

/** Autoritativer Zustands-Snapshot, aus dem sich die Gültigkeit einer Meldung ableitet. */
export interface ReconcileSnapshot {
  sessions: LiveSessionState[];
  /** featureId → aktuelle Integration-Stage. */
  featureStages: Map<string, IntegrationStage>;
}

/**
 * Merge-Fluss-Arten sind genau dann gültig, wenn `feature.integration` der zugeordneten
 * Stage entspricht (persistiert → restart-sicher). Siehe data-model.md.
 */
export const STAGE_FOR_KIND: Partial<Record<AttentionKind, IntegrationStage>> = {
  review_due: 'awaiting_human_review',
  verify_failed: 'verify_failed',
  gate_failed: 'gate_failed',
  merge_conflict_escalated: 'conflict_escalated',
};

function findSession(item: AttentionItem, snap: ReconcileSnapshot): LiveSessionState | undefined {
  return snap.sessions.find(
    (s) =>
      (item.sessionId != null && s.sessionId === item.sessionId) ||
      (item.conversationId != null && s.conversationId === item.conversationId),
  );
}

/**
 * Ist die Meldung anhand des aktuellen Zustands weiterhin gültig (aktiv)?
 * Nicht positiv bestätigbar → false (konservativ stale, FR-015).
 * `permission_request` ist nicht Teil der Inbox und wird nie angetastet (immer „gültig").
 */
export function isAttentionValid(item: AttentionItem, snap: ReconcileSnapshot): boolean {
  switch (item.kind) {
    case 'permission_request':
      return true;
    case 'awaiting_input': {
      const s = findSession(item, snap);
      return !!s && s.status === 'awaiting_input';
    }
    case 'agent_errored': {
      // Stale, sobald eine Live-Session desselben Features (bzw. derselben Session/Unterhaltung)
      // wieder arbeitet. Ohne laufende Arbeit bleibt der Fehler bestehen.
      if (item.featureId) {
        return !snap.sessions.some((s) => s.featureId === item.featureId && s.status === 'working');
      }
      const s = findSession(item, snap);
      return !(s && s.status === 'working');
    }
    case 'review_due':
    case 'verify_failed':
    case 'gate_failed':
    case 'merge_conflict_escalated': {
      if (!item.featureId) return false;
      const stage = snap.featureStages.get(item.featureId);
      if (stage === undefined) return false;
      return stage === STAGE_FOR_KIND[item.kind];
    }
    default:
      return true;
  }
}

/** Offene Meldungen, deren Zustand aktuell nicht (mehr) gültig ist. */
export function findStaleRuntime(open: AttentionItem[], snap: ReconcileSnapshot): AttentionItem[] {
  return open.filter((i) => i.kind !== 'permission_request' && !isAttentionValid(i, snap));
}

/**
 * Boot-Variante: Live-Sessions sind nach dem Neustart beendet, ihr Laufzeit-Status ist verloren.
 * Session-basierte Arten (`awaiting_input`, `agent_errored`) sind damit nicht bestätigbar und
 * werden konservativ als stale behandelt (D3). Merge-Arten bleiben an `feature.integration`
 * gekoppelt und damit weiterhin exakt bestimmbar.
 */
export function findStaleOnBoot(
  open: AttentionItem[],
  featureStages: Map<string, IntegrationStage>,
): AttentionItem[] {
  const snap: ReconcileSnapshot = { sessions: [], featureStages };
  return open.filter((i) => {
    if (i.kind === 'permission_request') return false;
    if (i.kind === 'awaiting_input' || i.kind === 'agent_errored') return true;
    return !isAttentionValid(i, snap);
  });
}
