# Phase 0 — Research: Review-Portal und Läufe-Ansicht — Lesbarkeits-Pass

**Feature**: `review-portal-und-laeufe-sicht-pass` · **Datum**: 2026-07-30 ·
**Spec**: [spec.md](./spec.md)

Die Spec ist nach `/speckit-clarify` ohne offene `NEEDS CLARIFICATION` (drei Fragen sind in
Session 2026-07-30 beantwortet: Theme-Fähigkeit von teal/violet, Reichweite der
Grössen-Untergrenze, Umfang der Änderungsübersicht). Dieses Dokument hält deshalb
**Umsetzungsentscheidungen** fest — insbesondere die **gemessenen Kontraste**, die aus den
Soll-Werten der Spec konkrete Farbstufen machen.

---

## Ausgangsbefund am Code

| Beobachtung | Stelle | Befund |
|---|---|---|
| Leere rechte Spalte | `review/AuditSidebar.tsx:31`, `ReviewPortal.tsx:73–75` | Bei 0 Läufen erscheinen nur Ring + „Keine Läufe" ohne Bedeutung; scheitert `api.agentRuns`, bleibt `runs === null` und die Spalte steht **dauerhaft** auf „Lade Audits …" — Lade- und Fehlerfall sind nicht unterscheidbar (FR-009 heute verletzt). |
| „Datei links auswählen." | `ReviewPortal.tsx:262` | Grösste Fläche des Portals ohne Aussage; die Daten (`summary.files`, `summary.commits`) sind ab `ReviewPortal.tsx:62` bereits geladen. |
| Diff-Fläche fest dunkel | `review/DiffViewer.tsx:52`, `ReviewPortal.tsx:460`, `review/FileEditor.tsx:114`, `review/TestsPane.tsx:77`, `ExecutionsView.tsx:233`, `FeatureDashboard.tsx:126` | 6× `bg-[#0a0a0c]` — ein fester Hex, der an der Inversion vorbeigeht. |
| Halbsatz-Etikett | `ExecutionsView.tsx:46` | `telemetry: 'von der CLI gemeldet'` zwischen drei Einzelwörtern. |
| Zu kleine Grössen | `ExecutionsView.tsx` (12×), `charts.tsx` (3×) | `text-[9px]`/`[10px]`/`[11px]` unter `text-xs`; Legendenpunkte `h-1.5 w-1.5` (6 px) und `h-2 w-2` (8 px), `StackedBar height={8}` — gegen Icons in Verwendung (`h-5`/`h-6`, 24er-Grid) verloren. |
| Nicht invertierte Skalen | `ExecutionsView.tsx` (teal 6×, violet 2×), `charts.tsx`/`ExecutionsView.tsx` (Hex-Paletten), `ProjectSettings.tsx`, `KanbanBoard.tsx`, `FeatureConsole.tsx` | teal/violet/purple folgen dem Hellmodus heute nicht. |

Mengengerüst der mechanischen Anteile (`text-zinc-600` / `text-zinc-500` / Sondergrössen / Hex):

| Datei | z-600 | z-500 | Sondergrösse | Hex |
|---|---|---|---|---|
| `ReviewPortal.tsx` | 7 | 5 | 2 | 1 |
| `review/DiffViewer.tsx` | 5 | 1 | 1 | 1 |
| `review/AuditSidebar.tsx` | 2 | 3 | 11 | 3 |
| `review/CommentsPanel.tsx` | 3 | 3 | 5 | 0 |
| `review/FileEditor.tsx` | 1 | 0 | 1 | 1 |
| `review/TestsPane.tsx` | 3 | 3 | 2 | 1 |
| `ExecutionsView.tsx` | 8 | 16 | 12 | 9 |
| `charts.tsx` | 2 | 0 | 3 | 1 |
| `FeatureDashboard.tsx` | 2 | 6 | 3 | 1 |

---

## D1 — Änderungsübersicht als reines Modul in `@sdd/shared`

