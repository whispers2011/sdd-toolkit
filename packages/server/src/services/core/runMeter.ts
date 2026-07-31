import {
  hasUsage,
  meter,
  selectEventsForWindow,
  summarizeEvents,
  sumUsage,
  usageTotalTokens,
  type UsageOrigin,
  type UsageTotals,
} from '@sdd/shared';
import type { ExecutionRepo, ExecutionUsageInput } from '../../db/repos.js';
import type { LiveSession } from '../../pty/sessionManager.js';
import {
  locateTranscript,
  offsetAtTimestamp,
  readTranscriptDelta,
  transcriptSize,
} from '../../pty/transcriptWatcher.js';
import { TELEMETRY_GRACE_MS, type TelemetryStore } from '../../telemetry/telemetryStore.js';
import type { PlausibilityService } from '../plausibilityService.js';
import { bus } from '../../events.js';

/**
 * Was ein messbarer Lauf mitbringen muss — der gemeinsame Nenner von Phasenlauf und
 * Chat-Turn (FR-002). Bisher stand das nur im Phasen-Pfad, eingebettet in
 * `RunningPhase`; der Chat mass ab einem selbst geführten Byte-Offset ohne jede
 * Fallunterscheidung.
 */
export interface RunMark {
  executionId: string;
  /** Beginn des Laufs — untere Grenze des Ereignisfensters. */
  startedAt: number;
  /** Scrollback-Offset beim Start — Grundlage der Schätzung. */
  scrollbackStart: number;
  /** Transkript-Byte-Offset beim Start. */
  transcriptOffsetStart: number;
  /** Transkriptdatei beim Start; `null` = beim Start unbekannt. */
  transcriptPathStart: string | null;
  /** Eingabetext für die Schätzung (Chat: leer). */
  promptText: string;
  /** Modell für die Schätzung (Chat: gesetzt, Phase: nicht). */
  model?: string;
}

/** Offenes Turn-Fenster einer Session — die Klammer, die dem Chat bisher fehlte. */
interface OpenTurn {
  startedAt: number;
  mark: Omit<RunMark, 'executionId'>;
  /** Wurde für dieses Fenster `telemetry.hold` gezogen? Nur dann darf es freigeben. */
  held: boolean;
}

/**
 * Fortgeschriebene Telemetrie-Summe eines Laufs. `seen` verhindert Doppelzählung,
 * `total`/`byOrigin` wachsen nur — daher kann eine Messung nie kleiner werden.
 */
interface TelemetryAccum {
  seen: Set<string>;
  total: UsageTotals;
  byOrigin: Record<UsageOrigin, UsageTotals>;
  model: string | null;
}

function emptyUsageTotals(): UsageTotals {
  return { tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costMicros: null };
}

/** Zuwachs auffalten. `costMicros` bleibt null, solange nichts einen Betrag trug (FR-023). */
function addTotals(ziel: UsageTotals, zuwachs: UsageTotals): void {
  ziel.tokens += zuwachs.tokens;
  ziel.inputTokens += zuwachs.inputTokens;
  ziel.outputTokens += zuwachs.outputTokens;
  ziel.cacheReadTokens += zuwachs.cacheReadTokens;
  ziel.cacheCreationTokens += zuwachs.cacheCreationTokens;
  if (zuwachs.costMicros !== null) ziel.costMicros = (ziel.costMicros ?? 0) + zuwachs.costMicros;
}

/**
 * Startmarke einer Session fotografieren: Transkriptpfad, Byte-Offset und
 * Scrollback-Länge zum Zeitpunkt `startedAt`. `promptText` und `model` trägt der
 * Aufrufer bei — sie sind pfadspezifisch.
 */
export function markSession(session: LiveSession, startedAt: number): Omit<RunMark, 'executionId'> {
  const path = session.claudeSessionId ? locateTranscript(session.cwd, session.claudeSessionId) : null;
  return {
    startedAt,
    scrollbackStart: session.scrollback.length,
    transcriptOffsetStart: path ? transcriptSize(path) : 0,
    transcriptPathStart: path,
    promptText: '',
  };
}

