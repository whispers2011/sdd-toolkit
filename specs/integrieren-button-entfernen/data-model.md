# Phase 1 — Datenmodell

Die drei Schlüssel-Entitäten der Spec (**Feature-Zustand**, **Aktion**, **Aktionsbefund**) werden hier auf konkrete Typen abgebildet. Alle drei leben in `packages/shared/src/actionPolicy.ts`, außer wo anders vermerkt.

---

## 1. Feature-Zustand → `FeatureActionContext`

Der vollständige und **einzige** Eingabewert jeder Entscheidung über Sichtbarkeit und Sperrung. Er ist bewusst ein flaches Datenobjekt ohne Verweise auf Repos, Sessions oder React — dadurch kann ihn Web (aus dem Store) wie Server (aus Repos + PTY-Manager) identisch aufbauen.

```ts
export interface FeatureActionContext {
  /** Nur die im Projekt aktiven Schritte (feature.phases enthält bereits nur diese). */
  phases: PhaseMap;
  integration: IntegrationStage;
  /** Feature ist archiviert (feature.archivedAt !== null). */
  archived: boolean;
  /** Arbeitsverzeichnis vorhanden (feature.worktreePath !== null). */
  hasWorktree: boolean;
  /** Anzeigestatus der lebenden Session; null = keine lebende Session. */
  session: SessionDisplayStatus | null;
  /** Ein Agenten-Gate (before_phase/after_phase) läuft für dieses Feature. */
  gateRunning: boolean;
  /** Vorprüfung nach FR-027; 'unknown' = noch nicht ermittelt (sperrt nicht). */
  hasChanges: boolean | 'unknown';
}
```

### Herkunft der Felder

| Feld | Web (`store.tsx`) | Server |
|---|---|---|
| `phases` | `feature.phases` | `features.get(id).phases` |
| `integration` | `feature.integration` | `features.get(id).integration` |
| `archived` | `feature.archivedAt !== null` | dito |
| `hasWorktree` | `feature.worktreePath !== null` | dito |
| `session` | `state.app.sessions.find(s => s.featureId === id && !s.exited)?.status ?? null` | `displayStatus(ptys.forFeature(id)?.machine.state)` |
| `gateRunning` | `state.gateRunning[id] === true` | `orchestrator.isGateRunning(id)` *(neuer Accessor über `runningGates`)* |
| `hasChanges` | Bereitschafts-Cache, sonst `'unknown'` | `collectUnmergedChanges(worktree, ziel)` |

### Abgeleitete Prädikate

```ts
/** FR-001: fertig = jeder aktive Schritt ist freigegeben. Ein als stale markierter
 *  Schritt gilt weiterhin als freigegeben (Annahme der Spec). Ohne Schritte: nicht fertig. */
export function isFeatureComplete(phases: PhaseMap): boolean;

/** FR-005: ein Satz, warum gerade gearbeitet wird — oder null. */
export function busyReason(ctx: FeatureActionContext): string | null;

/** FR-025: Klassifikation aller 11 Integrationsstufen. */
export type StageClass = 'idle' | 'active' | 'decision' | 'terminal';
export const STAGE_CLASS: Record<IntegrationStage, StageClass>;
```

`busyReason` liefert genau **einen** Satz, in dieser Prioritätsfolge (der erste Treffer gewinnt — der Bedienende soll den nächstliegenden Grund lesen, nicht alle):

| # | Bedingung | Satz |
|---|---|---|
| 1 | ein Schritt hat `status === 'running'` | „Es wird gerade gearbeitet — Schritt „«phase»" läuft." |
| 2 | `session === 'working'` | „Es wird gerade gearbeitet — die Session läuft." |
| 3 | `session === 'awaiting_input'` | „Die Session wartet auf eine Eingabe." |
| 4 | `gateRunning` | „Ein Qualitäts-Gate läuft." |
| 5 | `STAGE_CLASS[integration] === 'active'` | „Die Integration läuft — «Stufen-Label»." |
| – | sonst | `null` |

Das Stufen-Label stammt aus dem vorhandenen `INTEGRATION_STAGE_META` (`workflowModel.ts`), damit Stufenbezeichnungen nicht ein zweites Mal getextet werden.

---

## 2. Aktion → `FeatureActionId`

```ts
export type FeatureActionId =
  | 'phase_start'        // ▶ Schritt starten
  | 'phase_approve'      // ✓ Schritt freigeben
  | 'phase_discard'      // ↺ Schritt verwerfen
  | 'integrate'          // ⇥ Integrieren
  | 'integration_retry'  // ↻ Integration erneut anstoßen
  | 'review_approve'     // ✓ Freigeben & Integrieren (Portal)
  | 'review_reject'      // ✗ Zurückweisen (Portal)
  | 'archive'            // 🗄 Archivieren
  | 'delete';            // Feature löschen
```

Schrittbezogene Aktionen brauchen zusätzlich die betroffene Phase:

```ts
export function evaluateAction(
  action: FeatureActionId,
  ctx: FeatureActionContext,
  opts?: { phase?: FeaturePhase },
): ActionVerdict;
```

**Nicht** Teil dieser Aufzählung — bewusst, weil rein betrachtend (FR-007) und damit immer verfügbar: Review-Portal öffnen, Ergebnisse/Artefakte ansehen, Diff und Historie lesen, Datei im Editor öffnen, Pfad kopieren, Kommentare erfassen, Prompt an die laufende Session senden. Diese Bedienelemente werden von der Policy nicht berührt.

