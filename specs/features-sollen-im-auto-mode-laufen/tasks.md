---

description: "Task list for Features im Auto-Modus"
---

# Tasks: Features im Auto-Modus

**Input**: Design documents from `specs/features-sollen-im-auto-mode-laufen/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auto-mode.md, quickstart.md

**Tests**: Nicht als TDD angefordert. Test-Tasks sind als **(optional)** markiert und liegen in Polish; sie nutzen die bestehende Vitest-Infrastruktur (`packages/shared/src/*.test.ts`).

**Organization**: Nach User Story gruppiert (P1 → P2 → P3), jede unabhängig testbar.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1 / US2 / US3
- Dateipfade sind relativ zum Repo-Root.

## Path Conventions

Monorepo (pnpm): `packages/shared/src/`, `packages/server/src/`, `packages/web/src/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Sauberer Ausgangszustand vor der Änderung.

- [x] T001 Baseline verifizieren: `pnpm install` und danach `pnpm build && pnpm test` im Repo-Root ausführen — muss grün sein, bevor Änderungen beginnen.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Gemeinsames Datenfeld, von dem alle Stories abhängen.

**⚠️ CRITICAL**: Muss vor allen User Stories abgeschlossen sein.

- [x] T002 In `packages/shared/src/types.ts` das Feld `autoMode: boolean` zur `AutomationSettings`-Schnittstelle hinzufügen (mit JSDoc: „Tool-/Kommando-Berechtigungen automatisch erteilen — keine Rückfragen") und in **beiden** Presets `LEVEL2_DEFAULTS` und `LEVEL3_DEFAULTS` auf `true` setzen. `resolveAutomation` bleibt unverändert (mergt das Feld automatisch).

**Checkpoint**: `pnpm --filter @sdd/shared build` grün; globaler Default (`getAutomation` → mergt über `LEVEL2_DEFAULTS`) liefert `autoMode: true`.

---

## Phase 3: User Story 1 - Neue Features laufen ohne Kommando-Rückfragen (Priority: P1) 🎯 MVP

**Goal**: Neu angelegte Features starten standardmäßig so, dass der Agent Tool-/Kommando-Aufrufe ohne einzelne Berechtigungsrückfrage ausführt.

**Independent Test**: Neues Feature anlegen, Session öffnen, eine kommando-lastige Phase (z. B. `implement`) starten → keine „Darf ich … ausführen?"-Pause; Prozess wurde mit `--permission-mode bypassPermissions` gestartet.

### Implementation for User Story 1

- [x] T003 [US1] In `packages/server/src/services/orchestrator.ts` (`ensureSession`, ~Zeile 133–137) den hartkodierten `permissionMode: 'acceptEdits'` durch eine Ableitung aus der aufgelösten Automation ersetzen: `const automation = this.automationFor(feature);` und `permissionMode: automation.autoMode ? 'bypassPermissions' : 'acceptEdits'` an `buildClaudeArgv({...})` übergeben. `buildClaudeArgv`/`commandBuilder.ts` bleiben unverändert (kennen `bypassPermissions` bereits). Headless-Läufe (`buildHeadlessArgv`) nicht anfassen.

**Checkpoint**: Mit Default (`autoMode` global `true`) startet ein neues Feature im `bypassPermissions`-Modus → keine Kommando-Rückfragen. MVP funktionsfähig.

---

## Phase 4: User Story 2 - Auto-Modus oben rechts umschalten (Priority: P2)

**Goal**: Nutzer kann den Auto-Modus im Automation-Dial (oben rechts) ein-/ausschalten; der Zustand ist sichtbar und persistiert.

**Independent Test**: Dial → Auto-Modus auf „aus", Seite neu laden → Zustand bleibt „aus"; neues Feature startet dann mit `acceptEdits` (Rückfrage erscheint in der Feature-Konsole). Auf „an" → keine Rückfragen.

### Implementation for User Story 2

- [x] T004 [US2] In `packages/web/src/components/AutomationDial.tsx` einen `Toggle` „Auto-Modus (Berechtigungen automatisch erteilen)" ergänzen, gebunden an `a.autoMode`, `onChange={(v) => void apply({ autoMode: v })}`. Platzierung bei den übrigen Toggles (vor dem Sound/Voice-Block). Persistenz läuft über das bestehende `api.setAutomation` → `PUT /api/settings/automation` (mergt Partial); die Presets Level 2/Level 3 tragen `autoMode` bereits (aus T002). Keine Server-Änderung nötig.

**Checkpoint**: Umschalten wird gespeichert und überlebt Reload; die Wahl bestimmt den `permissionMode` neu gestarteter Sessions (US1-Pfad).

---

## Phase 5: User Story 3 - Keine Berechtigungs-Rückfragen in „Braucht dich" (Priority: P3)

**Goal**: Tool-/Kommando-Berechtigungsrückfragen erscheinen nicht mehr als Einträge in der „Braucht dich"-Inbox (auch nicht im Zähler); echte Eskalationen bleiben.

**Independent Test**: Auto-Modus „aus", Feature bis zu einer Kommando-Berechtigung laufen lassen → kein „Berechtigung"-Eintrag in „Braucht dich", Zähler unverändert, Session zeigt aber Status „wartet auf Eingabe"; Gegentest: echte `AskUserQuestion`-Frage bzw. rote Verifikation erscheint weiterhin.

### Implementation for User Story 3

- [x] T005 [P] [US3] In `packages/server/src/services/orchestrator.ts` (`handleStatusChange`, ~Zeile 280–303) den Zweig für `effect.kind === 'input_requested'` so anpassen, dass bei `effect.awaiting === 'permission'` **kein** `attention.raise({ kind: 'permission_request', … })` und **keine** `bus.emitEvent('notification', …)` erfolgt (früh `continue`/Guard). `awaiting === 'question'` und `'plan_approval'` unverändert lassen. Der `session_status`-Event oben in der Methode bleibt unangetastet.
- [x] T006 [P] [US3] In `packages/web/src/components/AttentionInbox.tsx` (Filter ~Zeile 21) Items mit `kind === 'permission_request'` zusätzlich herausfiltern, damit etwaige Alt-/Bestands-Rows nicht angezeigt werden.
- [x] T007 [P] [US3] In `packages/web/src/App.tsx` (`openAttention`, ~Zeile 25) `permission_request` aus der Zählung ausschließen (z. B. `attention.filter(a => a.kind !== 'permission_request').length`), damit Tab-Badge und Fenstertitel den Typ nicht mitzählen.

**Checkpoint**: Keine Berechtigungs-Rückfragen mehr in Liste oder Zähler; andere Attention-Typen unverändert.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Absicherung, Doku, Validierung.

- [x] T008 [P] Override-Hierarchie prüfen: Da `AutomationOverride` in `packages/web/src/components/ProjectSettings.tsx` (~Zeile 201–220) vollständige Presets schreibt und diese seit T002 `autoMode` enthalten, greift `resolveAutomation` global→Projekt→Feature automatisch. Manuell verifizieren (Projekt-Override auf ein Preset mit `autoMode:false` → nur dessen Feature-Sessions starten in `acceptEdits`). Kein Code-Change erwartet.
- [x] T009 (optional) In `packages/web/src/components/AutomationDial.tsx` einen Hinweistext „gilt ab dem nächsten Session-Start" nahe dem Auto-Modus-Toggle ergänzen (Design-Entscheidung D4 — laufende Sessions behalten ihre Start-Betriebsart).
- [x] T010 [P] (optional) Unit-Tests ergänzen: (a) in `packages/shared/src/` einen Test, dass `resolveAutomation` `autoMode` korrekt mergt und beide Presets `autoMode:true` haben; (b) einen Server-nahen Test/Guard, dass für `awaiting: 'permission'` kein Attention-Item entsteht, für `awaiting: 'question'` aber schon. Bestehende `sessionMachine.test.ts`/`phaseMachine.test.ts` müssen grün bleiben.
- [x] T011 Validierung: `quickstart.md`-Szenarien 1–4 durchspielen; danach `pnpm build && pnpm test` im Repo-Root grün.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten.
- **Foundational (Phase 2 / T002)**: nach Setup; **blockiert alle User Stories** (alle lesen `autoMode`).
- **User Stories (Phase 3–5)**: alle nach T002.
- **Polish (Phase 6)**: nach den gewünschten Stories.

### User Story Dependencies

- **US1 (P1)**: nur T002. Eigenständig lauffähig (MVP).
- **US2 (P2)**: nur T002 fachlich; wirkt über den US1-Pfad (`permissionMode`-Ableitung), ist aber unabhängig testbar (Persistenz + Reload). Kein Code aus US1 nötig.
- **US3 (P3)**: nur T002. Unabhängig von US1/US2 (eigene Codepfade: Attention/Inbox).

### Within / Across Stories

- T005 (US3, `orchestrator.ts`) und T003 (US1, `orchestrator.ts`) berühren dieselbe Datei, aber verschiedene Funktionen — nicht gleichzeitig editieren; da in getrennten Phasen unkritisch.
- T005 (Server) und T006/T007 (Web) sind verschiedene Dateien → parallel.

### Parallel Opportunities

- Innerhalb US3: **T005, T006, T007 laufen parallel** (Server-Datei vs. zwei Web-Dateien).
- Bei mehreren Bearbeitern nach T002: US1, US2, US3 parallel möglich (US1 und US3 koordinieren die eine Berührung von `orchestrator.ts`).
- Polish: T008 und T010 parallel.

---

## Parallel Example: User Story 3

```bash
# Nach T002 (Foundational) — die drei US3-Edits gleichzeitig:
Task: "T005 handleStatusChange: kein Raise/Notification für awaiting==='permission' in packages/server/src/services/orchestrator.ts"
Task: "T006 permission_request aus der Inbox-Liste filtern in packages/web/src/components/AttentionInbox.tsx"
Task: "T007 permission_request aus dem openAttention-Zähler ausschließen in packages/web/src/App.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. T001 (Setup) → T002 (Foundational, `autoMode`-Feld, Default `true`).
2. T003 (US1: `permissionMode`-Ableitung).
3. **STOP & VALIDATE**: Neues Feature läuft ohne Kommando-Rückfragen → Kern der Beschwerde gelöst.

### Incremental Delivery

1. Setup + Foundational → Basis steht.
2. + US1 → MVP (keine Rückfragen bei neuen Features).
3. + US2 → Umschaltbarkeit oben rechts.
4. + US3 → saubere „Braucht dich"-Inbox.
5. Polish (Override-Check, Doku-Hinweis, optionale Tests, Quickstart-Validierung).

---

## Notes

- [P] = andere Datei, keine offene Abhängigkeit.
- Keine DB-Migration (JSON-Partial-Merge über Presets; fehlendes `autoMode` erbt den globalen Default `true`).
- `commandBuilder.ts` bleibt unverändert — die `PermissionMode`-Union kennt `bypassPermissions` bereits.
- Nach jedem Task committen; an jedem Checkpoint die Story unabhängig validieren.