**Entscheidung**: Kürzung, Sortierung und Gruppierung entstehen in
`packages/shared/src/changeOverview.ts` (pure Funktion `buildChangeOverview`, Tests daneben),
die Web-Komponente `review/ChangeOverview.tsx` rendert nur.

**Begründung**: Die Regeln der Klärung (höchstens 10 Dateien, Restzeile, drei jüngste Commits,
Gruppierung, Sonderfall 0 Dateien) sind genau die Art Logik, die im Haus schon in `shared`
liegt und dort getestet wird (`diffParse.ts`, `runSummary.ts`, `lifecycleCatalog.ts`). Das
Web-Paket hat **keinen** Test-Runner (`test` = No-op), Logik in der Komponente wäre unprüfbar.

**Alternativen**: (a) alles in der Komponente — nicht testbar, verletzt das Hausmuster;
(b) neuer Server-Endpunkt, der die Übersicht liefert — verletzt FR-006/SC-009 (zusätzlicher
Ladevorgang) und erfindet einen Datenbestand, den die Spec ausdrücklich ausschliesst.

## D2 — Grenzen und Gruppenschlüssel der Übersicht

**Entscheidung**: `MAX_OVERVIEW_FILES = 10`, `MAX_OVERVIEW_COMMITS = 3`. Sortierung der Dateien
nach Änderungsumfang (`additions + deletions`) absteigend, bei Gleichstand Pfad aufsteigend
(deterministisch). Gruppenschlüssel = **erste zwei Pfadsegmente**, wenn der Pfad ≥ 3 Segmente
hat, sonst das erste Segment, bei Dateien in der Wurzel `(Wurzel)`.

**Begründung**: In diesem Monorepo ergibt die Regel genau die gewünschte Einheit —
`packages/web/src/components/X.tsx` → `packages/web`, `specs/foo/spec.md` → `specs/foo`,
`docs/x.md` → `docs`, `README.md` → `(Wurzel)`. Sie braucht keine Konfiguration und keine
Kenntnis der Workspace-Definition. Massstab der Klärung: 14–90 berührte Dateien an einem Tag;
bei 90 ist die ungekürzte Liste als Überblick wertlos, bei 14 ist die Kürzung folgenlos.

**Alternativen**: `pnpm-workspace.yaml` auslesen (Kopplung, Server-Wissen im Frontend);
gemeinsames Präfix je Gruppe dynamisch bestimmen (instabil, springt bei jeder neuen Datei);
gar nicht gruppieren (verletzt die Klärung).

## D3 — Rückkehr zur Übersicht

**Entscheidung**: Erster Eintrag der Dateiliste im Reiter „Dateien" ist ein Schalter
**„Übersicht"**, aktiv markiert, wenn keine Datei gewählt ist; Klick setzt
`selectedFile = null`. Zusätzlich sind die Dateizeilen **in** der Übersicht klickbar und wählen
die Datei aus.

**Begründung**: Deckt die Annahme der Spec („sichtbares Bedienelement in der linken
Dateiliste") mit dem kleinsten Eingriff, ohne die Tab-Struktur zu berühren (ausdrücklich nicht
Gegenstand). Die klickbaren Zeilen machen den Weg Übersicht → Diff kurz, ohne einen zweiten
Bedienpfad zu erfinden.

