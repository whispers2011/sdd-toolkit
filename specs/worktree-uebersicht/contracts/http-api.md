# HTTP-API-Contract: Worktree-Übersicht

Neue Routen-Datei `packages/server/src/api/worktreeRoutes.ts`, eingehängt in `buildServer()`
(Muster: `reviewRoutes.ts`). Alle Antworten JSON; Fehler als `{ message: string }` mit
passendem Status, zusätzlich `{ error: <code> }` bei den unterscheidbaren 409-Fällen.
**Keine Änderung an bestehenden Endpunkten. Kein neues WS-Event** (siehe research.md D8) —
das Entfernen sendet das bestehende `feature_updated`.

---

## `GET /api/worktrees`

Vollständige, tool-weite Momentaufnahme über **alle** konfigurierten Projekte.

**Query**

| Parameter | Typ | Bedeutung |
|---|---|---|
| `refresh` | `"1"` (optional) | Umgeht den 2-s-TTL-Cache — vom Button „↻ Aktualisieren" gesetzt (FR-030) |

**Antwort** `200 WorktreeOverview`

```jsonc
{
  "collectedAt": 1785000000000,
  "groups": [
    {
      "projectId": "p1",
      "projectName": "sdd-toolkit",
      "projectPath": "/Users/x/iwf-projects/sdd-toolkit",
      "defaultBranch": "main",
      "main": {
        "projectId": "p1",
        "projectName": "sdd-toolkit",
        "path": "/Users/x/iwf-projects/sdd-toolkit",
        "branch": "main",
        "defaultBranch": "main",
        "uncommittedFileCount": 2
      },
      "worktreeCount": 2,
      "worktrees": [
        {
          "id": "p1::/Users/x/.sdd-toolkit/worktrees/p1/worktree-uebersicht",
          "projectId": "p1",
          "kind": "feature",
          "label": "worktree-uebersicht",
          "path": "/Users/x/.sdd-toolkit/worktrees/p1/worktree-uebersicht",
          "branch": "feature/worktree-uebersicht",
          "dirState": "present",
          "featureId": "f7",
          "targetBranch": "main",
          "createdAt": 1784900000000,
          "sessionActive": true,
          "removable": false,
          "changedFileCount": 3,
          "uncommittedFileCount": 1,
          "files": [
            { "path": "packages/web/src/App.tsx", "oldPath": null, "kind": "modified",
              "state": "committed", "overlapping": true, "behindTarget": false }
          ],
          "filesTruncated": false,
          "warnings": [
            { "kind": "overlap", "files": ["packages/web/src/App.tsx"], "fileCount": 1,
              "others": [{ "entryId": "p1::/…/anderes-feature", "label": "anderes-feature",
                           "featureId": "f9" }] }
          ],
          "error": null
        }
      ],
      "error": null
    }
  ]
}
```

**Vertragszusagen**

- `groups` enthält **jedes** konfigurierte Projekt — auch unerreichbare (dann `error` gesetzt,
  `main: null`, `worktrees: []`). Ein defektes Projekt liefert nie 5xx (FR-032).
- `worktrees` enthält **alle** von git geführten Worktrees außer dem Haupt-Checkout, **plus**
  Features mit gesetztem `worktreePath`, den git nicht (mehr) kennt (`dirState: "missing"`,
  FR-009), **plus** Registry-Leichen (`dirState: "registry_only"`).
- `files` ist auf 300 Einträge gekürzt (`filesTruncated`); `changedFileCount` nennt immer die
  Gesamtzahl (FR-014/FR-016).
- Die Überschneidungs-Erkennung arbeitet serverseitig auf den **ungekürzten** Listen.
- Der Endpunkt ist **read-only** — er verändert weder Arbeitskopien noch DB.

**Fehler**: `500` nur bei einem Fehler außerhalb der projektbezogenen Erhebung (z. B.
DB nicht lesbar). Projektbezogene Fehler wandern in `groups[].error`.

---

## `POST /api/worktrees/remove`

Entfernt **genau einen** Worktree (FR-022). Einzige verändernde Operation des Features.

**Body**

| Feld | Typ | Pflicht | Bedeutung |
|---|---|---|---|
| `projectId` | `string` | ja | Projekt, dessen Worktree entfernt wird |
| `path` | `string` | ja | Pfad des Worktrees — muss in der **frisch gelesenen** Worktree-Liste dieses Projekts vorkommen |
| `force` | `boolean` | nein | Zweitbestätigung bei uncommitteten Änderungen (FR-024) |

**Erfolg** `200 { "ok": true, "featureId": string | null }`

Nachwirkungen: `git worktree remove [--force] <path>`; bei zugeordnetem Feature
`features.setWorktree(id, null)` + WS `feature_updated`; Übersicht-Cache verworfen.

**Fehlerfälle**

| Status | Body | Auslöser | Anforderung |
|---|---|---|---|
| `400` | `{ message }` | `projectId`/`path` fehlt | — |
| `400` | `{ error: "not_a_worktree", message }` | Pfad ist in diesem Projekt kein geführter Worktree (Schutz vor beliebigen Löschzielen) | Sicherheitsgrenze |
| `400` | `{ error: "main_checkout", message }` | Pfad ist der Haupt-Checkout | FR-026 |
| `400` | `{ error: "not_removable", message }` | `dirState` ist `registry_only`/`missing` — Prune/Reparatur sind außerhalb des Umfangs | Assumptions |
| `404` | `{ message }` | Projekt unbekannt | — |
| `409` | `{ error: "session_active", message }` | Nicht beendete Session mit `cwd` im Worktree | FR-025 |
| `409` | `{ error: "uncommitted", uncommittedFileCount: n, message }` | Uncommittete Änderungen **und** `force` nicht gesetzt | FR-024, SC-009 |
| `500` | `{ error: "remove_failed", message }` | `git worktree remove` fehlgeschlagen — keine DB-Änderung | FR-027 |

**Ablauf im Client** (siehe [ui-contract.md](./ui-contract.md))

```text
„Entfernen" → 1. Bestätigung (Feature, Branch, Pfad, Anzahl Änderungen)
            → POST ohne force
              ├─ 200            → Liste neu laden
              ├─ 409 uncommitted→ 2. Bestätigung („n uncommittete Änderungen gehen verloren")
              │                    → POST mit force:true → 200 → Liste neu laden
              ├─ 409 session_active → Meldung, keine Wiederholung
              └─ 4xx/5xx        → Klartextmeldung, Liste bleibt konsistent
```

---

## Caching-Verhalten (serverseitig)

| Eigenschaft | Wert |
|---|---|
| TTL | 2000 ms |
| Geltungsbereich | gesamte Übersicht (alle Projekte) |
| In-Flight-Dedupe | ja — parallele Abrufe teilen dieselbe laufende Erhebung |
| Invalidierung | `?refresh=1`, erfolgreiches `POST /api/worktrees/remove` |

Der Cache ist eine reine Lastbremse gegen das 5-s-Polling; er darf nie zu einer Anzeige
führen, die älter als seine TTL ist — `collectedAt` weist den tatsächlichen Stand aus (FR-028/031).

---

## Nicht Teil dieses Contracts

- Branch löschen, `git worktree prune`, `git worktree repair` (ausdrücklich außerhalb des Umfangs)
- Datei-Inhalte / Diffs (bleibt beim Review-Portal)
- Neue WS-Events, neue Tabellen, neue Settings-Schlüssel
