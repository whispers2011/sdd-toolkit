# Quickstart / Validation: Projekt-Klick öffnet Board-Ansicht

**Feature**: `feature/klick-auf-projektname-soll-board-oeffnen` | **Date**: 2026-07-22

Validierungs-Leitfaden, der beweist, dass das Feature Ende-zu-Ende funktioniert. Details zu den erwarteten Ergebnissen siehe [contracts/ui-interaction.md](./contracts/ui-interaction.md) (Zeilen C1–C9) und [spec.md](./spec.md) (FR-001…FR-008).

## Voraussetzungen

- Node ≥ 22, pnpm, git ≥ 2.40 (siehe `README.md`).
- Mindestens **zwei** Projekte im Toolkit hinzugefügt, davon eines mit einem oder mehreren Features (Board-Karten). Andernfalls über die Sidebar (》+ Projekt《) zwei Git-Repos hinzufügen.

## Setup / Start

```bash
pnpm install                      # falls noch nicht geschehen
pnpm dev                          # Server (4820) + Web-UI (4830)
# App öffnen:
open http://localhost:4830
```

## Statische Verifikation (Pflicht)

```bash
pnpm --filter @sdd/web typecheck  # muss fehlerfrei durchlaufen
```

> Hinweis: `pnpm --filter @sdd/web test` ist im MVP ein No-op-Stub (kein Web-Unit-Test-Harness). Die funktionale Prüfung erfolgt manuell/E2E unten.

## Manuelle Prüfszenarien

Nummerierung folgt dem Interaktions-Contract.

1. **C1 – Grundfall**: In eine Nicht-Board-Ansicht wechseln (Tab 》Läufe《 oder 》Braucht dich《). In der Sidebar auf einen **Projektnamen** klicken.
   → **Erwartet**: Board-Ansicht erscheint, zeigt nur Features dieses Projekts, Projektzeile ist hervorgehoben.

2. **C2 – aus anderer Ansicht**: Von 》Grid《 aus auf ein Projekt klicken.
   → **Erwartet**: Wechsel zum Board dieses Projekts.

3. **C3 – aus eigener Konsole**: Eine Feature-Konsole von Projekt A öffnen (Feature-Eintrag anklicken). Dann in der Sidebar auf den **Projektnamen A** klicken.
   → **Erwartet**: Wechsel zum Board von A (Konsole wird nicht beibehalten); die laufende Session bleibt im Hintergrund erhalten (erneutes Öffnen der Konsole zeigt sie weiter).

4. **C4–C6 – Aktionsbuttons**: Projektzeile hovern, nacheinander 》+《, 》>_《, 》⚙《 klicken.
   → **Erwartet**: Jeweils nur die zugehörige Aktion (Feature-Dialog / Terminal / Einstellungen); **kein** Board-Wechsel ausgelöst.

5. **C7 – Feature-Klick**: Auf einen Feature-Unterpunkt klicken.
   → **Erwartet**: Feature-Konsole öffnet (nicht das Board).

6. **C8 – Alle Projekte**: In einer Nicht-Board-Ansicht (z. B. 》Läufe《) auf 》Alle Projekte《 klicken.
   → **Erwartet**: Scope wird auf alle Projekte gesetzt, die **aktive Ansicht bleibt** (kein erzwungener Board-Wechsel).

7. **C9 – Idempotenz**: Board von Projekt A geöffnet lassen, erneut auf Projekt A klicken.
   → **Erwartet**: Board von A bleibt stabil; keine sichtbaren Nebeneffekte, keine abgebrochenen Prozesse.

8. **Leerzustand**: Auf ein Projekt ohne (sichtbare) Features klicken.
   → **Erwartet**: Leeres, auf das Projekt bezogenes Board (kein Fehler, kein Fremdinhalt).

## Erfolgskriterien (Abgleich mit Spec)

- Alle Szenarien 1–8 verhalten sich wie beschrieben → FR-001…FR-008 erfüllt.
- Board eines Projekts wird mit **einem** Klick erreicht (vorher: Projekt wählen + Board-Tab) → SC-002.
- Ansichtswechsel ohne wahrnehmbare Verzögerung → SC-003.
- `typecheck` fehlerfrei.

## Optional: E2E via chrome-devtools MCP

Bei laufender App (`http://localhost:4830`) kann der Klickpfad automatisiert nachgestellt werden: Seite öffnen → Snapshot → auf die Projektzeile klicken → Snapshot prüfen, dass die Board-Spalten sichtbar und auf das Projekt beschränkt sind (entspricht C1).
