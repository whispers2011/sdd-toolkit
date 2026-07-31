# Phase 1 — Datenmodell

Alle Feldnamen folgen den bestehenden Konventionen des Projekts: `camelCase` in TypeScript,
`snake_case` in SQLite, Abbildung in `ExecutionRepo.map()`.

---

## 1. `UsageEvent` (neu, flüchtig)

Eine einzelne, von der CLI gemeldete API-Anfrage. Entsteht im Parser aus einem
`claude_code.api_request`-Datensatz, lebt nur im Speicher und wird **nie** persistiert.

Entspricht der „Verbrauchsmeldung" und der „Kostenmeldung" der Spec — die CLI liefert beides
in einem Datensatz, eine Trennung in zwei Entitäten hätte keine Entsprechung in den Daten.

| Feld | Typ | Quelle im OTLP-Datensatz | Zweck |
|---|---|---|---|
| `requestId` | `string` | `request_id` | Dedupe-Schlüssel (FR-006) |
| `at` | `number` (ms) | `timeUnixNano` / 1e6 | Zuordnung zum Zeitfenster eines Laufs (FR-004) |
| `sddSessionId` | `string \| null` | Ressourcen-/Datensatz-Attribut `sdd.session.id` | Zuordnung zur Toolkit-Session (FR-002) |
| `sddRunId` | `string \| null` | Attribut `sdd.run.id` | Direktzuordnung bei Headless-Läufen |
| `claudeSessionId` | `string \| null` | `session.id` | Diagnose, Prüfung gegen die CLI (SC-004) |
| `model` | `string` | `model` | Modell je Lauf (FR-013) |
| `inputTokens` | `number` | `input_tokens` | FR-008 |
| `outputTokens` | `number` | `output_tokens` | FR-008 |
| `cacheReadTokens` | `number` | `cache_read_tokens` | FR-008 |
| `cacheCreationTokens` | `number` | `cache_creation_tokens` | FR-008 |
| `costMicros` | `number` | `cost_usd_micros` | Betrag in Mikro-USD, ganzzahlig (FR-021) |
| `origin` | `UsageOrigin` | abgeleitet aus `query_source` | Herkunft (FR-009/FR-010) |

**Regeln**

- Ein Datensatz ohne `requestId` oder ohne verwertbaren Zeitstempel wird verworfen.
- Fehlt `sddSessionId` **und** `sddRunId`, wird der Datensatz verworfen (FR-003).
- Zahlenattribute können in OTLP/JSON als `intValue: "123"` (String) oder `intValue: 123`
  ankommen; beide Formen werden gelesen, alles Unlesbare zählt als `0`.
- Es werden ausschliesslich die obigen Felder übernommen. Personenbezogene Attribute der CLI
  (`user.email`, `user.account_uuid`, `organization.id`, `user.id`) werden nicht gelesen und
  nicht gespeichert (FR-027).

---

## 2. `UsageOrigin` (neu, Aufzählung)

```ts
type UsageOrigin = 'main' | 'subagent' | 'auxiliary';
```

Abgeleitet aus `query_source`, exakt nach der Regel der CLI (research.md D4):

| `query_source` | `UsageOrigin` |
|---|---|
| fehlt | `main` |
| `sdk`, `repl_main_thread`, `repl_main_thread:…` | `main` |
| `agent:*`, `hook_agent` | `subagent` |
| alles andere (`compact`, `side_question`, `hook_prompt`, `web_search_tool`, …) | `auxiliary` |

`auxiliary` zählt in den Gesamtverbrauch des Laufs, aber nicht in den Subagenten-Anteil.

---

## 3. `SessionUsageBuffer` (neu, flüchtig)

Zwischenspeicher je Toolkit-Session bzw. Headless-Lauf. Existiert nur im Server-Prozess.

| Feld | Typ | Zweck |
|---|---|---|
| `key` | `string` | `sdd.session.id` oder `sdd.run.id` |
| `events` | `UsageEvent[]` | nach `at` aufsteigend |
| `seenRequestIds` | `Set<string>` | Dedupe (FR-006) |
| `lastEventAt` | `number` | Grundlage des Kehraus |

**Begrenzung (FR-030)** — drei Deckel, alle drei nötig:

