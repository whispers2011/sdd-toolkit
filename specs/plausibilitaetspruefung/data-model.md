# Phase 1 — Data Model: Plausibilitätsprüfung gemessener Läufe

**Grundsatz**: Dieses Feature legt **eine** neue Tabelle an (die Quittierung) und erweitert **zwei**
bestehende Typen (Meldungsart, Ablehnungsergebnis). Es verändert **keine** Zeile in `executions`,
`features` oder `projects` — SC-007.

Bezug: [research.md](./research.md) · Verträge: [contracts/](./contracts/)

---

## 1. Befund (Regel, kein Datensatz)

Ein Befund ist eine benannte Regel über bereits gespeicherte Daten. Er wird **nicht** persistiert;
persistiert werden nur seine Meldungen und seine Quittierung.

| Befund | `AttentionKind` | Bezugsobjekt | Datenquelle | Wasserstand |
|---|---|---|---|---|
| A gemessen, aber nicht bepreist | `run_unpriced` | Projekt | `executions` | ja |
| B Fehlstart statt Fehlschlag | `phase_false_start` | Feature | `executions` | ja |
| C Projekt mit Features, ohne Lauf | `project_without_runs` | Projekt | `projects`+`features`+`executions` | ja |
| D verworfene Nachkorrektur | `metering_conflict` | Feature | Ereignis (kein Bestand) | nein |

### Schwellen (`packages/shared/src/plausibility.ts`)

| Konstante | Wert | Herkunft |
|---|---|---|
| `FALSE_START_MAX_MS` | `6_000` | Assumption der Spec; an den Daten bestätigt (research.md D8) |
| `PROJECT_WITHOUT_RUNS_GRACE_MS` | `60 * 60_000` | Assumption der Spec (Karenzzeit) |
| `METERING_CONFLICT_MIN_FACTOR` | `2` | FR-010 |
| `TERMINATION_EXIT_CODES` | `[130, 137, 143]` | SIGINT/SIGKILL/SIGTERM (research.md D9) |
| Endgültigkeitsfenster | `TELEMETRY_GRACE_MS` (5 min) | **importiert** aus `telemetry/telemetryStore.ts`, als Parameter übergeben |

### Prädikate (pur, über `ExecutionRecord` aus `@sdd/shared`)

```ts
isMeasurementFinal(run, now, graceMs): boolean
  run.finishedAt !== null
  && now - run.finishedAt >= graceMs
  && (run.telemetryFinalAt === null || run.telemetryFinalAt <= now)

isUnpricedRun(run, now, graceMs): boolean          // Befund A
  run.status !== 'orphaned'
  && (run.tokens ?? 0) > 0
  && run.costMicros === null
  && isMeasurementFinal(run, now, graceMs)

isPhaseFalseStart(run): boolean                    // Befund B (ohne Archiv-Filter, siehe §4)
  run.kind === 'phase'
  && run.status === 'failed'                       // schließt 'orphaned' und 'running' aus
  && run.exitCode !== null && run.exitCode !== 0
  && !TERMINATION_EXIT_CODES.includes(run.exitCode)
  && run.finishedAt !== null
  && run.finishedAt - run.startedAt < FALSE_START_MAX_MS   // ausschließend: genau 6 s meldet nicht

isProjectWithoutRuns(stats, now): boolean          // Befund C
  stats.activeFeatures > 0
  && stats.phaseRuns === 0
  && stats.newestFeatureAt !== null
  && now - stats.newestFeatureAt >= PROJECT_WITHOUT_RUNS_GRACE_MS

meteringConflictFactor(existingTokens, rejectedTokens): number    // Befund D
  existingTokens / Math.max(rejectedTokens, 1)
```

**Ableitung der Nicht-Melde-Regeln** (SC-002 — jede ist ein eigener Testfall):

| Regel | erfüllt durch |
|---|---|
| FR-005 Betrag vorhanden | `costMicros === null` |
| FR-005 keine Tokens | `(tokens ?? 0) > 0` |
| FR-005 noch nachtragsfähig | `isMeasurementFinal` |
| FR-007 Exitcode 0 | `exitCode !== 0` |
| FR-007 Laufzeit ≥ 6 s | `< FALSE_START_MAX_MS` |
| FR-007 abgebrochen | `TERMINATION_EXIT_CODES` |
| FR-007 verwaist | `status === 'failed'` |
| FR-009 kein Feature | `activeFeatures > 0` |
| FR-009 mind. ein Phasenlauf | `phaseRuns === 0` |
| FR-009 alle archiviert | `activeFeatures` zählt nur `archived_at IS NULL` |
| FR-009 Karenzzeit offen | `now - newestFeatureAt >= GRACE` |
| FR-011 Nachtrag angenommen | Aufruf nur bei `applied: false` |
| FR-011 Abweichung < Faktor 2 | `factor >= METERING_CONFLICT_MIN_FACTOR` |

