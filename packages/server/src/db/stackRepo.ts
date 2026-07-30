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
import type { FeatureStackIntent, ManualTestDecision } from '@sdd/shared';
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
  decided_at: number;
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
        'INSERT INTO manual_test_decisions (id, feature_id, decision, reason, decided_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(nanoid(10), d.featureId, d.decision, d.reason, d.decidedAt);
    return d;
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
}
