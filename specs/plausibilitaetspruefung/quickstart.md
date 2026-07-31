# Quickstart — Validierung: Plausibilitätsprüfung gemessener Läufe

Nachweis, dass die vier Befunde erkannt werden, dass die Nicht-Melde-Fälle schweigen und dass die
Inbox handhabbar bleibt. Reihenfolge: automatisiert (Stufe 1–2), dann am echten Bestand (Stufe 3),
dann Handhabbarkeit und Nicht-Eingriff (Stufe 4–5).

## Voraussetzungen

```sh
node -v          # ≥ 22
pnpm -v          # 10.x
pnpm install
```

> **Ports und Prozesse** — Regel aus `CLAUDE.md`: Die laufende Toolkit-Instanz belegt 4820/4830.
> Jede Probe hier startet auf **eigenen** Ports und wird **ausschließlich über den eigenen Port
> oder die gemerkte PID** beendet. `pkill -f` mit unspezifischem Muster (`vite`, `node`, `tsx`) ist
> verboten — deine Session ist ein Kindprozess der laufenden Instanz und würde mitsterben.

---

## Stufe 1 — Typprüfung und Testlauf

```sh
pnpm -r typecheck
pnpm -r test
```

**Erwartet**: beides grün. Die Typprüfung ist Teil der Abnahme, nicht Formsache: `KIND_META` in
`AttentionInbox.tsx` ist ein `Record<AttentionKind, …>` und schlägt fehl, solange die vier neuen
Arten dort keine Bezeichnung haben (FR-012).

## Stufe 2 — Befunde und Nicht-Melde-Regeln (automatisiert)

```sh
pnpm --filter @sdd/shared test -- plausibility
pnpm --filter @sdd/server test -- plausibility attentionReconciler executionRepo
```

**Erwartete Abdeckung** (SC-002 — je Befund ein Erkennungstest, je Nicht-Melde-Regel ein Test):

| Nachweis | Testdatei | Szenario |
|---|---|---|
| A erkannt | `shared/…/plausibility.test.ts` | US1-1 |
| A schweigt: Betrag vorhanden / keine Tokens / noch nachtragsfähig | dito | US1-2, US1-3, US1-4 |
| B erkannt (2,4 s, Exitcode 1) | dito | US1-5 |
| B schweigt: Exitcode 0 / 40 s / abgebrochen / verwaist / genau 6 s | dito | US1-6, US1-7, US1-8, Edge Cases |
| C erkannt (Features, kein Phasenlauf, Karenz abgelaufen) | dito | US2-1 |
| C schweigt: kein Feature / Phasenlauf vorhanden / alles archiviert / Karenz offen | dito | US2-2…US2-5 |
| D erkannt (Faktor ≥ 2) / schweigt (< 2, angenommen, Preis-Ablehnung) | dito | US3-1…US3-4 |
| Wasserstand: alle 9 Zeilen der Wahrheitstabelle | dito | US4-1…US4-3 |
| Genau **eine** Meldung je Befund und Bezugsobjekt, über echte DB | `server/…/plausibilityService.test.ts` | SC-001 |
| Zehn Prüfungen ⇒ Anzahl wie nach der ersten | dito | US4-1, SC-004 |
| Aufgelöst + unverändert ⇒ keine neue Meldung | dito | US4-2, SC-005 |
| Aufgelöst + neuer betroffener Lauf ⇒ genau eine neue | dito | US4-3, SC-005 |
| Ein Befund über mehrere Läufe ⇒ eine Meldung mit Anzahl | dito | Edge Case |
| Arbeitender Agent löst Befund-Meldung nicht auf | `server/…/attentionReconciler.test.ts` | US4-4, FR-016 |
| Neustart verwirft Befund-Meldungen nicht (`findStaleOnBoot`) | dito | US4-5, FR-017 |
| Ablehnung liefert `rejection`, `factor`, beide Zahlen | `server/…/executionRepo.test.ts` | FR-010 |
| Fehler in der Prüfung lässt den Laufabschluss unberührt | `server/…/plausibilityService.test.ts` | FR-003, SC-006 |

