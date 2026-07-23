import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { AttentionItem, Feature, MergeQueueItem } from '@sdd/shared';
import { api, type AppState, type LiveSessionInfo } from './api.js';

export type View =
  | { kind: 'board' }
  | { kind: 'inbox' }
  | { kind: 'executions' }
  | { kind: 'review' }
  | { kind: 'grid' }
  | { kind: 'console'; featureId: string }
  | { kind: 'shell'; projectId: string }
  | { kind: 'knowledge'; projectId: string }
  | { kind: 'agents'; projectId: string };

/** Laufender Antwort-Stream eines Chat-Turns (kumulierter Text, idempotent). */
export interface ChatStreamState {
  projectId: string;
  conversationId: string;
  text: string;
  done: boolean;
}

export interface UiState {
  app: AppState | null;
  view: View;
  selectedProjectId: string | null; // null = kein Projekt vorhanden (Leerzustand); sonst genau ein Projekt
  /** Abgeschlossene (merged) Features anzeigen? Default: ausgeblendet. */
  showCompleted: boolean;
  /** Invalidierungs-Zähler je Projekt — Wissens-Views refetchen bei Änderung. */
  knowledgeVersion: Record<string, number>;
  error: string | null;
  /**
   * Projekt-Chat: Streams pro messageId + Invalidierungssignal. Die
   * Panel-Sichtbarkeit ist bewusst lokal (ChatBubble) — hier liegt nur, was
   * über WS hereinkommt und Panel-Lebenszyklen überleben muss.
   */
  chatStreams: Record<string, ChatStreamState>;
  chatUpdated: { projectId: string; conversationId: string; ts: number } | null;
  /** Signal „Chat-Panel öffnen" (z. B. aus der Inbox) — von ChatBubble konsumiert. */
  openChat: { projectId: string; ts: number } | null;
  /** Kommentar-Invalidierung pro Feature — Portal refetcht bei Änderung. */
  reviewCommentsVersion: Record<string, number>;
  /** Laufende before/after-Gates pro Feature (gateRunning-Badge). */
  gateRunning: Record<string, boolean>;
  /** Invalidierung nach Gate-Abschluss — Audit-Ansichten refetchen. */
  agentGateVersion: number;
}

export type Action =
  | { type: 'bootstrap'; state: AppState }
  | { type: 'feature_updated'; feature: Feature }
  | { type: 'session_status'; payload: { sessionId: string; featureId: string | null; conversationId: string | null; projectId: string; status: LiveSessionInfo['status']; awaitingKind: string | null; lastActiveAt?: number } }
  | { type: 'attention_raised'; item: AttentionItem }
  | { type: 'attention_resolved'; id: string }
  | { type: 'queue_updated'; payload: { projectId: string; items: MergeQueueItem[] } }
  | { type: 'set_view'; view: View }
  | { type: 'select_project'; projectId: string }
  | { type: 'toggle_completed' }
  | { type: 'knowledge_updated'; projectId: string }
  | { type: 'error'; message: string | null }
  | { type: 'chat_stream'; payload: { projectId: string; conversationId: string; messageId: string; text: string; done: boolean } }
  | { type: 'chat_updated'; payload: { projectId: string; conversationId: string } }
  | { type: 'open_chat'; projectId: string }
  | { type: 'review_comments_updated'; featureId: string }
  | { type: 'agent_gate'; payload: { featureId: string; status: 'running' | 'pass' | 'fail' } };

