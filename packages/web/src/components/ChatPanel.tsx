import { useEffect, useState } from 'react';
import { api, type ChatState } from '../api.js';
import { useStore } from '../store.js';
<<<<<<< HEAD
import { TerminalPane } from './TerminalPane.js';

const MIN_W = 340;
const MIN_H = 320;
const DEFAULT_W = 640;
const DEFAULT_H = 560;
const SIZE_KEY = 'sdd-chat-size';

function loadSize(): { w: number; h: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) ?? '') as { w: number; h: number };
    if (s && typeof s.w === 'number' && typeof s.h === 'number') return s;
  } catch {
    /* Default */
  }
  return { w: DEFAULT_W, h: DEFAULT_H };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
=======
import { ConfirmDialog } from './Sidebar.js';
import { NewFeatureDialog } from './NewFeatureDialog.js';
import { CloseIcon, RestartIcon, IdeaIcon, CheckIcon, WarningIcon, PauseIcon } from './icons.js';
>>>>>>> 41e46a3 (feat(emojis-im-projekt-immer-als-svg-icon-hinterlegen): implementation)

/**
 * Projekt-Chat: eine vollwertige, interaktive Claude-Code-Session (echte Konsole). Man tippt
 * direkt in die Konsole — kein Eingabefeld, keine Modi, keine Steuerbuttons. Das Fenster ist
 * frei größenverstellbar. Schlägt die Session Feature(s) vor, erscheint eine Bestätigungskarte.
 */
