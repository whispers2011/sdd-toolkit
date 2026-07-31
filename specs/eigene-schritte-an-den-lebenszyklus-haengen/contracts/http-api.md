# Vertrag: HTTP-API

Fünf neue Endpunkte, wörtlicher Zwilling der `/api/agents`-Routen. Alle liegen in
`packages/server/src/api/server.ts` direkt neben diesen. Fehler folgen dem bestehenden
`httpError(code, message)`-Muster; der Origin-Guard gilt unverändert für alle Routen.

**Kein** Endpunkt für einen manuellen Einzellauf — anders als bei Agents ist das Out of Scope.

---

## GET /api/lifecycle-steps

Verwaltungsliste.

| Query | Bedeutung |
|---|---|
| — | alle Schritte (global + alle Projekte), sortiert `project_id NULLS FIRST, sort_order, name` |
| `?projectId=<id>` | Union: globale **und** Schritte dieses Projekts, sortiert `project_id IS NOT NULL, sort_order, name` |
| `?projectId=global` | wie ohne Query (Vorbild: `/api/agents`) |

**200** → `LifecycleStep[]`

```json
[
  {
    "id": "kQ7x2mAb9c",
    "projectId": null,
    "name": "Abhängigkeiten installieren",
    "command": "pnpm install --frozen-lockfile",
    "trigger": { "kind": "after_worktree_create" },
    "blocking": true,
    "timeoutMs": 600000,
    "enabled": true,
    "sortOrder": 0
  },
  {
    "id": "Lm3pQ8ttZa",
    "projectId": "p1",
    "name": "Typen prüfen",
    "command": "pnpm -r typecheck",
    "trigger": { "kind": "after_phase", "phase": "implement" },
    "blocking": false,
    "timeoutMs": null,
    "enabled": true,
    "sortOrder": 10
  }
]
```

---

## PUT /api/lifecycle-steps

Anlegen **oder** aktualisieren (Upsert über `id`; fehlendes `id` = Neuanlage).

**Body**: `LifecycleStep` ohne `id` (Neuanlage) bzw. mit `id` (Änderung).

**Validierung** (alle → **400**):

| Prüfung | Meldung |
|---|---|
| `name.trim()` leer | `Name fehlt` |
| `command.trim()` leer | `Kommando fehlt` |
| `trigger.kind` ∉ `LIFECYCLE_TRIGGER_KINDS` | `Unbekannte Auslöser-Art` |
| `before_phase`/`after_phase` ohne gültige Phase | `Phasen-Auslöser braucht eine gültige Phase` |
| `before_stage`/`after_stage` ohne gültige Stufe | `Stufen-Auslöser braucht eine gültige Stufe` |
| `phase` bei einer Art, die keine kennt | `Auslöser-Art erlaubt keine Phase` |
| `stage` bei einer Art, die keine kennt | `Auslöser-Art erlaubt keine Stufe` |
| `timeoutMs` gesetzt und ≤ 0 oder > 86 400 000 | `Zeitlimit muss zwischen 1 ms und 24 h liegen` |

**404** `Projekt nicht gefunden`, wenn `projectId` gesetzt ist und nicht existiert.

**200** → der gespeicherte `LifecycleStep` (mit normalisiertem Trigger: nicht zutreffende Felder
fehlen).

---

## DELETE /api/lifecycle-steps/:id

**200** → `{ "ok": true }` (idempotent — ein unbekanntes `id` ist kein Fehler, Vorbild
`/api/agents/:id`).

Bisherige Läufe bleiben lesbar: `executions.label` trägt den Namen (FR-028). Zeilen in
`lifecycle_step_feature_selection` werden per `ON DELETE CASCADE` mitentfernt.

---

## GET /api/features/:id/lifecycle-steps

Effektive Sicht eines Features: Union (global ∪ Projekt) + Auswahl + jüngster Lauf.

**404** `Feature nicht gefunden`.

**200** → `FeatureLifecycleStepView[]`

```json
[
  {
    "step": { "id": "kQ7x2mAb9c", "name": "Abhängigkeiten installieren", "…": "…" },
    "decision": "auto",
    "effective": true,
    "lastRun": {
      "executionId": "a1B2c3D4e5",
      "startedAt": 1769812345678,
      "finishedAt": 1769812389012,
      "status": "succeeded",
      "exitCode": 0
    }
  }
]
```

`effective` = `decision === 'include' ? true : decision === 'exclude' ? false : step.enabled`
(identisch mit `/api/features/:id/agents`).

---

## PUT /api/features/:id/lifecycle-steps/selection

Per-Feature-Ausnahme setzen oder aufheben.

**Body**: `{ "stepId": string, "decision": "include" | "exclude" | "auto" }`

- `auto` löscht die Zeile (Ebene darüber gilt wieder).
- **400** `decision muss include|exclude|auto sein`
- **404** `Feature nicht gefunden` / `Schritt nicht gefunden`

**200** → `{ "ok": true }`

---

## Unveränderte Endpunkte, die das Feature mitbedienen

| Endpunkt | Warum er ohne Änderung trägt |
|---|---|
| `GET /api/executions?featureId=` | liefert Schritt-Läufe mit `kind:"lifecycle_step"`, `label`, `exitCode`, Zeitraum (FR-017/FR-019) |
| `GET /api/runs` | aggregiert Schritt-Läufe als eigenen Step des Laufs (`key: "lifecycle_step"`, Kategorie `overhead`) |
| `GET /api/executions/:id/log` | bedient die vollständige Ausgabe über „Fall A: physische Log-Datei" (FR-019) |
| `GET /api/attention` | listet `lifecycle_step_failed` mit; `POST /api/attention/:id/resolve` löst manuell auf |
| `POST /api/features/:id/session` | erneutes Anstoßen der Worktree-Vorbereitung (Wiederanlauf, FR-025) |
| `POST /api/features/:id/phases/:phase/start` | erneutes Anstoßen eines Phasen-Auslösers |
| `POST /api/features/:id/retry-integration` | erneutes Anstoßen der Integrations-Stufen |

**Kein neues WebSocket-Event.** Zustandsänderungen fließen über die bestehenden Events
`feature_updated`, `attention_raised`, `attention_resolved` und `execution_updated`.
