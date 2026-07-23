# Data Model: „Braucht dich"-Meldungen optimieren

**Feature**: `braucht-dich-meldungen-optimieren` | **Date**: 2026-07-23

Dieses Feature führt **keine neue Persistenz** ein. Es nutzt vorhandene Entitäten und ergänzt ein abgeleitetes **Gültigkeitsmodell**. Keine Schema-Migration nötig.

## Bestehende Entitäten (relevant)

### AttentionItem (unverändert)
Quelle: `packages/shared/src/types.ts:165`, Tabelle `attention`.

| Feld | Bedeutung |
|------|-----------|
| `id` | eindeutige ID |
| `kind` | `awaiting_input` \| `permission_request` \| `verify_failed` \| `gate_failed` \| `merge_conflict_escalated` \| `review_due` \| `agent_errored` |
| `projectId` | Projekt-Scope (Filter für Liste **und** Badge) |
| `featureId` | Bezug zum Feature (null bei reinen Chat-Sessions) |
| `sessionId` | Bezug zur Session (null bei Merge-Fluss-Arten) |
| `conversationId` | Bezug zur Chat-Unterhaltung (bei `chat_work`) |
| `message` | Anzeigetext |
| `createdAt` | Erstellzeitpunkt |
| `resolvedAt` | `null` = offen; gesetzt = erledigt/aufgelöst |

`permission_request` bleibt aus „Braucht dich" ausgeschlossen (bestehendes Verhalten).

### Feature (Wahrheitsquelle für Merge-Arten, unverändert)
`packages/shared/src/types.ts:117`. Relevantes Feld: `integration: IntegrationStage`
(`none | verifying | verify_failed | review_gate | gate_failed | awaiting_human_review | queued | merging | conflict_resolving | conflict_escalated | merged`). Persistiert → restart-sicher.

### Live-Session (Wahrheitsquelle für Session-Arten, ephemer)
Laufzeit-Zustand aus der Session-State-Machine (`displayStatus`: `idle | working | awaiting_input | stopped | errored`). Nicht persistiert; beim Boot via `reapOnBoot()` beendet.

## Abgeleitetes Modell: Gültigkeits-Prädikat

Eine offene Meldung ist **gültig** (bleibt sichtbar), solange ihr Prädikat wahr ist. Ist es falsch, ist sie **stale** → wird aufgelöst (`resolvedAt` gesetzt) und aus der Inbox entfernt.

| kind | gültig solange | Wahrheitsquelle |
|------|----------------|-----------------|
| `awaiting_input` | Live-Session zu `sessionId`/`conversationId` ist im Zustand `awaiting_input` | Live-Session |
| `agent_errored` | keine Session desselben Features hat seit dem Fehler wieder gearbeitet **und** kein Boot dazwischen | Live-Session / Feature |
| `review_due` | `feature.integration === 'awaiting_human_review'` | Feature (persistiert) |
| `verify_failed` | `feature.integration === 'verify_failed'` | Feature (persistiert) |
| `gate_failed` | `feature.integration === 'gate_failed'` | Feature (persistiert) |
| `merge_conflict_escalated` | `feature.integration === 'conflict_escalated'` | Feature (persistiert) |

**Unbestimmbarkeit → konservativ stale** (FR-015): Lässt sich das Prädikat nicht positiv als wahr bestätigen (z. B. Session existiert nach Boot nicht mehr, Feature nicht auffindbar), gilt die Meldung als stale.

## Zustandsübergänge einer Meldung

```
        raise() (Prädikat wird wahr)
   ─────────────────────────────────▶ [offen, gültig]
                                            │
        Prädikat wird falsch                │  manuelles ✓ (FR-014)
        (Reconcile: Boot | Event | Read)    │
                                            ▼
                                      [aufgelöst: resolvedAt gesetzt]
                                            │
        Prädikat wird erneut wahr           │ (Wiederauftreten = neues Ereignis, FR-013)
                                            ▼
                                      neues AttentionItem via raise()
```

## Invarianten

- **INV-1**: Eine in der Inbox sichtbare Meldung hat `resolvedAt === null` **und** ein wahres Gültigkeits-Prädikat.
- **INV-2**: Reconcile ist idempotent — mehrfaches Ausführen ohne Zustandsänderung ändert nichts.
- **INV-3**: Reconcile löst pro Durchlauf ausschliesslich Meldungen mit falschem Prädikat auf; gültige Meldungen bleiben unberührt (FR-012).
- **INV-4**: Dedup bleibt erhalten — höchstens eine offene Meldung je (kind, project, feature/session/conversation) (`repos.ts:528`).
- **INV-5**: Badge-Zahl = Anzahl der für das ausgewählte Projekt sichtbaren, gültigen Meldungen (ohne `permission_request`) = Länge der Inbox-Liste (FR-011, SC-004).
