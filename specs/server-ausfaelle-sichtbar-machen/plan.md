# Implementation Plan: Server-Ausfälle sichtbar machen

**Branch**: `feature/server-ausfaelle-sichtbar-machen` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/server-ausfaelle-sichtbar-machen/spec.md`

## Summary

Der Server hinterlässt beim Verschwinden keine Spur — der Ausfall vom 30.07.2026 steht in keinem
einzigen Betriebsdatensatz. Das Feature schliesst diese Lücke mit drei Bausteinen, die aufeinander
aufbauen, aber einzeln tragen:

1. **Lebenszeichen + Lückenerkennung (P1)**: Der Server schreibt alle 30 s eine winzige,
   atomar ersetzte Datei `heartbeat.json` neben die Datenbank. Beim Start vergleicht eine **reine
   Funktion** in `@sdd/shared` das letzte Lebenszeichen mit der Startzeit; ist die Lücke grösser als
   90 s und war kein geordneter Abgang vermerkt, gilt der Server als unerwartet weg. Die betroffenen
   Läufe werden gelesen, **bevor** der bestehende Start-Reaper sie auf `orphaned` setzt, und je
   betroffenem Projekt entsteht genau eine Meldung `server_outage` in der bestehenden Übersicht
   „Braucht dich".
2. **Abgangsprotokoll (P2)**: `operations.jsonl` — eine JSON-Zeile je Start und Abgang, synchron
   angehängt, damit auch `process.on('exit')` noch schreiben kann. Anlässe werden unterschieden;
   ein stiller Abgang wird beim nächsten Start nachgetragen.
3. **Ressourcendruck (P3)**: `fs.statfs` für freien Plattenplatz, `sysctl vm.swapusage` für die
   Auslagerung, laufende Executions für die Parallelität. Bewertet von einer reinen Funktion mit den
   Schwellen aus der Spec, angezeigt in der Kopfleiste — samt letztem registriertem Ausfall.

Kein Datenbankschema-Wechsel, keine neue Abhängigkeit. Die Entscheidungen zu Mechanismen,
Ablageorten und Schwellen stehen mit Begründung in [research.md](./research.md) (D1–D18).

## Technical Context

**Language/Version**: TypeScript 5.8, ESM, Node ≥ 22 (`engines` im Repo-Root)

**Primary Dependencies**: keine neuen. Genutzt werden ausschliesslich Bordmittel —
`node:fs` (`statfs`, `appendFileSync`, `renameSync`), `node:child_process` (`execFile`),
`node:process` (Signal- und `exit`-Handler). Bestand: Fastify 5, better-sqlite3 12, React 19,
Tailwind 4, nanoid 5.

**Storage**: zwei Dateien im bestehenden Datenverzeichnis (`$SDD_DATA_DIR`, Default
`~/.sdd-toolkit`) — `heartbeat.json` und `operations.jsonl`. Bestehende SQLite-Datenbank nur
lesend (laufende Executions) und über den bestehenden `AttentionRepo` schreibend. **Keine
Migration.**

**Testing**: vitest 3 (`pnpm -r test`). Reine Logik in `@sdd/shared` mit gesetzten Zeitpunkten,
Datei- und Verdrahtungslogik im Server gegen ein temporäres Datenverzeichnis und
`openMemoryDatabase()`. Web hat im Repo keine Tests (`@sdd/web` → „keine Web-Tests (MVP)"); die
Oberfläche wird über [quickstart.md](./quickstart.md) Teil C abgenommen.

**Target Platform**: macOS (Entwicklung und Betrieb). Plattenplatz plattformneutral über
`fs.statfs`; Auslagerungsspeicher macOS-spezifisch, anderswo sauber `null` statt geraten (FR-022).

**Project Type**: pnpm-Monorepo, lokale Web-Anwendung — Fastify-Server (`@sdd/server`) + React-SPA
(`@sdd/web`) + gemeinsames pures Paket (`@sdd/shared`).

**Performance Goals**: Lebenszeichen ~100 Byte alle 30 s; Ressourcenerhebung bedarfsgesteuert mit
10 s Cache bei 20 s Polling. Prozessorlast im Leerlauf < 1 %, Startverzögerung ≤ 200 ms (SC-008).

**Constraints**: Kein Schreibvorgang darf den Server beenden (FR-011, FR-017, FR-024) — genau der
Zustand „Platte voll" ist der, in dem das Feature gebraucht wird. Der Abgangspfad muss **synchron**
schreiben, weil `process.on('exit')` asynchrone Arbeit verwirft. Die Erkennung muss vor
`orchestrator.reapOnBoot()` laufen, sonst zählt sie null betroffene Läufe.

**Scale/Scope**: ~2–4 Protokolleinträge je Serverlauf, Rotation bei 1 MB auf 1000 Zeilen. 4 neue
Server-Module, 2 neue reine Module, 1 neue Web-Komponente, 1 neuer HTTP-Endpunkt, 1 neue
`AttentionKind`-Variante.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist im Repo eine **unausgefüllte Vorlage** (`[PRINCIPLE_1_NAME]`,
`[GOVERNANCE_RULES]`, …). Es gibt damit keine ratifizierten Prinzipien, gegen die geprüft werden
könnte. Statt das Gate für erledigt zu erklären, wird gegen die im Repo tatsächlich geltenden und
schriftlich festgehaltenen Regeln geprüft — `CLAUDE.md` im Projektstamm und die im Code belegten
Konventionen.

| Regel | Quelle | Bewertung |
|---|---|---|
| Prozesse nie über generische Muster beenden (`pkill -f vite`, `killall node`) — die eigene Session ist Kindprozess des laufenden Toolkits | `CLAUDE.md` | **PASS** — die Abnahme läuft auf eigenen Ports (4899/4898) in eigenem Datenverzeichnis; beendet wird über `lsof -ti:4899` bzw. die gemerkte PID. Ausdrücklich als Warnblock in [quickstart.md](./quickstart.md) |
| Pure Logik in `@sdd/shared`, Nebenwirkungen im Server | belegt durch `phaseMachine`, `actionPolicy`, `worktreeStatus`, `lifecycleCatalog` | **PASS** — D16; `detectOutage` bekommt `now` als Parameter und liest nie `Date.now()` |
| Minimale Komplexität, keine Rückwärtskompatibilitäts-Hüllen | `CLAUDE.md` (global) | **PASS** — kein Migrationsschritt, keine neue Abhängigkeit, kein Hintergrund-Timer für die Kennzahlen (D11) |
| Der Server darf sich nicht selbst beenden | bestehender Fatal-Guard, `index.ts:240-249` | **PASS** — jeder neue Schreibvorgang liegt in `try/catch`; der Fatal-Guard bleibt unverändert und wird nur um einen Protokolleintrag ergänzt (D8) |
| Bestehende Wiederaufnahme bleibt zuständig | Spec-Annahme + `mergeQueue.resumeInterruptedOnBoot()` | **PASS** — dieses Feature meldet und repariert nichts; `run_interrupted` bleibt unberührt (C4.3) |
| Deutsche Prosa in Kommentaren, englische Bezeichner | durchgängig im Code | **PASS** |

**Ergebnis: PASS** (mit dem Vermerk, dass die Verfassung ungefüllt ist — das ist ein eigener
Mangel des Repos und kein Befund dieses Features).

**Re-Check nach Phase 1**: unverändert **PASS**. Das Design hat keine Verletzung nachgezogen; die
Tabelle „Complexity Tracking" bleibt leer.

## Project Structure

### Documentation (this feature)

```text
specs/server-ausfaelle-sichtbar-machen/
├── plan.md                          # Diese Datei
├── spec.md                          # Vorhanden
├── research.md                      # Phase 0 — D1–D18
├── data-model.md                    # Phase 1 — Entitäten, Ablage, Zustandsübergänge
├── quickstart.md                    # Phase 1 — Abnahmeleitfaden (inkl. kill -9)
├── checklists/
│   └── requirements.md              # Vorhanden
├── contracts/                       # Phase 1
│   ├── outage-detection.md          # C1 — reine Lückenerkennung
│   ├── operations-log.md            # C2 — Dateiformat operations.jsonl
│   ├── system-status-api.md         # C3 — GET /api/system/status
│   └── attention-item.md            # C4 — Meldungsart server_outage
└── tasks.md                         # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── outage.ts                    # NEU  detectOutage, formatOutageDuration, outageMessage (C1)
├── outage.test.ts               # NEU  alle sechs Fälle aus FR-026
├── resourcePressure.ts          # NEU  Schwellen, PressureLevel, Kurzform, Hinweistext
├── resourcePressure.test.ts     # NEU
├── types.ts                     # ÄND  Heartbeat, OutageRecord, OperationsEntry,
│                                #      ResourceSnapshot, SystemStatus; AttentionKind += server_outage
└── index.ts                     # ÄND  zwei Export-Zeilen

