import { describe, expect, it } from 'vitest';
import {
  FALSE_START_MAX_MS,
  PROJECT_WITHOUT_RUNS_GRACE_MS,
  decideFinding,
  falseStartMessage,
  isPhaseFalseStart,
  isProjectWithoutRuns,
  isUnpricedRun,
  meteringConflictFactor,
  meteringConflictMessage,
  projectWithoutRunsMessage,
  unpricedMessage,
  type ProjectRunStats,
} from './plausibility.js';
import type { ExecutionRecord } from './types.js';

const GRACE = 5 * 60_000;
const NOW = 10_000_000;

/**
 * Erwartungen an formatierte Zahlen werden AUS dem Formatierer abgeleitet, nicht
 * als Zeichenkette hingeschrieben: `de-CH` trennt Tausender mit U+2019 (’) und
 * nutzt den Punkt als Dezimaltrenner. Ein hart notiertes `62'377'448` oder `2,4`
 * würde eine ICU-Eigenheit einfrieren statt die Zusage zu prüfen (plan.md,
 * Risiko „Meldungstexte sind nicht testbar").
 */
const zahl = (n: number) => new Intl.NumberFormat('de-CH').format(n);
const sek = (ms: number) =>
  new Intl.NumberFormat('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ms / 1000);

/** Abgeschlossener Lauf, dessen Messung endgültig ist — der unauffällige Normalfall. */
function run(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'e1',
    projectId: 'p1',
    featureId: 'f1',
    kind: 'phase',
    phase: 'implement',
    status: 'succeeded',
    startedAt: NOW - 3_600_000,
    finishedAt: NOW - GRACE,
    exitCode: 0,
    tokens: 1000,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    tokensSource: 'telemetry',
    costMicros: 42_000,
    subagentTokens: null,
    subagentCostMicros: null,
    model: null,
    telemetryFinalAt: null,
    transcriptOffsetStart: null,
    transcriptOffsetEnd: null,
    transcriptPath: null,
    optContextStrategy: null,
    optCompression: null,
    logPath: null,
    ...over,
  };
}

// ---------- Befund A: gemessen, aber nicht bepreist (T012) ----------

describe('isUnpricedRun — Befund A', () => {
  it('erkennt einen abgeschlossenen Lauf mit Tokens ohne Betrag (US1-1)', () => {
    expect(isUnpricedRun(run({ tokens: 62_377_448, costMicros: null }), NOW, GRACE)).toBe(true);
  });

  it('schweigt, wenn ein Betrag vorhanden ist (FR-005, US1-2)', () => {
    expect(isUnpricedRun(run({ tokens: 62_377_448, costMicros: 3_800_000 }), NOW, GRACE)).toBe(false);
  });

  it('schweigt bei 0 Tokens (FR-005, US1-3)', () => {
    expect(isUnpricedRun(run({ tokens: 0, costMicros: null }), NOW, GRACE)).toBe(false);
  });

  it('schweigt bei tokens === null (FR-005, US1-3)', () => {
    expect(isUnpricedRun(run({ tokens: null, costMicros: null }), NOW, GRACE)).toBe(false);
  });

  it('schweigt, solange das Nachtragsfenster noch offen ist (FR-005, US1-4)', () => {
    expect(isUnpricedRun(run({ costMicros: null, finishedAt: NOW - 60_000 }), NOW, GRACE)).toBe(false);
  });

  it('meldet genau am Ende des Nachtragsfensters (Grenze einschliessend)', () => {
    expect(isUnpricedRun(run({ costMicros: null, finishedAt: NOW - GRACE }), NOW, GRACE)).toBe(true);
  });

  it('schweigt bei einem noch laufenden Lauf (finishedAt null)', () => {
    expect(isUnpricedRun(run({ costMicros: null, finishedAt: null, status: 'running' }), NOW, GRACE)).toBe(false);
  });

  it('schweigt bei status "orphaned" — der Abschlusspfad wurde nie erreicht (research.md D8)', () => {
    expect(isUnpricedRun(run({ costMicros: null, status: 'orphaned' }), NOW, GRACE)).toBe(false);
  });

  it('schweigt, solange telemetryFinalAt in der Zukunft liegt (zusätzliche Sperre)', () => {
    expect(isUnpricedRun(run({ costMicros: null, telemetryFinalAt: NOW + 1 }), NOW, GRACE)).toBe(false);
  });

  it('meldet einen fehlgeschlagenen Lauf ohne Betrag — der Status spielt bei A keine Rolle', () => {
    expect(isUnpricedRun(run({ costMicros: null, status: 'failed', exitCode: 1 }), NOW, GRACE)).toBe(true);
  });
});

