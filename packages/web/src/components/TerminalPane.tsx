import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { api } from '../api.js';
import { useStore } from '../store.js';

/**
 * Wiederverwendbares Terminal (xterm.js ⇄ WS ⇄ Server-PTY) mit Reconnect und
 * Focus-Drosselung (WP8): unfokussierte Panes erhalten gebündelten Output.
 */
export function TerminalPane({
  featureId,
  focused = true,
  fontSize = 13,
  onConnectionChange,
}: {
  featureId: string;
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
      theme: { background: '#09090b', foreground: '#d4d4d8', cursor: '#a1a1aa' },
      scrollback: 20_000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    let disposed = false;

    const connect = async () => {
      try {
        const { sessionId } = await api.ensureSession(featureId);
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
      observer.disconnect();
      dataDisposable.dispose();
      wsRef.current?.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
