import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import type { FeaturePhase, Project } from '@sdd/shared';
import { initialPhases } from '@sdd/shared';
import type { FeatureRepo, ProjectRepo } from '../db/repos.js';
import { currentBranch, git, isGitRepo } from '../git/git.js';
import { artifactExists, hasSpecKit, listSpecDirs, parseTaskProgress } from './artifacts.js';
import { bus } from '../events.js';

const DEFAULT_ENABLED: FeaturePhase[] = ['specify', 'clarify', 'plan', 'tasks', 'implement'];

export interface OnboardingResult {
  project: Project;
  specKitDetected: boolean;
  importedFeatures: string[];
}

/**
 * Brownfield-Onboarding: bestehendes Repo registrieren, spec-kit erkennen,
 * vorhandene specs/<feature>-Ordner als Features importieren (Artefakte → approved).
 */
export class OnboardingService {
  constructor(
    private projects: ProjectRepo,
    private features: FeatureRepo,
  ) {}

  async addProject(opts: { path: string; name?: string }): Promise<OnboardingResult> {
    const path = opts.path.replace(/\/+$/, '');
    if (!existsSync(path)) throw new Error(`Pfad existiert nicht: ${path}`);
    if (!(await isGitRepo(path))) throw new Error(`Kein Git-Repository: ${path}`);
    if (this.projects.getByPath(path)) throw new Error(`Projekt bereits registriert: ${path}`);

    const defaultBranch = await detectDefaultBranch(path);
    const specKitDetected = hasSpecKit(path);

    const project = this.projects.create({
      name: opts.name ?? basename(path),
      path,
      defaultBranch,
      color: null,
      enabledPhases: DEFAULT_ENABLED,
      verifyCommands: [],
      automation: {},
      mergeMode: 'ff',
      editorCmd: null,
    });

    const importedFeatures: string[] = [];
    for (const dir of listSpecDirs(path)) {
      const phases = initialPhases(DEFAULT_ENABLED);
      for (const phase of DEFAULT_ENABLED) {
        // Brownfield: existierende Artefakte gelten als approved — das Team lebt bereits damit.
        if (artifactExists(path, dir, phase)) {
          phases[phase] = { status: 'approved', stale: false };
        }
      }
      const progress = await parseTaskProgress(path, dir);
      const feature = this.features.create({
        projectId: project.id,
        name: dir,
        branch: `feature/${dir}`,
        worktreePath: null,
        phases,
        integration: 'none',
        automation: {},
        tasksDone: progress.done,
        tasksTotal: progress.total,
      });
      importedFeatures.push(dir);
      bus.emitEvent('feature_updated', feature);
    }

    return { project, specKitDetected, importedFeatures };
  }
}

async function detectDefaultBranch(path: string): Promise<string> {
  for (const candidate of ['main', 'master']) {
    const r = await git(path, ['show-ref', '--verify', `refs/heads/${candidate}`]);
    if (r.code === 0) return candidate;
  }
  return currentBranch(path);
}
