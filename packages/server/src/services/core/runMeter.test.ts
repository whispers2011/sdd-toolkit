import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openMemoryDatabase, type DB } from '../../db/database.js';
import { ExecutionRepo, ProjectRepo, type ExecutionUsageInput } from '../../db/repos.js';
import type { LiveSession } from '../../pty/sessionManager.js';
import type { TelemetryStore } from '../../telemetry/telemetryStore.js';
import type { PlausibilityService } from '../plausibilityService.js';
import { bus } from '../../events.js';
import { RunMeter, markSession, startOffsetIn, type RunMark } from './runMeter.js';

/**
 * Turn messen — der gemeinsame Kern beider Pfade (FR-002, FR-006…FR-012).
 *
 * `locateTranscript` zeigt fest auf `~/.claude`; Tests schreiben dort nicht. Die
 * Transkript-Zugriffe sind darum steuerbar gemacht — nur so ist die mittlere Stufe der
 * Kaskade überhaupt prüfbar.
 */
const transkript = vi.hoisted(() => ({
  pfad: null as string | null,
  zeilen: [] as string[],
  groesse: 0,
  offsets: [] as number[],
}));

vi.mock('../../pty/transcriptWatcher.js', () => ({
  locateTranscript: () => transkript.pfad,
  transcriptSize: () => transkript.groesse,
  readTranscriptDelta: (_p: string, offset: number) => {
    transkript.offsets.push(offset);
    return transkript.zeilen;
  },
  offsetAtTimestamp: () => 0,
}));

beforeEach(() => {
  transkript.pfad = null;
  transkript.zeilen = [];
  transkript.groesse = 0;
  transkript.offsets = [];
});

/**
 * Quellenwahl beim Abschluss eines Laufs (Feature "token-und-kostenmessung...").
 * Der Kern: liegen Meldungen der CLI vor, gewinnen sie und die Transkript-Messung
 * läuft gar nicht erst — die Werte beider Quellen werden nie addiert (FR-016).
 */
