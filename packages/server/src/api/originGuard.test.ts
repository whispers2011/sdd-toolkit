import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { openMemoryDatabase } from '../db/database.js';
import { ExecutionRepo } from '../db/repos.js';
import { buildServer, type ApiDeps } from './server.js';
import { buildAllowedOrigins, hostAuthority, isHostAllowed, isOriginAllowed } from './originGuard.js';

const ALLOWED = buildAllowedOrigins([4820, 4830]);

/** Freien Port reservieren und sofort wieder freigeben — der Guard muss ihn kennen. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

describe('originGuard — reine Prüfregeln', () => {
  it('erlaubt beide lokalen Ports in allen üblichen Schreibweisen', () => {
    for (const origin of [
      'http://localhost:4830',
      'http://127.0.0.1:4830',
      'http://[::1]:4830',
      'http://localhost:4820',
      'http://127.0.0.1:4820',
    ]) {
      expect(isOriginAllowed(origin, ALLOWED), origin).toBe(true);
    }
  });

  it('weist fremde Origins ab — auch bei ähnlicher Schreibweise', () => {
    for (const origin of [
      'https://evil.example',
      'http://localhost:4831',
      'http://localhost.evil.example:4830',
      'http://evil.example:4830',
      'null',
      'http://127.0.0.1',
    ]) {
      expect(isOriginAllowed(origin, ALLOWED), origin).toBe(false);
    }
  });

  it('lässt fehlenden Origin zu — kein Browser-Angriffskontext (curl, gleicher Ursprung bei GET)', () => {
    expect(isOriginAllowed(undefined, ALLOWED)).toBe(true);
  });

  it('normalisiert Groß-/Kleinschreibung und abschliessenden Schrägstrich', () => {
    expect(isOriginAllowed('HTTP://LOCALHOST:4830', ALLOWED)).toBe(true);
    expect(isOriginAllowed('http://localhost:4830/', ALLOWED)).toBe(true);
  });

  it('SDD_ALLOWED_ORIGINS ergänzt bewusste Ausnahmen', () => {
    const withExtra = buildAllowedOrigins([4820], 'http://sdd.local:8080 , http://other.local:9090/');
    expect(isOriginAllowed('http://sdd.local:8080', withExtra)).toBe(true);
    expect(isOriginAllowed('http://other.local:9090', withExtra)).toBe(true);
    expect(isOriginAllowed('http://dritte.local:7070', withExtra)).toBe(false);
  });

  it('hostAuthority ergänzt den Standard-Port und behandelt IPv6-Klammern', () => {
    expect(hostAuthority('localhost')).toBe('localhost:80');
    expect(hostAuthority('localhost:4830')).toBe('localhost:4830');
    expect(hostAuthority('[::1]')).toBe('[::1]:80');
    expect(hostAuthority('[::1]:4820')).toBe('[::1]:4820');
  });

  it('Host-Prüfung blockt DNS-Rebinding: fremder Name, der auf 127.0.0.1 zeigt', () => {
    expect(isHostAllowed('127.0.0.1:4820', ALLOWED)).toBe(true);
    expect(isHostAllowed('localhost:4830', ALLOWED)).toBe(true);
    expect(isHostAllowed('rebind.evil.example:4820', ALLOWED)).toBe(false);
    expect(isHostAllowed('127.0.0.1:9999', ALLOWED)).toBe(false);
    expect(isHostAllowed(undefined, ALLOWED)).toBe(false);
  });
});

/**
 * Verhalten am echten Server: die Angriffskette aus SECURITY.md („CSRF gegen die lokale
 * API") muss an der ersten Stufe scheitern — sowohl über HTTP als auch beim
 * WebSocket-Handshake, der keiner Same-Origin-Policy unterliegt.
 */
describe('originGuard — am laufenden Server', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let dataDir: string;

  const build = async (allowedOrigins: readonly string[]) => {
    const deps = {
      dataDir,
      allowedOrigins,
      executions: new ExecutionRepo(openMemoryDatabase()),
      ptys: { list: () => [], forFeature: () => undefined },
    } as unknown as ApiDeps;
    return buildServer(deps);
  };

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sdd-origin-'));
    mkdirSync(join(dataDir, 'logs'), { recursive: true });
    app = await build(ALLOWED);
  });

  afterEach(async () => {
    await app?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const inject = (headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/api/executions/nichtvorhanden/log', headers });

  it('fremder Origin wird mit 403 abgewiesen, bevor die Route läuft', async () => {
    const res = await inject({ host: '127.0.0.1:4820', origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toContain('Origin');
  });

  it('fremder Host-Header (DNS-Rebinding) wird mit 403 abgewiesen', async () => {
    const res = await inject({ host: 'rebind.evil.example:4820', origin: 'http://localhost:4830' });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toContain('Host');
  });

  it('erlaubter Origin passiert den Guard und erreicht die Route', async () => {
    const res = await inject({ host: '127.0.0.1:4820', origin: 'http://localhost:4830' });
    expect(res.statusCode).not.toBe(403);
  });

  it('CORS spiegelt fremde Origins nicht mehr zurück', async () => {
    const evil = await app.inject({
      method: 'OPTIONS',
      url: '/api/executions/x/log',
      headers: {
        host: '127.0.0.1:4820',
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
      },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();

    const ok = await app.inject({
      method: 'OPTIONS',
      url: '/api/executions/x/log',
      headers: {
        host: '127.0.0.1:4820',
        origin: 'http://localhost:4830',
        'access-control-request-method': 'GET',
      },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:4830');
  });

  it('WebSocket-Handshake aus fremdem Origin wird geschlossen, aus erlaubtem nicht', async () => {
    // Der Guard prüft auch den Host-Header, also muss der tatsächliche Lauschport
    // Teil der Allowlist sein — er wird vorab reserviert.
    const port = await freePort();
    const wsApp = await build(buildAllowedOrigins([port, 4830]));
    await wsApp.listen({ port, host: '127.0.0.1' });
    const url = `ws://127.0.0.1:${port}/ws/events`;

    const connect = (origin: string) =>
      new Promise<'offen' | 'zu'>((resolve) => {
        const ws = new WebSocket(url, { origin });
        const done = (result: 'offen' | 'zu') => {
          ws.removeAllListeners();
          ws.terminate();
          resolve(result);
        };
        // Ein abgewiesener Handshake endet je nach Stufe als abgelehnter Upgrade
        // (error) oder als sofortiges close — beides zählt als „zu".
        ws.on('error', () => done('zu'));
        ws.on('close', () => done('zu'));
        ws.on('open', () => setTimeout(() => done(ws.readyState === WebSocket.OPEN ? 'offen' : 'zu'), 100));
      });

    try {
      expect(await connect('https://evil.example')).toBe('zu');
      expect(await connect('http://localhost:4830')).toBe('offen');
    } finally {
      await wsApp.close();
    }
  });
});
