# Implementation Plan: Review-Portal und Läufe-Ansicht — Lesbarkeits-Pass

**Branch**: `feature/review-portal-und-laeufe-sicht-pass` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/review-portal-und-laeufe-sicht-pass/spec.md`

## Summary

Vier Lesbarkeits-Befunde aus der Benutzung am 30.07.2026 werden behoben, ohne eine einzige
funktionale Regel anzufassen. (1) Die grösste Fläche des Review-Portals zeigt statt „Datei links
auswählen." eine **Änderungsübersicht** — Kennzahlen, die zehn umfangreichsten Dateien nach
Paket gruppiert, die drei jüngsten Commits — gerechnet von einer neuen **reinen Funktion in
`@sdd/shared`** aus dem `DiffSummary`, das das Portal ohnehin lädt (kein zusätzlicher Abruf).
(2) Die **rechte Spalte** unterscheidet künftig „keine Läufe" (samt Bedeutung für die
Freigabe-Entscheidung), „wird geladen" und „konnte nicht geladen werden" — heute bleibt sie nach
einem gescheiterten Abruf für immer im Ladezustand. (3) Die **Diff-, Editor- und Log-Flächen**
verlieren ihren festen Hex `#0a0a0c` und folgen der Skala; Zeilennummern steigen von
`zinc-600` auf `zinc-500`. (4) Die **Läufe-Ansicht** kürzt „von der CLI gemeldet" auf
**„gemeldet"** (Farbmittel und Vorrangregel bleiben, die Aussage steht im Tooltip), hebt alle
Sondergrössen auf `text-xs` (Kennzahlen `text-sm`) und alle Marker auf ≥ 10 px, und bekommt
ihre Diagrammfarben über **Tailwind-Klassen statt Hex-Strings**. Dazu wird die
Hellmodus-Mechanik um die beiden schon benutzten Skalen **teal** und **violet** erweitert;
`purple` fällt weg. Grundlage aller Farbentscheidungen sind **gerechnete WCAG-Kontraste** für
beide Modi (research.md D6) — sie machen aus „lesbar" konkrete Skalenstufen.

## Technical Context

**Language/Version**: TypeScript 5.8, React 19, ESM (Node ≥ 22), pnpm 10

**Primary Dependencies**: Vite 6, Tailwind CSS v4 (Konfiguration in `index.css`), Vitest 3
(nur `packages/shared`/`packages/server`), react-markdown/remark-gfm (unverändert genutzt)

**Storage**: keine. Kein Schema, keine Migration, kein neues Feld an HTTP/WS. Die
Änderungsübersicht ist eine abgeleitete Sicht auf `GET /api/features/:id/diff`.

**Testing**: `vitest run` in `packages/shared` für das neue Modul `changeOverview.ts`; das
Web-Paket hat bewusst keinen Runner (`test` = No-op) → UI-Nachweis über
[quickstart.md](./quickstart.md) plus `tsc --noEmit` und `vite build`. Browser-Prüfung in Hell-
und Dunkelmodus mit abgelegten Belegen ist **Teil der Abnahme** (FR-027, SC-010).

**Target Platform**: Chromium/Firefox/WebKit, ausgeliefert über Vite (Dev-Port 4830, Proxy auf
Server 4820; eigene Prüfinstanz auf freien Ports)

**Project Type**: Web-Frontend (SPA) im pnpm-Monorepo; betroffen sind `packages/web` und ein
neues reines Modul in `packages/shared`. `packages/server` bleibt unverändert.

**Performance Goals**: Die Übersicht erscheint mit der Antwort von `/diff` — kein zusätzlicher
Abruf, kein eigener Lade-Zwischenzustand (FR-006, SC-009). Moduswechsel wirkt sofort und ohne
JS-Beteiligung, weil jede Farbe über `var(--color-…)` läuft (FR-026).

**Constraints**: WCAG 2.1 AA (4.5:1 Text, 3:1 grafische Flächen) in **beiden** Modi; nur die
Skalen zinc/emerald/amber/red/sky/teal/violet, keine festen Farbwerte; Schrift ≥ 12 px,
Kennzahlen 14 px, Marker ≥ 10 px; die Unterscheidung gemeldet ↔ erschlossen (FR-017/SC-009 der
Telemetrie-Spec) darf nicht abgeschwächt werden; Tab-Struktur, Spaltenlayout,
Freigabe-/Zurückweisungslogik und Verbrauchsmessung bleiben unangetastet.

