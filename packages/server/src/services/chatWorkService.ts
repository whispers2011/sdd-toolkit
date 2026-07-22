import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  displayStatus,
  meter,
  resolveAutomation,
  type ChatConversation,
  type ChatMode,
  type ChatWorkSessionInfo,
  type Project,
  type SessionEffect,
} from '@sdd/shared';
import type { AttentionRepo, ChatRepo, ExecutionRepo, ProjectRepo, SessionRepo, SettingsRepo } from '../db/repos.js';
import type { WorktreeManager } from '../git/worktrees.js';
import type { LiveSession, PtySessionManager } from '../pty/sessionManager.js';
import { MergeEngine } from '../git/mergeEngine.js';
import { git, isCleanWorkingTree } from '../git/git.js';
import { runVerification } from './verifyService.js';
import { locateTranscript } from '../pty/transcriptWatcher.js';
import { buildClaudeArgv } from '../pty/commandBuilder.js';
import { buildChatWorkSystemPrompt } from './chatWorkPrompt.js';
import { NotificationThrottle } from './notificationThrottle.js';
import { ChatError, type ChatService } from './chatService.js';
import { bus } from '../events.js';

interface RunningTurn {
  executionId: string;
  scrollbackStart: number;
  promptText: string;
}

export interface ChatWorkDeps {
  projects: ProjectRepo;
  /** Nur-Lese-Chat — für sauberes Beenden eines ask-Turns beim Moduswechsel. */
  chat: ChatService;
  chatRepo: ChatRepo;
  sessions: SessionRepo;
  attention: AttentionRepo;
  executions: ExecutionRepo;
  settings: SettingsRepo;
  worktrees: WorktreeManager;
  ptys: PtySessionManager;
  dataDir: string;
  model?: string;
}

/**
 * Arbeits-Chat („Arbeiten"-Modus): eine vollwertige, interaktive Claude-Code-Session in einer
 * isolierten Worktree/Branch pro Unterhaltung. Spiegelt Orchestrator.ensureSession statt den
 * headless-lesenden ChatService. Verwendet die Session-/Worktree-/Merge-Infrastruktur wieder.
 */
export class ChatWorkService {
  private mergeEngine = new MergeEngine();
  private notify = new NotificationThrottle();
  private runningTurns = new Map<string, RunningTurn>(); // sessionId → Turn
  private integrating = new Set<string>(); // conversationId gerade in Integration
  private terminating = new Set<string>(); // sessionId absichtlich beendet (kein Fehler-Item)

  constructor(private deps: ChatWorkDeps) {
    mkdirSync(join(deps.dataDir, 'logs'), { recursive: true });
  }

  // ---------- Modus ----------

  /** Modus der aktiven Unterhaltung wählen; ein Wechsel startet eine neue Unterhaltung. */
  setMode(projectId: string, mode: ChatMode): ChatConversation {
    this.mustProject(projectId);
    const active = this.deps.chatRepo.getActive(projectId);
    if (active && active.mode === mode) return active;

    if (active && active.mode === 'work') {
      // Laufende Arbeit nicht stillschweigend verwerfen.
      const live = this.deps.ptys.forConversation(active.id);
      if (live || existsSync(this.worktreePath(projectId, active.id))) {
        throw new ChatError(409, 'Arbeits-Session aktiv — bitte zuerst übernehmen oder verwerfen');
      }
      this.deps.chatRepo.endConversation(active.id);
    } else if (active) {
      // ask-Unterhaltung: laufenden Turn beenden + Unterhaltung schließen.
      this.deps.chat.reset(projectId);
    }

    const created = this.deps.chatRepo.createConversation(projectId, mode);
    bus.emitEvent('chat_updated', { projectId, conversationId: created.id });
    return created;
  }

  /** Laufzeit-Info der Arbeits-Session (null, wenn keine läuft). */
  workSessionInfo(conversation: ChatConversation): ChatWorkSessionInfo | null {
    if (conversation.mode !== 'work') return null;
    const live = this.deps.ptys.forConversation(conversation.id);
    if (!live) return null;
    return {
      sessionId: live.id,
      status: displayStatus(live.machine.state),
      awaitingKind: live.machine.state.kind === 'awaiting_input' ? live.machine.state.awaiting : null,
      branch: this.branchFor(conversation.id),
    };
  }

  // ---------- Session-Lifecycle ----------

