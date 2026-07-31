---
description: "Task list for Emojis als SVG-Icons (Wissensdatenbank & Wissens-Chat)"
---

# Tasks: Emojis als SVG-Icons (Wissensdatenbank & Wissens-Chat)

**Input**: Design documents from `specs/emojis-im-projekt-immer-als-svg-icon-hinterlegen/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/icon-component.md, quickstart.md

**Tests**: Nicht angefordert. Das Web-Paket hat kein Test-Harness (MVP); es wird bewusst keines eingeführt (siehe plan.md / research.md Entscheidung 7). Verifikation erfolgt über `typecheck`, `build`, Grep-Checks und die Sichtprüfungen in `quickstart.md`.

**Organization**: Tasks sind nach User Story gruppiert. Das gemeinsame Icon-Modul ist blockierende Grundlage für alle Stories (Phase 2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisierbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1 (Wissensdatenbank), US2 (Wissens-Chat), US3 (Konsistenz & Zugänglichkeit)
- Alle Pfade relativ zum Repo-Root

## Path Conventions

Web-Frontend im pnpm-Monorepo: Quellcode unter `packages/web/src/`. Nur `packages/web/src/components/` wird berührt.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ausgangslage sichern (Brownfield — kein Projekt-Init nötig)

- [X] T001 Baseline sichern: `pnpm --filter @sdd/web typecheck` und `pnpm --filter @sdd/web build` grün ausführen und die Ist-Emoji je Datei notieren (Referenz: `data-model.md` „Emoji→Icon-Zuordnung"), damit spätere Grep-/Layout-Vergleiche eine Vorher-Basis haben. Kein Code-Change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Das gemeinsame Icon-Modul — Voraussetzung für JEDE User Story

**⚠️ CRITICAL**: US1 und US2 können erst starten, wenn dieses Modul steht (beide importieren daraus).

- [X] T002 Icon-Modul anlegen: `packages/web/src/components/icons.tsx` mit gemeinsamem `IconProps`-Typ (`className?`, `title?`) und einer internen Basis-SVG-Konvention gemäß `contracts/icon-component.md` — `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`, `strokeLinecap/Linejoin="round"`, Default-Größe `1em`, per Default `aria-hidden="true"` + `focusable="false"`; bei gesetztem `title` stattdessen `role="img"` + `aria-label={title}`. `className` wird durchgereicht/gemerged.
- [X] T003 Die 15 benannten Icon-Komponenten in `packages/web/src/components/icons.tsx` implementieren (Geometrie an Lucide angelehnt, siehe `data-model.md` Icon-Katalog): `KnowledgeIcon, BundleIcon, EntryIcon, BundlePlusIcon, EntryPlusIcon, EditIcon, DeleteIcon, RefreshIcon, CloseIcon, ChatIcon, IdeaIcon, CheckIcon, WarningIcon, RestartIcon, PauseIcon`. (Abhängig von T002, gleiche Datei.)

**Checkpoint**: Icon-Set steht und ist per `pnpm --filter @sdd/web typecheck` fehlerfrei → Stories können beginnen.

---

## Phase 3: User Story 1 - Wissensdatenbank mit designkonformen SVG-Icons (Priority: P1) 🎯 MVP

**Goal**: Alle Emoji der Wissensdatenbank (Sidebar-/Header-Aufruf, Bundle-/Eintrags-Marker, Aktionen, Index, Feature-Wissensauswahl) durch SVG-Icons ersetzen; Funktion/Tooltips unverändert.

**Independent Test**: `quickstart.md` Schritte 1–5 — Wissensdatenbank öffnen, Bundles/Einträge anlegen/bearbeiten/löschen/importieren, Baum↔Index umschalten, Feature-Wissensauswahl öffnen; kein Emoji sichtbar, alle Aktionen funktionieren.

- [X] T004 [P] [US1] `packages/web/src/components/Sidebar.tsx` (~Z. 79): 📚 im „Projektspezifisches Wissen"-Button durch `<KnowledgeIcon />` ersetzen; `onClick`, `title` und Klassen unverändert lassen.
- [X] T005 [P] [US1] `packages/web/src/components/FeatureConsole.tsx` (~Z. 41): 📚 im `HeaderIcon` „Projektwissen für dieses Feature" durch `<KnowledgeIcon />` ersetzen; `title`/`onClick` unverändert.
- [X] T006 [P] [US1] `packages/web/src/components/KnowledgePanel.tsx`: alle Glyphen ersetzen — Bundle-Marker 📦 (~Z. 118) → `<BundleIcon />`; `+📦` (~Z. 122) → `<BundlePlusIcon />`; `+📄` (~Z. 123) → `<EntryPlusIcon />`; ✎ (~Z. 124, 174) → `<EditIcon />`; 🗑 (~Z. 135, 185) → `<DeleteIcon />`; Eintrags-Marker 📄 (~Z. 162) → `<EntryIcon />`; ⟳ (~Z. 172) → `<RefreshIcon />`; IndexView 📦/📄 (~Z. 198) → `<BundleIcon />`/`<EntryIcon />`; Prosa-Referenz „via ⟳ aktualisieren" (~Z. 305) neutral umformulieren (z. B. „über Aktualisieren neu laden") ODER kleines Inline-`<RefreshIcon />` einbetten. Marker in ihren vorhandenen farbgebenden `<span>`-Wrappern belassen, `IconBtn`-`title`/`onClick` unverändert.
- [X] T007 [P] [US1] `packages/web/src/components/FeatureKnowledgeSelect.tsx` (~Z. 56): bedingtes 📦/📄 durch `<BundleIcon />`/`<EntryIcon />` ersetzen; umgebender `<span className="text-zinc-600">` und Layout unverändert.
- [X] T008 [US1] US1 verifizieren: `pnpm --filter @sdd/web typecheck` + `build` grün; Grep über `Sidebar.tsx`, `FeatureConsole.tsx`, `KnowledgePanel.tsx`, `FeatureKnowledgeSelect.tsx` liefert keine der Glyphen `📚 📦 📄 🗑 ✎ ⟳`; `quickstart.md` Schritte 1–5 visuell bestätigen. (Abhängig von T004–T007.)

**Checkpoint**: Wissensdatenbank ist vollständig auf SVG-Icons umgestellt und eigenständig funktionsfähig (MVP).

---

## Phase 4: User Story 2 - Wissens-Chat mit designkonformen SVG-Icons (Priority: P2)

**Goal**: Alle Emoji/Symbolzeichen im Wissens-Chat (Sprechblase, Panel-Kopf, Vorschlagskarte, Status/Fehler/Unterbrechung) durch SVG-Icons ersetzen; `▍` und `→` bleiben unverändert.

**Independent Test**: `quickstart.md` Schritte 6–10 — Chat öffnen/schließen, Nachricht senden, Feature-Vorschlag + Status ansehen, Fehler-/Unterbrechungshinweis prüfen, „Neu" nutzen; kein Emoji sichtbar, Aktionen unverändert.

- [X] T009 [P] [US2] `packages/web/src/components/ChatBubble.tsx` (~Z. 26): Toggle-Glyphen ersetzen — `open ? ✕ : 💬` → `open ? <CloseIcon className="h-6 w-6" /> : <ChatIcon className="h-6 w-6" />`; `title`-Wechsel und `busy`-Punkt-Overlay unverändert.
- [X] T010 [P] [US2] `packages/web/src/components/ChatPanel.tsx`: ↺ im „Neu"-Button (~Z. 109) → `<RestartIcon />` (Text „Neu" bleibt); ✕ Schließen (~Z. 117) und ✕ Fehler-Dismiss (~Z. 148) → `<CloseIcon />`; 💡 Vorschlags-Marker (~Z. 217) → `<IdeaIcon />`; ✓ „angenommen" (~Z. 225) → `<CheckIcon />` (Text bleibt); ⚠ Fehlerhinweis (~Z. 274) → `<WarningIcon />`; ⏸ Unterbrechung (~Z. 277) → `<PauseIcon />`. Streaming-Cursor `▍` (~Z. 272) und „Zur Feature-Konsole →" (~Z. 251) NICHT ändern. Farbgebende `text-*`-Klassen der Wrapper unverändert lassen.
- [X] T011 [US2] US2 verifizieren: `pnpm --filter @sdd/web typecheck` + `build` grün; Grep über `ChatBubble.tsx`, `ChatPanel.tsx` liefert keine der Glyphen `💬 ✕ 💡 ✓ ⚠ ↺ ⏸` (aber `▍` und `→` weiterhin vorhanden); `quickstart.md` Schritte 6–10 visuell bestätigen. (Abhängig von T009–T010.)

**Checkpoint**: US1 und US2 sind beide unabhängig funktionsfähig und emoji-frei.

---

## Phase 5: User Story 3 - Einheitliches, zugängliches Icon-System (Priority: P3)

**Goal**: Sicherstellen, dass beide Oberflächen ein kohärentes, zugängliches Icon-Set nutzen (gleiche Bedeutung → gleiches Icon, currentColor, Tooltips erhalten, keine Layout-Sprünge).

**Independent Test**: `quickstart.md` Schritte 11–13 — Wissensdatenbank und Chat nebeneinander vergleichen; gleiche Bedeutungen sehen identisch aus, Größe/Ausrichtung passt, Tooltips funktionieren, Screenreader liest keine Emoji-Wörter.

- [X] T012 [US3] Konsistenz prüfen (SC-003): In `KnowledgePanel.tsx` und `FeatureKnowledgeSelect.tsx` verwenden Bundle/Eintrag dieselben `BundleIcon`/`EntryIcon`; in `ChatBubble.tsx` und `ChatPanel.tsx` verwendet „Schließen" dasselbe `CloseIcon`. Keine divergierenden Symbole für dieselbe Bedeutung; alle stammen aus `icons.tsx`.
- [X] T013 [US3] Zugänglichkeit prüfen (FR-006/FR-007): In allen sechs Dateien tragen interaktive Icons weiterhin ihr Button-`title` (dekoratives Icon `aria-hidden`); wo ein Icon die einzige Bedeutungsquelle ohne Button-`title` wäre, `title`-Prop am Icon setzen. Stichprobe: dekoratives Icon rendert `aria-hidden`, betiteltes Icon rendert `aria-label`.
- [X] T014 [US3] Layout/Größe prüfen (FR-008/SC-006): Icons erscheinen in Textzeilen-Größe (`1em`) und vertikal ausgerichtet; Vergleich gegen die Baseline aus T001 → keine sichtbaren Ausrichtungs-/Größensprünge in `Sidebar.tsx`, `FeatureConsole.tsx`, `KnowledgePanel.tsx`, `FeatureKnowledgeSelect.tsx`, `ChatBubble.tsx`, `ChatPanel.tsx`.

**Checkpoint**: Beide Oberflächen wirken als ein Guss und sind zugänglich.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Vollständigkeitsnachweis über den gesamten Scope

- [X] T015 [P] Gesamt-Grep (VR-1/SC-001): über alle sechs Dateien sicherstellen, dass keine Katalog-Glyphe `📚|📦|📄|🗑|💬|💡|✎|✕|⟳|✓|⚠|↺|⏸` mehr vorkommt (Ausnahmen `▍`, `→`). Befehl siehe `quickstart.md` Schritt 1; zusätzlich `icons.tsx` auf feste Farbliterale prüfen (nur `currentColor`).
- [ ] T016 Vollständige `quickstart.md`-Validierung end-to-end durchführen (`pnpm dev`, Schritte 1–13). **Teilweise erledigt**: automatisierte Checks grün — Schritt 1 (Grep: 0 In-Scope-Emoji), Schritt 2 (`typecheck` + `build` grün). **Ausstehend**: interaktive Sichtprüfung Schritte 3–13 im laufenden Browser (erfordert Projekt mit Wissensdaten + Chat) — empfohlene manuelle QA vor Merge.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: keine Abhängigkeiten.
- **Foundational (Phase 2)**: nach Setup; **blockiert alle Stories** (Icon-Modul).
- **User Stories (Phase 3–5)**: alle abhängig von Phase 2.
  - US1 (P1) und US2 (P2) sind untereinander unabhängig (verschiedene Dateien).
  - US3 (P3) ist eine Querschnitts-/Verifikationsstory und setzt US1 **und** US2 voraus.
- **Polish (Phase 6)**: nach allen gewünschten Stories.

### User Story Dependencies

- **US1 (P1)**: nach Foundational, keine Story-Abhängigkeit → MVP.
- **US2 (P2)**: nach Foundational, unabhängig von US1.
- **US3 (P3)**: nach US1 + US2 (prüft Konsistenz/Zugänglichkeit über beide Oberflächen).

### Within Each User Story

- Ersetzungs-Tasks (verschiedene Dateien) parallel → dann Verifikations-Task der Story.

### Parallel Opportunities

- Nach T003 (Icon-Modul fertig) können **alle sechs Ersetzungs-Tasks** parallel laufen, da sie verschiedene Dateien betreffen: T004, T005, T006, T007 (US1) und T009, T010 (US2).
- Innerhalb US1: T004–T007 sind [P]. Innerhalb US2: T009–T010 sind [P].
- T015 [P] kann unabhängig vom finalen Visual-Check vorbereitet werden.
- Verifikations-Tasks (T008, T011) hängen von ihren Ersetzungs-Tasks ab und sind nicht [P].

---

## Parallel Example: nach dem Icon-Modul (T003)

```bash
# Alle Datei-Ersetzungen parallel (verschiedene Dateien, nur Abhängigkeit = Icon-Modul):
Task: "Sidebar.tsx: 📚 → KnowledgeIcon"                     # T004 [US1]
Task: "FeatureConsole.tsx: 📚 → KnowledgeIcon"              # T005 [US1]
Task: "KnowledgePanel.tsx: alle Glyphen → Icons"           # T006 [US1]
Task: "FeatureKnowledgeSelect.tsx: 📦/📄 → Bundle/Entry"    # T007 [US1]
Task: "ChatBubble.tsx: 💬/✕ → Chat/Close"                  # T009 [US2]
Task: "ChatPanel.tsx: ✕ 💡 ✓ ⚠ ↺ ⏸ → Icons"               # T010 [US2]
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (T001) → Phase 2 (T002–T003, Icon-Modul).
2. Phase 3 (T004–T008): Wissensdatenbank umstellen.
3. **STOP & VALIDATE**: `quickstart.md` Schritte 1–5 → MVP steht.

### Incremental Delivery

1. Setup + Foundational → Icon-Set bereit.
2. US1 → unabhängig testen → Demo (MVP).
3. US2 → unabhängig testen → Demo.
4. US3 → Konsistenz/Zugänglichkeit über beide Oberflächen bestätigen.
5. Polish → Gesamt-Grep + volle quickstart-Validierung.

---

## Notes

- Tests bewusst ausgelassen (kein Web-Test-Harness; Over-Engineering vermeiden) — Verifikation via typecheck/build/grep/visual.
- `[P]` = andere Datei, keine offene Abhängigkeit.
- Farbe/Größe kommen aus dem Kontext (`currentColor`, `1em`); die bestehenden `text-*`-Wrapper-Klassen NICHT verändern — so bleiben Status-/Akzentfarben erhalten.
- `▍` (Streaming-Cursor) und `→` (Button-Text-Pfeil) sind bewusst out of scope.
- Die README-Prosa erwähnt „das 📚-Icon"; das liegt außerhalb des Feature-Scopes (nur UI-Oberflächen) und wird hier nicht geändert.
- Nach jedem Task oder logischer Gruppe committen.
