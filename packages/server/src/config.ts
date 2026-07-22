import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface ServerConfig {
  port: number;
  host: string;
  /** Datenverzeichnis für DB, Logs, Hook-Event-Dateien, Snapshots. */
  dataDir: string;
}

export function loadConfig(): ServerConfig {
  const dataDir = process.env.SDD_DATA_DIR ?? join(homedir(), '.sdd-toolkit');
  for (const sub of ['', 'logs', 'hooks', 'snapshots']) {
    mkdirSync(join(dataDir, sub), { recursive: true });
  }
  return {
    port: Number(process.env.SDD_PORT ?? 4820),
    host: process.env.SDD_HOST ?? '127.0.0.1',
    dataDir,
  };
}
