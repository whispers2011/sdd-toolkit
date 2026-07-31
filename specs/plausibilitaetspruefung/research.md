# Phase 0 — Research: Plausibilitätsprüfung gemessener Läufe

**Datum**: 2026-07-30 · **Basis**: Arbeitsstand `feature/plausibilitaetspruefung` (HEAD `7b1c6ce`)

Alle Zahlen unten sind an der **laufenden Datenbank** erhoben
(`~/.sdd-toolkit/sdd-toolkit.sqlite`, Kopie vom 30.07.2026 16:54, WAL eingespielt, nur gelesen).
Keine Zahl ist aus der Spezifikation übernommen — zwei davon widersprechen ihr, siehe D8.

Die Spezifikation enthält keine `[NEEDS CLARIFICATION]`-Marker. Die hier geführten Entscheidungen
schließen die **technischen** Lücken, die die Spezifikation absichtsvoll offen lässt (Ort der
Prüfung, Endgültigkeitskriterium, Speicherung der Quittierung).

---

## D1: Ein einziger Prüfpfad für Laufabschluss und Bestand

**Entscheidung**: FR-001 (beim Laufabschluss) und FR-002 (Bestand beim Start und im Intervall)
werden von **derselben Funktion** `PlausibilityService.check(now)` bedient. Der Laufabschluss
ruft keine eigene Einzelfall-Logik, sondern dieselbe vollständige Beurteilung.

