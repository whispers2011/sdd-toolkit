# Phase 1 — Datenmodell: Chat- und Phasen-Pfad, gemeinsamer Kern

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Datum**: 2026-07-31

Dieses Feature führt **keine neue persistierte Entität** ein und braucht **keine Migration**.
Was hier beschrieben ist, sind die Datenformen des gemeinsamen Kerns — überwiegend flüchtig, im
Speicher des Serverprozesses. Die einzige Berührung mit der Datenbank ist ein zusätzliches,
optionales Eingabefeld beim Anlegen eines Laufs (§6) auf einer Spalte, die es bereits gibt.

---

## 1. Arbeitskopie-Auftrag (`WorkspaceSpec`)

Was gebraucht wird, um eine Arbeitskopie idempotent sicherzustellen — die Aufgabe aus FR-003.

| Feld | Typ | Bedeutung | Phasen-Pfad | Chat-Pfad |
|---|---|---|---|---|
| `project` | `Project` | Repo-Pfad, Vorgabezweig, Id + Name (für den Ordnernamen) | Projekt des Features | Projekt der Unterhaltung |
| `name` | `string` | Verzeichnisname der Arbeitskopie | `feature.name` (Slug) | `chat-<conversationId>` |
| `branch` | `string` | Zweigname | `feature/<slug>` | `chat/<conversationId>` |
| `recordedPath` | `string \| null` | zuletzt bekannter Pfad; fehlt er auf der Platte, wird der verwaiste Eintrag aufgeräumt | `feature.worktreePath` (aus der DB) | `worktrees.pathFor(project, 'chat-<id>')` |

**Regeln**

- R1 — Ist `recordedPath` gesetzt und existiert das Verzeichnis **nicht**, wird zuerst
  `worktrees.remove(projectPath, recordedPath)` best-effort gerufen (räumt den
  Registry-Eintrag ab), danach neu angelegt. Heute nur im Phasen-Pfad
  (`orchestrator.ts:273–275`) — der Chat erbt es (US3 Szenario 2).
- R2 — Das Anlegen selbst bleibt `WorktreeManager.create()`: idempotent und je (Repo, Zweig)
  serialisiert. Es wird **nicht** ersetzt (Assumption der Spec).
- R3 — Der Rückgabewert ist der tatsächliche Pfad; er kann von `recordedPath` abweichen, wenn
  der Zweig bereits anderswo ausgecheckt ist (`worktrees.ts:201`).

**Zustandsübergänge**

```text
kein Eintrag ──────────────► angelegt
Eintrag + Ordner da ───────► unverändert übernommen (idempotent)
Eintrag ohne Ordner ───────► aufgeräumt ──► neu angelegt        (R1)
Anlegen scheitert ─────────► Fehler, vom Pfad eingekleidet      (FR-005)
```

---

## 2. Session-Auftrag (`SessionSpec`)

Was gebraucht wird, um eine Session sicherzustellen — die Aufgabe aus FR-001. Der Auftrag wird
**innerhalb** des Doppelstart-Schutzes erzeugt (research.md D3), nicht davor.

| Feld | Typ | Bedeutung |
|---|---|---|
| `project` | `Project` | Bezugsprojekt |
| `featureId` | `string \| null` | Bezugsobjekt Feature (Phasen-Pfad) |
| `conversationId` | `string \| null` | Bezugsobjekt Unterhaltung (Chat-Pfad) |
| `kind` | `'feature' \| 'chat_work'` | Session-Art, wandert in PTY-Registry und `sessions`-Tabelle |
| `existing` | `LiveSession \| undefined` | bereits laufende Session dieses Bezugsobjekts; ist sie da, endet der Vorgang sofort (FR-016) |
| `workspace` | `WorkspaceSpec` | §1 |
| `previous` | `{ id; claude_session_id } \| null` | Resume-Kandidat aus der `sessions`-Tabelle |
| `automation` | `AutomationSettings` | aufgelöst (global → Projekt → Feature); bestimmt den Berechtigungsmodus (FR-015) |
| `appendSystemPrompt` | `string \| undefined` | nur Chat (`buildChatWorkSystemPrompt`) |
| `model` | `string \| undefined` | nur Chat (`deps.model`) |
| `onWorktreeReady` | `(path) => void \| undefined` | Pfad beim Bezugsobjekt vermerken (`features.setWorktree`) |
| `wrapError` | `(stage, err) => Error \| undefined` | Fehlerdarstellung des Pfads (FR-005) |

`stage` ist `'worktree' | 'spawn'` — genau die beiden Stellen, an denen der Chat heute mit
`ChatError(503, …)` antwortet (`chatWorkService.ts:128`, `:160`).

**Invarianten**

