import type { AwaitingKind, SessionDisplayStatus } from './types.js';

/**
 * Status-Reducer für eine Agent-Session — Port der WhisperM8-AgentSessionStateMachine.
 * Pur, kein I/O. Effekte entstehen nur bei echten Übergängen (Notification-Dedup).
 * Prioritätsregel: Hooks schlagen Transcript.
 */

export type SessionState =
  | { kind: 'created' }
  | { kind: 'launching' }
  | { kind: 'ready' }
  | { kind: 'working' }
  | { kind: 'awaiting_input'; awaiting: AwaitingKind }
  | { kind: 'turn_done' }
  | { kind: 'stopped' }
  | { kind: 'errored' };

export type SessionSignal =
  | { type: 'process_spawned' }
  | { type: 'hook'; event: HookSignal }
  | { type: 'transcript'; event: 'working' | 'turn_finished' | 'turn_aborted' }
  | { type: 'process_exited'; code: number }
  | { type: 'stall_timeout' };

export type HookSignal =
  | { name: 'session_start' }
  | { name: 'user_prompt_submit' }
  /** `detail`: Kurzfassung der Rückfrage (Fragetext / Plan-Titel), sofern im Hook-Payload vorhanden. */
  | { name: 'pre_tool_use'; toolName: string; detail?: string }
  | { name: 'post_tool_use' }
  | { name: 'post_tool_use_failure' }
  | { name: 'permission_request' }
  | { name: 'stop' }
  | { name: 'session_end'; reason: string | null };

export type SessionEffect =
  | { kind: 'turn_completed' }
  | { kind: 'input_requested'; awaiting: AwaitingKind; detail?: string }
  | { kind: 'session_ended' };

export interface SessionMachine {
  state: SessionState;
  /** Sobald Hooks liefern, wird Transcript-Parsing (bis auf Abbruch) ignoriert. */
  hooksLive: boolean;
}

export const initialSession: SessionMachine = { state: { kind: 'created' }, hooksLive: false };

/** SessionEnd-Reasons, die einen In-Place-Neustart bedeuten (kein echtes Ende). */
export const RESTART_REASONS = new Set(['clear', 'resume', 'compact']);

/** Tools, deren PreToolUse „wartet auf den Menschen" bedeutet. */
const AWAITING_TOOLS: Record<string, AwaitingKind> = {
  AskUserQuestion: 'question',
  ExitPlanMode: 'plan_approval',
};

export function reduceSession(
  machine: SessionMachine,
  signal: SessionSignal,
): { machine: SessionMachine; effects: SessionEffect[] } {
  const { state, hooksLive } = machine;
  const terminal = state.kind === 'stopped' || state.kind === 'errored';

  switch (signal.type) {
    case 'process_spawned':
      if (state.kind !== 'created') return noop(machine);
      return next(machine, { kind: 'launching' });

    case 'hook':
      return reduceHook({ state, hooksLive: true }, signal.event, hooksLive);

    case 'transcript': {
      if (terminal) return noop(machine);
      // Hooks schlagen Transcript — außer beim ESC-Abbruch (Stop-Hook feuert dort nicht).
      if (hooksLive && signal.event !== 'turn_aborted') return noop(machine);
      if (signal.event === 'working') return next(machine, { kind: 'working' });
      if (signal.event === 'turn_aborted') {
        return state.kind === 'working' || state.kind === 'awaiting_input'
          ? next(machine, { kind: 'ready' })
          : noop(machine);
      }
      // turn_finished
      if (state.kind === 'working' || state.kind === 'awaiting_input') {
        return next(machine, { kind: 'turn_done' }, [{ kind: 'turn_completed' }]);
      }
      return noop(machine);
    }

    case 'process_exited':
      if (terminal) return noop(machine);
      return signal.code === 0
        ? next(machine, { kind: 'stopped' }, [{ kind: 'session_ended' }])
        : next(machine, { kind: 'errored' }, [{ kind: 'session_ended' }]);

    case 'stall_timeout':
      // Sicherheitsnetz: lange keine Aktivität → nicht mehr als working anzeigen.
      return state.kind === 'working' ? next(machine, { kind: 'ready' }) : noop(machine);
  }
}

