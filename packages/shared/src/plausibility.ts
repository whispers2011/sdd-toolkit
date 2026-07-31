/**
 * Plausibilitätsprüfung gemessener Läufe (Feature "plausibilitaetspruefung").
 *
 * Vier Regeln über BEREITS GESPEICHERTE Daten — Schwellen, Prädikate, die
 * Melde-Entscheidung und die Meldungstexte. Nur beurteilen, nie eingreifen:
 * nichts hier verändert einen Lauf, ein Feature oder ein Projekt.
 *
 * | Befund | Frage | Bezugsobjekt |
 * |---|---|---|
 * | A | Tokens gezählt, aber kein Betrag?          | Projekt |
 * | B | Fehlstart statt inhaltlichem Fehlschlag?   | Feature |
 * | C | Features, aber nie ein Phasenlauf?         | Projekt |
 * | D | Nachkorrektur verworfen, weil sie senkt?   | Feature |
 *
 * KEIN IO, KEINE Datenbank, KEIN `node:`-Import — alles hier ist über
 * plausibility.test.ts ohne Aufbau prüfbar (dasselbe Muster wie workflowModel.ts
 * und lifecycleCatalog.ts). Die Verdrahtung liegt im PlausibilityService
 * (@sdd/server), der SQL-Zugriff im PlausibilityRepo.
 *
 * Das Endgültigkeitsfenster steht bewusst NICHT hier: `TELEMETRY_GRACE_MS`
 * gehört dem Server und wird als Parameter `graceMs` übergeben. Zwei Fenster
 * könnten auseinanderlaufen.
 */
import type { ExecutionRecord } from './types.js';

/** Laufzeit unter dieser Grenze + Exitcode ≠ 0 = Fehlstart. AUSSCHLIESSEND: genau 6000 meldet nicht. */
export const FALSE_START_MAX_MS = 6_000;

/** Karenzzeit nach Anlage des jüngsten Features, bevor „Projekt ohne Lauf" melden darf. */
export const PROJECT_WITHOUT_RUNS_GRACE_MS = 60 * 60_000;

/** Ab diesem Faktor wird eine verworfene Nachkorrektur gemeldet statt nur protokolliert. */
export const METERING_CONFLICT_MIN_FACTOR = 2;

/**
 * Signal-Exitcodes: SIGINT (130), SIGKILL (137), SIGTERM (143) — Abbruch auf
 * Anforderung, kein Fehlstart. Es gibt keine persistierte Abbruch-Markierung;
 * der Exitcode ist die Information, die bereits da ist.
 */
export const TERMINATION_EXIT_CODES: readonly number[] = [130, 137, 143];

/** Aggregat je Projekt für Befund C. Hier definiert, damit das Prädikat pur bleibt. */
export interface ProjectRunStats {
  projectId: string;
  /** Features mit `archived_at IS NULL`. */
  activeFeatures: number;
  /** `MAX(created_at)` derselben Menge; null = keine nicht archivierten Features. */
  newestFeatureAt: number | null;
  /** Läufe mit `kind='phase'` am Projekt — ohne Status-Filter, ohne Join auf features. */
  phaseRuns: number;
}

/**
 * Ist die Messung dieses Laufs endgültig? Erst dann darf sie beurteilt werden (FR-001).
 *
 * Endgültigkeit ist das BESTEHENDE Nachtragsfenster, aus zwei Quellen: die
 * Zeitrechnung über `finishedAt` deckt auch den Altbestand ab (`telemetry_final_at`
 * ist dort NULL), `telemetryFinalAt` bleibt als zusätzliche Sperre wirksam.
 */
export function isMeasurementFinal(run: ExecutionRecord, now: number, graceMs: number): boolean {
  return (
    run.finishedAt !== null &&
    now - run.finishedAt >= graceMs &&
    (run.telemetryFinalAt === null || run.telemetryFinalAt <= now)
  );
}

