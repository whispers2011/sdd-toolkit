import { existsSync, statSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { extractSummary, hasExplicitVerdict, parseDecisionLabel, parseVerdict } from '@sdd/shared';
import type {
  AgentRunSummary,
  BranchInfo,
  Feature,
  IntegrationStage,
  Project,
  ReviewComment,
  ReviewOverviewItem,
} from '@sdd/shared';
import type { ExecutionRepo, FeatureRepo, ProjectRepo, ReviewCommentRepo } from '../db/repos.js';
import type { AgentRunRepo } from '../db/agentRepo.js';
import { git } from '../git/git.js';
import { collectUnmergedChanges } from '../services/unmergedChanges.js';
import { bus } from '../events.js';

/** Stages, die in der Review-Übersicht erscheinen. */
const REVIEW_STAGES: IntegrationStage[] = [
  'awaiting_human_review',
  'verify_failed',
  'gate_failed',
  'conflict_escalated',
];

/** Editier-/Lesegrenze für Portal-Dateien. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ReviewRouteDeps {
  projects: ProjectRepo;
  features: FeatureRepo;
  executions: ExecutionRepo;
  reviewComments: ReviewCommentRepo;
  agentRuns: AgentRunRepo;
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

/** Review-Portal-Routen (eigene Datei — server.ts ist bereits ~1100 Zeilen). */
export function registerReviewRoutes(app: FastifyInstance, deps: ReviewRouteDeps): void {
  const mustFeature = (id: string): Feature => {
    const f = deps.features.get(id);
    if (!f) throw httpError(404, 'Feature nicht gefunden');
    return f;
  };
  const mustProject = (id: string): Project => {
    const p = deps.projects.get(id);
    if (!p) throw httpError(404, 'Projekt nicht gefunden');
    return p;
  };

  /**
   * Pfad-Traversal-Guard: relativer Pfad muss innerhalb des Worktrees bleiben.
   * Liefert den absoluten Pfad.
   */
  const safeWorktreePath = (feature: Feature, relPath: string): { worktree: string; abs: string } => {
    const worktree = feature.worktreePath;
    if (!worktree || !existsSync(worktree)) throw httpError(409, 'Kein Worktree vorhanden');
    if (!relPath || isAbsolute(relPath)) throw httpError(400, 'Relativer Pfad erwartet');
    const abs = resolve(worktree, relPath);
    if (abs !== worktree && !abs.startsWith(worktree + sep)) throw httpError(400, 'Pfad verlässt den Worktree');
    return { worktree, abs };
  };

  /** Heuristik wie git: NUL-Byte im Kopf ⇒ binär. */
  const looksBinary = (buf: Buffer): boolean => buf.subarray(0, 8000).includes(0);

  // ---------- Review-Übersicht ----------

  app.get<{ Querystring: { projectId: string } }>('/api/review/overview', async (req) => {
    const project = mustProject(req.query.projectId);
    const items: ReviewOverviewItem[] = [];
    for (const feature of deps.features.listByProject(project.id)) {
      const isReviewStage = REVIEW_STAGES.includes(feature.integration);
      const isInProgress = feature.integration === 'none';
      // Merged o. Ä. raus; sonst Gate-Features UND in Entwicklung befindliche Features.
      if (!isReviewStage && !isInProgress) continue;

      let filesChanged = 0;
      let additions = 0;
      let deletions = 0;
      let hasUncommitted = false;
      let hasCommits = false;
      if (feature.worktreePath && existsSync(feature.worktreePath)) {
        try {
          // Merge-Base-Diff → committete UND uncommittete/untracked Änderungen zählen.
          const d = await collectUnmergedChanges(feature.worktreePath, project.defaultBranch);
          filesChanged = d.files.length;
          additions = d.files.reduce((s, f) => s + f.additions, 0);
          deletions = d.files.reduce((s, f) => s + f.deletions, 0);
          hasUncommitted = d.hasUncommitted;
          hasCommits = d.commits.length > 0;
        } catch {
          // Worktree defekt/verschwunden → mit 0 weiter statt die Übersicht zu killen.
        }
      }

      // In-Entwicklung-Features nur listen, wenn es überhaupt ungemergte Arbeit gibt.
      if (isInProgress && filesChanged === 0 && !hasCommits) continue;

      const latest = [...(await collectAuditRuns(feature, project, deps.agentRuns)).values()];
      const passed = latest.filter((r) => r.verdict === 'PASS').length;
      const failed = latest.filter((r) => r.verdict !== 'PASS').length;

      const verifyExec = deps.executions
        .list(feature.id)
        .find((e) => e.kind === 'verify' && e.status !== 'running');
      const verify: ReviewOverviewItem['verify'] = verifyExec
        ? verifyExec.status === 'succeeded'
          ? { status: 'passed', executionId: verifyExec.id }
          : { status: 'failed', executionId: verifyExec.id }
        : { status: 'none' };

      items.push({
        feature,
        stage: feature.integration,
        filesChanged,
        additions,
        deletions,
        audits: { passed, failed, total: latest.length },
        openComments: deps.reviewComments.countOpen(feature.id),
        verify,
        hasUncommitted,
      });
    }
    return items;
  });

  // ---------- Branches (Ziel-Auswahl) ----------

  app.get<{ Params: { id: string } }>('/api/projects/:id/branches', async (req) => {
    const project = mustProject(req.params.id);
    const r = await git(project.path, ['for-each-ref', 'refs/heads', '--format=%(refname:short)']);
    const featureBranches = new Set(deps.features.listByProject(project.id, true).map((f) => f.branch));
    const branches: BranchInfo[] = r.stdout
      .split('\n')
      .filter(Boolean)
      .map((name) => ({
        name,
        isDefault: name === project.defaultBranch,
        isFeatureBranch: featureBranches.has(name),
      }));
    return branches;
  });

  // ---------- Dateibaum + Datei lesen/schreiben ----------

  app.get<{ Params: { id: string } }>('/api/features/:id/tree', async (req) => {
    const feature = mustFeature(req.params.id);
    if (!feature.worktreePath || !existsSync(feature.worktreePath)) {
      throw httpError(409, 'Kein Worktree vorhanden');
    }
    const r = await git(feature.worktreePath, ['ls-files', '-co', '--exclude-standard']);
    return { files: r.stdout.split('\n').filter(Boolean).sort() };
  });

  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/features/:id/file', async (req) => {
    const feature = mustFeature(req.params.id);
    const { abs } = safeWorktreePath(feature, req.query.path);
    if (!existsSync(abs)) throw httpError(404, 'Datei nicht gefunden');
    const stat = statSync(abs);
    if (!stat.isFile()) throw httpError(400, 'Kein regulärer Dateipfad');
    if (stat.size > MAX_FILE_BYTES) throw httpError(413, 'Datei über 2 MB — im Portal nicht editierbar');
    const buf = await readFile(abs);
    if (looksBinary(buf)) throw httpError(415, 'Binärdatei — im Portal nicht editierbar');
    return { path: req.query.path, content: buf.toString('utf8'), mtimeMs: stat.mtimeMs, size: stat.size };
  });

  app.put<{ Params: { id: string }; Body: { path: string; content: string; baseMtimeMs: number } }>(
    '/api/features/:id/file',
    async (req, reply) => {
      const feature = mustFeature(req.params.id);
      if (feature.integration !== 'awaiting_human_review') {
        throw httpError(409, 'Bearbeiten nur möglich, solange das Feature auf menschliche Prüfung wartet');
      }
      const { path, content, baseMtimeMs } = req.body ?? ({} as never);
      if (typeof path !== 'string' || typeof content !== 'string' || typeof baseMtimeMs !== 'number') {
        throw httpError(400, 'path, content und baseMtimeMs erforderlich');
      }
      if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
        throw httpError(413, 'Inhalt über 2 MB');
      }
      const { abs } = safeWorktreePath(feature, path);
      if (!existsSync(abs)) throw httpError(404, 'Datei nicht gefunden');
      // mtime-Konfliktschutz (featureArtifacts-Muster): Fremdänderung nie stumm überschreiben.
      const current = statSync(abs).mtimeMs;
      if (Math.abs(current - baseMtimeMs) > 0.5) {
        void reply.code(409);
        return { error: 'conflict', message: 'Datei wurde zwischenzeitlich geändert', currentMtimeMs: current };
      }
      await writeFile(abs, content, 'utf8');
      return { mtimeMs: statSync(abs).mtimeMs };
    },
  );

  // ---------- Reviewer-Kommentare ----------

  const emitComments = (featureId: string) => bus.emitEvent('review_comments_updated', { featureId });

  app.get<{ Params: { id: string } }>('/api/features/:id/comments', (req) => {
    mustFeature(req.params.id);
    return deps.reviewComments.listForFeature(req.params.id);
  });

  app.post<{
    Params: { id: string };
    Body: { filePath?: string | null; line?: number | null; side?: 'old' | 'new' | null; text: string };
  }>('/api/features/:id/comments', async (req, reply) => {
    const feature = mustFeature(req.params.id);
    const text = req.body?.text?.trim();
    if (!text) throw httpError(400, 'Kommentartext fehlt');
    const comment = deps.reviewComments.create({
      featureId: feature.id,
      filePath: req.body.filePath ?? null,
      line: req.body.line ?? null,
      side: req.body.side ?? null,
      text,
    });
    emitComments(feature.id);
    void reply.code(201);
    return comment;
  });

  app.patch<{ Params: { id: string }; Body: { text?: string; status?: ReviewComment['status'] } }>(
    '/api/comments/:id',
    (req) => {
      const updated = deps.reviewComments.update(req.params.id, {
        ...(req.body?.text !== undefined ? { text: req.body.text } : {}),
        ...(req.body?.status !== undefined ? { status: req.body.status } : {}),
      });
      if (!updated) throw httpError(404, 'Kommentar nicht gefunden');
      emitComments(updated.featureId);
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/comments/:id', (req) => {
    const existing = deps.reviewComments.get(req.params.id);
    if (!existing) throw httpError(404, 'Kommentar nicht gefunden');
    deps.reviewComments.remove(existing.id);
    emitComments(existing.featureId);
    return { ok: true };
  });

  // ---------- Audits (agent_runs-first, Markdown-Fallback für Alt-Reviews) ----------

  app.get<{ Params: { id: string } }>('/api/features/:id/agent-runs', async (req) => {
    const feature = mustFeature(req.params.id);
    const project = mustProject(feature.projectId);
    const runs = deps.agentRuns.listForFeature(feature.id);
    const withTokens = runs.map((run) => attachTokens(run, deps.executions));
    const fallback = await markdownFallback(feature, project, runs);
    return [...withTokens, ...fallback];
  });

  app.get<{ Params: { id: string; runId: string } }>('/api/features/:id/agent-runs/:runId/report', async (req) => {
    const feature = mustFeature(req.params.id);
    const runs = deps.agentRuns.listForFeature(feature.id);
    const run = runs.find((r) => r.id === req.params.runId);
    // Fallback-Läufe (Alt-Reviews) adressieren den Bericht direkt über den Dateinamen.
    const reportPath = run?.reportPath ?? (req.params.runId.startsWith('md:') ? req.params.runId.slice(3) : null);
    if (!reportPath) throw httpError(404, 'Bericht nicht gefunden');
    const { abs } = safeWorktreePath(feature, reportPath);
    if (!existsSync(abs)) throw httpError(404, 'Berichtsdatei fehlt (Worktree bereits aufgeräumt?)');
    return { content: await readFile(abs, 'utf8'), reportPath };
  });
}

