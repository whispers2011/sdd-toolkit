# Vertrag: Auflösung einer „braucht dich"-Meldung (Server)

Gilt für `packages/server`. Betrifft die Repo-API, den Ereignis-Inhalt und alle Auflösewege.

## 1. Repo-API — `AttentionRepo` (`src/db/repos.ts`)

### 1.1 `resolve(id: string): boolean`

| | |
|---|---|
| **Wirkung** | Setzt `resolved_at` auf jetzt, **falls** das Item existiert und offen ist. |
| **Rückgabe** | `true` genau dann, wenn dieser Aufruf den Übergang `offen → aufgelöst` bewirkt hat. |
| **`false` bei** | unbekannte `id`; Item war bereits aufgelöst. |
| **Seiteneffekte** | keine außer dem `UPDATE`. Sendet **kein** Ereignis (das ist Sache des Aufrufers). |
| **Bruch zu heute** | Rückgabetyp `void` → `boolean`. Keine Verhaltensänderung an der Datenbank. |

### 1.2 `resolveFor(filter): string[]`

```ts
resolveFor(filter: {
  sessionId?: string;
  featureId?: string;
  conversationId?: string;
  kinds?: AttentionKind[];
}): string[]
```

| | |
|---|---|
| **Auswahl** | `resolved_at IS NULL` UND alle gesetzten Selektoren (UND-verknüpft) UND — falls `kinds` nicht leer — `kind IN (…)`. Unverändert zu heute. |
| **Wirkung** | Setzt `resolved_at` für alle ausgewählten Items in einem Statement. |
| **Rückgabe** | Die `id` jedes Items, dessen `resolved_at` durch **diesen** Aufruf gesetzt wurde. Reihenfolge nicht garantiert. |
| **Leerer Treffer** | `[]`. Kein Fehler, keine Änderung (FR-006). |
| **Bereits aufgelöste Items** | erscheinen **nicht** in der Rückgabe. |
| **Seiteneffekte** | keine außer dem `UPDATE`. Sendet **kein** Ereignis. |
| **Bruch zu heute** | Rückgabetyp `void` → `string[]`. Keine Verhaltensänderung an der Datenbank. |

Umsetzung: `UPDATE attention SET resolved_at=? WHERE <conds> RETURNING id` per `.all()`.

**Warnung (unverändert zu heute)**: Ein Aufruf ohne jeden Selektor löst *alle* offenen Meldungen auf.
Kein Aufrufer tut das.

## 2. Ereignis-Vertrag — `attention_resolved`

```ts
// src/events.ts
attention_resolved: (id: string) => void;

export function emitAttentionResolved(ids: readonly string[]): void;
```

| Regel | |
|---|---|
| **C1** | Das Nutzdatum ist **ausschliesslich** eine `AttentionItem.id`. `Feature.id`, `LiveSession.id`, `Conversation.id` sind unzulässig (FR-003). |
| **C2** | Pro betroffener Meldung genau ein Ereignis. Kein Sammel-Ereignis, keine ID-Liste im Nutzdatum (FR-002). |
| **C3** | Ein Ereignis wird nur beim tatsächlichen Übergang `offen → aufgelöst` gesendet. Kein Ereignis für ein bereits aufgelöstes Item. |
| **C4** | `emitAttentionResolved([])` ist wirkungslos und fehlerfrei (FR-006). |
| **C5** | Der Wire-Typ bleibt `string` — der WS-Broadcast (`BUS_EVENT_NAMES` → `/ws/events`) ändert sich nicht. |
| **C6** | Jeder Auflöseweg, der Meldungen als erledigt markiert, sendet für jede betroffene Meldung (SC-006). Es gibt keinen stummen Auflöseweg. |

**Kanonisches Aufrufmuster**:

```ts
emitAttentionResolved(this.deps.attention.resolveFor({ featureId, kinds: ['review_due'] }));
// bzw. für den Einzelfall:
if (deps.attention.resolve(id)) emitAttentionResolved([id]);
```

## 3. Auflösewege — Sollzustand aller 13 Stellen

Orte als Datei + Symbol (ohne Zeilennummern, Repo-Konvention). „heute" beschreibt den Fehlerzustand.

### Feature-/Review-Pfad

