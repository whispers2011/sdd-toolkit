---
description: "Aufgabenliste für die Umsetzung von „Individuelle Einstellungen“"
---

# Tasks: Individuelle Einstellungen (Signaltöne, Themes, Vorauswahl Ticket-Quelle)

**Input**: Design-Dokumente aus `/specs/persoenliche-einstellungen/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test-Aufgaben sind enthalten, weil die Spec sie **fordert** —
FR-024, FR-025, FR-028 verlangen automatisierte Prüfungen, SC-006 und SC-007
verlangen maschinelle Nachweise. Sie sind damit nicht optional, sondern
Anforderung.

**Organization**: nach User Story gruppiert, damit jede Story eigenständig
umgesetzt, geprüft und ausgeliefert werden kann.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel ausführbar (andere Datei, keine Abhängigkeit auf offene Aufgaben)
- **[Story]**: US1 / US2 / US3 — nur in den Story-Phasen
- Jede Aufgabe nennt den genauen Dateipfad

## Path Conventions

pnpm-Monorepo (`plan.md` → „Project Structure"):

- `packages/shared/src/` — pure, testbare Kerne (`vitest` läuft dort bereits)
- `packages/server/src/` — Fastify-Routen, SQLite-Repos
- `packages/web/src/` — React-Oberfläche, Effekte (`vitest` kommt in Phase 1 dazu)
- `packages/desktop/` — **unverändert**

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Der Web-Test-Runner, ohne den FR-024/FR-025/FR-028 nicht erfüllbar
sind (research D11). Keine Laufzeit-Abhängigkeit kommt hinzu.

- [X] T001 `vitest` als devDependency (`^3.2.0`, wie `@sdd/shared`) ergänzen und `"test"` von `echo 'keine Web-Tests (MVP)' && exit 0` auf `"vitest run"` umstellen in `packages/web/package.json`
- [X] T002 [P] `packages/web/vitest.config.ts` neu anlegen: `include: ['src/**/*.test.ts']`, `environment: 'node'`, **ohne** die Vite-Plugins aus `vite.config.ts` (Tailwind/React sollen für Tests nicht laden)
- [ ] T003 `pnpm install` an der Wurzel ausführen und belegen, dass `pnpm --filter @sdd/web test` (noch ohne Testdateien) sowie `pnpm test` (= `pnpm -r test`) grün durchlaufen

**Checkpoint**: Vier Pakete, vier laufende Test-Skripte.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Vokabular, Ablage, Übertragung und der gemeinsame Dialograhmen —
alles, was mehr als eine Story braucht. Nach `plan.md` teilen sich die drei
Themen **ausschliesslich** den Dialograhmen; deshalb entsteht er hier und nicht
in US1.

**⚠️ CRITICAL**: Keine Story-Arbeit an US1 oder US3 beginnt, bevor diese Phase
steht. (US2 ist die Ausnahme — siehe „User Story Dependencies".)

### Shared: Typen und Kataloge

- [X] T004 Ablage- und Übertragungstypen in `packages/shared/src/types.ts` ergänzen: `SoundTriggerId` (Template-Literal über `attention:${AttentionKind}` / `flow:'turn_completed'|'merged'` / `phase:'changed'|${FeaturePhase}`), `ToneId`, `SoundReaction` (unterscheidbare Union `silence|tone|speech`), `SoundSettings` (`enabled`, `volume`, `reactions: Partial<Record<SoundTriggerId, SoundReaction>>`), `TicketSource`, `PersonalSettings` — Felder und Bedeutungen nach [data-model.md](./data-model.md) §3, §4, §6, §7
- [X] T005 `packages/shared/src/soundCatalog.ts` neu anlegen mit `SoundTrigger`/`ToneStep`/`Tone`-Interfaces sowie `SOUND_TRIGGERS` (20 Einträge) und `soundTrigger(id)`: die zehn `attention:*` **aus** `AttentionKind` (`types.ts:222`), die sieben `phase:<FeaturePhase>` **aus** `FEATURE_PHASES` (`types.ts:2`) mit Phasennamen aus `PHASE_META` (`workflowModel.ts:36`), dazu `flow:turn_completed`, `flow:merged`, `phase:changed`; Labels wörtlich nach [contracts/sound-catalog.md](./contracts/sound-catalog.md) S1; `hint` mit der Begründung der bisherigen Stille (WhisperM8-Regel) an `attention:awaiting_input` und `attention:permission_request` (S1.4); `constitution` ist **kein** Auslöser (S1.5)
- [X] T006 Ton-Katalog in `packages/shared/src/soundCatalog.ts`: `TONES` mit 22 Einträgen sowie `tone(id)`, `toneFingerprint(t)` (`wave` ⊕ Tonhöhenfolge ⊕ Rhythmusfolge) und `toneDurationMs(t)`; `TONES[0]` ist `two-tone-rise` und entspricht **bitgenau** dem heutigen Beep aus `packages/web/src/store.tsx:378-399` (`sine`, 880 Hz → 1174 Hz, je 150 ms Klang, 120 ms Versatz); deutsche, paarweise eindeutige Labels; keine Datei-, URL- oder Netzverweise (S2)
- [X] T007 Standardwerte und Normalisierung in `packages/shared/src/soundCatalog.ts`: `DEFAULT_SOUND_SETTINGS` (`enabled: true`, `volume: 0.06`, genau zwei Reaktionen `flow:turn_completed` und `flow:merged` auf `two-tone-rise` — S3), `DEFAULT_PERSONAL_SETTINGS` (`ticketSource: 'jira'`), `normalizeSoundSettings(raw: unknown)` nach der Tabelle S4.1–S4.9 (idempotent; fehlendes `reactions` ist die **leere** Karte, nicht die Standardbelegung), `normalizeTicketSource(raw: unknown)` und `normalizePersonalSettings(raw: unknown)`
- [X] T008 Auflösung in `packages/shared/src/soundCatalog.ts`: `SoundEvent`-Union (`attention` | `flow` | `phase`) und `resolveReaction(settings, event)` nach S5 — `enabled === false` ⇒ `null`, aufgelöste Stille ⇒ `null`, bei `phase` gewinnt `phase:<phase>` **nur sofern dort keine Stille steht**, sonst `phase:changed` (FR-016, research D3); rein, höchstens eine Reaktion
- [X] T009 [P] `enteredPhase(prev, next)` in `packages/shared/src/phaseMachine.ts` ergänzen: liefert die Phase, die neu auf `running` wechselt; `prev === undefined` ⇒ `null`; bei mehreren gleichzeitigen Wechseln die in `FEATURE_PHASES` **späteste**; kein Wechsel nach `running` ⇒ `null` (S6.1–S6.5)
- [X] T010 `export * from './soundCatalog.js';` in `packages/shared/src/index.ts` ergänzen (alphabetisch neben `sessionMachine`), damit Server und Web denselben Katalog beziehen
- [X] T011 [P] `packages/shared/src/soundCatalog.test.ts` neu anlegen: 20 Auslöser mit eindeutigen `id`/`label` und Hints an den zwei Rückfrage-Auslösern (S1, FR-004/007/014, SC-001); ≥ 20 Töne mit paarweise eindeutigen Fingerprints/Labels und `TONES[0]` exakt wie der heutige Beep (S2, FR-006/012/013); Standardbelegung genau zwei Einträge, die übrigen 18 stumm (S3, SC-003); Normalisierung verwirft Unbekanntes, klemmt `volume`, ist idempotent (S4, FR-003/020); Auflösung inkl. Hauptschalter-aus und Phasen-Spezifität (S5, FR-010/016)
- [X] T012 [P] Fälle zu `enteredPhase` in `packages/shared/src/phaseMachine.test.ts` ergänzen: Eintritt in `running`, `prev === undefined`, Mehrfachwechsel, Nicht-`running`-Übergänge (S6)

### Server: Ablage und Routen

- [X] T013 `getPersonal(): PersonalSettings` und `setPersonal(patch): PersonalSettings` in `SettingsRepo` (`packages/server/src/db/repos.ts:1093`) ergänzen — zwei Einträge `sound` und `ticketSource` über das bestehende `getJson`/`setJson`, beide Wege durch `normalizeSoundSettings`/`normalizeTicketSource` aus `@sdd/shared`; `reactions` wird als **ganze Karte** ersetzt, defektes JSON ⇒ Standardwerte statt Ausnahme (A4.1–A4.3, A2.2)
- [X] T014 `personal: deps.settings.getPersonal()` in die Antwort von `GET /api/state` aufnehmen (`packages/server/src/api/server.ts:172`, neben `automation`/`optimization`); `personal` ist immer vollständig, nie `null` (A1.1–A1.3)
- [X] T015 Route `PATCH /api/settings/personal` in `packages/server/src/api/server.ts` nach dem Muster von `PATCH /api/settings/optimization` (`server.ts:1396`) ergänzen: Teilmengen-Semantik, Antwort ist das vollständige normalisierte `PersonalSettings`, kein WS-Broadcast, kein Zugriff auf `settings['jira.lastSelection']` (A2.1–A2.8)
- [X] T016 Routentests in `packages/server/src/api/server.test.ts` ergänzen: `GET /api/state` liefert vollständige Standardwerte bei leerer Ablage (A1.1); `PATCH` ändert nur mitgesandte Felder (A2.1); `reactions` wird ersetzt, nicht gemischt (A2.2); unbekannte Auslöser/`toneId` werden verworfen statt abgelehnt (A2.3); `volume` wird auf `[0,1]` geklemmt (A2.4); ungültiges `ticketSource` bleibt ohne Wirkung (A2.5); `PATCH /api/settings/personal` lässt `jira.lastSelection` unberührt und `PUT /api/settings/jira` lässt `ticketSource` unberührt (A2.6/A2.7, **SC-011**); defektes JSON in `settings['sound']` ergibt Standardwerte statt 500 (A4.2)

### Web: Einstellungs-Client und Dialograhmen

- [ ] T017 `personal: PersonalSettings` in `interface AppState` (`packages/web/src/api.ts:87`) ergänzen und `savePersonal(patch: Partial<PersonalSettings>)` als `PATCH /api/settings/personal` neben `saveOptimization` (`api.ts:224-227`) hinzufügen
- [ ] T018 `packages/web/src/personalSettings.ts` neu anlegen nach dem Modulmuster von `theme.ts` (Modulzustand + Abonnentenmenge + `useSyncExternalStore`): `getPersonal`, `primePersonal`, `patchPersonal` (optimistisch schreiben, Antwort als Wahrheit übernehmen, bei Fehler zurücksetzen und sichtbar melden), `onPersonalChange`, `usePersonal`; vor dem Boot gelten `DEFAULT_PERSONAL_SETTINGS` aus `@sdd/shared` — nie `null`, nie ein Ladezustand (U3.1–U3.3)
- [ ] T019 `primePersonal(state.personal)` beim `bootstrap` in `packages/web/src/store.tsx:442-448` aufrufen, auch bei jedem Wiederverbinden (`ws.onclose` → `bootstrap`), damit die Ton-Ebene ohne React-Kontext an die Einstellungen kommt (U3.2)
- [ ] T020 `packages/web/src/components/PersonalSettingsDialog.tsx` neu anlegen: Rahmen über das bestehende `Dialog` aus `Sidebar.tsx`, Titel „Individuelle Einstellungen", drei leere Abschnitte in der Reihenfolge **Signaltöne**, **Darstellung**, **Vorauswahl Ticket-Quelle** (U6.1) — die Inhalte füllen T032/T033/T034 (US1), T046 (US2) und T048 (US3)
- [ ] T021 Eintrag „Individuelle Einstellungen" in `ToolSettings` (`packages/web/src/components/Sidebar.tsx:355`) neben „Jira-Verbindung" ergänzen und den Öffnungszustand in `Sidebar` verdrahten, sodass `PersonalSettingsDialog` erreichbar ist (FR-001)

**Checkpoint**: Kataloge sind getestet, `personal` fährt im Boot-Zustand mit, der
Dialog ist erreichbar und leer. US1 und US3 können beginnen.

---

## Phase 3: User Story 1 - Signaltöne je Auslöser wählen und vorhören (Priority: P1) 🎯 MVP

**Goal**: 20 Auslöser einzeln mit einem von 22 Tönen, einer gesprochenen Ansage
oder Stille belegen, jede Wahl vor dem Speichern vorhören, geräteübergreifend
gültig — bei unveränderter Standardbelegung (genau zwei hörbare Ereignisse,
gleicher Pegel) und genau **einer** Schaltstelle.

**Independent Test**: Für „Review fällig" und „Lauf abgebrochen" zwei
verschiedene Töne setzen, beide vorhören, beide Ereignisse auslösen — hörbar
unterschiedlich (quickstart V2). Braucht weder US2 noch US3.

### Implementation for User Story 1

- [ ] T022 [US1] `packages/web/src/sound.ts` neu anlegen mit dem Audio-Kern: **ein** träge erzeugter, gemeinsamer `AudioContext` mit Master-`GainNode` auf `settings.volume`, `resume()` vor jeder Ausgabe, und ein Interpreter, der `Tone.steps` als Oszillator-Sequenz spielt und beim `onended` des letzten Schritts ein Fertig-Signal liefert (U4.1, research D6)
- [ ] T023 [US1] Sprachausgabe in `packages/web/src/sound.ts`: `speechSynthesis` + `SpeechSynthesisUtterance` mit Systemstandardstimme, Fertig-Signal über `onend`/`onerror`; leerer oder nur aus Leerraum bestehender Text ⇒ es wird `triggerLabel` gesprochen (U4.7/U4.8, research D7/D12)
- [ ] T024 [US1] Serielle Warteschlange in `packages/web/src/sound.ts`: der nächste Eintrag startet erst nach dem Fertig-Signal des vorherigen, mit Sicherheitsfrist als Notausgang gegen verschluckte `onend`-Meldungen; Kapazität 20, darüber wird der **älteste noch nicht begonnene** Eintrag verworfen; der Player wird als Abhängigkeit injiziert (U4.2/U4.3/U4.9, FR-017, research D5)
- [ ] T025 [US1] Öffentliche Schnittstelle in `packages/web/src/sound.ts`: `playReaction(r, triggerLabel)` (Ereignisfall: still bei blockiertem Audio oder fehlender Sprachausgabe, ohne Fehlermeldung und ohne Konsolenlärm — U4.4/FR-018), `previewReaction(r, triggerLabel): Promise<PreviewResult>` (am Hauptschalter vorbei, ohne Speichern, meldet `audio_blocked`/`speech_unavailable` zurück — U4.5/U4.6/U4.10), `handleSoundEvent(event)` (`resolveReaction` aus `@sdd/shared` gegen `getPersonal().sound`, Ergebnis einreihen)
- [ ] T026 [P] [US1] `packages/web/src/sound.test.ts` neu anlegen: Warteschlange mit injiziertem Player: zehn dicht eingereihte Ausgaben ergeben zehn Aufrufe **strikt nacheinander** — kein Start vor dem Fertig-Signal des Vorgängers (**SC-006**, FR-017); Sicherheitsfrist löst eine hängende Ausgabe; ab Kapazität 20 fällt der älteste noch nicht begonnene Eintrag weg
- [ ] T027 [US1] `attention_raised` in `packages/web/src/store.tsx:474` an die Ton-Ebene anbinden: `handleSoundEvent({ kind: 'attention', attention: item.kind })`; die sichtbare Behandlung des Aufmerksamkeits-Eingangs bleibt unverändert (U5.1, A3.2)
- [ ] T028 [US1] `notification`-Zweig in `packages/web/src/store.tsx:513-533` umstellen: `turn_completed` und `merged` erzeugen `handleSoundEvent({ kind: 'flow', … })`, `input_requested` und `escalation` erzeugen **nichts** (U5.2, research D1); den alten Beep-Pfad vollständig entfernen — `soundEnabled()` (`store.tsx:369`), `setSoundEnabled()` (`store.tsx:373`), `playCompletionSound()` (`store.tsx:378-399`) und der Aufruf in Zeile 531; die `Notification`-Behandlung darüber bleibt Zeile für Zeile unverändert (U5.5/U5.6, FR-011/FR-018)
- [ ] T029 [US1] `feature_updated` in `packages/web/src/store.tsx:459` an die Ton-Ebene anbinden: letzten `phases`-Stand je Feature in einer `useRef`-Karte halten (**nicht** im Reducer-Zustand), `enteredPhase(prev, next)` aus `@sdd/shared` auswerten und bei ≠ `null` `handleSoundEvent({ kind: 'phase', phase })` aufrufen; beim `bootstrap` werden die Stände **ohne** Ausgabe übernommen (U5.3/U5.4, research D2)
- [ ] T030 [P] [US1] `SoundToggle` (`packages/web/src/components/AutomationDial.tsx:251-262`), seine Verwendung und den Import `setSoundEnabled, soundEnabled` (`AutomationDial.tsx:10`) entfernen — genau eine Schaltstelle (U6.10, FR-011)
- [ ] T031 [US1] Einmalige Übernahme des alten Schalters in `packages/web/src/personalSettings.ts`: liefert der Boot-Zustand `sound` in unveränderter Standardbelegung und steht `localStorage['sdd-sound'] === 'off'`, wird `enabled: false` übernommen und über `patchPersonal` **einmal** serverseitig festgeschrieben; danach wird `sdd-sound` nie mehr gelesen oder geschrieben (U3.4/U3.5, FR-015, research D9)
- [ ] T032 [US1] Abschnitt „Signaltöne" in `packages/web/src/components/PersonalSettingsDialog.tsx`: Hauptschalter (`sound.enabled`) und Grundlautstärke (`sound.volume`, Standard 0.06), beide über `patchPersonal` — der Hauptschalter lässt `reactions` unangetastet (U6.2, FR-010/FR-013)
- [ ] T033 [US1] Auslöser-Liste in `packages/web/src/components/PersonalSettingsDialog.tsx`: alle 20 Auslöser aus `SOUND_TRIGGERS`, gruppiert nach `group` (Aufmerksamkeit / Ablauf / Phasen); je Auslöser eine Auswahl „Stille / Ton … / Ansage", bei „Ton" die Liste aus `TONES` mit deren `label`, bei „Ansage" ein Textfeld (max. 200 Zeichen); die `hint` von „Eingabe erwartet" und „Berechtigung erfragt" wird angezeigt; Änderungen laufen ausschliesslich über `patchPersonal` (U6.2/U6.3/U6.6/U6.9, FR-005/FR-009/FR-014)
- [ ] T034 [US1] Vorhören in `packages/web/src/components/PersonalSettingsDialog.tsx`: Knopf je Auslöser, der über `previewReaction` den **aktuell in der Auswahl stehenden** Wert spielt (nicht den gespeicherten, kein Speichern nötig); scheitert es, erscheint der Grund (`audio_blocked` / `speech_unavailable`) am betroffenen Auslöser (U6.4/U6.5, FR-008/FR-019, SC-002)

**Checkpoint**: US1 ist vollständig und eigenständig prüfbar — quickstart V1–V9
sind durchführbar, `pnpm --filter @sdd/shared test` und
`pnpm --filter @sdd/web test` grün.

---

## Phase 4: User Story 2 - Zusätzliches Farbdesign wählen (Priority: P2)

**Goal**: „Dunkel, hoher Kontrast" als drittes, vollständiges Design — Oberfläche
und Agenten-Konsole wechseln ohne Neuladen, kein Schlüssel fehlt, nachgewiesen
durch automatisierte Prüfungen.

**Independent Test**: Design wählen und belegen, dass keine Fläche und keine
Statusfarbe im alten Schema zurückbleibt, die offene Konsole eingeschlossen
(quickstart V10). Braucht weder US1 noch US3 — und aus Phase 2 nur T020/T021 für
den Dialogabschnitt.

### Implementation for User Story 2

- [ ] T035 [US2] `packages/web/src/theme.ts` erweitern: `ThemeMode` → `ThemeId = 'light' | 'dark' | 'high-contrast'`, `THEMES: readonly { id: ThemeId; label: string }[]` („Hell", „Dunkel", „Dunkel, hoher Kontrast"), `isThemeId` statt `isMode`, `colorScheme` = `light` nur für `light` (sonst `dark`), `cycleTheme()` (`dark → light → high-contrast → dark`) **ersetzt** `toggleTheme()`; Reihenfolge DOM → `localStorage` → Abonnenten und die Systempräferenz-Regel bleiben unverändert (U1.1–U1.6, FR-021/FR-027, research D10)
- [ ] T036 [US2] Block `:root[data-theme='high-contrast']` in `packages/web/src/index.css` neu anlegen — **derselbe** Schlüsselsatz wie der Light-Block (`index.css:17-85`): 12 `zinc`-Stufen inkl. `zinc-925` plus je 11 Stufen `emerald`, `amber`, `red`, `sky` (56 Farbvariablen) und `color-scheme: dark`; gleiche Farbtöne wie Dark, höhere Kontrast- und Sättigungsstufen (E1/E2, FR-021/FR-023)
- [ ] T037 [P] [US2] `packages/web/src/terminalTheme.ts` erweitern: `ConsolePalette` mit den 21 Schlüsseln aus [data-model.md](./data-model.md) §5, `CONSOLE_PALETTES: Record<ThemeId, ConsolePalette>` (bestehende `dark`/`light`-Paletten übernehmen, `high-contrast` neu), `terminalTheme(id: ThemeId): ITheme`; keine Vordergrund-, ANSI- oder Akzentfarbe gleicht dem `background` derselben Palette (U2.1–U2.3, FR-025/FR-028, E5)
- [ ] T038 [P] [US2] FOUC-Guard in `packages/web/index.html` erweitern: akzeptiert genau die drei `ThemeId`-Werte, setzt `data-theme` und `style.colorScheme` vor dem ersten Paint, unbekannter Wert ⇒ `dark` — Gleichlauf mit U1.3 (FR-026, SC-009)
- [ ] T039 [P] [US2] `ContrastIcon` in `packages/web/src/components/icons.tsx` ergänzen (Kontrast-/Halbkreis-Motiv im bestehenden Base-Stil der Datei, SVG — keine Emoji) (U8)
- [ ] T040 [US2] `packages/web/src/components/ThemeToggle.tsx` auf `cycleTheme()` umstellen: Icon zeigt weiterhin das **aktive** Design (`MoonIcon` / `SunIcon` / `ContrastIcon`), Tooltip und `aria-label` nennen das **nächste** Design (U1.4, U8)
- [ ] T041 [P] [US2] `packages/web/src/components/MarkdownEditor.tsx:80` korrigieren: `useTheme() === 'dark'` erfasst `high-contrast` nicht und liesse den Editor hell auf dunklem UI stehen — auf „dunkles Styling für alles ausser `light`" umstellen (FR-022, SC-008)
- [ ] T042 [P] [US2] `packages/web/src/components/TerminalPane.tsx:49-57` auf `ThemeId` nachziehen und belegen, dass `term.options.theme` über `onThemeChange` **live** aktualisiert wird — kein Remount, kein Verlust von PTY, Scrollback oder Fokus (U2.4, FR-022)
- [ ] T043 [US2] `packages/web/src/themeContract.test.ts` neu anlegen mit der Schlüsselsatz-Parität: `index.css` einlesen, die `:root[data-theme='…']`-Blöcke parsen und die Schlüsselsätze der Designs **miteinander** vergleichen (nie gegen die Zahl 56 — E4); ein fehlender Schlüssel lässt die Prüfung fehlschlagen und die Meldung nennt **Design und Schlüsselname** (FR-023/FR-024, **SC-007**)
- [ ] T044 [US2] `packages/web/src/themeContract.test.ts` ergänzen: jede `ThemeId` hat in `CONSOLE_PALETTES` eine Palette mit allen 21 Schlüsseln (FR-025); keine Vordergrund-, ANSI- oder Akzentfarbe einer Palette gleicht ihrem `background` (FR-028)
- [ ] T045 [US2] `packages/web/src/themeContract.test.ts` ergänzen: der Quelltext von `packages/web/index.html` akzeptiert im FOUC-Guard genau die drei `ThemeId`-Werte und keinen weiteren — nagelt den Gleichlauf zu `theme.ts` fest (FR-026)
- [ ] T046 [US2] Abschnitt „Darstellung" in `packages/web/src/components/PersonalSettingsDialog.tsx`: Auswahl aus `THEMES`, wirkt über `setTheme` sofort — ohne Speichern-Knopf, ohne Neuladen, ohne Serverweg (U6.7/U1.6, FR-021/FR-022, SC-008)

**Checkpoint**: US1 **und** US2 funktionieren eigenständig; `pnpm --filter @sdd/web test`
deckt SC-006 und SC-007 ab, quickstart V10–V12 sind durchführbar.

---

## Phase 5: User Story 3 - Vorauswahl der Ticket-Quelle (Priority: P3)

**Goal**: „Neues Feature" öffnet bei verbundenem Jira mit der eingestellten
Quelle; ohne Verbindung zwingend manuell, ohne die Einstellung zu verändern.

**Independent Test**: Vorauswahl auf „manuell" setzen und „Neues Feature" bei
verbundenem Jira öffnen (quickstart V13). Braucht weder US1 noch US2.

### Implementation for User Story 3

- [ ] T047 [US3] Entscheidungslogik in `NewFeatureFlow` (`packages/web/src/components/Sidebar.tsx:294-351`, in den Verträgen als `FeatureSourceGate` bezeichnet) umstellen: bei verbundenem Jira `setMode(getPersonal().ticketSource)` statt hart `'jira'` (`Sidebar.tsx:314`), ohne Verbindung weiterhin zwingend `'manual'`; der gespeicherte Wert wird dabei **nicht** geschrieben (U7.1/U7.2, FR-029/FR-030, SC-010)
- [ ] T048 [US3] Abschnitt „Vorauswahl Ticket-Quelle" in `packages/web/src/components/PersonalSettingsDialog.tsx`: Auswahl „Aus Jira importieren / Manuell erfassen" über `patchPersonal`, dazu der Hinweis, dass ohne Jira-Verbindung immer die manuelle Erfassung öffnet (U6.8/U6.9, FR-029/FR-030)
- [ ] T049 [US3] Belegen, dass `FeatureSourceToggle` (`packages/web/src/components/Sidebar.tsx:642`) in beiden Dialogen sichtbar bleibt (`JiraImportDialog.tsx:231`, `NewFeatureDialog.tsx:97`), der Wechsel im Dialog die gespeicherte Vorauswahl **nicht** verändert und `jira.lastSelection` unberührt bleibt (U7.3–U7.5, FR-031/FR-032, SC-011/SC-012, quickstart V14)

**Checkpoint**: alle drei Stories eigenständig funktionsfähig.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T050 `pnpm -r typecheck` grün — insbesondere `Record<ThemeId, ConsolePalette>` und die `SoundTriggerId`-Template-Literale
- [ ] T051 `pnpm test` (= `pnpm -r test`) grün über alle vier Pakete; die Abdeckungstabelle in [quickstart.md](./quickstart.md) („Automatisierte Prüfungen") Zeile für Zeile abgleichen
- [ ] T052 Gegenprobe zu **SC-007**: eine Zeile im `high-contrast`-Block in `packages/web/src/index.css` auskommentieren, `pnpm --filter @sdd/web test` laufen lassen — die Meldung muss `high-contrast` und den fehlenden Schlüsselnamen nennen; danach zurücknehmen
- [ ] T053 [P] Restspuren suchen und beseitigen: `grep -rn "sdd-sound\|soundEnabled\|playCompletionSound\|ThemeMode\|toggleTheme" packages/` darf ausser der einmaligen Migration in `personalSettings.ts` keinen Treffer mehr liefern (FR-011)
- [ ] T054 [P] `docs/funktionsumfang.md:94` nachziehen: der gerätelokale Sound-Schalter ist durch den nutzerweiten Einstellungsbereich ersetzt
- [ ] T055 Hörbare Szenarien V1–V9 aus [quickstart.md](./quickstart.md) auf eigener Instanz durchführen (`SDD_PORT=4899 SDD_WEB_PORT=4898 SDD_DATA_DIR="$HOME/.sdd-toolkit-test-persoenlich" pnpm dev`) — deckt SC-001…SC-006 ab
- [ ] T056 Sichtbare und Randfall-Szenarien V10–V16 aus [quickstart.md](./quickstart.md) durchführen — deckt SC-008…SC-012 sowie die Edge Cases „Einstellungen nicht lesbar" und „Audio-Sperre" ab
- [ ] T057 Eigene Instanz **ausschliesslich** über die eigenen Ports abräumen: `lsof -ti:4899 | xargs kill` und `lsof -ti:4898 | xargs kill` — **niemals** `pkill -f vite` / `pkill -f tsx` (`CLAUDE.md`: die eigene Session ist ein Kindprozess des laufenden Toolkits)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten — kann sofort beginnen
- **Foundational (Phase 2)**: hängt an Phase 1 (nur T011/T012/T016 brauchen den Runner; T001–T003 sind ohnehin billig) — **blockiert US1 und US3**
- **US1 (Phase 3)**: hängt an Phase 2 vollständig
- **US2 (Phase 4)**: hängt an Phase 1 (Test-Runner) und aus Phase 2 nur an T020/T021 (Dialograhmen) — **nicht** an den Ton-Kernen
- **US3 (Phase 5)**: hängt an Phase 2 (T017–T021), nicht an US1 oder US2
- **Polish (Phase 6)**: hängt an den gewünschten Stories

### User Story Dependencies

- **US1 (P1)**: nach Phase 2 — keine Abhängigkeit auf andere Stories
- **US2 (P2)**: unabhängig von US1 und US3. `plan.md` („Umsetzungsreihenfolge") empfiehlt, US2 **vor** US1 zu bauen: es ist klein, unabhängig, und seine drei geforderten Prüfungen etablieren den Web-Test-Runner, den US1 danach mitbenutzt. Die Phasennummerierung folgt hier der Spec-Priorität; die Reihenfolge Phase 4 → Phase 3 ist ausdrücklich zulässig.
- **US3 (P3)**: unabhängig von US1 und US2

### Within Each User Story

- Modul vor Anbindung: `sound.ts` (T022–T025) vor der Store-Anbindung (T027–T029)
- Kataloge und Client vor der Oberfläche: T004–T010, T018 vor T032–T034
- Abbau zusammen mit Aufbau: T030 (alter Schalter weg) gehört in **denselben** Schnitt wie T032 (neuer Hauptschalter) — dazwischen gäbe es zwei widersprüchliche Schaltstellen (FR-011)
- Innerhalb einer Datei strikt sequenziell: T005→T006→T007→T008 (`soundCatalog.ts`), T014→T015 (`server.ts`), T022→T023→T024→T025 (`sound.ts`), T032→T033→T034→T046→T048 (`PersonalSettingsDialog.tsx`), T043→T044→T045 (`themeContract.test.ts`)

### Parallel Opportunities

| Gruppe | Aufgaben | Warum parallel |
|---|---|---|
| Setup | T001, T002 | verschiedene Dateien |
| Shared | T009 parallel zu T005–T008 | `phaseMachine.ts` vs. `soundCatalog.ts` |
| Shared-Tests | T011, T012 | verschiedene Testdateien, nach T010 |
| US1 | T026 parallel zu T027–T029 | Testdatei vs. `store.tsx` |
| US1 | T030 parallel zu T032–T034 | `AutomationDial.tsx` vs. Dialog |
| US2 | T037, T038, T039, T041, T042 | fünf verschiedene Dateien, alle nach T035 |
| Polish | T053, T054 | Grep vs. Doku |
| Stories | US1 ∥ US2 ∥ US3 | nach Phase 2 vollständig entkoppelt |

---

## Parallel Example: User Story 2

```bash
# Nach T035 (theme.ts liefert ThemeId) fünf unabhängige Dateien gleichzeitig:
Task: "T037 ConsolePalette + CONSOLE_PALETTES in packages/web/src/terminalTheme.ts"
Task: "T038 FOUC-Guard auf drei ThemeId in packages/web/index.html"
Task: "T039 ContrastIcon in packages/web/src/components/icons.tsx"
Task: "T041 dunkles Styling für high-contrast in packages/web/src/components/MarkdownEditor.tsx"
Task: "T042 ThemeId nachziehen in packages/web/src/components/TerminalPane.tsx"
```

## Parallel Example: Foundational

```bash
# T009 läuft neben dem Katalog-Aufbau, T011/T012 danach gleichzeitig:
Task: "T009 enteredPhase in packages/shared/src/phaseMachine.ts"
Task: "T011 packages/shared/src/soundCatalog.test.ts"
Task: "T012 enteredPhase-Fälle in packages/shared/src/phaseMachine.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup (T001–T003)
2. Phase 2: Foundational (T004–T021) — **blockiert alles Weitere**
3. Phase 3: User Story 1 (T022–T034)
4. **STOP und VALIDIEREN**: quickstart V1–V9. Besonders V1 (frische Installation
   klingt genau wie heute) und V6/V7 (genau eine Schaltstelle, Übernahme des
   alten Schalters) — sie sichern, dass niemand durch die Umstellung
   unerwartet Töne bekommt oder verliert.
