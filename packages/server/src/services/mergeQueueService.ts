import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { ACTION_REASON, alreadyIntegratingReason, isValidBranchName } from '@sdd/shared';
import type { ApproveMergeRequest, Feature, IntegrationStage, Project } from '@sdd/shared';
import type { AttentionRepo, ExecutionRepo, FeatureRepo, ProjectRepo, QueueRepo, SettingsRepo } from '../db/repos.js';
import { MergeEngine } from '../git/mergeEngine.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { PtySessionManager } from '../pty/sessionManager.js';
import { git, isBranchMergedInto, isCleanWorkingTree, run, uncommittedFileCount } from '../git/git.js';
import { runVerification } from './verifyService.js';
import { hasUnmergedChanges } from './unmergedChanges.js';
import { resolveConflicts } from './conflictResolver.js';
import type { AgentGateService } from './agentGateService.js';
import { STAGE_FOR_KIND } from './attentionReconciler.js';
import { bus } from '../events.js';

const MAX_RESOLUTION_ATTEMPTS = 3;

/** Validierungsfehler der Review-Freigabe (API antwortet 400/409 statt 500). */
export class MergeApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeApprovalError';
  }
}

export interface MergeQueueDeps {
  projects: ProjectRepo;
  features: FeatureRepo;
  queue: QueueRepo;
  executions: ExecutionRepo;
  attention: AttentionRepo;
  settings: SettingsRepo;
  worktrees: WorktreeManager;
  ptys: PtySessionManager;
  agentGate: AgentGateService;
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
      // Selbstheilung beim Boot: als „hängend" markierte Features gegen die
      // Git-Realität abgleichen. Ein Feature, dessen Branch bereits im Default-
      // Branch liegt (z. B. Worktree nach Merge entfernt und die Eskalation nie
      // abgeglichen), wird hier automatisch auf 'merged' zurückgeführt statt
      // dauerhaft in verify_failed/conflict_escalated zu verharren.
      for (const feature of this.deps.features.listByProject(project.id)) {
        if (feature.integration === 'none' || feature.integration === 'merged') continue;
        await this.reconcile(feature, project).catch(() => {});
      }

