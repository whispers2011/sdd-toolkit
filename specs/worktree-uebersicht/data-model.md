# Phase 1 — Data Model: Worktree-Übersicht

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Alle Typen sind **abgeleitete Sichten** — es gibt **keine neue Tabelle und keine Migration**.
Quelle sind Git (`git worktree list`, Diffs, Status) und die bestehende `features`-Tabelle.
Die Typen leben in `packages/shared/src/types.ts` und werden von Server und Web geteilt.

## Entitäten-Überblick

```text
WorktreeOverview
└── groups: WorktreeProjectGroup[]        1 Block je konfiguriertem Projekt (FR-002)
    ├── main: MainCheckoutInfo | null     Haupt-Checkout (FR-003) — nie entfernbar
    └── worktrees: WorktreeEntry[]        offene Worktrees (FR-004 zählt sie)
        ├── files: WorktreeFileChange[]   geänderte Dateien (FR-011…FR-013), gekürzt
        └── warnings: WorktreeWarning[]   Risikolagen (FR-017…FR-021)
```

---

## 1. `WorktreeOverview`

Wurzel der Antwort von `GET /api/worktrees`.

| Feld | Typ | Bedeutung |
|---|---|---|
| `groups` | `WorktreeProjectGroup[]` | Ein Block je Projekt, Reihenfolge = `ProjectRepo.list()` |
| `collectedAt` | `number` | Erhebungszeitpunkt (ms). UI weist „Stand" aus (FR-031) |

**Validierung**: `groups` ist nie `null`; ohne Projekte ist die Liste leer (Leerzustand im UI).

---

## 2. `WorktreeProjectGroup`

| Feld | Typ | Bedeutung |
|---|---|---|
| `projectId` | `string` | |
| `projectName` | `string` | |
| `projectPath` | `string` | Absoluter Pfad des Haupt-Checkouts |
| `defaultBranch` | `string` | Projekt-Default (Vergleichsbasis, wenn kein Feature-Ziel gesetzt) |
| `main` | `MainCheckoutInfo \| null` | `null` **nur** wenn `error !== null` |
| `worktrees` | `WorktreeEntry[]` | Ohne Haupt-Checkout. Sortierung: `feature` → `chat` → `orphan`, je Gruppe alphabetisch nach `label` |
| `worktreeCount` | `number` | `worktrees.length` — explizit im Vertrag (FR-004) |
| `error` | `string \| null` | Projekt nicht erreichbar / kein Git-Repo (FR-032) |

**Regeln**
- `error !== null` ⇒ `main = null`, `worktrees = []`, `worktreeCount = 0`.
- Ein fehlerhafter Block darf die übrigen Blöcke nie verhindern (Erhebung je Projekt gekapselt).

---

## 3. `MainCheckoutInfo`

Bewusst **eigener, schlanker Typ** (siehe research.md D7) — kein `WorktreeEntry`.

| Feld | Typ | Bedeutung |
|---|---|---|
| `projectId` | `string` | |
| `projectName` | `string` | |
| `path` | `string` | Projektwurzel |
| `branch` | `string \| null` | Aktueller Branch; `null` = detached HEAD |
| `defaultBranch` | `string` | |
| `uncommittedFileCount` | `number` | Einträge aus `git status --porcelain` |

**Regeln**: keine Dateiliste, keine Warnungen, **keine Entfernen-Aktion** (FR-026).

---

## 4. `WorktreeEntry`

