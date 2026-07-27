import type { FastifyInstance } from 'fastify';

/**
 * Schutz der unauthentifizierten lokalen API gegen Zugriffe aus fremden Webseiten.
 *
 * Ohne diesen Guard genügt eine beliebige offene Browser-Seite: sie startet über
 * `POST /api/projects/:id/terminal` eine Login-Shell und schreibt über
 * `ws://127.0.0.1:4820/ws/terminal/<id>` beliebige Kommandos hinein. WebSockets
 * unterliegen keiner Same-Origin-Policy, und ein gespiegelter CORS-Origin macht
 * auch die HTTP-Antworten lesbar.
 *
 * Zwei Prüfungen, die sich gegenseitig abdecken:
 * - **Origin** — Browser senden ihn bei allen zustandsändernden Anfragen (POST/PUT/…),
 *   bei Formular-Posts und immer beim WebSocket-Handshake. Fehlt er (curl, gleicher
 *   Ursprung bei GET), liegt kein Browser-Angriffskontext vor.
 * - **Host** — fängt DNS-Rebinding ab: dort zeigt ein Angreifer-DNS-Name auf 127.0.0.1,
 *   der Browser sendet dann `Host: evil.example` statt einer lokalen Adresse.
 */

/** Hostnamen, unter denen der Server im unterstützten Betrieb erreichbar ist. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

/**
 * Erlaubte Browser-Origins: API-Port (Ein-Prozess-Prod) und Web-Port (Vite-Dev),
 * je über alle lokalen Schreibweisen. `extra` (SDD_ALLOWED_ORIGINS, kommagetrennt)
 * ist die bewusste Ausnahme für abweichende Betriebsarten.
 */
export function buildAllowedOrigins(ports: readonly number[], extra?: string): string[] {
  const local = ports.flatMap((port) => LOCAL_HOSTS.map((host) => `http://${host}:${port}`));
  const additional = (extra ?? '')
    .split(',')
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);
  return [...new Set([...local, ...additional])];
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Fehlender Origin gilt als erlaubt: Browser setzen ihn bei jeder Anfrage, die ein
 * fremder Ursprung auslösen kann. Der Literalwert `null` (sandboxed iframe, file://)
 * steht nicht auf der Liste und wird damit abgewiesen.
 */
export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) return true;
  return allowed.includes(normalizeOrigin(origin));
}

/** `Host`-Header auf `hostname:port` normalisieren; fehlender Port bedeutet 80. */
export function hostAuthority(host: string): string {
  const value = host.trim().toLowerCase();
  const hasPort = value.startsWith('[') ? value.includes(']:') : value.includes(':');
  return hasPort ? value : `${value}:80`;
}

export function isHostAllowed(host: string | undefined, allowed: readonly string[]): boolean {
  if (!host) return false;
  const authorities = new Set(allowed.map((origin) => origin.replace(/^https?:\/\//, '')));
  return authorities.has(hostAuthority(host));
}

/** HTTP-Seite des Guards. Muss vor CORS registriert werden, damit auch Preflights greifen. */
export function registerOriginGuard(app: FastifyInstance, allowed: readonly string[]): void {
  app.addHook('onRequest', async (req, reply) => {
    const reason = !isHostAllowed(req.headers.host, allowed)
      ? 'Host-Header'
      : !isOriginAllowed(req.headers.origin, allowed)
        ? 'Origin'
        : null;
    if (!reason) return;

    req.log.warn({ host: req.headers.host, origin: req.headers.origin }, `Anfrage abgewiesen: ${reason}`);

    // Ein Upgrade-Request kann keine normale Fastify-Antwort empfangen — der Client
    // wartet sonst endlos auf den Handshake. Also roh beantworten und die Verbindung
    // schliessen, statt reply.send() zu benutzen.
    if (req.headers.upgrade?.toLowerCase() === 'websocket') {
      reply.hijack();
      req.raw.socket.end(`HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n${reason} nicht erlaubt`);
      return;
    }
    return reply.code(403).send({ error: `${reason} nicht erlaubt — nur lokaler Zugriff wird unterstützt.` });
  });
}

/** WebSocket-Schließcode für einen abgewiesenen Origin (anwendungsdefinierter Bereich). */
export const WS_ORIGIN_REJECTED = 4403;
