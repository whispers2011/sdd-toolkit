import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_STACK_CONFIG } from '@sdd/shared';
import { openMemoryDatabase, type DB } from '../db/database.js';
import { PortRepo } from '../db/portRepo.js';
import { ProjectRepo } from '../db/repos.js';
import { PortAllocator, bindProbe, type WorktreeBlockOwner } from './portAllocator.js';
import { git as execGit } from '../git/git.js';

let db: DB;
let ports: PortRepo;
let projectId: string;
const tmpDirs: string[] = [];

const RANGE = { start: 21000, end: 21100, blockSize: 20 };

beforeEach(() => {
  db = openMemoryDatabase();
  ports = new PortRepo(db);
  projectId = new ProjectRepo(db).create({
    name: 'Projekt A',
    path: '/repo/a',
    defaultBranch: 'main',
    color: null,
    enabledPhases: ['specify', 'implement'],
    verifyCommands: [],
    automation: {},
    optimization: {},
    mergeMode: 'ff',
    editorCmd: null,
    integrationMode: 'local',
    stack: EMPTY_STACK_CONFIG,
  }).id;
});

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Ein Worktree-Besitzer, dessen Verzeichnis absichtlich NICHT existiert (keine Env-Datei). */
function owner(path: string, name = 'demo'): WorktreeBlockOwner {
  return {
    kind: 'worktree',
    path,
    projectId,
    projectName: 'Projekt A',
    projectPath: '/repo/a',
    featureName: name,
    branch: `feature/${name}`,
  };
}

function allocator(opts: { busy?: Set<number>; probeDelayMs?: number; range?: typeof RANGE } = {}): PortAllocator {
  const busy = opts.busy ?? new Set<number>();
  return new PortAllocator({
    ports,
    range: opts.range ?? RANGE,
    probe: async (port) => {
      if (opts.probeDelayMs) await new Promise((r) => setTimeout(r, opts.probeDelayMs));
      return !busy.has(port);
    },
  });
}

describe('PortAllocator.ensureFor', () => {
  it('vergibt den ersten Block des Bereichs', async () => {
    const block = await allocator().ensureFor(owner('/wt/a'));
    expect(block.base).toBe(21000);
    expect(block.span).toBe(20);
    expect(block.releasedAt).toBeNull();
  });

  /** FR-004: der Block wandert nie, auch nicht über Läufe und Sitzungen hinweg. */
  it('liefert beim zweiten Aufruf denselben Block (FR-004)', async () => {
    const a = allocator();
    const erst = await a.ensureFor(owner('/wt/a'));
    const nochmal = await a.ensureFor(owner('/wt/a'));
    expect(nochmal.base).toBe(erst.base);
    expect(ports.live()).toHaveLength(1);
  });

  /** FR-002: eindeutig über ALLE gleichzeitig bestehenden Worktrees. */
  it('gibt zwei Worktrees sich nicht überschneidende Blöcke (FR-002)', async () => {
    const a = allocator();
    const eins = await a.ensureFor(owner('/wt/a'));
    const zwei = await a.ensureFor(owner('/wt/b'));
    expect(Math.abs(zwei.base - eins.base)).toBeGreaterThanOrEqual(RANGE.blockSize);
  });

  it('vergibt auch bei gleichzeitigen Aufrufen jeden Block nur einmal', async () => {
    const a = allocator();
    const blocks = await Promise.all([
      a.ensureFor(owner('/wt/a')),
      a.ensureFor(owner('/wt/b')),
      a.ensureFor(owner('/wt/c')),
    ]);
    expect(new Set(blocks.map((b) => b.base)).size).toBe(3);
  });

  /**
   * FR-003: ein einziger belegter Port verwirft den GANZEN Block — die beobachtete
   * Kollision betraf 8080 *und* 4000.
   */
  it('überspringt einen Block, dessen mittlerer Port belegt ist (FR-003)', async () => {
    const block = await allocator({ busy: new Set([21007]) }).ensureFor(owner('/wt/a'));
    expect(block.base).toBe(21020);
  });

  it('überspringt mehrere belegte Blöcke hintereinander', async () => {
    const busy = new Set([21000, 21025, 21041]);
    expect((await allocator({ busy }).ensureFor(owner('/wt/a'))).base).toBe(21060);
  });

  /** FR-010: lieber sichtbar scheitern als still doppelt vergeben. */
  it('wirft mit klarem Text, wenn kein Bereich mehr frei ist (FR-010)', async () => {
    const a = allocator({ range: { start: 21000, end: 21000, blockSize: 20 } });
    await a.ensureFor(owner('/wt/a'));
    await expect(a.ensureFor(owner('/wt/b'))).rejects.toThrow(/Keine freien Portbereiche/);
    expect(ports.live()).toHaveLength(1);
  });

  it('wirft auch, wenn alle Blöcke von fremden Prozessen belegt sind', async () => {
    const busy = new Set(Array.from({ length: 200 }, (_, i) => 21000 + i));
    await expect(allocator({ busy }).ensureFor(owner('/wt/a'))).rejects.toThrow(/Keine freien Portbereiche/);
  });

  /** Zeitüberschreitung ⇒ Block überspringen, nie doppelt vergeben. */
  it('überspringt einen Block, dessen Prüfung das Zeitlimit reißt', async () => {
    const a = new PortAllocator({
      ports,
      range: RANGE,
      blockProbeTimeoutMs: 5,
      probe: async (port) => {
        if (port < 21020) await new Promise((r) => setTimeout(r, 80));
        return true;
      },
    });
    expect((await a.ensureFor(owner('/wt/a'))).base).toBe(21020);
  });
});

