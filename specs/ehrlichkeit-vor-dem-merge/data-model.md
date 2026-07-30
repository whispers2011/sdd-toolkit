# Phase 1 — Datenmodell: Ehrlichkeit vor dem Merge

Kein neues Schema, keine Migration (Begründung: `research.md` D10). Erweitert werden zwei
Aufzählungen, zwei Datenobjekte und ein Anzeigefeld. Alle Zahlen sind Durchreichung bereits
erhobener Werte (FR-022).

---

## 1. Projekt (`Project`, `packages/shared/src/types.ts:96`)

| Feld | Typ | Änderung | Bedeutung für dieses Feature |
|---|---|---|---|
| `verifyCommands` | `VerifyCommand[]` | unverändert | `length === 0` ist der Zustand „keine Verifikation konfiguriert". Er ist die **einzige** Quelle dieses Sachverhalts. |

**Regeln**

- R1.1 Die leere Liste wird nie als Erfolg gelesen (FR-001). Jede Stelle, die heute
  `verifyCommands.length > 0` prüft, behandelt den `else`-Zweig ausdrücklich (heute:
  `mergeQueueService.ts:252` und `:513` — die zweite Stelle ist die Re-Verifikation und bleibt
  unverändert stumm, weil sie keine Anzeige erzeugt).
