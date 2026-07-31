import { join, resolve, sep } from 'node:path';
import { mkdirSync, existsSync, readdirSync, realpathSync, rmdirSync, cpSync } from 'node:fs';
import { git, gitOk, isCleanWorkingTree, isGitRepo, localBranchExists } from './git.js';
import { readWorktreeInventory } from './worktreeInventory.js';

/** Zustand eines Worktrees nach der Gesundheitsprüfung. */
export type WorktreeHealth = 'ok' | 'repaired' | 'missing';

/** So viel eines Projekts, wie der Worktree-Pfad braucht. */
export interface WorktreeProject {
  id: string;
  name: string;
}

/**
 * Die Portvergabe, so viel davon wie der WorktreeManager braucht. Als Schnittstelle
 * statt als Klasse, damit `git/` nicht von `services/` abhängt und Tests ohne
 * Datenbank auskommen.
 */
export interface WorktreePortAllocator {
  ensureFor(owner: {
    kind: 'worktree';
    path: string;
    projectId: string;
    projectName: string;
    projectPath: string;
    featureName: string;
    branch: string;
  }): Promise<unknown>;
  releaseWorktree(worktreePath: string): void;
}

/**
 * Ordnername eines Projekts: `<name>-<id>`. Die ID allein ist eindeutig, aber
 * unlesbar — Reste gelöschter Projekte waren dadurch im Datenverzeichnis nicht
 * zuzuordnen (neun verwaiste Worktrees am 26.07.2026). Der Name macht sie
 * erkennbar, die ID hält sie eindeutig.
 */
export function projectDirName(project: WorktreeProject): string {
  const slug = project.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // Diakritika nach der Zerlegung (ä → a)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug ? `${slug}-${project.id}` : project.id;
}

/**
 * Agenten-Konfiguration, die ein Projekt bewusst NICHT eincheckt (`.claude/` steht
 * in vielen Repos in der .gitignore). `git worktree add` checkt nur getrackte Dateien
 * aus — dort fehlen dann die projektlokalen Skills, und ein Phasenstart schickt einen
 * Slash-Command, den es im Worktree gar nicht gibt: die Session endet nach Sekunden,
 * ohne den Prompt je anzunehmen (Jobmappe, 28.07.2026, drei Fehlstarts in Folge).
 */
const AGENT_CONFIG_PATHS = ['.claude', 'CLAUDE.md', 'AGENTS.md'] as const;

/**
 * Ungetrackte Agenten-Konfiguration aus dem Hauptrepo in den frischen Worktree
 * spiegeln. Nur was dort fehlt — getrackte Dateien gewinnen immer, denn die hat
 * `worktree add` gerade in der Branch-Version ausgecheckt.
 */
function mirrorAgentConfig(projectPath: string, dest: string): void {
  for (const rel of AGENT_CONFIG_PATHS) {
    const src = join(projectPath, rel);
    const target = join(dest, rel);
    if (!existsSync(src) || existsSync(target)) continue;
    try {
      cpSync(src, target, { recursive: true, dereference: true });
    } catch {
      // Eine nicht kopierbare Konfiguration darf das Anlegen des Worktrees nicht scheitern lassen.
    }
  }
}

/** Aufgelöster Pfad; fällt auf resolve() zurück, wenn er (noch) nicht existiert. */
function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** Zusammenfassung eines Aufräumlaufs; `kept` ist das, was bewusst stehenblieb. */
export interface WorktreeCleanup {
  removed: string[];
  kept: { path: string; reason: string }[];
}

/**
 * Worktree-Lifecycle pro Feature (WhisperM8-AgentWorktreeManager-Muster).
 * Worktrees liegen außerhalb des Repos unter <dataDir>/worktrees/<projectId>/<feature>
 * — kein .gitignore-Zwang im Ziel-Repo.
 */
export class WorktreeManager {
  /**
   * @param ports Die EINE Stelle der Portvergabe. Optional, damit bestehende
   * Tests ohne Datenbank weiterlaufen; im Betrieb immer gesetzt (FR-001).
   */
  constructor(
    private dataDir: string,
    private ports?: WorktreePortAllocator,
  ) {}

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

