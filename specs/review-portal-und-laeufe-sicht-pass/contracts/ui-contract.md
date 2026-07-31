# UI-Verträge: Review-Portal und Läufe-Ansicht — Lesbarkeits-Pass

**Feature**: `review-portal-und-laeufe-sicht-pass` · **Datum**: 2026-07-30
**Modul-Vertrag**: [change-overview.md](./change-overview.md) ·
**Datenmodell**: [../data-model.md](../data-model.md) · **Entscheidungen**: [../research.md](../research.md)

Das Feature exponiert **keine** HTTP- oder WS-Schnittstelle und ändert kein Datenschema. Die
Verträge betreffen `packages/web` (plus das reine Modul in `packages/shared`).

---

## C1 — Farb- und Kontrastvertrag (gilt für alle folgenden Verträge)

**Zulässige Skalen**: `zinc`, `emerald`, `amber`, `red`, `sky`, `teal`, `violet`. Jede muss in
`index.css` unter `:root[data-theme='light']` invertiert sein. **Verboten**: jede andere Skala
(insbesondere `indigo`, `purple`) und jeder feste Farbwert (`bg-[#…]`, Hex in TS/TSX,
`stroke="#…"`).

**Stufenregel** (aus den Messwerten in [research.md](../research.md) D6):

| Rolle | Soll | zulässige Stufen |
|---|---|---|
| Text (Fliesstext, Etiketten, Zahlen) | 4.5:1 | zinc **≤ 400**; Akzent **300** (oder 200) |
| Zeilennummern, Abschnittsköpfe | 3:1 | zinc **≤ 500**; Akzent **≤ 400** |
| Grafikfläche (Balken, Punkt, Ring, Segment) | 3:1 | Akzent **400**, `amber` **300**; grau **zinc-500** |
| Text auf Abzeichen-Fläche (800/900/950 derselben Skala) | 4.5:1 | Stufe **200** oder **300** |

**Verboten für Text**: `text-zinc-500`, `text-zinc-600` (3.99 / 2.49 im Dunkelmodus) sowie
400er-Akzente auf der Kartenfläche (`text-emerald-400` → 3.52 im Hellmodus).
**Verboten als Fläche**: `zinc-600` (2.3–2.5 in beiden Modi), `amber-400` (2.90–2.98 im
Hellmodus), `emerald-500`/`amber-500` als Ring (2.37 / 2.01 im Hellmodus).

**Ausnahme, ausdrücklich erlaubt**: `bg-black/70` als Abdunkelung hinter dem Portal-Dialog
(`ReviewPortal.tsx:150`) — keine Skala, sondern Modal-Schleier (D14).

**Vertragsregel**: Ein Moduswechsel wirkt **ohne Neuladen und ohne JS-Beteiligung**, weil jede
Farbe als Tailwind-Utility auf `var(--color-…)` kompiliert und vom `[data-theme='light']`-Block
überschrieben wird (FR-026).

## C2 — Theme-Variablen: teal und violet ergänzen (`index.css`)

Der Block `:root[data-theme='light']` erhält zwei weitere Skalen im **gleichen Stil** wie
`emerald`/`amber`/`red`/`sky` (11 Stufen, Inversion 50↔950 … 400↔600, 500 unverändert):

```css
  /* Akzent: teal — trägt „gemeldet" (Herkunft) und gemeldete Beträge */
  --color-teal-50:  #042f2e;  --color-teal-100: #134e4a;  --color-teal-200: #115e59;
  --color-teal-300: #0f766e;  --color-teal-400: #0d9488;  --color-teal-500: #14b8a6;
  --color-teal-600: #2dd4bf;  --color-teal-700: #5eead4;  --color-teal-800: #99f6e4;
  --color-teal-900: #ccfbf1;  --color-teal-950: #f0fdfa;

  /* Akzent: violet — trägt Subagenten-Anteil und die Kategorie „Chat" */
  --color-violet-50:  #2e1065;  --color-violet-100: #4c1d95;  --color-violet-200: #5b21b6;
  --color-violet-300: #6d28d9;  --color-violet-400: #7c3aed;  --color-violet-500: #8b5cf6;
  --color-violet-600: #a78bfa;  --color-violet-700: #c4b5fd;  --color-violet-800: #ddd6fe;
  --color-violet-900: #ede9fe;  --color-violet-950: #f5f3ff;
```

**Vertragsregeln**