describe('RunMeter — Telemetrie schlägt Transkript', () => {
  function withTelemetry(events: unknown[]) {
    const finishWithUsage = vi.fn();
    const updateTelemetry = vi.fn(() => ({ applied: true }) as { applied: boolean; reason?: string });
    const telemetry = {
      eventsFor: () => events,
      hold: vi.fn(),
      release: vi.fn(),
      forget: vi.fn(),
    } as unknown as TelemetryStore;
    const executions = {
      finishWithUsage,
      updateTelemetry,
      recordTranscriptEnd: vi.fn(),
      finish: vi.fn(),
      start: vi.fn(() => 'e-neu'),
    } as unknown as ExecutionRepo;

    const orch = new RunMeter({ executions, telemetry });
    const session = {
      id: 'sess1',
      featureId: 'f1',
      projectId: 'p1',
      cwd: '/p',
      claudeSessionId: null,
      scrollback: '',
    } as unknown as LiveSession;
    const running = {
      phase: 'specify',
      executionId: 'e1',
      scrollbackStart: 0,
      transcriptOffsetStart: 0,
      transcriptPathStart: null,
      startedAt: 1_000,
      promptText: 'prompt',
    } as RunMark;
    return { orch, session, running, finishWithUsage, updateTelemetry, telemetry };
  }

  function apiEvent(over: Record<string, unknown> = {}) {
    return {
      requestId: 'req_1',
      at: 2_000,
      sddSessionId: 'sess1',
      sddRunId: null,
      claudeSessionId: 'uuid',
      model: 'claude-opus-5',
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      costMicros: 500,
      origin: 'main',
      ...over,
    };
  }

  it('schreibt bei vorhandenen Meldungen die Herkunft telemetry — ohne Transkript-Messung', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([apiEvent()]);
    orch.finish(session, running, 0);

    expect(finishWithUsage).toHaveBeenCalledTimes(1);
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.tokensSource).toBe('telemetry');
    expect(usage.tokens).toBe(100);
    expect(usage.costMicros).toBe(500);
    expect(usage.model).toBe('claude-opus-5');
    // Endgültigkeitsfenster ist gesetzt (FR-012).
    expect(usage.telemetryFinalAt).toBeGreaterThan(Date.now());
  });

  it('zählt nur Meldungen im Zeitfenster des Laufs (US1 Szenario 1)', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([
      apiEvent({ requestId: 'frueher', at: 500, outputTokens: 999_999 }), // vor dem Laufstart
      apiEvent({ requestId: 'drin', at: 2_000 }),
    ]);
    orch.finish(session, running, 0);
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.outputTokens).toBe(20); // nur das Ereignis im Fenster
  });

  /**
   * Kern des Fixes vom 30.07.2026: die Messung wird fortgeschrieben, nicht neu summiert.
   * Vorher summierte jeder Nachtrag den Puffer von Grund auf — und traf einen, den der
   * Kehraus inzwischen beschnitten hatte. Neun Läufe wurden so um Faktor 2,9–16,8 nach
   * unten geschrieben; einer verlor sogar seinen Preis, weil die Messung ganz auf das
   * Transkript zurückfiel.
   */
  describe('Telemetrie-Summe ist monoton', () => {
    /** Direkter Zugriff auf die Messung — der Nachtrag hängt sonst an Timern. */
    const messen = (orch: unknown, session: unknown, running: unknown, until: number) =>
      (
        orch as unknown as {
          measureFromTelemetry(s: unknown, r: unknown, u: number): Record<string, number | null> | null;
        }
      ).measureFromTelemetry(session, running, until);

    it('hält die Zahl, wenn der Puffer zwischen zwei Messungen geleert wird', () => {
      const events: unknown[] = [
        apiEvent({ requestId: 'a', at: 2_000 }),
        apiEvent({ requestId: 'b', at: 3_000 }),
      ];
      const { orch, session, running } = withTelemetry(events);

      const erst = messen(orch, session, running, 4_000);
      expect(erst?.tokens).toBe(200); // 2 × (10+20+30+40)

      // Der Kehraus hat zugeschlagen — der Puffer ist leer.
      events.length = 0;
      const zweit = messen(orch, session, running, 4_000);

      expect(zweit?.tokens).toBe(200); // unverändert, NICHT 0 und nicht null
      expect(zweit?.costMicros).toBe(1_000);
    });

    it('zählt neue Meldungen dazu, jede aber nur einmal (FR-006)', () => {
      const events: unknown[] = [apiEvent({ requestId: 'a', at: 2_000 })];
      const { orch, session, running } = withTelemetry(events);

      expect(messen(orch, session, running, 9_000)?.tokens).toBe(100);

      // Dieselbe Meldung erneut im Puffer plus eine echte neue.
      events.push(apiEvent({ requestId: 'a', at: 2_000 }), apiEvent({ requestId: 'c', at: 5_000 }));

      expect(messen(orch, session, running, 9_000)?.tokens).toBe(200); // 100 + 100, 'a' nicht doppelt
    });

    it('trennt die Summen zweier Läufe', () => {
      const events: unknown[] = [apiEvent({ requestId: 'a', at: 2_000 })];
      const { orch, session, running } = withTelemetry(events);
      const zweiterLauf = { ...running, executionId: 'e2' };

      expect(messen(orch, session, running, 9_000)?.tokens).toBe(100);
      expect(messen(orch, session, zweiterLauf, 9_000)?.tokens).toBe(100); // eigener Akkumulator
    });
  });

  it('weist ohne Subagenten keinen Subagenten-Anteil aus (FR-010, kein Null-Platzhalter)', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([apiEvent({ origin: 'main' })]);
    orch.finish(session, running, 0);
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.subagentTokens).toBeNull();
  });

  it('rechnet Subagenten mit und weist ihren Anteil getrennt aus (FR-009/FR-010)', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([
      apiEvent({ requestId: 'haupt', origin: 'main', outputTokens: 100 }),
      apiEvent({ requestId: 'sub', origin: 'subagent', outputTokens: 300 }),
    ]);
    orch.finish(session, running, 0);
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.outputTokens).toBe(400);
    expect(usage.subagentTokens).toBe(380); // 10+300+30+40
  });

  it('fällt ohne Meldungen auf die bestehende Messung zurück (FR-015)', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([]);
    orch.finish(session, running, 0);
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.tokensSource).not.toBe('telemetry');
    expect(['transcript', 'parsed', 'estimated']).toContain(usage.tokensSource);
  });

  it('verwirft Meldungen einer fremden Session — sie tragen eine andere Marke (FR-003)', () => {
    const { orch, session, running, finishWithUsage } = withTelemetry([]);
    orch.finish(session, running, 0);
    // eventsFor('sess1') liefert leer → Rückfall, kein fremder Verbrauch am Lauf.
    const usage = finishWithUsage.mock.calls[0]![2] as Record<string, unknown>;
    expect(usage.tokensSource).not.toBe('telemetry');
  });
});