describe('PortAllocator.release / reconcile', () => {
  it('gibt frei und vergibt den Block danach wieder (FR-005)', async () => {
    const a = allocator();
    const erst = await a.ensureFor(owner('/wt/a'));
    a.releaseWorktree('/wt/a');
    expect((await a.ensureFor(owner('/wt/b'))).base).toBe(erst.base);
  });

  it('meldet nach der Freigabe keinen Blockanfang mehr', async () => {
    const a = allocator();
    await a.ensureFor(owner('/wt/a'));
    a.releaseWorktree('/wt/a');
    expect(a.baseForWorktree('/wt/a')).toBeNull();
  });

  /** Edge Case: „Worktree von außen gelöscht, Portbereich noch vergeben". */
  it('gibt beim Abgleich die Blöcke verschwundener Verzeichnisse frei', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdd-port-'));
    tmpDirs.push(dir);
    const a = allocator();
    await a.ensureFor(owner(dir));
    await a.ensureFor(owner('/wt/gibt-es-nicht'));

    expect(a.reconcile()).toBe(1);
    expect(a.baseForWorktree('/wt/gibt-es-nicht')).toBeNull();
    expect(a.baseForWorktree(dir)).not.toBeNull();
  });

  it('lässt Projektblöcke beim Abgleich unberührt', async () => {
    const a = allocator();
    await a.ensureFor({ kind: 'project', projectId, projectName: 'Projekt A', projectPath: '/repo/a' });
    expect(a.reconcile()).toBe(0);
    expect(a.baseForProject(projectId)).not.toBeNull();
  });
});

describe('PortAllocator: Projektblock für geteilte Dienste', () => {
  it('vergibt einen eigenen Block je Projekt, getrennt vom Worktree-Block', async () => {
    const a = allocator();
    const wt = await a.ensureFor(owner('/wt/a'));
    const proj = await a.ensureFor({ kind: 'project', projectId, projectName: 'Projekt A', projectPath: '/repo/a' });
    expect(proj.base).not.toBe(wt.base);
    expect(a.baseForProject(projectId)).toBe(proj.base);
  });
});

