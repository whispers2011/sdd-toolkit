# Quickstart / Validierung: „Braucht dich"-Meldungen optimieren

**Feature**: `braucht-dich-meldungen-optimieren`

Runnbare Validierungsszenarien, die belegen, dass nur echte, aktuelle Meldungen in „Braucht dich" stehen. Details zu Prädikaten/Verhalten: siehe `data-model.md` und `contracts/attention-reconciliation.md`.

## Voraussetzungen

- Node ≥ 22, pnpm 10.
- `pnpm install`
- Dev-Server: `pnpm dev` (startet `@sdd/server` + `@sdd/web`).
- Automatisierte Tests: `pnpm -r test` (vitest in `server`/`shared`).

## Automatisierte Verifikation (vitest, server)

Der Kern (Gültigkeits-Prädikate + Reconcile) wird per Unit-/Service-Test abgedeckt — analog zu `packages/server/src/db/chatWork.test.ts` / `services/chatWorkService.test.ts`.

```bash
pnpm --filter @sdd/server test
```

Erwartete, neu abgedeckte Fälle (Zuordnung zu Akzeptanzszenarien der Spec):

- **US1-1/US1-2** `awaiting_input` wird stale, sobald die Session wieder `working` bzw. beendet ist (auch ohne Inbox-Klick).
- **US1-3** `review_due` wird stale, wenn `feature.integration` von `awaiting_human_review` weiterwandert.
- **US1-4** `merge_conflict_escalated` wird stale, wenn `feature.integration !== 'conflict_escalated'`.
- **US1-5** `verify_failed`/`gate_failed` werden stale, wenn `feature.integration` nicht mehr die Fehlstufe ist.
- **US1-6** `agent_errored` wird stale, sobald eine Session desselben Features wieder arbeitet.
- **US1-7 / INV-3** Reconcile löst nur die betroffene Meldung auf, andere gültige bleiben.
- **US2-1 / SC-003** Boot-Reconcile: nach `reapOnBoot()` sind session-basierte Arten aufgelöst; nicht bestätigbare Meldungen fehlen.
- **INV-2** Reconcile ist idempotent.
- **INV-4 / FR-013** Dedup bleibt; nach Auflösung + erneutem Zustand entsteht ein neues Item.

## Manuelle Ende-zu-Ende-Validierung (UI)

Da Web keine automatisierten Tests hat, diese Szenarien manuell prüfen:

1. **Frage erledigt sich in der Konsole** (US1-1, FR-003/FR-004)
   - Feature-Session in einen „wartet auf Eingabe"-Zustand bringen → „Frage" erscheint in „Braucht dich".
   - Direkt in der Feature-Konsole antworten (nicht über die Inbox).
   - **Erwartet**: Meldung verschwindet innerhalb von ~5 s ohne Neuladen (SC-002).

2. **Zur Konsole, läuft bereits** (US1-2)
   - Bei bestehender „Frage" die Konsole öffnen, während die Session schon weiterläuft.
   - **Erwartet**: zugehörige Meldung ist weg.

3. **Merge-Fluss** (US1-3…1-5)
   - Für ein Feature nacheinander `review_due` / `verify_failed` / `merge_conflict_escalated` auslösen; die jeweilige Stage danach anders weiterführen.
   - **Erwartet**: die jeweilige Meldung verschwindet, sobald `feature.integration` die Stufe verlässt.

4. **Neustart** (US2-1, SC-003, FR-010)
   - Offene Meldungen erzeugen, dann den Server neu starten.
   - **Erwartet**: nach dem Reconnect zeigt die Inbox nur noch Meldungen, deren Zustand bestätigt aktiv ist; session-basierte Waisen sind weg.

5. **Badge = Liste** (US3, SC-004, FR-011)
   - Meldungen in einem anderen als dem ausgewählten Projekt erzeugen.
   - **Erwartet**: Badge zählt nur das ausgewählte Projekt; steht „Nichts braucht dich gerade", zeigt der Badge keine offenen Meldungen.

6. **Manuelles Erledigen** (US4, FR-014)
   - Eine noch aktive Meldung per ✓ als erledigt markieren.
   - **Erwartet**: verschwindet und kommt für denselben Zustand nicht sofort zurück.

## Erfolgskriterien-Abgleich

| Szenario | Success Criteria |
|----------|------------------|
| 1–4 automatisiert + manuell | SC-001 (100 % aufgelöst) |
| 1 manuell | SC-002 (≤ 5 s) |
| 4 Neustart | SC-003 (0 stale nach Reload) |
| 5 Badge | SC-004 (Badge = Liste) |
| jede gelistete Meldung ist echt | SC-005 |
