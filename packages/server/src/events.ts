import { EventEmitter } from 'node:events';
import type {
  AttentionItem,
  Feature,
  MergeQueueItem,
  SessionDisplayStatus,
  AwaitingKind,
} from '@sdd/shared';

/** Server-interne Events, die 1:1 als WS-Broadcast an alle Clients gehen. */
export interface BusEvents {
  feature_updated: (feature: Feature) => void;
  session_status: (payload: {
    sessionId: string;
    featureId: string | null;
    /** Gesetzt bei Arbeits-Chat-Sessions (kind chat_work) für Chat-Panel-Routing. */
    conversationId: string | null;
    projectId: string;
    status: SessionDisplayStatus;
    awaitingKind: AwaitingKind | null;
  }) => void;
  attention_raised: (item: AttentionItem) => void;
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
  /** Invalidierungssignal: Turn fertig, Vorschlag entschieden oder Unterhaltung zurückgesetzt. */
  chat_updated: (payload: { projectId: string; conversationId: string }) => void;
  /** Ergebnis einer Arbeits-Chat-Integration (Übernehmen nach main). */
  chat_work_integrated: (payload: {
    projectId: string;
    conversationId: string;
    result: 'merged' | 'failed';
    detail: string;
  }) => void;
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

export const BUS_EVENT_NAMES: (keyof BusEvents)[] = [
  'feature_updated',
  'session_status',
  'attention_raised',
  'attention_resolved',
  'queue_updated',
  'notification',
  'knowledge_updated',
  'chat_stream',
  'chat_updated',
  'chat_work_integrated',
];
