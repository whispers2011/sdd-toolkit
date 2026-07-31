# Implementation Plan: Chat- und Phasen-Pfad — gemeinsamer Kern

**Branch**: `feature/chat-und-phasen-pfad-gemeinsamer-kern` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/chat-und-phasen-pfad-gemeinsamer-kern/spec.md`

## Summary

Drei Aufgaben, die heute in `orchestrator.ts` und `chatWorkService.ts` doppelt stehen, ziehen in
einen gemeinsamen Kern unter `packages/server/src/services/core/`: **Arbeitskopie anlegen**
(`workspace.ts`), **Session sicherstellen** (`sessionCore.ts`) und **Turn messen**
(`runMeter.ts`). Beide Dienste bleiben eigenständig und rufen den Kern auf; ihre Unterschiede
gehen als Auftrag hinein (Bezugsobjekt, Namensbildung, System-Prompt, Fehlerdarstellung), nicht
als zweite Ausschrift derselben Aufgabe.

Der Nutzen fällt sofort an, weil der Phasen-Pfad der gepflegte Stand ist: Der Chat erbt mit dem
Kern die Puffer-Anmeldung, den monotonen Akkumulator, das Nachlauffenster, den Subagenten-Anteil
und die Fallunterscheidung der Transkript-Startmarke. Dazu kommen zwei Korrekturen, die erst
durch die Zusammenlegung sichtbar wurden:

- **Die Anmeldung des Ereignispuffers wird zählend** (FR-007a). Heute löscht das Ende eines
  Nachlauffensters den Puffer der ganzen *Session* (`telemetry.forget`). Bei Chats ist das der
  Regelfall, nicht der Randfall — Turns liegen Sekunden auseinander, das Fenster ist fünf
  Minuten offen. Künftig hält ein Zähler, und der letzte Abmelder überlässt den Puffer dem
  Kehraus nach Alter.
- **Ein Chat-Turn bekommt eine Dauer.** `executions.start()` nimmt einen optionalen
  Startzeitpunkt entgegen; der Chat gibt den Beginn seines Turn-Fensters mit. Heute haben alle
  33 chat_work-Läufe `started_at == finished_at` — strukturell, weil der Lauf erst beim Abschluss
  angelegt wird. Der Lauf bleibt atomar (keine offene `running`-Zeile), die Dauer stimmt
  trotzdem.

Der Phasen-Pfad verbucht nach der Umstellung dieselben Zahlen und sendet dieselben Ereignisse wie
vorher. Was doppelt bleiben *darf*, ist in FR-019 aufgezählt und wird nicht angefasst; die
Entscheidungen und die verworfenen Alternativen stehen in [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.8, Node.js ≥ 22, ESM · pnpm-Workspace 10

**Primary Dependencies**: Fastify 5, better-sqlite3 12, node-pty 1, chokidar 4, React 19 +
Tailwind. **Keine neue Abhängigkeit** — dieses Feature verschiebt Code und ändert an drei Stellen
Verhalten.

**Storage**: SQLite unter `~/.sdd-toolkit`. **Keine Migration.** Das einzige neue Datenfeld
(`ExecutionStartInput.startedAt`) schreibt in die bereits vorhandene Spalte
`executions.started_at`.

**Testing**: Vitest je Paket (`pnpm test`), `tsc --noEmit` je Paket (`pnpm typecheck`).
Schwerpunkt: die drei Kern-Bausteine mit Attrappen für `ExecutionRepo`, `TelemetryStore`,
`PtySessionManager` und `WorktreeManager` — dem Muster der bestehenden Tests in
`orchestrator.test.ts` und `chatWorkService.test.ts` folgend. Dazu ein Quellcode-Wächter gegen
die Rückkehr des Zwillings.

**Target Platform**: Lokaler Entwicklerrechner (macOS/Linux), Server an `127.0.0.1`.

**Project Type**: TypeScript-Monorepo, drei Pakete: `packages/shared` (reine Logik),
`packages/server` (Fastify, PTY, SQLite), `packages/web` (React-SPA). Dieses Feature berührt
**nur `packages/server`**.

**Performance Goals**: Keine. Es entsteht kein zusätzlicher Aufruf pro Turn — die Anmeldung des
Ereignispuffers ist ein `Map`-Zugriff, die Turn-Fenster-Karte hat einen Eintrag je laufender
Chat-Session.

**Constraints**:
- Bestehende Tests beider Pfade müssen ohne Anpassung ihrer Erwartungen grün bleiben (FR-017).
- Der Phasen-Pfad darf sich nach aussen nicht verändern: gleiche Zahlen, gleiche Ereignisse
  (FR-018).
- Sichtbares Verhalten des Chats ändert sich nur bei der Verbrauchsmessung; keine neuen
  Meldungen in der Oberfläche (Assumptions der Spec).
- Nach jedem Umstellungsschritt ist die Suite grün — die Umstellung darf nicht als ein einziger
  Sprung erfolgen.
- Der Zuordnungswächter bleibt feature-only (FR-020).

**Scale/Scope**: Vier berührte Dateien im Bestand (`orchestrator.ts`, `chatWorkService.ts`,
`telemetryStore.ts`, `db/repos.ts`), vier neue Dateien im Kern plus Tests. Netto erwartet:
`orchestrator.ts` verliert ~200 Zeilen, `chatWorkService.ts` ~90.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` steht im Auslieferungszustand — sämtliche Prinzipien sind
Platzhalter (`[PRINCIPLE_1_NAME]`, `[PRINCIPLE_1_DESCRIPTION]`, …). Es gibt daher **keine Gates,
die dieser Plan verletzen oder erfüllen könnte**; die Prüfung entfällt mangels Inhalt, nicht
mangels Beachtung.

