# Quickstart / Validierung: „Braucht dich" verschwindet nach Review nicht

Nachweisführung für die Success Criteria SC-001 bis SC-006. Stufen 1–2 sind automatisiert, Stufen 3–6
laufen gegen eine eigene Toolkit-Instanz.

## Voraussetzungen

- Node ≥ 22, pnpm 10, Abhängigkeiten installiert (`pnpm install`)
- Ein Testprojekt im Toolkit, dessen Integration lokal durchlaufen kann (Git-Repo mit `main`)
- **Eigene Ports.** Die laufende Toolkit-Instanz belegt 4820 (API) und 4830 (Web) — nicht
  mitbenutzen, sonst testet man gegen den fremden Stand:

  ```sh
  SDD_PORT=4921 SDD_WEB_PORT=4931 pnpm dev
  ```

- Aufräumen **nur** über den eigenen Port, niemals über generische Muster (Projektregel in
  `CLAUDE.md` — ein `pkill -f vite` reißt die laufende Instanz und damit die eigene Session mit):

  ```sh
  lsof -ti:4921 | xargs -r kill
  lsof -ti:4931 | xargs -r kill
  ```

## Stufe 1: Automatisierte Checks

```sh
pnpm -r typecheck
pnpm -r test
```

Erwartung: beide grün. Neu dabei:

| Datei | Deckt ab |
|---|---|
| `packages/shared/src/attentionList.test.ts` | FR-010 (a)+(b), V8–V10 |
| `packages/server/src/db/attentionRepo.test.ts` | FR-002/FR-006, V1–V4 |
| `packages/server/src/services/attentionResolveEvents.test.ts` | FR-001/FR-003/FR-005/FR-011, SC-006, V5–V7 |

Bestehende Suiten müssen unverändert grün bleiben — insbesondere
`packages/server/src/db/chatWork.test.ts`, `orchestrator.attention.test.ts`,
`mergeQueueService.attention.test.ts` und `attentionReconciler.test.ts` (FR-009).

**Vollständigkeitsprüfung der Umstellung** (FR-005, Vertragsregel aus
`contracts/attention-resolution.md` §3):

```sh
# Erwartung: KEIN Treffer — jeder Auflöseweg läuft über den Helfer.
grep -rn "emitEvent('attention_resolved'" packages/server/src --include='*.ts'

# Erwartung: 13 Treffer in api/server.ts, services/{mergeQueueService,orchestrator,chatWorkService}.ts
grep -rn "emitAttentionResolved(" packages/server/src --include='*.ts' | grep -v '\.test\.ts' | grep -v 'src/events.ts'

# Erwartung: KEIN Treffer — die sessionId-Zuordnung ist aus der Anzeige verschwunden.
grep -n "sessionId !== action.id" packages/web/src/store.tsx
```

## Stufe 2: Rot vor Grün beweisen (SC-005, FR-010)

Beide Ursachen müssen nachweislich von einem Test getroffen werden. Reihenfolge: Test schreiben,
fehlschlagen sehen, dann Code.

### 2a — Ursache B (Anzeige ordnet über fremde Kennung zu)

```sh
# In packages/shared/src/attentionList.ts vorübergehend die HEUTIGE Reducer-Regel einsetzen:
#   items.filter((a) => a.id !== resolvedId && a.sessionId !== resolvedId)
pnpm --filter @sdd/shared test attentionList
# Erwartung: der Test „fremde Kennung entfernt nichts" (FR-010b) schlägt fehl und nennt die
#            Meldung, die zu Unrecht verschwunden ist. Danach zurück auf die id-only-Regel.
```

### 2b — Ursache A (Sammel-Auflösung sendet nichts)

```sh
# In packages/server/src/db/repos.ts vorübergehend das RETURNING entfernen und `[]` zurückgeben,
# ODER in mergeQueueService.approveForMerge() den emitAttentionResolved-Aufruf auskommentieren.
pnpm --filter @sdd/server test attentionResolveEvents
# Erwartung: „Freigabe eines Reviews sendet genau ein Ereignis mit der Item-ID" schlägt fehl
#            (0 statt 1 Ereignis). Danach zurückbauen.
```

### 2c — Kein Nutzdatum, das keine Item-ID ist

```sh
# In orchestrator.resolveGateAttention() vorübergehend die alte Zeile wiederherstellen:
#   bus.emitEvent('attention_resolved', featureId)
pnpm --filter @sdd/server test attentionResolveEvents
# Erwartung: der Test „jedes Nutzdatum ist eine ID aus der attention-Tabelle" (FR-003)
#            schlägt fehl und nennt die featureId. Danach zurückbauen.
```

## Stufe 3: Der gemeldete Fall (US1, SC-001, SC-003)

Instanz starten, Oberfläche öffnen, **ab hier nicht neu laden** (kein F5, kein ⌘R).

1. Feature bis zum Review führen, sodass die Meldung „Review fällig" in der „braucht dich"-Liste
   steht.
2. **Freigeben.** Erwartung: Die Meldung verschwindet ohne Zutun, spürbar unmittelbar (< 1 s,
   SC-003). Zur Messung: DevTools → Network → `/ws/events` → Frames — zwischen dem Frame
   `attention_resolved` und dem Verschwinden liegt ein Render.
3. Integration durchlaufen lassen bis `merged`. Erwartung: Die Liste bleibt frei von Meldungen dieses
   Features; es taucht nichts wieder auf (US1-AS2).
4. **Jetzt** neu laden. Erwartung: Liste unverändert leer — Anzeige und gespeicherter Zustand
   stimmen überein (US1-AS4).
