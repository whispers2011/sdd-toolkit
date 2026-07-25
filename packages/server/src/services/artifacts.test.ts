import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { phaseDefinitionPath } from './artifacts.js';

describe('phaseDefinitionPath', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sdd-artifacts-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('findet die Skills-Installation (SKILL.md)', () => {
    const dir = join(root, '.claude', 'skills', 'speckit-specify');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'SKILL.md');
    writeFileSync(file, '# Specify');
    expect(phaseDefinitionPath(root, 'specify')).toBe(file);
  });

  it('findet die Command-Installation mit Bindestrich', () => {
    const dir = join(root, '.claude', 'commands');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'speckit-plan.md');
    writeFileSync(file, '# Plan');
    expect(phaseDefinitionPath(root, 'plan')).toBe(file);
  });

  it('findet die Command-Installation mit Punkt', () => {
    const dir = join(root, '.claude', 'commands');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'speckit.tasks.md');
    writeFileSync(file, '# Tasks');
    expect(phaseDefinitionPath(root, 'tasks')).toBe(file);
  });

  it('gibt null zurück, wenn keine Definition existiert', () => {
    expect(phaseDefinitionPath(root, 'analyze')).toBeNull();
  });
});
