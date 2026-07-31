# Contract: Phasen-Start & Status-Wahrheit

Betrifft `orchestrator.startPhaseRun` / `launchPhase` / `reapOnBoot` und die Phasen-Statussemantik (FR-002, FR-003, FR-004, FR-009).

## HTTP-Routen (Signaturen unverändert)

- `POST /api/features/:id/phases/:phase/start` → startet/​fortsetzt einen Phasenlauf.
- `POST /api/features/:id/prompt` → freier Prompt (muss weiterhin abgeschickt werden, FR-006).

Beide bleiben in Request/Response unverändert; nur das Verhalten dahinter wird robuster.

## `startPhaseRun` — Verhalten

1. `startPhase(...)` setzt Phase auf `running` (Intent) und persistiert.
2. `ensureSession(...)` + `launchPhase(...)` → `sendPrompt(...)`.
3. **Fehlerabsicherung (neu, FR-004)**: Wirft Schritt 2 (Spawn/Session) **oder** feuert später `onSubmitFailed`, dann:
   - Phase wird von `running` zurück auf `idle` gerollt (persistiert, `feature_updated` emittiert).
   - Ein `AttentionItem` (`agent_errored`, erkennbarer Fehlerhinweis) wird erzeugt und `attention_raised` emittiert.
   - Die Route darf weiterhin einen Fehler signalisieren, aber der Zustand bleibt konsistent (kein hängendes „läuft").

## Statuswahrheit (FR-003)

- Der Phasenwert `running` bedeutet **Intent**, nicht sichtbares „läuft …".
- Die Anzeige „läuft …" wird ausschließlich aus der Kombination **Phase `running` + echter Session-Status** abgeleitet (siehe `attention-and-ui-state.md`). Es darf **keine** „läuft …"-Anzeige geben, ohne dass die zugehörige Session tatsächlich arbeitet.

## Unterbrochene Läufe (FR-009)

- **Server-Neustart** (`reapOnBoot`): verwaiste `running`-Phasen → `idle` (Start/Run wird angeboten) **und** je Phase ein `AttentionItem` („Lauf unterbrochen — per Run fortsetzbar").
- **Fortsetzen**: `POST …/start` bzw. Kachel-„Run" nutzt dieselbe zuverlässige Send-Pipeline → der unterbrochene Task wird tatsächlich fortgesetzt (Prompt abgeschickt), nicht nur vorausgefüllt.
- **Ruhezustand**: durch die Statuswahrheit erscheint eine wieder-idle/gestallte Session nicht als „läuft"; ein noch als `running` markierter Lauf ohne arbeitende Session erscheint als „braucht dich".

## Doppel-Auslösung (FR-008)

- `startPhase` wirft bei Phase bereits `running`.
- UI: KanbanBoard zeigt „▶ Start" nur bei `idle`; PhaseStrip deaktiviert Buttons bei `runningPhase !== null`.
- „läuft bereits"-Fehler wird nutzerfreundlich abgefangen (kein roher Fehler-Toast bei schnellem Doppelklick).

## Testbare Akzeptanz

- `ensureSession` wirft → Phase wieder `idle`, genau ein `agent_errored`-AttentionItem. (FR-004)
- `reapOnBoot` mit einer `running`-Phase ohne lebenden Prozess → Phase `idle` + AttentionItem „fortsetzbar". (FR-009)
- Phasenlauf normal → `running` gesetzt, nach Session-`working` zeigt UI „läuft"; nach `turn_completed` → `awaiting_review`. (bestehend, Regression-Schutz)
