# Phase 0 Research: SDD-Schritt-Definitionen einsehen & bearbeiten

Ziel: Alle offenen technischen Entscheidungen aus dem Technical Context auflösen. Es verblieben keine `NEEDS CLARIFICATION`-Marker aus der Spec (durch `/speckit-clarify` geklärt).

## R1 – Wo liegen die Schritt-Definitionsdateien und wie werden sie aufgelöst?

**Decision**: Ein Resolver `phaseDefinitionPath(repoRoot, phase)` ermittelt die Datei analog zu `speckitCommandPrefix()` in `artifacts.ts`:
- Skills-Installation (aktuell): `<repoRoot>/.claude/skills/speckit-<phase>/SKILL.md`
- Ältere Command-Installation: `<repoRoot>/.claude/commands/speckit-<phase>.md` bzw. `speckit.<phase>.md`
- Existiert keine Datei → `null` (→ FR-004).

`repoRoot` ist der **Projekt-Checkout** (`project.path`), nicht der Feature-Worktree: Die Definition ist projektweit geteilt, nicht feature-spezifisch.

**Rationale**: Wiederverwendung des bereits vorhandenen, getesteten Erkennungsmusters (`.claude/skills` vs. `.claude/commands`). `packages/server/.claude/skills/speckit-*/SKILL.md` bestätigt Existenz und Struktur im Repo. Phase-Namen 1:1 auf Skill-Namen abbildbar (`FEATURE_PHASES`).

**Alternatives considered**:
- Feste Pfade ohne Erkennung — verworfen: bricht bei Command-style-Installationen.
- Worktree-Pfad statt Projekt-Pfad — verworfen: Definition ist geteilt; Worktree ist feature-lokal und kann fehlen.

## R2 – Projekt-Skopierung bei Board-Ansicht „Alle Projekte"

**Decision**: Lese-/Schreib-Endpunkte sind projekt-skopiert: `(projectId, phase)`. Der Dialog wird mit einer `projectId` geöffnet:
- Ist genau ein Projekt ausgewählt (`selectedProjectId`) → dieses.
- Ist „Alle" aktiv und existiert nur ein Projekt → dieses.
- Ist „Alle" aktiv bei mehreren Projekten → der Dialog zeigt oben eine kleine Projektauswahl (Default: erstes Projekt, das die Phase aktiviert hat); der Header nennt das aktuell angezeigte Projekt.

**Rationale**: Definitionen liegen physisch je Projekt vor und dürfen abweichen (Nutzer kann sie pro Projekt bearbeiten). Eine explizite `projectId` verhindert Mehrdeutigkeit und erfüllt FR-005 (jede sichtbare Lane abrufbar).

**Alternatives considered**:
- „Globale" gemeinsame Definition — verworfen: entspricht nicht der Dateirealität (je Projekt eigene `.claude/skills`). Die Spec-Annahme „projekt­übergreifend geteilt" wird hier auf „innerhalb eines Projekts geteilt" präzisiert.

## R3 – Konflikterkennung beim Speichern (FR-009)

**Decision**: Optimistic Concurrency per Datei-`mtimeMs`:
- `GET` liefert `content` + `mtimeMs` (aus `statSync`).
- `PUT` sendet `content` + `baseMtimeMs` (+ optional `overwrite: true`).
- Server vergleicht aktuelles `mtimeMs` mit `baseMtimeMs`. Weicht es ab und `overwrite` ist nicht gesetzt → `409 Conflict` mit aktuellem Inhalt/`mtimeMs`.
- Der Client zeigt dann die Wahl: **Überschreiben** (`PUT` mit `overwrite:true`) oder **Neu laden/Verwerfen** (übernimmt Server-Inhalt).

**Rationale**: `mtime` ist ausreichend, dateibasiert, ohne DB/Hashing; kein stiller Datenverlust (SC-004). Deckt „extern durch Agenten geändert" ab.

