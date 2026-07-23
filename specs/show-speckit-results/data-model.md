# Phase 1 Data Model: Speckit-Zwischenresultate

Keine Datenbank-Entitäten — die Wahrheit sind Dateien unter `specs/<feature>/`. Die folgenden Typen sind **DTOs/Value-Objects** (Transport & UI-State), gespiegelt an `PhaseDefinition`/`SavePhaseDefinition*` des Schwester-Features. Ziel-Datei für die Typen: `packages/shared/src/types.ts`.

## Phase → Datei-Mapping (autoritativ)

| Schritt (Icon) | Primärdatei | Begleitartefakte | Icon zeigen wenn |
|---|---|---|---|
| `specify` | `spec.md` | — | Datei existiert |
| `plan` | `plan.md` | `research.md`, `data-model.md`, `quickstart.md`, `contracts/*` (falls vorhanden) | mind. eine Datei existiert |
| `tasks` | `tasks.md` | — | Datei existiert |
| `checklist` | — | `checklists/*.md` | mind. eine Checkliste existiert |
| `clarify`, `analyze`, `implement` | — | — | **nie** (kein eigenes Artefakt) |

Basisverzeichnis `base = feature.worktreePath ?? project.path`; Dateipfade = `join(base, 'specs', feature.name, relPath)`.

## Entitäten (DTOs)

### FeatureArtifactFile
Eine einzelne einsehbare Datei innerhalb eines Schritts.
- `id: string` — stabile Kennung (relativer Pfad, z. B. `plan.md`, `contracts/api.md`), dient als `?file=`-Selektor.
- `label: string` — Anzeigename (z. B. „Plan", „Research", „Contract: api.md").
- `relPath: string` — Pfad relativ zu `specs/<feature>/`.

### FeatureArtifactStep
Ein artefakt-erzeugender Schritt für ein Feature (steuert Icon + Tooltip + Verfügbarkeit).
- `phase: FeaturePhase` — einer von `specify | plan | tasks | checklist`.
- `label: string` — z. B. „Specify".
- `tooltip: string` — Hover-Text, z. B. „Specify-Ergebnis ansehen (spec.md)".
- `available: boolean` — mind. eine zugehörige Datei existiert (sonst Icon deaktiviert).
- `files: FeatureArtifactFile[]` — vorhandene Dateien (leer, wenn `available=false`).

### FeatureArtifact
Inhalt einer konkret gewählten Artefakt-Datei (Detail-DTO fürs Modal).
- `featureId: string`
- `phase: FeaturePhase`
- `fileId: string` — welche Datei (siehe `FeatureArtifactFile.id`).
- `label: string`
- `path: string | null` — absoluter Pfad (informativ); null wenn nicht vorhanden.
- `content: string | null` — Roh-Markdown der Datei (Editor rendert es als Rich-Text); null wenn nicht vorhanden.
- `mtimeMs: number | null` — Basis der Konfliktprüfung.
- `exists: boolean`
- `locked: boolean` — Bearbeiten gesperrt (irgendeine Phase des Features läuft).
- `lockReason: string | null`
- `files: FeatureArtifactFile[]` — Geschwister-Dateien desselben Schritts (für den Umschalter).

### SaveFeatureArtifactRequest
- `content: string`
- `baseMtimeMs: number` — beim Öffnen gelesene mtime (Konfliktbasis).
- `overwrite?: boolean` — Konfliktprüfung bewusst überspringen.

### SaveFeatureArtifactResult
- `ok: true`
- `mtimeMs: number` — neue mtime nach dem Schreiben.

## Validierungs- & Verhaltensregeln

- **Lock (FR-011)**: `locked = FEATURE_PHASES.some(p => feature.phases[p]?.status === 'running')`. Schreiben bei `locked` → Fehler `locked` (HTTP 409). Lesen immer erlaubt.
- **Konflikt (FR-014)**: Vor dem Schreiben aktuelle mtime prüfen; weicht sie von `baseMtimeMs` ab und `overwrite` ist nicht gesetzt → Fehler `conflict` (HTTP 409) inkl. `current: { content, mtimeMs }`.
- **Nicht gefunden**: Datei/Schritt ohne Artefakt → `exists=false` beim Lesen; Schreibversuch → Fehler `not_found` (HTTP 404).
- **Verlustfreier Rückschrieb (FR-010)**: Der WYSIWYG-Editor serialisiert über remark/mdast strukturerhaltend zurück (Tabellen, `- [ ]`, Codeblöcke, Frontmatter).
- **Zustandsmaschine (UI)**: `Ansicht → (Bearbeiten) → Editieren → (Speichern|Abbrechen) → Ansicht`. `dirty` blockiert Schließen/Moduswechsel ohne Warnung (FR-013). `conflict` öffnet Überschreiben-vs-Neuladen-Dialog (Muster: `PhaseDefinitionDialog`).

## Fehler-Codes (Service `DefinitionError`-analog)

`not_found | locked | conflict` — identische Semantik wie `phaseDefinition.ts`, damit der Web-Client `SaveConflictError` und die 409-Behandlung wiederverwenden kann.
