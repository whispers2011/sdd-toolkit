import { useState } from 'react';
import { useStore } from '../store.js';
import { ChatPanel } from './ChatPanel.js';

/**
 * Sprechblase des Projekt-Chats (Ask-a-Question): schwebt unten rechts,
 * nur sichtbar bei geöffnetem Projekt (FR-001). Öffnen/Schließen ist lokaler
 * UI-State — Verlauf und Streams leben in Store/DB und überleben das Panel.
 */
export function ChatBubble() {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const projectId = state.selectedProjectId;
  if (!projectId) return null;

  const busy = Object.values(state.chatStreams).some((s) => s.projectId === projectId && !s.done);

  return (
    <>
      {open && <ChatPanel key={projectId} projectId={projectId} onClose={() => setOpen(false)} />}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Projekt-Chat schließen' : 'Projekt-Chat öffnen'}
        className="fixed right-4 bottom-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xl shadow-lg transition-colors hover:bg-zinc-700"
      >
        {open ? '✕' : '💬'}
        {busy && (
          <span className="absolute -top-0.5 -right-0.5 h-3 w-3 animate-pulse rounded-full bg-emerald-500" />
        )}
      </button>
    </>
  );
}