/**
 * Startmarke eines Laufs in seiner Transkriptdatei. Drei Fälle, und sie sind
 * NICHT dasselbe:
 *  - gleiche Datei wie beim Start → der gemerkte Offset.
 *  - Datei wechselte während des Laufs (/clear-Reset) → die neue Datei gehört
 *    ganz diesem Lauf, ab 0 messen.
 *  - beim Start war die Datei unbekannt (Claude-Session-ID noch nicht gemeldet,
 *    typisch bei fortgesetzter Session) → sie enthält womöglich frühere Läufe.
 *    Ab 0 zu messen schrieb deren Verbrauch diesem Lauf zu (gemessen: ein
 *    2-Minuten-Lauf mit 62 Mio. Tokens / $132). Startmarke ist darum die erste
 *    Zeile, die zeitlich zu diesem Lauf gehört.
 */
export function startOffsetIn(
  path: string,
  mark: Pick<RunMark, 'transcriptPathStart' | 'transcriptOffsetStart' | 'startedAt'>,
): number {
  if (mark.transcriptPathStart === null) return offsetAtTimestamp(path, mark.startedAt);
  return path === mark.transcriptPathStart ? mark.transcriptOffsetStart : 0;
}

export interface RunMeterDeps {
  executions: ExecutionRepo;
  /** Puffer der Verbrauchsmeldungen der CLI; fehlt er, misst nur das Transkript. */
  telemetry?: TelemetryStore;
  /**
   * Beurteilung der Messung. Fehlt sie, wird nur nicht beurteilt — eine Beurteilung
   * darf nie Voraussetzung eines Laufabschlusses sein (Plausibilitätsprüfung FR-003).
   */
  plausibility?: PlausibilityService;
  /**
   * Nach einem angewandten Transkript-Nachtrag. Der Phasen-Pfad zieht damit seine
   * Log-Koordinaten nach; ein Chat-Turn hat kein solches Log.
   */
  onApplied?: (session: LiveSession, mark: RunMark, source: 'telemetry' | 'transcript') => void;
}

/**
 * Turn messen — die Aufgabe aus FR-002, ab jetzt an einer Stelle.
 *
 * Der Phasen-Pfad führt seine Lauf-Marke selbst (`launchPhase` legt den Lauf an,
 * `finish` schliesst ihn ab). Der Chat hat keinen expliziten Startpunkt; für ihn führt
 * der Meter das Turn-Fenster (`openTurn`/`closeTurn`). Beide münden auf denselben
 * Messweg, denselben Akkumulator, dasselbe Nachlauffenster und dieselbe Beurteilung.
 */
export class RunMeter {
  /** Laufende Summe je Execution, fortgeschrieben statt neu berechnet (FR-008). */
  private accums = new Map<string, TelemetryAccum>();
  /** Offenes Turn-Fenster je Session — nur der Chat-Pfad benutzt es. */
  private turns = new Map<string, OpenTurn>();
  /** Ende des Vorgängerturns je Session — Rückfallebene, wenn kein Fenster geöffnet wurde. */
  private lastTurnEnd = new Map<string, number>();
  /** Scrollback-Länge an der letzten Turn-Grenze — dieselbe Rückfallebene, andere Achse. */
  private lastTurnScrollback = new Map<string, number>();
  private timers = new Set<NodeJS.Timeout>();

  constructor(private deps: RunMeterDeps) {}

  // ---------- Phasen-Pfad: der Lauf existiert schon ----------

  /** Lauf beim Ereignispuffer anmelden; Gegenstück ist das Ende des Nachlauffensters. */
  hold(sessionId: string): void {
    this.deps.telemetry?.hold(sessionId);
  }

