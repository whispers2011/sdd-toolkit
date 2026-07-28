# Phase 1 — Data Model: Dokument-Upload bei manueller Feature-Erfassung

**Datum**: 2026-07-27 | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Es gibt **keine Datenbankänderung**. Der Zustand liegt vollständig im Dateisystem des
Feature-Worktrees (R2); die Typen unten beschreiben das On-Disk-Format und die daraus
abgeleiteten DTOs.

---

## Ablage

```text
<worktree>/specs/<feature-slug>/
├── docs/                     # NEU — Ausgangsmaterial des Features
│   ├── documents.json        # Manifest (Quelle der Wahrheit für API + Prompt)
│   ├── Anforderungen.pdf     # Dokumente unverändert, Originalname wo möglich
│   ├── schema.sql
│   └── bericht-2.pdf         # bei Namenskollision entstandener Name
├── spec.md                   # bestehende Artefakte
├── plan.md
└── …
```

- Der Ordner entsteht nur, wenn mindestens ein Dokument übernommen wird (FR-017).
- Inhalt der Dateien wird byteweise übernommen — keine Konvertierung, keine Kürzung
  (FR-003).
- Ordner und Manifest werden unmittelbar committet (R1).

---

## Entities

### FeatureDocument

Ein vom Nutzer beim Anlegen mitgegebenes Dokument. Gehört zu genau einem Feature.
Definiert in `packages/shared/src/featureDocuments.ts`, exportiert über
`packages/shared/src/index.ts`.

| Feld | Typ | Beschreibung | Quelle |
|---|---|---|---|
| `name` | `string` | Anzeigename = ursprünglicher Dateiname des Nutzers | Upload |
| `storedName` | `string` | Abgelegter Dateiname im `docs/`-Ordner; gleich `name`, außer der Name musste bereinigt oder entkollidiert werden (FR-005) | `safeFilename` |
| `relPath` | `string` | Fundort relativ zur Worktree-Wurzel: `specs/<slug>/docs/<storedName>` | abgeleitet |
| `bytes` | `number` | Größe in Byte (> 0, ≤ 25 MB) | Upload |
| `mimeType` | `string` | Vom Browser gemeldeter Typ; `application/octet-stream` als Rückfall. Rein informativ — die Übernahme hängt nicht davon ab (FR-013) | Upload |
| `uploadedAt` | `number` | Zeitpunkt der Übernahme (Unix-ms) | Server |

**Validierungsregeln**

| Regel | Quelle | Verletzung |
|---|---|---|
| `bytes > 0` | FR-012 | Dokument abgelehnt, Grund `leer` |
| `bytes ≤ MAX_DOCUMENT_BYTES` (25 MB) | FR-011 | abgelehnt, Grund `zu groß (max. 25 MB)` |
| höchstens `MAX_DOCUMENTS_PER_FEATURE` (20) je Feature | FR-011 | überzählige abgelehnt, Grund `Höchstzahl (20) erreicht` |
| `storedName` enthält keine Pfadseparatoren, kein `..`, keine Steuerzeichen | FR-005 | Name wird bereinigt (keine Ablehnung) |
| `storedName` ist innerhalb des Features eindeutig | FR-005 | Suffix `-2`, `-3`, … vor der Endung |
| aufgelöster Zielpfad liegt unterhalb von `docs/` | FR-005 | abgelehnt, Grund `unsicherer Dateiname` |

`name` wird **nicht** validiert oder verändert — er ist reine Anzeige und bleibt im
Manifest so erhalten, wie der Nutzer die Datei genannt hat.

---

### DocumentManifest (On-Disk)

`specs/<slug>/docs/documents.json` — das einzige persistente Format.

```jsonc
{
  "version": 1,
  "documents": [
    {
      "name": "Anforderungen 2026.pdf",
      "storedName": "Anforderungen 2026.pdf",
      "bytes": 1258291,
      "mimeType": "application/pdf",
      "uploadedAt": 1785312000000
    }
  ]
}
```

- `relPath` steht **nicht** im Manifest: er ist aus dem Speicherort ableitbar und wäre
  nach einem Umbenennen des Features falsch.
- Unlesbares oder ungültiges Manifest ⇒ die Dokumentliste gilt als leer. Das darf niemals
  einen Phasenstart blockieren (best-effort wie `knowledgePreambleFor`,
  `orchestrator.ts:571`).
