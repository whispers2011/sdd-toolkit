# Phase 1 — Datenmodell

**Feature**: Ersetzbare Kernschritte, Stack-Profile und Testing-Lane

Alle Typen liegen in `packages/shared/src/types.ts`, alle Tabellen in einer additiven Migration am
Ende von `MIGRATIONS` (`packages/server/src/db/database.ts`). Die Entitäten folgen den sieben
„Key Entities" der [spec.md](./spec.md).

---

## 1. Portbereich (`PortBlock`)

Der einem Worktree — oder einem Projekt, für geteilte Dienste — zugewiesene exklusive Block von
Ports. **Einzige Quelle der Portvergabe** (FR-001).

```ts
export type PortBlockOwnerKind = 'worktree' | 'project';

export interface PortBlock {
  ownerKind: PortBlockOwnerKind;
  /** worktree: kanonischer Pfad (realpath); project: projectId. */
  ownerId: string;
  /** Immer gesetzt — auch bei ownerKind 'worktree' (Zuordnung in der Übersicht). */
  projectId: string;
  /** Anfang des Blocks; $SDD_PORT_BASE. */
  base: number;
  /** Breite; zum Zeitpunkt der Zuweisung festgehalten, damit eine Änderung der
   *  Vorgabe bestehende Blöcke nicht rückwirkend verschiebt. */
  span: number;
  allocatedAt: number;
  /** null = belegt; gesetzt = freigegeben und wiederverwendbar (FR-005). */
  releasedAt: number | null;
}
```

**Regeln**

| Regel | Quelle |
|---|---|
| Ein Block wird beim Anlegen des Worktrees zugewiesen — in `WorktreeManager.create()`, sonst nirgends | FR-001 |
| Blöcke belegter Besitzer überschneiden sich nie, projektübergreifend | FR-002 |
| Vor der Zuweisung wird **jeder** Port des Blocks probeweise gebunden; ein belegter Port verwirft den Block | FR-003 |
| `base`/`span` ändern sich für einen bestehenden Besitzer nie | FR-004 |
| Freigabe in `WorktreeManager.remove()` und im Abgleich (Verzeichnis fort) ⇒ `releasedAt` gesetzt, danach wiederverwendbar | FR-005 |
| Kein freier Block ⇒ Wurf mit klarem Text, keine Doppelvergabe | FR-010 |

**Ableitungen** (pure, `packages/shared/src/ports.ts`)

```ts
portFor(base: number, service: StackService): number      // base + service.portOffset
stackUrl(base: number, services: StackService[]): string | null  // primary → http://localhost:<port>
blockStarts(cfg: PortRangeConfig): number[]               // Kandidatenreihenfolge
```

---

## 2. Env-Datei (Erzeugnis, keine Entität)

`<worktree>/.sdd/env`, geschrieben vom `PortAllocator`, ausgeschlossen über
`$GIT_COMMON_DIR/info/exclude` und mit `git check-ignore` nachgeprüft (FR-009).

```sh
# Von SDD-Toolkit erzeugt — nicht bearbeiten, wird überschrieben.
SDD_PORT_BASE=21040
SDD_PORT_SPAN=20
SDD_WORKTREE=/Users/…/worktrees/projekt-x/mein-feature
SDD_PROJECT=Projekt X
SDD_FEATURE=mein-feature
SDD_BRANCH=feature/mein-feature
```

