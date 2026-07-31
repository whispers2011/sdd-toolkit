# Quickstart — Prüfen, dass der gemeinsame Kern trägt

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Datum**: 2026-07-31

Dieses Feature hat keine Oberfläche. Geprüft wird deshalb an drei Orten: der Testsuite, dem
Quellcode selbst (US4) und einem echten Chat-Turn gegen eine **eigene** Toolkit-Instanz.

## Voraussetzungen

```sh
node --version    # ≥ 22
pnpm --version    # 10.x
pnpm install
```

> **Prozesse nur gezielt beenden.** Dieses Repo ist das SDD-Toolkit selbst; deine Session ist ein
> Kindprozess der laufenden Instanz auf 4820/4830. `pkill -f vite`, `pkill -f tsx` oder
> `killall node` reissen sie mit — und dich. Eigene Testinstanz **immer** auf eigenen Ports,
> abgeräumt ausschliesslich über `lsof -ti:<eigener Port> | xargs kill`.

## Das Tor: die volle Suite

Nach **jedem** Umstellungsschritt, nicht nur am Ende (Assumption der Spec: die Umstellung darf in
Schritten erfolgen, solange nach jedem Schritt die Suite grün ist).

```sh
pnpm test        # vitest run in allen drei Paketen
pnpm typecheck   # tsc --noEmit in allen drei Paketen
```

**Erwartung**: beides ohne Fehler. Deckt **SC-006** und **FR-017** ab (alle bestehenden Tests
beider Pfade grün, ohne dass ihre Erwartungen angepasst wurden — erlaubt sind nur neue Tests für
die Verbesserungen, die der Chat neu erhält).

Schneller Durchlauf während der Arbeit:

```sh
pnpm --filter @sdd/server test -- run services/core
pnpm --filter @sdd/server test -- run services/chatWorkService services/orchestrator
```

---

## US1 — Ein Verbrauchs-Fix wirkt in beiden Pfaden (P1)

### 1.1 Gleiche Meldungen → gleiche Zahlen (SC-002, Szenarien 1 + 6)

```sh
pnpm --filter @sdd/server test -- run services/core/runMeter
```

Der Test speist **dieselben** Telemetrie-Ereignisse einmal über den Phasen-Weg
(`meter.finish`) und einmal über den Chat-Weg (`meter.openTurn` → `meter.closeTurn`) ein.

**Erwartung**: beide Läufe tragen identische `tokens`, `input/output/cache_read/cache_creation`,
identische `cost_micros`, dasselbe `model` und `tokens_source = 'telemetry'`. Abweichung 0.

### 1.2 Der Fall vom 28.07.2026 (SC-003)

Ereignis mit 7 016 059 Cache-Lese-Tokens, 45 096 Ausgabe-Tokens, 5 350 524 µ$ auf einen
Chat-Turn geben.

**Erwartung**: verbucht werden 7 175 597 Tokens und ein Betrag > 0 — nicht 94k Tokens und 0 $.
(Der bestehende Test `chatWorkService.test.ts:463` prüft genau diese Zahlen und muss ohne
Anpassung grün bleiben.)

### 1.3 Puffer überlebt den Kehraus (Szenario 2)

```sh
pnpm --filter @sdd/server test -- run telemetry/telemetryStore
```

**Erwartung**: Ein Chat-Turn, der 10 Minuten läuft, verbucht auch seine Meldungen aus der ersten
Minute. Ohne die Anmeldung fehlten sie — bei einem 33-Minuten-Lauf am 30.07.2026 waren das 83 %.

### 1.4 Zwei Turns derselben Session überlappen (Edge Case, FR-007a)

Ablauf im Test — siehe [contracts/telemetry-store.md](./contracts/telemetry-store.md):
Turn A anmelden, abschliessen; Turn B anmelden; Nachlauffenster von A läuft ab.

**Erwartung**: Turn B hat seine Meldungen noch. Vor der Änderung löschte das Fensterende von A
den Puffer der ganzen Session.

