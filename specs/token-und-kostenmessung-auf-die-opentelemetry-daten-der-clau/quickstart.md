# Quickstart — Prüfszenarien

Ausführbare Belege, dass das Feature wirkt. Je Szenario: Aufbau, Durchführung, erwartetes
Ergebnis. Keine Implementierungsdetails — die stehen in [plan.md](./plan.md) und
[data-model.md](./data-model.md).

---

## ⚠️ Prozessregel für dieses Repo

Aus `CLAUDE.md`: **Niemals** `pkill -f` / `killall` mit unspezifischen Mustern (`vite`, `node`,
`tsx`, `pnpm`). Dieses Repo ist das SDD-Toolkit selbst; während der Arbeit läuft eine
Toolkit-Instanz, und die eigene Session ist ein Kindprozess davon. Ein generisches `pkill`
reisst den Server und damit die eigene Arbeit mit runter — am 26.07.2026 zweimal passiert.

Testinstanzen deshalb nur gezielt abräumen:

```sh
lsof -ti:4899 | xargs -r kill        # nur die eigene Testinstanz
kill "$MEINE_PID"                     # PID beim Start gemerkt
```

Für eigene Instanzen freie Ports nehmen — **nicht** 4820/4830, die gehören der laufenden
Toolkit-Instanz.

---

## Voraussetzungen

```sh
pnpm install
claude --version        # ≥ 2.1.220 verifiziert; ältere CLIs → Szenario 8
```

---

## Basisprüfungen

```sh
pnpm typecheck          # alle drei Pakete
pnpm test               # Vitest je Paket
```

**Erwartet**: grün, einschliesslich des bestehenden Regressionstests zur Startmarke
(`packages/server/src/pty/transcriptOffsetAtTimestamp.test.ts`). Der Test darf **nicht**
angepasst werden — er sichert die Rückfallebene, die erhalten bleibt (FR-015).

---

## Szenario 1 — Ereignisse kommen an und tragen unsere Marke *(Grundlage)*

Belegt den Empfangsweg isoliert, ohne Toolkit-Server.

```sh
# Empfänger auf freiem Port, PID merken
node -e '
  const {createServer}=require("http");let n=0;
  createServer((q,s)=>{let b=[];q.on("data",c=>b.push(c));q.on("end",()=>{
    const t=Buffer.concat(b).toString();
    for (const rl of (JSON.parse(t).resourceLogs??[]))
      for (const sl of rl.scopeLogs)
        for (const r of sl.logRecords)
          if (r.body?.stringValue==="claude_code.api_request") {
            const a=Object.fromEntries(r.attributes.map(x=>[x.key,Object.values(x.value)[0]]));
            console.log(++n, a["sdd.session.id"], a.model, a.request_id, a.query_source,
                        a.input_tokens, a.output_tokens, a.cost_usd_micros);
          }
    s.writeHead(200,{"content-type":"application/json"});s.end("{}");});
  }).listen(4899,"127.0.0.1",()=>console.error("probe 4899"));' &
PROBE=$!; echo "PROBE=$PROBE"

CLAUDE_CODE_ENABLE_TELEMETRY=1 \
OTEL_LOGS_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_PROTOCOL=http/json \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4899 \
OTEL_LOGS_EXPORT_INTERVAL=1000 \
OTEL_RESOURCE_ATTRIBUTES=sdd.session.id=probe-1 \
  claude -p "Sag nur das Wort OK" --output-format text

sleep 6
kill $PROBE          # nur die eigene Probe
```

**Erwartet**: Mindestens eine Zeile mit `probe-1`, einem Modellnamen, einer `req_…`-ID, allen
vier Token-Zahlen und einem Betrag in Mikro-USD.

**Deckt ab**: FR-001, FR-002, FR-008, FR-021 · Vertrag
[otlp-receiver.md](./contracts/otlp-receiver.md)

---

## Szenario 2 — Fortgesetzte Session misst nur ihren eigenen Lauf *(US1 — der Kern)*

Das ist der Fall, in dem der 62-Mio.-Fehler entstand: Beim Start des Laufs ist die
Claude-Session noch nicht zugeordnet, die Startmarke musste aus Zeitstempeln erschlossen werden.

**Aufbau**
1. Toolkit auf einem freien Port starten (`SDD_PORT=4899 pnpm dev`), PID merken.
2. Ein Feature mit einer bestehenden, bereits benutzten Session öffnen — also eine Session
   fortsetzen, nicht neu anlegen.
3. Sicherstellen, dass die Session schon Verbrauch aus früheren Läufen enthält.

**Durchführung**: Einen kurzen Phasenlauf (1–2 min) starten und abwarten.

