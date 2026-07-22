import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeaturePhase } from '@sdd/shared';

/** spec-kit-Artefakt-Pfade relativ zum Repo-Root. */
export function artifactPath(repoRoot: string, featureName: string, phase: FeaturePhase): string | null {
  const dir = join(repoRoot, 'specs', featureName);
  switch (phase) {
    case 'specify':
    case 'clarify': // clarify aktualisiert spec.md in-place
      return join(dir, 'spec.md');
    case 'plan':
      return join(dir, 'plan.md');
    case 'checklist':
      return join(dir, 'checklists');
    case 'tasks':
      return join(dir, 'tasks.md');
    case 'analyze':
    case 'implement':
      return null; // kein eigenes Artefakt
  }
}

export function artifactExists(repoRoot: string, featureName: string, phase: FeaturePhase): boolean {
  const p = artifactPath(repoRoot, featureName, phase);
  return p !== null && existsSync(p);
}

/** Task-Fortschritt aus tasks.md-Checkboxen (speckit-assistant-Muster). */
export async function parseTaskProgress(
  repoRoot: string,
  featureName: string,
): Promise<{ done: number; total: number }> {
  const p = join(repoRoot, 'specs', featureName, 'tasks.md');
  try {
    const content = await readFile(p, 'utf8');
    const boxes = content.match(/^\s*[-*]\s+\[[ xX]\]/gm) ?? [];
    const done = boxes.filter((b) => /\[[xX]\]/.test(b)).length;
    return { done, total: boxes.length };
  } catch {
    return { done: 0, total: 0 };
  }
}

export function hasSpecKit(repoRoot: string): boolean {
  if (existsSync(join(repoRoot, '.specify')) || existsSync(join(repoRoot, 'specs'))) return true;
  // Slash-Commands/Skills-Installation ohne .specify (neuere spec-kit-Varianten)
  for (const dir of ['.claude/commands', '.claude/skills']) {
    const p = join(repoRoot, dir);
    if (!existsSync(p)) continue;
    try {
      if (readdirSync(p).some((f) => f.toLowerCase().startsWith('speckit'))) return true;
    } catch {
      /* unlesbar */
    }
  }
  return false;
}

/**
 * Kommando-Stil der spec-kit-Installation erkennen:
 * neue Skills-Installationen → `/speckit-<phase>`, ältere Command-Installationen
 * → `/speckit.<phase>`. Default: Bindestrich (aktueller Stand).
 */
export function speckitCommandPrefix(repoRoot: string): string {
  if (existsSync(join(repoRoot, '.claude', 'skills', 'speckit-specify'))) return '/speckit-';
  const commandsDir = join(repoRoot, '.claude', 'commands');
  try {
    if (existsSync(commandsDir) && readdirSync(commandsDir).some((f) => f.startsWith('speckit.'))) {
      return '/speckit.';
    }
  } catch {
    /* unlesbar */
  }
  return '/speckit-';
}

export function listSpecDirs(repoRoot: string): string[] {
  const specsDir = join(repoRoot, 'specs');
  if (!existsSync(specsDir)) return [];
  try {
    return readdirSync(specsDir).filter((d) => {
      try {
        return statSync(join(specsDir, d)).isDirectory() && !d.startsWith('.');
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}