### 1.5 Monotonie (SC-004, Szenario 4)

Messen, Puffer leeren, erneut messen — in einer Reihe über mehrere Nachträge.

**Erwartung**: **0 Absenkungen**. Die zweite Messung liefert dieselbe Zahl wie die erste, nicht 0
und nicht `null`. Wird ein Nachtrag von `updateTelemetry` abgelehnt, steht der Grund im Log
(`[metering] … Nachtrag verworfen — …`) und die verbuchte Zahl bleibt.

### 1.6 Rückfallebenen (Szenario 5, Edge Case ohne Telemetrie)

**Erwartung**: Ohne Meldungen, aber mit Transkript → `tokens_source = 'transcript'`. Ohne beides
→ `'estimated'` (bestehender Test `chatWorkService.test.ts:476`). Ohne konfigurierten
Telemetrie-Speicher: kein Fehler, Kaskade fällt durch.

### 1.7 Turn-Dauer > 0 (Clarification 30.07.2026)

**Erwartung**: Ein Chat-Turn schreibt `finished_at − started_at > 0`. Heute sind es bei **allen
33** chat_work-Läufen exakt 0 ms.

Gegenprobe an der eigenen Instanz (siehe §Live unten):

```sh
sqlite3 "$SDD_DATA_DIR/sdd.db" \
  "SELECT id, finished_at - started_at AS dauer_ms, tokens, cost_micros, tokens_source
     FROM executions WHERE kind='chat_work' ORDER BY started_at DESC LIMIT 5;"
```

---

## US2 — Ein Session-Fix wirkt in beiden Pfaden (P2)

### 2.1 Kein Doppelstart, in beiden Pfaden (SC-005, Szenarien 1 + 2)

```sh
pnpm --filter @sdd/server test -- run services/core/sessionCore
```

Je Pfad **20 aufeinanderfolgende Versuche** mit je zwei gleichzeitigen Aufrufen, die
Worktree-Anlage künstlich um 10 ms verzögert (so wie im bestehenden Test
`chatWorkService.test.ts:511`).

**Erwartung**: 20 × genau ein Spawn, 20 × dieselbe Session-Kennung für beide Aufrufer. 0
Doppelstarts.

### 2.2 Tote Session-Kennung wird nicht fortgesetzt (Szenario 3)

**Erwartung**: In beiden Pfaden wird die gespeicherte Kennung verworfen **und** in der Tabelle
`sessions` genullt; das `argv` enthält kein `--resume`.

### 2.3 Laufende Session wird unverändert zurückgegeben (FR-016, Szenario 4)

**Erwartung**: kein zweiter Prozess, dieselbe `LiveSession`.

### 2.4 Fehlerbild bleibt beim Pfad (FR-005, Szenario 5)

**Erwartung**: Scheitert der Spawn, antwortet der Chat weiterhin mit
`ChatError(503, 'Session konnte nicht gestartet werden: …')`; der Phasen-Pfad wirft weiterhin
seinen rohen `Error`. Am HTTP-Rand:

```sh
curl -i -X POST http://127.0.0.1:$PORT/api/projects/<id>/chat/work/ensure
```

**Erwartung im Fehlerfall**: `HTTP/1.1 503` mit derselben Meldung wie vor der Umstellung.

---

## US3 — Eine Arbeitskopie entsteht nach einer Regel (P3)

### 3.1 Chat legt über denselben Weg an (Szenario 1)

**Erwartung**: Nach `ensure()` existiert `<dataDir>/worktrees/<projekt>-<id>/chat-<convId>` mit
Zweig `chat/<convId>` — angelegt über `ensureWorkspace`, nicht über einen eigenen Aufruf.

### 3.2 Verwaister Pfad heilt in beiden Pfaden (Szenario 2)

Von aussen entfernen und erneut anfordern:

```sh
rm -rf "$SDD_DATA_DIR/worktrees/<projekt>-<id>/chat-<convId>"
curl -s -X POST http://127.0.0.1:$PORT/api/projects/<id>/chat/work/ensure
```

