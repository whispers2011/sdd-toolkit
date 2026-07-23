# Phase 1 Data Model: Kommandos direkt ausführen statt nur vorausfüllen

**Keine Datenbank-Migration.** Das Feature ändert Verhalten und ephemeren Laufzeitzustand, nicht das persistente Schema. Persistente Phasen (`PhaseState`) und Aufmerksamkeits-Items (`AttentionItem`) existieren bereits. Unten sind die betroffenen Entitäten mit ihren (teils neuen, ephemeren) Feldern und Übergängen.

## 1. Session-Sendezustand (ephemer, in-memory)

Ergänzt `LiveSession` in `packages/server/src/pty/sessionManager.ts` — nie persistiert.

| Feld | Typ | Bedeutung |
|------|-----|-----------|
| `pendingPrompts` | `string[]` | Prompts, die eingereiht wurden, weil die Session beim `sendPrompt`-Aufruf noch nicht bereit war (`created`/`launching`). |
| `submitPending` | `{ text: string; attempts: number; timer: Timeout \| null } \| null` | Aktuell abgeschickter Prompt, dessen Zustellung noch nicht via Session-Übergang bestätigt ist. |

**Bereitschaftsdefinition** (pure Ableitung aus `SessionMachine.state`):
- **Bereit zum Absenden**: `state.kind ∈ { ready, working, turn_done, awaiting_input }`
- **Noch nicht bereit (einreihen)**: `state.kind ∈ { created, launching }`
- **Nicht sendbar (Fehler)**: `state.kind ∈ { stopped, errored }`

**Ablauf-Übergänge**:
1. `sendPrompt(text)` → bereit? paste + CR, `submitPending` setzen. nicht bereit? `pendingPrompts.push(text)`.
2. Session erreicht `ready` (Hook `session_start`) → `pendingPrompts` FIFO abspülen.
3. Übergang nach `working` **oder** Hook `user_prompt_submit` innerhalb Bestätigungsfenster → `submitPending` als bestätigt löschen.
4. Kein Übergang → CR-Retry, `attempts++`; `attempts > MAX` → `onSubmitFailed(text)`.

## 2. PhaseState (bestehend, `packages/shared/src/types.ts` / `phaseMachine.ts`)

Werte unverändert: `idle | running | awaiting_review | approved` (+ `stale`, `startedAt`, `finishedAt`, `exitCode`).

**Semantik-Präzisierung durch dieses Feature** (kein neuer Wert):
- `running` bleibt „Intent: dieser Lauf soll laufen". Die **Anzeige** „läuft …" wird zusätzlich an den echten Session-Zustand gekoppelt (siehe §4), statt allein aus `running` abgeleitet zu werden.
- Verwaiste `running`-Phasen (Neustart) → `idle` **plus** Aufmerksamkeits-Item (fortsetzbar). Startfehler → Rollback `running → idle` **plus** Aufmerksamkeits-Item.

## 3. AttentionItem (bestehend, `AttentionRepo` / `types.ts`)

Wiederverwendung der Exception-Inbox („braucht dich"). Neue Auslöser dieses Features:

| Auslöser | `kind` | Beispiel-`message` |
|----------|--------|--------------------|
| Lauf durch Neustart unterbrochen | `run_interrupted` *(neu)* oder `agent_errored` *(Fallback)* | „<feature>: Lauf unterbrochen — per Run fortsetzbar" |
| Start/Zustellung fehlgeschlagen | `agent_errored` | „<feature>: Phase <p> konnte nicht gestartet werden" |

`AttentionKind` (in `types.ts`) ggf. um `run_interrupted` erweitern (rein additiv). Auflösung erfolgt über den bestehenden Weg: sobald die Session wieder `working` wird, ruft `handleStatusChange` `attention.resolveFor(...)`.

## 4. UI-Anzeigezustand (abgeleitet, `packages/web`)

Rein clientseitige Ableitung aus vorhandenen Feldern (`feature.phases[p].status`, `session.status`). Kein neues Transportfeld.

| Bedingung | Anzeige |
|-----------|---------|
| Phase `running` **und** `session.status ∈ {working, awaiting_input}` | **„läuft …"** (bzw. Puls im PhaseStrip) |
| Phase `running` **und** lebende Session, aber noch nicht arbeitend (`idle`) | **„wird gestartet …"** (transitorisch) |
| Phase `running` **und** keine lebende Session / `stopped`/`errored` | kein „läuft"; erscheint über Aufmerksamkeits-Item („braucht dich") |
| Phase `idle`/`awaiting_review`/`approved` | bestehende Darstellung (Start/Approve/…) |

## Beziehungen

```text
Feature 1───* PhaseState (running steuert Intent)
Feature 1───0..1 LiveSession (ephemer; status = echte Ausführung)
LiveSession 1───0..1 submitPending / *─ pendingPrompts (ephemere Sendekontrolle)
Feature/Session 1───* AttentionItem (braucht dich: unterbrochen / Startfehler)
```

Kein persistentes Feld kommt hinzu; einzige potenzielle Typ-Erweiterung ist der additive `AttentionKind 'run_interrupted'`.
