# Phase 0 — Research: Token- und Kostenmessung aus der Telemetrie der Claude-CLI

**Datum**: 2026-07-27 · **Basis**: Claude Code `2.1.220` (`/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code`)

Alle Aussagen unten sind am installierten Binary verifiziert — durch statische Analyse des
gebündelten Codes **und** durch einen Live-Probelauf gegen einen lokalen OTLP-Empfänger
(Port 4899, danach abgeräumt). Nichts hier ist aus der Dokumentation übernommen.

---

## D1: Ereignisse statt Metriken als Messquelle

**Entscheidung**: Primärquelle ist der OTel-**Log-/Ereignisstrom**, konkret das Ereignis
`claude_code.api_request`. Metriken (`claude_code.token.usage`, `claude_code.cost.usage`)
werden **nicht** ausgewertet und der Metrik-Exporter bleibt aus.

**Begründung**: Ein `api_request`-Ereignis trägt alles, was die Spec verlangt, und trägt es
je Einzelanfrage mit eigenem Zeitstempel. Verifizierter Mitschnitt eines echten Laufs:

```jsonc
{ "timeUnixNano": "1785150142488000000",
  "body": { "stringValue": "claude_code.api_request" },
  "attributes": [
    { "key": "sdd.session.id",     "value": { "stringValue": "probe-abc123" } },   // unsere Marke
    { "key": "session.id",         "value": { "stringValue": "65aa32c1-…" } },     // Claude-Session
    { "key": "model",              "value": { "stringValue": "claude-opus-5" } },
    { "key": "input_tokens",         "value": { "intValue": 2 } },
    { "key": "output_tokens",        "value": { "intValue": 4 } },
    { "key": "cache_read_tokens",    "value": { "intValue": 15273 } },
    { "key": "cache_creation_tokens","value": { "intValue": 8271 } },
    { "key": "cost_usd",           "value": { "doubleValue": 0.0904565 } },
    { "key": "cost_usd_micros",    "value": { "intValue": 90457 } },
    { "key": "request_id",         "value": { "stringValue": "req_011CdST19ne3fMRQ6CdysbFp" } },
    { "key": "query_source",       "value": { "stringValue": "sdk" } },
    { "key": "event.timestamp",    "value": { "stringValue": "2026-07-27T11:02:22.488Z" } }
  ] }
```

Damit sind vier Anforderungen direkt aus dem Datensatz erfüllt, ohne Rekonstruktion:

| Anforderung | Deckung durch `api_request` |
|---|---|
| FR-008 Vier Verbrauchsarten getrennt | `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` |
| FR-004 Zuordnung zum aktiven Lauf | `timeUnixNano` je Einzelanfrage → Zeitfenster-Zuordnung |
| FR-006 Keine Doppelzählung | `request_id` als natürlicher, stabiler Dedupe-Schlüssel |
| FR-021 Gemeldeter Geldbetrag | `cost_usd_micros` (ganzzahlig, kein Float-Drift) |

**Alternativen verworfen**:

- *Metriken (`claude_code.token.usage`)*: Zähler, die per Voreinstellung **alle 60 s** exportiert
  werden (`OTEL_METRIC_EXPORT_INTERVAL` Default `60000`), voreingestellt kumulativ. Ein
  Zwei-Minuten-Lauf bekäme ein bis zwei Datenpunkte — zu grob, um einen Lauf sauber vom
  nächsten zu trennen (FR-004/FR-005 wären wieder Rekonstruktion, genau das Problem, das
  dieses Feature abschafft). Zudem kein `request_id` → Dedupe nur über Zeitstempel.
  Ereignisse exportieren voreingestellt alle **5 s** (`OTEL_LOGS_EXPORT_INTERVAL` Default `5000`).
- *Traces/Spans*: siehe D7 — ausserhalb des Umfangs (Nutzerentscheidung 2026-07-27).

---

## D2: Zuordnung über eine eigene Ressourcen-Marke (`sdd.session.id`)

**Entscheidung**: Jeder vom Toolkit gestartete Claude-Prozess bekommt
`OTEL_RESOURCE_ATTRIBUTES=sdd.session.id=<Toolkit-Session-ID>` (interaktive PTY-Sessions)
bzw. `sdd.run.id=<executionId>` (Headless-Läufe). Ereignisse ohne eine dieser Marken werden
verworfen.

**Begründung**: Das ist der eigentliche Hebel gegen den 62-Mio.-Fehler. Die Marke wird vom
Prozess selbst gesetzt und in **jedes** Ereignis kopiert — es gibt kein Zeitfenster, in dem die
Zuordnung noch unbekannt wäre. Genau das war die Schwäche des Transkript-Wegs: dort steht die
Claude-Session-ID erst fest, wenn der Lauf schon läuft (`orchestrator.startOffsetIn`,
`transcriptWatcher.offsetAtTimestamp`).