**Scale/Scope**: 1 neues Modul + Test in `shared`, 1 neue Web-Komponente, 9 geänderte
Web-Dateien, 1 CSS-Ergänzung (2 Skalen × 11 Stufen). Mechanischer Anteil in diesen Dateien:
33× `text-zinc-600`, 37× `text-zinc-500`, 18 feste Hex-Werte sowie 40 Sondergrössen
`text-[9px]`–`text-[11px]` — davon bleiben die 16 der rechten Portal-Spalte
(`AuditSidebar`, `CommentsPanel`) laut Klärung **unverändert**. Verteilung je Datei in
[research.md](./research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist eine **unausgefüllte Vorlage** (nur Platzhalter); es
existieren **keine projektspezifischen Gates**. Angewendet werden die allgemeinen
spec-kit-Prinzipien, die Projektregeln aus `CLAUDE.md` und die Nutzerpräferenz „minimale
Komplexität".

| Prinzip | Bewertung |
|---|---|
| Minimale Komplexität / YAGNI | **PASS** — kein neuer Endpunkt, kein neuer Datenbestand; die Übersicht rechnet aus bereits geladenen Daten. Die Farbfrage wird über zwei CSS-Blöcke gelöst statt über einen Token-Refactor. |
| Bestehende Muster wiederverwenden | **PASS** — reines Modul + Test in `shared` wie `diffParse`/`runSummary`/`lifecycleCatalog`; Inversionsmechanik unverändert, nur um zwei Skalen ergänzt. |
| Keine unnötige Kopplung | **PASS** — `changeOverview` definiert seine Eingabe strukturell, kein Import aus `web`; `AuditSidebar` bleibt darstellend (Fehler kommt als Prop). |
| Bestehende Aussagen nicht abschwächen | **PASS** — Herkunfts-Unterscheidung behält Farbmittel und Vorrangregel; FR-024-Verhalten (Strich statt Null) bleibt wörtlich. |
| Prozesse nur gezielt beenden (`CLAUDE.md`) | **PASS** — Quickstart schreibt eigene Ports und `lsof -ti:<port>`-Abbau fest, kein `pkill -f`. |
| Technikneutralität der Spec gewahrt | **PASS** — Skalenstufen, Klassennamen und Grenzwerte stehen im Plan, nicht in der Spec. |

**Ergebnis: PASS** vor Phase 0 und nach Phase 1 → Complexity Tracking bleibt leer.

## Project Structure

### Documentation (this feature)

```text
specs/review-portal-und-laeufe-sicht-pass/
├── plan.md                      # Diese Datei (/speckit-plan)
├── research.md                  # Phase 0: Entscheidungen D1–D15 inkl. Kontrastmessung
├── data-model.md                # Phase 1: 4 abgeleitete Entitäten, Invarianten I1–I17
├── quickstart.md                # Phase 1: Validierung Stufe 1–4 (inkl. Browser-Belege)
├── contracts/
│   ├── change-overview.md       # Phase 1: API des reinen Moduls (R1–R9)
│   └── ui-contract.md           # Phase 1: C1–C9 (Farbe, Übersicht, Diff, Spalte, Diagramme)
├── checklists/
│   └── requirements.md          # (bestehend) Spec-Qualitäts-Checkliste
├── evidence/                    # Phase 3: Screenshots + Messwerte (FR-027, SC-010)
└── tasks.md                     # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/shared/src/
├── changeOverview.ts             # [neu] buildChangeOverview + overviewGroupKey (rein)
├── changeOverview.test.ts        # [neu] Vitest: R1–R9
└── index.ts                      # [ändern] export * from './changeOverview.js'

packages/web/src/
├── index.css                     # [ändern] teal + violet invertiert (C2)
└── components/
    ├── charts.tsx                # [ändern] ChartTone statt Hex, Grössen, Balkenwert nach aussen (C7)
    ├── ExecutionsView.tsx        # [ändern] 'gemeldet', Grössen, Töne, Tabelle scrollbar (C8)
    ├── FeatureDashboard.tsx      # [ändern] Log-Fläche + Textstufen (C5, D14)
    ├── ReviewPortal.tsx          # [ändern] Übersicht/Diff-Umschaltung, runsError, Farben (C4, C5)
    └── review/
        ├── ChangeOverview.tsx    # [neu] Darstellung der Änderungsübersicht (C3)
        ├── AuditSidebar.tsx      # [ändern] drei Zustände + Ring/Farben (C6)
        ├── CommentsPanel.tsx     # [ändern] nur Textstufen (C6)
        ├── DiffViewer.tsx        # [ändern] Fläche, Zeilennummern, Markierung (C5)
        ├── FileEditor.tsx        # [ändern] Fläche (C5)
        └── TestsPane.tsx         # [ändern] Fläche + Textstufen (C5)

# Unverändert: packages/server (kein Endpunkt, kein Schema), packages/desktop,
# terminalTheme.ts und die Terminal-Rahmen (FeatureConsole, ShellConsole, GridView,
# FeatureResultDialog), ProjectSettings-Farbwahl — Begründung in research.md D14.
```

**Structure Decision**: Frontend-Änderung mit **einem** Logik-Anteil, der nach `packages/shared`
geht, weil das Web-Paket bewusst keinen Test-Runner hat: Kürzung, Sortierung und Gruppierung der
Übersicht sind prüfbare Regeln aus der Klärung und gehören dorthin, wo sie getestet werden
können (Hausmuster `diffParse`, `runSummary`, `lifecycleCatalog`). Alles Übrige ist
Darstellung und bleibt in `packages/web`. Die Farbkorrekturen erfolgen an zwei Orten: zwei neue
Skalenblöcke in `index.css` (wirken auf alle bestehenden Utilities) und der gezielte Austausch
der Stufen dort, wo die Messung sie durchfallen lässt.

## Complexity Tracking

> Keine Constitution-Verletzungen — Abschnitt bleibt leer.

## Phase 0 — Outline & Research

Abgeschlossen → [research.md](./research.md). Entscheidungen: D1 reines Modul in `shared` ·
D2 Grenzen (10/3) und Gruppenschlüssel · D3 Rückweg über „Übersicht" in der Dateiliste ·
D4 kein eigener Ladezustand · D5 Flächen auf `bg-zinc-950` · **D6 Stufenregel aus gemessenen
Kontrasten** · D7 teal/violet invertieren · D8 purple → violet · D9 Diagrammfarben über
Tailwind-Klassen (nicht `var()`, nicht Hex) · D10 Grössen (12/14 px, Marker 10 px, Balkenwert
nach aussen) · D11 Tabelle waagerecht scrollen · D12 drei Zustände der rechten Spalte ·
D13 „gemeldet" + Tooltip · D14 Umfang der Flächen-Korrekturen · D15 Browser-Prüfung und Belege.

Offene `NEEDS CLARIFICATION`: **keine**. Die drei Klärungen der Spec (teal/violet, Reichweite
der Grössen, Umfang der Übersicht) sind eingearbeitet; die einzige nicht empirisch prüfbare
Annahme (Ausgabe unbenutzter Tailwind-Variablen — dieser Worktree hat kein `node_modules`) ist
durch D9 so umgangen, dass beide Fälle tragen, und wird vom Build in Quickstart-Stufe 1
sichtbar.

## Phase 1 — Design & Contracts

Abgeschlossen. Artefakte:

- [data-model.md](./data-model.md) — Änderungsübersicht, Prüfstand der rechten Spalte, Herkunft
  einer Verbrauchszahl, Darstellungs-Ton; Invarianten I1–I17.
- [contracts/change-overview.md](./contracts/change-overview.md) — Typen, zwei Funktionen,
  Regeln R1–R9, Mindestdeckung der Tests.
- [contracts/ui-contract.md](./contracts/ui-contract.md) — C1 Farb-/Kontraktvertrag inkl.
  Stufenregel, C2 Theme-Variablen, C3 Übersichts-Komponente, C4 Reiter „Dateien", C5 Diff-/
  Editor-/Log-Flächen, C6 rechte Spalte, C7 Diagramm-Bausteine, C8 Läufe-Ansicht, C9 Nicht-Ziele.
- [quickstart.md](./quickstart.md) — Stufe 1 automatisierte Checks, Stufe 2 Übersicht/Rückweg,
  Stufe 3 beide Modi im Browser (mit ablesbaren Mess-Schnipseln), Stufe 4 Belege.

**Post-Design Constitution Re-Check**: PASS — keine neuen Verletzungen; kein Endpunkt, kein
Schema, keine zweite Farbmechanik entstanden.

## Nächster Schritt

`/speckit-tasks` — erzeugt die abhängigkeitsgeordnete `tasks.md`. Empfohlene Reihenfolge:
`changeOverview` + Tests → `index.css` (teal/violet) → `charts.tsx` (ChartTone, Grössen) →
`ExecutionsView` + `FeatureDashboard` → `ChangeOverview.tsx` + `ReviewPortal` (Umschaltung,
`runsError`) → `AuditSidebar` (drei Zustände) → Flächen- und Stufen-Durchgang in `review/*` →
Browser-Prüfung in beiden Modi mit Belegen (Stufe 3/4 des Quickstarts).
