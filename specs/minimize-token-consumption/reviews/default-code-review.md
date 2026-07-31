# Code-Review: `minimize-token-consumption`

**Branch**: `feature/minimize-token-consumption` gegen `main` (Merge-Base `2e74c83`)
**Reviewer-Rolle**: Strenger, adversarialer Code-Review (Korrektheit, Randfälle, Fehlerbehandlung, Lesbarkeit, unnötige Komplexität, Konsistenz)
**Datum**: 2026-07-22

## Umfang

Geprüft wurden alle Code-Änderungen des Branches (Spec-/Doku-Dateien nur als Referenz):

- `packages/shared/src/`: `transcriptUsage.ts`, `costBreakdown.ts`, `optimization.ts`, `contextCompressor.ts`, `types.ts`, `index.ts` (+ Tests)
- `packages/server/src/`: `services/orchestrator.ts`, `services/contextOptimizer.ts` (+ Test), `db/database.ts`, `db/repos.ts`, `pty/transcriptWatcher.ts`, `pty/commandBuilder.ts`, `api/server.ts`, `services/onboardingService.ts`
- `packages/web/src/`: `api.ts`, `components/AutomationDial.tsx`, `components/ExecutionsView.tsx`, `components/ProjectSettings.tsx`

Hinweis: `pnpm typecheck`/`pnpm test` konnten in dieser Sandbox nicht ausgeführt werden (Kommandos wurden blockiert). Die Bewertung erfolgt daher rein statisch; die vorhandenen Unit-Tests wurden gelesen und decken die reinen `@sdd/shared`-Module gut ab.

Die reine Domänenlogik (Usage-Parsing, Aggregation, Settings-Auflösung, Kompressor) ist sauber, defensiv und gut getestet. Der Befund liegt in der **Verdrahtung im Orchestrator**.

---

## Befunde

### 🔴 BLOCKER 1 — Reset-Kommando und Phasen-Prompt werden zu einer einzigen Eingabe konkateniert (P2 ist funktional kaputt)

**Ort**: `packages/server/src/services/orchestrator.ts:239-241` in Kombination mit `packages/server/src/pty/sessionManager.ts:295-302`

```ts
// orchestrator.launchPhase()
if (plan.reset) this.deps.ptys.sendPrompt(session.id, resetCommand(plan.reset));
this.deps.ptys.sendPrompt(session.id, prompt);
```

```ts
// PtySessionManager.sendPrompt()
sendPrompt(id: string, text: string): void {
  const s = this.sessions.get(id);
  if (!s) return;
  s.pty.write(bracketedPaste(text));          // Paste SOFORT
  setTimeout(() => {
    if (!s.exited) s.pty.write(SUBMIT_KEY);    // Enter erst nach 80 ms
  }, SUBMIT_DELAY_MS);
}
```

`sendPrompt` schreibt den Bracketed-Paste-Block **synchron sofort** und plant das abschließende `\r` (Submit) erst nach `SUBMIT_DELAY_MS` (80 ms) per `setTimeout`. Beide `sendPrompt`-Aufrufe in `launchPhase` laufen im **selben synchronen Tick**. Reihenfolge der an die PTY geschriebenen Bytes:

1. `\x1b[200~/compact\x1b[201~`  (Reset-Paste)
2. `\x1b[200~<Phasen-Prompt>\x1b[201~`  (Prompt-Paste)
3. *(nach 80 ms)* `\r`  (Submit des ersten `sendPrompt`)
4. *(nach 80 ms)* `\r`  (Submit des zweiten `sendPrompt`)

Da zwischen den beiden Pastes **kein Enter** liegt, enthält der TUI-Eingabepuffer nach Schritt 2 den zusammengesetzten String `/compact/speckit-plan specs/... <Präambel>`. Das erste `\r` submittet diese **eine** Zeile.

**Folgen**:
- `/compact` interpretiert den angehängten Phasen-Prompt als seine optionalen Instruktionen — es wird also **verdichtet mit dem Phasenbefehl als Compact-Anweisung**, statt den speckit-Befehl auszuführen. Die eigentliche Phase (`/speckit-plan`, `/speckit-tasks`, …) **läuft nie**.
- Die Execution wird in `launchPhase` bereits als `running` gebucht und in `handleTurnCompleted` regulär als abgeschlossen/gemetert verbucht — das System hält die Phase für erfolgreich, obwohl kein Artefakt erzeugt wurde.
- Bei aktivem Auto-Progress kaskadiert der Fehler: Jede Folgephase wird identisch korrumpiert.

**Auslösebedingung**: Sobald `contextStrategy` ≠ `full` ist. Das ist exakt der empfohlene Standard der ersten Ausbaustufe (`OPTIMIZATION_DEFAULTS = { contextStrategy: 'compact', … }`, `optimization.ts:22`) und die im Dial/ProjectSettings angebotene Kern-Option. Der Feature-Default (`getOptimization()` → `OPTIMIZATION_OFF_DEFAULTS`) verschleiert das nur, solange niemand die Optimierung einschaltet — also solange das Feature ungenutzt bleibt.

