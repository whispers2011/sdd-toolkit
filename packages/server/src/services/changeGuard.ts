import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { FeatureRepo, ProjectRepo } from '../db/repos.js';
import type { Orchestrator } from './orchestrator.js';

const DEBOUNCE_MS = 500;

/**
 * Change-Guard (WP12): beobachtet specs/** in Projekt-Checkouts und Feature-
 * Worktrees. Externe Änderungen (Editor, andere Tools) lösen Phasen-Reconcile
 * und Task-Fortschritts-Update aus — die UI bleibt synchron.
 */
export class ChangeGuard {
  private watchers = new Map<string, { watcher: FSWatcher; projectId: string }>();
  private pending = new Map<string, NodeJS.Timeout>(); // projectId → debounce

  constructor(
    private projects: ProjectRepo,
    private features: FeatureRepo,
    private orchestrator: Orchestrator,
  ) {}

  /** Watcher-Menge an den aktuellen Projekt-/Feature-Bestand angleichen (idempotent). */
  sync(): void {
    const wanted = new Map<string, string>(); // dir → projectId
    for (const project of this.projects.list()) {
      const dir = join(project.path, 'specs');
      if (existsSync(dir)) wanted.set(dir, project.id);
    }
    for (const feature of this.features.listAll()) {
      if (!feature.worktreePath) continue;
      const dir = join(feature.worktreePath, 'specs');
      if (existsSync(dir)) wanted.set(dir, feature.projectId);
    }

    for (const [dir, entry] of this.watchers) {
      if (!wanted.has(dir)) {
        void entry.watcher.close();
        this.watchers.delete(dir);
      }
    }
    for (const [dir, projectId] of wanted) {
      if (this.watchers.has(dir)) continue;
      const watcher = watch(dir, {
        persistent: true,
        ignoreInitial: true,
        depth: 3,
        ignored: /\/reviews\//, // Review-Berichte schreiben wir selbst
      });
      watcher.on('all', () => this.schedule(projectId));
      this.watchers.set(dir, { watcher, projectId });
    }
  }

  private schedule(projectId: string): void {
    const existing = this.pending.get(projectId);
    if (existing) clearTimeout(existing);
    this.pending.set(
      projectId,
      setTimeout(() => {
        this.pending.delete(projectId);
        for (const feature of this.features.listByProject(projectId)) {
          try {
            this.orchestrator.reconcileFeature(feature.id);
          } catch {
            /* Feature ggf. gerade gelöscht */
          }
        }
      }, DEBOUNCE_MS),
    );
  }

  async stop(): Promise<void> {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    await Promise.allSettled([...this.watchers.values()].map((e) => e.watcher.close()));
    this.watchers.clear();
  }
}
