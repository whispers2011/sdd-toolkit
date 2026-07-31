/**
 * DER eine Ausführungspfad für vom Projekt gelieferte Kommandos: Lebenszyklus-
 * Schritte (F1b) und Stack-Profile laufen hier durch.
 *
 * Ein zweiter Runner hätte zwangsläufig abweichendes Verhalten bei Zeitlimit,
 * Log-Ablage und Ausgabe-Ausschnitt — und bräuchte die Prozessgruppen-Regel an
 * zwei Stellen (research E6).
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tailLines } from '@sdd/shared';
import { loginShellEnv } from '../pty/loginShellEnv.js';

/** Prozess-Ausführung, injizierbar für Tests (Muster: HeadlessRunner). */
export type StepRunner = (opts: {
  command: string;
  cwd: string;
  logPath: string;
  /** Erste Zeile der Log-Datei: `=== <name>: <command> ===` */
  header: string;
  timeoutMs: number;
  /** Die acht Kontext-Variablen; der Runner mischt sie in die Login-Shell-Umgebung. */
  extraEnv: Record<string, string>;
}) => Promise<{ exitCode: number; tail: string; timedOut: boolean }>;

/**
 * Rohpuffer für den Tail: mehr als genug für die letzten 20 Zeilen / 2000 Zeichen
 * und trotzdem hart begrenzt. Der Schnitt auf Zeilen passiert erst am Ende —
 * inkrementell angewandt würde `tailLines` Zeilengrenzen zwischen zwei Chunks
 * verkleben.
 */
const TAIL_RAW_MAX = 16_384;

/**
 * Beendet die Prozessgruppe eines SELBST GESTARTETEN Prozesses (FR-040/FR-041).
 *
 * `kill(-pid)` trifft die ganze Gruppe — also auch Enkel wie einen im Kommando
 * gestarteten Dev-Server. Ein Beenden über Namensmuster (`pkill`, `killall`)
 * findet hier NICHT statt: es träfe gleichartige Prozesse anderer Features und
 * Sitzungen, und im SDD-Toolkit sogar den Server, dessen Kindprozess die eigene
 * Arbeit ist.
 *
 * `pid > 0` ist Pflicht: `kill(-0, …)` bedeutet „eigene Prozessgruppe" — das wäre
 * der Toolkit-Server selbst. Der Aufruf ist gefasst, weil der Prozess inzwischen
 * weg sein kann.
 *
 * @returns true, wenn das Signal abgesetzt werden konnte.
 */
export function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Produktions-Runner: `$SHELL -l -c "<command>"` im Zielverzeichnis.
 *
 * Login-Shell (`-l`), weil Version-Manager (nvm, mise) in `.zprofile` hängen —
 * ohne sie findet ein `pnpm`-Kommando sein Node nicht (dieselbe Begründung wie in
 * verifyService/agentGateService).
 *
 * Die Ausgabe wird GESTREAMT in die Log-Datei geschrieben und nie vollständig im
 * Speicher gehalten; nur ein begrenzter Rest bleibt für den Tail des Inbox-Items
 * stehen (Edge Case „sehr viel Ausgabe").
 *
 * `detached: true` gibt dem Kommando eine EIGENE Prozessgruppe. Bei Zeitlimit
 * wird diese Gruppe beendet — damit stirbt auch ein im Kommando gestarteter
 * Hintergrunddienst mit, statt das Arbeitsverzeichnis weiter zu halten (genau der
 * Befund hinter dem fehlgeschlagenen Worktree-Entfernen, research E11/E12).
 * Ohne `detached` beendete `child.kill()` nur die Shell, nicht ihre Enkel.
 */
export const defaultStepRunner: StepRunner = async ({
  command,
  cwd,
  logPath,
  header,
  timeoutMs,
  extraEnv,
}) => {
  const env = { ...(await loginShellEnv()), ...extraEnv };
  mkdirSync(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: 'a' });
  log.write(`=== ${header} ===\n`);

  let raw = '';
  const capture = (chunk: Buffer): void => {
    raw += chunk.toString('utf8');
    if (raw.length > TAIL_RAW_MAX) raw = raw.slice(raw.length - TAIL_RAW_MAX);
  };

  return new Promise((resolve) => {
    const child = spawn(env.SHELL ?? '/bin/zsh', ['-l', '-c', command], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Erst die eigene Gruppe; schlägt das fehl (Prozess schon weg oder keine
      // Gruppe entstanden), bleibt das eigene Handle als Rückfallweg.
      if (!killProcessGroup(child.pid, 'SIGKILL')) child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });

    const done = (exitCode: number): void => {
      clearTimeout(timer);
      if (timedOut) log.write(`\n=== Zeitlimit überschritten — Kommando beendet (exit 137) ===\n`);
      // Erst zurückkehren, wenn das Log wirklich auf der Platte ist: der Aufrufer
      // verbucht den Lauf direkt danach, und die Läufe-Ansicht liest die Datei
      // über dieselbe Ableitung. Ein noch nicht geleerter Puffer zeigte dort ein
      // abgeschnittenes Log.
      log.end(() => resolve({ exitCode, tail: tailLines(raw), timedOut }));
    };
    child.on('close', (code) => done(timedOut ? 137 : (code ?? 1)));
    // Kommando existiert nicht / Shell nicht startbar ⇒ regulärer Fehlschlag,
    // nie ein stiller Erfolg.
    child.on('error', () => done(127));
  });
};
