/**
 * Pure Domäne der Lebenszyklus-Schritte: Auslöser-Vergleich, Auflösung über die
 * drei Ebenen, Reihenfolge, Arbeitsverzeichnis und der Variablensatz.
 *
 * KEIN IO, keine Node-Importe — alles in Isolation testbar. Die Auflösungsregeln
 * spiegeln `resolveAgentsForTrigger` (agentSelect.ts) absichtlich Zeile für Zeile:
 * es entsteht kein zweites Bedienkonzept.
 */
import type {
  LifecycleContext,
  LifecycleStep,
  LifecycleStepFeatureDecision,
  LifecycleTrigger,
} from './types.js';

/** Zeitlimit eines Schritts ohne eigene Angabe — identisch mit den Verifikations-Kommandos. */
export const DEFAULT_STEP_TIMEOUT_MS = 15 * 60_000;

/**
 * Passt der konfigurierte Auslöser zum gefeuerten? Phase bzw. Stufe müssen bei
 * den Arten, die sie kennen, ebenfalls übereinstimmen.
 */
export function triggerMatches(configured: LifecycleTrigger, fired: LifecycleTrigger): boolean {
  if (configured.kind !== fired.kind) return false;
  if (fired.kind === 'before_phase' || fired.kind === 'after_phase') {
    return configured.phase === fired.phase;
  }
  if (fired.kind === 'before_stage' || fired.kind === 'after_stage') {
    return configured.stage === fired.stage;
  }
  return true;
}

/**
 * Ausführungsreihenfolge: globale Schritte zuerst, dann projektspezifische; je
 * Gruppe nach `sortOrder`, bei Gleichstand nach `name`.
 *
 * Die Gruppierung nach Ebene geht über die Agent-Sortierung hinaus, weil bei
 * Schritten die WIRKUNG von der Reihenfolge abhängt (erst installieren, dann
 * bauen). Ohne sie entschiede bei gleichem sortOrder der Name über die Ebene.
 * Dieselbe Ordnung steht im SQL des Repos.
 */
export function compareStepOrder(a: LifecycleStep, b: LifecycleStep): number {
  const levelA = a.projectId === null ? 0 : 1;
  const levelB = b.projectId === null ? 0 : 1;
  if (levelA !== levelB) return levelA - levelB;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name);
}

/**
 * Welche Schritte laufen für dieses Feature an diesem Auslöser?
 * Regeln: (1) Auslöser muss passen, (2) ein Per-Feature-'exclude' schlägt alles,
 * (3) ein 'include' erzwingt den Lauf auch bei deaktiviertem Schritt,
 * (4) sonst entscheidet `enabled`.
 */
export function resolveLifecycleSteps(
  steps: readonly LifecycleStep[],
  selection: ReadonlyMap<string, LifecycleStepFeatureDecision>,
  trigger: LifecycleTrigger,
): LifecycleStep[] {
  return steps
    .filter((s) => triggerMatches(s.trigger, trigger))
    .filter((s) => {
      const decision = selection.get(s.id);
      if (decision === 'exclude') return false;
      if (decision === 'include') return true;
      return s.enabled;
    })
    .sort(compareStepOrder);
}

/**
 * In welchem Verzeichnis läuft ein Auslöser? 'main' nur an den zwei Punkten, an
 * denen der Lebenszyklus per Definition keinen Worktree hat: vor der Anlage und
 * nach dem Cleanup der Abschluss-Stufe. Fehlt der Worktree sonst, ist das ein
 * behebbarer Infrastrukturfehler — kein Grund, still am falschen Ort zu laufen.
 */
export function lifecycleCwdKind(trigger: LifecycleTrigger): 'worktree' | 'main' {
  if (trigger.kind === 'before_worktree_create') return 'main';
  if (trigger.kind === 'after_stage' && trigger.stage === 'merged') return 'main';
  return 'worktree';
}

/**
 * DIE eine Stelle, an der Umgebungsvariablen für Schritte entstehen. Genau sechs
 * Schlüssel, immer alle vorhanden — nicht zutreffende Angaben sind der leere
 * String, nie ein Platzhalter und nie ein Wert aus einem anderen Vorgang. Damit
 * ist `set -u` in einem Kommando gefahrlos.
 *
 * Die zentrale Portvergabe ergänzt hier SDD_PORT_BASE und SDD_PROFILE; heute
 * darf sich kein Kommando darauf verlassen.
 */
export function buildLifecycleEnv(ctx: LifecycleContext): Record<string, string> {
  return {
    SDD_WORKTREE: ctx.worktreePath,
    SDD_PROJECT: ctx.projectName,
    SDD_FEATURE: ctx.featureName,
    SDD_BRANCH: ctx.branch,
    SDD_PHASE: ctx.phase ?? '',
    SDD_STAGE: ctx.stage ?? '',
  };
}

/**
 * Letzte `maxLines` Zeilen, hart auf `maxChars` gekappt — der Ausschnitt für das
 * Inbox-Item. Die vollständige Ausgabe bleibt über die Log-Datei des Laufs
 * erreichbar; hier hält nur ein kleiner Rest Speicher.
 */
export function tailLines(text: string, maxLines = 20, maxChars = 2000): string {
  const lines = text.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const tail = lines.slice(-maxLines).join('\n');
  return tail.length > maxChars ? tail.slice(tail.length - maxChars) : tail;
}
