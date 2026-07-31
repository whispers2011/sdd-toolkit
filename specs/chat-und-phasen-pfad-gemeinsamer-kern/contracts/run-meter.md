# Vertrag: Turn messen (`services/core/runMeter.ts`)

Erfüllt **FR-002** (genau eine Implementierung) und **FR-006…FR-012**.
Aufrufer: `Orchestrator` (Phasenläufe), `ChatWorkService` (Turns).

Das ist der Baustein mit dem grössten Abstand zwischen den Pfaden — hier kommen die beiden
Verbesserungen vom 30.07.2026 im Chat an (Puffer-Anmeldung, monotoner Akkumulator) und hier
entsteht die Turn-Dauer.

## Oberfläche

```ts
export interface RunMark {
  executionId: string;
  startedAt: number;
  scrollbackStart: number;
  transcriptOffsetStart: number;
  transcriptPathStart: string | null;
  promptText: string;
  model?: string;
}

/** Startmarke einer Session fotografieren (Transkriptpfad + Byte-Offset + Scrollback). */
export function markSession(session: LiveSession, startedAt: number): Omit<RunMark, 'executionId'>;

/** Startmarke eines Laufs in seiner Transkriptdatei — drei Fälle, siehe data-model.md §3. */
export function startOffsetIn(path: string, mark: RunMark): number;

export class RunMeter {
  constructor(deps: {
    executions: ExecutionRepo;
    telemetry?: TelemetryStore;
    /** Nach einem angewandten Nachtrag — der Phasen-Pfad zieht damit seine Log-Koordinaten nach. */
    onApplied?: (session: LiveSession, mark: RunMark, source: 'telemetry' | 'transcript') => void;
  });

  // ---- Phasen-Pfad: der Lauf existiert schon, der Aufrufer führt die Marke selbst ----
  hold(sessionId: string): void;
  finish(session: LiveSession, mark: RunMark, exitCode: number): void;
  measure(session: LiveSession, mark: RunMark, until: number): ExecutionUsageInput | null;

  // ---- Chat-Pfad: der Kern führt das Turn-Fenster ----
  openTurn(session: LiveSession): void;                 // idempotent
  closeTurn(session: LiveSession, run: {
    projectId: string; featureId: string | null; kind: 'chat_work';
  }): void;

  // ---- beide ----
  abandon(sessionId: string): void;                     // Session endet: Fenster verwerfen, freigeben
  dispose(executionId: string): void;                   // Akkumulator verwerfen
}
```

## Messkaskade (FR-006) — genau ein Schreibpfad je Lauf

```text
1  Meldungen der CLI im Fenster [mark.startedAt, until]?
      ja → tokensSource 'telemetry'; Transkript wird GAR NICHT gelesen
2  sonst: Transkript-Delta ab startOffsetIn(path, mark), sofern Usage vorhanden
      ja → tokensSource 'transcript'
3  sonst: Schätzung aus dem Scrollback ab mark.scrollbackStart
           → tokensSource 'parsed' | 'estimated'
```

Das Nicht-Addieren ist strukturell: Stufe 2 läuft nur, wenn Stufe 1 `null` liefert.

## Zusicherungen

| # | Zusicherung | Bezug |
|---|---|---|
| M1 | **Monoton.** `measure` schreibt einen Akkumulator je `executionId` fort und summiert nie neu. Ein Nachtrag auf einen beschnittenen Puffer liefert dieselbe Zahl wie zuvor, nie eine kleinere und nie `null`. | FR-008, SC-004 |
| M2 | **Jede Meldung zählt einmal.** Dedupe über `requestId` in `accum.seen`, auch über beliebig viele Nachträge. | FR-010 |
| M3 | **Puffer-Anmeldung.** Vom Öffnen des Laufs bis zum Ende des Nachlauffensters ist `telemetry.hold(session.id)` gezogen; danach `release(session.id)` — **nicht** `forget`. | FR-007, FR-007a |
| M4 | **Nachtrag.** Nach dem Abschluss wird zweimal nachgemessen: nach 8 s (Regelfall, Exportintervall 5 s) und am Ende des Nachlauffensters (5 min, Sicherheitsnetz). Timer sind `unref`'d. | FR-009 |
| M5 | **Kein verschlechternder Nachtrag.** Lehnt `executions.updateTelemetry` ab (weniger Tokens oder Preis-Verlust), bleibt die verbuchte Zahl stehen und der Grund wird geloggt. | FR-008, US1 Szenario 4 |
| M6 | **Ansicht zieht nach.** Nach einem angewandten Nachtrag: `bus.emitEvent('execution_updated', { executionId, featureId })` — `featureId` ist bei Chat-Läufen `null`. | FR-009 |
| M7 | **Kosten und Modell** werden verbucht, wenn die Quelle sie liefert; die Quelle steht je Lauf in `tokens_source`. | FR-011, FR-012 |
| M8 | **Ohne Telemetrie-Speicher** (optional konfiguriert) fällt die Kaskade fehlerfrei auf Transkript und Schätzung zurück. | Edge Case |
| M9 | **`abandon` verbucht nichts.** Ein offenes Turn-Fenster einer endenden Session wird verworfen; keine halbe Messung. | Edge Case Leerlauf-Reaper |
| M10 | **Kein Lauf ohne Dauer.** `closeTurn` legt den Lauf mit `startedAt` des Fensters an; `finished_at` ist die Abschlusszeit. | Clarification 30.07.2026 |

