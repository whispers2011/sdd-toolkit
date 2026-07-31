import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSONAL_SETTINGS,
  DEFAULT_SOUND_SETTINGS,
  MAX_SPEECH_LENGTH,
  SOUND_TRIGGERS,
  TONES,
  isSoundTriggerId,
  normalizePersonalSettings,
  normalizeSoundSettings,
  normalizeTicketSource,
  resolveReaction,
  soundTrigger,
  tone,
  toneDurationMs,
  toneFingerprint,
  type SoundEvent,
} from './soundCatalog.js';
import {
  FEATURE_PHASES,
  type AttentionKind,
  type FeaturePhase,
  type SoundSettings,
  type SoundTriggerId,
} from './types.js';

// ---------- S1: Auslöser-Katalog ----------

describe('Auslöser-Katalog (S1)', () => {
  it('deckt alle Meldungsarten ab: Aufmerksamkeit + 2 Ablauf + Phasen (FR-004, SC-001)', () => {
    const byGroup = (g: string) => SOUND_TRIGGERS.filter((t) => t.group === g);
    // 17 statt ursprünglich 10: die Nachbar-Features haben am 30./31.07.2026 sieben
    // Meldungsarten ergänzt (verification_unconfigured, run_unpriced, phase_false_start,
    // project_without_runs, metering_conflict, server_outage, lifecycle_step_failed).
    // Die eigentliche Absicherung ist `Record<AttentionKind, …>` in soundCatalog.ts — sie
    // bricht den Typecheck, sobald eine Art fehlt. Diese Zahl ist die Gegenprobe dazu.
    expect(byGroup('attention')).toHaveLength(17);
    expect(byGroup('flow')).toHaveLength(2);
    // 7 konkrete Phasen + der generische Eintrag.
    expect(byGroup('phase')).toHaveLength(FEATURE_PHASES.length + 1);
    // Gesamtzahl abgeleitet statt gepinnt — sonst bricht der Test bei jeder neuen Meldungsart
    // ein zweites Mal an derselben Ursache.
    expect(SOUND_TRIGGERS).toHaveLength(
      byGroup('attention').length + byGroup('flow').length + byGroup('phase').length,
    );
  });

  it('leitet die Phasen-Auslöser aus FEATURE_PHASES ab (S1.2)', () => {
    for (const phase of FEATURE_PHASES) {
      expect(isSoundTriggerId(`phase:${phase}`)).toBe(true);
    }
    expect(isSoundTriggerId('phase:changed')).toBe(true);
  });

  it('kennt `constitution` NICHT als Auslöser (S1.5)', () => {
    expect(isSoundTriggerId('phase:constitution')).toBe(false);
  });

  it('hat paarweise eindeutige id und label (FR-007, S1.3)', () => {
    expect(new Set(SOUND_TRIGGERS.map((t) => t.id)).size).toBe(SOUND_TRIGGERS.length);
    expect(new Set(SOUND_TRIGGERS.map((t) => t.label)).size).toBe(SOUND_TRIGGERS.length);
    // Kein Label wiederholt bloss den technischen Schlüssel.
    for (const t of SOUND_TRIGGERS) expect(t.label).not.toBe(t.id);
  });

  it('begründet die bisherige Stille an genau den zwei Rückfrage-Auslösern (FR-014, S1.4)', () => {
    expect(soundTrigger('attention:awaiting_input').hint).toBeTruthy();
    expect(soundTrigger('attention:permission_request').hint).toBeTruthy();
    // Kein weiterer Aufmerksamkeits-Auslöser trägt eine solche Begründung.
    const withHint = SOUND_TRIGGERS.filter((t) => t.group === 'attention' && t.hint);
    expect(withHint.map((t) => t.id)).toEqual([
      'attention:awaiting_input',
      'attention:permission_request',
    ]);
  });

  it('wirft bei einem unbekannten Auslöser statt still zu raten', () => {
    expect(() => soundTrigger('attention:gibtsnicht' as SoundTriggerId)).toThrow(/Unbekannter/);
  });
});

// ---------- S2: Ton-Katalog ----------