function reduceHook(
  machine: SessionMachine,
  event: HookSignal,
  _wasLive: boolean,
): { machine: SessionMachine; effects: SessionEffect[] } {
  const { state } = machine;
  const terminal = state.kind === 'stopped' || state.kind === 'errored';
  if (terminal && event.name !== 'session_start') return noop(machine);

  switch (event.name) {
    case 'session_start':
      return next(machine, { kind: 'ready' });
    case 'user_prompt_submit':
    case 'post_tool_use':
    case 'post_tool_use_failure':
      return next(machine, { kind: 'working' });
    case 'pre_tool_use': {
      const awaiting = AWAITING_TOOLS[event.toolName];
      if (awaiting) {
        return next(machine, { kind: 'awaiting_input', awaiting }, [
          { kind: 'input_requested', awaiting, ...(event.detail ? { detail: event.detail } : {}) },
        ]);
      }
      return next(machine, { kind: 'working' });
    }
    case 'permission_request':
      return next(machine, { kind: 'awaiting_input', awaiting: 'permission' }, [
        { kind: 'input_requested', awaiting: 'permission' },
      ]);
    case 'stop': {
      if (state.kind === 'working' || state.kind === 'awaiting_input') {
        return next(machine, { kind: 'turn_done' }, [{ kind: 'turn_completed' }]);
      }
      return next(machine, { kind: 'turn_done' });
    }
    case 'session_end':
      if (event.reason !== null && RESTART_REASONS.has(event.reason)) {
        return next(machine, { kind: 'ready' });
      }
      return next(machine, { kind: 'stopped' }, [{ kind: 'session_ended' }]);
  }
}

function noop(machine: SessionMachine): { machine: SessionMachine; effects: SessionEffect[] } {
  return { machine, effects: [] };
}

function next(
  machine: SessionMachine,
  state: SessionState,
  effects: SessionEffect[] = [],
): { machine: SessionMachine; effects: SessionEffect[] } {
  // Effekt-Dedup: identischer Zustand → keine Effekte, keine Änderung.
  if (sameState(machine.state, state)) return { machine, effects: [] };
  return { machine: { ...machine, state }, effects };
}

function sameState(a: SessionState, b: SessionState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'awaiting_input' && b.kind === 'awaiting_input') return a.awaiting === b.awaiting;
  return true;
}

/**
 * Kann die Session gerade eine Eingabe (Prompt + Submit) zuverlässig annehmen?
 * Nur wenn die Claude-TUI hochgefahren ist — nicht während created/launching und
 * nicht in terminalen Zuständen. Grundlage des bereitschaftsgesteuerten Absendens.
 */
export function isReadyForInput(state: SessionState): boolean {
  switch (state.kind) {
    case 'ready':
    case 'working':
    case 'turn_done':
    case 'awaiting_input':
      return true;
    default:
      return false;
  }
}

/** Terminaler Zustand: die Session nimmt nie wieder Eingaben an. */
export function isTerminal(state: SessionState): boolean {
  return state.kind === 'stopped' || state.kind === 'errored';
}

/** UI-Abbildung: launching/ready/turn_done erscheinen als idle (WhisperM8-Regel). */
export function displayStatus(state: SessionState): SessionDisplayStatus {
  switch (state.kind) {
    case 'created':
    case 'launching':
    case 'ready':
    case 'turn_done':
      return 'idle';
    case 'working':
      return 'working';
    case 'awaiting_input':
      return 'awaiting_input';
    case 'stopped':
      return 'stopped';
    case 'errored':
      return 'errored';
  }
}
