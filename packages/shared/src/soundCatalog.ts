/**
 * Ton- und Auslöser-Katalog (Contract S1–S5, Feature „persoenliche-einstellungen").
 *
 * Ein Ton ist DATEN, kein Code (research D4): `{ id, label, wave, steps[] }`. Der
 * Web-Renderer in `packages/web/src/sound.ts` ist ein reiner Interpreter dieser
 * Daten. Nur so ist die von FR-006 verlangte Unterscheidbarkeit maschinell
 * prüfbar (`toneFingerprint`) — eine Renderfunktion pro Ton wäre nicht
 * vergleichbar.
 *
 * Die Auslöser werden AUS dem bestehenden Vokabular abgeleitet: die zehn
 * `attention:*` über `Record<AttentionKind, …>` (Compile-Fehler bei jeder
 * Änderung an `AttentionKind`), die sieben `phase:*` über `FEATURE_PHASES` +
 * `PHASE_META`. Es gibt keine zweite, handgeschriebene Liste (S1.2).
 *
 * KEINE UI, KEIN IO, keine Uhr, kein Zufall — in Isolation testbar.
 */
import { FEATURE_PHASES } from './types.js';
import type {
  AttentionKind,
  FeaturePhase,
  PersonalSettings,
  SoundReaction,
  SoundSettings,
  SoundTriggerId,
  TicketSource,
  ToneId,
} from './types.js';
import { PHASE_META } from './workflowModel.js';

// ---------- Auslöser (S1) ----------

export interface SoundTrigger {
  id: SoundTriggerId;
  /** Bezeichnung in der Oberfläche (deutsch). */
  label: string;
  /** Gruppierung im Einstellungsbereich. */
  group: 'attention' | 'flow' | 'phase';
  /** Erklärender Zusatz — trägt u. a. die Begründung der bisherigen Stille (FR-014). */
  hint?: string;
}

/**
 * Bezeichnungen der Aufmerksamkeitsereignisse. Über `Record<AttentionKind, …>`
 * getypt ⇒ eine neue oder entfallende `AttentionKind` bricht hier `typecheck`,
 * genau wie `PHASE_META` für die Phasen (S1.2).
 */
const ATTENTION_LABELS: Record<AttentionKind, string> = {
  awaiting_input: 'Eingabe erwartet',
  permission_request: 'Berechtigung erfragt',
  verify_failed: 'Verifikation fehlgeschlagen',
  gate_failed: 'Gate fehlgeschlagen',
  merge_conflict_escalated: 'Merge-Konflikt eskaliert',
  review_due: 'Review fällig',
  agent_errored: 'Agent-Fehler',
  run_interrupted: 'Lauf abgebrochen',
  phase_gate_failed: 'Phasen-Gate fehlgeschlagen',
  approval_required: 'Freigabe nötig',
  // Nachgetragen bei der Zusammenführung am 31.07.2026: die Nachbar-Features haben sieben
  // Meldungsarten ergänzt (Ehrlichkeit vor dem Merge, Plausibilitätsprüfung, Server-Ausfälle,
  // eigene Lebenszyklus-Schritte). Der Drift-Guard oben hat das erwartungsgemäss gemeldet —
  // genau dafür ist er gebaut.
  verification_unconfigured: 'Keine Verifikation konfiguriert',
  run_unpriced: 'Verbrauch ohne Preis',
  phase_false_start: 'Phase lief nie an',
  project_without_runs: 'Projekt ohne Läufe',
  metering_conflict: 'Messung widersprüchlich',
  server_outage: 'Server war weg',
  lifecycle_step_failed: 'Lebenszyklus-Schritt fehlgeschlagen',
  // Vier weitere aus diesem Feature (Stack-Profile und Testing-Lane) — derselbe Drift-Guard,
  // dieselbe Ursache: parallel gebaute Features ergänzen die Union, der Katalog zieht nach.
  manual_test_due: 'Manueller Test fällig',
  stack_failed: 'Stack-Start fehlgeschlagen',
  worktree_cleanup_failed: 'Aufräumen fehlgeschlagen',
  orphan_worktree: 'Verwaister Worktree',
};

/**
 * Rückfragen waren bisher bewusst lautlos, damit viele parallele Agents keinen
 * Ton-Spam erzeugen. Wer sie jetzt hörbar macht, soll wissen, warum sie es nicht
 * waren (FR-014, S1.4).
 */
