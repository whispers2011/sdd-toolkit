import { describe, expect, it } from 'vitest';
import { parseWorktreeListPorcelain } from './worktreeInventory.js';

describe('parseWorktreeListPorcelain', () => {
  it('liefert für leere Ausgabe eine leere Liste', () => {
    expect(parseWorktreeListPorcelain('')).toEqual([]);
    expect(parseWorktreeListPorcelain('\n\n')).toEqual([]);
  });

  it('parst den Haupt-Checkout mit Branch und HEAD', () => {
    const out = ['worktree /repo', 'HEAD abc123', 'branch refs/heads/main', ''].join('\n');
    const [wt] = parseWorktreeListPorcelain(out);
    expect(wt).toMatchObject({
      path: '/repo',
      branch: 'main',
      head: 'abc123',
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
    });
  });

  it('erkennt detached HEAD (kein Branch)', () => {
    const out = ['worktree /repo/wt', 'HEAD deadbeef', 'detached', ''].join('\n');
    const [wt] = parseWorktreeListPorcelain(out);
    expect(wt?.detached).toBe(true);
    expect(wt?.branch).toBeNull();
    expect(wt?.head).toBe('deadbeef');
  });

  it('erkennt bare (weder HEAD noch Branch)', () => {
    const out = ['worktree /repo.git', 'bare', ''].join('\n');
    const [wt] = parseWorktreeListPorcelain(out);
    expect(wt?.bare).toBe(true);
    expect(wt?.head).toBeNull();
    expect(wt?.branch).toBeNull();
  });

  it('erkennt locked mit und ohne Begründung', () => {
    const withReason = parseWorktreeListPorcelain(
      ['worktree /a', 'HEAD a1', 'branch refs/heads/x', 'locked auf USB-Stick', ''].join('\n'),
    );
    expect(withReason[0]).toMatchObject({ locked: true, lockedReason: 'auf USB-Stick' });

    const bare = parseWorktreeListPorcelain(
      ['worktree /b', 'HEAD b1', 'branch refs/heads/y', 'locked', ''].join('\n'),
    );
    expect(bare[0]).toMatchObject({ locked: true, lockedReason: null });
  });

  it('erkennt prunable inkl. Begründung (Registry-Leiche)', () => {
    const out = [
      'worktree /weg',
      'HEAD c1',
      'branch refs/heads/z',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');
    const [wt] = parseWorktreeListPorcelain(out);
    expect(wt?.prunable).toBe(true);
    expect(wt?.prunableReason).toBe('gitdir file points to non-existent location');
  });

  it('parst mehrere Einträge in Reihenfolge und ohne abschließende Leerzeile', () => {
    const out = [
      'worktree /repo',
      'HEAD a',
      'branch refs/heads/main',
      '',
      'worktree /repo/wt-1',
      'HEAD b',
      'branch refs/heads/feature/eins',
      '',
      'worktree /repo/wt-2',
      'HEAD c',
      'detached',
    ].join('\n');
    const list = parseWorktreeListPorcelain(out);
    expect(list.map((e) => e.path)).toEqual(['/repo', '/repo/wt-1', '/repo/wt-2']);
    expect(list.map((e) => e.branch)).toEqual(['main', 'feature/eins', null]);
    expect(list[2]?.detached).toBe(true);
  });

  it('behält Pfade mit Leerzeichen unverändert', () => {
    const out = ['worktree /Users/x/mein projekt', 'HEAD a', 'branch refs/heads/main', ''].join('\n');
    expect(parseWorktreeListPorcelain(out)[0]?.path).toBe('/Users/x/mein projekt');
  });
});
