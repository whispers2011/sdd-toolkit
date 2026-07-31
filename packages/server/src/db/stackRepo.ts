/**
 * Buchführung der Stack-ABSICHT und der manuellen Abnahme.
 *
 * `feature_stacks` hält ausschließlich, WELCHES Profil betrieben werden soll —
 * nie, ob ein Dienst läuft. Der Zustand wird erhoben (StackService.probe),
 * damit auch ein Serverneustart nichts behauptet, was nicht stimmt (FR-023,
 * research E8).
 *
 * Auch die Frage „nutzt noch ein anderes Feature die geteilten Dienste?" wird
 * hier ABGELEITET statt gezählt: ein Referenzzähler driftet bei Abstürzen
 * (research E7).
 */
import { nanoid } from 'nanoid';
import {
  MANUAL_TEST_SEVERITIES,
  type FeatureStackIntent,
  type ManualTestDecision,
  type ManualTestFinding,
  type ManualTestSeverity,
} from '@sdd/shared';
import type { DB } from './database.js';

interface IntentRow {
  feature_id: string;
  profile: string;
  since: number;
}

interface DecisionRow {
  feature_id: string;
  decision: string;
  reason: string | null;
  round: number;
  decided_at: number;
}

interface FindingRow {
  id: string;
  feature_id: string;
  round: number;
  where_at: string | null;
  text: string;
  severity: string;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

function toFinding(r: FindingRow): ManualTestFinding {
  return {
    id: r.id,
    featureId: r.feature_id,
    round: r.round,
    where: r.where_at,
    text: r.text,
    severity: (MANUAL_TEST_SEVERITIES as readonly string[]).includes(r.severity)
      ? (r.severity as ManualTestSeverity)
      : 'rework',
    status: r.status === 'resolved' ? 'resolved' : 'open',
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

function toIntent(r: IntentRow): FeatureStackIntent {
  return {
    featureId: r.feature_id,
    profile: r.profile === 'full' ? 'full' : 'test',
    since: r.since,
  };
}

function toDecision(r: DecisionRow): ManualTestDecision {
  return {
    featureId: r.feature_id,
    decision: r.decision === 'rejected' ? 'rejected' : 'confirmed',
    reason: r.reason,
    round: r.round,
    decidedAt: r.decided_at,
  };
}

export class StackRepo {
  constructor(private db: DB) {}

  // ---------- Absicht ----------

  getIntent(featureId: string): FeatureStackIntent | null {
    const r = this.db.prepare('SELECT * FROM feature_stacks WHERE feature_id=?').get(featureId) as
      | IntentRow
      | undefined;
    return r ? toIntent(r) : null;
  }

  /** Absicht setzen bzw. auf ein anderes Profil heben (`test` → `full`). */
  setIntent(featureId: string, profile: 'test' | 'full', since: number): void {
    this.db
      .prepare(
        `INSERT INTO feature_stacks (feature_id, profile, since) VALUES (?, ?, ?)
         ON CONFLICT(feature_id) DO UPDATE SET profile=excluded.profile, since=excluded.since`,
      )
      .run(featureId, profile, since);
  }

  clearIntent(featureId: string): void {
    this.db.prepare('DELETE FROM feature_stacks WHERE feature_id=?').run(featureId);
  }

  /** Alle Features des Projekts mit einer Stack-Absicht. */
  intentsForProject(projectId: string): FeatureStackIntent[] {
    return (
      this.db
        .prepare(
          `SELECT fs.* FROM feature_stacks fs
           JOIN features f ON f.id = fs.feature_id
           WHERE f.project_id = ?`,
        )
        .all(projectId) as IntentRow[]
    ).map(toIntent);
  }

  /**
   * Betreibt außer `exceptFeatureId` noch ein Feature dieses Projekts einen Stack?
   * Entscheidet, ob das geteilte Kommando beim Abbau laufen darf (FR-022).
   */
  hasOtherIntent(projectId: string, exceptFeatureId: string): boolean {
    return this.intentsForProject(projectId).some((i) => i.featureId !== exceptFeatureId);
  }

  // ---------- Manuelle Abnahme ----------

  /** Historie, nicht überschreibend — mehrere Ablehnungen sind möglich (FR-029). */
  addDecision(d: ManualTestDecision): ManualTestDecision {
    this.db
      .prepare(
        'INSERT INTO manual_test_decisions (id, feature_id, decision, reason, round, decided_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(nanoid(10), d.featureId, d.decision, d.reason, d.round, d.decidedAt);
    return d;
  }

  /**
   * Laufende Abnahme-Runde: eine mehr als die Zahl der bereits gefallenen
   * Ablehnungen. ABGELEITET statt gezählt — ein eigener Zähler driftet, sobald
   * eine Entscheidung außerhalb dieses Wegs entsteht (dieselbe Überlegung wie
   * bei `hasOtherIntent`).
   */
  currentRound(featureId: string): number {
    const r = this.db
      .prepare(`SELECT COUNT(*) AS n FROM manual_test_decisions WHERE feature_id=? AND decision='rejected'`)
      .get(featureId) as { n: number };
    return r.n + 1;
  }

  /** Jüngste Entscheidung eines Features; null = es gab noch keine. */
  lastDecision(featureId: string): ManualTestDecision | null {
    const r = this.db
      .prepare('SELECT * FROM manual_test_decisions WHERE feature_id=? ORDER BY decided_at DESC, rowid DESC LIMIT 1')
      .get(featureId) as DecisionRow | undefined;
    return r ? toDecision(r) : null;
  }

  /** Vollständige Historie, jüngste zuerst. */
  decisionsFor(featureId: string): ManualTestDecision[] {
    return (
      this.db
        .prepare('SELECT * FROM manual_test_decisions WHERE feature_id=? ORDER BY decided_at DESC, rowid DESC')
        .all(featureId) as DecisionRow[]
    ).map(toDecision);
  }

  // ---------- Befunde der Abnahme ----------

  addFinding(f: Omit<ManualTestFinding, 'id' | 'status' | 'resolvedAt'>): ManualTestFinding {
    const id = nanoid(10);
    this.db
      .prepare(
        `INSERT INTO manual_test_findings (id, feature_id, round, where_at, text, severity, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, f.featureId, f.round, f.where, f.text, f.severity, f.createdAt);
    return { ...f, id, status: 'open', resolvedAt: null };
  }

  /** Alle Befunde eines Features, älteste zuerst — die Runden bleiben lesbar. */
  findingsFor(featureId: string): ManualTestFinding[] {
    return (
      this.db
        .prepare('SELECT * FROM manual_test_findings WHERE feature_id=? ORDER BY round, created_at, rowid')
        .all(featureId) as FindingRow[]
    ).map(toFinding);
  }

  openFindingsFor(featureId: string): ManualTestFinding[] {
    return this.findingsFor(featureId).filter((f) => f.status === 'open');
  }

  getFinding(id: string): ManualTestFinding | null {
    const r = this.db.prepare('SELECT * FROM manual_test_findings WHERE id=?').get(id) as
      | FindingRow
      | undefined;
    return r ? toFinding(r) : null;
  }

  /**
   * Behoben-Häkchen der nächsten Abnahme. Umkehrbar: wer versehentlich abhakt,
   * bekommt den Befund zurück in die offene Liste.
   */
  setFindingStatus(id: string, status: 'open' | 'resolved', at: number): ManualTestFinding | null {
    this.db
      .prepare('UPDATE manual_test_findings SET status=?, resolved_at=? WHERE id=?')
      .run(status, status === 'resolved' ? at : null, id);
    return this.getFinding(id);
  }

  removeFinding(id: string): void {
    this.db.prepare('DELETE FROM manual_test_findings WHERE id=?').run(id);
  }
}
