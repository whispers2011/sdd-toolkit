import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SNAPSHOT_LIMIT = 512 * 1024; // letzter Stand reicht — kein volles Scrollback

/**
 * Terminal-Snapshots (WP2, WhisperM8 TerminalSnapshotStore-Muster):
 * Plaintext-Endstand pro FEATURE (nicht Session), damit eine neue Session
 * nach Server-Neustart den letzten Kontext replayen kann.
 */
export class SnapshotStore {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'snapshots');
    mkdirSync(this.dir, { recursive: true });
  }

  private pathFor(featureId: string): string {
    return join(this.dir, `${featureId}.txt`);
  }

  save(featureId: string, scrollback: string): void {
    if (!scrollback) return;
    try {
      writeFileSync(this.pathFor(featureId), scrollback.slice(-SNAPSHOT_LIMIT), { mode: 0o600 });
    } catch {
      /* Snapshot ist Komfort, nie fatal */
    }
  }

  load(featureId: string): string | null {
    try {
      const p = this.pathFor(featureId);
      if (!existsSync(p)) return null;
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  }

  remove(featureId: string): void {
    try {
      unlinkSync(this.pathFor(featureId));
    } catch {
      /* fehlt schon */
    }
  }
}

/** Trennzeile beim Replay eines Snapshots einer früheren Session. */
export function snapshotReplayBanner(): string {
  return '\r\n\x1b[2m────────── frühere Session (Snapshot) ──────────\x1b[0m\r\n';
}