Verifiziert: die Marke kam im Probelauf **doppelt** an — als Ressourcen-Attribut
(`resource.attributes`) und, weil `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES` per Voreinstellung
`true` ist, zusätzlich auf jedem einzelnen Log-Datensatz. Wir lesen die Ressourcen-Ebene und
fallen auf die Datensatz-Ebene zurück; damit hängt die Zuordnung nicht an einer Vorgabe, die
ein Nutzer umstellen könnte.

Validierung der Marke durch die CLI (aus dem Bundle): Schlüssel und Wert je ≤ 255 Zeichen,
nur druckbares ASCII ohne `,` `;` `\`. Toolkit-IDs sind `nanoid(10)` — unproblematisch.

**FR-003 (fremde Sessions)** fällt damit trivial aus: eine Session, die der Nutzer selbst
startet, trägt keine `sdd.*`-Marke; ihre Ereignisse werden verworfen.

**FR-007 (Kontext-Reset)**: Ein `/clear` erzeugt eine neue `session.id`, aber **derselbe
Prozess** läuft weiter und behält seine `sdd.session.id`. Der Verbrauch beider Abschnitte
landet ohne Sonderbehandlung im selben Lauf.

**Alternative verworfen**: Zuordnung allein über `session.id` (Claude-UUID) und die im Toolkit
bereits geführte Abbildung aus der Hook-Bridge (`sessionManager.onClaudeSessionId`). Funktioniert
im Regelfall, hat aber genau die Wettlaufsituation, die dieses Feature beseitigen soll, und
kann eine fremde Session nicht von einer eigenen unterscheiden, deren ID noch nicht gemeldet
wurde. `session.id` wird trotzdem mitgelesen — als Diagnose- und Prüfhilfe (SC-004).

---

## D3: Empfang über `http/json` auf dem bestehenden Fastify-Server

**Entscheidung**: Der Server nimmt OTLP unter `POST /v1/logs` auf dem **bestehenden** Port
(Default 4820, gebunden an `127.0.0.1`) entgegen. Protokoll `http/json`.

**Begründung**: `http/json` ist von der CLI unterstützt (im Bundle als eigener Zweig neben
`grpc` und `http/protobuf`; im Probelauf mit `Content-Type: application/json` und unkomprimiert
angekommen). Damit braucht das Toolkit **keine** neue Abhängigkeit — kein Protobuf, kein
OTel-SDK, kein zweiter Listener. Der Empfänger ist ein Fastify-Route-Handler über einem
JSON-Objekt.

Der Exporter hängt den Signalpfad selbst an: aus `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4820`
wird `http://127.0.0.1:4820/v1/logs`.

**Zu beachten bei der Umsetzung**:
- Fastify begrenzt Rumpfgrössen per Voreinstellung auf 1 MiB. Gemessene Stapel lagen bei
  3–19 KB; für lange Sessions ist die Route trotzdem mit erhöhtem `bodyLimit` zu registrieren,
  damit ein grosser Stapel nicht still mit 413 verworfen wird.
- Der Handler antwortet immer `200 {}`. Ein Fehler in der Auswertung darf nie zu einem
  Wiederholungsversuch der CLI führen (FR-006) und schon gar nicht die Session stören (FR-020).
- Ganzzahlen kommen in OTLP/JSON als **String** (`intValue: "15273"`) oder Zahl — beides
  tolerieren.

**Alternativen verworfen**: eigener Port (zusätzliche Konfiguration, zusätzliche Fehlerquelle);
`http/protobuf` (Abhängigkeit ohne Gegenwert); Datei-Exporter (existiert nicht).

---

## D4: Herkunft (Haupt-/Subagent/Hilfsanfrage) aus `query_source`

**Entscheidung**: Die Einstufung wird als reine Funktion in `@sdd/shared` nachgebildet — exakt
nach der Regel der CLI:

```
undefined                              → main   (kein Attribut = Hauptagent)
"repl_main_thread…" | "sdk"            → main
"agent:…" | "hook_agent"               → subagent
alles andere                           → auxiliary
```

Beobachtete Werte von `query_source` (aus der Wertemenge im Bundle): `repl_main_thread`,
`repl_main_thread:outputStyle:*`, `sdk`, `agent:default`, `agent:builtin`, `agent:custom`,
`compact`, `hook_agent`, `hook_prompt`, `side_question`, `web_search_tool`, `web_fetch_apply`,
`repl_sampling`, `auto_mode`, `chrome_mcp`.

**Begründung**: Damit ist US2 ohne Zusatzaufwand erfüllt — Subagenten melden über **denselben**
Kanal wie der Hauptagent (sie sind Teil desselben Prozesses), es gibt keine zweite Quelle
anzuzapfen. Das heutige Loch (Subagenten schreiben in eigene Transkripte, die niemand liest)
existiert im Telemetrie-Weg schlicht nicht.

