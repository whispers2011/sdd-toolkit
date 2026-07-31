import { describe, expect, it } from 'vitest';
import {
  CHAT_HYGIENE_LIMITS,
  contextRatio,
  evaluateChatHygiene,
  evaluateChatPause,
  formatHistorySize,
  formatIdleSpan,
  ratioLabel,
  restartOfferMessage,
  type ChatHygieneInput,
  type ChatOfferWatermark,
  type ChatTurnUsage,
} from './chatHygiene.js';

const L = CHAT_HYGIENE_LIMITS;
const MB = 1024 * 1024;

/** Ein gemessener Turn; nicht genannte Felder bleiben unbekannt (`null`), nicht `0`. */
const turn = (over: Partial<ChatTurnUsage> = {}): ChatTurnUsage => ({
  cacheReadTokens: null,
  outputTokens: null,
  costMicros: null,
  tokens: null,
  measured: true,
  ...over,
});

const evaluate = (over: Partial<ChatHygieneInput> = {}) =>
  evaluateChatHygiene({ historyBytes: null, turns: [], idle: false, watermark: null, ...over });

/** Turn, der den Verhältnis-Auslöser für sich erfüllt (viel gelesen, wenig erzeugt). */
const ratioTurn = (cacheReadTokens: number = L.minCacheReadTokens) =>
  turn({ cacheReadTokens, outputTokens: Math.floor(cacheReadTokens / L.ratioTrigger) });

describe('evaluateChatHygiene — Verlaufsgröße (FR-002)', () => {
  it('löst genau auf der Schwelle aus, einen Byte darunter nicht', () => {
    expect(evaluate({ historyBytes: L.historyBytes - 1 }).reasons).toEqual([]);
    expect(evaluate({ historyBytes: L.historyBytes }).reasons).toEqual(['history_size']);
    expect(evaluate({ historyBytes: L.historyBytes }).offerOpen).toBe(true);
  });

  it('unbekannte Verlaufsgröße löst nie aus, der verbrauchsbasierte Auslöser bleibt wirksam', () => {
    const profile = evaluate({
      historyBytes: null,
      turns: [turn({ cacheReadTokens: L.cacheReadTokensPerTurn, outputTokens: 500 })],
    });
    expect(profile.reasons).toEqual(['context_per_turn']);
    expect(profile.historyBytes).toBeNull();
  });
});

describe('evaluateChatHygiene — gelesener Kontext je Turn (FR-003)', () => {
  it('löst auf der Schwelle aus, obwohl der Verlauf klein ist', () => {
    const profile = evaluate({
      historyBytes: 200 * 1024,
      turns: [turn({ cacheReadTokens: L.cacheReadTokensPerTurn, outputTokens: 4_000 })],
    });
    expect(profile.reasons).toEqual(['context_per_turn']);
  });

  it('einen Token darunter nicht', () => {
    const profile = evaluate({
      turns: [turn({ cacheReadTokens: L.cacheReadTokensPerTurn - 1, outputTokens: 4_000 })],
    });
    expect(profile.reasons).toEqual([]);
    expect(profile.offerOpen).toBe(false);
  });

  it('bewertet immer den jüngsten Turn (zuletzt in der Liste)', () => {
    const profile = evaluate({
      turns: [turn({ cacheReadTokens: 900_000, outputTokens: 10 }), turn({ cacheReadTokens: 1_000, outputTokens: 900 })],
    });
    expect(profile.reasons).toEqual([]);
    expect(profile.lastTurn?.cacheReadTokens).toBe(1_000);
  });
});

