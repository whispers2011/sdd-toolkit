import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { meter } from '@sdd/shared';
import type { Feature, Project } from '@sdd/shared';
import type { ExecutionRepo, PersonaRepo } from '../db/repos.js';
import { buildHeadlessArgv } from '../pty/commandBuilder.js';
import { loginShellEnv } from '../pty/loginShellEnv.js';
import { isGitRepo } from '../git/git.js';

export interface GateResult {
  ok: boolean;
  /** Name der Persona, an der das Gate gescheitert ist (falls FAIL). */
  failedPersona: string | null;
}

/** Verdict aus der Review-Datei; Fallback: Exit-Code (speckit-assistant-Muster). */
export function parseVerdict(reviewContent: string | null, exitCode: number): 'PASS' | 'FAIL' {
  if (reviewContent) {
    const m = reviewContent.match(/VERDICT:\s*(PASS|FAIL)/i);
    if (m?.[1]) return m[1].toUpperCase() as 'PASS' | 'FAIL';
  }
  return exitCode === 0 ? 'PASS' : 'FAIL';
}

/**
 * Review-Gate (WP4): Personas laufen sequentiell als Headless-Claude im Worktree.
 * Erster FAIL stoppt das Gate. Reviews landen versioniert im Repo
 * (`specs/<feature>/reviews/<persona-id>.md`).
 */
export class ReviewGateService {
  constructor(
    private personas: PersonaRepo,
    private executions: ExecutionRepo,
    private dataDir: string,
  ) {}

  async run(feature: Feature, project: Project): Promise<GateResult> {
    if (!feature.worktreePath) return { ok: true, failedPersona: null };
    // Infrastruktur-Guard: Ist der Worktree verschwunden (z. B. mitten in der Session
    // gelöscht), darf das Gate KEIN dauerhaftes VERDICT: FAIL in die Repo schreiben.
    // Stattdessen als behebbaren Fehler eskalieren (Aufrufer fängt und retryt).
    if (!existsSync(feature.worktreePath) || !(await isGitRepo(feature.worktreePath))) {
      throw new Error(
        `Review-Gate übersprungen: Worktree fehlt oder ist kein Git-Repo (${feature.worktreePath}) — Integration erneut anstoßen.`,
      );
    }
    const reviewDir = join(feature.worktreePath, 'specs', feature.name, 'reviews');
    mkdirSync(reviewDir, { recursive: true });

    for (const persona of this.personas.forProject(project.id)) {
      const reviewFile = join('specs', feature.name, 'reviews', `${persona.id}.md`);
      const prompt = [
        persona.prompt.replaceAll('{reviewFile}', reviewFile),
        '',
        `Kontext: Feature '${feature.name}', Branch '${feature.branch}', Default-Branch '${project.defaultBranch}'.`,
        `Die Spezifikation liegt unter specs/${feature.name}/.`,
      ].join('\n');

      const execId = this.executions.start({
        projectId: project.id,
        featureId: feature.id,
        kind: 'review',
        phase: null,
        logPath: null,
      });
      const logPath = join(this.dataDir, 'logs', `${execId}.log`);
      const exitCode = await this.runHeadless(prompt, feature.worktreePath, logPath);

      const reviewPath = join(feature.worktreePath, reviewFile);
      const content = existsSync(reviewPath) ? await readFile(reviewPath, 'utf8') : null;
      const verdict = parseVerdict(content, exitCode);

      const output = await readFile(logPath, 'utf8').catch(() => '');
      const cost = meter({ promptText: prompt, outputText: output });
      this.executions.finish(execId, verdict === 'PASS' ? 0 : 1, cost.costUsd, cost.totalTokens);

      if (verdict === 'FAIL') return { ok: false, failedPersona: persona.name };
    }
    return { ok: true, failedPersona: null };
  }

  private async runHeadless(prompt: string, cwd: string, logPath: string): Promise<number> {
    const env = await loginShellEnv();
    const log = createWriteStream(logPath, { flags: 'a' });
    const [cmd, ...args] = buildHeadlessArgv(prompt);
    return new Promise<number>((resolve) => {
      const child = spawn(cmd!, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 20 * 60_000);
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      child.on('close', (code) => {
        clearTimeout(timeout);
        log.end();
        resolve(code ?? 1);
      });
      child.on('error', () => {
        clearTimeout(timeout);
        log.end();
        resolve(127);
      });
    });
  }
}
