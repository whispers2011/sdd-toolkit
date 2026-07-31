# Phase 1 Data Model: Projektspezifisches Wissen

Quellen: Spec (Key Entities, FR-001…FR-015), research.md (D1–D7). Persistenz = SQLite (neue Migration in `packages/server/src/db/database.ts`); Domänentypen + pure Logik in `packages/shared/src/knowledge.ts`.

## Entitäten & Beziehungen

```text
Project (bestehend)
 └─1:N─ KnowledgeBundle ──parent_id (self, N:1, optional)──┐  (beliebig tief verschachtelt)
 │        └─1:N─ KnowledgeEntry                            │
 └─1:N─ KnowledgeEntry (bundle_id = NULL → direkt am Projekt)
Feature (bestehend)
 └─1:N─ KnowledgeFeatureSelection ──> target (Bundle | Entry)
```

- Alles ist projekt-gescopt (`project_id`, FK auf `projects`, `ON DELETE CASCADE`) → FR-002, SC-004 (0 Cross-Projekt-Leakage).
- Verschachtelung: `KnowledgeBundle.parent_id` (Adjazenzliste) und `KnowledgeEntry.bundle_id` → FR-003.
- Selektion pro Feature: Override-Entscheidungen, FK auf `features`, `ON DELETE CASCADE` → FR-010.

## SQLite-Schema (neue Migration, an `MIGRATIONS[]` anhängen)

```sql
CREATE TABLE knowledge_bundles (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id          TEXT REFERENCES knowledge_bundles(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  applicability_text TEXT NOT NULL DEFAULT '',
  applicability_tags TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE knowledge_entries (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bundle_id          TEXT REFERENCES knowledge_bundles(id) ON DELETE CASCADE,  -- NULL = direkt am Projekt
  title              TEXT NOT NULL,
  body               TEXT NOT NULL DEFAULT '',      -- Markdown (leer bei source='file')
  applicability_text TEXT NOT NULL DEFAULT '',
  applicability_tags TEXT NOT NULL DEFAULT '[]',    -- JSON string[]
  source             TEXT NOT NULL DEFAULT 'inline',-- 'inline' | 'file'
  source_path        TEXT,                          -- repo-relativ, wenn source='file'
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE knowledge_feature_selection (
  feature_id  TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  target_id   TEXT NOT NULL,                        -- Bundle- oder Entry-ID
  target_kind TEXT NOT NULL,                        -- 'bundle' | 'entry'
  decision    TEXT NOT NULL,                        -- 'include' | 'exclude'
  PRIMARY KEY (feature_id, target_id)
);

CREATE INDEX idx_kbundles_project ON knowledge_bundles(project_id);
CREATE INDEX idx_kbundles_parent  ON knowledge_bundles(parent_id);
CREATE INDEX idx_kentries_project ON knowledge_entries(project_id);
CREATE INDEX idx_kentries_bundle  ON knowledge_entries(bundle_id);
```

> Konvention wie im Bestand: JSON-Felder als TEXT (`enabled_phases`, `verify_commands`), IDs via `nanoid(10)`, Zeit als `Date.now()`-`INTEGER`. `foreign_keys = ON` ist gesetzt.

## Domänentypen (`@sdd/shared/src/knowledge.ts`)

```ts
export type ApplicabilityTag = string;

export interface Applicability {
  text: string;              // Freitext „wann anwenden"
  tags: ApplicabilityTag[];  // strukturierte Schlagworte
}

export interface KnowledgeBundle {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  applicability: Applicability;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export type KnowledgeSource = 'inline' | 'file';

export interface KnowledgeEntry {
  id: string;
  projectId: string;
  bundleId: string | null;
  title: string;
  body: string;
  applicability: Applicability;
  source: KnowledgeSource;
  sourcePath: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** Verschachtelter Baum für Anzeige/Materialisierung. */
export interface KnowledgeTreeNode {
  bundle: KnowledgeBundle;
  children: KnowledgeTreeNode[];  // Unter-Bundles
  entries: KnowledgeEntry[];      // Einträge dieses Bundles
}

export interface KnowledgeTree {
  roots: KnowledgeTreeNode[];     // Top-Level-Bundles
  looseEntries: KnowledgeEntry[]; // Einträge mit bundleId = null
}

/** Kompakte Projektion OHNE Inhalte (der „Index"). */
export interface KnowledgeIndexItem {
  id: string;
  kind: 'bundle' | 'entry';
  parentId: string | null;
  label: string;                 // name | title
  applicability: Applicability;
}
export interface KnowledgeIndex {
  projectId: string;
  items: KnowledgeIndexItem[];   // topologisch (Eltern vor Kindern)
  generatedAt: number;
}

export type SelectionDecision = 'include' | 'exclude';
export interface KnowledgeFeatureSelection {
  featureId: string;
  targetId: string;
  targetKind: 'bundle' | 'entry';
  decision: SelectionDecision;
}

/** Ergebnis der Relevanz-Auswertung für eine Feature-Phase. */
export interface ResolvedSelection {
  autoIncluded: string[];   // vom Score vorgeschlagen
  userIncluded: string[];   // manuell hinzugenommen
  userExcluded: string[];   // manuell entfernt
  effective: string[];      // finale IDs (auto ∪ userIncluded) \ userExcluded
}
```

## Pure Funktionen (testbar, keine IO)

| Funktion | Signatur (vereinfacht) | Zweck / Requirement |
|----------|------------------------|---------------------|
| `buildKnowledgeTree` | `(bundles, entries) → KnowledgeTree` | Baum aus flachen Zeilen; Zyklen abweisen. FR-003 |
| `projectIndex` | `(bundles, entries, now) → KnowledgeIndex` | Projektion ohne Inhalte, Eltern vor Kindern. FR-005/FR-006 |
| `scoreRelevance` | `(index, signal:string) → {id,score}[]` | deterministisch: Tag-Exakttreffer + Text-Token-Overlap. FR-009/D4 |
| `resolveSelection` | `(scored, selections, threshold) → ResolvedSelection` | Auto-Vorschlag ⊕ Overrides. FR-010 |
| `detectCycle` | `(bundles, id, newParentId) → boolean` | Verschachtelungs-Validierung |

## Validierungsregeln

- `name`/`title`: nicht leer nach Trim.
- `applicability_tags`: JSON-Array aus getrimmten, nicht-leeren Strings; Duplikate entfernt.
- `parent_id`/`bundle_id`: müssen existieren und **demselben Projekt** gehören (FR-002); `parent_id` darf keinen Zyklus erzeugen (`detectCycle`).
- `source='file'` ⇒ `source_path` gesetzt, repo-relativ, kein `..`-Traversal (Muster wie Pfad-Guards in `api/server.ts`); `source='inline'` ⇒ `source_path = NULL`.
- Löschen eines Bundles kaskadiert auf Unter-Bundles und Einträge (DB-CASCADE).
- Titel-Duplikate innerhalb eines Projekts sind erlaubt (Spec-Edge-Case) — Anzeige disambiguiert über Pfad/Bundle.

## Zustands-/Lebenszyklus-Notizen

- Kein Status-Enum auf Wissen (keine Workflow-Zustände) — nur `updated_at` für Änderungsverfolgung.
- **Index-„Aktualisierung"** ist kein Schreibvorgang, sondern Neu-Projektion (D2) → FR-006/SC-005 by construction.
- **Materialisierte Kopie** (`.sdd/knowledge/` im Worktree, D5) ist der einzige abgeleitete Zustand außerhalb der DB; wird bei jedem Phasenstart neu geschrieben und ist über Re-Sync (FR-013) reproduzierbar.
