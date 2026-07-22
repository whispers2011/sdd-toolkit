import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import {
  WORKING_STALL_SECONDS,
  assistantTextFromTranscriptLine,
  decideTranscriptSignal,
  encodeClaudeCwd,
  parseClaudeTranscriptLine,
  type SessionSignal,
} from '@sdd/shared';

/**
 * Transkript-JSONL einer Claude-Session lokalisieren.
 * Stufe 1 (99 %-Fall): deterministischer Pfad `<root>/<encoded-cwd>/<id>.jsonl`.
 * Stufe 2: Scan über die übrigen Projektverzeichnisse (cwd kann abweichen).
 */
export function locateTranscript(cwd: string, claudeSessionId: string): string | null {
  const root = join(homedir(), '.claude', 'projects');
  const direct = join(root, encodeClaudeCwd(cwd), `${claudeSessionId}.jsonl`);
  if (existsSync(direct)) return direct;

  try {
    for (const dir of readdirSync(root)) {
      const candidate = join(root, dir, `${claudeSessionId}.jsonl`);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* Root fehlt → keine Transkripte */
  }
  return null;
}

const STALL_CHECK_INTERVAL_MS = 30_000;

/**
 * Watcht das Transkript-JSONL und liefert Status-Signale aus NEUEN Zeilen
 * (Offset ab Startgröße — kein retroaktives Feuern alter Events).
 * Die Prioritätsregel „Hooks schlagen Transcript, außer turn_aborted"
 * implementiert die Session-State-Machine, nicht dieser Watcher.
 */
export class TranscriptWatcher {
  private watcher: FSWatcher | null = null;
  private stallTimer: NodeJS.Timeout | null = null;
  private offset = 0;
  private buffer = '';
  private lastStat: { mtimeMs: number; size: number } | null = null;
  private lastSignalWasWorking = false;

  constructor(
    private transcriptPath: string,
    private onSignal: (signal: SessionSignal) => void,
    /** Optional: Volltext jeder Assistant-Zeile (für Marker-Erkennung, z. B. Feature-Vorschläge). */
    private onAssistantText?: (text: string) => void,
  ) {}

  start(): void {
    try {
      const st = statSync(this.transcriptPath);
      this.offset = st.size;
      this.lastStat = { mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      this.offset = 0;
    }
    this.watcher = watch(this.transcriptPath, { persistent: true, ignoreInitial: true });
    this.watcher.on('change', () => this.drain());
    this.stallTimer = setInterval(() => this.checkStall(), STALL_CHECK_INTERVAL_MS);
  }

  private drain(): void {
    // stat-first: unverändert → nur 1 Syscall, kein Read.
    let st: { mtimeMs: number; size: number };
    try {
      const s = statSync(this.transcriptPath);
      st = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return;
    }
    if (this.lastStat && st.mtimeMs === this.lastStat.mtimeMs && st.size === this.lastStat.size) return;
    this.lastStat = st;
    if (st.size < this.offset) this.offset = 0; // Datei wurde ersetzt/gekürzt
    if (st.size === this.offset) return;

    const fd = openSync(this.transcriptPath, 'r');
    try {
      const len = st.size - this.offset;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, this.offset);
      this.offset = st.size;
      this.buffer += buf.toString('utf8');
    } finally {
      closeSync(fd);
    }

    // Letztes statusrelevantes Event der neuen Zeilen bestimmt das Signal.
    let idx: number;
    let signal: ReturnType<typeof decideTranscriptSignal> = null;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const raw = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!raw) continue;
      const event = parseClaudeTranscriptLine(raw);
      if (!event) continue;
      const s = decideTranscriptSignal(event);
      if (s !== null) signal = s;
      if (this.onAssistantText && event.kind === 'assistant_stopped') {
        const text = assistantTextFromTranscriptLine(raw);
        if (text) this.onAssistantText(text);
      }
    }
    if (signal !== null) {
      this.lastSignalWasWorking = signal === 'working';
      this.onSignal({ type: 'transcript', event: signal });
    }
  }

  /** Sicherheitsnetz: „working" ohne File-Write seit >120 s ist keine Arbeit mehr. */
  private checkStall(): void {
    if (!this.lastSignalWasWorking) return;
    try {
      const st = statSync(this.transcriptPath);
      if ((Date.now() - st.mtimeMs) / 1000 > WORKING_STALL_SECONDS) {
        this.lastSignalWasWorking = false;
        this.onSignal({ type: 'stall_timeout' });
      }
    } catch {
      /* Datei weg → SessionEnd/Exit regeln das */
    }
  }

  async stop(): Promise<void> {
    if (this.stallTimer) clearInterval(this.stallTimer);
    this.stallTimer = null;
    await this.watcher?.close();
    this.watcher = null;
  }
}