describe('PortAllocator: Env-Datei', () => {
  /**
   * FR-006: die Datei liegt IM Worktree, damit Schritte und Agents sie ohne
   * Wissen über das Datenverzeichnis finden.
   */
  it('schreibt .sdd/env mit den stabilen Angaben in den Worktree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdd-port-'));
    tmpDirs.push(dir);
    const block = await allocator().ensureFor(owner(dir, 'mein-feature'));

    const envPath = join(dir, '.sdd', 'env');
    expect(existsSync(envPath)).toBe(true);
    const text = readFileSync(envPath, 'utf8');
    expect(text).toContain(`SDD_PORT_BASE=${block.base}`);
    expect(text).toContain(`SDD_PORT_SPAN=${block.span}`);
    expect(text).toContain(`SDD_WORKTREE=${dir}`);
    expect(text).toContain('SDD_PROJECT=Projekt A');
    expect(text).toContain('SDD_FEATURE=mein-feature');
    expect(text).toContain('SDD_BRANCH=feature/mein-feature');
  });

  /**
   * research E4: nur STABILE Angaben. Phase, Stufe und Profil wechseln pro Lauf —
   * eine Datei mit veraltetem Phasenwert wäre eine Falschaussage.
   */
  it('nimmt Phase, Stufe und Profil NICHT in die Datei auf', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdd-port-'));
    tmpDirs.push(dir);
    await allocator().ensureFor(owner(dir));
    const text = readFileSync(join(dir, '.sdd', 'env'), 'utf8');
    expect(text).not.toContain('SDD_PHASE');
    expect(text).not.toContain('SDD_STAGE');
    expect(text).not.toContain('SDD_PROFILE');
  });

  /** Edge Case „von Hand verändert": die Zuweisung des Toolkits gewinnt. */
  it('überschreibt eine von Hand veränderte Datei bei der nächsten Bereitstellung', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdd-port-'));
    tmpDirs.push(dir);
    const a = allocator();
    const block = await a.ensureFor(owner(dir));

    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, '.sdd', 'env'), 'SDD_PORT_BASE=1\n', 'utf8');
    await a.ensureFor(owner(dir));

    expect(readFileSync(join(dir, '.sdd', 'env'), 'utf8')).toContain(`SDD_PORT_BASE=${block.base}`);
  });

  it('vergibt auch ohne existierendes Verzeichnis einen Block, ohne zu werfen', async () => {
    const block = await allocator().ensureFor(owner('/wt/gibt-es-nicht'));
    expect(block.base).toBe(21000);
  });

  /**
   * FR-009: die Datei darf nie in einen Commit oder Merge geraten. Der Bestand
   * macht das nicht von allein — `MergeQueueService.commitWorktree()` ruft
   * `git add -A` und nähme eine ungetrackte Datei mit.
   */
  it('schließt die Datei in einem echten Repo aus und hält sie aus `git status` heraus', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'sdd-repo-'));
    tmpDirs.push(repo);
    await execGit(repo, ['init', '-b', 'main']);

    await allocator().ensureFor(owner(repo));

    const ignored = await execGit(repo, ['check-ignore', '-v', '.sdd/env']);
    expect(ignored.code).toBe(0);
    expect(ignored.stdout).toContain('info/exclude');

    const status = await execGit(repo, ['status', '--porcelain']);
    expect(status.stdout).not.toContain('.sdd');
  });

  it('trägt das Ausschlussmuster nur einmal ein', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'sdd-repo-'));
    tmpDirs.push(repo);
    await execGit(repo, ['init', '-b', 'main']);

    const a = allocator();
    await a.ensureFor(owner(repo));
    await a.ensureFor(owner(repo));

    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter((l) => l.trim() === '/.sdd/')).toHaveLength(1);
  });
});

describe('bindProbe (echter Socket)', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  });

  it('meldet einen freien Port als frei', async () => {
    expect(await bindProbe(0)).toBe(true);
  });

  /**
   * Bind statt Connect: ein Dienst auf 127.0.0.1 antwortet keinem Connect auf
   * einer anderen Adresse, blockiert aber ein Binden auf 0.0.0.0 (research E3).
   */
  it('meldet einen belegten Port als belegt', async () => {
    server = createServer();
    const port = await new Promise<number>((r) => {
      server!.listen({ host: '0.0.0.0', port: 0 }, () => {
        const addr = server!.address();
        r(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    expect(await bindProbe(port)).toBe(false);
  });
});