**Alternativen**: zusätzlicher Reiter „Übersicht" (verletzt „Tab-Struktur bleibt unverändert");
Escape-Taste als einziger Rückweg (unsichtbar, verletzt „sichtbares Bedienelement").

## D4 — Kein eigener Ladezustand für die Übersicht

**Entscheidung**: Solange `summary === null` ist (der ohnehin laufende Erst-Ladevorgang des
Portals), steht in der Mitte „Lade Änderungen …". Sobald `summary` da ist, erscheint die
Übersicht **ohne** weiteren Ladeschritt.

**Begründung**: SC-009 verbietet einen *zusätzlichen* Ladevorgang und einen *eigenen*
Lade-Zwischenzustand der Übersicht — nicht die Aussage während des Erst-Ladens des Portals.
Zugleich verlangt SC-002, dass keine Fläche ohne Aussage bleibt; ein stiller leerer Kasten
während des Ladens wäre genau die beklagte leere Fläche. Beides zusammen ergibt: eine Aussage,
die an den bestehenden Ladevorgang gebunden ist.

## D5 — Diff-, Editor- und Log-Flächen: `bg-[#0a0a0c]` → `bg-zinc-950`

**Entscheidung**: Alle sechs festen Flächen werden `bg-zinc-950`.

**Begründung**: `#0a0a0c` ist praktisch `zinc-950` (`#09090b`); die Skala liefert im Hellmodus
`#fafafa`. Damit invertiert die Fläche mit — und weil Vorder- **und** Hintergrund derselben
invertierten Mechanik folgen, bleibt der Kontrast in beiden Modi nahezu gleich (Messung unten).
Der Rahmen bleibt: die Fläche liegt eine Stufe „tiefer" als die Portalfläche `zinc-925`, im
Hellmodus entsprechend eine Stufe heller — die gewollte Absetzung bleibt in beiden Modi.

**Alternativen**: eigene Variable `--color-code-surface` je Modus (zweite Mechanik neben der
Inversion, mehr Begriffe ohne Gewinn); `bg-zinc-925` (Fläche und Portal wären gleichfarbig,
die Absetzung des Codes ginge verloren).

## D6 — Stufenregel aus gemessenen Kontrasten

Berechnet nach WCAG 2.1 (relative Luminanz, Alpha vorher komponiert) über die Werte aus
`packages/web/src/index.css` und das dortige Inversionsschema (50↔950, 100↔900, 200↔800,
300↔700, 400↔600, 500 unverändert; `zinc-925` mit eigenem Hellwert `#f7f7f8`).

**Heute (Fläche fest, invertiert nicht):**

| Paar | dark | light | Soll |
|---|---|---|---|
| Code `text-zinc-400` auf `#0a0a0c` | 7.72 | **2.56 ✗** | 4.5 |
| Zeilennummer `text-zinc-600` auf `#0a0a0c` | **2.56 ✗** | 7.72 | 3 |

Beide Richtungen fallen durch — im Dunkelmodus die Zeilennummern, im Hellmodus der Code selbst.
Das ist der gemeldete Befund („schlecht lesbar" / „schwarze Fläche im Hellmodus") in Zahlen.

**Nach D5 (Fläche `bg-zinc-950`):**

| Paar | dark | light | Soll |
|---|---|---|---|
| Code `text-zinc-400` | 7.76 | 7.41 | 4.5 ✓ |
| Zeilennummer `text-zinc-500` | 4.12 | 4.63 | 3 ✓ |
| Zeilennummer `text-zinc-600` | **2.57 ✗** | **2.46 ✗** | 3 |
| Hunk-Kopf `text-sky-400` auf `bg-zinc-900` | 8.27 | 3.73 | 3 ✓ |
| add: `text-emerald-300` auf `bg-emerald-950/60` | 11.42 | 5.23 | 4.5 ✓ |
| del: `text-red-300` auf `bg-red-950/50` | 9.75 | 6.05 | 4.5 ✓ |

**Text auf der Kartenfläche `zinc-925` (Läufe-Ansicht, Portal-Kopf):**

| Farbe | dark | light | 4.5 |
|---|---|---|---|
| `zinc-600` | 2.49 | 2.39 | ✗✗ |
| `zinc-500` | 3.99 | 4.51 | ✗ (dark) |
| `zinc-400` | 7.52 | 7.22 | ✓ |
| `emerald-400` | 10.03 | 3.52 | ✗ (light) |
| `emerald-300` | 12.64 | 5.12 | ✓ |
| `sky-400` | 9.00 | 3.83 | ✗ (light) |
| `sky-300` | 11.56 | 5.54 | ✓ |
| `teal-400` | 10.35 | 3.50 | ✗ (light) |
| `teal-300` | 13.03 | 5.11 | ✓ |
| `violet-300` | 10.44 | 6.64 | ✓ |
| `amber-300` | 13.37 | 4.69 | ✓ |
| `red-400` | 6.97 | 4.51 | ✓ (knapp) |

**Grafikflächen (≥ 3:1) gegen Karte `zinc-925` bzw. Spur `zinc-900`:**

| Fläche | auf `zinc-925` | auf `zinc-900` | 3.0 |
|---|---|---|---|
| `sky-400` | 9.00 / 3.83 | 8.27 / 3.73 | ✓ |
| `emerald-400` | 10.03 / 3.52 | 9.22 / 3.43 | ✓ |
| `violet-400` | 7.08 / 5.32 | 6.51 / 5.18 | ✓ |
| `amber-400` | 11.55 / **2.98** | 10.61 / **2.90** | ✗ (light) |
| `amber-300` | 13.37 / 4.69 | 12.29 / 4.57 | ✓ |
| `zinc-600` | 2.49 / 2.39 | 2.29 / 2.33 | ✗✗ |
| `zinc-500` | 3.99 / 4.51 | 3.67 / 4.40 | ✓ |
| Ring `emerald-500` | 7.60 / **2.37** | — | ✗ (light) |
| Ring `amber-500` | 8.97 / **2.01** | — | ✗ (light) |

**Entscheidung — Stufenregel für beide Modi** (gilt für die Flächen dieses Features):

1. **Text**: zinc nicht dunkler/heller als **Stufe 400**; Akzentfarben auf **Stufe 300**
   (`emerald-300`, `sky-300`, `teal-300`, `violet-300`, `amber-300`). `zinc-500`/`zinc-600`
   sind für Text verboten, 400er-Akzente auf der Kartenfläche ebenfalls.
2. **Nur-3:1-Elemente** (Zeilennummern, Abschnittsköpfe): `zinc-500` genügt, `zinc-600` nicht.
3. **Grafikflächen**: Akzent **Stufe 400**, Ausnahme **amber → 300**; graue Flächen
   **zinc-500**, nicht `zinc-600`.
4. **Abzeichen** (Text auf 800/900/950-Fläche derselben Skala): Textstufe **200 oder 300** —
   `teal-200` auf `teal-900` misst 7.52/6.73, `emerald-300` auf `emerald-950` 9.94/5.21.

**Begründung / Muster dahinter**: Sind Vordergrund und Hintergrund beide invertierte Stufen,
ist das Verhältnis in beiden Modi fast identisch — die Inversion tauscht beide Endpunkte. Es
fallen genau drei Klassen durch: (a) eine Seite ist ein fester Hex (D5), (b) das Paar liegt
symmetrisch um Stufe 500 (`zinc-600` auf `zinc-925` — in **beiden** Modi zu nah), (c) das Paar
ist unsymmetrisch nah (400er-Akzent gegen die fast weisse Hellmodus-Fläche). Die Regel folgt
damit dem Randfall der Spec: „Stufe innerhalb derselben Skala anpassen, nicht die Skala
wechseln."

**Nebenwirkung, bewusst in Kauf genommen**: Die Textstufen 500/600 fallen als
Hierarchie-Ebene weg; die Abstufung läuft künftig über 200/300 (primär) gegen 400 (sekundär).
Das ist flacher als heute, aber lesbar — und lesbar ist die Anforderung.

## D7 — Hellmodus-Mechanik um teal und violet erweitern

**Entscheidung**: In `index.css` unter `:root[data-theme='light']` je 11 Stufen für **teal**
und **violet** nach demselben Inversionsschema ergänzen (Hex-Stil wie die bestehenden Blöcke):

```text
teal   50 #042f2e · 100 #134e4a · 200 #115e59 · 300 #0f766e · 400 #0d9488 · 500 #14b8a6
      600 #2dd4bf · 700 #5eead4 · 800 #99f6e4 · 900 #ccfbf1 · 950 #f0fdfa
violet 50 #2e1065 · 100 #4c1d95 · 200 #5b21b6 · 300 #6d28d9 · 400 #7c3aed · 500 #8b5cf6
      600 #a78bfa · 700 #c4b5fd · 800 #ddd6fe · 900 #ede9fe · 950 #f5f3ff
```

**Begründung**: Genau die zwei Skalen, die im UI schon Bedeutung tragen (Herkunft „gemeldet" =
teal, Subagenten = violet). Die Mechanik selbst bleibt unangetastet, es kommen nur zwei Blöcke
in derselben Form hinzu. Danach misst das teal-Abzeichen in beiden Modi ≥ 6.7:1 — FR-019 ist
allein durch die Inversion erfüllt, es braucht **kein** Ersatzmittel (Rahmen, Schriftgewicht).

**Alternativen**: Herkunft auf eine schon invertierte Skala umstellen (nimmt eine Bedeutung von
emerald/sky/amber weg oder verwechselt sich mit ihr — die Spec verlangt ausdrücklich, dass
jede heutige Unterscheidung farblich erhalten bleibt); alle Skalen aufnehmen (YAGNI, die Spec
schliesst Skalen ohne Verwendungszweck aus).

## D8 — `purple` fällt weg: Kategorie „Chat" wird violet

**Entscheidung**: `CATEGORY_COLORS.chat` `#c084fc` (purple-400) → **violet-400**.

**Begründung**: FR-025 zählt die zulässigen Skalen auf (zinc, emerald, amber, red, sky, teal,
violet) — purple ist nicht dabei, und eine achte Skala aufzunehmen widerspricht D7. violet-400
liegt optisch neben purple-400 (beides Violett), die Kategorie bleibt also erkennbar; sie
misst als Fläche 7.08/5.32 gegen die Karte. Die zweite violette Bedeutung (Subagenten-Zahl,
`violet-300`, Text) kollidiert nicht: verschiedene Rolle (Zahl vs. Diagrammfläche) und
verschiedene Stufe.

## D9 — Diagrammfarben über Tailwind-Klassen, nicht über Hex oder `var()`

**Entscheidung**: `Segment.color: string` (Hex) entfällt. Ein Segment trägt statt dessen einen
**Ton** mit zwei vollständig ausgeschriebenen Klassennamen:

```ts
export interface ChartTone { bg: `bg-${string}`; stroke: `stroke-${string}` }
```

Palette als eine Konstante mit **literalen** Klassennamen (`'bg-sky-400'`,
`'stroke-sky-400'`, …). `StackedBar`/`HBarChart` setzen `className={tone.bg}`, `Donut` setzt
`className={tone.stroke}` am `<circle>`; `ProgressRing` ebenso.

**Begründung**: Zwei Wege wären denkbar gewesen, beide haben einen Haken. (a) Inline-Style mit
`var(--color-sky-400)`: Tailwind v4 gibt **unbenutzte** Theme-Variablen nicht aus, und ein
`var(…)` in einer `.tsx`-Zeichenkette ist für den Klassen-Scanner keine Verwendung — für
Stufen, die sonst nirgends als Utility auftauchen (`violet-400`), wäre die Variable im Build
womöglich nicht definiert, und der Hellmodus-Override griffe ins Leere. (b) Dynamisch gebaute
Klassennamen (`bg-${scale}-400`) findet der Scanner ebenfalls nicht. Vollständig
ausgeschriebene Klassennamen in einer Konstante findet er dagegen zuverlässig — das ist die
dokumentierte Regel von Tailwind und im Repo schon Praxis (`CATEGORY_LABELS` & Co.).
Nebengewinn: der Moduswechsel greift ohne jede JS-Beteiligung (FR-026), weil die Klasse auf
`var(--color-…)` kompiliert wird, die der `[data-theme='light']`-Block überschreibt.

**Nicht empirisch geprüft**: dass Tailwind v4 die Variablen wirklich weglässt. Der Worktree hat
kein `node_modules` (kein Build möglich), und die Entscheidung ist so gewählt, dass sie in
**beiden** Fällen trägt. Die Prüfung erfolgt implizit in Stufe 1 des Quickstarts (Build) und
sichtbar in Stufe 3 (Hellmodus im Browser).

## D10 — Grössen: Untergrenze `text-xs`, Kennzahlen `text-sm`, Marker ≥ 10 px

**Entscheidung**:

- „Kleine Standardschriftgrösse der Anwendung" = **`text-xs` (12 px)**. Alle
  `text-[9px]`/`text-[10px]`/`text-[11px]` der Läufe-Ansicht und von `charts.tsx` fallen weg.
- „Kennzahlen eines Laufs" = die Aggregatzahlen der Lauf-Karte (Output, Cache-Read, Betrag,
  Subagenten) → **`text-sm` (14 px)**; die Wertespalte wächst von `w-28` auf `w-36`.
