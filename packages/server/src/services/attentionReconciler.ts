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
  // Absichtlich KEIN Eintrag für 'verification_unconfigured': die Art ist
  // projektbezogen (featureId === null). Eine Stufen-Kopplung würde den Eintrag bei
  // jedem Stufenwechsel jedes Features auflösen und beim nächsten Feature erneut
  // entstehen lassen — genau die Dauerlast, die FR-006 ausschließt.
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
    case 'server_outage':
      // Ein Ausfall ist ein Ereignis der Vergangenheit — es gibt keinen „aktiven Zustand",
      // an dem er sich prüfen liesse. Nur der Mensch erledigt ihn. Der `default: true`
      // unten würde das heute zufällig richtig machen; der explizite Fall hält es richtig,
      // wenn jemand später den Default umdreht (D14).
      return true;
    case 'awaiting_input': {
      const s = findSession(item, snap);
      return !!s && s.status === 'awaiting_input';
    }
    case 'agent_errored':
    case 'run_interrupted':
    case 'phase_gate_failed': {
      // „Prozess"-Meldungen (Agent-Fehler / unterbrochener Lauf / fehlgeschlagenes Phasen-Gate):
      // obsolet, sobald eine Live-Session desselben Features (bzw. derselben Session/Unterhaltung)
      // wieder arbeitet — dann wird der Auslöser gerade „auf andere Weise" behoben (Lauf fortgesetzt
      // bzw. Phase/Gate erneut angestoßen) und es gibt nichts mehr zu tun. Ohne laufende Arbeit
      // bleiben sie bestehen (stage-unabhängig — ein Integration-Stage-Wechsel löst sie NICHT).
      if (item.featureId) {
        return !snap.sessions.some((s) => s.featureId === item.featureId && s.status === 'working');
      }
      const s = findSession(item, snap);
      return !(s && s.status === 'working');
    }
    case 'lifecycle_step_failed':
      // Ein fehlgeschlagener Lebenszyklus-Schritt (z. B. `pnpm install`) ist nicht
      // dadurch behoben, dass irgendeine Session desselben Features arbeitet oder
      // die Integration eine Stufe weiterrückt. Die Meldung bleibt gültig, bis ein
      // erfolgreicher Wiederanlauf desselben Auslösers sie auflöst — oder der Mensch
      // sie in der Inbox erledigt. Bewusst NICHT im Zweig der „Prozess"-Meldungen
      // und bewusst ohne Eintrag in STAGE_FOR_KIND (sonst räumt jeder setStage() sie ab).
      return true;
    case 'verification_unconfigured':
      // Gültigkeit kommt aus der Projektkonfiguration, nicht aus Session- oder
      // Stufenzustand: solange das Projekt keine Verifikationskommandos hat, gibt es
      // etwas zu tun. Aufgelöst wird der Eintrag ausschließlich von
      // `resolveVerificationGaps()`, sobald ein Kommando konfiguriert ist (FR-007) —
      // oder von Hand. Ein eigener `case` statt des `default`-Zweigs, damit die
      // Entscheidung hier steht und nicht aus einem Fallback zu lesen ist.
      return true;
    case 'review_due':
    case 'verify_failed':
    case 'gate_failed':
    case 'merge_conflict_escalated': {
      if (!item.featureId) return false;
      const stage = snap.featureStages.get(item.featureId);
      if (stage === undefined) return false;
      return stage === STAGE_FOR_KIND[item.kind];
    }
    case 'run_unpriced':
    case 'phase_false_start':
    case 'project_without_runs':
    case 'metering_conflict':
      // Datenbefunde: der Widerspruch steht in der Datenbank und besteht unabhängig
      // davon, ob gerade ein Agent arbeitet (FR-016) oder ob das Toolkit neu gestartet
      // wurde (FR-017). Nur ein Mensch löst sie auf; danach kehren sie erst bei
      // gewachsenem Bestand zurück (Wasserstand in plausibility_state).
      //
      // Sie fielen ohnehin in den default-Zweig — die Zweige stehen explizit da, damit
      // ein späteres Umsortieren des switch sie nicht versehentlich in eine
      // Prozess-Gruppe zieht. Kein Eintrag in STAGE_FOR_KIND: nicht stufengebunden.
      return true;
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
    // Ein Ausfall wird gerade BEIM Boot gemeldet — er darf im selben Boot nicht wieder
    // aufgelöst werden und auch nicht in den pauschalen Stale-Zweig unten geraten (C4.7).
    if (i.kind === 'server_outage') return false;
    // Ein fehlgeschlagener Lebenszyklus-Schritt überlebt den Neustart: er hängt an
    // keiner Session und ist ohne Wiederanlauf weiterhin offen.
    if (i.kind === 'lifecycle_step_failed') return false;
    if (i.kind === 'awaiting_input' || i.kind === 'agent_errored') return true;
    return !isAttentionValid(i, snap);
  });
}
