import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  AtlassianMcpClient,
  JiraAuthRequiredError,
  JiraUnreachableError,
  parseToolResult,
  type McpConnection,
  type McpTransportFactory,
} from './atlassianMcpClient.js';

const USER = { name: 'Louis Michel', email: 'l.michel@iwf.ch' };
const SITES = [{ id: 'site-1', name: 'IWF', url: 'https://iwf.atlassian.net' }];

/** Fake-Transport: verbindet nur bei vorhandenen Tokens; sonst Browser-Flow. */
function fakeTransport(
  opts: {
    /** Tool-Antworten (Name → Nutzdaten); Default: userinfo + resources. */
    tools?: Record<string, unknown>;
    /** connect() schlägt mit diesem Fehler fehl, obwohl Tokens existieren. */
    connectError?: Error;
    /** callTool schlägt mit diesem Fehler fehl. */
    callError?: Error;
  } = {},
): McpTransportFactory & { closed: number } {
  const tools: Record<string, unknown> = {
    atlassianUserInfo: USER,
    getAccessibleAtlassianResources: SITES,
    ...opts.tools,
  };
  const factory = {
    closed: 0,
    async connect(provider: OAuthClientProvider): Promise<McpConnection> {
      const tokens = await provider.tokens();
      if (!tokens) {
        await provider.redirectToAuthorization(new URL('https://auth.atlassian.com/authorize?state=x'));
        throw new UnauthorizedError('Unauthorized');
      }
      if (opts.connectError) throw opts.connectError;
      return {
        callTool: (name: string) => {
          if (opts.callError) return Promise.reject(opts.callError);
          return Promise.resolve({
            content: [{ type: 'text', text: JSON.stringify(tools[name] ?? null) }],
          });
        },
        close: () => {
          factory.closed++;
          return Promise.resolve();
        },
      };
    },
    async finishAuth(provider: OAuthClientProvider, code: string): Promise<void> {
      if (code !== 'good-code') throw new Error('invalid_grant');
      await provider.saveTokens({ access_token: 'at-1', token_type: 'bearer', refresh_token: 'rt-1' });
    },
  };
  return factory;
}

function makeClient(opts: Parameters<typeof fakeTransport>[0] = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'sdd-jira-'));
  const transport = fakeTransport(opts);
  const client = new AtlassianMcpClient({ dataDir, transport });
  // opts wird per Referenz gehalten — Tests können z. B. callError nachträglich löschen.
  return { client, dataDir, transport, opts, file: join(dataDir, 'atlassian-mcp.json') };
}

/** Persistenzdatei mit gültigen Tokens vorbereiten (Neustart-Szenarien). */
function seedTokens(file: string): void {
  writeFileSync(
    file,
    JSON.stringify({
      clientInformation: { client_id: 'c-1', redirect_uris: ['http://127.0.0.1:4820/api/jira/oauth/callback'] },
      tokens: { access_token: 'at-1', token_type: 'bearer', refresh_token: 'rt-1' },
    }),
  );
}

describe('AtlassianMcpClient — Verbindungslebenszyklus (US1)', () => {
  it('meldet disconnected ohne Persistenzdatei', async () => {
    const { client } = makeClient();
    expect(await client.getStatus()).toEqual({ state: 'disconnected' });
  });

  it('startConnect liefert die Autorisierungs-URL und meldet connecting', async () => {
    const { client } = makeClient();
    const { authUrl } = await client.startConnect();
    expect(authUrl).toContain('https://auth.atlassian.com/authorize');
    expect((await client.getStatus()).state).toBe('connecting');
  });

  it('handleCallback tauscht den Code, danach connected mit Konto + Site', async () => {
    const { client } = makeClient();
    await client.startConnect();
    await client.handleCallback('good-code');
    const status = await client.getStatus();
    expect(status.state).toBe('connected');
    expect(status.account).toEqual(USER);
    expect(status.site).toEqual({ id: 'site-1', name: 'IWF', url: 'https://iwf.atlassian.net' });
  });

  it('handleCallback lehnt einen falschen state-Parameter ab', async () => {
    const { client, file } = makeClient();
    await client.startConnect();
    // state() wird vom echten SDK während des Flows aufgerufen — hier simuliert.
    writeFileSync(file, JSON.stringify({ pendingState: 'expected' }));
    await expect(client.handleCallback('good-code', 'wrong')).rejects.toThrow(/state/i);
  });

  it('disconnect entfernt die Persistenzdatei und schließt die Verbindung', async () => {
    const { client, file, transport } = makeClient();
    await client.startConnect();
    await client.handleCallback('good-code');
    await client.getStatus(); // Verbindung aufbauen
    expect(existsSync(file)).toBe(true);
    await client.disconnect();
    expect(existsSync(file)).toBe(false);
    expect(transport.closed).toBeGreaterThan(0);
    expect(await client.getStatus()).toEqual({ state: 'disconnected' });
  });
});

