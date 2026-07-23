# Code-Review: „Kommandos direkt ausführen statt nur vorausfüllen"

**Branch**: `feature/ausfuehren-eines-commands-soll-diesen-auch-direkt-ausfuehren`
**Basis (Merge-Base gegen `main`)**: `ff8b6a3`
**Reviewer-Modus**: streng / adversarial
**Datum**: 2026-07-23

## Umfang

Diff gegen den Merge-Base (24 Dateien, +1347/-22). Kern der Änderung:

- `packages/shared`: `isReadyForInput` / `isTerminal` (pur), `AttentionKind 'run_interrupted'`.
- `packages/server/src/pty/sessionManager.ts`: `sendPrompt` von „blind CR nach 80 ms" auf **bereitschaftsgesteuertes, bestätigtes Absenden mit Retry + `onSubmitFailed`** umgestellt (`pump`/`deliver`/`armSubmit`/`fireSubmit`/`onSubmitUnconfirmed`, `armReadyTimeout`).
- `packages/server/src/pty/commandBuilder.ts`: Konstanten `SUBMIT_CONFIRM_MS`, `MAX_SUBMIT_RETRIES`, `READY_TIMEOUT_MS`.
- `packages/server/src/services/orchestrator.ts`: `startPhaseRun`-Rollback (`failPhaseStart`), `handleSubmitFailed`, `reapOnBoot`-Attention.
- `packages/web`: „läuft …"/„wird gestartet …"-Ableitung aus echtem Session-Status; „läuft bereits"-Fehler stumm.
- Tests: `sessionManager.test.ts`, `orchestrator.test.ts`, `server.test.ts`, `sessionMachine.test.ts`.

**Hinweis zur Verifikation**: Typecheck und Test-Suite konnten in dieser Umgebung wegen Permission-Gates (`pnpm`/`vitest`/`tsc` nicht ausführbar) **nicht** laufen. Die Tests wurden statisch gegen den Code geprüft (Retry-Mathematik, Reihenfolge, Confirm-Pfade konsistent). Die Laufzeit-Findings unten hängen teils vom tatsächlichen Hook-/Transcript-Verhalten von Claude Code ab, das ich nicht ausführen konnte — sie sind entsprechend als „design-analytisch bestätigt, Laufzeit nicht ausführbar geprüft" markiert.

Die Kern-Anforderung (US1: frisch gespawnte Session → Prompt zuverlässig nach `ready` abschicken) ist sauber umgesetzt und getestet. Die Findings betreffen **Sekundärpfade**, führen dort aber zu echten Regressionen.

---

## Findings

### 🔴 HIGH-1 — Reset-Kommandos (`/clear`, `/compact`) laufen durch die neue Bestätigungs-/Fehler-Pipeline und lösen falsche Phasen-Rollbacks aus

**Dateien**: `orchestrator.ts:270-271`, `sessionManager.ts:338-395`, `orchestrator.ts:513-538`, `contextOptimizer.ts:45-53`

`launchPhase` sendet bei aktiver Token-Optimierung **zwei** Prompts über dieselbe `sendPrompt`-Pipeline:

```ts
// orchestrator.ts:270-271
if (plan.reset) this.deps.ptys.sendPrompt(session.id, resetCommand(plan.reset)); // '/compact' | '/clear'
this.deps.ptys.sendPrompt(session.id, prompt);
```

`sendPrompt` verlangt jetzt eine **Zustellbestätigung** — nur die Signale `user_prompt_submit` (Hook) oder `working` (Transcript) lösen `clearSubmitPending` aus (`sessionManager.ts:452-457`). Bleibt sie aus, wird nach `MAX_SUBMIT_RETRIES` `onSubmitFailed` gefeuert (`sessionManager.ts:382-395`) → `orchestrator.handleSubmitFailed` (`orchestrator.ts:513-538`).

`/clear` ist ein **client-seitiges Built-in-Kommando ohne Modell-Turn**: Es feuert `SessionEnd(reason='clear')` + `SessionStart` (siehe `RESTART_REASONS` in `sessionMachine.ts:50`), aber **weder `user_prompt_submit` noch ein Transcript-`working`-Event**. Damit wird der `/clear`-Submit nie bestätigt.

