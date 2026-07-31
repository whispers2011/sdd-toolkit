# Implementation Plan: Light-/Dark-Mode-Umschalter & lesbare Claude-Chat-Farben

**Branch**: `feature/light-model-claude-chat-farben` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/light-model-claude-chat-farben/spec.md`

## Summary

Das heute **Dark-only** gestaltete Web-UI (`packages/web`) erhält einen
**Umschalter oben rechts** (SVG-Icon) für Light-/Dark-Mode und behebt den
Lesbarkeits-Defekt der Claude-**Rückfragen** im Projekt-Chat („schwarz auf
schwarz"). Technischer Kern: (1) ein **Theme-Modul** mit `localStorage`-Persistenz
(`sdd-theme`), Systempräferenz als Erst-Default und FOUC-freier Früh-Initialisierung
in `index.html`; (2) **Palette-Inversion über Tailwind-v4-CSS-Variablen** unter
`[data-theme="light"]`, wodurch die 553 vorhandenen Farb-Utilities (19 Dateien)
ohne Einzeländerung nach hell kippen; (3) eine **vollständige, kollisionsfreie
xterm-ANSI-Palette je Modus** mit **Live-Update** (kein Remount → kein
PTY-/Scrollback-/Fokusverlust). Der Rückfragen-Fix greift bereits in Dark, da die
Grundursache die fehlende ANSI-Palette (xterm-Default) ist.

## Technical Context

**Language/Version**: TypeScript 5.8, React 19, ESM (Node ≥ 22)

**Primary Dependencies**: Vite 6, Tailwind CSS v4 (`@tailwindcss/vite`, Konfiguration in `index.css`), xterm.js 5.5 (`@xterm/xterm` + fit/web-links addons), react-markdown/remark-gfm (für diese Änderung nicht zentral)

**Storage**: Browser-`localStorage` (gerätelokal), Schlüssel `sdd-theme` ∈ {`light`,`dark`}; Abwesenheit ⇒ Systempräferenz, ersatzweise Dark

**Testing**: Kein Test-Runner im Web-Paket (MVP; `test` = No-op). Validierung über `quickstart.md` (manuell) + `tsc --noEmit` + `vite build`

**Target Platform**: Moderne Browser (Chromium/Firefox/WebKit), via Vite bereitgestellt (Dev-Port 4830, Proxy auf Server 4820)

**Project Type**: Web-Frontend (SPA) in pnpm-Monorepo — betroffen ist **nur** `packages/web`; `@sdd/server` und `@sdd/shared` bleiben unverändert

**Performance Goals**: Moduswechsel sichtbar in < 2 s (SC-001), praktisch sofort (CSS-Variablen-Swap + ein `term.options.theme`-Update); kein Reflow-Reload; kein FOUC beim Laden

**Constraints**: Kein Neuladen, kein Verlust von Sitzung/Stream/Fokus (FR-009); WCAG 2.1 AA Kontrast in beiden Modi (SC-002); kein „gleichfarbig auf gleichfarbig" (FR-004)

**Scale/Scope**: 19 Web-Dateien mit Farb-Utilities (**433 neutral** + **120 Akzent** Verwendungen); 1 neues Theme-Modul, 1 Toggle-Komponente, 2 neue SVG-Icons, 1 xterm-Theme-Funktion, `index.html`- und `index.css`-Anpassung. Keine Server-/Schemaänderung.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist eine **unausgefüllte Vorlage** (Platzhalter);
es existieren **keine projektspezifischen Gates**. Angewendet werden daher die
allgemeinen spec-kit-Prinzipien und die ausdrückliche Nutzerpräferenz „minimale
Komplexität".

| Prinzip (allgemein) | Bewertung |
|---------------------|-----------|
| Minimale Komplexität / YAGNI | **PASS** — Palette-Inversion vermeidet 553 Einzeländerungen bzw. einen Token-Refactor; binärer Toggle statt Tri-State. |
| Technikneutralität der Spec gewahrt | **PASS** — Umsetzung entscheidet Palette/Engine, Spec bleibt neutral. |
| Keine unnötige Kopplung / kein neuer Server-State | **PASS** — rein clientseitig, ein `localStorage`-Schlüssel. |
| Bestehende Muster wiederverwenden | **PASS** — folgt `sdd-*`-`localStorage`-Muster und dem `icons.tsx`-Base-Stil. |

**Ergebnis: PASS** (vor und nach Phase-1-Design; keine Verletzungen → Complexity
Tracking bleibt leer).

## Project Structure

### Documentation (this feature)

```text
specs/light-model-claude-chat-farben/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0: Entscheidungen D1–D6
├── data-model.md        # Phase 1: Entität Theme-Präferenz
├── quickstart.md        # Phase 1: Validierungsszenarien V1–V5
├── contracts/
│   └── ui-contract.md   # Phase 1: Theme-Modul-, Toggle-, xterm-Verträge (C1–C6)
├── checklists/
│   └── requirements.md  # (bestehend) Spec-Qualitäts-Checkliste
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/web/
├── index.html                     # [ändern] class="dark" → FOUC-Guard-Inlineskript (C2)
└── src/
    ├── index.css                  # [ändern] [data-theme=light] Palette-Inversion + color-scheme (C4)
    ├── theme.ts                   # [neu] Theme-Modul: resolve/get/set/toggle/onChange (C1)
    ├── main.tsx                   # [ggf. ändern] Theme-Init sicherstellen (Import theme.ts)
    ├── App.tsx                    # [ändern] <ThemeToggle/> oben rechts im Header (C3)
    └── components/
        ├── icons.tsx              # [ändern] SunIcon + MoonIcon (Base-Stil)
        ├── ThemeToggle.tsx        # [neu] Umschalter-Button (C3)
        ├── TerminalPane.tsx       # [ändern] terminalTheme(mode) + Live-Update via onThemeChange (C5)
        └── ChatPanel.tsx          # [ändern] bg-black-Rahmen theme-abhängig (C5)