/**
 * Befund A — der Lauf hat Tokens gezählt, aber keinen Betrag bekommen.
 *
 * `orphaned` wird übersprungen: ein verwaister Lauf hat seinen Abschlusspfad nie
 * erreicht, seine Messung war also nie endgültig. Verwaiste Läufe haben zudem
 * bereits ihre eigene Meldung beim Aufräumen zum Start.
 */
export function isUnpricedRun(run: ExecutionRecord, now: number, graceMs: number): boolean {
  return (
    run.status !== 'orphaned' &&
    (run.tokens ?? 0) > 0 &&
    run.costMicros === null &&
    isMeasurementFinal(run, now, graceMs)
  );
}

/**
 * Befund B — die Phase lief nie an, statt inhaltlich fehlzuschlagen.
 *
 * `status === 'failed'` schliesst `orphaned` und `running` aus; die
 * Laufzeitschwelle ist ausschliessend (genau 6 s meldet nicht). Der Archiv-Filter
 * gehört NICHT hierher — er ist eine Frage der Handhabbarkeit und steht im Service.
 */
export function isPhaseFalseStart(run: ExecutionRecord): boolean {
  return (
    run.kind === 'phase' &&
    run.status === 'failed' &&
    run.exitCode !== null &&
    run.exitCode !== 0 &&
    !TERMINATION_EXIT_CODES.includes(run.exitCode) &&
    run.finishedAt !== null &&
    run.finishedAt - run.startedAt < FALSE_START_MAX_MS
  );
}

/**
 * Befund C — das Projekt hat Features, aber nie einen Phasenlauf.
 *
 * Die Karenzzeit hängt am jüngsten nicht archivierten Feature: frisch angelegte
 * Features hatten noch keine Gelegenheit zu laufen (FR-009).
 */
export function isProjectWithoutRuns(stats: ProjectRunStats, now: number): boolean {
  return (
    stats.activeFeatures > 0 &&
    stats.phaseRuns === 0 &&
    stats.newestFeatureAt !== null &&
    now - stats.newestFeatureAt >= PROJECT_WITHOUT_RUNS_GRACE_MS
  );
}

/**
 * Befund D — um welchen Faktor würde die verworfene Nachkorrektur die Messung senken?
 * `Math.max(…, 1)` statt einer Division durch 0: ein Nachtrag über 0 Tokens ist real.
 */
export function meteringConflictFactor(existingTokens: number, rejectedTokens: number): number {
  return existingTokens / Math.max(rejectedTokens, 1);
}

// ---------- Melde-Entscheidung (Wasserstand) ----------

export type FindingAction = 'raise' | 'refresh' | 'suppress' | 'clear';

/**
 * Melden, nachziehen, schweigen oder Marke löschen?
 *
 * `AttentionRepo.raise()` dedupliziert nur gegen OFFENE Meldungen — eine
 * aufgelöste Meldung würde im Minutentakt neu entstehen und die Inbox nach
 * Minuten unbenutzbar machen. Deshalb der persistente Wasserstand: solange eine
 * Meldung offen ist, wird die Marke nachgezogen (`refresh`); wer auflöst,
 * quittiert damit den Stand IM MOMENT DER AUFLÖSUNG und die Meldung kehrt erst
 * bei einem NEUEN betroffenen Lauf zurück (FR-014, SC-005).
 *
 * `clear` bei offener Meldung löst diese NICHT auf: der Widerspruch war real und
 * wird von einem Menschen quittiert, nicht vom Toolkit.
 *
 * @param count       aktuell betroffene Objekte (0 = Befund liegt nicht vor)
 * @param mark        quittierter Stand aus `plausibility_state`, null = nie gemeldet
 * @param hasOpenItem offene Meldung dieses Befunds für dieses Bezugsobjekt vorhanden
 */
export function decideFinding(count: number, mark: number | null, hasOpenItem: boolean): FindingAction {
  if (count === 0) return mark === null ? 'suppress' : 'clear';
  if (hasOpenItem) return 'refresh';
  return mark === null || count > mark ? 'raise' : 'suppress';
}

