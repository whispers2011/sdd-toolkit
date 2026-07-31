# Quickstart: Validierung „Kommandos direkt ausführen"

Runnable Validierung, dass Kommandos beim Auslösen tatsächlich starten und die Statusanzeige der Realität entspricht. Details zu Verhalten/Grenzen: siehe [contracts/](./contracts/) und [data-model.md](./data-model.md).

## Voraussetzungen

- Repo-Setup wie üblich (pnpm-Monorepo), `claude` CLI verfügbar.
- Ein Projekt mit mindestens einem Feature, das eine startbare (idle) Phase hat.

## Automatisierte Tests

```bash
# Pure Domänenlogik + Server-Unit-Tests (Bereitschaft/Submit/Reconciliation)
pnpm -r test
# gezielt:
pnpm --filter @sdd/shared test
pnpm --filter @sdd/server test
```

Erwartet: neue Tests für die Send-Pipeline (Bereitschafts-Gate, Submit-Bestätigung, Retry, `onSubmitFailed`), für die Startfehler-/Interrupt-Reconciliation und für die reine UI-Ableitungsregel sind grün; bestehende Tests bleiben grün.

## Manuelle End-to-End-Szenarien

### S1 — Kaltstart: „Run" startet sofort (US1, FR-001/FR-002)
1. Stack starten (`pnpm dev` o. ä.), Board öffnen.
2. Auf einer Kachel mit idle-Phase „▶ Start" klicken (Feature-Session ist noch nicht hochgefahren).
3. **Erwartet**: In der Feature-Konsole wird der Slash-Command **abgeschickt** und ausgeführt — ohne manuelles Enter. Keine unbestätigte Eingabezeile.

### S2 — Statuswahrheit (US2, FR-003/SC-003)
1. Direkt nach Klick auf „Run" die Kachel beobachten.
2. **Erwartet**: kurz „wird gestartet …", dann „läuft …", sobald die Session real arbeitet. Zu keinem Zeitpunkt „läuft …", während nichts abgeschickt wurde.

### S3 — Freier Prompt weiterhin absendbar (FR-006)
1. Prompt-Leiste öffnen, Text eingeben, „Senden".
2. **Erwartet**: Prompt wird wie bisher automatisch abgeschickt (keine Regression).

### S4 — Resume nach Stack-Neustart (FR-009)
1. Während eine Phase läuft, den Server neu starten.
2. **Erwartet**: Die betroffene Kachel zeigt **nicht** „läuft …", sondern erscheint in der „braucht dich"-Inbox als fortsetzbar; „▶ Start"/„Run" ist verfügbar.
3. „Run" klicken. **Erwartet**: Der Lauf wird tatsächlich fortgesetzt (Command abgeschickt), und das „braucht dich"-Item löst sich auf, sobald die Session arbeitet.

### S5 — Resume nach PC-Ruhezustand (FR-009)
1. Bei laufender Session den Rechner in den Ruhezustand versetzen und wieder aufwecken.
2. **Erwartet**: Falls der Lauf still endete/stallte, zeigt die Kachel kein falsches „läuft …"; ein noch offener Lauf erscheint als „braucht dich". „Run" setzt zuverlässig fort.

### S6 — Startfehler (FR-004)
1. Startfehler provozieren (z. B. Worktree-Pfad ungültig machen, sodass `ensureSession` scheitert).
2. Auf „Run" klicken.
3. **Erwartet**: Kachel bleibt **nicht** in „läuft …"; sie erscheint in „braucht dich" mit erkennbarem Fehlerhinweis; Phase ist wieder idle.

### S7 — Scope-Ausnahmen bleiben (FR-007/FR-010)
1. **Init**: spec-kit-Init im Projekt-Terminal auslösen. **Erwartet**: Befehl wird nur vorausgefüllt, **nicht** automatisch abgeschickt — Nutzer bestätigt bewusst mit Enter.
2. **Bild-Pfad**: ein Bild in die Feature-Konsole einfügen. **Erwartet**: Der Dateipfad wird eingefügt, **nicht** automatisch abgeschickt.

### S8 — Doppelklick (FR-008)
1. „Run" schnell mehrfach klicken.
2. **Erwartet**: genau ein Lauf; keine doppelte Ausführung; kein roher Fehler-Toast.

## Erfolgskriterien-Mapping

| Szenario | Erfüllt |
|----------|---------|
| S1, S4-Fortsetzen | SC-001, SC-002 |
| S2 | SC-003 |
| S1, S4/S5 | SC-004 |
| S3 | SC-005 |
