# Vertrag: OTLP-Empfänger (eingehend)

**Rolle des Toolkits**: Server. Gegenstelle ist die Claude-CLI, die das Toolkit selbst
gestartet hat.

Das Format ist nicht verhandelbar — es ist das OTLP/HTTP-JSON der CLI. Dieser Vertrag hält
fest, welchen Ausschnitt davon das Toolkit liest und wie es sich verhält.

---

## Endpunkt

```
POST /v1/logs
Content-Type: application/json
```

Auf dem bestehenden Server, gebunden an `127.0.0.1` (Default-Port 4820). Kein zusätzlicher
Listener. Der Signalpfad `/v1/logs` wird vom Exporter der CLI selbst an
`OTEL_EXPORTER_OTLP_ENDPOINT` angehängt.

**Registrierung**: mit erhöhtem `bodyLimit` (Fastify-Voreinstellung 1 MiB). Gemessene Stapel
lagen bei 3–19 KB, aber ein stiller 413 in einer langen Session wäre ein unsichtbarer
Messverlust.

## Antwort

**Immer** `200 OK` mit `{}` — auch bei unlesbarem Rumpf, unbekannten Ereignissen oder einem
Fehler in der Auswertung.

Begründung: Ein Fehlerstatus lässt den Exporter den Stapel wiederholen. Das erzeugt genau die
Doppelzählung, die FR-006 ausschliesst, und im schlimmsten Fall eine Schleife. Der Empfang ist
Buchhaltung, keine Zustellgarantie — was nicht verstanden wird, fehlt still und der Lauf fällt
auf die Transkript-Messung zurück (FR-015).

Ein Fehler in der Auswertung darf die Session nie erreichen (FR-020, FR-029).

## Gelesener Rumpf

```jsonc
{
  "resourceLogs": [{
    "resource": { "attributes": [ { "key": "sdd.session.id", "value": { "stringValue": "…" } } ] },
    "scopeLogs": [{
      "scope": { "name": "com.anthropic.claude_code.events" },
      "logRecords": [{
        "timeUnixNano": "1785150142488000000",
        "body": { "stringValue": "claude_code.api_request" },
        "attributes": [ /* siehe unten */ ]
      }]
    }]
  }]
}
```

### Ausgewertete Datensätze

Ausschliesslich `body.stringValue === "claude_code.api_request"`.

Alle anderen Ereignisse — `user_prompt`, `assistant_response`, `tool`, `tool_result`,
`hook_execution_*`, `mcp_server_connection`, `api_error`, … — werden verworfen, **bevor** sie
irgendwo landen. Das ist die technische Umsetzung von FR-027: Inhaltsdaten können gar nicht
erst gespeichert werden, unabhängig davon, wie die Inhalts-Schalter stehen.

### Gelesene Attribute

| Attribut | Typ in OTLP | Pflicht | Abbildung |
|---|---|---|---|
| `sdd.session.id` | `stringValue` | eines von beiden | `UsageEvent.sddSessionId` |
| `sdd.run.id` | `stringValue` | eines von beiden | `UsageEvent.sddRunId` |
| `request_id` | `stringValue` | ja | `UsageEvent.requestId` |
| `model` | `stringValue` | ja | `UsageEvent.model` |
| `input_tokens` | `intValue` | ja | `UsageEvent.inputTokens` |
| `output_tokens` | `intValue` | ja | `UsageEvent.outputTokens` |
| `cache_read_tokens` | `intValue` | nein → `0` | `UsageEvent.cacheReadTokens` |
| `cache_creation_tokens` | `intValue` | nein → `0` | `UsageEvent.cacheCreationTokens` |
| `cost_usd_micros` | `intValue` | nein → kein Betrag | `UsageEvent.costMicros` |
| `query_source` | `stringValue` | nein → `main` | `UsageEvent.origin` |
| `session.id` | `stringValue` | nein | `UsageEvent.claudeSessionId` (Diagnose) |

Der Zeitstempel kommt aus `logRecords[].timeUnixNano` (Nanosekunden als String) →
Millisekunden.

**Nicht gelesen** (und damit nicht gespeichert): `user.id`, `user.email`, `user.account_uuid`,
`user.account_id`, `organization.id`, `terminal.type`, `prompt.id`, `workspace.host_paths`.

### Marke: zwei Fundorte

`sdd.session.id` kommt **doppelt** an — auf `resource.attributes` und, weil
`OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES` per Voreinstellung `true` ist, zusätzlich auf jedem
Datensatz. Gelesen wird die Ressourcen-Ebene, mit Rückfall auf die Datensatz-Ebene. Damit hängt
die Zuordnung nicht an einer Vorgabe, die ein Nutzer umstellen könnte.

## Robustheitsregeln

| Fall | Verhalten |
|---|---|
| Rumpf kein gültiges JSON | verwerfen, `200` |
| `resourceLogs` fehlt oder ist kein Array | verwerfen, `200` |
| Datensatz ohne `request_id` oder ohne Zeitstempel | diesen Datensatz überspringen |
| Datensatz ohne `sdd.session.id` **und** ohne `sdd.run.id` | diesen Datensatz verwerfen (FR-003) |
| `intValue` als String (`"15273"`) statt Zahl | beide Formen lesen |
| `request_id` bereits gesehen | überspringen (FR-006) |
| Ereignis für einen bereits endgültigen Lauf | verwerfen (FR-012) |
| Unbekannter `query_source`-Wert | `auxiliary` |

## Verifizierter Mitschnitt

Ein echter `claude_code.api_request`-Datensatz aus dem Probelauf gegen CLI 2.1.220 liegt in
[../research.md](../research.md), Abschnitt D1.
