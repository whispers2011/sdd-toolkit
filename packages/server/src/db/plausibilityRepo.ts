import type { AttentionKind, ProjectRunStats } from '@sdd/shared';
import type { DB } from './database.js';

/**
 * Wasserstand der Plausibilitätsprüfung (Feature "plausibilitaetspruefung").
 *
 * Hält je Befund und Bezugsobjekt die zuletzt gemeldete Anzahl, damit eine
 * aufgelöste Meldung nicht im nächsten Prüfintervall neu entsteht (FR-014) und
 * einen Neustart übersteht (FR-017). Die Entscheidung selbst trifft `decideFinding`
 * in @sdd/shared — hier steht nur der Zugriff.
 *
 * `featureId: ''` bezeichnet einen projektweiten Befund (A, C).
 */
export class PlausibilityRepo {
  constructor(private db: DB) {}

  /**
   * Aggregat je Projekt für Befund C — EINE Abfrage mit drei Unterabfragen, kein N+1.
   *
   * Der Phasenlauf-Zähler geht über `executions.project_id` und ausdrücklich NICHT
   * über einen Join auf `features`: damit zählen Läufe eines inzwischen gelöschten
   * Features weiterhin als „es lief etwas" (Edge Case der Spec). Ebenso ohne
   * Status-Filter — ein fehlgeschlagener Phasenlauf ist auch ein Lauf (FR-009).
   */
  listProjectStats(): ProjectRunStats[] {
    const rows = this.db
      .prepare(
        `SELECT p.id AS project_id,
           (SELECT COUNT(*)          FROM features f  WHERE f.project_id=p.id AND f.archived_at IS NULL) AS active_features,
           (SELECT MAX(f.created_at) FROM features f  WHERE f.project_id=p.id AND f.archived_at IS NULL) AS newest_feature_at,
           (SELECT COUNT(*)          FROM executions e WHERE e.project_id=p.id AND e.kind='phase')       AS phase_runs
         FROM projects p`,
      )
      .all() as { project_id: string; active_features: number; newest_feature_at: number | null; phase_runs: number }[];
    return rows.map((r) => ({
      projectId: r.project_id,
      activeFeatures: r.active_features,
      newestFeatureAt: r.newest_feature_at ?? null,
      phaseRuns: r.phase_runs,
    }));
  }

  /** Quittierter Stand; null = nie gemeldet. */
  getMark(kind: AttentionKind, projectId: string, featureId: string): number | null {
    const row = this.db
      .prepare('SELECT reported_count FROM plausibility_state WHERE kind=? AND project_id=? AND feature_id=?')
      .get(kind, projectId, featureId) as { reported_count: number } | undefined;
    return row?.reported_count ?? null;
  }

  /** Marke setzen oder überschreiben. */
  setMark(kind: AttentionKind, projectId: string, featureId: string, count: number, now: number): void {
    this.db
      .prepare(
        `INSERT INTO plausibility_state (kind, project_id, feature_id, reported_count, reported_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (kind, project_id, feature_id)
         DO UPDATE SET reported_count=excluded.reported_count, reported_at=excluded.reported_at`,
      )
      .run(kind, projectId, featureId, count, now);
  }

  /**
   * Marke löschen — der Befund liegt nicht mehr vor. Ohne das bliebe eine stille
   * Falle zurück: verschwindet ein Befund ganz und tritt später ein einzelner
   * neuer Fall auf, wäre `1 ≤ alte Marke` dauerhaft unterdrückt.
   */
  clearMark(kind: AttentionKind, projectId: string, featureId: string): void {
    this.db
      .prepare('DELETE FROM plausibility_state WHERE kind=? AND project_id=? AND feature_id=?')
      .run(kind, projectId, featureId);
  }
}
