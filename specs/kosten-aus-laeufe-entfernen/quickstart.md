# Phase 1 — Quickstart: Verifikation

**Feature**: Geschätzte Kosten aus den Läufen entfernen | **Datum**: 2026-07-26

Nachweisleitfaden für die Success Criteria SC-001 … SC-005. `@sdd/web` hat bewusst keine
Test-Suite, daher sind US1/US2 (Anzeige) manuelle Szenarien und US3 (Daten) automatisiert.

## Voraussetzungen

- Node ≥ 22, pnpm 10, Abhängigkeiten installiert (`pnpm install`)
- Eine **bestehende** SQLite-Datenbank mit Läufen aus der Zeit *vor* der Änderung — sie ist die
  Grundlage für SC-004 (FR-011). Pfad: `$SDD_DATA_DIR/sdd-toolkit.sqlite`, Default-`dataDir` ist
  `~/.sdd-toolkit` (`packages/server/src/config.ts:16`). Vorher sichern:

  ```bash
  DB="${SDD_DATA_DIR:-$HOME/.sdd-toolkit}/sdd-toolkit.sqlite"
  cp "$DB" "$DB.bak"
  ```

- Mindestens ein Projekt mit einem Feature, das ≥ 2 Ausführungen unterschiedlicher Art hat
  (z. B. eine `phase`- und eine `verify`-Ausführung), damit Step-Auswertung und Tabelle der
  Einzel-Ausführungen bestückt sind.

## Setup

```bash
pnpm install
pnpm typecheck            # muss grün sein — findet jede vergessene costUsd-Lesestelle
pnpm test                 # shared + server (web-Suite ist ein No-op)
pnpm dev                  # Server (127.0.0.1:4820) + Web (http://localhost:4830) parallel
```

`pnpm typecheck` ist hier mehr als eine Formalität: weil `costUsd` aus den Typen in `@sdd/shared`
entfernt wird, ist ein grüner Durchlauf der maschinelle Beweis, dass keine Stelle in `server` oder
`web` den Wert noch liest.

---

## S1 — Läufe-Ansicht ohne Kostenangaben (US1 → SC-001)

1. UI öffnen, Projekt mit Läufen auswählen, Tab **Läufe**.
2. **Zusammenfassungszeile oben rechts** prüfen: Format `N Läufe · X Tokens · Y % gemessen`.
   → Kein `$`-Betrag, keine doppelten oder hängenden `·`-Trenner. *(FR-001)*
3. **Eine Lauf-Zeile** prüfen: Name, Status-Badge, gestapelter Verbrauchsbalken, Token-Zahl mit
   Herkunfts-Badge — rechts davon **kein** Betragsfeld und keine leere Spalte. *(FR-002, FR-012)*
4. Lauf **aufklappen** → „Tokens pro Step": jede Balkenzeile zeigt Label und Token-Wert; rechts
   steht **kein** Betrag und **kein** leerer Platz mehr (die `sub`-Spalte ist entfallen). *(FR-003)*
5. „Spez vs. Coding vs. Overhead" (Donut) und „Komposition" prüfen → unverändert. *(FR-010)*
6. **Tabelle „Einzelne Ausführungen"**: Kopfzeile lautet
   `Start | Art | Status | Dauer | Tokens | (Log)` — die Spalte „Kosten" fehlt vollständig, Header
   und Zellen sind ausgerichtet. *(FR-004, FR-012)*
7. Eine Zeile mit Herkunft „geschätzt" suchen → Badge unverändert vorhanden, kein Betrag
   daneben. *(FR-010, Acceptance Scenario 5)*
8. Auf „Log" klicken → Log-Panel öffnet, Inhalt unverändert.

**Erwartet**: `⌘F` im Browser auf `$` findet in der gesamten Läufe-Ansicht (inkl. aufgeklapptem
Lauf) **0 Treffer** in vom Toolkit gerenderten Kennzahlen. → **SC-001**

## S2 — Übrige Lauf-Ansichten (US2 → SC-002)

