# Vertrag: `@sdd/shared` — Modul `plausibility.ts`

Pures Modul: **kein IO, kein `node:`-Import, keine Datenbank, keine UI.** Alles hier ist über
`packages/shared/src/plausibility.test.ts` ohne Aufbau prüfbar. Re-Export über
`packages/shared/src/index.ts`.

## Konstanten

```ts
/** Laufzeit unter dieser Grenze + Exitcode ≠ 0 = Fehlstart. AUSSCHLIESSEND: genau 6000 meldet nicht. */
export const FALSE_START_MAX_MS = 6_000;

/** Karenzzeit nach Anlage des jüngsten Features, bevor „Projekt ohne Lauf" melden darf. */
export const PROJECT_WITHOUT_RUNS_GRACE_MS = 60 * 60_000;

/** Ab diesem Faktor wird eine verworfene Nachkorrektur gemeldet statt nur protokolliert. */
export const METERING_CONFLICT_MIN_FACTOR = 2;

/** Signal-Exitcodes: SIGINT, SIGKILL, SIGTERM — Abbruch auf Anforderung, kein Fehlstart. */
export const TERMINATION_EXIT_CODES: readonly number[] = [130, 137, 143];
```

Das Endgültigkeitsfenster ist **keine** Konstante dieses Moduls: `TELEMETRY_GRACE_MS` gehört dem
Server (`telemetry/telemetryStore.ts`) und wird als Parameter `graceMs` übergeben. Zwei Fenster
könnten auseinanderlaufen.

## Prädikate

```ts
export function isMeasurementFinal(run: ExecutionRecord, now: number, graceMs: number): boolean;
export function isUnpricedRun(run: ExecutionRecord, now: number, graceMs: number): boolean;
export function isPhaseFalseStart(run: ExecutionRecord): boolean;
export function isProjectWithoutRuns(stats: ProjectRunStats, now: number): boolean;
export function meteringConflictFactor(existingTokens: number, rejectedTokens: number): number;
```

`ProjectRunStats` wird hier definiert (nicht im Server), damit das Prädikat pur bleibt:

```ts
export interface ProjectRunStats {
  projectId: string;
  activeFeatures: number;
  newestFeatureAt: number | null;
  phaseRuns: number;
}
```

**Garantien**

| Garantie | Belegt durch Test |
|---|---|
| `isPhaseFalseStart` ist bei Laufzeit **genau** `FALSE_START_MAX_MS` falsch | Edge Case „genau 6 s" |
| `isPhaseFalseStart` ist bei `status: 'orphaned'` immer falsch | FR-007 |
| `isPhaseFalseStart` ist bei Exitcode 130/137/143 immer falsch | FR-007, US1-8 |
| `isUnpricedRun` ist bei `costMicros !== null` immer falsch | FR-005, US1-2 |
| `isUnpricedRun` ist bei `tokens` `null` oder `0` immer falsch | FR-005, US1-3 |
| `isUnpricedRun` ist innerhalb von `graceMs` nach `finishedAt` immer falsch | FR-005, US1-4 |
| `isProjectWithoutRuns` ist bei `phaseRuns > 0` immer falsch | FR-009, US2-4 |
| `isProjectWithoutRuns` ist bei `activeFeatures === 0` immer falsch | FR-009, US2-3/US2-5 |
| `isProjectWithoutRuns` ist innerhalb der Karenzzeit immer falsch | FR-009, US2-2 |
| Kein Prädikat mutiert sein Argument | — |

## Melde-Entscheidung

```ts
export type FindingAction = 'raise' | 'refresh' | 'suppress' | 'clear';

/**
 * @param count       aktuell betroffene Objekte (0 = Befund liegt nicht vor)
 * @param mark        quittierter Stand aus `plausibility_state`, null = nie gemeldet
 * @param hasOpenItem offene Meldung dieses Befunds für dieses Bezugsobjekt vorhanden
 */
export function decideFinding(count: number, mark: number | null, hasOpenItem: boolean): FindingAction;
```

Wahrheitstabelle — vollständig, jede Zeile ein Testfall:

| `count` | `mark` | `hasOpenItem` | Ergebnis | Anforderung |
|---|---|---|---|---|
| 0 | `null` | false | `suppress` | — |
| 0 | 5 | false | `clear` | FR-014 (Marke darf nicht dauerhaft sperren) |
| 0 | 5 | true | `clear` | Befund weg ⇒ Marke weg; die Meldung bleibt bis zum Auflösen sichtbar |
| 3 | `null` | false | `raise` | FR-004/006/008 |
| 3 | 3 | true | `refresh` | FR-013, SC-004 |
| 5 | 3 | true | `refresh` | FR-014 (Quittierung erfasst den Stand bei Auflösung) |
| 3 | 3 | false | `suppress` | FR-014, SC-005 (unverändert ⇒ keine Wiederkehr) |
| 2 | 3 | false | `suppress` | FR-014 |
| 4 | 3 | false | `raise` | SC-005 (neuer betroffener Lauf ⇒ Wiederkehr) |

`clear` bei `hasOpenItem: true` löst die offene Meldung **nicht** auf — der Widerspruch war real
und wird von einem Menschen quittiert, nicht vom Toolkit (FR-016 in der Absicht: das Toolkit
räumt Datenbefunde nicht selbst weg).

## Meldungstexte

```ts
export interface UnpricedExample { featureName: string | null; phase: string | null; kind: string; tokens: number; }
export interface FalseStartExample { phase: string | null; minMs: number; maxMs: number; exitCode: number; }

export function unpricedMessage(count: number, ex: UnpricedExample): string;
export function falseStartMessage(count: number, featureName: string, ex: FalseStartExample): string;
export function projectWithoutRunsMessage(projectName: string, activeFeatures: number, ageMs: number): string;
export function meteringConflictMessage(runId: string, existingTokens: number, rejectedTokens: number, factor: number): string;
```

**Garantien**

- Jeder Text nennt die **Anzahl** und ein **konkretes Beispiel** (FR-015).
- `unpricedMessage` nennt bei `featureName: null` die Lauf-Art statt Feature und Schritt.
- `falseStartMessage` nennt den Befund wörtlich „Fehlstart" und sagt, dass die Phase nie anlief
  (FR-006).
- Zahlen im Format `de-CH` (`Intl.NumberFormat`), Laufzeiten in Sekunden mit einer Dezimalstelle.
- Kein Text enthält eine Datenbank-ID außer bei Befund D (dort ist die Lauf-ID die Fundstelle).
