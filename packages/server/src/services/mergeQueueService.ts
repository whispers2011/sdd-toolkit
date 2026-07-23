import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import type { Feature, IntegrationStage, Project } from '@sdd/shared';
import type { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo, QueueRepo, SettingsRepo } from '../db/repos.js';
import { MergeEngine } from '../git/mergeEngine.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import { git, isCleanWorkingTree, run } from '../git/git.js';
import { runVerification } from './verifyService.js';
import { resolveConflicts } from './conflictResolver.js';
import type { ReviewGateService } from './reviewGateService.js';
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
  reviewGate: ReviewGateService;
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
   * Nach Server-Neustart: unterbrochene Queue-Items wieder aufnehmen. Ein Worker,
   * der mitten in `merging`/`conflict_resolving` stirbt (Server-Neustart, Crash),
   * würde das Item sonst für immer in dieser Stufe hängen lassen — es gibt keinen
   * anderen Auslöser als `enqueue()`. Eskalierte Items (Mensch muss ran) bleiben
   * unangetastet.
   */
  async resumeInterruptedOnBoot(): Promise<void> {
    const resumable: IntegrationStage[] = ['queued', 'merging', 'conflict_resolving'];
    for (const project of this.deps.projects.list()) {
      const items = this.deps.queue.listByProject(project.id);
      let hasWork = false;
      for (const item of items) {
        if (!resumable.includes(item.stage)) continue;
        hasWork = true;
        const feature = this.deps.features.get(item.featureId);
        if (item.stage !== 'queued') {
          // Halb erledigten Rebase abräumen, damit rebaseOntoDefault sauber neu startet.
          if (feature?.worktreePath && existsSync(feature.worktreePath)) {
            await this.engine.abortRebase(feature.worktreePath).catch(() => {});
          }
          this.deps.queue.setStage(item.id, 'queued');
          if (feature) this.setStage(feature, 'queued');
        }
      }
      if (hasWork) {
        this.emitQueue(project.id);
        void this.processProject(project.id);
      }
    }
  }

  /**
   * Boot: Features, die als 'merged' markiert sind, aber noch Worktree/Branch/DB-Reste
   * tragen, sauber abräumen. Behebt „Restanzen, die in der DB stehen und nicht
   * aktualisiert werden" — Cleanup nach Merge kann früher unvollständig geblieben sein
   * (Crash/Neustart, Fehler beim Branch-Löschen, ältere Version).
   */
  async reconcileMergedLeftovers(): Promise<void> {
    let cleaned = 0;
    for (const project of this.deps.projects.list()) {
      for (const feature of this.deps.features.listByProject(project.id, true)) {
        if (feature.integration !== 'merged') continue;
        const branchThere = await this.engine.branchExists(project.path, feature.branch);
        if (!feature.worktreePath && !branchThere) continue; // bereits sauber
        if (await this.cleanupMerged(feature, project, { safeOnly: true })) cleaned++;
      }
    }
    if (cleaned > 0) console.log(`[merge-queue] ${cleaned} gemergte Feature-Restanz(en) bereinigt`);
  }

  /**
   * Worktree + Branch eines integrierten Features restlos entfernen und die DB
   * angleichen. Robust: Worktree-Rest → prune.
   *
   * `safeOnly` (Reconcile-Pfad): fasst ein Feature nur an, wenn sein Branch
   * nachweislich in den Default-Branch integriert ist oder gar nicht mehr existiert.
   * Ein als 'merged' markiertes Feature, dessen Branch NICHT in main liegt, bleibt
   * unangetastet (könnte ungemergte Arbeit sein) — kein Force, kein Datenverlust.
   * Ohne `safeOnly` (direkt nach erfolgreichem Merge) wird bedingungslos aufgeräumt —
   * korrekt auch für Squash-Merges, deren Branch-Tip kein main-Vorfahre ist.
   *
   * @returns true, wenn aufgeräumt wurde.
   */
  private async cleanupMerged(feature: Feature, project: Project, opts: { safeOnly?: boolean } = {}): Promise<boolean> {
    const branchExists = await this.engine.branchExists(project.path, feature.branch);
    if (opts.safeOnly && branchExists) {
      const merged = await this.engine.isBranchMerged(project.path, feature.branch, project.defaultBranch);
      if (!merged) {
        console.warn(
          `[merge-queue] ${feature.name}: als 'merged' markiert, aber Branch nicht in ${project.defaultBranch} — Cleanup übersprungen`,
        );
        return false;
      }
    }

    const session = this.deps.ptys.forFeature(feature.id);
    if (session) await this.deps.ptys.terminate(session.id);

    if (feature.worktreePath) {
      try {
        await this.deps.worktrees.remove(project.path, feature.worktreePath, { force: true });
      } catch {
        await git(project.path, ['worktree', 'prune']).catch(() => {});
      }
    }
    if (branchExists) await this.engine.deleteBranch(project.path, feature.branch).catch(() => {});

    this.deps.features.setWorktree(feature.id, null);
    this.deps.ptys.snapshots.remove(feature.id);
    const fresh = this.deps.features.get(feature.id);
    if (fresh) bus.emitEvent('feature_updated', fresh);
    return true;
  }

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

      // Review-Gate (WP4): Personas sequentiell, erster FAIL eskaliert.
      if (automation.autoReviewAgents) {
        this.setStage(feature, 'review_gate');
        const gate = await this.deps.reviewGate.run(this.mustFeature(featureId), project);
        // Review-Berichte gehören versioniert zum Feature.
        await this.commitWorktree(this.mustFeature(featureId), `docs(${feature.name}): review-berichte`);
        if (!gate.ok) {
          this.setStage(feature, 'gate_failed');
          this.escalate(feature, 'gate_failed', `${feature.name}: Review-Gate FAIL — ${gate.failedPersona}`);
          return;
        }
      }

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
      kinds: ['merge_conflict_escalated', 'verify_failed', 'gate_failed'],
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
        try {
          const done = await this.processItem(head.id, head.featureId, projectId);
          if (!done) break; // eskaliert → Queue anhalten bis Mensch eingreift
        } catch (err) {
          // Unerwarteter Fehler (z. B. Worktree ist kein Git-Repo mehr, weil er
          // bereits aufgeräumt wurde) darf NIE den Server abschießen — der Worker
          // läuft als fire-and-forget-Promise, ein ungefangener Reject beendet
          // den Prozess. Vertrag der Queue: eskalieren statt crashen.
          const feature = this.deps.features.get(head.featureId);
          if (!feature) {
            this.deps.queue.remove(head.id); // toter Eintrag → verwerfen, weiter
            continue;
          }
          this.setStage(feature, 'conflict_escalated');
          this.deps.queue.setStage(head.id, 'conflict_escalated', String(err));
          this.escalate(
            feature,
            'merge_conflict_escalated',
            `${feature.name}: Integration abgebrochen (unerwarteter Fehler) — ${String(err)}`,
          );
          break; // Queue anhalten bis Mensch eingreift
        }
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
      // Konflikt-Transparenz (WP5): Zustand vor/nach der Auto-Auflösung festhalten.
      await this.captureDiff(feature.worktreePath, execId, 'pre');
      const res = await resolveConflicts({
        worktreePath: feature.worktreePath,
        featureName: feature.name,
        defaultBranch: project.defaultBranch,
        conflictFiles: rebase.files,
        logDir: join(this.deps.dataDir, 'logs'),
        executionId: execId,
      });
      await this.captureDiff(feature.worktreePath, execId, 'post');
      this.deps.executions.finish(execId, res.exitCode, res.costUsd, res.tokens);
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

    // 3a) PR-Modus (WP13): push + gh pr create statt lokalem Merge.
    if (project.integrationMode === 'pr') {
      return this.createPullRequest(queueId, feature, project);
    }

    // 3b) Merge im Haupt-Checkout.
    const merge = await this.engine.mergeFeature({
      projectPath: project.path,
      branch: feature.branch,
      defaultBranch: project.defaultBranch,
      mode: project.mergeMode,
      message: `feat: ${feature.name}`,
    });
    if (!merge.ok) {
      this.setStage(feature, 'conflict_escalated');
      this.deps.queue.setStage(queueId, 'conflict_escalated', merge.message);
      this.escalate(feature, 'merge_conflict_escalated', `${feature.name}: Merge blockiert — ${merge.message}`);
      return false;
    }

    // 4) Cleanup: Session beenden, Worktree + Branch entfernen, DB angleichen.
    await this.cleanupMerged(feature, project);
    this.setStage(feature, 'merged');
    this.deps.queue.remove(queueId);
    this.emitQueue(projectId);
    bus.emitEvent('notification', {
      title: 'Feature gemergt',
      body: `${feature.name} → ${project.defaultBranch}`,
      featureId,
      kind: 'merged',
    });
    return true;
  }

  /**
   * PR-Modus (WP13): Branch pushen (force-with-lease — der Rebase hat die
   * Historie umgeschrieben) und PR via gh erstellen. Worktree bleibt bis zum
   * PR-Merge bestehen.
   */
  private async createPullRequest(queueId: string, feature: Feature, project: Project): Promise<boolean> {
    const wt = feature.worktreePath!;
    const push = await git(wt, ['push', '--force-with-lease', '-u', 'origin', feature.branch]);
    if (push.code !== 0) {
      this.setStage(feature, 'conflict_escalated');
      this.deps.queue.setStage(queueId, 'conflict_escalated', push.stderr.trim());
      this.escalate(feature, 'merge_conflict_escalated', `${feature.name}: Push fehlgeschlagen — ${push.stderr.trim()}`);
      return false;
    }
    const pr = await run(wt, 'gh', ['pr', 'create', '--fill', '--base', project.defaultBranch, '--head', feature.branch]);
    const alreadyExists = pr.code !== 0 && /already exists/i.test(pr.stderr + pr.stdout);
    if (pr.code !== 0 && !alreadyExists) {
      this.setStage(feature, 'conflict_escalated');
      this.deps.queue.setStage(queueId, 'conflict_escalated', pr.stderr.trim());
      this.escalate(feature, 'merge_conflict_escalated', `${feature.name}: PR-Erstellung fehlgeschlagen — ${pr.stderr.trim()}`);
      return false;
    }
    this.setStage(feature, 'merged'); // UI zeigt im PR-Modus „PR erstellt"
    this.deps.queue.remove(queueId);
    this.emitQueue(project.id);
    bus.emitEvent('notification', {
      title: 'PR erstellt',
      body: `${feature.name}: ${pr.stdout.trim().split('\n').at(-1) ?? feature.branch}`,
      featureId: feature.id,
      kind: 'merged',
    });
    return true;
  }

  /** Diff-Schnappschuss (Konfliktzustand bzw. Auflösung) neben dem Lauf-Log ablegen. */
  private async captureDiff(worktreePath: string, execId: string, phase: 'pre' | 'post'): Promise<void> {
    const r = await git(worktreePath, ['diff']);
    await writeFile(join(this.deps.dataDir, 'logs', `${execId}.${phase}.diff`), r.stdout).catch(() => {});
  }

  /** Uncommittete Änderungen im Worktree committen. */
  private async commitWorktree(feature: Feature, message?: string): Promise<void> {
    if (!feature.worktreePath) return;
    if (await isCleanWorkingTree(feature.worktreePath)) return;
    await git(feature.worktreePath, ['add', '-A']);
    const r = await git(feature.worktreePath, [
      'commit',
      '-m',
      message ?? `feat(${feature.name}): implementation`,
    ]);
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
    bus.emitEvent('notification', { title: 'Aufmerksamkeit nötig', body: message, featureId: feature.id, kind: 'escalation' });
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
