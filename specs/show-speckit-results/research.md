# Phase 0 Research: Speckit-Zwischenresultate einsehen und bearbeiten

Kontext: React 19 + Vite 6 + Tailwind 4 (web), Fastify + Node ≥ 22 (server), TypeScript 5.8. Bestehendes Muster: Schwester-Feature „Lane-Info-Icon" (`phaseDefinition.ts`, `PhaseDefinitionDialog.tsx`).

---

## Entscheidung 1 — WYSIWYG-Markdown-Editor (Ansicht + Bearbeiten, kein Quelltext)

**Decision**: `@mdxeditor/editor` als Basis einer schlanken Wrapper-Komponente `MarkdownEditor.tsx`, betrieben mit den Plugins für GFM-Tabellen, Aufgaben-Listen (`- [ ]`), Codeblöcke und Frontmatter. Dieselbe Komponente rendert die **Ansicht** (readOnly) und den **Editor** (editierbar) — so ist beides garantiert „kein Markdown-Quelltext" und identisch formatiert (Clarify-Antwort Q3: voller WYSIWYG).

**Rationale**:
- Zweck-gebaut für „Markdown als Rich-Text anzeigen und bearbeiten"; Round-Trip erfolgt über **mdast/remark** — dieselbe Familie wie das bereits genutzte `remark-gfm`. Damit bleiben Tabellen, Task-Lists, Codeblöcke und Frontmatter strukturell erhalten (FR-010).
- React-first, unterstützt einen `readOnly`-Modus → eine Komponente für Ansicht **und** Editor (weniger Code, kein Divergieren der Darstellung).
- Codeblöcke werden als eigenständige Rich-Blöcke dargestellt (CodeMirror-Plugin), nicht als roher Text — passt zu „voller WYSIWYG" statt „geschützte Rohblöcke".

**Alternatives considered**:
- **Milkdown** (ProseMirror + remark): ähnlich starke remark-Round-Trip-Treue, aber mehr Boilerplate/Plugin-Verdrahtung; als Fallback vorgemerkt, falls MDXEditor mit React 19/Vite Probleme macht.
- **TipTap + `tiptap-markdown`**: populär, aber der Markdown-Serializer ist nicht remark-basiert → höheres Risiko für Verluste bei GFM-Tabellen/Task-Lists.
- **Nur `react-markdown` + `<textarea>`** (wie das Schwester-Feature): erfüllt die Anforderung ausdrücklich **nicht** (Editor zeigt rohes Markdown). Verworfen.