- Die Mechanik selbst (Position der Overrides ausserhalb jedes `@layer`, Selektor,
  `color-scheme`) bleibt **unverändert** — es kommen nur zwei Blöcke hinzu.
- Keine weitere Skala wird aufgenommen; `--color-zinc-925` bleibt der einzige Sonderwert.
- Nach der Ergänzung gilt: `teal-200` auf `teal-900` misst 7.52 (dark) / 6.73 (light) — FR-019
  ist ohne Ersatzmittel erfüllt.

## C3 — Änderungsübersicht in der Mitte (`review/ChangeOverview.tsx`, neu)

```tsx
export function ChangeOverview({
  overview,          // ChangeOverview aus buildChangeOverview()
  targetBranch,      // für den Satz „Keine Änderungen gegenüber …"
  onSelectFile,      // Klick auf eine Dateizeile wählt die Datei
}: {
  overview: ChangeOverview;
  targetBranch: string;
  onSelectFile: (path: string) => void;
}): JSX.Element;
```

**Aufbau (in dieser Reihenfolge)**

1. **Kopfzeile** — drei Kennzahlen: geänderte Dateien, `+A −D`, Commits. Zahlen `text-sm`,
   Etiketten `text-xs text-zinc-400`.
2. **Dateien** — je Gruppe eine Überschrift (Gruppenschlüssel, `font-mono text-xs
   text-zinc-400`), darunter die Dateien als Schalter: Pfad **relativ zur Gruppe**, rechts
   `+A` (`text-emerald-300`) / `−D` (`text-red-300`) oder **„binär"** (`text-zinc-400`).
3. **Restzeile** — bei `hiddenFiles > 0`: „+N weitere Dateien — vollständige Liste links."
4. **Commits** — „M Commits", darunter die bis zu drei jüngsten Betreffzeilen mit Zeitpunkt;
   Hinweis auf den Reiter „Historie". Bei `hasCommits === false` statt der Liste der Satz, dass
   noch keine Commits vorliegen und die Arbeit ungetrackt im Worktree liegt.

**Vertragsregeln**

- **Überblick, kein Diff**: Die Komponente rendert **nur** `overview` — sie kürzt, sortiert und
  gruppiert nicht selbst (das tut `buildChangeOverview`) und lädt nichts nachträglich.
- `hasChanges === false` ⇒ ausschliesslich der Satz „Keine Änderungen gegenüber
  `<targetBranch>`." — keine Kennzahlen mit Nullwerten (FR-005, US1-AS4).
- Kein waagerechtes Scrollen der Seite: lange Pfade werden **innerhalb** ihrer Zeile gekürzt
  (`truncate`, vollständiger Pfad im `title`).
- Keine eigene Höhenbegrenzung: die Fläche scrollt bereits (`overflow-auto` des Elternteils).

**Akzeptanz-Bezug**: US1-AS1/2/4/5/6, FR-001–FR-003, FR-005, SC-001.

## C4 — Reiter „Dateien" im Portal (`ReviewPortal.tsx`)

- Die Mitte zeigt bei `selectedFile === null` die **Änderungsübersicht** statt „Datei links
  auswählen."; bei `summary === null` „Lade Änderungen …" (D4).
- Die Dateiliste links erhält als **ersten Eintrag** den Schalter **„Übersicht"** — aktiv
  markiert, wenn keine Datei gewählt ist; Klick setzt `selectedFile = null` (FR-004).
- Der Aufruf `buildChangeOverview(summary)` läuft in `useMemo` über `summary` — kein
  zusätzlicher Abruf, kein zusätzlicher Zustand (FR-006, SC-009).
- Der Kopf (`HeaderStat`) und die Liste erfüllen C1 (u. a. `text-zinc-600` → `text-zinc-400`,
  `text-emerald-500`/`text-red-500` → `-300`).

**Akzeptanz-Bezug**: US1-AS1–AS3, FR-001, FR-004, FR-006, SC-009.

## C5 — Diff-, Editor- und Log-Flächen

| Datei | Stelle | Änderung |
|---|---|---|
| `review/DiffViewer.tsx` | `:52` | `bg-[#0a0a0c]` → `bg-zinc-950` |
| `ReviewPortal.tsx` (`DiffView`) | `:460` | dito (Roh-Diff der Konfliktauflösung, FR-016) |
| `review/FileEditor.tsx` | `:114` | dito |
| `review/TestsPane.tsx` | `:77` | dito |
| `ExecutionsView.tsx` | `:233` | dito (Log-Ansicht, FR-016) |
| `FeatureDashboard.tsx` | `:126` | dito (dieselbe Log-Fläche, D14) |