// ---------- Befund B: Fehlstart statt Fehlschlag (T013) ----------

describe('isPhaseFalseStart — Befund B', () => {
  const fehlstart = (over: Partial<ExecutionRecord> = {}) =>
    run({ status: 'failed', exitCode: 1, startedAt: NOW - 2_400, finishedAt: NOW, ...over });

  it('erkennt 2,4 s Laufzeit mit Exitcode 1 (US1-5)', () => {
    expect(isPhaseFalseStart(fehlstart())).toBe(true);
  });

  it('schweigt bei Exitcode 0 (FR-007, US1-6)', () => {
    expect(isPhaseFalseStart(fehlstart({ status: 'succeeded', exitCode: 0 }))).toBe(false);
  });

  it('schweigt bei 40 s Laufzeit — inhaltlicher Fehlschlag (FR-007, US1-7)', () => {
    expect(isPhaseFalseStart(fehlstart({ startedAt: NOW - 40_000 }))).toBe(false);
  });

  it('schweigt bei Laufzeit von GENAU 6000 ms — die Schwelle ist ausschliessend (Edge Case)', () => {
    expect(isPhaseFalseStart(fehlstart({ startedAt: NOW - FALSE_START_MAX_MS }))).toBe(false);
  });

  it('meldet bei 5999 ms — eine Millisekunde unter der Schwelle', () => {
    expect(isPhaseFalseStart(fehlstart({ startedAt: NOW - (FALSE_START_MAX_MS - 1) }))).toBe(true);
  });

  it.each([130, 137, 143])('schweigt bei Abbruch-Exitcode %i (FR-007, US1-8)', (code) => {
    expect(isPhaseFalseStart(fehlstart({ exitCode: code }))).toBe(false);
  });

  it('schweigt bei status "orphaned" (FR-007)', () => {
    expect(isPhaseFalseStart(fehlstart({ status: 'orphaned' }))).toBe(false);
  });

  it('schweigt bei exitCode null', () => {
    expect(isPhaseFalseStart(fehlstart({ exitCode: null }))).toBe(false);
  });

  it.each(['verify', 'review', 'chat', 'chat_work'] as const)('schweigt bei Lauf-Art "%s"', (kind) => {
    expect(isPhaseFalseStart(fehlstart({ kind }))).toBe(false);
  });

  it('schweigt bei finishedAt null (laufender Lauf)', () => {
    expect(isPhaseFalseStart(fehlstart({ finishedAt: null, status: 'running' }))).toBe(false);
  });
});

// ---------- Meldungstexte A und B (T014) ----------

