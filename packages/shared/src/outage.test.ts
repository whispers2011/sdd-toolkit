import { describe, expect, it } from 'vitest';
import type { Heartbeat } from './types.js';
import {
  HEARTBEAT_INTERVAL_MS,
  OUTAGE_THRESHOLD_MS,
  detectOutage,
  formatOutageDuration,
  outageMessage,
} from './outage.js';

/**
 * Alle Zeitpunkte sind GESETZT — kein `Date.now()`, kein Warten, kein echter Absturz
 * (FR-025). Zeiten werden über lokale Datumsbestandteile gebaut, damit die erwartete
 * de-CH-Ausgabe unabhängig von der Zeitzone der Maschine stimmt.
 */
function hb(over: Partial<Heartbeat> = {}): Heartbeat {
  return { ts: 1_000_000, instanceId: 'inst-a', clean: false, startedAt: 900_000, ...over };
}

const MIN = 60_000;
const H = 60 * MIN;
const TAG = 24 * H;

describe('Konstanten', () => {
  it('Takt 30 s, Schwelle 90 s — drei ausgefallene Takte (D2)', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
    expect(OUTAGE_THRESHOLD_MS).toBe(90_000);
    expect(OUTAGE_THRESHOLD_MS).toBe(3 * HEARTBEAT_INTERVAL_MS);
  });
});

describe('detectOutage — die fünf Zusicherungen C1.1 bis C1.5', () => {
  it('C1.1 / FR-026 „Erststart ohne Lebenszeichen": kein Lebenszeichen → kein Ausfall', () => {
    expect(detectOutage({ heartbeat: null, now: 5_000_000 })).toEqual({
      kind: 'none',
      reason: 'first_start',
    });
  });

  it('C1.2 / FR-026 „gewollter Abgang auch nach Tagen": clean=true → nie ein Ausfall', () => {
    const heartbeat = hb({ ts: 1_000_000, clean: true });
    // Beliebig grosse Lücke: eine Stunde, ein Tag, zwei Wochen.
    for (const lücke of [H, TAG, 14 * TAG]) {
      expect(detectOutage({ heartbeat, now: heartbeat.ts + lücke })).toEqual({
        kind: 'none',
        reason: 'clean_shutdown',
      });
    }
  });

  it('C1.3: Lücke innerhalb der Schwelle → Toleranz, kein Ausfall', () => {
    const heartbeat = hb({ ts: 1_000_000 });
    // Genau auf der Schwelle gilt noch als Toleranz (`<=`).
    expect(detectOutage({ heartbeat, now: 1_000_000 + OUTAGE_THRESHOLD_MS })).toEqual({
      kind: 'none',
      reason: 'within_tolerance',
    });
    expect(detectOutage({ heartbeat, now: 1_000_000 + HEARTBEAT_INTERVAL_MS })).toEqual({
      kind: 'none',
      reason: 'within_tolerance',
    });
  });

  it('C1.4 / FR-026 „Uhr springt rückwärts": Lebenszeichen in der Zukunft → nicht bestimmbar', () => {
    const heartbeat = hb({ ts: 9_000_000 });
    expect(detectOutage({ heartbeat, now: 1_000_000 })).toEqual({
      kind: 'undetermined',
      reason: 'clock_backwards',
      lastHeartbeatAt: 9_000_000,
      bootAt: 1_000_000,
    });
  });

  it('C1.5 / FR-026 „Ausfall mit betroffenen Läufen": Lücke über der Schwelle → Ausfall mit Fenster', () => {
    const heartbeat = hb({ ts: 1_000_000, instanceId: 'inst-alt' });
    const now = 1_000_000 + 5 * MIN;
    expect(detectOutage({ heartbeat, now })).toEqual({
      kind: 'outage',
      from: 1_000_000,
      to: now,
      durationMs: 5 * MIN,
      instanceId: 'inst-alt',
    });
  });

  it('nimmt eine eigene Schwelle, damit Tests nicht warten müssen (FR-025)', () => {
    const heartbeat = hb({ ts: 1_000_000 });
    expect(detectOutage({ heartbeat, now: 1_000_100, thresholdMs: 50 }).kind).toBe('outage');
    expect(detectOutage({ heartbeat, now: 1_000_100, thresholdMs: 500 }).kind).toBe('none');
  });

  it('prüft clean VOR der Uhr — ein gewollter Abgang bleibt auch bei verstellter Uhr kein Ausfall', () => {
    const heartbeat = hb({ ts: 9_000_000, clean: true });
    expect(detectOutage({ heartbeat, now: 1_000_000 })).toEqual({
      kind: 'none',
      reason: 'clean_shutdown',
    });
  });

  it('ist rein: gleiche Eingabe → gleiches Ergebnis, und die Dauer ist nie negativ', () => {
    const input = { heartbeat: hb({ ts: 1_000_000 }), now: 1_000_000 + 10 * MIN };
    expect(detectOutage(input)).toEqual(detectOutage(input));
    const result = detectOutage(input);
    expect(result.kind === 'outage' && result.durationMs > 0).toBe(true);
  });
});

