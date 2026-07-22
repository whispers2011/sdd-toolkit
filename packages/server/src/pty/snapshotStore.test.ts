import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotStore } from './snapshotStore.js';

describe('SnapshotStore', () => {
  let dir: string;
  let store: SnapshotStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sdd-snap-'));
    store = new SnapshotStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('save/load/remove Roundtrip', () => {
    expect(store.load('f1')).toBeNull();
    store.save('f1', 'terminal-inhalt');
    expect(store.load('f1')).toBe('terminal-inhalt');
    store.remove('f1');
    expect(store.load('f1')).toBeNull();
  });

  it('kappt auf das Limit (letzter Stand zählt)', () => {
    const big = 'x'.repeat(600 * 1024) + 'ENDE';
    store.save('f2', big);
    const loaded = store.load('f2')!;
    expect(loaded.length).toBeLessThanOrEqual(512 * 1024);
    expect(loaded.endsWith('ENDE')).toBe(true);
  });

  it('leerer Scrollback überschreibt nichts', () => {
    store.save('f3', 'inhalt');
    store.save('f3', '');
    expect(store.load('f3')).toBe('inhalt');
  });
});