## Stufe 3 — Am echten Bestand (SC-003)

Beweist, dass die heute unbemerkten Zustände nach dem Start in der Inbox stehen. Läuft gegen eine
**Kopie** der Produktivdatenbank in einem eigenen Datenverzeichnis — die laufende Instanz bleibt
unangetastet.

```sh
PROBE=$(mktemp -d)
mkdir -p "$PROBE/logs" "$PROBE/hooks" "$PROBE/snapshots"
cp ~/.sdd-toolkit/sdd-toolkit.sqlite* "$PROBE/"

SDD_DATA_DIR="$PROBE" SDD_PORT=4899 pnpm --filter @sdd/server dev &
MEINE_PID=$!
```

Warten, bis `sdd-toolkit Server läuft auf http://127.0.0.1:4899` erscheint, dann:

```sh
curl -s localhost:4899/api/attention \
  | python3 -c 'import json,sys;[print(i["kind"],"|",i["featureId"] or "-","|",i["message"]) for i in json.load(sys.stdin)]'
```

**Erwartet — genau fünf neue Meldungen** (Stand der Datenbank vom 30.07.2026, Herleitung in
[research.md](./research.md) D8):

| Art | Bezug | Inhalt |
|---|---|---|
| `run_unpriced` | Projekt sdd-toolkit | 148 Läufe, Beispiel mit Feature, Schritt, Tokenzahl |
| `run_unpriced` | Projekt Jobmappe | 12 Läufe |
| `phase_false_start` | `nur-sessions-aktiver-projekte-anzeigen` | 9 Läufe, 2,1–…s, Exitcode 1 |
| `phase_false_start` | `frontend-ui-ux-agent` | 10 Läufe |
| `project_without_runs` | Projekt iwf-datenkrake | 22 Features, nie ein Phasenlauf |

Gegenprobe zur Abgrenzung — der Bestand ist damit vollständig erklärt:

```sh
sqlite3 "$PROBE/sdd-toolkit.sqlite" \
  "SELECT 'A_gesamt',COUNT(*) FROM executions WHERE tokens>0 AND cost_micros IS NULL AND finished_at IS NOT NULL
   UNION ALL SELECT 'A_orphaned',COUNT(*) FROM executions WHERE tokens>0 AND cost_micros IS NULL AND status='orphaned'
   UNION ALL SELECT 'B_signatur',COUNT(*) FROM executions WHERE kind='phase' AND status='failed' AND finished_at-started_at<6000
   UNION ALL SELECT 'B_lange_fehlschlaege',COUNT(*) FROM executions WHERE kind='phase' AND status='failed' AND finished_at-started_at>=6000;"
```

**Erwartet**: `A_gesamt 171`, `A_orphaned 11` (⇒ 160 gemeldet), `B_signatur 33`,
`B_lange_fehlschlaege 12` — die 12 langen Fehlschläge dürfen **nicht** als Fehlstart erscheinen
(FR-007), die 14 Läufe archivierter Features ebenfalls nicht ([research.md](./research.md) D6).

Aufräumen — nur der eigene Prozess:

```sh
kill "$MEINE_PID"          # oder: lsof -ti:4899 | xargs kill
rm -rf "$PROBE"
```

## Stufe 4 — Handhabbarkeit (US4, manuell in der laufenden Instanz)

Mit der Probe-Instanz aus Stufe 3 (Port 4899):

1. **Vier Arten unterscheidbar** — Inbox „Braucht dich" öffnen, Projekt umschalten. Jede Meldung
   trägt eigene Bezeichnung und eigenes Icon, jede hat einen ✓-Knopf (US4-6). Projektbezogene
   Meldungen (A, C) haben keinen Aktionsknopf — richtig, es gibt nichts zu starten.
