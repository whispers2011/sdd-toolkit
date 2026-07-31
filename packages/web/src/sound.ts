import {
  resolveReaction,
  soundTrigger,
  tone,
  toneDurationMs,
  type SoundEvent,
  type SoundReaction,
  type Tone,
} from '@sdd/shared';
import { getPersonal } from './personalSettings.js';

/**
 * Ton-Ausgabe (Contract U4). Interpreter der Ton-DATEN aus `@sdd/shared` —
 * hier steht kein Katalog, nur das Abspielen.
 *
 * Drei Eigenschaften tragen den Vertrag:
 *  - EIN gemeinsamer, träge erzeugter AudioContext (research D6). Früher entstand
 *    pro Beep ein neuer und wurde nach 600 ms geschlossen; bei zehn dichten
 *    Ereignissen wären das zehn Kontexte — Browser begrenzen deren Zahl hart.
 *  - Eine STRIKT serielle Warteschlange mit Fertig-Signal statt Zeitraster
 *    (research D5): gesprochene Ansagen haben unbekannte Länge.
 *  - Asymmetrische Fehlermeldung: im Ereignisfall still (FR-018), beim Vorhören
 *    sichtbar (FR-019).
 */

export type PreviewResult = { ok: true } | { ok: false; reason: 'audio_blocked' | 'speech_unavailable' };

/** SC-006 verlangt zehn; 20 gibt Reserve, ohne unbegrenzt aufzustauen. */
const QUEUE_CAPACITY = 20;

// ---------- Serielle Warteschlange (U4.2/U4.3/U4.9) ----------

export interface SoundQueue {
  /** `run` muss beim Fertig-Signal der Ausgabe auflösen. */
  enqueue(run: () => Promise<void>, safetyMs: number): void;
  /** Noch nicht begonnene Einträge (für Tests). */
  readonly waiting: number;
}

/**
 * Der nächste Eintrag beginnt erst nach dem Fertig-Signal des vorherigen
 * (FR-017). Die Sicherheitsfrist ist der Notausgang gegen verschluckte
 * `onend`-Meldungen der Browser-Sprachausgabe — sie ist KEIN Taktgeber.
 *
 * Der Player wird als Abhängigkeit übergeben (`run`), damit die Reihenfolge
 * ohne Audio-Hardware prüfbar ist (U4.9).
 */
export function createSoundQueue(capacity: number = QUEUE_CAPACITY): SoundQueue {
  const waiting: { run: () => Promise<void>; safetyMs: number }[] = [];
  let busy = false;

  async function pump(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      let item = waiting.shift();
      while (item) {
        await withSafety(item.run, item.safetyMs);
        item = waiting.shift();
      }
    } finally {
      busy = false;
    }
  }

  return {
    enqueue(run, safetyMs) {
      // Über der Kapazität fällt der ÄLTESTE noch nicht begonnene Eintrag weg —
      // nicht der neueste: SC-006 verlangt zehn unterscheidbare Ausgaben, nicht
      // die zehnte.
      if (waiting.length >= capacity) waiting.shift();
      waiting.push({ run, safetyMs });
      void pump();
    },
    get waiting() {
      return waiting.length;
    },
  };
}

/** Läuft `run` und gibt spätestens nach `safetyMs` frei — Fehler blockieren nie. */
function withSafety(run: () => Promise<void>, safetyMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, safetyMs);
    try {
      run().then(finish, finish);
    } catch {
      finish();
    }
  });
}

// ---------- Audio-Kern (U4.1) ----------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let audioBroken = false;

function audio(): { ctx: AudioContext; master: GainNode } | null {
  if (audioBroken) return null;
  if (!ctx || !master) {
    try {
      const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : undefined;
      if (!Ctor) {
        audioBroken = true;
        return null;
      }
      ctx = new Ctor();
      master = ctx.createGain();
      master.connect(ctx.destination);
    } catch {
      audioBroken = true;
      ctx = null;
      master = null;
      return null;
    }
  }
  return { ctx, master };
}

/**
 * Spielt die Schritte eines Tons als Oszillator-Sequenz. `gapMs` ist der
 * Versatz zum Start des nächsten Schritts (siehe `ToneStep` in `@sdd/shared`) —
 * deshalb wächst der Versatz um `gapMs`, nicht um `ms + gapMs`. Nur so überlappt
 * der Standardton exakt wie der heutige Beep.
 *
 * Löst beim `onended` des zuletzt endenden Oszillators auf.
 */
async function playTone(t: Tone, volume: number): Promise<boolean> {
  const a = audio();
  if (!a) return false;
  try {
    await a.ctx.resume();
  } catch {
    return false; // Audio-Sperre vor der ersten Interaktion (FR-018, Edge Case)
  }
  if (a.ctx.state !== 'running') return false;

  try {
    a.master.gain.value = volume;
    const start = a.ctx.currentTime;
    let offsetMs = 0;
    let letzter: OscillatorNode | null = null;
    let letztesEnde = -1;

    for (const step of t.steps) {
      const osc = a.ctx.createOscillator();
      osc.type = t.wave;
      osc.frequency.value = step.freq;
      osc.connect(a.master);
      const von = start + offsetMs / 1000;
      const bis = von + step.ms / 1000;
      osc.start(von);
      osc.stop(bis);
      if (bis > letztesEnde) {
        letztesEnde = bis;
        letzter = osc;
      }
      offsetMs += step.gapMs;
    }

    if (!letzter) return true;
    const ende = letzter;
    return await new Promise<boolean>((resolve) => {
      ende.onended = () => resolve(true);
    });
  } catch {
    return false;
  }
}

