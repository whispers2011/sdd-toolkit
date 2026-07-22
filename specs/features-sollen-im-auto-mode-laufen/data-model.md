# Phase 1 — Data Model: Features im Auto-Modus

Die Änderung ist konfigurativ; es entsteht **eine** neue Feldergänzung an einem bestehenden
Typ plus abgeleitetes Laufzeitverhalten. Keine neue Tabelle, keine Migration.

## Entity: AutomationSettings (erweitert)

Bestehender Typ in `packages/shared/src/types.ts`. Neues Feld:

| Feld | Typ | Default (Preset) | Bedeutung |
|------|-----|------------------|-----------|
| `autoProgressUntil` | `FeaturePhase \| 'off'` | L2: `'off'` / L3: `'implement'` | (bestehend) Auto-Progression bis Phase |
| `autoVerify` | `boolean` | L2: `false` / L3: `true` | (bestehend) Verify-Pipeline nach implement |
| `autoReviewAgents` | `boolean` | L2: `false` / L3: `true` | (bestehend) Review-Agents |
| `autoMerge` | `boolean` | L2: `false` / L3: `true` | (bestehend) Auto-Merge-Queue |
| **`autoMode`** | **`boolean`** | **L2: `true` / L3: `true`** | **NEU: Tool-/Kommando-Berechtigungen automatisch erteilen (keine Rückfragen)** |

- **Validierung**: reines Bool, kein Wertebereich zu prüfen.
- **Auflösung**: unverändert über `resolveAutomation(global, project, feature) = { ...global, ...project, ...feature }`. `autoMode` wird wie jedes andere Feld gemergt.
- **Persistenz**: global in Tabelle `settings` (key `automation`, JSON); Overrides in `projects.automation` / `features.automation` (JSON-Partial). Fehlt `autoMode` in einem Partial → globaler Default greift.
- **Default-Herkunft**: `SettingsRepo.getAutomation()` mergt gespeicherten Partial über `LEVEL2_DEFAULTS`; da dort `autoMode: true`, ist der Auslieferungs-Default für neue/bestehende Installationen `true`.

## Ableitung: PermissionMode (Laufzeit, keine Persistenz)

Bestehender Typ `PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'` in `commandBuilder.ts`. Abbildung beim Session-Start:

| aufgelöstes `autoMode` | `--permission-mode` |
|------------------------|---------------------|
| `true` | `bypassPermissions` |
| `false` | `acceptEdits` |

Headless-Läufe (`buildHeadlessArgv`) bleiben unverändert bei `acceptEdits`.

## Entity: AttentionItem (Verhaltensänderung, kein Schema-Change)

Bestehender Typ + Tabelle `attention`. Der `AttentionKind`-Wert `permission_request`:

- wird vom Orchestrator **nicht mehr erzeugt** (kein `raise`, keine Notification);
- bleibt als Typ/DB-Spaltenwert **kompatibel** (Bestands-Rows brechen nicht);
- wird in der Inbox-Anzeige und im Zähler **ausgeblendet**.

Alle übrigen `AttentionKind`-Werte (`awaiting_input`, `verify_failed`, `gate_failed`, `merge_conflict_escalated`, `review_due`, `agent_errored`) sind unverändert.

## State / Sichtbarkeit

- Session-Status `awaiting_input` (SessionMachine) bleibt erhalten und wird weiter über das `session_status`-Event publiziert → Status-Dot & Konsole zeigen den Wartezustand auch dann, wenn kein Inbox-Item entsteht (relevant nur bei `autoMode = false`).
- Bei `autoMode = true` tritt `awaiting: 'permission'` gar nicht mehr auf, da Claude im `bypassPermissions`-Modus keinen `PermissionRequest`-Hook feuert.