# Unverändert: packages/server, packages/shared, alle übrigen Komponenten
# (die restlichen 15 Komponenten kippen automatisch über die Palette-Inversion)
```

**Structure Decision**: Web-Frontend-Änderung, ausschließlich in `packages/web`.
Die bewusst kleine Liste explizit editierter Dateien ist Folge der
Palette-Inversion (D4): CSS-Variablen-Overrides statt Änderungen an einzelnen
`className`-Verwendungen. Nur echte JS-Konsumenten des Modus (xterm-Terminal)
und die neuen UI-Bausteine (Toggle, Icons, Theme-Modul, FOUC-Guard) werden
gezielt angefasst.

## Complexity Tracking

> Keine Constitution-Verletzungen — Abschnitt bleibt leer.

## Phase 0 — Outline & Research

Abgeschlossen → [research.md](./research.md). Aufgelöste Entscheidungen:
D1 binärer Toggle · D2 Icon zeigt aktiven Modus · D3 Terminal färbt live um +
Rückfragen-Fix · D4 Palette-Inversion (Tailwind v4) · D5 Persistenz/FOUC-Default ·
D6 Live-Verteilung an xterm. Die drei aus der übersprungenen `/speckit-clarify`
stammenden Punkte (D1/D2/D3) wurden mit den empfohlenen, spec-konformen Defaults
festgelegt.

## Phase 1 — Design & Contracts

Abgeschlossen. Artefakte:
- [data-model.md](./data-model.md) — Entität **Theme-Präferenz** (Werte,
  Ableitungsregeln, Zustandsübergänge, Invarianten).
- [contracts/ui-contract.md](./contracts/ui-contract.md) — C1 Theme-Modul,
  C2 FOUC-Guard, C3 Toggle, C4 CSS-Variablen, C5 Terminal-Theme, C6 Nicht-Ziele.
- [quickstart.md](./quickstart.md) — Validierungsszenarien V1–V5 mit Bezug zu
  Akzeptanzkriterien/SC.

**Post-Design Constitution Re-Check**: PASS (keine neuen Verletzungen).

## Nächster Schritt

`/speckit-tasks` — erzeugt die abhängigkeitsgeordnete `tasks.md`. Empfohlene
Reihenfolge der Umsetzung: Theme-Modul + FOUC-Guard → CSS-Inversion → Toggle +
Icons → xterm-Theme + Live-Update → Kontrast-/Sonderfall-Durchgang (V5).