  /**
   * Lauf abschliessen und dabei die Quelle wählen (FR-006).
   *
   * Liegen Meldungen der CLI vor, gewinnen sie und die Transkript-Messung läuft GAR
   * NICHT erst — das Nicht-Addieren ist damit eine strukturelle Eigenschaft und keine
   * Regel, die eingehalten werden müsste. Zusätzlich bleibt der Lauf fünf Minuten
   * nachtragsfähig, weil Meldungen in Intervallen eintreffen und ein kurzer Lauf beim
   * Abschluss noch unvollständig sein kann (FR-009).
   */
  finish(
    session: LiveSession,
    mark: RunMark,
    exitCode: number,
    opts: { releaseHold?: boolean } = {},
  ): ExecutionUsageInput {
    const now = Date.now();
    const fromTelemetry = this.measureFromTelemetry(session, mark, now);

    const usage: ExecutionUsageInput = fromTelemetry
      ? { ...fromTelemetry, telemetryFinalAt: now + TELEMETRY_GRACE_MS }
      : this.measureFallback(session, mark).usage;
    this.deps.executions.finishWithUsage(mark.executionId, exitCode, usage);
    // Auch ohne Meldungen beim Abschluss kann Telemetrie noch eintreffen (kurzer Lauf,
    // Exportintervall 5 s). Der Nachtrag ersetzt die Transkript-Zahl dann vollständig.
    this.scheduleLateReconcile(session, mark, now, opts.releaseHold !== false);
    return usage;
  }

  /**
   * Verbrauch eines Laufs nach der vollen Kaskade: Meldungen vor Transkript vor
   * Schätzung. `null` nur, wenn gar nichts messbar war.
   */
  measure(session: LiveSession, mark: RunMark, until: number): ExecutionUsageInput | null {
    const fromTelemetry = this.measureFromTelemetry(session, mark, until);
    if (fromTelemetry) return fromTelemetry;
    const fallback = this.measureFallback(session, mark);
    return fallback.billable ? fallback.usage : null;
  }

  // ---------- Chat-Pfad: der Kern führt das Turn-Fenster ----------

  /**
   * Turn-Fenster öffnen — gerufen bei jedem Übergang nach `working`, idempotent.
   *
   * Der Zeitpunkt trägt drei Dinge zugleich: den Beginn des Laufs (und damit seine
   * Dauer), die untere Grenze des Ereignisfensters und die Anmeldung des Puffers.
   * Die frühere Marke „Ende des Vorgängerturns" enthielt die Lesezeit des Nutzers —
   * ein Turn von 10 Sekunden nach 5 Minuten Nachdenken hätte die Dauer 5:10 bekommen.
   */
  openTurn(session: LiveSession): void {
    if (this.turns.has(session.id)) return; // z. B. zweiter working-Übergang nach einer Rückfrage
    const startedAt = Date.now();
    this.turns.set(session.id, {
      startedAt,
      mark: markSession(session, startedAt),
      held: this.deps.telemetry !== undefined,
    });
    this.deps.telemetry?.hold(session.id);
  }

  /**
   * Turn abschliessen: Lauf anlegen (mit dem Beginn des Fensters, nicht mit „jetzt")
   * und über denselben Weg wie ein Phasenlauf verrechnen.
   *
   * Der Lauf entsteht NUR hier — es gibt zu keinem Zeitpunkt eine chat_work-Zeile im
   * Zustand `running` (Assumption der Spec: der Chat verbucht atomar).
   *
   * Der Rückgabewert ist die Messung dieses Turns (`null` = nichts messbar). Der Chat
   * gibt sie an seine Kontext-Hygiene weiter: auch „nichts messbar" ist eine Aussage
   * über den Turn und wird als solche festgehalten, nicht als Nullmessung.
   */
  closeTurn(
    session: LiveSession,
    run: { projectId: string; featureId: string | null; kind: 'chat_work' },
  ): ExecutionUsageInput | null {
    const fenster = this.turns.get(session.id) ?? this.retroactiveTurn(session);
    this.turns.delete(session.id);
    const jetzt = Date.now();
    this.lastTurnEnd.set(session.id, jetzt);
    this.lastTurnScrollback.set(session.id, session.scrollback.length);

    // Ein Turn, der nichts hergab (kein Ereignis, kein Transkript-Zuwachs, keine
    // Ausgabe), bekommt wie bisher keine Lauf-Zeile — sonst füllte sich die
    // Läufe-Ansicht mit Null-Einträgen für Turns, die es gar nicht gab.
    if (!this.hasSomethingToBill(session, fenster, jetzt)) {
      if (fenster.held) this.deps.telemetry?.release(session.id);
      return null;
    }

    const executionId = this.deps.executions.start({
      projectId: run.projectId,
      featureId: run.featureId,
      kind: run.kind,
      phase: null,
      logPath: null,
      startedAt: fenster.startedAt,
    });
    return this.finish(session, { ...fenster.mark, executionId }, 0, { releaseHold: fenster.held });
  }

