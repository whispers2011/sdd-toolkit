import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import type { VerifyCommand } from '@sdd/shared';
import { loginShellEnv } from '../pty/loginShellEnv.js';

export interface VerifyOutcome {
  ok: boolean;
  results: { name: string; exitCode: number }[];
  logPath: string;
}

/**
 * Self-Verification-Pipeline (Level-3-Kern): Test/Build/Lint-Kommandos
 * sequentiell im Worktree ausführen; erster Fehlschlag bricht ab.
 */
export async function runVerification(opts: {
  commands: VerifyCommand[];
  cwd: string;
  logDir: string;
  executionId: string;
  timeoutMs?: number;
}): Promise<VerifyOutcome> {
  const logPath = join(opts.logDir, `${opts.executionId}.log`);
  const log = createWriteStream(logPath, { flags: 'a' });
  const env = await loginShellEnv();
  const results: { name: string; exitCode: number }[] = [];

  try {
    for (const cmd of opts.commands) {
      log.write(`\n=== ${cmd.name}: ${cmd.command} ===\n`);
      const exitCode = await new Promise<number>((resolve) => {
        const child = spawn(env.SHELL ?? '/bin/zsh', ['-l', '-c', cmd.command], {
          cwd: opts.cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const timeout = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 15 * 60_000);
        child.stdout.pipe(log, { end: false });
        child.stderr.pipe(log, { end: false });
        child.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code ?? 1);
        });
        child.on('error', () => {
          clearTimeout(timeout);
          resolve(127);
        });
      });
      results.push({ name: cmd.name, exitCode });
      if (exitCode !== 0) {
        log.write(`\n=== ${cmd.name} FEHLGESCHLAGEN (exit ${exitCode}) ===\n`);
        return { ok: false, results, logPath };
      }
    }
    return { ok: true, results, logPath };
  } finally {
    log.end();
  }
}
