import { describe, expect, it } from 'vitest';
import {
  displayStatus,
  initialSession,
  reduceSession,
  type SessionMachine,
  type SessionSignal,
} from './sessionMachine.js';

function run(signals: SessionSignal[], from: SessionMachine = initialSession) {
  let machine = from;
  const effects = [];
  for (const s of signals) {
    const r = reduceSession(machine, s);
    machine = r.machine;
    effects.push(...r.effects);
  }
  return { machine, effects };
}

describe('sessionMachine', () => {
  it('Lebenszyklus: spawn → session_start → prompt → tools → stop', () => {
    const { machine, effects } = run([
      { type: 'process_spawned' },
      { type: 'hook', event: { name: 'session_start' } },
      { type: 'hook', event: { name: 'user_prompt_submit' } },
      { type: 'hook', event: { name: 'pre_tool_use', toolName: 'Bash' } },
      { type: 'hook', event: { name: 'post_tool_use' } },
      { type: 'hook', event: { name: 'stop' } },
    ]);
    expect(machine.state.kind).toBe('turn_done');
    expect(displayStatus(machine.state)).toBe('idle');
    expect(effects).toEqual([{ kind: 'turn_completed' }]);
  });

  it('PermissionRequest → awaiting_input(permission) mit Effekt', () => {
    const { machine, effects } = run([
      { type: 'hook', event: { name: 'user_prompt_submit' } },
      { type: 'hook', event: { name: 'permission_request' } },
    ]);
    expect(machine.state).toEqual({ kind: 'awaiting_input', awaiting: 'permission' });
    expect(effects).toContainEqual({ kind: 'input_requested', awaiting: 'permission' });
  });

  it('AskUserQuestion/ExitPlanMode → question/plan_approval', () => {
    const q = run([{ type: 'hook', event: { name: 'pre_tool_use', toolName: 'AskUserQuestion' } }]);
    expect(q.machine.state).toEqual({ kind: 'awaiting_input', awaiting: 'question' });
    const p = run([{ type: 'hook', event: { name: 'pre_tool_use', toolName: 'ExitPlanMode' } }]);
    expect(p.machine.state).toEqual({ kind: 'awaiting_input', awaiting: 'plan_approval' });
  });

  it('Effekt-Dedup: doppelter PermissionRequest feuert nur einmal', () => {
    const { effects } = run([
      { type: 'hook', event: { name: 'permission_request' } },
      { type: 'hook', event: { name: 'permission_request' } },
    ]);
    expect(effects.filter((e) => e.kind === 'input_requested')).toHaveLength(1);
  });

  it('Hooks schlagen Transcript', () => {
    const { machine } = run([
      { type: 'hook', event: { name: 'user_prompt_submit' } },
      { type: 'transcript', event: 'turn_finished' }, // muss ignoriert werden
    ]);
    expect(machine.state.kind).toBe('working');
  });

  it('ESC-Abbruch kommt trotz Hooks aus dem Transcript durch', () => {
    const { machine } = run([
      { type: 'hook', event: { name: 'user_prompt_submit' } },
      { type: 'transcript', event: 'turn_aborted' },
    ]);
    expect(machine.state.kind).toBe('ready');
  });

  it('Transcript-Fallback ohne Hooks: working → turn_finished mit Effekt', () => {
    const { machine, effects } = run([
      { type: 'transcript', event: 'working' },
      { type: 'transcript', event: 'turn_finished' },
    ]);
    expect(machine.state.kind).toBe('turn_done');
    expect(effects).toEqual([{ kind: 'turn_completed' }]);
  });

  it('SessionEnd mit clear/resume/compact ist ein In-Place-Neustart', () => {
    for (const reason of ['clear', 'resume', 'compact']) {
      const { machine } = run([
        { type: 'hook', event: { name: 'user_prompt_submit' } },
        { type: 'hook', event: { name: 'session_end', reason } },
      ]);
      expect(machine.state.kind).toBe('ready');
    }
    const ended = run([{ type: 'hook', event: { name: 'session_end', reason: 'other' } }]);
    expect(ended.machine.state.kind).toBe('stopped');
  });

  it('process_exited: 0 → stopped, sonst errored', () => {
    expect(run([{ type: 'process_exited', code: 0 }]).machine.state.kind).toBe('stopped');
    expect(run([{ type: 'process_exited', code: 1 }]).machine.state.kind).toBe('errored');
  });

  it('stall_timeout setzt working auf ready zurück', () => {
    const { machine } = run([
      { type: 'transcript', event: 'working' },
      { type: 'stall_timeout' },
    ]);
    expect(machine.state.kind).toBe('ready');
  });

  it('terminale Zustände ignorieren Nachzügler-Signale', () => {
    const { machine, effects } = run([
      { type: 'process_exited', code: 0 },
      { type: 'hook', event: { name: 'stop' } },
      { type: 'transcript', event: 'working' },
    ]);
    expect(machine.state.kind).toBe('stopped');
    expect(effects).toEqual([{ kind: 'session_ended' }]);
  });
});