export function ChatPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { state } = useStore();
  const [chat, setChat] = useState<ChatState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState(loadSize);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = () =>
    void api
      .getChat(projectId)
      .then(setChat)
      .catch((e: Error) => setError(e.message));

  // Beim Öffnen: Session sicherstellen (Worktree + interaktive Claude-Session), dann Zustand laden.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    void api
      .ensureChatWorkSession(projectId)
      .then(() => {
        if (cancelled) return;
        setReady(true);
        load();
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Invalidierungssignal: Feature-Vorschlag geändert / Turn fertig → Zustand neu laden.
  useEffect(() => {
    if (state.chatUpdated?.projectId === projectId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chatUpdated?.ts]);

  const conversationId = chat?.conversation?.id ?? null;
  const pending = chat?.pendingFeatures ?? null;
  const liveWork = state.app?.sessions.find((s) => conversationId && s.conversationId === conversationId);
  const status = liveWork?.status ?? chat?.workSession?.status ?? 'idle';
  const projectName = state.app?.projects.find((p) => p.id === projectId)?.name ?? '';

  // Bei neuem Vorschlag alle Features vorauswählen.
  useEffect(() => {
    if (pending) setSelected(new Set(pending.features.map((f) => f.name)));
  }, [pending?.id]);

  const toggle = (name: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const createFeatures = () => {
    const names = [...selected];
    if (names.length === 0) return;
    setError(null);
    void api.createChatFeatures(projectId, names).catch((e: Error) => setError(e.message));
  };

  const dismiss = () => void api.dismissChatFeatures(projectId).catch((e: Error) => setError(e.message));

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const sw = size.w;
    const sh = size.h;
    const onMove = (ev: PointerEvent) => {
      // Panel ist unten-rechts verankert: nach links/oben ziehen vergrößert.
      setSize({
        w: clamp(sw + (startX - ev.clientX), MIN_W, window.innerWidth - 40),
        h: clamp(sh + (startY - ev.clientY), MIN_H, window.innerHeight - 120),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setSize((cur) => {
        localStorage.setItem(SIZE_KEY, JSON.stringify(cur));
        return cur;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const statusTone =
    status === 'working'
      ? 'bg-emerald-500'
      : status === 'awaiting_input'
        ? 'bg-amber-500'
        : status === 'errored'
          ? 'bg-red-500'
          : 'bg-zinc-600';

  return (
    <div
      style={{ width: size.w, height: size.h }}
      className="fixed right-4 bottom-20 z-40 flex max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
    >
      {/* Resize-Griff oben links */}
      <div
        onPointerDown={startResize}
        title="Größe ändern"
        className="absolute top-0 left-0 z-50 h-5 w-5 cursor-nwse-resize"
      >
        <div className="m-1.5 h-2 w-2 border-t-2 border-l-2 border-zinc-500" />
      </div>

      <header className="flex items-center gap-2 border-b border-zinc-800 py-2 pr-3 pl-6">
        <span className={`h-2 w-2 rounded-full ${statusTone}`} title={status} />
        <span className="text-sm font-semibold text-zinc-100">Projekt-Chat</span>
        <span className="truncate text-xs text-zinc-500">{projectName}</span>
<<<<<<< HEAD
        <button
          onClick={onClose}
          title="Schließen (Session läuft weiter)"
          className="ml-auto rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ✕
        </button>
      </header>

      {error && (
        <div className="flex items-center justify-between border-b border-red-900 bg-red-950/60 px-3 py-1.5 text-xs text-red-300">
          <span className="truncate">{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-200">
            ✕
=======
        <div className="ml-auto flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={() => setConfirmReset(true)}
              title="Neue Unterhaltung beginnen"
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              <RestartIcon /> Neu
            </button>
          )}
          <button
            onClick={onClose}
            title="Schließen"
            className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-zinc-600">
            Frag etwas zum Projekt — oder auch nicht. Der Chat ist rein lesend;
            Features entstehen nur, wenn du es ausdrücklich bestätigst.
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

      {sendError && (
        <div className="flex items-center justify-between border-t border-red-900 bg-red-950/60 px-3 py-1.5 text-xs text-red-300">
          <span className="truncate">{sendError}</span>
          <button onClick={() => setSendError(null)} title="Fehler ausblenden" className="ml-2 text-red-400 hover:text-red-200">
            <CloseIcon />
>>>>>>> 41e46a3 (feat(emojis-im-projekt-immer-als-svg-icon-hinterlegen): implementation)
          </button>
        </div>
      )}

      {/* Echte Konsole der Session — man tippt direkt hier hinein. */}
      <div className="min-h-0 flex-1 bg-black">
        {ready ? (
          <TerminalPane
            key={projectId}
            featureId={null}
            getSession={() => api.ensureChatWorkSession(projectId)}
            focused
            fontSize={12}
          />
        ) : (
          !error && <p className="p-4 text-xs text-zinc-500">Claude-Session wird gestartet …</p>
        )}
      </div>

      {/* Feature-Vorschlag der Session → Bestätigungskarte */}
      {pending && (
        <div className="border-t border-sky-900 bg-sky-950/40 p-3">
          <p className="mb-2 text-xs font-semibold text-sky-300">
            💡 {pending.features.length === 1 ? 'Feature vorgeschlagen' : `${pending.features.length} Features vorgeschlagen`} — anlegen?
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {pending.features.map((f) => (
              <label
                key={f.name}
                className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-sky-900/30"
              >
                <input
                  type="checkbox"
                  checked={selected.has(f.name)}
                  onChange={() => toggle(f.name)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <code className="rounded bg-zinc-900 px-1 text-xs text-zinc-200">{f.name}</code>
                  <span className="block truncate text-[11px] text-zinc-400">{f.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={createFeatures}
              disabled={selected.size === 0}
              className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
            >
              Anlegen{selected.size > 1 ? ` (${selected.size})` : ''}
            </button>
            <button
              onClick={dismiss}
              className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              Verwerfen
            </button>
          </div>
        </div>
<<<<<<< HEAD
=======
      </footer>

      {confirmReset && (
        <ConfirmDialog
          title="Neue Unterhaltung"
          message="Die bisherige Unterhaltung wird beendet und nicht mehr angezeigt. Eine laufende Antwort wird abgebrochen."
          confirmLabel="Neue Unterhaltung"
          onConfirm={() => void reset()}
          onClose={() => setConfirmReset(false)}
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
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300"><IdeaIcon /> Feature-Vorschlag</span>
        <code className="truncate rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300">{proposal.name}</code>
        {proposal.status !== 'offen' && (
          <span
            className={`ml-auto text-xs font-medium ${
              proposal.status === 'angenommen' ? 'text-emerald-400' : 'text-zinc-500'
            }`}
          >
            {proposal.status === 'angenommen' ? (
              <span className="inline-flex items-center gap-1">
                <CheckIcon /> angenommen
              </span>
            ) : (
              'abgelehnt'
            )}
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
          <p className="mt-1 flex items-center gap-1 text-xs text-red-400"><WarningIcon /> {message.error ?? 'Antwort fehlgeschlagen'}</p>
        )}
        {message.status === 'interrupted' && (
          <p className="mt-1 flex items-center gap-1 text-xs text-amber-400"><PauseIcon /> Antwort unterbrochen (z. B. durch Neustart)</p>
        )}
      </div>
      {message.status === 'complete' && (message.tokens !== null || message.costUsd !== null) && (
        <span className="px-1 text-[10px] text-zinc-600">
          {message.tokens !== null && `${message.tokens.toLocaleString('de-DE')} Tokens`}
          {message.tokens !== null && message.costUsd !== null && ' · '}
          {message.costUsd !== null && `$${message.costUsd.toFixed(4)}`}
        </span>
>>>>>>> 41e46a3 (feat(emojis-im-projekt-immer-als-svg-icon-hinterlegen): implementation)
      )}
    </div>
  );
}