describe('unpricedMessage', () => {
  it('nennt Anzahl und ein konkretes Beispiel mit Feature, Schritt und Tokenzahl (FR-015)', () => {
    const text = unpricedMessage(148, {
      featureName: 'lebenszyklus-schritte-sichtbar-machen',
      phase: 'implement',
      kind: 'phase',
      tokens: 62_377_448,
    });
    expect(text).toContain('148');
    expect(text).toContain('lebenszyklus-schritte-sichtbar-machen');
    expect(text).toContain('implement');
    expect(text).toContain(zahl(62_377_448));
  });

  it('nennt bei featureName null die Lauf-Art statt Feature und Schritt', () => {
    const text = unpricedMessage(3, { featureName: null, phase: null, kind: 'chat_work', tokens: 1234 });
    expect(text).toContain('chat_work');
    expect(text).toContain(zahl(1234));
    expect(text).not.toContain('„');
  });

  it('formatiert Zahlen mit Tausendertrenner nach de-CH', () => {
    const text = unpricedMessage(1000, { featureName: 'x', phase: 'plan', kind: 'phase', tokens: 5000 });
    expect(text).toContain(zahl(1000));
    expect(zahl(1000)).not.toBe('1000'); // die Zusage „getrennt" prüft sich selbst mit
  });
});

describe('falseStartMessage', () => {
  const ex = { phase: 'implement', minMs: 2_090, maxMs: 3_400, exitCode: 1 };

  it('nennt den Befund wörtlich „Fehlstart" und sagt, dass die Phase nie anlief (FR-006)', () => {
    const text = falseStartMessage(9, 'nur-sessions-aktiver-projekte-anzeigen', ex);
    expect(text).toContain('Fehlstart');
    expect(text).toContain('nie an');
  });

  it('nennt Anzahl, Feature, Laufzeitspanne in Sekunden und Exitcode (FR-015)', () => {
    const text = falseStartMessage(9, 'nur-sessions-aktiver-projekte-anzeigen', ex);
    expect(text).toContain('9');
    expect(text).toContain('nur-sessions-aktiver-projekte-anzeigen');
    expect(text).toContain(`${sek(2_090)}–${sek(3_400)} s`);
    expect(text).toContain('Exitcode 1');
  });

  it('nennt bei genau einem Lauf nur einen Wert statt einer Spanne', () => {
    const text = falseStartMessage(1, 'f', { ...ex, minMs: 2_400, maxMs: 2_400 });
    expect(text).toContain(`${sek(2_400)} s`);
    expect(text).not.toContain('–');
  });
});

// ---------- Befund C (T021) ----------

describe('isProjectWithoutRuns — Befund C', () => {
  const stats = (over: Partial<ProjectRunStats> = {}): ProjectRunStats => ({
    projectId: 'p1',
    activeFeatures: 22,
    newestFeatureAt: NOW - PROJECT_WITHOUT_RUNS_GRACE_MS,
    phaseRuns: 0,
    ...over,
  });

  it('erkennt ein Projekt mit Features, ohne Phasenlauf, nach Ablauf der Karenzzeit (US2-1)', () => {
    expect(isProjectWithoutRuns(stats(), NOW)).toBe(true);
  });

  it('schweigt ohne nicht archivierte Features (FR-009, US2-3)', () => {
    expect(isProjectWithoutRuns(stats({ activeFeatures: 0, newestFeatureAt: null }), NOW)).toBe(false);
  });

  it('schweigt, sobald mindestens ein Phasenlauf existiert (FR-009, US2-4)', () => {
    expect(isProjectWithoutRuns(stats({ phaseRuns: 1 }), NOW)).toBe(false);
  });

  it('schweigt, solange die Karenzzeit läuft (FR-009, US2-2)', () => {
    expect(isProjectWithoutRuns(stats({ newestFeatureAt: NOW - 60_000 }), NOW)).toBe(false);
  });

  it('schweigt, wenn alle Features archiviert sind — newestFeatureAt null (FR-009, US2-5)', () => {
    expect(isProjectWithoutRuns(stats({ newestFeatureAt: null }), NOW)).toBe(false);
  });

  it('meldet genau am Ende der Karenzzeit (Grenze einschliessend)', () => {
    expect(isProjectWithoutRuns(stats({ newestFeatureAt: NOW - PROJECT_WITHOUT_RUNS_GRACE_MS }), NOW)).toBe(true);
  });
});