- I1 — Genau eines von `featureId` / `conversationId` ist gesetzt.
- I2 — Der Schlüssel des Doppelstart-Schutzes ist `feature:<featureId>` bzw.
  `chat:<projectId>`. Die unterschiedliche Wahl ist beabsichtigt: der Chat hat höchstens eine
  aktive Unterhaltung je Projekt, und die wird erst *innerhalb* des Schutzes ermittelt.
- I3 — Eine gespeicherte Claude-Session-Kennung wird nur fortgesetzt, wenn
  `locateTranscript(worktreePath, id)` sie findet; sonst wird sie in der Datenbank auf `null`
  gesetzt und verworfen (FR-014).

**Zustandsübergänge**

```text
Aufruf ─► Schutz belegt?  ──ja──► dasselbe Versprechen zurückgeben        (FR-013)
            │nein
            ▼
        Auftrag auflösen (kann werfen: Projekt/Feature-Vorprüfung)
            ▼
        läuft schon eine? ──ja──► zurückgeben, nichts weiter              (FR-016)
            │nein
            ▼
        Arbeitskopie sicherstellen (§1) ─► onWorktreeReady
            ▼
        Resume prüfen (I3) ─► argv bauen ─► spawn ─► sessions.create
            ▼
        LiveSession
```

---

## 3. Lauf-Marke (`RunMark`)

Der gemeinsame Nenner eines messbaren Laufs — die Aufgabe aus FR-002. Heute existiert sie nur im
Phasen-Pfad, eingebettet in `RunningPhase` (`orchestrator.ts:131`).

| Feld | Typ | Bedeutung |
|---|---|---|
| `executionId` | `string` | Zeile in `executions` |
| `startedAt` | `number` | Beginn des Laufs — untere Grenze des Ereignisfensters |
| `scrollbackStart` | `number` | Offset im Terminal-Puffer, für die Schätzung |
| `transcriptOffsetStart` | `number` | Byte-Offset im Transkript beim Start |
| `transcriptPathStart` | `string \| null` | Transkriptdatei beim Start; `null` = beim Start unbekannt |
| `promptText` | `string` | Eingabetext für die Schätzung (Chat: leer) |
| `model` | `string \| undefined` | Modell für die Schätzung (Chat: gesetzt, Phase: nicht) |

`RunningPhase` wird künftig als `RunMark & { phase; promptConfirmed }` geführt — dieselben
Felder, nur nicht mehr zweimal beschrieben.

**Ableitung der Transkript-Startmarke** (`startOffsetIn`, aus dem Orchestrator in den Kern
gezogen — drei Fälle, die nicht dasselbe sind):

| Lage beim Start | Startmarke |
|---|---|
| gleiche Datei wie beim Start | der gemerkte Byte-Offset |
| Datei wechselte während des Laufs (`/clear`) | 0 — die neue Datei gehört ganz diesem Lauf |
| beim Start unbekannt (`transcriptPathStart === null`) | `offsetAtTimestamp(path, startedAt)` |

Der Chat bekommt diese Fallunterscheidung neu; heute misst er ab einem selbst geführten Offset
ohne Rücksicht auf einen Dateiwechsel (`chatWorkService.ts:437`).

---

## 4. Offenes Turn-Fenster (`OpenTurn`)

Flüchtiger Zustand des Kerns je Session — die Klammer zwischen „der Agent beginnt zu arbeiten"
und „der Lauf ist verrechnet".

| Feld | Typ | Bedeutung |
|---|---|---|
| `sessionId` | `string` | Marke des Ereignispuffers |
| `startedAt` | `number` | erster Übergang nach `working` (research.md D4) |
| `mark` | `Omit<RunMark, 'executionId'>` | §3, beim Öffnen fotografiert |
| `held` | `boolean` | ob `telemetryStore.hold` für dieses Fenster gezogen wurde |

**Lebenszyklus**

```text
→ working (erstmalig)   openTurn()   Fenster auf, hold(sessionId)
→ working (erneut)      openTurn()   No-op — dasselbe Fenster                (Rückfrage mitten im Turn)
→ turn_completed        closeTurn()  Lauf anlegen (startedAt=Fenster), messen, verbuchen
                                     Nachtrag planen (8 s / 5 min)
→ 5 min nach Abschluss               release(sessionId), Akkumulator verwerfen
→ Session endet vorher  abandon()    Fenster verwerfen, release(sessionId), nichts verbuchen
```

Der letzte Übergang ist der Edge Case der Spec „Leerlauf-Reaper beendet eine Chat-Session, für
die noch ein Turn-Zustand im Speicher steht": abgeräumt **ohne** halbe Messung.

Im Phasen-Pfad tritt `OpenTurn` nicht auf — dort öffnet `launchPhase` den Lauf explizit und
`RunningPhase` ist bereits die Klammer. Der Kern bietet beides an: `openTurn/closeTurn` für den
Chat, `finish(session, mark, exitCode)` für den Phasen-Pfad, die auf denselben Messweg münden.