const SILENT_BY_DEFAULT_HINT =
  'War bisher bewusst lautlos: bei vielen parallelen Agents erzeugen Rückfragen sonst Dauerton.';

const ATTENTION_HINTS: Partial<Record<AttentionKind, string>> = {
  awaiting_input: SILENT_BY_DEFAULT_HINT,
  permission_request: SILENT_BY_DEFAULT_HINT,
};

/** Die zwei heute hörbaren `notification`-Arten (research D1). */
const FLOW_LABELS: Record<'turn_completed' | 'merged', string> = {
  turn_completed: 'Agent-Zug fertig',
  merged: 'Feature gemergt',
};

/**
 * Genau 20 Auslöser: 10 `attention:*` + 2 `flow:*` + `phase:changed` +
 * 7 `phase:<FeaturePhase>` (S1.1). `constitution` ist bewusst KEIN Auslöser —
 * es ist eine Projekt-, keine Feature-Phase (S1.5).
 */
export const SOUND_TRIGGERS: readonly SoundTrigger[] = [
  ...(Object.entries(ATTENTION_LABELS) as [AttentionKind, string][]).map(
    ([kind, label]): SoundTrigger => ({
      id: `attention:${kind}`,
      label,
      group: 'attention',
      ...(ATTENTION_HINTS[kind] ? { hint: ATTENTION_HINTS[kind] } : {}),
    }),
  ),
  ...(Object.entries(FLOW_LABELS) as ['turn_completed' | 'merged', string][]).map(
    ([kind, label]): SoundTrigger => ({ id: `flow:${kind}`, label, group: 'flow' }),
  ),
  {
    id: 'phase:changed',
    label: 'Phasenwechsel (allgemein)',
    group: 'phase',
    hint: 'Greift für jede Phase, für die unten kein eigener Ton hinterlegt ist.',
  },
  ...FEATURE_PHASES.map(
    (phase): SoundTrigger => ({
      id: `phase:${phase}`,
      label: `Phase erreicht: ${PHASE_META[phase].label}`,
      group: 'phase',
    }),
  ),
];

const TRIGGER_BY_ID = new Map(SOUND_TRIGGERS.map((t) => [t.id, t] as const));

export function soundTrigger(id: SoundTriggerId): SoundTrigger {
  const t = TRIGGER_BY_ID.get(id);
  if (!t) throw new Error(`Unbekannter Ton-Auslöser: ${id}`);
  return t;
}

export function isSoundTriggerId(v: unknown): v is SoundTriggerId {
  return typeof v === 'string' && TRIGGER_BY_ID.has(v as SoundTriggerId);
}

// ---------- Töne (S2) ----------

export interface ToneStep {
  /** Tonhöhe in Hz, > 0. */
  freq: number;
  /** Klingdauer in ms, > 0. */
  ms: number;
  /**
   * Versatz bis zum Start des NÄCHSTEN Schritts, gerechnet ab dem Start dieses
   * Schritts (ms, ≥ 0). Beim letzten Schritt bedeutungslos.
   *
   * Warum Versatz und nicht „Pause danach": der heutige Beep überlappt seine
   * beiden Töne (150 ms Klang, aber nur 120 ms Versatz — `store.tsx:378-399`).
   * Eine reine Pause ≥ 0 könnte diese Überlappung nicht ausdrücken, und FR-012/
   * FR-013 verlangen den Standardton BITGENAU wie bisher. Alle übrigen Töne des
   * Katalogs setzen `gapMs > ms` und klingen damit sauber nacheinander.
   */
  gapMs: number;
}

export interface Tone {
  id: ToneId;
  /** Wiedererkennbare, deutsche Bezeichnung (FR-007). */
  label: string;
  wave: 'sine' | 'square' | 'triangle' | 'sawtooth';
  steps: readonly ToneStep[];
}

/**
 * 22 Töne (≥ 20 gefordert, S2.1). `TONES[0]` ist der heutige Zwei-Ton-Beep und
 * bleibt der Standardton (FR-012/FR-013, S2.6). Kein Eintrag verweist auf eine
 * Datei, eine URL oder ein Netz (S2.7) — alles entsteht aus Oszillatoren.
 */
