/**
 * Buchführung der Portblöcke. Zusammen mit dem PortAllocator, der als einziger
 * schreibend darauf zugreift, ist das die EINZIGE Quelle der Portvergabe
 * (FR-001/FR-002).
 *
 * Der partielle Index `idx_port_blocks_base_live` erzwingt auf Datenbankebene,
 * dass zwei BELEGTE Blöcke nie dieselbe Basis haben — auch dann nicht, wenn zwei
 * Vorgänge gleichzeitig zugreifen. Freigegebene Blöcke dürfen sich eine Basis
 * teilen, weil sie wiederverwendbar sind (FR-005).
 */
import type { PortBlock, PortBlockOwnerKind } from '@sdd/shared';
import type { DB } from './database.js';

interface PortBlockRow {
  owner_kind: string;
  owner_id: string;
  project_id: string;
  base: number;
  span: number;
  allocated_at: number;
  released_at: number | null;
}

function toBlock(r: PortBlockRow): PortBlock {
  return {
    ownerKind: r.owner_kind === 'project' ? 'project' : 'worktree',
    ownerId: r.owner_id,
    projectId: r.project_id,
    base: r.base,
    span: r.span,
    allocatedAt: r.allocated_at,
    releasedAt: r.released_at,
  };
}

export class PortRepo {
  constructor(private db: DB) {}

  /** Alle Blöcke, auch freigegebene — für Übersicht und Abgleich. */
  list(): PortBlock[] {
    return (this.db.prepare('SELECT * FROM port_blocks ORDER BY base').all() as PortBlockRow[]).map(toBlock);
  }

  /** Nur die belegten Blöcke: die Basen, die bei der Vergabe ausscheiden. */
  live(): PortBlock[] {
    return (
      this.db.prepare('SELECT * FROM port_blocks WHERE released_at IS NULL ORDER BY base').all() as PortBlockRow[]
    ).map(toBlock);
  }

  /** Belegter Block eines Besitzers; null = keiner (oder freigegeben). */
  findLiveByOwner(ownerKind: PortBlockOwnerKind, ownerId: string): PortBlock | null {
    const r = this.db
      .prepare('SELECT * FROM port_blocks WHERE owner_kind=? AND owner_id=? AND released_at IS NULL')
      .get(ownerKind, ownerId) as PortBlockRow | undefined;
    return r ? toBlock(r) : null;
  }

  /** Eintrag eines Besitzers unabhängig vom Freigabestand (der Primärschlüssel). */
  findByOwner(ownerKind: PortBlockOwnerKind, ownerId: string): PortBlock | null {
    const r = this.db
      .prepare('SELECT * FROM port_blocks WHERE owner_kind=? AND owner_id=?')
      .get(ownerKind, ownerId) as PortBlockRow | undefined;
    return r ? toBlock(r) : null;
  }

  /**
   * Block belegen. Ein früher freigegebener Eintrag desselben Besitzers wird
   * überschrieben — der Primärschlüssel ist (Art, Besitzer). Verletzt die Basis
   * den partiellen Index, wirft better-sqlite3; der Allocator behandelt das als
   * „Block ist inzwischen weg" und nimmt den nächsten.
   */
  allocate(block: Omit<PortBlock, 'releasedAt'>): PortBlock {
    this.db
      .prepare(
        `INSERT INTO port_blocks (owner_kind, owner_id, project_id, base, span, allocated_at, released_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(owner_kind, owner_id) DO UPDATE SET
           project_id=excluded.project_id, base=excluded.base, span=excluded.span,
           allocated_at=excluded.allocated_at, released_at=NULL`,
      )
      .run(block.ownerKind, block.ownerId, block.projectId, block.base, block.span, block.allocatedAt);
    return { ...block, releasedAt: null };
  }

  /** Freigeben; der Block ist danach wieder vergebbar (FR-005). */
  release(ownerKind: PortBlockOwnerKind, ownerId: string, ts: number): void {
    this.db
      .prepare('UPDATE port_blocks SET released_at=? WHERE owner_kind=? AND owner_id=? AND released_at IS NULL')
      .run(ts, ownerKind, ownerId);
  }

  /** Belegte Worktree-Blöcke eines Projekts — für die Worktree-Übersicht. */
  liveForProject(projectId: string): PortBlock[] {
    return (
      this.db
        .prepare('SELECT * FROM port_blocks WHERE project_id=? AND released_at IS NULL ORDER BY base')
        .all(projectId) as PortBlockRow[]
    ).map(toBlock);
  }
}