packages/server/src/
├── services/heartbeatStore.ts        # NEU  lesen/schreiben/markClean, atomar, wirft nie
├── services/heartbeatStore.test.ts   # NEU
├── services/operationsLog.ts         # NEU  append/appendFarewell/tail/rotateIfNeeded (C2)
├── services/operationsLog.test.ts    # NEU
├── services/outageMonitor.ts         # NEU  detectOnBoot, Takt, Abgangs-Handler, lastOutage
├── services/outageMonitor.test.ts    # NEU  Verdrahtung inkl. Startreihenfolge
├── services/resourceMonitor.ts       # NEU  statfs + sysctl + aktive Features, 10 s Cache
├── services/resourceMonitor.test.ts  # NEU  Swap-Parser, Degradation, Cache
├── services/attentionReconciler.ts   # ÄND  expliziter case 'server_outage' (C4.6/C4.7)
├── services/attentionReconciler.test.ts # ÄND  zwei Fälle
├── db/repos.ts                       # ÄND  ExecutionRepo.listRunning()
├── api/server.ts                     # ÄND  GET /api/system/status (C3)
└── index.ts                          # ÄND  Verdrahtung, Startreihenfolge, Abgangs-Handler

packages/web/src/
├── components/SystemStatus.tsx       # NEU  Kopfleisten-Anzeige + Aufklapp-Details (D17)
├── components/AttentionInbox.tsx     # ÄND  KIND_META + aufklappbare Ausfall-Zeile (C4.8)
├── App.tsx                           # ÄND  SystemStatus in die Kopfleiste
└── api.ts                            # ÄND  systemStatus()
```

**Structure Decision**: Bestehende Monorepo-Struktur, keine neuen Pakete und keine neuen
Verzeichnisse. Die Aufteilung folgt der im Repo etablierten Trennung: entscheidende Logik als reines
Modul in `packages/shared/src/` (dort liegen bereits `phaseMachine`, `actionPolicy`,
`worktreeStatus`), Datei- und Betriebssystemzugriff als Service in
`packages/server/src/services/`, Anzeige als Komponente in `packages/web/src/components/`. Tests
liegen wie überall im Repo als `*.test.ts` **neben** der Datei, die sie prüfen — kein eigener
`tests/`-Baum.

## Umsetzung in Schnitten

Die drei User Stories bleiben unabhängig lieferbar, wie die Spec es verlangt.

**Schnitt 1 (US1, P1) — trägt allein die geforderte Abnahme**
`shared/outage.ts` + `heartbeatStore.ts` + `ExecutionRepo.listRunning()` + `outageMonitor.detectOnBoot()`
+ `AttentionKind` + Reconciler-Fall + `AttentionInbox`-Eintrag + Verdrahtung in `index.ts`.
Nach diesem Schnitt erfüllt `kill -9` → Neustart → Meldung die Abnahmebedingung. Das Protokoll ist
dabei bereits als Ablageort nötig (der Ausfall wird auch ohne betroffene Läufe festgehalten, US1-6)
— `operationsLog.ts` gehört deshalb mit in diesen Schnitt, seine Abgangs-Handler noch nicht.

**Schnitt 2 (US2, P2)** — Abgangs-Handler (`shutdown`, `exit`, `uncaught`), `appendFarewell` mit
Once-Flag, Nachtrag des stillen Abgangs, Rotation.

**Schnitt 3 (US3, P3)** — `resourcePressure.ts`, `resourceMonitor.ts`, `GET /api/system/status`,
`SystemStatus.tsx`, Einbau in die Kopfleiste.

## Risiken und wie der Plan sie adressiert

| Risiko | Adressiert durch |
|---|---|
| Erkennung läuft nach dem Reaper → zählt immer null betroffene Läufe | Verbindliche Startreihenfolge in [C4](./contracts/attention-item.md) + eigener Test (quickstart Teil A) |
| Doppelter Abgangseintrag durch `shutdown()` → `process.exit()` → `'exit'` | Once-Flag in `OperationsLog.appendFarewell()` (C2.2) |
| Ein neuer Schreibvorgang beendet den Server im Fehlerfall — im schlimmsten Moment | Jeder Aufruf in `try/catch`, Abnahmeschritt B8 mit schreibgeschütztem Verzeichnis |
| Phantom-Ausfälle bei verzögertem Takt oder zwei Instanzen | Schwelle 3× Takt (D2); jeder Takt schreibt `clean:false` neu (D5) |
| `default: true` im Reconciler kippt später und löst Ausfallmeldungen auf | Expliziter `case` statt Verlass auf den Default, mit Test (D14, C4.6/C4.7) |
| Abnahme schiesst die laufende Toolkit-Instanz und die eigene Session ab | Eigene Ports und eigenes Datenverzeichnis, Warnblock als erster Abschnitt der quickstart |

## Complexity Tracking

> Keine Verletzungen der geprüften Regeln — die Tabelle bleibt leer.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
