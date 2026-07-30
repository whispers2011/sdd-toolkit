import type { ChangeFile, ChangeOverview as Overview } from '@sdd/shared';

/**
 * Änderungsübersicht in der Mitte des Reiters „Dateien": was dieses Feature
 * überhaupt anfasst, bevor eine Datei gewählt ist.
 *
 * Rein darstellend — Kürzung, Sortierung und Gruppierung stehen in
 * `buildChangeOverview` (`@sdd/shared`); hier wird nichts gerechnet und nichts
 * nachgeladen.
 */
export function ChangeOverview({
  overview,
  targetBranch,
  onSelectFile,
}: {
  overview: Overview;
  targetBranch: string;
  onSelectFile: (path: string) => void;
}) {
  // Kein Kennzahlenblock mit Nullwerten: „0 Dateien +0 −0" sähe wie ein Fehler
  // aus, obwohl der Vergleich einfach leer ist (FR-005).
  if (!overview.hasChanges) {
    return <p className="p-4 text-sm text-zinc-400">Keine Änderungen gegenüber {targetBranch}.</p>;
  }

  const { totals, groups, hiddenFiles, recentCommits, hasCommits } = overview;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-6">
        <Stat label="Geänderte Dateien" value={String(totals.files)} />
        <Stat
          label="Zeilen"
          value={
            <>
              <span className="text-emerald-300">+{totals.additions}</span>{' '}
              <span className="text-red-300">−{totals.deletions}</span>
            </>
          }
        />
        <Stat label="Commits" value={String(totals.commits)} />
      </div>

      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="mb-1 font-mono text-xs text-zinc-400">{group.key}</div>
            <ul>
              {group.files.map((file) => (
                <li key={file.path}>
                  <button
                    onClick={() => onSelectFile(file.path)}
                    className="flex w-full items-center gap-3 rounded px-2 py-1 text-left text-sm text-zinc-300 hover:bg-zinc-900"
                    title={file.path}
                  >
                    <span className="truncate">{relativeToGroup(file.path, group.key)}</span>
                    <span className="ml-auto shrink-0 whitespace-nowrap text-xs">
                      <FileVolume file={file} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {hiddenFiles > 0 && (
          <p className="px-2 text-xs text-zinc-400">
            +{hiddenFiles} weitere Dateien — vollständige Liste links.
          </p>
        )}
      </div>

      <div className="border-t border-zinc-800 pt-3">
        <div className="mb-1 text-xs text-zinc-400">
          {totals.commits} {totals.commits === 1 ? 'Commit' : 'Commits'}
        </div>
        {hasCommits ? (
          <>
            <ul className="flex flex-col gap-1">
              {recentCommits.map((c) => (
                <li key={c.sha} className="flex items-baseline gap-3 text-sm text-zinc-300">
                  <span className="truncate">{c.subject}</span>
                  <span className="ml-auto shrink-0 text-xs text-zinc-400">
                    {new Date(c.date).toLocaleString('de-CH')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-zinc-400">Vollständige Historie im Reiter „Historie".</p>
          </>
        ) : (
          <p className="text-sm text-zinc-400">
            Noch keine Commits — die Arbeit liegt ungetrackt im Worktree.
          </p>
        )}
      </div>
    </div>
  );
}

/** Binärdateien haben keine Zeilenbilanz — „+0 −0" wäre eine Falschaussage (FR-003). */
function FileVolume({ file }: { file: ChangeFile }) {
  if (file.binary) return <span className="text-zinc-400">binär</span>;
  return (
    <>
      <span className="text-emerald-300">+{file.additions}</span>{' '}
      <span className="text-red-300">−{file.deletions}</span>
    </>
  );
}

/** Der Gruppenschlüssel steht schon in der Überschrift — die Zeile zeigt den Rest. */
function relativeToGroup(path: string, groupKey: string): string {
  return path.startsWith(`${groupKey}/`) ? path.slice(groupKey.length + 1) : path;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="flex flex-col">
      <span className="text-sm text-zinc-200">{value}</span>
      <span className="text-xs text-zinc-400">{label}</span>
    </span>
  );
}