export const TONES: readonly Tone[] = [
  // Der heutige Beep, unverändert: sine, 880 → 1174 Hz, je 150 ms, 120 ms Versatz.
  {
    id: 'two-tone-rise',
    label: 'Zwei-Ton aufwärts',
    wave: 'sine',
    steps: [
      { freq: 880, ms: 150, gapMs: 120 },
      { freq: 1174, ms: 150, gapMs: 0 },
    ],
  },
  {
    id: 'two-tone-fall',
    label: 'Zwei-Ton abwärts',
    wave: 'sine',
    steps: [
      { freq: 1174, ms: 150, gapMs: 170 },
      { freq: 880, ms: 150, gapMs: 0 },
    ],
  },
  {
    id: 'chime-soft',
    label: 'Sanftes Glöckchen',
    wave: 'sine',
    steps: [
      { freq: 1568, ms: 220, gapMs: 240 },
      { freq: 2093, ms: 300, gapMs: 0 },
    ],
  },
  {
    id: 'chime-double',
    label: 'Doppel-Glöckchen',
    wave: 'sine',
    steps: [
      { freq: 2093, ms: 120, gapMs: 180 },
      { freq: 2093, ms: 120, gapMs: 0 },
    ],
  },
  { id: 'ping', label: 'Ping', wave: 'sine', steps: [{ freq: 1320, ms: 90, gapMs: 0 }] },
  { id: 'ping-high', label: 'Hoher Ping', wave: 'sine', steps: [{ freq: 1976, ms: 70, gapMs: 0 }] },
  { id: 'blip', label: 'Blip', wave: 'square', steps: [{ freq: 880, ms: 60, gapMs: 0 }] },
  {
    id: 'blip-double',
    label: 'Doppel-Blip',
    wave: 'square',
    steps: [
      { freq: 988, ms: 50, gapMs: 90 },
      { freq: 988, ms: 50, gapMs: 0 },
    ],
  },
  {
    id: 'click-triple',
    label: 'Dreifach-Klick',
    wave: 'square',
    steps: [
      { freq: 1319, ms: 40, gapMs: 70 },
      { freq: 1319, ms: 40, gapMs: 70 },
      { freq: 1319, ms: 40, gapMs: 0 },
    ],
  },
  {
    id: 'error-descend',
    label: 'Fehler-Abstieg',
    wave: 'sawtooth',
    steps: [
      { freq: 440, ms: 160, gapMs: 180 },
      { freq: 330, ms: 160, gapMs: 180 },
      { freq: 220, ms: 260, gapMs: 0 },
    ],
  },
  {
    id: 'alert-pulse',
    label: 'Alarm-Puls',
    wave: 'square',
    steps: [
      { freq: 740, ms: 110, gapMs: 160 },
      { freq: 740, ms: 110, gapMs: 160 },
      { freq: 740, ms: 110, gapMs: 0 },
    ],
  },
  {
    id: 'fanfare',
    label: 'Fanfare',
    wave: 'triangle',
    steps: [
      { freq: 523, ms: 120, gapMs: 140 },
      { freq: 659, ms: 120, gapMs: 140 },
      { freq: 784, ms: 120, gapMs: 140 },
      { freq: 1047, ms: 280, gapMs: 0 },
    ],
  },
  {
    id: 'arpeggio-up',
    label: 'Arpeggio aufwärts',
    wave: 'triangle',
    steps: [
      { freq: 523, ms: 100, gapMs: 120 },
      { freq: 659, ms: 100, gapMs: 120 },
      { freq: 784, ms: 100, gapMs: 120 },
      { freq: 988, ms: 180, gapMs: 0 },
    ],
  },
  {
    id: 'arpeggio-down',
    label: 'Arpeggio abwärts',
    wave: 'triangle',
    steps: [
      { freq: 988, ms: 100, gapMs: 120 },
      { freq: 784, ms: 100, gapMs: 120 },
      { freq: 659, ms: 100, gapMs: 120 },
      { freq: 523, ms: 180, gapMs: 0 },
    ],
  },
  {
    id: 'knock',
    label: 'Klopfen',
    wave: 'triangle',
    steps: [
      { freq: 196, ms: 80, gapMs: 130 },
      { freq: 196, ms: 80, gapMs: 0 },
    ],
  },
  {
    id: 'bass-thud',
    label: 'Dumpfer Anstoss',
    wave: 'sine',
    steps: [{ freq: 110, ms: 220, gapMs: 0 }],
  },
  {
    id: 'warble',
    label: 'Wechselton',
    wave: 'sine',
    steps: [
      { freq: 880, ms: 90, gapMs: 100 },
      { freq: 1046, ms: 90, gapMs: 100 },
      { freq: 880, ms: 90, gapMs: 100 },
      { freq: 1046, ms: 90, gapMs: 0 },
    ],
  },
  {
    id: 'siren-short',
    label: 'Kurze Sirene',
    wave: 'sawtooth',
    steps: [
      { freq: 660, ms: 200, gapMs: 220 },
      { freq: 880, ms: 200, gapMs: 0 },
    ],
  },
  {
    id: 'whistle-up',
    label: 'Aufwärtspfiff',
    wave: 'sine',
    steps: [
      { freq: 1046, ms: 70, gapMs: 80 },
      { freq: 1318, ms: 70, gapMs: 80 },
      { freq: 1568, ms: 120, gapMs: 0 },
    ],
  },
  {
    id: 'whistle-down',
    label: 'Abwärtspfiff',
    wave: 'sine',
    steps: [
      { freq: 1568, ms: 70, gapMs: 80 },
      { freq: 1318, ms: 70, gapMs: 80 },
      { freq: 1046, ms: 120, gapMs: 0 },
    ],
  },
  {
    id: 'bell-triple',
    label: 'Dreifach-Glocke',
    wave: 'sine',
    steps: [
      { freq: 1760, ms: 130, gapMs: 200 },
      { freq: 1760, ms: 130, gapMs: 200 },
      { freq: 1760, ms: 130, gapMs: 0 },
    ],
  },
  {
    id: 'soft-marimba',
    label: 'Weiche Marimba',
    wave: 'triangle',
    steps: [
      { freq: 784, ms: 140, gapMs: 160 },
      { freq: 1047, ms: 200, gapMs: 0 },
    ],
  },
];

