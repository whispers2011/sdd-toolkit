import { useCallback, useEffect, useState } from 'react';
import { featureProgressLabel } from '@sdd/shared';
import type {
  FileChangeKind,
  FileChangeState,
  MainCheckoutInfo,
  WorktreeEntry,
  WorktreeFileChange,
  WorktreeOverview as Overview,
  WorktreeProjectGroup,
  WorktreeWarning,
  WorktreeWarningKind,
} from '@sdd/shared';
import { api, WorktreeRemoveError } from '../api.js';
import { useStore } from '../store.js';
import { ConfirmDialog } from './Sidebar.js';
import { ChevronDownIcon, WorktreeIcon } from './icons.js';

/** Kürzel + Tooltip je Änderungsart (ui-contract C3.2). */
const KIND_MARK: Record<FileChangeKind, { mark: string; title: string; tone: string }> = {
  added: { mark: '+', title: 'neu', tone: 'text-emerald-500' },
  modified: { mark: '~', title: 'geändert', tone: 'text-sky-500' },
  deleted: { mark: '−', title: 'gelöscht', tone: 'text-red-500' },
  renamed: { mark: '→', title: 'umbenannt', tone: 'text-amber-500' },
};

const STATE_LABEL: Record<FileChangeState, string> = {
  committed: 'committet',
  uncommitted: 'uncommittet',
  both: 'committet + geändert',
};

/** Warn-Badges: optisch unterscheidbar, damit mehrere Lagen nebeneinander lesbar bleiben (C4.2). */
const WARNING_BADGE: Record<WorktreeWarningKind, { label: string; tone: string }> = {
  already_merged: { label: 'bereits integriert', tone: 'bg-emerald-950/60 text-emerald-300' },
  overlap: { label: 'Überschneidung', tone: 'bg-amber-950/60 text-amber-300' },
  behind_target: { label: 'veraltet', tone: 'bg-sky-950/60 text-sky-300' },
};

const plural = (n: number): string => (n === 1 ? 'Datei' : 'Dateien');

/** Erhebungszeitpunkt als HH:MM:SS (C6 „Stand"). */
const clockTime = (ts: number): string => new Date(ts).toLocaleTimeString('de-CH');

/** Klartext einer Warnung (ui-contract C4). */
function warningText(warning: WorktreeWarning, targetBranch: string): string {
  switch (warning.kind) {
    case 'already_merged':
      return 'bereits integriert — Worktree kann entfernt werden';
    case 'overlap': {
      const others = warning.others.map((o) => o.label).join(', ');
      return `Überschneidung mit ${others || 'einem anderen Worktree'}: ${warning.fileCount} ${plural(warning.fileCount)}`;
    }
    case 'behind_target':
      return `gegenüber ${targetBranch} veraltet: ${warning.fileCount} ${plural(warning.fileCount)} dort ebenfalls geändert`;
  }
}

/**
 * Tool-weite Worktree-Übersicht (Einstieg: Einstellungen → „Worktree-Übersicht").
 * Zeigt je Projekt den Haupt-Checkout und alle offenen Worktrees mit
 * Feature-Zuordnung, Branch, Pfad, Bearbeitungsstand und den gegenüber dem
 * Zielbranch geänderten Dateien — projektübergreifend, deshalb bewusst kein Tab
 * in der projektbezogenen Kopfleiste.
 */
/** Laufender Entfern-Vorgang: erste Bestätigung bzw. ausdrückliche Zweitbestätigung. */
type Removal =
  | { stage: 'confirm'; entry: WorktreeEntry }
  | { stage: 'force'; entry: WorktreeEntry; uncommittedFileCount: number };

