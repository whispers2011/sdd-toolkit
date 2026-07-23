import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { JiraConnectionStatus } from '@sdd/shared';

/**
 * Offizieller Atlassian Rovo MCP (per Spec-Clarification fixiert).
 * Streamable HTTP ist der aktuelle Endpoint; der SSE-Endpoint (/v1/sse) ist
 * seit 30.06.2026 abgekündigt und dient nur noch als Rückfallebene.
 */
export const ROVO_MCP_URL = 'https://mcp.atlassian.com/v1/mcp';

/** Autorisierung fehlt oder ist abgelaufen → HTTP 401 mit Zustand (FR-004). */
export class JiraAuthRequiredError extends Error {
  constructor(
    message: string,
    public readonly state: 'disconnected' | 'reauth_required',
  ) {
    super(message);
    this.name = 'JiraAuthRequiredError';
  }
}

/** Jira/MCP nicht erreichbar (Netz-/Dienststörung) → HTTP 503 (R9). */
export class JiraUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JiraUnreachableError';
  }
}

/** Roh-Ergebnis eines MCP-Tool-Aufrufs (Teilmenge des SDK-CallToolResult). */
export interface McpToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface McpConnection {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}

/**
 * Transport-Abstraktion (testbar): baut die MCP-Verbindung auf bzw. tauscht den
 * Authorization-Code. `connect` wirft `UnauthorizedError`, wenn erst der
 * Browser-Flow nötig ist — die Autorisierungs-URL landet dabei im Provider.
 */
export interface McpTransportFactory {
  connect(authProvider: OAuthClientProvider): Promise<McpConnection>;
  finishAuth(authProvider: OAuthClientProvider, code: string): Promise<void>;
}

class RovoTransportFactory implements McpTransportFactory {
  constructor(private mcpUrl: string) {}

  async connect(authProvider: OAuthClientProvider): Promise<McpConnection> {
    const attempt = async (
      transport: SSEClientTransport | StreamableHTTPClientTransport,
    ): Promise<McpConnection> => {
      const client = new Client({ name: 'sdd-toolkit', version: '0.1.0' });
      // Cast: SDK-Transports sind unter exactOptionalPropertyTypes nicht 1:1 zuweisbar.
      await client.connect(transport as Parameters<Client['connect']>[0]);
      return {
        callTool: (name, args) =>
          client.callTool({ name, arguments: args }) as Promise<McpToolResult>,
        close: () => client.close(),
      };
    };
    try {
      return await attempt(new StreamableHTTPClientTransport(new URL(this.mcpUrl), { authProvider }));
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      // Streamable HTTP gestört → abgekündigter SSE-Endpunkt als Rückfallebene (R2).
      return attempt(
        new SSEClientTransport(new URL(this.mcpUrl.replace(/\/mcp\/?$/, '/sse')), {
          authProvider,
        }),
      );
    }
  }

  async finishAuth(authProvider: OAuthClientProvider, code: string): Promise<void> {
    // finishAuth tauscht den Code über den Provider — unabhängig vom Verbindungszustand.
    const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl), { authProvider });
    await transport.finishAuth(code);
  }
}

/** Persistierte OAuth-Daten (Hoheit beim MCP-SDK; das Toolkit interpretiert nur Existenz). */
interface PersistedAuth {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  /** state-Parameter des laufenden Browser-Flows (CSRF-Schutz des Callbacks). */
  pendingState?: string;
}

/**
 * Datei-basierter `OAuthClientProvider`: Client-Registrierung (DCR) + Tokens auf
 * Nutzerebene unter `~/.sdd-toolkit/atlassian-mcp.json` (FR-002/FR-003).
 * „Trennen" = Datei löschen (FR-005).
 */
class FileOAuthProvider implements OAuthClientProvider {
  /** Vom SDK übergebene Autorisierungs-URL des laufenden Flows. */
  authUrl: URL | null = null;

  /** Flow-Neustart: alte Autorisierungs-URL verwerfen. */
  resetAuthFlow(): void {
    this.authUrl = null;
  }

  constructor(
    private file: string,
    private redirect: string,
  ) {}

