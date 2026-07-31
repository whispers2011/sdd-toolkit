# Vertrag: Arbeitskopie sicherstellen (`services/core/workspace.ts`)

Erfüllt **FR-003** (genau eine Implementierung) und **FR-005** (Fehlerbild bleibt beim Pfad).
Aufrufer: `Orchestrator.createFeature`, `SessionCore.ensure`. Der Chat ruft nicht direkt auf —
er kommt über `SessionCore`.

## Oberfläche

```ts
export interface WorkspaceSpec {
  project: Project;              // id, name, path, defaultBranch
  name: string;                  // Verzeichnisname der Arbeitskopie
  branch: string;                // Zweigname
  recordedPath: string | null;   // zuletzt bekannter Pfad, oder null
}

/** Legt die Arbeitskopie an oder übernimmt die vorhandene; liefert den echten Pfad. */
export function ensureWorkspace(
  worktrees: WorktreeManager,
  spec: WorkspaceSpec,
): Promise<string>;
```

## Zusicherungen

| # | Zusicherung |
|---|---|
| W1 | **Idempotent.** Existiert am Ziel eine gültige Arbeitskopie, wird ihr Pfad zurückgegeben, ohne etwas anzulegen. |
| W2 | **Waisen-Erholung.** Ist `recordedPath` gesetzt, das Verzeichnis aber weg, wird der Registry-Eintrag best-effort entfernt (`worktrees.remove`, Fehler werden geschluckt) und danach neu angelegt. |
| W3 | **Serialisiert je (Repo, Zweig).** Ererbt von `WorktreeManager.create`; zwei gleichzeitige Aufrufe legen den Zweig nicht doppelt an. |
| W4 | **Wirft roh.** Der Fehler von `worktrees.create` wird unverändert weitergereicht; das Einkleiden ist Sache des Aufrufers (`SessionCore` über `wrapError`, `createFeature` gar nicht). |
| W5 | **Kein Nebenwirkungs-Schreiben.** Die Funktion vermerkt den Pfad nirgends — das tut der Aufrufer über `onWorktreeReady` bzw. direkt. |

## Aufrufbeispiele

```ts
// Phasen-Pfad, neues Feature (vor der Feature-Zeile — die braucht den Pfad):
const path = await ensureWorkspace(worktrees, {
  project, name: slug, branch: `feature/${slug}`, recordedPath: null,
});

// Chat-Pfad (über SessionCore):
workspace: {
  project,
  name: `chat-${conv.id}`,
  branch: `chat/${conv.id}`,
  recordedPath: worktrees.pathFor(project, `chat-${conv.id}`),
}
```

## Was sich für die Aufrufer ändert

| Aufrufer | vorher | nachher |
|---|---|---|
| `Orchestrator.createFeature` | `worktrees.create({…})` direkt | `ensureWorkspace(…)`, `recordedPath: null` |
| `Orchestrator.ensureSessionInner` | eigener Block mit Waisen-Erholung | fällt weg, kommt aus `SessionCore` |
| `ChatWorkService.ensureUnlocked` | `worktrees.create({…})` ohne Waisen-Erholung | fällt weg, kommt aus `SessionCore` — **bekommt W2 neu** |