function reducer(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'bootstrap': {
      // Kontext auflösen: sobald Projekte existieren, ist genau eines aktiv (FR-001/FR-004).
      const selectedProjectId = resolveSelectedProject(action.state.projects, state.selectedProjectId);
      if (selectedProjectId !== null) persistSelectedProject(selectedProjectId);
      return { ...state, app: action.state, selectedProjectId };
    }
    case 'feature_updated': {
      if (!state.app) return state;
      const exists = state.app.features.some((f) => f.id === action.feature.id);
      const features = exists
        ? state.app.features.map((f) => (f.id === action.feature.id ? action.feature : f))
        : [...state.app.features, action.feature];
      return { ...state, app: { ...state.app, features: features.filter((f) => !f.archivedAt) } };
    }
    case 'session_status': {
      if (!state.app) return state;
      const p = action.payload;
      const others = state.app.sessions.filter((s) => s.id !== p.sessionId);
      const prev = state.app.sessions.find((s) => s.id === p.sessionId);
      const session: LiveSessionInfo = {
        id: p.sessionId,
        projectId: p.projectId,
        featureId: p.featureId,
        conversationId: p.conversationId,
        kind: prev?.kind ?? (p.conversationId ? 'chat_work' : 'feature'),
        status: p.status,
        awaitingKind: p.awaitingKind,
        exited: p.status === 'stopped' || p.status === 'errored',
        // Zeitstempel darf durch ein Status-Update nie verloren gehen (Grid-Sortierung).
        lastActiveAt: p.lastActiveAt ?? prev?.lastActiveAt ?? Date.now(),
      };
      return { ...state, app: { ...state.app, sessions: [...others, session] } };
    }
    case 'attention_raised': {
      if (!state.app) return state;
      const exists = state.app.attention.some((a) => a.id === action.item.id);
      return exists
        ? state
        : { ...state, app: { ...state.app, attention: [action.item, ...state.app.attention] } };
    }
    case 'attention_resolved': {
      if (!state.app) return state;
      // id kann eine Attention-ID oder eine Session-ID (resolveFor) sein.
      return {
        ...state,
        app: {
          ...state.app,
          attention: state.app.attention.filter((a) => a.id !== action.id && a.sessionId !== action.id),
        },
      };
    }
    case 'queue_updated': {
      if (!state.app) return state;
      return {
        ...state,
        app: { ...state.app, queues: { ...state.app.queues, [action.payload.projectId]: action.payload.items } },
      };
    }
    case 'set_view': {
      // Fremd-Navigation zieht den Projektkontext mit (FR-007/Contract C6):
      // Öffnet man eine Feature-Konsole (Benachrichtigung, Inbox, ⌘K, Board),
      // wird automatisch dessen Projekt aktiver Kontext.
      const view = action.view;
      if (view.kind === 'console' && state.app) {
        const feature = state.app.features.find((f) => f.id === view.featureId);
        if (feature && feature.projectId !== state.selectedProjectId) {
          persistSelectedProject(feature.projectId);
          return { ...state, view, selectedProjectId: feature.projectId };
        }
      }
      return { ...state, view };
    }
    case 'select_project': {
      // Kontext-Trennung: beim Projektwechsel keine fremden Inhalte stehen lassen —
      // Konsole/Terminal eines anderen Projekts fällt aufs Board zurück.
      let view = state.view;
      if (state.app) {
        if (view.kind === 'console') {
          const feature = state.app.features.find((f) => f.id === (view as { featureId: string }).featureId);
          if (feature && feature.projectId !== action.projectId) view = { kind: 'board' };
        } else if (view.kind === 'shell' && view.projectId !== action.projectId) {
          view = { kind: 'board' };
        } else if (view.kind === 'knowledge' && view.projectId !== action.projectId) {
          view = { kind: 'board' };
        } else if (view.kind === 'agents' && view.projectId !== action.projectId) {
          view = { kind: 'board' };
        }
      }
      persistSelectedProject(action.projectId);
      return { ...state, selectedProjectId: action.projectId, view };
    }
    case 'toggle_completed': {
      const next = !state.showCompleted;
      localStorage.setItem('sdd-show-completed', next ? 'on' : 'off');
      return { ...state, showCompleted: next };
    }
    case 'knowledge_updated': {
      const cur = state.knowledgeVersion[action.projectId] ?? 0;
      return { ...state, knowledgeVersion: { ...state.knowledgeVersion, [action.projectId]: cur + 1 } };
    }
    case 'error':
      return { ...state, error: action.message };
    case 'open_chat': {
      persistSelectedProject(action.projectId);
      return { ...state, selectedProjectId: action.projectId, openChat: { projectId: action.projectId, ts: Date.now() } };
    }
    case 'chat_stream': {
      const { messageId, ...stream } = action.payload;
      return { ...state, chatStreams: { ...state.chatStreams, [messageId]: stream } };
    }
    case 'chat_updated': {
      // Abgeschlossene Streams der Unterhaltung aufräumen — das Panel lädt bei
      // diesem Signal ohnehin die autoritative Fassung per GET nach.
      const chatStreams = Object.fromEntries(
        Object.entries(state.chatStreams).filter(
          ([, s]) => !(s.conversationId === action.payload.conversationId && s.done),
        ),
      );
      return { ...state, chatStreams, chatUpdated: { ...action.payload, ts: Date.now() } };
    }
    case 'review_comments_updated': {
      const cur = state.reviewCommentsVersion[action.featureId] ?? 0;
      return {
        ...state,
        reviewCommentsVersion: { ...state.reviewCommentsVersion, [action.featureId]: cur + 1 },
      };
    }
    case 'agent_gate': {
      return {
        ...state,
        gateRunning: { ...state.gateRunning, [action.payload.featureId]: action.payload.status === 'running' },
        agentGateVersion: state.agentGateVersion + 1,
      };
    }
  }
}

/** Sichtbare Features unter Berücksichtigung von Projekt-Scope und Abgeschlossen-Filter. */
export function visibleFeatures(state: UiState): AppState['features'] {
  if (!state.app) return [];
  return state.app.features.filter(
    (f) =>
      f.projectId === state.selectedProjectId &&
      (state.showCompleted || f.integration !== 'merged'),
  );
}

/** Gemerkte Projektauswahl — überlebt Neustarts (FR-005). */
const SELECTED_PROJECT_KEY = 'sdd-selected-project';