**Erwartung**: Der Registry-Eintrag wird aufgeräumt, die Arbeitskopie neu angelegt, die Session
startet. Vor der Umstellung hatte nur der Phasen-Pfad diese Erholung.

### 3.3 Fehlerbild unverändert (Szenario 3)

**Erwartung**: Scheitert das Anlegen, antwortet der Chat mit
`ChatError(503, 'Arbeitskopie konnte nicht erstellt werden: …')`.

---

## US4 — Der nächste Fix findet nur eine Fundstelle (P3)

### 4.1 Der Wächter (SC-001, Szenarien 1–3)

```sh
pnpm --filter @sdd/server test -- run services/core/singleImplementation
```

**Erwartung**: grün. Der Test liest alle Quellen unter `packages/server/src` (ohne `*.test.ts`)
und lässt je Merkmal genau eine Fundstelle zu — Messkaskade, Doppelstart-Schutz, Anlage-Regel.
Die einzige Ausnahme ist `ptys.spawn` in `api/server.ts` (Projekt-Terminal, `kind: 'shell'`,
keine Claude-Session), mit Begründung in der Erlaubnisliste.

Gegenprobe von Hand:

```sh
grep -rn "selectEventsForWindow(\|buildClaudeArgv(\|worktrees.create(" \
  packages/server/src --include="*.ts" | grep -v "\.test\." | grep -v "src/services/core/"
```

**Erwartung**: nur die Definition in `pty/commandBuilder.ts` — sonst keine Zeile.

### 4.2 Die Stichprobe (SC-008)

Eine kleine Beispieländerung an einer der drei Aufgaben durchführen (z. B. das Nachtragsfenster
von 8 s auf 6 s) und zählen, wie viele Dateien geöffnet werden müssen.

**Erwartung**: **genau eine** (`services/core/runMeter.ts`). Änderung danach zurücknehmen.

**Durchgeführt am 31.07.2026** — Nachtragsfenster `attempt(8_000, false)` → `attempt(6_000, false)`:

```sh
grep -rn "8_000" packages/server/src --include="*.ts" | grep -v "\.test\."
# → keine weitere Fundstelle
```

Geöffnete Dateien: **1** (`packages/server/src/services/core/runMeter.ts`). Änderung
zurückgenommen. Vor der Umstellung wäre dieselbe Änderung an *keiner* zweiten Stelle möglich
gewesen — der Chat hatte gar kein Nachtragsfenster; man hätte es dort erst bauen müssen. Genau
das ist der Unterschied, den SC-008 misst.

---

## SC-007 — Die vier Verbesserungen vom 30.07.2026, abschliessend beantwortet

| # | Verbesserung | Status | Nachweis |
|---|---|---|---|
| 1 | `telemetryStore.hold`/`release` | im Chat wirksam | `telemetryStore.test.ts` → „Anmeldung ist zählend" (4 Tests, T1–T3); `runMeter.test.ts` → „gibt am Ende des Nachlauffensters frei statt zu löschen (M3, FR-007a)". Der Chat zieht die Anmeldung in `RunMeter.openTurn`. |
| 2 | Monotoner Akkumulator | im Chat wirksam | `runMeter.test.ts` → „Monotonie über beliebig viele Nachträge (SC-004)": 0 Absenkungen über eine Reihe mit beschnittenem Puffer. Chat und Phase laufen durch denselben Akkumulator (`RunMeter.measureFromTelemetry`). |
| 3 | Sperre gegen Integration bei schreibendem Agenten | ausgeschlossen | Chat-Zweige laufen nicht über die Merge-Queue — es gibt dort keine Integration zu sperren (spec.md, Out of Scope) |
| 4 | Zuordnungswächter `checkWorkWithoutRun` | ausgeschlossen | Der Chat verbucht atomar; es gibt nie ein offenes Lauffenster, das der Wächter prüfen könnte (FR-020). Festgenagelt durch `orchestrator.test.ts` → „schweigt für eine arbeitende Chat-Session — der Wächter bleibt feature-only (FR-020)". |

