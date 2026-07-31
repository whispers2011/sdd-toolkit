# Contract: Optimization-Settings API & Auflösung

Steuert die Reduktionsmaßnahmen; reversibel (FR-008), Ebenen global → Projekt → Feature.

## Datenform

Siehe data-model.md §3. `OptimizationSettings { contextStrategy, compression }`, Partials auf Projekt-/Feature-Ebene.

## REST

### GET /api/settings/optimization
→ `200 { optimization: OptimizationSettings }` (globaler, effektiver Default).

### PATCH /api/settings/optimization
Body: `Partial<OptimizationSettings>` → merged in globalen Default. → `200 { optimization }`.

### PATCH /api/projects/:id  (erweitert)
Akzeptiert zusätzlich `optimization: Partial<OptimizationSettings>` (analog zum bestehenden `automation`-Feld, `types.ts:90`). → aktualisiertes `Project`.

### PATCH /api/features/:id  (erweitert)
Akzeptiert zusätzlich `optimization: Partial<OptimizationSettings>` (analog `feature.automation`, `types.ts:109`). → aktualisiertes `Feature`.

## Auflösung (pure, `@sdd/shared`)

```
resolveOptimization(global, project.optimization, feature.optimization) → OptimizationSettings
```
Präzedenz identisch zu `resolveAutomation` (`types.ts:273-279`): `{ ...global, ...project, ...feature }`.

## Verhaltensverträge

- **Reversibilität (FR-008)**: global `{ contextStrategy:'full', compression:'off' }` ⇒ exakt heutiges Verhalten (kein Reset, keine Verdichtung). Keine Datenmigration nötig.
- **Snapshot**: Beim Phasenstart wird die aufgelöste Strategie ermittelt und auf der Execution gespeichert (`opt_context_strategy`, `opt_compression`) — Grundlage des A/B-Nachweises.
- **Scope (FR-011)**: Settings wirken nur auf `kind='phase'`-Läufe.
- **Default-Sicherheit (FR-010)**: unbekannte Enum-Werte oder Auflösungsfehler ⇒ `full`/`off`.

## Contract-Tests
- `resolveOptimization` Präzedenz (global < project < feature).
- Leeres Feature-Partial erbt Projekt-/Global-Wert.
- PATCH validiert Enum-Werte; ungültige → 400 oder Ignorieren mit Default (defensiv).
