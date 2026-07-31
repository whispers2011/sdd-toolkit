# Data Model: Features aus Jira-Tickets erstellen

**Datum**: 2026-07-23 · **Basis**: spec.md (Key Entities), research.md

## 1. Persistente Entitäten

### 1.1 Feature (Erweiterung, `features`-Tabelle)

Bestehende Entität; erhält eine optionale Ticket-Referenz (FR-012, Schnappschuss-Charakter).

**Neue Spalten** (Migration Index 10, `user_version` 10 → 11 in `packages/server/src/db/database.ts`):

| Spalte | Typ | Beschreibung |
|---|---|---|
| `jira_key` | TEXT NULL | Ticketschlüssel des Ursprungstickets (z. B. `PROJ-123`) |
| `jira_url` | TEXT NULL | Browse-URL des Tickets (`https://<site>/browse/<key>`) |
| `jira_imported_at` | INTEGER NULL | Übernahmezeitpunkt (Unix-ms) |

Index: `CREATE INDEX idx_features_jira ON features(project_id, jira_key)` — Duplikat-Lookup (FR-010/FR-014).

**Shared-Typ** (`packages/shared/src/types.ts`):

```ts
interface Feature {
  // … bestehende Felder unverändert …
  jiraRef?: { key: string; url: string; importedAt: number };
}
```

**Regeln**:
- `jiraRef` ist unveränderlich nach der Anlage (Schnappschuss; kein Sync).
- Mehrere Features dürfen denselben `jira_key` tragen — aber nur nach ausdrücklicher Bestätigung (FR-014); kein UNIQUE-Constraint.
- `FeatureRepo`-Erweiterungen: Row↔`jiraRef`-Mapping, `setJiraRef(featureId, ref)`, `listJiraKeys(projectId): string[]`.

### 1.2 Jira-Verbindung (Datei, kein DB-Objekt)

Genau eine Verbindung je Toolkit-Nutzer (FR-001–FR-005), verwaltet vom SDK-`OAuthClientProvider`.

- **Ablage**: `~/.sdd-toolkit/atlassian-mcp.json` (Nutzerebene, überlebt Neustarts — FR-003)
- **Inhalt**: OAuth-Client-Registrierung (DCR) + Tokens; Struktur hoheitlich beim MCP-SDK, das Toolkit interpretiert sie nicht selbst
- **Lebenszyklus**: Datei fehlt → `disconnected`; Datei vorhanden + Tokens gültig → `connected`; Tokens ungültig/abgelaufen → `reauth_required`; Trennen = Datei löschen (FR-005)

### 1.3 Letzte Auswahl (`settings`-Tabelle)

- **Key**: `jira.lastSelection` via `SettingsRepo.getJson/setJson`
- **Wert**: `{ siteId: string; projectKey?: string; sprintId?: number }` (FR-009)

## 2. Transiente DTOs (`packages/shared/src/types.ts`)

```ts
type JiraConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reauth_required';

interface JiraConnectionStatus {
  state: JiraConnectionState;
  account?: { name: string; email?: string };   // via atlassianUserInfo
  site?: { id: string; name: string; url: string };
}

interface JiraSite { id: string; name: string; url: string }           // getAccessibleAtlassianResources

interface JiraProject { id: string; key: string; name: string }        // getVisibleJiraProjects

interface JiraSprint {
  id: number;
  name: string;
  state: 'active' | 'future';
  startDate?: string;   // ISO
  endDate?: string;     // ISO
}

interface JiraIssueSummary {
  key: string;
  title: string;
  type: string;         // z. B. Story, Bug
  status: string;       // Jira-Status-Name
  imported: boolean;    // FR-010: bereits als Feature übernommen (im aktuellen Projekt)
}

interface JiraImportResult {
  issueKey: string;
  status: 'created' | 'failed' | 'skipped_duplicate';
  featureId?: string;   // bei created
  error?: string;       // bei failed, verständliche Meldung (FR-015)
}
```

## 3. Zustandsübergänge

### 3.1 Jira-Verbindung

```text
disconnected --startConnect()--> connecting --handleCallback(code)--> connected
connected --Token ungültig/401--> reauth_required --startConnect()--> connecting
connected | reauth_required --disconnect()--> disconnected   (Datei gelöscht, FR-005)
```

- `connecting` ist flüchtig (offener Browser-Flow); Abbruch fällt auf den vorherigen Zustand zurück.
- `reauth_required` wird beim ersten fehlschlagenden Tool-Call erkannt und im Status gemeldet (FR-004, Edge Case „Ablauf mitten in der Sitzung").

### 3.2 Ticket-Übernahme (je Ticket, FR-011–FR-016)

```text
ausgewählt → [bereits importiert & unbestätigt?] → skipped_duplicate
           → Ticket laden (getJiraIssue, Kommentare, Links, Anhänge)
           → Namen eindeutig machen (Slug; Kollision → Suffix Ticketschlüssel)
           → orchestrator.createFeature(...)  → Feature + Worktree + Specify-Start
           → Dossier + Anhänge in specs/<slug>/jira/ schreiben
           → FeatureRepo.setJiraRef(...)      → created
Fehler in einem Schritt → failed (übrige Tickets laufen weiter)
```

## 4. Ablage im Feature-Worktree (US4)

```text
specs/<feature-slug>/jira/
├── ticket.md            # Dossier: Titel, Beschreibung, alle ausgefüllten Felder,
│                        # Kommentare (Autor + Zeitpunkt), Anhangsliste (FR-017/FR-019)
└── attachments/         # zugängliche Anhänge, Originaldateinamen (FR-018)
```

Nicht abrufbare Anhänge erscheinen nur im Dossier als Verweis (Name + Quell-URL).

## 5. Validierungsregeln (aus Requirements)

- Feature-Name: eindeutig je Projekt (bestehendes `UNIQUE(project_id, name)`); Kollision → automatischer Suffix aus dem Ticketschlüssel (FR-013).
- Import ohne Verbindung bzw. mit `reauth_required` → 401 mit Hinweis, keine Teilanlage.
- `issueKeys` beim Import: nicht leer; unbekannte/unzugängliche Keys → `failed` je Ticket, kein Gesamtabbruch (FR-015).
- Leere Ticket-Felder werden im Dossier ausgelassen (FR-017).
