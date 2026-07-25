import { mkdtempSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectUnmergedChanges } from './unmergedChanges.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Kern der Sichtbarkeit ungemergter Arbeit: Der Diff gegen den Abzweigpunkt muss
 * committete UND uncommittete UND untracked Änderungen erfassen (der frühere
 * Drei-Punkt-Diff sah nur Commits — genau der Blindspot).
 */
describe('collectUnmergedChanges', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sdd-unmerged-'));
    sh(repo, ['init', '-b', 'main']);
    sh(repo, ['config', 'user.email', 'test@test.local']);
    sh(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'init']);
    sh(repo, ['checkout', '-b', 'feature/z']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('erfasst committete Branch-Änderungen und Commits', async () => {
    writeFileSync(join(repo, 'committed.txt'), 'a\nb\n');
    sh(repo, ['add', '-A']);
    sh(repo, ['commit', '-m', 'feat: committed']);
    const d = await collectUnmergedChanges(repo, 'main');
    expect(d.files.map((f) => f.path)).toContain('committed.txt');
    expect(d.commits.map((c) => c.subject)).toContain('feat: committed');
    expect(d.hasUncommitted).toBe(false);
  });

  it('erfasst uncommittete Änderungen an getrackten Dateien', async () => {
    appendFileSync(join(repo, 'base.txt'), 'more\n');
    const d = await collectUnmergedChanges(repo, 'main');
    expect(d.files.find((f) => f.path === 'base.txt')?.additions).toBeGreaterThan(0);
    expect(d.hasUncommitted).toBe(true);
  });

  it('erfasst untracked Dateien als „neu" mit Zeilenzahl', async () => {
    writeFileSync(join(repo, 'new.ts'), 'x\ny\nz\n');
    const d = await collectUnmergedChanges(repo, 'main');
    const f = d.files.find((x) => x.path === 'new.ts');
    expect(f?.untracked).toBe(true);
    expect(f?.additions).toBeGreaterThan(0);
    expect(d.hasUncommitted).toBe(true);
  });
});
