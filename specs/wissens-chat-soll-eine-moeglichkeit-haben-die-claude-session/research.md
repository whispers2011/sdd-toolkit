# Phase 0 Research: Wissens-Chat neu starten

Die Spec enthält keine offenen `[NEEDS CLARIFICATION]` (durch `/speckit-clarify` aufgelöst). Der
Tech-Stack ist vollständig bekannt (bestehendes Monorepo). Diese Datei hält die zentralen
technischen Entscheidungen fest und begründet die Wiederverwendung bestehender Bausteine.

## Entscheidung 1 — „Clean" durch neue Conversation-ID statt Kontext-Löschen

- **Decision**: Neustart = alte Unterhaltung deaktivieren + **neue** `createConversation(projectId, 'work')` anlegen; die neue Session wird über den unveränderten `ChatWorkService.ensure`-Pfad gespawnt.
- **Rationale**: `ensure` bindet Worktree (`chat-<convId>`), Branch (`chat/<convId>`) und Resume-Session-ID an die `conversationId`. Eine neue ID erzwingt automatisch eine leere Worktree und `latestForConversation(newId) === null` ⇒ **kein `--resume`** ⇒ garantiert kontextfreie Session (FR-003). Kein Eingriff in Claude-interne Kontextverwaltung nötig.
- **Alternatives considered**: (a) Bestehende Session „leeren"/neu prompten — unsicher, Alt-Kontext bliebe im Claude-Transkript; (b) `chat_messages` löschen — verstößt gegen Q2 (Verlauf soll erhalten bleiben) und würde die Session-ID nicht zurücksetzen.

## Entscheidung 2 — Deaktivieren = `endConversation` (Verlauf bleibt erhalten)

- **Decision**: `ChatRepo.endConversation(id)` setzt `ended_at`; `getActive` filtert `ended_at IS NULL`. Nachrichten in `chat_messages` werden **nicht** gelöscht.
- **Rationale**: Erfüllt Q2/FR-002 („deaktivieren, im Datenbestand behalten, nicht löschen") ohne neue Spalte oder Migration. Nutzt exakt das bestehende aktiv/inaktiv-Modell (identisch zu `chatService.reset`).
- **Alternatives considered**: Hard-Delete (verworfen, s. Clarification Q2); eigenes `is_active`-Flag (redundant — `ended_at` existiert bereits).

## Entscheidung 3 — Ressourcen-Cleanup der verworfenen Session

- **Decision**: Reihenfolge im `restart`: (1) laufende PTY-Session via `ptys.forConversation(oldConvId)` → `terminate(id)` + `remove(id)`; (2) `worktrees.remove(projectPath, worktreePath, { force: true })`; (3) `mergeEngine.deleteBranch(projectPath, 'chat/<oldConvId>')` (Fehler tolerieren); (4) `endConversation(oldConvId)`.
- **Rationale**: Verhindert verwaiste Worktrees/Branches/Prozesse (FR-007, FR-008, SC-004). `worktrees.remove` bricht bei dirty Worktree ohne `force` ab (Guard in `worktrees.ts:44`) — nach bestätigtem Neustart ist `force: true` korrekt, weil der Verlust bewusst freigegeben wurde. `deleteBranch` (`git branch -D`) wird wie im MergeQueue-Pfad mit `.catch(() => {})` best-effort ausgeführt.
- **Offene Detailfrage (Implementierung)**: Den Worktree-Pfad der alten Conversation rekonstruieren — entweder über `worktrees.list(projectPath)` und Match auf Branch `chat/<oldConvId>`, oder über den beim `ensure` erzeugten deterministischen Pfad. Beides ist verfügbar; Task-Phase wählt die simplere Variante.

## Entscheidung 4 — Warn-Guard server-autoritativ (FR-006 / Q1)

- **Decision**: Der `restart`-Endpoint nimmt `{ confirm?: boolean }`. Der Server ermittelt „Arbeit vorhanden" = Session-Status ∈ {`working`, `awaiting_input`} **ODER** `!isCleanWorkingTree(worktreePath)`. Ist Arbeit vorhanden und `confirm` fehlt/false ⇒ Antwort `409 { needsConfirm: true, reason }`, **ohne** etwas zu verwerfen. Mit `confirm: true` (oder ohne Arbeit) wird der Neustart durchgeführt.
- **Rationale**: Die „dirty"-Erkennung braucht einen Git-Aufruf und die maßgebliche Wahrheit liegt im Server (vermeidet Duplizierung der bekannten „untracked = unclean"-Falle im Frontend). Ein 409-Roundtrip ist billiger als `isCleanWorkingTree` bei jedem `GET /chat`-Poll. Genau das von Q1 gewählte Verhalten.
- **Alternatives considered**: `dirty`-Flag in `GET /chat` (mehr Git-Last pro Poll); reiner Frontend-`window.confirm` ohne Server-Check (kann dirty Worktrees nicht erkennen).

## Entscheidung 5 — Automatischer Start & sauberer UI-Remount (FR-004 / FR-005)

- **Decision**: Nach erfolgreichem `restart` gibt der Server die neue `sessionId` zurück und feuert `chat_updated`. Das Frontend lädt `getChat` neu; die `TerminalPane` wird per **`key={conversationId}`** (statt `key={projectId}`) neu gemountet und verbindet sich über `ensureChatWorkSession` automatisch mit der frischen Session.
- **Rationale**: `projectId` ändert sich beim Neustart nicht → aktueller `key={projectId}` würde die Terminal-Komponente **nicht** remounten und zeigte den alten Scrollback. Ein `conversationId`-Key erzwingt den sauberen Neuaufbau (leere Konsole, FR-005) und der `ensure`-Aufruf startet die Session automatisch (FR-004).
- **Alternatives considered**: Panel komplett schließen/öffnen (schlechtere UX); Scrollback manuell leeren (löst nicht die Session-Bindung).

## Entscheidung 6 — Idempotenz gegen Doppelklick (FR-008)

- **Decision**: Während ein `restart` läuft, wird der Icon-Button deaktiviert (Frontend) und der Server behandelt einen erneuten `restart` für dasselbe Projekt idempotent (kein zweiter neuer Worktree). `ensure` ist bereits idempotent (`forConversation` liefert bestehende Session).
- **Rationale**: Verhindert Ansammlung paralleler Sessions bei schnellem Mehrfachklick (Edge Case, SC-004).
- **Alternatives considered**: Server-seitiges Lock je Projekt — nur nötig, falls sich echte Races zeigen; im Einzelnutzer-Kontext genügt Button-Disable + Idempotenz von `ensure`.