---

## 5. Fortgeschriebene Summe je Lauf (`TelemetryAccum`)

Unverändert übernommen aus `orchestrator.ts:104`, nur verschoben. Die Entität, die FR-008
(Monotonie) trägt.

| Feld | Typ | Bedeutung |
|---|---|---|
| `seen` | `Set<string>` | verrechnete `requestId`s — verhindert Doppelzählung (FR-010) |
| `total` | `UsageTotals` | wächst nur |
| `byOrigin` | `Record<'main'\|'subagent'\|'auxiliary', UsageTotals>` | Subagenten-Anteil (Chat neu) |
| `model` | `string \| null` | zuletzt gemeldet |

**Regeln**

- R4 — Schlüssel ist die `executionId`. Zwei Läufe derselben Session haben getrennte
  Akkumulatoren (Edge Case „Chat-Turn und Phasenlauf gleichzeitig im selben Projekt").
- R5 — `costMicros` bleibt `null`, solange keine Meldung einen Betrag trug — aus „nichts
  gemeldet" darf keine gemessene 0 werden.
- R6 — Verworfen wird der Akkumulator erst am Ende des Nachlauffensters.

**Verbuchte Felder eines Laufs** — nach der Zusammenlegung für Chat und Phase identisch
(Clarification vom 30.07.2026): `tokens`, `input_tokens`, `output_tokens`, `cache_read_tokens`,
`cache_creation_tokens`, `tokens_source`, `cost_micros`, `model`, `telemetry_final_at` sowie
`subagent_tokens` / `subagent_cost_micros`, sofern der Turn Subagenten erzeugt hat. Kein
chat-eigenes Feld, keine zweite Rechenvorschrift.

---

## 6. Anmeldung des Ereignispuffers (`TelemetryStore.holds`)

**Änderung an einer bestehenden Struktur.**

| vorher | nachher |
|---|---|
| `held: Set<string>` | `holds: Map<string, number>` |
| `hold(key)` → eintragen | `hold(key)` → Zähler +1 |
| `release(key)` → austragen | `release(key)` → Zähler −1; bei 0 austragen (nie negativ) |
| `forget(key)` → Puffer weg + austragen | unverändert |
| `sweep` überspringt `held.has(key)` | überspringt `holds.has(key)` |

**Regeln**

- R7 — Anmelden und Abmelden gehören paarweise zu **einem Lauf** (FR-007a).
- R8 — Das Abmelden des letzten Laufs verwirft den Puffer **nicht**; er unterliegt danach wieder
  dem Kehraus nach Alter. Der heutige Aufruf `telemetry?.forget(session.id)` am Ende des
  Nachlauffensters (`orchestrator.ts:1003`) wird durch `release(session.id)` ersetzt.
- R9 — Der Speicherdeckel `maxEventsPerKey` bleibt unberührt.

---

## 7. Laufbeginn beim Anlegen (`ExecutionStartInput.startedAt`)

**Einzige Berührung mit der Datenbank.**

| Feld | Typ | Vorgabe | Wer setzt es |
|---|---|---|---|
| `startedAt` | `number \| undefined` | `Date.now()` | nur der Chat-Pfad (Beginn des Turn-Fensters) |

Die Spalte `executions.started_at` existiert; `start()` schreibt heute fest `Date.now()`
(`repos.ts:446`). **Keine Migration.** Alle übrigen sieben Aufrufer von `executions.start()`
(Merge-Queue, Gates, Q&A-Chat, Phasen) geben das Feld nicht mit und verhalten sich unverändert
(FR-018).

**Wirkung**: chat_work-Läufe bekommen `finished_at − started_at > 0`. Heute haben **alle 33**
die Dauer 0 (Clarification vom 30.07.2026) — die Läufe-Ansicht rechnet damit
(`ExecutionsView.tsx:383`), Kosten pro Minute werden bildbar, und eine Fehlstart-Regel über die
Dauer kann für den Chat überhaupt erst greifen.

---

## Was ausdrücklich unverändert bleibt

| Struktur | Warum |
|---|---|
| Schema der Tabelle `executions` | keine neue Spalte, keine Migration |
| `UsageEvent`, `UsageTotals`, `UsageSummary` in `@sdd/shared` | der Kern benutzt sie, ändert sie nicht |
| `LiveSession` | keine neuen Felder — `startedAt`, `lastOutputAt`, `scrollback` reichen |
| Bereits verbuchte Chat-Läufe | keine rückwirkende Korrektur (Assumption der Spec) |
| `checkWorkWithoutRun` und sein Filter auf `kind === 'feature'` | FR-020 |