- R1.2 Die Konfiguration wird nicht erzwungen und nicht validiert (FR-010, Assumption „kein Zwang
  zur Konfiguration").

---

## 2. Feature (`Feature`, `packages/shared/src/types.ts:117`)

| Feld | Typ | Änderung | Bedeutung |
|---|---|---|---|
| `integration` | `IntegrationStage` | **neuer möglicher Wert** `'verification_unconfigured'` | Persistierte Stufe; im Rückblick erkennbar (FR-001a). |
| `tasksDone` | `number` | unverändert | Erledigte Aufgaben aus `tasks.md`. Nur gelesen. |
| `tasksTotal` | `number` | unverändert | Gesamtzahl; `0` = keine Aufgabenliste. Nur gelesen. |

### 2.1 Integrationsstufen (`IntegrationStage`)

```
none
verifying                     (Projekt MIT verifyCommands)
verification_unconfigured     ← NEU (Projekt OHNE verifyCommands)
verify_failed
review_gate
gate_failed
awaiting_human_review
queued
merging
conflict_resolving
conflict_escalated
merged
```

Die neue Stufe steht **anstelle** von `verifying`, nicht daneben: ein Feature durchläuft genau eine
der beiden.

### 2.2 Zustandsübergänge (Ergänzung zum bestehenden Ablauf)

```
none
 └─ beginIntegration(), Vorprüfungen bestanden
     ├─ verifyCommands.length > 0 → verifying ──────────────┐
     └─ verifyCommands.length = 0 → verification_unconfigured┤
                                                            │
   (Punkt der Verifikation: nur im verifying-Zweig läuft runVerification;
    im unkonfigurierten Zweig entsteht hier einmal je Projekt der
    Aufmerksamkeits-Eintrag — siehe 3.)
                                                            │
     ┌──────────────────────────────────────────────────────┘
     ├─ autoReviewAgents → review_gate → (gate_failed | weiter)
     ├─ autoMerge        → queued → merging → merged
     └─ sonst            → awaiting_human_review → (queued …)

Abzweigungen aus beiden Stufen unverändert:
 reconcile() = 'merged' → merged        (kein Verifikations-Anspruch, Edge Case)
 reconcile() = 'lost'   → conflict_escalated
 Ausnahme im try-Block  → verify_failed
```

**Regeln**

- R2.1 `verification_unconfigured` blockiert nichts und eskaliert nichts (FR-010, SC-005). Der
  Weiterlauf ist identisch zum Fall „konfiguriert und grün".
- R2.2 Stufenklasse: `STAGE_CLASS['verification_unconfigured'] = 'active'`
  (`actionPolicy.ts:93`) — dieselbe Klasse wie `verifying`, damit die Aktions-Policy unverändert
  entscheidet (research D11).
- R2.3 Herkunft im Lebenszyklus: `INTEGRATION_STAGE_ORIGIN['verification_unconfigured'] =
  'integration'` (`lifecycleCatalog.ts:546`).
- R2.4 Beschriftung ausschließlich aus `INTEGRATION_STAGE_META`
  (`label: 'keine Verifikation konfiguriert'`, `tone: 'human'`). Kein Rohbezeichner in einer
  Oberfläche (FR-002, research D9).
- R2.5 `verify_failed` bleibt unerreichbar aus `verification_unconfigured` heraus über eine
  Verifikation — dieselbe Stufe entsteht dort nur noch aus einer Ausnahme (`catch`), was
  unverändertes Verhalten ist.

---

## 3. Aufmerksamkeits-Eintrag (`AttentionItem`, `packages/shared/src/types.ts:234`)

| Feld | Wert für die neue Art | Bemerkung |
|---|---|---|
| `kind` | `'verification_unconfigured'` (**neu** in `AttentionKind`) | |
| `projectId` | Projekt mit leeren `verifyCommands` | Trägerobjekt der Meldung |
| `featureId` | `null` | **projektbezogen**, nicht feature-bezogen (Assumption der Spec, FR-006) |
| `sessionId` / `conversationId` | `null` | |
| `message` | `'<Projektname>: Projekt hat keine Verifikation konfiguriert — Features werden ungeprüft integriert.'` | Wortlaut nach FR-004 |

### 3.1 Lebenszyklus

```
(kein Eintrag)
   │  Integrationsversuch erreicht den Punkt der Verifikation
   │  UND verifyCommands ist leer
   │  UND attention.hasEver(kind, projectId) === false
   ▼
offen ──── Mensch hakt ab (POST /api/attention/:id/resolve) ───▶ aufgelöst
   │                                                               │
   │  verifyCommands ≥ 1 (Reconcile-Durchlauf)                     │  verifyCommands ≥ 1
   ▼                                                               ▼
gelöscht  (attention.forget) ────────────────────────────────▶ gelöscht
   │
   └─ danach: verifyCommands wieder leer + nächster Integrationsversuch
      ⇒ neuer Eintrag (Edge Case „Kommandos nachträglich entfernt")
```

**Regeln**

- R3.1 Höchstens ein Eintrag je Projekt und Lücken-Episode (FR-005). Durchgesetzt über
  `hasEver({kind, projectId})` — nicht über die Offen-Dedup von `raise()`, die einen abgehakten
  Eintrag erneut entstehen ließe.
- R3.2 Der Eintrag ist unabhängig vom Stand einzelner Features (FR-006). Technisch garantiert durch
  `featureId === null`: die stufengekoppelte Bereinigung in `MergeQueueService.setStage()`
  (`mergeQueueService.ts:732-739`) überspringt Einträge fremder/leerer `featureId`, und
  `STAGE_FOR_KIND` erhält bewusst **keinen** Eintrag.
- R3.3 Auflösung ohne menschliches Zutun, sobald mindestens ein Verifikationskommando konfiguriert
  ist (FR-007). Ort: `Orchestrator.reconcileOpenAttention()`, das auf dem Lesepfad läuft.
- R3.4 Abhaken löst genau die Meldung auf — Stufe, Meldungen und Review-Portal führen den Zustand
  weiter (Clarification). Es gibt keinen Code-Pfad, der aus dem Abhaken eine Verifikation macht.
- R3.5 `isAttentionValid()` führt die Art als eigenen `case` (Rückgabe `true`); ihre Gültigkeit
  kommt aus der Projektkonfiguration, nicht aus Session- oder Stufenzustand.
- R3.6 Beschriftung in der Inbox: `KIND_META` ist `Record<AttentionKind, …>`
  (`AttentionInbox.tsx:8`) — der Typecheck erzwingt Label/Icon/Ton.

### 3.2 Neue Repo-Operationen (`AttentionRepo`, `packages/server/src/db/repos.ts:706`)

| Operation | Signatur | Semantik |
|---|---|---|
| `hasEver` | `({ kind, projectId }) => boolean` | Existiert **irgendeine** Zeile (offen oder aufgelöst) dieser Art für das Projekt? |
| `forget` | `({ kind, projectId }) => string[]` | Löscht alle Zeilen dieser Art des Projekts; liefert die IDs der zuvor offenen (für `attention_resolved`). |

Beide sind nach `kind` parametrisiert und damit nicht auf diese Art beschränkt; sie fügen dem
Schema nichts hinzu.

---

## 4. Review-Übersicht-Eintrag (`ReviewOverviewItem`, `packages/shared/src/types.ts:541`)

| Feld | Typ | Änderung |
|---|---|---|
| `verify.status` | `'passed' \| 'failed' \| 'none' \| 'unconfigured'` | **neuer Wert** `'unconfigured'` (FR-009) |
| `feature` | `Feature` | unverändert — trägt `tasksDone`/`tasksTotal` für FR-012 in der Übersicht |

**Regeln**

- R4.1 Ermittlungsreihenfolge (research D6): abgeschlossene `verify`-Execution schlägt Konfiguration.
  Ein Projekt, dessen Kommandos nach einem grünen Lauf entfernt wurden, zeigt weiterhin den Lauf.
- R4.2 `'unconfigured'` und `'none'` müssen sich im Text unterscheiden (FR-009); die Oberfläche
  liest über eine `Record<Status, …>`-Tabelle, damit ein weiterer Wert nicht stumm in den
  Rest-Zweig fällt.
- R4.3 Die Stufenbezeichnung der Zeile fällt auf `INTEGRATION_STAGE_META` zurück statt auf den
  Rohwert (research D9).

---

## 5. Lauf-Zusammenfassung (`RunSummary`, `packages/shared/src/runSummary.ts:44`)

| Feld | Typ | Änderung | Quelle |
|---|---|---|---|
| `tasksDone` | `number` | **neu** | `feature.tasksDone` (Kopie in `buildOne()`) |
| `tasksTotal` | `number` | **neu** | `feature.tasksTotal` |

Abgeleitete Grösse — **kein Feld**:

```ts
costPerTask(run): { micros: number | null; incomplete: boolean }
```

| Fall | `micros` | `incomplete` |
|---|---|---|
| `tasksDone === 0` | `null` (Strich, FR-020) | `runsWithoutCost > 0` |
| `tasksDone > 0`, kein Betrag gemeldet (`costMicros === 0`) | `null` (Strich, Edge Case) | `true` |
| `tasksDone > 0`, Betrag vorhanden | `round(costMicros / tasksDone)` | `runsWithoutCost > 0` |
| `tasksDone > tasksTotal` (widersprüchlich) | wie oben, Rohwerte | wie oben |

**Regeln**

- R5.1 `tasksTotal === 0` wird als „keine Aufgabenliste" angezeigt, nie als „0 von 0 erledigt"
  (FR-013 sinngemäß, Story-3-Szenario 6).
- R5.2 Läufe-Liste und Lauf-Dashboard zeigen denselben Wert, weil beide dieselbe Funktion aufrufen
  (FR-019). Das Dashboard ist die aufgeklappte `RunCard`, die auch `FeatureDashboard.tsx:105`
  verwendet — die Ergänzung erscheint dort ohne Zusatzarbeit.
- R5.3 Archivierte Läufe verhalten sich identisch (Edge Case) — `buildRunSummaries` filtert nicht.
- R5.4 Keine neue Zählstelle: beide Felder sind Kopien, `costPerTask` ist eine Division (SC-008).

---

## 6. Meldungstexte (`packages/shared/src/integrationMessages.ts`, neu)

Keine Entität, aber Teil des Vertrags — vollständige Signaturen in `contracts/domain.md`.

| Funktion | Gelesene Felder | Verwendet in |
|---|---|---|
| `taskProgressText` | `tasksDone`, `tasksTotal` | beide Meldungen, Oberflächen |
| `reviewDueMessage` | `name`, `tasksDone`, `tasksTotal` + `verificationConfigured` | `mergeQueueService.ts:296` |
| `mergedNotificationBody` | `name`, `tasksDone`, `tasksTotal` + Zielbranch | `mergeQueueService.ts:566` und `:620` |

**Regeln**

- R6.1 Für Projekte MIT Verifikation bleibt der Verifikationsteil wortgleich zum heutigen Text
  (FR-011); ergänzt wird ausschließlich der Aufgabenstand.
- R6.2 Für Projekte OHNE Verifikation enthält der Text weder „verifiziert" noch „Verifikation
  läuft" (FR-003, SC-001).
- R6.3 Der Aufgabenstand steht in **jeder** `review_due`-Meldung, unabhängig von der
  Verifikationskonfiguration (Clarification zu FR-011/FR-012).
