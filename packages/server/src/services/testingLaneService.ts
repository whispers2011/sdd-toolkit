/**
 * Die Testing-Lane: alles, was ein Mensch zur manuellen Abnahme braucht, in
 * EINER Ansicht (FR-030, SC-009).
 *
 * Der Service stellt nur zusammen und liest — die Übergänge der Stufe liegen im
 * MergeQueueService, weil dort die Integrations-Pipeline sitzt. Es entsteht kein
 * zweiter Weg aus `awaiting_manual_test` heraus.
 */
import type {
  Feature,
  ManualTestRejection,
  Project,
  TestingLaneEntry,
  TestingLaneView,
} from '@sdd/shared';
import type { FeatureRepo, ProjectRepo } from '../db/repos.js';
import type { StackRepo } from '../db/stackRepo.js';
import type { StackService } from './stackService.js';
import type { MergeQueueService } from './mergeQueueService.js';

export interface TestingLaneDeps {
  projects: ProjectRepo;
  features: FeatureRepo;
  stacks: StackRepo;
  stackService: StackService;
  mergeQueue: MergeQueueService;
}

export class TestingLaneService {
  constructor(private deps: TestingLaneDeps) {}

  /**
   * Einträge eines Projekts. Zwei Abschnitte:
   *
   * - `awaitingManualTest` — die eigentliche Warteschlange der Abnahme.
   * - `running` — Features mit betriebenem Stack, die NICHT auf der Stufe stehen.
   *   Sie stehen dort, damit sichtbar bleibt, was Ports und Dienste belegt; ohne
   *   sie wäre die Kostenlage wieder unsichtbar, die dieses Feature beheben soll.
   */
  async list(projectId: string, opts: { refresh?: boolean } = {}): Promise<TestingLaneView> {
    const project = this.deps.projects.get(projectId);
    if (!project) throw new Error(`Projekt ${projectId} nicht gefunden`);

    const awaitingManualTest: TestingLaneEntry[] = [];
    const running: TestingLaneEntry[] = [];

    for (const feature of this.deps.features.listByProject(projectId)) {
      const onStage = feature.integration === 'awaiting_manual_test';
      const hasStack = this.deps.stacks.getIntent(feature.id) !== null;
      if (!onStage && !hasStack) continue;
      const entry = await this.entry(feature, project, opts);
      (onStage ? awaitingManualTest : running).push(entry);
    }

    return { awaitingManualTest, running, collectedAt: Date.now() };
  }

  /** Ein einzelner Eintrag — dieselbe Zusammenstellung wie in der Lane. */
  async entry(feature: Feature, project: Project, opts: { refresh?: boolean } = {}): Promise<TestingLaneEntry> {
    return {
      featureId: feature.id,
      featureName: feature.name,
      branch: feature.branch,
      worktreePath: feature.worktreePath,
      createdAt: feature.createdAt,
      stage: feature.integration,
      // IMMER frisch erhoben — auch nach einem Serverneustart wird nichts
      // behauptet, was nicht stimmt (FR-023).
      stack: await this.deps.stackService.probe(feature, project, opts),
      // Eine frühere Ablehnung bleibt am Eintrag sichtbar (FR-029).
      lastDecision: this.deps.stacks.lastDecision(feature.id),
      round: this.deps.stacks.currentRound(feature.id),
      // Was in einer früheren Runde nicht abgehakt wurde, steht noch aus — ein
      // offener Blocker sperrt die Annahme.
      openFindings: this.deps.stacks.openFindingsFor(feature.id),
    };
  }

  /** Anzahl der Features auf der Stufe — Zähler am Sidebar-Eintrag. */
  countAwaiting(projectId: string): number {
    return this.deps.features
      .listByProject(projectId)
      .filter((f) => f.integration === 'awaiting_manual_test').length;
  }

  /**
   * Bestätigen bzw. Ablehnen laufen über den MergeQueueService — dort sitzt die
   * Pipeline. Die Lane ruft nur durch, damit es nicht zwei Wege aus der Stufe gibt
   * (FR-028/FR-029).
   */
  async confirm(featureId: string): Promise<void> {
    await this.deps.mergeQueue.confirmManualTest(featureId);
  }

  async reject(featureId: string, input: ManualTestRejection): Promise<void> {
    await this.deps.mergeQueue.rejectManualTest(featureId, input);
  }
}