---

## 2. Wasserstand — neue Tabelle `plausibility_state`

Migration (neuer Eintrag am Ende von `MIGRATIONS` in `packages/server/src/db/database.ts`):

```sql
CREATE TABLE plausibility_state (
  kind           TEXT    NOT NULL,
  project_id     TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature_id     TEXT    NOT NULL DEFAULT '',   -- '' = projektweiter Befund (A, C)
  reported_count INTEGER NOT NULL,
  reported_at    INTEGER NOT NULL,
  PRIMARY KEY (kind, project_id, feature_id)
);
```

**Feldbedeutung**

| Feld | Bedeutung |
|---|---|
| `kind` | Meldungsart des Befunds (`run_unpriced`, `phase_false_start`, `project_without_runs`) |
| `project_id` | Bezugsprojekt; Fremdschlüssel mit Cascade, damit ein gelöschtes Projekt keine Marken hinterlässt |
| `feature_id` | Bezugsfeature bei Befund B, sonst `''`. **Kein** Fremdschlüssel — `''` ist kein Feature |
| `reported_count` | Anzahl betroffener Objekte beim letzten Melden bzw. beim letzten Nachziehen |
| `reported_at` | Zeitpunkt dieses Stands (Diagnose; keine Regel hängt daran) |

**Warum `''` statt `NULL`**: `NULL` wäre in einem Primärschlüssel in SQLite mehrfach erlaubt und
würde die Eindeutigkeit projektweiter Befunde aufheben.

**Aufräumen**: `FeatureRepo.hardDelete()` löscht zusätzlich
`DELETE FROM plausibility_state WHERE feature_id=?` (in derselben Transaktion wie die bestehenden
expliziten Löschungen von `executions`, `agent_runs`, `attention`, `sessions`).

### Zustandsübergänge der Melde-Entscheidung

```
                  Anzahl = 0 ─────────────► clear      (Marke löschen)
                       │
 Befund vorhanden ─────┼─ offene Meldung ──► refresh    (Marke = Anzahl, keine neue Meldung)
                       │
                       └─ keine offene ────┬─ keine Marke oder Anzahl > Marke ─► raise
                                           └─ Anzahl ≤ Marke ──────────────────► suppress
```

Pure Funktion:
`decideFinding(count: number, mark: number | null, hasOpenItem: boolean): 'raise' | 'refresh' | 'suppress' | 'clear'`

**Invarianten**

- `raise` setzt die Marke immer auf die gemeldete Anzahl → zehn Prüfungen ergeben eine Meldung (SC-004).
- `refresh` verändert **nie** eine offene Meldung (kein Text-Update) → die Anzahl in einer offenen
  Meldung ist der Stand ihrer Entstehung. Bewusst: eine sich still ändernde Meldung wäre nicht
  quittierbar.
- Nach `clear` verhält sich der Befund wie beim ersten Mal.

---

## 3. Meldung (`attention`, bestehende Tabelle, unverändert)

Die vier Befunde nutzen die bestehende Inbox ohne Schemaänderung.

| Feld | Befund A | Befund B | Befund C | Befund D |
|---|---|---|---|---|
| `kind` | `run_unpriced` | `phase_false_start` | `project_without_runs` | `metering_conflict` |
| `project_id` | Projekt des Laufs | Projekt des Features | Projekt | Projekt des Features |
| `feature_id` | `NULL` | Feature | `NULL` | Feature |
| `session_id` | `NULL` | `NULL` | `NULL` | `NULL` |
| `conversation_id` | `NULL` | `NULL` | `NULL` | `NULL` |
| `message` | Anzahl + Beispiel | Anzahl + Beispiel | Anzahl Features + Alter | beide Zahlen + Faktor |

`AttentionRepo.raise()` dedupliziert über `(kind, project_id, feature_id, session_id,
conversation_id)` bei `resolved_at IS NULL` — mit dieser Belegung ist FR-013 exakt die
vorhandene Dedup-Regel, ohne Änderung an `repos.ts`.

### Meldungstexte (pure Builder, Deutsch, `Intl.NumberFormat('de-CH')`)

