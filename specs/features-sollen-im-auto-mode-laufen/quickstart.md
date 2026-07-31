# Quickstart — Features im Auto-Modus (Validierung)

Belegt end-to-end, dass die drei User Stories erfüllt sind. Details zu Feldern/Endpunkten
siehe [data-model.md](./data-model.md) und [contracts/auto-mode.md](./contracts/auto-mode.md).

## Voraussetzungen

- Node ≥ 22, `pnpm install` ausgeführt.
- Claude Code CLI (`claude`) im PATH; ein Ziel-Repo mit spec-kit als Projekt hinzugefügt.
- App läuft: `pnpm dev` → Server (4820) + Web-UI (4830), `open http://localhost:4830`.

## Automatisierte Prüfungen

```bash
pnpm test        # Vitest über alle Packages
pnpm build       # Type-Check/Build muss grün sein (neues Feld korrekt typisiert)
pnpm lint        # sofern konfiguriert
```

Erwartet: bestehende `sessionMachine`/`phaseMachine`-Tests grün; neue Unit-Tests
(siehe tasks) für das `autoMode → permissionMode`-Mapping und für „kein
`permission_request`-Attention" grün.

## Szenario 1 — Neues Feature läuft ohne Kommando-Rückfragen (US1)

1. Sicherstellen, dass der Auto-Modus global **an** ist (Default; Dial oben rechts prüfen).
2. Neues Feature anlegen und dessen Session öffnen.
3. Eine Phase starten, die Shell-Kommandos ausführt (z. B. `implement`).

**Erwartet**: Der Agent führt Kommandos aus, **ohne** in der Konsole „Darf ich … ausführen?"
zu fragen; der Prozess wurde mit `--permission-mode bypassPermissions` gestartet
(prüfbar über die Prozess-Argv / Session-Log).

## Szenario 2 — Auto-Modus oben rechts umschalten (US2)

1. Dial oben rechts öffnen → **Auto-Modus** auf **aus** stellen.
2. Seite neu laden.

**Erwartet**: Schalter bleibt „aus" (persistiert via `PUT /api/settings/automation`).

3. Neues Feature starten.

**Erwartet**: Session startet mit `--permission-mode acceptEdits`; bei einem
Kommando erscheint wieder die Rückfrage **in der Feature-Konsole**.

4. Dial → **Auto-Modus** auf **an**; neues Feature starten.

**Erwartet**: keine Kommando-Rückfragen.

## Szenario 3 — Keine Berechtigungs-Rückfragen in „Braucht dich" (US3)

1. Auto-Modus **aus** (um überhaupt einen Permission-Fall zu erzeugen).
2. Ein Feature so laufen lassen, dass Claude eine Kommando-Berechtigung anfordert.
3. In den „Braucht dich"-Tab wechseln.

**Erwartet**:
- **Kein** Eintrag vom Typ „Berechtigung"; der offene-Items-Zähler zählt ihn nicht.
- Die betroffene Session zeigt dennoch Status „wartet auf Eingabe" (Status-Dot/Konsole).
- Zum Gegentest eine echte Agent-Frage (`AskUserQuestion`) bzw. eine rote Verifikation
  auslösen → diese erscheinen weiterhin regulär in „Braucht dich".

## Szenario 4 — Override-Hierarchie (FR-008)

1. Global Auto-Modus **an**.
2. Für ein Projekt bzw. Feature den Automation-Override auf ein Preset setzen, das
   `autoMode: false` trägt (bzw. gezielt überschreiben).

**Erwartet**: Nur die Sessions dieses Projekts/Features starten in `acceptEdits`;
alle anderen bleiben `bypassPermissions`. (`resolveAutomation` global→Projekt→Feature.)

## Erfolgskriterien-Abgleich

| Szenario | Deckt ab |
|----------|----------|
| 1 | SC-001, SC-003, FR-001, FR-004 |
| 2 | SC-002, SC-005, FR-002, FR-003, FR-007, FR-009 |
| 3 | SC-003, SC-004, FR-005, FR-006 |
| 4 | FR-008 |