export function WorktreeOverview() {
  const { state } = useStore();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Aufklappzustand über entry.id — überlebt jede Aktualisierung (C3.7).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback((refresh = false) => {
    setLoading(true);
    return api
      .worktrees(refresh)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Toolkit-eigene Änderungen (Merge, Cleanup, neues Feature) kommen über WS in
  // den Store — daran hängt ein zusätzlicher Refetch (C6.2).
  const featuresKey = state.app?.features.map((f) => `${f.id}:${f.integration}`).join(',');

  useEffect(() => {
    void load();
  }, [load, featuresKey]);

  // Extern (im Terminal) angelegte Worktrees erzeugen kein Toolkit-Event —
  // nur Polling erfasst sie. Läuft ausschließlich, solange die View steht (C6.1).
  useEffect(() => {
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  const toggle = useCallback((id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /**
   * Entfernen ausführen. Ein `409 uncommitted` ist kein Fehler, sondern der
   * geplante Halt vor der Zweitbestätigung — erst sie sendet `force` (FR-024).
   */
  const remove = (entry: WorktreeEntry, force: boolean) => {
    setRemoveError(null);
    void api
      .removeWorktree({ projectId: entry.projectId, path: entry.path, force })
      .then(() => load())
      .catch((e: unknown) => {
        if (e instanceof WorktreeRemoveError && e.code === 'uncommitted') {
          setRemoval({ stage: 'force', entry, uncommittedFileCount: e.uncommittedFileCount });
          return;
        }
        setRemoveError(e instanceof Error ? e.message : String(e));
        return load();
      });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-zinc-100">Worktree-Übersicht</h1>
        <span className="ml-auto text-xs text-zinc-500">
          {/* Während des Ladens werden alte Daten nie als aktuell ausgegeben (FR-031). */}
          {loading ? 'wird aktualisiert …' : data ? `Stand ${clockTime(data.collectedAt)}` : ''}
        </span>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          title="Neu erheben (umgeht den Server-Cache)"
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
        >
          ↻ Aktualisieren
        </button>
      </div>

      {error && (
        <p className="flex items-center gap-3 rounded border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          <span className="min-w-0 flex-1">Übersicht konnte nicht geladen werden: {error}</span>
          <button
            onClick={() => void load(true)}
            className="shrink-0 rounded border border-red-800 px-2 py-0.5 text-xs hover:bg-red-900"
          >
            Erneut versuchen
          </button>
        </p>
      )}

      {removeError && (
        <p className="rounded border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          Entfernen fehlgeschlagen: {removeError}
        </p>
      )}

      {!data && !error && <p className="text-sm text-zinc-600">Lade Worktree-Übersicht …</p>}

      {data?.groups.length === 0 && (
        <p className="rounded border border-zinc-800 px-4 py-6 text-center text-sm text-zinc-600">
          Noch keine Projekte konfiguriert.
        </p>
      )}

      {data?.groups.map((group) => (
        <ProjectBlock
          key={group.projectId}
          group={group}
          expanded={expanded}
          onToggle={toggle}
          onRemove={(entry) => setRemoval({ stage: 'confirm', entry })}
        />
      ))}

      {removal?.stage === 'confirm' && (
        <ConfirmDialog
          title="Worktree entfernen?"
          message={firstConfirmText(removal.entry)}
          confirmLabel="Entfernen"
          onConfirm={() => remove(removal.entry, false)}
          onClose={() => setRemoval(null)}
        />
      )}
      {removal?.stage === 'force' && (
        <ConfirmDialog
          title="Uncommittete Arbeit geht verloren"
          message={forceConfirmText(removal.entry, removal.uncommittedFileCount)}
          confirmLabel="Endgültig entfernen"
          onConfirm={() => remove(removal.entry, true)}
          onClose={() => setRemoval(null)}
        />
      )}
    </div>
  );
}

/** Erste Bestätigung: nennt Feature/Label, Branch, Pfad und Umfang (FR-023). */
function firstConfirmText(entry: WorktreeEntry): string {
  return [
    `${entry.label}`,
    `Branch: ${entry.branch ?? 'losgelöster HEAD'}`,
    `Pfad: ${entry.path}`,
    '',
    entry.changedFileCount === 0
      ? `Keine Änderungen gegenüber ${entry.targetBranch}.`
      : `${entry.changedFileCount} geänderte ${plural(entry.changedFileCount)}, davon ${entry.uncommittedFileCount} uncommittet.`,
    '',
    'Das Verzeichnis wird von der Festplatte entfernt. Der Branch bleibt bestehen.',
  ].join('\n');
}

/** Zweitbestätigung: benennt ausdrücklich, was unwiederbringlich verloren geht (SC-009). */
function forceConfirmText(entry: WorktreeEntry, uncommitted: number): string {
  return [
    `Im Worktree „${entry.label}" ${uncommitted === 1 ? 'ist' : 'sind'} ${uncommitted} ${plural(uncommitted)} uncommittet.`,
    'Diese Arbeit ist nach dem Entfernen unwiederbringlich verloren.',
    '',
    `Pfad: ${entry.path}`,
  ].join('\n');
}

/** Ein Projektblock: Kopfzeile, Haupt-Checkout, offene Worktrees (bzw. Fehlermeldung). */
function ProjectBlock({
  group,
  expanded,
  onToggle,
  onRemove,
}: {
  group: WorktreeProjectGroup;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onRemove: (entry: WorktreeEntry) => void;
}) {
  return (
    <section className="rounded border border-zinc-800">
      <header className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2">
        <WorktreeIcon className="shrink-0 text-zinc-500" />
        <span className="truncate text-sm font-semibold text-zinc-100">{group.projectName}</span>
        {group.main?.branch && <span className="truncate text-xs text-zinc-500">{group.main.branch}</span>}
        <span className="ml-auto shrink-0 text-xs text-zinc-500">
          {group.worktreeCount} {group.worktreeCount === 1 ? 'Worktree' : 'Worktrees'}
        </span>
      </header>

      {group.error ? (
        <p className="px-4 py-3 text-sm text-red-400">Projekt nicht erreichbar: {group.error}</p>
      ) : (
        <>
          {group.main && <MainRow main={group.main} />}
          {group.worktrees.length === 0 ? (
            <p className="px-4 py-4 text-center text-sm text-zinc-600">Keine offenen Worktrees</p>
          ) : (
            <ul className="divide-y divide-zinc-800/70">
              {group.worktrees.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  expanded={expanded.has(entry.id)}
                  onToggle={() => onToggle(entry.id)}
                  onRemove={() => onRemove(entry)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Haupt-Checkout: erster, optisch abgesetzter Eintrag — nie mit Entfernen-Aktion (FR-026). */
function MainRow({ main }: { main: MainCheckoutInfo }) {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/30 px-4 py-2">
      <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
        Haupt-Checkout
      </span>
      <span className="shrink-0 text-xs text-zinc-400">{main.branch ?? 'losgelöster HEAD'}</span>
      <span className="truncate text-xs text-zinc-600" title={main.path}>
        {main.path}
      </span>
      <span className="ml-auto shrink-0 text-xs text-zinc-500">
        {main.uncommittedFileCount === 0
          ? 'nichts uncommittet'
          : `${main.uncommittedFileCount} uncommittet`}
      </span>
    </div>
  );
}

/** Ein Worktree-Eintrag: Label, Branch, Pfad, Bearbeitungsstand, Kennzeichnungen, Dateiliste. */
function EntryRow({
  entry,
  expanded,
  onToggle,
  onRemove,
}: {
  entry: WorktreeEntry;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { state, dispatch } = useStore();
  const feature = entry.featureId ? state.app?.features.find((f) => f.id === entry.featureId) : undefined;
  const hasFiles = entry.dirState === 'present';

  const openFeature = () => {
    if (!entry.featureId) return;
    dispatch({ type: 'select_project', projectId: entry.projectId });
    dispatch({ type: 'set_view', view: { kind: 'console', featureId: entry.featureId } });
  };

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        {hasFiles ? (
          <button
            onClick={onToggle}
            title={expanded ? 'Dateiliste einklappen' : 'Dateiliste aufklappen'}
            className="shrink-0 text-zinc-600 hover:text-zinc-300"
          >
            <ChevronDownIcon className={`transition-transform ${expanded ? '' : '-rotate-90'}`} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {entry.featureId ? (
          <button
            onClick={openFeature}
            title="Zur Feature-Konsole springen"
            className="shrink-0 truncate text-sm font-medium text-zinc-100 hover:underline"
          >
            {entry.label}
          </button>
        ) : (
          <span className="shrink-0 truncate text-sm font-medium text-zinc-300">{entry.label}</span>
        )}
        <span className="shrink-0 truncate text-xs text-zinc-500">{entry.branch ?? 'losgelöster HEAD'}</span>
        {feature && <span className="shrink-0 text-xs text-sky-500">{featureProgressLabel(feature)}</span>}
        <EntryTags entry={entry} />
      </div>

      <div className="mt-0.5 flex items-center gap-3 pl-6">
        <span className="truncate text-xs text-zinc-600" title={entry.path}>
          {entry.path}
        </span>
        {hasFiles && (
          <span className="ml-auto shrink-0 text-xs text-zinc-500">
            {entry.changedFileCount === 0
              ? 'keine Änderungen'
              : `${entry.changedFileCount} ${plural(entry.changedFileCount)} · ${entry.uncommittedFileCount} uncommittet`}
          </span>
        )}
        {/* Entfernen nur für tatsächlich entfernbare Einträge; Session-Sperre wird benannt (C5.1). */}
        {entry.removable ? (
          <button
            onClick={onRemove}
            title="Worktree-Verzeichnis entfernen (Branch bleibt bestehen)"
            className={`shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 ${hasFiles ? '' : 'ml-auto'}`}
          >
            Entfernen
          </button>
        ) : (
          entry.sessionActive && (
            <span
              title="Beende die Session, bevor der Worktree entfernt werden kann"
              className={`shrink-0 cursor-not-allowed rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-600 ${hasFiles ? '' : 'ml-auto'}`}
            >
              Session aktiv — Entfernen gesperrt
            </span>
          )
        )}
      </div>

      {entry.warnings.length > 0 && (
        <ul className="mt-1.5 space-y-1 pl-6">
          {entry.warnings.map((warning) => (
            <WarningRow key={warning.kind} warning={warning} targetBranch={entry.targetBranch} />
          ))}
        </ul>
      )}

      {entry.error && <p className="mt-1 pl-6 text-xs text-red-400">{entry.error}</p>}
      {expanded && hasFiles && <FileList entry={entry} />}
    </li>
  );
}

/** Eine Warnung: Badge, Klartext und — auf Wunsch — die betroffenen Dateien (C4.3). */
function WarningRow({ warning, targetBranch }: { warning: WorktreeWarning; targetBranch: string }) {
  const [showFiles, setShowFiles] = useState(false);
  const badge = WARNING_BADGE[warning.kind];
  return (
    <li className="text-xs">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${badge.tone}`}>{badge.label}</span>
        <span className="truncate text-zinc-400">{warningText(warning, targetBranch)}</span>
        {warning.files.length > 0 && (
          <button
            onClick={() => setShowFiles((v) => !v)}
            className="shrink-0 text-zinc-600 hover:text-zinc-300"
          >
            {showFiles ? 'Dateien verbergen' : 'Dateien zeigen'}
          </button>
        )}
      </div>
      {showFiles && (
        <ul className="mt-1 ml-2 max-h-40 space-y-0.5 overflow-y-auto border-l border-zinc-800 pl-2">
          {warning.files.map((path) => (
            <li key={path} className="truncate text-zinc-500" title={path}>
              {path}
            </li>
          ))}
          {warning.fileCount > warning.files.length && (
            <li className="text-zinc-600">
              … zeigt {warning.files.length} von {warning.fileCount} {plural(warning.fileCount)}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** Aufgeklappte Dateiliste: Pfad, Änderungsart, Commit-Zustand — scrollend in fester Höhe. */
function FileList({ entry }: { entry: WorktreeEntry }) {
  if (entry.changedFileCount === 0) {
    return (
      <p className="mt-2 ml-6 rounded border border-zinc-800 px-3 py-2 text-xs text-zinc-500">
        Keine Änderungen gegenüber <span className="text-zinc-400">{entry.targetBranch}</span>
      </p>
    );
  }
  return (
    <div className="mt-2 ml-6 rounded border border-zinc-800">
      <ul className="max-h-64 divide-y divide-zinc-800/60 overflow-y-auto">
        {entry.files.map((file) => (
          <FileRow key={file.path} file={file} />
        ))}
      </ul>
      {entry.filesTruncated && (
        <p className="border-t border-zinc-800 px-3 py-1.5 text-xs text-zinc-600">
          … zeigt {entry.files.length} von {entry.changedFileCount} Dateien
        </p>
      )}
    </div>
  );
}

function FileRow({ file }: { file: WorktreeFileChange }) {
  const kind = KIND_MARK[file.kind];
  return (
    <li className="flex items-center gap-2 px-3 py-1 text-xs">
      <span className={`w-3 shrink-0 text-center font-mono ${kind.tone}`} title={kind.title}>
        {kind.mark}
      </span>
      <span className="truncate text-zinc-300" title={file.path}>
        {file.path}
      </span>
      {file.oldPath && (
        <span className="shrink-0 truncate text-zinc-600" title={`vorher: ${file.oldPath}`}>
          ← {file.oldPath}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {file.overlapping && (
          <span
            className="rounded bg-amber-950/60 px-1 py-0.5 text-[10px] text-amber-300"
            title="Auch in einem anderen offenen Worktree geändert"
          >
            überschneidet
          </span>
        )}
        {file.behindTarget && (
          <span
            className="rounded bg-sky-950/60 px-1 py-0.5 text-[10px] text-sky-300"
            title="Seit dem Abzweigpunkt auch auf dem Zielbranch geändert"
          >
            veraltet
          </span>
        )}
        <span className="text-zinc-500">{STATE_LABEL[file.state]}</span>
      </span>
    </li>
  );
}

/** Sichtbare Kennzeichnungen für Ausnahmelagen — nie stillschweigend weggelassen (SC-010). */
function EntryTags({ entry }: { entry: WorktreeEntry }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      {entry.kind === 'orphan' && <Tag tone="amber">ohne Feature-Zuordnung</Tag>}
      {entry.kind === 'chat' && <Tag tone="zinc">Wissens-Chat</Tag>}
      {entry.dirState === 'missing' && <Tag tone="red">Worktree-Verzeichnis fehlt</Tag>}
      {entry.dirState === 'registry_only' && <Tag tone="red">nur in der Git-Verwaltung geführt</Tag>}
    </span>
  );
}

const TAG_TONE = {
  zinc: 'bg-zinc-800 text-zinc-400',
  amber: 'bg-amber-950/60 text-amber-300',
  red: 'bg-red-950/60 text-red-300',
} as const;

export function Tag({ tone, children }: { tone: keyof typeof TAG_TONE; children: React.ReactNode }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${TAG_TONE[tone]}`}>{children}</span>;
}