Ersatzweise gelten die im Repository niedergeschriebenen Regeln:

| Regel (Quelle) | Bewertung |
|---|---|
| Prozesse nie über generische Muster beenden (`CLAUDE.md`) | Betrifft die Live-Gegenprobe in [quickstart.md](./quickstart.md): eigene Instanz nur auf eigenen Ports (4898/4899), abgeräumt über gemerkte PID bzw. `lsof -ti:<port>`. Ausdrücklich so dokumentiert; 4820/4830 bleiben unangetastet. |
| Minimale Komplexität, kein Over-Engineering (globale Vorgaben) | Keine neue Abhängigkeit, kein neues Paket, keine Vererbungshierarchie, keine Migration. Zwei der drei Bausteine sind Klassen — und zwar genau die beiden mit Gedächtnis (research.md D2). |
| Keine Rückwärtskompatibilitäts-Krücken für entfernten Code | Die alten Methoden werden **entfernt**, nicht als Weiterleitung stehen gelassen. Genau das prüft der Wächter aus US4. |
| Fehler beheben, ohne den Umkreis aufzuräumen | Der Plan fasst nur an, was die drei Aufgaben betrifft. `handleExit` und `handleStatusChange` bleiben doppelt — die Spec merkt sie als Folge-Feature vor. |

**Ergebnis**: Gate bestanden (keine definierten Gates). Nach Phase 1 erneut geprüft —
unverändert; das Design fügt weder Abhängigkeit noch Paket noch persistierte Struktur hinzu.

## Project Structure

### Documentation (this feature)

```text
specs/chat-und-phasen-pfad-gemeinsamer-kern/
├── plan.md              # Diese Datei
├── research.md          # Phase 0: D1–D10, am Quellcode belegt
├── data-model.md        # Phase 1: sieben Datenformen, keine Migration
├── quickstart.md        # Phase 1: Prüfszenarien je User Story + Live-Gegenprobe
├── contracts/
│   ├── workspace.md         # Arbeitskopie anlegen        (FR-003)
│   ├── session-core.md      # Session sicherstellen       (FR-001)
│   ├── run-meter.md         # Turn messen                 (FR-002)
│   └── telemetry-store.md   # geänderte Zusicherung       (FR-007a)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — NICHT von /speckit-plan erzeugt
```

### Source Code (repository root)

```text
packages/server/src/
├── services/
│   ├── core/                          # NEU — der gemeinsame Kern
│   │   ├── workspace.ts               # NEU: ensureWorkspace (FR-003)
│   │   ├── sessionCore.ts             # NEU: SessionCore.ensure (FR-001, FR-013…FR-016)
│   │   ├── runMeter.ts                # NEU: RunMeter, markSession, startOffsetIn (FR-002, FR-006…FR-012)
│   │   ├── workspace.test.ts          # NEU
│   │   ├── sessionCore.test.ts        # NEU
│   │   ├── runMeter.test.ts           # NEU
│   │   └── singleImplementation.test.ts  # NEU: Wächter gegen den Zwilling (US4, SC-001)
│   ├── orchestrator.ts                # ÄNDERN: ruft den Kern; verliert Messkaskade,
│   │                                  #          Akkumulator, Nachtrag, Session-/Worktree-Anlage
│   └── chatWorkService.ts             # ÄNDERN: ruft den Kern; verliert meterTurn/usageForTurn
│                                      #          und die eigene Session-/Worktree-Anlage
├── telemetry/telemetryStore.ts        # ÄNDERN: hold/release zählend (FR-007a)
├── db/repos.ts                        # ÄNDERN: ExecutionStartInput.startedAt (optional)
└── index.ts                           # ÄNDERN: SessionCore + RunMeter aufbauen und beiden
                                       #          Diensten mitgeben
```

