# Vertrag: `PlausibilityService` und `PlausibilityRepo` (Server)

Zwei neue Dateien, ein neuer Migrationsschritt. Die Verdrahtung berührt vier Bestandsdateien und
verändert **kein** bestehendes Verhalten außer der Erweiterung von `TelemetryUpdateOutcome`.

## `packages/server/src/db/plausibilityRepo.ts` (neu)

```ts
export class PlausibilityRepo {
  constructor(private db: DB) {}

  /** Aggregat je Projekt für Befund C — eine Abfrage, keine N+1. */
  listProjectStats(): ProjectRunStats[];

  /** Quittierter Stand; null = nie gemeldet. featureId '' = projektweiter Befund. */
  getMark(kind: AttentionKind, projectId: string, featureId: string): number | null;

  /** Marke setzen/überschreiben (INSERT … ON CONFLICT DO UPDATE). */
  setMark(kind: AttentionKind, projectId: string, featureId: string, count: number, now: number): void;

  /** Marke löschen (Befund liegt nicht mehr vor). */
  clearMark(kind: AttentionKind, projectId: string, featureId: string): void;
}
```

`listProjectStats()` fragt **`executions.project_id`** ab, nicht über einen Join auf `features` —
damit zählen Läufe gelöschter Features weiterhin als „es lief etwas" (Edge Case der Spec).

## `packages/server/src/services/plausibilityService.ts` (neu)

```ts
export interface PlausibilityDeps {
  executions: ExecutionRepo;
  features: FeatureRepo;
  projects: ProjectRepo;
  attention: AttentionRepo;
  state: PlausibilityRepo;
  /** Endgültigkeitsfenster; Default TELEMETRY_GRACE_MS. Test-Naht. */
  graceMs?: number;
}

export class PlausibilityService {
  constructor(deps: PlausibilityDeps);

  /**
   * Vollständige Beurteilung des Bestands (Befunde A, B, C).
   * EINZIGER Prüfpfad — vom Start, vom Intervall und vom Laufabschluss aufgerufen (FR-001/FR-002).
   * Idempotent: mehrfacher Aufruf über unverändertem Bestand legt keine zweite Meldung an.
   * Wirft nie: der Rumpf ist vollständig in try/catch gefasst, Fehler landen als console.warn.
   */
  check(now?: number): void;

  /**
   * Befund D — ereignisgetrieben, aus dem Ablehnungspfad von updateTelemetry (FR-010).
   * Meldet nur bei rejection === 'lowered' && factor >= METERING_CONFLICT_MIN_FACTOR.
   * Wirft nie.
   */
  reportMeteringConflict(run: { id: string; projectId: string; featureId: string | null },
                         outcome: Extract<TelemetryUpdateOutcome, { applied: false }>): void;
}
```

### Zusagen

| Zusage | Anforderung |
|---|---|
| Schreibt ausschließlich in `attention` und `plausibility_state` | SC-007 |
| Kein `UPDATE`/`INSERT` auf `executions`, `features`, `projects` | SC-007 |
| Sendet `attention_raised` über den Bus bei jeder neuen Meldung | Live-Aktualisierung der Inbox |
| `check()` wirft unter keinen Umständen | FR-003, SC-006 |
| `reportMeteringConflict()` wirft unter keinen Umständen | FR-003 |
| Bestehende `console.warn`-Ausgaben bleiben unverändert | FR-018 |
| Ein Befund über mehrere Läufe ⇒ **eine** Meldung mit Anzahl | Edge Case, FR-015 |

## Migration

Neuer Eintrag am Ende von `MIGRATIONS` (`packages/server/src/db/database.ts`) — Tabelle
`plausibility_state`, Definition in [data-model.md](../data-model.md) §2. Additiv, keine
Datenumformung, keine Rückmigration nötig.

## Verdrahtung in Bestandsdateien

| Datei | Änderung | Anforderung |
|---|---|---|
| `db/database.ts` | Migrationsschritt `plausibility_state` | FR-017 |
| `db/repos.ts` | `TelemetryUpdateOutcome` um Ablehnungsdaten erweitert; `FeatureRepo.hardDelete()` löscht Marken mit | FR-010 |
| `services/orchestrator.ts` | optionale Abhängigkeit `plausibility?`; Aufruf am Ende des `last`-Zweigs von `scheduleLateReconcile()`; `reportMeteringConflict()` an den **zwei** Ablehnungsstellen (`scheduleLateReconcile`, `reconcileTranscriptTail`) | FR-001, FR-010 |
| `services/attentionReconciler.ts` | vier `case`-Zweige mit `return true` | FR-016, FR-017 |
| `index.ts` | `PlausibilityRepo` + `PlausibilityService` bauen (**vor** dem Orchestrator); `check()` **nach** `reapOnBoot()`; `setInterval(…, 60_000)`; `clearInterval` im Shutdown | FR-002 |
| `web/components/AttentionInbox.tsx` | vier `KIND_META`-Einträge | FR-012 |

**Reihenfolge beim Start ist verbindlich**: `orchestrator.reapOnBoot()` muss vor dem ersten
`check()` laufen. Der Reaper setzt hängengebliebene Läufe auf `orphaned` — Befund A und B
überspringen diesen Status, würden ohne den Reaper aber `running`-Leichen ohne `finished_at`
sehen (die kein Befund sind, aber die Absicht wäre unklar).

**Der Aufruf im Orchestrator ist die letzte Anweisung des Timer-Rumpfes**, in eigenem `try/catch`.
Er darf die Messung, die davor läuft, nicht beeinflussen (FR-003).

## Intervall

`60_000 ms`, neben dem bestehenden `workWithoutRunInterval` — derselbe Takt wie der
Zuordnungswächter (Assumption der Spec: „Bestandsprüfung im Takt der bestehenden regelmäßigen
Prüfung"). Kein eigener Timer-Mechanismus, kein Cron.
