# Contract — HTTP-API

Ergänzt [action-policy.md](./action-policy.md) um die serverseitige Durchsetzung (FR-024) und die Routen-Änderungen. Fehlerantworten folgen dem bestehenden Muster (`httpError(status, message)` → Body mit `message`; der Client liest `JSON.parse(text).message`).

---

## 1. Entfernte Routen (ersatzlos)

| Methode | Pfad | Bisher | Nachher | Anforderung |
|---|---|---|---|---|
| `POST` | `/api/features/:id/mark-done` | setzte `integration = 'merged'`, beendete die Session | **existiert nicht mehr** → 404 | FR-016 |
| `POST` | `/api/features/:id/advance` | approvte alle Schritte bis zum Ziel und startete die Zielphase | **existiert nicht mehr** → 404 | FR-029 |

Mit entfernt werden: `api.markDone` / `api.advance` (`packages/web/src/api.ts`), `Orchestrator.advanceTo()` und der Menüeintrag „✓ Als abgeschlossen markieren" auf der Board-Karte. Es bleiben keine Aufrufer zurück (im Repo verifiziert).

---

## 2. Neue Route

### `GET /api/features/:id/integration-readiness`

Liefert den einzigen Fakt, den die UI nicht aus ihrem Zustand ableiten kann (FR-027).

**Antwort 200**

```json
{ "hasChanges": true }
```

| Feld | Typ | Bedeutung |
|---|---|---|
| `hasChanges` | `boolean` | Das Arbeitsverzeichnis enthält Änderungen gegenüber dem Zielstand — `files.length > 0 \|\| commits.length > 0` aus `collectUnmergedChanges(worktreePath, feature.integrationTarget ?? project.defaultBranch)` |

**Fehler**

| Status | Fall |
|---|---|
| 404 | Feature oder Projekt nicht gefunden |
| 200 mit `hasChanges: false` | Kein Arbeitsverzeichnis vorhanden oder Worktree nicht lesbar (die Integrations-Aktion ist in diesem Fall ohnehin `hidden`) |

**Aufrufregel der UI**: nur für Features, für die `isFeatureComplete(phases) && integration === 'none' && !archived && hasWorktree` gilt. Das Ergebnis wird je Feature im Store gehalten und bei `feature_updated` für dieses Feature verworfen. Solange kein Ergebnis vorliegt, ist `hasChanges: 'unknown'` — die Aktion bleibt auslösbar und der Server lehnt notfalls ab.

---

## 3. Bewachte Routen (FR-024)

Jede dieser Routen ruft vor jeder Wirkung `assertAllowed(action, featureId)` aus `packages/server/src/services/actionGuard.ts`. Ist der Befund nicht `available`, antwortet sie mit **409 Conflict** und dem Grundsatz aus der Policy — wortgleich zu dem, was die UI anzeigt.

| Methode | Pfad | Geprüfte Aktion |
|---|---|---|
| `POST` | `/api/features/:id/phases/:phase/start` | `phase_start` (mit `phase`) |
| `POST` | `/api/features/:id/phases/:phase/approve` | `phase_approve` (mit `phase`) |
| `POST` | `/api/features/:id/phases/:phase/discard` | `phase_discard` (mit `phase`) |
| `POST` | `/api/features/:id/integrate` | `integrate` — inklusive serverseitig ermitteltem `hasChanges` |
| `POST` | `/api/features/:id/retry-integration` | `integration_retry` |
| `POST` | `/api/features/:id/approve-merge` | `review_approve` |
| `POST` | `/api/features/:id/reject-review` | `review_reject` |
| `POST` | `/api/features/:id/archive` | `archive` |

`DELETE /api/features/:id` bleibt **ungeschützt** — Löschen ist nach FR-008 eine Aufräum-Aktion mit Rückfrage in der UI, keine gesperrte Aktion.

**Beispiel einer Ablehnung**

```
POST /api/features/f_42/integrate
→ 409 Conflict
{ "message": "Erst integrierbar, wenn alle aktiven Schritte freigegeben sind." }
```

**Garantie nach FR-004**: Bei einer Ablehnung wird der Feature-Zustand nicht verändert und im Arbeitsverzeichnis nichts festgeschrieben. Die Prüfung liegt vor jedem `setIntegration`, vor `reconcile()` und vor `commitWorktree()`.

