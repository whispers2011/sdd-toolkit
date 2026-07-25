import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import {
  displayStatus,
  meter,
  parseSessionFeatures,
  resolveAutomation,
  type ChatConversation,
  type ChatFeatureProposal,
  type ChatWorkAdoptBlocked,
  type ChatWorkAdoptResult,
  type ChatWorkRestartNeedsConfirm,
  type ChatWorkRestartResult,
  type ChatWorkSessionInfo,
  type ChatWorktreeSync,
  type Feature,
  type Project,
  type SessionEffect,
} from '@sdd/shared';
import type { AttentionRepo, ChatRepo, ExecutionRepo, ProjectRepo, SessionRepo, SettingsRepo } from '../db/repos.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import { awaitingMessage, type Orchestrator } from './orchestrator.js';
import { locateTranscript } from '../pty/transcriptWatcher.js';
import { behindCount, git, isCleanWorkingTree } from '../git/git.js';
import { MergeEngine } from '../git/mergeEngine.js';
import { collectUnmergedChanges } from './unmergedChanges.js';
import { buildClaudeArgv } from '../pty/commandBuilder.js';
import { buildChatWorkSystemPrompt } from './chatWorkPrompt.js';
import { NotificationThrottle } from './notificationThrottle.js';
import { ChatError } from './chatService.js';
import { bus } from '../events.js';

/**
 * Ein Projekt-Chat ohne Aktivität für diese Dauer wird automatisch beendet, damit
 * keine Leerlauf-Session im Hintergrund weiterläuft. Der Verlauf bleibt erhalten:
 * Das Panel zeigt danach eine „Pausiert"-Karte (`workPaused`), über die der Nutzer
 * fortsetzen (`ensure()` → Scrollback-Snapshot + Claude-Resume) oder frisch beginnen kann.
 */
export const CHAT_IDLE_TIMEOUT_MS = 5 * 60_000;

export interface ChatWorkDeps {
  projects: ProjectRepo;
  chatRepo: ChatRepo;
  sessions: SessionRepo;
  attention: AttentionRepo;
  executions: ExecutionRepo;
  settings: SettingsRepo;
  worktrees: WorktreeManager;
  ptys: PtySessionManager;
  /** Feature-Anlage läuft über den kanonischen Pfad (Worktree, optional /speckit-specify). */
  orchestrator: Orchestrator;
  dataDir: string;
  model?: string;
}

/**
 * Projekt-Chat als vollwertige Claude-Code-Session: eine interaktive, persistente Session pro
 * Projekt in einer isolierten Worktree/Branch. Der Nutzer tippt direkt in die Konsole. Erkennt
 * die Session, dass sich aus der Unterhaltung Feature(s) herauskristallisieren, gibt sie einen
 * `<sdd:features>`-Marker aus — das Toolkit zeigt eine Bestätigungskarte, und bestätigte Features
 * werden über den normalen Weg (Orchestrator.createFeature) angelegt.
 */
export class ChatWorkService {
  private notify = new NotificationThrottle();
  /** Scrollback-Länge an der letzten Turn-Grenze — für Kosten-Metering pro Turn. */
  private turnStart = new Map<string, number>(); // sessionId → scrollback-Offset
  /** Offener Feature-Vorschlag je Unterhaltung (im Speicher; überlebt Panel-Öffnen). */
  private proposals = new Map<string, ChatFeatureProposal>(); // conversationId → Vorschlag
  /** Dedup: zuletzt verarbeiteter Marker je Unterhaltung. */
  private lastMarker = new Map<string, string>();
  /** Laufender Neustart je Projekt — koalesziert schnelle Doppelklicks (FR-008). */
  private restarting = new Map<string, Promise<ChatWorkRestartResult | ChatWorkRestartNeedsConfirm>>();
  /** Sessions, die für einen Neustart absichtlich beendet werden — kein Fehler-Alarm beim Exit. */
  private terminating = new Set<string>();
  /** Stand der Arbeitskopie je Unterhaltung, ermittelt beim Start/Fortsetzen der Session. */
  private syncState = new Map<string, ChatWorktreeSync>(); // conversationId → Stand
  private engine = new MergeEngine();

