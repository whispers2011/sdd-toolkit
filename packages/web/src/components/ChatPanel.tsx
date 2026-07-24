import { useEffect, useState } from 'react';
import { api, type ChatState } from '../api.js';
import { useStore } from '../store.js';
import { TerminalPane } from './TerminalPane.js';
import { CloseIcon, IdeaIcon, RestartIcon } from './icons.js';

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

/**
 * Projekt-Chat: eine vollwertige, interaktive Claude-Code-Session (echte Konsole). Man tippt
 * direkt in die Konsole — kein Eingabefeld, keine Modi, keine Steuerbuttons. Das Fenster ist
 * frei größenverstellbar. Schlägt die Session Feature(s) vor, erscheint eine Bestätigungskarte.
 * Das Neustart-Icon im Kopf verwirft die aktuelle Unterhaltung und startet eine frische Session
 * (bei laufender Arbeit/dirty Worktree erst nach Bestätigung).
 */
export function ChatPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { state } = useStore();
  const [chat, setChat] = useState<ChatState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState(loadSize);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restarting, setRestarting] = useState(false);

  const load = () =>
    void api
      .getChat(projectId)
      .then(setChat)
      .catch((e: Error) => setError(e.message));

  // Beim Öffnen: erst den Zustand prüfen. Eine wegen Inaktivität pausierte (fortsetzbare)
  // Session wird NICHT still resumt — stattdessen fragt die Karte den Nutzer. Eine frische
  // Unterhaltung startet wie gehabt automatisch.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    void api
      .getChat(projectId)
      .then((st) => {
        if (cancelled) return undefined;
        setChat(st);
        if (st.workPaused && !st.workSession) return undefined; // pausiert → Karte, nicht starten
        return api.ensureChatWorkSession(projectId).then(() => {
          if (cancelled) return;
          setReady(true);
          load();
        });
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
  // Wegen 5 min Inaktivität pausiert: Session beendet, Verlauf erhalten. Der Nutzer
  // entscheidet, ob fortgesetzt (claude --resume) oder frisch begonnen wird.
  const paused = !!chat?.workPaused;

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

  // Neustart: frische Session. Bei drohendem Verlust erst bestätigen lassen (FR-006).
  const runRestart = async (confirm: boolean): Promise<void> => {
    const res = await api.restartChatWorkSession(projectId, confirm);
    if ('needsConfirm' in res) {
      const msg =
        res.reason === 'running'
          ? 'Der Chat arbeitet gerade. Ein Neustart verwirft die laufende Arbeit. Trotzdem neu starten?'
          : 'Die Arbeitskopie enthält unbestätigte Änderungen, die beim Neustart verloren gehen. Trotzdem neu starten?';
      if (window.confirm(msg)) await runRestart(true);
      return;
    }
    load(); // neue conversationId → TerminalPane remountet auf die frische Session
  };

  const onRestart = () => {
    if (restarting) return;
    setRestarting(true);
    setError(null);
    void runRestart(false)
      .catch((e: Error) => setError(e.message))
      .finally(() => setRestarting(false));
  };

  // Pausierten Chat fortsetzen: Karte sofort ausblenden, Terminal mounten → dessen
  // getSession() resumt die alte Unterhaltung (claude --resume + Scrollback-Snapshot).
  // Bewusst kein load() hier: getChat könnte zurückkommen, bevor die resumte Session
  // serverseitig live ist (workPaused kurz wieder true → Karten-Flackern). Der Status
  // aktualisiert sich über den App-WS; chat_updated-Events lösen später ein load() aus.
  const resume = () => {
    setError(null);
    setChat((c) => (c ? { ...c, workPaused: false } : c));
    setReady(true);
  };

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
        <button
          onClick={onRestart}
          disabled={restarting}
          title="Chat neu starten (frische Session)"
          className="ml-auto rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
        >
          <RestartIcon />
        </button>
        <button
          onClick={onClose}
          title="Schließen (Session läuft weiter)"
          className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <CloseIcon />
        </button>
      </header>

      {error && (
        <div className="flex items-center justify-between border-b border-red-900 bg-red-950/60 px-3 py-1.5 text-xs text-red-300">
          <span className="truncate">{error}</span>
          <button
            onClick={() => setError(null)}
            title="Fehler ausblenden"
            className="ml-2 text-red-400 hover:text-red-200"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Echte Konsole der Session — man tippt direkt hier hinein.
          Hintergrund folgt dem Terminal-Theme (zinc-950 ⇄ hell). */}
      <div className="min-h-0 flex-1 bg-zinc-950">
        {paused ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <span className="text-3xl text-zinc-500" aria-hidden>
              ⏸
            </span>
            <div>
              <p className="text-sm font-semibold text-zinc-200">Chat wegen Inaktivität pausiert</p>
              <p className="mt-1 text-xs text-zinc-500">
                Seit 5 min keine Aktivität — die Session wurde beendet. Dein Verlauf ist erhalten.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={resume}
                className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-zinc-50 hover:bg-emerald-600"
              >
                Chat fortsetzen
              </button>
              <button
                onClick={onRestart}
                disabled={restarting}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                Neuen Chat starten
              </button>
            </div>
          </div>
        ) : ready ? (
          <TerminalPane
            key={conversationId ?? 'boot'}
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
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-sky-300">
            <IdeaIcon />
            <span>
              {pending.features.length === 1 ? 'Feature vorgeschlagen' : `${pending.features.length} Features vorgeschlagen`} — anlegen?
            </span>
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
              className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-zinc-50 hover:bg-emerald-600 disabled:opacity-40"
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
      )}
    </div>
  );
}
