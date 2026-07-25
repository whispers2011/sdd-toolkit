import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  meter,
  parseChatStreamLine,
  parseFeatureProposal,
  type ChatConversation,
  type ChatMessage,
  type ChatStreamEvent,
  type FeatureProposal,
  type Project,
} from '@sdd/shared';
import type { ChatRepo, ExecutionRepo, ProjectRepo } from '../db/repos.js';
import { buildChatArgv } from '../pty/commandBuilder.js';
import { loginShellEnv } from '../pty/loginShellEnv.js';
import { bus } from '../events.js';
import { buildChatSystemPrompt } from './chatPrompt.js';

const TURN_TIMEOUT_MS = 20 * 60_000;
/** Resume-Fallback (R4): so viele letzte Nachrichten als Kontextblock mitgeben. */
const RESUME_CONTEXT_MESSAGES = 10;

/** Fehler mit HTTP-Status — Fastify serialisiert err.statusCode direkt. */
export class ChatError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

interface RunningTurn {
  /** null bis der Prozess gespawnt ist — Slot wird synchron reserviert. */
  child: ChildProcess | null;
  messageId: string;
  cancelled: boolean;
}

/**
 * Projekt-Chat (Ask-a-Question): führt Chat-Turns als kurzlebige Headless-Läufe
 * aus (stream-json, --resume), streamt Fortschritt über den Bus und persistiert
 * alles im ChatRepo. Strikt lesend gegenüber dem Projekt (FR-004) — die
 * Feature-Anlage läuft ausschließlich über den bestehenden createFeature-Pfad,
 * nie über diese Session.
 */
export class ChatService {
  /** Genau eine laufende Antwort pro Unterhaltung. */
  private running = new Map<string, RunningTurn>();

  constructor(
    private deps: {
      projects: ProjectRepo;
      chat: ChatRepo;
      executions: ExecutionRepo;
      dataDir: string;
      model?: string;
    },
  ) {
    mkdirSync(join(deps.dataDir, 'logs'), { recursive: true });
  }

  getState(projectId: string): { conversation: ChatConversation | null; messages: ChatMessage[] } {
    const conversation = this.deps.chat.getActive(projectId);
    return { conversation, messages: conversation ? this.deps.chat.listMessages(conversation.id) : [] };
  }

  /** Boot-Cleanup: streamende Leichen aus früheren Server-Läufen → interrupted. */
  interruptStreamingOnBoot(): number {
    return this.deps.chat.interruptStreaming();
  }

  /** Shutdown: laufende Turns hart beenden (Boot-Cleanup markiert die Nachrichten). */
  killAll(): void {
    for (const turn of this.running.values()) {
      turn.cancelled = true;
      turn.child?.kill('SIGKILL');
    }
  }