## `openTurn` / `closeTurn` im Einzelnen (Chat)

**`openTurn(session)`** — gerufen bei jedem Übergang nach `working`:

- Existiert bereits ein Fenster für `session.id`: No-op.
- Sonst: `startedAt = Date.now()`, `mark = markSession(session, startedAt)`,
  `telemetry?.hold(session.id)`.

**`closeTurn(session, run)`** — gerufen beim Effekt `turn_completed`:

1. Fenster holen; fehlt eines, rückwirkend öffnen mit `startedAt` = Ende des Vorgängerturns
   dieser Session, ersatzweise `session.startedAt` (Rückfallebene, siehe research.md D4).
2. `executionId = executions.start({ …run, phase: null, logPath: null, startedAt: fenster.startedAt })`
3. `finish(session, { …fenster.mark, executionId }, 0)` — derselbe Weg wie im Phasen-Pfad.
4. Ende des Vorgängerturns merken, Fenster schliessen. Die Anmeldung bleibt bis zum Ende des
   Nachlauffensters bestehen (M3).

Ein Lauf entsteht **nur** beim Abschluss (Assumption der Spec: der Chat verbucht atomar); es gibt
zu keinem Zeitpunkt eine chat_work-Zeile im Zustand `running`.

## Was sich für die Aufrufer ändert

| Aufrufer | vorher | nachher |
|---|---|---|
| `Orchestrator.launchPhase` | `transcriptMarkFor(…)`, `telemetry?.hold(…)` | `markSession(session, Date.now())`, `meter.hold(session.id)` |
| `Orchestrator.handleTurnCompleted` / `handleExit` | `finishWithMetering(…)` | `meter.finish(session, running, exitCode)` |
| `Orchestrator` (privat) | `meterFromTelemetry`, `meterTurn`, `scheduleLateReconcile`, `reconcileTranscriptTail`, `telemetryAccum*`, `startOffsetIn`, `transcriptMarkFor`, `emptyUsageTotals`, `addTotals`, `TelemetryAccum` | entfallen — im Kern |
| `Orchestrator.persistTranscriptRange` | bleibt; ruft `startOffsetIn` | bleibt; importiert `startOffsetIn` aus dem Kern, wird bei Transkript-Nachträgen über `onApplied` angestossen |
| `ChatWorkService.handleStatusChange` | `if (turn_completed) this.meterTurn(session)` | `if (status === 'working') meter.openTurn(session)`; `if (turn_completed) meter.closeTurn(session, …)` |
| `ChatWorkService` (privat) | `meterTurn`, `usageForTurn`, `turnStartedAt`, `turnTranscriptOffset` | entfallen — im Kern |
| `ChatWorkService.handleExit` | räumt drei Karten ab | `meter.abandon(session.id)`; `turnStart` bleibt (Scrollback-Marke der Session) |

## Erwartete Verhaltensänderungen (und nur diese)

| Pfad | Änderung | Anforderung |
|---|---|---|
| Chat | Meldungen der CLI werden angemeldet und überleben den Kehraus | FR-007 |
| Chat | Zahl wächst über Nachträge, sinkt nie | FR-008/009 |
| Chat | Subagenten-Anteil, `telemetry_final_at`, Transkript-Fallunterscheidung neu | Clarification |
| Chat | Laufdauer > 0 | Clarification |
| Phase | keine — dieselben Zahlen, dieselben Ereignisse | FR-018 |
| beide | Ende des Nachlauffensters gibt frei statt zu löschen | FR-007a |
