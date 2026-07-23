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
import { existsSync } from 'node:fs';
import { loginShellEnv } from './loginShellEnv.js';
import { ensureSpawnHelperExecutable } from './ptyFix.js';
import { HookEventWatcher, writeHookSettings, type HookSetup } from './hookBridge.js';
import { TranscriptWatcher, locateTranscript } from './transcriptWatcher.js';
import { SnapshotStore, snapshotReplayBanner } from './snapshotStore.js';
import { bracketedPaste, SUBMIT_DELAY_MS, SUBMIT_KEY } from './commandBuilder.js';

const SCROLLBACK_LIMIT = 2 * 1024 * 1024; // 2 MB Ring-Puffer pro Session

export interface LiveSession {
  id: string;
  projectId: string;
  featureId: string | null;
  /** Bindung an eine Chat-Unterhaltung (nur bei kind==='chat_work'). */
  conversationId: string | null;
  kind: 'feature' | 'shell' | 'chat_work';
  /** Schlüssel für Snapshot-Persistenz (Feature-Id bzw. `chat-<conversationId>`); null = kein Snapshot. */
  snapshotKey: string | null;
  cwd: string;
  pty: IPty;
  machine: SessionMachine;
  hookSetup: HookSetup | null;
  hookWatcher: HookEventWatcher | null;
  transcriptWatcher: TranscriptWatcher | null;
  transcriptRetryTimer: NodeJS.Timeout | null;
  claudeSessionId: string | null;
  scrollback: string;
  /** Snapshot der Vorgänger-Session (Replay nach Server-Neustart). */
  snapshotPrefix: string | null;
  subscribers: Set<Subscriber>;
  exited: boolean;
  /** Letzter Aktivitätszeitpunkt: gesetzt beim Start, aktualisiert bei working/awaiting_input. */
  lastActiveAt: number;
}

/**
 * Feed-Drosselung (WP8, WhisperM8 TerminalFeedBatcher-Muster): fokussierte
 * Subscriber streamen sofort, unfokussierte gebündelt (~12 Hz) — sonst bricht
 * der Browser bei vielen gleichzeitigen Grid-Panes ein.
 */
interface Subscriber {
  send: (data: string) => void;
  focused: boolean;
  buffer: string;
  timer: NodeJS.Timeout | null;
}

export interface SubscribeHandle {
  unsubscribe: () => void;
  setFocused: (focused: boolean) => void;
}

const BATCH_INTERVAL_MS = 80;

export interface SessionCallbacks {
  onStatusChange: (session: LiveSession, effects: SessionEffect[]) => void;
  onExit: (session: LiveSession, exitCode: number) => void;
  onClaudeSessionId: (session: LiveSession, claudeSessionId: string) => void;
  /** Volltext einer abgeschlossenen Assistant-Nachricht (Marker-Erkennung, nur Chat-Work). */
  onAssistantText?: (session: LiveSession, text: string) => void;
}

/**
 * PTY-Registry: hält alle lebenden Sessions. PTYs leben am Server weiter,
 * wenn kein Browser verbunden ist — Reconnect ersetzt nur die Subscriber.
 */
export class PtySessionManager {
  private sessions = new Map<string, LiveSession>();
  readonly snapshots: SnapshotStore;

  constructor(
    private dataDir: string,
    private callbacks: SessionCallbacks,
  ) {
    this.snapshots = new SnapshotStore(dataDir);
    ensureSpawnHelperExecutable();
  }

