import { describe, expect, it } from 'vitest';
import { initialPhases, type Project } from '@sdd/shared';
import { openMemoryDatabase } from './database.js';
import { FeatureRepo, ProjectRepo } from './repos.js';
import { KnowledgeRepo } from './knowledgeRepo.js';

function baseProject(name: string, path: string): Omit<Project, 'id' | 'createdAt'> {
  return {
    name,
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

function setup() {
  const db = openMemoryDatabase();
  const projects = new ProjectRepo(db);
  const features = new FeatureRepo(db);
  const knowledge = new KnowledgeRepo(db);
  const project = projects.create(baseProject('P', '/tmp/p'));
  return { db, projects, features, knowledge, project };
}

const app = { text: '', tags: [] as string[] };

describe('KnowledgeRepo — Einträge & Scoping', () => {
  it('CRUD und Projekt-Scoping (kein Cross-Projekt)', () => {
    const { projects, knowledge, project } = setup();
    const other = projects.create(baseProject('Q', '/tmp/q'));

    const e = knowledge.createEntry(project.id, { bundleId: null, title: 'Regeln', body: 'X', applicability: app });
    expect(knowledge.listEntriesByProject(project.id).map((x) => x.id)).toEqual([e.id]);
    expect(knowledge.listEntriesByProject(other.id)).toHaveLength(0);

    knowledge.updateEntry(e.id, { title: 'Neu' });
    expect(knowledge.getEntry(e.id)!.title).toBe('Neu');

    knowledge.deleteEntry(e.id);
    expect(knowledge.getEntry(e.id)).toBeNull();
  });
});

describe('KnowledgeRepo — Verschachtelung & Cascade', () => {
  it('baut Baum und kaskadiert Löschen auf Teilbaum', () => {
    const { knowledge, project } = setup();
    const a = knowledge.createBundle(project.id, { parentId: null, name: 'Auth', applicability: app });
    const b = knowledge.createBundle(project.id, { parentId: a.id, name: 'SSO', applicability: app });
    const e = knowledge.createEntry(project.id, { bundleId: b.id, title: 'Token', body: '…', applicability: app });

    const tree = knowledge.tree(project.id);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]!.children[0]!.entries[0]!.id).toBe(e.id);

    knowledge.deleteBundle(a.id);
    expect(knowledge.getBundle(b.id)).toBeNull(); // Unter-Bundle kaskadiert
    expect(knowledge.getEntry(e.id)).toBeNull(); // Eintrag kaskadiert
  });

  it('index() liefert projectId auch bei leerem Projekt', () => {
    const { knowledge, project } = setup();
    const idx = knowledge.index(project.id);
    expect(idx.projectId).toBe(project.id);
    expect(idx.items).toHaveLength(0);
  });
});

describe('KnowledgeRepo — Feature-Selektion', () => {
  it('setzt, überschreibt und löscht Overrides', () => {
    const { knowledge, features, project } = setup();
    const feature = features.create({
      projectId: project.id,
      name: 'f',
      branch: 'feature/f',
      worktreePath: null,
      phases: initialPhases(['specify']),
      integration: 'none',
      automation: {},
      tasksDone: 0,
      tasksTotal: 0,
    });

    knowledge.setSelection(feature.id, 'b1', 'bundle', 'include');
    knowledge.setSelection(feature.id, 'b1', 'bundle', 'exclude'); // upsert
    expect(knowledge.listSelectionForFeature(feature.id)).toEqual([
      { featureId: feature.id, targetId: 'b1', targetKind: 'bundle', decision: 'exclude' },
    ]);

    knowledge.clearSelection(feature.id, 'b1');
    expect(knowledge.listSelectionForFeature(feature.id)).toHaveLength(0);
  });
});
