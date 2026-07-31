# Phase 1 — Datenmodell: „Braucht dich" verschwindet nach Review nicht

Dieses Feature führt **keine neue Entität, keine neue Spalte und keine Migration** ein. Es schärft die
Rückgabewerte zweier Repo-Methoden, den Inhalt eines bestehenden Ereignisses und die Auswahlregel der
Anzeige. Der Abschnitt beschreibt deshalb primär Verträge und Invarianten, nicht Strukturen.

## 1. Entitäten

### 1.1 „Braucht dich"-Meldung — `AttentionItem` (unverändert)

`packages/shared/src/types.ts`, Tabelle `attention` in `packages/server/src/db/database.ts`.

| Feld | Typ | Bedeutung für dieses Feature |
|---|---|---|
| `id` | `string` (nanoid, 10) | **Die einzige gültige Kennung in einer Auflösungs-Meldung.** Eindeutig über alle Meldungen. |
| `kind` | `AttentionKind` | Grenzt Sammel-Auflösungen ein (`kinds`-Filter). Unverändert. |
| `projectId` | `string` | — |
| `featureId` | `string \| null` | Selektor für Sammel-Auflösungen. **Nie** Inhalt einer Auflösungs-Meldung. |
| `sessionId` | `string \| null` | Selektor für Sammel-Auflösungen. **Nie** Inhalt einer Auflösungs-Meldung. Verliert seine Rolle in der Anzeige-Zuordnung. |
| `conversationId` | `string \| null` | Selektor für Sammel-Auflösungen (Projekt-Chat). Nie Inhalt. |
| `message` | `string` | — |
| `createdAt` | `number` | — |
| `resolvedAt` | `number \| null` | `null` = offen. Zustandsübergang siehe §4. |

Keine Feldänderung, keine neue Spalte, kein Indexbedarf. Der bestehende Teilindex
`idx_attention_open ON attention(resolved_at) WHERE resolved_at IS NULL` deckt die Sammel-Auflösung
weiterhin.

### 1.2 Auflösungs-Meldung — Bus-Ereignis `attention_resolved`

Kein persistiertes Objekt, sondern eine Mitteilung. Nutzdatum: **genau eine `AttentionItem.id`**.

```ts
// packages/server/src/events.ts — Signatur bleibt unverändert
attention_resolved: (id: string) => void;
```

Invarianten (FR-003):

- **I1**: Das Nutzdatum ist eine `AttentionItem.id`. `Feature.id`, `LiveSession.id` und
  `Conversation.id` sind als Nutzdatum unzulässig.
- **I2**: Ein Ereignis bezieht sich auf genau eine Meldung. Es gibt keine Listen-Variante.
- **I3**: Zu einer Meldung wird das Ereignis höchstens einmal gesendet — nämlich beim Übergang
  `offen → aufgelöst` (siehe §4).

### 1.3 Auflöseweg (Begriff, nicht Typ)

Ein Vorgang, der Meldungen als erledigt markiert. Zwei Formen:

| Form | Repo-Methode | Rückgabe (neu) | Ereignisse |
|---|---|---|---|
| gezielt, eine Meldung | `resolve(id)` | `boolean` — wurde durch diesen Aufruf aufgelöst | 1, falls `true`; sonst 0 |
| gesammelt, n Meldungen | `resolveFor(filter)` | `string[]` — IDs der durch diesen Aufruf aufgelösten Meldungen | genau `ids.length` |

Die vollständige Liste der 13 Auflösewege steht in
[contracts/attention-resolution.md](./contracts/attention-resolution.md) §3.

## 2. Geänderte Verträge

### 2.1 `AttentionRepo` (`packages/server/src/db/repos.ts`)

```ts
/** @returns true, wenn das Item durch diesen Aufruf aufgelöst wurde (war offen). */
resolve(id: string): boolean;

/**
 * Offene Items einer Session/eines Features/einer Unterhaltung auflösen.
 * @returns IDs der durch diesen Aufruf aufgelösten Items; leer, wenn keines betroffen war.
 */
resolveFor(filter: {
  sessionId?: string;
  featureId?: string;
  conversationId?: string;
  kinds?: AttentionKind[];
}): string[];
```

Semantik der Auswahl bleibt identisch (`resolved_at IS NULL` plus die gesetzten Selektoren, UND-
verknüpft). Neu ist allein die Rückgabe. Umsetzung: `UPDATE … RETURNING id` per `.all()` bzw.
`run().changes > 0` (research.md D1/D2).

Unverändert: `raise()` inklusive Dedup-Logik, `get()`, `listOpen()` (FR-009).

### 2.2 Emit-Helfer (`packages/server/src/events.ts`)

```ts
/**
 * Auflösungs-Meldungen an die Oberfläche: pro betroffenem Item genau ein Ereignis,
 * Nutzdatum ausschliesslich die Item-ID (FR-001/FR-002/FR-003).
 */
export function emitAttentionResolved(ids: readonly string[]): void;
```

Bei leerer Liste ohne Wirkung und ohne Fehler (FR-006).

### 2.3 Pures Anzeige-Modul (`packages/shared/src/attentionList.ts`, NEU)

```ts
/**
 * Entfernt die aufgelöste Meldung aus der angezeigten Liste. Zuordnung ausschliesslich
 * über die eigene Kennung der Meldung — kein Abgleich über sessionId/featureId (FR-004).
 */
export function applyAttentionResolved(
  items: readonly AttentionItem[],
  resolvedId: string,
): AttentionItem[];
```