// ---------- Meldungstexte ----------

const NUM = new Intl.NumberFormat('de-CH');

/** Sekunden mit einer Dezimalstelle, de-CH (Dezimalkomma). */
function sekunden(ms: number): string {
  return new Intl.NumberFormat('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ms / 1000);
}

/** Ganze Stunden, aufgerundet auf mindestens 1 — Altersangabe für Befund C. */
function stunden(ms: number): string {
  return NUM.format(Math.max(1, Math.floor(ms / 3_600_000)));
}

/** Auffälligster Lauf eines Befund-A-Bündels: der mit der grössten Tokenzahl. */
export interface UnpricedExample {
  /** null bei Läufen ohne Feature (z. B. `chat_work`) — dann nennt der Text die Lauf-Art. */
  featureName: string | null;
  phase: string | null;
  kind: string;
  tokens: number;
}

/** Auffälligster Lauf eines Befund-B-Bündels: der kürzeste, plus die Spanne. */
export interface FalseStartExample {
  phase: string | null;
  minMs: number;
  maxMs: number;
  exitCode: number;
}

/** Befund A: Verbrauch ohne Preis. Nennt Anzahl und ein konkretes Beispiel (FR-015). */
export function unpricedMessage(count: number, ex: UnpricedExample): string {
  const beispiel =
    ex.featureName === null
      ? `ein Lauf der Art ${ex.kind} mit ${NUM.format(ex.tokens)} Tokens`
      : `${ex.phase ?? ex.kind} in „${ex.featureName}" mit ${NUM.format(ex.tokens)} Tokens`;
  return (
    `Verbrauch ohne Preis: ${NUM.format(count)} abgeschlossene ${count === 1 ? 'Lauf hat' : 'Läufe haben'} ` +
    `Tokens gezählt, aber keinen Betrag — z.B. ${beispiel}. ` +
    `Der Preis dieser Läufe ist unbekannt und nicht nachträglich berechenbar.`
  );
}

/** Befund B: Fehlstart. Nennt den Befund wörtlich und sagt, dass die Phase nie anlief (FR-006). */
export function falseStartMessage(count: number, featureName: string, ex: FalseStartExample): string {
  const spanne = ex.minMs === ex.maxMs ? `${sekunden(ex.minMs)} s` : `${sekunden(ex.minMs)}–${sekunden(ex.maxMs)} s`;
  return (
    `Fehlstart: ${NUM.format(count)} ${count === 1 ? 'Phasenlauf' : 'Phasenläufe'} von „${featureName}" ` +
    `${count === 1 ? 'endete' : 'endeten'} nach ${spanne} mit Exitcode ${ex.exitCode}` +
    `${ex.phase ? ` (zuletzt ${ex.phase})` : ''} — die Phase lief nie an, das ist kein inhaltlicher Fehlschlag.`
  );
}

/** Befund C: Projekt mit Features, aber ohne einen einzigen Phasenlauf. */
export function projectWithoutRunsMessage(projectName: string, activeFeatures: number, ageMs: number): string {
  return (
    `Projekt „${projectName}": ${NUM.format(activeFeatures)} nicht archivierte ` +
    `${activeFeatures === 1 ? 'Feature' : 'Features'}, aber nie ein Phasenlauf. ` +
    `Jüngstes Feature vor ${stunden(ageMs)} Stunden angelegt.`
  );
}

/** Befund D: verworfene Nachkorrektur. Die Lauf-ID ist hier die Fundstelle. */
export function meteringConflictMessage(
  runId: string,
  existingTokens: number,
  rejectedTokens: number,
  factor: number,
): string {
  const f = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(factor);
  return (
    `Messung widersprüchlich: Nachtrag für Lauf ${runId} verworfen — ` +
    `${NUM.format(existingTokens)} Tokens vorhanden, ${NUM.format(rejectedTokens)} nachgetragen (Faktor ${f}). ` +
    `Die bestehende Zahl bleibt stehen; einer der beiden Messwege ist falsch.`
  );
}