`compact` fällt in `auxiliary`: Der Verbrauch eines `/compact` gehört zum Lauf, der ihn
ausgelöst hat (dieselbe Haltung wie heute in `orchestrator.launchPhase` — „die Usage des Resets
gehört zur realen Kosten dieses optimierten Laufs"), zählt aber nicht als Subagenten-Anteil.

---

## D5: Vorrang gegenüber bestehender Telemetrie-Konfiguration

**Entscheidung** (Nutzerentscheidung 2026-07-27): Das Toolkit gewinnt für die von ihm
gestarteten Prozesse — mit sichtbarem Hinweis. Es setzt die OTel-Variablen ausschliesslich
in der Umgebung seiner eigenen Kindprozesse; die Konfiguration des Nutzers (Umgebung,
`~/.claude/settings.json`) wird **nicht** verändert. Sessions, die der Nutzer selbst startet,
bleiben unberührt.

**Begründung**: Verlässliche Messung ohne Konfigurationsarbeit (FR-001). Der Eingriff bleibt
auf Toolkit-Prozesse begrenzt und ist nicht still: erkennt das Toolkit beim Start eine
abweichende OTel-Konfiguration in der geerbten Umgebung, weist es in den Einstellungen darauf
hin, dass sie für Toolkit-Sessions übersteuert wird (gleicher Mechanismus wie FR-019).

**Alternativen verworfen**: bestehende Konfiguration gewinnt (die neue Messung griffe bei
genau diesen Nutzern nie); Weiterleitung an den fremden Endpunkt (das Toolkit sendete dann
selbst Nutzungsdaten nach aussen — FR-028 schliesst das aus).

**Rangfolge — empirisch geklärt (T002, 2026-07-27, CLI 2.1.220)**

Zwei Probeläufe gegen einen lokalen Empfänger, jeweils mit `--settings <datei>`:

| Fall | Prozess-Umgebung | Settings-`env` | Ergebnis |
|---|---|---|---|
| A | `OTEL_LOGS_EXPORTER=otlp` (+ vollständige Konfiguration) | `OTEL_LOGS_EXPORTER=none` | **0** Ereignisse |
| B | leer (Variablen ausdrücklich entfernt) | vollständige Konfiguration inkl. `OTEL_RESOURCE_ATTRIBUTES` | **1** Ereignis, Marke auf Ressourcen- **und** Datensatz-Ebene, mit `request_id`, `query_source`, `cost_usd_micros` |

**Ergebnis**: Der `env`-Block einer Settings-Datei **schlägt** die Prozessumgebung. Die
Prüfung fällt damit gegen den ursprünglichen Hauptweg aus — der geplante Ausweichweg wird zum
Hauptweg.

**Folge für die Umsetzung**: Die Telemetrie-Variablen gehören in den `env`-Block der je Session
geschriebenen Settings-Datei, nicht (nur) in die Prozessumgebung.

- **PTY-Sessions**: `hookBridge.writeHookSettings` schreibt diese Datei bereits und `--settings`
  wird bereits übergeben — es kommt nur der `env`-Block dazu.
- **Headless-Läufe** (Agent-Gate, Konfliktauflösung, Chat) bekommen heute **keine**
  Settings-Datei. Sie brauchen eine eigene, kleine Datei je Lauf plus `--settings` in der
  argv-Erzeugung. Ohne das würde eine gegenläufige `~/.claude/settings.json` des Nutzers die
  Messung dieser Läufe still abschalten.
- Die Prozessumgebung wird **zusätzlich** gesetzt. Sie kostet nichts und trägt, falls eine
  Settings-Datei einmal fehlt oder nicht gelesen wird.

Bestätigt bleibt: `OTEL_RESOURCE_ATTRIBUTES` ist im `env`-Block zulässig und die Marke kommt
unverändert an — die Zuordnung (D2) funktioniert auf diesem Weg genauso.

---

## D6: Datenschutz — Inhalte bleiben aus (FR-027)

**Entscheidung**: Die Inhalts-Schalter werden **ausdrücklich** auf `0` gesetzt, statt sich auf
die Voreinstellung zu verlassen: `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`,
`OTEL_LOG_TOOL_CONTENT`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_RAW_API_BODIES`.

**Begründung**: Verifiziert — im Probelauf kamen `claude_code.user_prompt` und
`claude_code.assistant_response` mit `"prompt": "<REDACTED>"` bzw. `"response": "<REDACTED>"`
an, nur Längen waren gefüllt. Die Voreinstellung ist also bereits richtig. Explizit gesetzt
bleibt sie richtig, auch wenn der Nutzer die Schalter global anders stellt — und passt zu D5
(Toolkit-Prozesse tragen die Toolkit-Haltung).

Ereignisse ausserhalb der Whitelist werden vom Empfänger **verworfen, bevor** sie irgendwo
landen: ausgewertet wird ausschliesslich `claude_code.api_request`. Personenbezogene
Attribute, die die CLI mitschickt (`user.email`, `user.account_uuid`, `organization.id`),
werden nicht gespeichert.

---

## D7: Traces ausserhalb des Umfangs

**Entscheidung** (Nutzerentscheidung 2026-07-27): Kein Traces-Exporter, keine Span-Auswertung.
`OTEL_TRACES_EXPORTER` bleibt ungesetzt, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` wird nicht
aktiviert.

**Begründung**: Für Tokens, Kosten und den Subagenten-Anteil liefern Spans nichts, was
`api_request` nicht schon trägt. Sie hängen an einem Beta-Schalter der CLI und vervielfachen
das Datenvolumen.

---

## D8: Nachlauffenster und Endgültigkeit (FR-011/FR-012)

**Entscheidung**: Ein abgeschlossener Lauf bleibt **5 Minuten** aufnahmebereit; danach ist
seine Zahl endgültig und später eintreffende Ereignisse für diesen Lauf werden verworfen.
Jede nachträgliche Verrechnung aktualisiert den Lauf und meldet ihn über den bestehenden
Ereignisbus an die Oberfläche.

**Begründung**: Die reale Verzögerung ist klein — Exportintervall 5 s, plus ein Flush beim
Prozessende (im Bundle: `flushTelemetry`, Zeitlimit über `CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS`).
5 Minuten sind gegenüber 5 Sekunden reichlich Sicherheitsabstand und zugleich der von der Spec
gesetzte Wert (FR-012, SC-005).

**Speicherbegrenzung (FR-030)**: Ereignisse ohne zuordenbaren Lauf werden in einem Puffer je
Session gehalten, der zeitlich (dasselbe 5-Minuten-Fenster) und in der Anzahl gedeckelt ist;
ein periodischer Kehraus entfernt Puffer beendeter Sessions. Nichts davon wird persistiert.

---

## D9: Vorrang und Rückfallebene (FR-014 bis FR-016)

**Entscheidung**: Beim Abschluss eines Laufs wird zuerst die Telemetrie befragt. Liegen
Ereignisse vor, gewinnt sie und die Transkript-Messung wird für diesen Lauf **gar nicht erst
ausgeführt**. Liegen keine vor, läuft `orchestrator.meterTurn` unverändert wie heute.

**Begründung**: Nicht-Addieren (FR-016) ist so eine strukturelle Eigenschaft und keine Regel,
die man einhalten muss — es gibt nur einen Schreibpfad je Lauf. Der bestehende
Regressionstest zur Startmarke (`transcriptOffsetAtTimestamp.test.ts`) bleibt unangetastet,
die Rückfallebene wird nicht abgebaut (Annahme der Spec).

Neue Herkunftsstufe: `telemetry` — über den bestehenden `transcript` / `parsed` / `estimated`
(`ExecutionRecord.tokensSource`, `costBreakdown.TokensSource`, `runSummary.sourceMix`).

**FR-025 (Bestandsdaten)**: Rein additive Spalten mit `NULL` als Vorgabe. Altläufe behalten
`tokensSource='transcript'` und bekommen keinen Betrag — sie werden nicht angefasst.

---

## D10: Kosten in der Oberfläche

**Entscheidung** (Nutzerentscheidung 2026-07-27): Gemeldete Beträge werden angezeigt, deutlich
als „gemeldet" gekennzeichnet.

**Begründung**: Der Grund der Entfernung vom 26.07. (`specs/kosten-aus-laeufe-entfernen`) war
ausdrücklich, dass die Zahl **geschätzt** und von niemandem überprüfbar war — „Der Weg dahin
ist, sie zu entfernen, nicht sie zu kennzeichnen." Für eine von der CLI selbst gemeldete Zahl
trifft die Begründung nicht mehr zu. Die Entfernung bleibt für geschätzte Beträge bestehen:
FR-022 verbietet jede eigene Preistabelle, FR-023 verbietet Ersatzwerte, FR-024 verlangt, bei
Summen auszuweisen, wie viele Läufe keinen Betrag beitragen.

`costMeter.ts` behält seine Rolle für die Token-**Schätzung** der Rückfallebene; eine
Preistabelle existiert im Projekt ohnehin nicht und wird nicht eingeführt.

---

## Offene Punkte

Keine. Alle drei `NEEDS CLARIFICATION` der Spec sind entschieden (D10, D5, D7); alle
technischen Annahmen sind am installierten Binary belegt.

Ein Punkt ist bewusst in die Umsetzung verschoben und dort abgesichert: die Rangfolge
`settings.json`-`env` gegenüber Prozessumgebung (D5) — mit gebautem Ausweichweg.
