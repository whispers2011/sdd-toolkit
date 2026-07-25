import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import {
  resolveSelection,
  scoreRelevance,
  type Feature,
  type KnowledgeEntry,
  type KnowledgeIndex,
  type KnowledgeIndexItem,
  type Project,
  type ResolvedSelection,
} from '@sdd/shared';
import type { KnowledgeRepo } from '../db/knowledgeRepo.js';
import type { FeatureRepo, ProjectRepo } from '../db/repos.js';

export interface KnowledgeServiceDeps {
  knowledge: KnowledgeRepo;
  projects: ProjectRepo;
  features: FeatureRepo;
}

export interface MaterializeResult {
  indexPath: string | null;
  materialized: { id: string; path: string }[];
  resolved: ResolvedSelection;
  /** Kurzer Pointer, den der Orchestrator an die Phasen-Prompt anhängt. */
  preamble: string;
}

const KNOWLEDGE_DIR = join('.sdd', 'knowledge');

export class KnowledgeService {
  constructor(private deps: KnowledgeServiceDeps) {}

  // ---------- Import bestehender Repo-Dateien (FR-015) ----------

  importFromFile(
    projectId: string,
    input: { bundleId: string | null; sourcePath: string; title?: string | undefined; applicability: { text: string; tags: string[] } },
  ): KnowledgeEntry {
    const project = this.mustProject(projectId);
    const rel = this.safeRepoRelative(project.path, input.sourcePath);
    const abs = join(project.path, rel);
    if (!existsSync(abs)) throw new Error(`Datei nicht gefunden: ${rel}`);
    const body = readFileSync(abs, 'utf8');
    const title = input.title?.trim() || (rel.split('/').at(-1) ?? rel);
    return this.deps.knowledge.createEntry(projectId, {
      bundleId: input.bundleId,
      title,
      body,
      applicability: input.applicability,
      source: 'file',
      sourcePath: rel,
    });
  }

  refreshFromFile(entryId: string): KnowledgeEntry {
    const entry = this.deps.knowledge.getEntry(entryId);
    if (!entry) throw new Error(`Eintrag ${entryId} nicht gefunden`);
    if (entry.source !== 'file' || !entry.sourcePath) {
      throw new Error('Nur datei-basierte Einträge können aktualisiert werden');
    }
    const project = this.mustProject(entry.projectId);
    const abs = join(project.path, this.safeRepoRelative(project.path, entry.sourcePath));
    if (!existsSync(abs)) throw new Error(`Quelldatei fehlt: ${entry.sourcePath}`);
    return this.deps.knowledge.updateEntry(entryId, { body: readFileSync(abs, 'utf8') });
  }

  // ---------- Relevanz + Materialisierung (P4) ----------

  /** Signal = Feature-Name + spec.md (falls vorhanden) → Score je Index-Element. */
  suggestRelevance(feature: Feature): { index: KnowledgeIndex; scored: ReturnType<typeof scoreRelevance> } {
    const project = this.mustProject(feature.projectId);
    const root = feature.worktreePath ?? project.path;
    const specPath = join(root, 'specs', feature.name, 'spec.md');
    let signal = feature.name.replace(/-/g, ' ');
    if (existsSync(specPath)) {
      try {
        signal += '\n' + readFileSync(specPath, 'utf8');
      } catch {
        /* Spec unlesbar → nur Name als Signal */
      }
    }
    const index = this.deps.knowledge.index(feature.projectId);
    return { index, scored: scoreRelevance(index, signal) };
  }

  resolveForFeature(feature: Feature): { index: KnowledgeIndex; resolved: ResolvedSelection } {
    const { index, scored } = this.suggestRelevance(feature);
    const selections = this.deps.knowledge.listSelectionForFeature(feature.id);
    return { index, resolved: resolveSelection(scored, selections) };
  }