Unberührt: `packages/shared` (die reinen Funktionen `selectEventsForWindow`, `summarizeEvents`,
`sumUsage` bleiben, wie sie sind), `packages/web` (der Chat zieht seine Ansicht über das
bestehende Ereignis `execution_updated` nach), `db/database.ts` (keine Migration).

**Structure Decision**: Bestehende Drei-Paket-Struktur, unverändert. Die einzige strukturelle
Zutat ist der Ordner `services/core/` — nach demselben Muster, mit dem `telemetry/` die vier
Bausteine der Messung gebündelt hat. Er liegt unter `services/`, weil ausschliesslich Dienste ihn
benutzen; ein Ordner auf oberster Ebene würde eine tool-weite Rolle behaupten, die diese drei
Bausteine nicht haben (research.md D1).

## Umsetzung in Schritten

Vier Schritte. Nach jedem ist `pnpm test` und `pnpm typecheck` grün — das ist die Bedingung, unter
der die Spec eine schrittweise Umstellung erlaubt.

### Schritt 1 — Arbeitskopie (Baumaterial, Abnahme erst mit Schritt 3)

1. `services/core/workspace.ts` mit `ensureWorkspace()` nach
   [contracts/workspace.md](./contracts/workspace.md): idempotent, mit Waisen-Erholung, wirft roh.
2. `Orchestrator.createFeature` und der Worktree-Block in `ensureSessionInner` rufen es auf.
3. Test: vorhandene Kopie wird übernommen; fehlendes Verzeichnis bei gesetztem `recordedPath`
   wird aufgeräumt und neu angelegt; der Fehler kommt unverändert heraus.

> Die Reihenfolge weicht bewusst von den Prioritäten ab: US3 ist P3, aber `ensureWorkspace` ist
> Baumaterial für Schritt 3. Die **Abnahme** von US3 fällt trotzdem erst mit Schritt 3 zusammen,
> weil der Chat die Arbeitskopie erst dann über den gemeinsamen Weg anlegt (research.md D10).

### Schritt 2 — US1: Turn messen (P1, der Schritt mit dem sofortigen Nutzen)

4. **Puffer zählend anmelden**: `TelemetryStore.held: Set` → `holds: Map<string, number>` nach
   [contracts/telemetry-store.md](./contracts/telemetry-store.md). Test für den überlappenden
   Fall (Turn A meldet ab, während Turn B noch offen ist).
5. **`ExecutionStartInput.startedAt`** (optional, Vorgabe `Date.now()`) in `db/repos.ts`. Keine
   Migration; die übrigen sieben Aufrufer bleiben unverändert.
6. **`services/core/runMeter.ts`**: `RunMark`, `markSession`, `startOffsetIn`, `RunMeter` mit
   Kaskade, Akkumulator, Anmeldung, Nachtrag und `openTurn`/`closeTurn`/`abandon` — vollständig
   in [contracts/run-meter.md](./contracts/run-meter.md). Inhaltlich ist das der bestehende
   Orchestrator-Code, verschoben; neu sind nur die drei Turn-Fenster-Methoden und `release`
   statt `forget`.
7. **Orchestrator umhängen**: `finishWithMetering`, `meterFromTelemetry`, `meterTurn`,
   `scheduleLateReconcile`, `reconcileTranscriptTail`, `telemetryAccum*`, `startOffsetIn`,
   `transcriptMarkFor`, `TelemetryAccum`, `emptyUsageTotals`, `addTotals` entfernen;
   `RunningPhase` als `RunMark & { phase; promptConfirmed }` führen; `persistTranscriptRange`
   bleibt und hängt am `onApplied`-Rückruf.
8. **Chat umhängen**: `meterTurn`, `usageForTurn`, `turnStartedAt`, `turnTranscriptOffset`
   entfernen; in `handleStatusChange` bei `status === 'working'` → `openTurn`, beim Effekt
   `turn_completed` → `closeTurn`; in `handleExit` → `abandon`.
9. Tests: die sechs Szenarien aus US1, dazu der Gleichstand Chat/Phase bei identischen Meldungen
   (SC-002) und die Turn-Dauer > 0.

Nach diesem Schritt ist der teuerste Teil des Problems weg — auch dann, wenn Session und
Arbeitskopie noch doppelt wären.

### Schritt 3 — US2 + US3: Session sicherstellen und Arbeitskopie (P2/P3)