**Begründung**: FR-013/FR-014 verlangen „höchstens eine offene Meldung je Befund und
Bezugsobjekt" und „keine Wiederkehr bei unverändertem Bestand". Zwei Pfade (Einzellauf vs.
Bestand) müssten diese Invariante *beide* einhalten und könnten auseinanderlaufen — genau der
Fehler, der laut Memory-Notiz im Toolkit schon einmal auftrat (Orchestrator-Pfad gefixt,
Chat-Pfad blieb zurück). Mit einem Pfad ist SC-004 („zehn Prüfungen ⇒ nicht mehr Meldungen als
eine") eine strukturelle Eigenschaft und keine Regel, die zweimal eingehalten werden muss.

Ein Einzellauf-Pfad wäre ohnehin nicht kürzer: Befund A und B melden **je Bezugsobjekt mit
Anzahl** (FR-015), müssten also auch beim Einzellauf den ganzen Bestand des Projekts bzw.
Features zählen.

**Kosten**: Die Prüfung liest alle abgeschlossenen Läufe. Heute sind das **254 Zeilen** — die
Beurteilung ist reine Arithmetik über eine kleine Liste, im Millisekundenbereich. Der Deckel:
ab etwa 10⁵ Läufen lohnt ein SQL-Vorfilter (`finished_at IS NOT NULL AND cost_micros IS NULL`).
Bis dahin wäre er vorgezogene Optimierung.

**Alternativen**: (a) Einzellauf-Prüfung mit inkrementellem Zähler — verworfen, weil der Zähler
ein zweiter Wahrheitsort neben der Tabelle wäre; (b) nur Intervallprüfung ohne Kopplung an den
Laufabschluss — verworfen, weil FR-001 die Beurteilung ausdrücklich an die Endgültigkeit der
Messung bindet, nicht an einen Uhrzeittakt.

## D2: Endgültigkeit = Ende des bestehenden Nachtragsfensters, aus zwei Quellen

**Entscheidung**: Die Messung eines Laufs gilt als endgültig, wenn **beides** zutrifft:

```
finishedAt !== null  &&  now - finishedAt >= TELEMETRY_GRACE_MS
                     &&  (telemetryFinalAt === null || telemetryFinalAt <= now)
```

`TELEMETRY_GRACE_MS` (5 min) wird **nicht kopiert**, sondern aus
`packages/server/src/telemetry/telemetryStore.ts` importiert und als Parameter in das pure
Modul gegeben.

**Begründung**: Das Feld `telemetry_final_at` existiert erst seit dem Telemetrie-Feature und ist
nur bei **40 von 254** Läufen gesetzt — für Bestandsläufe (also für die 171 des Befunds A) ist es
`NULL`. Eine Prüfung nur auf `telemetry_final_at` würde den gesamten Bestand entweder übergehen
oder sofort als endgültig ansehen. Die Zeitrechnung über `finished_at` deckt beide Fälle mit
derselben Regel; `telemetry_final_at` bleibt als **zusätzliche** Sperre wirksam, weil es der
Orchestrator bewusst nicht mitwandern lässt (Kommentar an `updateTelemetry`, FR-012 des
Telemetrie-Features).

Das erfüllt US1-Szenario 4 (verspäteter Betrag innerhalb des Fensters ⇒ keine Meldung) ohne
eigenes Zeitfenster: es ist exakt dasselbe Fenster, das die Nachträge nutzen.

**Alternativen**: Eigenes Plausibilitäts-Fenster — verworfen, zwei Fenster driften auseinander.
Prüfung im Moment des Prozessendes — laut Spezifikation (Assumption) bei Befund A fast immer
falsch positiv; bestätigt durch die Daten: **3 der 40** Läufe mit gesetztem
`telemetry_final_at` haben keinen Preis, die anderen 37 bekamen ihn nachgetragen.

## D3: Der Aufhängepunkt ist das letzte Nachtrags-Timeout

**Entscheidung**: Der Laufabschluss-Trigger sitzt in `Orchestrator.scheduleLateReconcile()` im
`last`-Zweig — dem Timer, der bei `TELEMETRY_GRACE_MS` feuert und heute schon den Puffer
abmeldet. Dort steht der Lauf exakt im Moment seiner Endgültigkeit.

**Begründung**: `scheduleLateReconcile` läuft für **jeden** Phasenlauf, auch für abgebrochene und
fehlgeschlagene (`handleExit` → `finishWithMetering` → `scheduleLateReconcile`, ohne Bedingung).
Ein Fehlstart nach 2 s erreicht diesen Punkt also genauso wie ein Lauf über eine Stunde.

Läufe anderer Art (`verify`, `review`, `merge`, `chat`, `chat_work`) werden über
`executions.finish()` abgeschlossen und haben kein Nachtragsfenster — sie erreichen den Trigger
nicht und fallen der Intervallprüfung zu (≤ 60 s später, ihre Endgültigkeit liegt ohnehin 5 min
nach dem Abschluss). Ein zweiter Trigger in `finish()` wäre möglich, brächte aber nichts:
zum Zeitpunkt von `finish()` ist **kein** Lauf endgültig.

**Nebenwirkung, bewusst in Kauf genommen**: Ein Fehlstart (Befund B) ist bereits im Moment des
Abschlusses erkennbar — Laufzeit und Exitcode stehen fest, auf einen Nachtrag muss niemand
warten. Er erscheint trotzdem erst 5 min später, weil es nur einen Trigger gibt (D1). Die
Spezifikation deckt das ausdrücklich: „die Befunde sind nicht zeitkritisch".

**FR-003 (Beurteilung ist kein Tor)**: Der Aufruf steht am **Ende** des Timer-Rumpfes, in einem
eigenen `try/catch` — er kann die Messung, die davor passiert, nicht mehr beeinflussen. Der Timer
läuft ohnehin lange nach dem Lauf und ist niemandem im Weg; zusätzlich fängt der
`unhandledRejection`/`uncaughtException`-Guard in `index.ts` alles ab, was durchkommt.

## D4: Quittierung persistent, in eigener kleiner Tabelle

**Entscheidung**: Neue Tabelle `plausibility_state` mit Primärschlüssel
`(kind, project_id, feature_id)` und den Spalten `reported_count`, `reported_at`.
Die Entscheidung „melden / nichts tun" trifft eine pure Funktion:

| Lage | Aktion |
|---|---|
| Anzahl = 0, Marke vorhanden | Marke löschen (`clear`) |
| Anzahl = 0, keine Marke | nichts (`suppress`) |
| offene Meldung existiert | Marke auf aktuelle Anzahl nachziehen (`refresh`) |
| keine offene Meldung, keine Marke **oder** Anzahl > Marke | melden + Marke setzen (`raise`) |
| keine offene Meldung, Anzahl ≤ Marke | nichts (`suppress`) |

**Begründung**: `AttentionRepo.raise()` dedupliziert nur gegen **offene** Meldungen. Eine
aufgelöste Meldung würde beim nächsten Takt sofort neu entstehen — FR-014 verletzt und die Inbox
nach Minuten unbenutzbar. Es braucht also einen Wasserstand, der die Auflösung überlebt (FR-017
verlangt Neustartfestigkeit ⇒ Datenbank, nicht Speicher).

Das Nachziehen der Marke bei **offener** Meldung (`refresh`) ist der Kern von FR-014: Wer
auflöst, quittiert den Stand *im Moment der Auflösung*. Kommen danach neue betroffene Läufe
hinzu, steigt die Anzahl über die Marke und die Meldung kehrt zurück (SC-005) — ohne dieses
Nachziehen käme sie schon durch Läufe zurück, die *vor* der Auflösung eingetroffen waren.

Das Löschen der Marke bei Anzahl 0 verhindert die stille Falle: verschwindet ein Befund ganz
(Läufe gelöscht) und tritt später ein einzelner neuer Fall auf, wäre `1 ≤ alte Marke` sonst
dauerhaft unterdrückt.

**Alternativen**: (a) Anzahl in `attention.message` schreiben und beim Prüfen zurückparsen —
verworfen, Text als Datenspeicher; (b) Spalten an `attention` anhängen — verworfen, die Tabelle
ist für alle Meldungsarten da und würde vier Spalten für eine Art tragen; (c) `settings`-KV mit
JSON-Blob — verworfen, kein Primärschlüssel, kein gezieltes Löschen, keine Fremdschlüssel.

## D5: Nur ein Weg zur Wahrheit — Prädikate in TypeScript, nicht in SQL

**Entscheidung**: Die Bedingungen der Befunde A und B stehen **ausschließlich** als pure
Prädikate in `packages/shared/src/plausibility.ts`. Die Datenbank liefert Zeilen
(`ExecutionRepo.listAll()`, existiert bereits), gefiltert wird in TypeScript. Nur Befund C
braucht eine eigene Abfrage, weil er über Aggregate dreier Tabellen geht (D7).

**Begründung**: Dieselbe Regel in SQL *und* als Prädikat (für den Einzellauf und die Tests) wäre
zweimal formuliert und würde auseinanderlaufen — die Tests wären dann grün gegen die Fassung, die
nicht läuft. Bei 254 Zeilen ist der Vorteil einer SQL-Selektion nicht messbar. Ein
`WHERE`-Vorfilter kann später zusätzlich davorgestellt werden, ohne die Prädikate anzutasten,
solange er nur eine **Obermenge** liefert.

## D6: Befund B überspringt archivierte Features — bewusste Verengung von FR-006

**Entscheidung**: Fehlstarts (Befund B) werden nur für **nicht archivierte** Features gemeldet.
Befund A zählt dagegen **alle** Läufe eines Projekts, auch solche archivierter und gelöschter
Features.

**Datenlage** — die 33 Läufe mit Fehlstart-Signatur verteilen sich auf fünf Features, drei davon
archiviert:

| Feature | Läufe | archiviert |
|---|---|---|
| `nur-sessions-aktiver-projekte-anzeigen` | 9 | nein |
| `frontend-ui-ux-agent` | 10 | nein |
| `erstellen-eines-features-basierend-auf-einem-jira-ticket` | 11 | **ja** (27.07.) |
| `alternative-mailadresse` | 2 | **ja** (29.07.) |
| `alterantive-mailadresse` | 1 | **ja** (29.07.) |

**Begründung**: FR-007 zählt vier Nicht-Melde-Regeln auf und nennt „archiviert" nicht — die
Entscheidung ist damit eine **Verengung von FR-006** und wird hier offen als solche geführt.
Dafür sprechen drei Dinge: (1) FR-009 nimmt bei Befund C archivierte Features ausdrücklich aus,
die Spezifikation behandelt Archivierung also als „nicht mehr im Bild"; (2) ein Fehlstart eines
abgeschlossenen Features ist nichts, was jemand noch tun kann — US4 („Meldungen bleiben
handhabbar") ist der Zweck des Ganzen; (3) `FeatureRepo.listAll()` liefert ohnehin nur nicht
archivierte Features, die Verengung ist der Normalpfad des Bestandscodes.

**Wirkung**: 2 Meldungen über 19 Läufe statt 5 Meldungen über 33 Läufe.
**Umkehrbar in einer Zeile**: `features.listAll()` → `listByProject(id, true)`. Wird die
Verengung nicht gewollt, ist das die ganze Änderung; die Tests dazu sind entsprechend benannt.

## D7: Befund C fragt Projekte ab, nicht Features

**Entscheidung**: Eine Abfrage je Projekt mit drei Unterabfragen — Anzahl nicht archivierter
Features, Zeitstempel des jüngsten davon, Anzahl der Phasenläufe **am Projekt**:

```sql
SELECT p.id,
  (SELECT COUNT(*)      FROM features f WHERE f.project_id=p.id AND f.archived_at IS NULL),
  (SELECT MAX(created_at) FROM features f WHERE f.project_id=p.id AND f.archived_at IS NULL),
  (SELECT COUNT(*)      FROM executions e WHERE e.project_id=p.id AND e.kind='phase')
FROM projects p
```

**Begründung**: Der Phasenlauf-Zähler geht über `executions.project_id` und **nicht** über einen
Join auf `features`. Damit ist der Edge Case „alle Läufe gehören zu einem inzwischen gelöschten
Feature ⇒ keine Meldung" ohne Sonderbehandlung erfüllt: die Zeile trägt weiterhin ihre
`project_id` (`executions.feature_id` hat keinen Fremdschlüssel). Ebenso zählt ein
*fehlgeschlagener* Phasenlauf mit (Szenario 4) — es wird nicht nach Status gefiltert.

**Verifiziert**: genau ein Projekt erfüllt die Bedingung.

| Projekt | aktive Features | Phasenläufe | Läufe gesamt |
|---|---|---|---|
| sdd-toolkit | 33 | 176 | 254 |
| Jobmappe | 40 | 34 | 51 |
| **iwf-datenkrake** | **22** | **0** | 1 (`chat_work`) |

Der eine Lauf der iwf-datenkrake ist ein Projekt-Chat, kein Phasenlauf — FR-008 fragt
ausdrücklich nach Phasenläufen, die Meldung entsteht also korrekt. Das deckt sich mit der in der
Aufgabenstellung genannten Beobachtung „22 Features in einem Projekt ohne einen einzigen
Phasenlauf".

## D8: Zwei Zahlen der Aufgabenstellung halten der Prüfung nicht stand

Die Aufgabenstellung nennt 171 unbepreiste Läufe und 43 Fehlstarts. Beide Zahlen sind so nicht
das, was gemeldet werden soll:

**171 → 160.** Die 171 enthalten **11 Läufe mit Status `orphaned`** (8 `review`, 3 `phase`).
Entscheidung: Befund A **überspringt `orphaned`**. Begründung: ein verwaister Lauf hat seinen
Abschlusspfad nie erreicht, seine Messung war also nie endgültig — genau das Kriterium aus
FR-001. Außerdem nimmt die Spezifikation verwaiste Läufe ausdrücklich aus dem Umfang
(„für verwaiste Läufe existiert bereits eine Meldung beim Aufräumen zum Start"). Verbleiben
**160** Läufe in zwei Projekten (sdd-toolkit 148, Jobmappe 12) ⇒ **2 Meldungen**.

**43 → 33 → 19.** Die 43 sind *alle* Phasenläufe mit `status='failed'` und Exitcode 1, mit
Laufzeiten von 2,1 s bis **2,5 Stunden**. Die Fehlstart-Signatur trifft davon 33 (2,09–4,04 s);
die übrigen 10 sind echte inhaltliche Fehlschläge und dürfen laut FR-007 nicht melden. Nach D6
(ohne archivierte Features) bleiben **19** Läufe in 2 Features ⇒ **2 Meldungen**.

**Die 6-Sekunden-Schwelle ist an den Daten bestätigt** — zwischen Fehlstart und Fehlschlag liegt
eine leere Zone, die Schwelle liegt mitten darin:

| Exitcode | < 6 s | 6–20 s | 20–60 s | > 60 s |
|---|---|---|---|---|
| 1 | **33** | 0 | 8 | 2 |
| 143 | 0 | 0 | 0 | 2 |

**Folge für SC-003**: nach dem ersten Start entstehen **5 Meldungen** (2 × Befund A, 2 × Befund
B, 1 × Befund C) über 160 unbepreiste Läufe, 19 Fehlstarts und 22 Features ohne Lauf. Die
Prüfung ist damit erfüllt („sichtbar, ohne dass jemand eine Datenbankabfrage formuliert"), die
Zahlen im Text von SC-003 sind es nicht — sie stammen aus ungefilterten Abfragen.

## D9: „Auf Anforderung abgebrochen" ist am Exitcode erkennbar

**Entscheidung**: Läufe mit Exitcode **130, 137 oder 143** (SIGINT / SIGKILL / SIGTERM) gelten als
abgebrochen und melden nie als Fehlstart. Zusätzlich verlangt Befund B `status='failed'`, was
`orphaned` ausschließt.

**Begründung**: Es gibt **keine** persistierte Markierung „ein Mensch hat gestoppt" —
`PtySessionManager.terminate()` schickt 2× Ctrl+C und danach `kill()`, der Exitcode landet über
`handleExit` unverändert in der Zeile. Eine neue Spalte dafür würde für den Bestand nichts
bringen (alle Altzeilen wären `NULL`) und wäre der einzige Schreibzugriff dieses Features auf
`executions` — gegen SC-007. Der Exitcode ist die Information, die bereits da ist.

**In den Daten geprüft**: Exitcode 143 kommt ausschließlich bei Läufen > 60 s vor (2 Zeilen) —
Abbrüche würden also auch ohne diese Regel an der Laufzeitschwelle scheitern. Die Regel steht
trotzdem explizit da, damit US1-Szenario 8 („nach 2,4 s abgebrochen ⇒ keine Meldung") **per
Konstruktion** hält und nicht per Zufall der Beobachtung.

## D10: Befund D braucht strukturierte Ablehnungsdaten, keinen zweiten Vergleich

**Entscheidung**: `TelemetryUpdateOutcome` wird im Ablehnungsfall um Felder erweitert:
`rejection: 'lowered' | 'price_loss'`, `existingTokens`, `rejectedTokens`, `factor`. Gemeldet
wird nur `rejection === 'lowered' && factor >= 2`. Das `reason`-Feld und beide `console.warn`
bleiben **wortgleich** erhalten (FR-018).

**Begründung**: `updateTelemetry` berechnet den Faktor heute schon — für die Textmeldung, in der
er als formatierte Zeichenkette verschwindet. Ihn im Aufrufer aus dem Text zurückzuparsen oder
den Vergleich ein zweites Mal zu rechnen (mit einem zweiten `SELECT`, dessen Ergebnis inzwischen
abweichen kann) wären beides schlechtere Wege als die Zahl mitzugeben.

Die Ablehnung `price_loss` kann den Faktor 2 **nie** erreichen: sie wird nur erreicht, wenn die
Token-Prüfung davor nicht griff, also `neu >= alt` gilt. US3-Szenario 3 (Nachtrag ohne Betrag,
bepreiste Zahl bleibt) ist damit strukturell erfüllt; die Prüfung auf `rejection === 'lowered'`
steht zusätzlich da, weil FR-011 sie wörtlich verlangt.

**Bezugsobjekt Feature** (FR-013): Bei einer offenen D-Meldung wird ein zweiter Widerspruch
desselben Features nicht als eigene Meldung angelegt — die Dedup-Regel von `raise()` greift. Das
ist die von FR-013 gewollte Wirkung und die Grenze der Meldung: sie sagt „dieses Feature hat
widersprüchliche Messungen", nicht „hier ist jeder einzelne Fall". Der `console.warn` nennt
weiterhin jeden Fall.

**Kein Wasserstand für D**: D ist ein Ereignis, kein Bestand — es gibt keine Anzahl, die wachsen
könnte, und die Ablehnung ist nicht aus den Daten rekonstruierbar. Nach dem Auflösen führt der
nächste abgelehnte Nachtrag zu einer neuen Meldung; das ist richtig, weil es ein neues Ereignis
ist.

## D11: Vier neue Meldungsarten, keine Wiederverwendung bestehender

**Entscheidung**: `AttentionKind` wird um `run_unpriced`, `phase_false_start`,
`project_without_runs`, `metering_conflict` erweitert.

**Begründung**: FR-012 verlangt vier unterscheidbare Arten mit eigener Bezeichnung. Die
Wiederverwendung von `agent_errored` (wie beim Zuordnungswächter `checkWorkWithoutRun`, der sich
`agent_errored` leiht) wäre hier aktiv schädlich: `agent_errored` ist in
`attentionReconciler.isAttentionValid()` eine **Prozess**-Art und wird ungültig, sobald eine
Session desselben Features wieder arbeitet — genau das, was FR-016 für Datenbefunde verbietet.

Die vier neuen Arten fallen in `isAttentionValid()` in den `default`-Zweig (`return true`, immer
gültig) und in `findStaleOnBoot()` weder in die Session- noch in die Merge-Gruppe. FR-016 und
FR-017 sind damit **ohne Änderung** am Reconciler erfüllt. Es werden trotzdem vier explizite
`case`-Zweige mit Begründung gesetzt, damit ein späteres Umsortieren des `switch` sie nicht
versehentlich in eine Prozess-Gruppe zieht — plus je ein Test.

`KIND_META` in `AttentionInbox.tsx` ist ein `Record<AttentionKind, …>`: die vier Einträge sind
nicht optional, `pnpm typecheck` erzwingt sie. Die Datei nutzt Emoji-Icons, entgegen der
Projektkonvention „SVG statt Emoji" — das ist Bestand und wird hier nicht umgebaut (die neuen
Einträge folgen dem Muster der Datei).

## D12: Pures Modul in `shared`, Zustand in `server`

**Entscheidung**: Schwellen, Prädikate, Melde-Entscheidung und Meldungstexte liegen in
`packages/shared/src/plausibility.ts` (ohne IO, ohne `node:`-Import). Datenbankzugriff in
`packages/server/src/db/plausibilityRepo.ts`, Verdrahtung in
`packages/server/src/services/plausibilityService.ts`.

**Begründung**: Das ist das etablierte Muster des Repos (`workflowModel.ts`,
`lifecycleCatalog.ts`, `attentionReconciler.ts`) und der Grund, warum SC-002 (je Befund ein
Erkennungstest, je Nicht-Melde-Regel ein Test) ohne Datenbank-Aufbau erreichbar ist: die 14
Nicht-Melde-Regeln aus FR-005/007/009/011 sind Aufrufe purer Funktionen.

`shared` bleibt frei von der Server-Konstante `TELEMETRY_GRACE_MS` — sie wird als Parameter
übergeben (D2).

---

## Zusammenfassung: Erwartetes Ergebnis des ersten Starts

| Befund | Art | Bezug | Meldungen | erfasste Objekte |
|---|---|---|---|---|
| A gemessen, nicht bepreist | `run_unpriced` | Projekt | 2 | 160 Läufe (148 + 12) |
| B Fehlstart | `phase_false_start` | Feature | 2 | 19 Läufe (9 + 10) |
| C Projekt ohne Lauf | `project_without_runs` | Projekt | 1 | 22 Features |
| D verworfene Nachkorrektur | `metering_conflict` | Feature | 0 | ereignisgetrieben |

Danach: keine weitere Meldung, solange keine neuen betroffenen Läufe entstehen (FR-014).
