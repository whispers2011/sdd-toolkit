# Implementation Plan: Emojis als SVG-Icons (Wissensdatenbank & Wissens-Chat)

**Branch**: `feature/emojis-im-projekt-immer-als-svg-icon-hinterlegen` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/emojis-im-projekt-immer-als-svg-icon-hinterlegen/spec.md`

## Summary

Alle als Icon eingesetzten Emoji- und Symbol-Glyphen in der **Wissensdatenbank** und im **Wissens-Chat** werden durch ein einheitliches, designkonformes SVG-Icon-Set ersetzt. Bedeutung, Funktion, Tooltips und Layout bleiben unverändert.

**Technischer Ansatz**: Ein kleines, hauseigenes Icon-Modul (`packages/web/src/components/icons.tsx`) stellt pro Bedeutung eine winzige React-Komponente bereit, die ein Inline-`<svg>` mit `fill="none"`/`stroke="currentColor"` rendert (Outline-Stil, 24er-Grid, `stroke-width` 2, Geometrie an Lucide/Feather angelehnt). Die Icons erben Farbe (`currentColor`) und Größe (`1em` bzw. `className`) aus ihrem Kontext und sind standardmäßig `aria-hidden`; interaktive Buttons behalten ihr bestehendes `title`. Keine neue Laufzeit-Abhängigkeit — konsistent mit dem schlanken Setup (bisher keinerlei Icon-Bibliothek, ~13–15 Icons genügen). Anschließend werden die Emoji in genau sechs Komponenten durch diese Icons ersetzt.

## Technical Context

**Language/Version**: TypeScript 5.8, React 19 (JSX/TSX)

**Primary Dependencies**: React 19, Vite 6, Tailwind CSS v4 (`@tailwindcss/vite`); **keine neue Abhängigkeit** — Icons hausintern als Inline-SVG-Komponenten

**Storage**: N/A (rein visuelles Frontend-Feature, keine Persistenz/kein Datenmodell betroffen)

**Testing**: Web-Paket hat kein Test-Harness (MVP: `test` ist No-op; vitest existiert nur in `server`/`shared`). Verifikation über `tsc --noEmit` (typecheck), `vite build` und eine manuelle Sicht-/Grep-Prüfung laut `quickstart.md`. Es wird bewusst kein neues Test-Framework eingeführt (Over-Engineering vermeiden, siehe Constitution Check).

**Target Platform**: Lokale Web-App im Browser (Vite Dev-Server Port 4830), dunkles Design (`color-scheme: dark`, Zinc-Palette)

**Project Type**: Web-Frontend (pnpm-Monorepo: `packages/web`, `packages/server`, `packages/shared`)

**Performance Goals**: Keine messbaren Performance-Ziele; Inline-SVG ist statisch und rendert ohne spürbare Kosten. Kein Netzwerk-/Bundle-Zuwachs durch externe Icon-Bibliothek.

**Constraints**: Icons MÜSSEN `currentColor` erben (kein festes Fill), zur Textzeile passende Größe (`1em`), keine Layout-Sprünge, bestehende `title`/Tooltips erhalten, dekorative Icons `aria-hidden`. Betroffener Scope strikt auf Wissensdatenbank + Wissens-Chat begrenzt.

**Scale/Scope**: 6 Komponentendateien, ~13–15 unterschiedliche Icons, 1 neues Icon-Modul. Kein Server-/Shared-Code betroffen.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Die Projekt-Constitution (`.specify/memory/constitution.md`) ist eine **unausgefüllte Vorlage** (nur Platzhalter, keine ratifizierten Prinzipien). Es existieren daher keine formalen Gates. Ersatzweise werden die dokumentierten Projektnormen (README, globale Präferenzen) angewandt:

- **Minimale Komplexität / kein Over-Engineering** → ✅ Hausinternes Icon-Modul statt neuer Abhängigkeit; kein neues Test-Framework.
- **Keine unnötigen Abhängigkeiten** → ✅ Kein `lucide-react` o. Ä. als Laufzeit-Dependency (siehe `research.md`).
- **Stil des Umfelds übernehmen** → ✅ Flaches `components/`-Layout, `currentColor`/Tailwind-Klassen, bestehende `title`-Konvention.
- **Rein visuell, keine Verhaltensänderung** → ✅ Keine Änderung an Daten, APIs, WS-Events oder Abläufen.

**Gate-Ergebnis**: PASS (keine Verstöße, Complexity Tracking bleibt leer).

**Re-Check nach Phase 1**: Weiterhin PASS — das Design (ein Icon-Modul + Ersetzungen in 6 Dateien, keine neue Dependency, kein neues Test-Framework) fügt keine Komplexität über das Nötige hinaus hinzu.

## Project Structure

### Documentation (this feature)

```text
specs/emojis-im-projekt-immer-als-svg-icon-hinterlegen/
├── plan.md              # Diese Datei (/speckit-plan)
├── research.md          # Phase 0 (/speckit-plan)
├── data-model.md        # Phase 1 (/speckit-plan) — Icon-Katalog & Emoji→Icon-Mapping
├── quickstart.md        # Phase 1 (/speckit-plan) — Verifikationsleitfaden
├── contracts/
│   └── icon-component.md # Phase 1 (/speckit-plan) — UI-Contract des Icon-Moduls
├── checklists/
│   └── requirements.md  # (aus /speckit-specify)
└── tasks.md             # Phase 2 (/speckit-tasks — NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/web/src/
├── components/
│   ├── icons.tsx              # NEU: hausinternes SVG-Icon-Set (currentColor, aria-hidden)
│   ├── Sidebar.tsx            # ändern: 📚 → <KnowledgeIcon/>
│   ├── FeatureConsole.tsx     # ändern: 📚 → <KnowledgeIcon/>
│   ├── KnowledgePanel.tsx     # ändern: 📦 📄 ✎ 🗑 ⟳ +📦 +📄 → Icons
│   ├── FeatureKnowledgeSelect.tsx  # ändern: 📦 📄 → Icons
│   ├── ChatBubble.tsx         # ändern: 💬 ✕ → Icons
│   └── ChatPanel.tsx          # ändern: ✕ 💡 ✓ ⚠ ↺ ⏸ → Icons
└── index.css                  # i. d. R. keine Änderung (Größe/Farbe via currentColor + Tailwind)
```

**Structure Decision**: Web-Frontend im bestehenden pnpm-Monorepo. Es wird ausschließlich `packages/web/src/components` berührt. Das flache `components/`-Verzeichnis wird um eine einzelne Datei `icons.tsx` ergänzt (kein Unterordner nötig bei ~15 Icons) und aus den sechs Zielkomponenten importiert. Server- und Shared-Pakete bleiben unberührt.

## Complexity Tracking

> Keine Constitution-Verstöße — Tabelle bleibt leer.
