import type { Heartbeat } from './types.js';

/** Abstand zweier Lebenszeichen. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Ab dieser Lücke ohne vermerkten gewollten Abgang gilt der Server als unerwartet weg.
 *
 * Drei ausgefallene Takte — bewusst grosszügig. Bei parallelen Rust-Builds (dem Zustand,
 * der den Befund vom 30.07.2026 auslöste) ist ein verzögerter Takt plausibel; eine engere
 * Schwelle erzeugte Phantom-Ausfälle (D2).
 */
export const OUTAGE_THRESHOLD_MS = 90_000;

/** Höchstens so viele Feature-Namen stehen in der Meldung, der Rest wird gezählt (D18). */
export const MAX_FEATURE_NAMES = 5;

/** Ergebnis der reinen Lückenerkennung — die einzige Stelle, die „Ausfall ja/nein" entscheidet. */
export type OutageDetection =
  | { kind: 'none'; reason: 'first_start' | 'clean_shutdown' | 'within_tolerance' }
  | { kind: 'outage'; from: number; to: number; durationMs: number; instanceId: string | null }
  | { kind: 'undetermined'; reason: 'clock_backwards'; lastHeartbeatAt: number; bootAt: number };

/**
 * War der Server zwischen dem letzten Lebenszeichen und diesem Start unerwartet weg?
 *
 * Rein: `now` kommt IMMER von aussen, nie aus `Date.now()`, und es wird keine Datei
 * gelesen. Nur so ist das Verhalten ohne echten Serverabsturz mit gesetzten Zeitpunkten
 * prüfbar (FR-025, D16).
 *
 * Die Reihenfolge der Prüfungen ist verbindlich: `null` → `clean` → Uhr → Schwelle.
 * `clean` steht vor der Uhrprüfung, damit ein geordneter Abgang auch bei verstellter
 * Uhr nie zum Ausfall wird (FR-010).
 */
export function detectOutage(input: {
  /** Zuletzt gelesenes Lebenszeichen; null = keines vorhanden oder unlesbar. */
  heartbeat: Heartbeat | null;
  /** Startzeitpunkt der neuen Instanz (ms). */
  now: number;
  thresholdMs?: number;
}): OutageDetection {
  const { heartbeat, now } = input;
  const threshold = input.thresholdMs ?? OUTAGE_THRESHOLD_MS;

  if (heartbeat === null) return { kind: 'none', reason: 'first_start' };
  if (heartbeat.clean) return { kind: 'none', reason: 'clean_shutdown' };
  if (heartbeat.ts > now) {
    return { kind: 'undetermined', reason: 'clock_backwards', lastHeartbeatAt: heartbeat.ts, bootAt: now };
  }

  const durationMs = now - heartbeat.ts;
  if (durationMs <= threshold) return { kind: 'none', reason: 'within_tolerance' };
  return { kind: 'outage', from: heartbeat.ts, to: now, durationMs, instanceId: heartbeat.instanceId };
}

/**
 * Lesbare Dauer statt roher Sekunden: höchstens zwei Einheiten, grösste zuerst,
 * abgeschnitten statt gerundet, Nullanteile weggelassen („2 h", nicht „2 h 0 min").
 * Neben Minuten stehen keine Sekunden — bei einem Ausfall interessiert die
 * Grössenordnung, nicht die Sekunde.
 */
export function formatOutageDuration(ms: number): string {
  const sekunden = Math.max(0, Math.floor(ms / 1000));
  const tage = Math.floor(sekunden / 86_400);
  const stunden = Math.floor((sekunden % 86_400) / 3_600);
  const minuten = Math.floor((sekunden % 3_600) / 60);

  if (tage > 0) return paar(`${tage} ${tage === 1 ? 'Tag' : 'Tage'}`, stunden > 0 ? `${stunden} h` : null);
  if (stunden > 0) return paar(`${stunden} h`, minuten > 0 ? `${minuten} min` : null);
  if (minuten > 0) return `${minuten} min`;
  return `${sekunden} s`;
}

function paar(gross: string, klein: string | null): string {
  return klein ? `${gross} ${klein}` : gross;
}

/**
 * Text der Aufmerksamkeitsmeldung — der vollständige Inhalt von `AttentionItem.message`.
 * Die Oberfläche parst ihn nicht, sie zeigt ihn (C1, C4).
 */
export function outageMessage(input: {
  from: number;
  to: number;
  durationMs: number;
  /** Zahl der betroffenen Läufe DIESES Projekts. */
  runCount: number;
  /** Feature-Namen des betroffenen Projekts; `null` = Lauf ohne Feature (Chat). */
  featureNames: (string | null)[];
  /** Für die Zeitformatierung; Tests setzen sie fest. */
  locale?: string;
}): string {
  const locale = input.locale ?? 'de-CH';
  // Über Mitternacht hinweg wäre „zwischen 22:14 und 02:05" irreführend — dann
  // bekommen beide Zeiten ihr Datum.
  const tageswechsel = new Date(input.from).toDateString() !== new Date(input.to).toDateString();
  const beginn = zeitpunkt(input.from, locale, tageswechsel);
  const ende = zeitpunkt(input.to, locale, tageswechsel);
  const dauer = formatOutageDuration(input.durationMs);
  return `Server war zwischen ${beginn} und ${ende} unerwartet weg (${dauer}) — ${betroffene(input.runCount, input.featureNames)}`;
}

function zeitpunkt(ts: number, locale: string, mitDatum: boolean): string {
  const d = new Date(ts);
  const zeit = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (!mitDatum) return zeit;
  return `${d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })} ${zeit}`;
}

function betroffene(runCount: number, featureNames: (string | null)[]): string {
  if (runCount <= 0) return 'keine Läufe betroffen';
  const zahl = runCount === 1 ? '1 Lauf betroffen' : `${runCount} Läufe betroffen`;
  // Zwei Läufe desselben Features nennen den Namen einmal; die Laufzahl bleibt vollständig.
  const namen = [...new Set(featureNames.map((n) => n ?? 'Chat'))];
  if (namen.length === 0) return zahl;
  const rest = namen.length - MAX_FEATURE_NAMES;
  const gezeigt = namen.slice(0, MAX_FEATURE_NAMES).join(', ');
  return rest > 0 ? `${zahl}: ${gezeigt} … und ${rest} weitere` : `${zahl}: ${gezeigt}`;
}
