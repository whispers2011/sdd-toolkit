import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { meter } from '@sdd/shared';
import { loginShellEnv } from '../pty/loginShellEnv.js';
import { buildHeadlessArgv } from '../pty/commandBuilder.js';

/**
 * Auto-Konfliktauflösung: Headless-Claude löst Rebase-Konflikte im Worktree.
 * Bekommt beide Spec-Kontexte, damit die Auflösung die Intention BEIDER
 * Änderungen erhält. Danach prüft der MergeQueueService via Verifikation.
 */
export async function resolveConflicts(opts: {
  worktreePath: string;
  featureName: string;
  defaultBranch: string;
  conflictFiles: string[];
  logDir: string;
  executionId: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ exitCode: number; logPath: string; costUsd: number; tokens: number }> {
  const logPath = join(opts.logDir, `${opts.executionId}.log`);
  const specDir = `specs/${opts.featureName}`;
  const specHint = existsSync(join(opts.worktreePath, specDir))
    ? `Der Spezifikations-Kontext dieses Features liegt in ${specDir}/ (spec.md, plan.md, tasks.md).`
    : '';

  const prompt = [
    `Du bist mitten in einem git rebase auf '${opts.defaultBranch}' und es gibt Merge-Konflikte.`,
    `Konfliktdateien:`,
    ...opts.conflictFiles.map((f) => `- ${f}`),
    '',
    `Löse ALLE Konflikte auf. Regeln:`,
    `1. Verstehe zuerst die Absicht beider Seiten: 'ours' ist der Stand von '${opts.defaultBranch}' (bereits gemergte Features), 'theirs' ist dieses Feature.`,
    specHint,
    `2. Nutze 'git log --merge -p -- <datei>' und die Konfliktmarker, um beide Änderungen zu verstehen.`,
    `3. Erhalte die Funktionalität BEIDER Seiten. Im Zweifel hat der Stand von '${opts.defaultBranch}' Vorrang bei Infrastruktur, das Feature bei seiner eigenen Fachlichkeit.`,
    `4. Entferne alle Konfliktmarker (<<<<<<<, =======, >>>>>>>).`,
    `5. Führe NICHT 'git rebase --continue' aus und committe nichts — nur die Dateien bereinigen.`,
    `6. Wenn ein Konflikt fachlich nicht sicher auflösbar ist, brich ab und beschreibe warum.`,
  ]
    .filter(Boolean)
    .join('\n');

  const argv = buildHeadlessArgv(prompt, opts.model !== undefined ? { model: opts.model } : {});
  const env = await loginShellEnv();
  const log = createWriteStream(logPath, { flags: 'a' });
  log.write(`=== Auto-Konfliktauflösung für ${opts.featureName} ===\nDateien: ${opts.conflictFiles.join(', ')}\n\n`);

  const exitCode = await new Promise<number>((resolve) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd!, args, {
      cwd: opts.worktreePath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 20 * 60_000);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      log.write(`\nSpawn-Fehler: ${String(err)}\n`);
      resolve(127);
    });
  });

  log.end();

  // Kosten-Metering (WP3) aus dem Lauf-Log.
  const output = await readFile(logPath, 'utf8').catch(() => '');
  const cost = meter({ ...(opts.model !== undefined ? { model: opts.model } : {}), promptText: prompt, outputText: output });
  return { exitCode, logPath, costUsd: cost.costUsd, tokens: cost.totalTokens };
}