```
A  Verbrauch ohne Preis: 148 abgeschlossene Läufe haben Tokens gezählt, aber keinen Betrag —
   z.B. implement in „lebenszyklus-schritte-sichtbar-machen" mit 62'377'448 Tokens.
   Der Preis dieser Läufe ist unbekannt und nicht nachträglich berechenbar.

B  Fehlstart: 9 Phasenläufe von „nur-sessions-aktiver-projekte-anzeigen" endeten nach
   2,1–3,4 s mit Exitcode 1 — die Phase lief nie an, das ist kein inhaltlicher Fehlschlag.

C  Projekt „iwf-datenkrake": 22 nicht archivierte Features, aber nie ein Phasenlauf.
   Jüngstes Feature vor 29 Stunden angelegt.

D  Messung widersprüchlich: Nachtrag für Lauf uQ_RAMEn verworfen — 6'578'097 Tokens vorhanden,
   568'955 nachgetragen (Faktor 11,6). Die bestehende Zahl bleibt stehen; einer der beiden
   Messwege ist falsch.
```

Beispiel-Auswahl (FR-015): der Lauf mit der **größten Tokenzahl** (A) bzw. der **kürzeste**
Fehlstart (B) — deterministisch, damit Tests auf den Text prüfen können. Fehlt bei A das Feature
(Läufe mit `feature_id IS NULL`, z.B. `chat_work`), nennt der Text die Lauf-Art statt Feature und
Schritt.

---

## 4. Eingangsdaten der Prüfung

| Nr. | Quelle | Methode | Zweck |
|---|---|---|---|
| 1 | `ExecutionRepo.listAll()` (**bestehend**) | alle Läufe, aufsteigend | Befund A und B |
| 2 | `FeatureRepo.listAll()` (**bestehend**) | nur nicht archivierte | Feature-Namen; Archiv-Filter für Befund B (research.md D6) |
| 3 | `ProjectRepo.list()` (**bestehend**) | Projektnamen | Meldungstexte |
| 4 | `PlausibilityRepo.listProjectStats()` (**neu**) | Aggregat je Projekt | Befund C |

```ts
interface ProjectRunStats {
  projectId: string;
  activeFeatures: number;      // features WHERE archived_at IS NULL
  newestFeatureAt: number | null;  // MAX(created_at) derselben Menge
  phaseRuns: number;           // executions WHERE project_id=? AND kind='phase'
}
```

**Gruppierung**

- Befund A: alle Läufe mit `isUnpricedRun` → gruppiert nach `projectId` (Läufe archivierter und
  gelöschter Features zählen mit, research.md D6).
- Befund B: alle Läufe mit `isPhaseFalseStart` **und** `featureId` in den nicht archivierten
  Features → gruppiert nach `featureId`.

---

## 5. Erweiterung `TelemetryUpdateOutcome` (`packages/server/src/db/repos.ts`)

```ts
export type TelemetryUpdateOutcome =
  | { applied: true }
  | {
      applied: false;
      reason: string;                            // unverändert, wortgleich (FR-018)
      rejection: 'lowered' | 'price_loss';
      existingTokens: number;
      rejectedTokens: number;
      factor: number;                            // existingTokens / max(rejectedTokens, 1)
    };
```

Rückwärtskompatibel: bestehende Prüfungen auf `applied` und `reason` bleiben gültig, die
`console.warn`-Ausgaben in `orchestrator.ts` ändern sich nicht.

`rejection: 'price_loss'` kann `factor >= 2` nie erreichen, weil dieser Zweig erst nach der
Token-Prüfung erreichbar ist (`rejectedTokens >= existingTokens`) — siehe research.md D10.

---

## 6. Erweiterung `AttentionKind` (`packages/shared/src/types.ts`)

```ts
export type AttentionKind =
  | …bestehende zehn…
  | 'run_unpriced'          // Befund A
  | 'phase_false_start'     // Befund B
  | 'project_without_runs'  // Befund C
  | 'metering_conflict';    // Befund D
```

**Zwangsfolgen aus der Typprüfung** (beides ohne diese Erweiterung nicht kompilierbar):

1. `KIND_META: Record<AttentionKind, …>` in `packages/web/src/components/AttentionInbox.tsx` —
   vier neue Einträge (Bezeichnung, Icon, Farbe), siehe [contracts/attention-kinds.md](./contracts/attention-kinds.md).
2. `STAGE_FOR_KIND` in `attentionReconciler.ts` ist `Partial<Record<…>>` und braucht **keinen**
   Eintrag — die neuen Arten sind nicht an eine Integrations-Stufe gebunden.

**Gültigkeitsverhalten** (FR-016/FR-017): vier explizite `case`-Zweige in `isAttentionValid()`,
die `true` zurückgeben. Sie sind damit weder session- noch stage-gekoppelt: ein wieder arbeitender
Agent löst sie nicht auf, ein Neustart verwirft sie nicht (`findStaleOnBoot` behandelt nur
`awaiting_input`/`agent_errored` pauschal als stale).
