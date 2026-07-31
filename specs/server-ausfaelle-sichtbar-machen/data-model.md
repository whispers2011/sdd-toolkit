# Phase 1 — Datenmodell: Server-Ausfälle sichtbar machen

**Feature**: `specs/server-ausfaelle-sichtbar-machen` | **Datum**: 2026-07-30

Ableitung der Key Entities aus [spec.md](./spec.md) auf konkrete Ablage und Typen. Keine
Datenbank-Migration: alles Neue lebt in zwei Dateien im Datenverzeichnis. Die einzige Änderung an
bestehenden Daten ist ein zusätzlicher Wert der Aufzählung `AttentionKind`, der ohne Schemawechsel
in die vorhandene `TEXT`-Spalte passt.

---

## Ablageorte

| Was | Pfad | Format | Lebensdauer |
|---|---|---|---|
| Lebenszeichen | `$SDD_DATA_DIR/heartbeat.json` | eine JSON-Zeile, atomar ersetzt | wird laufend überschrieben |
| Betriebsprotokoll | `$SDD_DATA_DIR/operations.jsonl` | JSON Lines, angehängt | rotiert bei > 1 MB auf 1000 Zeilen |
| Ausfallmeldung | Tabelle `attention` (bestehend) | Zeile mit `kind='server_outage'` | bis erledigt |
| Ressourcen-Momentaufnahme | nur Arbeitsspeicher | — | 10 s Cache |

`$SDD_DATA_DIR` ist per Default `~/.sdd-toolkit` (siehe `packages/server/src/config.ts`). Beide
Dateien liegen damit neben `sdd-toolkit.sqlite` — wie in der Spec-Annahme „Ablageort" gefordert.

---

## Entität: Lebenszeichen (`Heartbeat`)

Modul: `packages/shared/src/types.ts`

```ts
export interface Heartbeat {
  /** Zeitpunkt des Schreibens (ms seit Epoche). */
  ts: number;
  /** Kennung des schreibenden Serverlaufs; wechselt bei jedem Start. */
  instanceId: string;
  /** true = der Server hat sich geordnet verabschiedet; eine Lücke danach ist kein Ausfall. */
  clean: boolean;
  /** Startzeitpunkt der schreibenden Instanz (Laufzeit im Abgangseintrag). */
  startedAt: number;
}
```

**Regeln**

- Jeder Takt schreibt den Satz **vollständig** neu, `clean` immer `false` (D5).
- `markClean()` beim geordneten Herunterfahren setzt `clean: true` und behält `ts`, `instanceId`,
  `startedAt`.
