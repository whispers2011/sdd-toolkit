# Phase 0 — Research: Features im Auto-Modus

Alle offenen Punkte sind aufgelöst; die beiden im `/speckit-clarify` gestellten, aber vom
Nutzer durch Weitergehen zu `/speckit-plan` nicht separat beantworteten Fragen werden hier
auf den empfohlenen Defaults festgeschrieben (Security-Posture = volles Bypass;
Aus-Modus-Signalisierung = nur Konsole). Beide waren bereits als Assumptions in der Spec dokumentiert.

## D1 — Abbildung „Auto-Modus" auf die Claude-Berechtigungs-Betriebsart

- **Decision**: `autoMode === true` → Feature-Session startet mit `--permission-mode bypassPermissions`; `autoMode === false` → `acceptEdits` (das heutige Verhalten).
- **Rationale**: `bypassPermissions` unterdrückt alle `PreToolUse`-Berechtigungsabfragen (inkl. beliebiger Kommandos) und feuert keinen `PermissionRequest`-Hook. Damit entstehen weder Konsolen-Pausen noch — über die Kette `parseHookLine` → `reduceSession` → `handleStatusChange` — Berechtigungs-Attention-Items. `acceptEdits` bleibt als sichere Aus-Variante erhalten (akzeptiert nur Datei-Edits, fragt bei Kommandos nach).
- **Alternatives considered**:
  - *`acceptEdits` beibehalten + nur Inbox filtern*: löst US1 nicht — Kommando-Rückfragen pausieren die Session weiterhin in der Konsole.
  - *Feinkörnige Deny-Liste (Option B der Clarify-Frage)*: erheblicher Mehraufwand (eigene Permission-Rules), kein klarer Gewinn innerhalb der Worktree-Isolation. Verworfen zugunsten von Option A.
- **Referenz**: `packages/server/src/pty/commandBuilder.ts` — `PermissionMode` enthält `bypassPermissions` bereits; `buildClaudeArgv` hängt `--permission-mode` an, wenn ≠ `default`. Keine Änderung an `commandBuilder` nötig; nur der übergebene Wert in `ensureSession` (`orchestrator.ts:133-137`) wird dynamisch.

## D2 — Ort und Default des Schalters