// ---------- Kaskade und Rückfallebenen (US1 Szenario 5, Edge Case ohne Telemetrie) ----------

/** Transkript-Zeile im Format, das `sumUsage` liest. */
const usageZeile = (u: Partial<Record<string, number>> = {}) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id: `msg_${u.nr ?? 1}`,
      model: 'claude-opus-5',
      usage: {
        input_tokens: u.input ?? 7,
        output_tokens: u.output ?? 11,
        cache_read_input_tokens: u.cacheRead ?? 13,
        cache_creation_input_tokens: u.cacheCreation ?? 17,
      },
    },
  });

function bauen(
  opts: { events?: unknown[]; ohneTelemetrie?: boolean; plausibility?: PlausibilityService } = {},
) {
  const finishWithUsage = vi.fn();
  const updateTelemetry = vi.fn(() => ({ applied: true }) as { applied: boolean; reason?: string });
  const executions = {
    finishWithUsage,
    updateTelemetry,
    recordTranscriptEnd: vi.fn(),
    start: vi.fn(() => 'e-chat'),
  } as unknown as ExecutionRepo;
  const telemetry = opts.ohneTelemetrie
    ? undefined
    : ({
        eventsFor: () => opts.events ?? [],
        hold: vi.fn(),
        release: vi.fn(),
        forget: vi.fn(),
      } as unknown as TelemetryStore);
  const meter = new RunMeter({
    executions,
    ...(telemetry ? { telemetry } : {}),
    ...(opts.plausibility ? { plausibility: opts.plausibility } : {}),
  });
  return { meter, executions, finishWithUsage, updateTelemetry, telemetry };
}

const liveSession = (over: Partial<LiveSession> = {}): LiveSession =>
  ({
    id: 'sess1',
    featureId: null,
    projectId: 'p1',
    kind: 'chat_work',
    cwd: '/p',
    claudeSessionId: 'uuid-1',
    scrollback: '',
    startedAt: 1_000,
    ...over,
  }) as unknown as LiveSession;

const phasenMarke = (over: Partial<RunMark> = {}): RunMark => ({
  executionId: 'e1',
  startedAt: 1_000,
  scrollbackStart: 0,
  transcriptOffsetStart: 0,
  transcriptPathStart: null,
  promptText: 'prompt',
  ...over,
});

const ereignis = (over: Record<string, unknown> = {}) => ({
  requestId: 'req_a',
  at: 5_000,
  sddSessionId: 'sess1',
  sddRunId: null,
  claudeSessionId: 'uuid-1',
  model: 'claude-opus-5',
  inputTokens: 135,
  outputTokens: 45_096,
  cacheReadTokens: 7_016_059,
  cacheCreationTokens: 114_307,
  costMicros: 5_350_524,
  origin: 'main',
  ...over,
});

