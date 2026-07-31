# Quickstart & Validation: Nur ein Projektkontext

**Feature**: Nur ein Projektkontext — „Alle Projekte" entfernen
**Date**: 2026-07-22

Manuelle End-to-End-Validierung der Invariante „genau ein Projektkontext". Referenzen: [spec.md](./spec.md), [contracts/ui-state-contract.md](./contracts/ui-state-contract.md).

## Voraussetzungen

- Node ≥ 22, pnpm 10, Abhängigkeiten installiert (`pnpm install`).
- Mindestens **zwei** Projekte im Toolkit, jeweils mit ≥ 1 Feature (zur Kontextprüfung). Bei Bedarf über „+ Projekt" in der Sidebar hinzufügen.

## Statische Verifikation (Pflicht)

```bash
pnpm --filter @sdd/web typecheck
```

**Erwartet**: keine Typfehler. Das Verengen von `select_project` auf `projectId: string` macht jeden übersehenen `null`-Pfad zu einem Compile-Fehler (Vertrag C2/C4).

Optional Gesamtbau:

```bash
pnpm --filter @sdd/web build
```

## App starten

```bash
pnpm dev          # startet Server + Web parallel
# danach die angezeigte Web-URL im Browser öffnen
```

## Validierungsszenarien

Jedes Szenario bildet Akzeptanzkriterien bzw. Vertragspunkte ab.

### V1 — Keine „Alle Projekte"-Option (US1 / C2 / SC-003)
1. Sidebar betrachten.
2. **Erwartet**: Kein Button „Alle Projekte"; nur einzelne Projekte sind wählbar.

### V2 — Strikte Kontextfilterung (US1 / C3 / SC-001)
1. Projekt A wählen.
2. Nacheinander Board, Grid, Läufe, Braucht dich öffnen.
3. **Erwartet**: Ausschließlich Inhalte von A; keinerlei B-Inhalte (Features, Panes-Auswahl, Läufe, Attention).
4. In der Sidebar Projekt B klicken → alle Ansichten zeigen nun nur B.

### V3 — Automatische Startwahl (US2 / C4 / SC-002)
1. Projekt B wählen, dann Seite neu laden.
2. **Erwartet**: B ist ohne Interaktion aktiv (gemerkte Auswahl, C5).
3. `localStorage['sdd-selected-project']` entfernen und neu laden.
4. **Erwartet**: Erstes Projekt der Liste ist automatisch aktiv; nie „kein Projekt".

### V4 — Persistenz über Neustart (US2 / C5 / SC-005)
1. Projekt B wählen.
2. Browser-Tab schließen und App erneut öffnen.
3. **Erwartet**: B ist weiterhin aktiv.

### V5 — Aktives Projekt entfernen (US3 / C4 / FR-006)
1. Projekt A ist aktiv.
2. Über ⚙ → „Projekt entfernen …" A entfernen.
3. **Erwartet**: Kontext springt automatisch auf ein anderes vorhandenes Projekt; kein Leer-/Null-Zustand, keine Fehler.

### V6 — Fremd-Navigation wechselt Kontext (US3 / C6 / SC-004)
1. Projekt A ist aktiv.
2. `⌘K` öffnen, ein Feature aus Projekt B anspringen.
3. **Erwartet**: Kontext wechselt auf B; Konsole des B-Features ist offen.
4. Analog: Klick auf eine Desktop-Benachrichtigung eines B-Features → Kontext wird B.

### V7 — Leerzustand (US3 / C7 / FR-008)
1. Alle Projekte entfernen (oder frische Instanz ohne Projekte).
2. **Erwartet**: Sidebar zeigt „Noch keine Projekte"; projektbezogene Ansichten ohne Inhalte, keine Konsolenfehler.
3. Erstes Projekt hinzufügen → es wird automatisch aktiver Kontext.

## Erfolgskriterium

Alle V1–V7 verhalten sich wie erwartet **und** `pnpm --filter @sdd/web typecheck` läuft fehlerfrei durch.
