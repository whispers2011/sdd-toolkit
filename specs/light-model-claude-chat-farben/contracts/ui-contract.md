# UI & Module Contracts: Light-/Dark-Mode-Umschalter

**Feature**: `light-model-claude-chat-farben` · **Date**: 2026-07-23

Das Feature exponiert keine HTTP-/WS-Schnittstelle. Die Verträge betreffen das
Frontend `packages/web`: das Theme-Modul, den Umschalter (UI-Contract) und das
Terminal-Theme.

---

## C1 — Theme-Modul (`packages/web/src/theme.ts`)

Kapselt Lesen, Auflösen, Persistieren und Verteilen des Modus. Einzige Quelle
der Wahrheit für den aktiven Modus außerhalb von CSS.

```ts
export type ThemeMode = 'light' | 'dark';

/** Auflösung nach D5/Data-Model: explizit → System → Dark. Kein Seiteneffekt. */
export function resolveInitialTheme(): ThemeMode;

/** Aktuell angewendeter Modus (liest data-theme bzw. resolveInitialTheme). */
export function getTheme(): ThemeMode;

/** Setzt data-theme + color-scheme, persistiert sdd-theme, benachrichtigt Abonnenten. */
export function setTheme(mode: ThemeMode): void;

/** Wechselt light↔dark (explizite Wahl → source=explicit). */
export function toggleTheme(): ThemeMode;

/** Abonniert Moduswechsel (für Nicht-CSS-Konsumenten wie xterm). Gibt Unsubscribe zurück. */
export function onThemeChange(cb: (mode: ThemeMode) => void): () => void;
```

**Vertragsregeln**

- `setTheme` MUSS synchron `document.documentElement.dataset.theme` und
  `style.colorScheme` setzen, `localStorage['sdd-theme']` schreiben und **danach**
  Abonnenten aufrufen (Reihenfolge: DOM zuerst, dann Signal).
- Ungültiger/kaputter `sdd-theme`-Wert ⇒ Behandlung wie „abwesend" (Fallback),
  kein Throw.
- Abonnenten-Callbacks MÜSSEN idempotent aufrufbar sein (mehrfacher gleicher
  Modus ohne Schaden).

## C2 — FOUC-Guard (`index.html`, Inline-Skript im `<head>`)

Setzt `data-theme` **vor** dem ersten Paint; ersetzt das feste `class="dark"`.

- **Vorher**: `<html lang="de" class="dark">`
- **Nachher**: `<html lang="de">` + Inline-Skript, das vor dem Body-Paint läuft:

```html
<script>
  (function () {
    try {
      var s = localStorage.getItem('sdd-theme');
      var m = (s === 'light' || s === 'dark')
        ? s
        : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var r = document.documentElement;
      r.dataset.theme = m;
      r.style.colorScheme = m;
    } catch (e) {
      document.documentElement.dataset.theme = 'dark';
    }
  })();
</script>
```

**Vertragsregel**: Beim Laden entsteht **kein** sichtbarer Farbwechsel (kein
Flash). Fallback bei Fehler = `dark`.

## C3 — Umschalter-Komponente (`ThemeToggle`)

- **Platzierung**: **oben rechts** in der `App.tsx`-`<header>`, im `ml-auto`-
  Cluster neben `AutomationDial`. (FR-001)
- **Darstellung**: Button mit **SVG-Icon** (`SunIcon`/`MoonIcon`, ergänzt in
  `components/icons.tsx`, gleicher Base-Stil: 24er-Grid, `currentColor`,
  `stroke-width 2`). Icon zeigt den **aktiven** Modus (Mond = Dark aktiv,
  Sonne = Light aktiv). (FR-002, FR-006, D2)
- **Verhalten**: Klick ⇒ `toggleTheme()`. Der Wechsel wirkt **sofort und ohne
  Neuladen** auf das gesamte UI. (FR-003)
- **Barrierefreiheit**: `title`/`aria-label` nennt das Ziel
  („Zu Light-Mode wechseln" / „Zu Dark-Mode wechseln"); Button ist
  tastaturbedienbar (nativer `<button>`).

**Akzeptanz-Bezug**: US1 Szenario 1–2, FR-001/002/003/006, SC-001/SC-005.

## C4 — Theme-Variablen-Vertrag (`index.css`)

- Dark ist die Basis (`[data-theme="dark"]` bzw. Default): unveränderte
  Tailwind-Zink-/Akzentwerte.
- `[data-theme="light"]` überschreibt die genutzten Farbskalen **invertiert**
  (Stufe `950↔50`, `900↔100`, `800↔200`, `700↔300`, `600↔400`, `500` bleibt,
  usw.) für **zinc** und die Akzente **emerald/amber/red/sky** (weitere nur bei
  Nutzung). Zusätzlich die projektspezifische `--color-zinc-925`.
- `color-scheme` wird je Theme gesetzt.
- **Nicht-skalierte Sonderfälle** (`bg-black`, `bg-white`, `text-white`,
  `text-black`) werden gezielt behandelt, sodass in **keinem** Modus
  gleichfarbig-auf-gleichfarbig entsteht. (FR-004)

**Vertragsregel (SC-002/FR-004)**: In beiden Modi erreichen alle Text- und
Bedienelemente WCAG 2.1 AA (4,5:1 Fließtext, 3:1 große Schrift/Controls); kein
Element ist gleichfarbig auf gleichfarbig.

## C5 — Terminal-Theme (`TerminalPane` / neue `terminalTheme(mode)`-Funktion)

- `terminalTheme(mode: ThemeMode)` liefert ein **vollständiges** xterm-`ITheme`:
  `background`, `foreground`, `cursor`, `cursorAccent`, `selectionBackground`
  **und alle 16 ANSI-Farben** (`black`,`red`,`green`,`yellow`,`blue`,`magenta`,
  `cyan`,`white` + `bright*`).
- **Kernregel (FR-005, US2)**: Keine ANSI-Farbe — insbesondere
  `black`/`brightBlack` — darf mit `background` kollidieren; „dunkler Text auf
  dunklem Grund" ist ausgeschlossen. Gilt für **beide** Modi.
- **Live-Update (FR-003, FR-009)**: `TerminalPane` abonniert `onThemeChange` und
  setzt `term.options.theme = terminalTheme(mode)` **ohne Remount**. PTY-
  Verbindung, Scrollback (20 000 Zeilen) und Eingabefokus bleiben erhalten.
- Der `bg-black`-Rahmen des Terminals in `ChatPanel` wird theme-abhängig (folgt
  dem Terminal-`background`), damit keine schwarze Fläche im Light-Mode verbleibt.

**Akzeptanz-Bezug**: US2 Szenario 1–4, FR-005/FR-003/FR-009, SC-003/SC-006.

## C6 — Nicht-Ziele (unverändert)

- Keine Server-/`@sdd/shared`-Änderungen, keine WS-/HTTP-Verträge.
- Keine Änderung funktionaler Abläufe (SDD-Phasen, Sessions, Merge-Queue).
- Keine neue Persistenz außer dem einen `localStorage`-Schlüssel `sdd-theme`.
