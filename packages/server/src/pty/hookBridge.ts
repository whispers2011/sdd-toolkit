import { writeFileSync, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { HookSignal } from '@sdd/shared';

/**
 * Claude-Hook-Bridge (WhisperM8-Muster): Statt Terminal-Output zu parsen,
 * bekommt Claude eine Settings-JSON, deren Hooks jedes Event als JSON-Zeile an
 * ein session-eigenes Event-File anhängen. Wir watchen das File → zuverlässige
 * Statuserkennung, 0 % Idle-CPU.
 */

const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop',
] as const;

export interface HookSetup {
  settingsPath: string;
  eventFile: string;
}

export function writeHookSettings(dataDir: string, sessionId: string): HookSetup {
  const dir = join(dataDir, 'hooks');
  mkdirSync(dir, { recursive: true });
  const eventFile = join(dir, `${sessionId}.events.jsonl`);
  const settingsPath = join(dir, `${sessionId}.settings.json`);

  // Bewusst simpel gehalten — kein jq nötig, plattformneutral (WhisperM8-Trick).
  const command = `(cat; echo) >> "${eventFile}"`;
  const hooks: Record<string, unknown[]> = {};
  for (const event of HOOK_EVENTS) {
    hooks[event] = [{ hooks: [{ type: 'command', command }] }];
  }

  writeFileSync(settingsPath, JSON.stringify({ hooks }, null, 2), { mode: 0o600 });
  writeFileSync(eventFile, '', { flag: 'a', mode: 0o600 });
  return { settingsPath, eventFile };
}

export interface ParsedHookEvent {
  signal: HookSignal | null;
  /** Externe Claude-Session-ID aus dem Payload (für --resume). */
  claudeSessionId: string | null;
}

export function parseHookLine(line: string): ParsedHookEvent {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { signal: null, claudeSessionId: null };
  }
  const claudeSessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
  const name = payload.hook_event_name;

  switch (name) {
    case 'SessionStart':
      return { signal: { name: 'session_start' }, claudeSessionId };
    case 'SessionEnd':
      return {
        signal: { name: 'session_end', reason: typeof payload.reason === 'string' ? payload.reason : null },
        claudeSessionId,
      };
    case 'UserPromptSubmit':
      return { signal: { name: 'user_prompt_submit' }, claudeSessionId };
    case 'PreToolUse':
      return {
        signal: { name: 'pre_tool_use', toolName: typeof payload.tool_name === 'string' ? payload.tool_name : '' },
        claudeSessionId,
      };
    case 'PostToolUse':
      return { signal: { name: 'post_tool_use' }, claudeSessionId };
    case 'PostToolUseFailure':
      return { signal: { name: 'post_tool_use_failure' }, claudeSessionId };
    case 'PermissionRequest':
      return { signal: { name: 'permission_request' }, claudeSessionId };
    case 'Stop':
      return { signal: { name: 'stop' }, claudeSessionId };
    default:
      return { signal: null, claudeSessionId };
  }
}

/** Watcht ein Event-File und liefert jede neue Zeile inkrementell (offset-basiert). */
export class HookEventWatcher {
  private watcher: FSWatcher | null = null;
  private offset = 0;
  private buffer = '';

  constructor(
    private eventFile: string,
    private onEvent: (event: ParsedHookEvent) => void,
  ) {}

  start(): void {
    try {
      this.offset = statSync(this.eventFile).size;
    } catch {
      this.offset = 0;
    }
    this.watcher = watch(this.eventFile, { persistent: true, ignoreInitial: true });
    this.watcher.on('change', () => this.drain());
  }

  private drain(): void {
    let size: number;
    try {
      size = statSync(this.eventFile).size;
    } catch {
      return;
    }
    if (size < this.offset) this.offset = 0; // File wurde ersetzt
    if (size === this.offset) return;

    const fd = openSync(this.eventFile, 'r');
    try {
      const len = size - this.offset;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, this.offset);
      this.offset = size;
      this.buffer += buf.toString('utf8');
    } finally {
      closeSync(fd);
    }

    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) this.onEvent(parseHookLine(line));
    }
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}