describe('formatOutageDuration — lesbare Dauer statt roher Sekunden', () => {
  it('bildet die Tabelle aus C1 ab', () => {
    expect(formatOutageDuration(47_000)).toBe('47 s');
    expect(formatOutageDuration(92_000)).toBe('1 min');
    expect(formatOutageDuration(4_080_000)).toBe('1 h 8 min');
    expect(formatOutageDuration(273_600_000)).toBe('3 Tage 4 h');
  });

  it('lässt Nullanteile weg (2 h statt 2 h 0 min)', () => {
    expect(formatOutageDuration(2 * H)).toBe('2 h');
    expect(formatOutageDuration(2 * TAG)).toBe('2 Tage');
  });

  it('schneidet ab statt zu runden', () => {
    expect(formatOutageDuration(119_000)).toBe('1 min'); // 1 min 59 s
    expect(formatOutageDuration(H - 1_000)).toBe('59 min');
  });

  it('setzt den Singular bei einem Tag', () => {
    expect(formatOutageDuration(TAG + 3 * H)).toBe('1 Tag 3 h');
  });

  it('nennt auch eine sehr kurze Dauer in Sekunden', () => {
    expect(formatOutageDuration(1_500)).toBe('1 s');
    expect(formatOutageDuration(0)).toBe('0 s');
  });
});

describe('outageMessage — Text der Aufmerksamkeitsmeldung', () => {
  /** Beginn und Ende am selben Kalendertag — das Beispiel aus C1 (1 h 8 min). */
  const from = new Date(2026, 6, 30, 12, 59, 0).getTime();
  const to = new Date(2026, 6, 30, 14, 7, 12).getTime();

  it('nennt Fenster, Dauer und betroffene Läufe (de-CH, ohne Sekunden)', () => {
    expect(
      outageMessage({
        from,
        to,
        durationMs: to - from,
        runCount: 2,
        featureNames: ['uQ_RAMEn', 'tMvPe72V'],
      }),
    ).toBe(
      'Server war zwischen 12:59 und 14:07 unerwartet weg (1 h 8 min) — 2 Läufe betroffen: uQ_RAMEn, tMvPe72V',
    );
  });

  it('stellt bei Tageswechsel beiden Zeiten das Datum voran', () => {
    const abend = new Date(2026, 6, 28, 22, 14, 0).getTime();
    const morgen = new Date(2026, 6, 29, 2, 5, 0).getTime();
    expect(
      outageMessage({
        from: abend,
        to: morgen,
        durationMs: morgen - abend,
        runCount: 1,
        featureNames: ['nachtlauf'],
      }),
    ).toBe(
      'Server war zwischen 28.07. 22:14 und 29.07. 02:05 unerwartet weg (3 h 51 min) — 1 Lauf betroffen: nachtlauf',
    );
  });

  it('setzt den Singular bei genau einem Lauf', () => {
    const text = outageMessage({ from, to, durationMs: to - from, runCount: 1, featureNames: ['nur-eins'] });
    expect(text).toContain('1 Lauf betroffen: nur-eins');
    expect(text).not.toContain('1 Läufe');
  });

  it('nennt höchstens fünf Feature-Namen und zählt den Rest', () => {
    const text = outageMessage({
      from,
      to,
      durationMs: to - from,
      runCount: 7,
      featureNames: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    });
    expect(text).toContain('7 Läufe betroffen: a, b, c, d, e … und 2 weitere');
    expect(text).not.toContain(', f');
    expect(text).not.toContain(', g');
  });

  it('führt einen Lauf ohne Feature als Chat', () => {
    const text = outageMessage({
      from,
      to,
      durationMs: to - from,
      runCount: 2,
      featureNames: [null, 'mit-feature'],
    });
    expect(text).toContain('2 Läufe betroffen: Chat, mit-feature');
  });

  it('nennt denselben Namen nicht zweimal, zählt die Läufe aber vollständig', () => {
    const text = outageMessage({
      from,
      to,
      durationMs: to - from,
      runCount: 3,
      featureNames: ['gleich', 'gleich', null, null],
    });
    expect(text).toContain('3 Läufe betroffen: gleich, Chat');
  });

  it('lässt die Aufzählung weg, wenn kein Name bekannt ist', () => {
    expect(outageMessage({ from, to, durationMs: to - from, runCount: 0, featureNames: [] })).toBe(
      'Server war zwischen 12:59 und 14:07 unerwartet weg (1 h 8 min) — keine Läufe betroffen',
    );
  });
});
