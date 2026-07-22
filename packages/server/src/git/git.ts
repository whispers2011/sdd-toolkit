import { execFile } from 'node:child_process';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Async git-Aufruf — nie execSync (blockiert den Event-Loop, speckit-assistant-Fehler). */
export function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        let code = 0;
        if (err) {
          const raw: unknown = (err as NodeJS.ErrnoException).code;
          code = typeof raw === 'number' ? raw : 1;
        }
        resolve({ code, stdout, stderr });
      },
    );
  });
}

export async function gitOk(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) {
    throw new Error(`git ${args.join(' ')} fehlgeschlagen (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  }
  return r.stdout;
}

export async function isCleanWorkingTree(cwd: string): Promise<boolean> {
  const r = await gitOk(cwd, ['status', '--porcelain']);
  return r.trim() === '';
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await gitOk(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

/** Konfliktdateien während eines Rebase/Merge. */
export async function conflictedFiles(cwd: string): Promise<string[]> {
  const r = await gitOk(cwd, ['diff', '--name-only', '--diff-filter=U']);
  return r.split('\n').filter(Boolean);
}
