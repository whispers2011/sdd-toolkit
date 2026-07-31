# Vertrag: HTTP-Schnittstelle Richtung Web

Erweiterungen an bestehenden Endpunkten sind **additiv** — vorhandene Felder behalten Namen
und Bedeutung, damit die Oberfläche schrittweise nachziehen kann.

---

## Geändert: `GET /api/runs`

Liefert `RunSummary[]` (`shared/runSummary.ts`).

### Neue Felder je `CostRollup`

```jsonc
{
  "runs": 12, "tokens": 4200000,
  "inputTokens": 1200, "outputTokens": 34000,
  "cacheReadTokens": 4100000, "cacheCreationTokens": 64800,

  "costMicros": 2340567,      // NEU: Summe gemeldeter Beträge, Mikro-USD
  "runsWithoutCost": 3,       // NEU: enthaltene Läufe ohne gemeldeten Betrag (FR-024)
  "subagentTokens": 890000    // NEU: davon durch Subagenten (FR-010)
}
```

### Geändert: `sourceMix`

```jsonc
"sourceMix": { "telemetry": 0.82, "transcript": 0.15, "parsed": 0, "estimated": 0.03 }
```

`telemetry` ist neu. Der Nenner bleibt **alle** Läufe, nicht nur die gemessenen — sonst meldet
ein Lauf mit einer gemessenen und zehn ungemessenen Ausführungen „100 % gemessen". Die Summe
der vier Werte ist ≤ 1; der Rest zu 1 ist der ungemessene Anteil.

**Für die Oberfläche wichtig**: Die heutige Kennzahl „% gemessen" rechnet mit
`sourceMix.transcript` allein. Sie muss auf `telemetry + transcript` erweitert werden — sonst
fällt die Anzeige beim Umstieg scheinbar auf 0.

---

## Geändert: `GET /api/executions`

Liefert `ExecutionRecord[]`.

```jsonc
{
  "id": "…", "kind": "phase", "phase": "implement",
  "tokens": 412000,
  "inputTokens": 120, "outputTokens": 8400,
  "cacheReadTokens": 398000, "cacheCreationTokens": 5480,

  "tokensSource": "telemetry",   // GEÄNDERT: neue höchste Stufe
  "costMicros": 234056,          // NEU: null = kein Betrag gemeldet
  "subagentTokens": 89000,       // NEU: null = keine Subagenten (keine Null-Zeile!)
  "subagentCostMicros": 45200,   // NEU
  "model": "claude-opus-5",      // NEU: aus den Meldungen (FR-013)
  "telemetryFinalAt": 1785150442000  // NEU: ab hier endgültig (FR-012)
}
```

`costMicros: null` bedeutet **kein Betrag** und wird als solcher dargestellt — nie als `0` und
nie als Ersatzschätzung (FR-023). Bestandsläufe haben `null` und bekommen keinen rückwirkenden
Betrag (FR-025).

`subagentTokens: null` bedeutet **keine Subagenten**; die Oberfläche zeigt dann keinen
Subagenten-Anteil — kein leerer Platzhalter, keine Null-Zeile (FR-010, Szenario 3).

---

## Geändert: `GET /api/features/:featureId/cost-breakdown`

`FeatureCostBreakdown`. Dieselben neuen `CostRollup`-Felder in `total`, `byPhase[].rollup`,
`byKind[].rollup`, und `sourceMix` um `telemetry` erweitert.

---

## Neu: `GET /api/telemetry/status`

Deckt FR-019 (Hinweis mit Grund) und die Sichtbarkeit aus research.md D5 ab.

```jsonc
{
  "active": true,
  "reason": null,
  "endpoint": "http://127.0.0.1:4820",
  "eventsReceived": 1284,
  "lastEventAt": 1785150142488,
  "overridesUserConfig": false
}
```

| Feld | Bedeutung |
|---|---|
| `active` | Empfang in Betrieb. |
| `reason` | Grund, wenn `active: false` — siehe Tabelle unten; `null` wenn aktiv. |
| `endpoint` | Was den Claude-Prozessen mitgegeben wird (Diagnose). |
| `eventsReceived` | Verwertete `api_request`-Ereignisse seit Serverstart. `0` bei aktivem Empfang deutet auf eine CLI ohne Telemetrie-Unterstützung. |
| `lastEventAt` | Zeitpunkt des letzten verwerteten Ereignisses; `null` wenn noch keines. |
| `overridesUserConfig` | `true`, wenn eine abweichende OTel-Konfiguration in der geerbten Umgebung erkannt wurde und für Toolkit-Sessions übersteuert wird (D5). |

### Gründe

| `reason` | Bedeutung | Folge |
|---|---|---|
| `null` | in Betrieb | — |
| `"route_unavailable"` | Empfangsroute konnte nicht registriert werden | Rückfall auf Transkript |
| `"no_events_yet"` | aktiv, aber noch nichts eingetroffen | normal kurz nach dem Start |

In allen Fällen startet die Session normal und bleibt bedienbar (FR-020); die Messung fällt auf
die Transkript-Ebene zurück (FR-015).

---

## Ereignisbus (bestehend, erweitert)

Wird ein Lauf nachträglich verrechnet (FR-011), meldet der Server das über den bestehenden
Bus, damit sich die Ansicht ohne Zutun des Nutzers aktualisiert:

```jsonc
{ "type": "execution_updated", "executionId": "…", "featureId": "…" }
```

Die Oberfläche lädt daraufhin die betroffenen Läufe neu. Das ist der Mechanismus hinter
US1, Szenario 4 — nachgereichte Meldungen korrigieren den Lauf sichtbar, ohne Neuladen.
