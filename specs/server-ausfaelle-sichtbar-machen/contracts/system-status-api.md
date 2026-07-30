# Contract C3 — `GET /api/system/status`

Einziger neuer HTTP-Endpunkt. Bedient die Kopfleisten-Anzeige (US3) einschliesslich des zuletzt
registrierten Ausfalls (FR-023).

**Registriert in**: `packages/server/src/api/server.ts`
**Aufrufer**: `packages/web/src/components/SystemStatus.tsx` über `api.systemStatus()`

---

## Anfrage

```
GET /api/system/status
```

Keine Parameter. Keine Authentisierung (wie alle Routen dieses lokal gebundenen Servers, siehe
`originGuard.ts`).

## Antwort `200`

```jsonc
{
  "resources": {
    "diskFreeBytes": 852017152,
    "diskTotalBytes": 994662584320,
    "swapUsedRatio": 0.8017,
    "swapUsedBytes": 4777115648,
    "swapTotalBytes": 5905580032,
    "activeFeatures": 3,
    "collectedAt": 1753890120000
  },
  "pressure": {
    "level": "warn",
    "summary": "813 MB · Swap 80 % · 3 parallel",
    "notice": "3 Features parallel, Swap 80 %, 813 MB frei"
  },
  "lastOutage": {
    "from": 1753884550000,
    "to": 1753890000000,
    "durationMs": 5450000,
    "affectedRuns": 2,
    "silent": true,
    "undetermined": false
  }
}
```

## Zusicherungen

| # | Zusicherung | Bezug |
|---|---|---|
| C3.1 | Antwortet immer `200`, auch wenn jede einzelne Kennzahl fehlschlägt — dann stehen dort `null` | FR-022, FR-024 |
| C3.2 | `collectedAt` ist der echte Erhebungszeitpunkt, nicht der Antwortzeitpunkt; bei Cache-Treffer bleibt er stehen | FR-021 |
| C3.3 | `collectedAt` ist beim Abruf höchstens 10 s alt (Cache-Dauer); bei 20-s-Polling ist die Anzeige damit nie älter als 30 s | FR-021, SC-006 |
| C3.4 | `lastOutage` ist `null`, wenn im Betriebsprotokoll kein Ausfall steht; es überlebt das Erledigen der Aufmerksamkeitsmeldung | FR-023, Edge Case „Erledigte Ausfallmeldung" |
| C3.5 | `pressure` wird serverseitig aus derselben reinen Funktion abgeleitet, die auch getestet wird — die Oberfläche entscheidet keine Schwellen selbst | FR-020 |
| C3.6 | Die Route blockiert die Ereignisschleife nicht: `fs.statfs` und `sysctl` laufen asynchron, `sysctl` mit 2 s Timeout | FR-024, SC-008 |
| C3.7 | Nicht ermittelbare Kennzahlen unterdrücken die übrigen nicht (`Promise.allSettled`) | FR-022, US3-5 |

## Kurzform `pressure.summary`

Genau die Zeichenkette, die in der Kopfleiste steht. Aufbau: `<freier Platz>` · `Swap <Prozent>` ·
`<n> parallel`. Regeln:

- Nicht ermittelbare Werte erscheinen als `–` (`"– · Swap 80 % · 2 parallel"`).
- Der Teil `<n> parallel` entfällt bei weniger als zwei arbeitenden Features (FR-019).
- Plattenplatz mit einer Nachkommastelle ab GB (`"1.4 GB"`), ganzzahlig in MB darunter (`"813 MB"`).

## `pressure.notice`

Gesetzt, sobald Ressourcendruck **und** Parallelität zusammentreffen (US3-4) oder die Warnschwelle
unterschritten ist (FR-020). Sonst `null`. Der Text nennt die konkreten Werte, nicht nur die Stufe.

## Web-Anbindung

```ts
// packages/web/src/api.ts
systemStatus: () => request<SystemStatus>('GET', '/api/system/status'),
```

`SystemStatus` wird aus `@sdd/shared` importiert, nicht im Web dupliziert. Das Polling-Intervall
(20 s) liegt in `SystemStatus.tsx` — Vorbild ist `WorktreeOverview.tsx:104`.
