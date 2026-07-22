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
  | { kind: 'grid' }
  | { kind: 'console'; featureId: string }
  | { kind: 'shell'; projectId: string };

export interface UiState {
  app: AppState | null;
  view: View;
  selectedProjectId: string | null; // null = alle Projekte
  error: string | null;
}

export type Action =
  | { type: 'bootstrap'; state: AppState }
  | { type: 'feature_updated'; feature: Feature }
  | { type: 'session_status'; payload: { sessionId: string; featureId: string | null; projectId: string; status: LiveSessionInfo['status']; awaitingKind: string | null } }
  | { type: 'attention_raised'; item: AttentionItem }
  | { type: 'attention_resolved'; id: string }
  | { type: 'queue_updated'; payload: { projectId: string; items: MergeQueueItem[] } }
  | { type: 'set_view'; view: View }
  | { type: 'select_project'; projectId: string | null }
  | { type: 'error'; message: string | null };

function reducer(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'bootstrap':
      return { ...state, app: action.state };
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
        kind: prev?.kind ?? 'feature',
        status: p.status,
        awaitingKind: p.awaitingKind,
        exited: p.status === 'stopped' || p.status === 'errored',
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
    case 'set_view':
      return { ...state, view: action.view };
    case 'select_project':
      return { ...state, selectedProjectId: action.projectId };
    case 'error':
      return { ...state, error: action.message };
  }
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
    error: null,
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
