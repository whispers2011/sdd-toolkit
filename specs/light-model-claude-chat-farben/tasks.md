---
description: "Task list for Light-/Dark-Mode-Umschalter & lesbare Claude-Chat-Farben"
---

# Tasks: Light-/Dark-Mode-Umschalter & lesbare Claude-Chat-Farben

**Input**: Design documents from `/specs/light-model-claude-chat-farben/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Nicht angefordert. Die Spec verlangt kein TDD; das Web-Paket hat keinen
Test-Runner (MVP). Validierung erfolgt über `quickstart.md` (manuell) +
`tsc --noEmit` + `vite build`. Daher keine Test-Tasks.

**Organization**: Nach User Story gruppiert (P1 → P2 → P3), jede unabhängig testbar.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1 / US2 / US3
- Pfade sind repo-relativ ab Repo-Root.

## Path Conventions

Web-Frontend-Änderung ausschließlich in `packages/web/`. Server/`@sdd/shared`
unverändert.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ausgangsbasis absichern

- [X] T001 Baseline prüfen: `pnpm install` (Repo-Root) sowie `pnpm --filter @sdd/web typecheck` und `pnpm --filter @sdd/web build` laufen vor den Änderungen fehlerfrei. Keine neuen Abhängigkeiten nötig (Tailwind v4 / xterm.js bereits vorhanden).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Theme-Substrat, auf dem ALLE User Stories aufsetzen

**⚠️ CRITICAL**: Keine User-Story-Arbeit vor Abschluss dieser Phase

- [X] T002 Theme-Modul `packages/web/src/theme.ts` erstellen (Contract C1): `type ThemeMode = 'light'|'dark'`; interner Zustand, der beim Import aus `document.documentElement.dataset.theme` (vom FOUC-Guard gesetzt) synchronisiert wird; `getTheme()`; `setTheme(mode)` (setzt `data-theme` + `style.colorScheme` auf `<html>`, schreibt `localStorage['sdd-theme']`, ruft danach Abonnenten); `toggleTheme()`; `onThemeChange(cb)` mit Unsubscribe; `resolveInitialTheme()` (localStorage → `matchMedia('(prefers-color-scheme: dark)')` → Dark-Fallback); React-Hook `useTheme()` als dünner Wrapper über `getTheme`/`onThemeChange`.
- [X] T003 FOUC-Guard in `packages/web/index.html` (Contract C2): festes `class="dark"` entfernen und Inline-`<script>` im `<head>` ergänzen, das **vor dem ersten Paint** `data-theme` + `colorScheme` auf `<html>` setzt (Auflösung `localStorage['sdd-theme']` → `prefers-color-scheme` → Dark; Fehler-Fallback Dark).
- [X] T004 Theme-Init in `packages/web/src/main.tsx` verdrahten: `import './theme.js'` (bzw. `./theme`) vor dem Render, damit das Modul seinen In-Memory-Zustand aus dem vom Guard gesetzten `data-theme` übernimmt.

**Checkpoint**: `data-theme` wird FOUC-frei gesetzt; Modus ist lesbar/setzbar/abonnierbar — User Stories können beginnen.

---

## Phase 3: User Story 1 - Zwischen Light- und Dark-Mode umschalten (Priority: P1) 🎯 MVP

**Goal**: Umschalter oben rechts (SVG-Icon); das **gesamte** UI wechselt sofort und ohne Neuladen zwischen Light und Dark, in beiden Modi vollständig lesbar.

**Independent Test**: Umschalter oben rechts betätigen → gesamtes UI (Board, Grid, Läufe, Braucht dich, Konsolen, Dialoge) kippt sofort in den anderen Modus und bleibt lesbar; Icon zeigt den aktiven Modus.

- [X] T005 [P] [US1] `SunIcon` und `MoonIcon` in `packages/web/src/components/icons.tsx` ergänzen (bestehender `Base`-Stil: 24er-Grid, `currentColor`, `stroke-width 2`, `title`-fähig).
- [X] T006 [US1] Umschalter-Komponente `packages/web/src/components/ThemeToggle.tsx` erstellen (Contract C3): nutzt `useTheme()` + `toggleTheme()`; rendert das Icon des **aktiven** Modus (Mond = Dark, Sonne = Light); `title`/`aria-label` nennen das Ziel („Zu Light-Mode wechseln" / „Zu Dark-Mode wechseln"); nativer `<button>`. (abhängig von T002, T005)
- [X] T007 [US1] `<ThemeToggle/>` **oben rechts** in `packages/web/src/App.tsx` einhängen — im `ml-auto`-Cluster der `<header>` neben `<AutomationDial/>`. (abhängig von T006)
- [X] T008 [US1] In `packages/web/src/index.css` unter `:root[data-theme="light"]` die **neutrale Zink-Skala invertieren** (`--color-zinc-950↔50`, `900↔100`, `800↔200`, `700↔300`, `600↔400`, `500` bleibt Mitte) inkl. Light-Gegenwert für `--color-zinc-925`, plus `color-scheme: light`. Overrides außerhalb `@layer` schreiben, damit sie den Tailwind-`theme`-Layer sicher überschreiben (Contract C4/D4).
- [X] T009 [US1] In `packages/web/src/index.css` die **Akzent-Skalen invertieren** (`emerald`, `amber`, `red`, `sky` sowie ggf. weitere tatsächlich genutzte Skalen) analog unter `:root[data-theme="light"]`. (gleiche Datei wie T008 → nach T008)
- [X] T010 [US1] In `packages/web/src/index.css` die **nicht-skalierten Sonderfälle** behandeln (`bg-black`, `bg-white`, `text-white`, `text-black`) und das feste `:root { color-scheme: dark }` entfernen/ersetzen (jetzt attribut-/inline-gesteuert), sodass in **keinem** Modus gleichfarbig-auf-gleichfarbig entsteht (FR-004). (gleiche Datei wie T008/T009 → danach)

**Checkpoint**: US1 eigenständig funktionsfähig — Umschalter wechselt das gesamte UI sichtbar, in beiden Modi lesbar.

---

## Phase 4: User Story 2 - Rückfragen im Claude-Chat sind in beiden Modi lesbar (Priority: P2)

**Goal**: Die xterm-Konsole des Projekt-Chats erhält je Modus eine vollständige, kollisionsfreie ANSI-Palette; „schwarz auf schwarz" verschwindet, Wechsel erfolgt live ohne Session-/Scrollback-/Fokusverlust.

**Independent Test**: Im Projekt-Chat eine Claude-Rückfrage herbeiführen und in **beiden** Modi prüfen, dass Frage und Optionen deutlich vom Hintergrund abheben; beim Umschalten während anstehender Rückfrage bleiben Lesbarkeit, Eingabe und Fokus erhalten.

- [X] T011 [P] [US2] `terminalTheme(mode)` in `packages/web/src/terminalTheme.ts` erstellen (Contract C5): vollständiges xterm-`ITheme` für Light **und** Dark — `background`, `foreground`, `cursor`, `cursorAccent`, `selectionBackground` **und alle 16 ANSI-Farben** (`black`,`red`,`green`,`yellow`,`blue`,`magenta`,`cyan`,`white` + `bright*`); Kernregel: keine ANSI-Farbe (v. a. `black`/`brightBlack`) kollidiert mit `background` (behebt FR-005 bereits in Dark).
- [X] T012 [US2] `packages/web/src/components/TerminalPane.tsx` anpassen: Initial-Theme via `terminalTheme(getTheme())` statt der fest verdrahteten `{background:'#09090b',…}`; `onThemeChange` abonnieren und bei Wechsel `term.options.theme = terminalTheme(mode)` **live** setzen (kein Remount → PTY/Scrollback/Fokus bleiben, FR-003/FR-009); Subscription im Cleanup lösen. (abhängig von T011, T002)
- [X] T013 [P] [US2] In `packages/web/src/components/ChatPanel.tsx` den `bg-black`-Rahmen des Terminals theme-abhängig machen (folgt dem Terminal-`background`), damit im Light-Mode keine schwarze Fläche verbleibt. (andere Datei → parallel zu T011/T012)

**Checkpoint**: US1 **und** US2 funktionieren unabhängig; Rückfragen in beiden Modi lesbar.

---

## Phase 5: User Story 3 - Gewählter Modus bleibt erhalten (Priority: P3)

**Goal**: Explizite Wahl überlebt Neuladen/Neustart, System-Default + Dark-Fallback greifen bei Erstnutzung, und eine spätere Systemänderung überschreibt eine explizite Wahl nicht.

**Independent Test**: Modus wählen, neu laden → gleicher Modus. `sdd-theme` löschen + Systempräferenz variieren → UI folgt System bzw. Dark-Fallback. Explizit wählen, dann Systempräferenz ändern → UI bleibt bei der Nutzerwahl.

- [X] T014 [US3] In `packages/web/src/theme.ts` einen Laufzeit-Listener auf `matchMedia('(prefers-color-scheme: dark)')` ergänzen, der den Modus **nur** dann der Systemänderung folgen lässt, wenn **keine** explizite Wahl in `localStorage['sdd-theme']` vorliegt (Quelle „system"); bei expliziter Wahl bleibt der Modus unverändert (FR-010). (abhängig von T002)
- [X] T015 [US3] In `packages/web/src/theme.ts` `resolveInitialTheme()` gegen ungültige/kaputte `sdd-theme`-Werte härten (unbekannter Wert ⇒ wie „abwesend" → System/Dark), ohne Throw (Data-Model-Invariante). (gleiche Datei wie T014 → danach)

**Checkpoint**: Alle drei User Stories unabhängig funktionsfähig.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Kontrast/Lesbarkeit über beide Modi absichern und Gesamtvalidierung

- [X] T016 WCAG-2.1-AA-Kontrastdurchgang in **beiden** Modi (SC-002) für die enumerierten Sonderflächen und ggf. Nachjustierung in `packages/web/src/index.css`: Status-Punkte/Badges (`emerald/amber/red`), Banner in `App.tsx` (`bg-amber-950/40`, `bg-red-950`), Feature-Vorschlagskarte in `ChatPanel.tsx` (`bg-sky-950/40`), rote Fehlerleisten. Fließtext ≥ 4,5:1, große Schrift/Controls ≥ 3:1; nirgends gleichfarbig-auf-gleichfarbig.
- [ ] T017 Validierung `quickstart.md` V1–V5 durchführen und etwaige Lücken schließen.
- [X] T018 `pnpm --filter @sdd/web typecheck` und `pnpm --filter @sdd/web build` ausführen — beide fehlerfrei.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten.
- **Foundational (Phase 2)**: nach Setup — **blockiert alle** User Stories.
- **User Stories (Phase 3–5)**: alle nach Foundational; danach parallel oder in Prioritätsfolge P1 → P2 → P3.
- **Polish (Phase 6)**: nach den gewünschten Stories.

### User Story Dependencies

- **US1 (P1)**: nach Foundational; keine Abhängigkeit von anderen Stories.
- **US2 (P2)**: nach Foundational; unabhängig von US1 (eigener Terminal-Theme-Pfad; nutzt nur `theme.ts` aus Foundational).
- **US3 (P3)**: nach Foundational; erweitert `theme.ts`, keine UI-Abhängigkeit von US1/US2.

### Within Each User Story

- US1: T005 → T006 → T007 (Icons → Toggle → Einhängen); CSS T008 → T009 → T010 (gleiche Datei, sequenziell). T005/T008 parallel zu T006-Vorbereitung möglich.
- US2: T011 → T012; T013 parallel.
- US3: T014 → T015 (gleiche Datei).

### Parallel Opportunities

- Foundational: T002 blockiert; T003 (index.html) und T002 (theme.ts) sind verschiedene Dateien und teilweise parallelisierbar, T004 danach.
- US1: T005 (icons.tsx) parallel zur CSS-Arbeit (index.css); die drei index.css-Tasks T008–T010 sind **nicht** untereinander parallel (gleiche Datei).
- US2: T011 (terminalTheme.ts) und T013 (ChatPanel.tsx) parallel; T012 nach T011.
- Verschiedene Stories parallel durch verschiedene Personen nach Foundational.

---

## Parallel Example: User Story 2

```bash
# Nach Foundational — parallel starten (verschiedene Dateien):
Task: "terminalTheme(mode) in packages/web/src/terminalTheme.ts erstellen (T011)"
Task: "bg-black-Rahmen in packages/web/src/components/ChatPanel.tsx theme-abhängig machen (T013)"
# danach:
Task: "TerminalPane.tsx auf terminalTheme + Live-Update umstellen (T012)"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational (kritisch, blockiert alles).
2. Phase 3 US1 vollständig.
3. **STOP & VALIDATE**: Umschalter oben rechts wechselt das gesamte UI, beide Modi lesbar (quickstart V1).
4. Demo/Einsatz möglich.

### Incremental Delivery

1. Setup + Foundational → Substrat steht.
2. US1 → Umschalter + gesamtes UI beidmodig (MVP, quickstart V1/V5).
3. US2 → Rückfragen/Terminal in beiden Modi lesbar (quickstart V2).
4. US3 → Persistenz, System-Default, Vorrang der Nutzerwahl (quickstart V3/V4).
5. Polish → Kontrast-Feinschliff + Gesamtvalidierung.

### Parallel Team Strategy

Nach Foundational: Entwickler A → US1, B → US2, C → US3. Integrieren unabhängig; `theme.ts` (Foundational) ist die gemeinsame Basis, an der nur US3 weiterarbeitet.

---

## Notes

- [P] = andere Datei, keine offene Abhängigkeit.
- Persistenz ist bereits im Foundational-Modul aktiv; **US3** garantiert und validiert zusätzlich System-Default, Dark-Fallback, Vorrang der Nutzerwahl (FR-010) und Robustheit gegen kaputte Werte.
- Der Rückfragen-Fix (US2) wirkt auch für reine Dark-Nutzer, da die Grundursache die fehlende ANSI-Palette (xterm-Default) ist.
- Nach jeder Task oder logischen Gruppe committen; an Checkpoints Story unabhängig prüfen.
