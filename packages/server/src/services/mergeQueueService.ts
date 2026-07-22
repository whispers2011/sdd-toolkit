import { join } from 'node:path';
import type { Feature, Project } from '@sdd/shared';
import type { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo, QueueRepo, SettingsRepo } from '../db/repos.js';
import { MergeEngine } from '../git/mergeEngine.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import { git, isCleanWorkingTree } from '../git/git.js';
import { runVerification } from './verifyService.js';
import { resolveConflicts } from './conflictResolver.js';
import { bus } from '../events.js';

const MAX_RESOLUTION_ATTEMPTS = 3;

export interface MergeQueueDeps {
  projects: ProjectRepo;
  features: FeatureRepo;
  queue: QueueRepo;
  executions: ExecutionRepo;
  attention: AttentionRepo;
  settings: SettingsRepo;
  worktrees: WorktreeManager;
  ptys: PtySessionManager;
  dataDir: string;
}

/**
 * Merge-Queue (Alleinstellungsmerkmal): approvte Features werden pro Projekt
 * sequentiell integriert — rebase → Auto-Konfliktauflösung → Verifikation →
 * merge → Cleanup. Scheitert etwas, wird eskaliert statt blind gemergt.
 */
export class MergeQueueService {
  private engine = new MergeEngine();
  private working = new Set<string>(); // projectIds mit aktivem Worker

  constructor(private deps: MergeQueueDeps) {}

  /**
   * Integration eines Features beginnen: Worktree committen, verifizieren,
   * dann (autoMerge) einreihen oder auf menschliches Review warten.
   */
  async beginIntegration(featureId: string): Promise<void> {
    const feature = this.mustFeature(featureId);
    const project = this.mustProject(feature.projectId);
    if (!feature.worktreePath) throw new Error(`Feature ${feature.name} hat keinen Worktree`);

    this.setStage(feature, 'verifying');
    try {
      await this.commitWorktree(feature);

      if (project.verifyCommands.length > 0) {
        const execId = this.deps.executions.start({
          projectId: project.id,
          featureId,
          kind: 'verify',
          phase: null,
          logPath: null,
        });
        const outcome = await runVerification({
          commands: project.verifyCommands,
          cwd: feature.worktreePath,
          logDir: join(this.deps.dataDir, 'logs'),
          executionId: execId,
        });
        this.deps.executions.finish(execId, outcome.ok ? 0 : 1);
        if (!outcome.ok) {
          this.setStage(feature, 'verify_failed');
          this.escalate(feature, 'verify_failed', `Verifikation fehlgeschlagen: ${outcome.results.at(-1)?.name}`);
          return;
        }
      }

      const automation = this.automationFor(feature);
      if (automation.autoMerge) {
        this.enqueue(feature);
      } else {
        this.setStage(feature, 'awaiting_human_review');
        this.escalate(feature, 'review_due', `${feature.name}: verifiziert — bereit für dein Review & Merge`);
      }
    } catch (err) {
      this.setStage(feature, 'verify_failed');
      this.escalate(feature, 'verify_failed', `Integration fehlgeschlagen: ${String(err)}`);
    }
  }

  /** Nach menschlichem Review: in die Queue. */
  approveForMerge(featureId: string): void {
    const feature = this.mustFeature(featureId);
    this.deps.attention.resolveFor({ featureId, kinds: ['review_due'] });
    this.enqueue(feature);
  }

  retry(featureId: string): void {
    const feature = this.mustFeature(featureId);
    this.deps.attention.resolveFor({
      featureId,
      kinds: ['merge_conflict_escalated', 'verify_failed'],
    });
    void this.beginIntegration(featureId);
  }

  private enqueue(feature: Feature): void {
    const existing = this.deps.queue
      .listByProject(feature.projectId)
      .find((i) => i.featureId === feature.id);
    if (!existing) this.deps.queue.enqueue(feature.projectId, feature.id);
    this.setStage(feature, 'queued');
    this.emitQueue(feature.projectId);
    void this.processProject(feature.projectId);
  }

  /** Worker: arbeitet die Queue eines Projekts sequentiell ab. */
  private async processProject(projectId: string): Promise<void> {
    if (this.working.has(projectId)) return;
    this.working.add(projectId);
    try {
      for (;;) {
        const head = this.deps.queue.head(projectId);
        if (!head) break;
        const done = await this.processItem(head.id, head.featureId, projectId);
        if (!done) break; // eskaliert → Queue anhalten bis Mensch eingreift
      }
    } finally {
      this.working.delete(projectId);
      this.emitQueue(projectId);
    }
  }

