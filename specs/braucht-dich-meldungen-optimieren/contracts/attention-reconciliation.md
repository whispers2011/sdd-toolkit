# Contract: Attention-Reconciliation

**Feature**: `braucht-dich-meldungen-optimieren`

Interne Kontrakte für die Gültigkeitsprüfung der „Braucht dich"-Meldungen. Kein öffentliches API; beschreibt das Verhalten der serverseitigen Reconcile-Logik und die davon abhängigen Endpunkte/Events.

## C1 — Gültigkeits-/Reconcile-Funktion (server)

**Zweck**: Aus offenen Meldungen die stale Meldungen bestimmen und auflösen.

**Eingaben (Snapshot des aktuellen Zustands)**:
- offene `AttentionItem[]` (`resolved_at IS NULL`)
- Live-Sessions inkl. Laufzeit-Status (`awaiting_input` / sonstiges), adressierbar über `sessionId` und `conversationId`
- Features inkl. `integration` (`IntegrationStage`), adressierbar über `featureId`

**Verhalten**:
- Für jedes Item das Prädikat aus `data-model.md` auswerten.
- **Stale** (Prädikat falsch oder nicht bestätigbar) → auflösen: `resolvedAt` setzen und `attention_resolved` emittieren.
- **Gültig** → unverändert lassen.
- `permission_request` wird ignoriert (nicht Teil der Inbox).

**Zusicherungen**:
- Idempotent (INV-2).
- Löst nie eine gültige Meldung auf (INV-3).
- Kein Auslösen von `attention_raised` (Reconcile legt nie neue Meldungen an).

**Aufrufpunkte**:
1. Boot — aus `orchestrator.reapOnBoot()` nach dem Beenden der Sessions. Session-basierte Arten (`awaiting_input`, `agent_errored`) sind hier nicht bestätigbar → werden aufgelöst (D3).
2. Working-Übergang — bestehende Auflösung in `orchestrator.handleStatusChange` / `chatWorkService.handleStatusChange` um `agent_errored` erweitern (zusätzlich zu `awaiting_input`).
3. Merge-Stage-Wechsel — bei `setStage()` Meldungen auflösen, deren Art nicht mehr zur neuen `integration`-Stage passt.
4. Lesen — bei `GET /api/attention` und im Bootstrap-`getState` vor der Auslieferung reconcilen.

## C2 — Read-Endpunkte

### GET /api/attention
- **Vorher**: Reconcile ausführen.
- **Rückgabe**: nur gültige, offene Items (stale wurden aufgelöst und sind nicht enthalten).

### Bootstrap `getState` (`server.ts:84`)
- `attention`-Feld enthält nach Reconcile nur gültige, offene Items.
- Für beim Bootstrap aufgelöste Items werden `attention_resolved`-Events emittiert (oder sie fehlen schlicht im initialen Snapshot — der Client hält ohnehin nur den Snapshot).

## C3 — Events (unverändert im Format)

`packages/server/src/events.ts`:
- `attention_raised(item: AttentionItem)` — unverändert; nur bei echtem neuem Zustand.
- `attention_resolved(idOrSessionId: string)` — wird zusätzlich von Reconcile ausgelöst. Client entfernt per `id` **oder** `sessionId` (`store.tsx:113`, unverändert).

**Client-Erwartung**: Bei geöffneter Inbox verschwindet eine Meldung innerhalb von 5 s nach Zustandsauflösung (SC-002), ohne Neuladen.

## C4 — Badge-Scope (web)

- `App.tsx` Badge/Titel-Zähler filtert auf `a.kind !== 'permission_request'` **und** `a.projectId === selectedProjectId`.
- **Zusicherung**: Badge-Zahl === Länge der sichtbaren Inbox-Liste für das ausgewählte Projekt (INV-5, SC-004).

## Testbare Akzeptanz (Zuordnung zu FRs)

| Kontrakt | FR/SC |
|----------|-------|
| C1 Prädikate + Auflösung | FR-001, FR-002, FR-003, FR-005, FR-006, FR-007, FR-008, FR-012, FR-015 |
| C1 Aufrufpunkt Boot | FR-010, SC-003 |
| C1 Aufrufpunkt Working-Übergang | FR-003, FR-004, FR-008 |
| C1 Aufrufpunkt Read | FR-001, FR-002 (Sicherheitsnetz) |
| C2 Read liefert nur gültige | FR-001, SC-005 |
| C3 Events / Echtzeit | FR-009, SC-002 |
| C4 Badge-Scope | FR-011, SC-004 |
| Dedup / Wiederauftreten | FR-013, FR-014, INV-4 |
