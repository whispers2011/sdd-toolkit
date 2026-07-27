import type { FastifyInstance } from 'fastify';
import { parseOtlpLogs } from '@sdd/shared';
import type { TelemetryStore } from './telemetryStore.js';

/**
 * OTLP-Empfänger (contracts/otlp-receiver.md). Die Claude-CLI exportiert ihre
 * Ereignisse als OTLP/HTTP-JSON hierher — auf den bestehenden Server, gebunden an
 * 127.0.0.1. Kein zusätzlicher Listener, keine neue Abhängigkeit.
 */

/**
 * Gemessene Stapel lagen bei 3–19 KB. Fastifys Voreinstellung von 1 MiB würde
 * für den Normalfall reichen, aber ein stiller 413 in einer langen Session wäre
 * ein unsichtbarer Messverlust — deshalb grosszügig.
 */
const BODY_LIMIT = 16 * 1024 * 1024;

export function registerOtlpRoute(app: FastifyInstance, store: TelemetryStore): void {
  // Gekapselter Geltungsbereich: Der nachsichtige JSON-Parser unten gilt NUR für
  // diese Route. Auf der übrigen API bleibt ein kaputter Rumpf ein 400.
  void app.register(async (scope) => {
    // Fastifys eingebauter JSON-Parser beantwortet unlesbare Rümpfe mit 400 — und
    // ein Fehlerstatus lässt den Exporter denselben Stapel erneut schicken, also
    // genau die Doppelzählung, die FR-006 ausschliesst. Deshalb parsen wir selbst
    // und geben bei Unsinn einen leeren Rumpf weiter statt eines Fehlers.
    scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: BODY_LIMIT }, (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(null, undefined);
      }
    });

    scope.post('/v1/logs', { bodyLimit: BODY_LIMIT }, (req, reply) => {
      // Der Empfang ist Buchhaltung, keine Zustellgarantie: JEDE Antwort ist 200.
      // Ein Fehler hier darf die laufende Session nie erreichen (FR-020, FR-029).
      try {
        store.ingest(parseOtlpLogs(req.body));
      } catch (err) {
        req.log.warn({ err }, '[telemetry] Stapel konnte nicht ausgewertet werden — verworfen');
      }
      return reply.code(200).send({});
    });
  });
}
