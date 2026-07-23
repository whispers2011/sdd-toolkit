# Phase 0 Research: Light-/Dark-Mode-Umschalter & lesbare Claude-Chat-Farben

**Feature**: `light-model-claude-chat-farben` · **Date**: 2026-07-23

Dieses Dokument löst die offenen Punkte der Technical Context und dokumentiert die
tragenden Entscheidungen. Es umfasst auch die **drei aus `/speckit-clarify`
übernommenen Vorgabe-Antworten** (die Klärungsschleife wurde vom Nutzer
übersprungen; es wurden die empfohlenen, spec-konformen Defaults gewählt).

---

## D1 — Toggle-Modell: binär (Light/Dark), System nur als Erst-Default

- **Decision**: Der Umschalter ist **binär** (Light ⇄ Dark). Die
  Systempräferenz (`prefers-color-scheme`) wird ausschließlich als **Erst-Default**
  verwendet, solange keine explizite Wahl vorliegt. Nach der ersten expliziten
  Umschaltung ist der Wert festgeschrieben; es gibt **keinen** dritten
  „System/Auto"-Zustand.
- **Rationale**: Deckt sich exakt mit der Nutzeranforderung („switcher für
  light/darkmode"), mit FR-008 (System als Default) und FR-010 (explizite Wahl
  gewinnt). Minimale Komplexität in Datenmodell (2 statt 3 Zustände) und UI
  (2-Wege-Schalter statt Zyklus/Menü).
- **Alternatives considered**: Tri-State (Light/Dark/System). Verworfen: erhöht
  UI- und Persistenzkomplexität ohne von der Spec geforderten Nutzen; „zurück zu
  System" ist kein benanntes Bedürfnis. Nachrüstbar, falls später gewünscht.

## D2 — Icon-Konvention: Icon zeigt den **aktiven** Modus

- **Decision**: Der Umschalter zeigt das Icon des **aktuell aktiven** Modus
  (Mond im Dark-Mode, Sonne im Light-Mode). Der Tooltip nennt das Ziel
  („Zu Light-Mode wechseln" / „Zu Dark-Mode wechseln").
- **Rationale**: Erfüllt FR-006 und SC-005 unmittelbar — der aktive Modus ist am
  Symbol ohne Ausprobieren erkennbar. Löst die in FR-002 offen gelassene
  Formulierung „aktuellen **bzw.** erreichbaren Modus" eindeutig zugunsten
  „aktuell aktiv" auf; der erreichbare Modus wird über den Tooltip kommuniziert.
- **Alternatives considered**: Icon zeigt das Ziel (Sonne im Dark-Mode).
  Verworfen: verlangt Interpretation und widerspricht dem Wortlaut von FR-006.

## D3 — Terminal färbt mit dem Modus um; Rückfragen-Fix in beiden Modi

- **Decision**: Der xterm.js-Projekt-Chat erhält **je Modus eine vollständige
  16-Farben-ANSI-Palette** (plus `background`/`foreground`/`cursor`/`selection`).
  Beim Moduswechsel wird `term.options.theme` **live aktualisiert** (kein
  Remount, kein PTY-/Scrollback-Verlust). Der Rückfragen-Defekt wird bereits in
  Dark behoben, weil die neue Palette kollisionsfrei ist.
- **Rationale**: Grundursache des „schwarz auf schwarz" ist, dass `TerminalPane`
  nur `background/foreground/cursor` setzt und xterm auf seine **Default-ANSI-
  Palette** zurückfällt (ANSI-Schwarz/dim ≈ sehr dunkel auf `#09090b`). Claude
  Codes interaktive Rückfrage-Boxen nutzen genau diese ANSI-Farben → unlesbar.
  Eine explizite, kontrastgeprüfte Palette je Modus behebt FR-005/US2 dauerhaft
  und erfüllt zugleich FR-003/FR-009 (Live-Wechsel ohne Unterbrechung).