**Umsetzungs-Spike (vor Commit der Abhängigkeit zu verifizieren, in `tasks.md`)**:
1. **React-19-/Vite-6-Kompatibilität** des gewählten Editors (Peer-Deps, SSR-freies Mounten im Browser).
2. **Round-Trip-Treue** an echten Projektdateien: `spec.md` (Tabellen, Fettdruck), `tasks.md` (`- [ ]`-Checkboxen), `plan.md` (Codeblöcke, Frontmatter) laden → ohne Änderung speichern → Diff prüfen.
   - Akzeptanzmaß: **semantisch/strukturell verlustfrei** (keine verlorenen Zellen, Checkboxen, Codeblöcke). Byte-Identität ist nicht garantiert (Markdown hat mehrere gültige Serialisierungen).
   - Mitigation gegen Diff-Rauschen: `remark-stringify`-Optionen am spec-kit-Stil ausrichten (Bullet `-`, Fenced-Code ```` ``` ````, ATX-Überschriften) und **nur bei tatsächlicher Nutzer-Änderung** speichern (dirty-Flag, kein Speichern bei reinem Öffnen).

---

## Entscheidung 2 — Basisverzeichnis der Artefakte (Worktree vs. Haupt-Checkout)

**Decision**: Artefakte werden aus `feature.worktreePath` gelesen/geschrieben, wenn gesetzt; sonst Fallback auf `project.path`. Pfad = `join(base, 'specs', feature.name, …)`.

**Rationale**: Während der Entwicklung leben die Zwischenresultate im isolierten Feature-Worktree (auf `feature/<name>`); das ist die Fassung, die der Nutzer sieht und bearbeitet. Vor Worktree-Anlage bzw. nach dem Merge (Brownfield-Import) existiert nur der Haupt-Checkout. Die vorhandene `artifactPath(repoRoot, featureName, phase)` nimmt `repoRoot` als Parameter — es genügt, `base` einzusetzen; keine Signaturänderung nötig.

**Alternatives considered**: Immer `project.path` (wie beim Schwester-Feature für globale Definitionen) — falsch, weil per-Feature-Artefakte auf dem Feature-Branch im Worktree liegen und im Haupt-Checkout noch fehlen.

---

## Entscheidung 3 — Sperr-Semantik „Feature wird aktiv entwickelt" (FR-011)

**Decision**: Neue pure Funktion `featureLock(feature)` in `packages/shared`. `locked = FEATURE_PHASES.some(p => feature.phases[p]?.status === 'running')`. Sperrt **alle** Artefakte des Features (artefaktunabhängig, Clarify-Antwort Q4). Einsehen bleibt immer möglich.

**Rationale**: `PhaseState.status` (`'running'`) steht bereits im gelesenen App-State; keine neue Quelle nötig. Bewusst **feature-scoped** und damit anders als `phaseLock()` des Schwester-Features (projekt-/phasenweit) — passt exakt zur Clarify-Entscheidung.

**Alternatives considered**: Board-Status-basiert (Spalte) — verworfen (Q4); nur betroffener Schritt — verworfen (Q4).

---

## Entscheidung 4 — Split-Screen-Claude-Session

**Decision**: Wiederverwendung der bestehenden `TerminalPane`-Komponente mit `featureId`, gerendert in der rechten Hälfte des Modal-Overlays. Die Session wird über den bereits vorhandenen Default-Weg (`api.ensureSession(featureId)`, den `TerminalPane` selbst aufruft) sichergestellt. Toggle „Split-Screen" im Modal-Header; Aufteilung per einfachem Flex-Layout (Modal links, Konsole rechts).

**Rationale**: FR-015 verlangt ausdrücklich die **bestehende** Feature-Konsole; `TerminalPane` ist bereits ein wiederverwendbares xterm-⇄-WS-⇄-PTY-Panel und wird an mehreren Stellen eingesetzt. Kein neuer Session-Typ, keine Server-Änderung.

**Zu verifizieren (Spike, `tasks.md`)**: Mehrere gleichzeitige Terminal-WS-Clients auf **dieselbe** Feature-Session (Modal-Split-Screen + ggf. offene Konsolen-Ansicht). Server-PTYs leben serverseitig mit Scrollback-Replay; falls simultane Clients nicht sauber unterstützt werden, öffnet der Split-Screen dieselbe Session als aktiver Client (Reconnect-Handoff) — funktional ausreichend für den Einzelnutzer.

**Alternatives considered**: Neue dedizierte Session / Projekt-Chat — durch Q2 verworfen.

---

## Entscheidung 5 — Datei-Enumeration je Schritt (Mehrfach-Artefakte, FR-018)

**Decision**: Pure Funktion `featureArtifactFiles(base, featureName, phase)` in `shared` liefert eine geordnete Liste `{ id, label, relPath }`:
- **specify** → `spec.md`
- **plan** → `plan.md`, `research.md`, `data-model.md`, `quickstart.md` (jeweils falls vorhanden) + alle `contracts/*`
- **tasks** → `tasks.md`
- **checklist** → alle `checklists/*.md`

Nur tatsächlich existierende Dateien werden gelistet. Das Modal zeigt bei > 1 Datei einen Auswahl-Umschalter (Tabs/Dropdown); die erste Datei ist Default.

**Rationale**: `artifactPath()` liefert für `plan` nur `plan.md` und für `checklist` ein Verzeichnis. Die Enumeration ergänzt genau die von spec-kit erzeugten Begleitartefakte (belegt durch `specs/spec-kit-spezifikation-einsehen/`: `research.md`, `data-model.md`, `quickstart.md`, `contracts/`). Pure & getestet → deterministisch.

**Alternatives considered**: Nur die Primärdatei je Schritt anzeigen — verletzt FR-018 und verbirgt Plan-Begleitartefakte.

---

## Entscheidung 6 — Icon-Set & Tooltips (FR-001/FR-002)

**Decision**: Vier neue Outline-SVG-Icons im vorhandenen `icons.tsx`-Stil (24er-Grid, `currentColor`, `1em`) für Specify/Plan/Tasks/Checklist. Platzierung als kompakte Icon-Leiste auf der `FeatureCard`. Tooltip via `title`-Attribut (etabliertes Muster im Projekt), Text z. B. „Specify-Ergebnis ansehen (spec.md)". Icons für noch nicht erzeugte Artefakte werden deaktiviert dargestellt (reduzierte Deckkraft, `title` „noch kein Ergebnis").

**Rationale**: Konsistenz mit dem hausinternen SVG-Icon-Set (Feature „emojis-als-svg"); keine Emoji. `title` genügt für Hover-Kurzinfo ohne zusätzliche Tooltip-Abhängigkeit.

**Alternatives considered**: Emoji-Icons — widerspricht der SVG-Konvention. Externe Tooltip-Library — unnötige Komplexität.

---

## Offene NEEDS CLARIFICATION

Keine. Alle in der Technical Context genannten Unbekannten sind aufgelöst; die zwei Restrisiken (Editor-Kompatibilität/Round-Trip, simultane Terminal-Clients) sind als Umsetzungs-Spikes mit Fallback dokumentiert und blockieren das Design nicht.
