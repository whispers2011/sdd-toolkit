import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAllowedOrigins } from './api/originGuard.js';

export interface ServerConfig {
  port: number;
  host: string;
  /** Browser-Origins, die HTTP-API und WebSockets nutzen dürfen (siehe api/originGuard.ts). */
  allowedOrigins: string[];
  /** Datenverzeichnis für DB, Logs, Hook-Event-Dateien, Snapshots. */
  dataDir: string;
  /** Gebautes Web-Bundle, das der Server im Prod-Modus mit ausliefert; null = Dev (Vite liefert das Web). */
  webDir: string | null;
}

export function loadConfig(): ServerConfig {
  const dataDir = process.env.SDD_DATA_DIR ?? join(homedir(), '.sdd-toolkit');
  for (const sub of ['', 'logs', 'hooks', 'snapshots']) {
    mkdirSync(join(dataDir, sub), { recursive: true });
  }
  const port = Number(process.env.SDD_PORT ?? 4820);
  const webPort = Number(process.env.SDD_WEB_PORT ?? 4830);
  return {
    port,
    host: process.env.SDD_HOST ?? '127.0.0.1',
    allowedOrigins: buildAllowedOrigins([port, webPort], process.env.SDD_ALLOWED_ORIGINS),
    dataDir,
    webDir: resolveWebDir(),
  };
}

/**
 * Prod-Modus (NODE_ENV=production oder SDD_SERVE_WEB=1): das gebaute Web-Bundle
 * ausliefern, damit EIN Prozess API + Web bedient. Default-Pfad relativ zum
 * kompilierten Server (packages/server/dist → packages/web/dist), per SDD_WEB_DIR
 * übersteuerbar. Existiert kein index.html, bleibt das Web-Serving aus.
 */
function resolveWebDir(): string | null {
  const serveWeb = process.env.NODE_ENV === 'production' || process.env.SDD_SERVE_WEB === '1';
  if (!serveWeb) return null;
  const dir = process.env.SDD_WEB_DIR
    ? resolve(process.env.SDD_WEB_DIR)
    : resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  return existsSync(join(dir, 'index.html')) ? dir : null;
}