**Fehlszenario** (contextStrategy `fresh`, Downstream-Phase, z. B. Auto-Progress `specify → plan`):
1. `sendPrompt('/clear')` → zugestellt, `submitPending={/clear}`; der Phasenprompt wartet in `pendingPrompts`.
2. `/clear` wird ausgeführt (Kontext geleert), aber kein Bestätigungssignal.
3. 4 CRs über ~2 s → `onSubmitFailed(session, '/clear')`.
4. `handleSubmitFailed`: `running`-Phase (`plan`) → `finishPhase(..., 1)` = **zurück auf `idle`**, `executions.finish(executionId, 1)`, `runningPhases.delete`, `attention.raise('agent_errored')`.
5. Danach (`onSubmitUnconfirmed` → `pump`) wird der Phasenprompt doch noch zugestellt und **läuft tatsächlich durch** — aber die Phase steht bereits auf `idle`, `runningPhases` ist leer.
6. Turn-Ende → `handleTurnCompleted` findet kein `running` → nur generische „Agent ist fertig"-Notification; Phase bleibt `idle`, Execution ist fälschlich als `exit 1` verbucht, und in der „braucht dich"-Inbox steht „Kommando für Phase plan konnte nicht gestartet werden" — **obwohl die Phase erfolgreich lief**.

Das verletzt FR-003/FR-004 (Statuswahrheit) in die andere Richtung und ist eine **Regression am ausgelieferten Feature `minimize-token-consumption`**. `fresh`/`compact` sind gültige, benutzerwählbare Strategien (`optimization.ts:24`, empfohlener Default ist sogar `compact`). Vor diesem PR war `sendPrompt` fire-and-forget — Reset-Kommandos waren unkritisch.

**Empfehlung**: Reset-/Steuerkommandos nicht über den bestätigungs-/fehlerpflichtigen `sendPrompt`-Pfad schicken (eigener fire-and-forget-Weg bzw. `write` + CR ohne `onSubmitFailed`), oder `handleSubmitFailed` nur greifen lassen, wenn der zugehörige *Phasenprompt* (nicht das Reset) nicht zugestellt werden konnte.

---

### 🟠 MEDIUM-2 — Prompt an eine bereits `working`-Session: Transcript-`working` bricht das noch nicht gesendete CR ab

**Dateien**: `sessionManager.ts:259-272`, `sessionManager.ts:362-367`, `sessionManager.ts:452-457`

`isSubmitConfirming` behandelt Transcript-`working` **ohne `hooksLive`-Gate** als Bestätigung:

```ts
function isSubmitConfirming(signal: SessionSignal): boolean {
  if (signal.type === 'hook') return signal.event.name === 'user_prompt_submit';
  if (signal.type === 'transcript') return signal.event === 'working';  // gilt auch bei laufendem hooks-Betrieb
  return false;
}
```

Wird `sendPrompt` auf eine bereits `working`-Session aufgerufen (z. B. Nutzer schickt über die PromptBar eine Folge-Nachricht, während der Agent arbeitet — FR-006), passiert:

1. `deliver`: Paste geschrieben, `submitPending` gesetzt, `armSubmit(SUBMIT_DELAY_MS=80 ms)` — das CR folgt erst nach 80 ms (`sessionManager.ts:363-366`).
2. Der **laufende** Turn schreibt weiter ins Transcript → ein Transcript-`working`-Event trifft ein.
3. `dispatch` (`sessionManager.ts:261-263`) ruft `clearSubmitPending` → **löscht `submitTimer`** (genau den 80-ms-Paste→CR-Timer) und setzt `submitPending=null`.
4. Ergebnis: Das CR wird **nie gesendet**, kein Retry, `submitPending` weg → der Prompt bleibt gepastet, aber **unabgeschickt** in der Eingabezeile stehen.

