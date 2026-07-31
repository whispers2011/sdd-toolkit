# Quickstart / Validierung: Projektspezifisches Wissen

End-to-End-Nachweis, dass das Feature funktioniert. Verweise auf Details: [data-model.md](./data-model.md), [contracts/](./contracts/). Implementierungsdetails gehören in `tasks.md`.

## Voraussetzungen

- Repo-Setup wie README: `pnpm install`, Node ≥ 22.
- Dev-Umgebung: `pnpm dev` (Server :4820, Web :4830) → `open http://localhost:4830`.
- Mindestens ein registriertes Projekt (Sidebar → „+ Projekt").
- Migration angewandt (automatisch beim Serverstart über `migrate()` in `database.ts`).

## Build / Test / Typecheck

```bash
pnpm -r typecheck      # alle Packages
pnpm -r test           # Vitest (shared: pure Logik; server: In-Memory-DB)
pnpm --filter @sdd/shared test    # gezielt knowledge.test.ts
```

## Szenario 1 — Wissen verwalten (User Story P1)

1. Projekt wählen → Wissens-Panel öffnen.
2. Eintrag anlegen (Titel + Markdown-Body). **Erwartet**: erscheint sofort in der Liste (WS `knowledge_updated` → Refetch).
3. Bearbeiten/Löschen. **Erwartet**: Änderung persistiert über Server-Neustart; gelöschtes Element verschwindet.
4. Zweites Projekt öffnen. **Erwartet**: Wissen aus Projekt A ist dort **nicht** sichtbar (SC-004).

API-Smoke (ohne UI):
```bash
PID=<projектId>
curl -s localhost:4820/api/projects/$PID/knowledge | jq '.tree, .index'
curl -s -XPOST localhost:4820/api/projects/$PID/knowledge/entries \
  -H 'content-type: application/json' \
  -d '{"bundleId":null,"title":"Coding-Conventions","body":"# Regeln\n- …","applicability":{"text":"immer bei neuem Code","tags":["style"]},"source":"inline"}' | jq
```

## Szenario 2 — Verschachtelte Bundles + Anwendbarkeit (P2)

1. Bundle „Auth" anlegen, Anwendbarkeit-Freitext + Tags (`auth`, `jwt`) setzen.
2. Unter-Bundle + zwei Einträge darunter anlegen.
3. Einen Eintrag per PATCH in ein anderes Bundle verschieben.
4. **Erwartet**: Baum zeigt korrekte Hierarchie; Zyklus-Versuch (`parentId` = eigener Nachfahre) wird mit `400` abgewiesen (`detectCycle`).

## Szenario 3 — Automatischer Index (P3)

1. `GET /api/projects/$PID/knowledge` → `index.items` merken.
2. Neuen Eintrag anlegen → erneut `GET`. **Erwartet**: `index` enthält das neue Element **ohne** manuellen Schritt (FR-006); `index` trägt keine Inhalte (`body` fehlt), nur Label + Anwendbarkeit (FR-005).
3. Eintrag löschen → `index` spiegelt Entfernung (SC-005 = 100 % Konsistenz, da Projektion).

## Szenario 4 — Selektive Nutzung bei Feature-Erstellung (P4)

1. Projekt mit mehreren Bundles (z. B. „Auth", „Deployment").
2. Feature mit auth-bezogener Beschreibung anlegen (z. B. „JWT-Login härten").
3. `GET /api/features/:id/knowledge` → **Erwartet**: `resolved.autoIncluded` enthält „Auth", **nicht** „Deployment" (D4-Score).
4. Override testen: `PUT …/knowledge/selection` `{targetId: <Deployment>, decision:"include"}` → „Deployment" in `effective` (FR-010).
5. `POST …/knowledge/materialize` (oder eine Phase starten). **Erwartet**:
   - `<worktree>/.sdd/knowledge/index.md` existiert und listet **alle** Elemente,
   - nur `effective`-Elemente sind `[relevant]` + haben materialisierte Dateien/Repo-Verweise (SC-003),
   - `.sdd/` steht in `<worktree>/.git/info/exclude` → `git status` im Worktree zeigt `.sdd/` **nicht** an.
6. **Erwartet (FR-014)**: geladene Auswahl ist im Feature-Wissens-Panel einsehbar.

## Abnahmekriterien-Abgleich

| Kriterium | Nachweis |
|-----------|----------|
| SC-002 (100 % im Toolkit) | Szenario 1 komplett ohne Dateibearbeitung außerhalb des Tools |
| SC-003 (nur Relevantes geladen) | Szenario 4.5 — nur `effective` materialisiert |
| SC-004 (kein Cross-Projekt) | Szenario 1.4 |
| SC-005 (Index konsistent) | Szenario 3 |
| SC-007 (Auswahl nachvollziehbar) | Szenario 4.6 |
| FR-015 (Import) | `POST …/entries/import` mit `docs/…md` → `source='file'`, Body gelesen |