Re-Export über `packages/shared/src/index.ts`.

### 2.4 Anzeige-Zustand (`packages/web/src/store.tsx`)

`UiState.app.attention: AttentionItem[]` — Struktur unverändert. Der Reducer-Zweig
`attention_resolved` delegiert:

```ts
attention: applyAttentionResolved(state.app.attention, action.id)
```

Der Vergleich `a.sessionId !== action.id` entfällt ersatzlos. `Action` behält
`{ type: 'attention_resolved'; id: string }` — `id` ist ab jetzt vertraglich eine Item-ID.

## 3. Beziehungen

```text
AttentionItem 1 ──── 0..1 Auflösungs-Meldung        (I3: höchstens eine pro Meldung)

Auflöseweg  ──── n AttentionItem                   (Selektor: featureId | sessionId | conversationId [+ kinds])
            ──── n Auflösungs-Meldungen             (FR-002: genau eine pro betroffener Meldung)

Auflösungs-Meldung ──── 1 Listeneintrag der Anzeige (Zuordnung: id == id, FR-004)
```

Der Bruch, den dieses Feature behebt, sitzt in der letzten Zeile: heute ist die Zuordnung
`id == id ODER sessionId == payload`, und die Payload ist an fünf Stellen gar keine Item-ID.

## 4. Zustandsübergänge

```text
                 raise()                    resolve(id) / resolveFor(filter)
   (nicht da) ───────────► offen ─────────────────────────────────────────► aufgelöst
                            │  resolved_at = null                            resolved_at = <ts>
                            │
                            └─ raise() mit gleichem (kind, project, feature, session, conversation)
                               → Dedup, kein neues Item, kein Ereignis (FR-009, unverändert)
```

| Übergang | DB | Ereignis |
|---|---|---|
| — → offen | INSERT | `attention_raised` (unverändert) |
| offen → aufgelöst | `resolved_at` gesetzt | **genau ein** `attention_resolved` mit dieser Item-ID |
| aufgelöst → aufgelöst (erneuter Auflöseversuch) | keine Änderung (`AND resolved_at IS NULL` greift) | **keines** |
| offen → offen (Auflöseweg trifft nicht zu) | keine Änderung | **keines** |

Es gibt keinen Rückweg `aufgelöst → offen`. Eine erneut nötige Meldung entsteht als **neues** Item mit
eigener `id` — deshalb darf die Auflösung der Vorgängerin sie nicht mitentfernen (Edge Case „Meldung
wird unmittelbar nach der Auflösung neu erzeugt"). Die Zuordnung über die Item-ID leistet das
automatisch; die heutige sessionId-Zuordnung tut es nicht.

## 5. Validierungsregeln

Prüfbar, mit Zuordnung zur Testebene:

| Regel | Ebene | Testort |
|---|---|---|
| V1: `resolveFor()` liefert genau die IDs, deren `resolved_at` durch den Aufruf gesetzt wurde | DB | `packages/server/src/db/attentionRepo.test.ts` |
| V2: `resolveFor()` liefert `[]`, wenn kein offenes Item passt (FR-006) | DB | dito |
| V3: `resolveFor()` respektiert den `kinds`-Filter — nicht passende Arten bleiben offen und fehlen in der Rückgabe | DB | dito |
| V4: `resolve()` liefert beim ersten Aufruf `true`, beim zweiten `false` | DB | dito |
| V5: Jeder Auflöseweg sendet genau `|betroffene Items|` Ereignisse (FR-001/FR-002/FR-011/SC-006) | Service/API | `packages/server/src/services/attentionResolveEvents.test.ts` |
| V6: Jedes gesendete Nutzdatum ist eine ID aus `attention`; keine `Feature.id`, keine `session.id` (FR-003/I1) | Service/API | dito |
| V7: Ein Auflöseweg ohne Treffer sendet nichts und wirft nicht (FR-006) | Service/API | dito |
| V8: `applyAttentionResolved` entfernt genau die Meldung mit dieser `id`, alle übrigen bleiben unverändert (FR-010a) | pure | `packages/shared/src/attentionList.test.ts` |
| V9: `applyAttentionResolved` entfernt **nichts** bei einer `featureId`/`sessionId`/unbekannten Kennung (FR-010b) | pure | dito |
| V10: Mehrere Meldungen derselben Session werden nur einzeln, nie gemeinsam entfernt | pure | dito |
| V11: `raise()`-Dedup und Meldungsarten bleiben unverändert (FR-009) | DB/Service | bestehende Tests bleiben grün (`chatWork.test.ts`, `orchestrator.attention.test.ts`, `mergeQueueService.attention.test.ts`) |

## 6. Nicht Teil des Modells

- Keine Persistenz der Auflösungs-Meldungen (kein Outbox-, kein Replay-Mechanismus). Ereignisse
  bleiben Best-Effort; die Rückfallebene ist der Abruf beim Laden (FR-008).
- Keine Änderung an `AttentionKind`, an den Meldungstexten oder an den Auslösebedingungen (Out of
  Scope).
- Keine Änderung an `attentionReconciler.ts` (`STAGE_FOR_KIND`, `isAttentionValid`,
  `findStaleRuntime`, `findStaleOnBoot`) — die Gültigkeitsregeln bleiben, wie sie sind. Nur die
  Aufrufer, die deren Ergebnis auflösen, senden künftig über den Helfer.
- Keine nachträgliche Bereinigung von Altbeständen (Out of Scope).
