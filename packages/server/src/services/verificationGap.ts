/**
 * Der Aufmerksamkeits-Eintrag „dieses Projekt hat keine Verifikation
 * konfiguriert" — Entstehen und Vergehen an genau einer Stelle.
 *
 * Die Lebensdauer ist bewusst NICHT an eine Integrationsstufe gekoppelt
 * (`featureId === null`, kein Eintrag in `STAGE_FOR_KIND`): die Lücke gilt dem
 * Projekt und überlebt jeden Stufenwechsel jedes Features (FR-006). Einzige
 * Quelle der Wahrheit ist die `attention`-Tabelle — kein zweites Flag daneben.
 */
import type { AttentionItem, Project } from '@sdd/shared';
import type { AttentionRepo, ProjectRepo } from '../db/repos.js';

const KIND = 'verification_unconfigured' as const;

/** Wortlaut nach FR-004 — die Lücke wird benannt, nicht bewertet. */
function message(project: Project): string {
  return `${project.name}: Projekt hat keine Verifikation konfiguriert — Features werden ungeprüft integriert.`;
}

/**
 * Die Lücke melden, falls sie besteht und noch nie gemeldet wurde (FR-004, FR-005).
 *
 * `hasEver` statt der Offen-Dedup von `raise()`: wer die Meldung abhakt,
 * verzichtet auf die Erinnerung — sie darf beim nächsten Feature nicht erneut
 * erscheinen (Clarification). Aufgerufen am Punkt der Verifikation, nicht beim
 * Setzen der Stufe: ein Versuch, der an einer Vorprüfung scheitert, meldet nichts.
 *
 * @returns den neuen Eintrag, oder `null`, wenn nichts zu melden war.
 */
export function raiseVerificationGap(args: {
  attention: Pick<AttentionRepo, 'raise' | 'hasEver'>;
  project: Project;
}): AttentionItem | null {
  const { attention, project } = args;
  if (project.verifyCommands.length > 0) return null;
  if (attention.hasEver({ kind: KIND, projectId: project.id })) return null;
  return attention.raise({
    kind: KIND,
    projectId: project.id,
    featureId: null,
    message: message(project),
  });
}

/**
 * Einträge aller Projekte auflösen, die inzwischen mindestens ein
 * Verifikationskommando haben (FR-007) — ohne menschliches Zutun.
 *
 * Läuft im bestehenden Reconcile-Durchlauf und damit auf dem Lesepfad: das wirkt
 * auch nach einem Neustart und bei Konfigurationsänderungen, die nicht über
 * `PATCH /api/projects/:id` kommen. `forget` löscht die Zeilen, damit ein
 * späteres Leeren der Konfiguration wieder melden darf.
 *
 * @returns die IDs der zuvor offenen Einträge (für `attention_resolved`).
 */
export function resolveVerificationGaps(args: {
  attention: Pick<AttentionRepo, 'forget'>;
  projects: Pick<ProjectRepo, 'list'>;
}): string[] {
  const resolved: string[] = [];
  for (const project of args.projects.list()) {
    if (project.verifyCommands.length === 0) continue;
    resolved.push(...args.attention.forget({ kind: KIND, projectId: project.id }));
  }
  return resolved;
}