describe('RunMeter — Rückfallebenen der Kaskade', () => {
  it('misst ohne Meldungen das Transkript-Delta und kennzeichnet es (US1 Szenario 5)', () => {
    transkript.pfad = '/t/uuid-1.jsonl';
    transkript.zeilen = [usageZeile()];
    const { meter, finishWithUsage } = bauen({ events: [] });

    meter.finish(liveSession(), phasenMarke(), 0);

    const usage = finishWithUsage.mock.calls[0]![2] as ExecutionUsageInput;
    expect(usage.tokensSource).toBe('transcript');
    expect(usage.tokens).toBe(48); // 7 + 11 + 13 + 17
    expect(usage.cacheReadTokens).toBe(13);
  });

  it('fällt ohne konfigurierten Telemetrie-Speicher fehlerfrei durch (M8, Edge Case)', () => {
    transkript.pfad = null; // auch kein Transkript
    const { meter, finishWithUsage } = bauen({ ohneTelemetrie: true });

    expect(() =>
      meter.finish(liveSession({ scrollback: 'Antwort des Agenten.' }), phasenMarke(), 0),
    ).not.toThrow();

    const usage = finishWithUsage.mock.calls[0]![2] as ExecutionUsageInput;
    expect(['parsed', 'estimated']).toContain(usage.tokensSource);
    expect(usage.tokens).toBeGreaterThan(0);
  });

  it('liest das Transkript ab der Startmarke des Laufs, nicht ab 0 (Dateiwechsel)', () => {
    transkript.pfad = '/t/neu.jsonl';
    transkript.zeilen = [usageZeile()];
    const { meter } = bauen({ events: [] });

    // Beim Start war eine ANDERE Datei aktiv (/clear-Reset) → die neue gehört ganz diesem Lauf.
    meter.finish(liveSession(), phasenMarke({ transcriptPathStart: '/t/alt.jsonl', transcriptOffsetStart: 900 }), 0);
    expect(transkript.offsets[0]).toBe(0);

    // Gleiche Datei wie beim Start → der gemerkte Offset.
    transkript.offsets = [];
    meter.finish(
      liveSession(),
      phasenMarke({ executionId: 'e2', transcriptPathStart: '/t/neu.jsonl', transcriptOffsetStart: 900 }),
      0,
    );
    expect(transkript.offsets[0]).toBe(900);
  });
});

describe('startOffsetIn — drei Fälle, die nicht dasselbe sind', () => {
  it('nimmt den gemerkten Offset bei gleicher Datei', () => {
    expect(
      startOffsetIn('/t/a.jsonl', { transcriptPathStart: '/t/a.jsonl', transcriptOffsetStart: 512, startedAt: 1 }),
    ).toBe(512);
  });

  it('misst ab 0, wenn die Datei während des Laufs wechselte', () => {
    expect(
      startOffsetIn('/t/b.jsonl', { transcriptPathStart: '/t/a.jsonl', transcriptOffsetStart: 512, startedAt: 1 }),
    ).toBe(0);
  });

  it('sucht die Zeitmarke, wenn die Datei beim Start unbekannt war', () => {
    // offsetAtTimestamp ist im Mock 0 — geprüft wird, dass dieser Zweig genommen wird
    // und NICHT der gemerkte Offset (der schriebe fremden Verbrauch diesem Lauf zu).
    expect(
      startOffsetIn('/t/b.jsonl', { transcriptPathStart: null, transcriptOffsetStart: 512, startedAt: 1 }),
    ).toBe(0);
  });
});

// ---------- SC-002: derselbe Verbrauch, egal über welchen Pfad ----------

