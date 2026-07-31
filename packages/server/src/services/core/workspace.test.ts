import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@sdd/shared';
import type { WorktreeManager } from '../../git/worktrees.js';
import { ensureWorkspace } from './workspace.js';

/**
 * Arbeitskopie anlegen — die Aufgabe aus FR-003, ab jetzt an einer Stelle.
 * Geprüft werden die Zusicherungen, die das Verhalten tragen: idempotent (W1),
 * Waisen-Erholung (W2), roher Fehler (W4), kein Nebenwirkungs-Schreiben (W5).
 */
describe('ensureWorkspace', () => {
  let dataDir: string;
  let project: Project;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-ws-'));
    project = {
      id: 'p1',
      name: 'Demo',
      path: '/tmp/demo',
      defaultBranch: 'main',
    } as unknown as Project;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  const managerMock = (createdPath: string) => {
    const create = vi.fn(async () => createdPath);
    const remove = vi.fn(async () => {});
    return { manager: { create, remove } as unknown as WorktreeManager, create, remove };
  };

  it('übernimmt eine vorhandene Arbeitskopie, ohne den Registry-Eintrag anzufassen (W1)', async () => {
    const vorhanden = join(dataDir, 'wt');
    mkdirSync(vorhanden, { recursive: true });
    const { manager, create, remove } = managerMock(vorhanden);

    const pfad = await ensureWorkspace(manager, {
      project,
      name: 'demo',
      branch: 'feature/demo',
      recordedPath: vorhanden,
    });

    expect(pfad).toBe(vorhanden);
    expect(remove).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('räumt einen verwaisten Eintrag auf und legt neu an (W2)', async () => {
    const verwaist = join(dataDir, 'weg'); // nie angelegt → fehlt auf der Platte
    const { manager, create, remove } = managerMock(verwaist);

    const pfad = await ensureWorkspace(manager, {
      project,
      name: 'chat-c1',
      branch: 'chat/c1',
      recordedPath: verwaist,
    });

    expect(remove).toHaveBeenCalledWith('/tmp/demo', verwaist);
    expect(create).toHaveBeenCalledTimes(1);
    expect(pfad).toBe(verwaist);
  });

  it('legt ohne gespeicherten Pfad direkt an (kein Aufräumversuch)', async () => {
    const neu = join(dataDir, 'neu');
    const { manager, create, remove } = managerMock(neu);

    await ensureWorkspace(manager, {
      project,
      name: 'demo',
      branch: 'feature/demo',
      recordedPath: null,
    });

    expect(remove).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      project,
      projectPath: '/tmp/demo',
      featureName: 'demo',
      branch: 'feature/demo',
      defaultBranch: 'main',
    });
  });

  it('schluckt einen Fehler beim Aufräumen — er darf die Anlage nicht verhindern (W2)', async () => {
    const verwaist = join(dataDir, 'weg');
    const create = vi.fn(async () => verwaist);
    const remove = vi.fn(async () => {
      throw new Error('worktree remove fehlgeschlagen');
    });
    const manager = { create, remove } as unknown as WorktreeManager;

    await expect(
      ensureWorkspace(manager, {
        project,
        name: 'demo',
        branch: 'feature/demo',
        recordedPath: verwaist,
      }),
    ).resolves.toBe(verwaist);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reicht den Fehler der Anlage unverändert weiter (W4)', async () => {
    const create = vi.fn(async () => {
      throw new Error('cannot lock ref');
    });
    const manager = { create, remove: vi.fn(async () => {}) } as unknown as WorktreeManager;

    await expect(
      ensureWorkspace(manager, {
        project,
        name: 'demo',
        branch: 'feature/demo',
        recordedPath: null,
      }),
    ).rejects.toThrow('cannot lock ref');
  });

  it('vermerkt den Pfad nirgends — das tut der Aufrufer (W5)', async () => {
    const neu = join(dataDir, 'neu');
    const { manager } = managerMock(neu);
    const managerKeys = Object.keys(manager as unknown as Record<string, unknown>);

    await ensureWorkspace(manager, { project, name: 'demo', branch: 'feature/demo', recordedPath: null });

    // Ausser create/remove wird nichts am Manager berührt; insbesondere kein setWorktree
    // und kein Schreiben am Projekt.
    expect(Object.keys(manager as unknown as Record<string, unknown>)).toEqual(managerKeys);
  });
});
