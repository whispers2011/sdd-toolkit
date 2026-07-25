import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { git, gitOk, isCleanWorkingTree, isGitRepo, localBranchExists } from './git.js';

/** Zustand eines Worktrees nach der Gesundheitsprüfung. */
export type WorktreeHealth = 'ok' | 'repaired' | 'missing';

/**
 * Worktree-Lifecycle pro Feature (WhisperM8-AgentWorktreeManager-Muster).
 * Worktrees liegen außerhalb des Repos unter <dataDir>/worktrees/<projectId>/<feature>
 * — kein .gitignore-Zwang im Ziel-Repo.
 */
export class WorktreeManager {
  constructor(private dataDir: string) {}

  /** Läufe pro Schlüssel serialisieren: der nächste startet erst, wenn der vorige fertig ist. */
  private locks = new Map<string, Promise<unknown>>();
  private serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(fn, fn);
    this.locks.set(
      key,
      run.catch(() => {}),
    );
    return run;
  }

  pathFor(projectId: string, featureName: string): string {
    return join(this.dataDir, 'worktrees', projectId, featureName);
  }

  /**
   * Worktree + Feature-Branch anlegen (Branch von defaultBranch abgezweigt).
   * Idempotent und race-fest: serialisiert pro (Repo, Branch), sodass zwei parallele
   * Aufrufe (Boot-Recovery + reconnectender Client) nicht beide „Branch fehlt" lesen
   * und beide `add -b` rufen — die Ursache von „cannot lock ref … reference already exists".
   */
  async create(opts: {
    projectId: string;
    projectPath: string;
    featureName: string;
    branch: string;
    defaultBranch: string;
  }): Promise<string> {
    return this.serialize(`${opts.projectPath}::${opts.branch}`, () => this.createUnlocked(opts));
  }

  private async createUnlocked(opts: {
    projectId: string;
    projectPath: string;
    featureName: string;
    branch: string;
    defaultBranch: string;
  }): Promise<string> {
    const dest = this.pathFor(opts.projectId, opts.featureName);
    mkdirSync(join(this.dataDir, 'worktrees', opts.projectId), { recursive: true });

    // Registry-Leichen entfernen (Verzeichnis weg, Admin-Eintrag geblieben) — sonst
    // scheitert `worktree add` mit „already used by worktree".
    await git(opts.projectPath, ['worktree', 'prune']).catch(() => {});

    // Bereits ein Worktree am Ziel? Idempotent ist NUR derselbe Branch. Ein fremder Branch
    // (Rest eines gelöschten Features mit gleichem Slug) würde sonst samt seinem Inhalt und
    // seiner Historie stillschweigend adoptiert — das Feature liefe auf fremder Arbeit.
    if (existsSync(dest)) {
      const health = await this.ensureValid(opts.projectPath, dest);
      if (health === 'ok' || health === 'repaired') {
        const there = await this.branchAt(dest);
        if (there === opts.branch) return dest;
        // Fremd belegt: nur eine SAUBERE Hülle darf weichen — ihre Commits leben im Branch
        // weiter, es geht nichts verloren. Uncommittete Arbeit ist unersetzlich → abbrechen.
        if (!(await isCleanWorkingTree(dest).catch(() => false))) {
          throw new Error(
            `Worktree-Pfad ${dest} ist mit Branch '${there ?? 'detached HEAD'}' belegt und hat ` +
              `uncommittete Änderungen — dort committen oder verwerfen, dann erneut versuchen`,
          );
        }
      }
      await this.remove(opts.projectPath, dest, { force: true }).catch(() => {});
    }

    // Ist der Branch schon in einem Worktree ausgecheckt? → dessen Pfad nutzen (idempotent).
    const worktreeForBranch = async (): Promise<string | null> => {
      const w = (await this.list(opts.projectPath).catch(() => [])).find((e) => e.branch === opts.branch);
      return w && existsSync(w.path) ? w.path : null;
    };
    const existing = await worktreeForBranch();
    if (existing) return existing;

    const branchExists = await localBranchExists(opts.projectPath, opts.branch);
    const addArgs = branchExists
      ? ['worktree', 'add', dest, opts.branch]
      : ['worktree', 'add', dest, '-b', opts.branch, opts.defaultBranch];

    const res = await git(opts.projectPath, addArgs);
    if (res.code === 0) return dest;

    // Rest-Race: Branch/Worktree wurde zwischen Prüfung und add doch angelegt.
    const msg = `${res.stderr}\n${res.stdout}`;
    if (/already exists|already checked out|already used by worktree/i.test(msg)) {
      await git(opts.projectPath, ['worktree', 'prune']).catch(() => {});
      const now = await worktreeForBranch();
      if (now) return now;
      // Branch existiert jetzt, aber ohne Worktree → auf bestehenden Branch aufsetzen.
      const retry = await git(opts.projectPath, ['worktree', 'add', dest, opts.branch]);
      if (retry.code === 0) return dest;
      throw new Error(
        `git worktree add fehlgeschlagen: ${retry.stderr.trim() || retry.stdout.trim() || msg.trim()}`,
      );
    }
    throw new Error(`git worktree add fehlgeschlagen (${res.code}): ${res.stderr.trim() || res.stdout.trim()}`);
  }

  /** Im Worktree ausgecheckter Branch; null bei detached HEAD oder unlesbarem Zustand. */
  private async branchAt(worktreePath: string): Promise<string | null> {
    const r = await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const name = r.stdout.trim();
    return r.code === 0 && name !== '' && name !== 'HEAD' ? name : null;
  }

  /**
   * Prüft die Git-Verknüpfung eines Worktrees und repariert sie bei Bedarf.
   * - Verzeichnis fehlt → 'missing'.
   * - Verzeichnis da, aber `.git`-Verknüpfung defekt (z. B. Admin-Eintrag
   *   `git worktree prune`d) → `git worktree repair` im Haupt-Checkout versuchen,
   *   dann erneut prüfen ('repaired' bei Erfolg, sonst 'missing').
   * Wirft nie — der Aufrufer entscheidet, wie er mit dem Zustand umgeht.
   */
  async ensureValid(projectPath: string, worktreePath: string): Promise<WorktreeHealth> {
    if (!existsSync(worktreePath)) return 'missing';
    if (await isGitRepo(worktreePath)) return 'ok';
    // `git worktree repair` ist idempotent und harmlos, wenn nichts zu tun ist.
    await git(projectPath, ['worktree', 'repair', worktreePath]).catch(() => {});
    return (await isGitRepo(worktreePath)) ? 'repaired' : 'missing';
  }

  /** Entfernen mit Sauberkeitsprüfung; force nur explizit. */
  async remove(projectPath: string, worktreePath: string, opts: { force?: boolean } = {}): Promise<void> {
    if (!existsSync(worktreePath)) {
      await git(projectPath, ['worktree', 'prune']);
      return;
    }
    if (!opts.force && !(await isCleanWorkingTree(worktreePath))) {
      throw new Error(`Worktree ${worktreePath} hat uncommittete Änderungen — Entfernen verweigert`);
    }
    await gitOk(projectPath, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), worktreePath]);
  }

  /** Branch löschen (best-effort; wirft nicht bei fehlendem Branch). */
  async deleteBranch(projectPath: string, branch: string): Promise<void> {
    await git(projectPath, ['branch', '-D', branch]);
  }

  async list(projectPath: string): Promise<{ path: string; branch: string | null }[]> {
    const out = await gitOk(projectPath, ['worktree', 'list', '--porcelain']);
    const entries: { path: string; branch: string | null }[] = [];
    let cur: { path: string; branch: string | null } | null = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (cur) entries.push(cur);
        cur = { path: line.slice('worktree '.length), branch: null };
      } else if (line.startsWith('branch refs/heads/') && cur) {
        cur.branch = line.slice('branch refs/heads/'.length);
      }
    }
    if (cur) entries.push(cur);
    return entries;
  }
}