Das ist exakt der Defekt, den das Feature beseitigen sollte („Prompt bleibt unabgeschickt in der Eingabezeile"). Das 80-ms-Fenster ist schmal, aber während eines aktiven Turns schreibt das Transcript häufig; für Sessions ab dem 2. Turn ist der TranscriptWatcher garantiert attached. Zusätzlich ist das neue Verhalten für den „während-working-absenden"-Fall fragiler als das alte Einzel-CR (mehrere Retry-CRs bzw. Fehlbestätigung). Potenzielle FR-006-Regression.

**Empfehlung**: Transcript-`working` nur als Bestätigung zählen, wenn `!hooksLive` (analog zu `reduceSession`), bzw. Bestätigung/Retry erst nach dem tatsächlichen Senden des CR abbrechen lassen — die Bestätigungsprüfung darf den noch ausstehenden Paste→CR-Timer nicht killen.

---

### 🟡 LOW-3 — Bestätigungsfenster (500 ms) vs. Datei-Watch-Latenz der Hook-Bridge

**Dateien**: `commandBuilder.ts:96-98`, `hookBridge.ts:102-139`

Hook-Events werden über `chokidar`-Dateiüberwachung + `drain()` geliefert (`hookBridge.ts`). Unter Last kann die Latenz `SUBMIT_CONFIRM_MS = 500 ms` übersteigen; dann werden auch bei völlig gesundem Submit überflüssige Retry-CRs (leere Enter) gesendet, bevor die Bestätigung eintrifft. Meist harmlos, kann aber Streu-Newlines in die TUI schicken. Ein größeres/adaptives Confirm-Fenster wäre robuster.

---

### 🟡 LOW-4 — PhaseStrip-Tooltip inkonsistent mit Contract und KanbanBoard

**Dateien**: `FeatureConsole.tsx:180-187` vs. `KanbanBoard.tsx:221-230`, Contract `attention-and-ui-state.md`

Für `phase.status === 'running'` **ohne** lebende Session (`stopped`/`errored`/nicht vorhanden) zeigt der PhaseStrip Titel „wird gestartet …" und einen gedimmten Stil. Contract und KanbanBoard behandeln diesen Fall dagegen als **kein „läuft"/kein Badge** (der „braucht dich"-Fall). „wird gestartet …" ist laut `data-model.md` §4 ausdrücklich nur für `session.status === 'idle'` (lebende, aber noch nicht arbeitende Session) vorgesehen. Kosmetisch, aber divergent zur eigenen Spezifikation.

---

### 🟡 LOW-5 — Verwaiste Execution bei synchronem Fehler in `launchPhase`

**Datei**: `orchestrator.ts:227-272`, `failPhaseStart:203-220`

Wirft `launchPhase` **nach** `executions.start` synchron (z. B. `prepareForPhase`), rollt `failPhaseStart` zwar die Phase zurück, ruft aber nie `executions.finish` für die bereits gestartete Execution → sie bleibt `running` bis `reapOrphans`. Geringfügig (Aufräumen erfolgt beim nächsten Boot), aber die Execution-Buchung ist zwischenzeitlich inkonsistent.

---

## Positiv

- Kern-Pfad (US1/US2/US3 Primärfall) korrekt und sauber getestet; `pump`/`deliver`/Retry-Mathematik konsistent mit `sessionManager.test.ts`.
- `isReadyForInput`/`isTerminal` pur und gut abgedeckt.
- Trennung Auto-Submit (`sendPrompt`) vs. reine Einfügung (`write`: `init-speckit`, `paste-image`) durch den Tripwire-Test `server.test.ts` abgesichert (FR-007/FR-010).
- Timer-Aufräumung im Exit-Pfad (`onExit`) vollständig; `reapOnBoot`-Attention (FR-009) sinnvoll umgesetzt.
- „läuft bereits"-Doppelklick wird stumm geschluckt (FR-008), und `startPhase` wirft vor dem try-Block, sodass ein Doppelstart **nicht** fälschlich zurückgerollt wird.

## Fazit

HIGH-1 ist eine konkrete Regression an einer ausgelieferten, benutzerwählbaren Konfiguration (Reset-Strategie `fresh`/`compact`): Downstream-Phasen können fälschlich als „nicht gestartet/braucht dich" markiert werden, während sie tatsächlich laufen — ein direkter Verstoß gegen die Statuswahrheit, die dieses Feature garantieren soll. MEDIUM-2 kann den ursprünglich zu behebenden Defekt (unabgeschickter Prompt) bei „Folgeprompt während working" reproduzieren. Beide müssen vor dem Merge behoben (oder zumindest gegen das reale Hook-/Transcript-Verhalten von `/clear` verifiziert) werden.

VERDICT: FAIL