**Stand 31.07.2026**: 4 von 4 beantwortet, 0 offen.

---

## Live-Gegenprobe an einer eigenen Instanz

Nur, wenn ein echter Chat-Turn gegen echte Telemetrie geprüft werden soll. **Eigene Ports, eigenes
Datenverzeichnis** — die laufende Instanz auf 4820/4830 bleibt unangetastet.

```sh
export SDD_PORT=4899
export SDD_WEB_PORT=4898
export SDD_DATA_DIR="$HOME/.sdd-toolkit-probe"

pnpm --filter @sdd/server dev &
MEINE_PID=$!
```

1. Projekt anlegen, Projekt-Chat öffnen, eine Frage stellen, die den Agenten spürbar arbeiten
   lässt (mehrere Tool-Aufrufe).
2. Turn abwarten, dann die Läufe-Ansicht öffnen — oder direkt in der Datenbank nachsehen (Abfrage
   aus §1.7).

**Erwartung**: Der Lauf trägt `tokens_source = 'telemetry'`, einen Betrag > 0, ein Modell, alle
vier Token-Klassen und eine Dauer > 0. Nach ~8 Sekunden aktualisiert sich die Zahl noch einmal
nach oben (Nachtrag, FR-009) und sinkt dabei nie.

Abräumen — **nur die eigene Instanz**:

```sh
kill "$MEINE_PID"
lsof -ti:4899 | xargs -r kill
rm -rf "$HOME/.sdd-toolkit-probe"
```

### Stand 31.07.2026 — was durchgeführt wurde

**Durchgeführt**: Boot-Gegenprobe auf Port **4871** (4899 war von einer fremden Instanz belegt und
blieb unangetastet), eigenes Datenverzeichnis `~/.sdd-toolkit-probe-oyhw`, abgeräumt über die
gemerkte PID. Ergebnis:

- Der Server startet mit der neuen Verdrahtung fehlerfrei (`SessionCore` und `RunMeter` einmal
  aufgebaut, beiden Diensten mitgegeben; Boot-Reaper läuft). **0 Fehler im Log.**
- `GET /api/state` → 200.
- `POST /api/projects/<unbekannt>/chat/work/ensure` → **404** mit dem Fehlerbild des Chat-Pfads.
  Das belegt zugleich, dass die Auflösefunktion *innerhalb* des Doppelstart-Schutzes läuft und ihr
  Fehler den Aufrufer unverändert erreicht (FR-005, research.md D3).

**Nicht durchgeführt**: der echte Chat-Turn gegen echte Telemetrie. Er startet einen realen
Claude-Code-Prozess und verursacht reale Kosten — ein Seiteneffekt, der eine ausdrückliche
Entscheidung braucht. Die Zahlen, die er prüfen würde (`tokens_source`, Preis > 0, Modell, vier
Token-Klassen, Dauer > 0, Nachtrag nach ~8 s ohne Absenkung), sind durch die Tests in
`runMeter.test.ts` gedeckt; was der Live-Lauf zusätzlich zeigte, wäre das Zusammenspiel mit dem
echten OTLP-Exporter der CLI. **Offen — bei der nächsten echten Chat-Nutzung nachholen** (Abfrage
aus §1.7).

---

## Abnahme in einem Blick

| Kriterium | Wo geprüft |
|---|---|
| SC-001 je Aufgabe genau eine Implementierung | §4.1 |
| SC-002 gleiche Meldungen → gleiche Zahlen | §1.1 |
| SC-003 der Fall vom 28.07.2026 | §1.2 |
| SC-004 0 Absenkungen | §1.5 |
| SC-005 0 Doppelstarts in 20 Versuchen je Pfad | §2.1 |
| SC-006 Suite grün, Typen fehlerfrei | Das Tor |
| SC-007 4 von 4 beantwortet | eigener Abschnitt |
| SC-008 eine Datei je Änderung | §4.2 |