5. Gegenprobe im WS-Frame: das Nutzdatum von `attention_resolved` ist eine 10-stellige Item-ID, keine
   Feature-ID (FR-003).

Für SC-001 („10 von 10") wird Schritt 1–3 zehnmal wiederholt; ein einzelnes Stehenbleiben ist ein
Fehlschlag.

## Stufe 4: Alle Auflösewege (US2, SC-002)

Je Weg: passende Meldung erzeugen, Weg auslösen, **ohne Neuladen** die Anzeige mit
`GET /api/attention` vergleichen. Abgleichhilfe:

```sh
curl -s localhost:4921/api/attention | python3 -c "import json,sys;print(sorted(i['id'] for i in json.load(sys.stdin)))"
```

Erwartung in allen Fällen: dieselbe ID-Menge wie in der Anzeige.

| Weg | Auslösen | Erwartung |
|---|---|---|
| Freigabe eines Reviews | Freigeben im Review-Portal | `review_due` verschwindet (Stufe 3) |
| Zurückweisung eines Reviews | Review zurückweisen | `review_due` verschwindet sofort (US1-AS3) |
| Abschluss nach dem Merge | Integration bis `merged` | alle Merge-Fluss-Meldungen des Features verschwinden |
| Wiederaufnahme einer fehlgeschlagenen Integration | Integration scheitern lassen (z.B. Verify-Kommando auf `exit 1`), dann „Wiederaufnehmen" | `verify_failed`/`gate_failed`/`merge_conflict_escalated` verschwinden (US2-AS1) |
| Freigabe/Verwerfen/Neustart einer Phase | Phase mit `approval_required` bzw. fehlgeschlagenem Gate freigeben, verwerfen, neu starten | Meldung verschwindet (US2-AS2) |
| Wartende Session nimmt Arbeit auf | Agent fragt nach (`awaiting_input`), dann antworten | Meldung verschwindet (US2-AS3) |
| Session endet | Session mit offener Frage beenden | Meldung verschwindet (US2-AS4) |
| Projekt-Chat arbeitet weiter | Chat-Frage beantworten | Meldung verschwindet (US2-AS5) |
| Projekt-Chat-Session endet | Chat-Session beenden | Meldung verschwindet (US2-AS5) |

**Sammel-Fall (US2-AS6)**: Ein Feature mit zwei offenen Meldungen (z.B. `verify_failed` +
`gate_failed`) über „Wiederaufnehmen" gemeinsam auflösen. Erwartung: **beide** verschwinden, im
WS-Log stehen **zwei** `attention_resolved`-Frames mit je einer Item-ID.

**Treffer-Null (US2-AS7)**: Denselben Weg ein zweites Mal auslösen, ohne dass eine Meldung offen ist.
Erwartung: Anzeige unverändert, kein `attention_resolved`-Frame, kein Fehler im Serverlog.

## Stufe 5: Manuelles Wegklicken bleibt unverändert (SC-004, FR-007)

1. Offene Meldung per ✓ wegklicken. Erwartung: verschwindet sofort.
2. Neu laden. Erwartung: bleibt verschwunden.
3. Zehnmal wiederholen (SC-004: 10 von 10).
4. Gegenprobe „schon erledigt": Meldung erst über einen automatischen Weg auflösen lassen, dann
   `curl -s -XPOST localhost:4921/api/attention/<id>/resolve`. Erwartung: Antwort `{"ok":true}`,
   **kein** zweiter `attention_resolved`-Frame (Edge Case „Meldung war schon erledigt").

## Stufe 6: Edge Cases

| Fall | Vorgehen | Erwartung |
|---|---|---|
| Oberfläche nicht verbunden | WS in DevTools offline schalten, Meldung serverseitig auflösen (z.B. Review freigeben), wieder online, neu laden | Meldung ist weg — Sicherheitsnetz greift (FR-008) |
| Auflösung einer nie angezeigten Meldung | `curl -s -XPOST …/api/attention/<fremde-id>/resolve` mit einer ID, die nicht in der Liste steht | Anzeige unverändert, kein Fehler in der Konsole |
| Zwei Oberflächen offen | Zwei Browserfenster, in einem freigeben | In **beiden** verschwindet die Meldung |
| Meldung wird direkt neu erzeugt | Frage beantworten (Meldung löst sich), Agent fragt sofort erneut | Die **neue** Meldung bleibt sichtbar — die Auflösung der Vorgängerin entfernt sie nicht mit |
| Auflösung während des Neuladens | Freigeben und sofort ⌘R | Ergebnis identisch: Meldung weg, nicht doppelt |
| Server-Neustart | Instanz mit offenen Meldungen neu starten (`reapOnBoot`) | Verhalten wie heute; verbleibende Liste = `GET /api/attention` |

## Abnahme-Matrix

| Kriterium | Nachweis |
|---|---|
| SC-001 | Stufe 3, 10 Durchläufe |
| SC-002 | Stufe 4, alle neun Wege + Sammel- und Nulltreffer-Fall |
| SC-003 | Stufe 3.2, WS-Frame → Render |
| SC-004 | Stufe 5, 10 Durchläufe |
| SC-005 | Stufe 2a–2c (rot), Stufe 1 (grün) |
| SC-006 | Stufe 1 (`grep`: kein direkter `emitEvent`) + `attentionResolveEvents.test.ts` |
| FR-007 | Stufe 5 |
| FR-008 | Stufe 6, Zeile 1 |
| FR-009 | Stufe 1, bestehende Suiten grün |
| FR-010 | Stufe 1 + Stufe 2a |
| FR-011 | Stufe 1 + Stufe 4, Sammel-Fall |