describe('projectWithoutRunsMessage', () => {
  it('nennt Projektname, Anzahl Features und Alter des jüngsten Features', () => {
    const text = projectWithoutRunsMessage('iwf-datenkrake', 22, 29 * 3_600_000);
    expect(text).toContain('iwf-datenkrake');
    expect(text).toContain('22');
    expect(text).toContain('29');
    expect(text).toContain('nie ein Phasenlauf');
  });

  it('rundet ein Alter unter einer Stunde auf 1 statt auf 0', () => {
    expect(projectWithoutRunsMessage('p', 1, 90_000)).toContain('1 Stunden');
  });
});

// ---------- Befund D (T028) ----------

describe('meteringConflictFactor — Befund D', () => {
  it('erkennt eine Halbierung als Faktor 2 (US3-1)', () => {
    expect(meteringConflictFactor(1000, 500)).toBe(2);
  });

  it('liefert bei leicht kleinerer Zahl einen Faktor unter 2 (US3-2)', () => {
    expect(meteringConflictFactor(1000, 900)).toBeCloseTo(1.11, 2);
  });

  it('läuft bei rejectedTokens 0 nicht in eine Division durch 0', () => {
    expect(meteringConflictFactor(6_578_097, 0)).toBe(6_578_097);
    expect(Number.isFinite(meteringConflictFactor(1, 0))).toBe(true);
  });

  it('rechnet den beobachteten Fall uQ_RAMEn korrekt (6578097 → 568955 ≈ Faktor 11,6)', () => {
    expect(meteringConflictFactor(6_578_097, 568_955)).toBeCloseTo(11.6, 1);
  });
});

describe('meteringConflictMessage', () => {
  it('nennt Lauf-ID, beide Zahlen und den Faktor (FR-010)', () => {
    const text = meteringConflictMessage('uQ_RAMEn', 6_578_097, 568_955, 11.56);
    expect(text).toContain('uQ_RAMEn');
    expect(text).toContain(zahl(6_578_097));
    expect(text).toContain(zahl(568_955));
    expect(text).toContain(`Faktor ${sek(11_560)}`);
    expect(text).toContain('bleibt stehen');
  });
});

// ---------- Wasserstand: vollständige Wahrheitstabelle (T034) ----------

describe('decideFinding — Wahrheitstabelle', () => {
  it('(0, null, false) → suppress: kein Befund, keine Marke', () => {
    expect(decideFinding(0, null, false)).toBe('suppress');
  });

  it('(0, 5, false) → clear: Befund weg, Marke darf nicht dauerhaft sperren (FR-014)', () => {
    expect(decideFinding(0, 5, false)).toBe('clear');
  });

  it('(0, 5, true) → clear: Marke weg, die offene Meldung bleibt bis zum Auflösen sichtbar', () => {
    expect(decideFinding(0, 5, true)).toBe('clear');
  });

  it('(3, null, false) → raise: erstmaliger Befund (FR-004/006/008)', () => {
    expect(decideFinding(3, null, false)).toBe('raise');
  });

  it('(3, 3, true) → refresh: offene Meldung, keine zweite (FR-013, SC-004)', () => {
    expect(decideFinding(3, 3, true)).toBe('refresh');
  });

  it('(5, 3, true) → refresh: Quittierung erfasst den Stand bei Auflösung (FR-014)', () => {
    expect(decideFinding(5, 3, true)).toBe('refresh');
  });

  it('(3, 3, false) → suppress: unverändert nach Auflösung, keine Wiederkehr (SC-005)', () => {
    expect(decideFinding(3, 3, false)).toBe('suppress');
  });

  it('(2, 3, false) → suppress: geschrumpft, keine Wiederkehr (FR-014)', () => {
    expect(decideFinding(2, 3, false)).toBe('suppress');
  });

  it('(4, 3, false) → raise: ein weiterer betroffener Lauf bringt die Meldung zurück (SC-005)', () => {
    expect(decideFinding(4, 3, false)).toBe('raise');
  });
});
