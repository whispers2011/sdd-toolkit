import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ArtifactStepSpec,
  Feature,
  FeatureArtifact,
  FeatureArtifactFile,
  FeatureArtifactStep,
  FeaturePhase,
  Project,
} from '@sdd/shared';
import { ARTIFACT_STEP_SPECS, artifactFileLabel, artifactStepSpec, featureLock } from '@sdd/shared';

/** Basisverzeichnis der Ergebnis-Artefakte: Feature-Worktree bevorzugt, sonst Haupt-Checkout. */
function featureSpecsDir(project: Project, feature: Feature): string {
  const base = feature.worktreePath ?? project.path;
  return join(base, 'specs', feature.name);
}

/** Vorhandene Dateien eines Schritts ermitteln (Primärdatei + Begleiter + Verzeichnis-Globs). */
function enumerateFiles(dir: string, spec: ArtifactStepSpec): FeatureArtifactFile[] {
  const rels: string[] = [];
  if (spec.primaryRelPath && existsSync(join(dir, spec.primaryRelPath))) rels.push(spec.primaryRelPath);
  for (const rel of spec.companionRelPaths) {
    if (existsSync(join(dir, rel))) rels.push(rel);
  }
  for (const g of spec.globDirs) {
    const gdir = join(dir, g);
    if (!existsSync(gdir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(gdir).sort();
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.md')) continue;
      const rel = `${g}/${name}`;
      try {
        if (statSync(join(dir, rel)).isFile()) rels.push(rel);
      } catch {
        /* skip unlesbar */
      }
    }
  }
  return rels.map((rel) => ({ id: rel, label: artifactFileLabel(rel), relPath: rel }));
}

/** Alle artefakt-erzeugenden Schritte des Features samt Verfügbarkeit (steuert Kachel-Icons). */
export function listFeatureArtifactSteps(project: Project, feature: Feature): FeatureArtifactStep[] {
  const dir = featureSpecsDir(project, feature);
  return ARTIFACT_STEP_SPECS.map((spec) => {
    const files = enumerateFiles(dir, spec);
    return {
      phase: spec.phase,
      label: spec.label,
      tooltip: spec.tooltip,
      available: files.length > 0,
      files,
    };
  });
}

export type ArtifactErrorCode = 'not_found' | 'locked' | 'conflict';

export class ArtifactError extends Error {
  constructor(
    public readonly code: ArtifactErrorCode,
    message: string,
    public readonly current?: { content: string; mtimeMs: number },
  ) {
    super(message);
    this.name = 'ArtifactError';
  }
}

/** Inhalt einer Artefakt-Datei lesen (immer erlaubt, auch bei laufender Phase). */
export async function readFeatureArtifact(
  project: Project,
  feature: Feature,
  phase: FeaturePhase,
  fileId?: string,
): Promise<FeatureArtifact> {
  const spec = artifactStepSpec(phase);
  if (!spec) throw new ArtifactError('not_found', `Schritt '${phase}' erzeugt kein Ergebnis-Artefakt.`);
  const dir = featureSpecsDir(project, feature);
  const files = enumerateFiles(dir, spec);
  const { locked, reason } = featureLock(feature);
  const chosen = (fileId ? files.find((f) => f.id === fileId) : undefined) ?? files[0] ?? null;

  if (!chosen) {
    return {
      featureId: feature.id,
      phase,
      fileId: fileId ?? '',
      label: spec.label,
      path: null,
      content: null,
      mtimeMs: null,
      exists: false,
      locked,
      lockReason: reason,
      files,
    };
  }

  const abs = join(dir, chosen.relPath);
  try {
    const content = await readFile(abs, 'utf8');
    const mtimeMs = statSync(abs).mtimeMs;
    return {
      featureId: feature.id,
      phase,
      fileId: chosen.id,
      label: chosen.label,
      path: abs,
      content,
      mtimeMs,
      exists: true,
      locked,
      lockReason: reason,
      files,
    };
  } catch {
    return {
      featureId: feature.id,
      phase,
      fileId: chosen.id,
      label: chosen.label,
      path: abs,
      content: null,
      mtimeMs: null,
      exists: false,
      locked,
      lockReason: reason,
      files,
    };
  }
}

/** Bearbeiteten Inhalt zurückschreiben; sperr- (FR-011) und konflikt-geschützt (FR-014). */
export async function writeFeatureArtifact(
  project: Project,
  feature: Feature,
  phase: FeaturePhase,
  fileId: string,
  body: { content: string; baseMtimeMs: number; overwrite?: boolean },
): Promise<{ mtimeMs: number }> {
  const spec = artifactStepSpec(phase);
  if (!spec) throw new ArtifactError('not_found', `Schritt '${phase}' erzeugt kein Ergebnis-Artefakt.`);

  const dir = featureSpecsDir(project, feature);
  const chosen = enumerateFiles(dir, spec).find((f) => f.id === fileId);
  if (!chosen) throw new ArtifactError('not_found', 'Ergebnis-Datei nicht gefunden.');

  const { locked, reason } = featureLock(feature);
  if (locked) throw new ArtifactError('locked', reason ?? 'Bearbeiten ist gesperrt.');

  const abs = join(dir, chosen.relPath);
  const currentMtime = statSync(abs).mtimeMs;
  if (!body.overwrite && currentMtime !== body.baseMtimeMs) {
    const current = await readFile(abs, 'utf8');
    throw new ArtifactError('conflict', 'Die Datei wurde seit dem Öffnen extern geändert.', {
      content: current,
      mtimeMs: currentMtime,
    });
  }

  await writeFile(abs, body.content, 'utf8');
  return { mtimeMs: statSync(abs).mtimeMs };
}
