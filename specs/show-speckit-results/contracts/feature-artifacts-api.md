# Contract: Feature-Artefakte REST-API

Drei Endpunkte, gespiegelt am Muster `/api/projects/:id/phases/:phase/definition` (`server.ts` 224–284). Lookup: `deps.features.get(id)` → Feature, `deps.projects.get(feature.projectId)` → Projekt. Basisverzeichnis: `feature.worktreePath ?? project.path`. Phasen werden über `validatePhase()` geprüft; nur `specify | plan | tasks | checklist` liefern Artefakte.

---

## 1) GET `/api/features/:id/artifacts`

Listet die artefakt-erzeugenden Schritte des Features (steuert Icons + Tooltips + Verfügbarkeit + Datei-Umschalter).

**Response 200** — `FeatureArtifactStep[]`
```json
[
  {
    "phase": "specify",
    "label": "Specify",
    "tooltip": "Specify-Ergebnis ansehen (spec.md)",
    "available": true,
    "files": [{ "id": "spec.md", "label": "Spec", "relPath": "spec.md" }]
  },
  {
    "phase": "plan",
    "label": "Plan",
    "tooltip": "Plan-Ergebnis ansehen (plan.md + Begleitartefakte)",
    "available": true,
    "files": [
      { "id": "plan.md", "label": "Plan", "relPath": "plan.md" },
      { "id": "research.md", "label": "Research", "relPath": "research.md" },
      { "id": "data-model.md", "label": "Data Model", "relPath": "data-model.md" },
      { "id": "contracts/api.md", "label": "Contract: api.md", "relPath": "contracts/api.md" }
    ]
  },
  { "phase": "tasks", "label": "Tasks", "tooltip": "Tasks-Ergebnis ansehen (tasks.md)", "available": false, "files": [] },
  { "phase": "checklist", "label": "Checklist", "tooltip": "Checklisten ansehen", "available": true,
    "files": [{ "id": "checklists/requirements.md", "label": "requirements", "relPath": "checklists/requirements.md" }] }
]
```

**Errors**: `404` Feature/Projekt nicht gefunden.

---

## 2) GET `/api/features/:id/artifacts/:phase?file=<id>`

Liefert den Inhalt einer Artefakt-Datei. Ohne `file` wird die erste vorhandene Datei des Schritts geliefert. Immer lesbar (auch bei `locked`).

**Response 200** — `FeatureArtifact`
```json
{
  "featureId": "f_123",
  "phase": "plan",
  "fileId": "plan.md",
  "label": "Plan",
  "path": "/abs/worktree/specs/show-speckit-results/plan.md",
  "content": "# Implementation Plan…",
  "mtimeMs": 1750000000000,
  "exists": true,
  "locked": false,
  "lockReason": null,
  "files": [ { "id": "plan.md", "label": "Plan", "relPath": "plan.md" }, { "id": "research.md", "label": "Research", "relPath": "research.md" } ]
}
```

- `exists=false` (Datei fehlt): `content=null`, `mtimeMs=null`, `path=null` — 200 (kein Fehler; Modal zeigt „kein Ergebnis").

**Errors**: `404` Feature/Projekt nicht gefunden; `400` ungültige Phase (bzw. Phase ohne Artefakt).

---

## 3) PUT `/api/features/:id/artifacts/:phase?file=<id>`

Speichert den bearbeiteten Inhalt zurück. Konflikt- (FR-014) und Sperr-geschützt (FR-011).

**Request Body** — `SaveFeatureArtifactRequest`
```json
{ "content": "…", "baseMtimeMs": 1750000000000, "overwrite": false }
```
Pflicht: `content: string`, `baseMtimeMs: number`. Fehlend → `400`.

**Response 200** — `SaveFeatureArtifactResult`
```json
{ "ok": true, "mtimeMs": 1750000009999 }
```

**Konflikt/Sperre — 409** (Shape identisch zur Definition-API, damit `SaveConflictError` wiederverwendbar ist):
```json
{ "error": "conflict", "message": "Die Datei wurde seit dem Öffnen extern geändert.", "current": { "content": "…", "mtimeMs": 1750000005000 } }
```
```json
{ "error": "locked", "message": "Ein Agent entwickelt dieses Feature gerade." }
```

**Errors**: `404` Feature/Projekt/Datei nicht gefunden; `400` fehlende Felder; `409` `conflict` | `locked`.

---

## Client-Methoden (`packages/web/src/api.ts`)

```ts
featureArtifacts(featureId): Promise<FeatureArtifactStep[]>
featureArtifact(featureId, phase, fileId?): Promise<FeatureArtifact>
saveFeatureArtifact(featureId, phase, fileId, body): Promise<SaveFeatureArtifactResult>  // wirft SaveConflictError bei 409/conflict
```

Der Split-Screen nutzt keine neue API — `TerminalPane featureId={…}` ruft intern `api.ensureSession(featureId)` (POST `/api/features/:id/session`).