---

## 3. Aktionsbefund → `ActionVerdict`

```ts
export type ActionAvailability = 'available' | 'blocked' | 'hidden';

export interface ActionVerdict {
  availability: ActionAvailability;
  /** Ein Satz; null genau dann, wenn availability === 'available'. */
  reason: string | null;
  /** Rückfrage muss auf den Abbruch laufender Arbeit hinweisen (FR-008). */
  confirmAbortsWork: boolean;
}
```

**Invariante** (im Test abgesichert): `reason === null` ⟺ `availability === 'available'`. Auch `hidden` trägt einen Grund — die UI *zeigt* ihn nur bei `blocked` an (FR-028), der Server nutzt ihn in beiden Fällen als Ablehnungstext, damit ein auf anderem Weg ausgelöster Start verständlich gemeldet wird (FR-003).

**Unterscheidung `hidden` vs. `blocked`** (FR-009, US4, Annahme „Gesperrt statt ausgeblendet"):
- `hidden` = im aktuellen Zustand **grundsätzlich sinnlos** (die Aktion hätte keine Bedeutung — z. B. „Integrieren" an einem Feature, das noch drei offene Schritte hat).
- `blocked` = grundsätzlich richtig, **gerade** verhindert (z. B. „Integrieren" an einem fertigen Feature, dessen Session noch arbeitet).

---

## 4. Zustandsübergänge

### 4.1 Zurückweisung im Review (FR-020 / FR-026 / FR-021)

```
                    ┌ integration: awaiting_human_review
  vor der Abweisung ┤ letzter Schritt: approved
                    └ reviewRejectedAt: null

        │ POST /api/features/:id/reject-review
        ▼
                    ┌ integration: none            (Karte zurück in die Entwicklungs-Spalte)
  nach der Abweisung┤ integrationTarget: null
                    │ letzter Schritt: awaiting_review   ← reopenLastPhase(), keine Effekte
                    └ reviewRejectedAt: <jetzt>    (Hinweis bleibt sichtbar)

        │ Korrektursession arbeitet → Feature ist beschäftigt → keine Aktion auslösbar
        │ POST /api/features/:id/phases/<letzter>/approve
        ▼
                    ┌ letzter Schritt: approved → Feature gilt wieder als fertig
  nach der Freigabe ┤ reviewRejectedAt: null
                    └ Integration startet frisch: verifying → [review_gate] → awaiting_human_review
```

Wird ohne Kommentar und ohne Freitext zurückgewiesen, startet keine Korrektursession (bestehendes Verhalten in `reject-review`); der letzte Schritt steht trotzdem auf `awaiting_review` und ist sofort erneut freigebbar (Edge Case der Spec).

### 4.2 Integrationsstart (FR-004 / FR-027)

```
  integrate angefordert (Schaltfläche, Kartenzug oder API)
        │
        ├─ Feature nicht fertig?            → 409 „Erst wenn alle Schritte freigegeben sind."   ─┐
        ├─ integration !== 'none'?          → 409 „Das Feature ist bereits in der Integration."  ├─ Zustand
        ├─ beschäftigt?                     → 409 «busyReason»                                   ├─ und Worktree
        ├─ keine Änderungen (FR-027)?       → 409 „Keine Änderungen zu integrieren."             ├─ bleiben
        └─ sonst → beginIntegration(): setStage('verifying') → commitWorktree() → …             ─┘ unberührt
```

Die vier Ablehnungen greifen **vor** jeder Zustandsänderung und vor `commitWorktree()` — das ist der Kern von FR-004.

### 4.3 Feature-Lebenszyklus im Überblick (nach diesem Feature)

```
  in Arbeit ──(alle aktiven Schritte freigegeben)──► fertig
                                                      │
                                          integrate ──┤
                                                      ▼
                        verifying ──► [review_gate] ──► awaiting_human_review
                            │              │                    │
                    verify_failed    gate_failed        ┌───────┴────────┐
                            │              │       freigeben        zurückweisen
                            └──── retry ───┘            │                │
                                                        ▼                ▼
                                              queued ► merging ► merged  in Arbeit
                                                        │                (letzter Schritt
                                                conflict_resolving        wieder offen)
                                                        │
                                              conflict_escalated ── retry ─┐
                                                                           │
  jederzeit (nicht archiviert): archivieren / löschen  ── Aufräumen, kein Abschluss
```

Genau **ein** Pfeil führt in `merged` (SC-003). Der frühere Direktpfeil „Als abgeschlossen markieren" existiert nicht mehr.

---

## 5. Persistenz-Änderung

| Tabelle | Spalte | Typ | Zweck |
|---|---|---|---|
| `features` | `review_rejected_at` | `INTEGER` (nullable) | FR-026 — Zeitpunkt der letzten Zurückweisung; `NULL` = keine offene Zurückweisung |

Umsetzung als neuer Eintrag am Ende des `MIGRATIONS`-Arrays in `packages/server/src/db/database.ts` (`user_version`-gesteuert, append-only — das etablierte Muster). Abbildung in `FeatureRow`/`toFeature` in `repos.ts` plus ein Setter `setReviewRejected(id, ts | null)`.

**Bestandsdaten** (Annahme der Spec „Bestehende Features bleiben gültig"): Die Spalte ist für alle vorhandenen Zeilen `NULL`. Features, die früher per „Als abgeschlossen markieren" auf `merged` gesetzt wurden, bleiben unverändert `merged`; die neuen Regeln greifen ab dem nächsten Zustandswechsel.
