import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Feature, FeaturePhase, Project } from '@sdd/shared';
import { DefinitionError, phaseLock, readPhaseDefinition, writePhaseDefinition } from './phaseDefinition.js';

function fakeProject(root: string): Project {
  return { id: 'p1', name: 'Test', path: root } as unknown as Project;
}
function featureRunning(phase: FeaturePhase): Feature {
  return { id: 'f1', projectId: 'p1', phases: { [phase]: { status: 'running' } } } as unknown as Feature;
}

describe('phaseLock', () => {
  it('sperrt, wenn ein Feature den Schritt ausführt', () => {
    expect(phaseLock([featureRunning('plan')], 'plan').locked).toBe(true);
    expect(phaseLock([featureRunning('plan')], 'specify').locked).toBe(false);
    expect(phaseLock([], 'plan').locked).toBe(false);
  });
});

describe('readPhaseDefinition / writePhaseDefinition', () => {
  let root: string;
  let file: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sdd-phasedef-'));
    const dir = join(root, '.claude', 'skills', 'speckit-specify');
    mkdirSync(dir, { recursive: true });
    file = join(dir, 'SKILL.md');
    writeFileSync(file, '# Original');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('liest vorhandene Definition inkl. mtime', async () => {
    const def = await readPhaseDefinition(fakeProject(root), 'specify', []);
    expect(def.exists).toBe(true);
    expect(def.content).toBe('# Original');
    expect(def.mtimeMs).toBeGreaterThan(0);
    expect(def.locked).toBe(false);
  });

  it('meldet fehlende Definition ohne Fehler', async () => {
    const def = await readPhaseDefinition(fakeProject(root), 'analyze', []);
    expect(def.exists).toBe(false);
    expect(def.content).toBeNull();
    expect(def.path).toBeNull();
  });

  it('markiert locked, wenn Agent den Schritt ausführt', async () => {
    const def = await readPhaseDefinition(fakeProject(root), 'specify', [featureRunning('specify')]);
    expect(def.locked).toBe(true);
    expect(def.lockReason).toContain('specify');
  });

  it('schreibt bei passender Basis-mtime', async () => {
    const base = statSync(file).mtimeMs;
    const res = await writePhaseDefinition(fakeProject(root), 'specify', [], {
      content: '# Neu',
      baseMtimeMs: base,
    });
    expect(readFileSync(file, 'utf8')).toBe('# Neu');
    expect(res.mtimeMs).toBeGreaterThan(0);
  });

  it('wirft conflict bei abweichender mtime ohne overwrite', async () => {
    await expect(
      writePhaseDefinition(fakeProject(root), 'specify', [], { content: '# X', baseMtimeMs: 1 }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // Inhalt unverändert
    expect(readFileSync(file, 'utf8')).toBe('# Original');
  });

  it('überschreibt bei overwrite trotz abweichender mtime', async () => {
    await writePhaseDefinition(fakeProject(root), 'specify', [], {
      content: '# Forced',
      baseMtimeMs: 1,
      overwrite: true,
    });
    expect(readFileSync(file, 'utf8')).toBe('# Forced');
  });

  it('wirft locked, wenn Agent den Schritt ausführt', async () => {
    await expect(
      writePhaseDefinition(fakeProject(root), 'specify', [featureRunning('specify')], {
        content: '# X',
        baseMtimeMs: statSync(file).mtimeMs,
      }),
    ).rejects.toMatchObject({ code: 'locked' });
  });

  it('wirft not_found bei fehlender Datei', async () => {
    await expect(
      writePhaseDefinition(fakeProject(root), 'analyze', [], { content: '# X', baseMtimeMs: 1 }),
    ).rejects.toBeInstanceOf(DefinitionError);
  });
});
