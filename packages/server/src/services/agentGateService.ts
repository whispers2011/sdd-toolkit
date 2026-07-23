import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractSummary,
  hasExplicitVerdict,
  meter,
  parseApprovalItems,
  parseDecisionLabel,
  parseVerdict,
  resolveAgentsForTrigger,
} from '@sdd/shared';
import type { AgentDefinition, AgentRunSummary, AgentTrigger, Feature, Project } from '@sdd/shared';
import type { AttentionRepo, ExecutionRepo } from '../db/repos.js';
import type { AgentRepo, AgentRunRepo } from '../db/agentRepo.js';
import { buildHeadlessArgv } from '../pty/commandBuilder.js';
import { loginShellEnv } from '../pty/loginShellEnv.js';
import { isGitRepo } from '../git/git.js';
import { bus } from '../events.js';

export interface GateOutcome {
  ok: boolean;
  /** Name des Agents, an dem das Gate gescheitert ist (erster blockierender FAIL). */
  failedAgent: string | null;
  runs: AgentRunSummary[];
}

/** Headless-Runner injizierbar für Tests (argv → Exit-Code). */
export type HeadlessRunner = (argv: string[], cwd: string, logPath: string) => Promise<number>;

export interface AgentGateDeps {
  agents: AgentRepo;
  agentRuns: AgentRunRepo;
  executions: ExecutionRepo;
  attention: AttentionRepo;
  dataDir: string;
  runner?: HeadlessRunner;
}

/**
 * Agent-Gate (Generalisierung des Review-Gates, WP4 → Agents): konfigurierte
 * Agents laufen sequentiell als Headless-Claude im Worktree. Blockierende
 * Agents stoppen das Gate beim ersten FAIL; beratende werden nur verbucht.
 * Berichte landen versioniert im Repo (`specs/<feature>/reviews/<agent-id>.md`),
 * strukturierte Ergebnisse in `agent_runs`.
 */
export class AgentGateService {
  private runner: HeadlessRunner;

  constructor(private deps: AgentGateDeps) {
    this.runner = deps.runner ?? defaultRunner;
  }

  /** Fast-Path: gibt es für diesen Trigger überhaupt laufende Agents? */
  hasAgentsFor(projectId: string, featureId: string, trigger: AgentTrigger): boolean {
    return this.resolve(projectId, featureId, trigger).length > 0;
  }

  /**
   * Alle für den Trigger geltenden Agents sequentiell ausführen.
   * Wirft, wenn der Worktree fehlt (behebbarer Infrastruktur-Fehler, kein FAIL).
   */
  async runTrigger(feature: Feature, project: Project, trigger: AgentTrigger): Promise<GateOutcome> {
    const agents = this.resolve(project.id, feature.id, trigger);
    if (agents.length === 0) return { ok: true, failedAgent: null, runs: [] };

    this.guardWorktree(feature);
    await this.emitGate(feature, trigger, 'running');

    const runs: AgentRunSummary[] = [];
    for (const agent of agents) {
      const run = await this.runOne(agent, feature, project, trigger);
      runs.push(run);
      if (agent.blocking && run.verdict !== 'PASS') {
        await this.emitGate(feature, trigger, 'fail');
        return { ok: false, failedAgent: agent.name, runs };
      }
    }
    await this.emitGate(feature, trigger, 'pass');
    return { ok: true, failedAgent: null, runs };
  }