| # | Ort | heute | Sollzustand | FR-005-Punkt |
|---|---|---|---|---|
| 1 | `api/server.ts` → `POST /api/features/:id/reject-review` | `resolveFor({featureId, kinds:['review_due']})`, **kein Ereignis** | `emitAttentionResolved(resolveFor(…))` | Zurückweisung eines Reviews |
| 2 | `services/mergeQueueService.ts` → `approveForMerge()` | `resolveFor({featureId, kinds:['review_due']})`, **kein Ereignis** | `emitAttentionResolved(resolveFor(…))` | Freigabe eines Reviews |
| 3 | `services/mergeQueueService.ts` → `retry()` | `resolveFor({featureId, kinds:['merge_conflict_escalated','verify_failed','gate_failed']})`, **kein Ereignis** | `emitAttentionResolved(resolveFor(…))` | Wiederaufnahme einer fehlgeschlagenen Integration |
| 4 | `services/mergeQueueService.ts` → `finalizeMerged()` | `resolveFor({featureId, kinds:[…4 Arten]})`, **kein Ereignis** | `emitAttentionResolved(resolveFor(…))` | Abschluss nach dem Merge |
| 5 | `services/mergeQueueService.ts` → `setStage()` | `resolve(it.id)` + Ereignis pro ID ✅ | `if (resolve(it.id)) emitAttentionResolved([it.id])` — Verhalten unverändert | (stützt 2/3/4) |
| 6 | `services/orchestrator.ts` → `resolveGateAttention()` (aus `startPhaseRun()`, `approve()`, `discard()`) | Ereignis mit **featureId** ❌ | `emitAttentionResolved(resolveFor(…))` | Freigabe/Verwerfen/Neustart einer Phase |

### Session-Pfad (funktioniert heute nur über den sessionId-Zweig des Reducers)

| # | Ort | heute | Sollzustand | FR-005-Punkt |
|---|---|---|---|---|
| 7 | `services/orchestrator.ts` → `handleStatusChange()`, Zweig `status === 'working'` | Ereignis mit **session.id** ❌ | `emitAttentionResolved(resolveFor({sessionId, kinds:['awaiting_input','permission_request']}))` | Wiederaufnahme der Arbeit einer wartenden Session |
| 8 | `services/orchestrator.ts` → `handleExit()` | Ereignis mit **session.id** ❌ | `emitAttentionResolved(resolveFor({sessionId, kinds:['awaiting_input']}))` | Ende einer Session |
| 9 | `services/chatWorkService.ts` → `handleStatusChange()` | Ereignis mit **session.id** ❌ | wie #7 | Projekt-Chat |
| 10 | `services/chatWorkService.ts` → `handleExit()` | Ereignis mit **session.id** ❌ | wie #8 | Projekt-Chat |

### Bereinigung / manuell

| # | Ort | heute | Sollzustand | |
|---|---|---|---|---|
| 11 | `services/orchestrator.ts` → `reconcileOpenAttention()` | `resolve(stale.id)` + Ereignis pro ID ✅ | `if (resolve) emitAttentionResolved([stale.id])` | Sicherheitsnetz, Verhalten unverändert |
| 12 | `services/orchestrator.ts` → `reapOnBoot()` | `resolve(stale.id)` + Ereignis pro ID ✅ | dito | Verhalten unverändert |
| 13 | `api/server.ts` → `POST /api/attention/:id/resolve` | `resolve(id)`, Ereignis **unbedingt** | `if (resolve(id)) emitAttentionResolved([id])` | manuelles Wegklicken (FR-007) |

**Vollständigkeitsregel**: Nach der Umsetzung darf in `packages/server/src` **kein**
`bus.emitEvent('attention_resolved', …)` mehr direkt vorkommen — jeder Aufruf läuft über
`emitAttentionResolved()`. Das ist per `grep` prüfbar (siehe quickstart.md Stufe 1) und macht C1/C2
strukturell durchsetzbar.

## 4. Unverändert (FR-008/FR-009)

| Ort | Zusicherung |
|---|---|
| `api/server.ts` → `GET /api/state` | liefert weiterhin `attention: deps.attention.listOpen()` |
| `api/server.ts` → `GET /api/attention` | ruft weiterhin vorher `deps.orchestrator.reconcileOpenAttention()` |
| `AttentionRepo.raise()` | Dedup-Logik, Feldbelegung, `attention_raised`-Ereignis unverändert |
| `services/attentionReconciler.ts` | `STAGE_FOR_KIND`, `isAttentionValid`, `findStaleRuntime`, `findStaleOnBoot` unverändert |
| DB-Schema | keine Migration, kein neues Feld, kein neuer Index |
| WS-Kanal | kein neues Ereignis, kein geändertes Nutzdatum-Format |
