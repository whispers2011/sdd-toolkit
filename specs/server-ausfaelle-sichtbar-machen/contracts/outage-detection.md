# Contract C1 — Lückenerkennung (`@sdd/shared/outage`)

Reines Modul ohne Nebenwirkungen. Erfüllt FR-025 („eigenständig prüfbare Einheit, deren Verhalten
ohne echten Serverabsturz mit gesetzten Zeitpunkten getestet werden kann").

**Datei**: `packages/shared/src/outage.ts` · **Tests**: `packages/shared/src/outage.test.ts`

---

## Konstanten

```ts
/** Abstand zweier Lebenszeichen. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Ab dieser Lücke ohne vermerkten gewollten Abgang gilt der Server als unerwartet weg. */
export const OUTAGE_THRESHOLD_MS = 90_000;
```

Beide sind Vorgabewerte; `detectOutage` nimmt die Schwelle als optionalen Parameter, damit Tests
ohne Warten arbeiten (FR-025).

---

## `detectOutage`

```ts
export function detectOutage(input: {
  /** Zuletzt gelesenes Lebenszeichen; null = keines vorhanden oder unlesbar. */
  heartbeat: Heartbeat | null;
  /** Startzeitpunkt der neuen Instanz (ms). Wird IMMER übergeben, nie intern gelesen. */
  now: number;
  thresholdMs?: number;
}): OutageDetection;
```

**Zusicherungen**

| # | Gegeben | Ergebnis |
|---|---|---|
| C1.1 | `heartbeat === null` | `{ kind: 'none', reason: 'first_start' }` |
| C1.2 | `heartbeat.clean === true`, Lücke beliebig gross (auch Tage) | `{ kind: 'none', reason: 'clean_shutdown' }` |
| C1.3 | `now - ts <= thresholdMs` | `{ kind: 'none', reason: 'within_tolerance' }` |
| C1.4 | `ts > now` (Uhr rückwärts) | `{ kind: 'undetermined', reason: 'clock_backwards', lastHeartbeatAt, bootAt }` |
| C1.5 | `now - ts > thresholdMs`, `clean === false` | `{ kind: 'outage', from: ts, to: now, durationMs: now - ts, instanceId }` |

**Invarianten**

- `durationMs > 0` in jedem `outage`-Ergebnis — ein negatives Fenster ist unmöglich (C1.4 fängt es
  vorher ab).
- Die Funktion ist rein: gleiche Eingabe → gleiches Ergebnis; kein `Date.now()`, kein Dateizugriff.
- Reihenfolge der Prüfungen ist verbindlich: `null` → `clean` → `ts > now` → Schwelle. `clean` vor
  der Uhrprüfung, damit ein geordneter Abgang auch bei verstellter Uhr nie zum Ausfall wird
  (FR-010).

---

## `formatOutageDuration`

```ts
export function formatOutageDuration(ms: number): string;
```

Lesbare Dauer statt roher Sekunden (Edge Case „sehr langer Ausfall").

| Eingabe | Ausgabe |
|---|---|
| `47_000` | `"47 s"` |
| `92_000` | `"1 min"` |
| `4_080_000` | `"1 h 8 min"` |
| `273_600_000` | `"3 Tage 4 h"` |

Regel: höchstens zwei Einheiten, grösste zuerst, abgeschnitten (nicht gerundet), Nullanteile
weggelassen (`"2 h"` statt `"2 h 0 min"`).

---

## `outageMessage`

```ts
export function outageMessage(input: {
  from: number;
  to: number;
  durationMs: number;
  runCount: number;
  featureNames: string[];   // nur die des betroffenen Projekts
  /** Für die Zeitformatierung; Tests setzen sie fest. */
  locale?: string;
}): string;
```

Erzeugt den Text der Aufmerksamkeitsmeldung. Aufbau:

```
Server war zwischen 12:59 und 14:07 unerwartet weg (1 h 8 min) — 2 Läufe betroffen: uQ_RAMEn, tMvPe72V
```

**Regeln**

- Uhrzeiten in `de-CH`, ohne Sekunden. Fällt der Beginn auf einen anderen Kalendertag als das Ende,
  wird bei beiden das Datum vorangestellt (`28.07. 22:14`).
- Höchstens fünf Feature-Namen; darüber hinaus `… und N weitere`.
- `runCount === 1` → `1 Lauf betroffen`.
- Läufe ohne Feature (Chat) erscheinen als `Chat`.

Die Zeichenkette ist der vollständige Inhalt von `AttentionItem.message`; die Oberfläche parst sie
nicht, sie zeigt sie (siehe [C4](./attention-item.md)).