- `version` erlaubt ein späteres Format, ohne alte Features zu brechen.

---

### FeatureDocumentsResult (Antwort-DTO)

Ergebnis des Anlegens mit Dokumenten. Trennt sauber, was gelungen und was liegengeblieben
ist (FR-014).

| Feld | Typ | Beschreibung |
|---|---|---|
| `feature` | `Feature` | Das angelegte Feature, unverändertes bestehendes DTO |
| `documents` | `FeatureDocument[]` | Tatsächlich übernommene Dokumente |
| `rejected` | `RejectedDocument[]` | Nicht übernommene Dokumente mit Grund |

### RejectedDocument

| Feld | Typ | Beschreibung |
|---|---|---|
| `name` | `string` | Ursprünglicher Dateiname |
| `reason` | `string` | Menschenlesbarer Grund, nennt Dateiname und ggf. Grenze (SC-005) |

---

### Feature (bestehend, unverändert)

`packages/shared/src/types.ts:117` bekommt **kein** neues Feld. Die Zuordnung
Feature → Dokumente (0..n) ergibt sich aus dem Pfad `specs/<feature.name>/docs/`.

**Begründung**: Ein Feld wie `documentCount` am `Feature` müsste bei jeder Änderung auf
Disk nachgezogen werden und wäre nach einem Merge (Worktree entfernt) nicht mehr
verifizierbar. Die Oberfläche lädt die Liste bei Bedarf über `GET /api/features/:id/documents`
— dasselbe Muster wie bei den Artefakt-Icons (`api.featureArtifacts`,
`packages/web/src/api.ts:277`).

---

### Arbeitsschritt-Auftrag (bestehend, erweitert)

Der Prompt-Text, mit dem eine Phase gestartet wird
(`Orchestrator.launchPhase`, `orchestrator.ts:419`). Bisher:

```text
<slash-command> [extraPrompt] + [Wissens-Präambel] + [Vorlagen-Hinweis]
```

Neu:

```text
<slash-command> [extraPrompt] + [Dokument-Verweis] + [Wissens-Präambel] + [Vorlagen-Hinweis]
```

Der Dokument-Verweis ist leer, wenn keine Dokumente hinterlegt sind — der Prompt ist dann
zeichengleich mit dem heutigen (FR-017, SC-006). Sein Format ist als Vertrag festgehalten:
[contracts/document-preamble.md](./contracts/document-preamble.md).

---

## Zustandsübergänge

Dokumente sind nach dem Anlegen unveränderlich (Spec-Annahme „Kein Nachreichen"). Es gibt
genau einen Übergang, und er findet innerhalb eines Requests statt:

```text
(ausgewählt im Dialog)
        │  Datei ≤ 25 MB, > 0 Byte, Anzahl < 20 ?
        ├─ nein ──────────────────► verworfen  → rejected[] (Feature entsteht trotzdem)
        └─ ja
             │  Feature angelegt ?
             ├─ nein ─────────────► nichts geschrieben (FR-015), Request scheitert
             └─ ja
                  │  Schreiben in docs/ erfolgreich ?
                  ├─ nein ────────► rejected[]  (Feature bleibt nutzbar, FR-014)
                  └─ ja ──────────► hinterlegt → Manifest → Commit → Specify-Start
```

Danach ändert sich der Zustand eines Dokuments nur noch durch den Nutzer selbst (Datei im
Worktree löschen) oder durch die Integration (Merge in den Zielbranch). Beides wird von der
Liste ehrlich abgebildet, weil sie bei jedem Aufruf aus Manifest + Verzeichnis gelesen wird.

---

## Konstanten

Definiert in `packages/shared/src/featureDocuments.ts`, damit Dialog, Server und Tests
dieselbe Zahl nennen (FR-018):

| Konstante | Wert | Herkunft |
|---|---|---|
| `MAX_DOCUMENT_BYTES` | `25 * 1024 * 1024` | bestehende Multipart-Grenze, `api/server.ts:110` |
| `MAX_DOCUMENTS_PER_FEATURE` | `20` | Spec-Annahme „Grenzen" |
| `DOCUMENTS_DIR_NAME` | `'docs'` | dieser Plan |
| `DOCUMENTS_MANIFEST` | `'documents.json'` | dieser Plan |
