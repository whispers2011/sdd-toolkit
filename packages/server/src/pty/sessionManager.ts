import { spawn, type IPty } from 'node-pty';
import { nanoid } from 'nanoid';
import {
  initialSession,
  reduceSession,
  displayStatus,
  isReadyForInput,
  isTerminal,
  RESTART_REASONS,
  type SessionEffect,
  type SessionMachine,
  type SessionSignal,
} from '@sdd/shared';
import { existsSync } from 'node:fs';
import { loginShellEnv } from './loginShellEnv.js';
import { ensureSpawnHelperExecutable } from './ptyFix.js';
import { HookEventWatcher, writeHookSettings, type HookSetup } from './hookBridge.js';
import { telemetryEnvFor } from '../telemetry/telemetryEnv.js';
import { TranscriptWatcher, locateTranscript } from './transcriptWatcher.js';
import { SnapshotStore, snapshotReplayBanner } from './snapshotStore.js';
import {
  bracketedPaste,
  KILL_LINE,
  SUBMIT_DELAY_MS,
  SUBMIT_KEY,
  SUBMIT_CONFIRM_MS,
  MAX_SUBMIT_RETRIES,
  READY_TIMEOUT_MS,
} from './commandBuilder.js';

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
  /** Prompts, die eingereiht wurden, weil die Session (noch) nicht eingabebereit war. */
  pendingPrompts: string[];
  /** Aktuell abgeschickter Prompt, dessen Zustellung noch nicht bestätigt ist. */
  submitPending: { text: string; attempts: number } | null;
  /** Timer für Paste→CR bzw. Bestätigungsfenster/Retry des aktuellen Submits. */
  submitTimer: NodeJS.Timeout | null;
  /** Timer, der eine nie eingabebereit werdende Session als Fehlschlag beendet. */
  readyTimer: NodeJS.Timeout | null;
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
  /**
   * Ein Prompt konnte nicht zugestellt werden, obwohl die Session lebt (Retries
   * erschöpft bzw. nie eingabebereit). Der Aufrufer rollt z. B. den Phasenstatus
   * zurück und erzeugt ein „braucht dich"-Item.
   */
  onSubmitFailed?: (session: LiveSession, text: string) => void;
  /**
   * Ein Prompt wurde nachweislich angenommen (Gegenstück zu onSubmitFailed).
   * Der Orchestrator markiert damit den Phasenprompt als zugestellt — erst danach
   * darf ein `Stop` als Abschluss DIESER Phase gelten. Ohne das beendet der Stop
   * eines vorgeschalteten Reset-Kommandos die Phase, bevor sie begonnen hat.
   */
  onSubmitConfirmed?: (session: LiveSession, text: string) => void;
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
    /** Port des eigenen Servers — Ziel der Telemetrie-Meldungen (127.0.0.1). */
    private serverPort: number,
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

    // Verbrauchsmeldungen dieser Session tragen ihre Marke, damit jede Meldung
    // eindeutig dieser Session gehört — unabhängig davon, ob die Claude-Session-ID
    // beim Start schon bekannt ist. Genau das ersetzt die frühere Rekonstruktion
    // der Startmarke aus Byte-Positionen (Feature "token-und-kostenmessung...").
    const telemetryEnv = telemetryEnvFor({ sessionId: id }, this.serverPort, env);

    let hookSetup: HookSetup | null = null;
    let argv = opts.argv;
    if (opts.withHooks) {
      // Der env-Block der Settings-Datei schlägt die Prozessumgebung (research.md D5) —
      // ohne ihn könnte eine gegenläufige ~/.claude/settings.json die Messung abschalten.
      hookSetup = writeHookSettings(this.dataDir, id, telemetryEnv);
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
      // Zusätzlich zur Settings-Datei: kostet nichts und trägt, falls die Datei
      // einmal fehlt (withHooks=false, z. B. Shell-Sessions).
      env: { ...env, ...telemetryEnv, SDD_SESSION_ID: id },
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
      pendingPrompts: [],
      submitPending: null,
      submitTimer: null,
      readyTimer: null,
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
      // Sendekontrolle stilllegen: der Exit-Pfad (handleExit) übernimmt Rollback/Attention.
      this.clearSubmitTimer(session);
      this.clearReadyTimer(session);
      session.submitPending = null;
      session.pendingPrompts = [];
      if (session.snapshotKey) this.snapshots.save(session.snapshotKey, session.scrollback);
      this.dispatch(session, { type: 'process_exited', code: exitCode });
      void session.hookWatcher?.stop();
      this.detachTranscript(session);
      // Läuft im PTY-'exit'-Event: eine Exception hier wäre uncaught und würde
      // den Prozess beenden. Fehler des Exit-Handlers isolieren.
      try {
        this.callbacks.onExit(session, exitCode);
      } catch (err) {
        console.error(`[pty] onExit-Handler für Session ${session.id} fehlgeschlagen:`, err);
      }
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
    // Zustellung bestätigen, sobald der abgeschickte Prompt nachweislich angenommen wurde.
    if (session.submitPending && isSubmitConfirming(signal)) {
      const confirmed = session.submitPending.text;
      this.clearSubmitPending(session);
      this.callbacks.onSubmitConfirmed?.(session, confirmed);
    }
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
    // Warteschlange antreiben (z. B. nachdem die Session eingabebereit wurde).
    this.pump(session);
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

  /**
   * Prompt zuverlässig senden: einreihen und antreiben. Das eigentliche Absenden
   * (Bracketed Paste + bestätigtes CR mit Retry) erfolgt, sobald die Session
   * eingabebereit ist — siehe pump()/deliver(). Ersetzt das frühere „blind nach
   * 80 ms CR", das bei frisch gespawnter TUI ins Leere lief.
   */
  sendPrompt(id: string, text: string): void {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.pendingPrompts.push(text);
    this.pump(s);
  }

  /** Nächsten eingereihten Prompt zustellen, sobald die Session bereit ist. */
  private pump(s: LiveSession): void {
    if (s.exited || s.submitPending || s.pendingPrompts.length === 0) return;
    if (isTerminal(s.machine.state)) {
      // Session nimmt nie wieder Eingaben an → der Exit-Pfad behandelt den Rest.
      s.pendingPrompts = [];
      return;
    }
    if (!isReadyForInput(s.machine.state)) {
      this.armReadyTimeout(s);
      return;
    }
    this.clearReadyTimer(s);
    const text = s.pendingPrompts.shift()!;
    this.deliver(s, text);
  }

  /** Paste schreiben und den bestätigten Submit anstoßen. */
  private deliver(s: LiveSession, text: string): void {
    // Eingabezeile vorher leeren. Wird ein Prompt getippt, während Claude noch
    // arbeitet, nimmt die TUI den Text zwar an, sendet ihn aber nicht ab; das CR
    // verpufft, die Retries laufen leer und der NÄCHSTE Prompt landet als Paste
    // hinter dem alten Text in derselben Zeile. So entstand real
    // `/clear/speckit-implement` aus zwei getrennten Prompts — der Reset wurde
    // dadurch nie als TUI-Kommando ausgeführt und die Phasenbuchführung verrutschte
    // um eine Position. Bei leerer Zeile ist das Kill-Line ein No-op.
    s.pty.write(KILL_LINE);
    s.pty.write(bracketedPaste(text));
    s.submitPending = { text, attempts: 0 };
    this.armSubmit(s, SUBMIT_DELAY_MS);
  }

  private armSubmit(s: LiveSession, delay: number): void {
    this.clearSubmitTimer(s);
    s.submitTimer = setTimeout(() => this.fireSubmit(s), delay);
  }

  /** CR schicken, dann auf ein Bestätigungssignal warten (sonst Retry). */
  private fireSubmit(s: LiveSession): void {
    if (s.exited || !s.submitPending) return;
    s.pty.write(SUBMIT_KEY);
    this.clearSubmitTimer(s);
    s.submitTimer = setTimeout(() => this.onSubmitUnconfirmed(s), SUBMIT_CONFIRM_MS);
  }

  private onSubmitUnconfirmed(s: LiveSession): void {
    const sp = s.submitPending;
    if (!sp || s.exited) return;
    if (sp.attempts < MAX_SUBMIT_RETRIES) {
      sp.attempts += 1;
      this.armSubmit(s, 0); // CR erneut senden, danach wieder auf Bestätigung warten
      return;
    }
    // Aufgegeben: Session lebt, nimmt den Prompt aber nicht an → Aufrufer informieren.
    const text = sp.text;
    this.clearSubmitPending(s);
    this.callbacks.onSubmitFailed?.(s, text);
    this.pump(s);
  }

  private clearSubmitPending(s: LiveSession): void {
    this.clearSubmitTimer(s);
    s.submitPending = null;
  }

  private clearSubmitTimer(s: LiveSession): void {
    if (s.submitTimer) clearTimeout(s.submitTimer);
    s.submitTimer = null;
  }

  /** Eine nie eingabebereit werdende Session als Zustell-Fehlschlag beenden. */
  private armReadyTimeout(s: LiveSession): void {
    if (s.readyTimer) return;
    s.readyTimer = setTimeout(() => {
      s.readyTimer = null;
      if (s.exited || s.submitPending) return;
      if (!isReadyForInput(s.machine.state) && s.pendingPrompts.length > 0) {
        const failed = s.pendingPrompts.splice(0);
        for (const t of failed) this.callbacks.onSubmitFailed?.(s, t);
      }
    }, READY_TIMEOUT_MS);
  }

  private clearReadyTimer(s: LiveSession): void {
    if (s.readyTimer) clearTimeout(s.readyTimer);
    s.readyTimer = null;
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (s && !s.exited && cols > 0 && rows > 0) s.pty.resize(cols, rows);
  }

  /** Graceful: 2× Ctrl+C (TUI-Exit-Routine + JSONL-Flush), dann SIGKILL-Fallback. */
  async terminate(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    // PTY-Operationen dürfen nie werfen: schreibt/killt man ein PTY, dessen
    // Kindprozess bereits weg ist, wirft node-pty (EIO / „pty destroyed") — das
    // würde als unbehandelte Rejection den ganzen Serverprozess reißen.
    const safe = (fn: () => void) => {
      try {
        if (!s.exited) fn();
      } catch {
        /* PTY bereits tot — Exit-Pfad übernimmt den Rest. */
      }
    };
    safe(() => s.pty.write('\x03'));
    await delay(150);
    if (s.exited) return;
    safe(() => s.pty.write('\x03'));
    await delay(1200);
    safe(() => s.pty.kill());
  }

  displayStatusOf(id: string): ReturnType<typeof displayStatus> | null {
    const s = this.sessions.get(id);
    return s ? displayStatus(s.machine.state) : null;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }
}

/**
 * Signale, die belegen, dass ein abgeschickter Prompt angenommen wurde.
 *
 * `user_prompt_submit`/`working` deckt normale Prompts ab. Lokale TUI-Kommandos
 * (`/clear`, `/compact`) durchlaufen dagegen NICHT das Prompt-Handling von Claude:
 * sie feuern kein `user_prompt_submit` und lösen kein Transkript-`working` aus,
 * sondern beenden die Claude-Session mit einem Restart-Reason und starten sie neu.
 * Ohne diesen Zweig blieb ein Reset-Kommando ewig unbestätigt → 4 vergebliche CR-Retries
 * → `onSubmitFailed`, obwohl das Kommando längst ausgeführt war (Ursache dafür, dass
 * Auto-Progress bei contextStrategy 'fresh'/'compact' nie griff).
 */
function isSubmitConfirming(signal: SessionSignal): boolean {
  if (signal.type === 'hook') {
    if (signal.event.name === 'user_prompt_submit') return true;
    return signal.event.name === 'session_end' && signal.event.reason !== null && RESTART_REASONS.has(signal.event.reason);
  }
  if (signal.type === 'transcript') return signal.event === 'working';
  return false;
}

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_\-./=:@]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