- Marker: Legendenpunkte `h-1.5 w-1.5`/`h-2 w-2` → **`h-2.5 w-2.5` (10 px)**;
  `StackedBar` in der Lauf-Karte ohne `height`-Override (Standard **10**);
  `HBarChart`-Balken bleiben `h-4` (16 px).
- Der Zahlenwert im Balken (`HBarChart`) wandert **aus** dem Balken in eine eigene rechte
  Spalte (`w-14 text-right text-xs`).

**Begründung**: `text-xs` ist die Grösse, mit der das übrige UI arbeitet (Portal-Kopf, Reiter,
Dateiliste); 10 px sind die Hälfte der real verwendeten Icon-Höhe (`h-5` = 20 px, Iconset auf
24er-Grid) und damit ein stimmiges Verhältnis. Das Balkenlabel muss nach draussen, weil es
sonst zwei Anforderungen gleichzeitig verletzt: `text-zinc-950` auf einem 400er-Balken misst im
Hellmodus nur 3.05–3.92:1 (Soll 4.5), und bei kurzen Balken (`Math.max(1.5, …)%`) wird es heute
schon abgeschnitten. Draussen auf der Karte erreicht dieselbe Zahl mit `text-zinc-300`
9.75/13.04.

**Alternativen**: Balkenlabel behalten und Balkenstufe verdunkeln (verschiebt das Problem in
die 3:1-Prüfung der Fläche); Untergrenze auf 11 px (keine Grösse des Hauses, willkürlich).