**Alternatives considered**:
- Inhalts-Hash statt `mtime` — verworfen: mehr Aufwand, für Einzelnutzer-Lokalszenario unnötig.
- Datei-Locks — verworfen: zu schwergewichtig; Konflikt ist selten und wird interaktiv gelöst.

## R4 – Bearbeiten sperren bei laufendem Agenten (FR-010)

**Decision**: Serverseitig `locked = true`, wenn **irgendein Feature des Projekts** `feature.phases[phase].status === 'running'` hat.
- `GET` liefert `locked` + `lockReason`; der Client rendert dann read-only.
- `PUT` prüft `locked` erneut und antwortet bei Sperre mit `409` (Reason `locked`).

**Rationale**: Definition wird zu Beginn eines Agentenlaufs gelesen; Änderungen während des Laufs sind für den Nutzer riskant/verwirrend. Read-only-Sperre + Server-Nachprüfung verhindert Clobbering. Status ist bereits in `Feature.phases[phase].status` vorhanden.

**Alternatives considered**:
- Sperre projektübergreifend (jedes Projekt) — verworfen: unnötig streng; Definitionen sind projektlokal.
- Nur clientseitige Sperre — verworfen: Race möglich, deshalb zusätzlich Server-Check.

## R5 – Markdown-Rendering im Web

**Decision**: `react-markdown` + `remark-gfm` als neue Web-Abhängigkeiten, ausschließlich für die **Leseansicht**. Bearbeitungsmodus nutzt ein einfaches `<textarea>` mit Rohtext.

**Rationale**: Definitionsdateien sind umfangreiches GFM-Markdown (Überschriften, Listen, Tabellen, Codeblöcke). Gerenderte Darstellung erfüllt „formatiert" (US1/SC) und macht Schritte verständlich. `react-markdown@9` ist klein, wartungsaktiv, React-19-kompatibel und läuft lokal (keine CSP-Restriktionen wie bei Artifacts).

**Alternatives considered**:
- Rohtext in `<pre>` (monospace) — verworfen als Primärlösung: lesbar, aber nicht „formatiert"; als Fallback bei Renderfehlern akzeptabel.
- Eigener Mini-Markdown-Renderer — verworfen: mehr Code/Bugs als eine etablierte, eng begrenzte Abhängigkeit.

## R6 – „Im externen Editor öffnen" (FR-011)

**Decision**: Projekt-skopierter Endpunkt, der das bestehende `project.editorCmd`-Template (`code -g {file}:{line}`, Default) gegen den absoluten Definitionspfad ausführt — analog zur vorhandenen `/api/open-in-editor`-Logik, aber ohne `featureId` (Auflösung über `project.path`).

**Rationale**: Wiederverwendung des etablierten Editor-Öffner-Musters (`loginShellEnv`, `shellQuotePath`, `exec`). Kein neuer Mechanismus.

**Alternatives considered**:
- Bestehenden `/api/open-in-editor` mit `featureId` zweckentfremden — verworfen: Definition ist nicht feature-, sondern projektskopiert.

## R7 – Icon-Platzierung im Lane-Header (FR-001/FR-004)

**Decision**: Info-Button im vorhandenen Header-`<div>` von `KanbanBoard` (neben Titel/Zähler), **nur** für Phasen-Spalten (`column !== 'integration' && column !== 'done'`). Für Zustands-Spalten kein Icon (FR-004).

**Rationale**: Header-Struktur existiert bereits (`flex items-center justify-between`); minimaler Eingriff. `PHASE_LABELS`/`FeaturePhase` grenzen Phasen-Spalten sauber ab.

**Alternatives considered**:
- Icon auf Feature-Karten — verworfen: durch `/speckit-clarify` explizit auf Lane-Header festgelegt.

## Zusammenfassung offener Punkte

Keine offenen `NEEDS CLARIFICATION`. Alle Technical-Context-Entscheidungen sind getroffen und in `data-model.md` / `contracts/` konkretisiert.