describe('AtlassianMcpClient — Neustart-Persistenz (T010, FR-003/SC-005)', () => {
  it('vorhandene Persistenzdatei → connected ohne erneuten Login', async () => {
    const { client, file } = makeClient();
    seedTokens(file);
    const status = await client.getStatus();
    expect(status.state).toBe('connected');
    expect(status.account).toEqual(USER);
  });

  it('Persistenzdatei mit ungültigen Tokens → reauth_required', async () => {
    const { client, file } = makeClient({ callError: new UnauthorizedError('401') });
    seedTokens(file);
    expect((await client.getStatus()).state).toBe('reauth_required');
  });

  it('Registrierung ohne Tokens (abgebrochener Flow) → reauth_required', async () => {
    const { client, file } = makeClient();
    writeFileSync(file, JSON.stringify({ clientInformation: { client_id: 'c-1', redirect_uris: [] } }));
    expect((await client.getStatus()).state).toBe('reauth_required');
  });

  it('fehlende Datei → disconnected', async () => {
    const { client } = makeClient();
    expect((await client.getStatus()).state).toBe('disconnected');
  });
});

describe('AtlassianMcpClient — Fehler-Mapping (R9)', () => {
  it('callTool ohne Verbindung → JiraAuthRequiredError (disconnected)', async () => {
    const { client } = makeClient();
    await expect(client.callTool('atlassianUserInfo')).rejects.toBeInstanceOf(JiraAuthRequiredError);
  });

  it('401/invalid_grant beim Tool-Call → reauth_required (Status + Fehler)', async () => {
    const { client, file } = makeClient({ callError: new Error('invalid_grant: token expired') });
    seedTokens(file);
    await expect(client.callTool('getVisibleJiraProjects')).rejects.toMatchObject({
      name: 'JiraAuthRequiredError',
      state: 'reauth_required',
    });
    expect((await client.getStatus()).state).toBe('reauth_required');
  });

  it('Netzwerkfehler → JiraUnreachableError, Status bleibt connected', async () => {
    const { client, file } = makeClient({ callError: new TypeError('fetch failed') });
    seedTokens(file);
    await expect(client.callTool('getVisibleJiraProjects')).rejects.toBeInstanceOf(JiraUnreachableError);
    expect((await client.getStatus()).state).toBe('connected');
  });

  it('erneute Autorisierung nach reauth_required setzt den Zustand zurück', async () => {
    const shared = { callError: new UnauthorizedError('401') as Error | undefined };
    const { client, file } = makeClient(shared);
    seedTokens(file);
    expect((await client.getStatus()).state).toBe('reauth_required');
    // Re-Auth „repariert" die Tokens: Fehlerquelle entfällt, Flow wird neu durchlaufen.
    shared.callError = undefined;
    await client.startConnect();
    await client.handleCallback('good-code');
    expect((await client.getStatus()).state).toBe('connected');
  });
});

describe('parseToolResult', () => {
  it('bevorzugt structuredContent', () => {
    expect(parseToolResult({ structuredContent: { a: 1 }, content: [{ type: 'text', text: 'x' }] })).toEqual({ a: 1 });
  });
  it('parst JSON aus Text-Content', () => {
    expect(parseToolResult({ content: [{ type: 'text', text: '[1,2]' }] })).toEqual([1, 2]);
  });
  it('liefert Rohtext, wenn kein JSON', () => {
    expect(parseToolResult({ content: [{ type: 'text', text: 'hallo' }] })).toBe('hallo');
  });
  it('liefert null ohne Inhalt', () => {
    expect(parseToolResult({})).toBeNull();
  });
  it('überspringt vorangestellte [Hinweis]-Blöcke vor JSON-Objekten (Rovo-Deprecation-Notiz)', () => {
    const text = '[IMPORTANT: After 30th June 2026, usage of the HTTP+SSE transport endpoint will no longer be supported.]\n{"name":"Louis Michel","email":"l@iwf.ch"}';
    expect(parseToolResult({ content: [{ type: 'text', text }] })).toEqual({
      name: 'Louis Michel',
      email: 'l@iwf.ch',
    });
  });
  it('überspringt vorangestellte [Hinweis]-Blöcke vor JSON-Arrays', () => {
    const text = '[IMPORTANT: notice]\n[{"id":"site-1","url":"https://x.atlassian.net","scopes":["read:jira-work"]}]';
    expect(parseToolResult({ content: [{ type: 'text', text }] })).toEqual([
      { id: 'site-1', url: 'https://x.atlassian.net', scopes: ['read:jira-work'] },
    ]);
  });
  it('lässt einzeiliges JSON-Array mit Folgezeilen unangetastet (kein Fehl-Stripping)', () => {
    const text = 'kein json\nnur text';
    expect(parseToolResult({ content: [{ type: 'text', text }] })).toBe(text);
  });
});
