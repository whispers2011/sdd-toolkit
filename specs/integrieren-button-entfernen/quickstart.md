# Quickstart — Validierung

Ausführbare Nachweise, dass das Feature wirkt. Die Szenarien folgen den Independent Tests der User Stories und den messbaren Kriterien SC-001…SC-008. Details zu Regeln und Texten stehen in [contracts/action-policy.md](./contracts/action-policy.md), Routen in [contracts/http-api.md](./contracts/http-api.md).

## Voraussetzungen

- Node ≥ 22, pnpm 10
- Ein Toolkit-Projekt mit gültigem Git-Checkout und mindestens einem Feature
- Abhängigkeiten installiert: `pnpm install`

## Automatisierte Prüfung

```bash
# Alles auf einmal — muss grün sein, bevor manuell geprüft wird
pnpm typecheck && pnpm test
```

| Befehl | Deckt ab |
|---|---|
| `pnpm --filter @sdd/shared test` | Aktions-Policy (Matrix, Invariante, Stufen-Exhaustiveness), `reopenLastPhase` |
| `pnpm --filter @sdd/server test` | `actionGuard`, Ablehnungen je Route, Wegfall von `mark-done`/`advance` |
| `pnpm typecheck` | `Record<IntegrationStage, StageClass>` ist vollständig; keine Aufrufer entfernter Methoden übrig |

**Erwartetes Ergebnis**: alle Suiten grün. Der Typecheck ist hier kein Formalismus — er ist der Nachweis, dass keine Integrationsstufe unklassifiziert bleibt und dass `api.markDone` / `api.advance` / `Orchestrator.advanceTo` restlos verschwunden sind.

## Anwendung starten

```bash
pnpm dev          # startet @sdd/server und @sdd/web parallel
```

---

## Szenario 1 — Integrieren erst, wenn das Feature fertig ist (US1, SC-001)

1. Neues Feature anlegen.
2. Board und Feature-Konsole nacheinander in **jedem** Zwischenzustand ansehen:
   - kein Schritt gestartet
   - erster Schritt läuft
   - erster Schritt wartet auf Freigabe
   - mittlerer Schritt freigegeben, letzter Schritt offen
3. Alle Schritte freigeben.

**Erwartet**: In den Zuständen aus Punkt 2 bietet **keine** Oberfläche eine Integrations-Aktion an — sie ist nicht gesperrt, sondern gar nicht vorhanden. Nach Punkt 3 erscheint sie gleichzeitig in Board und Konsole und startet bei Auslösung die Pipeline (`verifying`).

**Zusatz (FR-002, Projekt mit abgeschalteten optionalen Schritten)**: In einem Projekt ohne `clarify`/`checklist`/`analyze` erscheint die Aktion, sobald die verbleibenden aktiven Schritte freigegeben sind.

---

## Szenario 2 — Kein Weg an der Bedingung vorbei (US1 §5, FR-003/FR-004/FR-018)

Bei einem Feature mit mindestens einem offenen Schritt:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4820/api/features/<FEATURE_ID>/integrate
# erwartet: 409