/** totalTokens aus der verknüpften Execution anreichern. */
function attachTokens(run: AgentRunSummary, executions: ExecutionRepo): AgentRunSummary {
  if (!run.executionId) return run;
  const exec = executions.get(run.executionId);
  if (!exec) return run;
  return { ...run, totalTokens: exec.tokens };
}

/** Jüngster Lauf je Agent inkl. Markdown-Fallback (für Audit-Zähler der Übersicht). */
async function collectAuditRuns(
  feature: Feature,
  project: Project,
  agentRuns: AgentRunRepo,
): Promise<Map<string, AgentRunSummary>> {
  const latest = agentRuns.latestPerAgent(feature.id);
  for (const run of await markdownFallback(feature, project, agentRuns.listForFeature(feature.id))) {
    latest.set(run.agentName, run);
  }
  return latest;
}

/**
 * Alt-Reviews aus der Zeit VOR der strukturierten Ablage: Berichte unter
 * specs/<feature>/reviews/*.md, die keinem agent_run zugeordnet sind, werden
 * bestmöglich geparst und als source:'markdown' ausgewiesen.
 */
async function markdownFallback(
  feature: Feature,
  project: Project,
  runs: AgentRunSummary[],
): Promise<AgentRunSummary[]> {
  void project;
  if (!feature.worktreePath || !existsSync(feature.worktreePath)) return [];
  const reviewsDir = join(feature.worktreePath, 'specs', feature.name, 'reviews');
  if (!existsSync(reviewsDir)) return [];
  const known = new Set(runs.map((r) => r.reportPath).filter(Boolean));
  const out: AgentRunSummary[] = [];
  for (const entry of await readdir(reviewsDir)) {
    if (!entry.endsWith('.md')) continue;
    const relPath = join('specs', feature.name, 'reviews', entry);
    if (known.has(relPath)) continue;
    const content = await readFile(join(reviewsDir, entry), 'utf8').catch(() => null);
    if (content === null) continue;
    const agentId = entry.replace(/\.md$/, '');
    out.push({
      id: `md:${relPath}`,
      agentId: null,
      agentName: agentId,
      featureId: feature.id,
      executionId: null,
      trigger: { kind: 'review_gate' },
      blocking: true,
      verdict: hasExplicitVerdict(content) ? parseVerdict(content, 1) : null,
      decisionLabel: parseDecisionLabel(content),
      summary: extractSummary(content),
      reportPath: relPath,
      createdAt: statSync(join(reviewsDir, entry)).mtimeMs,
      finishedAt: statSync(join(reviewsDir, entry)).mtimeMs,
      source: 'markdown',
    });
  }
  return out;
}