10. **`services/core/sessionCore.ts`** nach [contracts/session-core.md](./contracts/session-core.md):
    In-Flight-Karte, Auflösefunktion innerhalb des Schutzes, Ablauf 1–11.
11. **`Orchestrator.ensureSession`** wird ein Aufruf mit `key = 'feature:<id>'` und einer
    Auflösefunktion, die die heutige Reihenfolge beibehält: erst `ptys.forFeature`, dann die
    Prüfung auf abgeschlossenes Feature.
12. **`ChatWorkService.ensure`** wird ein Aufruf mit `key = 'chat:<projectId>'`; `wrapError`
    liefert die beiden `ChatError(503, …)` zeichengleich wie heute. `ensureUnlocked`,
    `ensuring` und der eigene Worktree-Block entfallen.
13. Tests: 20 × zwei gleichzeitige Aufrufe je Pfad (SC-005), tote Session-Kennung, laufende
    Session, beide Fehlerbilder, Waisen-Erholung im Chat.

### Schritt 4 — US4: der Wächter und die Buchführung

14. **`services/core/singleImplementation.test.ts`**: liest `packages/server/src` rekursiv (ohne
    `*.test.ts`) und lässt je Merkmal genau eine Fundstelle zu; die einzige Ausnahme
    (`ptys.spawn` im Projekt-Terminal, `kind: 'shell'`) steht mit Begründung in der
    Erlaubnisliste (research.md D9).
15. **Regressionstest FR-020**: `checkWorkWithoutRun` schlägt für eine arbeitende
    chat_work-Session **nicht** an — der Filter auf `kind === 'feature'` bleibt.
16. **`index.ts`**: `SessionCore` und `RunMeter` einmal aufbauen und beiden Diensten mitgeben.
17. **Stichprobe SC-008** durchführen und das Ergebnis festhalten (quickstart.md §4.2).

## Risiken und wie der Plan sie auffängt

| Risiko | Auffangen |
|---|---|
| **Der Phasen-Pfad verbucht nach der Umstellung anders** (FR-018) | Schritt 2 verschiebt Code, ohne ihn umzuschreiben. Die bestehenden Metering-Tests (`orchestrator.test.ts:412–619`) greifen weiter über dieselben Namen; sie sind die Abnahme dieses Schritts und werden **nicht** angepasst. |
| **Ein Testmock kennt `release` nicht** und wirft | Die Attrappe in `orchestrator.test.ts:421` definiert nur `eventsFor` und `forget`. Sie bekommt `release` ergänzt — eine Ergänzung der Attrappe, keine Änderung einer Erwartung (FR-017 bleibt erfüllt). |
| **Turn-Fenster öffnet nie** (kein `working`-Übergang, weil Hooks und Transkript ausfallen) | `closeTurn` öffnet rückwirkend mit dem Ende des Vorgängerturns, ersatzweise `session.startedAt`. Dauer nie 0, nie negativ (research.md D4). |
| **Hold-Leck**: eine Marke bleibt angemeldet, ihr Puffer altert nie aus | Jeder Pfad, der ein Fenster öffnet, gibt es wieder frei: regulär am Fensterende, bei Sessionende über `abandon`. Der Zähler geht nie unter 0. |
| **Reihenfolge-Fallstrick**: „läuft schon eine Session?" vs. „Feature abgeschlossen?" | Ausdrücklich als Vorgabe in [contracts/session-core.md](./contracts/session-core.md) festgehalten und in Schritt 3 als eigener Punkt geführt, statt beim Umbau nebenbei zu entstehen. |
| **Der Chat bekommt versehentlich Phasen-Verhalten**, das er nicht haben soll | FR-019 und FR-020 sind als Liste in research.md D8 geführt; Schritt 4 nagelt den Zuordnungswächter mit einem Test fest. |
| **Grosser Umbau in einem Sprung** | Vier Schritte, nach jedem eine grüne Suite. Schritt 2 liefert allein bereits den bezifferten Nutzen. |
| **Der Zwilling kommt zurück** | Der Wächter aus Schritt 4 läuft im bestehenden `pnpm test` — dem Tor, das jede Phase ohnehin passiert. |

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Keine Verletzungen zu rechtfertigen — die Constitution definiert keine Gates, und der Plan führt
weder eine neue Abhängigkeit noch ein neues Paket noch eine Migration ein. Die einzige
strukturelle Zutat ist der Ordner `packages/server/src/services/core/`; er ersetzt doppelten Code
durch einen Ort und ist damit die Verringerung, nicht die Erhöhung der Komplexität, die dieses
Feature bezweckt.