curl -s -X POST http://localhost:4820/api/features/<FEATURE_ID>/integrate
# erwartet: {"message":"Erst integrierbar, wenn alle aktiven Schritte freigegeben sind.", …}
```

Danach im Board dieselbe Karte auf die Integrations-Spalte ziehen.

**Erwartet**: Der Zug wird nicht angenommen; derselbe Satz erscheint als Meldung. `git -C <worktree> status --porcelain` und `git -C <worktree> log --oneline -1` sind **vor und nach** beiden Versuchen identisch — es wurde nichts festgeschrieben.

---

## Szenario 3 — Keine Aktionen, während gearbeitet wird (US2, SC-002/SC-006)

1. Für ein Feature einen Schritt starten und während der Laufzeit nacheinander ansteuern: Board-Karte, Feature-Konsole (Schrittleiste), Review-Übersicht, Review-Portal.
2. Jede aktionsauslösende Schaltfläche anklicken.

**Erwartet**:
- Keine Schaltfläche löst aus. Jede ist sichtbar gesperrt.
- Bei jeder gesperrten Gruppe steht **dauerhaft** ein Satz — ohne Hover, ohne Klick, ohne Navigation: „Es wird gerade gearbeitet — Schritt „implement" läuft."
- Mit der Tabulatortaste sind die gesperrten Schaltflächen erreichbar (`aria-disabled`, nicht `disabled`); ein Screenreader liest den Grund über `aria-describedby` vor.
- Betrachtende Bedienelemente funktionieren unverändert: Ergebnis-Icons, Diff, „Im Editor öffnen", „Pfad kopieren", Prompt an die laufende Session.
- Nach Ende des Laufs sind die im Zustand sinnvollen Aktionen ohne Neuladen wieder verfügbar (FR-023).

**Varianten, jeweils mit derselben Erwartung**: Session arbeitet ohne als „läuft" markierten Schritt · ein Qualitäts-Gate läuft (`⚖`-Badge) · die Pipeline steht auf `verifying`/`review_gate`/`queued`/`merging`/`conflict_resolving`.

**Gegenprobe FR-011**: Feature A läuft, Feature B ist untätig — die Aktionen von B bleiben unbeeinflusst.

---

## Szenario 4 — Genau ein Standardweg (US3, SC-003)

1. Alle Oberflächen eines Features durchgehen und die auslösbaren Wege in den Endzustand „abgeschlossen" zählen.
2. Das Zahnrad-Menü der Board-Karte öffnen.
3. Eine Karte mit mehreren offenen Schritten auf eine spätere Schritt-Spalte ziehen.

**Erwartet**:
- Genau **1** Weg: die Integrations-Pipeline. „✓ Als abgeschlossen markieren" existiert nicht mehr.
- Die Schritt-Spalte nimmt die Karte nicht an; es wird keine Freigabe erteilt und kein Schritt gestartet (FR-029). Schritt-Spalten zeigen beim Ziehen keine Drop-Markierung.
- `POST /api/features/<ID>/mark-done` und `POST /api/features/<ID>/advance` antworten mit **404**.
- „🗄 Archivieren" steht auch für ein nie integriertes Feature bereit und ist als Aufräumen beschriftet (FR-017).

---

## Szenario 5 — Fertiges Feature ohne Änderungen (FR-027, Edge Case)

Ein Feature mit allen Schritten freigegeben, dessen Worktree keine Änderungen gegenüber dem Zielstand hat (`git -C <worktree> status --porcelain` leer, keine eigenen Commits).

```bash
curl -s http://localhost:4820/api/features/<FEATURE_ID>/integration-readiness
# erwartet: {"hasChanges":false}
```

**Erwartet**:
- Die Integrations-Aktion bleibt **sichtbar** und ist gesperrt mit „Keine Änderungen zu integrieren."
- Ein Start über jeden Bedienweg (Schaltfläche, Kartenzug, `curl`) wird mit 409 und demselben Satz abgelehnt.
- Die Integrationsstufe bleibt `none` — das Feature rutscht **nicht** über `reconcile()` auf `merged`.
- Archivieren und Löschen stehen zum Abräumen bereit.

---

## Szenario 6 — Zurückweisung im Review (US3 §7–8, SC-008, FR-020/FR-021/FR-026)

1. Ein Feature bis `awaiting_human_review` bringen.
2. Im Review-Portal mit Kommentar zurückweisen.
3. Board und Konsole ansehen.
4. Warten, bis die Korrektursession fertig ist; dann den letzten Schritt erneut freigeben.

**Erwartet**:
- Die Karte steht wieder in der Entwicklungs-Spalte (`integration === 'none'`), der letzte Schritt auf „wartet auf Freigabe".
- Der Hinweis „↩ im Review zurückgewiesen" bleibt sichtbar — auch nach einem Server-Neustart.
- Während die Korrektursession arbeitet, ist **keine** Aktion auslösbar (weder Integration noch Freigabe).
- Es startet **keine** automatische Integration vor der erneuten Freigabe (FR-021) — auch nicht bei aktivem `autoVerify`.
- Nach der erneuten Freigabe gilt das Feature wieder als fertig, der Hinweis verschwindet, und die Integration beginnt von vorn: `verifying` → ggf. `review_gate` → `awaiting_human_review`.

**Variante ohne Kommentar**: Zurückweisen ohne Kommentar und ohne Freitext startet keine Korrektursession; der letzte Schritt steht trotzdem auf „wartet auf Freigabe" und ist sofort erneut freigebbar.

---

## Szenario 7 — Gleiches Bild überall (US4, SC-004/SC-007)

Dasselbe Feature gleichzeitig in Board, Feature-Konsole und Review-Übersicht öffnen und durch die Zustände führen: in Arbeit → fertig → `verifying` → `awaiting_human_review` → `verify_failed` → `merged`.

**Erwartet**:
- In **jedem** Zustand zeigen alle drei Ansichten dieselbe Menge erlaubter Aktionen und dieselbe einzige nächste Aktion.
- Bei `verify_failed`, `gate_failed` und `conflict_escalated` bietet **jede** der drei Stellen dieselbe Wiederaufnahme-Aktion „↻ Erneut" an (FR-015 — heute fehlt sie auf der Board-Karte bei `gate_failed`).
- In der Review-Übersicht ist ein Feature mit `integration === 'none'` als **Vorschau** gekennzeichnet; das daraus geöffnete Portal bietet keine Integrations- oder Freigabe-Aktion und erklärt das als Vorschau statt mit einer technischen Zustandsmeldung (FR-019).
- Zustandswechsel schlagen in allen offenen Ansichten ohne Neuladen durch (FR-023).

---

## Szenario 8 — Doppelklick und veraltete Schaltfläche (FR-010, Edge Case)

1. Eine verfügbare Aktion zweimal schnell hintereinander auslösen.
2. Board offen lassen, während sich der Zustand des Features ändert (z. B. Lauf endet), dann eine inzwischen ungültig gewordene Schaltfläche klicken.

**Erwartet**: Der zweite Auslöser wird wirkungslos verworfen — **keine** Fehlermeldung, keine zweite Anfrage. Die veraltete Schaltfläche entfaltet keine Wirkung; sie wurde durch die WS-getriebene Neuberechnung ohnehin bereits gesperrt oder entfernt.

---

## Szenario 9 — Destruktive Aktionen bei laufender Arbeit (FR-008)

Bei einem Feature mit laufendem Schritt „Feature löschen" bzw. „🗄 Archivieren" auslösen.

**Erwartet**: Die Rückfrage weist ausdrücklich darauf hin, dass die laufende Arbeit dabei abgebrochen wird. Beide Aktionen bleiben verfügbar (sie sind Aufräum-Aktionen und werden nie gesperrt).

---

## Abnahme-Checkliste

| Kriterium | Nachweis |
|---|---|
| SC-001 | Szenario 1 + Policy-Test „integrate niemals verfügbar vor Fertigstellung" |
| SC-002 | Szenario 3 + Policy-Test „busy sperrt alle auslösenden Aktionen" |
| SC-003 | Szenario 4 (genau 1 Weg; 404 auf `mark-done`) + Szenario 5 (kein `merged` über den leeren Branch) |
| SC-004 | Szenario 7 (drei Ansichten parallel) — strukturell durch die gemeinsame Policy |
| SC-005 | Szenario 2 (`git status`/`git log` unverändert nach Ablehnung) |
| SC-006 | Szenario 3 (Satz sichtbar ohne Hover, per Tastatur erreichbar) |
| SC-007 | Szenario 7 (nächste Aktion in jeder Ansicht unmittelbar sichtbar) |
| SC-008 | Szenario 6 (erneute Freigabe zwingend vor erneuter Integration) |