1. Feature mit Ausführungen im **Review-Portal** öffnen. Kopfzeile prüfen: `Dateien`, `Audits`,
   `Verify` vorhanden — Kennzahl „Kosten" fehlt vollständig. *(FR-005)*
2. Tab **Tests/Verifikation**: StatCards `Läufe`, `Letzter Lauf`, `Tokens` — die Karte „Kosten"
   fehlt; die verbleibenden drei Karten stehen ohne Lücke. Pro Lauf-Zeile: Zeitpunkt, Dauer,
   `exit N`, `… tok` — kein ` · $x.xx`-Suffix. *(FR-006, FR-012)*
3. **Audit-Seitenleiste** eines Features mit Review-Läufen: pro Lauf Verdict-Pill,
   Entscheidungs-Label, Zusammenfassung, Zeitpunkt und `… tok` — kein Betrag. *(FR-007)*
4. Auch einen Alt-Review mit `source: 'markdown'` prüfen (falls vorhanden) → lesbar, kein Fehler.
5. Dialog **Agent-Auswahl** eines Features öffnen, bei dem ein Agent schon gelaufen ist: letzter
   Lauf mit Verdict, Zusammenfassung, Zeitpunkt und `… tok` — kein Betrag. *(FR-007)*

**Erwartet**: 0 Geldbeträge in allen vier Ansichten. → **SC-002**

## S3 — Ausgelieferte Daten ohne Kostenfelder (US3 → SC-003)

Automatisiert (Teil der Test-Suite, `pnpm test`):

- `shared`: `buildRunSummaries()` und `aggregateBreakdown()` liefern Rollups ohne `costUsd`;
  Token-Summen und `sourceMix` unverändert (bestehende Assertions bleiben grün).
- `shared`: `meter()` und `usageTotalTokens()` liefern kein Kostenfeld; `parseUsage()` extrahiert
  keinen Geldbetrag mehr, Token-Extraktion unverändert.
- `shared`: `parseChatStreamLine()` liefert für ein `result`-Event kein `costUsd`.
- `server`: `ExecutionRepo.finish()`/`finishWithUsage()` schreiben keine Kosten; der Row-Mapper
  liefert kein `costUsd`, auch wenn die Spalte in der Zeile gefüllt ist (Regressionstest:
  Zeile mit `cost_usd = 0.42` direkt einfügen, lesen, `'costUsd' in record === false` erwarten).

Manuell gegen den laufenden Server (Kontrakt C1):

```bash
BASE=http://127.0.0.1:4820   # SDD_PORT, siehe packages/server/src/config.ts:21
FEATURE=<feature-id>

for URL in \
  "/api/runs" \
  "/api/executions?featureId=$FEATURE" \
  "/api/features/$FEATURE/cost-breakdown" \
  "/api/features/$FEATURE/agents" \
  "/api/features/$FEATURE/agent-runs" ; do
  printf '%s → ' "$URL"
  curl -s "$BASE$URL" | grep -c 'costUsd' || true
done
```

**Erwartet**: jede Zeile endet mit `0`. Token-Felder (`tokens`, `inputTokens`, `outputTokens`,
`cacheReadTokens`, `cacheCreationTokens`, `tokensSource`, `sourceMix`, `totalTokens`) sind
weiterhin vorhanden. → **SC-003**

## S4 — Alt-Läufe bleiben vollständig lesbar (SC-004, FR-011)

1. Server gegen die **bestehende** (nicht neu angelegte) Datenbank starten — es darf keine neue
   Migration laufen:

   ```bash
   DB="${SDD_DATA_DIR:-$HOME/.sdd-toolkit}/sdd-toolkit.sqlite"
   sqlite3 "$DB" 'PRAGMA user_version;'    # vor und nach dem Start identisch
   ```

2. Bestätigen, dass Alt-Werte in der Datenbank unangetastet sind (sie werden nur nicht mehr
   ausgeliefert):

   ```bash
   sqlite3 "$DB" 'SELECT COUNT(*) FROM executions WHERE cost_usd IS NOT NULL;'   # > 0 erwartet
   ```