**Kontextaufbau im Guard**

```ts
buildContext(featureId): FeatureActionContext
// phases/integration/archived/hasWorktree  ← FeatureRepo
// session   ← displayStatus(ptys.forFeature(featureId)?.machine.state) ?? null
// gateRunning ← orchestrator.isGateRunning(featureId)   (neuer Accessor über `runningGates`)
// hasChanges  ← 'unknown', außer die Route reicht den ermittelten Wert herein
```

---

## 4. Geändertes Verhalten bestehender Routen

### `POST /api/features/:id/reject-review` (FR-020 / FR-026 / FR-021)

Zusätzlich zum heutigen Verhalten (`setIntegration('none')`, `setIntegrationTarget(null)`, offene Kommentare + Freitext als Prompt in die Feature-Konsole):

1. `savePhases(reopenLastPhase(feature.phases).phases)` — der letzte aktive Schritt geht auf `awaiting_review` zurück.
2. `setReviewRejected(featureId, Date.now())`.
3. **Keine** Folgeeffekte: kein Auto-Progress, kein automatischer Integrationsstart (FR-021).
4. `feature_updated` wird wie bisher emittiert — Board und Konsole aktualisieren sich ohne Neuladen (FR-023).

### `POST /api/features/:id/phases/:phase/approve`

Ist `feature.reviewRejectedAt !== null` und der freigegebene Schritt der letzte aktive, wird `setReviewRejected(featureId, null)` gesetzt. Die anschließende Integration läuft über den unveränderten Weg (`approvePhase` → `start_integration` bei `autoVerify`, sonst manuell) und beginnt damit vollständig neu (FR-026).

### `POST /api/features/:id/integrate` und `MergeQueueService.beginIntegration()`

`beginIntegration()` erhält die Signatur `Promise<{ started: boolean; reason?: string }>` und prüft **vor** `reconcile()`:

```
1. integration !== 'none'          → { started: false, reason: "Das Feature ist bereits in der Integration — …" }
2. kein Worktree                   → { started: false, reason: "Kein Arbeitsverzeichnis vorhanden." }
3. keine Änderungen (FR-027)       → { started: false, reason: "Keine Änderungen zu integrieren." }
4. sonst → reconcile() → setStage('verifying') → commitWorktree() → …
```

Damit gilt der Schutz auch für den automatischen Pfad (`PhaseEffect start_integration` bei `autoVerify`), der keine Route durchläuft. Zugleich schließt Schritt 3 die bestehende Falle, dass ein änderungsfreier Branch in `reconcile()` als „bereits gemergt" erkannt und über `finalizeMerged()` auf `merged` gesetzt wird — ein zweiter Weg in den Endzustand, den SC-003 ausschließt.

### `POST /api/features/:id/archive` (FR-017)

Unverändert in der Wirkung, aber nun für jedes nicht archivierte Feature aufrufbar (bisher bot nur die Done-Spalte den Einstieg an). Die UI beschriftet die Aktion als Aufräumen und nicht als Abschluss.

---

## 5. DTO-Änderung

`Feature` (`packages/shared/src/types.ts`) erhält ein Feld:

```ts
/** Zeitpunkt der letzten Zurückweisung im Review; null = keine offene Zurückweisung (FR-026). */
reviewRejectedAt: number | null;
```

Es wird in `/api/state` und in jedem `feature_updated`-Ereignis mitgeliefert. Persistenz: Spalte `features.review_rejected_at` (siehe [data-model.md](../data-model.md#5-persistenz-änderung)).

---

## 6. Unveränderte Zusagen

- Die Stufen und die Reihenfolge der Integrations-Pipeline bleiben identisch.
- Die Automation-Einstellungen (`autoProgressUntil`, `autoVerify`, `autoReviewAgents`, `autoMerge`, `autoMode`) und ihre Auflösung global → Projekt → Feature bleiben unverändert.
- WebSocket-Ereignisse (`feature_updated`, `session_status`, `agent_gate`, `queue_updated`, `attention_*`) bleiben unverändert — sie sind bereits die Grundlage für FR-023.
- Betrachtende Routen (Diff, Dateien, Kommentare, Artefakte, Prompt an die Session, Executions) bleiben ungeschützt und uneingeschränkt verfügbar (FR-007).
