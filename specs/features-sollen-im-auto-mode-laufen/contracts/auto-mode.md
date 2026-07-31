# Contracts — Features im Auto-Modus

Die Feature berührt drei Vertragsflächen: die HTTP-API für Automation-Einstellungen,
den internen Session-Start-Vertrag (CLI-Argumente) und das Attention-/Event-Verhalten.
Keine neuen Endpunkte — bestehende Endpunkte akzeptieren lediglich ein zusätzliches Feld.

## 1. HTTP: globale Automation setzen

**`PUT /api/settings/automation`** (bestehend, `packages/server/src/api/server.ts:514-516`)

- Body: `Partial<AutomationSettings>` — nimmt jetzt zusätzlich `autoMode?: boolean` an.
- Verhalten: mergt über die aktuelle globale Einstellung und persistiert; gibt die vollständige `AutomationSettings` zurück (inkl. `autoMode`).
- Beispiel:
  ```json
  // Request
  { "autoMode": false }
  // Response (200)
  { "autoProgressUntil": "off", "autoVerify": false, "autoReviewAgents": false, "autoMerge": false, "autoMode": false }
  ```

**`GET /api/settings/automation`** (bestehend) — Response enthält jetzt `autoMode`.

**Bootstrap** (`GET /api/state` bzw. Bootstrap-Payload, `server.ts:75`) — `automation` enthält `autoMode`.

## 2. HTTP: Projekt-/Feature-Override

- **`PATCH /api/features/:id`** (bestehend, `server.ts:240-246`) — `body.automation: Partial<AutomationSettings>` darf `autoMode` enthalten.
- **`PATCH /api/projects/:id`** (bestehend, `server.ts:155`) — `automation` im erlaubten Key-Set; darf `autoMode` enthalten.
- Auflösung: `resolveAutomation(global, project, feature)` — unveränderte Semantik, mergt `autoMode` mit.

## 3. Intern: Session-Start-Vertrag

**`orchestrator.ensureSession(featureId)`** → `buildClaudeArgv({ …, permissionMode })`

- Vorbedingung: `permissionMode` wird aus `resolveAutomation(...).autoMode` abgeleitet:
  - `autoMode === true`  ⇒ `permissionMode = 'bypassPermissions'`
  - `autoMode === false` ⇒ `permissionMode = 'acceptEdits'`
- Nachbedingung: Der gespawnte Claude-Prozess erhält `--permission-mode <mode>`.
- Invariante: `buildClaudeArgv` bleibt unverändert (die `PermissionMode`-Union kennt `bypassPermissions` bereits).
- Headless-Läufe (`buildHeadlessArgv`) sind **nicht** betroffen.

## 4. Attention- / Event-Verhalten

**`orchestrator.handleStatusChange(session, effects)`** (`server.ts`/`orchestrator.ts:280-303`)

- Vertrag: Für `effect.kind === 'input_requested'` mit `effect.awaiting === 'permission'` wird
  - **kein** `attention.raise({ kind: 'permission_request', … })` ausgeführt,
  - **kein** `bus.emitEvent('notification', … kind: 'input_requested')` für den Permission-Fall gesendet.
- Für `awaiting === 'question'` und `awaiting === 'plan_approval'` bleibt das Verhalten unverändert (Item `awaiting_input` + Notification).
- Der `session_status`-Event (mit `awaitingKind: 'permission'`) wird weiterhin publiziert — der Wartezustand ist über Status/Konsole sichtbar, nur nicht als Inbox-Eintrag.

**Inbox-Anzeige** (`AttentionInbox.tsx`, `App.tsx` Zähler)

- Vertrag: Items mit `kind === 'permission_request'` werden aus der gerenderten Liste **und** aus dem offenen-Items-Zähler herausgefiltert (Absicherung gegen Alt-Rows).

## Betroffene / unveränderte Verträge

| Fläche | Änderung |
|--------|----------|
| `PUT/GET /api/settings/automation` | akzeptiert/liefert `autoMode` |
| `PATCH /api/features/:id`, `/api/projects/:id` | `automation` darf `autoMode` tragen |
| `ensureSession` → `buildClaudeArgv` | dynamischer `permissionMode` |
| `buildClaudeArgv`, `buildHeadlessArgv` | **unverändert** |
| `handleStatusChange` | kein Raise/Notification für `permission` |
| WS-Events (`attention_raised`/`_resolved`, `session_status`) | keine neuen Events; `attention_raised` feuert nicht mehr für `permission_request` |
