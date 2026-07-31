/**
 * Routen der Testing-Lane (eigene Datei nach dem Vorbild `worktreeRoutes.ts` —
 * `server.ts` ist bereits am Limit). Die Stack- und Abnahme-Routen EINES Features
 * liegen dagegen bei den übrigen `/api/features/:id/*`-Routen, weil sie zu deren
 * Wach-/Guard-Muster gehören.
 */
import type { FastifyInstance } from 'fastify';
import type { TestingLaneService } from '../services/testingLaneService.js';
import type { StackRepo } from '../db/stackRepo.js';

export interface TestingLaneRouteDeps {
  testingLane: TestingLaneService;
  stacks: StackRepo;
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

  /**
   * Das „behoben?"-Häkchen der Folgerunde. Umkehrbar — wer versehentlich abhakt,
   * bekommt den Befund zurück in die offene Liste. Was offen bleibt, geht in die
   * nächste Ablehnung mit; ein offener Blocker sperrt die Annahme.
   */
  app.patch<{ Params: { id: string }; Body?: { status?: string } }>(
    '/api/manual-test-findings/:id',
    (req, reply) => {
      const status = req.body?.status;
      if (status !== 'open' && status !== 'resolved') {
        void reply.code(400);
        return { message: "status muss 'open' oder 'resolved' sein" };
      }
      const updated = deps.stacks.setFindingStatus(req.params.id, status, Date.now());
      if (!updated) {
        void reply.code(404);
        return { message: 'Befund nicht gefunden' };
      }
      return updated;
    },
  );

  /** Einen Befund verwerfen (versehentlich erfasst). */
  app.delete<{ Params: { id: string } }>('/api/manual-test-findings/:id', (req, reply) => {
    if (!deps.stacks.getFinding(req.params.id)) {
      void reply.code(404);
      return { message: 'Befund nicht gefunden' };
    }
    deps.stacks.removeFinding(req.params.id);
    return { ok: true };
  });
}