  constructor(private deps: ChatWorkDeps) {
    mkdirSync(join(deps.dataDir, 'logs'), { recursive: true });
  }

  // ---------- Session-Lifecycle ----------

  /** Session sicherstellen (idempotent): Worktree anlegen + interaktive Claude-Session spawnen. */
  async ensure(projectId: string): Promise<{ sessionId: string }> {
    const project = this.mustProject(projectId);
    const conv = this.deps.chatRepo.ensureActive(projectId, 'work');

    const existing = this.deps.ptys.forConversation(conv.id);
    if (existing) return { sessionId: existing.id };

    const worktreeName = `chat-${conv.id}`;
    const branch = this.branchFor(conv.id);
    let worktreePath: string;
    try {
      worktreePath = await this.deps.worktrees.create({
        projectId: project.id,
        projectPath: project.path,
        featureName: worktreeName,
        branch,
        defaultBranch: project.defaultBranch,
      });
    } catch (err) {
      throw new ChatError(503, `Arbeitskopie konnte nicht erstellt werden: ${(err as Error).message}`);
    }

    // Arbeitskopie an den Default-Branch heranführen, BEVOR die Session startet. Ohne das
    // bleibt der Chat-Branch für immer auf dem Commit stehen, an dem die Unterhaltung begann —
    // nach jedem Merge nach main argumentiert der Chat über veralteten Code und sein Diff
    // macht neuere Arbeit rückgängig.
    this.syncState.set(conv.id, await this.syncWorktree(project.id, worktreePath));

    // Resume-Recovery: nie blind auf eine tote Session-ID resumen.
    const prev = this.deps.sessions.latestForConversation(conv.id);
    let resumeId = prev?.claude_session_id ?? undefined;
    if (resumeId && prev && !locateTranscript(worktreePath, resumeId)) {
      this.deps.sessions.setClaudeSessionId(prev.id, null);
      resumeId = undefined;
    }

    const automation = resolveAutomation(this.deps.settings.getAutomation(), project.automation, {});
    const argv = buildClaudeArgv({
      ...(resumeId ? { resume: resumeId } : {}),
      settingsPath: '__SETTINGS__',
      appendSystemPrompt: buildChatWorkSystemPrompt(project),
      ...(this.deps.model ? { model: this.deps.model } : {}),
      permissionMode: automation.autoMode ? 'bypassPermissions' : 'acceptEdits',
    });

    let session: LiveSession;
    try {
      session = await this.deps.ptys.spawn({
        projectId: project.id,
        featureId: null,
        conversationId: conv.id,
        kind: 'chat_work',
        cwd: worktreePath,
        argv,
        withHooks: true,
      });
    } catch (err) {
      throw new ChatError(503, `Session konnte nicht gestartet werden: ${(err as Error).message}`);
    }
    this.turnStart.set(session.id, 0);
    this.deps.sessions.create({
      id: session.id,
      featureId: null,
      conversationId: conv.id,
      projectId: project.id,
      kind: 'chat_work',
      pid: session.pty.pid,
    });
    return { sessionId: session.id };
  }

  /**
   * Arbeitskopie auf den Default-Branch nachziehen. Sauber und veraltet → Rebase; dirty →
   * unangetastet lassen (die Arbeit des Nutzers hat Vorrang) und den Zustand melden, damit
   * das Panel es sichtbar macht statt still auf altem Stand weiterzuarbeiten.
   */
  async syncWorktree(projectId: string, worktreePath: string): Promise<ChatWorktreeSync> {
    const project = this.mustProject(projectId);
    const dirty = await isCleanWorkingTree(worktreePath).then(
      (clean) => !clean,
      () => false,
    );
    const behind = await behindCount(worktreePath, project.defaultBranch, 'HEAD');
    if (behind === 0) return { behind: 0, dirty, state: 'current' };
    if (dirty) return { behind, dirty, state: 'blocked_dirty' };

    const rebase = await this.engine.rebaseOnto(worktreePath, project.defaultBranch);
    if (rebase.ok) {
      console.log(`[chat] Arbeitskopie ${behind} Commit(s) auf '${project.defaultBranch}' nachgezogen`);
      return { behind: 0, dirty: false, state: 'rebased' };
    }
    // Konflikt lässt den Rebase stehen — zurückrollen, sonst startet die Session mitten drin.
    if (rebase.kind === 'conflict') await this.engine.abortRebase(worktreePath).catch(() => {});
    return { behind, dirty: false, state: 'conflict' };
  }

