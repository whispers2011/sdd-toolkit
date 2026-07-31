# Phase 0 — Research & Entscheidungen

**Feature**: Geschätzte Kosten aus den Läufen entfernen | **Datum**: 2026-07-26

Die Spec enthält keine `[NEEDS CLARIFICATION]`-Marker. Sie delegiert stattdessen zwei Punkte
ausdrücklich an die Planung (Abschnitt *Assumptions*): den Umgang mit bereits gespeicherten
Kostenwerten und den Fortbestand der internen Kostenberechnung. Beide werden hier entschieden,
zusammen mit den Folgeentscheidungen, die sich aus der Code-Bestandsaufnahme ergeben.

## Bestandsaufnahme

Vollständige Referenzsuche auf `costUsd | cost_usd | MODEL_PRICES | priceFor | usageToCost |
CACHE_READ_FACTOR | CACHE_WRITE_FACTOR | DEFAULT_PRICE | ModelPrice | total_cost` über
`packages/**/*.{ts,tsx}`:

**98 Treffer in 28 Dateien.** Verteilung:

| Schicht | Dateien | Rolle |
|---------|---------|-------|
| Erzeugung | `shared/costMeter.ts` (18), `shared/transcriptUsage.ts` (7), `shared/chatStream.ts` (2) | Preistabelle, Kostenformel, `total_cost_usd`-Parsing |
| Aggregation | `shared/costBreakdown.ts` (3), `shared/runSummary.ts` (2) | `CostRollup.costUsd` summiert Executions |
| Vertrag | `shared/types.ts` (3), `web/api.ts` (1) | `ExecutionRecord`, `ChatMessage`, `AgentRunSummary`, `ExecutionInfo` |
| Persistenz | `server/db/repos.ts` (12), `server/db/database.ts` (2) | Spalten `executions.cost_usd`, `chat_messages.cost_usd` |
| Schreibpfad | `orchestrator.ts` (4), `chatService.ts` (3), `conflictResolver.ts` (2), `chatWorkService.ts` (1), `agentGateService.ts` (1), `mergeQueueService.ts` (1) | rufen `meter()`/`usageToCost()` und `executions.finish()` |
| API | `api/server.ts` (1), `api/reviewRoutes.ts` (2) | Anreicherung `lastRun` / `attachCosts` |
| UI | `ExecutionsView.tsx` (4), `TestsPane.tsx` (2), `ReviewPortal.tsx` (1), `AuditSidebar.tsx` (1), `FeatureAgentSelect.tsx` (1) | 9 Anzeigestellen |
| Tests | `costMeter.test.ts` (10), `transcriptUsage.test.ts` (4), `costBreakdown.test.ts` (4), `chatStream.test.ts` (3), `chatRepo.test.ts` (2), `runSummary.test.ts` (1) | |

Die 9 Anzeigestellen deckungsgleich mit den FRs:

| # | Ort | FR |
|---|-----|-----|
| 1 | `ExecutionsView.tsx:167` Summenzeile `$${totalCost}` | FR-001 |
| 2 | `ExecutionsView.tsx:255` Lauf-Zeile `$${run.total.costUsd}` | FR-002 |
| 3 | `ExecutionsView.tsx:270` `HBarChart`-`sub` pro Step | FR-003 |
| 4 | `ExecutionsView.tsx:301+322` Tabellenspalte „Kosten" (Header + Zelle) | FR-004 |
| 5 | `ReviewPortal.tsx:159` `HeaderStat` „Kosten" | FR-005 |
| 6 | `TestsPane.tsx:55` `StatCard` „Kosten" | FR-006 |
| 7 | `TestsPane.tsx:76` Kostensuffix pro Verify-Lauf | FR-006 |
| 8 | `AuditSidebar.tsx:101` Kostensuffix pro Audit-Lauf | FR-007 |
| 9 | `FeatureAgentSelect.tsx:93` Kostensuffix am letzten Lauf | FR-007 |

Bestätigt wurde außerdem die Spec-Annahme, dass die Kosten-Aufschlüsselung pro Feature in keiner
Ansicht dargestellt wird: `api.costBreakdown()` (`web/api.ts:177`) ist definiert, hat aber **keinen
Aufrufer** in `packages/web/src`. Der Endpoint `GET /api/features/:featureId/cost-breakdown`
bleibt bestehen, liefert aber keine Geldbeträge mehr (FR-009).

---

## D1 — Tiefe: Entfernen statt Ausblenden