1. Ereignisse älter als das Nachlauffenster (5 min) werden entfernt, sobald kein offener Lauf
   sie mehr beanspruchen kann.
2. Anzahl je Puffer gedeckelt; beim Überlauf fallen die ältesten Ereignisse zuerst.
3. Puffer beendeter Sessions werden periodisch ganz entfernt.

Nichts davon wird persistiert — ein Serverneustart verliert nur noch nicht verrechnete
Ereignisse, und der betroffene Lauf fällt auf die Transkript-Messung zurück (FR-015).

---

## 4. `ExecutionRecord` (bestehend, erweitert)

`packages/shared/src/types.ts`. Alle neuen Felder sind `| null` und in der Ablage `NULL`-fähig —
Bestandsläufe bleiben dadurch unverändert (FR-025).

### Geändert

| Feld | Vorher | Nachher |
|---|---|---|
| `tokensSource` | `'transcript' \| 'parsed' \| 'estimated' \| null` | `'telemetry' \| 'transcript' \| 'parsed' \| 'estimated' \| null` |

`'telemetry'` ist die neue höchste Stufe (FR-017). Die Rangfolge lautet
`telemetry > transcript > parsed > estimated`.

### Neu

| Feld | Spalte | Typ | Zweck |
|---|---|---|---|
| `costMicros` | `cost_micros` | `INTEGER` | Gemeldeter Betrag in Mikro-USD (FR-021). `NULL` = kein Betrag gemeldet — **nie** `0` als Ersatz (FR-023). |
| `subagentTokens` | `subagent_tokens` | `INTEGER` | Gesamttokens der `subagent`-Ereignisse (FR-010). `NULL` = keine Subagenten (FR-010, Szenario 3). |
| `subagentCostMicros` | `subagent_cost_micros` | `INTEGER` | Betragsanteil der Subagenten. |
| `model` | `model` | `TEXT` | Modell aus den Meldungen (FR-013). |
| `telemetryFinalAt` | `telemetry_final_at` | `INTEGER` | Zeitpunkt, ab dem der Lauf endgültig gemessen ist (FR-012, SC-005). Nach diesem Zeitpunkt eintreffende Ereignisse werden verworfen. |

Die bestehenden Felder `tokens`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
`cacheCreationTokens` behalten ihre Bedeutung und werden bei Telemetrie-Herkunft aus den
Ereignissen gefüllt — dieselben Felder, andere Quelle. Dadurch funktionieren
`costBreakdown.aggregateBreakdown` und `runSummary.buildRunSummaries` ohne Umbau weiter.

`tokens` bleibt die Summe aller vier Arten (wie `usageTotalTokens` es heute definiert).

### Migration

Eine einzige, additive Migration, angehängt an `MIGRATIONS` in
`packages/server/src/db/database.ts`:

```sql
-- Feature "token-und-kostenmessung-auf-die-opentelemetry-daten-der-clau":
-- Verbrauch und Betrag stammen von der CLI selbst. Additiv/nullable — Bestandsläufe
-- behalten ihre Transkript-Zahlen und bekommen keinen rückwirkenden Betrag (FR-025).
ALTER TABLE executions ADD COLUMN cost_micros INTEGER;
ALTER TABLE executions ADD COLUMN subagent_tokens INTEGER;
ALTER TABLE executions ADD COLUMN subagent_cost_micros INTEGER;
ALTER TABLE executions ADD COLUMN model TEXT;
ALTER TABLE executions ADD COLUMN telemetry_final_at INTEGER;
```

Keine Änderung an `tokens_source` nötig — die Spalte ist `TEXT` und nimmt den neuen Wert
ohne Schemaänderung auf.

---

## 5. `CostRollup` / `RunSummary` / `FeatureCostBreakdown` (bestehend, erweitert)

`packages/shared/src/costBreakdown.ts`, `packages/shared/src/runSummary.ts`.

