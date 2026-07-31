import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { findPathLinks } from '@sdd/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { getTheme, onThemeChange } from '../theme.js';
import { terminalTheme } from '../terminalTheme.js';

/**
 * Wiederverwendbares Terminal (xterm.js ⇄ WS ⇄ Server-PTY) mit Reconnect und
 * Focus-Drosselung (WP8): unfokussierte Panes erhalten gebündelten Output.
 */
export function TerminalPane({
  featureId = null,
  getSession,
  focused = true,
  fontSize = 13,
  onConnectionChange,
}: {
  /** Für Editor-Links; null bei Shell-Sessions. WICHTIG: Parent muss `key` setzen. */
  featureId?: string | null;
  /** Liefert die Session-ID (Feature-Session oder Projekt-Shell). */
  getSession?: () => Promise<{ sessionId: string }>;
  focused?: boolean;
  fontSize?: number;
  onConnectionChange?: (connected: boolean) => void;
}) {
  const { dispatch } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [, setConnected] = useState(false);

  const focusedRef = useRef(focused);
  useEffect(() => {
    focusedRef.current = focused;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'focus', focused }));
    }
  }, [focused]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontSize,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: terminalTheme(getTheme()),
      scrollback: 20_000,
      allowProposedApi: true,
    });
    // Live-Umfärben bei Designwechsel — ohne Remount, damit PTY-Verbindung,
    // Scrollback und Eingabefokus erhalten bleiben (U2.4, FR-022). Das Design
    // steht bewusst NICHT in den Abhängigkeiten dieses Effekts: sonst würde das
    // Terminal bei jedem Wechsel neu aufgebaut und die Sitzung ginge verloren.
    const unsubscribeTheme = onThemeChange((id) => {
      term.options.theme = terminalTheme(id);
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // URLs klickbar (WP10); Datei-Pfade über eigenen Provider darunter.
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank')));
    term.open(containerRef.current);
    fit.fit();
    if (focusedRef.current) term.focus(); // echte Console: Tastatur landet direkt im Terminal

    // Datei-Links: pfad(.ext)(:zeile) → im Editor öffnen (Server führt editorCmd aus).
    const fid = featureId;
    const linkProvider = fid
      ? term.registerLinkProvider({
          provideLinks(bufferLineNumber, callback) {
            const line = term.buffer.active.getLine(bufferLineNumber - 1);
            if (!line) return callback(undefined);
            const text = line.translateToString(true);
            const links = findPathLinks(text).map((l) => ({
              range: {
                start: { x: l.start + 1, y: bufferLineNumber },
                end: { x: l.end, y: bufferLineNumber },
              },
              text: text.slice(l.start, l.end),
              activate: () => void api.openInEditor(fid, l.file, l.line).catch(() => {}),
            }));
            callback(links.length ? links : undefined);
          },
        })
      : null;

    let disposed = false;

    const connect = async () => {
      try {
        const resolve = getSession ?? (() => api.ensureSession(featureId!));
        const { sessionId } = await resolve();
        if (disposed) return;
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/ws/terminal/${sessionId}`);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          onConnectionChange?.(true);
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          ws.send(JSON.stringify({ type: 'focus', focused: focusedRef.current }));
        };
        ws.onmessage = (ev) => term.write(ev.data as string);
        ws.onclose = () => {
          setConnected(false);
          onConnectionChange?.(false);
          if (!disposed) setTimeout(() => void connect(), 1500);
        };
      } catch (e) {
        dispatch({ type: 'error', message: (e as Error).message });
      }
    };
    void connect();

    const dataDisposable = term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const observer = new ResizeObserver(() => {
      fit.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    observer.observe(containerRef.current);

    return () => {
      disposed = true;
      unsubscribeTheme();
      observer.disconnect();
      dataDisposable.dispose();
      linkProvider?.dispose();
      wsRef.current?.close();
      term.dispose();
    };
    // Bewusst nur beim Mount — Parent steuert Re-Init über `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bild-Paste (WP16/Q4): Screenshot einfügen → Pfad landet in der Konsole.
  const onPaste = (e: React.ClipboardEvent) => {
    if (!featureId) return;
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          void api.pasteImage(featureId, blob).catch((err: Error) =>
            dispatch({ type: 'error', message: `Bild-Paste: ${err.message}` }),
          );
        }
        return;
      }
    }
  };

  return <div ref={containerRef} className="h-full w-full" onPaste={onPaste} />;
}