Nur **stabile** Angaben. `SDD_PHASE`, `SDD_STAGE` und `SDD_PROFILE` wechseln pro Lauf und stehen
ausschließlich in der Prozessumgebung — eine Datei mit veraltetem Phasenwert wäre eine
Falschaussage. Bei Abweichung gewinnt die Zuweisung des Toolkits: die Datei wird bei jeder
Bereitstellung des Worktrees neu geschrieben (Edge Case „von Hand verändert").

---

## 3. Stack-Profil und Dienst (Projekt-Konfiguration)

```ts
export const STACK_PROFILE_NAMES = ['test', 'full', 'down'] as const;
export type StackProfileName = (typeof STACK_PROFILE_NAMES)[number];

export interface StackProfile {
  /** Feature-eigenes Kommando; leer = Profil nicht konfiguriert. */
  command: string;
  /** Kommando für projektweit geteilte Dienste; null = keine geteilten Dienste. */
  sharedCommand: string | null;
  /** Zeitlimit in ms; null = DEFAULT_STEP_TIMEOUT_MS (15 min, wie F1b). */
  timeoutMs: number | null;
}

export interface StackService {
  name: string;
  /** Port = portBase + portOffset; muss < span sein. */
  portOffset: number;
  /** 'feature' = je Feature eigener Dienst; 'shared' = projektweit genau einmal (FR-020). */
  scope: 'feature' | 'shared';
  /** Zustandsbehaftet (Datenbank, Dateiablage) — MUSS 'feature' sein (FR-021). */
  stateful: boolean;
  /** Haupteingang der Anwendung; genau einer je Projekt (Quelle der klickbaren URL). */
  primary: boolean;
}

export interface StackConfig {
  test: StackProfile | null;
  full: StackProfile | null;
  /** `command` baut ab **einschließlich** der Datenablagen (FR-017). */
  down: StackProfile | null;
  /** Optional: Dienste anhalten, Daten behalten — die Lane-Aktion „Stoppen". */
  stopCommand: string | null;
  services: StackService[];
}
```

Gespeichert als JSON in `projects.stack` (Vorgabe `'{}'` ⇒ alles `null`/leer ⇒ Projekt ohne Stack).
Das Toolkit bringt **keine** Vorgabekommandos mit (FR-012, Assumption der Spec).

**Validierung** (Route + pure Funktion, damit die Oberfläche denselben Satz zeigt)

| Prüfung | Meldung |
|---|---|
| `portOffset` ≥ 0 und < `span` | „Abstand muss zwischen 0 und {span-1} liegen." |
| `portOffset` je Dienst eindeutig | „Zwei Dienste können nicht denselben Abstand haben." |
| höchstens ein `primary` | „Genau ein Dienst ist der Haupteingang." |
| `stateful && scope === 'shared'` | „Ein zustandsbehafteter Dienst muss feature-eigen laufen." (FR-021) |
| `sharedCommand` gesetzt ⇒ mindestens ein Dienst mit `scope: 'shared'` | „Kein Dienst ist als geteilt gekennzeichnet." |
| Kommando nicht leer, wenn das Profil gesetzt wird | „Kommando darf nicht leer sein." |

**Auswahl je Lane-Aktion** (pure, `stackProfiles.ts`)

| Aktion | ausgeführte Kommandos | `$SDD_PROFILE` |
|---|---|---|
| Starten | `full.command` (+ `full.sharedCommand`, falls geteilte Dienste nicht erreichbar) | `full` |
| Stoppen | `stopCommand`; fehlt er ⇒ Aktion gesperrt mit Grund | `down` |
| Neustarten | Stoppen, dann Starten; ohne `stopCommand` `down.command` + `full.command` — der Dialog nennt dann ausdrücklich, dass die Datenablagen entfernt werden | `down`, dann `full` |
| Abbauen | `down.command` (+ `down.sharedCommand`, nur wenn kein weiteres Feature eine Absicht hat) | `down` |

---

## 4. Stack-Zustand eines Features

**Absicht** (persistiert, Tabelle `feature_stacks`) und **Zustand** (erhoben, nie persistiert) sind
getrennt (FR-023, research E8).

```ts
/** Persistierte Absicht: welches Profil soll für dieses Feature betrieben werden? */
export interface FeatureStackIntent {
  featureId: string;
  profile: Extract<StackProfileName, 'test' | 'full'>;
  since: number;
}

export type StackServiceStatus = 'up' | 'down' | 'unknown';

export interface StackServiceView {
  name: string;
  /** null = kein Port ableitbar (kein Block oder nichts konfiguriert). */
  port: number | null;
  scope: StackService['scope'];
  stateful: boolean;
  primary: boolean;
  status: StackServiceStatus;
}

export interface FeatureStackView {
  /** Projekt hat mindestens ein Profil und mindestens einen Dienst (FR-013/FR-033). */
  configured: boolean;
  /** Betriebenes Profil laut Absicht; null = keiner. */
  profile: 'test' | 'full' | null;
  portBase: number | null;
  /** Nur wenn der Haupteingang erreichbar ist — sonst null (FR-031/FR-033). */
  url: string | null;
  services: StackServiceView[];
  /** Erhebungszeitpunkt der Statusprobe (die Oberfläche weist ihn als „Stand" aus). */
  collectedAt: number;
}
```

**Regeln**

| Regel | Quelle |
|---|---|
| `test` wird bei Beginn von `implement` betrieben und bleibt über alle folgenden Läufe stehen | FR-014, SC-006 |
| Erneutes Hochfahren eines bereits betriebenen Profils erzeugt keinen zweiten Satz und keinen Fehler | FR-015 |
| `full` nur auf Anforderung aus der Lane | FR-016 |
| `down` bei Session-Ende, Merge, Worktree-Entfernen (plus Archivieren/Löschen) — inkl. Datenablagen | FR-017, Edge Case |
| `$SDD_PROFILE` teilt dem Kommando das gemeinte Profil mit | FR-018 |
| Fehlschlag beim Hoch-/Herunterfahren ⇒ `stack_failed`-Meldung mit Ausgabe-Ausschnitt, kein stilles Weiterlaufen | FR-019 |
| Zustandsbehaftete Dienste laufen feature-eigen; zwei Features haben unabhängige Datenbestände | FR-021 |
| Geteilter Dienst läuft projektweit genau einmal; Abbau erst mit dem letzten Nutzer | FR-022 |
| Jeder angezeigte Status kommt aus einer frischen Probe, auch nach Server-Neustart | FR-023 |

---

## 5. Testing-Lane-Eintrag (DTO, nicht persistiert)

Die Zusammenstellung, die ein Mensch zur manuellen Abnahme braucht (FR-030).

```ts
export interface TestingLaneEntry {
  featureId: string;
  featureName: string;
  branch: string;
  /** null = kein Arbeitsverzeichnis (dann keine Stack-Aktion möglich). */
  worktreePath: string | null;
  createdAt: number;
  stage: IntegrationStage;
  stack: FeatureStackView;
  /** Jüngste Entscheidung, falls es schon eine gab (z. B. frühere Ablehnung). */
  lastDecision: ManualTestDecision | null;
}
```

Fünf Pflichtangaben in **einer** Ansicht (SC-009): `worktreePath`, `branch`, `stack.url`,
`createdAt`, `stack.services[]` mit Status und Port.

---

## 6. Manuelle Abnahme (`ManualTestDecision`)

```ts
export interface ManualTestDecision {
  featureId: string;
  decision: 'confirmed' | 'rejected';
  /** Pflicht bei 'rejected' (FR-029); null bei Bestätigung. */
  reason: string | null;
  decidedAt: number;
}
```

Tabelle `manual_test_decisions` (Historie, nicht überschreibend — mehrere Ablehnungen sind möglich).

**Regeln**

| Regel | Quelle |
|---|---|
| Das Verlassen der Stufe in Richtung Review erfordert eine ausdrückliche menschliche Bestätigung und geschieht nie automatisch | FR-028 |
| Ablehnung führt das Feature in die Nacharbeit der Implementierung zurück und hält den Grund fest | FR-029, Assumption |
| Bei ausgeschaltetem Gate wird die Stufe nicht betreten; es entsteht keine Entscheidung | FR-027 |

---

## 7. Integrationsstufe und Pipeline-Stufe (Erweiterung des Bestands)

```ts
export type IntegrationStage =
  | 'none' | 'verifying' | 'verification_unconfigured' | 'verify_failed'
  | 'review_gate' | 'gate_failed'
  | 'awaiting_manual_test'      // NEU (FR-024) — vor awaiting_human_review
  | 'awaiting_human_review'
  | 'queued' | 'merging' | 'conflict_resolving' | 'conflict_escalated' | 'merged';

export const INTEGRATION_STAGE_IDS = [
  'verify', 'review_gate', 'manual_test', 'human_review', 'merge_queue', 'merged',
] as const;                     // 'manual_test' NEU
```

Vier getypte Kataloge müssen antworten (research E10):

| Katalog | Eintrag |
|---|---|
| `INTEGRATION_STAGE_META` | `{ label: 'wartet auf manuelle Abnahme', tone: 'human' }` |
| `STAGE_CLASS` (actionPolicy) | `'decision'` + `DECISION_REASON['awaiting_manual_test']` |
| `INTEGRATION_STEPS` | `{ id: 'manual_test', label: 'Manuelle Abnahme', requires: 'manualTestGate', … }` zwischen `review_gate` und `human_review` |
| `STAGE_FOR_KIND` (Reconciler) | `manual_test_due → 'awaiting_manual_test'` |

---

## 8. Automation-Schalter (Erweiterung des Bestands)

```ts
export interface AutomationSettings {
  autoProgressUntil: FeaturePhase | 'off';
  autoVerify: boolean;
  autoReviewAgents: boolean;
  autoMerge: boolean;
  autoMode: boolean;
  /** Manuelles Test-Gate: Halt auf 'awaiting_manual_test' vor dem Review (FR-025). */
  manualTestGate: boolean;
}

export const LEVEL2_DEFAULTS = { …, manualTestGate: true  };   // FR-026
export const LEVEL3_DEFAULTS = { …, manualTestGate: false };   // FR-026
```

Auflösung über die bestehenden drei Ebenen (`resolveAutomation`: global → Projekt → Feature) — kein
eigenes Bedienkonzept (FR-025). `AUTOMATION_META` erzwingt per `Record<keyof AutomationSettings, …>`
einen Beschriftungs-Eintrag, wodurch der Schalter automatisch in der Workflow-Übersicht erscheint.
`SettingsRepo.getAutomation()` mischt gespeicherte Teilmengen über `LEVEL2_DEFAULTS` — eine
bestehende Datenbank erhält den neuen Schalter damit ohne Migration im Zustand „an".

---

## 9. Worktree-Größe und Plattenwarnung (Erweiterung des Bestands)

```ts
export interface WorktreeEntry {
  …
  /** Belegter Platz in Bytes; null = nicht ermittelbar („unbekannt", FR-044). */
  sizeBytes: number | null;
}

export interface WorktreeDiskInfo {
  /** Freier Platz des Datenträgers des Datenverzeichnisses; null = nicht ermittelbar. */
  freeBytes: number | null;
  /** Dokumentierte Warnschwelle (config.diskWarnBytes, Vorgabe 10 GiB). */
  warnBelowBytes: number;
  /** freeBytes !== null && freeBytes < warnBelowBytes. */
  warn: boolean;
}

export interface WorktreeOverview {
  groups: WorktreeProjectGroup[];
  collectedAt: number;
  disk: WorktreeDiskInfo;   // NEU (FR-043)
}
```

`WorktreeEntry` trägt zusätzlich den zugewiesenen Portblock (`portBase: number | null`), damit die
Übersicht zeigt, welcher Bereich belegt ist — dieselbe Erhebung, kein zweiter Abruf.

---

## 10. Aufmerksamkeits-Arten (vier neue)

```ts
export type AttentionKind =
  | …
  /** Stufe erreicht: ein Mensch muss die Anwendung abnehmen (FR-024/FR-030). */
  | 'manual_test_due'
  /** Hoch- oder Herunterfahren eines Profils fehlgeschlagen (FR-019). */
  | 'stack_failed'
  /** Entfernen des Worktrees nach dem Merge fehlgeschlagen (FR-035). */
  | 'worktree_cleanup_failed'
  /** Worktree ohne zugeordnetes Feature (FR-039). */
  | 'orphan_worktree';
```

**Gültigkeitsregeln** (`attentionReconciler.isAttentionValid`)

| Art | gültig, solange … | in `STAGE_FOR_KIND`? |
|---|---|---|
| `manual_test_due` | `feature.integration === 'awaiting_manual_test'` | ja |
| `stack_failed` | bis ein erfolgreicher Lauf desselben Profils sie auflöst oder der Mensch sie erledigt (Muster `lifecycle_step_failed`) | nein |
| `worktree_cleanup_failed` | bis ein erfolgreiches Aufräumen sie auflöst | nein |
| `orphan_worktree` | solange der verwaiste Eintrag in einer Erhebung erscheint | nein |

Nachrichtentexte tragen alles, was ohne Log-Suche nötig ist: Profil/Anlass, Kommando, Exit-Code und
den Ausgabe-Ausschnitt (`tailLines`, letzte 20 Zeilen / 2000 Zeichen) — identisch mit F1b.

---

## 11. Schema (Migration, additiv)

```sql
-- Feature "ersetzbare-kernschritte-stack-profile-testing-lane".
-- Additiv, keine Seeds, kein Backfill: ohne Stack-Konfiguration verhält sich eine
-- bestehende Datenbank unverändert (FR-013, SC-010).

-- Die EINZIGE Buchführung der Portvergabe (FR-001/FR-002).
CREATE TABLE port_blocks (
  owner_kind   TEXT    NOT NULL CHECK (owner_kind IN ('worktree','project')),
  owner_id     TEXT    NOT NULL,                 -- realpath des Worktrees bzw. projectId
  project_id   TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  base         INTEGER NOT NULL,
  span         INTEGER NOT NULL,
  allocated_at INTEGER NOT NULL,
  released_at  INTEGER,                          -- NULL = belegt
  PRIMARY KEY (owner_kind, owner_id)
);
-- Eindeutigkeit der BELEGTEN Blöcke (SQLite behandelt NULL als eigenständig, deshalb
-- der partielle Index — zwei freigegebene Blöcke mit gleicher Basis sind erlaubt).
CREATE UNIQUE INDEX idx_port_blocks_base_live ON port_blocks(base) WHERE released_at IS NULL;

-- Absicht, NICHT Zustand: welches Profil soll für dieses Feature betrieben werden (FR-014/FR-023).
CREATE TABLE feature_stacks (
  feature_id TEXT PRIMARY KEY REFERENCES features(id) ON DELETE CASCADE,
  profile    TEXT    NOT NULL CHECK (profile IN ('test','full')),
  since      INTEGER NOT NULL
);

-- Manuelle Abnahme: Bestätigung/Ablehnung mit Zeitpunkt und Grund (FR-028/FR-029).
CREATE TABLE manual_test_decisions (
  id         TEXT PRIMARY KEY,
  feature_id TEXT    NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  decision   TEXT    NOT NULL CHECK (decision IN ('confirmed','rejected')),
  reason     TEXT,                               -- Pflicht bei 'rejected'
  decided_at INTEGER NOT NULL
);
CREATE INDEX idx_manual_test_decisions_feature ON manual_test_decisions(feature_id);

-- Profilkommandos + Dienstliste je Projekt (JSON, '{}' = kein Stack).
ALTER TABLE projects ADD COLUMN stack TEXT NOT NULL DEFAULT '{}';

-- Grund eines fehlgeschlagenen Aufräumens; NULL = kein offener Fehlschlag (FR-035/FR-037).
ALTER TABLE features ADD COLUMN cleanup_error TEXT;
```

Bewusst **keine** Tabelle für den Dienststatus (er wird erhoben, E8) und **keine** für
Referenzzähler geteilter Dienste (die Frage wird aus `feature_stacks` abgeleitet, E7).

---

## 12. Zustände & Übergänge

### Portblock

```text
(kein Eintrag) --create()--> belegt (released_at IS NULL)
belegt --remove() / Verzeichnis fort--> freigegeben (released_at gesetzt)
freigegeben --create() eines anderen Worktrees--> belegt (Wiederverwendung, FR-005)
```

Ein belegter Block wandert nie und wird nie umverteilt (FR-004; „Out of Scope: nachträgliche
Umverteilung").

### Stack-Absicht

```text
(keine)  --Beginn implement--> test
test     --Lane: Starten-->     full
full     --Lane: Stoppen/Abbauen, Session-Ende, Merge, Worktree entfernen--> (keine)
test     --dieselben Anlässe--> (keine)
```

Erneutes `up` desselben Profils ist ein No-Op auf der Absicht und führt das Kommando nicht erneut
aus (FR-014/FR-015). Der Wechsel `test → full` führt `full.command` aus (Obermenge).

### Integrations-Pipeline mit Gate

```text
… review_gate bestanden
   ├─ manualTestGate an  → awaiting_manual_test
   │                        ├─ bestätigen → autoMerge? queued : awaiting_human_review
   │                        └─ ablehnen   → integration 'none', letzte Phase wieder offen,
   │                                        Grund festgehalten, Prompt in die Konsole
   └─ manualTestGate aus → unverändert: autoMerge? queued : awaiting_human_review
```

Der Schalter wird **beim Durchlauf** gelesen. Ein Feature, das bereits auf
`awaiting_human_review` steht, wird durch das Einschalten nicht zurückgeschoben (Edge Case) — es
gibt keinen Übergang `awaiting_human_review → awaiting_manual_test`.

### Aufräumen nach dem Merge

```text
merge ok
  → after_stage merge_queue / before_stage merged (F1b-Schritte)
  → down-Profil                     ── Fehlschlag ─→ stack_failed, Pfad bleibt, Abbruch
  → Session beenden (Prozessgruppe)
  → worktrees.remove() + existsSync-Nachweis
        ├─ Nachweis ok  → worktree_path = NULL, Branch löschen, Stufe 'merged'
        └─ Fehlschlag   → Pfad BLEIBT, cleanup_error gesetzt,
                          worktree_cleanup_failed-Meldung, wiederholbar (FR-037)
```

---

## 13. Berührte Bestandstypen (Zusammenfassung)

| Typ / Konstante | Änderung | Anforderung |
|---|---|---|
| `IntegrationStage` | + `'awaiting_manual_test'` | FR-024 |
| `INTEGRATION_STAGE_IDS` | + `'manual_test'` | FR-024 |
| `AutomationSettings` (+ Level-Vorgaben) | + `manualTestGate` | FR-025/FR-026 |
| `LifecycleContext` | + `portBase`, `profile` | FR-007 |
| `buildLifecycleEnv()` | + `SDD_PORT_BASE`, `SDD_PROFILE` (acht Schlüssel) | FR-007/FR-018 |
| `AttentionKind` | + vier Arten | FR-019/FR-035/FR-039 |
| `FeatureActionId` / `FeatureActionContext` | + sechs Aktionen, + `stackConfigured`, `stackRunning` | FR-028/FR-032 |
| `Project` | + `stack: StackConfig` | FR-011/FR-012 |
| `Feature` | + `cleanupError: string \| null` | FR-035 |
| `WorktreeEntry` / `WorktreeOverview` | + `sizeBytes`, `portBase` / + `disk` | FR-042/FR-043 |
| `INTEGRATION_STAGE_META`, `STAGE_CLASS`, `INTEGRATION_STEPS`, `AUTOMATION_META`, `STAGE_FOR_KIND` | je ein Eintrag (Compile-Pflicht) | FR-024/FR-026 |
