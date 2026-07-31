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
  // Port 0 = Telemetrie zeigt ins Leere; dieser Test prüft die Sendepipeline, nicht die Messung.
  const mgr = new PtySessionManager(join(tmpdir(), `sdd-test-${process.pid}`), 0, callbacks);
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

  // Regression: /clear und /compact laufen NICHT durch Claudes Prompt-Handling — sie
  // feuern kein user_prompt_submit, sondern beenden die Session mit Restart-Reason.
  // Ohne diesen Zweig lief jedes Reset-Kommando in die Retry-Erschöpfung und riss über
  // onSubmitFailed die real laufende Phase mit (kein Auto-Progress, keine Tokens).
  it.each(['clear', 'compact', 'resume'])(
    'akzeptiert session_end(reason=%s) als Zustellbestätigung und meldet KEIN onSubmitFailed',
    (reason) => {
      const { mgr, onSubmitFailed } = makeManager();
      const s = fakeSession({ kind: 'ready' });
      inject(mgr, s);

      mgr.sendPrompt(s.id, '/clear');
      vi.advanceTimersByTime(SUBMIT_DELAY_MS);
      expect(s.submitPending).not.toBeNull();

      dispatch(mgr, s, { type: 'hook', event: { name: 'session_end', reason } });
      expect(s.submitPending).toBeNull();

      // Über das gesamte Retry-Fenster hinaus: kein Fehlschlag, keine weiteren CRs.
      vi.advanceTimersByTime((SUBMIT_CONFIRM_MS + 1) * (MAX_SUBMIT_RETRIES + 1));
      expect(onSubmitFailed).not.toHaveBeenCalled();
      expect(crCount(s)).toBe(1);
    },
  );

  it('behandelt ein echtes Session-Ende (reason=other) weiterhin NICHT als Bestätigung', () => {
    const { mgr } = makeManager();
    const s = fakeSession({ kind: 'ready' });
    inject(mgr, s);

    mgr.sendPrompt(s.id, 'x');
    vi.advanceTimersByTime(SUBMIT_DELAY_MS);
    dispatch(mgr, s, { type: 'hook', event: { name: 'session_end', reason: 'prompt_input_exit' } });

    expect(s.submitPending).not.toBeNull(); // kein Restart-Reason → keine Zustellbestätigung
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


// ---------- Session-Ende über die Prozessgruppe (US4, FR-040/FR-041, SC-008) ----------

describe('PtySessionManager.terminate — Prozessgruppe statt PTY-Handle', () => {
  /**
   * node-pty macht das Kind über forkpty() zum Gruppenführer. `kill(-pid)`
   * trifft deshalb genau die Prozesse DIESER Session — einschließlich eines darin
   * gestarteten Dev-Servers. `pty.kill()` allein beendete nur die Shell: der Enkel
   * überlebte und hielt das Arbeitsverzeichnis, woran anschließend das Entfernen
   * des Worktrees scheiterte (research E11/E12).
   */
  function fakeWithPid(pid: number) {
    const s = fakeSession('idle');
    const kill = vi.fn();
    s.pty = { write: s.pty.write, kill, pid } as unknown as LiveSession['pty'];
    return { s, kill };
  }

  it('sendet das Signal an die NEGATIVE pid — also an die Gruppe', async () => {
    const { mgr } = makeManager();
    const { s } = fakeWithPid(4242);
    inject(mgr, s);
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await mgr.terminate(s.id);

    const gruppenSignale = spy.mock.calls.filter(([pid]) => pid === -4242);
    expect(gruppenSignale.length).toBeGreaterThan(0);
    expect(gruppenSignale[0]?.[1]).toBe('SIGTERM');
    // Kein Signal an eine fremde oder an die eigene (0) Gruppe.
    expect(spy.mock.calls.every(([pid]) => pid === -4242)).toBe(true);
    spy.mockRestore();
  }, 15_000);

  it('fällt auf das eigene PTY-Handle zurück, wenn die Gruppe nicht erreichbar ist', async () => {
    const { mgr } = makeManager();
    const { s, kill } = fakeWithPid(4243);
    inject(mgr, s);
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });

    await mgr.terminate(s.id);

    expect(kill).toHaveBeenCalled();
    spy.mockRestore();
  }, 15_000);

  /** `kill(-0, …)` wäre die EIGENE Gruppe — also der Toolkit-Server selbst. */
  it('sendet niemals an Gruppe 0', async () => {
    const { mgr } = makeManager();
    const { s } = fakeWithPid(0);
    inject(mgr, s);
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await mgr.terminate(s.id);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }, 15_000);
});
