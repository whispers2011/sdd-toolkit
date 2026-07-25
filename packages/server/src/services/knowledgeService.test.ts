import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initialPhases, type Project } from '@sdd/shared';
import { openMemoryDatabase } from '../db/database.js';
import { FeatureRepo, ProjectRepo } from '../db/repos.js';
import { KnowledgeRepo } from '../db/knowledgeRepo.js';
import { KnowledgeService } from './knowledgeService.js';

function baseProject(path: string): Omit<Project, 'id' | 'createdAt'> {
  return {
    name: 'P',
    path,
    defaultBranch: 'main',
    color: null,
    enabledPhases: ['specify'],
    verifyCommands: [],
    automation: {},
    mergeMode: 'ff',
    editorCmd: null,
    integrationMode: 'local',
  };
}

describe('KnowledgeService.materializeForFeature', () => {
  it('materialisiert nur relevante Elemente + git-excludes .sdd/', () => {
    const worktree = mkdtempSync(join(tmpdir(), 'sdd-kn-'));
    mkdirSync(join(worktree, '.git', 'info'), { recursive: true });

    const db = openMemoryDatabase();
    const projects = new ProjectRepo(db);
    const features = new FeatureRepo(db);
    const knowledge = new KnowledgeRepo(db);
    const service = new KnowledgeService({ knowledge, projects, features });

    const project = projects.create(baseProject(worktree));
    knowledge.createBundle(project.id, { parentId: null, name: 'Auth', applicability: { text: 'bei login', tags: ['jwt'] } });
    knowledge.createBundle(project.id, { parentId: null, name: 'Deploy', applicability: { text: 'bei release', tags: ['ci'] } });

    const feature = features.create({
      projectId: project.id,
      name: 'jwt-login',
      branch: 'feature/jwt-login',
      worktreePath: worktree,
      phases: initialPhases(['specify']),
      integration: 'none',
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });

    const result = service.materializeForFeature(feature);

    // "Auth" (Tag jwt trifft Feature-Name) ist relevant, "Deploy" nicht.
    expect(result.resolved.effective).toHaveLength(1);
    expect(result.indexPath).toBe(join('.sdd', 'knowledge', 'index.md'));
    expect(result.materialized).toHaveLength(1);

    const indexMd = readFileSync(join(worktree, '.sdd', 'knowledge', 'index.md'), 'utf8');
    expect(indexMd).toContain('[relevant]');
    expect(indexMd).toContain('Auth');
    expect(indexMd).toContain('Deploy'); // alles gelistet …
    // … aber nur Auth materialisiert:
    expect(existsSync(join(worktree, result.materialized[0]!.path))).toBe(true);

    const exclude = readFileSync(join(worktree, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('.sdd/');
  });

  it('gibt leere Präambel zurück, wenn kein Wissen existiert', () => {
    const worktree = mkdtempSync(join(tmpdir(), 'sdd-kn-'));
    const db = openMemoryDatabase();
    const projects = new ProjectRepo(db);
    const features = new FeatureRepo(db);
    const knowledge = new KnowledgeRepo(db);
    const service = new KnowledgeService({ knowledge, projects, features });
    const project = projects.create(baseProject(worktree));
    const feature = features.create({
      projectId: project.id,
      name: 'x',
      branch: 'feature/x',
      worktreePath: worktree,
      phases: initialPhases(['specify']),
      integration: 'none',
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });
    const result = service.materializeForFeature(feature);
    expect(result.preamble).toBe('');
    expect(result.indexPath).toBeNull();
  });
});