  peek(): PersistedAuth | null {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as PersistedAuth;
    } catch {
      return null;
    }
  }

  private write(patch: { [K in keyof PersistedAuth]?: PersistedAuth[K] | undefined }): void {
    const cur = this.peek() ?? {};
    const next: { [K in keyof PersistedAuth]?: PersistedAuth[K] | undefined } = { ...cur, ...patch };
    for (const key of Object.keys(next) as (keyof PersistedAuth)[]) {
      if (next[key] === undefined) delete next[key];
    }
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(next, null, 2), { mode: 0o600 });
  }

  wipe(): void {
    try {
      unlinkSync(this.file);
    } catch {
      /* Datei fehlt bereits */
    }
  }

  exists(): boolean {
    return existsSync(this.file);
  }

  pendingState(): string | undefined {
    return this.peek()?.pendingState;
  }

  clearPendingState(): void {
    this.write({ pendingState: undefined });
  }

  // ---- OAuthClientProvider ----

  get redirectUrl(): string {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'SDD Toolkit',
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    const s = randomBytes(16).toString('hex');
    this.write({ pendingState: s });
    return s;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.peek()?.clientInformation;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.write({ clientInformation: info });
  }

  tokens(): OAuthTokens | undefined {
    return this.peek()?.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.write({ tokens });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Serverseitig gibt es keinen User-Agent — die URL wird an den Web-Client gereicht.
    this.authUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.write({ codeVerifier });
  }

  codeVerifier(): string {
    const v = this.peek()?.codeVerifier;
    if (!v) throw new Error('Kein code_verifier gespeichert — OAuth-Flow neu starten');
    return v;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') {
      this.wipe();
    } else if (scope === 'client') {
      this.write({ clientInformation: undefined });
    } else if (scope === 'tokens') {
      this.write({ tokens: undefined });
    } else if (scope === 'verifier') {
      this.write({ codeVerifier: undefined });
    }
  }
}

export interface AtlassianMcpClientOptions {
  /** Verzeichnis der Persistenzdatei (Default: ~/.sdd-toolkit). */
  dataDir?: string;
  /** Callback-URL des lokalen OAuth-Flows (Default: http://127.0.0.1:4820/…). */
  callbackUrl?: string;
  /** Transport-Injektion für Tests (Default: Rovo MCP via SDK). */
  transport?: McpTransportFactory;
}

/**
 * MCP-Client zum offiziellen Atlassian Rovo MCP: OAuth-Browser-Flow (DCR +
 * lokaler Callback), Persistenz auf Nutzerebene, Tool-Aufrufe mit Fehler-Mapping
 * (401/invalid_grant → `reauth_required`, Netzfehler → `JiraUnreachableError`).
 */
export class AtlassianMcpClient {
  private provider: FileOAuthProvider;
  private transport: McpTransportFactory;
  private connection: McpConnection | null = null;
  private connecting: Promise<McpConnection> | null = null;
  /** Browser-Flow gestartet, Callback steht noch aus. */
  private flowPending = false;
  /** Ein Tool-Call ist an abgelaufener Autorisierung gescheitert (FR-004). */
  private reauthRequired = false;
  private identity: Pick<JiraConnectionStatus, 'account' | 'site'> | null = null;

  constructor(opts: AtlassianMcpClientOptions = {}) {
    const dataDir = opts.dataDir ?? join(homedir(), '.sdd-toolkit');
    const callbackUrl = opts.callbackUrl ?? 'http://127.0.0.1:4820/api/jira/oauth/callback';
    this.provider = new FileOAuthProvider(join(dataDir, 'atlassian-mcp.json'), callbackUrl);
    this.transport = opts.transport ?? new RovoTransportFactory(ROVO_MCP_URL);
  }

  /** Verbindungsstatus — wirft nie; erwartbare Zustände sind Werte, keine Fehler. */
  async getStatus(): Promise<JiraConnectionStatus> {
    if (this.flowPending) return { state: 'connecting' };
    const persisted = this.provider.peek();
    if (!persisted?.tokens) {
      // Registrierung ohne Tokens = abgebrochener/abgelaufener Flow → wie getrennt.
      return { state: persisted?.clientInformation ? 'reauth_required' : 'disconnected' };
    }
    if (this.reauthRequired) return { state: 'reauth_required' };
    if (!this.identity) {
      try {
        await this.loadIdentity();
      } catch (err) {
        if (err instanceof JiraAuthRequiredError) return { state: 'reauth_required' };
        // Nicht erreichbar: Tokens existieren — Zustand bleibt verbunden, nur ohne Kontodaten.
        return { state: 'connected' };
      }
    }
    return { state: 'connected', ...this.identity };
  }

  /**
   * OAuth-Browser-Flow starten. Liefert die Autorisierungs-URL für den Browser;
   * `null`, wenn die persistierten Tokens noch gültig sind (direkt verbunden).
   */
  async startConnect(): Promise<{ authUrl: string | null }> {
    this.provider.resetAuthFlow();
    await this.closeConnection();
    try {
      this.connection = await this.transport.connect(this.provider);
      this.reauthRequired = false;
      return { authUrl: null };
    } catch (err) {
      const authUrl = this.provider.authUrl;
      if (err instanceof UnauthorizedError && authUrl) {
        this.flowPending = true;
        return { authUrl: authUrl.toString() };
      }
      throw this.mapError(err);
    }
  }

