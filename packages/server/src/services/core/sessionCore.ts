import type { AutomationSettings, Project } from '@sdd/shared';
import type { SessionRepo } from '../../db/repos.js';
import type { WorktreeManager } from '../../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../../pty/sessionManager.js';
import { locateTranscript } from '../../pty/transcriptWatcher.js';
import { buildClaudeArgv } from '../../pty/commandBuilder.js';
import { ensureWorkspace, type WorkspaceSpec } from './workspace.js';

/** Die beiden Stellen, an denen ein Pfad sein eigenes Fehlerbild einsetzen darf. */
export type SpawnStage = 'worktree' | 'spawn';

/**
 * Auftrag, eine Session sicherzustellen (FR-004). Er nimmt die Unterschiede beider
 * Pfade als Daten auf — Bezugsobjekt, Namensbildung, System-Prompt, Fehlerdarstellung —
 * damit die Aufgabe selbst kein zweites Mal ausgeschrieben werden muss.
 */
export interface SessionSpec {
  project: Project;
  featureId: string | null;
  conversationId: string | null;
  kind: 'feature' | 'chat_work';
  /** Bereits laufende Session dieses Bezugsobjekts — dann passiert nichts weiter (FR-016). */
  existing: LiveSession | undefined;
  /**
   * Arbeitskopie bereitstellen. Der Regelfall ist ein Auftrag (`WorkspaceSpec`), den
   * der Kern über `ensureWorkspace` ausführt — so macht es der Chat.
   *
   * Der Phasen-Pfad gibt stattdessen eine Funktion mit: er klammert die Anlage in
   * seine Lebenszyklus-Auslöser (`before_worktree_create` / `after_worktree_create`),
   * die ein Feature brauchen und für den Chat nicht gelten. Sie ruft `ensureWorkspace`
   * selbst — die Anlage-Regel bleibt also eine einzige Implementierung (FR-003).
   */
  workspace: WorkspaceSpec | (() => Promise<string>);
  /** Resume-Kandidat aus der `sessions`-Tabelle. */
  previous: { id: string; claude_session_id: string | null } | null;
  /** Aufgelöst global → Projekt → Feature; bestimmt den Berechtigungsmodus (FR-015). */
  automation: AutomationSettings;
  appendSystemPrompt?: string;
  model?: string;
  /** Pfad beim Bezugsobjekt vermerken (der Kern schreibt selbst nichts zurück). */
  onWorktreeReady?: (path: string) => void;
  /** Fehlerdarstellung des Pfads (FR-005); ohne sie fliegt der rohe Fehler. */
  wrapError?: (stage: SpawnStage, err: Error) => Error;
}

/**
 * Session sicherstellen — die Aufgabe aus FR-001, ab jetzt an einer Stelle.
 *
 * Der Doppelstart-Schutz ist der Grund, warum es diesen Baustein gibt: Zwischen der
 * Prüfung „läuft schon eine?" und dem Spawn liegt ein `await` auf die Worktree-Anlage.
 * Zwei gleichzeitige Aufrufe lasen beide „keine Session" und spawnten beide eine — am
 * 28.07.2026 fünfmal beobachtet, zuletzt mit zwei arbeitenden Claude-Prozessen in
 * derselben Arbeitskopie. Der Schutz existierte danach in beiden Pfaden, aber zweimal.
 */
export class SessionCore {
  private inFlight = new Map<string, Promise<LiveSession>>();

  constructor(
    private deps: { sessions: SessionRepo; ptys: PtySessionManager; worktrees: WorktreeManager },
  ) {}

  /**
   * Höchstens ein Vorgang je `key`; der zweite Aufrufer bekommt das laufende Versprechen.
   *
   * `resolve` wird INNERHALB des Schutzes gerufen, nicht davor: Zwischen dem ersten und
   * dem zweiten gleichzeitigen Aufruf kann sich der Zustand geändert haben (Neustart,
   * gelöschte Arbeitskopie). Ein vorab gebauter Auftrag würde den zweiten Aufrufer mit
   * veralteten Daten bedienen. Die Auflösefunktion trägt zugleich die pfadspezifischen
   * Vorprüfungen und darf werfen.
   */
  ensure(key: string, resolve: () => SessionSpec | Promise<SessionSpec>): Promise<LiveSession> {
    const laufend = this.inFlight.get(key);
    if (laufend) return laufend;
    const p = this.ensureUnlocked(resolve).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private async ensureUnlocked(
    resolve: () => SessionSpec | Promise<SessionSpec>,
  ): Promise<LiveSession> {
    const spec = await resolve();
    if (spec.existing) return spec.existing;

    let worktreePath: string;
    try {
      worktreePath =
        typeof spec.workspace === 'function'
          ? await spec.workspace()
          : await ensureWorkspace(this.deps.worktrees, spec.workspace);
    } catch (err) {
      throw spec.wrapError?.('worktree', err as Error) ?? err;
    }
    spec.onWorktreeReady?.(worktreePath);

    // Resume-Recovery: nie blind auf eine tote Session-Kennung resumen — erst prüfen,
    // ob das Transkript-JSONL noch existiert (Claude räumt nach ~30 Tagen auf). Fehlt es,
    // wird die Kennung auch in der Datenbank genullt (FR-014).
    const prev = spec.previous;
    let resumeId = prev?.claude_session_id ?? undefined;
    if (resumeId && prev && !locateTranscript(worktreePath, resumeId)) {
      this.deps.sessions.setClaudeSessionId(prev.id, null);
      resumeId = undefined;
    }

    // Auto-Modus an → bypassPermissions (keine Kommando-/Tool-Rückfragen),
    // aus → acceptEdits (nur Edits, Kommandos fragen nach).
    const argv = buildClaudeArgv({
      ...(resumeId ? { resume: resumeId } : {}),
      settingsPath: '__SETTINGS__',
      ...(spec.appendSystemPrompt ? { appendSystemPrompt: spec.appendSystemPrompt } : {}),
      ...(spec.model ? { model: spec.model } : {}),
      permissionMode: spec.automation.autoMode ? 'bypassPermissions' : 'acceptEdits',
    });

    let session: LiveSession;
    try {
      session = await this.deps.ptys.spawn({
        projectId: spec.project.id,
        featureId: spec.featureId,
        conversationId: spec.conversationId,
        kind: spec.kind,
        cwd: worktreePath,
        argv,
        withHooks: true,
      });
    } catch (err) {
      throw spec.wrapError?.('spawn', err as Error) ?? err;
    }

    this.deps.sessions.create({
      id: session.id,
      featureId: spec.featureId,
      conversationId: spec.conversationId,
      projectId: spec.project.id,
      kind: spec.kind,
      pid: session.pty.pid,
    });
    return session;
  }
}
