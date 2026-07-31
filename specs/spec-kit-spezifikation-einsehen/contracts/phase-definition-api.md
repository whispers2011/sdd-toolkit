# API-Kontrakt: Phase-Definition (Lesen / Speichern / Im Editor öffnen)

Projekt-skopierte REST-Endpunkte auf dem Fastify-Server (`packages/server/src/api/server.ts`). Alle Pfade relativ zur bestehenden `/api`-Basis. `:phase` MUSS in `FEATURE_PHASES` liegen.

---

## 1. GET `/api/projects/:id/phases/:phase/definition`

Liefert die Definition des Schritts `:phase` für Projekt `:id`.

**Path-Parameter**: `id` (Projekt-ID), `phase` (FeaturePhase)

**Antwort 200** (`PhaseDefinition`):
```json
{
  "projectId": "p_123",
  "phase": "specify",
  "exists": true,
  "path": "/abs/project/.claude/skills/speckit-specify/SKILL.md",
  "content": "# Feature Specification...\n...",
  "mtimeMs": 1737550000000,
  "locked": false,
  "lockReason": null
}
```

**Antwort 200 – keine Definition vorhanden** (FR-004):
```json
{ "projectId": "p_123", "phase": "analyze", "exists": false, "path": null, "content": null, "mtimeMs": null, "locked": false, "lockReason": null }
```

**Antwort 200 – gesperrt** (FR-010):
```json
{ "projectId": "p_123", "phase": "plan", "exists": true, "path": "...", "content": "...", "mtimeMs": 1737550000000, "locked": true, "lockReason": "Agent führt gerade 'plan' aus" }
```

**Fehler**:
- `400` – `:phase` nicht in `FEATURE_PHASES`.
- `404` – Projekt nicht gefunden.

---

## 2. PUT `/api/projects/:id/phases/:phase/definition`

Schreibt neuen Inhalt in die Definitionsdatei; konflikt- und sperrgeschützt.

**Body** (`SavePhaseDefinitionRequest`):
```json
{ "content": "…neuer Markdown-Inhalt…", "baseMtimeMs": 1737550000000, "overwrite": false }
```

**Antwort 200** (`SavePhaseDefinitionResult`):
```json
{ "ok": true, "mtimeMs": 1737550999999 }
```

**Antwort 409 – Konflikt** (externe Änderung seit dem Öffnen, `overwrite !== true`) (FR-009):
```json
{
  "error": "conflict",
  "message": "Die Datei wurde seit dem Öffnen extern geändert.",
  "current": { "content": "…aktueller Serverinhalt…", "mtimeMs": 1737550500000 }
}
```
→ Client bietet **Überschreiben** (erneutes PUT mit `overwrite:true`) oder **Neu laden** (Server-`content` übernehmen).

**Antwort 409 – gesperrt** (Agent läuft) (FR-010):
```json
{ "error": "locked", "message": "Bearbeiten ist gesperrt, solange ein Agent 'plan' ausführt." }
```

**Fehler**:
- `400` – `:phase` ungültig oder `content`/`baseMtimeMs` fehlen.
- `404` – Projekt nicht gefunden **oder** keine Definitionsdatei vorhanden (kein Neuanlegen).
- `500` – Schreibfehler (z. B. nicht schreibbar); Client behält Eingaben (FR-007).

---

## 3. POST `/api/projects/:id/phases/:phase/definition/open-in-editor`

Öffnet die Definitionsdatei im konfigurierten externen Editor des Projekts (FR-011).

**Body**: keiner erforderlich.

**Verhalten**: Führt `project.editorCmd` (Default `code -g {file}:{line}`) mit `{file}` = absoluter Definitionspfad, `{line}` = 1 aus (via `loginShellEnv` + `shellQuotePath` + `exec`, `cwd = project.path`).

**Antwort 200**:
```json
{ "ok": true }
```

**Fehler**:
- `400` – `:phase` ungültig.
- `404` – Projekt nicht gefunden oder keine Definitionsdatei vorhanden.

---

## Web-Client-Methoden (`packages/web/src/api.ts`)

```text
phaseDefinition(projectId, phase)                    → GET  …/definition           : PhaseDefinition
savePhaseDefinition(projectId, phase, body)          → PUT  …/definition           : SavePhaseDefinitionResult (wirft bei 409/5xx)
openPhaseDefinitionInEditor(projectId, phase)        → POST …/definition/open-in-editor
```

## Kontrakt-Tests (Server, vitest)

- `phaseDefinitionPath`: Skills-Layout → korrekter `SKILL.md`-Pfad; Command-Layout → korrekter Pfad; fehlend → `null`.
- Konfliktlogik: `baseMtimeMs` == aktuell → schreibt; abweichend ohne `overwrite` → `conflict`; mit `overwrite` → schreibt.
- Lock-Logik: Feature mit `phases[phase].status==='running'` im Projekt → `locked=true`; sonst `false`.
- Route-Validierung: ungültige `phase` → `400`; fehlende Datei bei PUT → `404`.
