import type { FastifyInstance } from 'fastify';
import {
  WorktreeRemoveError,
  type WorktreeOverviewService,
  type WorktreeRemoveErrorCode,
} from '../services/worktreeOverviewService.js';

export interface WorktreeRouteDeps {
  worktreeOverview: WorktreeOverviewService;
}

/** HTTP-Abbildung der Abweisungsgründe (contracts/http-api.md). */
const REMOVE_STATUS: Record<WorktreeRemoveErrorCode, number> = {
  project_not_found: 404,
  not_a_worktree: 400,
  main_checkout: 400,
  not_removable: 400,
  session_active: 409,
  uncommitted: 409,
  remove_failed: 500,
};

/** Worktree-Übersicht (eigene Datei — server.ts ist bereits ~1350 Zeilen). */
export function registerWorktreeRoutes(app: FastifyInstance, deps: WorktreeRouteDeps): void {
  app.get<{ Querystring: { refresh?: string } }>('/api/worktrees', async (req) =>
    deps.worktreeOverview.buildOverview({ refresh: req.query.refresh === '1' }),
  );

  app.post<{ Body: { projectId?: string; path?: string; force?: boolean } }>(
    '/api/worktrees/remove',
    async (req, reply) => {
      const { projectId, path, force } = req.body ?? {};
      if (typeof projectId !== 'string' || !projectId || typeof path !== 'string' || !path) {
        void reply.code(400);
        return { message: 'projectId und path erforderlich' };
      }
      try {
        return await deps.worktreeOverview.removeWorktree({ projectId, path, force: force === true });
      } catch (err) {
        if (!(err instanceof WorktreeRemoveError)) throw err;
        void reply.code(REMOVE_STATUS[err.code]);
        if (err.code === 'project_not_found') return { message: err.message };
        if (err.code === 'uncommitted') {
          return {
            error: err.code,
            uncommittedFileCount: err.uncommittedFileCount,
            message: err.message,
          };
        }
        return { error: err.code, message: err.message };
      }
    },
  );
}