describe('Ton-Katalog (S2)', () => {
  it('hat mindestens 20 Töne (FR-006, SC-001)', () => {
    expect(TONES.length).toBeGreaterThanOrEqual(20);
  });

  it('hat paarweise eindeutige id und label (FR-007, S2.2/S2.3)', () => {
    expect(new Set(TONES.map((t) => t.id)).size).toBe(TONES.length);
    expect(new Set(TONES.map((t) => t.label)).size).toBe(TONES.length);
  });

  it('unterscheidet je zwei Töne in Klangfarbe, Tonhöhenfolge oder Rhythmus (FR-006, S2.4)', () => {
    const prints = TONES.map(toneFingerprint);
    expect(new Set(prints).size).toBe(TONES.length);
  });

  it('ist durchgehend wohlgeformt (S2.5)', () => {
    for (const t of TONES) {
      expect(t.steps.length, t.id).toBeGreaterThanOrEqual(1);
      for (const s of t.steps) {
        expect(s.freq, t.id).toBeGreaterThan(0);
        expect(s.ms, t.id).toBeGreaterThan(0);
        expect(s.gapMs, t.id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('führt den heutigen Beep als TONES[0] — bitgenau (FR-012/FR-013, S2.6)', () => {
    const beep = TONES[0]!;
    expect(beep.id).toBe('two-tone-rise');
    expect(beep.wave).toBe('sine');
    // store.tsx:378-399: 880 Hz und 1174 Hz, je 150 ms Klang, 120 ms Versatz.
    expect(beep.steps).toEqual([
      { freq: 880, ms: 150, gapMs: 120 },
      { freq: 1174, ms: 150, gapMs: 0 },
    ]);
  });

  it('verweist auf keine Datei, URL oder Netzadresse (S2.7)', () => {
    // Töne sind reine Oszillator-Daten: nur die vier bekannten Felder, keine Strings mit Pfaden.
    for (const t of TONES) {
      expect(Object.keys(t).sort(), t.id).toEqual(['id', 'label', 'steps', 'wave']);
      expect(t.id).not.toMatch(/[/.]|https?:/);
    }
  });

  it('liefert eine Sicherheitsfrist, die die echte Länge nie unterschätzt', () => {
    const beep = TONES[0]!;
    // Echte Länge = letzter Start + dessen Klingdauer = 120 + 150 = 270 ms.
    expect(toneDurationMs(beep)).toBeGreaterThanOrEqual(270);
    for (const t of TONES) expect(toneDurationMs(t), t.id).toBeGreaterThan(0);
  });

  it('wirft bei einem unbekannten Ton', () => {
    expect(() => tone('gibtsnicht')).toThrow(/Unbekannter/);
  });
});

// ---------- S3: Standardbelegung ----------

describe('Standardbelegung (S3)', () => {
  it('klingt genau zweimal, im heutigen Ton und Pegel (FR-012/FR-013, SC-003)', () => {
    expect(DEFAULT_SOUND_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_SOUND_SETTINGS.volume).toBe(0.06);
    expect(DEFAULT_SOUND_SETTINGS.reactions).toEqual({
      'flow:turn_completed': { kind: 'tone', toneId: 'two-tone-rise' },
      'flow:merged': { kind: 'tone', toneId: 'two-tone-rise' },
    });
  });

  it('lässt alle übrigen Auslöser stumm (FR-012/FR-014, SC-003/SC-004)', () => {
    const belegt = Object.keys(DEFAULT_SOUND_SETTINGS.reactions);
    expect(belegt).toHaveLength(2);
    const stumm = SOUND_TRIGGERS.filter((t) => !belegt.includes(t.id));
    // Abgeleitet statt gepinnt: die Aussage ist „alles ausser den zwei belegten schweigt",
    // nicht „es sind genau 18". Eine neue Meldungsart darf diesen Test nicht brechen.
    expect(stumm).toHaveLength(SOUND_TRIGGERS.length - belegt.length);
    for (const t of stumm) {
      expect(resolveReaction(DEFAULT_SOUND_SETTINGS, eventFor(t.id)), t.id).toBeNull();
    }
  });

  it('startet die Ticket-Quelle auf dem heutigen Verhalten (FR-033, SC-010)', () => {
    expect(DEFAULT_PERSONAL_SETTINGS.ticketSource).toBe('jira');
  });
});

/** Hilfsbrücke: aus einer Auslöser-ID das Ereignis bauen, das sie auslöst. */
function eventFor(id: SoundTriggerId): SoundEvent {
  const [group, rest] = id.split(':') as [string, string];
  if (group === 'attention') return { kind: 'attention', attention: rest as AttentionKind };
  if (group === 'flow') return { kind: 'flow', flow: rest as 'turn_completed' | 'merged' };
  // `phase:changed` ist kein Ereignis, sondern die Ausweichregel — für den
  // Stumm-Nachweis genügt eine beliebige konkrete Phase.
  return { kind: 'phase', phase: (rest === 'changed' ? 'specify' : rest) as FeaturePhase };
}

// ---------- S4: Normalisierung ----------

describe('Normalisierung (S4)', () => {
  it('liefert bei fehlendem oder defektem Eintrag die Standardwerte (S4.1, FR-003)', () => {
    for (const raw of [null, undefined, 42, 'kaputt', [], true]) {
      expect(normalizeSoundSettings(raw)).toEqual(DEFAULT_SOUND_SETTINGS);
    }
  });

  it('behandelt ein fehlendes `reactions` als LEERE Karte, nicht als Standardbelegung (S4)', () => {
    // Sonst liesse sich „alles stumm" nicht speichern.
    expect(normalizeSoundSettings({ enabled: true, volume: 0.06 }).reactions).toEqual({});
  });

  it('verwirft unbekannte Auslöser und behält den Rest (S4.2, FR-020)', () => {
    const r = normalizeSoundSettings({
      reactions: {
        'attention:review_due': { kind: 'tone', toneId: 'ping' },
        'attention:gibtsnichtmehr': { kind: 'tone', toneId: 'ping' },
        'quatsch': { kind: 'silence' },
      },
    });
    expect(r.reactions).toEqual({ 'attention:review_due': { kind: 'tone', toneId: 'ping' } });
  });

  it('verwirft unbekannte Töne, Nicht-Text-Ansagen und unbekannte Arten (S4.3/S4.4/S4.6)', () => {
    const r = normalizeSoundSettings({
      reactions: {
        'attention:review_due': { kind: 'tone', toneId: 'gibtsnicht' },
        'attention:gate_failed': { kind: 'speech', text: 42 },
        'attention:agent_errored': { kind: 'telepathie' },
        'attention:approval_required': { kind: 'silence' },
      },
    });
    // Nur die ausdrückliche Stille überlebt — der Rest fällt weg (⇒ ebenfalls still).
    expect(r.reactions).toEqual({ 'attention:approval_required': { kind: 'silence' } });
  });

  it('kürzt eine zu lange Ansage statt sie zu verwerfen (S4.5)', () => {
    const r = normalizeSoundSettings({
      reactions: { 'attention:review_due': { kind: 'speech', text: 'a'.repeat(500) } },
    });
    const reaction = r.reactions['attention:review_due'];
    expect(reaction).toEqual({ kind: 'speech', text: 'a'.repeat(MAX_SPEECH_LENGTH) });
  });

  it('klemmt die Lautstärke auf [0,1] und fängt Unsinn ab (S4.7, FR-013)', () => {
    expect(normalizeSoundSettings({ volume: 5 }).volume).toBe(1);
    expect(normalizeSoundSettings({ volume: -2 }).volume).toBe(0);
    expect(normalizeSoundSettings({ volume: 0.5 }).volume).toBe(0.5);
    expect(normalizeSoundSettings({ volume: NaN }).volume).toBe(0.06);
    expect(normalizeSoundSettings({ volume: 'laut' }).volume).toBe(0.06);
  });

  it('fällt bei nicht-boolschem Hauptschalter auf den Standardwert zurück (S4.8, FR-010)', () => {
    expect(normalizeSoundSettings({ enabled: 'ja' }).enabled).toBe(true);
    expect(normalizeSoundSettings({ enabled: false }).enabled).toBe(false);
  });

  it('ist idempotent: f(f(x)) === f(x) (S4.9)', () => {
    const roh = {
      enabled: 'ja',
      volume: 9,
      reactions: {
        'attention:review_due': { kind: 'tone', toneId: 'chime-soft' },
        'attention:gate_failed': { kind: 'speech', text: 'x'.repeat(500) },
        'unbekannt:dings': { kind: 'silence' },
      },
    };
    const einmal = normalizeSoundSettings(roh);
    expect(normalizeSoundSettings(einmal)).toEqual(einmal);
    // Auch die Standardwerte selbst sind ein Fixpunkt.
    expect(normalizeSoundSettings(DEFAULT_SOUND_SETTINGS)).toEqual(DEFAULT_SOUND_SETTINGS);
  });

  it('normalisiert die Ticket-Quelle und das Bündel (FR-003)', () => {
    expect(normalizeTicketSource('manual')).toBe('manual');
    expect(normalizeTicketSource('confluence')).toBe('jira');
    expect(normalizeTicketSource(undefined)).toBe('jira');
    expect(normalizePersonalSettings(null)).toEqual({
      sound: DEFAULT_SOUND_SETTINGS,
      ticketSource: 'jira',
    });
    expect(normalizePersonalSettings({ ticketSource: 'manual', sound: { enabled: false } })).toEqual({
      sound: { enabled: false, volume: 0.06, reactions: {} },
      ticketSource: 'manual',
    });
  });
});

// ---------- S5: Auflösung ----------

describe('Auflösung (S5)', () => {
  const mit = (reactions: SoundSettings['reactions'], enabled = true): SoundSettings => ({
    enabled,
    volume: 0.06,
    reactions,
  });

  it('bildet Aufmerksamkeit und Ablauf direkt ab (S5.3)', () => {
    const s = mit({
      'attention:review_due': { kind: 'tone', toneId: 'chime-soft' },
      'flow:merged': { kind: 'speech', text: 'gemergt' },
    });
    expect(resolveReaction(s, { kind: 'attention', attention: 'review_due' })).toEqual({
      triggerId: 'attention:review_due',
      reaction: { kind: 'tone', toneId: 'chime-soft' },
    });
    expect(resolveReaction(s, { kind: 'flow', flow: 'merged' })).toEqual({
      triggerId: 'flow:merged',
      reaction: { kind: 'speech', text: 'gemergt' },
    });
  });

  it('schweigt bei ausgeschaltetem Hauptschalter, ohne Zuordnungen zu verlieren (S5.1, FR-010)', () => {
    const reactions = { 'flow:merged': { kind: 'tone' as const, toneId: 'ping' } };
    const s = mit(reactions, false);
    expect(resolveReaction(s, { kind: 'flow', flow: 'merged' })).toBeNull();
    expect(s.reactions).toEqual(reactions); // unangetastet
  });

  it('schweigt bei ausdrücklicher Stille und bei fehlender Zuordnung (S5.2)', () => {
    expect(
      resolveReaction(mit({ 'flow:merged': { kind: 'silence' } }), { kind: 'flow', flow: 'merged' }),
    ).toBeNull();
    expect(resolveReaction(mit({}), { kind: 'flow', flow: 'merged' })).toBeNull();
  });

  it('lässt die spezifische Phase gewinnen (S5.4, FR-016)', () => {
    const s = mit({
      'phase:changed': { kind: 'tone', toneId: 'ping' },
      'phase:implement': { kind: 'tone', toneId: 'fanfare' },
    });
    expect(resolveReaction(s, { kind: 'phase', phase: 'implement' })).toEqual({
      triggerId: 'phase:implement',
      reaction: { kind: 'tone', toneId: 'fanfare' },
    });
  });

  it('weicht auf den allgemeinen Phasen-Auslöser aus, wenn die spezifische Phase stumm ist (research D3)', () => {
    const s = mit({
      'phase:changed': { kind: 'tone', toneId: 'ping' },
      'phase:plan': { kind: 'silence' },
    });
    // Ausdrückliche Stille an der spezifischen Phase …
    expect(resolveReaction(s, { kind: 'phase', phase: 'plan' })).toEqual({
      triggerId: 'phase:changed',
      reaction: { kind: 'tone', toneId: 'ping' },
    });
    // … und ebenso eine fehlende Zuordnung.
    expect(resolveReaction(s, { kind: 'phase', phase: 'tasks' })?.triggerId).toBe('phase:changed');
  });

  it('bleibt still, wenn weder spezifisch noch allgemein etwas hinterlegt ist', () => {
    expect(
      resolveReaction(mit({ 'phase:changed': { kind: 'silence' } }), {
        kind: 'phase',
        phase: 'plan',
      }),
    ).toBeNull();
  });

  it('liefert nie zwei Reaktionen (S5.5)', () => {
    const s = mit({
      'phase:changed': { kind: 'tone', toneId: 'ping' },
      'phase:implement': { kind: 'tone', toneId: 'fanfare' },
    });
    const r = resolveReaction(s, { kind: 'phase', phase: 'implement' });
    expect(r).not.toBeNull();
    expect(Array.isArray(r)).toBe(false);
  });
});
