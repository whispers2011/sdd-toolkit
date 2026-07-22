import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatMode, FeatureProposal } from '@sdd/shared';
import { api, type ChatState } from '../api.js';
import { useStore } from '../store.js';
import { ConfirmDialog } from './Sidebar.js';
import { NewFeatureDialog } from './NewFeatureDialog.js';
import { TerminalPane } from './TerminalPane.js';

/**
 * Chat-Panel des Projekt-Chats mit zwei Modi (FR-011): „Fragen" (strikt lesend,
 * Nachrichtenliste — keine Artefakte) und „Arbeiten" (vollwertige, eingreifende
 * Session in isolierter Arbeitskopie — echte Konsole + Verwerfen/Übernehmen).
 */
export function ChatPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [chat, setChat] = useState<ChatState | null>(null);
  const [input, setInput] = useState('');
  const [workInput, setWorkInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [integrating, setIntegrating] = useState(false);
  /** Vorbefüllter Anlege-Dialog für einen angenommenen Feature-Vorschlag (FR-006). */
  const [proposalDialog, setProposalDialog] = useState<{ messageId: string; proposal: FeatureProposal } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = () =>
    void api
      .getChat(projectId)
      .then(setChat)
      .catch((e: Error) => setSendError(e.message));

  useEffect(load, [projectId]);

  // Invalidierungssignal: Turn fertig, Vorschlag entschieden, Reset, Integration (auch aus anderen Panels).
  useEffect(() => {
    if (state.chatUpdated?.projectId === projectId) {
      load();
      setIntegrating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chatUpdated?.ts]);

  const mode: ChatMode = chat?.conversation?.mode ?? 'ask';
  const conversationId = chat?.conversation?.id ?? null;
  const liveWork = state.app?.sessions.find((s) => conversationId && s.conversationId === conversationId);
  const workStatus = liveWork?.status ?? chat?.workSession?.status ?? 'idle';
  const workBusy = workStatus === 'working';

  const switchMode = (next: ChatMode) => {
    if (next === mode) return;
    setSendError(null);
    void api
      .setChatMode(projectId, next)
      .then(setChat)
      .catch((e: Error) => setSendError(e.message));
  };

  const messages = chat?.messages ?? [];
  const liveText = (m: ChatMessage): string => {
    const live = state.chatStreams[m.id];
    // Kumulierter Stream-Text ist mindestens so aktuell wie der DB-Stand beim Laden.
    return live && live.text.length >= m.content.length ? live.text : m.content;
  };
  const busy = messages.some((m) => m.status === 'streaming' && !state.chatStreams[m.id]?.done);

  // Auto-Scroll ans Ende bei neuen Inhalten.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy, state.chatStreams]);

  const send = async () => {
    const content = input.trim();
    if (!content || busy) return;
    setInput('');
    setSendError(null);
    try {
      const r = await api.sendChatMessage(projectId, content);
      setChat((cur) => ({
        conversation: cur?.conversation ?? null,
        messages: [...(cur?.messages ?? []), r.userMessage, r.assistantMessage],
      }));
    } catch (e) {
      setSendError((e as Error).message);
      setInput(content); // Eingabe nicht verlieren (FR-010)
    }
  };

  const reset = async () => {
    try {
      await api.resetChat(projectId);
      setChat({ conversation: null, messages: [] });
    } catch (e) {
      setSendError((e as Error).message);
    }
  };

  const projectName = state.app?.projects.find((p) => p.id === projectId)?.name ?? '';

  /** Ablehnen (FR-008) — Unterhaltung läuft ohne Seiteneffekte weiter. */
  const declineProposal = (messageId: string) =>
    void api
      .decideChatProposal(messageId, 'abgelehnt')
      .then(load)
      .catch((e: Error) => setSendError(e.message));

  /** Nach erfolgreicher Anlage im Dialog: Entscheidung verbuchen (FR-006/FR-011). */
  const proposalCreated = (messageId: string, featureId: string) =>
    void api
      .decideChatProposal(messageId, 'angenommen', featureId)
      .then(load)
      .catch((e: Error) => setSendError(e.message));

  const openFeature = (featureId: string) =>
    dispatch({ type: 'set_view', view: { kind: 'console', featureId } });

  // ----- Arbeits-Modus -----
  const sendWork = async () => {
    const text = workInput.trim();
    if (!text) return;
    setWorkInput('');
    setSendError(null);
    try {
      await api.sendChatWorkPrompt(projectId, text);
    } catch (e) {
      setSendError((e as Error).message);
      setWorkInput(text);
    }
  };

  const interrupt = () =>
    void api.interruptChatWork(projectId).catch((e: Error) => setSendError(e.message));

  const discard = async () => {
    try {
      await api.discardChatWork(projectId);
      setChat({ conversation: null, messages: [], workSession: null });
    } catch (e) {
      setSendError((e as Error).message);
    }
  };

  const integrate = () => {
    setSendError(null);
    void api
      .integrateChatWork(projectId)
      .then(() => setIntegrating(true))
      .catch((e: Error) => setSendError(e.message));
  };

  return (
    <div className="fixed right-4 bottom-20 z-40 flex h-[34rem] w-[27rem] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="text-sm font-semibold text-zinc-100">Projekt-Chat</span>
        <span className="truncate text-xs text-zinc-500">{projectName}</span>
        <div className="ml-auto flex items-center gap-1">
          {mode === 'ask' && messages.length > 0 && (
            <button
              onClick={() => setConfirmReset(true)}
              title="Neue Unterhaltung beginnen"
              className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              ↺ Neu
            </button>
          )}
          <button
            onClick={onClose}
            title="Schließen"
            className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Modus-Umschalter (FR-011) — jederzeit sichtbar */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <div className="flex rounded-md border border-zinc-700 p-0.5 text-xs">
          <button
            onClick={() => switchMode('ask')}
            className={`rounded px-2 py-0.5 ${mode === 'ask' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            💬 Fragen
          </button>
          <button
            onClick={() => switchMode('work')}
            className={`rounded px-2 py-0.5 ${mode === 'work' ? 'bg-emerald-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            🛠 Arbeiten
          </button>
        </div>
        <span className="ml-auto truncate text-[10px] text-zinc-600">
          {mode === 'work'
            ? 'Isolierte Arbeitskopie · Änderungen erst nach Übernahme'
            : 'Strikt lesend · keine Artefakte'}
        </span>
      </div>

      {mode === 'work' ? (
        <WorkView
          projectId={projectId}
          conversationId={conversationId}
          status={workStatus}
          branch={chat?.workSession?.branch ?? null}
          integrating={integrating}
          input={workInput}
          onInput={setWorkInput}
          onSend={() => void sendWork()}
          onInterrupt={interrupt}
          onIntegrate={integrate}
          onDiscard={() => setConfirmDiscard(true)}
          busy={workBusy}
        />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 && (
            <p className="px-2 py-8 text-center text-xs text-zinc-600">
              Frag etwas zum Projekt — oder auch nicht. Der „Fragen"-Modus ist rein lesend.
              Zum tatsächlichen Umsetzen von Änderungen wechsle zu „Arbeiten".
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id}>
              <MessageBubble message={m} text={liveText(m)} streaming={m.status === 'streaming' && busy} />
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  onAccept={() => setProposalDialog({ messageId: m.id, proposal: m.proposal! })}
                  onDecline={() => declineProposal(m.id)}
                  onOpenFeature={openFeature}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {sendError && (
        <div className="flex items-center justify-between border-t border-red-900 bg-red-950/60 px-3 py-1.5 text-xs text-red-300">
          <span className="truncate">{sendError}</span>
          <button onClick={() => setSendError(null)} className="ml-2 text-red-400 hover:text-red-200">
            ✕
          </button>
        </div>
      )}

      {mode === 'ask' && (
        <footer className="border-t border-zinc-800 p-2">
          <div className="flex items-end gap-2">
            <textarea
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={busy ? 'Antwort läuft …' : 'Frage stellen … (Enter sendet)'}
              rows={2}
              className="min-h-0 flex-1 resize-none rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
            >
              {busy ? '…' : 'Senden'}
            </button>
          </div>
        </footer>
      )}

      {confirmReset && (
        <ConfirmDialog
          title="Neue Unterhaltung"
          message="Die bisherige Unterhaltung wird beendet und nicht mehr angezeigt. Eine laufende Antwort wird abgebrochen."
          confirmLabel="Neue Unterhaltung"
          onConfirm={() => void reset()}
          onClose={() => setConfirmReset(false)}
        />
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title="Arbeit verwerfen"
          message="Die isolierte Arbeitskopie samt Branch und allen bisher gemachten Änderungen wird restlos entfernt. Die Haupt-Arbeitskopie bleibt unberührt. Das lässt sich nicht rückgängig machen."
          confirmLabel="Verwerfen"
          onConfirm={() => void discard()}
          onClose={() => setConfirmDiscard(false)}
        />
      )}

      {/* Dialog-Abbruch lässt den Vorschlag offen — erneut aufrufbar (Edge Case). */}
      {proposalDialog && (
        <NewFeatureDialog
          projectId={projectId}
          initialName={proposalDialog.proposal.name}
          initialDescription={proposalDialog.proposal.description}
          onCreated={(featureId) => proposalCreated(proposalDialog.messageId, featureId)}
          onClose={() => setProposalDialog(null)}
        />
      )}
    </div>
  );
}

/** Arbeits-Modus: echte Konsole (isolierte Session) + Steuerung + Prompt-Leiste. */
function WorkView({
  projectId,
  conversationId,
  status,
  branch,
  integrating,
  input,
  onInput,
  onSend,
  onInterrupt,
  onIntegrate,
  onDiscard,
  busy,
}: {
  projectId: string;
  conversationId: string | null;
  status: string;
  branch: string | null;
  integrating: boolean;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  onInterrupt: () => void;
  onIntegrate: () => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  const statusTone =
    status === 'working'
      ? 'bg-emerald-500'
      : status === 'awaiting_input'
        ? 'bg-amber-500'
        : status === 'errored'
          ? 'bg-red-500'
          : 'bg-zinc-600';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Steuerleiste (FR-006/FR-007) */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs">
        <span className={`h-2 w-2 rounded-full ${statusTone}`} title={status} />
        {branch && <code className="truncate text-[10px] text-zinc-500">{branch}</code>}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onInterrupt}
            disabled={!busy}
            title="Laufenden Turn abbrechen (Session bleibt)"
            className="rounded px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          >
            ⏸ Unterbrechen
          </button>
          <button
            onClick={onIntegrate}
            disabled={integrating}
            title="Änderungen prüfen und nach main übernehmen"
            className="rounded bg-sky-800 px-2 py-0.5 text-sky-100 hover:bg-sky-700 disabled:opacity-40"
          >
            {integrating ? 'Übernehme …' : '✓ Übernehmen'}
          </button>
          <button
            onClick={onDiscard}
            title="Arbeitskopie samt Branch verwerfen"
            className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-400 hover:bg-zinc-800"
          >
            🗑 Verwerfen
          </button>
        </div>
      </div>

      {/* Echte Konsole der Arbeits-Session */}
      <div className="min-h-0 flex-1 bg-black">
        {conversationId ? (
          <TerminalPane
            key={conversationId}
            featureId={null}
            getSession={() => api.ensureChatWorkSession(projectId)}
            focused
            fontSize={12}
          />
        ) : (
          <p className="p-4 text-xs text-zinc-500">Arbeits-Session wird vorbereitet …</p>
        )}
      </div>

      {/* Prompt-Leiste */}
      <footer className="border-t border-zinc-800 p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Änderung beschreiben oder Problem schildern … (Enter sendet)"
            rows={2}
            className="min-h-0 flex-1 resize-none rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
          />
          <button
            onClick={onSend}
            disabled={!input.trim()}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            Senden
          </button>
        </div>
      </footer>
    </div>
  );
}

/** Feature-Vorschlag des Assistenten: Karte mit Entscheidung (FR-005–FR-008, FR-011). */
function ProposalCard({
  proposal,
  onAccept,
  onDecline,
  onOpenFeature,
}: {
  proposal: FeatureProposal;
  onAccept: () => void;
  onDecline: () => void;
  onOpenFeature: (featureId: string) => void;
}) {
  return (
    <div className="mt-1 max-w-[90%] rounded-lg border border-sky-900 bg-sky-950/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-sky-300">💡 Feature-Vorschlag</span>
        <code className="truncate rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300">{proposal.name}</code>
        {proposal.status !== 'offen' && (
          <span
            className={`ml-auto text-xs font-medium ${
              proposal.status === 'angenommen' ? 'text-emerald-400' : 'text-zinc-500'
            }`}
          >
            {proposal.status === 'angenommen' ? '✓ angenommen' : 'abgelehnt'}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs whitespace-pre-wrap text-zinc-400">{proposal.description}</p>
      {proposal.status === 'offen' && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={onAccept}
            className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600"
          >
            Feature anlegen …
          </button>
          <button
            onClick={onDecline}
            className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            Ablehnen
          </button>
        </div>
      )}
      {proposal.status === 'angenommen' && proposal.featureId && (
        <button
          onClick={() => onOpenFeature(proposal.featureId!)}
          className="mt-2 rounded border border-emerald-800 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-950"
        >
          Zur Feature-Konsole →
        </button>
      )}
    </div>
  );
}

function MessageBubble({ message, text, streaming }: { message: ChatMessage; text: string; streaming: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-emerald-900/50 px-3 py-2 text-sm whitespace-pre-wrap text-zinc-100">
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="max-w-[90%] rounded-lg rounded-bl-sm bg-zinc-800 px-3 py-2 text-sm whitespace-pre-wrap text-zinc-200">
        {text}
        {streaming && <span className="ml-0.5 animate-pulse text-zinc-400">▍</span>}
        {message.status === 'error' && (
          <p className="mt-1 text-xs text-red-400">⚠ {message.error ?? 'Antwort fehlgeschlagen'}</p>
        )}
        {message.status === 'interrupted' && (
          <p className="mt-1 text-xs text-amber-400">⏸ Antwort unterbrochen (z. B. durch Neustart)</p>
        )}
      </div>
      {message.status === 'complete' && (message.tokens !== null || message.costUsd !== null) && (
        <span className="px-1 text-[10px] text-zinc-600">
          {message.tokens !== null && `${message.tokens.toLocaleString('de-DE')} Tokens`}
          {message.tokens !== null && message.costUsd !== null && ' · '}
          {message.costUsd !== null && `$${message.costUsd.toFixed(4)}`}
        </span>
      )}
    </div>
  );
}
