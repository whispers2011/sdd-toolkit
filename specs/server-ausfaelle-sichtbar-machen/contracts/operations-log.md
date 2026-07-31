# Contract C2 — Betriebsprotokoll `operations.jsonl`

Öffentliches Dateiformat: Der Nutzer liest es ohne laufenden Server und ohne Werkzeug (FR-015).
Damit ist es ein Contract, kein Implementierungsdetail.

**Pfad**: `$SDD_DATA_DIR/operations.jsonl` (Default `~/.sdd-toolkit/operations.jsonl`)
**Modul**: `packages/server/src/services/operationsLog.ts`

---

## Format

Eine Zeile = ein JSON-Objekt = ein Ereignis. Keine umschliessende Liste, kein Komma am Zeilenende.
Anhängen ist die einzige Schreibart, damit die Dateireihenfolge die zeitliche Reihenfolge ist.

```jsonl
{"ts":1753876123456,"instanceId":"k3Jd9Xa2","kind":"startup","pid":42731}
{"ts":1753879750112,"instanceId":"k3Jd9Xa2","kind":"shutdown","signal":"SIGINT","uptimeMs":3626656}
{"ts":1753880012004,"instanceId":"pQ7zLm1B","kind":"startup","pid":43990}
{"ts":1753883550000,"instanceId":"pQ7zLm1B","kind":"uncaught","error":"TypeError: Cannot read properties of undefined (reading 'id')\n    at handleExit (orchestrator.ts:812:19)"}
{"ts":1753890000000,"instanceId":"rT4uYc8N","kind":"startup","pid":44810}
{"ts":1753890000010,"instanceId":"rT4uYc8N","kind":"outage","outage":{"from":1753884550000,"to":1753890000000,"durationMs":5450000,"affectedRuns":2,"silent":true,"undetermined":false}}
```

## Feldbedeutung

| Feld | Bei welcher Art | Bedeutung |
|---|---|---|
| `ts` | alle | Zeitpunkt des Ereignisses, ms seit Epoche |
| `instanceId` | alle | Kennung des Serverlaufs; verbindet `startup` mit seinem Abgang |
| `kind` | alle | `startup` \| `shutdown` \| `uncaught` \| `exit` \| `outage` |
| `pid` | `startup` | Prozesskennung |
| `signal` | `shutdown` | empfangenes Signal (`SIGINT`, `SIGTERM`, `SIGHUP`) |
| `error` | `uncaught` | Fehlerbeschreibung, auf 2000 Zeichen gekürzt |
| `exitCode` | `exit` | Rückgabewert des Prozesses |
| `uptimeMs` | `shutdown`, `exit` | Laufzeit der Instanz |
| `outage` | `outage` | nachgetragener Ausfall, Felder siehe [data-model.md](../data-model.md) |

## Zusicherungen

| # | Zusicherung | Bezug |
|---|---|---|
| C2.1 | Je Instanz genau ein `startup`-Eintrag, geschrieben vor jeder anderen Startarbeit | FR-012 |
| C2.2 | Je Instanz **höchstens ein** Abgangseintrag (`shutdown` oder `exit`); ein Once-Flag verhindert Dubletten aus `shutdown()` → `process.exit()` → `'exit'` | FR-013 |
| C2.3 | `uncaught` ist **kein** Abgang — der Fatal-Guard lässt den Server weiterlaufen; das Once-Flag bleibt unberührt | FR-013 |
| C2.4 | Fehlt zum letzten `startup` ein Abgangseintrag, schreibt der nächste Start einen `outage`-Eintrag mit `silent: true` | FR-014 |
| C2.5 | Jeder Schreibvorgang ist in `try/catch`; ein Fehlschlag (volle/schreibgeschützte Platte) wird verschluckt und beeinträchtigt Start, Betrieb und Abgang nicht | FR-017, US2-6 |
| C2.6 | Beim Start wird die Datei auf 1000 Zeilen zurückgeschnitten, sobald sie 1 MB überschreitet — atomar über Temp-Datei + `rename` | FR-016 |
| C2.7 | Der Abgangspfad schreibt **synchron** (`appendFileSync`); `process.on('exit')` verwirft asynchrone Arbeit | FR-013 |

## Modulschnittstelle

```ts
export class OperationsLog {
  constructor(dataDir: string);

  /** Rotation prüfen und ggf. kürzen. Einmal beim Start. */
  rotateIfNeeded(): void;

  /** Eintrag anhängen. Wirft nie. */
  append(entry: OperationsEntry): void;

  /** Abgangseintrag anhängen — nur der erste je Instanz wird geschrieben. */
  appendFarewell(entry: OperationsEntry): void;

  /** Die letzten n Einträge, älteste zuerst. Unlesbare Zeilen werden übersprungen. */
  tail(n: number): OperationsEntry[];
}
```

`tail()` bedient zwei Fragen beim Start: „gab es zum letzten `startup` einen Abgang?" (C2.4) und
„wie lautet der letzte registrierte Ausfall?" (FR-023, D13). Beschädigte Zeilen — etwa eine halb
geschriebene letzte Zeile nach `kill -9` — werden still übersprungen, nicht als Fehler behandelt.