**Weitere Regeln für den Diff**

- Zeilennummern: `text-zinc-600` → `text-zinc-500` (2.57 → 4.12 dark / 4.63 light, Soll 3).
- Abschnittskopf (`@@`): bleibt `text-sky-400` auf `bg-zinc-900/70` (8.27 / 3.73 ≥ 3).
- add/del behalten `emerald-300` / `red-300` auf `emerald-950/60` / `red-950/50` — nach C5
  messbar 11.42/5.23 bzw. 9.75/6.05.
- **Ohne Farbwahrnehmung unterscheidbar** (FR-014): das führende `+`/`-`/Leerzeichen bleibt Teil
  des Zeilentexts (`DiffViewer.tsx:148`) — vorhanden, darf nicht entfallen.
- **Markierung** (FR-015): `ring-1 ring-sky-500` bleibt (Stufe 500, in beiden Modi mittig) und
  ändert die Textfarbe nicht; erledigte Kommentare `text-zinc-500` → `text-zinc-400`.
- Platzhalter- und Hinweistexte („Lade Diff …", „Kein Diff für diese Datei.", „Binärdatei —
  kein Text-Diff.") `text-zinc-600` → `text-zinc-400`.

**Akzeptanz-Bezug**: US2-AS1–AS6, FR-012–FR-016, SC-004, SC-005.

## C6 — Rechte Spalte (`review/AuditSidebar.tsx`, `ReviewPortal.tsx`)

```tsx
export function AuditSidebar({
  featureId,
  runs,                       // AgentRunSummary[] | null
  error,                      // string | null  (neu)
}: { featureId: string; runs: AgentRunSummary[] | null; error: string | null }): JSX.Element;
```

**Zustände in dieser Prüfreihenfolge**

1. `error` ⇒ „Audits konnten nicht geladen werden." + Grund (`text-amber-300`); **kein**
   Ladezustand mehr (FR-009).
2. `runs === null` ⇒ „Lade Audits …".
3. `runs.length === 0` ⇒ Aussage **plus Bedeutung**: dass kein Agent geprüft hat und damit das
   eigene Urteil das einzige Gate ist (FR-008).
4. sonst wie heute (Gruppen nach Auslöser, `VerdictPill`, Bericht-Dialog).

**Vertragsregeln**

- `ReviewPortal` hält den Fehler lokal (`runsError`) und übergibt ihn; der bestehende globale
  Fehlerkanal (`dispatch({type:'error'})`) bleibt unverändert.
- `verdict === null` bleibt „unklar" und zählt nie in `passed` (FR-011).
- **Schriftgrössen der Spalte bleiben unverändert** (Klärung 2026-07-30) — hier ändern sich nur
  Farben nach C1: `text-zinc-600`/`-500` → `text-zinc-400`, `text-amber-300` bleibt,
  `VerdictPill` auf `emerald-300`/`red-300`.
- `ProgressRing`: `stroke="#27272a"` → `className="stroke-zinc-800"`,
  `#10b981`/`#f59e0b` → `stroke-emerald-400` / `stroke-amber-300`.
- Der Kommentarbereich behält seine Leer-Aussage (FR-010) und erhält nur die Farbkorrekturen.

**Akzeptanz-Bezug**: US3-AS1–AS6, FR-007–FR-011, SC-002, SC-003.

## C7 — Diagramm-Bausteine (`charts.tsx`)

```ts
/** Fläche + Ring einer Bedeutung, als vollständig ausgeschriebene Tailwind-Klassen. */
export interface ChartTone { bg: string; stroke: string }

export interface Segment { label: string; value: number; tone: ChartTone }   // color: string entfällt

export const CHART_TONES: {
  spec: ChartTone; coding: ChartTone; overhead: ChartTone; chat: ChartTone;
  input: ChartTone; output: ChartTone; cacheRead: ChartTone; cacheWrite: ChartTone;
  track: ChartTone;
};
```

**Vertragsregeln**

| # | Regel | Bezug |
|---|---|---|
| T1 | Farbe **nur** über `ChartTone`; kein Hex, kein `style={{ backgroundColor }}`, kein `var(--color-…)` in TSX. | FR-025a, D9 |
| T2 | Klassennamen literal — kein `bg-${…}`. | D9, I15 |
| T3 | Untergrenze Schrift `text-xs`; `text-[10px]`/`text-[11px]` entfallen. | FR-020, FR-021a |
| T4 | Legendenpunkte `h-2.5 w-2.5` (10 px). | FR-021 |
| T5 | `StackedBar`: Standardhöhe **10**; Leerzustand `h-2.5`. Aufrufer **dürfen** keine Höhe < 10 übergeben. | FR-021 |
| T6 | `HBarChart`: Balken `h-4`; der Zahlenwert steht **rechts neben** dem Balken (`w-14 text-right text-xs text-zinc-300`), nicht darin. | D10, FR-020 |
| T7 | `Donut`: Spur `stroke-zinc-800`, Segmente `tone.stroke`; Legende `text-xs`. | C1 |
| T8 | Die Grössen gelten für **alle** Ansichten, die diese Bausteine nutzen (heute `ExecutionsView`, `FeatureDashboard` über `RunCard`) — Diagramme sehen überall gleich gross aus. | FR-021a |

## C8 — Läufe-Ansicht (`ExecutionsView.tsx`)

**Beschriftung**

- `SOURCE_LABELS.telemetry` = `'gemeldet'`; `SourceBadge` erhält
  `title="Von der Claude-CLI gemeldet — nicht vom Toolkit erschlossen"` (FR-017, FR-018, D13).
- `dominantSource`-Vorrangregel, `measured`/`reported`-Rechnung und alle Kommentare dazu bleiben
  **unverändert**.

**Grössen**

| Element | heute | neu |
|---|---|---|
| Kennzahlen der Lauf-Karte (Output, Cache-Read, Betrag, Subagenten) | `text-xs`/`text-[10px]` | **`text-sm`**, Spalte `w-28` → `w-36` |
| Zweitzeilen (Branch, Startzeit), Abzeichen, Legenden, Tabellentext | `text-[9px]`–`text-[11px]` | **`text-xs`** |
| Abschnittsüberschriften (`uppercase`) | `text-[11px]` | `text-xs` |
| `StackedBar` in der Karte | `height={8}` | Standard **10** (Override entfällt) |
| Legendenpunkt in `Composition` | `h-1.5 w-1.5` | `h-2.5 w-2.5` |

**Farben**

- `CATEGORY_COLORS` (Hex) → `CATEGORY_TONES` aus `CHART_TONES` (spec/coding/overhead/chat).
- `Composition`-Segmente → `input`/`output`/`cacheRead`/`cacheWrite`.
- `text-emerald-400` (Output) → `text-emerald-300`; `text-teal-300` bleibt;
  `text-violet-300` bleibt; `text-zinc-600`/`-500` (Text) → `text-zinc-400`.
- `StatusBadge`/`IntegrationBadge`: Textstufe 400 → **300** auf der 950-Fläche
  (`emerald-300` auf `emerald-950` = 9.94/5.21; `sky-400` auf `sky-950` scheitert im Hellmodus
  mit 3.84).

**Tabelle „Einzelne Ausführungen"** (FR-022, D11)

- Umschliessender `<div className="overflow-x-auto">`; `<table className="w-full min-w-[60rem] …">`.
- Zahlen-, Zeit- und Status-Zellen `whitespace-nowrap`; keine `truncate` auf Werten.
- Die Seite selbst scrollt **nicht** waagerecht.

**Unverändert (FR-024)**

- `—` statt `0` bei `subagentTokens === null` bzw. `costMicros === null`;
- keine Zeile ohne Anteil, keine Ersatzschätzung für Beträge;
- die bewusste Trennung Output ↔ Cache-Read und der erklärende Absatz darüber.

**Akzeptanz-Bezug**: US4-AS1–AS7, FR-017–FR-024, SC-006–SC-008.

## C9 — Nicht-Ziele

- Keine Änderung an Server, `@sdd/shared`-Typen (ausser dem **neuen** Modul), HTTP-/WS-Verträgen
  oder Datenbank.
- Keine neuen Prüf- oder Verifikationsläufe; keine Änderung der Freigabe-/Zurückweisungslogik
  (`actionPolicy`) und der Merge-Queue.
- Keine Änderung der Tab-Struktur des Portals und keine Umverteilung des Spaltenlayouts.
- Keine inhaltliche Änderung der Verbrauchsmessung (Ermittlung, Vorrang, Prozentrechnung).
- Terminal-Rahmen (`bg-[#09090b]` in `FeatureConsole`, `ShellConsole`, `GridView`,
  `FeatureResultDialog`) und die freie Projektfarben-Palette (`ProjectSettings.tsx:16`) bleiben
  unangetastet (D14).
