# Quickstart & Validierung: Wissens-Chat neu starten

Diese Anleitung validiert das Feature Ende-zu-Ende. Details zu Endpoint/Datenmodell:
siehe [contracts/restart-endpoint.md](./contracts/restart-endpoint.md) und [data-model.md](./data-model.md).

## Voraussetzungen

- Node ≥ 22, `pnpm@10`, lokal lauffähige Claude-Code-CLI (für echte Sessions).
- Abhängigkeiten installiert: `pnpm install`.

## Starten

```bash
# im Repo-Root
pnpm dev            # startet @sdd/server + @sdd/web parallel
```

Danach die Web-App im Browser öffnen (Vite-URL aus der Konsole), ein Projekt öffnen und die
Sprechblase unten rechts (Wissens-Chat) anklicken.

## Automatisierte Tests

```bash
pnpm --filter @sdd/server test      # vitest — Server-Logik (restart, Guard, Cleanup)
pnpm typecheck                      # Typprüfung über alle Pakete
```

Empfohlene neue Server-Tests (Kern-Invarianten aus data-model.md):

- **INV-1/INV-2**: Nach `restart` ist die aktive Conversation neu, die alte hat `ended_at` gesetzt und ihre Nachrichten sind weiterhin per `listMessages(oldId)` abrufbar.
- **INV-3**: Neue aktive Conversation hat `claude_session_id === null` (kein Resume ⇒ clean).
- **Guard (FR-006)**: Bei dirty Worktree / laufender Session liefert `restart` ohne `confirm` einen 409; mit `confirm: true` wird verworfen und neu gestartet.
- **INV-4/INV-5**: Nach mehreren `restart` existiert genau eine aktive Session; kein Worktree/Branch `chat/<oldId>` bleibt zurück.

## Manuelle Validierung (mappt auf Acceptance Scenarios)

### US1 — Neustart per Icon (P1)

1. Wissens-Chat öffnen, 1–2 Nachrichten austauschen (z. B. „Hallo, merke dir das Wort BANANE").
2. Auf das **Neustart-Icon** im Panel-Kopf klicken.
   - **Erwartet**: Konsole wird leer, eine neue Session startet **automatisch** und ist ohne weiteren Klick bedienbar (< 5 s, SC-002).
3. In der neuen Session fragen: „Welches Wort solltest du dir merken?"
   - **Erwartet**: Die Session kennt „BANANE" **nicht** (clean, FR-003 / SC-003).
4. Panel schließen und erneut öffnen.
   - **Erwartet**: Die **neue** (leere) Unterhaltung wird angezeigt, nicht die verworfene (FR-005).

### US2 — Warnung bei laufender Arbeit (P2)

5. In der Session eine Datei-Änderung anstoßen (z. B. „lege eine Datei test.txt an") und abwarten, bis Änderungen in der Arbeitskopie liegen; dann Neustart-Icon klicken.
   - **Erwartet**: Bestätigungsdialog erscheint **vor** dem Verwerfen (Guard `reason: dirty`).
   - Abbrechen → alte Unterhaltung + Arbeit bleiben unverändert.
   - Bestätigen → Neustart wie US1.
6. In einer frischen, ruhenden Session ohne Änderungen das Icon klicken.
   - **Erwartet**: Neustart **sofort ohne** Rückfrage (SC-005 wahrt: kein ungewarnter Verlust, aber auch keine unnötige Reibung).

### US3 — Ressourcen-Cleanup (P3)

7. Chat 3× hintereinander neu starten.
   - **Erwartet**: Genau **eine** aktive Session/Worktree für das Projekt (SC-004). Prüfen via `git worktree list` im Projekt: keine verwaisten `chat-<id>`-Worktrees der alten Unterhaltungen; `git branch --list 'chat/*'` zeigt keine Leichen.
8. Parallel ein reguläres Feature im selben Projekt öffnen und dann den Chat neu starten.
   - **Erwartet**: Die Feature-Session bleibt unberührt.

## Edge-Case-Checks

- **Doppelklick** auf Neustart schnell hintereinander → nur **eine** neue Session (Button disabled während Request, FR-008).
- **Offener Feature-Vorschlag** beim Neustart → Vorschlagskarte verschwindet mit der verworfenen Unterhaltung (FR-009); bereits angelegte Features bleiben in der Übersicht.
- **Neue Session startet nicht** (z. B. Claude-CLI weg) → verständliches Fehlerbanner, Icon bleibt nutzbar, erneuter Versuch möglich (FR-010).
