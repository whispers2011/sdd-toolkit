# Quickstart — Validierung

Feature: Projekt-Chat als vollwertige Claude-Code-Session

Dieses Dokument beschreibt ausführbare Validierungsszenarien, die belegen, dass das Feature
end-to-end funktioniert. Details zu Datenmodell/Contracts nicht duplizieren — siehe
`data-model.md`, `contracts/`.

## Voraussetzungen

- Node ≥ 22, git ≥ 2.40, Claude-Code-CLI (`claude`) im PATH.
- Ein hinzugefügtes Git-Projekt im Toolkit (Sidebar → „+ Projekt").
- App läuft: `pnpm install && pnpm dev` → Web auf `http://localhost:4830`, Server auf `:4820`.

## Setup / Checks vor der manuellen Prüfung

```bash
pnpm typecheck          # alle Pakete typen
pnpm test               # Domain-Machines (inkl. neuer chatMode-Guard) + DB/Git-Integration
```

Erwartung: grün. Neue Unit-Tests decken mindestens ab: `chatMode`-Guard/Übergang, Migration
(mode/conversation_id/attention.conversation_id additive & idempotent), `SessionRepo`
conversation-Bindung, generischer `SnapshotStore`-Key.

## Szenario 1 — Änderung im Arbeits-Modus umsetzen (US1 / P1)

1. Projekt öffnen → Sprechblase unten rechts → Chat öffnen.
2. Modus **„Arbeiten"** wählen (Umschalter sichtbar; Modus erkennbar).
3. Prompt: „Ergänze in `<eine Datei>` einen Kommentar `// hello sdd` am Dateiende."
4. Erwartung:
   - Es erscheint eine echte interaktive Konsole (Terminal) im Chat-Panel.
   - Der Assistent führt die Änderung aus und fasst sie zusammen.
   - Die Änderung liegt in der **isolierten Worktree** (`~/.sdd-toolkit/worktrees/<projectId>/chat-*`),
     **nicht** in der Haupt-Arbeitskopie.
5. Verifikation (Terminal/Shell):
   ```bash
   git -C <projekt> status         # Haupt-Arbeitskopie unverändert
   git -C ~/.sdd-toolkit/worktrees/<projectId>/chat-* diff   # Änderung sichtbar
   ```
   → mappt auf Acceptance US1-1/US1-2.

## Szenario 2 — Problem lösen (US2 / P1)

1. Im Projekt reproduzierbar einen Fehler erzeugen (z. B. einen Test rot machen).
2. Arbeits-Modus-Chat: „Der Test `<name>` schlägt fehl. Finde die Ursache und behebe sie."
3. Erwartung: Der Assistent führt Diagnose-Kommandos aus (z. B. Test-Runner), benennt die Ursache,
   setzt einen Fix in der Worktree um und verifiziert (Kommando erneut grün) — oder begründet
   nachvollziehbar, warum nicht (US2-1..3).

## Szenario 3 — Kontrolle: Freigabe, Beobachten, Unterbrechen, Verwerfen (US3 / P2)

1. Automation-Dial auf **Level 2** („nachfragen", `autoMode` aus) stellen.
2. Arbeits-Modus: eine eingreifende Aktion anfordern.
   - Erwartung: Freigabe wird angefragt (im Terminal bzw. „Braucht dich"-Inbox), Aktion erst nach
     Zustimmung (US3-1, FR-005).
3. Während einer laufenden Bearbeitung:
   - Fortschritt ist im Terminal sichtbar (US3-2).
   - „Unterbrechen" → Session stoppt zeitnah; Projekt/Worktree konsistent (US3-3).
4. „Verwerfen" (mit Bestätigung):
   - Erwartung: Worktree + Branch + Snapshot entfernt; Haupt-Arbeitskopie ohne Rückstände (US3-4,
     FR-007). Prüfen:
     ```bash
     git -C <projekt> worktree list        # chat-* nicht mehr gelistet
     git -C <projekt> branch --list 'chat/*'   # kein Chat-Branch
     ```

## Szenario 4 — Nur fragen bleibt nebenwirkungsfrei + Feature-Übergabe (US4 / P3)

1. Neue Unterhaltung im Modus **„Fragen"**.
2. Reine Projektfrage stellen → Antwort mit Projektbezug; **keine** Worktree/Branch/Feature-Artefakte
   entstehen (US4-1). Prüfen: keine `chat-*`-Worktree, keine neue Feature-Karte.
3. In der Unterhaltung eine erkennbar **feature-würdige** Anforderung beschreiben.
   - Erwartung: Der Assistent schlägt via Karte die Feature-Anlage vor (bestehender
     Proposal-Weg, `parseFeatureProposal`); „Feature anlegen …" öffnet den vorbefüllten
     `NewFeatureDialog` (US4-2, FR-010).

## Szenario 5 — Neustart-Wiederherstellung (FR-008)

1. Arbeits-Modus-Chat mit ein paar Änderungen offen lassen.
2. Server neu starten (`pnpm dev` neu).
3. Projekt öffnen → Chat im Arbeits-Modus:
   - Erwartung: Der bisherige Konsolen-Inhalt ist per Snapshot-Replay wieder sichtbar; die Session
     wird via `claude --resume` fortgesetzt; die Worktree/Änderungen sind noch da. Verwaiste
     `chat_work`-Executions sind als `orphaned` markiert (Executions-View).

## Szenario 6 — Übernehmen nach main (FR-004)

1. Arbeits-Modus-Chat mit einer sinnvollen, testbaren Änderung.
2. (Optional) `verifyCommands` des Projekts gesetzt (z. B. `pnpm test`).
3. „Übernehmen":
   - Erwartung: commit → verify (grün) → merge nach `main` → Worktree/Branch entfernt; Änderung ist
     jetzt in der Haupt-Arbeitskopie/`main`.
   - Bei rotem Verify: **kein** Merge; Inbox-Eintrag `verify_failed` (mit `conversationId`),
     Worktree bleibt für erneuten Versuch erhalten (FR-012, „nie blind mergen").

## Abbruch-/Fehlerpfade (Edge Cases)

- Session kann nicht starten → verständliche Fehlermeldung, Sprechblase bleibt nutzbar.
- Langlaufendes Kommando → Unterbrechen greift; Zeitlimit als Fallback.
- Parallele Feature-Session am selben Projekt → getrennte Worktrees, kein gegenseitiger Schaden.
