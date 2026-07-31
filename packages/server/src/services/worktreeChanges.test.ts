import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorktreeFileChange } from '@sdd/shared';
import { changedOnTargetSince, collectWorktreeChanges } from './worktreeChanges.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** Erhebung gegen ein echtes Repo — die Parser sind separat in shared getestet. */
describe('collectWorktreeChanges (Integration)', () => {
  let repo: string;

  const byPath = (files: WorktreeFileChange[]): Record<string, WorktreeFileChange> =>
    Object.fromEntries(files.map((f) => [f.path, f]));

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-wc-repo-'));
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'bleibt.txt'), 'a\n');
    writeFileSync(join(repo, 'geaendert.txt'), 'alt\n');
    writeFileSync(join(repo, 'geloescht.txt'), 'weg\n');
    writeFileSync(join(repo, 'umbenannt.txt'), 'x'.repeat(200));
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);
    sh(repo, ['checkout', '-b', 'feature/x']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('meldet einen unveränderten Worktree als leer', async () => {
    const { files } = await collectWorktreeChanges(repo, 'main');
    expect(files).toEqual([]);
  });

  it('erfasst neu, geändert, gelöscht, umbenannt und untracked mit korrekter Änderungsart', async () => {
    writeFileSync(join(repo, 'neu.txt'), 'neu\n');
    writeFileSync(join(repo, 'geaendert.txt'), 'neu\n');
    rmSync(join(repo, 'geloescht.txt'));
    sh(repo, ['mv', 'umbenannt.txt', 'jetzt-anders.txt']);
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'arbeit']);
    writeFileSync(join(repo, 'untracked.txt'), 'roh\n');

    const map = byPath((await collectWorktreeChanges(repo, 'main')).files);
    expect(map['neu.txt']).toMatchObject({ kind: 'added', state: 'committed' });
    expect(map['geaendert.txt']).toMatchObject({ kind: 'modified', state: 'committed' });
    expect(map['geloescht.txt']).toMatchObject({ kind: 'deleted', state: 'committed' });
    expect(map['jetzt-anders.txt']).toMatchObject({
      kind: 'renamed',
      oldPath: 'umbenannt.txt',
      state: 'committed',
    });
    expect(map['untracked.txt']).toMatchObject({ kind: 'added', state: 'uncommitted' });
    // Unveränderte Dateien tauchen nicht auf.
    expect(map['bleibt.txt']).toBeUndefined();
  });

  it('unterscheidet committet, uncommittet und beides', async () => {
    writeFileSync(join(repo, 'geaendert.txt'), 'commit-stand\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'erste änderung']);
    // Dieselbe Datei danach erneut anfassen ⇒ 'both'.
    writeFileSync(join(repo, 'geaendert.txt'), 'arbeitsbaum-stand\n');
    // Eine andere Datei nur im Arbeitsbaum ⇒ 'uncommitted'.
    writeFileSync(join(repo, 'bleibt.txt'), 'jetzt anders\n');
    // Eine committete, danach unberührte Datei ⇒ 'committed'.
    writeFileSync(join(repo, 'nur-committet.txt'), 'fest\n');
    sh(repo, ['add', 'nur-committet.txt']);
    sh(repo, ['commit', '-m', 'zweite änderung']);

    const map = byPath((await collectWorktreeChanges(repo, 'main')).files);
    expect(map['geaendert.txt']?.state).toBe('both');
    expect(map['bleibt.txt']?.state).toBe('uncommitted');
    expect(map['nur-committet.txt']?.state).toBe('committed');
  });

  it('erfasst Pfade mit Leerzeichen und Umlauten', async () => {
    writeFileSync(join(repo, 'mein ordner größe.txt'), 'ä\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'umlaute']);

    const paths = (await collectWorktreeChanges(repo, 'main')).files.map((f) => f.path);
    expect(paths).toContain('mein ordner größe.txt');
  });

  it('liefert den Abzweigpunkt mit', async () => {
    const { base } = await collectWorktreeChanges(repo, 'main');
    expect(base).toMatch(/^[0-9a-f]{40}$/);
  });

  it('wirft mit Klartext, wenn der Zielbranch nicht existiert', async () => {
    await expect(collectWorktreeChanges(repo, 'gibt-es-nicht')).rejects.toThrow(
      /gibt-es-nicht nicht ermittelbar/,
    );
  });
});

describe('changedOnTargetSince (Integration)', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-cots-repo-'));
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('nennt die seit dem Abzweigpunkt auf dem Ziel geänderten Pfade', async () => {
    const base = sh(repo, ['rev-parse', 'HEAD']).trim();
    writeFileSync(join(repo, 'a.txt'), 'auf main geaendert\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'main bewegt sich']);

    const changed = await changedOnTargetSince(repo, base, 'main');
    expect([...changed]).toEqual(['a.txt']);
  });

  it('ist leer, solange sich das Ziel nicht bewegt hat', async () => {
    const base = sh(repo, ['rev-parse', 'HEAD']).trim();
    expect((await changedOnTargetSince(repo, base, 'main')).size).toBe(0);
  });
});
