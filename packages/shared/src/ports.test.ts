import { describe, expect, it } from 'vitest';
import { PORT_DEFAULTS, blockStarts, formatPortBlock, portFor, portsOfBlock, stackUrl } from './ports.js';
import type { StackService } from './types.js';

function svc(patch: Partial<StackService> = {}): StackService {
  return { name: 'web', portOffset: 0, scope: 'feature', stateful: false, primary: false, ...patch };
}

describe('PORT_DEFAULTS', () => {
  /**
   * 21000 liegt oberhalb der üblichen Entwicklungsports (3000/4000/5173/8080) und
   * unterhalb des ephemeren Bereichs ab 49152 — genau die Begründung aus research E2.
   */
  it('liegt zwischen den üblichen Dev-Ports und dem ephemeren Bereich', () => {
    expect(PORT_DEFAULTS.start).toBeGreaterThan(8080);
    expect(PORT_DEFAULTS.end + PORT_DEFAULTS.blockSize).toBeLessThan(49152);
  });

  it('fasst ein Sieben-Dienste-Projekt mit Reserve', () => {
    expect(PORT_DEFAULTS.blockSize).toBeGreaterThanOrEqual(7);
  });
});

describe('blockStarts', () => {
  it('zählt aufsteigend in Schritten der Blockbreite', () => {
    expect(blockStarts({ start: 100, end: 140, blockSize: 20 })).toEqual([100, 120, 140]);
  });

  it('nimmt `end` als letzten Blockanfang mit auf', () => {
    const starts = blockStarts({ start: 100, end: 140, blockSize: 20 });
    expect(starts[starts.length - 1]).toBe(140);
  });

  it('lässt einen nicht mehr passenden Anfang aus', () => {
    expect(blockStarts({ start: 100, end: 139, blockSize: 20 })).toEqual([100, 120]);
  });

  /**
   * (29980 − 21000) / 20 + 1 = 450 — der Anfang 29980 zählt mit. (plan.md nennt
   * 449 und lässt den letzten Block versehentlich weg.)
   */
  it('liefert für die Vorgabe 450 Blöcke', () => {
    expect(blockStarts(PORT_DEFAULTS)).toHaveLength(450);
  });

  it('liefert nichts bei leerem oder ungültigem Bereich', () => {
    expect(blockStarts({ start: 200, end: 100, blockSize: 20 })).toEqual([]);
    expect(blockStarts({ start: 100, end: 200, blockSize: 0 })).toEqual([]);
    expect(blockStarts({ start: 100, end: 200, blockSize: -5 })).toEqual([]);
  });

  it('überschneidet sich nie: aufeinanderfolgende Blöcke liegen genau `blockSize` auseinander', () => {
    const starts = blockStarts({ start: 21000, end: 21100, blockSize: 20 });
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBe(20);
    }
  });
});

describe('portsOfBlock', () => {
  /** FR-003 prüft JEDEN Port des Blocks, nicht nur den Anfang. */
  it('nennt alle Ports des Blocks, nicht nur den Anfang', () => {
    expect(portsOfBlock(21040, 4)).toEqual([21040, 21041, 21042, 21043]);
  });

  it('ist bei Breite 0 oder negativ leer', () => {
    expect(portsOfBlock(21040, 0)).toEqual([]);
    expect(portsOfBlock(21040, -3)).toEqual([]);
  });
});

describe('portFor', () => {
  it('ist Blockanfang plus Abstand', () => {
    expect(portFor(21040, svc({ portOffset: 0 }))).toBe(21040);
    expect(portFor(21040, svc({ portOffset: 1 }))).toBe(21041);
    expect(portFor(21040, svc({ portOffset: 2 }))).toBe(21042);
  });

  it('liefert null ohne Block — statt einer erfundenen Zahl', () => {
    expect(portFor(null, svc({ portOffset: 1 }))).toBeNull();
  });
});

describe('stackUrl', () => {
  const services = [
    svc({ name: 'web', portOffset: 0, primary: true }),
    svc({ name: 'api', portOffset: 1 }),
    svc({ name: 'db', portOffset: 2, stateful: true }),
  ];

  it('bildet die Adresse aus dem Haupteingang', () => {
    expect(stackUrl(21040, services)).toBe('http://localhost:21040');
  });

  it('nimmt den Haupteingang, nicht den ersten Dienst', () => {
    const withLaterPrimary = [
      svc({ name: 'api', portOffset: 1 }),
      svc({ name: 'web', portOffset: 5, primary: true }),
    ];
    expect(stackUrl(21040, withLaterPrimary)).toBe('http://localhost:21045');
  });

  /** FR-033: lieber kein Link als einer, der ins Leere führt. */
  it('liefert null ohne Haupteingang', () => {
    expect(stackUrl(21040, [svc({ name: 'api', portOffset: 1 })])).toBeNull();
  });

  it('liefert null ohne Block', () => {
    expect(stackUrl(null, services)).toBeNull();
  });

  it('liefert null ohne Dienste', () => {
    expect(stackUrl(21040, [])).toBeNull();
  });

  /** Sprechende Hostnamen sind Out of Scope — erste Stufe ist localhost. */
  it('bildet localhost, keinen sprechenden Hostnamen', () => {
    expect(stackUrl(21040, services)).toMatch(/^http:\/\/localhost:\d+$/);
  });
});

describe('formatPortBlock', () => {
  it('nennt Anfang und Ende des Blocks', () => {
    expect(formatPortBlock(21040, 20)).toBe('21040–21059');
  });

  it('ist ohne Block leer', () => {
    expect(formatPortBlock(null, 20)).toBe('');
  });
});
