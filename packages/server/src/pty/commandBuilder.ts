import type { FeaturePhase } from '@sdd/shared';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export interface ClaudeLaunchOptions {
  /** Externe Claude-Session-ID für --resume. */
  resume?: string;
  /** Pfad zur generierten Hook-Settings-JSON. */
  settingsPath: string;
  model?: string;
  permissionMode?: PermissionMode;
}

/** Argv für eine interaktive Feature-Session (läuft im Worktree-cwd). */
export function buildClaudeArgv(opts: ClaudeLaunchOptions): string[] {
  const args = ['claude'];
  if (opts.resume) args.push('--resume', opts.resume);
  args.push('--settings', opts.settingsPath);
  if (opts.model) args.push('--model', opts.model);
  if (opts.permissionMode && opts.permissionMode !== 'default') {
    args.push('--permission-mode', opts.permissionMode);
  }
  return args;
}

/** Argv für einen Headless-Lauf (Review-Agents, Konfliktauflösung). */
export function buildHeadlessArgv(prompt: string, opts: { model?: string; addDir?: string } = {}): string[] {
  const args = ['claude', '-p', prompt, '--output-format', 'text'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.addDir) args.push('--add-dir', opts.addDir);
  // Headless-Läufe arbeiten im Worktree — Edits sind dort isoliert und erwünscht.
  args.push('--permission-mode', 'acceptEdits');
  return args;
}

/**
 * Argv für einen Chat-Turn (Projekt-Q&A): streamend, resümierbar und strikt
 * lesend — nur Lese-Tools sind erlaubt, alles andere wird im Headless-Modus
 * automatisch verweigert (bewusst KEIN acceptEdits, anders als buildHeadlessArgv).
 */
export function buildChatArgv(
  prompt: string,
  opts: { resume?: string; systemPrompt: string; model?: string },
): string[] {
  // --verbose ist im Print-Modus Voraussetzung für stream-json.
  const args = ['claude', '-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (opts.resume) args.push('--resume', opts.resume);
  args.push('--append-system-prompt', opts.systemPrompt);
  if (opts.model) args.push('--model', opts.model);
  args.push('--allowedTools', 'Read,Grep,Glob');
  return args;
}

/**
 * Slash-Command für eine spec-kit-Phase (wird in die Feature-Session gesendet).
 * `prefix` kommt aus der Repo-Erkennung: `/speckit-` (Skills) oder `/speckit.` (Commands).
 */
export function phaseSlashCommand(
  phase: FeaturePhase | 'constitution',
  featureDir?: string,
  prefix = '/speckit-',
): string {
  const cmd = `${prefix}${phase}`;
  return featureDir ? `${cmd} ${featureDir}` : cmd;
}

/**
 * Prompt-Send-Pipeline (WhisperM8-Muster): Bracketed Paste verhindert, dass
 * eingebettete Newlines sofort submitten; CR folgt nach kurzer Verzögerung.
 */
export function bracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}

export const SUBMIT_DELAY_MS = 80;
export const SUBMIT_KEY = '\r';