  /** true = Item abgeschlossen (weiter mit nächstem); false = eskaliert. */
  private async processItem(queueId: string, featureId: string, projectId: string): Promise<boolean> {
    const feature = this.mustFeature(featureId);
    const project = this.mustProject(projectId);
    if (!feature.worktreePath) {
      this.deps.queue.remove(queueId);
      return true;
    }

    this.setStage(feature, 'merging');
    this.deps.queue.setStage(queueId, 'merging');
    this.emitQueue(projectId);

    // 1) Rebase auf den Default-Branch, Konflikte agentisch auflösen.
    let rebase = await this.engine.rebaseOntoDefault(feature.worktreePath, project.defaultBranch);
    let attempts = 0;
    while (!rebase.ok && rebase.kind === 'conflict' && attempts < MAX_RESOLUTION_ATTEMPTS) {
      attempts++;
      this.deps.queue.bumpAttempts(queueId);
      this.setStage(feature, 'conflict_resolving');
      this.emitQueue(projectId);

      const execId = this.deps.executions.start({
        projectId,
        featureId,
        kind: 'conflict_resolution',
        phase: null,
        logPath: null,
      });
      const res = await resolveConflicts({
        worktreePath: feature.worktreePath,
        featureName: feature.name,
        defaultBranch: project.defaultBranch,
        conflictFiles: rebase.files,
        logDir: join(this.deps.dataDir, 'logs'),
        executionId: execId,
      });
      this.deps.executions.finish(execId, res.exitCode);
      if (res.exitCode !== 0) break;

      rebase = await this.engine.continueRebase(feature.worktreePath);
    }

    if (!rebase.ok) {
      await this.engine.abortRebase(feature.worktreePath);
      this.setStage(feature, 'conflict_escalated');
      this.deps.queue.setStage(queueId, 'conflict_escalated', rebase.kind === 'error' ? rebase.message : null);
      this.escalate(
        feature,
        'merge_conflict_escalated',
        rebase.kind === 'conflict'
          ? `${feature.name}: Konflikte nicht automatisch auflösbar (${rebase.files.join(', ')})`
          : `${feature.name}: Rebase fehlgeschlagen — ${rebase.message}`,
      );
      return false;
    }

    // 2) Nach Konfliktauflösung IMMER erneut verifizieren — nie blind mergen.
    if (project.verifyCommands.length > 0 && attempts > 0) {
      const execId = this.deps.executions.start({
        projectId,
        featureId,
        kind: 'verify',
        phase: null,
        logPath: null,
      });
      const outcome = await runVerification({
        commands: project.verifyCommands,
        cwd: feature.worktreePath,
        logDir: join(this.deps.dataDir, 'logs'),
        executionId: execId,
      });
      this.deps.executions.finish(execId, outcome.ok ? 0 : 1);
      if (!outcome.ok) {
        this.setStage(feature, 'verify_failed');
        this.deps.queue.setStage(queueId, 'verify_failed');
        this.escalate(feature, 'verify_failed', `${feature.name}: Tests nach Konfliktauflösung rot — Eskalation`);
        return false;
      }
    }

    // 3) Merge im Haupt-Checkout.
    const merge = await this.engine.mergeFeature({
      projectPath: project.path,
      branch: feature.branch,
      defaultBranch: project.defaultBranch,
      mode: 'ff',
      message: `feat: ${feature.name}`,
    });
    if (!merge.ok) {
      this.setStage(feature, 'conflict_escalated');
      this.deps.queue.setStage(queueId, 'conflict_escalated', merge.message);
      this.escalate(feature, 'merge_conflict_escalated', `${feature.name}: Merge blockiert — ${merge.message}`);
      return false;
    }

    // 4) Cleanup: Session beenden, Worktree + Branch entfernen.
    const session = this.deps.ptys.forFeature(featureId);
    if (session) await this.deps.ptys.terminate(session.id);
    try {
      await this.deps.worktrees.remove(project.path, feature.worktreePath, { force: true });
    } catch {
      // Worktree-Reste sind nicht fatal — git worktree prune räumt später auf.
    }
    await this.engine.deleteBranch(project.path, feature.branch).catch(() => {});
    this.deps.features.setWorktree(featureId, null);
    this.deps.ptys.snapshots.remove(featureId);
    this.setStage(feature, 'merged');
    this.deps.queue.remove(queueId);
    this.emitQueue(projectId);
    bus.emitEvent('notification', {
      title: 'Feature gemergt',
      body: `${feature.name} → ${project.defaultBranch}`,
      featureId,
    });
    return true;
  }

  /** Uncommittete Implement-Änderungen im Worktree committen. */
  private async commitWorktree(feature: Feature): Promise<void> {
    if (!feature.worktreePath) return;
    if (await isCleanWorkingTree(feature.worktreePath)) return;
    await git(feature.worktreePath, ['add', '-A']);
    const r = await git(feature.worktreePath, ['commit', '-m', `feat(${feature.name}): implementation`]);
    if (r.code !== 0) throw new Error(`Commit im Worktree fehlgeschlagen: ${r.stderr}`);
  }

  private automationFor(feature: Feature) {
    const project = this.mustProject(feature.projectId);
    return {
      ...this.deps.settings.getAutomation(),
      ...project.automation,
      ...feature.automation,
    };
  }

  private setStage(feature: Feature, stage: Feature['integration']): void {
    this.deps.features.setIntegration(feature.id, stage);
    const fresh = this.deps.features.get(feature.id);
    if (fresh) bus.emitEvent('feature_updated', fresh);
  }

  private escalate(feature: Feature, kind: import('@sdd/shared').AttentionKind, message: string): void {
    const item = this.deps.attention.raise({
      kind,
      projectId: feature.projectId,
      featureId: feature.id,
      message,
    });
    bus.emitEvent('attention_raised', item);
    bus.emitEvent('notification', { title: 'Aufmerksamkeit nötig', body: message, featureId: feature.id });
  }

  private emitQueue(projectId: string): void {
    bus.emitEvent('queue_updated', { projectId, items: this.deps.queue.listByProject(projectId) });
  }

  private mustFeature(id: string): Feature {
    const f = this.deps.features.get(id);
    if (!f) throw new Error(`Feature ${id} nicht gefunden`);
    return f;
  }

  private mustProject(id: string): Project {
    const p = this.deps.projects.get(id);
    if (!p) throw new Error(`Projekt ${id} nicht gefunden`);
    return p;
  }
}
