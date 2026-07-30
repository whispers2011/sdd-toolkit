import { describe, expect, it } from 'vitest';
import type { ResourceSnapshot } from './types.js';
import {
  DISK_NOTICE_BYTES,
  DISK_WARN_BYTES,
  SWAP_NOTICE_RATIO,
  evaluatePressure,
} from './resourcePressure.js';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Alles im grünen Bereich; jeder Test verstellt genau das, worum es ihm geht. */
function snapshot(over: Partial<ResourceSnapshot> = {}): ResourceSnapshot {
  return {
    diskFreeBytes: 200 * GB,
    diskTotalBytes: 500 * GB,
    swapUsedRatio: 0.1,
    swapUsedBytes: 600 * MB,
    swapTotalBytes: 6 * GB,
    activeFeatures: 0,
    collectedAt: 1_700_000_000_000,
    ...over,
  };
}

describe('evaluatePressure — Stufe', () => {
  it('ok, solange Platte und Auslagerung Luft haben', () => {
    expect(evaluatePressure(snapshot()).level).toBe('ok');
  });

  it('warn unter 2 GB freiem Plattenplatz', () => {
    expect(evaluatePressure(snapshot({ diskFreeBytes: DISK_WARN_BYTES - 1 })).level).toBe('warn');
    // Genau auf der Schwelle ist noch keine Warnung — die Schwelle ist die Untergrenze.
    expect(evaluatePressure(snapshot({ diskFreeBytes: DISK_WARN_BYTES })).level).toBe('notice');
  });

  it('notice unter 10 GB freiem Plattenplatz', () => {
    expect(evaluatePressure(snapshot({ diskFreeBytes: DISK_NOTICE_BYTES - 1 })).level).toBe('notice');
    expect(evaluatePressure(snapshot({ diskFreeBytes: DISK_NOTICE_BYTES })).level).toBe('ok');
  });

  it('notice ab 80 % Auslastung des Auslagerungsspeichers', () => {
    expect(evaluatePressure(snapshot({ swapUsedRatio: SWAP_NOTICE_RATIO })).level).toBe('notice');
    expect(evaluatePressure(snapshot({ swapUsedRatio: SWAP_NOTICE_RATIO - 0.01 })).level).toBe('ok');
  });

  it('die Warnung der Platte schlägt den Hinweis der Auslagerung', () => {
    expect(evaluatePressure(snapshot({ diskFreeBytes: 1 * GB, swapUsedRatio: 0.95 })).level).toBe('warn');
  });

  it('Parallelität allein ist kein Druck — sie verschärft nur vorhandenen', () => {
    expect(evaluatePressure(snapshot({ activeFeatures: 5 })).level).toBe('ok');
  });
});

describe('evaluatePressure — Unwissen ist keine Warnung (FR-022)', () => {
  it('null-Kennzahlen gehen NICHT in die Bewertung ein', () => {
    const blind = snapshot({
      diskFreeBytes: null,
      diskTotalBytes: null,
      swapUsedRatio: null,
      swapUsedBytes: null,
      swapTotalBytes: null,
    });
    expect(evaluatePressure(blind).level).toBe('ok');
    expect(evaluatePressure(blind).notice).toBeNull();
  });

  it('eine fehlende Kennzahl unterdrückt das Urteil über die andere nicht', () => {
    // Swap unbekannt, Platte knapp → die Platte entscheidet.
    expect(evaluatePressure(snapshot({ swapUsedRatio: null, diskFreeBytes: 1 * GB })).level).toBe('warn');
    // Platte unbekannt, Swap voll → die Auslagerung entscheidet.
    expect(evaluatePressure(snapshot({ diskFreeBytes: null, swapUsedRatio: 0.9 })).level).toBe('notice');
  });
});

describe('evaluatePressure — Kurzform für die Kopfleiste (C3)', () => {
  it('nennt freien Platz, Auslagerung und ab zwei Features deren Zahl', () => {
    const v = evaluatePressure(snapshot({ diskFreeBytes: 852_017_152, swapUsedRatio: 0.8017, activeFeatures: 3 }));
    expect(v.summary).toBe('813 MB · Swap 80 % · 3 parallel');
  });

  it('lässt den Teil „<n> parallel" unter zwei Features weg (FR-019)', () => {
    expect(evaluatePressure(snapshot({ activeFeatures: 1 })).summary).not.toContain('parallel');
    expect(evaluatePressure(snapshot({ activeFeatures: 0 })).summary).not.toContain('parallel');
    expect(evaluatePressure(snapshot({ activeFeatures: 2 })).summary).toContain('2 parallel');
  });

  it('zeigt Unbekanntes als „–", nicht als geratene Zahl', () => {
    const v = evaluatePressure(snapshot({ diskFreeBytes: null, swapUsedRatio: 0.8, activeFeatures: 2 }));
    expect(v.summary).toBe('– · Swap 80 % · 2 parallel');
    expect(evaluatePressure(snapshot({ swapUsedRatio: null })).summary).toContain('Swap –');
  });

  it('gibt Plattenplatz ab GB mit einer Nachkommastelle, darunter ganzzahlig in MB', () => {
    const platz = (bytes: number) => evaluatePressure(snapshot({ diskFreeBytes: bytes })).summary.split(' · ')[0];
    expect(platz(1.4 * GB)).toBe('1.4 GB');
    expect(platz(183.17 * GB)).toBe('183.2 GB');
    expect(platz(1 * GB)).toBe('1.0 GB');
    expect(platz(813 * MB)).toBe('813 MB');
    expect(platz(0)).toBe('0 MB');
  });
});

describe('evaluatePressure — Hinweistext (US3-4, FR-020)', () => {
  it('bleibt null, solange nichts drückt', () => {
    expect(evaluatePressure(snapshot({ activeFeatures: 4 })).notice).toBeNull();
  });

  it('nennt bei Druck UND Parallelität die konkreten Werte, nicht nur die Stufe', () => {
    const v = evaluatePressure(snapshot({ diskFreeBytes: 852_017_152, swapUsedRatio: 0.8017, activeFeatures: 3 }));
    expect(v.notice).toBe('3 Features parallel, Swap 80 %, 813 MB frei');
  });

  it('bleibt bei blossem Hinweis ohne Parallelität still — sonst verrauscht die Kopfleiste', () => {
    const v = evaluatePressure(snapshot({ diskFreeBytes: 5 * GB, activeFeatures: 1 }));
    expect(v.level).toBe('notice');
    expect(v.notice).toBeNull();
  });

  it('spricht die Warnschwelle auch ohne Parallelität aus und nennt den Restplatz (FR-020)', () => {
    const v = evaluatePressure(snapshot({ diskFreeBytes: 1.4 * GB, activeFeatures: 0 }));
    expect(v.level).toBe('warn');
    expect(v.notice).toBe('1.4 GB frei');
  });
});