  /**
   * Arbeit des Wissens-Chats in den Default-Branch übernehmen: uncommittetes festschreiben,
   * auf den Default-Branch rebasen, dort mergen. Erst damit gibt es einen sauberen Weg aus der
   * Arbeitskopie heraus — ohne ihn wandert dieselbe Änderung von Hand nach main und existiert
   * anschließend zweimal (einmal in main, einmal weiter im Chat-Branch).
   * Verändert bei jedem Blocker NICHTS.
   */
  async adopt(projectId: string): Promise<ChatWorkAdoptResult | ChatWorkAdoptBlocked> {
    const project = this.mustProject(projectId);
    const conv = this.deps.chatRepo.getActive(projectId);
    if (!conv) throw new ChatError(404, 'Keine aktive Unterhaltung');

    const worktreePath = this.deps.worktrees.pathFor(project.id, `chat-${conv.id}`);
    if (!existsSync(worktreePath)) {
      return { blocked: 'nothing', message: 'Es gibt keine Arbeitskopie zu übernehmen.' };
    }

    // Ein laufender Turn schreibt gerade Dateien — mitten hinein zu committen übernähme
    // einen halben Stand (genau das Problem, das die Übernahme lösen soll).
    const live = this.deps.ptys.forConversation(conv.id);
    if (live && displayStatus(live.machine.state) === 'working') {
      return { blocked: 'running', message: 'Der Chat arbeitet gerade — warte, bis der Turn fertig ist.' };
    }

    const diff = await collectUnmergedChanges(worktreePath, project.defaultBranch);
    if (diff.files.length === 0 && diff.commits.length === 0) {
      return {
        blocked: 'nothing',
        message: `Die Arbeitskopie enthält keine Änderungen gegenüber '${project.defaultBranch}'.`,
      };
    }

    const committed = diff.hasUncommitted;
    if (committed) {
      await git(worktreePath, ['add', '-A']);
      const c = await git(worktreePath, ['commit', '-m', `feat(chat): Übernahme aus dem Wissens-Chat`]);
      if (c.code !== 0) {
        return { blocked: 'merge', message: `Commit in der Arbeitskopie fehlgeschlagen: ${c.stderr.trim()}` };
      }
    }

    const rebase = await this.engine.rebaseOnto(worktreePath, project.defaultBranch);
    if (!rebase.ok) {
      if (rebase.kind === 'conflict') {
        await this.engine.abortRebase(worktreePath).catch(() => {});
        return {
          blocked: 'conflict',
          message: `Konflikte gegen '${project.defaultBranch}' — im Chat auflösen und erneut übernehmen.`,
          files: rebase.files,
        };
      }
      return { blocked: 'merge', message: rebase.message };
    }

    const merge = await this.engine.mergeIntoTarget({
      projectPath: project.path,
      branch: this.branchFor(conv.id),
      target: project.defaultBranch,
      mode: project.mergeMode,
      message: `feat(chat): Übernahme aus dem Wissens-Chat`,
      tmpWorktreeDir: join(this.deps.dataDir, 'merge-tmp'),
    });
    if (!merge.ok) return { blocked: 'merge', message: merge.message };

    // Nach dem Merge ist die Arbeitskopie deckungsgleich mit dem Ziel — der Chat läuft
    // auf dem übernommenen Stand weiter, statt seine Kopie parallel weiterzuführen.
    this.syncState.set(conv.id, { behind: 0, dirty: false, state: 'current' });
    bus.emitEvent('chat_updated', { projectId, conversationId: conv.id });
    return { target: project.defaultBranch, files: diff.files.length, committed };
  }