  /**
   * Schreibt das selektierte Wissen in den Feature-Worktree (`.sdd/knowledge/`),
   * git-excluded. Immer `index.md`; Inhalte nur für `effective`-Elemente.
   */
  materializeForFeature(feature: Feature): MaterializeResult {
    const project = this.mustProject(feature.projectId);
    const root = feature.worktreePath ?? project.path;
    const { index, resolved } = this.resolveForFeature(feature);

    if (index.items.length === 0) {
      return { indexPath: null, materialized: [], resolved, preamble: '' };
    }

    const dir = join(root, KNOWLEDGE_DIR);
    mkdirSync(join(dir, 'bundles'), { recursive: true });
    mkdirSync(join(dir, 'entries'), { recursive: true });

    const effective = new Set(resolved.effective);
    const materialized: { id: string; path: string }[] = [];

    // Inhalte nur für relevante Elemente schreiben.
    for (const entry of this.deps.knowledge.listEntriesByProject(feature.projectId)) {
      if (!effective.has(entry.id) || entry.source === 'file') continue;
      const rel = join(KNOWLEDGE_DIR, 'entries', `${entry.id}.md`);
      writeFileSync(join(root, rel), `# ${entry.title}\n\n${entry.body}\n`);
      materialized.push({ id: entry.id, path: rel });
    }
    for (const bundle of this.deps.knowledge.listBundles(feature.projectId)) {
      if (!effective.has(bundle.id)) continue;
      const rel = join(KNOWLEDGE_DIR, 'bundles', `${bundle.id}.md`);
      writeFileSync(
        join(root, rel),
        `# Bundle: ${bundle.name}\n\nAnwendbarkeit: ${bundle.applicability.text || '—'}\nTags: ${bundle.applicability.tags.join(', ') || '—'}\n`,
      );
      materialized.push({ id: bundle.id, path: rel });
    }

    const indexRel = join(KNOWLEDGE_DIR, 'index.md');
    writeFileSync(join(root, indexRel), renderIndexMd(index, effective));

    this.ensureGitExcluded(root, '.sdd/');

    return {
      indexPath: indexRel,
      materialized,
      resolved,
      preamble:
        `\n\n[Projektwissen] Konsultiere zuerst \`${indexRel}\` und lies NUR die dort als ` +
        `**[relevant]** markierten Bundles/Einträge — nicht den gesamten Kontext einlesen.`,
    };
  }

  // ---------- Helpers ----------

  private mustProject(id: string): Project {
    const p = this.deps.projects.get(id);
    if (!p) throw new Error(`Projekt ${id} nicht gefunden`);
    return p;
  }

  /** Repo-relativen Pfad validieren: kein Traversal, kein absoluter Pfad. */
  private safeRepoRelative(projectPath: string, sourcePath: string): string {
    const rel = normalize(sourcePath).replace(/^\.\//, '');
    if (isAbsolute(sourcePath) || rel.startsWith('..') || rel.split(sep).includes('..')) {
      throw new Error(`Ungültiger Pfad (Traversal): ${sourcePath}`);
    }
    const abs = resolve(projectPath, rel);
    const base = resolve(projectPath);
    if (abs !== base && !abs.startsWith(base + sep)) {
      throw new Error(`Pfad liegt außerhalb des Projekts: ${sourcePath}`);
    }
    return rel;
  }

  /** `.sdd/` lokal aus git ausschließen — ohne das Repo-.gitignore anzufassen. */
  private ensureGitExcluded(worktreeRoot: string, pattern: string): void {
    try {
      const excludePath = join(worktreeRoot, '.git', 'info', 'exclude');
      const cur = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
      if (!cur.includes(pattern)) appendFileSync(excludePath, `\n${pattern}\n`);
    } catch {
      /* Worktree-.git ist eine Datei (gitdir-Redirect) — best effort */
    }
  }
}

/** Rendert den kompakten Index als Markdown (alle Elemente, Relevante markiert). */
function renderIndexMd(index: KnowledgeIndex, effective: Set<string>): string {
  const depth = new Map<string, number>();
  const lines: string[] = [
    '# Projektspezifischer Wissens-Index',
    '',
    '> Lies ZUERST diesen Index. Lade Inhalte NUR für die als **[relevant]** markierten Elemente',
    '> (Dateien unter .sdd/knowledge/… bzw. den angegebenen Repo-Pfad). Nicht alles einlesen.',
    '',
  ];
  for (const item of index.items) {
    const d = item.parentId != null ? (depth.get(item.parentId) ?? 0) + 1 : 0;
    depth.set(item.id, d);
    lines.push(`${'  '.repeat(d)}- ${renderIndexItem(item, effective.has(item.id))}`);
  }
  return lines.join('\n') + '\n';
}

function renderIndexItem(item: KnowledgeIndexItem, relevant: boolean): string {
  const mark = relevant ? '**[relevant]** ' : '';
  const kind = item.kind === 'bundle' ? 'Bundle' : 'Eintrag';
  const app = item.applicability.text ? ` — Anwendbarkeit: ${item.applicability.text}` : '';
  const tags = item.applicability.tags.length ? ` · Tags: ${item.applicability.tags.join(', ')}` : '';
  let ref = '';
  if (relevant) {
    if (item.kind === 'bundle') ref = ` → .sdd/knowledge/bundles/${item.id}.md`;
    else if (item.sourcePath) ref = ` → Repo-Datei: ${item.sourcePath}`;
    else ref = ` → .sdd/knowledge/entries/${item.id}.md`;
  }
  return `${mark}${kind} „${item.label}"${app}${tags}${ref}`;
}
