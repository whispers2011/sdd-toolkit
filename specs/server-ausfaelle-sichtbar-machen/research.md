# Phase 0 — Research: Server-Ausfälle sichtbar machen

**Feature**: `specs/server-ausfaelle-sichtbar-machen` | **Datum**: 2026-07-30

Die Spezifikation enthält keine `[NEEDS CLARIFICATION]`-Marker. Offen waren dagegen die
Mechanismen, die der Checklisten-Vermerk ausdrücklich in den Plan verschiebt („die Wahl der
Mechanismen gehört in den Plan"). Dieses Dokument entscheidet sie.

---

## D1 — Ablage des Lebenszeichens: eigene Datei statt Datenbankzeile

**Entscheidung**: `~/.sdd-toolkit/heartbeat.json` (bzw. `$SDD_DATA_DIR/heartbeat.json`), geschrieben
über Temp-Datei + `renameSync` (atomarer Austausch), Inhalt einzeilig als JSON.

**Begründung**: Der Ausfall vom 30.07. traf einen Prozess, dessen SQLite-Verbindung mit ihm starb.
Die Datenbank läuft im WAL-Modus; ein hart abgebrochener Schreibvorgang ist zwar wiederherstellbar,
aber die Lückenerkennung muss **vor** `openDatabase()` verlässlich sein können und auch dann noch
etwas finden, wenn die Datenbankdatei beschädigt ist. Eine winzige, atomar ersetzte Datei ist die
robustere Basis. `rename(2)` ist auf APFS/HFS+ atomar — die Datei ist damit entweder vollständig
alt oder vollständig neu, nie halb geschrieben (deckt den Edge Case „Ausfall während des
Schreibens" ab; ein trotzdem unlesbarer Inhalt gilt als nicht vorhanden).

**Alternativen**:
- *Zeile in `settings`-Tabelle*: 30-Sekunden-Takt als DB-Schreibvorgang ist billig, aber der Wert
  wäre bei kaputter DB verloren und die Erkennung hinge an einer geöffneten Verbindung.
- *`mtime` einer Touch-Datei*: kein Platz für Instanzkennung und „gewollter Abgang"-Flag, und
  Zeitstempel-Auflösung/Zeitzonen sind unnötig fehleranfällig.
- *`process.uptime()`-Vergleich*: sagt nichts über die Zeit **ohne** Server aus.

## D2 — Taktabstand 30 s, Ausfallschwelle 90 s

**Entscheidung**: Takt 30 000 ms, Schwelle 90 000 ms — beide als benannte Konstanten im puren
Modul, per Parameter überschreibbar (Testbarkeit, FR-025).

**Begründung**: Direkt aus der Spec-Annahme übernommen. Drei ausgefallene Takte als Schwelle hält
Abstand zu Ereignisschleifen-Stau (langer synchroner Git-Aufruf, `better-sqlite3`-Transaktion) und
erfüllt SC-002 (Abweichung ≤ 90 s) exakt an der Obergrenze: der gemeldete Beginn ist das letzte
Lebenszeichen, es liegt höchstens einen Takt (30 s) vor dem realen Abbruch. Der `setInterval` wird
mit `unref()` versehen, damit er den Prozess nicht am Beenden hindert.

**Alternativen**: 10 s/30 s wurde verworfen — bei parallelen Rust-Builds (dem auslösenden Zustand!)
ist eine Verzögerung von mehr als 30 s plausibel, das erzeugte Phantom-Ausfälle.

## D3 — Erkennung läuft VOR dem bestehenden Start-Reaper

**Entscheidung**: `outageMonitor.detectOnBoot()` wird in `packages/server/src/index.ts` direkt nach
dem Aufbau der Repos aufgerufen — **vor** `orchestrator.reapOnBoot()`.

**Begründung**: `ExecutionRepo.reapOrphans()` setzt in einem Statement alle `status='running'` auf
`'orphaned'`. Danach ist nicht mehr feststellbar, welche Läufe zum Ausfallzeitpunkt liefen —
`orphaned` sammelt auch Altlasten früherer Starts. Die Zählung der betroffenen Läufe (FR-005) muss
den Bestand also vorher lesen. Der Reaper selbst bleibt unverändert (FR-008: bestehende
`run_interrupted`-Meldungen werden nicht angetastet).

**Alternativen**: `finished_at`-Fenster nachträglich auswerten — ungenau, weil `reapOrphans()`
`finished_at` auf die Startzeit des neuen Prozesses setzt und damit gerade die Information
zerstört, die gebraucht wird.

## D4 — Nicht-Wiederholung (FR-009) über Neuschreiben des Lebenszeichens

**Entscheidung**: Unmittelbar nach der Erkennung schreibt der Boot ein frisches Lebenszeichen mit
`clean: false` und der neuen Instanzkennung. Kein zusätzlicher „schon gemeldet"-Zustand.

**Begründung**: Der Ausfall ist definiert als Lücke zwischen letztem Lebenszeichen und Start.
Sobald der Start das Lebenszeichen überschreibt, existiert diese Lücke nicht mehr — ein weiterer
Start ohne zwischenzeitlichen Absturz findet ein frisches Lebenszeichen und meldet nichts. Das ist
derselbe Zustand wie im Normalbetrieb und braucht keinen zweiten Merker, der selbst wieder
verwaisen könnte. Zusätzlich greift die Dedup-Logik von `AttentionRepo.raise()` für den Fall, dass
eine offene Ausfallmeldung desselben Projekts noch steht.

## D5 — Zwei gleichzeitige Instanzen erzeugen keine Phantom-Ausfälle

**Entscheidung**: Kein Lock, keine PID-Prüfung. Jeder Takt schreibt `{ ts, instanceId, clean: false }`
vollständig neu.

**Begründung**: Solange **irgendeine** Instanz läuft, ist das Lebenszeichen frisch — Instanz B
findet beim Start keine Lücke. Setzt Instanz A beim geordneten Beenden `clean: true`, hebt der
nächste Takt von B das sofort wieder auf; die Lücke bliebe ohnehin unter der Schwelle. Der
Edge-Case-Anspruch der Spec ist „keine dauerhaften Phantom-Ausfälle" — das ist erfüllt, ohne
Sperrdatei-Mechanik einzuführen, die im Absturzfall selbst zum Problem wird (verwaiste Locks).
Die Instanzkennung im Protokoll macht einen Instanzwechsel im Nachhinein trotzdem lesbar.

## D6 — Abgangsprotokoll als JSONL neben der Datenbank

**Entscheidung**: `$SDD_DATA_DIR/operations.jsonl`, eine Zeile JSON je Ereignis, angehängt mit
`appendFileSync` (`flag: 'a'`, `mode: 0o600`).

**Begründung**: `process.on('exit')` erlaubt **ausschliesslich synchrone** Arbeit — asynchrone
Schreibvorgänge werden verworfen. `appendFileSync` ist damit die einzig zuverlässige Wahl im
Abgangspfad. JSON Lines ist gleichzeitig maschinell auswertbar und ohne Werkzeug lesbar (`tail`),
erfüllt also FR-015 („ohne laufenden Server lesbar") und die zeitliche Reihenfolge ergibt sich aus
der Anhänge-Semantik. Jeder Schreibvorgang liegt in `try/catch` und schluckt Fehler (FR-017) —
genau der Zustand „Platte voll" ist der, in dem das Feature gebraucht wird.

**Alternativen**: Tabelle in SQLite — scheidet aus, weil der Abgangseintrag geschrieben werden muss,
wenn die DB schon geschlossen ist (`shutdown()` ruft `db.close()` vor `process.exit(0)`), und weil
FR-015 Lesbarkeit ohne laufenden Server verlangt.

## D7 — Rotation beim Start statt bei jedem Anhängen

**Entscheidung**: Beim Serverstart einmal prüfen: überschreitet die Datei 1 MB, wird sie auf die
letzten 1000 Zeilen zurückgeschnitten (lesen, kürzen, atomar ersetzen). Kein Prüfen pro Eintrag.

**Begründung**: Es entstehen etwa 2–4 Einträge je Serverlauf. 1000 Zeilen sind Monate an Historie;
1 MB ist die harte Grenze gegen einen Fehlerfall, der in einer Schleife protokolliert. Eine Prüfung
je Anhängen würde den Abgangspfad (synchron, unter Zeitdruck) mit einem `stat` belasten, ohne dass
das etwas bringt.

## D8 — Anlässe des Abgangs und wer sie schreibt

**Entscheidung**: Fünf Anlässe, in dieser Zuständigkeit:

| Anlass | Ausgelöst durch | Schreibt | `clean` |
|---|---|---|---|
| `startup` | Serverstart | `outageMonitor.detectOnBoot()` | `false` |
| `shutdown` | SIGINT / SIGTERM / SIGHUP → bestehende `shutdown()` | ebenda, vor `db.close()` | `true` |
| `uncaught` | `uncaughtException` / `unhandledRejection` (Fatal-Guard) | im bestehenden Handler | unverändert |
| `exit` | `process.on('exit')` mit Rückgabewert | Once-Flag, falls noch kein Abgang geschrieben | unverändert |
| `silent` | nachgetragen beim nächsten Start (FR-014) | `detectOnBoot()` | — |

**Begründung**: SIGINT (Ctrl-C im Terminal) und SIGTERM (`kill`) laufen im Toolkit heute beide durch
denselben geordneten `shutdown()`-Pfad und sind damit beide „geordnetes Herunterfahren"; das
empfangene Signal wird im Eintrag mitgeführt, sodass Scenario US2-1 und US2-2 sich weiterhin
unterscheiden lassen. Der Fatal-Guard beendet den Prozess **nicht** (bewusste Entscheidung eines
früheren Features, siehe Kommentar in `index.ts`) — sein Eintrag ist deshalb kein Abgang, sondern
ein Vorfall; er bleibt trotzdem im Protokoll, weil er die Frage „selbst gestorben?" beantwortet.
Ein Once-Flag verhindert, dass `shutdown()` → `process.exit(0)` → `'exit'` zwei Abgänge schreibt.

**Alternativen**: SIGINT als „gewollt", SIGTERM als „von aussen abgeschossen" zu werten wurde
verworfen — beide durchlaufen denselben geordneten Pfad, die Unterscheidung wäre erfunden. Wer
sie braucht, liest das mitgeführte Signal.

## D9 — Freier Plattenplatz über `fs.statfs`

**Entscheidung**: `fs.promises.statfs(dataDir)` → `bavail * bsize`. Kein Unterprozess.

**Begründung**: In Node ≥ 18.15 vorhanden (`engines: node >= 22`), im Repo verifiziert:
`bsize 4096`, `bavail 44 718 304` → 183,17 GB. `bavail` (für Nicht-Root verfügbar) ist die für die
Warnung richtige Zahl, nicht `bfree`. Kein `df`-Aufruf, kein Parsing, keine Blockierung.

## D10 — Auslagerungsspeicher über `sysctl vm.swapusage`, sonst unbekannt

**Entscheidung**: Auf `darwin` `execFile('sysctl', ['-n', 'vm.swapusage'])` mit 2-s-Timeout; das
Parsen der Zeile ist eine reine, getestete Funktion. Auf allen anderen Plattformen bleibt die
Kennzahl `null`.

**Begründung**: Die Ausgabe ist stabil formatiert (verifiziert:
`total = 6144.00M  used = 4555.38M  free = 1588.62M  (encrypted)`). Node bietet keine
Swap-API — `os.freemem()` ist Arbeitsspeicher, nicht Auslagerung. Die Spec setzt macOS als
Betriebsplattform und verlangt sauberes Degradieren statt Raten (FR-022); `null` ist damit die
korrekte Antwort auf Linux/Windows, nicht ein Mangel. Der Aufruf ist asynchron und in `try/catch`
(FR-024).

**Alternativen**: `/proc/meminfo` zusätzlich zu lesen — bewusst weggelassen (YAGNI, keine
Linux-Nutzung), die reine Parser-Funktion macht das Nachrüsten später zum Einzeiler.

## D11 — Erhebung bedarfsgesteuert mit kurzem Cache statt Hintergrund-Timer

**Entscheidung**: `ResourceMonitor.snapshot()` erhebt bei Aufruf und cached 10 s. Das Web ruft
`GET /api/system/status` alle 20 s ab. Kein zusätzlicher `setInterval` im Server.

**Begründung**: FR-021 verlangt „höchstens 60 Sekunden alt" — 20 s Abruf + 10 s Cache ergibt
maximal 30 s Alter, mit Reserve. Ein Hintergrund-Timer würde auch dann messen, wenn niemand
hinschaut, und SC-008 (unter 1 % Prozessorlast im Leerlauf) unnötig belasten. Der Cache verhindert,
dass mehrere offene Browser-Tabs die Erhebung vervielfachen. Vorbild ist
`worktreeOverviewService.ts` (dort 2 s Cache gegen 5 s Polling).

## D12 — „Gleichzeitig arbeitende Features" aus laufenden Executions

**Entscheidung**: Anzahl verschiedener `feature_id` (bzw. `project_id` bei Chat-Läufen ohne Feature)
unter `executions WHERE status='running'`.

**Begründung**: Dieselbe Quelle, aus der die betroffenen Läufe eines Ausfalls gezählt werden
(Spec-Annahme: „die Zählung stützt sich auf denselben Bestand, den die bestehende Start-Bereinigung
schon auswertet"). Damit sagen Ausfallmeldung und Ressourcenanzeige dasselbe. Die Alternative — die
PTY-Sessionliste — kennt keine Läufe ohne Terminal und wäre eine zweite, abweichende Wahrheit.

## D13 — Anzeige des letzten Ausfalls aus dem Protokoll-Ende

**Entscheidung**: Beim Start liest `outageMonitor` die letzten Zeilen von `operations.jsonl` und
hält den jüngsten `outage`-Eintrag im Speicher; `GET /api/system/status` liefert ihn mit.

**Begründung**: FR-023 verlangt den letzten registrierten Ausfall auch dann, wenn er folgenlos war
(also keine Aufmerksamkeitsmeldung erzeugt hat) und auch dann noch, wenn die Meldung abgehakt wurde
(Edge Case „Erledigte Ausfallmeldung"). Die Attention-Tabelle taugt dafür nicht — sie wird geleert.
Das Protokoll ist die dauerhafte Quelle. Ein Lesevorgang beim Start genügt, weil sich der Wert
während eines Laufs nur einmal ändern kann: beim Start.

## D14 — `server_outage` als eigene Attention-Art, ausdrücklich nicht auto-auflösbar

**Entscheidung**: Neue `AttentionKind`-Variante `server_outage`. In `attentionReconciler.ts` bekommt
sie einen **expliziten** `case`, der `true` (immer gültig) zurückgibt, statt sich auf `default: true`
zu verlassen — mit Test.

**Begründung**: FR-007 verlangt eine eigene, erkennbare Art. Der Reconciler löst Meldungen auf,
deren Zustand nicht mehr aktiv ist; ein Ausfall ist ein Ereignis der Vergangenheit und hat keinen
„aktiven Zustand" — er darf nur vom Menschen erledigt werden. `default: true` würde das heute
zufällig richtig machen; ein expliziter Fall plus Test hält es richtig, wenn jemand später den
Default umdreht. Achtung auch bei `findStaleOnBoot()`: dort werden `awaiting_input` und
`agent_errored` pauschal als stale behandelt — `server_outage` darf dort nicht hineinrutschen.

## D15 — Ausfallzeitfenster nicht bestimmbar (Uhr springt rückwärts)

**Entscheidung**: Liegt das letzte Lebenszeichen in der Zukunft, liefert die Erkennung das Ergebnis
`undetermined`. Folge: **kein** Aufmerksamkeits-Item (das Fenster wäre erfunden), aber ein
Protokolleintrag `outage` mit `undetermined: true` und beiden Zeitstempeln.

**Begründung**: Die Spec verbietet ein negatives Fenster und verlangt die Behandlung als
„Zeitfenster nicht bestimmbar". Eine Meldung ohne Fenster wäre für den Nutzer wertlos und würde die
Inbox verrauschen; der Protokolleintrag bewahrt die Nachvollziehbarkeit. FR-026 verlangt genau
diesen Fall als Testfall.

## D16 — Reine Logik in `@sdd/shared`, Nebenwirkungen im Server

**Entscheidung**: Lückenerkennung, Dauerformatierung, Meldungstext und Schwellenbewertung liegen als
pure Funktionen in `packages/shared/src/` (`outage.ts`, `resourcePressure.ts`). Datei-, Uhr- und
Betriebssystemzugriffe liegen ausschliesslich in `packages/server/src/services/`.

**Begründung**: FR-025 verlangt die Lückenerkennung als „eigenständig prüfbare Einheit, deren
Verhalten ohne echten Serverabsturz mit gesetzten Zeitpunkten getestet werden kann" — genau das
Muster, das das Repo schon für `phaseMachine`, `actionPolicy`, `worktreeStatus` und
`lifecycleCatalog` verwendet: pures Modul in `shared`, dünner Aufrufer im Server. `now` wird als
Parameter übergeben, nie aus `Date.now()` innerhalb der reinen Funktion gelesen.

## D17 — Ort der Anzeige: Kopfleiste, Details beim Aufklappen

**Entscheidung**: Neue Komponente `SystemStatus.tsx` rechts in der Kopfleiste von `App.tsx`, neben
`ThemeToggle` und `AutomationDial`. Kompakt („813 MB · Swap 80 % · 3 parallel"), bei Warnstufe
eingefärbt, per Klick ein Aufklapp-Feld mit Einzelwerten, Erhebungszeitpunkt und letztem Ausfall.

**Begründung**: Spec-Annahme („bestehende Kopfleiste … unabhängig von Projekt und Ansicht
sichtbar"). Die Kopfleiste enthält bereits genau dieses Muster aus Icon-Schaltflächen. SC-007
verlangt, dass die Warnung sichtbar ist, **bevor** der Nutzer ein Feature startet — der
„Neues Feature"-Weg beginnt in der Seitenleiste, die Kopfleiste ist dabei im Blick.

## D18 — Meldungstext trägt die Details, Inbox-Zeile klappt auf

**Entscheidung**: Der Text der `server_outage`-Meldung enthält Fenster, Dauer, Zahl der betroffenen
Läufe und bis zu fünf Feature-Namen (darüber hinaus „+N weitere"). Die Inbox-Zeile bekommt für diese
Art einen Aufklapp-Schalter, der den Text vollständig statt abgeschnitten zeigt.

**Begründung**: Scenario US1-2 verlangt beim Öffnen Beginn, Ende, Dauer und die betroffenen
Features. Die Inbox schneidet Meldungstexte heute per `truncate` ab. Ein Aufklappen ist die
kleinste Änderung, die das Szenario erfüllt — ein eigener Detail-Endpunkt für Daten, die ohnehin im
Text stehen, wäre Aufwand ohne Zusatznutzen.

---

## Verifizierte Umgebungsannahmen

| Annahme | Prüfung | Ergebnis |
|---|---|---|
| `fs.statfs` in dieser Node-Version vorhanden | `node -e` im Repo | vorhanden, liefert `bsize`/`bavail` |
| `sysctl vm.swapusage` verfügbar und stabil formatiert | Aufruf auf der Zielmaschine | `total = 6144.00M  used = 4555.38M  free = 1588.62M  (encrypted)` |
| `reapOrphans()` zerstört die Laufzuordnung | `packages/server/src/db/repos.ts:573` | bestätigt — Erkennung muss davor laufen |
| Reconciler tastet unbekannte Arten nicht an | `attentionReconciler.ts:73` | `default: true`; wird durch expliziten Fall ersetzt |
| Kopfleiste hat einen Platz für Icon-Anzeigen | `packages/web/src/App.tsx:105-124` | bestätigt |
