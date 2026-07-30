/**
 * Routen der Testing-Lane (eigene Datei nach dem Vorbild `worktreeRoutes.ts` —
 * `server.ts` ist bereits am Limit). Die Stack- und Abnahme-Routen EINES Features
 * liegen dagegen bei den übrigen `/api/features/:id/*`-Routen, weil sie zu deren
 * Wach-/Guard-Muster gehören.
 */
import type { FastifyInstance } from 'fastify';
import type { TestingLaneService } from '../services/testingLaneService.js';

export interface TestingLaneRouteDeps {
  testingLane: TestingLaneService;
}

export function registerTestingLaneRoutes(app: FastifyInstance, deps: TestingLaneRouteDeps): void {
  app.get<{ Querystring: { projectId?: string; refresh?: string } }>(
    '/api/testing-lane',
    async (req, reply) => {
      const projectId = req.query.projectId;
      if (typeof projectId !== 'string' || projectId === '') {
        void reply.code(400);
        return { message: 'projectId erforderlich' };
      }
      try {
        return await deps.testingLane.list(projectId, { refresh: req.query.refresh === '1' });
      } catch (err) {
        void reply.code(404);
        return { message: (err as Error).message };
      }
    },
  );
}