**Erwartet**
- Der Lauf trägt die Herkunft „von der CLI gemeldet".
- Der ausgewiesene Verbrauch enthält **keinen** Anteil früherer Läufe derselben Session.
- Gegenprobe: `/cost` in derselben Session bzw. die Summe der `api_request`-Ereignisse im
  Zeitfenster des Laufs weicht um < 5 % ab.
- Keine Abweichung um Grössenordnungen.

**Zusatzprüfung — Kontext-Reset mitten im Lauf (FR-007)**

Denselben Lauf mit aktivem Kontext-Reset wiederholen: im Optimierungs-Dial `compact` oder
`fresh` einstellen, sodass `launchPhase` vor dem Phasenprompt `/compact` bzw. `/clear` sendet.
Ein `/clear` erzeugt eine **neue** Claude-Session-ID.

**Erwartet**: Der Verbrauch **beider** Abschnitte — vor und nach dem Reset — gehört demselben
Lauf. Nichts geht verloren, nichts landet an einem anderen Lauf.

**Deckt ab**: US1 Szenarien 1 + 3, FR-002, FR-004, FR-007, FR-014 · SC-001

---

## Szenario 3 — Zwei Läufe nacheinander, keine Überschneidung *(US1)*

**Durchführung**: In derselben Session zwei Phasenläufe nacheinander abschliessen.

**Erwartet**
- Summe beider Läufe = für die Session insgesamt gemeldeter Verbrauch (< 5 % Abweichung).
- Kein Anteil erscheint in beiden Läufen (Stichprobe über `request_id`: keine ID doppelt).
- Verbrauch, der **zwischen** den Läufen entsteht (Nutzer tippt selbst), erscheint in keinem
  der beiden.

**Deckt ab**: US1 Szenario 2, FR-005, FR-006 · SC-004

---

## Szenario 4 — Nachgereichte Meldungen korrigieren den Lauf *(US1)*

**Durchführung**: Einen sehr kurzen Lauf (< 5 s) starten, sodass er endet, bevor das
Exportintervall (5 s) abgelaufen ist. Die Läufe-Ansicht offen lassen.

**Erwartet**
- Direkt nach dem Abschluss zeigt der Lauf noch keinen oder einen unvollständigen Verbrauch.
- Innerhalb weniger Sekunden aktualisiert sich die Zahl **ohne Zutun des Nutzers** (kein
  Neuladen).
- Nach 5 Minuten ändert sie sich nicht mehr.

**Deckt ab**: US1 Szenario 4, FR-011, FR-012 · SC-005

---

## Szenario 5 — Parallele Sessions und fremde Session *(US1)*

**Durchführung**
1. Zwei Features gleichzeitig bearbeiten, in beiden je einen Lauf.
2. **Parallel** in einem eigenen Terminal `claude` starten und dort etwas arbeiten — mit
   derselben Telemetrie-Konfiguration (Umgebungsvariablen aus Szenario 1, aber **ohne**
   `OTEL_RESOURCE_ATTRIBUTES`).

**Erwartet**
- Jeder Lauf trägt ausschliesslich den Verbrauch seiner eigenen Session.
- Der Verbrauch der fremden Session erscheint an **keinem** Lauf des Toolkits.

**Deckt ab**: US1 Szenarien 5 + 6, FR-003

---

## Szenario 6 — Subagenten zählen mit und sind getrennt sichtbar *(US2)*

**Durchführung**: Einen Lauf ausführen, der ausdrücklich Subagenten einsetzt (eine Phase, die
mehrere Agenten startet).

**Erwartet**
- Der ausgewiesene Verbrauch ist nachweislich höher als der reine Hauptagent-Anteil.
- Der Subagenten-Anteil ist getrennt ablesbar und beziffert.
- Gegenprobe: Ereignisse mit `query_source` beginnend mit `agent:` sind enthalten.

**Danach ein Lauf ohne Subagenten**: Es erscheint **kein** Subagenten-Anteil — kein leerer
Platzhalter, keine Null-Zeile.

**Und die Feature-Summe**: Sie ist die Summe der Einzelläufe **inklusive** Subagenten-Anteile.

**Deckt ab**: US2 Szenarien 1–4, FR-009, FR-010 · SC-003

---

## Szenario 7 — Herkunft ist ablesbar, Messanteil stimmt *(US3)*

**Durchführung**: Läufe beider Herkünfte nebeneinander betrachten (aus Szenario 2 und 8).

**Erwartet**
- Läufe mit Telemetrie tragen „von der CLI gemeldet", unterscheidbar von „gemessen" /
  „geparst" / „geschätzt".
- Die Lauf-Übersicht weist aus, welcher Anteil der Läufe aus welcher Quelle stammt.
- **Achtung, häufiger Fehler**: Die Kennzahl „% gemessen" darf nach dem Umstieg **nicht**
  einbrechen. Sie muss `telemetry + transcript` zählen, nicht nur `transcript`.