Ein bestehender oder erwarteter Worktree eines Projekts.

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | `string` | Stabile Kennung `<projectId>::<realpath>`; Identität über Erhebungen hinweg |
| `projectId` | `string` | |
| `kind` | `WorktreeEntryKind` | `feature \| chat \| orphan` (`main` ist ausgelagert, siehe 3.) |
| `label` | `string` | Feature-Name · `"Wissens-Chat"` · Verzeichnisname (verwaist) |
| `path` | `string` | Kanonisierter Pfad |
| `branch` | `string \| null` | `null` = detached HEAD |
| `dirState` | `WorktreeDirState` | `present \| missing \| registry_only` |
| `featureId` | `string \| null` | Zuordnung; `null` ⇒ verwaist (FR-008) |
| `targetBranch` | `string` | `feature.integrationTarget ?? project.defaultBranch` |
| `createdAt` | `number \| null` | `feature.createdAt`, sonst `mtime` des Verzeichnisses, sonst `null` |
| `sessionActive` | `boolean` | Nicht beendete PTY-Session mit `cwd` im Worktree (FR-025) |
| `removable` | `boolean` | `dirState === 'present' && !sessionActive` |
| `changedFileCount` | `number` | **Gesamtzahl** geänderter Dateien (FR-014), auch bei Kürzung |
| `uncommittedFileCount` | `number` | Teilmenge mit `state ≠ 'committed'` |
| `files` | `WorktreeFileChange[]` | Auf **300** gekürzt (FR-016) |
| `filesTruncated` | `boolean` | `true` ⇒ UI nennt Gesamtzahl und weist die Kürzung aus |
| `warnings` | `WorktreeWarning[]` | Leer = keine Warnung (FR-020) |
| `error` | `string \| null` | Erhebung dieses Eintrags fehlgeschlagen — Eintrag bleibt sichtbar |

### Ableitungsregeln je `dirState`

| `dirState` | Bedingung | `files` / `warnings` | `removable` |
|---|---|---|---|
| `present` | git führt den Worktree **und** Verzeichnis existiert | erhoben | `!sessionActive` |
| `registry_only` | git führt ihn, Verzeichnis fehlt (bzw. `prunable`) | leer | `false` (Prune ist außerhalb des Umfangs) |
| `missing` | Feature hat `worktreePath`, git kennt ihn nicht / Verzeichnis fehlt | leer | `false` (FR-009) |

### Klassifikation `kind`

1. Zuordnung über realpath, sonst über Branch (research.md D2) ⇒ `feature`.
2. Sonst Verzeichnisname `chat-<id>` bzw. Branch `chat/<id>` ⇒ `chat`, Label `"Wissens-Chat"`.
3. Sonst ⇒ `orphan`, Label = Verzeichnisname. Archivierte Features gelten nicht als
   Zuordnung (Assumption der Spezifikation) und landen daher hier.

---

## 5. `WorktreeFileChange`

| Feld | Typ | Bedeutung |
|---|---|---|
| `path` | `string` | Repo-relativ; bei Umbenennung der **neue** Pfad |
| `oldPath` | `string \| null` | Nur bei `kind === 'renamed'` |
| `kind` | `FileChangeKind` | `added \| modified \| deleted \| renamed` (FR-012) |
| `state` | `FileChangeState` | `committed \| uncommitted \| both` (FR-013) |
| `overlapping` | `boolean` | Datei auch in einem anderen offenen Worktree geändert |
| `behindTarget` | `boolean` | Datei seit `base` auch auf `targetBranch` geändert |

### Herleitung (pure `mergeFileChanges`, siehe research.md D4/D5)

```text
base            = merge-base(targetBranch, HEAD)
netto           = git diff --name-status -M -z <base>          → path, oldPath, kind
untracked       = git ls-files --others --exclude-standard -z  → kind 'added'
committedPaths  = git diff --name-only -z <base>..HEAD
worktreePaths   = git status --porcelain -z

state = committedPaths.has(p) && worktreePaths.has(p) ? 'both'
      : committedPaths.has(p)                        ? 'committed'
      :                                                'uncommitted'
```

**Invarianten**
- Jeder Pfad erscheint **höchstens einmal** in `files`.
- `changedFileCount === 0` ⇒ UI zeigt ausdrücklich „keine Änderungen" (FR-015).
- Untracked-Dateien sind immer `state: 'uncommitted'`, `kind: 'added'`.
- `oldPath` erzeugt **keinen** Überschneidungs-Treffer (Fehlalarm-Schutz).