  /** Arbeits-Session sicherstellen (idempotent): Worktree anlegen + PTY spawnen/rehydrieren. */
  async ensure(projectId: string): Promise<{ sessionId: string }> {
    const project = this.mustProject(projectId);
    const conv = this.deps.chatRepo.getActive(projectId);
    if (!conv) throw new ChatError(404, 'Keine aktive Unterhaltung');
    if (conv.mode !== 'work') throw new ChatError(409, 'Unterhaltung ist nicht im Arbeits-Modus');

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

  /** Prompt in die Arbeits-Session senden (startet Kosten-Metering für den Turn). */
  async sendPrompt(projectId: string, text: string): Promise<void> {
    const { sessionId } = await this.ensure(projectId);
    const live = this.deps.ptys.get(sessionId);
    if (!live) throw new ChatError(404, 'Arbeits-Session nicht gefunden');
    const executionId = this.deps.executions.start({
      projectId: live.projectId,
      featureId: null,
      kind: 'chat_work',
      phase: null,
      logPath: null,
    });
    this.runningTurns.set(sessionId, { executionId, scrollbackStart: live.scrollback.length, promptText: text });
    this.deps.ptys.sendPrompt(sessionId, text);
  }

  /** Laufenden Turn abbrechen (ESC), Session bleibt bestehen. */
  interrupt(projectId: string): { status: string } {
    const conv = this.activeWork(projectId);
    const live = this.deps.ptys.forConversation(conv.id);
    if (!live) throw new ChatError(404, 'Keine laufende Arbeits-Session');
    this.deps.ptys.write(live.id, '\x1b'); // ESC bricht die aktuelle Generierung ab
    return { status: 'stopped' };
  }

  /** Arbeit restlos verwerfen: Session beenden, Worktree/Branch/Snapshot entfernen. */
  async discard(projectId: string): Promise<void> {
    const project = this.mustProject(projectId);
    const conv = this.activeWork(projectId);
    await this.teardown(project, conv.id);
    this.deps.chatRepo.endConversation(conv.id);
    bus.emitEvent('chat_updated', { projectId, conversationId: conv.id });
  }

  /** Arbeit nach main übernehmen: commit → verify → rebase → merge → Cleanup (async). */
  integrate(projectId: string): { executionId: string } {
    const project = this.mustProject(projectId);
    const conv = this.activeWork(projectId);
    if (this.integrating.has(conv.id)) throw new ChatError(409, 'Integration läuft bereits');
    this.integrating.add(conv.id);
    const executionId = this.deps.executions.start({
      projectId: project.id,
      featureId: null,
      kind: 'chat_work',
      phase: null,
      logPath: null,
    });
    void this.runIntegration(project, conv, executionId).finally(() => this.integrating.delete(conv.id));
    return { executionId };
  }

  private async runIntegration(project: Project, conv: ChatConversation, executionId: string): Promise<void> {
    const branch = this.branchFor(conv.id);
    const worktreePath = this.worktreePath(project.id, conv.id);
    const fail = (detail: string, raise = true): void => {
      if (raise) {
        const item = this.deps.attention.raise({
          kind: 'verify_failed',
          projectId: project.id,
          conversationId: conv.id,
          message: `Projekt-Chat: Übernahme fehlgeschlagen — ${detail}`,
        });
        bus.emitEvent('attention_raised', item);
      }
      this.deps.executions.finish(executionId, 1);
      bus.emitEvent('chat_work_integrated', { projectId: project.id, conversationId: conv.id, result: 'failed', detail });
    };

    try {
      const live = this.deps.ptys.forConversation(conv.id);
      if (live) {
        this.terminating.add(live.id);
        await this.deps.ptys.terminate(live.id);
      }
      if (!existsSync(worktreePath)) return fail('Arbeitskopie fehlt');

      // Committen (falls Änderungen). Keine Änderungen → nichts zu übernehmen: sauber verwerfen.
      if (await isCleanWorkingTree(worktreePath)) {
        await this.teardown(project, conv.id);
        this.deps.chatRepo.endConversation(conv.id);
        this.deps.executions.finish(executionId, 0);
        bus.emitEvent('chat_work_integrated', {
          projectId: project.id,
          conversationId: conv.id,
          result: 'merged',
          detail: 'Keine Änderungen zum Übernehmen',
        });
        bus.emitEvent('chat_updated', { projectId: project.id, conversationId: conv.id });
        return;
      }
      await git(worktreePath, ['add', '-A']);
      const committed = await git(worktreePath, ['commit', '-m', 'chat: Änderungen aus dem Projekt-Chat']);
      if (committed.code !== 0) return fail(committed.stderr.trim() || 'commit fehlgeschlagen');

      // Verifikation (falls konfiguriert) — nie blind mergen.
      if (project.verifyCommands.length > 0) {
        const outcome = await runVerification({
          commands: project.verifyCommands,
          cwd: worktreePath,
          logDir: join(this.deps.dataDir, 'logs'),
          executionId,
        });
        if (!outcome.ok) {
          const failed = outcome.results.find((r) => r.exitCode !== 0);
          return fail(`Verifikation fehlgeschlagen (${failed?.name ?? 'unbekannt'})`);
        }
      }

      // Rebase auf default, dann mergen.
      const rb = await this.mergeEngine.rebaseOntoDefault(worktreePath, project.defaultBranch);
      if (!rb.ok) {
        if (rb.kind === 'conflict') await this.mergeEngine.abortRebase(worktreePath).catch(() => {});
        const item = this.deps.attention.raise({
          kind: rb.kind === 'conflict' ? 'merge_conflict_escalated' : 'verify_failed',
          projectId: project.id,
          conversationId: conv.id,
          message:
            rb.kind === 'conflict'
              ? `Projekt-Chat: Merge-Konflikt beim Rebase (${rb.files.join(', ')})`
              : `Projekt-Chat: Rebase fehlgeschlagen — ${rb.message}`,
        });
        bus.emitEvent('attention_raised', item);
        this.deps.executions.finish(executionId, 1);
        bus.emitEvent('chat_work_integrated', {
          projectId: project.id,
          conversationId: conv.id,
          result: 'failed',
          detail: rb.kind === 'conflict' ? 'Merge-Konflikt' : rb.message,
        });
        return;
      }

      const merged = await this.mergeEngine.mergeFeature({
        projectPath: project.path,
        branch,
        defaultBranch: project.defaultBranch,
        mode: project.mergeMode,
        message: 'chat: Änderungen aus dem Projekt-Chat übernehmen',
      });
      if (!merged.ok) return fail(merged.message);

      // Erfolg → Cleanup + Unterhaltung beenden.
      await this.teardown(project, conv.id);
      this.deps.chatRepo.endConversation(conv.id);
      this.deps.executions.finish(executionId, 0);
      bus.emitEvent('chat_work_integrated', {
        projectId: project.id,
        conversationId: conv.id,
        result: 'merged',
        detail: `nach ${project.defaultBranch} übernommen`,
      });
      bus.emitEvent('chat_updated', { projectId: project.id, conversationId: conv.id });
    } catch (err) {
      fail((err as Error).message);
    }
  }

  // ---------- Session-Callbacks (delegiert vom Orchestrator) ----------

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
    });

    if (status === 'working') {
      this.deps.attention.resolveFor({ sessionId: session.id, kinds: ['awaiting_input', 'permission_request'] });
      bus.emitEvent('attention_resolved', session.id);
    }

    for (const effect of effects) {
      if (effect.kind === 'input_requested') {
        if (effect.awaiting === 'permission') continue; // in der Konsole beantworten
        const item = this.deps.attention.raise({
          kind: 'awaiting_input',
          projectId: session.projectId,
          sessionId: session.id,
          conversationId: session.conversationId,
          message:
            effect.awaiting === 'plan_approval'
              ? 'Projekt-Chat: wartet auf Plan-Freigabe'
              : 'Projekt-Chat: hat eine Frage',
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
        this.handleTurnCompleted(session);
      }
    }
  }

  private handleTurnCompleted(session: LiveSession): void {
    const running = this.runningTurns.get(session.id);
    if (running) {
      this.runningTurns.delete(session.id);
      const outputText = session.scrollback.slice(running.scrollbackStart);
      const cost = meter({ ...(this.deps.model ? { model: this.deps.model } : {}), promptText: running.promptText, outputText });
      this.deps.executions.finish(running.executionId, 0, cost.costUsd, cost.totalTokens);
    }
    if (this.notify.allow(session.id, 'turn_completed')) {
      bus.emitEvent('notification', {
        title: 'Projekt-Chat ist fertig',
        body: 'Turn abgeschlossen',
        featureId: null,
        kind: 'turn_completed',
      });
    }
  }

  handleExit(session: LiveSession, exitCode: number): void {
    this.deps.sessions.end(session.id);
    const running = this.runningTurns.get(session.id);
    if (running) {
      this.runningTurns.delete(session.id);
      this.deps.executions.finish(running.executionId, exitCode || 1);
    }
    const intentional = this.terminating.delete(session.id);
    if (exitCode !== 0 && !intentional) {
      const item = this.deps.attention.raise({
        kind: 'agent_errored',
        projectId: session.projectId,
        sessionId: session.id,
        conversationId: session.conversationId,
        message: `Arbeits-Chat-Session beendet (exit ${exitCode})`,
      });
      bus.emitEvent('attention_raised', item);
    }
    this.deps.ptys.remove(session.id);
  }

  killAll(): void {
    this.runningTurns.clear();
  }

  // ---------- Helpers ----------

  /** Session beenden + Worktree/Branch/Snapshot restlos entfernen (Verwerfen & Merge-Cleanup). */
  private async teardown(project: Project, conversationId: string): Promise<void> {
    const live = this.deps.ptys.forConversation(conversationId);
    if (live) {
      this.terminating.add(live.id);
      await this.deps.ptys.terminate(live.id);
    }
    const worktreePath = this.worktreePath(project.id, conversationId);
    await this.deps.worktrees.remove(project.path, worktreePath, { force: true }).catch(() => {});
    await this.mergeEngine.deleteBranch(project.path, this.branchFor(conversationId)).catch(() => {});
    this.deps.ptys.snapshots.remove(`chat-${conversationId}`);
  }

  private activeWork(projectId: string): ChatConversation {
    const conv = this.deps.chatRepo.getActive(projectId);
    if (!conv || conv.mode !== 'work') throw new ChatError(409, 'Keine aktive Arbeits-Unterhaltung');
    return conv;
  }

  private branchFor(conversationId: string): string {
    return `chat/${conversationId}`;
  }

  private worktreePath(projectId: string, conversationId: string): string {
    return this.deps.worktrees.pathFor(projectId, `chat-${conversationId}`);
  }

  private mustProject(id: string): Project {
    const p = this.deps.projects.get(id);
    if (!p) throw new ChatError(404, 'Projekt nicht gefunden');
    return p;
  }
}
