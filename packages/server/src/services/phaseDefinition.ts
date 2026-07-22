import { statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import type { Feature, FeaturePhase, PhaseDefinition, Project } from '@sdd/shared';
import { phaseDefinitionPath } from './artifacts.js';

/** Sperre, solange ein Feature des Projekts den Schritt gerade ausführt (FR-010). */
export function phaseLock(
  features: Feature[],
  phase: FeaturePhase,
): { locked: boolean; reason: string | null } {
  const running = features.some((f) => f.phases[phase]?.status === 'running');
  return running
    ? { locked: true, reason: `Agent führt gerade '${phase}' aus` }
    : { locked: false, reason: null };
}

/** Liest die Definition eines Schritts und leitet exists/mtime/lock ab. */
export async function readPhaseDefinition(
  project: Project,
  phase: FeaturePhase,
  features: Feature[],
): Promise<PhaseDefinition> {
  const path = phaseDefinitionPath(project.path, phase);
  const { locked, reason } = phaseLock(features, phase);
  if (!path) {
    return {
      projectId: project.id,
      phase,
      exists: false,
      path: null,
      content: null,
      mtimeMs: null,
      locked,
      lockReason: reason,
    };
  }
  const content = await readFile(path, 'utf8');
  const mtimeMs = statSync(path).mtimeMs;
  return { projectId: project.id, phase, exists: true, path, content, mtimeMs, locked, lockReason: reason };
}

export type DefinitionErrorCode = 'not_found' | 'locked' | 'conflict';

export class DefinitionError extends Error {
  constructor(
    public readonly code: DefinitionErrorCode,
    message: string,
    public readonly current?: { content: string; mtimeMs: number },
  ) {
    super(message);
    this.name = 'DefinitionError';
  }
}

/** Schreibt die Definition zurück; konflikt- (FR-009) und sperrgeschützt (FR-010). */
export async function writePhaseDefinition(
  project: Project,
  phase: FeaturePhase,
  features: Feature[],
  body: { content: string; baseMtimeMs: number; overwrite?: boolean },
): Promise<{ mtimeMs: number }> {
  const path = phaseDefinitionPath(project.path, phase);
  if (!path) throw new DefinitionError('not_found', 'Keine Definitionsdatei für diesen Schritt.');

  const { locked, reason } = phaseLock(features, phase);
  if (locked) throw new DefinitionError('locked', reason ?? 'Bearbeiten ist gesperrt.');

  const currentMtime = statSync(path).mtimeMs;
  if (!body.overwrite && currentMtime !== body.baseMtimeMs) {
    const current = await readFile(path, 'utf8');
    throw new DefinitionError('conflict', 'Die Datei wurde seit dem Öffnen extern geändert.', {
      content: current,
      mtimeMs: currentMtime,
    });
  }

  await writeFile(path, body.content, 'utf8');
  return { mtimeMs: statSync(path).mtimeMs };
}
