import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionState } from '@sdd/shared';
import { PtySessionManager, type LiveSession, type SessionCallbacks } from './sessionManager.js';
import {
  bracketedPaste,
  SUBMIT_DELAY_MS,
  SUBMIT_CONFIRM_MS,
  SUBMIT_KEY,
  MAX_SUBMIT_RETRIES,
} from './commandBuilder.js';

/**
 * Testet die bereitschaftsgesteuerte Send-Pipeline (sendPrompt/pump/deliver)
 * ohne echten PTY: eine Fake-Session wird in die Registry injiziert, Signale
 * werden über dispatch() simuliert, Timer laufen als Fake-Timer.
 */

function makeManager() {
  const onSubmitFailed = vi.fn();
  const callbacks: SessionCallbacks = {
    onStatusChange: () => {},
    onExit: () => {},
    onClaudeSessionId: () => {},
    onSubmitFailed,
  };
  const mgr = new PtySessionManager(join(tmpdir(), `sdd-test-${process.pid}`), callbacks);
  return { mgr, onSubmitFailed };
}

function fakeSession(state: SessionState): LiveSession {
  const write = vi.fn();
  return {
    id: 'sess1',
    projectId: 'p',
    featureId: 'f',
    conversationId: null,
    kind: 'feature',
    snapshotKey: null,
    cwd: tmpdir(),
    pty: { write } as unknown as LiveSession['pty'],
    machine: { state, hooksLive: true },
    hookSetup: null,
    hookWatcher: null,
    transcriptWatcher: null,
    transcriptRetryTimer: null,
    claudeSessionId: null,
    scrollback: '',
    snapshotPrefix: null,
    subscribers: new Set(),
    exited: false,
    pendingPrompts: [],
    submitPending: null,
    submitTimer: null,
    readyTimer: null,
  };
}

function inject(mgr: PtySessionManager, s: LiveSession) {
  (mgr as unknown as { sessions: Map<string, LiveSession> }).sessions.set(s.id, s);
}

function dispatch(mgr: PtySessionManager, s: LiveSession, signal: unknown) {
  (mgr as unknown as { dispatch(s: LiveSession, sig: unknown): void }).dispatch(s, signal);
}

function writes(s: LiveSession): string[] {
  return (s.pty.write as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
}

function crCount(s: LiveSession): number {
  return writes(s).filter((d) => d === SUBMIT_KEY).length;
}

function pastes(s: LiveSession): string[] {
  return writes(s).filter((d) => d.startsWith('\x1b[200~'));
}

describe('PtySessionManager.sendPrompt — bereitschaftsgesteuertes, bestätigtes Absenden', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reiht bei frisch gespawnter Session ein und schickt nach ready genau einmal ab', () => {
    const { mgr } = makeManager();
    const s = fakeSession({ kind: 'created' });
    inject(mgr, s);

    mgr.sendPrompt(s.id, 'hallo');
    expect(s.pendingPrompts).toEqual(['hallo']); // eingereiht, nichts geschrieben
    expect(writes(s)).toHaveLength(0);

    // Session wird eingabebereit
    dispatch(mgr, s, { type: 'hook', event: { name: 'session_start' } });
    expect(pastes(s)).toEqual([bracketedPaste('hallo')]); // jetzt zugestellt

    vi.advanceTimersByTime(SUBMIT_DELAY_MS);
    expect(crCount(s)).toBe(1); // genau ein Submit
  });

  it('schickt bei bereiter Session sofort ab und bestätigt via working', () => {
    const { mgr } = makeManager();
    const s = fakeSession({ kind: 'ready' });
    inject(mgr, s);

    mgr.sendPrompt(s.id, 'los');
    expect(pastes(s)).toEqual([bracketedPaste('los')]);
    vi.advanceTimersByTime(SUBMIT_DELAY_MS);
    expect(crCount(s)).toBe(1);
    expect(s.submitPending).not.toBeNull();

    // Bestätigung: user_prompt_submit → submitPending gelöscht
    dispatch(mgr, s, { type: 'hook', event: { name: 'user_prompt_submit' } });
    expect(s.submitPending).toBeNull();
  });

  it('wiederholt das CR bei ausbleibender Bestätigung und meldet dann onSubmitFailed', () => {
    const { mgr, onSubmitFailed } = makeManager();
    const s = fakeSession({ kind: 'ready' });
    inject(mgr, s);

    mgr.sendPrompt(s.id, 'x');
    vi.advanceTimersByTime(SUBMIT_DELAY_MS + (SUBMIT_CONFIRM_MS + 1) * (MAX_SUBMIT_RETRIES + 1));

    expect(crCount(s)).toBe(1 + MAX_SUBMIT_RETRIES); // erstes CR + Retries
    expect(onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(onSubmitFailed).toHaveBeenCalledWith(s, 'x');
    expect(s.submitPending).toBeNull();
  });

  it('bewahrt die Reihenfolge zweier aufeinanderfolgender Prompts', () => {
    const { mgr } = makeManager();
    const s = fakeSession({ kind: 'ready' });
    inject(mgr, s);

    mgr.sendPrompt(s.id, 'first');
    mgr.sendPrompt(s.id, 'second');
    expect(s.pendingPrompts).toEqual(['second']); // zweiter wartet hinter dem ersten
    expect(pastes(s)).toEqual([bracketedPaste('first')]);

    vi.advanceTimersByTime(SUBMIT_DELAY_MS);
    dispatch(mgr, s, { type: 'hook', event: { name: 'user_prompt_submit' } }); // ersten bestätigen

    expect(pastes(s)).toEqual([bracketedPaste('first'), bracketedPaste('second')]);
  });
});