---

## 6. `WorktreeWarning`

| Feld | Typ | Bedeutung |
|---|---|---|
| `kind` | `WorktreeWarningKind` | `overlap \| behind_target \| already_merged` |
| `files` | `string[]` | Betroffene Pfade, auf **20** gekürzt (Anzeige) |
| `fileCount` | `number` | Gesamtzahl betroffener Dateien |
| `others` | `{ entryId, label, featureId }[]` | Nur bei `overlap`: die anderen beteiligten Einträge (FR-017) |

### Erkennungsregeln

| `kind` | Bedingung | Nachweis |
|---|---|---|
| `already_merged` | Branch fehlt **oder** ist Vorfahre von `targetBranch` | `isBranchMergedInto(project.path, branch, target)` |
| `behind_target` | `files ∩ (git diff --name-only -z <base>..<target>) ≠ ∅` | je (Projekt, target, base) einmal erhoben, gecacht |
| `overlap` | Pfad in ≥ 2 Einträgen mit `dirState === 'present'` desselben Projekts | pure `detectOverlaps()` über die **ungekürzten** Listen |

**Ausschlüsse (keine Fehlalarme, FR-020 / SC-010)**
- `already_merged` unterdrückt `behind_target` am selben Eintrag.
- Einträge mit `dirState ≠ present` erzeugen und empfangen keine Warnungen.
- Der Haupt-Checkout nimmt an keiner Warnung teil.
- Bei `already_merged` ohne betroffene Dateien: `files = []`, `fileCount = 0`.

**Mehrfachwarnungen**: `warnings` transportiert alle zutreffenden Arten gleichzeitig; die
Reihenfolge ist stabil `already_merged` → `overlap` → `behind_target` (FR-021).

---

## 7. Aufzählungstypen

```ts
export type WorktreeEntryKind  = 'feature' | 'chat' | 'orphan';
export type WorktreeDirState   = 'present' | 'missing' | 'registry_only';
export type FileChangeKind     = 'added' | 'modified' | 'deleted' | 'renamed';
export type FileChangeState    = 'committed' | 'uncommitted' | 'both';
export type WorktreeWarningKind= 'overlap' | 'behind_target' | 'already_merged';
```

---

## 8. Zustandsübergänge (Entfernen-Aktion)

Der einzige verändernde Vorgang. Kein Zustand wird persistiert — der Übergang ist ein
Wechsel der beobachteten Realität.

```text
present ──„Entfernen" + Bestätigung──────────────────► (Eintrag verschwindet)
   │                                    ▲
   │ uncommittedFileCount > 0           │ force: true (2. Bestätigung, FR-024)
   └───────► 409 uncommitted ───────────┘

present + sessionActive ──„Entfernen"──► 409 session_active (Aktion verweigert, FR-025)
registry_only / missing ───────────────► keine Aktion angeboten (Prune außerhalb des Umfangs)
main ──────────────────────────────────► keine Aktion angeboten (FR-026)
```

**Nachwirkungen bei Erfolg**
1. `features.setWorktree(featureId, null)` (nur wenn zugeordnet)
2. `bus.emitEvent('feature_updated', fresh)` → alle Clients synchron
3. Übersicht-Cache verworfen ⇒ nächster Abruf liest die Realität neu (FR-027)

**Bei Fehlschlag**: keine DB-Änderung, Klartext-Fehler an den Client; die nächste Erhebung
zeigt den tatsächlich verbliebenen Zustand.

---

## 9. Berührte bestehende Entitäten

| Entität | Nutzung | Änderung |
|---|---|---|
| `Project` | `path`, `name`, `defaultBranch` | keine |
| `Feature` | `worktreePath`, `branch`, `name`, `integrationTarget`, `phases`, `integration`, `createdAt` | keine (nur `setWorktree(null)` nach Entfernen) |
| `LiveSession` (PTY) | `cwd`, `exited` | keine — nur gelesen für `sessionActive` |