const TONE_BY_ID = new Map(TONES.map((t) => [t.id, t] as const));

export function tone(id: ToneId): Tone {
  const t = TONE_BY_ID.get(id);
  if (!t) throw new Error(`Unbekannter Ton: ${id}`);
  return t;
}

export function isToneId(v: unknown): v is ToneId {
  return typeof v === 'string' && TONE_BY_ID.has(v);
}

/**
 * Maschinenprüfbare Fassung von FR-006 („keine zwei Töne mit derselben
 * Kombination aus Tonhöhenfolge, Klangfarbe und Rhythmus"): Klangfarbe ⊕
 * Tonhöhenfolge ⊕ Rhythmusfolge. Wird ausschliesslich vom Test benutzt.
 */
export function toneFingerprint(t: Tone): string {
  const pitches = t.steps.map((s) => s.freq).join(',');
  const rhythm = t.steps.map((s) => `${s.ms}/${s.gapMs}`).join(',');
  return `${t.wave}|${pitches}|${rhythm}`;
}

/**
 * Obergrenze der Spieldauer — von der Warteschlange als Sicherheitsfrist
 * genutzt, nicht als Taktgeber (data-model §2, research D5). Bewusst die Summe
 * aus Klang und Versatz: sie kann die echte Länge überschätzen, nie unterschätzen.
 */
export function toneDurationMs(t: Tone): number {
  return t.steps.reduce((sum, s) => sum + s.ms + s.gapMs, 0);
}

// ---------- Standardwerte (S3) ----------

/** Zahlenwert des heutigen `gain` (`store.tsx:382`) — FR-013. */
export const DEFAULT_VOLUME = 0.06;

/** Der Standardton ist der heutige Beep. */
export const DEFAULT_TONE_ID: ToneId = 'two-tone-rise';

/**
 * Genau zwei hörbare Ereignisse, gleicher Pegel, gleicher Ton wie bisher — die
 * übrigen 18 Auslöser sind nicht enthalten und damit stumm (S3, SC-003).
 */
export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: DEFAULT_VOLUME,
  reactions: {
    'flow:turn_completed': { kind: 'tone', toneId: DEFAULT_TONE_ID },
    'flow:merged': { kind: 'tone', toneId: DEFAULT_TONE_ID },
  },
};

/** Heutiges Verhalten: bei verbundenem Jira öffnet der Import (FR-033). */
export const DEFAULT_TICKET_SOURCE: TicketSource = 'jira';

export const DEFAULT_PERSONAL_SETTINGS: PersonalSettings = {
  sound: DEFAULT_SOUND_SETTINGS,
  ticketSource: DEFAULT_TICKET_SOURCE,
};

