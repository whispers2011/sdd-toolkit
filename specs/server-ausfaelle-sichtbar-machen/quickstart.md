# Quickstart — Server-Ausfälle sichtbar machen

Abnahmeleitfaden. Prüft die Success Criteria aus [spec.md](./spec.md) an einer eigenen
Testinstanz — **nicht** an der laufenden Toolkit-Instanz.

---

## ⚠️ Vor dem Start: Prozessregeln dieses Repos

Dieses Repo ist das SDD-Toolkit selbst. Während der Arbeit läuft eine Toolkit-Instanz auf den Ports
**4820/4830**, und die eigene Agent-Session ist ein Kindprozess dieses Servers.

- **Niemals** `pkill -f vite`, `pkill -f tsx`, `pkill -f node`, `killall node` — das reisst die
  laufende Instanz und damit die eigene Session mit (belegt am 26.07.2026, zweimal).
- Die Testinstanz läuft auf **eigenen Ports** und in einem **eigenen Datenverzeichnis**.
- Beendet wird ausschliesslich über den eigenen Port oder die gemerkte PID.

```sh
# Ports und Datenverzeichnis dieser Abnahme — einmal setzen, überall verwenden
export SDD_PORT=4899
export SDD_WEB_PORT=4898
export SDD_DATA_DIR="$TMPDIR/sdd-ausfall-abnahme"
```

---

## Voraussetzungen

```sh
pnpm install
pnpm typecheck        # muss grün sein, bevor irgendetwas gestartet wird
```

---

## Teil A — Automatisierte Tests (SC-009, FR-026)

Die Lückenerkennung wird ohne echten Serverabsturz geprüft; alle Zeitpunkte werden gesetzt.

```sh
pnpm --filter @sdd/shared test        # reine Erkennung, Dauerformat, Meldungstext, Schwellen
pnpm --filter @sdd/server test        # Lebenszeichen-Datei, Protokoll, Verdrahtung, Reconciler
```

**Erwartet**: grün, und die folgenden sechs Fälle aus FR-026 sind namentlich unter den Testfällen
zu finden:

| # | Fall | Erwartetes Verhalten | Contract |
|---|---|---|---|
| 1 | Ausfall mit betroffenen Läufen | `kind: 'outage'`, Fenster und Zahl stimmen | [C1.5](./contracts/outage-detection.md) |
| 2 | gewollter Abgang | kein Ausfall, auch nach Tagen | [C1.2](./contracts/outage-detection.md) |
| 3 | Erststart ohne Lebenszeichen | kein Ausfall | [C1.1](./contracts/outage-detection.md) |
| 4 | Ausfall ohne betroffene Läufe | Protokolleintrag, **keine** Meldung | [C4.2](./contracts/attention-item.md) |
| 5 | Uhr springt rückwärts | `undetermined`, kein negatives Fenster, keine Meldung | [C1.4](./contracts/outage-detection.md) |
| 6 | wiederholter Start nach gemeldetem Ausfall | keine zweite Meldung | [C4.4](./contracts/attention-item.md) |