- **Alternatives considered**:
  - Nur Hintergrund aufhellen: löst die ANSI-Kollision nicht zuverlässig.
  - Terminal-Theme fest lassen und nur den React-Rahmen umfärben: verstößt gegen
    FR-003/FR-004 („gesamtes UI", beide Modi lesbar) und lässt das Kernproblem
    (ANSI-Schwarz) bestehen.
  - Remount des Terminals bei Moduswechsel: verworfen — bräche PTY-Verbindung,
    Scrollback und Eingabefokus (FR-009).

## D4 — Theming-Mechanik: Palette-Inversion über Tailwind-v4-CSS-Variablen

- **Decision**: Kern der Umsetzung ist die **Umkehrung der Farbskalen** je
  `[data-theme="light"]`. Tailwind v4 kompiliert Farb-Utilities zu
  `var(--color-<skala>-<stufe>)`. Im Light-Mode werden diese Variablen für die
  genutzten Skalen (neutral **zinc** sowie die Akzente **emerald/amber/red/sky**
  u. a.) **invertiert** überschrieben (Stufe 950↔50, 900↔100, …, 500 bleibt
  Mitte). Da das bestehende Dark-UI die Skalen **durchgängig richtungsgleich**
  verwendet (hohe Stufe = dunkel, niedrige Stufe = hell), kippt eine
  Skalen-Inversion das Erscheinungsbild kohärent nach hell — **ohne** die 553
  Utility-Verwendungen in 19 Dateien anzufassen. Zusätzlich wird
  `color-scheme: light|dark` je Theme gesetzt (native Controls, Scrollbars).
- **Rationale**: Minimaler, robuster Diff. Die Alternative — an 553 Fundstellen
  `dark:`-Varianten ergänzen oder ein vollständiger Semantik-Token-Refactor —
  wäre deutlich komplexer und fehleranfälliger und widerspricht dem Ziel
  minimaler Komplexität. Hues und relative Kontraste bleiben durch die Inversion
  erhalten.
- **Restrisiken & Gegenmaßnahmen** (werden in `quickstart.md` als Prüfpunkte und
  in `tasks.md` als gezielte Aufgaben adressiert):
  - **Nicht-skalierte Farben** `bg-black`/`bg-white`/`text-white`/`text-black`
    liegen auf keiner Skala → gezielt behandeln (Surface-Variable bzw. punktuelle
    Overrides). Betroffen u. a. der `bg-black`-Rahmen des Terminals in
    `ChatPanel`.
  - **Mittelstufe 500** hat beidseitig knappen Kontrast → Sichtprüfung.
  - **WCAG 2.1 AA (SC-002)**: abschließender Kontrast-Durchgang über beide Modi
    (Fließtext 4,5:1, große Schrift/Controls 3:1).
- **Alternatives considered**:
  - Semantische Tokens (`--bg`, `--surface`, `--text`, …) + Rewrite aller
    Klassen: höchste Wartbarkeit, aber großflächiger Umbau — verworfen (Komplexität).
  - `dark:`-Variante an jeder Fundstelle: 553 Änderungen, hohe Fehlerquote —
    verworfen.

## D5 — Persistenz & Erst-Default (FOUC-frei)

- **Decision**: Gerätelokale Speicherung in `localStorage` unter dem Schlüssel
  **`sdd-theme`** mit Werten `"light"` | `"dark"`. Fehlt der Schlüssel, folgt die
  UI der Systempräferenz (`matchMedia('(prefers-color-scheme: dark)')`),
  ersatzweise **Dark**. Ein **kleines Inline-Skript in `index.html`** setzt
  `data-theme` auf `<html>` **vor dem ersten Paint** (kein Flash). `index.html`
  wird von fest `class="dark"` auf das attributgesteuerte Schema umgestellt.
- **Rationale**: Entspricht dem bestehenden Persistenzmuster des Toolkits
  (`localStorage`-Schlüssel wie `sdd-selected-project`, `sdd-show-completed`,
  `sdd-sound` in `store.tsx`). Kein Server, kein Konto (FR-007). Inline-Init
  verhindert FOUC beim Laden.
- **Alternatives considered**: Persistenz im Server-State — verworfen
  (gerätelokal genügt laut Spec, unnötige Kopplung). Theme rein im React-Store —
  verworfen (React mountet erst nach dem ersten Paint → FOUC; xterm braucht
  zudem einen Nicht-React-Zugriff).

## D6 — Live-Verteilung des Theme-Wechsels an Nicht-CSS-Konsumenten

- **Decision**: Ein schlankes Theme-Modul (`theme.ts`/`theme.tsx`) kapselt
  `getTheme()`, `setTheme()`, `toggleTheme()`, `resolveInitial()` und ein
  **Subscribe** (Event-Emitter/`CustomEvent` auf `window`). CSS reagiert allein
  über `data-theme`; `TerminalPane` **abonniert** Änderungen und ruft
  `term.options.theme = terminalTheme(mode)` auf. Ein optionaler React-Hook
  (`useTheme()`) versorgt Komponenten wie den Toggle.
- **Rationale**: CSS-Utilities brauchen keinen JS-Kanal (rein
  attributgesteuert). Nur echte JS-Konsumenten (xterm) benötigen ein Signal;
  ein Emitter hält das entkoppelt und vermeidet Remounts (FR-009).
- **Alternatives considered**: Theme in `store.tsx` integrieren — möglich, aber
  `store` ist WS-/App-zentriert und mountet nach dem ersten Paint; ein
  eigenständiges Modul erlaubt die FOUC-freie Früh-Initialisierung und den
  Zugriff außerhalb des React-Baums.

---

## Aufgelöste Technical-Context-Unbekannte

| Thema | Ergebnis |
|-------|----------|
| Sprache/Runtime | TypeScript 5.8, React 19, ESM (unverändert) |
| Theming-Engine | Tailwind v4 (`@tailwindcss/vite`, Konfiguration in `index.css`) |
| Zustand/Persistenz | `localStorage` (`sdd-theme`), Systempräferenz als Default |
| Terminal | xterm.js 5.5 — vollständige ANSI-Palette je Modus, Live-Update |
| Tests | Web-Paket ohne Test-Runner (MVP, `test` = No-op) → Validierung via `quickstart.md` + `tsc --noEmit` |
| Betroffener Scope | ausschließlich `packages/web`; `server`/`shared` unverändert |
