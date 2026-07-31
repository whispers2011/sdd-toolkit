import { useCallback, useEffect, useState } from 'react';
import { formatOutageDuration, type OutageRecord, type SystemStatus as Status } from '@sdd/shared';
import { api } from '../api.js';

/**
 * Abrufabstand. Zusammen mit dem 10-s-Cache des Servers ist die Anzeige nie älter
 * als 30 s — FR-021 verlangt 60 s (D11, C3.3). Vorbild: WorktreeOverview.tsx.
 */
const POLL_MS = 20_000;

/** Nicht ermittelbar — dieselbe Marke, die auch die Kurzform des Servers verwendet. */
const UNBEKANNT = '–';

/**
 * Systemzustand in der Kopfleiste (D17): freier Platz, Auslagerung und die Zahl
 * gleichzeitig arbeitender Features — ohne Terminal ablesbar, unabhängig von Projekt
 * und Ansicht (US3-1, US3-3).
 *
 * Die Stufe kommt fertig vom Server; hier wird keine Schwelle nachgerechnet (C3.5).
 * Aufgeklappt stehen die Einzelwerte, der Erhebungszeitpunkt und der zuletzt
 * registrierte Ausfall — der bleibt dort auch, nachdem die Meldung in „Braucht dich"
 * abgehakt wurde (FR-023, US3-6).
 */
export function SystemStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(
    () =>
      api
        .systemStatus()
        .then(setStatus)
        // Ein fehlgeschlagener Abruf ist kein Fall für die Fehlerleiste: die Anzeige ist
        // Beiwerk, und der nächste Takt versucht es ohnehin erneut.
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Vor der ersten Antwort nimmt ein Platzhalter den Raum ein, damit die Kopfleiste
  // nicht springt, sobald die Zahlen eintreffen.
  if (!status) return <div className="w-40" aria-hidden />;

  const { level, summary, notice } = status.pressure;
  const ton =
    level === 'warn'
      ? 'border-red-800 bg-red-950/40 text-red-300 hover:bg-red-950/60'
      : level === 'notice'
        ? 'border-amber-800 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50'
        : 'border-zinc-700 text-zinc-400 hover:bg-zinc-900';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={notice ?? 'Systemzustand — Platte, Auslagerung, parallele Features'}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${ton}`}
      >
        {level !== 'ok' && <span aria-hidden>{level === 'warn' ? '⚠' : '●'}</span>}
        <span className="tabular-nums">{summary}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm shadow-xl">
          {notice && (
            <p className={`mb-2 rounded px-2 py-1.5 text-xs ${level === 'warn' ? 'bg-red-950/60 text-red-200' : 'bg-amber-950/50 text-amber-200'}`}>
              {notice}
            </p>
          )}

          <Zeile
            label="Freier Platz"
            wert={
              status.resources.diskFreeBytes === null
                ? UNBEKANNT
                : `${bytes(status.resources.diskFreeBytes)}${
                    status.resources.diskTotalBytes === null ? '' : ` von ${bytes(status.resources.diskTotalBytes)}`
                  }`
            }
          />
          <Zeile
            label="Auslagerung"
            wert={
              status.resources.swapUsedRatio === null
                ? UNBEKANNT
                : `${Math.round(status.resources.swapUsedRatio * 100)} %${
                    status.resources.swapUsedBytes === null || status.resources.swapTotalBytes === null
                      ? ''
                      : ` (${bytes(status.resources.swapUsedBytes)} von ${bytes(status.resources.swapTotalBytes)})`
                  }`
            }
          />
          <Zeile label="Features parallel" wert={String(status.resources.activeFeatures)} />
          <Zeile label="Erhoben" wert={new Date(status.resources.collectedAt).toLocaleTimeString('de-CH')} />

          <div className="mt-2 border-t border-zinc-800 pt-2">
            <p className="mb-1 text-xs font-medium text-zinc-400">Letzter registrierter Ausfall</p>
            <LetzterAusfall outage={status.lastOutage} />
          </div>
        </div>
      )}
    </div>
  );
}

function Zeile({ label, wert }: { label: string; wert: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="tabular-nums text-xs text-zinc-200">{wert}</span>
    </div>
  );
}

/**
 * Der letzte Ausfall aus dem Betriebsprotokoll — auch ein folgenloser (FR-023).
 * Ein nicht bestimmbares Fenster (Uhr sprang rückwärts, D15) wird als solches
 * benannt statt mit erfundenen Zeiten gefüllt.
 */
function LetzterAusfall({ outage }: { outage: OutageRecord | null }) {
  if (!outage) return <p className="text-xs text-zinc-600">Keiner registriert.</p>;

  const ende = new Date(outage.to).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (outage.undetermined || outage.from === null || outage.durationMs === null) {
    return (
      <p className="text-xs text-zinc-300">
        Zeitfenster nicht bestimmbar, bemerkt am {ende}.
      </p>
    );
  }

  const beginn = new Date(outage.from).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <p className="text-xs text-zinc-300">
      {beginn} bis {ende} ({formatOutageDuration(outage.durationMs)})
      {outage.affectedRuns > 0 && `, ${outage.affectedRuns} ${outage.affectedRuns === 1 ? 'Lauf' : 'Läufe'} betroffen`}
      {outage.silent && <span className="text-zinc-500"> — ohne Abgangseintrag</span>}
    </p>
  );
}

function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}