// ---------- Sprachausgabe (U4.7/U4.8, research D7/D12) ----------

function speechApi(): SpeechSynthesis | null {
  if (typeof speechSynthesis === 'undefined') return null;
  if (typeof SpeechSynthesisUtterance === 'undefined') return null;
  return speechSynthesis;
}

/**
 * Systemstandardstimme, keine Stimm-, Sprach-, Tempo- oder Tonhöhenwahl
 * (ausdrücklich nicht im Umfang). Leerer Text ⇒ die Auslöser-Bezeichnung wird
 * gesprochen: wer „Ansage" wählt, will hören, nicht schweigen (research D7).
 */
async function playSpeech(text: string, triggerLabel: string): Promise<boolean> {
  const synth = speechApi();
  if (!synth) return false;
  const gesprochen = text.trim() || triggerLabel;
  if (!gesprochen) return false;

  try {
    const u = new SpeechSynthesisUtterance(gesprochen);
    return await new Promise<boolean>((resolve) => {
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      synth.cancel(); // Reste einer abgebrochenen Ausgabe wegräumen
      synth.speak(u);
    });
  } catch {
    return false;
  }
}

// ---------- Ausgabe einer Reaktion ----------

/** Obergrenze, ab der die Warteschlange eine Ausgabe als verschluckt ansieht. */
function safetyMsFor(r: SoundReaction): number {
  if (r.kind === 'tone') {
    try {
      return toneDurationMs(tone(r.toneId)) + 1000;
    } catch {
      return 1000;
    }
  }
  if (r.kind === 'speech') {
    // Grosszügig: gesprochene Länge ist unbekannt, die Frist darf nie zu kurz sein.
    return 3000 + r.text.length * 150;
  }
  return 0;
}

/** Gibt die Reaktion aus. `false` = nicht hörbar geworden. */
async function render(r: SoundReaction, triggerLabel: string, volume: number): Promise<boolean> {
  switch (r.kind) {
    case 'silence':
      return true;
    case 'tone':
      try {
        return await playTone(tone(r.toneId), volume);
      } catch {
        return false; // Ton nicht im Katalog (sollte die Normalisierung abfangen)
      }
    case 'speech':
      return await playSpeech(r.text, triggerLabel);
  }
}

const queue = createSoundQueue();

/**
 * Ereignisfall: still bei blockiertem Audio oder fehlender Sprachausgabe —
 * ohne Fehlermeldung und ohne Konsolenlärm (U4.4, FR-018).
 */
export function playReaction(r: SoundReaction, triggerLabel: string): void {
  if (r.kind === 'silence') return;
  const volume = getPersonal().sound.volume;
  queue.enqueue(async () => {
    await render(r, triggerLabel, volume);
  }, safetyMsFor(r));
}

/**
 * Vorhören: läuft am Hauptschalter vorbei und ohne zu speichern (U4.5), reiht
 * sich aber in dieselbe Warteschlange ein, damit auch hier nichts überlappt
 * (U4.10). Nichtverfügbarkeit wird sichtbar zurückgemeldet (U4.6, FR-019).
 */
export function previewReaction(r: SoundReaction, triggerLabel: string): Promise<PreviewResult> {
  if (r.kind === 'silence') return Promise.resolve({ ok: true });

  const fehlschlag: PreviewResult =
    r.kind === 'speech'
      ? { ok: false, reason: 'speech_unavailable' }
      : { ok: false, reason: 'audio_blocked' };

  const volume = getPersonal().sound.volume;
  const safety = safetyMsFor(r);

  return new Promise<PreviewResult>((resolve) => {
    let done = false;
    const settle = (v: PreviewResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    // Schlägt die Sicherheitsfrist der Warteschlange zu, bevor eine Meldung kam,
    // gilt das Vorhören als nicht erfolgt — sonst bliebe der Knopf stumm hängen.
    const timer = setTimeout(() => settle(fehlschlag), safety + 500);

    queue.enqueue(async () => {
      settle((await render(r, triggerLabel, volume)) ? { ok: true } : fehlschlag);
    }, safety);
  });
}

/**
 * Ereignis → Auflösung gegen den aktuellen Stand → Einreihung. Die Auflösung
 * liegt in `@sdd/shared`; hier wird nur ausgegeben.
 */
export function handleSoundEvent(event: SoundEvent): void {
  const treffer = resolveReaction(getPersonal().sound, event);
  if (!treffer) return;
  playReaction(treffer.reaction, soundTrigger(treffer.triggerId).label);
}