describe('RunMeter — Chat und Phase verbuchen dieselben Zahlen (SC-002)', () => {
  it('liefert für dieselben Meldungen identische Zahlen — Abweichung 0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    try {
      const events = [ereignis()];

      // Phasen-Weg: der Lauf existiert schon, der Aufrufer führt die Marke.
      const phase = bauen({ events });
      phase.meter.finish(liveSession({ kind: 'feature', featureId: 'f1' }), phasenMarke({ startedAt: 1_000 }), 0);
      const ausPhase = phase.finishWithUsage.mock.calls[0]![2] as ExecutionUsageInput;

      // Chat-Weg: der Kern führt das Turn-Fenster.
      const chat = bauen({ events });
      const session = liveSession();
      vi.setSystemTime(1_000);
      chat.meter.openTurn(session);
      vi.setSystemTime(10_000);
      chat.meter.closeTurn(session, { projectId: 'p1', featureId: null, kind: 'chat_work' });
      const ausChat = chat.finishWithUsage.mock.calls[0]![2] as ExecutionUsageInput;

      for (const feld of [
        'tokens',
        'inputTokens',
        'outputTokens',
        'cacheReadTokens',
        'cacheCreationTokens',
        'costMicros',
        'model',
        'tokensSource',
      ] as const) {
        expect(ausChat[feld], `Feld ${feld}`).toEqual(ausPhase[feld]);
      }
      expect(ausChat.tokensSource).toBe('telemetry');
      expect(ausChat.tokens).toBe(7_175_597);
      expect(ausChat.costMicros).toBe(5_350_524);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Der Fall vom 28.07.2026: 7,0 Mio. Cache-Lese-Tokens, verbucht als 94k und 0 $. */
  it('verbucht den Fall vom 28.07.2026 vollständig und mit Preis (SC-003)', () => {
    vi.useFakeTimers();
    try {
      const chat = bauen({ events: [ereignis()] });
      const session = liveSession();
      vi.setSystemTime(1_000);
      chat.meter.openTurn(session);
      vi.setSystemTime(10_000);
      chat.meter.closeTurn(session, { projectId: 'p1', featureId: null, kind: 'chat_work' });

      const usage = chat.finishWithUsage.mock.calls[0]![2] as ExecutionUsageInput;
      expect(usage.tokens).toBe(7_175_597);
      expect(usage.costMicros!).toBeGreaterThan(0);
      expect(usage.model).toBe('claude-opus-5');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gibt die Messung an den Aufrufer zurück — der Chat hängt seine Hygiene daran', () => {
    vi.useFakeTimers();
    try {
      const chat = bauen({ events: [ereignis()] });
      const session = liveSession();
      vi.setSystemTime(1_000);
      chat.meter.openTurn(session);
      vi.setSystemTime(10_000);
      const usage = chat.meter.closeTurn(session, { projectId: 'p1', featureId: null, kind: 'chat_work' });

      expect(usage?.cacheReadTokens).toBe(7_016_059);
      expect(usage?.costMicros).toBe(5_350_524);
    } finally {
      vi.useRealTimers();
    }
  });

  it('liefert null, wenn der Turn nichts hergab — „nichts messbar" ist keine Nullmessung', () => {
    const { meter } = bauen({ events: [] });
    const session = liveSession({ scrollback: '', claudeSessionId: null });

    meter.openTurn(session);
    expect(meter.closeTurn(session, { projectId: 'p1', featureId: null, kind: 'chat_work' })).toBeNull();
  });
});

// ---------- SC-004: die Zahl sinkt nie ----------

describe('RunMeter — Monotonie über beliebig viele Nachträge (SC-004)', () => {
  const klein = (id: string, at: number) =>
    ereignis({
      requestId: id,
      at,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      costMicros: 500,
    });

  it('zählt über eine Reihe mit beschnittenem Puffer 0 Absenkungen', () => {
    const events: unknown[] = [klein('a', 2_000)];
    const { meter } = bauen({ events });
    const messen = () =>
      (
        meter as unknown as {
          measureFromTelemetry(s: unknown, m: unknown, u: number): ExecutionUsageInput | null;
        }
      ).measureFromTelemetry(liveSession(), phasenMarke(), 20_000);

    const reihe: number[] = [];
    reihe.push(messen()!.tokens!);

    events.push(klein('b', 3_000));
    reihe.push(messen()!.tokens!);

    events.length = 0; // Kehraus hat den Puffer beschnitten
    reihe.push(messen()!.tokens!);
    reihe.push(messen()!.tokens!);

    events.push(klein('c', 4_000)); // späte Meldung trifft doch noch ein
    reihe.push(messen()!.tokens!);

    const absenkungen = reihe.filter((wert, i) => i > 0 && wert < reihe[i - 1]!).length;
    expect(absenkungen).toBe(0);
    expect(reihe).toEqual([100, 200, 200, 200, 300]);
  });

  /**
   * Sperre gegen verschlechternde Nachträge: die verbuchte Zahl bleibt stehen, der
   * Grund steht im Protokoll UND — bei grobem Widerspruch — in der Inbox (FR-010 der
   * Plausibilitätsprüfung). Beides gilt ab jetzt auch für einen Chat-Turn.
   */
  it('lässt die verbuchte Zahl stehen und meldet den Widerspruch (M5)', () => {
    vi.useFakeTimers();
    try {
      const reportMeteringConflict = vi.fn();
      const events: unknown[] = [klein('a', 2_000)];
      const { meter, updateTelemetry } = bauen({
        events,
        plausibility: { reportMeteringConflict, check: vi.fn() } as unknown as PlausibilityService,
      });
      updateTelemetry.mockReturnValue({ applied: false, reason: 'weniger Tokens' });
      const warnung = vi.spyOn(console, 'warn').mockImplementation(() => {});

      meter.finish(liveSession({ featureId: 'f1' }), phasenMarke(), 0);
      vi.advanceTimersByTime(8_000);

      expect(updateTelemetry).toHaveBeenCalled();
      expect(warnung.mock.calls.flat().join(' ')).toContain('Nachtrag verworfen');
      expect(reportMeteringConflict).toHaveBeenCalledWith(
        { id: 'e1', projectId: 'p1', featureId: 'f1' },
        expect.objectContaining({ applied: false }),
      );
      warnung.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('beurteilt am Ende des Nachlauffensters — als LETZTE Anweisung, in eigenem try/catch', () => {
    vi.useFakeTimers();
    try {
      const check = vi.fn(() => {
        throw new Error('Beurteilung kaputt');
      });
      const { meter, telemetry } = bauen({
        events: [],
        plausibility: { reportMeteringConflict: vi.fn(), check } as unknown as PlausibilityService,
      });
      const warnung = vi.spyOn(console, 'warn').mockImplementation(() => {});

      meter.hold('sess1');
      meter.finish(liveSession(), phasenMarke(), 0);
      vi.advanceTimersByTime(5 * 60_000);

      expect(check).toHaveBeenCalled();
      // Ein Fehler der Beurteilung darf nichts reissen — Freigabe ist vorher passiert.
      expect(telemetry!.release).toHaveBeenCalledWith('sess1');
      warnung.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------- FR-009: Nachtrag zieht die Ansicht nach ----------

describe('RunMeter — Nachtrag nach dem Abschluss (US1 Szenario 3)', () => {
  it('trägt verspätete Meldungen nach und meldet die Ansicht nach (M6)', () => {
    vi.useFakeTimers();
    const gesehen: { executionId: string; featureId: string | null }[] = [];
    const horcher = (p: { executionId: string; featureId: string | null }) => gesehen.push(p);
    bus.onEvent('execution_updated', horcher);
    try {
      const events: unknown[] = []; // beim Abschluss liegt noch nichts vor
      const { meter, updateTelemetry } = bauen({ events });
      const session = liveSession({ featureId: null });

      meter.finish(session, phasenMarke({ executionId: 'e-spaet' }), 0);

      // Die Meldung trifft erst nach dem Abschluss ein — das Fenster ist noch offen.
      events.push(
        ereignis({
          requestId: 'spaet',
          at: 1_500,
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheCreationTokens: 4,
          costMicros: 99,
        }),
      );
      vi.advanceTimersByTime(8_000);

      expect(updateTelemetry).toHaveBeenCalledTimes(1);
      const nachtrag = updateTelemetry.mock.calls[0]![1] as unknown as ExecutionUsageInput;
      expect(nachtrag.tokensSource).toBe('telemetry');
      expect(nachtrag.tokens).toBe(10);
      expect(gesehen).toContainEqual({ executionId: 'e-spaet', featureId: null });
    } finally {
      bus.off('execution_updated', horcher);
      vi.useRealTimers();
    }
  });

  it('gibt am Ende des Nachlauffensters frei statt zu löschen (M3, FR-007a)', () => {
    vi.useFakeTimers();
    try {
      const { meter, telemetry } = bauen({ events: [] });
      meter.hold('sess1');
      meter.finish(liveSession(), phasenMarke(), 0);

      vi.advanceTimersByTime(5 * 60_000);

      expect(telemetry!.release).toHaveBeenCalledWith('sess1');
      expect(telemetry!.forget).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------- Das Turn-Fenster des Chats ----------

describe('RunMeter — Turn-Fenster (openTurn / closeTurn / abandon)', () => {
  it('öffnet bei einem zweiten working-Übergang kein zweites Fenster (idempotent)', () => {
    vi.useFakeTimers();
    try {
      const { meter, telemetry, executions } = bauen({ events: [ereignis()] });
      const session = liveSession();

      vi.setSystemTime(1_000);
      meter.openTurn(session);
      vi.setSystemTime(4_000); // Berechtigungs-Rückfrage mitten im Turn → erneut working
      meter.openTurn(session);
      vi.setSystemTime(9_000);
      meter.closeTurn(session, { projectId: 'p1', featureId: null, kind: 'chat_work' });

      expect(telemetry!.hold).toHaveBeenCalledTimes(1);
      const start = (executions.start as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
        startedAt: number;
      };
      expect(start.startedAt).toBe(1_000); // das ERSTE Fenster, nicht das zweite
    } finally {
      vi.useRealTimers();
    }
  });

  it('legt den Lauf mit dem Beginn des Fensters an — die Dauer wird echt (M10)', () => {
    const db: DB = openMemoryDatabase();
    try {
      const executions = new ExecutionRepo(db);
      const projectId = new ProjectRepo(db).create({
        name: 'Demo', path: '/tmp/demo', defaultBranch: 'main', color: null, enabledPhases: [],
        verifyCommands: [], automation: {}, mergeMode: 'ff', editorCmd: null, integrationMode: 'local',
      }).id;
      const telemetry = {
        // Echte Uhr: die Meldung muss in das Fenster dieses Turns fallen.
        eventsFor: () => [{ ...ereignis(), at: Date.now() }],
        hold: vi.fn(),
        release: vi.fn(),
        forget: vi.fn(),
      } as unknown as TelemetryStore;
      const meter = new RunMeter({ executions, telemetry });
      const session = liveSession();

      const t0 = Date.now();
      meter.openTurn(session);
      // Der Turn dauert; ohne mitgegebenen Beginn wäre started_at == finished_at.
      const bis = t0 + 25;
      while (Date.now() < bis) { /* Turn läuft */ }
      meter.closeTurn(session, { projectId, featureId: null, kind: 'chat_work' });

      const [lauf] = executions.listAll();
      expect(lauf!.kind).toBe('chat_work');
      expect(lauf!.finishedAt! - lauf!.startedAt).toBeGreaterThan(0);
      expect(lauf!.tokensSource).toBe('telemetry');
    } finally {
      db.close();
    }
  });

  it('öffnet rückwirkend, wenn kein working-Übergang gesehen wurde — nie 0, nie negativ (D4)', () => {
    vi.useFakeTimers();
    try {
      const { meter, executions } = bauen({ events: [ereignis()] });
      const session = liveSession({ startedAt: 2_000 });

      vi.setSystemTime(9_000);
      meter.closeTurn(session, { projectId: 'p1', featureId: null, kind: 'chat_work' });

      const start = (executions.start as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
        startedAt: number;
      };
      expect(start.startedAt).toBe(2_000); // session.startedAt, nicht „jetzt"
      expect(Date.now() - start.startedAt).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('nimmt beim zweiten Turn ohne Fenster das Ende des Vorgängerturns (D4)', () => {
    vi.useFakeTimers();
    try {
      // Ohne Meldungen und ohne Transkript trägt die Ausgabe den Turn — es geht hier
      // allein um die Wahl der Startmarke.
      const { meter, executions } = bauen({ events: [] });
      const session = liveSession({ startedAt: 2_000, claudeSessionId: null, scrollback: 'Antwort.' });

      vi.setSystemTime(9_000);
      meter.closeTurn(session, { projectId: 'p1', featureId: null, kind: 'chat_work' });
      vi.setSystemTime(20_000);
      (session as { scrollback: string }).scrollback += 'Zweite Antwort.'; // der Agent hat wieder gearbeitet
      meter.closeTurn(session, { projectId: 'p1', featureId: null, kind: 'chat_work' });

      const zweiter = (executions.start as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![0] as {
        startedAt: number;
      };
      expect(zweiter.startedAt).toBe(9_000); // Ende des Vorgängerturns
    } finally {
      vi.useRealTimers();
    }
  });

  it('verbucht bei abandon nichts und gibt den Puffer frei (M9, Leerlauf-Reaper)', () => {
    const { meter, telemetry, executions, finishWithUsage } = bauen({ events: [ereignis()] });
    const session = liveSession();

    meter.openTurn(session);
    meter.abandon(session.id);

    expect(executions.start).not.toHaveBeenCalled();
    expect(finishWithUsage).not.toHaveBeenCalled();
    expect(telemetry!.release).toHaveBeenCalledWith('sess1');
  });

  it('gibt bei abandon ohne offenes Fenster nichts frei — sonst verlöre ein fremder Lauf seinen Schutz', () => {
    const { meter, telemetry } = bauen({ events: [] });

    meter.abandon('sess1');

    expect(telemetry!.release).not.toHaveBeenCalled();
  });

  it('legt für einen Turn ohne jede Ausgabe keinen Lauf an (heutiges Verhalten)', () => {
    const { meter, executions } = bauen({ events: [] }); // kein Ereignis, kein Transkript, kein Scrollback
    const session = liveSession({ scrollback: '', claudeSessionId: null });

    meter.openTurn(session);
    meter.closeTurn(session, { projectId: 'p1', featureId: null, kind: 'chat_work' });

    expect(executions.start).not.toHaveBeenCalled();
  });
});

describe('markSession', () => {
  it('fotografiert Scrollback-Länge und Transkript-Stand', () => {
    transkript.pfad = '/t/uuid-1.jsonl';
    transkript.groesse = 4_096;

    const mark = markSession(liveSession({ scrollback: 'abcde' }), 7_000);

    expect(mark.startedAt).toBe(7_000);
    expect(mark.scrollbackStart).toBe(5);
    expect(mark.transcriptPathStart).toBe('/t/uuid-1.jsonl');
    expect(mark.transcriptOffsetStart).toBe(4_096);
  });

  it('merkt sich „Datei beim Start unbekannt" als null statt als Offset 0', () => {
    const mark = markSession(liveSession({ claudeSessionId: null }), 7_000);

    expect(mark.transcriptPathStart).toBeNull();
    expect(mark.transcriptOffsetStart).toBe(0);
  });
});