  /** OAuth-Callback abschließen: state prüfen, Code gegen Tokens tauschen. */
  async handleCallback(code: string, state?: string): Promise<void> {
    const expected = this.provider.pendingState();
    if (expected && state !== expected) {
      throw new Error('Ungültiger state-Parameter — OAuth-Flow bitte neu starten');
    }
    try {
      await this.transport.finishAuth(this.provider, code);
    } catch (err) {
      throw this.mapError(err);
    } finally {
      this.flowPending = false;
    }
    this.provider.clearPendingState();
    this.reauthRequired = false;
    this.identity = null;
  }

  /** Verbindung trennen: Persistenzdatei entfernen, Verbindung schließen (FR-005). */
  async disconnect(): Promise<void> {
    await this.closeConnection();
    this.provider.wipe();
    this.identity = null;
    this.reauthRequired = false;
    this.flowPending = false;
  }

  /**
   * MCP-Tool aufrufen; Ergebnis ist das geparste strukturierte Resultat
   * (structuredContent bzw. JSON aus dem ersten Text-Content).
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.provider.peek()?.tokens) {
      throw new JiraAuthRequiredError(
        'Keine Jira-Verbindung — bitte zuerst in den Benutzereinstellungen verbinden',
        'disconnected',
      );
    }
    try {
      const conn = await this.ensureConnection();
      const result = await conn.callTool(name, args);
      if (result.isError) {
        throw new Error(extractText(result) || `Jira-Tool ${name} fehlgeschlagen`);
      }
      return parseToolResult(result);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /** Access-Token für authentifizierte Zusatz-Downloads (Anhänge, FR-018). */
  getAccessToken(): string | null {
    return this.provider.peek()?.tokens?.access_token ?? null;
  }

  // ---- intern ----

  private ensureConnection(): Promise<McpConnection> {
    if (this.connection) return Promise.resolve(this.connection);
    if (this.connecting) return this.connecting;
    this.connecting = this.transport
      .connect(this.provider)
      .then((conn) => {
        this.connection = conn;
        return conn;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  private async closeConnection(): Promise<void> {
    const conn = this.connection;
    this.connection = null;
    if (conn) await conn.close().catch(() => {});
  }

  private async loadIdentity(): Promise<void> {
    const user = (await this.callTool('atlassianUserInfo')) as {
      name?: string;
      email?: string;
      displayName?: string;
      emailAddress?: string;
    } | null;
    const resources = (await this.callTool('getAccessibleAtlassianResources')) as
      | { id?: string; name?: string; url?: string }[]
      | null;
    const first = Array.isArray(resources) ? resources[0] : undefined;
    this.identity = {
      ...(user
        ? {
            account: {
              name: user.name ?? user.displayName ?? 'Unbekanntes Konto',
              ...(user.email ?? user.emailAddress ? { email: user.email ?? user.emailAddress } : {}),
            },
          }
        : {}),
      ...(first?.id && first.url
        ? { site: { id: first.id, name: first.name ?? first.url, url: first.url } }
        : {}),
    };
  }

  private mapError(err: unknown): Error {
    if (err instanceof JiraAuthRequiredError || err instanceof JiraUnreachableError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UnauthorizedError || /invalid_grant|\b401\b|unauthorized/i.test(message)) {
      this.reauthRequired = true;
      this.connection = null;
      return new JiraAuthRequiredError(
        'Jira-Autorisierung ist abgelaufen — bitte in den Benutzereinstellungen erneut autorisieren',
        'reauth_required',
      );
    }
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|network/i.test(message)) {
      this.connection = null;
      return new JiraUnreachableError('Jira ist derzeit nicht erreichbar — bitte später erneut versuchen');
    }
    return err instanceof Error ? err : new Error(message);
  }
}

function extractText(result: McpToolResult): string {
  return (result.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

/**
 * Führende einzeilige `[Hinweis]`-Blöcke des MCP-Servers entfernen (der Rovo MCP
 * stellt Tool-Antworten z. B. eine Deprecation-Notiz vor dem JSON voran).
 */
function stripLeadingNotices(text: string): string {
  let rest = text.trimStart();
  for (;;) {
    const nl = rest.indexOf('\n');
    if (nl === -1) break;
    const line = rest.slice(0, nl).trimEnd();
    if (!line.startsWith('[') || !line.endsWith(']')) break;
    try {
      JSON.parse(line);
      break; // einzeiliges JSON-Array, keine Notiz
    } catch {
      rest = rest.slice(nl + 1).trimStart();
    }
  }
  return rest;
}

/** Tool-Ergebnis auf Nutzdaten reduzieren: structuredContent > JSON-Text > Rohtext. */
export function parseToolResult(result: McpToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = extractText(result);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const stripped = stripLeadingNotices(text);
    if (stripped !== text) {
      try {
        return JSON.parse(stripped) as unknown;
      } catch {
        /* Rohtext unten */
      }
    }
    return text;
  }
}