| Feld | Ort | Zweck |
|---|---|---|
| `costMicros: number` | `CostRollup` | Summe der gemeldeten Beträge. |
| `runsWithoutCost: number` | `CostRollup` | Wie viele der enthaltenen Läufe keinen Betrag beitragen (FR-024). |
| `subagentTokens: number` | `CostRollup` | Summierter Subagenten-Anteil. |
| `sourceMix.telemetry: number` | `RunSummary`, `FeatureCostBreakdown` | Anteil der Läufe mit Telemetrie-Herkunft (FR-018). |

**Wichtig für FR-018**: `sourceMix` behält seinen heutigen Nenner — **alle** Läufe, nicht nur
gemessene. Die Begründung steht als Kommentar in beiden Dateien und gilt unverändert: sonst
meldet ein Lauf mit einer gemessenen und zehn ungemessenen Ausführungen „100 % gemessen".

Die heutige Kennzahl „% gemessen" in `ExecutionsView.tsx` rechnet mit `sourceMix.transcript`
allein. Sie muss auf `telemetry + transcript` erweitert werden, sonst fällt die Anzeige beim
Umstieg scheinbar auf 0, obwohl die Messung besser geworden ist.

---

## 6. Zustandsübergänge eines Laufs

```
                    ┌──────────────────────────────────────────┐
                    │  running                                 │
                    │  Ereignisse sammeln sich im Puffer        │
                    └───────────────────┬──────────────────────┘
                                        │ Turn fertig / Session-Exit
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │  Ereignisse im Fenster vorhanden?         │
                    └───────┬──────────────────────────┬───────┘
                        ja  │                          │  nein
                            ▼                          ▼
        tokensSource='telemetry'            meterTurn() wie heute
        Beträge + Subagenten-Anteil         tokensSource='transcript'
        telemetryFinalAt = jetzt + 5 min    | 'parsed' | 'estimated'
                            │                          │
                            ▼                          ▼
        ┌───────────────────────────────┐   ┌────────────────────────┐
        │ nachtragsfähig (≤ 5 min)      │   │ endgültig              │
        │ späte Ereignisse werden       │   │ (unverändertes         │
        │ verrechnet, Ansicht aktuali-  │   │  Verhalten)            │
        │ siert sich von selbst         │   └────────────────────────┘
        └───────────────┬───────────────┘
                        │ telemetryFinalAt überschritten
                        ▼
        ┌───────────────────────────────┐
        │ endgültig — spätere Ereignisse│
        │ für diesen Lauf verworfen     │
        └───────────────────────────────┘
```

Der Übergang ist **einmalig und ausschliesslich**: Ein Lauf bekommt entweder Telemetrie- oder
Transkript-Zahlen, nie beides addiert (FR-016). Das ist keine Regel, die eingehalten werden
muss, sondern folgt daraus, dass es je Lauf nur einen Schreibpfad gibt.

---

## 7. Zuordnungsregel (die zentrale Invariante)

Ein `UsageEvent` gehört zu einem Lauf, wenn **alle** vier Bedingungen gelten:

1. `event.sddSessionId` entspricht der Session des Laufs — **oder** `event.sddRunId` entspricht
   direkt der `executionId` (Headless).
2. `event.at` liegt in `[lauf.startedAt, lauf.finishedAt]`. Für einen noch laufenden Lauf ist
   die obere Grenze offen.
3. `event.requestId` wurde für diesen Lauf noch nicht verrechnet.
4. Der Lauf ist noch nicht endgültig (`telemetryFinalAt` nicht überschritten).

Daraus folgen unmittelbar die Erwartungen der Spec:

- **Kein Verbrauch früherer Läufe** (US1, Szenario 1) — Bedingung 2, ohne jede Rekonstruktion
  einer Startmarke.
- **Keine Überschneidung zweier Läufe** (US1, Szenario 2) — die Fenster aufeinanderfolgender
  Läufe derselben Session überschneiden sich nicht.
- **Verbrauch ohne aktiven Lauf zählt nirgends** (FR-005) — er liegt in keinem Fenster.
- **Parallele Sessions trennen sauber** (US1, Szenario 5) — Bedingung 1.
- **Fremde Sessions zählen nie** (US1, Szenario 6) — ohne Marke schon im Parser verworfen.
- **Kontext-Reset bricht nichts** (FR-007) — `/clear` wechselt `session.id`, nicht
  `sdd.session.id`; beide Abschnitte liegen im selben Fenster.
