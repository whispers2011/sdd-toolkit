import type { UsageEvent } from '@sdd/shared';

/**
 * Zwischenspeicher der eingetroffenen Verbrauchsmeldungen (Feature
 * "token-und-kostenmessung...", data-model.md Abschnitt 3).
 *
 * Rein flüchtig: Nichts hiervon wird persistiert. Ein Serverneustart verliert nur
 * noch nicht verrechnete Ereignisse — der betroffene Lauf fällt dann auf die
 * Transkript-Messung zurück (FR-015).
 *
 * Der Speicherbedarf ist dreifach gedeckelt (FR-030), weil eine lange Session
 * fortlaufend meldet und Ereignisse ohne zugehörigen Lauf sich sonst unbegrenzt
 * ansammelten.
 */

/** Nachlauffenster: so lange kann ein abgeschlossener Lauf noch nachgetragen werden (FR-012). */
export const TELEMETRY_GRACE_MS = 5 * 60_000;

const DEFAULT_MAX_EVENTS_PER_KEY = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

interface Buffer {
  events: UsageEvent[];
  seen: Set<string>;
}

export interface TelemetryStats {
  eventsReceived: number;
  lastEventAt: number | null;
}

export class TelemetryStore {
  private buffers = new Map<string, Buffer>();
  /** Marken mit einem offenen Lauf — ihr Puffer wird nicht nach Alter geleert. */
  private held = new Set<string>();
  private eventsReceived = 0;
  private lastEventAt: number | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private readonly maxEventsPerKey: number;

  constructor(opts: { maxEventsPerKey?: number; autoSweep?: boolean } = {}) {
    this.maxEventsPerKey = opts.maxEventsPerKey ?? DEFAULT_MAX_EVENTS_PER_KEY;
    if (opts.autoSweep !== false) {
      this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
      this.sweepTimer.unref?.();
    }
  }

  /**
   * Neue Ereignisse aufnehmen. Dubletten (gleiche requestId je Marke) zählen nicht
   * erneut — die CLI kann denselben Stapel nach einem Übertragungsfehler wiederholen.
   */
  ingest(events: readonly UsageEvent[]): void {
    for (const e of events) {
      const key = e.sddSessionId ?? e.sddRunId;
      if (!key) continue; // ohne Marke: fremde Session (FR-003)

      let buf = this.buffers.get(key);
      if (!buf) this.buffers.set(key, (buf = { events: [], seen: new Set() }));
      if (buf.seen.has(e.requestId)) continue;

      buf.seen.add(e.requestId);
      insertSorted(buf.events, e);
      this.eventsReceived += 1;
      if (this.lastEventAt === null || e.at > this.lastEventAt) this.lastEventAt = e.at;

      if (buf.events.length > this.maxEventsPerKey) {
        // Älteste zuerst verwerfen: sie liegen am weitesten hinter jedem noch
        // offenen Lauf und werden am ehesten nicht mehr gebraucht.
        const dropped = buf.events.splice(0, buf.events.length - this.maxEventsPerKey);
        for (const d of dropped) buf.seen.delete(d.requestId);
      }
    }
  }

  /** Alle gepufferten Ereignisse einer Marke, aufsteigend nach Zeit. */
  eventsFor(key: string): UsageEvent[] {
    return this.buffers.get(key)?.events ?? [];
  }

  /**
   * Einen offenen Lauf anmelden: solange er läuft, darf `sweep()` seine Ereignisse
   * nicht nach Alter verwerfen. Ohne diese Sperre verlor ein Lauf alles, was älter
   * als das Nachlauffenster war, BEVOR er überhaupt einmal verrechnet wurde — bei
   * einem 33-Minuten-Lauf am 30.07.2026 waren das ~83 % seines Verbrauchs
   * (6'578'097 gemeldet gegen 39'472'755 im Transkript gemessen).
   */
  hold(key: string): void {
    this.held.add(key);
  }

  /** Lauf abgemeldet: ab jetzt gilt für diese Marke wieder der normale Kehraus. */
  release(key: string): void {
    this.held.delete(key);
  }

  /** Puffer einer beendeten Session vollständig abräumen. */
  forget(key: string): void {
    this.buffers.delete(key);
    this.held.delete(key);
  }

  stats(): TelemetryStats {
    return { eventsReceived: this.eventsReceived, lastEventAt: this.lastEventAt };
  }

  /**
   * Kehraus: alles verwerfen, was kein offener Lauf mehr beanspruchen kann.
   *
   * „Kein offener Lauf mehr" ist eine Frage der Zuordnung, nicht des Alters — genau
   * hier lag der Fehler bis zum 30.07.2026. Das Nachlauffenster (5 min) galt als
   * Verfallsdatum für JEDES Ereignis, obwohl ein laufender Lauf beliebig lange dauern
   * kann: implement-Läufe des Tages liefen 33 bis 76 Minuten. Ihre frühen Ereignisse
   * wurden also verworfen, bevor der Lauf sie zum ersten Mal verrechnen konnte, und
   * der Nachtrag am Fensterende summierte nur noch den Rest — neun Läufe wurden so
   * um Faktor 2,9 bis 16,8 nach unten geschrieben.
   *
   * Ereignisse eines angemeldeten Laufs (`hold`) bleiben deshalb liegen, bis er
   * abgemeldet ist (`release`/`forget` am Ende des Nachlauffensters). Die
   * Mengenobergrenze `maxEventsPerKey` bleibt als Speicherdeckel bestehen (FR-030).
   */
  sweep(now = Date.now()): void {
    const cutoff = now - TELEMETRY_GRACE_MS;
    for (const [key, buf] of this.buffers) {
      if (this.held.has(key)) continue;
      const keep = buf.events.filter((e) => e.at >= cutoff);
      if (keep.length === buf.events.length) continue;
      if (keep.length === 0) {
        this.buffers.delete(key);
        continue;
      }
      buf.seen = new Set(keep.map((e) => e.requestId));
      buf.events = keep;
    }
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }
}

/** Einfügen mit Sortierung nach Zeit — Stapel treffen nicht zwingend in Reihenfolge ein. */
function insertSorted(events: UsageEvent[], e: UsageEvent): void {
  if (events.length === 0 || events[events.length - 1]!.at <= e.at) {
    events.push(e);
    return;
  }
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.at <= e.at) lo = mid + 1;
    else hi = mid;
  }
  events.splice(lo, 0, e);
}
