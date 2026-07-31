import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  DOCUMENTS_DIR_NAME,
  DOCUMENTS_MANIFEST,
  DOCUMENT_MANIFEST_VERSION,
  MAX_DOCUMENTS_PER_FEATURE,
  MAX_DOCUMENT_BYTES,
  reasonEmpty,
  reasonTooMany,
  reasonUnsafeName,
  reasonWriteFailed,
  type DocumentManifest,
  type Feature,
  type FeatureDocument,
  type Project,
  type RejectedDocument,
} from '@sdd/shared';
import type { FeatureRepo, ProjectRepo } from '../db/repos.js';
import { git } from '../git/git.js';
import { resolveInside, sanitizeFilename, uniqueFilename } from './safeFilename.js';

/**
 * Ablage der beim Anlegen mitgegebenen Dokumente: `specs/<slug>/docs/` im
 * Feature-Worktree, Manifest daneben, sofort committet (R1/R2). Gegenstück zu
 * `jiraImportService.writeTicketMaterial()`, mit dem es sich die Dateinamen-
 * Härtung teilt.
 */

/** Eine Datei aus dem multipart-Strom — wird direkt auf Disk geschrieben, nie gepuffert. */
export interface IncomingDocument {
  filename: string;
  mimeType: string;
  /** `truncated` setzt @fastify/multipart, sobald die Größengrenze griff (R6). */
  stream: Readable & { truncated?: boolean };
}

export interface FeatureDocumentsDeps {
  projects: Pick<ProjectRepo, 'get'>;
  features: Pick<FeatureRepo, 'get'>;
}

export class FeatureDocumentsService {
  constructor(private readonly deps: FeatureDocumentsDeps) {}

