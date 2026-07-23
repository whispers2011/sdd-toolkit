# Implementation Plan: Speckit-Zwischenresultate pro Feature einsehen und bearbeiten

**Branch**: `show-speckit-results` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/show-speckit-results/spec.md`

## Summary

Auf der Feature-Kachel des Kanban-Boards bekommt jeder artefakt-erzeugende Speckit-Schritt (Specify, Plan, Tasks, Checklist) ein SVG-Icon mit Hover-Tooltip. Ein Klick öffnet ein Modal, das das zugehörige Ergebnis-Artefakt des Features (`spec.md`, `plan.md` + Begleitartefakte, `tasks.md`, Checklisten) in einem lesbaren Format (WYSIWYG, kein Markdown-Quelltext) darstellt. Oben rechts wechselt ein Bearbeiten-Button in einen vollwertigen WYSIWYG-Editor; Speichern schreibt strukturerhaltend in die Datei zurück — konflikt- und sperrgeschützt (gesperrt, solange irgendeine Phase des Features läuft). Aus dem Modal lässt sich die bestehende Feature-Konsole als Split-Screen daneben öffnen.

Technischer Ansatz: **maximale Wiederverwendung** des bereits vorhandenen Musters des Schwester-Features „Lane-Info-Icon" (`phaseDefinition.ts` / `PhaseDefinitionDialog.tsx`). Server-seitig entsteht ein analoger Service `featureArtifacts.ts` (Lesen/Auflisten/Schreiben mit mtime-Konflikt- und Sperrprüfung), der die vorhandene `artifactPath()`-Zuordnung nutzt; drei neue REST-Endpunkte unter `/api/features/:id/artifacts`. Web-seitig ein neues Modal `FeatureResultDialog.tsx`, das für Ansicht **und** Editor eine neue WYSIWYG-Komponente (`MarkdownEditor.tsx`, Basis MDXEditor/remark) verwendet, plus die bereits existierende `TerminalPane` für den Split-Screen. Pure Logik (Datei-Enumeration, Feature-Lock) liegt in `packages/shared` und ist unit-getestet.

## Technical Context

**Language/Version**: TypeScript 5.8, Node ≥ 22, ES modules

**Primary Dependencies**: React 19 + Vite 6 + Tailwind 4 (web); Fastify + WebSockets + better-sqlite3 + node-pty (server); `react-markdown`/`remark-gfm` bereits vorhanden. **Neu (web)**: WYSIWYG-Markdown-Editor — Entscheidung in `research.md` (Empfehlung: `@mdxeditor/editor`, remark/mdast-basierter Round-Trip).

**Storage**: Dateisystem — die Ergebnis-Artefakte unter `specs/<feature>/` (im Feature-Worktree während der Entwicklung, sonst im Haupt-Checkout). Keine neue SQLite-Tabelle; Orchestrierungs-State (Phasen-Status) wird nur gelesen. `~/.claude/` bleibt read-only.

**Testing**: Vitest. Unit-Tests für pure Logik in `packages/shared` und für den Server-Service in `packages/server` (Muster: `phaseDefinition.test.ts`, `artifacts.test.ts`). Web hat bewusst keine Tests (MVP-Konvention).

**Target Platform**: Lokale Web-App (Server Port 4820, Web 4830), Desktop-Browser.

**Project Type**: Web-App im pnpm-Monorepo (`packages/shared` · `packages/server` · `packages/web`).

**Performance Goals**: Artefakt nach Klick in < 1 s lesbar dargestellt (SC-002); flüssiges Scrollen auch bei großen Dateien.

**Constraints**: Kein stiller Datenverlust (mtime-Konflikterkennung); Bearbeiten gesperrt bei aktiver Feature-Entwicklung; verlustfreier (strukturerhaltender) Rückschrieb inkl. Tabellen, Codeblöcke, Aufgaben-Checklisten (`- [ ]`); nur-lokaler Einzelnutzer.

**Scale/Scope**: 4 Artefakt-Schritte pro Feature; Plan erzeugt bis zu 5 Begleitdateien + `contracts/`. Kleine Dateien (typisch < 100 KB).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ist eine **unausgefüllte Vorlage** — es existieren keine ratifizierten Prinzipien, gegen die formal gegatet wird. Ersatzweise werden die impliziten Projektkonventionen aus `README.md` angewandt:

- **Pure State/Logik in `packages/shared`, unit-getestet** → Datei-Enumeration & Feature-Lock landen als pure Funktionen in `shared` mit Tests. ✅
- **Dateien in `specs/` sind die Wahrheit; `~/.claude/` read-only; SQLite nur für Orchestrierungs-State** → Feature liest/schreibt ausschließlich `specs/<feature>/`-Artefakte, keine DB-Änderung. ✅
- **Wiederverwendung statt Parallelstruktur** → Server- und UI-Muster des Schwester-Features werden gespiegelt, nicht dupliziert; `TerminalPane` und `artifactPath()` werden wiederverwendet. ✅
- **Minimale Komplexität (YAGNI)** → einzige neue Abhängigkeit ist der WYSIWYG-Editor (durch die „kein Markdown"-Anforderung zwingend). ✅

**Gate: PASS** (keine Verstöße; Complexity Tracking bleibt leer).

## Project Structure

### Documentation (this feature)

```text
specs/show-speckit-results/
├── plan.md              # Diese Datei
├── research.md          # Phase 0 — Editor-Wahl, Lock-Semantik, Basisverzeichnis, Split-Screen
├── data-model.md        # Phase 1 — Entitäten & Phase→Datei-Mapping
├── quickstart.md        # Phase 1 — manuelle Validierungsszenarien
├── contracts/
│   └── feature-artifacts-api.md   # Phase 1 — REST-Verträge der 3 Endpunkte
├── checklists/
│   └── requirements.md  # aus /speckit-specify
└── tasks.md             # /speckit-tasks (NICHT von /speckit-plan erzeugt)
```

### Source Code (repository root)

```text
packages/
├── shared/src/
│   ├── types.ts                    # ÄNDERN: FeatureArtifact*-DTOs + Save-Request/Result
│   ├── featureArtifacts.ts         # NEU: pure Logik — Schrittliste, Datei-Enumeration, featureLock()
│   ├── featureArtifacts.test.ts    # NEU: Unit-Tests der puren Logik
│   └── index.ts                    # ÄNDERN: Re-Export
│
├── server/src/
│   ├── services/
│   │   ├── artifacts.ts            # WIEDERVERWENDEN: artifactPath() (ggf. minimal erweitern)
│   │   ├── featureArtifacts.ts     # NEU: read/list/write mit Lock- & Konfliktschutz (Muster: phaseDefinition.ts)
│   │   └── featureArtifacts.test.ts# NEU: Service-Tests (conflict/lock/not_found)
│   └── api/server.ts               # ÄNDERN: 3 Endpunkte unter /api/features/:id/artifacts
│
└── web/src/
    ├── api.ts                      # ÄNDERN: Client-Methoden (featureArtifacts, saveFeatureArtifact) — SaveConflictError wiederverwenden
    ├── components/
    │   ├── KanbanBoard.tsx         # ÄNDERN: Icon-Leiste je Artefakt-Schritt auf FeatureCard + Dialog-State
    │   ├── icons.tsx               # ÄNDERN: neue Schritt-Icons (Specify/Plan/Tasks/Checklist)
    │   ├── FeatureResultDialog.tsx # NEU: Modal — Ansicht+Editor (WYSIWYG), Datei-Auswahl, Split-Screen-Konsole, Konflikt/Discard
    │   └── MarkdownEditor.tsx      # NEU: WYSIWYG-Wrapper (readOnly für Ansicht, editierbar für Bearbeiten)
    └── package.json                # ÄNDERN: WYSIWYG-Editor-Dependency
```

**Structure Decision**: Bestehendes Monorepo, keine neue Top-Level-Struktur. Feature erweitert die drei vorhandenen Pakete entlang der etablierten Schichtung (pure Logik in `shared`, Datei-/Prozess-Zugriff in `server`, UI in `web`) und spiegelt konsequent das Muster des Schwester-Features `spec-kit-spezifikation-einsehen`.

## Complexity Tracking

> Keine Constitution-Verstöße — Abschnitt bleibt leer.
