# Quickstart & Validierung: SDD-Schritt-Definitionen einsehen & bearbeiten

Validierungsleitfaden, der beweist, dass das Feature Ende-zu-Ende funktioniert. Details siehe [data-model.md](./data-model.md) und [contracts/phase-definition-api.md](./contracts/phase-definition-api.md).

## Voraussetzungen

- Node.js ≥ 22, pnpm 10.
- Mindestens ein verwaltetes Projekt mit spec-kit-Installation (`<project.path>/.claude/skills/speckit-*/SKILL.md`).
- Neue Abhängigkeit installiert: `pnpm --filter @sdd/web add react-markdown remark-gfm`.

## Setup & Start

```bash
pnpm install
pnpm dev            # startet @sdd/server und @sdd/web parallel
```

## Automatisierte Prüfungen

```bash
pnpm --filter @sdd/server test     # Resolver-, Konflikt-, Lock- und Route-Tests
pnpm typecheck                     # Typen über alle Pakete (inkl. neue DTOs)
pnpm --filter @sdd/web build       # tsc --noEmit + vite build (Web kompiliert)
```

Erwartung: alle Tests grün; Typecheck ohne Fehler.

## Manuelle End-to-End-Szenarien

### Szenario 1 – Schritt verstehen (US1, P1)
1. Board öffnen, ein Projekt auswählen.
2. Im Header der Lane **Specify** auf das Info-Icon klicken.
3. **Erwartung**: Dialog öffnet sich in < 1 s und zeigt die Specify-Definition als **formatiertes** Markdown (Überschriften/Listen lesbar). (SC-001, SC-002)
4. Dialog schließen → Board unverändert. (FR-013)

### Szenario 2 – Zustands-Spalte ohne Definition (FR-004)
1. Prüfen: Lanes **Integration** und **Done** zeigen **kein** Info-Icon.
2. Info-Icon einer Phase ohne Definitionsdatei (z. B. falls `analyze` nicht installiert) öffnen.
3. **Erwartung**: verständlicher Hinweis „keine Definition", kein Fehler/leerer Dialog.

### Szenario 3 – Bearbeiten & Speichern (US2, P2)
1. Definition öffnen → **Bearbeiten** klicken → Text ändern (z. B. Kommentarzeile ergänzen).
2. **Speichern** → Erfolgsbestätigung. (FR-006)
3. Dialog schließen und erneut öffnen → Änderung ist vorhanden. (SC-003)

### Szenario 4 – Ungespeicherte Änderungen (FR-008)
1. Im Bearbeitungsmodus Text ändern, dann Dialog schließen.
2. **Erwartung**: Warnung vor Verwerfen; Abbrechen behält die Eingaben.

### Szenario 5 – Speicherkonflikt (FR-009)
1. Definition öffnen und in den Bearbeitungsmodus wechseln.
2. Parallel die Datei extern ändern und speichern (Editor/Terminal) → `mtime` ändert sich.
3. In-App **Speichern**.
4. **Erwartung**: Konflikt-Hinweis mit Wahl **Überschreiben** vs. **Neu laden/Verwerfen**; kein stiller Verlust. (SC-004)

### Szenario 6 – Sperre bei laufendem Agenten (FR-010)
1. Für ein Feature des Projekts den Schritt (z. B. **Plan**) starten, sodass `phases.plan.status === 'running'`.
2. Info-Icon der Plan-Lane öffnen.
3. **Erwartung**: Ansicht ist nur-lesend mit Sperr-Hinweis; **Bearbeiten** ist deaktiviert. Einsehen bleibt möglich.
4. Nach Ende des Laufs erneut öffnen → Bearbeiten wieder möglich.

### Szenario 7 – Im externen Editor öffnen (US3, P3)
1. Definition öffnen → **Im Editor öffnen** klicken.
2. **Erwartung**: Genau die Definitionsdatei erscheint im konfigurierten Editor (`project.editorCmd`).

### Szenario 8 – „Alle Projekte" bei mehreren Projekten (R2)
1. Board auf „Alle Projekte" stellen (mehrere Projekte vorhanden).
2. Info-Icon einer Lane öffnen.
3. **Erwartung**: Dialog zeigt Projektauswahl und benennt das aktuell angezeigte Projekt; Wechsel lädt die jeweilige Definition.

## Abnahmekriterien-Abgleich

| Kriterium | Szenario |
|-----------|----------|
| SC-001 / SC-002 (schnell einsehen) | 1 |
| SC-003 (Änderung persistiert) | 3 |
| SC-004 (klare Rückmeldung, kein Verlust) | 2, 5, 6 |
| SC-005 (jede sichtbare Lane abrufbar) | 1, 8 |
| SC-006 (kleine Korrektur in-App) | 3 |
