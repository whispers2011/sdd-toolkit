# Code-Review — Projekt-Chat als vollwertige Claude-Code-Session

**Branch**: `feature/projekt-chat-sollte-eine-claude-code-session-sein`
**Basis (Merge-Base gegen `main`)**: `07c7e2e`
**Datum**: 2026-07-22
**Reviewer**: strenger, adversarialer Code-Review

## Umfang & Methode

Reviewt wurde der gesamte Diff des Feature-Branches gegen den Merge-Base
(`git diff 07c7e2e..HEAD`), Schwerpunkt Server-Logik (`chatWorkService`, `orchestrator`,
`sessionManager`, `snapshotStore`, `repos`, `database`, `events`, `api/server`), Shared-Typen
(`types`, `chatMode`) und Web (`ChatPanel`, `store`, `api`, `AttentionInbox`, `ChatBubble`).
Abgeglichen gegen `spec.md`, `plan.md`, `data-model.md`, `contracts/`.

> **Hinweis zur Ausführung:** `pnpm typecheck` / `pnpm test` konnten in dieser
> (nicht-interaktiven) Umgebung nicht ausgeführt werden — die Prozessausführung wurde vom
> Sandbox-/Permission-Layer blockiert. Der Review beruht daher auf statischer Analyse. Die
> vorhandenen Tests (`chatMode.test.ts`, `chatWork.test.ts`, `chatWorkService.test.ts`) decken
> die glücklichen Pfade ab, aber **nicht** die unten beschriebenen Fehlerpfade.

---

## Befunde

### 🔴 F1 — Datenverlust + Falschmeldung „merged" bei bereits committeten, aber nicht gemergten Änderungen (BLOCKER)

**Ort**: `packages/server/src/services/chatWorkService.ts:246-259` (`runIntegration`)

`integrate` interpretiert einen **sauberen Working-Tree** (`isCleanWorkingTree`) pauschal als
„keine Änderungen zum Übernehmen", verwirft dann via `teardown()` den Worktree **und den Branch
(`git branch -D chat/<id>`)** und meldet das Ergebnis als `result: 'merged'`. Ein sauberer
Working-Tree bedeutet aber **nicht**, dass der Branch keine ungemergten Commits enthält — er ist
auch dann sauber, wenn die Arbeit bereits committet, aber noch nicht nach `main` überführt wurde.

**Reproduzierbare Szenarien** (beide realistisch):

1. **Retry nach Verify-Fehler**: `integrate` committet die Änderungen (`:260-262`), danach schlägt
   die Verifikation fehl (`:265-276`) → `fail(...)`; Worktree bleibt erhalten, Unterhaltung bleibt
   aktiv, `integrating` wird im `finally` freigegeben, und die UI reaktiviert den „Übernehmen"-Button
   (`ChatPanel.tsx:38-39`). Klickt der Nutzer erneut „Übernehmen", ist der Working-Tree jetzt
   **sauber** (alles committet) → der Zweig `:247` greift → **die committete Arbeit wird mit
   `git branch -D` gelöscht und als „merged" gemeldet, obwohl nichts nach `main` gelangt ist.**
2. **Session committet selbst**: Der Arbeits-Modus läuft im Default (Level 2) mit
   `permissionMode: 'bypassPermissions'` (`:142`), d. h. die Claude-Session **kann** `git commit`
   ohne Rückfrage ausführen. Der System-Prompt bittet zwar darum, es zu lassen
   (`chatWorkPrompt.ts:25`), erzwingt es aber nicht. Committet die Session ihre Arbeit, ist der
   Working-Tree beim allerersten „Übernehmen" sauber → sofortiger Datenverlust + Falschmeldung.

**Auswirkung**: Verletzt FR-004 (abgeschlossene Arbeit MUSS nach `main` überführbar sein),
FR-007/SC-003 (Nutzer MUSS nachvollziehen können, *was* gemergt wurde) und FR-012 (konsistenter
Zustand). Der Nutzer glaubt, seine Änderungen seien übernommen, während sie unwiederbringlich
gelöscht wurden. Das ist der schwerste denkbare Fehler dieses Features.

