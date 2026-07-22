import { spawn, type IPty } from 'node-pty';
import { nanoid } from 'nanoid';
import {
  initialSession,
  reduceSession,
  displayStatus,
  type SessionEffect,
  type SessionMachine,
  type SessionSignal,
} from '@sdd/shared';
import { loginShellEnv } from './loginShellEnv.js';
import { HookEventWatcher, writeHookSettings, type HookSetup } from './hookBridge.js';
import { bracketedPaste, SUBMIT_DELAY_MS, SUBMIT_KEY } from './commandBuilder.js';

const SCROLLBACK_LIMIT = 2 * 1024 * 1024; // 2 MB Ring-Puffer pro Session

export interface LiveSession {
  id: string;
  projectId: string;
  featureId: string | null;
  kind: 'feature' | 'shell';
  pty: IPty;
  machine: SessionMachine;
  hookSetup: HookSetup | null;
  hookWatcher: HookEventWatcher | null;
  claudeSessionId: string | null;
  scrollback: string;
  subscribers: Set<(data: string) => void>;
  exited: boolean;
}

export interface SessionCallbacks {
  onStatusChange: (session: LiveSession, effects: SessionEffect[]) => void;
  onExit: (session: LiveSession, exitCode: number) => void;
  onClaudeSessionId: (session: LiveSession, claudeSessionId: string) => void;
}

/**
 * PTY-Registry: hält alle lebenden Sessions. PTYs leben am Server weiter,
 * wenn kein Browser verbunden ist — Reconnect ersetzt nur die Subscriber.
 */
export class PtySessionManager {
  private sessions = new Map<string, LiveSession>();

  constructor(
    private dataDir: string,
    private callbacks: SessionCallbacks,
  ) {}

  async spawn(opts: {
    projectId: string;
    featureId: string | null;
    kind: 'feature' | 'shell';
    cwd: string;
    argv: string[];
    /** Claude-Session: Hook-Bridge aktivieren. */
    withHooks: boolean;
    sessionId?: string;
  }): Promise<LiveSession> {
    const id = opts.sessionId ?? nanoid(10);
    const env = await loginShellEnv();

    let hookSetup: HookSetup | null = null;
    let argv = opts.argv;
    if (opts.withHooks) {
      hookSetup = writeHookSettings(this.dataDir, id);
      // --settings wird vom Aufrufer via Platzhalter erwartet:
      argv = argv.map((a) => (a === '__SETTINGS__' ? hookSetup!.settingsPath : a));
    }

    const shell = env.SHELL ?? '/bin/zsh';
    const command = argv.map(shellQuote).join(' ');
    const pty = spawn(shell, ['-l', '-c', command], {
      name: 'xterm-256color',
      cols: 120,
      rows: 32,
      cwd: opts.cwd,
      env: { ...env, SDD_SESSION_ID: id },
    });

    const session: LiveSession = {
      id,
      projectId: opts.projectId,
      featureId: opts.featureId,
      kind: opts.kind,
      pty,
      machine: initialSession,
      hookSetup,
      hookWatcher: null,
      claudeSessionId: null,
      scrollback: '',
      subscribers: new Set(),
      exited: false,
    };
    this.sessions.set(id, session);

    pty.onData((data) => {
      session.scrollback = (session.scrollback + data).slice(-SCROLLBACK_LIMIT);
      for (const sub of session.subscribers) sub(data);
    });

    pty.onExit(({ exitCode }) => {
      session.exited = true;
      this.dispatch(session, { type: 'process_exited', code: exitCode });
      void session.hookWatcher?.stop();
      this.callbacks.onExit(session, exitCode);
    });

    if (hookSetup) {
      session.hookWatcher = new HookEventWatcher(hookSetup.eventFile, (event) => {
        if (event.claudeSessionId && event.claudeSessionId !== session.claudeSessionId) {
          session.claudeSessionId = event.claudeSessionId;
          this.callbacks.onClaudeSessionId(session, event.claudeSessionId);
        }
        if (event.signal) this.dispatch(session, { type: 'hook', event: event.signal });
      });
      session.hookWatcher.start();
    }

    this.dispatch(session, { type: 'process_spawned' });
    return session;
  }

  private dispatch(session: LiveSession, signal: SessionSignal): void {
    const before = session.machine.state;
    const { machine, effects } = reduceSession(session.machine, signal);
    session.machine = machine;
    if (before !== machine.state || effects.length > 0) {
      this.callbacks.onStatusChange(session, effects);
    }
  }

  get(id: string): LiveSession | undefined {
    return this.sessions.get(id);
  }

  forFeature(featureId: string): LiveSession | undefined {
    for (const s of this.sessions.values()) {
      if (s.featureId === featureId && !s.exited) return s;
    }
    return undefined;
  }

  list(): LiveSession[] {
    return [...this.sessions.values()];
  }

  subscribe(id: string, onData: (data: string) => void): (() => void) | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.scrollback) onData(s.scrollback); // Replay für Reconnect
    s.subscribers.add(onData);
    return () => s.subscribers.delete(onData);
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  /** Prompt senden: Bracketed Paste + verzögertes CR (WhisperM8-Send-Pipeline). */
  sendPrompt(id: string, text: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.pty.write(bracketedPaste(text));
    setTimeout(() => {
      if (!s.exited) s.pty.write(SUBMIT_KEY);
    }, SUBMIT_DELAY_MS);
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (s && !s.exited && cols > 0 && rows > 0) s.pty.resize(cols, rows);
  }

  /** Graceful: 2× Ctrl+C (TUI-Exit-Routine + JSONL-Flush), dann SIGKILL-Fallback. */
  async terminate(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.pty.write('\x03');
    await delay(150);
    if (s.exited) return;
    s.pty.write('\x03');
    await delay(1200);
    if (!s.exited) s.pty.kill();
  }

  displayStatusOf(id: string): ReturnType<typeof displayStatus> | null {
    const s = this.sessions.get(id);
    return s ? displayStatus(s.machine.state) : null;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }
}

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_\-./=:@]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