Zusätzlich muss ein Test die **Startreihenfolge** festhalten: die betroffenen Läufe werden gelesen,
bevor `reapOnBoot()` sie auf `orphaned` setzt (siehe
[contracts/attention-item.md](./contracts/attention-item.md), Abschnitt „Reihenfolge beim Start").
Ohne diesen Test bleibt der wahrscheinlichste Regressionsfehler unbemerkt.

---

## Teil B — Abnahme am laufenden Server (SC-001 bis SC-005)

### B1 — Testinstanz starten

```sh
rm -rf "$SDD_DATA_DIR" && mkdir -p "$SDD_DATA_DIR"
pnpm dev &                 # nutzt SDD_PORT/SDD_WEB_PORT/SDD_DATA_DIR aus der Umgebung
SERVER_PID=$!              # PID merken — das ist der einzige zulässige Abschaltweg neben dem Port
```

Oberfläche: `http://127.0.0.1:4898`. Ein Projekt hinzufügen und ein Feature starten, sodass
mindestens ein Lauf **arbeitet**.

**Erwartet**:

```sh
cat "$SDD_DATA_DIR/heartbeat.json"          # {"ts":…,"instanceId":"…","clean":false,"startedAt":…}
cat "$SDD_DATA_DIR/operations.jsonl"        # eine Zeile kind:"startup"
```

Nach 30 s: `ts` in `heartbeat.json` ist gewachsen.

### B2 — Harter Abbruch (die geforderte Abnahme)

```sh
lsof -ti:4899 | xargs kill -9               # nur die eigene Testinstanz
```

**Erwartet**: kein neuer Eintrag in `operations.jsonl` — ein `kill -9` kann nichts mehr schreiben.
Genau das ist der Zustand vom 30.07.2026.

### B3 — Neustart

Zwei Minuten warten (über der 90-s-Schwelle), dann neu starten wie in B1.

**Erwartet** (SC-001, SC-002):

- In „Braucht dich" steht innerhalb einer Minute nach dem Start eine Meldung
  **🕳 Server-Ausfall** — „Server war zwischen HH:MM und HH:MM unerwartet weg (2 min) — N Läufe
  betroffen: …".
- Der gemeldete Beginn liegt höchstens 90 s vor dem tatsächlichen `kill -9` (SC-002).
- Die Zeile lässt sich aufklappen; Beginn, Ende, Dauer und die betroffenen Features sind lesbar
  (US1-2).
- `operations.jsonl` enthält einen Eintrag `kind:"outage"` mit `"silent":true` (SC-005, FR-014).
- Bestehende „⏸ Lauf unterbrochen"-Meldungen stehen weiterhin daneben (FR-008, US1-7).

### B4 — Gegenprobe: geordnetes Herunterfahren

```sh
kill -INT "$SERVER_PID"                     # oder Ctrl-C im Vordergrund
```

**Erwartet**:

- `operations.jsonl`: Eintrag `kind:"shutdown"`, `"signal":"SIGINT"`, mit `uptimeMs` (US2-1).
- `heartbeat.json`: `"clean": true` (FR-002).
- Neustart nach beliebig langer Pause → **keine** Ausfallmeldung (SC-003, US1-3).

### B5 — Abbruchsignal von aussen

Instanz starten, dann `kill -TERM "$SERVER_PID"`.
**Erwartet**: Eintrag mit dem empfangenen Signal `SIGTERM` (US2-2).

### B6 — Kein Doppeleintrag, keine Doppelmeldung

Nach B4 erneut starten und wieder geordnet beenden.
**Erwartet**: je Instanz genau **ein** Abgangseintrag (C2.2) und keine wiederholte Ausfallmeldung
für denselben Ausfall (SC-003, FR-009).

### B7 — Protokoll ohne laufenden Server lesen (FR-015)

```sh
tail -5 "$SDD_DATA_DIR/operations.jsonl"
```

**Erwartet**: lesbar, zeitlich sortiert, `instanceId` verbindet `startup` und Abgang je Instanz
(US2-5).

### B8 — Schreibfehler bleiben folgenlos (US2-6, FR-017)

Geprüft werden muss der Fehlschlag **dieses Features**, nicht der der Datenbank. Ein
`chmod a-w "$SDD_DATA_DIR"` taugt dafür nicht: dann scheitert schon `openDatabase()` mit
`SQLITE_READONLY_DIRECTORY` (`index.ts:42`) — noch bevor eine Zeile dieses Features läuft. Das ist
eine bestehende Eigenschaft des Toolkits und sagt über die Betriebsspuren nichts aus.

Deshalb bleibt die Datenbank schreibbar, und nur die beiden Zieldateien werden unbeschreibbar
gemacht — als Verzeichnis angelegt schlagen `appendFileSync` und `renameSync` mit `EISDIR` fehl:

```sh
mv "$SDD_DATA_DIR/operations.jsonl" /tmp/ops.bak; mv "$SDD_DATA_DIR/heartbeat.json" /tmp/hb.bak
mkdir -p "$SDD_DATA_DIR/operations.jsonl" "$SDD_DATA_DIR/heartbeat.json"
# Instanz starten, > 30 s laufen lassen (ein Takt muss fehlschlagen), geordnet beenden
rmdir "$SDD_DATA_DIR/operations.jsonl" "$SDD_DATA_DIR/heartbeat.json"
mv /tmp/ops.bak "$SDD_DATA_DIR/operations.jsonl"; mv /tmp/hb.bak "$SDD_DATA_DIR/heartbeat.json"
```

**Erwartet**: Der Server startet, antwortet auf `/api/system/status` und `/api/attention` mit `200`,
übersteht mindestens einen fehlgeschlagenen Takt und beendet sich normal. Keine Ausnahme auf der
Konsole, keine Fehlermeldung, die den Betrieb stoppt.

Den schreibgeschützten **Ordner** decken die Unit-Tests ab (C2.5, FR-011) — dort ohne Datenbank.

---

## Teil C — Ressourcenanzeige (SC-006, SC-007)

### C1 — Sichtbarkeit

Oberfläche öffnen, in die Kopfleiste rechts schauen.

**Erwartet** (US3-1, US3-3): freier Platz, Swap-Auslastung und — ab zwei arbeitenden Features —
deren Zahl, ohne Terminal ablesbar. Aufklappen zeigt die Einzelwerte und den Erhebungszeitpunkt.

```sh
curl -s "http://127.0.0.1:4899/api/system/status" | python3 -m json.tool
```

**Erwartet**: Antwortform wie in [contracts/system-status-api.md](./contracts/system-status-api.md);
`collectedAt` höchstens 30 s alt (FR-021, SC-006).

### C2 — Warnschwelle

Schwellen testweise anheben (in `packages/shared/src/resourcePressure.ts`) und neu laden. **Beide**
anheben, und `DISK_WARN_BYTES` unter `DISK_NOTICE_BYTES` lassen — bei 169 GB freiem Platz etwa
`DISK_NOTICE_BYTES = 300 * 1024 ** 3` und `DISK_WARN_BYTES = 200 * 1024 ** 3`. Nur `DISK_WARN_BYTES`
allein anzuheben kehrt die Schwellen um; dann ist die Stufe `warn`, aber keine der Lagen mahnt und
der Hinweis ist folgerichtig `null` (siehe `hinweis()`). Das ist kein Fehler, taugt aber nicht als
Vorführung.

**Erwartet** (US3-2, FR-020, SC-007): Die Anzeige ist deutlich als Warnung gekennzeichnet und nennt
den verbleibenden Platz. Bei gleichzeitig arbeitenden Features erscheint der zusammengesetzte
Hinweis, etwa „3 Features parallel, Swap 80 %, 813 MB frei" (US3-4). Schwelle danach zurücksetzen.

### C3 — Nicht ermittelbare Kennzahl

Auf einer Nicht-macOS-Umgebung oder mit testweise abgeklemmtem `sysctl`-Aufruf prüfen.

**Erwartet** (US3-5, FR-022): Swap erscheint als `–`, Plattenplatz und Feature-Zahl bleiben
sichtbar. Keine geratene Zahl.

### C4 — Letzter Ausfall in der Anzeige

Nach Teil B die Aufmerksamkeitsmeldung mit ✓ erledigen, dann die Systemanzeige aufklappen.

**Erwartet** (US3-6, FR-023, C3.4): Der letzte registrierte Ausfall steht dort weiterhin mit
Zeitfenster — auch nachdem die Meldung abgehakt wurde und auch, wenn er folgenlos war.

---

## Teil D — Last (SC-008)

```sh
# Testinstanz im Leerlauf, 60 s beobachten
top -pid "$SERVER_PID" -l 6 -stats pid,cpu,command
```

**Erwartet**: Prozessorlast im Mittel unter 1 %. Der Serverstart verlängert sich um höchstens
200 ms — messbar über den Zeitstempelabstand zwischen dem `startup`-Eintrag in
`operations.jsonl` und der Zeile „sdd-toolkit Server läuft auf …" auf der Konsole.

---

## Aufräumen

```sh
lsof -ti:4899 | xargs kill        # nur die eigene Testinstanz — NIE pkill mit generischem Muster
rm -rf "$SDD_DATA_DIR"
```

Prüfen, dass die reguläre Toolkit-Instanz auf 4820/4830 unberührt weiterläuft:

```sh
lsof -ti:4820 >/dev/null && echo "Toolkit läuft weiter — gut"
```

---

## Abdeckungsübersicht

Rechte Spalte: Befund der Abnahme vom 30.07.2026 (Instanz auf 4897/4896, Node 22).

| Success Criterion | Geprüft in | Befund |
|---|---|---|
| SC-001 Meldung binnen einer Minute nach Neustart | B3 | je betroffenem Projekt eine Meldung, ~13 s nach dem Start |
| SC-002 Beginn höchstens 90 s daneben | B3 | gemeldeter Beginn 24 s vor dem tatsächlichen `kill -9` |
| SC-003 geordnetes Herunterfahren meldet nie | B4, B6 | 124 s Pause nach `SIGINT` → kein Ausfall |
| SC-004 Ausfall allein aus Betriebsdaten rekonstruierbar | B3, B7, C4 | `operations.jsonl` ohne Server lesbar, `lastOutage` in der API |
| SC-005 je Abgang ein Eintrag, stiller Abgang nachgetragen | B2–B6 | genau ein Abgang je Instanz; `silent:true` nur für die `kill -9`-Instanz |
| SC-006 Kennzahlen ohne Terminal, ≤ 60 s alt | C1 | Kopfleiste lesbar, `collectedAt` 0,1 s alt |
| SC-007 Warnung vor dem Start eines weiteren Features | C2 | Kopfleisten-Feld rot mit ⚠, Hinweis nennt den Restplatz |
| SC-008 keine spürbare Zusatzlast | D | 0,0 % Prozessorlast über 60 s; Startverzögerung 47 ms |
| SC-009 automatisierte Tests der Lückenerkennung | A | 440 Tests `@sdd/shared`, 597 `@sdd/server`, grün |

Die sechs Fälle aus FR-026 sind alle **namentlich** unter den Testfällen:

| # | Fall | Testfall |
|---|---|---|
| 1 | Ausfall mit betroffenen Läufen | `outage.test.ts` — „C1.5 / FR-026 …" |
| 2 | gewollter Abgang auch nach Tagen | `outage.test.ts` — „C1.2 / FR-026 …" |
| 3 | Erststart ohne Lebenszeichen | `outage.test.ts` — „C1.1 / FR-026 …" |
| 4 | Ausfall ohne betroffene Läufe | `outageMonitor.test.ts` — „FR-026 … KEINE Meldung (C4.2)" |
| 5 | Uhr springt rückwärts | `outage.test.ts` — „C1.4 / FR-026 …" |
| 6 | wiederholter Start nach gemeldetem Ausfall | `outageMonitor.test.ts` — „FR-026 … keine zweite Meldung (C4.4)" |

Die Startreihenfolge hält `outageMonitor.test.ts` doppelt fest: einmal als Zusicherung und einmal
als Gegenprobe („vertauschte Reihenfolge zählt null betroffene Läufe").

**Keine Lücke offen.** Für die Abnahme wurden laufende Läufe direkt in der Testdatenbank angelegt
(zwei Projekte, drei Features, ein Chat-Lauf ohne Feature), weil der Meldepfad sonst nur mit echten
Agent-Läufen erreichbar wäre.