  // ---------- beide ----------

  /**
   * Session endet: ein offenes Turn-Fenster verwerfen und den Puffer freigeben —
   * ohne eine halbe Messung zu verbuchen (Edge Case Leerlauf-Reaper).
   */
  abandon(sessionId: string): void {
    const fenster = this.turns.get(sessionId);
    this.turns.delete(sessionId);
    this.lastTurnEnd.delete(sessionId);
    this.lastTurnScrollback.delete(sessionId);
    if (fenster?.held) this.deps.telemetry?.release(sessionId);
  }

  /** Akkumulator eines Laufs verwerfen. */
  dispose(executionId: string): void {
    this.accums.delete(executionId);
  }

  // ---------- Messung ----------

  /**
   * Verbrauch eines Laufs aus den Meldungen der CLI. Vorrangige Quelle: jede Meldung
   * trägt ihren eigenen Zeitstempel und die Marke ihrer Session, also gehört genau das
   * zum Lauf, was zwischen seinem Start und seinem Ende gemeldet wurde. Damit entfällt
   * die aus Byte-Positionen rekonstruierte Startmarke — die Quelle des Zwei-Minuten-Laufs
   * mit 62 Mio. Tokens.
   *
   * Fortschreiben statt neu summieren: nur noch nicht verrechnete Meldungen kommen
   * hinzu (über `seen`). Damit ist die Zahl monoton — ein Nachtrag, der einen
   * inzwischen beschnittenen Puffer sieht, ändert nichts mehr.
   *
   * Liefert `null`, wenn keine Meldungen vorliegen; dann greift die Rückfallebene.
   */
  private measureFromTelemetry(
    session: LiveSession,
    mark: RunMark,
    until: number,
  ): ExecutionUsageInput | null {
    const store = this.deps.telemetry;
    if (!store) return null;

    const accum = this.accumFor(mark.executionId);
    const neu = selectEventsForWindow(
      store.eventsFor(session.id),
      { from: mark.startedAt, to: until },
      accum.seen,
    );
    for (const e of neu) accum.seen.add(e.requestId);
    if (neu.length > 0) {
      const zuwachs = summarizeEvents(neu);
      addTotals(accum.total, zuwachs.total);
      for (const origin of ['main', 'subagent', 'auxiliary'] as const) {
        addTotals(accum.byOrigin[origin], zuwachs.byOrigin[origin]);
      }
      if (zuwachs.model) accum.model = zuwachs.model;
    }
    if (accum.seen.size === 0) return null;

    const { total, byOrigin, model } = accum;
    const hasSubagents = byOrigin.subagent.tokens > 0;
    return {
      tokens: total.tokens,
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      cacheReadTokens: total.cacheReadTokens,
      cacheCreationTokens: total.cacheCreationTokens,
      tokensSource: 'telemetry' as const,
      costMicros: total.costMicros,
      // null statt 0: ohne Subagenten soll die Ansicht gar nichts zeigen, keine
      // Null-Zeile (FR-010, US2 Szenario 3).
      subagentTokens: hasSubagents ? byOrigin.subagent.tokens : null,
      subagentCostMicros: hasSubagents ? byOrigin.subagent.costMicros : null,
      model,
    };
  }

