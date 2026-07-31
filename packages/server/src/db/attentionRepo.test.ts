import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type DB } from './database.js';
import { AttentionRepo, ProjectRepo } from './repos.js';

describe('AttentionRepo — Rückgabewerte der Auflösung', () => {
  let db: DB;
  let attention: AttentionRepo;
  let projectId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    attention = new AttentionRepo(db);
    projectId = new ProjectRepo(db).create({
      name: 'Demo',
      path: '/tmp/demo',
      defaultBranch: 'main',
      color: null,
      enabledPhases: [],
      verifyCommands: [],
      automation: {},
      optimization: {},
      mergeMode: 'ff',
      editorCmd: null,
      integrationMode: 'local',
    }).id;
  });

  describe('resolveFor()', () => {
    it('liefert genau die IDs, deren resolved_at durch diesen Aufruf gesetzt wurde (V1)', () => {
      const a = attention.raise({ kind: 'review_due', projectId, featureId: 'f1', message: 'Review fällig' });
      const b = attention.raise({ kind: 'verify_failed', projectId, featureId: 'f1', message: 'Verify rot' });
      const fremd = attention.raise({ kind: 'review_due', projectId, featureId: 'f2', message: 'anderes Feature' });

      const ids = attention.resolveFor({ featureId: 'f1' });

      expect(ids.slice().sort()).toEqual([a.id, b.id].sort());
      expect(attention.get(a.id)!.resolvedAt).not.toBeNull();
      expect(attention.get(b.id)!.resolvedAt).not.toBeNull();
      expect(attention.get(fremd.id)!.resolvedAt).toBeNull();
    });

    it('liefert [], wenn kein offenes Item passt (V2, FR-006)', () => {
      attention.raise({ kind: 'review_due', projectId, featureId: 'f1', message: 'Review fällig' });

      expect(attention.resolveFor({ featureId: 'ohne-meldung' })).toEqual([]);
    });

    it('führt bereits aufgelöste Items nicht erneut auf (V2)', () => {
      const a = attention.raise({ kind: 'review_due', projectId, featureId: 'f1', message: 'Review fällig' });

      expect(attention.resolveFor({ featureId: 'f1' })).toEqual([a.id]);
      expect(attention.resolveFor({ featureId: 'f1' })).toEqual([]);
    });

    it('respektiert den kinds-Filter — nicht passende Arten bleiben offen und fehlen in der Rückgabe (V3)', () => {
      const passend = attention.raise({ kind: 'review_due', projectId, featureId: 'f1', message: 'Review fällig' });
      const andereArt = attention.raise({ kind: 'gate_failed', projectId, featureId: 'f1', message: 'Gate rot' });

      const ids = attention.resolveFor({ featureId: 'f1', kinds: ['review_due'] });

      expect(ids).toEqual([passend.id]);
      expect(attention.get(andereArt.id)!.resolvedAt).toBeNull();
    });

    it('grenzt über die sessionId ab (V1)', () => {
      const meine = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's1', message: 'Frage' });
      const fremde = attention.raise({ kind: 'awaiting_input', projectId, sessionId: 's2', message: 'Frage' });

      expect(attention.resolveFor({ sessionId: 's1', kinds: ['awaiting_input'] })).toEqual([meine.id]);
      expect(attention.get(fremde.id)!.resolvedAt).toBeNull();
    });
  });

  describe('resolve()', () => {
    it('liefert beim ersten Aufruf true und beim zweiten false (V4)', () => {
      const a = attention.raise({ kind: 'review_due', projectId, featureId: 'f1', message: 'Review fällig' });

      expect(attention.resolve(a.id)).toBe(true);
      expect(attention.resolve(a.id)).toBe(false);
      expect(attention.get(a.id)!.resolvedAt).not.toBeNull();
    });

    it('liefert false bei unbekannter id (V4)', () => {
      expect(attention.resolve('gibt-es-nicht')).toBe(false);
    });

    it('liefert false, wenn das Item schon über resolveFor() aufgelöst wurde (V4)', () => {
      const a = attention.raise({ kind: 'review_due', projectId, featureId: 'f1', message: 'Review fällig' });
      attention.resolveFor({ featureId: 'f1' });

      expect(attention.resolve(a.id)).toBe(false);
    });
  });
});