2. **Kein Nachwachsen** — Meldungen zählen, 10 Minuten warten (10 Intervall-Durchläufe), erneut
   zählen: dieselbe Anzahl (US4-1, SC-004).
   ```sh
   curl -s localhost:4899/api/attention | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))'
   ```
3. **Auflösen bleibt aufgelöst** — eine `run_unpriced`-Meldung mit ✓ auflösen, zwei Intervalle
   warten, prüfen: sie kommt nicht zurück (US4-2).
4. **Wiederkehr bei Wachstum** — einen weiteren betroffenen Lauf einfügen und ein Intervall warten:
   genau eine neue Meldung (US4-3).
   ```sh
   sqlite3 "$PROBE/sdd-toolkit.sqlite" "INSERT INTO executions
     (id,project_id,feature_id,kind,phase,status,started_at,finished_at,exit_code,tokens)
     VALUES ('probe00001','OYHWliMHZN',NULL,'phase','implement','succeeded',
             strftime('%s','now')*1000-900000, strftime('%s','now')*1000-600000, 0, 12345);"
   ```
5. **Neustart** — Probe-Instanz über den eigenen Port beenden, neu starten, Inbox prüfen: die
   nicht aufgelösten Befund-Meldungen sind weiterhin offen, die aufgelöste bleibt weg (US4-5,
   FR-014, FR-017).

## Stufe 5 — Nicht-Eingriff (SC-006, SC-007)

1. **Laufabschluss unverändert**: In der Probe-Instanz ein Feature anlegen und eine kurze Phase
   laufen lassen. Ablauf, Dauer und Ergebnis wie gewohnt; die Beurteilung erscheint erst mit dem
   Ende des Nachtragsfensters (5 min), nicht davor.
2. **Prüfung ist kein Tor**: Der Test „Fehler in der Prüfung" aus Stufe 2 belegt es automatisiert —
   ein werfender `PlausibilityService` lässt Status, `finished_at`, Exitcode und Tokenzahl des
   Laufs unverändert.
3. **Nur lesen**: Prüfsumme über die Lauftabelle vor und nach mehreren Prüfdurchläufen vergleichen:
   ```sh
   sqlite3 "$PROBE/sdd-toolkit.sqlite" \
     "SELECT COUNT(*), SUM(COALESCE(tokens,0)), SUM(COALESCE(cost_micros,0)),
             SUM(COALESCE(exit_code,-1)), SUM(COALESCE(finished_at,0)) FROM executions;"
   ```
   **Erwartet**: identisch (nur die in Stufe 4.4 eingefügte Probe-Zeile verändert die Summen).
   Geschrieben wird ausschließlich in `attention` und `plausibility_state`.
4. **Konsole bleibt** (FR-018): Bei einem abgelehnten Nachtrag steht die bisherige Zeile
   `[metering] <id>: Nachtrag verworfen — …` wortgleich im Serverprotokoll, zusätzlich zur
   Meldung.

---

## Abnahme-Checkliste

- [ ] `pnpm -r typecheck` und `pnpm -r test` grün (Stufe 1)
- [ ] Je Befund ein Erkennungstest, je Nicht-Melde-Regel aus FR-005/007/009/011 ein Test (Stufe 2, SC-002)
- [ ] Fünf Meldungen am echten Bestand, Abgrenzung durch die Gegenprobe belegt (Stufe 3, SC-003)
- [ ] Zehn Prüfungen ⇒ eine Meldung je Befund (Stufe 4.2, SC-004)
- [ ] Aufgelöst bleibt weg, kehrt bei neuem Lauf zurück (Stufe 4.3/4.4, SC-005)
- [ ] Meldungen überleben den Neustart (Stufe 4.5, FR-017)
- [ ] Laufabschluss unverändert, auch bei Fehler in der Prüfung (Stufe 5.1/5.2, SC-006)
- [ ] Lauftabelle unverändert (Stufe 5.3, SC-007)
- [ ] Konsolenausgaben erhalten (Stufe 5.4, FR-018)
- [ ] Probe-Instanz über eigenen Port/PID beendet, Probe-Verzeichnis entfernt
