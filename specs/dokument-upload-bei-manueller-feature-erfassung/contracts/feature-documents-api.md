# HTTP-Contract: Feature-Dokumente

Alle Routen werden in `packages/server/src/api/server.ts` registriert (Interface `ApiDeps`).
Antworten sind JSON; Fehlerkörper folgen dem bestehenden Muster `{ message: string }`.

Typen (`FeatureDocument`, `RejectedDocument`, `FeatureDocumentsResult`) siehe
[data-model.md](../data-model.md); sie werden in `packages/shared/src/featureDocuments.ts`
definiert und über `@sdd/shared` exportiert.

---

## POST /api/projects/:id/features/with-documents

Legt ein Feature an und hinterlegt die mitgegebenen Dokumente (US1).

**Content-Type**: `multipart/form-data`

**Feldreihenfolge ist verbindlich** — `name` und `description` MÜSSEN vor den Dateien im
Formular stehen. Der Server legt das Feature an, sobald er `name` gelesen hat, und
streamt die folgenden Dateien direkt in dessen Worktree (R3/R4). Trifft ein Datei-Part
ein, bevor `name` gelesen wurde, antwortet der Server `400`.

| Part | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | field | ja | Feature-Name (wird wie bisher zu einem Slug normalisiert) |
| `description` | field | nein | Freitext; leer erlaubt, wenn Dokumente vorhanden sind (FR-010) |
| `files` | file (mehrfach) | ja (≥ 1) | Die Dokumente; beliebige Dateiart (FR-013) |

**Response 200**: `FeatureDocumentsResult`

```jsonc
{
  "feature": { "id": "…", "name": "kundenimport", "branch": "feature/kundenimport", … },
  "documents": [
    {
      "name": "Anforderungen 2026.pdf",
      "storedName": "Anforderungen 2026.pdf",
      "relPath": "specs/kundenimport/docs/Anforderungen 2026.pdf",
      "bytes": 1258291,
      "mimeType": "application/pdf",
      "uploadedAt": 1785312000000
    }
  ],
  "rejected": [
    { "name": "dump.sql", "reason": "dump.sql: zu groß (41.2 MB, max. 25 MB)" },
    { "name": "leer.txt", "reason": "leer.txt: leere Datei (0 Byte)" }
  ]
}
```

- `200` auch dann, wenn einzelne Dokumente in `rejected` stehen: das Feature ist angelegt
  und nutzbar (FR-014). Der Client zeigt `rejected` als Meldung an (SC-005).
- Der Specify-Lauf wird serverseitig gestartet, sobald die Dokumente geschrieben sind —
  der Client startet **keine** Phase (FR-006, R4).

**Fehler**

| Zustand | HTTP | Körper |
|---|---|---|
| `name` fehlt oder ist leer | 400 | `{ message: 'Feature-Name fehlt' }` |
| Datei-Part vor `name` | 400 | `{ message: 'name muss vor den Dateien gesendet werden' }` |
| keine Datei im Formular | 400 | `{ message: 'Kein Dokument im Formular' }` |
| Feature-Name existiert bereits | 400 | `{ message: "Feature 'x' existiert bereits" }` — **keine** Datei wurde geschrieben (FR-015) |
| Projekt nicht gefunden | 404 | `{ message: 'Projekt nicht gefunden' }` |
| Worktree fehlt (Feature ohne Arbeitsverzeichnis) | 500 | `{ message: 'Feature hat keinen Worktree — Dokumente nicht ablegbar' }` |

**Ablehnungsgründe** (Text in `rejected[].reason`, jeweils mit Dateiname und Grenze —
FR-011, FR-012, SC-005):

| Ursache | Grund-Text |
|---|---|
| Datei > 25 MB | `<name>: zu groß (<größe>, max. 25 MB)` |
| Datei = 0 Byte | `<name>: leere Datei (0 Byte)` |
| mehr als 20 Dokumente | `<name>: Höchstzahl von 20 Dokumenten je Feature erreicht` |
| Dateiname nicht sicher ablegbar | `<name>: unsicherer Dateiname` |
| Schreibfehler | `<name>: konnte nicht abgelegt werden (<ursache>)` |

**Grenzen** werden routenlokal gesetzt:
`req.parts({ limits: { fileSize: MAX_DOCUMENT_BYTES }, throwFileSizeLimit: false })` —
eine überschrittene Datei kommt als `part.file.truncated === true` an und wird verworfen,
ohne den Strom abzubrechen (R6).

---

## GET /api/features/:id/documents

Liste der hinterlegten Dokumente eines Features (US3, FR-016).

**Response 200**: `FeatureDocument[]`

- Leeres Array, wenn keine Dokumente hinterlegt sind — kein Fehler.
- Quelle ist `specs/<slug>/docs/documents.json` im Worktree; ist der Worktree entfernt
  (nach dem Merge), greift der bestehende Rückfall auf `project.path`
  (`featureArtifacts.ts:16`), sodass gemergte Dokumente weiter gelistet werden (SC-007).
- Ein Manifest-Eintrag, dessen Datei fehlt, wird ausgelassen — die Liste zeigt nur, was
  tatsächlich vorhanden ist.

| Zustand | HTTP | Körper |
|---|---|---|
| Feature nicht gefunden | 404 | `{ message: 'Feature nicht gefunden' }` |
| Projekt nicht gefunden | 404 | `{ message: 'Projekt nicht gefunden' }` |

---

## POST /api/features/:id/documents/open

Öffnet ein Dokument mit der Systemanwendung (FR-016, R8).

**Request**: `{ "storedName": "Anforderungen 2026.pdf" }`

**Response 200**: `{ ok: true }`

- `storedName` wird gegen die Manifest-Einträge geprüft. Kein Treffer ⇒ `404`; der Wert
  wird **nie** direkt als Pfad verwendet (FR-005).
- Geöffnet wird mit dem Systemöffner (`open <pfad>` auf macOS), nicht mit `editorCmd` —
  Dokumente sind beliebige Dateiarten (FR-013).

| Zustand | HTTP | Körper |
|---|---|---|
| Dokument nicht im Manifest | 404 | `{ message: 'Dokument nicht gefunden' }` |
| Datei fehlt auf Disk | 404 | `{ message: 'Datei nicht mehr vorhanden' }` |

---

## Unveränderte Routen

`POST /api/projects/:id/features` (JSON, `{ name, description? }`) bleibt in Verhalten und
Signatur unverändert. Der Dialog benutzt sie weiterhin, wenn keine Datei ausgewählt ist
(FR-017, SC-006). Diese Route legt **keinen** `docs/`-Ordner an und hängt **keinen**
Dokument-Verweis an den Prompt.

---

## Client-Methoden (`packages/web/src/api.ts`)

```ts
createFeatureWithDocuments(
  projectId: string,
  name: string,
  description: string | undefined,
  files: File[],
): Promise<FeatureDocumentsResult>          // FormData: name, description, files…

featureDocuments(featureId: string): Promise<FeatureDocument[]>

openFeatureDocument(featureId: string, storedName: string): Promise<{ ok: true }>
```

`createFeatureWithDocuments` baut das `FormData` in der vom Contract geforderten
Reihenfolge (`name`, `description`, dann alle Dateien) und nutzt `fetch` direkt — wie
`pasteImage` (`packages/web/src/api.ts:242`), da der JSON-Helfer `request()` keinen
multipart-Body unterstützt.
