# Vertrag: geteilte Domäne (`@sdd/shared`)

Was Server und Oberfläche gemeinsam als wahr voraussetzen. Änderungen hier brechen `pnpm typecheck`
in beiden Paketen — das ist der Zweck (FR-001a).

---

## 1. Aufzählungen

```ts
// packages/shared/src/types.ts
export type IntegrationStage =
  | 'none'
  | 'verifying'
  | 'verification_unconfigured'   // NEU
  | 'verify_failed'
  | 'review_gate'
  | 'gate_failed'
  | 'awaiting_human_review'
  | 'queued'
  | 'merging'
  | 'conflict_resolving'
  | 'conflict_escalated'
  | 'merged';

export type AttentionKind =
  | 'awaiting_input'
  | 'permission_request'
  | 'verify_failed'
  | 'gate_failed'
  | 'merge_conflict_escalated'
  | 'review_due'
  | 'verification_unconfigured'   // NEU (projektbezogen: featureId === null)
  | 'agent_errored'
  | 'run_interrupted'
  | 'phase_gate_failed'
  | 'approval_required';
```

**Pflichten, die daraus folgen** (jeweils compile-erzwungen):

| Katalog | Datei | Eintrag |
|---|---|---|
| `INTEGRATION_STAGE_META` | `workflowModel.ts:171` | `verification_unconfigured: { label: 'keine Verifikation konfiguriert', tone: 'human' }` |
| `STAGE_CLASS` | `actionPolicy.ts:93` | `verification_unconfigured: 'active'` |
| `INTEGRATION_STAGE_ORIGIN` | `lifecycleCatalog.ts:546` | `verification_unconfigured: 'integration'` |
| `KIND_META` | `web/components/AttentionInbox.tsx:8` | `verification_unconfigured: { label: 'Verifikation fehlt', icon: '⚠', tone: 'text-amber-400' }` |

**Nicht** zu ergänzen: `STAGE_FOR_KIND` (`server/services/attentionReconciler.ts:22`) — die neue
Art ist projektbezogen und darf nicht an eine Stufe gekoppelt werden (FR-006).

**Invarianten**

- INV-1 `INTEGRATION_STAGE_META[stage].label` ist für jede Stufe nicht leer (bestehender Test
  `workflowModel.test.ts:52`).
- INV-2 Für `verification_unconfigured` enthält kein Label und kein abgeleiteter Text die Zeichen­folge
  „verifiziert" oder „Verifikation läuft" (SC-001).
- INV-3 `RETRYABLE_STAGES` bleibt unverändert — die neue Stufe ist kein Fehlzustand.

---

## 2. Meldungstexte (neues Modul)

```ts
// packages/shared/src/integrationMessages.ts   (pur, keine IO)
import type { Feature } from './types.js';

type TaskCounts = Pick<Feature, 'tasksDone' | 'tasksTotal'>;
type NamedFeature = Pick<Feature, 'name' | 'tasksDone' | 'tasksTotal'>;

/**
 * Aufgabenstand als Satzteil. Ohne Aufgabenliste wird das benannt, statt „0/0" zu zeigen (FR-013).
 */
export function taskProgressText(f: TaskCounts): string;

/** Meldung, mit der ein Feature zum menschlichen Review gerufen wird (FR-003, FR-012, FR-013). */
export function reviewDueMessage(
  f: NamedFeature,
  opts: { verificationConfigured: boolean },
): string;

/** Text der Meldung über den vollzogenen Merge bzw. den erstellten PR (FR-012a). */
export function mergedNotificationBody(f: NamedFeature, target: string): string;
```

### Zugesicherte Ausgaben

| Eingabe | `taskProgressText` |
|---|---|
| `{ done: 68, total: 76 }` | `68/76 erledigt, 8 offen` |
| `{ done: 76, total: 76 }` | `76/76 erledigt, keine offen` |
| `{ done: 0, total: 76 }` | `0/76 erledigt, 76 offen` |
| `{ done: 0, total: 0 }` | `keine Aufgabenliste vorhanden` |
| `{ done: 80, total: 76 }` | `80/76 erledigt, keine offen` (Rohwerte, offene nie negativ) |

| Fall | `reviewDueMessage` |
|---|---|
| `verificationConfigured: true` | `<name>: verifiziert — bereit für dein Review & Merge · <taskProgressText>` |
| `verificationConfigured: false` | `<name>: keine Verifikation konfiguriert — es wurde nichts geprüft; bereit für dein Review & Merge · <taskProgressText>` |

| Fall | `mergedNotificationBody` |
|---|---|
| immer | `<name> → <target> · <taskProgressText>` |

**Invariante INV-4**: der Teil vor `·` ist bei `verificationConfigured: true` zeichengleich mit dem
heutigen Text aus `mergeQueueService.ts:296` (FR-011).

---

## 3. Lauf-Zusammenfassung

```ts
// packages/shared/src/runSummary.ts
export interface RunSummary {
  // … unverändert …
  /** Aufgabenstand des zugehörigen Features (Durchreichung, FR-017). */
  tasksDone: number;
  tasksTotal: number;
}

export interface CostPerTask {
  /** Mikro-USD je erledigter Aufgabe; null = nicht bestimmbar (Strich, FR-020/FR-021). */
  micros: number | null;
  /** Mindestens eine Ausführung des Laufs hat keinen Betrag gemeldet (FR-021). */
  incomplete: boolean;
}

/** Bezugsgrösse: gemeldeter Betrag je ERLEDIGTER Aufgabe. Nie geschätzt. */
export function costPerTask(run: Pick<RunSummary, 'total' | 'tasksDone'>): CostPerTask;
```

**Invarianten**

- INV-5 `costPerTask({ tasksDone: 0, … }).micros === null` — kein Wert, keine Schätzung, kein Fehler.
- INV-6 `total.costMicros === 0` ⇒ `micros === null` (nie `0`).
- INV-7 `costPerTask` ist rein aus `RunSummary` bestimmt; Läufe-Liste und Lauf-Dashboard rufen
  dieselbe Funktion (FR-019).
- INV-8 `buildRunSummaries()` liest ausschließlich vorhandene Felder — keine neue Erhebung (SC-008).

---

## 4. Review-Übersicht

```ts
// packages/shared/src/types.ts
export interface ReviewOverviewItem {
  // … unverändert …
  verify: {
    status: 'passed' | 'failed' | 'none' | 'unconfigured'; // 'unconfigured' NEU (FR-009)
    executionId?: string;
  };
}
```

**Vertrag der Belegung** (Server, `api/reviewRoutes.ts`):

1. abgeschlossene `verify`-Execution vorhanden ⇒ `'passed'` / `'failed'` + `executionId`
2. sonst `project.verifyCommands.length === 0` ⇒ `'unconfigured'`
3. sonst ⇒ `'none'`

**Vertrag der Anzeige** (Web): Beschriftung über eine vollständige
`Record<ReviewOverviewItem['verify']['status'], …>`-Tabelle; `'unconfigured'` und `'none'` haben
unterschiedliche Texte (FR-009). Vorgeschlagene Texte: `Verify ✓` · `Verify ✗` ·
`Verify – (kein Lauf)` · `Verify nicht konfiguriert`.