  /**
   * Projektordner unter <dataDir>/worktrees. Neu: `<name>-<id>`. Ein bereits
   * belegter Alt-Ordner `<id>` bleibt in Benutzung — bestehende Worktrees werden
   * nicht umgezogen (ihre Pfade stehen in der DB und in .git-Verknüpfungen).
   * Ein LEERER Alt-Ordner zählt nicht als Bestand.
   */
  projectDir(project: WorktreeProject): string {
    const legacy = join(this.dataDir, 'worktrees', project.id);
    try {
      if (readdirSync(legacy).length > 0) return legacy;
    } catch {
      /* nicht vorhanden → neuer Name */
    }
    return join(this.dataDir, 'worktrees', projectDirName(project));
  }

  pathFor(project: WorktreeProject, featureName: string): string {
    return join(this.projectDir(project), featureName);
  }

  /**
   * Alle vom Toolkit angelegten Worktrees eines Projekts entfernen — der fehlende
   * Schritt beim Projekt-Löschen, durch den neun verwaiste Worktrees liegenblieben.
   *
   * Zwei Sicherungen: angefasst wird ausschließlich, was unter <dataDir>/worktrees
   * liegt (eigene Worktrees des Nutzers bleiben unberührt), und uncommittete Arbeit
   * wird NIE gelöscht, sondern gemeldet. Branches werden nur entfernt, wenn sie im
   * Zielbranch enthalten sind (`git branch -d`) — ein ungemergter Branch ist das
   * einzige, was die Arbeit noch hält.
   */
  async removeAllForProject(project: WorktreeProject, projectPath: string): Promise<WorktreeCleanup> {
    // Über realpath vergleichen: `git worktree list` meldet den aufgelösten Pfad,
    // dataDir kann über einen Symlink zeigen (macOS: /var → /private/var).
    const owned = realPath(join(this.dataDir, 'worktrees')) + sep;
    const cleanup: WorktreeCleanup = { removed: [], kept: [] };

    for (const entry of await this.list(projectPath).catch(() => [])) {
      if (!realPath(entry.path).startsWith(owned)) continue;
      if (existsSync(entry.path) && !(await isCleanWorkingTree(entry.path).catch(() => true))) {
        cleanup.kept.push({ path: entry.path, reason: 'uncommittete Änderungen' });
        continue;
      }
      try {
        await this.remove(projectPath, entry.path);
        if (entry.branch) await git(projectPath, ['branch', '-d', entry.branch]);
        cleanup.removed.push(entry.path);
      } catch (err) {
        cleanup.kept.push({ path: entry.path, reason: (err as Error).message });
      }
    }

    await git(projectPath, ['worktree', 'prune']).catch(() => {});
    for (const dir of [join(this.dataDir, 'worktrees', project.id), join(this.dataDir, 'worktrees', projectDirName(project))]) {
      try {
        if (readdirSync(dir).length === 0) rmdirSync(dir);
      } catch {
        /* nicht vorhanden oder nicht leer → stehen lassen */
      }
    }
    return cleanup;
  }

  /**
   * Worktree + Feature-Branch anlegen (Branch von defaultBranch abgezweigt).
   * Idempotent und race-fest: serialisiert pro (Repo, Branch), sodass zwei parallele
   * Aufrufe (Boot-Recovery + reconnectender Client) nicht beide „Branch fehlt" lesen
   * und beide `add -b` rufen — die Ursache von „cannot lock ref … reference already exists".
   */
  async create(opts: {
    project: WorktreeProject;
    projectPath: string;
    featureName: string;
    branch: string;
    defaultBranch: string;
  }): Promise<string> {
    return this.serialize(`${opts.projectPath}::${opts.branch}`, async () => {
      const path = await this.createUnlocked(opts);
      // DIE Stelle der Portvergabe: hier — und nur hier — bekommt ein Worktree
      // seinen Block. Beide Anlagepfade (Feature und Chat) laufen hier durch,
      // deshalb ist der Block über ALLE gleichzeitig bestehenden Worktrees
      // eindeutig (FR-001/FR-002, research E1).
      await this.ports?.ensureFor({
        kind: 'worktree',
        path,
        projectId: opts.project.id,
        projectName: opts.project.name,
        projectPath: opts.projectPath,
        featureName: opts.featureName,
        branch: opts.branch,
      });
      return path;
    });
  }

