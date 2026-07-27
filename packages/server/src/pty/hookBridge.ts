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

export function writeHookSettings(
  dataDir: string,
  sessionId: string,
  /**
   * Umgebungsvariablen, die im `env`-Block der Settings-Datei landen. Nötig für die
   * Telemetrie-Messung: Der `env`-Block SCHLÄGT die Prozessumgebung (empirisch
   * geklärt, research.md D5) — eine gegenläufige `~/.claude/settings.json` des
   * Nutzers würde die Messung sonst still abschalten.
   */
  env: Record<string, string> = {},
): HookSetup {
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

  const settings: Record<string, unknown> = { hooks };
  if (Object.keys(env).length > 0) settings.env = env;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  writeFileSync(eventFile, '', { flag: 'a', mode: 0o600 });
  return { settingsPath, eventFile };
}

/**
 * Settings-Datei für einen Headless-Lauf: nur der `env`-Block, keine Hooks.
 * Headless-Prozesse bekommen heute keine Settings-Datei — ohne eine würde eine
 * gegenläufige Nutzerkonfiguration ihre Messung abschalten (research.md D5).
 */
export function writeEnvSettings(dataDir: string, runId: string, env: Record<string, string>): string {
  const dir = join(dataDir, 'hooks');
  mkdirSync(dir, { recursive: true });
  const settingsPath = join(dir, `run-${runId}.settings.json`);
  writeFileSync(settingsPath, JSON.stringify({ env }, null, 2), { mode: 0o600 });
  return settingsPath;
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
    case 'PreToolUse': {
      const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
      const detail = askDetail(toolName, payload.tool_input);
      return {
        signal: { name: 'pre_tool_use', toolName, ...(detail ? { detail } : {}) },
        claudeSessionId,
      };
    }
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

/** Länge der Kurzfassung — genug zum Einschätzen, kurz genug für eine Inbox-Zeile. */
const DETAIL_MAX = 140;

/**
 * Worum bittet der Agent? Kurzfassung aus dem Hook-Payload.
 *
 * Das Toolkit hatte diese Information bereits und verwarf sie: Die Inbox meldete
 * nur „<Feature>: hat eine Frage", während im Payload drei ausformulierte Fragen
 * mit je drei Optionen standen. Wer priorisieren wollte, musste in die Konsole
 * wechseln — genau die Arbeit, die die Inbox abnehmen soll.
 *
 * Bewusst tolerant: unbekannte Formen liefern null, dann bleibt es beim alten Text.
 */
export function askDetail(toolName: string, toolInput: unknown): string | null {
  if (toolInput === null || typeof toolInput !== 'object') return null;
  const input = toolInput as Record<string, unknown>;

  if (toolName === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const texts = questions
      .map((q) => (q && typeof q === 'object' ? (q as Record<string, unknown>).question : null))
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
    if (texts.length === 0) return null;
    const first = clamp(texts[0]!);
    return texts.length > 1 ? `${first} (+${texts.length - 1} weitere)` : first;
  }

  if (toolName === 'ExitPlanMode') {
    const plan = typeof input.plan === 'string' ? input.plan : null;
    if (!plan) return null;
    const headline = plan
      .split('\n')
      .map((l) => l.replace(/^#+\s*/, '').trim())
      .find((l) => l.length > 0);
    return headline ? clamp(headline) : null;
  }

  return null;
}

function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= DETAIL_MAX ? flat : `${flat.slice(0, DETAIL_MAX - 1)}…`;
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
