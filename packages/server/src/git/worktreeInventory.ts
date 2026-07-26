import { gitOk } from './git.js';

/**
 * Ein von git geführter Worktree, so wie `git worktree list --porcelain` ihn ausweist.
 * Bewusst reicher als das schlanke `{ path, branch }` des WorktreeManagers: die
 * Worktree-Übersicht braucht `prunable` (Registry-Leiche) und `detached`/`bare`,
 * um Widersprüche zwischen Git-Verwaltung und Festplatte benennen zu können.
 */
export interface WorktreeInventoryEntry {
  path: string;
  /** Ausgecheckter Branch ohne `refs/heads/`-Präfix; null bei detached HEAD/bare. */
  branch: string | null;
  /** Commit-SHA des HEAD; null bei bare. */
  head: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  /** Begründung der Sperre, sofern git eine ausweist. */
  lockedReason: string | null;
  /** git hält den Eintrag für entfernbar (typischerweise: Verzeichnis verschwunden). */
  prunable: boolean;
  prunableReason: string | null;
}

function emptyEntry(path: string): WorktreeInventoryEntry {
  return {
    path,
    branch: null,
    head: null,
    detached: false,
    bare: false,
    locked: false,
    lockedReason: null,
    prunable: false,
    prunableReason: null,
  };
}

/**
 * Porcelain-Ausgabe vollständig parsen. Format: ein Attribut je Zeile
 * (`label` oder `label value`), Leerzeile beendet einen Datensatz; boolesche
 * Attribute erscheinen nur, wenn sie zutreffen.
 */
export function parseWorktreeListPorcelain(out: string): WorktreeInventoryEntry[] {
  const entries: WorktreeInventoryEntry[] = [];
  let cur: WorktreeInventoryEntry | null = null;

  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line === '') {
      if (cur) entries.push(cur);
      cur = null;
      continue;
    }
    const sep = line.indexOf(' ');
    const label = sep === -1 ? line : line.slice(0, sep);
    const value = sep === -1 ? '' : line.slice(sep + 1);

    if (label === 'worktree') {
      if (cur) entries.push(cur);
      cur = emptyEntry(value);
      continue;
    }
    if (!cur) continue; // Attribut ohne vorangehenden `worktree`-Kopf → ignorieren
    switch (label) {
      case 'HEAD':
        cur.head = value || null;
        break;
      case 'branch':
        cur.branch = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value || null;
        break;
      case 'detached':
        cur.detached = true;
        break;
      case 'bare':
        cur.bare = true;
        break;
      case 'locked':
        cur.locked = true;
        cur.lockedReason = value || null;
        break;
      case 'prunable':
        cur.prunable = true;
        cur.prunableReason = value || null;
        break;
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

/** Worktree-Bestand eines Repos lesen — immer asynchron (nie execSync). */
export async function readWorktreeInventory(projectPath: string): Promise<WorktreeInventoryEntry[]> {
  return parseWorktreeListPorcelain(await gitOk(projectPath, ['worktree', 'list', '--porcelain']));
}
