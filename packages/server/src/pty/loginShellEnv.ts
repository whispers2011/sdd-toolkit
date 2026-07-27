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
  // Geerbte Claude-Code-Marker entfernen: Wurde der Server aus einer Claude-Session
  // gestartet, erben gespawnte Sessions CLAUDE_CODE_CHILD_SESSION — Claude Code ≥2.1
  // schaltet dann das Transkript-Schreiben ab („Transcript saving is off") und die
  // autoritative Token-Messung fällt still auf Schätzung zurück.
  for (const k of Object.keys(base)) {
    if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || k.startsWith('CLAUDE_CODE_')) {
      delete base[k];
    }
  }
  // In der Desktop-App läuft der Server als Electron-Binary im Node-Modus. Die
  // Marke darf nicht weitervererbt werden — sie würde jede gestartete
  // Electron-Anwendung in einen kopflosen Node-Prozess verwandeln.
  delete base.ELECTRON_RUN_AS_NODE;
  base.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = '1';

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