- Für einen Lauf, für den beide Quellen Daten hätten, gilt die Meldung der CLI; die
  Transkript-Zahl wird **nicht** zusätzlich addiert (Stichprobe: Verbrauch nicht ~doppelt).

**Deckt ab**: US3 Szenarien 1, 3, 4, FR-017, FR-018 · SC-009

---

## Szenario 8 — Ohne Telemetrie bleibt alles bedienbar *(US3 — Rückfallebene)*

**Durchführung**: Denselben Lauf einmal mit abgeschalteter Telemetrie ausführen — Port des
Empfängers blockieren oder den Empfang abschalten.

**Erwartet**
- Die Session **startet normal** und ist bedienbar; nichts blockiert, keine Fehlermeldung im
  Terminal.
- Der Lauf bekommt trotzdem eine Zahl — aus der bestehenden Transkript-Messung, mit der
  bisherigen Kennzeichnung.
- Der Nutzer wird erkennbar auf die inaktive Telemetrie hingewiesen, **mit Grund**.
- Die sichtbare Terminalausgabe ist unverändert — keine Diagnoseausgaben dazwischen.

**Deckt ab**: US3 Szenarien 2 + 5, FR-015, FR-019, FR-020, FR-029 · SC-006, SC-007

---

## Szenario 9 — Kosten stammen von der CLI *(US4)*

**Durchführung**: Einen Lauf ausführen und den ausgewiesenen Betrag mit dem vergleichen, den
die CLI für dieselbe Session nennt (`/cost`).

**Erwartet**
- Der Betrag entspricht dem gemeldeten und ist als **gemeldet** — nicht geschätzt —
  gekennzeichnet.
- Ein Lauf ohne gemeldeten Betrag zeigt **keinen** Betrag und keine Ersatzschätzung.
- Eine Feature-Summe summiert ausschliesslich gemeldete Beträge und weist aus, wie viele
  enthaltene Läufe keinen Betrag beitragen.
- Läufe aus der Zeit **vor** diesem Feature zeigen keinen rückwirkend errechneten Betrag.

**Gegenprobe im Code**: `grep -rn` nach einer Preistabelle (Preise je Modell/Token) in
`packages/` findet nichts. Kein Betrag in der Oberfläche stammt aus einer hinterlegten
Preisannahme.

**Deckt ab**: US4 Szenarien 1–4, FR-021 bis FR-025 · SC-008

---

## Szenario 10 — Datenschutz und Speicherbedarf

**Inhalte (FR-027/FR-028)**

Empfänger aus Szenario 1 so erweitern, dass er **jeden** eingehenden Rumpf roh mitschreibt.
Einen Lauf mit auffälligem Prompt-Text ausführen.

**Erwartet**
- Der Prompt-Text erscheint nirgends im Mitschnitt; `user_prompt` trägt `<REDACTED>`.
- Antworttexte und Werkzeug-Inhalte ebenso.
- Keine ausgehende Netzwerkverbindung ausser an `127.0.0.1`.
- In der Ablage stehen keine personenbezogenen Attribute (`user.email`, `user.account_uuid`,
  `organization.id`).

**Speicher (FR-030)**

Eine lange Session laufen lassen (> 30 min) mit Phasen, in denen kein Lauf aktiv ist.

**Erwartet**: Der Speicherbedarf des Servers wächst nicht fortlaufend. Ereignisse ohne
zugehörigen Lauf sammeln sich nicht unbegrenzt an.

---

## Abdeckungsübersicht

| Anforderung | Szenario |
|---|---|
| FR-001, FR-002 | 1, 2 |
| FR-003 | 5 |
| FR-004 | 2 |
| FR-005 | 3 |
| FR-006 | 3 |
| FR-007 | 2 (Kontext-Reset im Lauf) |
| FR-008 | 1, 2 |
| FR-009, FR-010 | 6 |
| FR-011, FR-012 | 4 |
| FR-013 | 1 |
| FR-014, FR-016 | 2, 7 |
| FR-015 | 8 |
| FR-017, FR-018 | 7 |
| FR-019, FR-020 | 8 |
| FR-021 – FR-024 | 9 |
| FR-025 | 9 |
| FR-026 | 2, 6, 9 (Phase, Review, Chat) |
| FR-027, FR-028 | 10 |
| FR-029 | 8 |
| FR-030 | 10 |
| SC-001 | 2 |
| SC-002 | 7 |
| SC-003 | 6 |
| SC-004 | 3 |
| SC-005 | 4 |
| SC-006 | 8 |
| SC-007 | 8 |
| SC-008 | 9 |
| SC-009 | 7 |
