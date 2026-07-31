# Phase 0 Research: Kommandos direkt ausführen statt nur vorausfüllen

Alle Punkte des Technical Context sind aus dem bestehenden Code ableitbar — keine offenen `NEEDS CLARIFICATION`. Diese Datei hält die Ursachenanalyse und die getroffenen Entscheidungen fest.

## Ursachenanalyse (aus dem Code)

### Symptom A — Befehl bleibt vorausgefüllt, wird nicht abgeschickt (US1)
`PtySessionManager.sendPrompt` (`packages/server/src/pty/sessionManager.ts:295`) schreibt Bracketed Paste und danach ein einzelnes CR nach **fixen 80 ms** (`SUBMIT_DELAY_MS`, `commandBuilder.ts:87`). Der Phasen-Start (`orchestrator.startPhaseRun` → `launchPhase` → `sendPrompt`) ruft dies unmittelbar nach `ensureSession` auf. Bei einer **frisch gespawnten** Session (`spawn` startet `claude` in einer Login-Shell) ist die TUI nach 80 ms noch nicht eingabebereit → Paste/CR laufen ins Leere, der Befehl bleibt stehen. Gleiches gilt beim Resume nach Stack-Neustart (frischer Spawn mit `--resume`).

### Symptom B — falsche „läuft …"-Anzeige (US2 / FR-003)
Die „läuft …"-Anzeige (`KanbanBoard.tsx:213`) und der PhaseStrip-Puls (`FeatureConsole.tsx:161`) hängen **ausschließlich** an `phaseState.status === 'running'`. Dieser Status wird in `startPhase` (`phaseMachine.ts:54-61`) **eager** gesetzt und in `orchestrator.startPhaseRun` **vor** `ensureSession`/`sendPrompt` persistiert — also unabhängig davon, ob der Befehl je abgeschickt wurde. Er wird erst durch `finishPhase`/`handleExit`/`reapOrphanedRunning` korrigiert. Ein **separater, wahrer** Statuspunkt existiert bereits: `status-dot` (`KanbanBoard.tsx:169`) bindet an `SessionInfo.status` (`working`/`awaiting_input`/idle) aus der Session-State-Maschine.

### Symptom C — unterbrochen/verwaist (FR-009)
- **Stack-/Server-Neustart**: `orchestrator.reapOnBoot` ruft `reapOrphanedRunning(phases, () => false)` → alle `running`-Phasen fallen auf `idle`. Der In-Memory-`runningPhases`-Eintrag geht verloren. Danach ist die Kachel idle (bzw. via `reconcileWithDisk` `awaiting_review`) → „▶ Start" erscheint, aber ein erneuter Start trifft wieder Symptom A.
- **PC-Ruhezustand**: PTY und `runningPhases`-Eintrag überleben; die Session kann still auf `turn_done`/Stall geraten, während die Phase weiter `running` zeigt. Das Sicherheitsnetz `stall_timeout` wird bereits vom `TranscriptWatcher` (`transcriptWatcher.ts:161`) emittiert und überführt `working → ready` in der Maschine — die Phase bleibt aber ohne Reconciliation `running`.

### Symptom D — Startfehler (FR-004)
`startPhaseRun` setzt `running` zuerst und ruft danach `ensureSession`. Wirft `ensureSession`/Spawn, bleibt die Phase in `running` hängen und die Route liefert 500 — es gibt keinen Rollback und kein Aufmerksamkeits-Item.

