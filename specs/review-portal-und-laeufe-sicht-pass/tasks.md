---
description: "Aufgabenliste: Review-Portal und Läufe-Ansicht — Lesbarkeits-Pass"
---

# Tasks: Review-Portal und Läufe-Ansicht — Lesbarkeits-Pass

**Input**: Design-Dokumente aus `/specs/review-portal-und-laeufe-sicht-pass/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (D1–D15),
[data-model.md](./data-model.md) (I1–I17), [contracts/change-overview.md](./contracts/change-overview.md) (R1–R9),
[contracts/ui-contract.md](./contracts/ui-contract.md) (C1–C9), [quickstart.md](./quickstart.md) (Stufe 1–4)

**Tests**: Tests sind hier **ausdrücklich verlangt** — aber nur für das neue reine Modul.
`packages/shared` hat einen Vitest-Runner, `packages/web` hat bewusst keinen (`test` = No-op,
`packages/web/package.json`). Deshalb genau **eine** Testdatei (`changeOverview.test.ts`,
Mindestdeckung aus contracts/change-overview.md §4); der UI-Nachweis läuft über
`tsc --noEmit`, `vite build` und die belegte Browser-Prüfung (FR-027, SC-010).

**Organization**: Aufgaben sind nach User Story gruppiert, damit jede Story eigenständig
umgesetzt, geprüft und ausgeliefert werden kann.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel ausführbar (andere Datei, keine Abhängigkeit von offenen Aufgaben)
- **[Story]**: Zuordnung zur User Story (US1–US4)
- Jede Beschreibung nennt den genauen Pfad

## Pfad-Konventionen

pnpm-Monorepo. Betroffen sind nur:

- `packages/shared/src/` — ein neues reines Modul + sein Test
- `packages/web/src/` — `index.css` und 10 Komponenten
- `specs/review-portal-und-laeufe-sicht-pass/evidence/` — Belege der Browser-Prüfung
- **Unangetastet**: `packages/server`, `packages/desktop`, `terminalTheme.ts`, die
  Terminal-Rahmen (`FeatureConsole`, `ShellConsole`, `GridView`, `FeatureResultDialog`) und
  `ProjectSettings.tsx` (D14, C9)

## Farbregel für ALLE Aufgaben (C1)

Zulässig sind nur die Skalen `zinc`, `emerald`, `amber`, `red`, `sky`, `teal`, `violet`.
Verboten: jede andere Skala (insbesondere `indigo`, `purple`) und jeder feste Farbwert
(`bg-[#…]`, Hex in TS/TSX, `stroke="#…"`). Stufen: Text zinc **≤ 400** / Akzent **300**;
Nur-3:1-Elemente zinc **≤ 500**; Grafikfläche Akzent **400**, `amber` **300**, grau
**zinc-500**; Abzeichentext **200/300**. Einzige erlaubte Ausnahme: `bg-black/70` als
Modal-Schleier (`ReviewPortal.tsx:150`).

---

## Phase 1: Setup (gemeinsame Voraussetzungen)

**Purpose**: Arbeitsfähiger Worktree und Ablage für die Belege

- [X] T001 Abhängigkeiten im Worktree installieren: `pnpm install` im Repo-Wurzelverzeichnis — dieser Worktree hat kein `node_modules`, ohne Installation scheitern `typecheck`, `test` und `build` (quickstart.md „Voraussetzungen")
- [X] T002 [P] Belegordner `specs/review-portal-und-laeufe-sicht-pass/evidence/` anlegen (mit `.gitkeep`), Zieldateien laut quickstart.md Stufe 4
- [X] T003 [P] Eigene Prüfinstanz auf **freien** Ports starten und PID merken: `SDD_PORT=4899 pnpm --filter @sdd/server dev` + `SDD_PORT=4899 SDD_WEB_PORT=4898 pnpm --filter @sdd/web dev` → `http://localhost:4898`. **Nicht** 4820/4830 (laufende Toolkit-Instanz), **kein** `pkill -f` (CLAUDE.md)
  - **Tatsächlich verwendet**: 4898 und 4899 waren beim Start von fremden Worktrees belegt (auf 4899 lief ein fremder Fastify-Server, Vite driftete stumm dorthin). Deshalb: nur **Vite** auf dem freien Port **4880** mit `--strictPort`, API per Proxy auf den laufenden Server 4820 (`SDD_PORT=4820 pnpm --filter @sdd/web exec vite --port 4880 --strictPort`) → `http://localhost:4880`. **Kein zweiter Server**: `dataDir` ist `~/.sdd-toolkit`, ein zweiter Schreiber auf derselben SQLite-Datei hätte die laufende Instanz gefährdet — und ohne echte Features (Diff, Commits, Läufe) wäre die Browser-Prüfung ohnehin gegenstandslos. Gemerkte PID: siehe T037.

---

## Phase 2: Foundational (blockierende Voraussetzung)

**Purpose**: Die Hellmodus-Mechanik muss teal und violet kennen, **bevor** irgendeine Fläche
oder Schrift auf diese Skalen gesetzt wird — sonst folgt der Hellmodus nicht (FR-025, C2).

**⚠️ CRITICAL**: Kein Story-Task darf vor Abschluss dieser Phase Farben auf teal/violet setzen.

- [X] T004 In `packages/web/src/index.css` im Block `:root[data-theme='light']` die zwei Skalen **teal** und **violet** mit je 11 Stufen nach dem bestehenden Inversionsschema ergänzen (50↔950 … 400↔600, 500 unverändert); Hex-Werte wörtlich aus contracts/ui-contract.md C2. Die Mechanik selbst (Selektor, Position **ausserhalb** jedes `@layer`, `color-scheme`) bleibt unverändert, `--color-zinc-925` bleibt der einzige Sonderwert
- [X] T005 Ergänzung in `packages/web/src/index.css` prüfen: `grep -o 'color-teal-[0-9]*\|color-violet-[0-9]*' packages/web/src/index.css | wc -l` ergibt **22**; keine weitere Skala aufgenommen (kein `purple`, kein `indigo`); danach misst `teal-200` auf `teal-900` 7.52 (dark) / 6.73 (light) → FR-019 ohne Ersatzmittel erfüllt

**Checkpoint**: Alle sieben Skalen invertieren — Story-Arbeit kann beginnen

---

## Phase 3: User Story 1 — Beim Öffnen des Portals sofort wissen, worum es geht (Priority: P1) 🎯 MVP

**Goal**: Die grösste Fläche des Review-Portals zeigt ohne Dateiauswahl eine gekürzte
Änderungsübersicht (Kennzahlen, höchstens 10 Dateien nach Paket gruppiert, Restzeile, drei
jüngste Commits) statt „Datei links auswählen." — gerechnet aus dem bereits geladenen
`DiffSummary`, ohne zusätzlichen Abruf.

**Independent Test**: Portal eines Features mit mehreren geänderten Dateien und mehreren Commits
öffnen, **keine** Datei anklicken → die Mitte zeigt Dateizahl, Zeilenbilanz, die grössten
Änderungen und die Commits; Klick auf eine Datei zeigt deren Diff an derselben Stelle, „Übersicht"
führt ohne Neuladen zurück.

### Tests for User Story 1 ⚠️

> **Zuerst schreiben, Fehlschlag bestätigen, dann T007 umsetzen.**

- [X] T006 [US1] Vitest-Suite `packages/shared/src/changeOverview.test.ts` anlegen mit der Mindestdeckung aus contracts/change-overview.md §4: 14 Dateien → 10 gezeigt / `hiddenFiles === 4`; 90 Dateien → `hiddenFiles === 80` und Kopfzahlen über alle 90; genau 10 → `hiddenFiles === 0`; Gleichstand im Umfang → Pfad entscheidet und Ergebnis ist über zwei Aufrufe stabil (R2); alle vier Pfadformen → `packages/web`, `specs/foo`, `docs`, `(Wurzel)`; Gruppenreihenfolge nach gezeigter Summe (R3); Binärdatei behält `0/0` + `binary` (R5); nur Binärdateien → `hasChanges === true`, `binaryFiles === totals.files`; 0 Dateien (R6); 0 Commits bei vorhandenen Dateien (R7); 5 unsortierte Commits → die 3 jüngsten absteigend (R4); Eingabe-Arrays vor/nach Aufruf unverändert (R8)

### Implementation for User Story 1

- [X] T007 [US1] Reines Modul `packages/shared/src/changeOverview.ts` anlegen: Typen `ChangeFile`, `ChangeCommit`, `ChangeOverviewInput`, `ChangeGroup`, `ChangeOverview`, Konstanten `MAX_OVERVIEW_FILES = 10`, `MAX_OVERVIEW_COMMITS = 3`, `ROOT_GROUP_KEY = '(Wurzel)'` sowie `overviewGroupKey(path)` (erste zwei Segmente bei ≥ 3 Segmenten, sonst erstes Segment, Wurzel → `ROOT_GROUP_KEY`) und `buildChangeOverview(input)` nach R1–R9 — pur, ohne `Date.now()`, ohne DOM/Netz, Sortierung auf Kopien
- [X] T008 [US1] `packages/shared/src/index.ts`: `export * from './changeOverview.js';` in der bestehenden Liste ergänzen (Reihenfolge/Stil wie `./diffParse.js`)
- [X] T009 [US1] Neue Komponente `packages/web/src/components/review/ChangeOverview.tsx` mit Props `{ overview, targetBranch, onSelectFile }` laut C3: Kopfzeile mit drei Kennzahlen (`text-sm`, Etiketten `text-xs text-zinc-400`), Dateien je Gruppe (Überschrift `font-mono text-xs text-zinc-400`, Pfad **relativ zur Gruppe**, rechts `+A` `text-emerald-300` / `−D` `text-red-300` oder **„binär"** `text-zinc-400`), Restzeile „+N weitere Dateien — vollständige Liste links." bei `hiddenFiles > 0`, Commit-Teil („M Commits" + bis zu drei Betreffzeilen mit Zeitpunkt, Hinweis auf den Reiter „Historie"; bei `hasCommits === false` der Satz über ungetrackte Arbeit). Bei `hasChanges === false` **ausschliesslich** „Keine Änderungen gegenüber `<targetBranch>`." — keine Nullwert-Kennzahlen. Die Komponente rechnet nicht selbst, kürzt nicht selbst und lädt nichts nach; lange Pfade `truncate` mit vollem Pfad im `title`, keine eigene Höhenbegrenzung
- [X] T010 [US1] `packages/web/src/components/ReviewPortal.tsx`: `buildChangeOverview(summary)` in einem `useMemo` über `summary` (kein neuer State, kein zusätzlicher Abruf) und die Mitte des Reiters „Dateien" umschalten — `selectedFile !== null` → Diff wie heute; `summary === null` → „Lade Änderungen …" (D4); sonst `<ChangeOverview …>` statt „Datei links auswählen." (`:262`). `targetBranch` aus dem bereits geladenen `target` (`MergeTarget.targetBranch`, `:37`) beziehen, `onSelectFile` setzt `setSelectedFile(path)`
- [X] T011 [US1] `packages/web/src/components/ReviewPortal.tsx`: in der Dateiliste des Reiters „Dateien" (`:214`) als **ersten Eintrag** den Schalter **„Übersicht"** einfügen — aktiv markiert bei `selectedFile === null` (gleiche Aktiv-Markierung wie die Dateizeilen, `:221`), Klick setzt `setSelectedFile(null)`; Tab-Struktur und Spaltenlayout bleiben unverändert (C9)
- [ ] T012 [US1] Browser-Prüfung quickstart.md **Stufe 2** auf `http://localhost:4898` durchlaufen (Schritte 1–7: Übersicht ohne Klick, Datei → Diff, Rückweg über „Übersicht" und über eine Dateizeile, Feature ohne Änderungen, Binärdatei-Zeile trägt „binär", 90-Dateien-Fall ohne waagerechtes Seiten-Scrollen, Netzwerk-Panel: **kein** zusätzlicher Abruf und kein zweiter Ladezustand); Belege `evidence/portal-uebersicht-dark.png`, `evidence/portal-uebersicht-light.png`, `evidence/portal-leer.png`

**Checkpoint**: US1 ist eigenständig lauffähig und prüfbar (FR-001–FR-006, SC-001, SC-009)

---

## Phase 4: User Story 2 — Den Diff in beiden Modi tatsächlich lesen können (Priority: P2)

**Goal**: Diff-, Editor- und Log-Flächen verlieren den festen Hex `#0a0a0c` und folgen der Skala;
Zeilennummern steigen von `zinc-600` auf `zinc-500`; Code erreicht in **beiden** Modi ≥ 4.5:1,
Zeilennummern und Abschnittsköpfe ≥ 3:1.

**Independent Test**: Datei mit hinzugefügten **und** entfernten Zeilen öffnen, Modus bei offenem
Diff umschalten → Fläche folgt sofort, keine dunkle Fläche im Hellmodus, Scroll-Position bleibt;
gemessene Kontraste erfüllen das Soll; im Graustufen-Screenshot bleiben add/del am führenden
`+`/`-` unterscheidbar.

- [ ] T013 [P] [US2] `packages/web/src/components/review/DiffViewer.tsx`: Fläche `:52` `bg-[#0a0a0c]` → `bg-zinc-950`; Zeilennummern `text-zinc-600` → `text-zinc-500` (2.57 → 4.12/4.63); Platzhalter- und Hinweistexte („Lade Diff …", „Kein Diff für diese Datei.", „Binärdatei — kein Text-Diff.") und erledigte Kommentare `text-zinc-600`/`-500` → `text-zinc-400`. **Unverändert bleiben**: Abschnittskopf `text-sky-400` auf `bg-zinc-900/70`, add/del `emerald-300`/`red-300` auf `emerald-950/60`/`red-950/50`, Markierung `ring-1 ring-sky-500` (ändert keine Textfarbe) und das führende `+`/`-`/Leerzeichen im Zeilentext (`:148`, FR-014)
- [ ] T014 [P] [US2] `packages/web/src/components/review/FileEditor.tsx:114`: `bg-[#0a0a0c]` → `bg-zinc-950`
- [ ] T015 [P] [US2] `packages/web/src/components/review/TestsPane.tsx`: Fläche `:77` → `bg-zinc-950`; Textstufen `text-zinc-600`/`-500` → `text-zinc-400` (C1)
- [ ] T016 [P] [US2] `packages/web/src/components/ExecutionsView.tsx:233`: Log-Fläche `bg-[#0a0a0c]` → `bg-zinc-950` (FR-016) — nur diese Zeile, alles Übrige der Datei gehört zu US4
- [ ] T017 [P] [US2] `packages/web/src/components/FeatureDashboard.tsx`: Log-Fläche `:126` → `bg-zinc-950` und Textstufen `text-zinc-600`/`-500` → `text-zinc-400` (D14, C1)
- [ ] T018 [US2] `packages/web/src/components/ReviewPortal.tsx`: Roh-Diff der Konfliktauflösung (`DiffView`, `:460`) `bg-[#0a0a0c]` → `bg-zinc-950` (FR-016) und C1-Stufen im Kopf und in der Dateiliste — `text-zinc-600` → `text-zinc-400`, `text-emerald-500`/`text-red-500` → `-300` (`HeaderStat` ab `:163`, Liste ab `:214`); `bg-black/70` (`:150`) bleibt
- [ ] T019 [US2] Browser-Prüfung quickstart.md **Stufe 3a** in **beiden** Modi: Modus bei offenem Diff umschalten (Fläche folgt, Scroll-Position bleibt), Kommentar-Anker anspringen (Markierung erkennbar, Text lesbar), Konfliktauflösung und Log-Ansicht im Hellmodus; Kontrast-Schnipsel aus quickstart.md Stufe 3a ausführen (Soll: Code ≥ 4.5, Zeilennummer ≥ 3) und `document.documentElement.style.filter = 'grayscale(1)'` für SC-005 setzen und **zurücksetzen**; Belege `evidence/portal-diff-dark.png`, `evidence/portal-diff-light.png`, `evidence/portal-diff-graustufen.png`

**Checkpoint**: US1 **und** US2 funktionieren unabhängig (FR-012–FR-016, SC-004–SC-006)

---

## Phase 5: User Story 3 — Die rechte Spalte sagt etwas, auch wenn nichts geprüft wurde (Priority: P3)

**Goal**: Die rechte Spalte unterscheidet „konnte nicht geladen werden", „wird geladen" und
„keine Läufe" (samt Bedeutung für die Freigabe-Entscheidung) und bleibt nach einem gescheiterten
Abruf **nicht** für immer im Ladezustand.

**Independent Test**: Portal eines Features ohne Agent-Läufe öffnen → Aussage samt Bedeutung;
`/agent-runs` drosseln → „Lade Audits …"; `/agent-runs` blockieren → Fehlersatz statt Dauer-Laden.
Alle drei Fälle je einmal ausgelöst und belegt.

- [ ] T020 [US3] `packages/web/src/components/ReviewPortal.tsx`: State `runsError: string | null` ergänzen und im `agentRuns`-Abruf (`:74`) den Fehler **lokal** merken (`setRunsError`) — zusätzlich zum bestehenden globalen Kanal (`fail` / `dispatch({type:'error'})`), der unverändert bleibt; `error={runsError}` an `AuditSidebar` (`:303–316`) übergeben (D12)
- [ ] T021 [US3] `packages/web/src/components/review/AuditSidebar.tsx`: Prop `error: string | null` in die Signatur aufnehmen und die vier Zustände **in dieser Prüfreihenfolge** rendern (`:31`) — (1) `error` → „Audits konnten nicht geladen werden." + Grund (`text-amber-300`), **kein** Ladezustand mehr; (2) `runs === null` → „Lade Audits …"; (3) `runs.length === 0` → benannter Zustand **plus Bedeutung**, dass kein Agent geprüft hat und das eigene Urteil damit das einzige Gate ist; (4) sonst wie heute (Gruppen nach Auslöser, `VerdictPill`, Bericht-Dialog). `verdict === null` bleibt „unklar" und zählt nie in `passed` (FR-011, I10)
- [ ] T022 [US3] `packages/web/src/components/review/AuditSidebar.tsx`: Farben nach C1 — `ProgressRing` (`:134`) `stroke="#27272a"` → `className="stroke-zinc-800"`, `#10b981`/`#f59e0b` → `stroke-emerald-400`/`stroke-amber-300`; `text-zinc-600`/`-500` → `text-zinc-400`; `VerdictPill` auf `emerald-300`/`red-300`. **Die Schriftgrössen der Spalte bleiben unverändert** — die 11 Sondergrössen dieser Datei werden **nicht** angefasst (Klärung 2026-07-30, C6)
- [ ] T023 [P] [US3] `packages/web/src/components/review/CommentsPanel.tsx`: **nur** Farbstufen nach C1 (`text-zinc-600`/`-500` → `text-zinc-400`); die bestehende Leer-Aussage (`:96–100`, FR-010) und die 5 Sondergrössen bleiben unverändert
- [ ] T024 [US3] Browser-Prüfung quickstart.md **Stufe 3b** in beiden Modi: alle drei Zustände auslösen (Feature ohne Läufe / „Slow 3G" / Request-Blocking auf `/agent-runs`), zusätzlich Feature ohne Kommentare und Lauf mit `verdict === null`; Belege `evidence/portal-ohne-laeufe.png`, `evidence/portal-laeufe-laedt.png`, `evidence/portal-laeufe-fehler.png`

**Checkpoint**: US1–US3 sind je eigenständig funktionsfähig (FR-007–FR-011, SC-002, SC-003)

---

## Phase 6: User Story 4 — Läufe-Ansicht: knappe Beschriftung, lesbare Grössen, beide Modi (Priority: P4)

**Goal**: „von der CLI gemeldet" wird zu **„gemeldet"** (Farbmittel, Vorrangregel und Aussage
bleiben — die lange Form steht im Tooltip), alle Sondergrössen steigen auf `text-xs`
(Kennzahlen `text-sm`), alle Marker auf ≥ 10 px, und die Diagrammfarben kommen über
Tailwind-Klassen statt Hex.

**Independent Test**: Läufe-Ansicht mit zwei Läufen unterschiedlicher Herkunft in beiden Modi
öffnen → Abzeichen zeigt **ein Wort**, der Farbunterschied bleibt in beiden Modi erkennbar, kein
Text unter 12 px, Kennzahlen 14 px, kleinster Marker ≥ 10 px, alle neun Spalten der Tabelle
erreichbar.

> **Reihenfolge-Hinweis**: T025/T026 (`charts.tsx`) und T028 (`ExecutionsView.tsx`) hängen am
> gleichen Typ — `Segment.color` entfällt, `Segment.tone` kommt. Dazwischen ist `tsc --noEmit`
> **rot**; die drei Aufgaben müssen als eine Einheit fertig werden. `ExecutionsView.tsx` ist der
> einzige Konsument der Diagramm-Bausteine (`AuditSidebar`, `TestsPane`, `FeatureAgentSelect`
> importieren nur `fmtTokens`) — `FeatureDashboard` erbt die Änderungen über `RunCard`.

- [ ] T025 [US4] `packages/web/src/components/charts.tsx`: `ChartTone { bg: string; stroke: string }` exportieren, `Segment.color: string` (`:6`) durch `tone: ChartTone` ersetzen, `HBarChart`-Items entsprechend (`:34`), und `CHART_TONES` mit **vollständig ausgeschriebenen** Klassennamen anlegen (`spec`/`input` = `bg-sky-400`+`stroke-sky-400`, `coding`/`output` = `emerald-400`, `overhead`/`cacheWrite` = **`amber-300`**, `chat` = **`violet-400`** (kein `purple`), `cacheRead` = `zinc-500`, `track` = `zinc-800`). Kein Hex, kein `style={{ backgroundColor }}`, kein `var(--color-…)` und **kein** Template-String `bg-${…}` (T1, T2, D9, I15)
- [ ] T026 [US4] `packages/web/src/components/charts.tsx`: Grössen nach T3–T7 — `StackedBar` (`:57`) Standardhöhe **10** und Leerzustand `h-2.5`, `HBarChart` (`:34`) Balken `h-4` und der Zahlenwert **rechts neben** dem Balken in eigener Spalte (`w-14 text-right text-xs text-zinc-300`) statt darin, `Donut` (`:76`) Spur `stroke-zinc-800` + Segmente `tone.stroke` + Legende `text-xs`, Legendenpunkte `h-2.5 w-2.5`; alle `text-[10px]`/`text-[11px]` der Datei entfallen
- [ ] T027 [US4] `packages/web/src/components/ExecutionsView.tsx`: `SOURCE_LABELS.telemetry` (`:46`) `'von der CLI gemeldet'` → **`'gemeldet'`** und am `SourceBadge` `title="Von der Claude-CLI gemeldet — nicht vom Toolkit erschlossen"` setzen (D13). `dominantSource`-Vorrangregel, die `measured`/`reported`-Rechnung und alle Kommentare dazu bleiben **wörtlich unverändert** (FR-018, I14)
- [ ] T028 [US4] `packages/web/src/components/ExecutionsView.tsx`: `CATEGORY_COLORS` (`:31`, Hex) durch `CATEGORY_TONES` aus `CHART_TONES` ersetzen und die drei Verwendungsstellen (`:262`, `:332`, `:344`) auf `tone` umstellen; `Composition`-Segmente auf `input`/`output`/`cacheRead`/`cacheWrite`; `StackedBar`-Override `height={8}` entfernen (Standard 10); Legendenpunkte `h-1.5 w-1.5`/`h-2 w-2` → `h-2.5 w-2.5`. Danach ist `pnpm -r typecheck` wieder grün (siehe Reihenfolge-Hinweis)
- [ ] T029 [US4] `packages/web/src/components/ExecutionsView.tsx`: Grössen nach C8 — Kennzahlen der Lauf-Karte (Output, Cache-Read, Betrag, Subagenten) auf **`text-sm`** und ihre Spalte `w-28` → `w-36`; alle 12 Sondergrössen `text-[9px]`–`text-[11px]` (Zweitzeilen, Abzeichen, Legenden, Tabellentext, `uppercase`-Überschriften) → **`text-xs`**
- [ ] T030 [US4] `packages/web/src/components/ExecutionsView.tsx`: Farbstufen nach C1 — `text-emerald-400` (Output) → `text-emerald-300`, `text-zinc-600`/`-500` als Text → `text-zinc-400`, `StatusBadge`/`IntegrationBadge` Textstufe 400 → **300** auf der 950-Fläche; `text-teal-300` (Herkunft) und `text-violet-300` (Subagenten) bleiben. Kein Hex mehr in der Datei
- [ ] T031 [US4] `packages/web/src/components/ExecutionsView.tsx`: Tabelle „Einzelne Ausführungen" in einen `<div className="overflow-x-auto">` fassen, `<table className="w-full min-w-[60rem] …">`, Zahlen-, Zeit- und Status-Zellen `whitespace-nowrap`, keine `truncate` auf Werten — die **Seite** scrollt nicht waagerecht (FR-022, D11)
- [ ] T032 [US4] Browser-Prüfung quickstart.md **Stufe 3c** in beiden Modi: zwei Läufe unterschiedlicher Herkunft nebeneinander (ein Wort, Farbunterschied, Tooltip), Schriftgrössen-Schnipsel (kleinster Wert = 12, Kennzahlen 14), Marker-Schnipsel (kleinste Ausdehnung ≥ 10), Lauf aufgeklappt (Balkenwerte **neben** den Balken, keine dunkle Fläche im Hellmodus), Tabelle mit allen neun Spalten, FR-024-Verhalten (`—` statt `0`, keine Zeile ohne Anteil, keine Ersatzschätzung) und `FeatureDashboard` desselben Features zum Grössenvergleich (FR-021a); Belege `evidence/laeufe-dark.png`, `evidence/laeufe-light.png`, `evidence/laeufe-herkunft.png`, `evidence/laeufe-tabelle.png`

**Checkpoint**: Alle vier Stories sind eigenständig funktionsfähig (FR-017–FR-024, SC-006–SC-008)

---

## Phase 7: Polish & übergreifende Prüfungen

**Purpose**: Nachweise, dass keine feste Farbe und keine verbotene Skala übrig ist, und dass die
Abnahme belegt vorliegt

- [ ] T033 [P] Restsuche quickstart.md **Stufe 3d** ausführen: `grep -rnE 'bg-\[#|#[0-9a-fA-F]{6}'` über `packages/web/src/components/ExecutionsView.tsx`, `charts.tsx`, `review/` und `ReviewPortal.tsx` findet **nichts**; `grep -rnE '(bg|text|border|ring|stroke|fill)-(indigo|purple|fuchsia|cyan|blue|green|lime|orange|rose|pink|slate|gray|neutral|stone)-' packages/web/src` findet **nichts**; `grep -o 'color-teal-[0-9]*\|color-violet-[0-9]*' packages/web/src/index.css | wc -l` ergibt 22
- [ ] T034 Automatisierte Checks quickstart.md **Stufe 1** grün: `pnpm -r typecheck && pnpm -r test && pnpm --filter @sdd/web build` — der Web-Build enthält den Tailwind-Durchlauf und belegt damit, dass die Klassennamen der Diagramm-Töne gefunden werden (D9); bestehende Suites (`diffParse.test.ts`, `runSummary.test.ts`, `actionPolicy.test.ts`) bleiben unverändert grün
- [ ] T035 [P] `specs/review-portal-und-laeufe-sicht-pass/evidence/messwerte.md` schreiben: abgelesene Kontraste und Schriftgrössen je Modus, Soll/Ist gegenübergestellt (Referenzwerte research.md D6) — plus die Notiz, dass `docs/images/review.png` und `docs/images/laeufe.png` **bekannt veraltet** sind (Aktualisierung nicht Teil dieses Features)
- [ ] T036 [P] Vollständigkeit der Belege gegen quickstart.md Stufe 4 prüfen: alle 12 Einträge liegen unter `specs/review-portal-und-laeufe-sicht-pass/evidence/` (beide Modi je Ansicht, Graustufen-Beleg, drei Zustände der rechten Spalte, Leer-Feature, Herkunfts-Vergleich, Tabelle, `messwerte.md`) — SC-010
- [ ] T037 Prüfinstanz aus T003 **gezielt** abbauen: `lsof -ti:4899 | xargs kill` und `lsof -ti:4898 | xargs kill` bzw. über die gemerkten PIDs. **Kein** `pkill -f vite`/`node`/`tsx`/`pnpm` — die eigene Session ist Kindprozess der laufenden Toolkit-Instanz und stirbt mit (CLAUDE.md)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeit — T001 blockiert jeden `typecheck`/`test`/`build`, T003 blockiert jede Browser-Prüfung
- **Foundational (Phase 2)**: nach Setup — **blockiert jede Farbaufgabe**, die teal oder violet setzt (T022, T025, T028, T030) und jede Hellmodus-Prüfung
- **US1 (Phase 3)**: nach Phase 2 — keine Abhängigkeit von US2–US4
- **US2 (Phase 4)**: nach Phase 2 — unabhängig von US1; berührt `ReviewPortal.tsx` (T018) wie US1 und US3
- **US3 (Phase 5)**: nach Phase 2 — unabhängig von US1/US2
- **US4 (Phase 6)**: nach Phase 2 — unabhängig von US1–US3
- **Polish (Phase 7)**: nach allen gewünschten Stories; T033/T034 sind erst dann aussagekräftig

### Innerhalb der Stories

- **US1**: T006 (Test) zuerst → T007 (Modul) → T008 (Export) → T009 (Komponente) → T010, T011 (`ReviewPortal`, dieselbe Datei, seriell) → T012 (Browser)
- **US2**: T013–T017 parallel → T018 (`ReviewPortal`, kollidiert mit T010/T011/T020) → T019 (Browser)
- **US3**: T020 (`ReviewPortal`) und T021 (`AuditSidebar`-Zustände) → T022 (`AuditSidebar`-Farben, dieselbe Datei) ∥ T023 (`CommentsPanel`) → T024 (Browser)
- **US4**: T025 → T026 → T028 als **eine** typecheck-Einheit; T027, T029, T030, T031 danach seriell in derselben Datei → T032 (Browser)

### Datei-Kollisionen (kein [P] über diese Grenzen hinweg)

| Datei | Aufgaben |
|---|---|
| `ReviewPortal.tsx` | T010, T011 (US1) · T018 (US2) · T020 (US3) |
| `review/AuditSidebar.tsx` | T021, T022 (US3) |
| `charts.tsx` | T025, T026 (US4) |
| `ExecutionsView.tsx` | T016 (US2) · T027, T028, T029, T030, T031 (US4) |
| `index.css` | T004 (T005 liest nur) |

### Parallel Opportunities

- Setup: T002 ∥ T003
- US2: T013 ∥ T014 ∥ T015 ∥ T016 ∥ T017 (fünf verschiedene Dateien) — grösste Parallelität des Features
- US3: T023 ∥ T021/T022
- Polish: T033 ∥ T035 ∥ T036
- Nach Phase 2 können US1, US2, US3 und US4 von verschiedenen Personen gleichzeitig bearbeitet werden — mit der Absprache, dass `ReviewPortal.tsx` (US1/US2/US3) und `ExecutionsView.tsx` (US2/US4) nacheinander angefasst werden

---

## Parallel Example: User Story 2

```bash
# Die fünf Flächen-Aufgaben liegen in fünf verschiedenen Dateien und laufen gleichzeitig:
Task: "T013 DiffViewer.tsx — Fläche bg-zinc-950, Zeilennummern zinc-500, Hinweistexte zinc-400"
Task: "T014 review/FileEditor.tsx:114 — bg-[#0a0a0c] → bg-zinc-950"
Task: "T015 review/TestsPane.tsx:77 — Fläche + Textstufen"
Task: "T016 ExecutionsView.tsx:233 — Log-Fläche"
Task: "T017 FeatureDashboard.tsx:126 — Log-Fläche + Textstufen"
# Danach seriell: T018 (ReviewPortal.tsx), dann T019 (Browser-Prüfung in beiden Modi)
```

---

## Implementation Strategy

### MVP zuerst (nur User Story 1)

1. Phase 1 (T001–T003)
2. Phase 2 (T004–T005) — **blockierend**
3. Phase 3 (T006–T012)
4. **STOP und prüfen**: US1 eigenständig gegen quickstart.md Stufe 2
5. Auslieferbar: das Portal zeigt beim Öffnen den Umfang des Features (SC-001)

### Inkrementelle Auslieferung

1. Setup + Foundational → alle sieben Skalen invertieren
2. + US1 → eigenständig prüfen → ausliefern (**MVP**)
3. + US2 → Diff in beiden Modi lesbar → ausliefern
4. + US3 → rechte Spalte mit Aussage → ausliefern
5. + US4 → Läufe-Ansicht knapp und lesbar → ausliefern
6. Phase 7 → Restsuche, Checks, Belege (SC-010)

Jede Stufe steht für sich; keine Story bricht eine vorige.

---

## Notes

- **Keine funktionale Regel wird angefasst** (C9): kein Endpunkt, kein Schema, keine Änderung an
  `actionPolicy`, Merge-Queue, Tab-Struktur, Spaltenlayout oder an der Verbrauchsmessung selbst
- **Nicht abschwächen**: die Unterscheidung gemeldet ↔ erschlossen (FR-018 — sie hat einen
  Messfehler um Faktor 10 sichtbar gemacht) und das FR-024-Verhalten bei fehlenden Werten
- **Schriftgrössen der rechten Portal-Spalte bleiben** (`AuditSidebar`, `CommentsPanel`): die 16
  Sondergrössen dort sind laut Klärung 2026-07-30 **kein** Gegenstand dieses Features
- `[P]` = andere Datei, keine offene Abhängigkeit — siehe Kollisionstabelle
- Commit nach jeder Aufgabe oder logischen Gruppe; an jedem Checkpoint kann angehalten und die
  Story einzeln geprüft werden
- Prozesse **nur** über eigenen Port oder gemerkte PID beenden, niemals per `pkill -f` mit
  generischem Muster (CLAUDE.md, T037)