  sendMessage(
    projectId: string,
    content: string,
  ): { conversationId: string; userMessage: ChatMessage; assistantMessage: ChatMessage } {
    const project = this.deps.projects.get(projectId);
    if (!project) throw new ChatError(404, 'Projekt nicht gefunden');

    const conversation = this.deps.chat.ensureActive(projectId);
    if (conversation.mode === 'work') {
      throw new ChatError(409, 'Unterhaltung ist im Arbeits-Modus — Nachrichten laufen über die Arbeits-Session');
    }
    if (this.running.has(conversation.id)) throw new ChatError(409, 'Antwort läuft bereits');

    const userMessage = this.deps.chat.createMessage({
      conversationId: conversation.id,
      role: 'user',
      content,
      status: 'complete',
    });
    const assistantMessage = this.deps.chat.createMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    });
    this.deps.chat.touch(conversation.id);

    // Slot synchron reservieren — verhindert Doppel-Turns im Spawn-Fenster.
    const turn: RunningTurn = { child: null, messageId: assistantMessage.id, cancelled: false };
    this.running.set(conversation.id, turn);
    void this.runTurn(project, conversation, turn, content, true).finally(() => {
      if (this.running.get(conversation.id) === turn) this.running.delete(conversation.id);
    });

    return { conversationId: conversation.id, userMessage, assistantMessage };
  }

  /** „Neue Unterhaltung": laufenden Turn abbrechen, aktive Unterhaltung beenden. */
  reset(projectId: string): void {
    const project = this.deps.projects.get(projectId);
    if (!project) throw new ChatError(404, 'Projekt nicht gefunden');
    const conversation = this.deps.chat.getActive(projectId);
    if (!conversation) return;

    const turn = this.running.get(conversation.id);
    if (turn) {
      turn.cancelled = true;
      turn.child?.kill('SIGKILL');
    }
    this.deps.chat.endConversation(conversation.id);
    bus.emitEvent('chat_updated', { projectId, conversationId: conversation.id });
  }

  /** Entscheidung zum Feature-Vorschlag einer Nachricht verbuchen (FR-006/FR-008). */
  decideProposal(
    messageId: string,
    decision: { status: 'angenommen'; featureId?: string } | { status: 'abgelehnt' },
  ): ChatMessage {
    const message = this.deps.chat.getMessage(messageId);
    if (!message?.proposal) throw new ChatError(404, 'Kein Vorschlag zu dieser Nachricht');
    if (message.proposal.status !== 'offen') throw new ChatError(409, 'Vorschlag wurde bereits entschieden');
    if (decision.status === 'angenommen' && !decision.featureId) throw new ChatError(400, 'featureId fehlt');

    const proposal: FeatureProposal = {
      name: message.proposal.name,
      description: message.proposal.description,
      status: decision.status,
      ...(decision.status === 'angenommen' ? { featureId: decision.featureId! } : {}),
    };
    this.deps.chat.setProposal(messageId, proposal);

    const conversation = this.deps.chat.getConversation(message.conversationId);
    if (conversation) {
      bus.emitEvent('chat_updated', { projectId: conversation.projectId, conversationId: conversation.id });
    }
    return this.deps.chat.getMessage(messageId)!;
  }

  private async runTurn(
    project: Project,
    conversation: ChatConversation,
    turn: RunningTurn,
    userContent: string,
    allowResumeFallback: boolean,
  ): Promise<void> {
    const { chat, executions } = this.deps;
    const messageId = turn.messageId;
    // Frisch lesen — der Resume-Fallback hat die Session-ID ggf. gelöscht.
    const resume = chat.getConversation(conversation.id)?.claudeSessionId ?? null;
    const prompt = this.buildPrompt(conversation.id, userContent, resume);

    const execId = executions.start({
      projectId: project.id,
      featureId: null,
      kind: 'chat',
      phase: null,
      logPath: null,
    });
    const logPath = join(this.deps.dataDir, 'logs', `${execId}.log`);
    const log = createWriteStream(logPath, { flags: 'a' });
    log.write(
      `=== Chat-Turn (${project.name}) ===\nConversation: ${conversation.id}${resume ? ` · resume ${resume}` : ''}\n\n`,
    );

    const argv = buildChatArgv(prompt, {
      systemPrompt: buildChatSystemPrompt(project),
      ...(resume ? { resume } : {}),
      ...(this.deps.model ? { model: this.deps.model } : {}),
    });

    let streamed = '';
    let result: Extract<ChatStreamEvent, { kind: 'result' }> | null = null;
    let timedOut = false;

    const env = await loginShellEnv();
    const [cmd, ...args] = argv;
    const child = spawn(cmd!, args, { cwd: project.path, env, stdio: ['ignore', 'pipe', 'pipe'] });
    turn.child = child;
    if (turn.cancelled) child.kill('SIGKILL'); // Reset kam während des Spawns

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TURN_TIMEOUT_MS);

    child.stderr?.on('data', (d: Buffer) => log.write(d));
    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      log.write(line + '\n');
      const event = parseChatStreamLine(line);
      if (event.kind === 'init') {
        // Sofort persistieren, damit Resume auch nach Abbruch mitten im Turn greift.
        chat.setClaudeSessionId(conversation.id, event.sessionId);
      } else if (event.kind === 'delta') {
        streamed += event.text;
        chat.appendDelta(messageId, event.text);
        bus.emitEvent('chat_stream', {
          projectId: project.id,
          conversationId: conversation.id,
          messageId,
          text: streamed,
          done: false,
        });
      } else if (event.kind === 'result') {
        result = event;
        if (event.sessionId) chat.setClaudeSessionId(conversation.id, event.sessionId);
      }
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 1));
      child.on('error', (err) => {
        log.write(`\nSpawn-Fehler: ${String(err)}\n`);
        resolve(127);
      });
    });
    clearTimeout(timeout);
    rl.close();
    // Snapshot nach Prozessende — TS trackt Zuweisungen aus dem line-Callback nicht.
    const turnResult = result as Extract<ChatStreamEvent, { kind: 'result' }> | null;

    const finish = (outcome: Parameters<ChatRepo['finalizeMessage']>[1]) => {
      chat.finalizeMessage(messageId, outcome);
      chat.touch(conversation.id);
      bus.emitEvent('chat_stream', {
        projectId: project.id,
        conversationId: conversation.id,
        messageId,
        text: outcome.status === 'complete' ? (outcome.content ?? streamed) : streamed,
        done: true,
      });
      bus.emitEvent('chat_updated', { projectId: project.id, conversationId: conversation.id });
    };

    if (turn.cancelled) {
      log.end();
      finish({ status: 'interrupted' });
      executions.finish(execId, exitCode);
      return;
    }

    if (turnResult && !turnResult.isError) {
      const finalText = turnResult.text || streamed;
      const { cleanText, proposal } = parseFeatureProposal(finalText);
      // Kosten (R7): primär aus dem Result-Event, sonst costMeter-Schätzung.
      const fallback = meter({
        ...(this.deps.model ? { model: this.deps.model } : {}),
        promptText: prompt,
        outputText: finalText,
      });
      const costUsd = turnResult.costUsd ?? fallback.costUsd;
      const tokens = turnResult.tokens ?? fallback.totalTokens;
      log.end();
      finish({
        status: 'complete',
        content: cleanText,
        proposal: proposal ? { ...proposal, status: 'offen' } : null,
        costUsd,
        tokens,
      });
      executions.finish(execId, 0, costUsd, tokens);
      return;
    }

    // Resume-Fallback (R4): --resume war gesetzt und der Lauf lieferte kein
    // Result (z. B. Transcript nach ~30 Tagen gepruned) → einmalig ohne Resume
    // neu starten; die letzten Nachrichten kommen als Kontextblock mit.
    if (resume && allowResumeFallback && !turnResult && !timedOut) {
      log.write('\nResume fehlgeschlagen — starte Turn ohne --resume neu.\n');
      log.end();
      executions.finish(execId, exitCode || 1);
      chat.setClaudeSessionId(conversation.id, null);
      chat.resetContent(messageId);
      await this.runTurn(project, conversation, turn, userContent, false);
      return;
    }

    log.end();
    const reason = timedOut
      ? 'Zeitüberschreitung nach 20 Minuten'
      : turnResult?.isError
        ? `Assistent meldet einen Fehler${turnResult.text ? `: ${turnResult.text.slice(0, 300)}` : ''}`
        : `Antwort fehlgeschlagen (Exit ${exitCode}) — Details im Lauf-Log`;
    finish({ status: 'error', error: reason });
    executions.finish(execId, exitCode || 1);
  }

  /** Ohne Resume: letzte Nachrichten als Kontextblock voranstellen (R4). */
  private buildPrompt(conversationId: string, userContent: string, resume: string | null): string {
    if (resume) return userContent;
    const history = this.deps.chat
      .listMessages(conversationId)
      .filter((m) => m.status === 'complete' && m.content)
      .slice(0, -1) // die aktuelle Nutzer-Nachricht nicht doppeln
      .slice(-RESUME_CONTEXT_MESSAGES);
    if (history.length === 0) return userContent;
    return [
      '[Kontext der bisherigen Unterhaltung — die ursprüngliche Session ist nicht mehr verfügbar]',
      ...history.map((m) => `${m.role === 'user' ? 'Nutzer' : 'Assistent'}: ${m.content}`),
      '[Ende Kontext]',
      '',
      userContent,
    ].join('\n');
  }
}
