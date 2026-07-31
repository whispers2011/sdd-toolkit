# Quickstart / Validierung: Läufe haben kein Log

Belegt end-to-end, dass Session-Durchläufe in der „Läufe"-Ansicht ein Log liefern.

## Voraussetzungen

- Node ≥ 22, pnpm, Claude Code CLI (`claude`) im PATH.
- Repo installiert: `pnpm install`.
- Ein Ziel-Projekt mit spec-kit und mindestens einem Feature (Worktree/Session vorhanden).

## Automatisierte Prüfungen

```bash
pnpm test         # inkl. neuer Unit-Tests für renderTranscriptLog + Endpoint-Test
pnpm typecheck    # alle Pakete
```

Erwartung: grün. Neu:
- `packages/shared/src/transcriptLog.test.ts` — Renderer (Prompt/Assistant/Tool/Abbruch/
  leer/kaputte Zeile).
- Server-Endpoint-Test — Fälle A–E aus `contracts/executions-log.md`.

## Manuelle End-to-End-Validierung

1. App starten: `pnpm dev`, dann `http://localhost:4830` öffnen.
2. Ein Feature wählen und einen Phasen-Lauf ausführen (z. B. `/speckit.specify` oder eine
   Phase über die Phasen-Leiste/Kanban starten). Warten, bis der Turn „fertig" ist.
3. In die **„Läufe"-Ansicht** wechseln, Zeile des soeben gelaufenen Phasen-Laufs (Art
   „Phase") suchen und **„Log"** klicken.
   - **Erwartet (SC-001, FR-002)**: Das rechte Panel zeigt den gerenderten Lauf-Inhalt
     (Prompt + Assistant-Text + Tool-Aktionen), **nicht** „Kein Log vorhanden".
   - **Erwartet (FR-006)**: Text ist lesbar, ohne ANSI-/Steuerzeichen-Müll.
4. Zwei aufeinanderfolgende Phasen (z. B. specify → plan) ausführen, dann beide Logs öffnen.
   - **Erwartet (SC-003, FR-003)**: Jedes Log enthält nur seinen eigenen Lauf, keine
     Vermischung.
5. Während ein Phasen-Lauf noch **läuft** (Status „running"), dessen „Log" öffnen.
   - **Erwartet (FR-005)**: Bisheriger Inhalt erscheint; nach kurzer Zeit erneut öffnen/
     nachladen → mehr Inhalt.
6. Log eines **Verify-/Review-/Chat-Laufs** öffnen.
   - **Erwartet (FR-007, SC-005)**: unverändert der Dateiinhalt.
7. (Optional) Server neu starten (`pnpm dev` erneut), Schritt 3 für den früheren Lauf
   wiederholen.
   - **Erwartet (FR-001)**: Das Log ist weiterhin abrufbar (aus persistierten
     Koordinaten + Transkript).
8. (Optional) Einen sehr langen `implement`-Lauf ausführen und dessen Log öffnen.
   - **Erwartet (FR-009)**: vollständig und scrollbar, ohne Kürzung.

## Referenzen

- Vertrag: `contracts/executions-log.md`
- Datenmodell/Migration: `data-model.md`
- Betroffene Dateien & Ansatz: `plan.md`
