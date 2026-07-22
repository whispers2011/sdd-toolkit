import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type View } from '../store.js';

interface Entry {
  label: string;
  hint: string;
  view: View;
  projectId?: string | null;
}

/** Quick-Switcher (WP16/Q5): ⌘K — Projekte, Features und Views anspringen. */
export function QuickSwitcher() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        setSelected(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    if (!state.app) return [];
    const list: Entry[] = [
      { label: 'Board', hint: 'Ansicht', view: { kind: 'board' } },
      { label: 'Grid', hint: 'Ansicht', view: { kind: 'grid' } },
      { label: 'Läufe', hint: 'Ansicht', view: { kind: 'executions' } },
      { label: 'Braucht dich', hint: 'Ansicht', view: { kind: 'inbox' } },
    ];
    for (const p of state.app.projects) {
      list.push({ label: p.name, hint: 'Projekt', view: { kind: 'board' }, projectId: p.id });
      list.push({ label: `${p.name}: Terminal`, hint: 'Shell', view: { kind: 'shell', projectId: p.id } });
    }
    for (const f of state.app.features) {
      const project = state.app.projects.find((p) => p.id === f.projectId);
      list.push({
        label: `${project?.name ?? '?'} / ${f.name}`,
        hint: 'Feature-Konsole',
        view: { kind: 'console', featureId: f.id },
      });
    }
    return list;
  }, [state.app]);

  const matches = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return entries.slice(0, 12);
    // Einfache Fuzzy-Suche: alle Zeichen in Reihenfolge enthalten.
    const fuzzy = (text: string) => {
      let i = 0;
      for (const ch of text.toLowerCase()) if (ch === q[i]) i++;
      return i === q.length;
    };
    return entries
      .filter((e) => e.label.toLowerCase().includes(q) || fuzzy(e.label))
      .slice(0, 12);
  }, [entries, query]);

  const activate = (entry: Entry) => {
    if (entry.projectId !== undefined) dispatch({ type: 'select_project', projectId: entry.projectId });
    dispatch({ type: 'set_view', view: entry.view });
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-32" onClick={() => setOpen(false)}>
      <div className="w-[32rem] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSelected((s) => Math.min(s + 1, matches.length - 1));
            else if (e.key === 'ArrowUp') setSelected((s) => Math.max(s - 1, 0));
            else if (e.key === 'Enter' && matches[selected]) activate(matches[selected]);
          }}
          placeholder="Projekt, Feature oder Ansicht …"
          className="w-full border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-200 outline-none"
        />
        <ul className="max-h-72 overflow-y-auto p-1">
          {matches.map((entry, i) => (
            <li key={`${entry.label}:${entry.hint}`}>
              <button
                onClick={() => activate(entry)}
                onMouseEnter={() => setSelected(i)}
                className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm ${
                  i === selected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
                }`}
              >
                <span className="truncate">{entry.label}</span>
                <span className="ml-auto text-xs text-zinc-600">{entry.hint}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-4 text-center text-xs text-zinc-600">Keine Treffer.</li>}
        </ul>
      </div>
    </div>
  );
}
