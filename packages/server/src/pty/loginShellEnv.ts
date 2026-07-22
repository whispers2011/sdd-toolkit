import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';

let cached: Record<string, string> | null = null;

/**
 * PATH-Fix (WhisperM8 LoginShellEnvironment-Muster): Wenn der Server nicht aus
 * einer interaktiven Shell gestartet wurde, fehlt der User-PATH. Einmalig die
 * Login-Shell fragen, cachen, um Fallback-Pfade ergänzen.
 */
export async function loginShellEnv(): Promise<Record<string, string>> {
  if (cached) return cached;

  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v;
  }

  const shell = process.env.SHELL ?? '/bin/zsh';
  const shellPath = await new Promise<string | null>((resolve) => {
    execFile(shell, ['-l', '-c', 'echo -n "$PATH"'], { timeout: 10_000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });

  const home = homedir();
  const fallbacks = [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const parts = new Set<string>([
    ...(shellPath ? shellPath.split(delimiter) : []),
    ...(base.PATH ? base.PATH.split(delimiter) : []),
    ...fallbacks,
  ]);

  cached = {
    ...base,
    PATH: [...parts].join(delimiter),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };
  return cached;
}