3. In der Läufe-Ansicht **jeden** Lauf des Projekts aufklappen: Token-Werte, Dauer, Status, Steps,
   Einzel-Ausführungen und Logs sind vorhanden; keine Fehlermeldung, keine leere Spalte, kein `—`
   an der Stelle des früheren Betrags.
4. Browser-Konsole prüfen → keine Fehler (kein `undefined.toFixed`).
5. Einen **neuen** Lauf starten und abschließen lassen → `cost_usd` der neuen Zeile ist `NULL`,
   `tokens`/`tokens_source` sind gesetzt:

   ```bash
   sqlite3 "$DB" 'SELECT cost_usd, tokens, tokens_source FROM executions ORDER BY started_at DESC LIMIT 1;'
   ```

**Erwartet**: 100 % der Alt-Läufe öffnen fehlerfrei; neue Läufe schreiben keine Kosten. → **SC-004**

## S5 — Tokens bleiben die Bezugsgröße am gewohnten Ort (SC-005)

1. In der Läufe-Ansicht prüfen: die Token-Angabe steht in **derselben** Lauf-Zeile, an derselben
   Position wie vor der Änderung (rechts vom Verbrauchsbalken), inklusive Herkunfts-Badge.
2. Kein zusätzlicher Klick, kein Aufklappen und kein Tab-Wechsel nötig, um den Verbrauch eines
   Laufs zu beurteilen.
3. Gegenprobe zu den Token-Zahlen: Wert in der Lauf-Zeile == Summe der Token-Werte in der Tabelle
   der Einzel-Ausführungen desselben Laufs (die Rollup-Invariante darf sich durch die Entfernung
   nicht verschoben haben).

**Erwartet**: Token-Angabe unverändert an Ort und Stelle, Summen konsistent. → **SC-005**

---

## Edge Cases aus der Spec

| Fall | Wie prüfen | Erwartung |
|------|------------|-----------|
| Lauf ohne gemessene Nutzung | Lauf mit `tokens = NULL` in allen Ausführungen aufklappen | Ansicht vollständig lesbar; an der Stelle des früheren Betrags **keine** Leerstelle und kein `—`; Hinweistext „Keine gemessene Usage …" unverändert |
| Laufender Lauf | Lauf starten und die Ansicht offen lassen (Auto-Refresh 5 s) | Badge „läuft", Tokens aktualisieren sich; **kein** Zwischenbetrag |
| Vor der Änderung mit Kosten abgeschlossene Läufe | S4 | lesbar, Werte werden nicht angezeigt |
| Spalte/Kennzahl, deren einzige Info die Kosten waren | S1.6, S2.1, S2.2 | Element verschwindet ganz, Layout der übrigen Angaben intakt |
| Nutzer kannte die Kostenangabe | S1, S2 | keine Ersatzzahl, keine Kennzeichnung „Schätzung entfernt" |

## Regressionsprüfung: keine Reste

```bash
grep -rniE 'costusd|cost_usd|MODEL_PRICES|priceFor|usageToCost|CACHE_READ_FACTOR|CACHE_WRITE_FACTOR|DEFAULT_PRICE|ModelPrice|total_cost' \
  packages --include='*.ts' --include='*.tsx'
```

**Erwartet nach der Umsetzung**: nur noch die beiden inerten Schema-Zeilen in
`packages/server/src/db/database.ts` (`cost_usd REAL` in `executions` und `chat_messages`).
Ausgangslage zum Vergleich: 98 Treffer in 28 Dateien (Branch-Basis `3dfedfc`).

## Rollback

Feature-Branch verwerfen bzw. den Merge revertieren. Es gibt keine Datenmigration, daher ist kein
Datenbank-Rollback nötig — die gesicherte Kopie aus *Voraussetzungen* ist nur eine Vorsichtsmaßnahme.
