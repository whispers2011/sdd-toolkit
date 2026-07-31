# Contract: Aufmerksamkeit („braucht dich") & UI-Anzeigezustand

Betrifft `packages/web/src/components/KanbanBoard.tsx`, `FeatureConsole.tsx` und den Aufmerksamkeits-Mechanismus (FR-003, FR-004, FR-009).

## UI-Ableitung „läuft …" (rein clientseitig)

Eingaben pro Kachel/Phase: `phaseState.status` (aus `feature.phases[p]`) und `session.status` (aus `SessionInfo`, bereits im Store; `session` = lebende Feature-Session).

```text
läuft …            ⟺ phaseState.status === 'running' && session?.status ∈ {working, awaiting_input}
wird gestartet …   ⟺ phaseState.status === 'running' && session vorhanden && session.status === 'idle'
(kein läuft)       ⟺ phaseState.status === 'running' && (kein session || session.status ∈ {stopped, errored})
```

- **KanbanBoard** (`:213`): Badge „läuft …" nach obiger Regel; im dritten Fall stattdessen kein Badge (der Zustand erscheint über die „braucht dich"-Inbox).
- **PhaseStrip** (`FeatureConsole.tsx:161`): `animate-pulse` nur im „läuft …"-Fall; im transitorischen Fall dezente „wird gestartet …"-Kennzeichnung.
- Der bereits vorhandene, wahre `status-dot` (`KanbanBoard.tsx:169`) bleibt unverändert (bindet an `session.status`).

**Garantie (FR-003 / SC-003)**: Keine „läuft …"-Anzeige ohne tatsächlich arbeitende Session.

## Aufmerksamkeits-Items

Wiederverwendung von `AttentionRepo.raise(...)` und der bestehenden „braucht dich"-Inbox (`GET /api/attention`, `attention_raised`/`attention_resolved`-Events).

| Situation | kind | Erzeugt in |
|-----------|------|------------|
| Startfehler / Zustellung endgültig gescheitert | `agent_errored` | `orchestrator.startPhaseRun` / `onSubmitFailed` |
| Lauf durch Neustart unterbrochen (fortsetzbar) | `run_interrupted` *(neu, additiv)* oder `agent_errored` | `orchestrator.reapOnBoot` |

- `AttentionItem.message` enthält einen erkennbaren, menschenlesbaren Hinweis (Feature-Name + Ursache).
- **Auflösung**: automatisch über den bestehenden Pfad — wird die Session wieder `working`, ruft `handleStatusChange` `attention.resolveFor({ sessionId, kinds })` und emittiert `attention_resolved`. Fortsetzen per „Run" führt also zur Auflösung, sobald der Lauf wirklich arbeitet.

## Nicht betroffen

- Berechtigungs-Rückfragen (`awaiting === 'permission'`) erscheinen weiterhin **nicht** in der „braucht dich"-Inbox (bestehende Regel in `handleStatusChange`).
- PromptBar „Senden" (`FeatureConsole.tsx:107`) bleibt unverändert (nutzt `sendPrompt`, profitiert transparent von der zuverlässigen Zustellung).

## Testbare Akzeptanz

- Phase `running`, Session `working` → „läuft …" sichtbar. (US2 AC1)
- Phase `running`, keine lebende Session → kein „läuft …"; Item in „braucht dich". (US2 AC2/AC3, FR-009)
- Startfehler → „braucht dich"-Item mit Fehlerhinweis erscheint, kein „läuft …". (FR-004)
- Nach erfolgreichem Fortsetzen (Session `working`) → zugehöriges „braucht dich"-Item ist aufgelöst.
