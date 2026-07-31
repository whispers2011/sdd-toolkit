import { EventEmitter } from 'node:events';
import type {
  AgentTrigger,
  AttentionItem,
  Feature,
  MergeQueueItem,
  SessionDisplayStatus,
  AwaitingKind,
} from '@sdd/shared';

/** Server-interne Events, die 1:1 als WS-Broadcast an alle Clients gehen. */
export interface BusEvents {
  feature_updated: (feature: Feature) => void;
  /** Feature endgültig gelöscht (Worktree + alle Spuren entfernt). */
  feature_deleted: (payload: { featureId: string; projectId: string }) => void;
  session_status: (payload: {
    sessionId: string;
    featureId: string | null;
    /** Gesetzt bei Arbeits-Chat-Sessions (kind chat_work) für Chat-Panel-Routing. */
    conversationId: string | null;
    projectId: string;
    status: SessionDisplayStatus;
    awaitingKind: AwaitingKind | null;
    /** Letzter Aktivitätszeitpunkt (Grid-Sortierung: zuletzt aktiv zuerst). */
    lastActiveAt: number;
  }) => void;
  attention_raised: (item: AttentionItem) => void;
  /**
   * Eine „braucht dich"-Meldung ist erledigt. Nutzdatum ist **ausschliesslich** eine
   * `AttentionItem.id` — `Feature.id`, `LiveSession.id` und `Conversation.id` sind unzulässig,
   * weil die Anzeige allein über die Item-ID zuordnet (C1). Pro betroffener Meldung genau ein
   * Ereignis, kein Sammel-Ereignis mit ID-Liste (C2), und nur beim tatsächlichen Übergang
   * offen → aufgelöst (C3). Nicht direkt senden, sondern über `emitAttentionResolved()` (C4).
   */
  attention_resolved: (id: string) => void;
  queue_updated: (payload: { projectId: string; items: MergeQueueItem[] }) => void;
  notification: (payload: {
    title: string;
    body: string;
    featureId: string | null;
    kind: 'turn_completed' | 'input_requested' | 'escalation' | 'merged';
  }) => void;
  knowledge_updated: (payload: { projectId: string }) => void;
  /** Antwortfortschritt eines Chat-Turns: kumulierter Text (idempotent), done = terminal. */
  chat_stream: (payload: {
    projectId: string;
    conversationId: string;
    messageId: string;
    text: string;
    done: boolean;
  }) => void;
  /** Invalidierungssignal: Turn fertig, Vorschlag (Feature-Karte) geändert oder Unterhaltung zurückgesetzt. */
  chat_updated: (payload: { projectId: string; conversationId: string }) => void;
  /** Reviewer-Kommentare eines Features geändert (Portal lädt die Liste neu). */
  review_comments_updated: (payload: { featureId: string }) => void;
  /** Start/Abschluss eines Agent-Gate-Laufs (gateRunning-Badge, Audit-Refresh). */
  agent_gate: (payload: {
    featureId: string;
    projectId: string;
    trigger: AgentTrigger;
    status: 'running' | 'pass' | 'fail';
  }) => void;
  /**
   * Verbrauch eines bereits abgeschlossenen Laufs wurde nachträglich verrechnet
   * (verspätet eingetroffene Telemetrie, FR-011). Die Ansicht lädt die Läufe neu,
   * damit sich die Zahl ohne Zutun des Nutzers korrigiert.
   */
  execution_updated: (payload: { executionId: string; featureId: string | null }) => void;
}

class TypedBus extends EventEmitter {
  emitEvent<K extends keyof BusEvents>(event: K, ...args: Parameters<BusEvents[K]>): void {
    this.emit(event, ...args);
  }
  onEvent<K extends keyof BusEvents>(event: K, listener: BusEvents[K]): void {
    this.on(event, listener as (...args: unknown[]) => void);
  }
}

export const bus = new TypedBus();
bus.setMaxListeners(100);

/**
 * Auflösungs-Meldungen an die Oberfläche: pro betroffenem Item genau ein Ereignis,
 * Nutzdatum ausschliesslich die Item-ID (FR-001/FR-002/FR-003).
 *
 * Kanonisches Aufrufmuster an jedem Auflöseweg — erst auflösen, dann mit den
 * zurückgegebenen IDs senden:
 *
 * ```ts
 * emitAttentionResolved(this.deps.attention.resolveFor({ featureId, kinds: ['review_due'] }));
 * if (deps.attention.resolve(id)) emitAttentionResolved([id]);
 * ```
 *
 * Eine leere Liste ist wirkungslos und fehlerfrei (FR-006): trifft ein Auflöseweg keine
 * offene Meldung, wird nichts gesendet.
 */
export function emitAttentionResolved(ids: readonly string[]): void {
  for (const id of ids) bus.emitEvent('attention_resolved', id);
}

export const BUS_EVENT_NAMES: (keyof BusEvents)[] = [
  'feature_updated',
  'feature_deleted',
  'session_status',
  'attention_raised',
  'attention_resolved',
  'queue_updated',
  'notification',
  'knowledge_updated',
  'chat_stream',
  'chat_updated',
  'review_comments_updated',
  'agent_gate',
  'execution_updated',
];