/** Obergrenze für den Text einer gesprochenen Ansage. */
export const MAX_SPEECH_LENGTH = 200;

// ---------- Normalisierung (S4) ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Eine einzelne Reaktion prüfen. `null` = verwerfen (⇒ Stille). */
function normalizeReaction(raw: unknown): SoundReaction | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case 'silence':
      return { kind: 'silence' };
    case 'tone':
      return isToneId(raw.toneId) ? { kind: 'tone', toneId: raw.toneId } : null;
    case 'speech':
      return typeof raw.text === 'string'
        ? { kind: 'speech', text: raw.text.slice(0, MAX_SPEECH_LENGTH) }
        : null;
    default:
      return null;
  }
}

/**
 * Wird auf BEIDEN Seiten angewandt (Server beim Lesen und Schreiben, Client beim
 * Übernehmen) — dieselbe Wahrheit, kein zweites Regelwerk (A4.1). Idempotent.
 *
 * Wichtig: ein fehlendes `reactions` ist die LEERE Karte, nicht die
 * Standardbelegung — sonst liesse sich „alles stumm" nicht speichern (S4).
 * Nur ein fehlender Gesamteintrag liefert die Standardwerte (S4.1).
 */
export function normalizeSoundSettings(raw: unknown): SoundSettings {
  if (!isRecord(raw)) return DEFAULT_SOUND_SETTINGS;

  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SOUND_SETTINGS.enabled;
  const volume =
    typeof raw.volume === 'number' && Number.isFinite(raw.volume)
      ? Math.min(1, Math.max(0, raw.volume))
      : DEFAULT_SOUND_SETTINGS.volume;

  const reactions: Partial<Record<SoundTriggerId, SoundReaction>> = {};
  if (isRecord(raw.reactions)) {
    for (const [key, value] of Object.entries(raw.reactions)) {
      if (!isSoundTriggerId(key)) continue; // unbekannter Auslöser (FR-020)
      const reaction = normalizeReaction(value);
      if (reaction) reactions[key] = reaction;
    }
  }
  return { enabled, volume, reactions };
}

export function isTicketSource(v: unknown): v is TicketSource {
  return v === 'jira' || v === 'manual';
}

/** Unbekannter gespeicherter Wert ⇒ Standardwert (FR-003). */
export function normalizeTicketSource(raw: unknown): TicketSource {
  return isTicketSource(raw) ? raw : DEFAULT_TICKET_SOURCE;
}

export function normalizePersonalSettings(raw: unknown): PersonalSettings {
  const r = isRecord(raw) ? raw : {};
  return {
    sound: normalizeSoundSettings(r.sound),
    ticketSource: normalizeTicketSource(r.ticketSource),
  };
}

// ---------- Auflösung (S5) ----------

export type SoundEvent =
  | { kind: 'attention'; attention: AttentionKind }
  | { kind: 'flow'; flow: 'turn_completed' | 'merged' }
  | { kind: 'phase'; phase: FeaturePhase };

function triggerIdOf(event: SoundEvent): SoundTriggerId {
  switch (event.kind) {
    case 'attention':
      return `attention:${event.attention}`;
    case 'flow':
      return `flow:${event.flow}`;
    case 'phase':
      return `phase:${event.phase}`;
  }
}

/**
 * Höchstens EINE Reaktion je Vorfall (FR-016/FR-017). Rein: keine Uhr, kein
 * Zufall, kein Zustand.
 *
 * Bei Phasen gewinnt der spezifische Auslöser nur, sofern dort keine Stille
 * steht — sonst greift `phase:changed` (research D3). Bedingungslose Spezifität
 * würde den generischen Auslöser wertlos machen, weil alle sieben
 * Phasen-Auslöser laut FR-012 stumm starten.
 */
export function resolveReaction(
  settings: SoundSettings,
  event: SoundEvent,
): { triggerId: SoundTriggerId; reaction: SoundReaction } | null {
  if (settings.enabled === false) return null; // Hauptschalter (S5.1)

  const specific = triggerIdOf(event);
  const direct = settings.reactions[specific];
  if (direct && direct.kind !== 'silence') return { triggerId: specific, reaction: direct };

  if (event.kind === 'phase') {
    const generic = settings.reactions['phase:changed'];
    if (generic && generic.kind !== 'silence') {
      return { triggerId: 'phase:changed', reaction: generic };
    }
  }
  return null;
}
