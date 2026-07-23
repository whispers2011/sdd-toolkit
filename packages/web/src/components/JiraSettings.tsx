import { useCallback, useEffect, useRef, useState } from 'react';
import type { JiraConnectionStatus } from '@sdd/shared';
import { api } from '../api.js';
import { ConfirmDialog, Dialog } from './Sidebar.js';

/**
 * Benutzereinstellungen → Jira (US1): verbinden (OAuth-Browser-Flow), Status
 * mit Konto + Instanz, trennen, Re-Auth bei abgelaufener Autorisierung.
 * Pollt den Status, solange der Dialog offen ist (Neustart-/Trenn-Härtung, T024).
 */
export function JiraSettings({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<JiraConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  /** Browser-Tab mit OAuth-Freigabe wurde geöffnet — auf Abschluss pollen. */
  const [awaitingAuth, setAwaitingAuth] = useState(false);
  const closedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.jiraStatus();
      if (!closedRef.current) {
        setStatus(s);
        if (s.state === 'connected') setAwaitingAuth(false);
      }
    } catch (e) {
      if (!closedRef.current) setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    closedRef.current = false;
    void refresh();
    // Statusänderungen (OAuth-Abschluss im Browser, Trennen anderswo) zeitnah abbilden.
    const interval = setInterval(() => void refresh(), awaitingAuth ? 2000 : 5000);
    return () => {
      closedRef.current = true;
      clearInterval(interval);
    };
  }, [refresh, awaitingAuth]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const { authUrl } = await api.jiraConnect();
      if (authUrl) {
        window.open(authUrl, '_blank', 'noopener');
        setAwaitingAuth(true);
        setStatus({ state: 'connecting' });
      } else {
        // Tokens waren noch gültig → direkt verbunden.
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.jiraDisconnect();
      setStatus({ state: 'disconnected' });
      setAwaitingAuth(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Benutzereinstellungen: Jira" onClose={onClose}>
      <p className="mb-3 text-xs text-zinc-500">
        Anbindung über den offiziellen Atlassian MCP (OAuth im Browser). Das Toolkit speichert keine
        Jira-Passwörter — die Autorisierung liegt unter <code>~/.sdd-toolkit/atlassian-mcp.json</code>.
      </p>

      {error && (
        <div className="mb-3 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {status === null ? (
        <p className="py-4 text-sm text-zinc-500">Status wird geladen …</p>
      ) : status.state === 'connected' ? (
        <div className="space-y-3">
          <div className="rounded border border-emerald-900 bg-emerald-950/30 px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <span className="status-dot status-idle" /> Verbunden
            </div>
            <dl className="mt-2 space-y-1 text-xs">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-zinc-500">Konto</dt>
                <dd className="text-zinc-300">
                  {status.account ? `${status.account.name}${status.account.email ? ` (${status.account.email})` : ''}` : '—'}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-zinc-500">Instanz</dt>
                <dd className="truncate text-zinc-300">
                  {status.site ? `${status.site.name} — ${status.site.url}` : '—'}
                </dd>
              </div>
            </dl>
          </div>
          <button
            onClick={() => setConfirmDisconnect(true)}
            disabled={busy}
            className="rounded border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950 disabled:opacity-50"
          >
            Verbindung trennen …
          </button>
        </div>
      ) : status.state === 'reauth_required' ? (
        <div className="space-y-3">
          <div className="rounded border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
            Die Jira-Autorisierung ist abgelaufen oder wurde widerrufen. Jira-Daten sind erst nach
            erneuter Freigabe wieder abrufbar — bereits übernommene Features bleiben unberührt.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void connect()}
              disabled={busy}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-emerald-600 disabled:opacity-50"
            >
              {busy ? '…' : 'Erneut autorisieren'}
            </button>
            <button
              onClick={() => setConfirmDisconnect(true)}
              disabled={busy}
              className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
            >
              Verbindung trennen …
            </button>
          </div>
        </div>
      ) : status.state === 'connecting' || awaitingAuth ? (
        <div className="space-y-3">
          <div className="rounded border border-sky-900 bg-sky-950/30 px-3 py-2 text-xs text-sky-300">
            Freigabe läuft: Bitte die Autorisierung im geöffneten Browser-Tab abschließen. Der Status
            aktualisiert sich hier automatisch.
          </div>
          <button
            onClick={() => void connect()}
            disabled={busy}
            className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
          >
            Freigabe-Link erneut öffnen
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">Keine Jira-Verbindung eingerichtet.</p>
          <button
            onClick={() => void connect()}
            disabled={busy}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-emerald-600 disabled:opacity-50"
          >
            {busy ? '…' : 'Mit Jira verbinden'}
          </button>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">
          Schließen
        </button>
      </div>

      {confirmDisconnect && (
        <ConfirmDialog
          title="Jira-Verbindung trennen"
          message={
            'Die gespeicherte Autorisierung wird entfernt (~/.sdd-toolkit/atlassian-mcp.json).\n\nBereits übernommene Features bleiben vollständig erhalten.'
          }
          confirmLabel="Trennen"
          onConfirm={() => void disconnect()}
          onClose={() => setConfirmDisconnect(false)}
        />
      )}
    </Dialog>
  );
}
