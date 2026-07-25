/**
 * Projektspezifisches Wissen (Feature "projektspezifisches-wissen").
 * Domänentypen + pure Logik: Baum-Aufbau, Index-Projektion, Relevanz-Scoring,
 * Selektions-Auflösung. Keine IO — alles testbar in Isolation.
 */

// ---------- Typen ----------

export type ApplicabilityTag = string;

/** Wann ein Bundle/Eintrag anzuwenden ist: Freitext + strukturierte Tags. */
export interface Applicability {
  text: string;
  tags: ApplicabilityTag[];
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
  children: KnowledgeTreeNode[];
  entries: KnowledgeEntry[];
}

export interface KnowledgeTree {
  roots: KnowledgeTreeNode[];
  looseEntries: KnowledgeEntry[];
}

/** Kompakte Projektion OHNE Inhalte (der „Index"). */
export interface KnowledgeIndexItem {
  id: string;
  kind: 'bundle' | 'entry';
  parentId: string | null;
  label: string;
  applicability: Applicability;
  /** Nur bei Einträgen mit source='file': repo-relativer Pfad. */
  sourcePath?: string | null;
}

export interface KnowledgeIndex {
  projectId: string;
  items: KnowledgeIndexItem[];
  generatedAt: number;
}

export type SelectionDecision = 'include' | 'exclude';

export interface KnowledgeFeatureSelection {
  featureId: string;
  targetId: string;
  targetKind: 'bundle' | 'entry';
  decision: SelectionDecision;
}

export interface ScoredItem {
  id: string;
  score: number;
}

/** Ergebnis der Relevanz-Auswertung für eine Feature-Phase. */
export interface ResolvedSelection {
  autoIncluded: string[];
  userIncluded: string[];
  userExcluded: string[];
  effective: string[];
}

export const DEFAULT_RELEVANCE_THRESHOLD = 1;

// ---------- Sortierung ----------

function byOrder<T extends { sortOrder: number; createdAt: number }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder || a.createdAt - b.createdAt;
}

// ---------- Baum ----------

/**
 * Baut aus flachen Zeilen den Wissensbaum. Bundles ohne (auffindbaren) Parent
 * gelten als Wurzeln; Einträge ohne (auffindbares) Bundle sind `looseEntries`.
 */
export function buildKnowledgeTree(
  bundles: KnowledgeBundle[],
  entries: KnowledgeEntry[],
): KnowledgeTree {
  const nodes = new Map<string, KnowledgeTreeNode>();
  for (const bundle of bundles) {
    nodes.set(bundle.id, { bundle, children: [], entries: [] });
  }

  const roots: KnowledgeTreeNode[] = [];
  for (const bundle of [...bundles].sort(byOrder)) {
    const node = nodes.get(bundle.id)!;
    const parent = bundle.parentId ? nodes.get(bundle.parentId) : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const looseEntries: KnowledgeEntry[] = [];
  for (const entry of [...entries].sort(byOrder)) {
    const parent = entry.bundleId ? nodes.get(entry.bundleId) : null;
    if (parent) parent.entries.push(entry);
    else looseEntries.push(entry);
  }

  return { roots, looseEntries };
}

/**
 * Würde das Umhängen von `id` unter `newParentId` einen Zyklus erzeugen?
 * true, wenn `newParentId === id` oder `id` ein Vorfahre von `newParentId` ist.
 */
export function detectCycle(
  bundles: KnowledgeBundle[],
  id: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === id) return true;
  const parentOf = new Map(bundles.map((b) => [b.id, b.parentId] as const));
  const seen = new Set<string>();
  let cur: string | null | undefined = newParentId;
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) break; // vorbestehender Zyklus — nicht hängenbleiben
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

// ---------- Index-Projektion ----------

/**
 * Der „Projekt-Index": kompakte Projektion über den Baum (Eltern vor Kindern),
 * OHNE Inhalte. Da abgeleitet, ist er per Konstruktion immer konsistent.
 */
export function projectIndex(
  bundles: KnowledgeBundle[],
  entries: KnowledgeEntry[],
  now: number,
): KnowledgeIndex {
  const tree = buildKnowledgeTree(bundles, entries);
  const items: KnowledgeIndexItem[] = [];

  const walk = (node: KnowledgeTreeNode): void => {
    items.push({
      id: node.bundle.id,
      kind: 'bundle',
      parentId: node.bundle.parentId,
      label: node.bundle.name,
      applicability: node.bundle.applicability,
    });
    for (const entry of node.entries) items.push(entryItem(entry));
    for (const child of node.children) walk(child);
  };
  for (const root of tree.roots) walk(root);
  for (const entry of tree.looseEntries) items.push(entryItem(entry));

  const projectId = bundles[0]?.projectId ?? entries[0]?.projectId ?? '';
  return { projectId, items, generatedAt: now };
}

function entryItem(entry: KnowledgeEntry): KnowledgeIndexItem {
  return {
    id: entry.id,
    kind: 'entry',
    parentId: entry.bundleId,
    label: entry.title,
    applicability: entry.applicability,
    sourcePath: entry.source === 'file' ? entry.sourcePath : null,
  };
}

// ---------- Relevanz ----------

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9äöüß]+/i)
      .filter((t) => t.length >= 3),
  );
}

/**
 * Deterministisches Relevanz-Scoring: exakter Tag-Treffer (Gewicht 2) plus
 * Freitext-Token-Overlap (Gewicht 1) gegen ein Signal (Feature-Name + Spec).
 */
export function scoreRelevance(index: KnowledgeIndex, signal: string): ScoredItem[] {
  const signalTokens = tokenize(signal);
  return index.items.map((item) => {
    let score = 0;
    for (const tag of item.applicability.tags) {
      const tagTokens = tokenize(tag);
      if (tagTokens.size > 0 && [...tagTokens].every((x) => signalTokens.has(x))) {
        score += 2;
      }
    }
    for (const token of tokenize(item.applicability.text)) {
      if (signalTokens.has(token)) score += 1;
    }
    return { id: item.id, score };
  });
}

/**
 * Verbindet den automatischen Vorschlag (Score ≥ Schwelle) mit den manuellen
 * Übersteuerungen des Nutzers zur finalen `effective`-Menge (hybrid).
 */
export function resolveSelection(
  scored: ScoredItem[],
  selections: KnowledgeFeatureSelection[],
  threshold: number = DEFAULT_RELEVANCE_THRESHOLD,
): ResolvedSelection {
  const autoIncluded = scored.filter((s) => s.score >= threshold).map((s) => s.id);
  const userIncluded = selections.filter((s) => s.decision === 'include').map((s) => s.targetId);
  const userExcluded = selections.filter((s) => s.decision === 'exclude').map((s) => s.targetId);

  const excluded = new Set(userExcluded);
  const effective = [...new Set([...autoIncluded, ...userIncluded])].filter((id) => !excluded.has(id));

  return { autoIncluded, userIncluded, userExcluded, effective };
}
