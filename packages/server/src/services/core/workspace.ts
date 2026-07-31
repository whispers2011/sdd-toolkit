import { existsSync } from 'node:fs';
import type { Project } from '@sdd/shared';
import type { WorktreeManager } from '../../git/worktrees.js';

/**
 * Auftrag, eine Arbeitskopie sicherzustellen (FR-003).
 *
 * Die Unterschiede beider Pfade stehen hier als Daten, nicht als zweite Ausschrift
 * derselben Aufgabe: der Phasen-Pfad benennt sie nach dem Feature-Slug, der Chat
 * nach seiner Unterhaltung.
 */
export interface WorkspaceSpec {
  project: Project;
  /** Verzeichnisname der Arbeitskopie (`<slug>` bzw. `chat-<conversationId>`). */
  name: string;
  /** Zweigname (`feature/<slug>` bzw. `chat/<conversationId>`). */
  branch: string;
  /** Zuletzt bekannter Pfad; fehlt er auf der Platte, wird der Eintrag aufgeräumt. */
  recordedPath: string | null;
}

/**
 * Arbeitskopie anlegen oder die vorhandene übernehmen; liefert den echten Pfad.
 *
 * Idempotent (W1) und je (Repo, Zweig) serialisiert (W3) — beides ererbt von
 * `WorktreeManager.create`, das bewusst nicht ersetzt wird.
 *
 * Der Teil, den bisher nur der Phasen-Pfad hatte, ist die Waisen-Erholung (W2):
 * Steht ein Pfad in der Datenbank, fehlt das Verzeichnis aber auf der Platte (manuell
 * gelöscht, Datenverzeichnis umgezogen), scheitert `worktree add` an einem
 * Registry-Eintrag, den niemand mehr sieht. Er wird darum vorher best-effort entfernt.
 *
 * Wirft roh (W4): das Einkleiden in ein Fehlerbild ist Sache des Aufrufers — der Chat
 * antwortet mit `ChatError(503, …)`, der Phasen-Pfad gar nicht. Und die Funktion
 * vermerkt den Pfad nirgends (W5); das tut der Aufrufer.
 *
 * Was NICHT hierher gehört: die Lebenszyklus-Auslöser `before_worktree_create` und
 * `after_worktree_create`. Sie klammern die Anlage im Phasen-Pfad
 * (`Orchestrator.prepareWorktree`), brauchen ein Feature und gelten für den Chat nicht.
 */
export async function ensureWorkspace(
  worktrees: WorktreeManager,
  spec: WorkspaceSpec,
): Promise<string> {
  const { project, name, branch, recordedPath } = spec;

  if (recordedPath && !existsSync(recordedPath)) {
    await worktrees.remove(project.path, recordedPath).catch(() => {});
  }

  return worktrees.create({
    project,
    projectPath: project.path,
    featureName: name,
    branch,
    defaultBranch: project.defaultBranch,
  });
}
