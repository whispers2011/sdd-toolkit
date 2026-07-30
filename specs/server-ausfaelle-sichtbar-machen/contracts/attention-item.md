# Contract C4 — Aufmerksamkeitsmeldung `server_outage`

Die Ausfallmeldung fügt sich in den bestehenden Apparat „Braucht dich" ein (FR-007). Dieser
Contract legt fest, was sich für bestehende Bestandteile ändert — und was ausdrücklich nicht.

---

## Neue Art

```ts
// packages/shared/src/types.ts
export type AttentionKind = … | 'server_outage';
```

Kein Datenbank-Migrationsschritt: `attention.kind` ist `TEXT` ohne `CHECK`
(`packages/server/src/db/database.ts:73`).

## Anlegen

```ts
attention.raise({
  kind: 'server_outage',
  projectId,          // je betroffenem Projekt eine Meldung (FR-006)
  featureId: null,    // ein Ausfall gehört keinem einzelnen Feature
  sessionId: null,
  conversationId: null,
  message: outageMessage({ from, to, durationMs, runCount, featureNames }),
});
```

| # | Zusicherung | Bezug |
|---|---|---|
| C4.1 | Genau eine Meldung je Projekt mit betroffenen Läufen; die Zahlen im Text sind die **dieses** Projekts | FR-006, US1-5 |
| C4.2 | Kein betroffener Lauf → **keine** Meldung, nur der Protokolleintrag | FR-006, US1-6 |
| C4.3 | Bestehende `run_interrupted`-Meldungen bleiben unberührt; die Ausfallmeldung tritt daneben | FR-008, US1-7 |
| C4.4 | Erneuter Start ohne zwischenzeitlichen Ausfall erzeugt keine zweite Meldung (D4 + Dedup in `AttentionRepo.raise`) | FR-009, US1-8 |
| C4.5 | `featureId` bleibt `null` — die Meldung ist anlagenweit, nicht feature-gebunden | Spec-Annahme „Meldungen sind projektbezogen" |

## Reihenfolge beim Start (verbindlich)

```
openDatabase()
  └─ Repos aufbauen
      └─ outageMonitor.detectOnBoot()      ← liest executions(status='running') SOLANGE es sie gibt
          ├─ operationsLog.rotateIfNeeded()
          ├─ operationsLog.append(startup)
          ├─ detectOutage(heartbeat, now)
          ├─ operationsLog.append(outage)   (bei kind='outage' oder 'undetermined')
          ├─ attention.raise(server_outage) (je Projekt mit betroffenen Läufen)
          └─ heartbeatStore.write(neu)      ← macht die Lücke unwiederholbar (D4)
  …
orchestrator.reapOnBoot()                   ← setzt running → orphaned, meldet run_interrupted
```

Wird diese Reihenfolge vertauscht, zählt der Ausfall **null** betroffene Läufe — der häufigste
denkbare Regressionsfehler dieses Features. Ein Test hält sie fest (siehe
[quickstart.md](../quickstart.md), Szenario 6).

## Reconciler

`packages/server/src/services/attentionReconciler.ts` bekommt einen expliziten Fall:

```ts
case 'server_outage':
  // Ein Ausfall ist ein Ereignis der Vergangenheit — es gibt keinen „aktiven Zustand",
  // an dem er sich prüfen liesse. Nur der Mensch erledigt ihn.
  return true;
```

| # | Zusicherung | Bezug |
|---|---|---|
| C4.6 | `findStaleRuntime()` löst `server_outage` nie auf | FR-007 |
| C4.7 | `findStaleOnBoot()` löst `server_outage` nie auf — insbesondere fällt sie nicht in den pauschalen Stale-Zweig von `awaiting_input`/`agent_errored` | FR-007 |

## Oberfläche

`packages/web/src/components/AttentionInbox.tsx`:

```ts
server_outage: { label: 'Server-Ausfall', icon: '🕳', tone: 'text-red-400' },
```

| # | Zusicherung | Bezug |
|---|---|---|
| C4.8 | Die Zeile lässt sich aufklappen und zeigt den Text dann vollständig statt `truncate`-abgeschnitten — Beginn, Ende, Dauer und betroffene Features werden lesbar | US1-2, D18 |
| C4.9 | Ohne `featureId` und ohne `conversationId` erscheint keine Folgeaktion — nur der Erledigt-Haken. Das ist das bestehende Verhalten und bleibt so | FR-007 |
| C4.10 | Erledigen läuft über den bestehenden `POST /api/attention/:id/resolve`; danach bleibt der Ausfall über `GET /api/system/status` und im Protokoll nachschlagbar | Edge Case „Erledigte Ausfallmeldung" |