  private async createUnlocked(opts: {
    project: WorktreeProject;
    projectPath: string;
    featureName: string;
    branch: string;
    defaultBranch: string;
  }): Promise<string> {
    const dest = this.pathFor(opts.project, opts.featureName);
    mkdirSync(this.projectDir(opts.project), { recursive: true });

    // Registry-Leichen entfernen (Verzeichnis weg, Admin-Eintrag geblieben) — sonst
    // scheitert `worktree add` mit „already used by worktree".
    await git(opts.projectPath, ['worktree', 'prune']).catch(() => {});

    // Bereits ein gültiger Worktree am Ziel? → idempotent zurück; kaputte Hülle entfernen.
    if (existsSync(dest)) {
      const health = await this.ensureValid(opts.projectPath, dest);
      if (health === 'ok' || health === 'repaired') {
        mirrorAgentConfig(opts.projectPath, dest);
        return dest;
      }
      await this.remove(opts.projectPath, dest, { force: true }).catch(() => {});
    }

    // Ist der Branch schon in einem Worktree ausgecheckt? → dessen Pfad nutzen (idempotent).
    const worktreeForBranch = async (): Promise<string | null> => {
      const w = (await this.list(opts.projectPath).catch(() => [])).find((e) => e.branch === opts.branch);
      return w && existsSync(w.path) ? w.path : null;
    };
    const existing = await worktreeForBranch();
    if (existing) {
      mirrorAgentConfig(opts.projectPath, existing);
      return existing;
    }

    const branchExists = await localBranchExists(opts.projectPath, opts.branch);
    const addArgs = branchExists
      ? ['worktree', 'add', dest, opts.branch]
      : ['worktree', 'add', dest, '-b', opts.branch, opts.defaultBranch];

    const res = await git(opts.projectPath, addArgs);
    if (res.code === 0) {
      mirrorAgentConfig(opts.projectPath, dest);
      return dest;
    }

    // Rest-Race: Branch/Worktree wurde zwischen Prüfung und add doch angelegt.
    const msg = `${res.stderr}\n${res.stdout}`;
    if (/already exists|already checked out|already used by worktree/i.test(msg)) {
      await git(opts.projectPath, ['worktree', 'prune']).catch(() => {});
      const now = await worktreeForBranch();
      if (now) {
        mirrorAgentConfig(opts.projectPath, now);
        return now;
      }
      // Branch existiert jetzt, aber ohne Worktree → auf bestehenden Branch aufsetzen.
      const retry = await git(opts.projectPath, ['worktree', 'add', dest, opts.branch]);
      if (retry.code === 0) {
        mirrorAgentConfig(opts.projectPath, dest);
        return dest;
      }
      throw new Error(
        `git worktree add fehlgeschlagen: ${retry.stderr.trim() || retry.stdout.trim() || msg.trim()}`,
      );
    }
    throw new Error(`git worktree add fehlgeschlagen (${res.code}): ${res.stderr.trim() || res.stdout.trim()}`);
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

  /**
   * Entfernen mit Sauberkeitsprüfung; force nur explizit.
   *
   * Nach dem git-Aufruf wird NACHGEWIESEN, dass das Verzeichnis wirklich fort ist
   * (FR-034). Dem Rückgabewert allein ist hier nicht zu trauen: `git worktree
   * remove` kehrt in Randfällen erfolgreich zurück und lässt Reste stehen — genau
   * so wuchs ein 10-GB-Verzeichnis unauffindbar weiter, weil der Aufrufer den
   * Pfad danach trotzdem geleert hat (research E11).
   *
   * Der Portblock wird erst NACH dem Nachweis freigegeben (FR-005/FR-036).
   */
  async remove(projectPath: string, worktreePath: string, opts: { force?: boolean } = {}): Promise<void> {
    if (!existsSync(worktreePath)) {
      await git(projectPath, ['worktree', 'prune']);
      this.ports?.releaseWorktree(worktreePath);
      return;
    }
    if (!opts.force && !(await isCleanWorkingTree(worktreePath))) {
      throw new Error(`Worktree ${worktreePath} hat uncommittete Änderungen — Entfernen verweigert`);
    }
    await gitOk(projectPath, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), worktreePath]);
    if (existsSync(worktreePath)) {
      throw new Error(
        `Worktree ${worktreePath} ist nach dem Entfernen noch vorhanden — vermutlich hält ein Prozess das Verzeichnis.`,
      );
    }
    this.ports?.releaseWorktree(worktreePath);
  }

  /** Branch löschen (best-effort; wirft nicht bei fehlendem Branch). */
  async deleteBranch(projectPath: string, branch: string): Promise<void> {
    await git(projectPath, ['branch', '-D', branch]);
  }

  async list(projectPath: string): Promise<{ path: string; branch: string | null }[]> {
    const inventory = await readWorktreeInventory(projectPath);
    return inventory.map((e) => ({ path: e.path, branch: e.branch }));
  }
}
