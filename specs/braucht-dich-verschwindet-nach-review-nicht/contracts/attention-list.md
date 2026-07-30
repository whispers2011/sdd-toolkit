# Vertrag: Anzeige der offenen Meldungen (Shared + Web)

Gilt für das neue pure Modul in `packages/shared` und dessen Verwendung im Reducer von
`packages/web`.

## 1. Pures Modul — `packages/shared/src/attentionList.ts` (NEU)

```ts
import type { AttentionItem } from './types.js';

/**
 * Entfernt die aufgelöste Meldung aus der angezeigten Liste.
 *
 * Zuordnung ausschliesslich über die eigene Kennung der Meldung (FR-004): ein Abgleich über
 * `sessionId`, `featureId` oder `conversationId` findet NICHT statt. Auflösungs-Meldungen tragen
 * per Vertrag nur Item-IDs (siehe contracts/attention-resolution.md, C1).
 */
export function applyAttentionResolved(
  items: readonly AttentionItem[],
  resolvedId: string,
): AttentionItem[];
```

### Zusicherungen

| Regel | Verhalten |
|---|---|
| **A1** | Enthält die Liste eine Meldung mit `id === resolvedId`, fehlt sie im Ergebnis. |
| **A2** | Alle übrigen Meldungen bleiben enthalten — mit unveränderter Identität (dieselben Objekte) und unveränderter Reihenfolge. |
| **A3** | Ist `resolvedId` eine `featureId`, `sessionId` oder `conversationId` einer enthaltenen Meldung, wird **nichts** entfernt. |
| **A4** | Ist `resolvedId` unbekannt, wird nichts entfernt. |
| **A5** | Mehrere Meldungen derselben Session/desselben Features werden nur einzeln entfernt — ein Aufruf entfernt höchstens eine Meldung (IDs sind eindeutig). |
| **A6** | Leere Eingabeliste → leeres Ergebnis, kein Fehler. |
| **A7** | Rein funktional: die Eingabe wird nicht verändert (`readonly`, `filter` gibt eine neue Liste). |
| **A8** | Idempotent: ein zweiter Aufruf mit derselben `resolvedId` ändert nichts mehr (deckt doppelt eintreffende Ereignisse und den Fall „lokal schon entfernt" ab). |

Re-Export in `packages/shared/src/index.ts` nach dem dort geltenden Muster
(`export * from './attentionList.js'`).

**Modulgrenzen**: keine UI, kein IO, kein React-Bezug, kein `node:`-Import — wie alle Module in
`packages/shared`.

## 2. Reducer — `packages/web/src/store.tsx`

### Sollzustand

```ts
case 'attention_resolved': {
  if (!state.app) return state;
  return {
    ...state,
    app: { ...state.app, attention: applyAttentionResolved(state.app.attention, action.id) },
  };
}
```

### Zusicherungen

| Regel | |
|---|---|
| **R1** | Der Zweig enthält keine eigene Filterlogik mehr — die Auswahlregel liegt vollständig im Shared-Modul (testbar, FR-010). |
| **R2** | Der Vergleich `a.sessionId !== action.id` entfällt **ersatzlos**, samt des Kommentars „id kann eine Attention-ID oder eine Session-ID (resolveFor) sein". |
| **R3** | `Action` behält `{ type: 'attention_resolved'; id: string }`. `id` ist ab jetzt vertraglich eine Item-ID. |
| **R4** | Die WS-Weiche (`case 'attention_resolved': dispatch({ type: 'attention_resolved', id: msg.payload as string })`) bleibt unverändert. |
| **R5** | `attention_raised` bleibt unverändert, inklusive der Dedup-Prüfung auf `a.id === action.item.id` (FR-009). |
| **R6** | `bootstrap` bleibt unverändert — die Liste aus `GET /api/state` ersetzt den Anzeigezustand wie bisher (Sicherheitsnetz, FR-008). |
| **R7** | `feature_deleted` behält seinen eigenen `attention`-Filter über `featureId` — das ist eine *Löschung* des Features, keine Auflösung einer Meldung, und bleibt unangetastet. |

### Unverändert im Web-Paket

| Ort | Zusicherung |
|---|---|
| `components/AttentionInbox.tsx` | Der ✓-Knopf ruft weiter `api.resolveAttention(item.id)` und dispatcht danach lokal `attention_resolved` mit `item.id` — das manuelle Wegklicken hängt nicht am Ereignis (FR-007). |
| Darstellung, Sortierung, Gruppierung, Filterung der Liste | unverändert (Out of Scope) |
| `packages/web/package.json` | keine neuen Dependencies, `"test"` bleibt der bestehende Platzhalter |

## 3. Zusammenspiel der beiden Verträge

```text
Auflöseweg
  └─ AttentionRepo.resolveFor(filter) ──► string[]  (IDs der tatsächlich aufgelösten Items)
        └─ emitAttentionResolved(ids)   ──► n × bus 'attention_resolved' (Nutzdatum: Item-ID)
              └─ WS /ws/events          ──► dispatch { type:'attention_resolved', id }
                    └─ applyAttentionResolved(items, id) ──► Liste ohne genau diese Meldung
```

Jede Stufe trägt genau eine Zusicherung: die Datenbank sagt, *was* betroffen war; der Helfer sorgt
dafür, dass *pro betroffener Meldung* gesendet wird; die Anzeige ordnet *ausschliesslich über die
Item-ID* zu. Fällt eine Stufe aus (verlorene Verbindung), greift der Abruf beim Laden — nicht als
Regelweg, sondern als Rückfallebene (FR-008).
