import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Feature, FeaturePhase, PhaseState, PhaseStatus, Project } from '@sdd/shared';
import { FEATURE_PHASES } from '@sdd/shared';
import {
  ArtifactError,
  listFeatureArtifactSteps,
  readFeatureArtifact,
  writeFeatureArtifact,
} from './featureArtifacts.js';

let root: string;
const FEATURE_NAME = 'demo-feature';

function specsDir(): string {
  return join(root, 'specs', FEATURE_NAME);
}

function writeArtifact(relPath: string, content: string): void {
  const abs = join(specsDir(), relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function makeProject(): Project {
  return {
    id: 'p1',
    name: 'Proj',
    path: join(root, 'main-checkout'),
    defaultBranch: 'main',
    color: null,
    enabledPhases: [...FEATURE_PHASES],
    verifyCommands: [],
    automation: {},
    optimization: {},
    mergeMode: 'ff',
    editorCmd: null,
    integrationMode: 'local',
    createdAt: 0,
  };
}

function makeFeature(running?: FeaturePhase): Feature {
  const phases = Object.fromEntries(
    FEATURE_PHASES.map((p) => [p, { status: (p === running ? 'running' : 'idle') as PhaseStatus, stale: false } satisfies PhaseState]),
  ) as Record<FeaturePhase, PhaseState>;
  return {
    id: 'f1',
    projectId: 'p1',
    name: FEATURE_NAME,
    branch: `feature/${FEATURE_NAME}`,
    worktreePath: root, // Artefakte liegen im Worktree
    phases,
    integration: 'none',
    automation: {},
    optimization: {},
    tasksDone: 0,
    tasksTotal: 0,
    createdAt: 0,
    archivedAt: null,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sdd-fa-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listFeatureArtifactSteps', () => {
  it('markiert nur vorhandene Artefakte als verfügbar', () => {
    writeArtifact('spec.md', '# Spec');
    const steps = listFeatureArtifactSteps(makeProject(), makeFeature());
    expect(steps.map((s) => s.phase)).toEqual(['specify', 'plan', 'tasks', 'checklist']);
    const specify = steps.find((s) => s.phase === 'specify')!;
    expect(specify.available).toBe(true);
    expect(specify.files).toEqual([{ id: 'spec.md', label: 'Spec', relPath: 'spec.md' }]);
    expect(steps.find((s) => s.phase === 'tasks')!.available).toBe(false);
  });

  it('enumeriert Plan-Begleitartefakte und contracts/*', () => {
    writeArtifact('plan.md', '# Plan');
    writeArtifact('research.md', '# Research');
    writeArtifact('contracts/api.md', '# API');
    writeArtifact('contracts/events.md', '# Events');
    const plan = listFeatureArtifactSteps(makeProject(), makeFeature()).find((s) => s.phase === 'plan')!;
    expect(plan.available).toBe(true);
    expect(plan.files.map((f) => f.id)).toEqual(['plan.md', 'research.md', 'contracts/api.md', 'contracts/events.md']);
    expect(plan.files.find((f) => f.id === 'contracts/api.md')!.label).toBe('Contract: api.md');
  });

  it('enumeriert checklists/* für den Checklist-Schritt', () => {
    writeArtifact('checklists/requirements.md', '# Req');
    const checklist = listFeatureArtifactSteps(makeProject(), makeFeature()).find((s) => s.phase === 'checklist')!;
    expect(checklist.available).toBe(true);
    expect(checklist.files.map((f) => f.id)).toEqual(['checklists/requirements.md']);
  });
});

describe('readFeatureArtifact', () => {
  it('liefert Inhalt + mtime für eine vorhandene Datei', async () => {
    writeArtifact('spec.md', '# Spec\nHallo');
    const art = await readFeatureArtifact(makeProject(), makeFeature(), 'specify');
    expect(art.exists).toBe(true);
    expect(art.content).toBe('# Spec\nHallo');
    expect(art.mtimeMs).toBeGreaterThan(0);
    expect(art.locked).toBe(false);
  });

  it('markiert exists=false, wenn kein Artefakt vorliegt', async () => {
    const art = await readFeatureArtifact(makeProject(), makeFeature(), 'tasks');
    expect(art.exists).toBe(false);
    expect(art.content).toBeNull();
    expect(art.mtimeMs).toBeNull();
  });

  it('setzt locked, wenn eine Phase des Features läuft', async () => {
    writeArtifact('spec.md', '# Spec');
    const art = await readFeatureArtifact(makeProject(), makeFeature('implement'), 'specify');
    expect(art.locked).toBe(true);
    expect(art.lockReason).toBeTruthy();
  });

  it('wählt bei plan die gewünschte Begleitdatei via fileId', async () => {
    writeArtifact('plan.md', '# Plan');
    writeArtifact('research.md', '# Research');
    const art = await readFeatureArtifact(makeProject(), makeFeature(), 'plan', 'research.md');
    expect(art.fileId).toBe('research.md');
    expect(art.content).toBe('# Research');
  });
});

describe('writeFeatureArtifact', () => {
  it('schreibt Inhalt zurück und liefert neue mtime', async () => {
    writeArtifact('spec.md', 'alt');
    const base = statSync(join(specsDir(), 'spec.md')).mtimeMs;
    const res = await writeFeatureArtifact(makeProject(), makeFeature(), 'specify', 'spec.md', {
      content: 'neu',
      baseMtimeMs: base,
    });
    expect(readFileSync(join(specsDir(), 'spec.md'), 'utf8')).toBe('neu');
    expect(res.mtimeMs).toBeGreaterThanOrEqual(base);
  });

  it('wirft conflict bei abweichender mtime ohne overwrite', async () => {
    writeArtifact('spec.md', 'aktuell');
    await expect(
      writeFeatureArtifact(makeProject(), makeFeature(), 'specify', 'spec.md', {
        content: 'x',
        baseMtimeMs: 1, // veraltet
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(readFileSync(join(specsDir(), 'spec.md'), 'utf8')).toBe('aktuell'); // unverändert
  });

  it('überschreibt bei overwrite trotz mtime-Abweichung', async () => {
    writeArtifact('spec.md', 'aktuell');
    await writeFeatureArtifact(makeProject(), makeFeature(), 'specify', 'spec.md', {
      content: 'forciert',
      baseMtimeMs: 1,
      overwrite: true,
    });
    expect(readFileSync(join(specsDir(), 'spec.md'), 'utf8')).toBe('forciert');
  });

  it('wirft locked, wenn eine Phase läuft', async () => {
    writeArtifact('spec.md', 'x');
    const base = statSync(join(specsDir(), 'spec.md')).mtimeMs;
    await expect(
      writeFeatureArtifact(makeProject(), makeFeature('specify'), 'specify', 'spec.md', {
        content: 'y',
        baseMtimeMs: base,
      }),
    ).rejects.toMatchObject({ code: 'locked' });
  });

  it('wirft not_found für eine unbekannte Datei', async () => {
    writeArtifact('spec.md', 'x');
    await expect(
      writeFeatureArtifact(makeProject(), makeFeature(), 'specify', 'nope.md', { content: 'y', baseMtimeMs: 1 }),
    ).rejects.toBeInstanceOf(ArtifactError);
  });
});