  /**
   * Wissens-Chat neu starten: aktive Unterhaltung deaktivieren (Verlauf bleibt erhalten),
   * ihre Session/Worktree/Branch verwerfen und eine frische, automatisch gestartete Session
   * beginnen. Liegt laufende Arbeit vor (Session arbeitet ODER Arbeitskopie dirty) und fehlt
   * `confirm`, wird ohne etwas zu verwerfen ein Bestätigungssignal zurückgegeben (FR-006).
   */
  restart(
    projectId: string,
    opts: { confirm?: boolean } = {},
  ): Promise<ChatWorkRestartResult | ChatWorkRestartNeedsConfirm> {
    const inflight = this.restarting.get(projectId);
    if (inflight) return inflight; // Doppelklick-Schutz (FR-008)
    const run = this.doRestart(projectId, opts.confirm === true).finally(() =>
      this.restarting.delete(projectId),
    );
    this.restarting.set(projectId, run);
    return run;
  }

  private async doRestart(
    projectId: string,
    confirm: boolean,
  ): Promise<ChatWorkRestartResult | ChatWorkRestartNeedsConfirm> {
    const project = this.mustProject(projectId);
    const old = this.deps.chatRepo.getActive(projectId);

    if (old) {
      const worktreePath = this.deps.worktrees.pathFor(project.id, `chat-${old.id}`);

      // Guard (FR-006): arbeitet die Session ODER hat die Arbeitskopie unbestätigte Änderungen?
      const live = this.deps.ptys.forConversation(old.id);
      const status = live ? displayStatus(live.machine.state) : null;
      const running = status === 'working' || status === 'awaiting_input';
      let dirty: boolean;
      try {
        dirty = !(await isCleanWorkingTree(worktreePath));
      } catch {
        dirty = false; // Worktree existiert (noch) nicht → nichts zu verlieren
      }
      if (!confirm && (running || dirty)) {
        return { needsConfirm: true, reason: running ? 'running' : 'dirty' };
      }

      // Verwerfen: Session beenden, Worktree + Branch fallenlassen (FR-007).
      if (live) {
        this.terminating.add(live.id); // absichtlicher Exit → kein Fehler-Alarm in handleExit
        await this.deps.ptys.terminate(live.id);
        this.deps.ptys.remove(live.id);
        this.deps.sessions.end(live.id);
      }
      await this.deps.worktrees
        .remove(project.path, worktreePath, { force: true })
        .catch(() => {});
      await this.deps.worktrees.deleteBranch(project.path, this.branchFor(old.id)).catch(() => {});

      // Flüchtigen Feature-Vorschlag entfernen (FR-009) und Unterhaltung deaktivieren (behalten).
      this.proposals.delete(old.id);
      this.lastMarker.delete(old.id);
      this.syncState.delete(old.id);
      this.deps.chatRepo.endConversation(old.id);
    }

    // Frische, aktive Unterhaltung → automatisch gestartete Session (FR-002/003/004).
    const fresh = this.deps.chatRepo.createConversation(projectId, 'work');
    const { sessionId } = await this.ensure(projectId);
    bus.emitEvent('chat_updated', { projectId, conversationId: fresh.id });
    return { sessionId, conversationId: fresh.id };
  }

  /** Laufzeit-Info der Session (null, wenn keine läuft) — für den Status-Indikator. */
  workSessionInfo(conversation: ChatConversation): ChatWorkSessionInfo | null {
    const live = this.deps.ptys.forConversation(conversation.id);
    if (!live) return null;
    return {
      sessionId: live.id,
      status: displayStatus(live.machine.state),
      awaitingKind: live.machine.state.kind === 'awaiting_input' ? live.machine.state.awaiting : null,
      branch: this.branchFor(conversation.id),
      sync: this.syncState.get(conversation.id) ?? null,
    };
  }

  /**
   * „Pausiert": Die Unterhaltung hatte schon eine echte Session, die aber nicht mehr
   * läuft (Leerlauf-Reaper oder Server-Neustart) und sich fortsetzen ließe. Signal für
   * das Panel, den Nutzer zu fragen (fortsetzen ODER neu) statt still zu resumen.
   */
  workPaused(conversation: ChatConversation): boolean {
    if (this.deps.ptys.forConversation(conversation.id)) return false; // läuft → nicht pausiert
    const prev = this.deps.sessions.latestForConversation(conversation.id);
    return !!prev?.claude_session_id; // es gab bereits eine echte Session → fortsetzbar
  }

