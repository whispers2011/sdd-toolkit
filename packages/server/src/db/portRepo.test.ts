import { describe, expect, it, beforeEach } from 'vitest';
import { openMemoryDatabase, type DB } from './database.js';
import { PortRepo } from './portRepo.js';
import { ProjectRepo } from './repos.js';
import { EMPTY_STACK_CONFIG } from '@sdd/shared';

let db: DB;
let ports: PortRepo;
let projectId: string;
let otherProjectId: string;

function makeProject(repo: ProjectRepo, name: string, path: string): string {
  return repo.create({
    name,
    path,
    defaultBranch: 'main',
    color: null,
    enabledPhases: ['specify', 'plan', 'tasks', 'implement'],
    verifyCommands: [],
    automation: {},
    optimization: {},
    mergeMode: 'ff',
    editorCmd: null,
    integrationMode: 'local',
    stack: EMPTY_STACK_CONFIG,
  }).id;
}

beforeEach(() => {
  db = openMemoryDatabase();
  ports = new PortRepo(db);
  const projects = new ProjectRepo(db);
  projectId = makeProject(projects, 'Projekt A', '/repo/a');
  otherProjectId = makeProject(projects, 'Projekt B', '/repo/b');
});

function alloc(ownerId: string, base: number, kind: 'worktree' | 'project' = 'worktree', pid = projectId) {
  return ports.allocate({ ownerKind: kind, ownerId, projectId: pid, base, span: 20, allocatedAt: 1000 });
}

describe('PortRepo', () => {
  it('belegt einen Block und liefert ihn als belegt zurück', () => {
    const block = alloc('/wt/a', 21000);
    expect(block).toEqual({
      ownerKind: 'worktree',
      ownerId: '/wt/a',
      projectId,
      base: 21000,
      span: 20,
      allocatedAt: 1000,
      releasedAt: null,
    });
    expect(ports.findLiveByOwner('worktree', '/wt/a')).toEqual(block);
    expect(ports.live().map((b) => b.base)).toEqual([21000]);
  });

  it('findet nichts für einen unbekannten Besitzer', () => {
    expect(ports.findLiveByOwner('worktree', '/wt/gibt-es-nicht')).toBeNull();
  });

  /** FR-002: eindeutig projektübergreifend, nicht nur innerhalb eines Projekts. */
  it('lässt zwei belegte Blöcke mit derselben Basis nicht zu — auch über Projekte hinweg', () => {
    alloc('/wt/a', 21000);
    expect(() => alloc('/wt/b', 21000, 'worktree', otherProjectId)).toThrow();
  });

  it('gibt frei und meldet den Block danach nicht mehr als belegt (FR-005)', () => {
    alloc('/wt/a', 21000);
    ports.release('worktree', '/wt/a', 2000);
    expect(ports.findLiveByOwner('worktree', '/wt/a')).toBeNull();
    expect(ports.live()).toEqual([]);
    expect(ports.findByOwner('worktree', '/wt/a')?.releasedAt).toBe(2000);
  });

  it('erlaubt die Wiederverwendung einer freigegebenen Basis (FR-005)', () => {
    alloc('/wt/a', 21000);
    ports.release('worktree', '/wt/a', 2000);
    const wieder = alloc('/wt/b', 21000);
    expect(wieder.base).toBe(21000);
    expect(ports.live().map((b) => b.ownerId)).toEqual(['/wt/b']);
  });

  it('lässt zwei FREIGEGEBENE Blöcke mit gleicher Basis nebeneinander stehen', () => {
    alloc('/wt/a', 21000);
    ports.release('worktree', '/wt/a', 2000);
    alloc('/wt/b', 21000);
    ports.release('worktree', '/wt/b', 3000);
    expect(ports.list().filter((b) => b.base === 21000)).toHaveLength(2);
    expect(ports.live()).toEqual([]);
  });

  it('belegt einen zuvor freigegebenen Besitzer erneut, statt eine zweite Zeile anzulegen', () => {
    alloc('/wt/a', 21000);
    ports.release('worktree', '/wt/a', 2000);
    alloc('/wt/a', 21040);
    expect(ports.list().filter((b) => b.ownerId === '/wt/a')).toHaveLength(1);
    expect(ports.findLiveByOwner('worktree', '/wt/a')?.base).toBe(21040);
  });

  /** Geteilte Dienste liegen im Block des PROJEKTS, nicht eines Features (research E2/E7). */
  it('führt Projektblöcke neben Worktree-Blöcken', () => {
    alloc('/wt/a', 21000);
    alloc(projectId, 21020, 'project');
    expect(ports.findLiveByOwner('project', projectId)?.base).toBe(21020);
    expect(ports.findLiveByOwner('worktree', '/wt/a')?.base).toBe(21000);
    expect(ports.live()).toHaveLength(2);
  });

  it('nennt die belegten Blöcke eines Projekts für die Übersicht', () => {
    alloc('/wt/a', 21000);
    alloc('/wt/b', 21020);
    alloc('/wt/c', 21040, 'worktree', otherProjectId);
    expect(ports.liveForProject(projectId).map((b) => b.ownerId)).toEqual(['/wt/a', '/wt/b']);
  });

  it('räumt die Blöcke mit dem Projekt ab (FK-Cascade)', () => {
    alloc('/wt/a', 21000);
    new ProjectRepo(db).remove(projectId);
    expect(ports.list()).toEqual([]);
  });

  it('gibt einen bereits freigegebenen Block ohne Wirkung erneut frei', () => {
    alloc('/wt/a', 21000);
    ports.release('worktree', '/wt/a', 2000);
    ports.release('worktree', '/wt/a', 5000);
    expect(ports.findByOwner('worktree', '/wt/a')?.releasedAt).toBe(2000);
  });
});