**Empfehlung**: Die „nichts zu übernehmen"-Bedingung muss zusätzlich prüfen, ob der Branch
gegenüber dem Default-Branch **überhaupt Commits voraus** hat. Z. B.: sauberer Working-Tree
**und** `git rev-list --count <defaultBranch>..HEAD` == 0 ⇒ wirklich nichts zu übernehmen. Andernfalls
(sauber, aber Commits vorhanden) darf der `add`/`commit`-Schritt übersprungen, aber **muss** regulär
rebased+gemergt werden.

---

### 🟠 F2 — `discard` ist nicht gegen eine laufende `integrate` abgesichert (Race → Repo-Korruption)

**Ort**: `packages/server/src/services/chatWorkService.ts:196-202` (`discard`) &
`packages/web/src/components/ChatPanel.tsx:370-376` (Verwerfen-Button ohne `disabled`)

`integrate()` läuft asynchron (`:217`, `runIntegration`) und schützt sich per `this.integrating`
nur gegen ein zweites `integrate`. `discard()` prüft dieses Flag **nicht**. In der UI ist der
„Verwerfen"-Button während der Integration weiterhin klickbar (anders als „Übernehmen", das
`disabled={integrating}` ist). Klickt der Nutzer während der laufenden Integration „Verwerfen",
ruft `teardown()` `worktrees.remove(force)` / `git branch -D` **parallel** zu den git-Operationen
(rebase/commit/merge) derselben `runIntegration` auf.

**Auswirkung**: Gleichzeitige git-Operationen auf demselben Worktree/Branch können den Worktree
mitten im Rebase entfernen oder den Haupt-Checkout in einem halbfertigen Merge-Zustand hinterlassen
— genau der „kaputte, ungekennzeichnete Zustand", den SC-004/FR-012 ausschließen.

**Empfehlung**: `discard` gegen `this.integrating.has(conv.id)` sperren (409) **und** den
Verwerfen-Button in `WorkView` während `integrating` deaktivieren.

---

### 🟠 F3 — Kein Single-Flight-Schutz für Arbeits-Prompts → verwaiste Execution-Einträge & falsches Metering

**Ort**: `packages/server/src/services/chatWorkService.ts:171-184` (`sendPrompt`) &
`packages/web/src/components/ChatPanel.tsx:119-130, 411-417` (`sendWork`, Senden-Button)

Im Arbeits-Modus gibt es weder client- noch serverseitig eine „läuft gerade"-Sperre: Der
Senden-Button ist nur `disabled={!input.trim()}` (kein `busy`-Guard, anders als der Fragen-Modus,
`ChatPanel.tsx:267`), und `sendPrompt` startet bedingungslos eine neue Execution und **überschreibt**
`runningTurns.set(sessionId, …)` (`:182`). Wird ein zweiter Prompt gesendet, während der erste Turn
noch läuft, geht der `RunningTurn` des ersten Turns verloren; dessen Execution-Eintrag bleibt für
immer im Status `running` (bis der Boot-Reaper ihn als `orphaned` markiert), und das Kosten-Delta
wird dem falschen Turn zugeordnet.

