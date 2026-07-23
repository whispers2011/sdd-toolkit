# WS-Event-Contract: Review-Portal & Agent-Verwaltung

Erweiterungen in `packages/server/src/api/events.ts` (bestehender Broadcast-Bus).

## Neue Events

### `review_comments_updated`

```ts
{ type: 'review_comments_updated', featureId: string }
```

Nach jeder Kommentar-Mutation (POST/PATCH/DELETE). Clients mit offenem Portal des Features
laden die Kommentarliste neu.

### `agent_gate`

```ts
{
  type: 'agent_gate',
  featureId: string,
  projectId: string,
  trigger: { kind: 'before_phase' | 'after_phase' | 'review_gate', phase?: FeaturePhase },
  status: 'running' | 'pass' | 'fail'
}
```

Emittiert bei Start und Abschluss jedes Gate-Laufs. Web nutzt es für: gateRunning-Badge am
Feature (before_phase-Deferral sichtbar machen), Live-Aktualisierung der AuditSidebar und der
Review-Übersicht.

## Bestehende Events (unverändert genutzt)

`features_updated` / Attention-Updates lösen wie bisher Store-Refreshes aus — neue
AttentionKinds (`phase_gate_failed`, `approval_required`) fließen über den bestehenden
Attention-Kanal, kein neues Event nötig.
