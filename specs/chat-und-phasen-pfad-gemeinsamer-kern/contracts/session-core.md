# Vertrag: Session sicherstellen (`services/core/sessionCore.ts`)

Erfüllt **FR-001** (genau eine Implementierung), **FR-004** (Unterschiede über Parameter),
**FR-005** (Fehlerbild bleibt beim Pfad), **FR-013…FR-016**.
Aufrufer: `Orchestrator.ensureSession`, `ChatWorkService.ensure`.

## Oberfläche

```ts
export type SpawnStage = 'worktree' | 'spawn';

export interface SessionSpec {
  project: Project;
  featureId: string | null;
  conversationId: string | null;
  kind: 'feature' | 'chat_work';
  /** Bereits laufende Session dieses Bezugsobjekts — dann passiert nichts weiter. */
  existing: LiveSession | undefined;
  workspace: WorkspaceSpec;
  previous: { id: string; claude_session_id: string | null } | null;
  automation: AutomationSettings;
  appendSystemPrompt?: string;
  model?: string;
  onWorktreeReady?: (path: string) => void;
  wrapError?: (stage: SpawnStage, err: Error) => Error;
}

export class SessionCore {
  constructor(deps: { sessions: SessionRepo; ptys: PtySessionManager; worktrees: WorktreeManager });

  /**
   * Höchstens ein Vorgang je `key`. `resolve` wird INNERHALB des Schutzes gerufen —
   * der zweite Aufrufer bekommt das laufende Versprechen, nicht einen zweiten Vorgang.
   */
  ensure(key: string, resolve: () => SessionSpec | Promise<SessionSpec>): Promise<LiveSession>;
}
```

## Ablauf (verbindlich in dieser Reihenfolge)

```text
1  Läuft für `key` schon ein Vorgang?      → dasselbe Promise zurückgeben          (FR-013)
2  resolve() aufrufen                       → darf werfen (Vorprüfungen des Pfads)
3  spec.existing gesetzt?                   → zurückgeben, Ende                    (FR-016)
4  ensureWorkspace(spec.workspace)          → Fehler durch wrapError('worktree')   (FR-005)
5  spec.onWorktreeReady?.(path)
6  Resume-Prüfung: previous.claude_session_id vorhanden UND
   locateTranscript(path, id) findet nichts → sessions.setClaudeSessionId(prev.id, null),
                                              Kennung verwerfen                    (FR-014)
7  buildClaudeArgv({ resume?, settingsPath: '__SETTINGS__', appendSystemPrompt?, model?,
                     permissionMode: automation.autoMode ? 'bypassPermissions' : 'acceptEdits' })
                                                                                    (FR-015)
8  ptys.spawn({ projectId, featureId, conversationId, kind, cwd: path, argv,
                withHooks: true })          → Fehler durch wrapError('spawn')       (FR-005)
9  sessions.create({ id, featureId, conversationId, projectId, kind, pid })
10 LiveSession zurückgeben
11 finally: Eintrag aus der In-Flight-Karte entfernen (auch im Fehlerfall)
```

## Zusicherungen

| # | Zusicherung | Prüfung |
|---|---|---|
| S1 | Zwei gleichzeitige `ensure(key, …)` erzeugen genau einen Prozess und liefern dieselbe Session-Kennung. | SC-005, US2 Szenarien 1+2 |
| S2 | Nach Abschluss ist der Schutz frei — ein späterer Aufruf läuft wieder voll durch. | bestehender Test `chatWorkService.test.ts:546` |
| S3 | Ein Fehler in `resolve()`, in Schritt 4 oder 8 erreicht **alle** wartenden Aufrufer und gibt den Schutz frei. | bestehender Test `orchestrator.test.ts:402` |
| S4 | Der Kern schreibt keinem Pfad seine Fehlerdarstellung vor: ohne `wrapError` fliegt der rohe Fehler. | FR-005, US2 Szenario 5 |
| S5 | Eine tote Claude-Session-Kennung wird verworfen **und** in der Datenbank genullt, bevor gestartet wird. | US2 Szenario 3 |
| S6 | Der Berechtigungsmodus folgt allein `automation.autoMode`. | FR-015 |

## Was der Aufrufer beisteuert (die Unterschiede, FR-004)

| | Phasen-Pfad | Chat-Pfad |
|---|---|---|
| `key` | `feature:<featureId>` | `chat:<projectId>` |
| Vorprüfung in `resolve()` | Feature + Projekt laden; **nach** `ptys.forFeature` prüfen, ob das Feature abgeschlossen ist → `Error` | Projekt laden → `ChatError(404)`; `chatRepo.ensureActive(projectId, 'work')` |
| `existing` | `ptys.forFeature(featureId)` | `ptys.forConversation(conv.id)` |
| Namensbildung | `feature.name` / `feature/<slug>` | `chat-<convId>` / `chat/<convId>` |
| `previous` | `sessions.latestForFeature(featureId)` | `sessions.latestForConversation(conv.id)` |
| `automation` | `resolveAutomation(global, project, feature)` | `resolveAutomation(global, project, {})` |
| `appendSystemPrompt` | — | `buildChatWorkSystemPrompt(project)` |
| `model` | — | `deps.model` |
| `onWorktreeReady` | `features.setWorktree(id, path)` | — |
| `wrapError` | — (roher Fehler) | `new ChatError(503, 'Arbeitskopie konnte nicht erstellt werden: …' \| 'Session konnte nicht gestartet werden: …')` |

**Reihenfolge-Hinweis**: Im Phasen-Pfad steht heute die Prüfung „läuft schon eine Session?" vor
der Prüfung „ist das Feature abgeschlossen?" (`orchestrator.ts:262` vor `:267`). Ein
abgeschlossenes Feature mit laufender Session bekommt also seine Session zurück, statt einen
Fehler zu werfen. `resolve()` muss diese Reihenfolge beibehalten.

## Rückgabe an die Aufrufer

`Orchestrator.ensureSession` liefert weiterhin `Promise<LiveSession>`; `ChatWorkService.ensure`
liefert weiterhin `Promise<{ sessionId: string }>` und setzt zusätzlich seine Turn-Marke
(`turnStart.set(session.id, 0)`). Die HTTP-Verträge von `POST /api/projects/:id/chat/work/*`
bleiben zeichengleich.
