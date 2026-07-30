# Vertrag: HTTP-Antworten und Ereignisse

Keine neue Route, kein neues Ereignis, keine geänderte Anfrageform. Was sich ändert, sind
**Werte in bestehenden Antworten** — alle rückwärtskompatibel im Sinne von „vorhandene Felder
behalten Typ und Bedeutung", aber mit neuen möglichen Enum-Werten, die Konsumenten kennen müssen.

---

## 1. `GET /api/state` (`server.ts:152-175`)

Liefert unverändert `{ projects, features, attention, … }`.

| Feld | Änderung |
|---|---|
| `features[].integration` | kann jetzt `'verification_unconfigured'` sein |
| `attention[].kind` | kann jetzt `'verification_unconfigured'` sein; solche Einträge haben `featureId === null` und `conversationId === null` |

**Nebenwirkung des Aufrufs** (bestehend, jetzt erweitert): `deps.orchestrator.reconcileOpenAttention()`
läuft vor der Antwort. Neu löst dieser Durchlauf zusätzlich die Einträge der Art
`verification_unconfigured` für Projekte auf, die inzwischen mindestens ein Verifikationskommando
haben (FR-007), und sendet für jeden aufgelösten Eintrag `attention_resolved` über den Ereignis-Bus.

---

## 2. `GET /api/attention` (`server.ts:958-961`)

Unverändert in Form; dieselbe Reconcile-Nebenwirkung wie oben. Enthält den projektbezogenen Eintrag,
solange er offen ist.

## 3. `POST /api/attention/:id/resolve` (`server.ts:963-966`)

Unverändert. Auf einen `verification_unconfigured`-Eintrag angewandt löst er **ausschließlich** die
Meldung auf (Clarification): Stufe, Meldungen und Review-Portal führen den Zustand weiter, und für
dasselbe Projekt entsteht kein neuer Eintrag, solange die Konfiguration leer bleibt.

---

## 4. `GET /api/review/overview?projectId=…` (`reviewRoutes.ts:75-132`)

`ReviewOverviewItem[]` wie bisher; `verify.status` kann jetzt `'unconfigured'` sein
(Belegungsregel in `contracts/domain.md` §4). `item.feature` trägt unverändert
`tasksDone`/`tasksTotal` — die Übersicht braucht dafür keine zusätzliche Anfrage.

---

## 5. `GET /api/runs` (`server.ts:1405-1407`)

```jsonc
{
  "runs": [
    {
      "featureId": "…",
      "featureName": "ehrlichkeit-vor-dem-merge",
      "projectId": "…",
      "branch": "feature/…",
      "integration": "merged",
      "archived": false,
      "startedAt": 1753900000000,
      "lastActivityAt": 1753910000000,
      "running": false,
      "tasksDone": 68,      // NEU
      "tasksTotal": 76,     // NEU
      "total": { "costMicros": 4200000, "runsWithoutCost": 2, "…": "…" },
      "byStep": [],
      "byCategory": {},
      "sourceMix": {}
    }
  ]
}
```

Kosten pro Aufgabe erscheinen **nicht** in der Antwort — sie werden auf beiden Anzeigeseiten aus
`total.costMicros` und `tasksDone` mit `costPerTask()` abgeleitet (SC-008: keine zusätzliche
gespeicherte oder übertragene Kennzahl).

---

## 6. `PATCH /api/projects/:id` (`server.ts:250-258`)

Unverändert (inklusive `verifyCommands` in der Positivliste). Das Auflösen des
Aufmerksamkeits-Eintrags hängt bewusst **nicht** an dieser Route, sondern am Reconcile-Durchlauf —
so wirkt es auch nach einem Neustart und bei Konfigurationsänderungen, die nicht über diese Route
kommen.

---

## 7. Ereignisse (WebSocket-Bus, `events.ts`)

| Ereignis | Änderung |
|---|---|
| `feature_updated` | kann ein Feature mit `integration: 'verification_unconfigured'` tragen |
| `attention_raised` | kann einen Eintrag der neuen Art tragen (`featureId: null`) |
| `attention_resolved` | wird zusätzlich beim automatischen Auflösen der neuen Art gesendet |
| `notification` (`kind: 'merged'`) | `body` enthält jetzt zusätzlich den Aufgabenstand (FR-012a) |

Keine neuen Ereignistypen (FR-012a: „kein neuer Meldungstyp").