describe('evaluateChatHygiene — Verhältnis über mehrere Turns (FR-004/FR-005)', () => {
  it('greift erst nach drei aufeinanderfolgenden Turns', () => {
    const t = ratioTurn(60_000);
    expect(evaluate({ turns: [t, t] }).reasons).toEqual([]);
    expect(evaluate({ turns: [t, t, t] }).reasons).toEqual(['context_ratio']);
  });

  it('ein Turn unter dem Verhältnis unterbricht die Folge', () => {
    const gut = turn({ cacheReadTokens: 60_000, outputTokens: 30_000 });
    expect(evaluate({ turns: [ratioTurn(60_000), gut, ratioTurn(60_000)] }).reasons).toEqual([]);
  });

  it('ein günstiger, kurzer Chat mit knapper Antwort bekommt nichts angeboten (FR-005)', () => {
    // 2'000 gelesene / 2 erzeugte Tokens = 1000 : 1, aber unter dem Mindestverbrauch.
    const knapp = turn({ cacheReadTokens: 2_000, outputTokens: 2 });
    const profile = evaluate({ historyBytes: 40 * 1024, turns: [knapp, knapp, knapp] });
    expect(profile.reasons).toEqual([]);
    expect(profile.offerOpen).toBe(false);
    expect(profile.ratio).toEqual({ kind: 'value', ratio: 1_000 });
  });

  it('einen Token unter dem Mindestverbrauch löst der Verhältnis-Auslöser nicht aus', () => {
    const knapp = ratioTurn(L.minCacheReadTokens - 1);
    expect(evaluate({ turns: [knapp, knapp, knapp] }).reasons).toEqual([]);
  });
});

describe('evaluateChatHygiene — fehlende Messwerte behaupten nichts (FR-016)', () => {
  it('ein Turn ohne Ausgabe ergibt no_output statt Infinity', () => {
    const profile = evaluate({ turns: [turn({ cacheReadTokens: 90_000, outputTokens: 0 })] });
    expect(profile.ratio).toEqual({ kind: 'no_output' });
    expect(ratioLabel(profile.ratio)).toBe('keine Ausgabe');
    expect(ratioLabel(profile.ratio)).not.toContain('Infinity');
  });

  it('ein nicht messbarer Turn ergibt ratio unknown und keinen verbrauchsbasierten Auslöser', () => {
    const profile = evaluate({ historyBytes: 100 * 1024, turns: [turn({ measured: false })] });
    expect(profile.ratio).toEqual({ kind: 'unknown' });
    expect(ratioLabel(profile.ratio)).toBe('unbekannt');
    expect(profile.reasons).toEqual([]);
    expect(profile.lastTurn?.measured).toBe(false);
  });

  it('nur Tokens gemessen (Schätz-Rückfallebene) → kein Split, kein Auslöser', () => {
    const profile = evaluate({ turns: [turn({ tokens: 94_000 })] });
    expect(profile.ratio).toEqual({ kind: 'unknown' });
    expect(profile.reasons).toEqual([]);
  });

  it('contextRatio ohne Turn ist unbekannt', () => {
    expect(contextRatio(null)).toEqual({ kind: 'unknown' });
  });
});

describe('evaluateChatHygiene — Ablehnung und Wasserstand (FR-009)', () => {
  const grosserVerlauf = { historyBytes: 10 * MB };

  it('ein gesetzter Wasserstand unterdrückt den Grund', () => {
    const watermark: ChatOfferWatermark = { historyBytes: 10 * MB, cacheReadTokens: null };
    const profile = evaluate({ ...grosserVerlauf, watermark });
    expect(profile.reasons).toEqual([]);
    expect(profile.offerOpen).toBe(false);
    expect(profile.message).toBeNull();
  });

  it('gibt erst nach einer weiteren Schwellenstufe wieder frei', () => {
    const watermark: ChatOfferWatermark = { historyBytes: 10 * MB, cacheReadTokens: null };
    expect(evaluate({ historyBytes: 10 * MB + L.historyBytes - 1, watermark }).reasons).toEqual([]);
    expect(evaluate({ historyBytes: 10 * MB + L.historyBytes, watermark }).reasons).toEqual(['history_size']);
  });

  it('unterdrückt auch den Kontext-Auslöser bis zur nächsten Stufe', () => {
    const watermark: ChatOfferWatermark = { historyBytes: null, cacheReadTokens: 265_000 };
    const turns = [turn({ cacheReadTokens: 265_673, outputTokens: 300 })];
    expect(evaluate({ turns, watermark }).reasons).toEqual([]);

    const gewachsen = [turn({ cacheReadTokens: 265_000 + L.cacheReadTokensPerTurn, outputTokens: 300 })];
    expect(evaluate({ turns: gewachsen, watermark }).reasons).toContain('context_per_turn');
  });

  it('Leerlauf bleibt vom Wasserstand unberührt — die Pausiert-Karte gehört nicht zur Ablehnung', () => {
    const watermark: ChatOfferWatermark = { historyBytes: 10 * MB, cacheReadTokens: 265_000 };
    const profile = evaluate({ ...grosserVerlauf, idle: true, watermark });
    expect(profile.reasons).toEqual(['idle']);
    expect(profile.offerOpen).toBe(false); // eigene Karte, kein Hinweisstreifen
  });
});