  async spawn(opts: {
    projectId: string;
    featureId: string | null;
    conversationId?: string | null;
    kind: 'feature' | 'shell' | 'chat_work';
    cwd: string;
    argv: string[];
    /** Claude-Session: Hook-Bridge aktivieren. */
    withHooks: boolean;
    sessionId?: string;
  }): Promise<LiveSession> {
    const id = opts.sessionId ?? nanoid(10);
    if (!existsSync(opts.cwd)) {
      throw new Error(`Arbeitsverzeichnis existiert nicht: ${opts.cwd}`);
    }
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

    const snapshotKey =
      opts.kind === 'feature' && opts.featureId
        ? opts.featureId
        : opts.kind === 'chat_work' && opts.conversationId
          ? `chat-${opts.conversationId}`
          : null;

    const session: LiveSession = {
      id,
      projectId: opts.projectId,
      featureId: opts.featureId,
      conversationId: opts.conversationId ?? null,
      kind: opts.kind,
      snapshotKey,
      cwd: opts.cwd,
      pty,
      machine: initialSession,
      hookSetup,
      hookWatcher: null,
      transcriptWatcher: null,
      transcriptRetryTimer: null,
      claudeSessionId: null,
      scrollback: '',
      snapshotPrefix: snapshotKey ? this.snapshots.load(snapshotKey) : null,
      subscribers: new Set(),
      exited: false,
      lastActiveAt: Date.now(),
    };
    this.sessions.set(id, session);

    pty.onData((data) => {
      session.scrollback = (session.scrollback + data).slice(-SCROLLBACK_LIMIT);
      for (const sub of session.subscribers) {
        if (sub.focused) {
          sub.send(data);
        } else {
          sub.buffer += data;
          if (!sub.timer) {
            sub.timer = setTimeout(() => {
              sub.timer = null;
              if (sub.buffer) {
                sub.send(sub.buffer);
                sub.buffer = '';
              }
            }, BATCH_INTERVAL_MS);
          }
        }
      }
    });

    pty.onExit(({ exitCode }) => {
      session.exited = true;
      if (session.snapshotKey) this.snapshots.save(session.snapshotKey, session.scrollback);
      this.dispatch(session, { type: 'process_exited', code: exitCode });
      void session.hookWatcher?.stop();
      this.detachTranscript(session);
      this.callbacks.onExit(session, exitCode);
    });

    if (hookSetup) {
      session.hookWatcher = new HookEventWatcher(hookSetup.eventFile, (event) => {
        if (event.claudeSessionId && event.claudeSessionId !== session.claudeSessionId) {
          session.claudeSessionId = event.claudeSessionId;
          this.callbacks.onClaudeSessionId(session, event.claudeSessionId);
          this.attachTranscript(session); // folgt auch /clear-Neustarts (neue Session-ID)
        }
        if (event.signal) this.dispatch(session, { type: 'hook', event: event.signal });
      });
      session.hookWatcher.start();
    }

    this.dispatch(session, { type: 'process_spawned' });
    return session;
  }

  /**
   * Transkript-Watcher (WP1) starten, sobald die Claude-Session-ID bekannt ist.
   * Das JSONL entsteht erst mit dem ersten Turn — bei Bedarf mit Retry suchen.
   */
  private attachTranscript(session: LiveSession, attempt = 0): void {
    this.detachTranscript(session);
    if (!session.claudeSessionId || session.exited) return;

    const path = locateTranscript(session.cwd, session.claudeSessionId);
    if (!path) {
      if (attempt < 6) {
        session.transcriptRetryTimer = setTimeout(() => this.attachTranscript(session, attempt + 1), 5_000);
      }
      return;
    }
    session.transcriptWatcher = new TranscriptWatcher(
      path,
      (signal) => this.dispatch(session, signal),
      this.callbacks.onAssistantText ? (text) => this.callbacks.onAssistantText!(session, text) : undefined,
    );
    session.transcriptWatcher.start();
  }

  private detachTranscript(session: LiveSession): void {
    if (session.transcriptRetryTimer) clearTimeout(session.transcriptRetryTimer);
    session.transcriptRetryTimer = null;
    void session.transcriptWatcher?.stop();
    session.transcriptWatcher = null;
  }

  private dispatch(session: LiveSession, signal: SessionSignal): void {
    const before = session.machine.state;
    const { machine, effects } = reduceSession(session.machine, signal);
    session.machine = machine;
    // „Zuletzt aktiv" = begann zu arbeiten oder stellte eine Rückfrage (Grid-Sortierung).
    if (machine.state.kind === 'working' || machine.state.kind === 'awaiting_input') {
      session.lastActiveAt = Date.now();
    }
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

  forConversation(conversationId: string): LiveSession | undefined {
    for (const s of this.sessions.values()) {
      if (s.conversationId === conversationId && !s.exited) return s;
    }
    return undefined;
  }

  list(): LiveSession[] {
    return [...this.sessions.values()];
  }

  subscribe(id: string, onData: (data: string) => void): SubscribeHandle | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    // Replay: erst Snapshot der Vorgänger-Session (falls vorhanden), dann Live-Scrollback.
    if (s.snapshotPrefix) onData(s.snapshotPrefix + snapshotReplayBanner());
    if (s.scrollback) onData(s.scrollback);
    const sub: Subscriber = { send: onData, focused: true, buffer: '', timer: null };
    s.subscribers.add(sub);
    return {
      unsubscribe: () => {
        if (sub.timer) clearTimeout(sub.timer);
        s.subscribers.delete(sub);
      },
      setFocused: (focused: boolean) => {
        sub.focused = focused;
        if (focused && sub.buffer) {
          if (sub.timer) clearTimeout(sub.timer);
          sub.timer = null;
          sub.send(sub.buffer);
          sub.buffer = '';
        }
      },
    };
  }

  /** Beim Server-Shutdown: alle Scrollbacks mit Snapshot-Schlüssel sichern. */
  saveAllSnapshots(): void {
    for (const s of this.sessions.values()) {
      if (s.snapshotKey && !s.exited) this.snapshots.save(s.snapshotKey, s.scrollback);
    }
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
