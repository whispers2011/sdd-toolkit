import { writeEnvSettings } from '../pty/hookBridge.js';
import { telemetryEnvFor } from './telemetryEnv.js';

/**
 * Telemetrie für einen Headless-Lauf (Review-/Gate-Agent, Konfliktauflösung, Chat).
 *
 * Ein Headless-Prozess IST genau ein Lauf — seine Meldungen tragen deshalb direkt die
 * `executionId` als Marke und brauchen kein Zeitfenster zur Zuordnung.
 *
 * Es entsteht eine kleine Settings-Datei je Lauf: Der `env`-Block einer Settings-Datei
 * schlägt die Prozessumgebung (research.md D5), und ohne eine solche Datei könnte eine
 * gegenläufige `~/.claude/settings.json` des Nutzers die Messung dieser Läufe still
 * abschalten.
 *
 * Best-effort: Schlägt das Schreiben fehl, läuft der Prozess ohne Telemetrie weiter und
 * der Lauf fällt auf die bestehende Messung zurück (FR-015, FR-020).
 */
export interface HeadlessTelemetry {
  env: Record<string, string>;
  settingsPath: string | null;
}

export function headlessTelemetry(
  dataDir: string,
  runId: string,
  port: number,
  inherited: Record<string, string | undefined> = {},
): HeadlessTelemetry {
  const env = telemetryEnvFor({ runId }, port, inherited);
  try {
    return { env, settingsPath: writeEnvSettings(dataDir, runId, env) };
  } catch (err) {
    console.warn(`[telemetry] Settings-Datei für Lauf ${runId} nicht schreibbar:`, (err as Error).message);
    return { env, settingsPath: null };
  }
}