describe('evaluateChatHygiene — frische Unterhaltung (FR-012)', () => {
  it('ohne Turns und mit kleinem Verlauf entsteht kein Angebot', () => {
    const profile = evaluate({ historyBytes: 12 * 1024, turns: [] });
    expect(profile.reasons).toEqual([]);
    expect(profile.offerOpen).toBe(false);
    expect(profile.lastTurn).toBeNull();
    expect(profile.message).toBeNull();
    expect(profile.ratio).toEqual({ kind: 'unknown' });
  });

  it('mehrere günstige Turns in Folge ergeben kein Angebot (SC-004)', () => {
    const guenstig = turn({ cacheReadTokens: 12_000, outputTokens: 600, costMicros: 900 });
    const profile = evaluate({ historyBytes: 300 * 1024, turns: [guenstig, guenstig, guenstig] });
    expect(profile.reasons).toEqual([]);
  });
});

describe('restartOfferMessage — ein Text, alle Gründe mit Zahl (FR-006/FR-013)', () => {
  it('nennt die Verlaufsgröße', () => {
    const profile = evaluate({ historyBytes: Math.round(16.8 * MB) });
    expect(profile.message).toBe('Der Verlauf ist 16,8 MB groß — jeder weitere Turn zahlt den Verlauf mit.');
  });

  it('nennt den gelesenen Kontext des letzten Turns', () => {
    const profile = evaluate({ turns: [turn({ cacheReadTokens: 265_673, outputTokens: 300 })] });
    expect(profile.message).toContain("265'673 Tokens Kontext");
  });

  it('Leerlauf und Kosten ergeben EINEN Text mit beiden Gründen (FR-013)', () => {
    const profile = evaluate({ historyBytes: Math.round(16.8 * MB), idle: true });
    expect(profile.reasons).toEqual(['idle', 'history_size']);
    expect(profile.message).toBe(
      'Seit 5 min keine Aktivität und der Verlauf ist 16,8 MB groß — jeder weitere Turn zahlt den Verlauf mit.',
    );
  });

  it('Leerlauf allein nennt keinen Kostengrund', () => {
    const profile = evaluate({ historyBytes: 40 * 1024, idle: true });
    expect(profile.message).toBe(
      'Seit 5 min keine Aktivität — die Session wurde beendet, der Verlauf ist erhalten.',
    );
  });

  it('drei Gründe werden mit Komma und „und" verbunden', () => {
    const t = turn({ cacheReadTokens: 265_673, outputTokens: 300 });
    const profile = evaluate({ historyBytes: 10 * MB, turns: [t, t, t] });
    expect(profile.reasons).toEqual(['history_size', 'context_per_turn', 'context_ratio']);
    expect(profile.message).toMatch(/^Der Verlauf ist .+, der letzte Turn las .+ und die letzten 3 Turns lasen /);
  });

  it('ohne Grund gibt es keinen Text', () => {
    expect(restartOfferMessage(evaluate())).toBeNull();
  });
});

describe('Referenzfall 28.07.2026 (SC-004)', () => {
  it('16,8 MB Verlauf, ~265 000 gelesene Tokens, ~300 Ausgabe-Tokens → Angebot', () => {
    const t = turn({ cacheReadTokens: 265_673, outputTokens: 300, costMicros: 890_000, tokens: 266_100 });
    const profile = evaluate({ historyBytes: Math.round(16.8 * MB), turns: [t, t, t] });

    expect(profile.offerOpen).toBe(true);
    expect(profile.reasons).toEqual(['history_size', 'context_per_turn', 'context_ratio']);
    expect(profile.ratio.kind).toBe('value');
    if (profile.ratio.kind === 'value') expect(Math.round(profile.ratio.ratio)).toBe(886);
    expect(profile.message).toContain('16,8 MB');
  });

  it('das Verhältnis des Referenzfalls liegt in der Gegend der kritischen Marke (SC-003)', () => {
    const ratio = contextRatio(turn({ cacheReadTokens: 265_673, outputTokens: 250 }));
    expect(ratio.kind === 'value' && ratio.ratio >= L.ratioCritical).toBe(true);
    expect(ratioLabel(ratio)).toBe("1'063 : 1");
  });
});

