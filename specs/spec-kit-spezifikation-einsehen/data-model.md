# Phase 1 Data Model

Dieses Feature führt **keine** persistente Datenstruktur ein (keine DB-Tabelle). Es definiert Laufzeit-DTOs für die Kommunikation Web↔Server sowie die Ableitung der Zustände aus vorhandenen Dateien und dem Feature-Status.

## Geteilte Typen (packages/shared/src/types.ts)

### PhaseDefinition (GET-Antwort)

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `projectId` | `string` | Projekt, dessen Definition angezeigt wird. |
| `phase` | `FeaturePhase` | Zugehöriger SDD-Schritt (specify … implement). |
| `exists` | `boolean` | Ob eine Definitionsdatei gefunden wurde. |
| `path` | `string \| null` | Absoluter Pfad der Datei (nur informativ / für „im Editor öffnen"); `null` wenn nicht gefunden. |
| `content` | `string \| null` | Dateiinhalt (Markdown); `null` wenn `exists === false`. |
| `mtimeMs` | `number \| null` | Änderungszeit für Konfliktprüfung; `null` wenn nicht vorhanden. |
| `locked` | `boolean` | `true`, wenn Bearbeiten wegen laufenden Agenten gesperrt ist. |
| `lockReason` | `string \| null` | Menschlich lesbarer Sperrgrund (z. B. „Agent führt gerade 'plan' aus"). |

### SavePhaseDefinitionRequest (PUT-Body)

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `content` | `string` | Neuer vollständiger Dateiinhalt. |
| `baseMtimeMs` | `number` | Beim Öffnen gelesene `mtimeMs` (Basis der Konfliktprüfung). |
| `overwrite` | `boolean?` | Wenn `true`, Konfliktprüfung überspringen (bewusstes Überschreiben). |

### SavePhaseDefinitionResult (PUT-Antwort)

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `ok` | `boolean` | Erfolg. |
| `mtimeMs` | `number` | Neue `mtimeMs` nach dem Schreiben (als neue Basis). |

## Abgeleitete Zustände (keine Speicherung)

- **`exists` / `path` / `content` / `mtimeMs`**: aus dem Dateisystem via `phaseDefinitionPath(project.path, phase)` + `statSync`/`readFile`.
- **`locked` / `lockReason`**: aus `FeatureRepo` — `locked = features(projectId).some(f => f.phases[phase].status === 'running')`.

## Validierungsregeln

- `phase` muss in `FEATURE_PHASES` liegen (sonst `400`).
- Zustands-Spalten (`integration`, `done`) sind **keine** `FeaturePhase` → für sie wird gar kein Icon gerendert; ein direkter Aufruf ergäbe `400`.
- `PUT` auf eine nicht existierende Definition → `404` (kein Anlegen neuer Definitionsdateien in diesem Feature).
- `PUT` bei `locked` → `409` (`reason: "locked"`).
- `PUT` bei `mtimeMs !== baseMtimeMs` und nicht `overwrite` → `409` (`reason: "conflict"`, aktueller `content`+`mtimeMs` in der Antwort).
- Kein Schreiben außerhalb des aufgelösten Definitionspfades (Pfad wird serverseitig ausschließlich aus `projectId`+`phase` abgeleitet, nie aus Client-Eingabe).

## Zustandsübergänge (Client-Dialog)

```text
[geschlossen]
   │ Icon-Klick (projectId, phase)
   ▼
[lädt] ──GET──> [Ansicht: read-only]
                    │ (locked=false) „Bearbeiten"
                    ▼
                 [Bearbeiten] ──Speichern──> PUT
                    │                          │ 200 → [Ansicht] (neue mtime, Bestätigung)
                    │                          │ 409 conflict → [Konflikt-Dialog] → Überschreiben | Neu laden
                    │                          │ 409 locked   → [Sperr-Hinweis], zurück zu read-only
                    │                          │ 5xx/Fehler   → [Fehler], Eingaben bleiben
                    │ „Schließen" mit ungespeicherten Änderungen → [Verwerfen bestätigen]
                    ▼
                 [Ansicht] / [geschlossen]
```