function rememberedProject(): string | null {
  return localStorage.getItem(SELECTED_PROJECT_KEY);
}

function persistSelectedProject(id: string): void {
  localStorage.setItem(SELECTED_PROJECT_KEY, id);
}

/** Auflösung des aktiven Projektkontexts (Contract C4): bestehende Auswahl →
 *  gemerkte ID → erstes Projekt → null (Leerzustand, wenn keine Projekte). */
function resolveSelectedProject(projects: AppState['projects'], current: string | null): string | null {
  if (current !== null && projects.some((p) => p.id === current)) return current;
  const remembered = rememberedProject();
  if (remembered !== null && projects.some((p) => p.id === remembered)) return remembered;
  return projects[0]?.id ?? null;
}

export function soundEnabled(): boolean {
  return localStorage.getItem('sdd-sound') !== 'off';
}

export function setSoundEnabled(on: boolean): void {
  localStorage.setItem('sdd-sound', on ? 'on' : 'off');
}

/** Dezenter Zwei-Ton-Beep via WebAudio — kein Asset nötig. */
function playCompletionSound(): void {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    gain.connect(ctx.destination);
    for (const [freq, start] of [
      [880, 0],
      [1174, 0.12],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.15);
    }
    setTimeout(() => void ctx.close(), 600);
  } catch {
    /* Audio blockiert → egal */
  }
}

const StoreContext = createContext<{ state: UiState; dispatch: Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    app: null,
    view: { kind: 'board' },
    selectedProjectId: null,
    showCompleted: localStorage.getItem('sdd-show-completed') === 'on',
    knowledgeVersion: {},
    error: null,
    chatStreams: {},
    chatUpdated: null,
    openChat: null,
    reviewCommentsVersion: {},
    gateRunning: {},
    agentGateVersion: 0,
  });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;

    const bootstrap = () =>
      api
        .state()
        .then((s) => dispatch({ type: 'bootstrap', state: s }))
        .catch((e: Error) => dispatch({ type: 'error', message: e.message }));

    void bootstrap();

    function connect() {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/events`);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { type: string; payload: unknown };
          switch (msg.type) {
            case 'feature_updated':
              dispatch({ type: 'feature_updated', feature: msg.payload as Feature });
              break;
            case 'session_status':
              dispatch({
                type: 'session_status',
                payload: msg.payload as Extract<Action, { type: 'session_status' }>['payload'],
              });
              break;
            case 'attention_raised':
              dispatch({ type: 'attention_raised', item: msg.payload as AttentionItem });
              break;
            case 'attention_resolved':
              dispatch({ type: 'attention_resolved', id: msg.payload as string });
              break;
            case 'queue_updated':
              dispatch({ type: 'queue_updated', payload: msg.payload as { projectId: string; items: MergeQueueItem[] } });
              break;
            case 'knowledge_updated':
              dispatch({ type: 'knowledge_updated', projectId: (msg.payload as { projectId: string }).projectId });
              break;
            case 'chat_stream':
              dispatch({
                type: 'chat_stream',
                payload: msg.payload as Extract<Action, { type: 'chat_stream' }>['payload'],
              });
              break;
            case 'chat_updated':
              dispatch({
                type: 'chat_updated',
                payload: msg.payload as Extract<Action, { type: 'chat_updated' }>['payload'],
              });
              break;
            case 'review_comments_updated':
              dispatch({
                type: 'review_comments_updated',
                featureId: (msg.payload as { featureId: string }).featureId,
              });
              break;
            case 'agent_gate':
              dispatch({
                type: 'agent_gate',
                payload: msg.payload as Extract<Action, { type: 'agent_gate' }>['payload'],
              });
              break;
            case 'notification': {
              const n = msg.payload as {
                title: string;
                body: string;
                featureId: string | null;
                kind: 'turn_completed' | 'input_requested' | 'escalation' | 'merged';
              };
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                const note = new Notification(n.title, { body: n.body, tag: `${n.kind}:${n.featureId ?? ''}` });
                // Klick fokussiert das Fenster und springt zur Feature-Konsole (WP9).
                note.onclick = () => {
                  window.focus();
                  if (n.featureId) {
                    dispatch({ type: 'set_view', view: { kind: 'console', featureId: n.featureId } });
                  }
                };
              }
              // Sound nur bei „fertig"/„gemergt" — Rückfragen bewusst lautlos (WhisperM8-Regel).
              if ((n.kind === 'turn_completed' || n.kind === 'merged') && soundEnabled()) {
                playCompletionSound();
              }
              break;
            }
          }
        } catch {
          /* ignorieren */
        }
      };
      ws.onclose = () => {
        if (!closed) setTimeout(() => { void bootstrap(); connect(); }, 2000);
      };
    }
    connect();

    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore außerhalb des StoreProvider');
  return ctx;
}