  /**
   * Rückfallebene: autoritative Usage aus dem Transkript-Delta (inkl. cache_read =
   * akkumulierter Kontext), sonst Schätzung aus dem Scrollback.
   *
   * `billable` beantwortet die Frage, die nur der Chat stellt: Hat dieser Turn
   * überhaupt etwas hergegeben? Eine Schätzung ohne jede Ausgabe ist keine Messung,
   * sondern ein Turn, den es nicht gab.
   */
  private measureFallback(
    session: LiveSession,
    mark: RunMark,
  ): { usage: ExecutionUsageInput; billable: boolean } {
    if (session.claudeSessionId) {
      const path = locateTranscript(session.cwd, session.claudeSessionId);
      if (path) {
        const usage = sumUsage(readTranscriptDelta(path, startOffsetIn(path, mark)));
        if (hasUsage(usage)) {
          return {
            billable: true,
            usage: {
              tokens: usageTotalTokens(usage),
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheCreationTokens: usage.cacheCreationTokens,
              tokensSource: 'transcript' as const,
            },
          };
        }
      }
    }
    const outputText = session.scrollback.slice(mark.scrollbackStart);
    const cost = meter({
      ...(mark.model ? { model: mark.model } : {}),
      promptText: mark.promptText,
      outputText,
    });
    return {
      billable: outputText.trim().length > 0,
      usage: {
        tokens: cost.totalTokens,
        tokensSource: (cost.source === 'parsed' ? 'parsed' : 'estimated') as 'parsed' | 'estimated',
      },
    };
  }

  /** Gibt dieser Turn überhaupt etwas her? Ohne das legt der Chat keinen Lauf an. */
  private hasSomethingToBill(session: LiveSession, fenster: OpenTurn, until: number): boolean {
    const store = this.deps.telemetry;
    if (store) {
      const events = selectEventsForWindow(store.eventsFor(session.id), {
        from: fenster.startedAt,
        to: until,
      });
      if (events.length > 0) return true;
    }
    return this.measureFallback(session, { ...fenster.mark, executionId: '' }).billable;
  }

  /**
   * Kein Fenster geöffnet (kein `working`-Übergang gesehen — praktisch nur denkbar,
   * wenn Hooks und Transkript beide ausfallen): rückwirkend mit dem Ende des
   * Vorgängerturns öffnen, ersatzweise mit dem Sessionstart. Damit ist eine Turn-Dauer
   * nie 0 und nie negativ. Ohne Fenster wurde auch nichts angemeldet (`held: false`) —
   * sonst entzöge das Fensterende einem gleichzeitig laufenden Turn den Schutz.
   *
   * Die Scrollback-Marke muss dieselbe Rückfallebene nehmen: `markSession` fotografiert
   * die AKTUELLE Länge, und die schliesst rückwirkend geöffnet die Ausgabe dieses Turns
   * bereits ein — das Delta wäre immer leer und der Turn scheinbar ohne Inhalt.
   */
  private retroactiveTurn(session: LiveSession): OpenTurn {
    const startedAt = this.lastTurnEnd.get(session.id) ?? session.startedAt ?? Date.now();
    return {
      startedAt,
      mark: {
        ...markSession(session, startedAt),
        scrollbackStart: this.lastTurnScrollback.get(session.id) ?? 0,
      },
      held: false,
    };
  }

  private accumFor(executionId: string): TelemetryAccum {
    let a = this.accums.get(executionId);
    if (!a) {
      a = {
        seen: new Set<string>(),
        total: emptyUsageTotals(),
        byOrigin: { main: emptyUsageTotals(), subagent: emptyUsageTotals(), auxiliary: emptyUsageTotals() },
        model: null,
      };
      this.accums.set(executionId, a);
    }
    return a;
  }

  // ---------- Nachtrag ----------