  /** Manueller Einzellauf („Jetzt ausführen"), unabhängig von enabled/Selektion. */
  async runAgent(agentId: string, feature: Feature, project: Project): Promise<AgentRunSummary> {
    const agent = this.deps.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} nicht gefunden`);
    this.guardWorktree(feature);
    return this.runOne(agent, feature, project, { kind: 'manual' });
  }

  private resolve(projectId: string, featureId: string, trigger: AgentTrigger): AgentDefinition[] {
    return resolveAgentsForTrigger(
      this.deps.agents.forProject(projectId),
      this.deps.agents.listSelection(featureId),
      trigger,
    );
  }

  /**
   * Infrastruktur-Guard: Ist der Worktree verschwunden (z. B. mitten in der
   * Session gelöscht), darf das Gate KEIN dauerhaftes FAIL verbuchen —
   * stattdessen als behebbaren Fehler eskalieren (Aufrufer fängt und retryt).
   */
  private guardWorktree(feature: Feature): void {
    if (!feature.worktreePath || !existsSync(feature.worktreePath)) {
      throw new Error(
        `Agent-Gate übersprungen: Worktree fehlt (${feature.worktreePath ?? 'kein Pfad'}) — erneut anstoßen.`,
      );
    }
  }

  private async runOne(
    agent: AgentDefinition,
    feature: Feature,
    project: Project,
    trigger: AgentTrigger,
  ): Promise<AgentRunSummary> {
    const worktree = feature.worktreePath!;
    if (!(await isGitRepo(worktree))) {
      throw new Error(`Agent-Gate übersprungen: ${worktree} ist kein Git-Repo — erneut anstoßen.`);
    }
    mkdirSync(join(worktree, 'specs', feature.name, 'reviews'), { recursive: true });
    const reviewFile = join('specs', feature.name, 'reviews', `${agent.id}.md`);
    const prompt = [
      agent.prompt.replaceAll('{reviewFile}', reviewFile),
      '',
      `Kontext: Feature '${feature.name}', Branch '${feature.branch}', Default-Branch '${project.defaultBranch}'.`,
      `Die Spezifikation liegt unter specs/${feature.name}/.`,
    ].join('\n');

    const execId = this.deps.executions.start({
      projectId: project.id,
      featureId: feature.id,
      kind: 'review',
      phase: trigger.phase ?? null,
      logPath: null,
    });
    const runId = this.deps.agentRuns.start({
      agent,
      projectId: project.id,
      featureId: feature.id,
      executionId: execId,
      trigger,
    });

    const logPath = join(this.deps.dataDir, 'logs', `${execId}.log`);
    const argv = buildHeadlessArgv(prompt, agent.model ? { model: agent.model } : {});
    const exitCode = await this.runner(argv, worktree, logPath);

    const reportPath = join(worktree, reviewFile);
    const content = existsSync(reportPath) ? await readFile(reportPath, 'utf8') : null;
    // Ohne explizites Urteil im Bericht NIE als bestanden werten (FR-025);
    // Exit-Code-Fallback greift nur für FAIL.
    const verdict = hasExplicitVerdict(content)
      ? parseVerdict(content, exitCode)
      : parseVerdict(content, exitCode) === 'FAIL'
        ? 'FAIL'
        : null;
    const decisionLabel = parseDecisionLabel(content);
    const summary = extractSummary(content);

    const output = await readFile(logPath, 'utf8').catch(() => '');
    const cost = meter({ promptText: prompt, outputText: output });
    this.deps.executions.finish(execId, verdict === 'PASS' ? 0 : 1, cost.costUsd, cost.totalTokens);
    this.deps.agentRuns.finish(runId, { verdict, decisionLabel, summary, reportPath: reviewFile });

    this.raiseApprovalIfNeeded(agent, feature, content, reviewFile, decisionLabel);

    return {
      id: runId,
      agentId: agent.id,
      agentName: agent.name,
      featureId: feature.id,
      executionId: execId,
      trigger,
      blocking: agent.blocking,
      verdict,
      decisionLabel,
      summary,
      reportPath: reviewFile,
      createdAt: Date.now(),
      finishedAt: Date.now(),
      source: 'db',
    };
  }

  /**
   * Explizit gemeldeter menschlicher Freigabebedarf (FREIGABE ERFORDERLICH:-Zeilen
   * oder GESAMTENTSCHEIDUNG "… MIT ÄNDERUNGEN") → eigenes Inbox-Item, auch bei PASS.
   */
  private raiseApprovalIfNeeded(
    agent: AgentDefinition,
    feature: Feature,
    content: string | null,
    reviewFile: string,
    decisionLabel: string | null,
  ): void {
    const topics = parseApprovalItems(content);
    if (decisionLabel && /MIT ÄNDERUNGEN/i.test(decisionLabel) && topics.length === 0) {
      topics.push(decisionLabel);
    }
    if (topics.length === 0) return;
    const item = this.deps.attention.raise({
      kind: 'approval_required',
      projectId: feature.projectId,
      featureId: feature.id,
      message: `${feature.name}: Freigabe erforderlich (${agent.name}) — ${topics.join('; ')} [Bericht: ${reviewFile}]`,
    });
    bus.emitEvent('attention_raised', item);
  }

  private async emitGate(feature: Feature, trigger: AgentTrigger, status: 'running' | 'pass' | 'fail'): Promise<void> {
    bus.emitEvent('agent_gate', {
      featureId: feature.id,
      projectId: feature.projectId,
      trigger,
      status,
    });
  }
}

/** Produktions-Runner: `claude -p …` im Worktree, 20-min-SIGKILL, Log-Mitschnitt. */
const defaultRunner: HeadlessRunner = async (argv, cwd, logPath) => {
  const env = await loginShellEnv();
  const log = createWriteStream(logPath, { flags: 'a' });
  const [cmd, ...args] = argv;
  return new Promise<number>((resolve) => {
    const child = spawn(cmd!, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20 * 60_000);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('close', (code) => {
      clearTimeout(timeout);
      log.end();
      resolve(code ?? 1);
    });
    child.on('error', () => {
      clearTimeout(timeout);
      log.end();
      resolve(127);
    });
  });
};