      const items = this.deps.queue.listByProject(project.id);
      let hasWork = false;
      for (const item of items) {
        if (!resumable.includes(item.stage)) continue;
        hasWork = true;
        const feature = this.deps.features.get(item.featureId);
        if (item.stage !== 'queued') {
          // Halb erledigten Rebase abräumen, damit rebaseOnto sauber neu startet.
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
    const target = feature.integrationTarget ?? project.defaultBranch;
    const branchExists = await this.engine.branchExists(project.path, feature.branch);
    if (opts.safeOnly && branchExists) {
      // Gegen das TATSÄCHLICHE Ziel prüfen — ein in 'integration/x' gemergtes
      // Feature liegt bewusst nicht in main. Extern gelöschtes Ziel ⇒ nicht
      // nachweisbar gemergt ⇒ überspringen mit Warnung (kein Datenverlust).
      const merged = await this.engine.isBranchMerged(project.path, feature.branch, target);
      if (!merged) {
        console.warn(
          `[merge-queue] ${feature.name}: als 'merged' markiert, aber Branch nicht in ${target} — Cleanup übersprungen`,
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
   * Feature-Hard-Delete (fälschlich angelegtes Feature spurlos entfernen): beendet die
   * Session, räumt Worktree + Branch bedingungslos ab, löscht die Lauf-Logs auf der Platte,
   * den Scrollback-Snapshot und ALLE DB-Spuren (features + executions/agent_runs/attention/
   * sessions/merge_queue/review_comments/agent_feature_selection). Danach ist nichts mehr da.
   */
  async deleteFeature(featureId: string): Promise<void> {
    const feature = this.deps.features.get(featureId);
    if (!feature) return;
    const project = this.deps.projects.get(feature.projectId);

    const session = this.deps.ptys.forFeature(featureId);
    if (session) await this.deps.ptys.terminate(session.id);

    if (project) {
      if (feature.worktreePath) {
        try {
          await this.deps.worktrees.remove(project.path, feature.worktreePath, { force: true });
        } catch {
          await git(project.path, ['worktree', 'prune']).catch(() => {});
        }
      }
      if (await this.engine.branchExists(project.path, feature.branch)) {
        await this.engine.deleteBranch(project.path, feature.branch).catch(() => {});
      }
    }

    const { executionIds } = this.deps.features.hardDelete(featureId);
    for (const exId of executionIds) {
      rmSync(join(this.deps.dataDir, 'logs', `${exId}.log`), { force: true });
      rmSync(join(this.deps.dataDir, 'logs', exId), { recursive: true, force: true });
    }
    this.deps.ptys.snapshots.remove(featureId);

    bus.emitEvent('feature_deleted', { featureId, projectId: feature.projectId });
  }

  /**
   * Integration eines Features beginnen: Worktree committen, verifizieren,
   * dann (autoMerge) einreihen oder auf menschliches Review warten.
   */
  /**
   * Integrations-Pipeline starten. Die drei Vorprüfungen laufen VOR jeder
   * Zustandsänderung, vor `reconcile()` und vor `commitWorktree()` (FR-004):
   * eine Ablehnung lässt Feature-Zustand UND Arbeitsverzeichnis unverändert —
   * insbesondere wird keine Arbeit festgeschrieben.
   *
   * Die Prüfung sitzt hier und nicht (nur) in der Route, damit auch der
   * automatische Pfad (`PhaseEffect start_integration` bei autoVerify) ihr
   * unterliegt. Zugleich schließt Prüfung 3 die Falle, dass ein änderungsfreier
   * Branch in `reconcile()` als „bereits gemergt" gilt und über
   * `finalizeMerged()` auf 'merged' rutscht — ein zweiter Weg in den
   * Endzustand, den SC-003 ausschließt.
   */
  async beginIntegration(featureId: string): Promise<{ started: boolean; reason?: string }> {
    const feature = this.mustFeature(featureId);
    const project = this.mustProject(feature.projectId);

    if (feature.integration !== 'none') {
      return { started: false, reason: alreadyIntegratingReason(feature.integration) };
    }
    if (!feature.worktreePath) {
      return { started: false, reason: ACTION_REASON.noWorktree };
    }
    if (!(await this.hasIntegrableChanges(feature, project))) {
      return { started: false, reason: ACTION_REASON.noChanges };
    }

    // Selbstheilung: Zustand mit der Git-Realität abgleichen, bevor blind git im
    // (evtl. entfernten/kaputten) Worktree ausgeführt wird.
    if ((await this.reconcile(feature, project)) !== 'proceed') return { started: false };

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
          return { started: true };
        }
      }

      const automation = this.automationFor(feature);

      // Review-Gate (WP4 → Agents): review_gate-Agents sequentiell; erster
      // blockierender FAIL eskaliert, beratende FAILs werden nur verbucht.
      if (automation.autoReviewAgents) {
        this.setStage(feature, 'review_gate');
        const gate = await this.deps.agentGate.runTrigger(this.mustFeature(featureId), project, {
          kind: 'review_gate',
        });
        // Review-Berichte gehören versioniert zum Feature.
        await this.commitWorktree(this.mustFeature(featureId), `docs(${feature.name}): review-berichte`);
        if (!gate.ok) {
          this.setStage(feature, 'gate_failed');
          this.escalate(feature, 'gate_failed', `${feature.name}: Review-Gate FAIL — ${gate.failedAgent}`);
          return { started: true };
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
    return { started: true };
  }

  /**
   * Vorprüfung nach FR-027. Ein nicht lesbarer Worktree gilt bewusst NICHT als
   * „nichts zu tun": `reconcile()` erkennt und meldet ihn danach mit klarer
   * Eskalation, statt den Start hier stumm zu verschlucken.
   */
  private async hasIntegrableChanges(feature: Feature, project: Project): Promise<boolean> {
    if (!feature.worktreePath) return false;
    try {
      return await hasUnmergedChanges(feature.worktreePath, feature.integrationTarget ?? project.defaultBranch);
    } catch {
      return true;
    }
  }

  /**
   * Nach menschlichem Review: Zielwahl validieren + persistieren, Reviewer-Edits
   * committen (⇒ erzwungene Re-Verifikation), dann in die Queue.
   */
  async approveForMerge(featureId: string, request: ApproveMergeRequest = {}): Promise<void> {
    const feature = this.mustFeature(featureId);
    const project = this.mustProject(feature.projectId);
    if (feature.integration !== 'awaiting_human_review') {
      throw new MergeApprovalError(`Feature ist nicht prüfbereit (Stage: ${feature.integration})`);
    }

    const requested = request.targetBranch?.trim();
    if (requested && requested !== project.defaultBranch) {
      if (!isValidBranchName(requested)) {
        throw new MergeApprovalError(`Ungültiger Branch-Name: '${requested}'`);
      }
      if (requested === feature.branch) {
        throw new MergeApprovalError('Ziel darf nicht der Feature-Branch selbst sein');
      }
      const exists = await this.engine.branchExists(project.path, requested);
      if (request.createBranch && exists) {
        throw new MergeApprovalError(`Branch '${requested}' existiert bereits`);
      }
      if (!request.createBranch && !exists) {
        throw new MergeApprovalError(`Branch '${requested}' existiert nicht`);
      }
      this.deps.features.setIntegrationTarget(feature.id, requested);
    } else {
      // Default-Ziel wird als NULL normalisiert (heutiges Verhalten).
      this.deps.features.setIntegrationTarget(feature.id, null);
    }

    // Reviewer-Korrekturen aus dem Portal gehören als gekennzeichneter Commit ins
    // Feature — und erzwingen eine Re-Verifikation vor dem Merge (ungeprüfter Code).
    let forceVerify = false;
    if (feature.worktreePath && !(await isCleanWorkingTree(feature.worktreePath))) {
      await this.commitWorktree(feature, `review(${feature.name}): reviewer-korrekturen`);
      forceVerify = true;
    }

    this.deps.attention.resolveFor({ featureId, kinds: ['review_due'] });
    this.enqueue(this.mustFeature(featureId), { forceVerify });
  }

  /**
   * Wiederaufnahme nach einer fehlgeschlagenen Integration (FR-015): die
   * Pipeline beginnt von vorn. Die Fehlerstufe wird dafür zurückgesetzt, damit
   * `beginIntegration()` denselben Vorprüfungen unterliegt wie ein Erststart —
   * es gibt keinen zweiten, ungeprüften Einstieg in die Integration.
   */
  retry(featureId: string): void {
    const feature = this.mustFeature(featureId);
    this.deps.attention.resolveFor({
      featureId,
      kinds: ['merge_conflict_escalated', 'verify_failed', 'gate_failed'],
    });
    this.setStage(feature, 'none');
    void this.beginIntegration(featureId).then((r) => {
      if (!r.started && r.reason) {
        console.warn(`[merge-queue] ${feature.name}: Wiederaufnahme abgelehnt — ${r.reason}`);
      }
    });
  }

  private enqueue(feature: Feature, opts: { forceVerify?: boolean } = {}): void {
    const existing = this.deps.queue
      .listByProject(feature.projectId)
      .find((i) => i.featureId === feature.id);
    if (!existing) this.deps.queue.enqueue(feature.projectId, feature.id, opts);
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
          const done = await this.processItem(head.id, head.featureId, projectId, head.forceVerify);
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
  private async processItem(
    queueId: string,
    featureId: string,
    projectId: string,
    forceVerify = false,
  ): Promise<boolean> {
    const feature = this.mustFeature(featureId);
    const project = this.mustProject(projectId);
    const target = feature.integrationTarget ?? project.defaultBranch;

    // Selbstheilung vor dem Merge: bereits gemergt → finalisieren (weiter);
    // Worktree unwiederbringlich weg und NICHT gemergt → sauber eskalieren (anhalten).
    const rec = await this.reconcile(feature, project);
    if (rec === 'merged') return true;
    if (rec === 'lost') {
      this.deps.queue.setStage(queueId, 'conflict_escalated', 'Worktree fehlt und Branch ist nicht gemergt');
      return false;
    }
    if (!feature.worktreePath) {
      this.deps.queue.remove(queueId);
      return true;
    }

    this.setStage(feature, 'merging');
    this.deps.queue.setStage(queueId, 'merging');
    this.emitQueue(projectId);

    // 1) Rebase auf das Ziel (neuer Ziel-Branch existiert noch nicht → identische
    //    Basis ist der Default-Branch), Konflikte agentisch auflösen.
    const rebaseBase = (await this.engine.branchExists(project.path, target))
      ? target
      : project.defaultBranch;
    let rebase = await this.engine.rebaseOnto(feature.worktreePath, rebaseBase);
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
      this.deps.executions.finish(execId, res.exitCode, res.tokens);
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

    // 2) Nach Konfliktauflösung oder Reviewer-Edits IMMER erneut verifizieren —
    //    nie blind mergen.
    if (project.verifyCommands.length > 0 && (attempts > 0 || forceVerify)) {
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
      return this.createPullRequest(queueId, feature, project, target);
    }

    // 3b) Merge ins Ziel: idempotent sicherstellen („Ziel-Branch sicherstellen,
    //     dann mergen" — resume-sicher), Haupt-Checkout wird nie umgeschaltet.
    await this.engine.ensureBranch(project.path, target, project.defaultBranch);
    const merge = await this.engine.mergeIntoTarget({
      projectPath: project.path,
      branch: feature.branch,
      target,
      mode: project.mergeMode,
      message: `feat: ${feature.name}`,
      tmpWorktreeDir: join(this.deps.dataDir, 'merge-tmp'),
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
      body: `${feature.name} → ${target}`,
      featureId,
      kind: 'merged',
    });
    return true;
  }

  /**
   * PR-Modus (WP13): Branch pushen (force-with-lease — der Rebase hat die
   * Historie umgeschrieben) und PR via gh erstellen. Worktree bleibt bis zum
   * PR-Merge bestehen. Ein lokal neu angelegter Ziel-Branch wird zuerst
   * veröffentlicht, damit er als PR-Basis existiert.
   */
  private async createPullRequest(
    queueId: string,
    feature: Feature,
    project: Project,
    target: string,
  ): Promise<boolean> {
    const wt = feature.worktreePath!;
    if (target !== project.defaultBranch) {
      await this.engine.ensureBranch(project.path, target, project.defaultBranch);
      const pushTarget = await git(project.path, ['push', '-u', 'origin', target]);
      if (pushTarget.code !== 0) {
        this.setStage(feature, 'conflict_escalated');
        this.deps.queue.setStage(queueId, 'conflict_escalated', pushTarget.stderr.trim());
        this.escalate(
          feature,
          'merge_conflict_escalated',
          `${feature.name}: Ziel-Branch '${target}' konnte nicht gepusht werden — ${pushTarget.stderr.trim()}`,
        );
        return false;
      }
    }
    const push = await git(wt, ['push', '--force-with-lease', '-u', 'origin', feature.branch]);
    if (push.code !== 0) {
      this.setStage(feature, 'conflict_escalated');
      this.deps.queue.setStage(queueId, 'conflict_escalated', push.stderr.trim());
      this.escalate(feature, 'merge_conflict_escalated', `${feature.name}: Push fehlgeschlagen — ${push.stderr.trim()}`);
      return false;
    }
    const pr = await run(wt, 'gh', ['pr', 'create', '--fill', '--base', target, '--head', feature.branch]);
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

  /**
   * Gleicht den gespeicherten Integrationszustand mit der Git-Realität ab, bevor
   * blind im Worktree gearbeitet wird. Verhindert das Muster „Worktree entfernt →
   * git schlägt fehl (‚not a git repository') → Dauer-Eskalation":
   *  - Branch bereits im Default-Branch → als 'merged' finalisieren (Self-Healing).
   *  - Worktree-Verknüpfung kaputt aber reparierbar → reparieren, weitermachen.
   *  - Worktree unwiederbringlich weg UND nicht gemergt → einmalig klar eskalieren.
   * Läuft immer im Haupt-Checkout (`project.path`), nie im evtl. defekten Worktree.
   */
  private async reconcile(feature: Feature, project: Project): Promise<'proceed' | 'merged' | 'lost'> {
    const target = feature.integrationTarget ?? project.defaultBranch;
    if (await isBranchMergedInto(project.path, feature.branch, target)) {
      // FALLSTRICK: Ein Branch OHNE eigene Commits ist trivial Vorfahre des Ziels und
      // gilt damit als „gemergt" — nicht unterscheidbar von einem echten ff-Merge.
      // finalizeMerged() würde den Worktree mit --force entfernen und uncommittete
      // Arbeit unwiederbringlich löschen (genau so ist eine fertige Implementierung
      // verloren gegangen). Vorher prüfen, ob dort etwas zu verlieren ist.
      const pending = feature.worktreePath ? await uncommittedFileCount(feature.worktreePath) : 0;
      if (pending > 0) {
        this.setStage(feature, 'conflict_escalated');
        this.escalate(
          feature,
          'merge_conflict_escalated',
          `${feature.name}: Branch gilt als in ${target} enthalten, aber der Worktree hat ${pending} ` +
            `uncommittete Datei(en). Aufräumen würde sie löschen — erst committen oder verwerfen, dann erneut integrieren.`,
        );
        return 'lost';
      }
      await this.finalizeMerged(feature, project);
      return 'merged';
    }
    if (feature.worktreePath) {
      const health = await this.deps.worktrees.ensureValid(project.path, feature.worktreePath);
      if (health === 'missing') {
        this.setStage(feature, 'conflict_escalated');
        this.escalate(
          feature,
          'merge_conflict_escalated',
          `${feature.name}: Worktree fehlt und der Branch ist noch nicht in ${feature.integrationTarget ?? project.defaultBranch}. ` +
            `Worktree neu erstellen und Integration erneut starten.`,
        );
        return 'lost';
      }
    }
    return 'proceed';
  }

  /** Bereits gemergtes Feature idempotent & best-effort abschließen (Cleanup + Zustände). */
  private async finalizeMerged(feature: Feature, project: Project): Promise<void> {
    const session = this.deps.ptys.forFeature(feature.id);
    if (session) await this.deps.ptys.terminate(session.id).catch(() => {});
    if (feature.worktreePath) {
      await this.deps.worktrees.remove(project.path, feature.worktreePath, { force: true }).catch(() => {});
    }
    await this.engine.deleteBranch(project.path, feature.branch).catch(() => {});
    this.deps.features.setWorktree(feature.id, null);
    this.deps.ptys.snapshots.remove(feature.id);
    const item = this.deps.queue.listByProject(feature.projectId).find((i) => i.featureId === feature.id);
    if (item) this.deps.queue.remove(item.id);
    this.deps.attention.resolveFor({
      featureId: feature.id,
      kinds: ['merge_conflict_escalated', 'verify_failed', 'gate_failed', 'review_due'],
    });
    this.setStage(feature, 'merged');
    this.emitQueue(feature.projectId);
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
    // Zustandsgekoppelte Bereinigung (US1): Merge-Fluss-Meldungen dieses Features auflösen, die
    // nicht (mehr) zur neuen Stage passen — so verschwinden review_due/verify_failed/gate_failed/
    // merge_conflict_escalated auch dann, wenn die Stage anders weiterwandert (nicht nur per Button).
    for (const it of this.deps.attention.listOpen()) {
      if (it.featureId !== feature.id) continue;
      const wanted = STAGE_FOR_KIND[it.kind];
      if (wanted !== undefined && wanted !== stage) {
        this.deps.attention.resolve(it.id);
        bus.emitEvent('attention_resolved', it.id);
      }
    }
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