- Unlesbarer oder unvollständiger Inhalt gilt als **nicht vorhanden** (Edge Case „Ausfall während
  des Schreibens"). Kein Fehler, kein Startabbruch.
- Fehlende Datei = Erststart (FR-010) → nie ein Ausfall.
- Schreibfehler werden geschluckt und beim nächsten Takt erneut versucht (FR-011).

**Zustandsübergänge**

```
(keine Datei) ──Start──▶ {ts=jetzt, clean=false}
      │                        │
      │                   Takt (30 s)  ──▶ {ts=jetzt, clean=false}
      │                        │
      │                   geordneter Abgang ──▶ {ts unverändert, clean=true}
      │                        │
      └──────────────── Start ─┴──▶ Auswertung durch detectOutage(), danach {ts=jetzt, clean=false}
```

---

## Entität: Ausfall (`OutageDetection` / `OutageRecord`)

Modul: `packages/shared/src/outage.ts` (Ergebnis der reinen Erkennung) und `types.ts` (Protokoll-
und Transportform).

```ts
/** Ergebnis der reinen Lückenerkennung — die einzige Stelle, die „Ausfall ja/nein" entscheidet. */
export type OutageDetection =
  | { kind: 'none'; reason: 'first_start' | 'clean_shutdown' | 'within_tolerance' }
  | { kind: 'outage'; from: number; to: number; durationMs: number; instanceId: string | null }
  | { kind: 'undetermined'; reason: 'clock_backwards'; lastHeartbeatAt: number; bootAt: number };

/** Festgehaltener Ausfall — so steht er im Protokoll und so geht er an die Oberfläche. */
export interface OutageRecord {
  from: number | null;          // letztes Lebenszeichen; null bei undetermined
  to: number;                   // Startzeitpunkt der neuen Instanz
  durationMs: number | null;    // null bei undetermined
  /** Zahl der zum Ausfallzeitpunkt noch als laufend geführten Läufe (über alle Projekte). */
  affectedRuns: number;
  /** true = kein Abgangseintrag vorhanden → stiller Abgang (FR-014). */
  silent: boolean;
  /** true = Zeitfenster nicht bestimmbar (D15). */
  undetermined: boolean;
}
```

**Validierungsregeln** (jede ist ein Testfall aus FR-026)

| Bedingung | Ergebnis |
|---|---|
| kein Lebenszeichen vorhanden | `none / first_start` |
| `heartbeat.clean === true` | `none / clean_shutdown` — unabhängig von der vergangenen Zeit |
| `now - ts <= 90 000 ms` | `none / within_tolerance` |
| `ts > now` | `undetermined / clock_backwards` |
| sonst | `outage`, `from = ts`, `to = now`, `durationMs = now - ts` |

**Abgeleitete Werte**

- `formatOutageDuration(ms)` → lesbare Dauer statt Sekunden (Edge Case „sehr langer Ausfall"):
  `"47 s"`, `"12 min"`, `"1 h 8 min"`, `"3 Tage 4 h"`.
- `outageMessage({ from, to, durationMs, runCount, featureNames })` → Text der
  Aufmerksamkeitsmeldung, siehe [contracts/attention-item.md](./contracts/attention-item.md).

---

## Entität: Betroffener Lauf

Keine eigene Ablage — abgeleitet aus der bestehenden Tabelle `executions`.

```ts
export interface AffectedRun {
  executionId: string;
  projectId: string;
  featureId: string | null;   // null bei Chat-Läufen ohne Feature
  featureName: string | null;
  kind: ExecutionRecord['kind'];
  startedAt: number;
}
```

**Ermittlung**: `SELECT * FROM executions WHERE status='running'` — gelesen **vor**
`orchestrator.reapOnBoot()` (D3). Neue Methode `ExecutionRepo.listRunning(): ExecutionRecord[]`.

**Gruppierung**: nach `project_id`. Je Projekt mit mindestens einem betroffenen Lauf entsteht genau
eine Meldung (FR-006). Projekte ohne betroffene Läufe bekommen keine (FR-006, Edge Case „Ausfall
ohne laufende Arbeit").

---

## Entität: Betriebsprotokoll-Eintrag (`OperationsEntry`)

Modul: `packages/shared/src/types.ts`, Ablage `operations.jsonl`.

```ts
export type OperationsEntryKind = 'startup' | 'shutdown' | 'uncaught' | 'exit' | 'outage';

export interface OperationsEntry {
  ts: number;
  instanceId: string;
  kind: OperationsEntryKind;
  /** kind='shutdown': empfangenes Signal, z. B. 'SIGINT'. */
  signal?: string;
  /** kind='uncaught': Fehlerbeschreibung (Message + erste Zeilen des Stacks, gekürzt). */
  error?: string;
  /** kind='exit': Rückgabewert des Prozesses. */
  exitCode?: number;
  /** kind='shutdown' | 'exit': Laufzeit der Instanz in ms. */
  uptimeMs?: number;
  /** kind='outage': der nachgetragene Ausfall (FR-014). */
  outage?: OutageRecord;
  /** kind='startup': Version/PID zur Zuordnung. */
  pid?: number;
}
```

**Regeln**

- Anhängen ist die einzige Schreibart; die Reihenfolge in der Datei ist die zeitliche Reihenfolge
  (FR-015).
- `instanceId` verbindet `startup` und den zugehörigen Abgang (Scenario US2-5).
- Höchstens **ein** Abgangseintrag je Instanz: ein Once-Flag im Modul verhindert, dass
  `shutdown()` → `process.exit(0)` → `'exit'`-Handler doppelt schreibt (D8).
- Ein `outage`-Eintrag mit `silent: true` wird beim nächsten Start nachgetragen, wenn zum letzten
  `startup` kein Abgangseintrag existiert (FR-014).
- Jeder Schreibvorgang ist in `try/catch`; ein Fehlschlag ist folgenlos (FR-017).
- Rotation beim Start: > 1 MB → letzte 1000 Zeilen behalten (FR-016, D7).

---

## Entität: Ressourcen-Momentaufnahme (`ResourceSnapshot`)

Modul: `packages/shared/src/types.ts`. Nur im Arbeitsspeicher, nie persistiert.

```ts
export interface ResourceSnapshot {
  /** Freier Plattenplatz des Datenverzeichnisses in Bytes; null = nicht ermittelbar. */
  diskFreeBytes: number | null;
  /** Gesamtgrösse des Datenträgers in Bytes; null = nicht ermittelbar. */
  diskTotalBytes: number | null;
  /** Auslastung des Auslagerungsspeichers 0..1; null = nicht ermittelbar. */
  swapUsedRatio: number | null;
  swapUsedBytes: number | null;
  swapTotalBytes: number | null;
  /** Zahl der Features, für die gerade mindestens ein Lauf läuft. */
  activeFeatures: number;
  /** Erhebungszeitpunkt (ms). Die Oberfläche prüft daran das Alter (FR-021). */
  collectedAt: number;
}
```

**Regel zur Degradation** (FR-022): jede Kennzahl ist einzeln `null`-fähig. Ein Fehlschlag einer
Kennzahl lässt die übrigen unberührt — die Erhebung nutzt `Promise.allSettled`, kein `all`.

---

## Bewertung des Ressourcendrucks (`resourcePressure.ts`)

Reines Modul, Schwellen aus der Spec-Annahme:

```ts
export const DISK_NOTICE_BYTES = 10 * 1024 ** 3;  // 10 GB → Hinweis
export const DISK_WARN_BYTES   =  2 * 1024 ** 3;  //  2 GB → Warnung
export const SWAP_NOTICE_RATIO = 0.8;             // 80 %  → Hinweis
export const PARALLEL_NOTICE   = 2;               // ab 2 Features wird die Zahl genannt

export type PressureLevel = 'ok' | 'notice' | 'warn';

export interface PressureVerdict {
  level: PressureLevel;
  /** Kurzform für die Kopfleiste, z. B. „813 MB · Swap 80 % · 3 parallel". */
  summary: string;
  /** Ausformulierter Hinweis, wenn Ressourcendruck UND Parallelität zusammentreffen (FR-020, US3-4). */
  notice: string | null;
}
```

**Ableitung des Levels**

| Zustand | Level |
|---|---|
| `diskFreeBytes < 2 GB` | `warn` |
| `diskFreeBytes < 10 GB` **oder** `swapUsedRatio >= 0,8` | `notice` |
| sonst | `ok` |

Nicht ermittelbare Kennzahlen (`null`) gehen **nicht** in die Bewertung ein — Unwissen ist keine
Warnung (FR-022). In der Kurzform erscheinen sie als `–`.

---

## Änderung an bestehenden Typen

`packages/shared/src/types.ts`:

```ts
export type AttentionKind =
  | 'awaiting_input'
  | …
  | 'approval_required'
  | 'server_outage';   // NEU (FR-007)
```

Kein Migrationsschritt nötig: `attention.kind` ist `TEXT` ohne `CHECK`-Beschränkung
(`packages/server/src/db/database.ts:73`). Bestandszeilen sind unberührt.

**Folgeänderungen, die der Typ erzwingt** (TypeScript findet sie beim `typecheck`):

- `packages/web/src/components/AttentionInbox.tsx` — `KIND_META` ist ein
  `Record<AttentionKind, …>` und verlangt einen Eintrag.
- `packages/server/src/services/attentionReconciler.ts` — expliziter `case` (D14).

---

## Beziehungen

```
Heartbeat ──(detectOutage, now)──▶ OutageDetection
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
            OperationsEntry      AttentionItem        OutageRecord (im Speicher)
            kind='outage'        kind='server_outage'  ──▶ GET /api/system/status
            (immer)              (je Projekt mit           (FR-023)
                                  betroffenen Läufen)

executions(status='running') ──gruppiert nach project_id──▶ AffectedRun[] ──▶ Meldungstext
```
