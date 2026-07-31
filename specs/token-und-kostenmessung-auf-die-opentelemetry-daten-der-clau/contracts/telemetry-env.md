# Vertrag: Umgebung der gestarteten Claude-Prozesse (ausgehend)

**Rolle des Toolkits**: Aufrufer. Diese Variablen werden ausschliesslich in die Umgebung der
vom Toolkit gestarteten Kindprozesse gesetzt — nie in die Umgebung des Nutzers, nie in
`~/.claude/settings.json`.

Alle Werte sind gegen Claude Code 2.1.220 verifiziert (research.md).

---

## Gemeinsame Variablen (alle Claude-Prozesse)

| Variable | Wert | Warum |
|---|---|---|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | `1` | Schaltet die Telemetrie ein. Wird von der CLI direkt aus `process.env` gelesen. |
| `OTEL_LOGS_EXPORTER` | `otlp` | Ereignisse — die Messquelle. |
| `OTEL_METRICS_EXPORTER` | *(nicht gesetzt)* | Metriken werden **nicht** ausgewertet (research.md D1). Nicht setzen = kein Exporter = kein Aufwand. |
| `OTEL_TRACES_EXPORTER` | *(nicht gesetzt)* | Traces ausserhalb des Umfangs (D7). |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/json` | Erlaubt einen Empfänger ohne Protobuf-Abhängigkeit. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://127.0.0.1:<serverPort>` | Der Signalpfad `/v1/logs` wird von der CLI angehängt. Port aus `ServerConfig.port`. |
| `OTEL_LOGS_EXPORT_INTERVAL` | `5000` | Entspricht der Voreinstellung; explizit gesetzt, damit eine abweichende Nutzerkonfiguration die Nachlaufzeit nicht verlängert. |

## Datenschutz-Variablen (FR-027)

| Variable | Wert |
|---|---|
| `OTEL_LOG_USER_PROMPTS` | `0` |
| `OTEL_LOG_ASSISTANT_RESPONSES` | `0` |
| `OTEL_LOG_TOOL_CONTENT` | `0` |
| `OTEL_LOG_TOOL_DETAILS` | `0` |
| `OTEL_LOG_RAW_API_BODIES` | `0` |

Das entspricht der Voreinstellung der CLI — im Probelauf kamen Prompt und Antwort als
`<REDACTED>` an. Explizit gesetzt bleibt es richtig, auch wenn der Nutzer die Schalter global
anders stellt. Zweite, unabhängige Absicherung: der Empfänger wertet ohnehin nur
`claude_code.api_request` aus.

## Marke je Prozess

Genau eine der beiden, abhängig von der Art des Prozesses:

| Prozessart | Variable | Wert |
|---|---|---|
| Interaktive PTY-Session (`PtySessionManager.spawn`) | `OTEL_RESOURCE_ATTRIBUTES` | `sdd.session.id=<LiveSession.id>` |
| Headless-Lauf (Agent-Gate, Konfliktauflösung, Chat) | `OTEL_RESOURCE_ATTRIBUTES` | `sdd.run.id=<executionId>` |

**Warum zwei Marken**: Eine PTY-Session überlebt viele Läufe — dort ist die Session die
stabile Einheit und der Lauf wird über das Zeitfenster bestimmt. Ein Headless-Prozess **ist**
genau ein Lauf; die direkte Zuordnung über die `executionId` braucht dort gar kein Zeitfenster.

**Format**: `OTEL_RESOURCE_ATTRIBUTES` ist eine Komma-Liste aus `schlüssel=wert`. Die CLI
validiert: Schlüssel und Wert je ≤ 255 Zeichen, nur druckbares ASCII ohne `,` `;` `\`.
Toolkit-IDs sind `nanoid(10)` und erfüllen das. Bei Verletzung verwirft die CLI die **gesamte**
Liste still — deshalb wird der Wert vor dem Setzen geprüft.

## Wo gesetzt wird

Alle Spawn-Stellen beziehen ihre Umgebung heute über `loginShellEnv()`. Die Telemetrie-Variablen
kommen als Überlagerung **je Aufruf** dazu, nicht in den gecachten Basis-Satz — sonst trügen
alle Prozesse dieselbe Marke.

| Datei | Aufruf | Marke |
|---|---|---|
| `pty/sessionManager.ts` | `spawn()` → `env: { ...env, SDD_SESSION_ID: id }` | `sdd.session.id` |
| `services/agentGateService.ts` | Review-/Gate-Agents | `sdd.run.id` |
| `services/conflictResolver.ts` | Konfliktauflösung | `sdd.run.id` |
| `services/chatService.ts` | Projekt-Chat | `sdd.run.id` |
| `services/chatWorkService.ts` | Arbeits-Chat | `sdd.run.id` |

`services/verifyService.ts` bleibt unangetastet — dort laufen die Verifikationskommandos des
Projekts, kein Claude-Prozess.

Damit ist FR-026 abgedeckt: Phasenläufe, Verifikations- und Review-Läufe, Konfliktlösung und
Chat-Sessions.

## Vorrang gegenüber bestehender Konfiguration

Entscheidung (research.md D5): Das Toolkit gewinnt für seine eigenen Prozesse und weist
sichtbar darauf hin.

**Erkennung**: Beim Start prüft der Server die geerbte Umgebung auf
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_LOGS_EXPORTER` und `CLAUDE_CODE_ENABLE_TELEMETRY`. Weicht
etwas davon ab, was das Toolkit setzen würde, wird das als Zustand gemeldet (siehe
[runs-api.md](./runs-api.md), `GET /api/telemetry/status`) und in den Einstellungen angezeigt.

**Bestehende `OTEL_RESOURCE_ATTRIBUTES` des Nutzers**: Die Marke wird **angehängt**, nicht
ersetzt — die übrigen Attribute des Nutzers bleiben erhalten.

**Nicht verändert werden**: die Umgebung des Nutzers, `~/.claude/settings.json`, projekt- oder
unternehmensweite Einstellungsdateien. Sessions, die der Nutzer selbst startet, sind von
alldem unberührt.

## Bei der Umsetzung zu prüfen

Die Rangfolge zwischen `settings.json`-`env` und Prozessumgebung innerhalb der CLI ist nicht
abschliessend geklärt. Einmal empirisch prüfen: eine Session mit einem gegenläufigen
`env`-Eintrag in `~/.claude/settings.json` starten und beobachten, ob Ereignisse ankommen.

Fällt die Prüfung gegen uns aus, wandern die Variablen in die je Session ohnehin geschriebene
Settings-Datei (`hookBridge.writeHookSettings` erzeugt sie bereits, `--settings` wird bereits
übergeben) — der Weg dorthin ist gebaut, es käme nur ein `env`-Block dazu.
