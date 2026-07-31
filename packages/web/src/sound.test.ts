import { describe, expect, it, vi } from 'vitest';
import { createSoundQueue } from './sound.js';

/**
 * Warteschlange der Ton-Ausgabe (FR-017, SC-006).
 *
 * Der Player wird injiziert (`run`), deshalb braucht dieser Test weder
 * AudioContext noch Sprachausgabe — geprüft wird die REIHENFOLGE, nicht der Klang.
 */

/** Ein Player, dessen Ausgaben einzeln von Hand beendet werden. */
function steuerbarerPlayer() {
  const gestartet: number[] = [];
  const beendet: number[] = [];
  const offen: (() => void)[] = [];
  /** Höchstzahl gleichzeitig laufender Ausgaben — muss 1 bleiben. */
  let laufend = 0;
  let maxGleichzeitig = 0;

  const run = (id: number) => async () => {
    gestartet.push(id);
    laufend += 1;
    maxGleichzeitig = Math.max(maxGleichzeitig, laufend);
    await new Promise<void>((resolve) => offen.push(resolve));
    laufend -= 1;
    beendet.push(id);
  };

  /** Fertig-Signal der aktuell laufenden Ausgabe geben. */
  const fertig = async () => {
    const resolve = offen.shift();
    expect(resolve, 'keine laufende Ausgabe').toBeDefined();
    resolve!();
    // Der Warteschlange Gelegenheit geben, den nächsten Eintrag zu starten.
    await Promise.resolve();
    await Promise.resolve();
  };

  return {
    run,
    fertig,
    gestartet,
    beendet,
    get maxGleichzeitig() {
      return maxGleichzeitig;
    },
  };
}

describe('Warteschlange spielt strikt seriell (FR-017, SC-006)', () => {
  it('startet zehn dicht eingereihte Ausgaben nacheinander, nie überlappend', async () => {
    const p = steuerbarerPlayer();
    const queue = createSoundQueue();

    // Zehn Ereignisse „gleichzeitig" — ohne jedes Warten dazwischen.
    for (let i = 0; i < 10; i++) queue.enqueue(p.run(i), 60_000);
    await Promise.resolve();
    await Promise.resolve();

    // Nur die erste läuft; die übrigen neun warten.
    expect(p.gestartet).toEqual([0]);

    for (let i = 1; i < 10; i++) {
      await p.fertig();
      expect(p.gestartet, `nach Fertig-Signal ${i - 1}`).toHaveLength(i + 1);
      // Kein Start vor dem Fertig-Signal des Vorgängers.
      expect(p.beendet).toHaveLength(i);
    }
    await p.fertig();

    expect(p.gestartet).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.beendet).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.maxGleichzeitig, 'zwei Ausgaben liefen gleichzeitig').toBe(1);
  });

  it('löst eine hängende Ausgabe über die Sicherheitsfrist (research D5)', async () => {
    vi.useFakeTimers();
    try {
      const gestartet: number[] = [];
      const queue = createSoundQueue();

      // Die erste Ausgabe meldet nie „fertig" (verschluckte onend-Meldung).
      queue.enqueue(async () => {
        gestartet.push(0);
        await new Promise<void>(() => {});
      }, 500);
      queue.enqueue(async () => {
        gestartet.push(1);
      }, 500);

      await vi.advanceTimersByTimeAsync(0);
      expect(gestartet).toEqual([0]); // die zweite wartet noch

      await vi.advanceTimersByTimeAsync(600);
      expect(gestartet, 'Sicherheitsfrist hat die Schlange nicht freigegeben').toEqual([0, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('verwirft ab der Kapazität den ÄLTESTEN noch nicht begonnenen Eintrag (U4.3)', async () => {
    const p = steuerbarerPlayer();
    const queue = createSoundQueue(3); // kleine Kapazität, gleiche Regel

    queue.enqueue(p.run(0), 60_000); // startet sofort
    await Promise.resolve();
    await Promise.resolve();
    expect(p.gestartet).toEqual([0]);

    // Drei warten (Kapazität 3) …
    queue.enqueue(p.run(1), 60_000);
    queue.enqueue(p.run(2), 60_000);
    queue.enqueue(p.run(3), 60_000);
    expect(queue.waiting).toBe(3);

    // … der vierte verdrängt den ältesten wartenden (1), nicht den neuesten.
    queue.enqueue(p.run(4), 60_000);
    expect(queue.waiting).toBe(3);

    for (let i = 0; i < 4; i++) await p.fertig();

    expect(p.gestartet).toEqual([0, 2, 3, 4]);
    expect(p.gestartet).not.toContain(1);
  });

  it('lässt einen Fehler in der Ausgabe die Schlange nicht blockieren (FR-018)', async () => {
    const gestartet: number[] = [];
    const queue = createSoundQueue();

    queue.enqueue(async () => {
      gestartet.push(0);
      throw new Error('Audio blockiert');
    }, 60_000);
    queue.enqueue(async () => {
      gestartet.push(1);
    }, 60_000);

    // Ohne Zeitsprung: der Fehler ist selbst das Fertig-Signal.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(gestartet).toEqual([0, 1]);
  });

  it('nimmt nach dem Leerlaufen neue Einträge wieder an', async () => {
    const p = steuerbarerPlayer();
    const queue = createSoundQueue();

    queue.enqueue(p.run(0), 60_000);
    await Promise.resolve();
    await Promise.resolve();
    await p.fertig();
    expect(p.beendet).toEqual([0]);

    queue.enqueue(p.run(1), 60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(p.gestartet).toEqual([0, 1]);
  });
});