5. Lieferbar: der Einstellungsbereich existiert, die stummen
   Aufmerksamkeitsereignisse sind hörbar schaltbar.

### Empfohlene Abweichung (aus plan.md)

`plan.md` empfiehlt **US2 vor US1**: T035–T046 sind klein, von US1 unabhängig und
etablieren die Web-Prüfungen, die US1 danach mitbenutzt. Wer dieser Reihenfolge
folgt, arbeitet: Phase 1 → Phase 2 → Phase 4 (US2) → Phase 3 (US1) →
Phase 5 (US3) → Phase 6.

### Incremental Delivery

1. Setup + Foundational → Fundament steht (noch kein Nutzen für sich)
2. + US1 → eigenständig prüfen → MVP
3. + US2 → eigenständig prüfen → drittes Design
4. + US3 → eigenständig prüfen → Vorauswahl
5. Polish → Gegenprobe SC-007, vollständiger quickstart-Durchlauf

### Parallel Team Strategy

Nach Phase 2 sind die drei Stories entkoppelt: eine Person auf US1 (der grösste
Teil), eine auf US2, eine auf US3. Der einzige gemeinsame Berührungspunkt ist
`PersonalSettingsDialog.tsx` — dort schreibt jede Story **ihren** Abschnitt
(T032–T034 / T046 / T048); der Rahmen steht bereits aus T020.