**Verletzt**: FR-004 (smarte Kontext-Übergabe), FR-006 (Qualitäts-Gates werden nicht durchlaufen, weil die Phase gar nicht ausgeführt wird), SC-001/SC-002 (A/B-Nachweis und Qualitätsgleichheit unmöglich, da der „optimierte" Lauf keine echten Artefakte produziert).

**Reproduktion**: Globale Optimierung auf `compact` stellen → Feature anlegen → `plan` starten (oder Auto-Progress). Die PTY erhält `…/compact…//speckit-plan…` als eine Eingabe; `plan.md` wird nicht erzeugt, die Execution steht dennoch auf `succeeded`.

**Fix-Richtung**: Reset und Prompt dürfen nicht als zwei überlappende `sendPrompt` abgesetzt werden. Nötig ist eine echte Sequenzierung — den Reset submitten, auf dessen Abschluss (bzw. `session_end`-Reason `compact`/`clear` → `ready`) warten, **dann** den Phasen-Prompt senden. Ein simples „beide sofort" ist wegen der asynchronen `/compact`-Zusammenfassung (eigener Turn) ohnehin nicht ausreichend.

---

### 🟠 BEFUND 2 — `compression: 'llm'` ist ein stiller No-Op, wird aber als eigene Option angeboten

**Ort**: `packages/server/src/services/contextOptimizer.ts:56-66` (aktiver Pfad) vs. `:89-103` (`applyLlmCompression`, nie aufgerufen)

`prepareForPhase` führt für **jeden** Modus ≠ `off` nur die deterministische `compress()` aus. `applyLlmCompression`/`llmResultIsWorthKeeping` sind implementiert und unit-getestet, werden aber im gesamten Server-Flow **nirgends aufgerufen** (per `grep` bestätigt — nur Tests referenzieren sie). Damit verhält sich die Auswahl `llm` **exakt wie** `deterministic`.

Gleichzeitig bieten sowohl `AutomationDial.tsx:124` als auch `ProjectSettings.tsx:176` die Option „LLM (nur bei Netto-Ersparnis)" aktiv zur Auswahl an. Ein Nutzer, der sie wählt, bekommt still deterministisches Verhalten — entgegen dem Label.

`tasks.md` (T026, Abschnitt „teilweise") dokumentiert bewusst, dass der Inline-Spawn zurückgestellt wurde. Das ist als Engineering-Entscheidung vertretbar — **aber** dann darf die UI die Option nicht als funktionsfähig ausweisen. FR-005 verlangt eine *optional zuschaltbare* LLM-Verdichtung; aktuell ist sie zuschaltbar, tut aber nichts.

**Fix-Richtung**: Entweder den `summarize`-Dependency verdrahten (Guard existiert bereits) **oder** die `llm`-Option in beiden UI-Stellen entfernen/als „geplant/deaktiviert" markieren, bis sie wirkt. So wie es ist, ist es irreführend und muss vor dem Merge bereinigt werden.

---

## Nicht-blockierende Beobachtungen (kein Grund für FAIL, sollten aber notiert werden)

- **Absolute Token-/Kostenwerte werden systematisch überschätzt.** `sumUsage` (`transcriptUsage.ts:60-74`) summiert `cache_read_input_tokens` über *alle* Assistant-Zeilen eines Phasenfensters; da derselbe Cache-Prefix pro Nachricht erneut gelesen wird, wächst die Summe weit über den real einzigartigen Kontext hinaus. Zusätzlich bepreist `usageToCost` (`:80-88`) Cache-Read wie volle Input-Tokens statt zum ~0,1×-Cache-Read-Tarif. Für den **relativen** A/B-Vergleich (SC-001, identische Methode auf beiden Seiten) ist das unschädlich und explizit als „grobe, dokumentierte Näherung" gekennzeichnet — aber die in der Executions-View mit Badge „gemessen" angezeigten Absolutwerte (SC-004) sind dadurch deutlich zu hoch. Ein Hinweis/Caveat wäre angebracht.
- **`baseArtifactExists` (`contextOptimizer.ts:106-108`) ist toter Export** — der Orchestrator nutzt `artifactExists`, die Tests nutzen `prepareForPhase`. Kein Aufrufer.
- **`byKind` enthält auch `kind='phase'`** (`costBreakdown.ts`), überlappt also mit `byPhase`. Das ist als getrennte Sicht gewollt und die Invarianz-Tests berücksichtigen es korrekt — nur beim Konsumieren beider Sichten nicht addieren.

## Positiv

- Migration additiv/nullable, sauber im bestehenden `user_version`-Muster (`database.ts:196-209`).
- `optimization.ts` löst defensiv auf (unbekannte Enums → Rückfall), `parseOptimizationPartial` schützt JSON-Spalten robust.
- `readTranscriptDelta`/`transcriptSize` behandeln fehlende/gekürzte/ersetzte Dateien und Offset-Overflow korrekt; Lesen ab `\n`-Grenze vermeidet UTF-8-Splits.
- `aggregateBreakdown` ist rein, gut getestet, Invariante `byPhase + phasenlos == total` gehalten.
- Reversibilität (FR-008) über `OPTIMIZATION_OFF_DEFAULTS` konsequent umgesetzt.

---

## Fazit

Die Mess-Infrastruktur (P1) und die reinen Bausteine sind solide. Der **Kern der Reduktion (P2)** ist jedoch durch die konkatenierte Prompt-Übergabe funktional gebrochen: Sobald die Optimierung eingeschaltet wird, laufen die SDD-Phasen nicht mehr, produzieren aber scheinbar erfolgreiche Executions. Das ist ein Datenverlust-/Qualitätsrisiko und macht den geforderten A/B-Nachweis unmöglich. Zusätzlich ist die angebotene LLM-Verdichtung ein stiller No-Op. Beides muss vor dem Merge behoben werden.

VERDICT: FAIL
