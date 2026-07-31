# Phase 1 Data Model: Light-/Dark-Mode-Umschalter

**Feature**: `light-model-claude-chat-farben` · **Date**: 2026-07-23

Das Feature führt genau **eine** persistente Größe ein: die Theme-Präferenz.
Es gibt kein Server-Datenmodell und keine Schemaänderung.

## Entität: Theme-Präferenz

Der vom Nutzer gewählte Darstellungsmodus, gerätelokal gespeichert.

| Feld | Typ | Werte | Beschreibung |
|------|-----|-------|--------------|
| `preference` | Enum (String) | `"light"` \| `"dark"` \| _(abwesend)_ | Persistierte explizite Wahl. **Abwesend** = noch keine explizite Wahl → Systempräferenz gilt. |
| `resolvedMode` | Enum (abgeleitet, nicht persistiert) | `"light"` \| `"dark"` | Der tatsächlich angewendete Modus zur Laufzeit. |
| `source` | Enum (abgeleitet, nicht persistiert) | `"explicit"` \| `"system"` | Herkunft von `resolvedMode`: explizite Wahl oder aus Systempräferenz abgeleitet. |

### Speicherort

- **Medium**: Browser-`localStorage` (gerätelokal, kein Server, kein Konto).
- **Schlüssel**: `sdd-theme`.
- **Wert**: der String `"light"` oder `"dark"`. Fehlender Schlüssel ≙ `preference` abwesend.
- Reiht sich in die vorhandenen `sdd-*`-Schlüssel ein (`sdd-selected-project`,
  `sdd-show-completed`, `sdd-sound`, `sdd-chat-size`).

### Ableitungsregeln (`resolvedMode` / `source`)

1. Ist `sdd-theme` gesetzt (`"light"`/`"dark"`) → `resolvedMode = preference`,
   `source = "explicit"`. (FR-007, FR-010)
2. Sonst, wenn `matchMedia('(prefers-color-scheme: dark)')` → `resolvedMode = "dark"`, sonst `"light"`; `source = "system"`. (FR-008)
3. Ist keine Systemangabe verfügbar → `resolvedMode = "dark"` (Fallback, heutiges
   Erscheinungsbild). (FR-008, Edge Case „Erstnutzung")

### Zustandsübergänge

| Auslöser | Vorher | Nachher | Persistenz |
|----------|--------|---------|------------|
| Erst-Load, kein `sdd-theme` | — | `resolvedMode` = System/Dark, `source=system` | keine (nichts geschrieben) |
| Nutzer betätigt Umschalter | beliebig | `resolvedMode` invertiert, `source=explicit` | `sdd-theme` ← neuer Wert |
| Erneuter Load, `sdd-theme` gesetzt | — | `resolvedMode = preference`, `source=explicit` | unverändert |
| Systempräferenz ändert sich, `source=explicit` | explizit | **unverändert** (Nutzerwahl gewinnt) | unverändert (FR-010) |
| Systempräferenz ändert sich, `source=system` | system | folgt neuer Systempräferenz | keine (Edge Case) |

### Validierung / Invarianten

- `preference` nimmt nur `"light"` oder `"dark"` an; unbekannte/kaputte Werte
  werden wie „abwesend" behandelt (Fallback auf System/Dark) — kein Absturz.
- `resolvedMode` ist zu jedem Zeitpunkt genau `"light"` **oder** `"dark"`.
- Ein Moduswechsel verändert **nur** Darstellungsvariablen; er berührt keinen
  Sitzungs-, Chat- oder Streaming-Zustand (FR-009).

## Abgeleitete Darstellungs-Artefakte (kein persistenter Zustand)

Diese ergeben sich deterministisch aus `resolvedMode` und werden nicht
gespeichert; hier zur Vollständigkeit des Modells:

- **CSS-Attribut**: `document.documentElement[data-theme] = resolvedMode`.
- **`color-scheme`**: `light` bzw. `dark` (native Controls/Scrollbars).
- **Terminal-Theme**: vollständige xterm-Palette je `resolvedMode` (siehe
  `contracts/ui-contract.md`).