## D11 — Neunspaltige Tabelle: waagerecht scrollen, nicht umbrechen

**Entscheidung**: Die Tabelle „Einzelne Ausführungen" bekommt einen eigenen
`overflow-x-auto`-Container, die Tabelle eine `min-w`-Untergrenze, Zahlen- und Zeitzellen
`whitespace-nowrap`.

**Begründung**: FR-022 verlangt erreichbare Spalten **und** unverkürzte Werte. Umbruch in
Zellen erfüllt das zweite, zerstört aber die Zeilenlesbarkeit einer Zahlentabelle; Kürzen
verletzt FR-022 direkt. Ein Scroll-Container im Panel hält die Seite selbst frei von
waagerechtem Scrollen (Randbedingung aus den Edge Cases).

## D12 — Drei Zustände der rechten Spalte

**Entscheidung**: `AuditSidebar` erhält einen zusätzlichen Prop `error: string | null`.
`ReviewPortal` merkt den Fehler des `agentRuns`-Abrufs lokal (`setRunsError`) — zusätzlich zur
bestehenden globalen Fehlermeldung. Darstellung: `error` → „Audits konnten nicht geladen
werden." samt Grund; `runs === null` → „Lade Audits …"; `runs.length === 0` → benannter
Zustand **plus** Bedeutung für die Entscheidung („Kein Agent hat dieses Feature geprüft — dein
Urteil ist das einzige Gate.").

**Begründung**: Ohne Fehlerzustand bleibt die Spalte nach einem gescheiterten Abruf für immer
auf „Lade Audits …" (Befund oben) — genau die von FR-009 verbotene Endlosschleife. Der Prop
statt eines eigenen Fetches in der Komponente hält den Datenfluss, wie er ist (das Portal lädt,
die Spalte stellt dar).

**Alternativen**: Laden in die Spalte verlagern (zweiter Abrufpfad neben dem des Portals,
verdoppelt Zustand); nur eine globale Fehlermeldung (die Spalte bliebe leer bzw. im
Ladezustand — der Befund wäre nicht behoben).

## D13 — „gemeldet" mit vollständiger Aussage im Tooltip

**Entscheidung**: `SOURCE_LABELS.telemetry` = **`'gemeldet'`**. Die lange Form wandert in das
`title`-Attribut des Abzeichens („Von der Claude-CLI gemeldet — nicht vom Toolkit erschlossen").
Farbmittel (teal, kräftiger als `transcript`) und Vorrangregel (`dominantSource`) bleiben
unverändert.

**Begründung**: FR-017 will das einzelne Wort, FR-018 verbietet jede Abschwächung der Aussage.
Das Wort trägt die Ebene („gemeldet/gemessen/geparst/geschätzt"), der Tooltip trägt die
Herkunft im Wortlaut, die Farbe trägt die Unterscheidung — die Messfehler-Sichtbarkeit von
Faktor 10 hängt an der Farbe und der Vorrangregel, nicht an der Länge des Etiketts.

**Alternativen**: „CLI-gemeldet" (kein einzelnes Wort, Bindestrich-Kompositum fällt aus der
Reihe); „telemetrie" (Fachbegriff statt Aussage).

## D14 — Umfang der Flächen-Korrekturen

**Entscheidung**: Angefasst werden die Flächen der beiden Ansichten dieses Features und die in
FR-016/FR-025a namentlich genannten: Datei-Diff, Roh-Diff der Konfliktauflösung, Datei-Editor,
Test-Ausgabe, Log-Ansicht der Läufe — und, weil sie dieselbe Log-Fläche im selben Muster führt
und über `RunCard` die Diagramm-Änderungen ohnehin erbt, die Log-Fläche in `FeatureDashboard`.

**Ausserhalb**: die `bg-[#09090b]`-Rahmen der Terminal-Flächen (`FeatureConsole`,
`ShellConsole`, `GridView`, `FeatureResultDialog`) und die Projektfarben-Palette
(`ProjectSettings.tsx:16`, freie Nutzerwahl). Erste folgen dem xterm-Hintergrund, der seine
eigene Palette je Modus hat (Feature `light-model-claude-chat-farben`, Contract C5); sie
gehören zu anderen Ansichten und werden hier **nicht** mitgeändert. SC-006 nennt ausdrücklich
Review-Portal und Läufe-Ansicht.

**Ebenfalls bewusst belassen**: `bg-black/70` als Abdunkelung hinter dem Portal-Dialog. Das ist
keine Skala, sondern der übliche Modal-Schleier, der in hellen Oberflächen genauso dunkel ist;
FR-025a richtet sich gegen feste Hex-Werte und nicht invertierende Skalen.

## D15 — Browser-Prüfung und Belege

**Entscheidung**: Prüfung über die Chrome-Anbindung auf einer **eigenen** Toolkit-Instanz mit
freien Ports (nicht 4820/4830). Belege als Screenshots unter
`specs/review-portal-und-laeufe-sicht-pass/evidence/` mit sprechenden Namen
(`portal-uebersicht-dark.png`, `portal-diff-light.png`, `laeufe-light.png`,
`diff-graustufen.png` …). Der Nachweis „ohne Farbwahrnehmung unterscheidbar" (SC-005) entsteht
durch `filter: grayscale(1)` auf `documentElement` vor dem Screenshot. Kontrast- und
Schriftgrössen-Belege entstehen als abgelesene Messwerte
(`getComputedStyle`) neben den Screenshots in `evidence/messwerte.md`.

**Begründung**: FR-027/SC-010 verlangen belegte Prüfung; die Erhebung vom 30.07.2026 fiel aus,
weil mehrere Agents dieselbe Anbindung belegten — die Prüfung ist deshalb Teil dieses Features
und nicht der Erhebung. Eigene Ports sind Projektregel (CLAUDE.md): die laufende
Toolkit-Instanz ist Elternprozess der Session.

---

## Offene Punkte

Keine. Alle Entscheidungen sind ohne weitere Rückfrage umsetzbar; die einzige nicht empirisch
verifizierte Annahme (Tailwind-Variablen-Ausgabe, D9) ist so umgangen, dass beide Fälle
funktionieren, und wird im Quickstart-Build sichtbar.