  // ---------- Feature-Vorschläge ----------

  /** Offener Vorschlag der aktiven Unterhaltung (für GET /chat). */
  proposalForProject(projectId: string): ChatFeatureProposal | null {
    const conv = this.deps.chatRepo.getActive(projectId);
    return conv ? (this.proposals.get(conv.id) ?? null) : null;
  }

  /** Bestätigte Features anlegen (Teilmenge per Name); löscht den Vorschlag. */
  async createFeatures(projectId: string, names: string[]): Promise<Feature[]> {
    const conv = this.deps.chatRepo.getActive(projectId);
    if (!conv) throw new ChatError(404, 'Keine aktive Unterhaltung');
    const proposal = this.proposals.get(conv.id);
    if (!proposal) throw new ChatError(404, 'Kein offener Feature-Vorschlag');

    const wanted = new Set(names);
    const selected = proposal.features.filter((f) => wanted.has(f.name));
    if (selected.length === 0) throw new ChatError(400, 'Kein Feature ausgewählt');

    const created: Feature[] = [];
    const errors: string[] = [];
    for (const f of selected) {
      try {
        created.push(await this.deps.orchestrator.createFeature(projectId, f.name, f.description));
      } catch (err) {
        errors.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    this.proposals.delete(conv.id);
    bus.emitEvent('chat_updated', { projectId, conversationId: conv.id });
    if (created.length === 0) throw new ChatError(409, `Feature-Anlage fehlgeschlagen — ${errors.join('; ')}`);
    return created;
  }

  /** Vorschlag verwerfen (kein Feature anlegen). */
  dismissProposal(projectId: string): void {
    const conv = this.deps.chatRepo.getActive(projectId);
    if (!conv) return;
    this.proposals.delete(conv.id);
    bus.emitEvent('chat_updated', { projectId, conversationId: conv.id });
  }

  // ---------- Session-Callbacks (delegiert vom Orchestrator / PtySessionManager) ----------

  /** Marker-Erkennung: Assistant-Text der Session auf Feature-Vorschläge prüfen. */
  onAssistantText(session: LiveSession, text: string): void {
    const conversationId = session.conversationId;
    if (!conversationId) return;
    const features = parseSessionFeatures(text);
    if (!features) return;
    const key = JSON.stringify(features);
    if (this.lastMarker.get(conversationId) === key) return; // Dedup (gleicher Marker erneut)
    this.lastMarker.set(conversationId, key);
    this.proposals.set(conversationId, { id: nanoid(10), features });
    bus.emitEvent('chat_updated', { projectId: session.projectId, conversationId });
    if (this.notify.allow(session.id, 'input_requested')) {
      bus.emitEvent('notification', {
        title: 'Projekt-Chat: Feature-Vorschlag',
        body: features.length === 1 ? features[0]!.name : `${features.length} Features vorgeschlagen`,
        featureId: null,
        kind: 'input_requested',
      });
    }
  }

  handleStatusChange(session: LiveSession, effects: SessionEffect[]): void {
    const status = displayStatus(session.machine.state);
    const awaiting = session.machine.state.kind === 'awaiting_input' ? session.machine.state.awaiting : null;
    bus.emitEvent('session_status', {
      sessionId: session.id,
      featureId: null,
      conversationId: session.conversationId,
      projectId: session.projectId,
      status,
      awaitingKind: awaiting,
      lastActiveAt: session.lastActiveAt,
    });

    if (status === 'working') {
      const ids = this.deps.attention.resolveFor({
        sessionId: session.id,
        kinds: ['awaiting_input', 'permission_request'],
      });
      for (const id of ids) bus.emitEvent('attention_resolved', id);
    }
    // Zustandsgekoppelte Bereinigung (US1): überholte Meldungen (auch der frühere „Agent-Fehler"
    // dieser Unterhaltung) auflösen, sobald wieder gearbeitet wird. Nicht im Warte-Übergang, damit
    // eine gerade entstehende Frage nicht sofort wieder entfernt wird.
    if (status !== 'awaiting_input') {
      this.deps.orchestrator.reconcileOpenAttention();
    }

    for (const effect of effects) {
      if (effect.kind === 'input_requested') {
        if (effect.awaiting === 'permission') continue; // in der Konsole beantworten
        const item = this.deps.attention.raise({
          kind: 'awaiting_input',
          projectId: session.projectId,
          sessionId: session.id,
          conversationId: session.conversationId,
          message: awaitingMessage('Projekt-Chat', effect.awaiting, effect.detail),
        });
        bus.emitEvent('attention_raised', item);
        if (this.notify.allow(session.id, 'input_requested')) {
          bus.emitEvent('notification', {
            title: 'Projekt-Chat wartet auf dich',
            body: item.message,
            featureId: null,
            kind: 'input_requested',
          });
        }
      } else if (effect.kind === 'turn_completed') {
        this.meterTurn(session);
      }
    }
  }

  private meterTurn(session: LiveSession): void {
    const start = this.turnStart.get(session.id) ?? 0;
    const outputText = session.scrollback.slice(start);
    this.turnStart.set(session.id, session.scrollback.length);
    if (!outputText.trim()) return;
    const cost = meter({ ...(this.deps.model ? { model: this.deps.model } : {}), promptText: '', outputText });
    const execId = this.deps.executions.start({
      projectId: session.projectId,
      featureId: null,
      kind: 'chat_work',
      phase: null,
      logPath: null,
    });
    this.deps.executions.finish(execId, 0, cost.costUsd, cost.totalTokens);
  }

  handleExit(session: LiveSession, exitCode: number): void {
    this.deps.sessions.end(session.id);
    this.turnStart.delete(session.id);
    // Beendete Session → eine offene „Frage" dieser Session ist hinfällig.
    for (const id of this.deps.attention.resolveFor({ sessionId: session.id, kinds: ['awaiting_input'] })) {
      bus.emitEvent('attention_resolved', id);
    }
    const intentional = this.terminating.delete(session.id); // Neustart-Termination → kein Alarm
    if (exitCode !== 0 && !intentional) {
      const item = this.deps.attention.raise({
        kind: 'agent_errored',
        projectId: session.projectId,
        sessionId: session.id,
        conversationId: session.conversationId,
        message: `Projekt-Chat-Session beendet (exit ${exitCode})`,
      });
      bus.emitEvent('attention_raised', item);
    }
    this.deps.ptys.remove(session.id);
  }

  /**
   * Leerlauf-Reaper: beendet Projekt-Chat-Sessions, die seit `maxIdleMs` nicht mehr
   * gearbeitet haben (weder `working` noch zwischenzeitlich aktiv). Eine gerade
   * arbeitende Session wird nie abgewürgt. Der Exit läuft über den regulären Pfad
   * (`handleExit`); dank `terminating` gibt es dabei keinen Fehler-Alarm.
   */
  reapIdleSessions(now: number = Date.now(), maxIdleMs: number = CHAT_IDLE_TIMEOUT_MS): void {
    for (const s of this.deps.ptys.list()) {
      try {
        if (s.kind !== 'chat_work' || s.exited) continue;
        if (displayStatus(s.machine.state) === 'working') continue; // aktiver Turn → laufen lassen
        if (now - s.lastActiveAt < maxIdleMs) continue;
        this.terminating.add(s.id); // erwarteter Exit → kein „braucht dich"-Alarm
        // Fehler beim Beenden dürfen weder die Schleife abbrechen noch als
        // unbehandelte Rejection den Serverprozess reißen.
        void this.deps.ptys.terminate(s.id).catch((err) => {
          console.error(`[chatWork] Reap von Session ${s.id} fehlgeschlagen:`, err);
        });
        if (s.conversationId) {
          bus.emitEvent('chat_updated', { projectId: s.projectId, conversationId: s.conversationId });
        }
      } catch (err) {
        console.error(`[chatWork] Reap-Iteration für Session ${s.id} fehlgeschlagen:`, err);
      }
    }
  }

  killAll(): void {
    this.turnStart.clear();
  }

  // ---------- Helpers ----------

  private branchFor(conversationId: string): string {
    return `chat/${conversationId}`;
  }

  private mustProject(id: string): Project {
    const p = this.deps.projects.get(id);
    if (!p) throw new ChatError(404, 'Projekt nicht gefunden');
    return p;
  }
}