  /**
   * Dokumente aus dem laufenden multipart-Strom übernehmen. Wirft nur, wenn gar
   * nichts abgelegt werden kann (kein Worktree) — Fehler einzelner Dateien landen
   * in `rejected`, damit das Feature nutzbar bleibt (FR-014).
   */
  async writeDocuments(
    feature: Feature,
    parts: AsyncIterable<IncomingDocument>,
  ): Promise<{ documents: FeatureDocument[]; rejected: RejectedDocument[] }> {
    if (!feature.worktreePath) throw new Error('Feature hat keinen Worktree — Dokumente nicht ablegbar');
    const dir = join(feature.worktreePath, 'specs', feature.name, DOCUMENTS_DIR_NAME);

    const documents: FeatureDocument[] = [];
    const rejected: RejectedDocument[] = [];
    const used = new Set<string>();
    let dirReady = false;

    for await (const part of parts) {
      const display = part.filename || 'dokument';

      if (documents.length >= MAX_DOCUMENTS_PER_FEATURE) {
        await drain(part.stream);
        rejected.push({ name: display, reason: reasonTooMany(display) });
        continue;
      }

      const storedName = uniqueFilename(sanitizeFilename(part.filename), used);
      if (!dirReady) {
        mkdirSync(dir, { recursive: true });
        dirReady = true;
      }
      // Gürtel plus Hosenträger: der bereinigte Name darf den Ordner nicht verlassen (FR-005).
      const target = resolveInside(dir, storedName);
      if (!target) {
        await drain(part.stream);
        rejected.push({ name: display, reason: reasonUnsafeName(display) });
        continue;
      }

      try {
        await pipeline(part.stream, createWriteStream(target));
      } catch (err) {
        discard(target);
        rejected.push({ name: display, reason: reasonWriteFailed(display, (err as Error).message) });
        continue;
      }

      // Größe und Abschneidung erst NACH dem Strom feststellbar (R6).
      if (part.stream.truncated) {
        discard(target);
        rejected.push({ name: display, reason: reasonTruncated(display) });
        continue;
      }
      const bytes = statSync(target).size;
      if (bytes === 0) {
        discard(target);
        rejected.push({ name: display, reason: reasonEmpty(display) });
        continue;
      }

      documents.push({
        name: display,
        storedName,
        relPath: relDocPath(feature, storedName),
        bytes,
        mimeType: part.mimeType || 'application/octet-stream',
        uploadedAt: Date.now(),
      });
    }

    if (documents.length === 0) {
      // Nichts übernommen ⇒ keinen leeren Ordner zurücklassen (FR-017). Nur
      // löschen, wenn er leer ist — ein Ordner mit früherem Material bleibt.
      if (dirReady) {
        try {
          rmdirSync(dir);
        } catch {
          /* nicht leer oder schreibgeschützt — dann bleibt er stehen */
        }
      }
      return { documents, rejected };
    }

    try {
      const manifest: DocumentManifest = {
        version: DOCUMENT_MANIFEST_VERSION,
        documents: documents.map(({ relPath: _relPath, ...entry }) => entry),
      };
      writeFileSync(join(dir, DOCUMENTS_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    } catch (err) {
      console.warn('[documents] Manifest nicht geschrieben:', (err as Error).message);
    }

    await this.commit(feature);
    return { documents, rejected };
  }

  /**
   * Ordner und Manifest sofort festschreiben (R1): nur so überleben die Dokumente
   * einen neu aufgesetzten Worktree und bleiben nach dem Merge nachvollziehbar.
   * Ein fehlgeschlagener Commit macht das Feature nicht unbrauchbar — die Dateien
   * liegen bereits im Worktree.
   */
  private async commit(feature: Feature): Promise<void> {
    if (!feature.worktreePath) return;
    const relDir = `specs/${feature.name}/${DOCUMENTS_DIR_NAME}`;
    try {
      const add = await git(feature.worktreePath, ['add', '--', relDir]);
      if (add.code !== 0) throw new Error(add.stderr.trim() || 'git add fehlgeschlagen');
      const commit = await git(feature.worktreePath, [
        'commit',
        '-m',
        `docs(${feature.name}): Ausgangsmaterial hinterlegt`,
        '--',
        relDir,
      ]);
      if (commit.code !== 0) throw new Error(commit.stderr.trim() || commit.stdout.trim());
    } catch (err) {
      console.warn(`[documents] ${feature.name}: Commit übersprungen — ${(err as Error).message}`);
    }
  }

  /**
   * Hinterlegte Dokumente eines Features. Quelle ist das Manifest; Einträge ohne
   * vorhandene Datei werden ausgelassen. Unlesbares oder ungültiges Manifest ⇒
   * leere Liste, nie ein Fehler (best-effort wie `knowledgePreambleFor`).
   */
  listDocuments(featureId: string): FeatureDocument[] {
    const feature = this.deps.features.get(featureId);
    if (!feature) return [];
    const project = this.deps.projects.get(feature.projectId);
    if (!project) return [];
    return readManifest(docsDir(project, feature), feature);
  }

  /** Absoluter Pfad eines gelisteten Dokuments — nur aus dem Manifest, nie aus der Eingabe (FR-005). */
  documentPath(featureId: string, storedName: string): string | null {
    const feature = this.deps.features.get(featureId);
    if (!feature) return null;
    const project = this.deps.projects.get(feature.projectId);
    if (!project) return null;
    const dir = docsDir(project, feature);
    const known = readManifest(dir, feature).find((d) => d.storedName === storedName);
    return known ? resolveInside(dir, known.storedName) : null;
  }
}

/** Ablageort: Feature-Worktree bevorzugt, nach dem Merge der Haupt-Checkout (SC-007). */
function docsDir(project: Project, feature: Feature): string {
  const base = feature.worktreePath ?? project.path;
  return join(base, 'specs', feature.name, DOCUMENTS_DIR_NAME);
}

/** Fundort relativ zur Worktree-Wurzel — genau der Pfad, den der Prompt nennt. */
function relDocPath(feature: Feature, storedName: string): string {
  return `specs/${feature.name}/${DOCUMENTS_DIR_NAME}/${storedName}`;
}

function readManifest(dir: string, feature: Feature): FeatureDocument[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, DOCUMENTS_MANIFEST), 'utf8'));
  } catch {
    return [];
  }
  const entries = (parsed as DocumentManifest | null)?.documents;
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e): e is FeatureDocument => typeof e?.storedName === 'string' && e.storedName.length > 0)
    .map((e) => ({
      name: typeof e.name === 'string' ? e.name : e.storedName,
      storedName: e.storedName,
      relPath: relDocPath(feature, e.storedName),
      bytes: typeof e.bytes === 'number' ? e.bytes : 0,
      mimeType: typeof e.mimeType === 'string' ? e.mimeType : 'application/octet-stream',
      uploadedAt: typeof e.uploadedAt === 'number' ? e.uploadedAt : 0,
    }))
    .filter((d) => existsSync(join(dir, d.storedName)));
}

/**
 * Abgelehnte Datei trotzdem leeren: ein nicht konsumierter Teil-Strom hält den
 * multipart-Parser an und der Request käme nie zum Ende.
 */
/** Angefangene Datei wegräumen — ein schreibgeschützter Ordner darf nicht zusätzlich werfen. */
function discard(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    /* best effort */
  }
}

async function drain(stream: Readable): Promise<void> {
  try {
    for await (const _chunk of stream) {
      /* verwerfen */
    }
  } catch {
    /* ein abgebrochener Strom ist hier ohne Folgen */
  }
}

/**
 * Grund für eine an der Grenze abgeschnittene Datei. Der Contract nennt die
 * echte Größe (`zu groß (30.0 MB, max. 25 MB)`) — die kennt nur der Dialog vor
 * dem Upload (FR-011). Am Strom ist nach dem Abschneiden nur noch bekannt, DASS
 * die Grenze überschritten wurde; die Meldung nennt daher Datei und Grenze.
 */
function reasonTruncated(name: string): string {
  return `${name}: zu groß (mehr als ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB)`;
}