- **Decision**: Neues Feld `autoMode: boolean` auf `AutomationSettings`. In **beiden** Presets `LEVEL2_DEFAULTS` und `LEVEL3_DEFAULTS` auf `true`. Der globale Default (`SettingsRepo.getAutomation` mergt über `LEVEL2_DEFAULTS`) ist damit `true` → neue Features laufen im Auto-Modus.
- **Rationale**: Der Auto-Modus ist orthogonal zur Phasen-Autonomie: auch ein Level-2-Nutzer will innerhalb eines Phasenlaufs nicht bei jedem Kommando gefragt werden (genau die Beschwerde). Ein eigener Toggle im Dial (unabhängig von den Level-2/3-Presets) bildet das ab und lässt sich jederzeit abschalten.
- **Alternatives considered**:
  - *Auto-Modus an Level 3 koppeln*: würde Level-2-Nutzer weiter mit Rückfragen belasten — widerspricht der Spec (US1, „neue Features … im Auto-Modus").
  - *Separates Settings-Panel*: widerspricht „oben rechts über die Einstellungen"; unnötige neue Fläche.
- **Referenz**: `packages/shared/src/types.ts:46-69` (`AutomationSettings`, `LEVEL2_DEFAULTS`, `LEVEL3_DEFAULTS`, `resolveAutomation`); `packages/server/src/db/repos.ts:560-569` (`getAutomation`/`setAutomation`).

## D3 — Berechtigungs-Rückfragen aus der „Braucht dich"-Inbox entfernen

- **Decision**: In `orchestrator.handleStatusChange` wird für `effect.awaiting === 'permission'` **kein** Attention-Item mehr erzeugt und **keine** Notification gesendet; die Fälle `question`/`plan_approval` bleiben unverändert. Zusätzlich blendet `AttentionInbox` (und der offene-Items-Zähler) etwaige Alt-/Rest-Einträge vom Typ `permission_request` aus.
- **Rationale**: Doppelte Absicherung. Bei Auto-Modus an entsteht ohnehin kein `permission_request` (D1). Bei Auto-Modus aus soll die Rückfrage laut Spec (FR-005/FR-007) nicht die Inbox verrauschen, sondern in der Feature-Konsole beantwortet werden. Der Session-Status `awaiting_input` wird weiterhin über `bus.emitEvent('session_status', …)` publiziert (unabhängig vom Attention-Raise), sodass Status-Dot/Konsole den Wartezustand zeigen.
- **Alternatives considered**:
  - *`AttentionKind` und `permission_request` ganz entfernen*: invasiver (Typ, `KIND_META`, DB-Rows, `resolveFor`), ohne funktionalen Zusatznutzen. Verworfen — Typ bleibt für Bestands-Rows kompatibel, wird nur nicht mehr erzeugt und in der Inbox ausgeblendet.
  - *Item erzeugen, aber im UI verstecken*: erzeugt weiterhin Notifications/Zähler-Rauschen. Verworfen.
- **Referenz**: `packages/server/src/services/orchestrator.ts:280-303` (Raise + Notification); `packages/web/src/components/AttentionInbox.tsx:21` (Filter) und `packages/web/src/App.tsx:25` (`openAttention`-Zähler).

## D4 — Verhalten laufender Sessions beim Umschalten

- **Decision**: Die Betriebsart wird beim Session-Start gebunden (`ensureSession`). Ein Umschalten wirkt auf **neu gestartete** Sessions; bereits laufende Sessions behalten ihre Start-Betriebsart bis zum nächsten (Re-)Start.
- **Rationale**: `--permission-mode` ist ein Startargument des CLI-Prozesses; es zur Laufzeit umzuschalten würde einen Session-Neustart erfordern. Für den Nutzer ist die Regel „gilt für neue Läufe" nachvollziehbar (FR-009) und vermeidet stille Neustarts laufender Arbeit.
- **Alternatives considered**: *Laufende Session bei Umschalten automatisch neu starten*: riskiert Kontextverlust/laufende Turns; nicht gewünscht. Optional könnte der Dial einen Hinweis „gilt ab nächstem Start" anzeigen (nice-to-have, kein Muss).
- **Referenz**: `packages/server/src/services/orchestrator.ts:100-155` (`ensureSession`).

## D5 — Migration / Bestandsdaten

- **Decision**: Keine DB-Migration. Globale Einstellung und Overrides sind JSON-Partials; `getAutomation` mergt über `LEVEL2_DEFAULTS`, `resolveAutomation` mergt global→Projekt→Feature. Fehlt `autoMode` in einem gespeicherten Partial, greift der globale Default (`true`).
- **Rationale**: Bestehende Projekt-/Feature-Overrides (als Presets gespeichert) enthalten das neue Feld noch nicht; durch den Merge erben sie den globalen Wert, bis der Nutzer den Override neu setzt (die Preset-Chips schreiben dann das vollständige, aktualisierte Preset inkl. `autoMode`).
- **Referenz**: `packages/server/src/db/repos.ts:560-569`, `packages/shared/src/types.ts:178-184`, `packages/web/src/components/ProjectSettings.tsx:201-220`.

## Zusammenfassung Entscheidungen

| # | Entscheidung | Kernartefakt |
|---|--------------|--------------|
| D1 | `autoMode` → `bypassPermissions` / `acceptEdits` | `orchestrator.ensureSession` |
| D2 | `autoMode: boolean`, Default `true` in beiden Presets, Toggle im Dial | `shared/types.ts`, `AutomationDial.tsx` |
| D3 | `permission_request` nicht mehr raisen + Inbox-Filter | `orchestrator.handleStatusChange`, `AttentionInbox.tsx` |
| D4 | Betriebsart bindet beim Start; wirkt auf neue Sessions | `orchestrator.ensureSession` |
| D5 | Keine Migration (JSON-Partial-Merge) | `repos.ts`, `resolveAutomation` |
