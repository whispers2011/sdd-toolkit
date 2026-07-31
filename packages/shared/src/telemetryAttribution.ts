/**
 * Zuordnung von Verbrauchsmeldungen zu Läufen (Feature "token-und-kostenmessung...", P1).
 * Reine Funktionen — keine IO.
 *
 * Der Kern des Features steckt in `selectEventsForWindow`: Ein Ereignis gehört zu einem
 * Lauf, wenn es zeitlich in dessen Fenster fällt. Damit entfällt die Startmarke, die
 * bisher aus Byte-Positionen einer fortlaufenden Datei rekonstruiert werden musste
 * (`orchestrator.startOffsetIn`) — die Quelle des Laufs mit 62 Mio. Tokens.
 */
import type { UsageEvent, UsageOrigin } from './telemetryEvent.js';

export { classifyOrigin } from './telemetryEvent.js';
export type { UsageEvent, UsageOrigin } from './telemetryEvent.js';

/** Zeitfenster eines Laufs; `to: null` = der Lauf läuft noch. */
export interface RunWindow {
  from: number;
  to: number | null;
}

/** Aufsummierter Verbrauch. `costMicros: null` = kein Ereignis trug einen Betrag. */
export interface UsageTotals {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costMicros: number | null;
}

export interface UsageSummary {
  total: UsageTotals;
  byOrigin: Record<UsageOrigin, UsageTotals>;
  /** Zuletzt gemeldetes Modell (FR-013); null wenn keines. */
  model: string | null;
  /** Verrechnete requestIds — der Aufrufer merkt sie sich gegen Doppelzählung (FR-006). */
  requestIds: string[];
}

function emptyTotals(): UsageTotals {
  return {
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costMicros: null,
  };
}

function addEvent(t: UsageTotals, e: UsageEvent): void {
  t.inputTokens += e.inputTokens;
  t.outputTokens += e.outputTokens;
  t.cacheReadTokens += e.cacheReadTokens;
  t.cacheCreationTokens += e.cacheCreationTokens;
  t.tokens += e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheCreationTokens;
  // null bleibt null, bis ein Ereignis wirklich einen Betrag trägt — sonst entstünde
  // aus "nichts gemeldet" eine 0, die wie ein gemessener Nullbetrag aussähe (FR-023).
  if (e.costMicros !== null) t.costMicros = (t.costMicros ?? 0) + e.costMicros;
}

/**
 * Ereignisse eines Laufs auswählen: im Fenster, noch nicht verrechnet, jede requestId
 * nur einmal. `alreadyCounted` trägt die requestIds, die dieser Lauf bereits verbucht
 * hat — nötig für den Nachtrag verspäteter Meldungen (FR-011), damit ein zweiter
 * Durchlauf nicht doppelt zählt.
 */
export function selectEventsForWindow(
  events: readonly UsageEvent[],
  window: RunWindow,
  alreadyCounted?: ReadonlySet<string>,
): UsageEvent[] {
  const seen = new Set<string>();
  const out: UsageEvent[] = [];
  for (const e of events) {
    if (e.at < window.from) continue;
    if (window.to !== null && e.at > window.to) continue;
    if (alreadyCounted?.has(e.requestId)) continue;
    if (seen.has(e.requestId)) continue;
    seen.add(e.requestId);
    out.push(e);
  }
  return out;
}

/**
 * Ereignisse zu Summen verdichten — gesamt und je Herkunft.
 *
 * `auxiliary` (Kontext-Reset, Nebenfragen, Websuche) zählt in die Gesamtsumme, aber
 * nicht in den Subagenten-Anteil: Der Verbrauch eines `/compact` gehört zum Lauf, der
 * ihn ausgelöst hat, ist aber keine Subagenten-Arbeit.
 */
export function summarizeEvents(events: readonly UsageEvent[]): UsageSummary {
  const total = emptyTotals();
  const byOrigin: Record<UsageOrigin, UsageTotals> = {
    main: emptyTotals(),
    subagent: emptyTotals(),
    auxiliary: emptyTotals(),
  };
  let model: string | null = null;
  const requestIds: string[] = [];

  for (const e of events) {
    addEvent(total, e);
    addEvent(byOrigin[e.origin], e);
    if (e.model) model = e.model; // letzter gewinnt, wie in transcriptUsage.sumUsage
    requestIds.push(e.requestId);
  }

  return { total, byOrigin, model, requestIds };
}