---

## Notes

- **Namensabweichung**: Verträge und Plan nennen die Entscheidungsstelle
  `FeatureSourceGate`; im Code heisst die Funktion `NewFeatureFlow`
  (`packages/web/src/components/Sidebar.tsx:294`). T047 meint diese Funktion.
- **Zwei Wahrheiten vermeiden**: Kataloge, Standardwerte und Normalisierung leben
  **nur** in `@sdd/shared` (A4.3). Server und Web importieren, sie schreiben nichts
  nach (keine zweite Auslöser-Liste, keine zweite Zahl 56).
- **Die Zahl 56 gehört nicht in den Test** — die Prüfung vergleicht
  Schlüsselsätze zwischen Designs (E4). Sonst veraltet sie bei der ersten
  Erweiterung.
- **Nicht angefasst**: `packages/desktop`, die sichtbaren Benachrichtigungen, der
  Aufmerksamkeits-Eingang, die Ereignisquellen, das DB-Schema, die semantische
  Token-Umstellung (E1/E3) und die Mehr-Tab-Entdopplung.
- **Kein neues WS-Ereignis** und keine neue Ereignisquelle (Spec-Assumption) —
  „Phase erreicht" entsteht ausschliesslich per Diff auf `feature_updated`.
- **Prozessregeln** (`CLAUDE.md`): eigene Instanz nur auf eigenen Ports
  (4898/4899), Aufräumen portgebunden, **kein** `pkill -f` mit generischem
  Muster — die eigene Session ist ein Kindprozess des laufenden Toolkits.
- [P] = andere Datei, keine offene Abhängigkeit. Nach jeder Aufgabe oder jeder
  logischen Gruppe committen.