### Scope-Grenzen (FR-007 / FR-010)
- `init-speckit` (`server.ts:217`): `deps.ptys.write(...)` ohne CR — **bewusster** Bestätigungsschritt → bleibt.
- `paste-image` (`server.ts:574`): Bracketed Paste eines Dateipfads ohne CR — reine Inhalts-Einfügung → bleibt.
- **Alle echten Kommando-Auslösepunkte** (Phasen-Start via Orchestrator, PromptBar „Senden", Review-Feedback) laufen bereits über `sendPrompt`. Damit greift die zentrale Korrektur „überall" (FR-005) ohne Umbau der einzelnen Aufrufer.

## Entscheidungen

### D1 — Bereitschaftsgesteuertes, bestätigtes Absenden (Kern)
- **Decision**: `sendPrompt` liefert den Prompt nur, wenn die Session eingabebereit ist. Ist die Session-Maschine in `created`/`launching`, wird der Prompt eingereiht und beim ersten Übergang nach `ready` (Hook `session_start`) abgespült. Nach dem CR wird die **Zustellung bestätigt** (Übergang nach `working` bzw. `user_prompt_submit`-Hook innerhalb eines Zeitfensters); bleibt die Bestätigung aus, wird das CR bis zu N‑mal wiederholt. Nach erschöpften Retries feuert ein `onSubmitFailed`-Callback.
- **Rationale**: Die Session-State-Maschine besitzt bereits ein verlässliches Bereitschaftssignal (`ready`) und ein Submit-Signal (`working`/`user_prompt_submit`). Bestätigung+Retry ersetzt das fragile Fixed-Timing und deckt Kaltstart wie Resume ab.
- **Alternatives considered**: (a) Nur `SUBMIT_DELAY_MS` erhöhen — verschiebt die Race nur, langsam bei bereiten Sessions, unzuverlässig bei langsamem Start. (b) Auf PTY-Ausgabe nach Prompt-Marker parsen — brüchig gegenüber TUI-Änderungen. (c) `--print`/Headless statt interaktiver TUI — großer Umbau, verliert die interaktive Konsole.

### D2 — „läuft …" an echten Ausführungszustand koppeln
- **Decision**: Die „läuft …"-Anzeige zeigt nur, wenn Phase `running` **und** eine lebende Session tatsächlich arbeitet (`SessionInfo.status ∈ {working, awaiting_input}`). Phase `running`, aber Session noch nicht arbeitend → transitorisch „wird gestartet …". Phase `running`, aber keine lebende/arbeitende Session → nicht „läuft", sondern „braucht dich" (siehe D3/D4). Rein clientseitige Rendering-Kombination der bereits vorhandenen Signale (`phaseState.status` + `session.status`).
- **Rationale**: Nutzt den bereits wahren `SessionInfo.status`; minimaler Eingriff, keine neuen Server-Zustände. Der transitorische Zustand ist per Spec-Assumption ausdrücklich erlaubt.
- **Alternatives considered**: Neuer persistenter Phasenstatus `starting` — mehr Zustandsfläche und DB-Semantik ohne Mehrwert, da das Session-Signal genügt.

### D3 — Unterbrochen/verwaist → „braucht dich" (fortsetzbar)
- **Decision**: `reapOnBoot` setzt verwaiste `running`-Phasen weiterhin auf `idle` (damit „▶ Start"/„Run" zum Fortsetzen erscheint), erzeugt dabei aber ein Aufmerksamkeits-Item („Lauf unterbrochen — fortsetzbar"). Für den Ruhezustand-Fall stellt die wahre „läuft"-Kopplung (D2) sicher, dass eine wieder-idle Session nicht als laufend erscheint. Fortsetzen per „Run" nutzt die zuverlässige Send-Pipeline (D1).
- **Rationale**: Deckt die vom Nutzer eingebrachte Kern-Beschwerde (falsches „läuft" nach Ruhezustand/Neustart) ab und macht den Lauf sichtbar fortsetzbar — genau die geklärte Anforderung (FR-009).
- **Alternatives considered**: Eigener sichtbarer „unterbrochen"-Kachelzustand — vom Nutzer zugunsten des bestehenden „braucht dich"-Mechanismus verworfen (Clarify Q2).

### D4 — Startfehler → Rollback + „braucht dich"
- **Decision**: `startPhaseRun` (und der `onSubmitFailed`-Callback aus D1) werden abgesichert: schlägt Start/Zustellung fehl, wird der eager gesetzte `running`-Status zurückgerollt und ein Aufmerksamkeits-Item mit erkennbarem Fehlerhinweis erzeugt (statt hängendem „läuft" und 500).
- **Rationale**: Erfüllt FR-004 und verhindert den „Geister-Lauf".
- **Alternatives considered**: Nur `running` roll-backen ohne Attention — der Nutzer bemerkt den Fehlschlag sonst nicht (Clarify Q3 verlangt erkennbaren Hinweis).

### D5 — Doppel-Auslösung
- **Decision**: Bestehende Guards genügen weitgehend: `startPhase` wirft bei bereits `running`; KanbanBoard zeigt „▶ Start" nur bei `idle`; PhaseStrip deaktiviert Buttons bei `runningPhase !== null`. Sicherstellen, dass der „läuft bereits"-Fehler nutzerfreundlich abgefangen wird (kein roher 500-Toast bei schnellem Doppelklick).
- **Rationale**: FR-008 ist mit minimaler Härtung erfüllt.

## Offene Parameter (in Phase 1 / Tasks zu fixieren)
- Konkrete Zeitfenster/Retry-Anzahl für die Submit-Bestätigung (Startwerte z. B. Bestätigungsfenster ~500 ms, bis zu 3 CR-Retries, Ready-Warte-Timeout als Fehlergrenze ~30 s) — werden als benannte Konstanten in `commandBuilder.ts` geführt und in Tests fixiert.
- Ob ein neuer `AttentionKind 'run_interrupted'` eingeführt wird oder der bestehende `agent_errored` mit passender Message wiederverwendet wird (Präferenz: dedizierter Kind für klare Filterung, minimal-invasiv in `types.ts`).