**Decision**: `costUsd` verschwindet über alle Schichten — Anzeige, API-Payload, Aggregation,
Persistenz-Schreibpfad und Berechnung.

**Rationale**: FR-008 und FR-009 verlangen beides zugleich (keine Anzeige *und* keine
Geldbeträge in den ausgelieferten Daten). Ein rein visuelles Ausblenden ließe das Feld in
`RunSummary`/`ExecutionRecord` und würde FR-009 direkt verletzen. Zusätzlich ist das Entfernen
des Typfelds das einzige Mittel, das die Regression technisch ausschließt: `tsc --noEmit` markiert
jede vergessene Lesestelle als Fehler — bei einem beibehaltenen, nur ungenutzten Feld wäre ein
Wiederauftauchen eine Frage der nächsten Änderung (genau das Argument von US3).

**Alternatives considered**:

- *Nur UI-Stellen entfernen*: verletzt FR-009; verworfen.
- *Feature-Flag / Einstellung zum Wiedereinschalten*: von der Spec explizit ausgeschlossen
  („das Feature entfernt sie, es macht sie nicht optional"); verworfen.
- *`costUsd` behalten, aber immer `null` schreiben*: das Feld bliebe im Payload (FR-009) und
  würde in der UI zum Platzhalter „—" verleiten (FR-012); verworfen.

---

## D2 — Bereits gespeicherte Werte: Spalten bleiben inert, keine Migration

**Decision**: Die SQLite-Spalten `executions.cost_usd` (`database.ts:57`) und
`chat_messages.cost_usd` (`database.ts:183`) bleiben unverändert im Schema. Es wird **keine neue
Migration** angefügt. Der Code schreibt sie nicht mehr (neue Zeilen behalten `NULL`) und liest sie
nicht mehr (Row-Mapper in `repos.ts:517` / `repos.ts:763` mappen das Feld nicht länger).

**Rationale**: Die Spec verzichtet ausdrücklich auf Bereinigung („Historisch erfasste Kostenwerte
müssen nicht rückwirkend bereinigt oder migriert werden") und definiert als Kriterium nur, dass die
Werte Nutzern nicht mehr angezeigt werden und nicht mehr Teil der ausgelieferten Auswertung sind —
das ist mit „nicht mehr lesen" vollständig erfüllt. Ein `ALTER TABLE … DROP COLUMN` wäre auf der
laufenden Datenbank des Nutzers irreversibel und würde Daten löschen, deren Erhalt die Spec weder
fordert noch verbietet; der Nachteil (eine inerte, nullbare Spalte) ist ungleich kleiner als
irreversibler Datenverlust. FR-011 ist damit trivial erfüllt: bestehende Datenbanken öffnen ohne
Schemaänderung, alle Alt-Läufe bleiben mit Tokens, Dauer, Status und Logs lesbar.

**Alternatives considered**:

- *`DROP COLUMN` als Migration 30*: technisch möglich (better-sqlite3 ^12 bündelt SQLite ≫ 3.35,
  keine Indizes auf `cost_usd`), aber irreversibel auf Produktivdaten und von der Spec nicht
  gefordert; verworfen. Bleibt als separate Aufräumarbeit jederzeit nachholbar.
- *`UPDATE executions SET cost_usd = NULL`*: löscht die Daten ohne den Vorteil eines saubereren
  Schemas — schlechteste Kombination; verworfen.

**Konsequenz für den Nachweis**: Weil die Spalte bestehen bleibt, sichern Tests ab, dass die
*ausgelieferte* Struktur kein `costUsd` mehr trägt (siehe [quickstart.md](./quickstart.md), S3).

---

## D3 — Interne Kostenberechnung wird gelöscht

**Decision**: Die kostenerzeugenden Bausteine in `shared` entfallen restlos:
`MODEL_PRICES`, `ModelPrice`, `DEFAULT_PRICE`, `priceFor()`, `normalizeModel()`,
`CACHE_READ_FACTOR`, `CACHE_WRITE_FACTOR`, die Kostenformel in `meter()`, das Feld
`CostMetadata.costUsd` und `ParsedUsage.costUsd`.

**Rationale**: Nach D1 hat keiner dieser Bausteine noch einen Konsumenten — die Referenzsuche
zeigt `priceFor` ausschließlich in `costMeter.ts`, `transcriptUsage.ts` und deren Tests;
`CACHE_*_FACTOR` nur in `transcriptUsage.ts`. Sie stehenzulassen hieße, eine Preistabelle mit
hartkodierten, veraltenden Annahmen (15/75, 3/15, 0.8/4 USD pro Mio. Token) zu pflegen, die
nichts speist. `normalizeModel()` fällt mit, weil es ausschließlich der Preisauswahl dient — die
Modellbezeichnung selbst bleibt über `CostMetadata.model` bzw. `TurnUsage.model` erhalten.

**Alternatives considered**:

- *Preistabelle als „interner Mechanismus" behalten* (von der Spec zugelassen, solange kein
  Ergebnis eine Ansicht erreicht): erzeugt toten Code ohne Nutzen und widerspricht der
  Projektvorgabe, keine Reste entfernter Funktionalität stehenzulassen; verworfen.
- *Auslagern in ein separates Modul „für später"*: spekulativ, kein Bedarfsträger; verworfen.

---

## D4 — `total_cost_usd` wird nicht mehr geparst

**Decision**: Der Kosten-Regex in `parseUsage()` (`costMeter.ts:54`) und das Feld `costUsd` im
`result`-Event von `parseChatStreamLine()` (`chatStream.ts:58`) entfallen. Token-Parsing
(`input/output/total tokens`, `usage.input_tokens`/`output_tokens`) bleibt unverändert.

**Rationale**: Diese beiden Stellen lesen den von der CLI **berichteten** Betrag — also keine
Schätzung des Toolkits. FR-008/FR-009 unterscheiden aber nicht nach Herkunft: kein Geldbetrag darf
in Ansicht oder ausgelieferten Daten erscheinen. Da nach D1 kein Feld mehr existiert, das den
geparsten Wert aufnimmt, wäre das Parsing wirkungslos. Die Genauigkeit der Token-Erfassung ändert
sich nicht: `chatService` nutzt weiterhin `turnResult.tokens ?? fallback.totalTokens`, und
`meter()` behält `source: 'parsed' | 'estimated'` — die Herkunfts-Erkennung stützt sich dann auf
die Token-Treffer statt zusätzlich auf den Kostentreffer.

**Nebenwirkung, bewusst akzeptiert**: Ein CLI-Output, der *nur* `total_cost_usd` und keine
Token-Zahlen berichtet, gilt künftig als `estimated` statt `parsed` — ohne Token-Angabe ist der
Token-Wert tatsächlich geschätzt (Zeichenlänge / 4), die Einordnung wird also ehrlicher, nicht
schlechter. FR-010 bleibt gewahrt: die Badge-Werte selbst und ihre Bedeutung ändern sich nicht.

**Alternatives considered**:

- *Kosten weiter parsen und verwerfen*: toter Codepfad; verworfen.
- *`source`-Bestimmung unverändert lassen, indem der Kostentreffer nur noch als Boolean
  weiterlebt*: erhält einen Kosten-Regex im Code, um ein Badge zu stützen, das ohne Token-Daten
  ohnehin nicht belastbar ist; verworfen (siehe Nebenwirkung).

---

## D5 — Keine Umbenennung von Dateien, Routen und Typen

**Decision**: `costMeter.ts`, `costBreakdown.ts`, die Typen `CostRollup` /
`FeatureCostBreakdown` / `CostMetadata` und die Route `GET /api/features/:featureId/cost-breakdown`
behalten ihre Namen. Umbenannt wird nur, was seine Funktion verliert:
`usageToCost(u): {totalTokens, costUsd}` → `usageTotalTokens(u): number`.

**Rationale**: Ein projektweiter Rename (Datei, Route, 4 Typen, Web-Client, 6 Testdateien) hätte
keinen nutzersichtbaren Effekt, würde aber den Diff aufblähen und die eigentliche Entfernung darin
verstecken — genau die Vermischung, die Review erschwert. `usageToCost` ist die Ausnahme: sein
Rückgabewert schrumpft auf eine Zahl, der Name würde aktiv falsch. „Cost" im Sinne von
„Verbrauch/Aufwand" bleibt für die verbleibenden Token-Aggregate eine tragfähige Lesart.

**Alternatives considered**:

- *Alles zu `usage*` umbenennen*: sauberere Semantik, aber Scope-Ausweitung ohne
  Anforderungsbezug; als separate Aufräumarbeit vormerkbar, hier verworfen.
- *`usageToCost` beibehalten und `costUsd: 0` liefern*: liefert einen erfundenen Geldbetrag;
  verworfen.

---

## D6 — Reihenfolge: UI zuerst, Typen zuletzt

**Decision**: Umsetzung in der Reihenfolge (1) UI-Anzeigestellen, (2) Server-Schreibpfad,
(3) Shared-Typen + Kostenmechanismus, (4) Tests/Doku.

**Rationale**: `costUsd` lebt in `@sdd/shared`, gegen das `server` *und* `web` kompilieren. Wird
das Feld zuerst entfernt, brechen 9 UI-Stellen und 7 Server-Stellen gleichzeitig — kein
Zwischenstand ist lauffähig, und die Slice-Grenzen der Spec (US1/US2 unabhängig prüfbar) wären
nicht einlösbar. In der gewählten Reihenfolge ist nach Schritt 1 die vollständige UI-Prüfung von
US1 und US2 möglich (die Daten tragen `costUsd` noch, niemand zeigt es), und Schritt 3 nutzt `tsc`
als Vollständigkeitsbeweis.

**Alternatives considered**:

- *Typ zuerst („compiler-driven")*: schnellstes Finden aller Stellen, aber ein einziger,
  unteilbarer Commit ohne prüfbare Zwischenstände; verworfen.
- *Pro User Story ein vollständiger vertikaler Schnitt*: bei einem gemeinsamen Typfeld nicht
  möglich, ohne US3 vorzuziehen; verworfen.

---

## D7 — `ChatMessage.costUsd` fällt mit

**Decision**: Auch `ChatMessage.costUsd` (`types.ts:439`) und der zugehörige Schreibpfad in
`ChatRepo` (`repos.ts:854/883/889/897`) entfallen; `chat_messages.cost_usd` bleibt nach D2 als
inerte Spalte stehen.

**Rationale**: Eine Chat-Nachricht ist streng genommen kein „Lauf", aber ihr Kostenwert entsteht
aus derselben Quelle (`meter()` bzw. `turnResult.costUsd`) und wird zusammen mit der zugehörigen
`chat`-Execution geschrieben (`chatService.ts:283`). Nach D3 existiert diese Quelle nicht mehr —
das Feld hätte keinen Lieferanten und müsste dauerhaft `null` bleiben. Es wird in keiner Ansicht
dargestellt (Referenzsuche: kein `costUsd` in Chat-Komponenten), sein Entfall ist also nicht
nutzersichtbar und weitet den Scope faktisch nicht aus.

**Alternatives considered**:

- *`ChatMessage.costUsd` als `null`-Feld behalten*: Feld ohne Lieferant und ohne Konsument;
  verworfen.

---

## D8 — FR-012 konkret: welche Elemente ganz verschwinden

**Decision**: Wo die Kostenangabe die einzige Information eines Elements war, verschwindet das
Element:

| Element | Behandlung |
|---------|------------|
| Tabellenspalte „Kosten" in `ExecutionsView` (`<th>` Z. 301 + `<td>` Z. 321–323) | Header **und** Zelle entfallen; die Tabelle hat danach 6 statt 7 Spalten |
| `HeaderStat label="Kosten"` in `ReviewPortal` (Z. 159) | Kennzahl entfällt inkl. `totalCost`-Memo (Z. 82) |
| `StatCard label="Kosten"` in `TestsPane` (Z. 55) | Kennzahl entfällt inkl. `totals.cost` (Z. 34) |
| `HBarChart`-Prop `sub` (`charts.tsx:23`, gerendert Z. 38) | Prop und der bislang leer gerenderte `w-16`-Span entfallen — nach der Änderung ist `sub` konsumentenlos |
| Suffixe ` · $x.xx` in `TestsPane`/`AuditSidebar`/`FeatureAgentSelect` | Suffix entfällt; das vorangehende Token-Suffix bleibt unverändert bestehen |
| Summenzeile `ExecutionsView` Z. 167 | Nur das Kosten-Segment entfällt; „N Läufe · X Tokens · Y % gemessen" bleibt mit korrekten Trennzeichen |
| Lauf-Zeile `ExecutionsView` Z. 255 | Der `w-14`-Span entfällt vollständig (kein leerer Platzhalter) |

**Rationale**: Direkte Umsetzung von FR-012 und der Edge Cases („keine Leerstelle, kein
Platzhalter wie —"). Besonders relevant bei der Tabelle: nur die Zelle zu entfernen würde die
Spaltenausrichtung zerstören, nur den Wert zu leeren würde eine leere Spalte hinterlassen.

**Alternatives considered**:

- *`sub`-Prop in `HBarChart` behalten*: generische Chart-Komponente, die eine Option ohne
  Aufrufer trägt; verworfen (Projektvorgabe: keine Reste entfernter Funktionalität).

---

## Offene Punkte

Keine. Alle von der Spec an die Planung delegierten Fragen sind in D2 und D3 entschieden.
