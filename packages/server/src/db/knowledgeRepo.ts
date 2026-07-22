import { nanoid } from 'nanoid';
import {
  buildKnowledgeTree,
  projectIndex,
  type Applicability,
  type KnowledgeBundle,
  type KnowledgeEntry,
  type KnowledgeFeatureSelection,
  type KnowledgeIndex,
  type KnowledgeTree,
  type SelectionDecision,
} from '@sdd/shared';
import type { DB } from './database.js';

// ---------- Row-Mapping ----------

interface BundleRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  applicability_text: string;
  applicability_tags: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface EntryRow {
  id: string;
  project_id: string;
  bundle_id: string | null;
  title: string;
  body: string;
  applicability_text: string;
  applicability_tags: string;
  source: string;
  source_path: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function toBundle(r: BundleRow): KnowledgeBundle {
  return {
    id: r.id,
    projectId: r.project_id,
    parentId: r.parent_id,
    name: r.name,
    applicability: { text: r.applicability_text, tags: parseTags(r.applicability_tags) },
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toEntry(r: EntryRow): KnowledgeEntry {
  return {
    id: r.id,
    projectId: r.project_id,
    bundleId: r.bundle_id,
    title: r.title,
    body: r.body,
    applicability: { text: r.applicability_text, tags: parseTags(r.applicability_tags) },
    source: r.source === 'file' ? 'file' : 'inline',
    sourcePath: r.source_path,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------- Eingabe-Typen ----------

export interface BundleInput {
  parentId: string | null;
  name: string;
  applicability: Applicability;
  sortOrder?: number;
}

export interface EntryInput {
  bundleId: string | null;
  title: string;
  body: string;
  applicability: Applicability;
  source?: 'inline' | 'file';
  sourcePath?: string | null;
  sortOrder?: number;
}

export class KnowledgeRepo {
  constructor(private db: DB) {}

  // ---------- Bundles ----------

  listBundles(projectId: string): KnowledgeBundle[] {
    return (
      this.db.prepare('SELECT * FROM knowledge_bundles WHERE project_id=? ORDER BY sort_order, created_at').all(projectId) as BundleRow[]
    ).map(toBundle);
  }

  getBundle(id: string): KnowledgeBundle | null {
    const r = this.db.prepare('SELECT * FROM knowledge_bundles WHERE id=?').get(id) as BundleRow | undefined;
    return r ? toBundle(r) : null;
  }

  createBundle(projectId: string, input: BundleInput): KnowledgeBundle {
    const id = nanoid(10);
    const ts = Date.now();
    this.db
      .prepare(
        `INSERT INTO knowledge_bundles (id, project_id, parent_id, name, applicability_text, applicability_tags, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.parentId,
        input.name,
        input.applicability.text,
        JSON.stringify(input.applicability.tags),
        input.sortOrder ?? 0,
        ts,
        ts,
      );
    return this.getBundle(id)!;
  }

  updateBundle(
    id: string,
    patch: Partial<Pick<KnowledgeBundle, 'name' | 'parentId' | 'applicability' | 'sortOrder'>>,
  ): KnowledgeBundle {
    const cur = this.getBundle(id);
    if (!cur) throw new Error(`Bundle ${id} nicht gefunden`);
    const merged = { ...cur, ...patch };
    this.db
      .prepare(
        `UPDATE knowledge_bundles SET parent_id=?, name=?, applicability_text=?, applicability_tags=?, sort_order=?, updated_at=? WHERE id=?`,
      )
      .run(
        merged.parentId,
        merged.name,
        merged.applicability.text,
        JSON.stringify(merged.applicability.tags),
        merged.sortOrder,
        Date.now(),
        id,
      );
    return this.getBundle(id)!;
  }

  deleteBundle(id: string): void {
    this.db.prepare('DELETE FROM knowledge_bundles WHERE id=?').run(id);
  }

  // ---------- Einträge ----------

  listEntriesByProject(projectId: string): KnowledgeEntry[] {
    return (
      this.db.prepare('SELECT * FROM knowledge_entries WHERE project_id=? ORDER BY sort_order, created_at').all(projectId) as EntryRow[]
    ).map(toEntry);
  }

  getEntry(id: string): KnowledgeEntry | null {
    const r = this.db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(id) as EntryRow | undefined;
    return r ? toEntry(r) : null;
  }

  createEntry(projectId: string, input: EntryInput): KnowledgeEntry {
    const id = nanoid(10);
    const ts = Date.now();
    this.db
      .prepare(
        `INSERT INTO knowledge_entries (id, project_id, bundle_id, title, body, applicability_text, applicability_tags, source, source_path, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.bundleId,
        input.title,
        input.body,
        input.applicability.text,
        JSON.stringify(input.applicability.tags),
        input.source ?? 'inline',
        input.sourcePath ?? null,
        input.sortOrder ?? 0,
        ts,
        ts,
      );
    return this.getEntry(id)!;
  }

  updateEntry(
    id: string,
    patch: Partial<Pick<KnowledgeEntry, 'title' | 'body' | 'bundleId' | 'applicability' | 'sortOrder'>>,
  ): KnowledgeEntry {
    const cur = this.getEntry(id);
    if (!cur) throw new Error(`Eintrag ${id} nicht gefunden`);
    const merged = { ...cur, ...patch };
    this.db
      .prepare(
        `UPDATE knowledge_entries SET bundle_id=?, title=?, body=?, applicability_text=?, applicability_tags=?, sort_order=?, updated_at=? WHERE id=?`,
      )
      .run(
        merged.bundleId,
        merged.title,
        merged.body,
        merged.applicability.text,
        JSON.stringify(merged.applicability.tags),
        merged.sortOrder,
        Date.now(),
        id,
      );
    return this.getEntry(id)!;
  }

  deleteEntry(id: string): void {
    this.db.prepare('DELETE FROM knowledge_entries WHERE id=?').run(id);
  }

  // ---------- Projektionen ----------

  tree(projectId: string): KnowledgeTree {
    return buildKnowledgeTree(this.listBundles(projectId), this.listEntriesByProject(projectId));
  }

  index(projectId: string): KnowledgeIndex {
    const idx = projectIndex(this.listBundles(projectId), this.listEntriesByProject(projectId), Date.now());
    // projectIndex leitet projectId aus den Zeilen ab — bei leerem Projekt nachtragen.
    return { ...idx, projectId };
  }

  // ---------- Feature-Selektion ----------

  listSelectionForFeature(featureId: string): KnowledgeFeatureSelection[] {
    const rows = this.db
      .prepare('SELECT * FROM knowledge_feature_selection WHERE feature_id=?')
      .all(featureId) as { feature_id: string; target_id: string; target_kind: string; decision: string }[];
    return rows.map((r) => ({
      featureId: r.feature_id,
      targetId: r.target_id,
      targetKind: r.target_kind === 'bundle' ? 'bundle' : 'entry',
      decision: r.decision === 'exclude' ? 'exclude' : 'include',
    }));
  }

  setSelection(
    featureId: string,
    targetId: string,
    targetKind: 'bundle' | 'entry',
    decision: SelectionDecision,
  ): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_feature_selection (feature_id, target_id, target_kind, decision) VALUES (?, ?, ?, ?)
         ON CONFLICT(feature_id, target_id) DO UPDATE SET target_kind=excluded.target_kind, decision=excluded.decision`,
      )
      .run(featureId, targetId, targetKind, decision);
  }

  clearSelection(featureId: string, targetId: string): void {
    this.db.prepare('DELETE FROM knowledge_feature_selection WHERE feature_id=? AND target_id=?').run(featureId, targetId);
  }
}