  /**
   * Nachtrag verspäteter Zahlen (FR-009): Bis zum Ablauf des Nachlauffensters wird der
   * Lauf neu verrechnet und die Ansicht über den Bus aktualisiert. Danach gilt seine
   * Zahl als endgültig und spätere Meldungen verfallen.
   *
   * Gilt AUCH für die Transkript-Rückfallebene: Claude Code schreibt die Schlusszeilen
   * eines Turns samt `usage` erst NACH dem Stop-Hook. Der beim Abschluss fotografierte
   * End-Offset schnitt sie deshalb systematisch ab — gemessen am 27.07.2026 fehlten so
   * 7,3 % (specify) bzw. 29,9 % (clarify) des Phasenverbrauchs, jeweils exakt die
   * letzte Nachricht.
   */
  private scheduleLateReconcile(
    session: LiveSession,
    mark: RunMark,
    finishedAt: number,
    releaseHold: boolean,
  ): void {
    const attempt = (delay: number, last: boolean) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        try {
          const usage = this.measureFromTelemetry(session, mark, finishedAt);
          if (usage) {
            this.applyLate(session, mark, usage, 'telemetry');
          } else {
            this.reconcileTranscriptTail(session, mark);
          }
        } catch (err) {
          console.warn('[metering] Nachtrag fehlgeschlagen:', (err as Error).message);
        }
        if (last) {
          // Nachlauffenster zu: Puffer abmelden (NICHT verwerfen — er gehört der
          // Session, auf der ein weiterer Lauf offen sein kann), Akkumulator weg.
          if (releaseHold) this.deps.telemetry?.release(session.id);
          this.accums.delete(mark.executionId);
          // Genau hier ist die Messung endgültig — der Moment, in dem sie beurteilt
          // werden darf. LETZTE Anweisung des Timer-Rumpfes, in eigenem try/catch:
          // die Beurteilung ist kein Tor, sie kann nichts mehr beeinflussen, was davor
          // passiert ist (Plausibilitätsprüfung FR-003, SC-006).
          try {
            this.deps.plausibility?.check();
          } catch (err) {
            console.warn('[plausibility] Beurteilung nach Laufabschluss fehlgeschlagen:', (err as Error).message);
          }
        }
      }, delay);
      timer.unref?.();
      this.timers.add(timer);
    };

    // Zweimal nachfassen: einmal kurz nach dem üblichen Exportintervall (5 s) für den
    // Regelfall, einmal am Ende des Nachlauffensters als Sicherheitsnetz.
    attempt(8_000, false);
    attempt(TELEMETRY_GRACE_MS, true);
  }

  /**
   * Transkript nach Ablauf der Frist erneut vermessen und die Zahl nachziehen, falls
   * die Datei seit dem Abschluss gewachsen ist. Nur relevant ohne Telemetrie — liegen
   * Meldungen vor, ersetzen sie die Transkript-Zahl ohnehin vollständig.
   */
  private reconcileTranscriptTail(session: LiveSession, mark: RunMark): void {
    const { usage } = this.measureFallback(session, mark);
    if (usage.tokensSource !== 'transcript') return; // Schätzung nicht nachziehen
    this.applyLate(session, mark, usage, 'transcript');
  }

  /**
   * Nachtrag anwenden; eine Ablehnung lässt die verbuchte Zahl stehen (FR-008).
   *
   * Ein grober Widerspruch gehört nicht nur ins Protokoll, sondern in die Inbox: der
   * `console.warn` bleibt, die Meldung kommt dazu (Plausibilitätsprüfung FR-010).
   */
  private applyLate(
    session: LiveSession,
    mark: RunMark,
    usage: ExecutionUsageInput,
    source: 'telemetry' | 'transcript',
  ): void {
    const outcome = this.deps.executions.updateTelemetry(mark.executionId, usage);
    if (!outcome.applied) {
      // Typischer Transkript-Fall: der Puffer war leer, also fiel die Messung aufs
      // Transkript zurück — mehr Tokens, aber ohne Preis. Die bepreiste Zahl bleibt.
      const was = source === 'telemetry' ? 'Nachtrag' : 'Transkript-Nachtrag';
      console.warn(`[metering] ${mark.executionId}: ${was} verworfen — ${outcome.reason}`);
      this.deps.plausibility?.reportMeteringConflict(
        { id: mark.executionId, projectId: session.projectId, featureId: session.featureId },
        outcome,
      );
      return;
    }
    this.deps.onApplied?.(session, mark, source);
    bus.emitEvent('execution_updated', {
      executionId: mark.executionId,
      featureId: session.featureId,
    });
  }
}