describe('formatHistorySize / ratioLabel', () => {
  it('formatiert Megabyte mit einer Dezimalstelle und Komma', () => {
    expect(formatHistorySize(Math.round(16.8 * MB))).toBe('16,8 MB');
    expect(formatHistorySize(8 * MB)).toBe('8,0 MB');
  });

  it('formatiert Kilobyte und Byte', () => {
    expect(formatHistorySize(200 * 1024)).toBe('200 KB');
    expect(formatHistorySize(512)).toBe('512 B');
  });

  it('unbekannte Größe wird nicht als 0 ausgewiesen (FR-016)', () => {
    expect(formatHistorySize(null)).toBe('unbekannt');
  });

  it('gibt das Verhältnis mit Tausendertrennung aus', () => {
    expect(ratioLabel({ kind: 'value', ratio: 886.2 })).toBe('886 : 1');
    expect(ratioLabel({ kind: 'value', ratio: 1_063.4 })).toBe("1'063 : 1");
  });
});

/**
 * Nach langer Pause wird nicht mehr fortgesetzt: Wer nach Stunden zurückkommt, beginnt
 * eine neue Aufgabe — der alte Verlauf würde ab da nur in jedem Turn mitgelesen.
 */
describe('evaluateChatPause — wie lange „Chat fortsetzen" angeboten wird', () => {
  const T = 1_000_000_000;

  it('nicht pausiert → keine Dauer, kein Angebot', () => {
    expect(evaluateChatPause({ paused: false, since: T, now: T + 60_000 })).toEqual({
      paused: false,
      since: null,
      idleMs: null,
      resumable: false,
    });
  });

  it('misst die Pause ab dem Ende der Session', () => {
    const state = evaluateChatPause({ paused: true, since: T, now: T + 12 * 60_000 });
    expect(state.idleMs).toBe(12 * 60_000);
    expect(state.resumable).toBe(true);
  });

  it('genau auf der Grenze ist nicht mehr fortsetzbar', () => {
    expect(evaluateChatPause({ paused: true, since: T, now: T + L.resumeMaxIdleMs - 1 }).resumable).toBe(true);
    expect(evaluateChatPause({ paused: true, since: T, now: T + L.resumeMaxIdleMs }).resumable).toBe(false);
  });

  it('unbekannter Beginn verwirft keinen Verlauf (FR-016)', () => {
    const state = evaluateChatPause({ paused: true, since: null, now: T });
    expect(state.idleMs).toBeNull();
    expect(state.resumable).toBe(true);
  });

  it('rückwärts laufende Uhr ergibt keine negative Dauer', () => {
    expect(evaluateChatPause({ paused: true, since: T, now: T - 5_000 }).idleMs).toBe(0);
  });
});

describe('formatIdleSpan', () => {
  it('nennt Minuten, Stunden und beides zusammen', () => {
    expect(formatIdleSpan(12 * 60_000)).toBe('12 min');
    expect(formatIdleSpan(60 * 60_000)).toBe('1 h');
    expect(formatIdleSpan(80 * 60_000)).toBe('1 h 20 min');
  });

  it('unter einer Minute wird nicht auf 0 min gerundet', () => {
    expect(formatIdleSpan(20_000)).toBe('weniger als 1 min');
  });
});

describe('Grenzwerte an einer Stelle (FR-018)', () => {
  it('trägt auch die bestehende Leerlaufzeit', () => {
    expect(L.idleMs).toBe(5 * 60_000);
  });

  it('trägt die Frist, nach der nicht mehr fortgesetzt wird', () => {
    expect(L.resumeMaxIdleMs).toBe(60 * 60_000);
  });

  it('lässt sich ohne Testumbau nachjustieren — Grenzen sind Parameter', () => {
    const streng = { ...L, historyBytes: 1024 };
    expect(evaluateChatHygiene({ historyBytes: 2048, turns: [], idle: false, watermark: null }, streng).reasons).toEqual(
      ['history_size'],
    );
    expect(evaluate({ historyBytes: 2048 }).reasons).toEqual([]);
  });
});