**Auswirkung**: Verletzt FR-009 (Aktivität/Kosten „konsistent mit anderen Läufen" erfassen).
Kosten-/Token-Audit wird unzuverlässig, sobald der Nutzer nachfasst, während die Session arbeitet
— ein normaler Bedienvorgang bei längeren Turns.

**Empfehlung**: Senden im Arbeits-Modus sperren, solange der Status `working` ist (UI-Guard analog
Fragen-Modus), und/oder in `sendPrompt` einen bereits laufenden Turn ablehnen bzw. dessen Execution
sauber abschließen, bevor ein neuer gestartet wird.

---

### 🟡 F4 — `POST /chat/reset` auf eine Arbeits-Unterhaltung verwaist Worktree/Branch/PTY

**Ort**: `packages/server/src/api/server.ts:355-359` → `packages/server/src/services/chatService.ts:121-134`

Der generische Reset-Endpunkt ruft `chat.reset(projectId)` auf, das die aktive Unterhaltung
**modus-blind** beendet (`endConversation`). Für eine `work`-Unterhaltung wird dabei weder die
laufende PTY-Session beendet noch Worktree/Branch/Snapshot entfernt (das macht nur `discard`).
Ergebnis: verwaister Worktree auf Disk, weiterlaufender PTY-Prozess und ein toter Branch — ohne
Bereinigungspfad (die spätere `setMode('work')` legt eine *neue* Unterhaltung mit neuer ID an).

Aktuell ist der Reset-Button in der UI im Arbeits-Modus ausgeblendet (`ChatPanel.tsx:158`), der
Endpunkt bleibt aber öffentlich erreichbar. Das widerspricht der Garantie „Verwerfen = ohne
Rückstände" (FR-004/FR-007).

**Empfehlung**: `reset` im `work`-Modus entweder auf den `discard`-Pfad umleiten oder mit 409
ablehnen („bitte übernehmen oder verwerfen"), analog zu `setMode` (`chatWorkService.ts:71-76`).

---

### 🟡 F5 — `interrupt` weicht von Contract ab und liefert irreführenden Status

**Ort**: `packages/server/src/services/chatWorkService.ts:186-193`

`interrupt` schreibt ein einzelnes ESC (`\x1b`) und gibt fest `{ status: 'stopped' }` zurück,
obwohl die Session weiterläuft (die Rückgabe ist damit sachlich falsch). Der Contract
(`contracts/rest.md`, Abschnitt interrupt) beschreibt dagegen „2× Ctrl-C → SIGKILL". Die UI wertet
den Rückgabewert zwar nicht aus (`ChatPanel.tsx:132-133`, nur Fehlerbehandlung), aber der Status
`'stopped'` ist unzutreffend und der reale Effekt eines einzelnen ESC auf die Generierung ist nicht
verifiziert/getestet. Entweder Implementierung und Contract angleichen oder einen wahrheitsgemäßen
Status (z. B. `'interrupted'`/tatsächlicher `displayStatus`) zurückgeben.

---

### 🔵 F6 — Contract-Drift: `workSession.hasChanges` fehlt

**Ort**: `contracts/rest.md` (GET `/chat`) vs. `packages/shared/src/types.ts:237-244`
(`ChatWorkSessionInfo`)

Der REST-Contract sagt `workSession` ein Feld `hasChanges: boolean` zu; das DTO implementiert es
nicht. Funktional unkritisch (die UI nutzt es nicht, `integrate` behandelt den Leerfall selbst),
aber der Contract sollte mit der Implementierung abgeglichen werden, damit die Spezifikation nicht
irreführend bleibt.

---

## Positiv hervorzuheben

- Saubere additive Migration (`database.ts:189-195`): nullable Spalten, `CHECK`-Constraint für
  `mode`, FK mit `ON DELETE SET NULL` — keine Breaking-Changes; per Test (`chatWork.test.ts`) belegt.
- Konsequente Wiederverwendung von `PtySessionManager`/`SnapshotStore`/`MergeEngine`/`verifyService`
  statt eines Parallel-Stacks; der `snapshotKey`-Generalisierung (`sessionManager.ts:121-126`) folgt
  der Persistenz sauber.
- Resume-Recovery prüft die Existenz des Transkripts, bevor blind auf eine tote Session-ID resümiert
  wird (`chatWorkService.ts:128-134`) — konsistent mit dem Orchestrator.
- Modus-Wechsel verweigert das stille Verwerfen laufender Arbeit (`chatWorkService.ts:71-76`).
- Dedup/Resolve der Attention-Inbox um `conversationId` erweitert und getestet
  (`repos.ts:442-449`, `chatWork.test.ts:60-72`).

## Fazit

F1 ist ein blockierender Datenverlust-Fehler mit gleichzeitiger Falschmeldung („merged") und muss
vor einem Merge behoben werden. F2 (Repo-Korruptions-Race) und F3 (Audit-Inkonsistenz) sind
ebenfalls vor dem Merge zu beheben; F4/F5 sollten adressiert werden. Damit ist das Ergebnis
eindeutig negativ.

VERDICT: FAIL
